// Ende-zu-Ende-Test für „Umriss verfeinern“: Werkstück mit simulierter Kamera anlegen, dann im
// Vollbild die Regler an den erkannten Umriss schieben, mit zwei Fingern zoomen, Mittelachse
// verschieben, mit Pinsel und Radierer malen und übernehmen. Screenshots: tools/test/ausgabe/fein-*.png
//
//   node tools/test/verfeinern-test.mjs [Szene=1703]

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { szene, rendern } from './szene.mjs';

const seed = Number(process.argv[2]) || 1703;
const wurzel = new URL('../../', import.meta.url).pathname;
const ausgabe = new URL('./ausgabe/', import.meta.url).pathname;
await mkdir(ausgabe, { recursive: true });

// Kamerabild als Y4M-Video
const s = szene(seed, { W: 432, Hpx: 936, frontal: true, fuell: 0.3 });
const { width: W, height: H, data } = rendern(s, { ss: 1 });
const Yb = Buffer.alloc(W * H), Ub = Buffer.alloc((W / 2) * (H / 2)), Vb = Buffer.alloc((W / 2) * (H / 2));
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
  Yb[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  if (!(x & 1) && !(y & 1)) {
    const k = (y / 2) * (W / 2) + x / 2;
    Ub[k] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    Vb[k] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
  }
}
const frames = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
for (let f = 0; f < 10; f++) frames.push(Buffer.from('FRAME\n'), Yb, Ub, Vb);
const video = join(ausgabe, 'kamera.y4m');
await writeFile(video, Buffer.concat(frames));

const typen = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const datei = join(wurzel, pfad === '/' ? 'index.html' : pfad);
    res.writeHead(200, { 'content-type': typen[extname(datei)] || 'application/octet-stream' });
    res.end(await readFile(datei));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
const page = await ctx.newPage();
const fehler = [];
page.on('pageerror', e => fehler.push(e.message));
page.on('console', m => { if (m.type() === 'error') fehler.push(m.text()); });
const pruefe = (ok, text) => { console.log(`${ok ? '✓' : '✗'} ${text}`); if (!ok) fehler.push(text); };

// Werkstück mit geführter Aufnahme anlegen
await page.goto(`http://localhost:${port}/#/werkstueck/neu`);
await page.click('[data-pick="guided"]');
await page.waitForSelector('.kamera video');
await page.waitForTimeout(800);
for (let i = 0; i < 4; i++) { await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0.2 }))); await page.waitForTimeout(250); }
await page.click('.kamera-ausloeser');
await page.waitForSelector('.pp-item img[src]', { timeout: 10000 });
await page.fill('input[name="name"]', 'Testbecher');
await page.click('button[type="submit"]');
await page.waitForSelector('.bp-card svg', { timeout: 20000 });

const stueck = () => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => {
    const tx = r.result.transaction(['pieces', 'photos']);
    const q = tx.objectStore('pieces').getAll();
    q.onsuccess = async () => {
      const p = q.result[0];
      const f = tx.objectStore('photos').get(p.blueprint.photoId);
      f.onsuccess = async () => { const bmp = await createImageBitmap(f.result.blob); res({ bp: p.blueprint, NW: bmp.width, NH: bmp.height }); };
    };
  };
}));
const vorher = await stueck();

// Vollbild öffnen
await page.click('#bp-fein');
await page.waitForSelector('.fein canvas');
const fertigGerechnet = () => page.waitForFunction(() => !document.querySelector('.fein-status')?.textContent.includes('neu berechnet'), null, { timeout: 20000 });
await fertigGerechnet();
await page.screenshot({ path: join(ausgabe, 'fein-1-offen.png') });
pruefe(!(await page.isDisabled('.fein-ok')), 'Umriss im Vollbild berechnet');

// Umrechnung Bild → Bildschirm (wie in verfeinern.js, ohne Zoom)
const cr = await page.evaluate(() => { const r = document.querySelector('.fein canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const { NW, NH } = vorher;
const S0 = Math.min((cr.w - 68) / NW, (cr.h - 68) / NH);
const ox = cr.x + (cr.w - NW * S0) / 2, oy = cr.y + (cr.h - NH * S0) / 2;
const sx = u => ox + u * NW * S0, sy = t => oy + t * NH * S0;

const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
async function ziehen(von, nach, schritte = 8) {
  await touch('touchStart', [von]);
  for (let i = 1; i <= schritte; i++) await touch('touchMove', [[von[0] + ((nach[0] - von[0]) * i) / schritte, von[1] + ((nach[1] - von[1]) * i) / schritte]]);
  await touch('touchEnd', []);
}

// Regler an den erkannten Umriss schieben (Griffe liegen außen an der Linie, mittig)
const k = vorher.bp.umriss.koerper;
const box = { x0: Math.min(...k.map(p => p[0])), x1: Math.max(...k.map(p => p[0])), y0: Math.min(...k.map(p => p[1])), y1: Math.max(...k.map(p => p[1])) };
const mx = (sx(0) + sx(1)) / 2, my = (sy(0) + sy(1)) / 2;
await ziehen([mx, Math.max(cr.y + 15, sy(0) - 17)], [mx, sy(box.y0) - 17]);
await ziehen([mx, sy(1) + 17], [mx, sy(box.y1) + 17]);
await ziehen([Math.max(cr.x + 15, sx(0) - 17), my], [sx(box.x0) - 17, my]);
await ziehen([sx(1) + 17, my], [sx(box.x1) + 17, my]);
await fertigGerechnet();
await page.screenshot({ path: join(ausgabe, 'fein-2-regler.png') });
const status = await page.textContent('.fein-status');
pruefe(!(await page.isDisabled('.fein-ok')), `Neu berechnet mit Reglern: ${status}`);

// Mittelachse etwas verschieben (in der Mitte zwischen den Enden greifen)
const ax = (box.x0 + box.x1) / 2, ay = (box.y0 + box.y1) / 2;
await ziehen([sx(ax), sy(ay)], [sx(ax) + 4, sy(ay)]);
await fertigGerechnet();

// Zwei Finger: zoomen
const c = [cr.x + cr.w / 2, cr.y + cr.h / 2];
await touch('touchStart', [[c[0] - 30, c[1]], [c[0] + 30, c[1]]]);
for (let i = 1; i <= 10; i++) await touch('touchMove', [[c[0] - 30 - i * 8, c[1]], [c[0] + 30 + i * 8, c[1]]]);
await touch('touchEnd', []);
await page.waitForTimeout(200);
await page.screenshot({ path: join(ausgabe, 'fein-3-zoom.png') });

// Pinsel und Radierer
await page.click('[data-tool="pinsel"]');
await ziehen([c[0] + 60, c[1] - 40], [c[0] + 70, c[1] + 40]);
await fertigGerechnet();
await page.click('[data-tool="radierer"]');
await ziehen([c[0] - 150, c[1] - 40], [c[0] - 150, c[1] + 40]);
await fertigGerechnet();
await page.screenshot({ path: join(ausgabe, 'fein-4-pinsel.png') });
await page.click('[data-aktion="einpassen"]');
await page.waitForTimeout(100);
await page.screenshot({ path: join(ausgabe, 'fein-5-ganz.png') });

// Übernehmen
await page.click('.fein-ok');
await page.waitForSelector('.fein', { state: 'detached' });
await page.waitForTimeout(800);
const nachher = await stueck();
console.log('Vorgaben:', JSON.stringify(nachher.bp.fein), 'Striche:', nachher.bp.brush.length);
pruefe(nachher.bp.fein && nachher.bp.fein.oben != null && nachher.bp.fein.unten != null && nachher.bp.fein.links != null && nachher.bp.fein.rechts != null, 'Regler gespeichert');
pruefe(!!nachher.bp.fein?.achse, 'Mittelachse gespeichert');
pruefe(nachher.bp.brush.length === 2, 'Pinsel- und Radiererstrich gespeichert');
await page.screenshot({ path: join(ausgabe, 'fein-6-werkstueck.png'), fullPage: true });
pruefe(page.url().endsWith(`/werkstueck/${await page.evaluate(() => location.hash.split('/')[2])}`), `Wieder auf der Werkstückseite (${page.url().split('#')[1]})`);

// Im Editor: Vorgaben bleiben erhalten
await page.click('a[href$="/umriss"]');
await page.waitForSelector('#bp-preview svg', { timeout: 20000 });
await page.screenshot({ path: join(ausgabe, 'fein-7-editor.png'), fullPage: true });
pruefe((await page.textContent('#bp-status')).includes('Von Hand verfeinert'), 'Editor zeigt „Von Hand verfeinert“');
pruefe(!(await page.isHidden('#bp-fein-weg')), '„Vorgaben entfernen“ sichtbar');

// Zurück-Taste schließt das Vollbild, ohne die Seite zu verlassen
await page.click('#bp-fein');
await page.waitForSelector('.fein canvas');
const hash = await page.evaluate(() => location.hash);
await page.goBack();
await page.waitForSelector('.fein', { state: 'detached' });
pruefe(await page.evaluate(() => location.hash) === hash && await page.isVisible('#bp-fein'), 'Zurück-Taste schließt nur das Vollbild');

console.log(fehler.length ? `FEHLER:\n${fehler.join('\n')}` : 'Keine Fehler.');
await browser.close();
server.close();
process.exit(fehler.length ? 1 : 0);
