// Ende-zu-Ende-Test im Browser: geführte Aufnahme mit simulierter Kamera (gerendertes
// Testfoto als Kamerabild) und simuliertem Lagesensor → Werkstück speichern → Blaupause
// → Umriss-Editor. Screenshots landen in tools/test/ausgabe/app-*.png.
//
//   node tools/test/app-test.mjs [Szene=1703]

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { szene, rendern } from './szene.mjs';

const seed = Number(process.argv[2]) || 1703;
const wurzel = new URL('../../', import.meta.url).pathname;
const ausgabe = new URL('./ausgabe/', import.meta.url).pathname;

// Kamerabild als Y4M-Video (so liest Chromium eine Ersatzkamera)
const s = szene(seed, { W: 432, Hpx: 936, frontal: true, fuell: 0.3 }); // Seitenverhältnis wie das Handydisplay
const bild = rendern(s, { ss: 1 });
const { width: W, height: H, data } = bild;
const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
  Y[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  if (!(x & 1) && !(y & 1)) {
    const k = (y / 2) * (W / 2) + x / 2;
    U[k] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    V[k] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
  }
}
const frames = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
for (let f = 0; f < 10; f++) frames.push(Buffer.from('FRAME\n'), Y, U, V);
const video = join(ausgabe, 'kamera.y4m');
await writeFile(video, Buffer.concat(frames));

// kleiner Webserver für die App
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

await page.goto(`http://localhost:${port}/#/werkstueck/neu`);
await page.waitForSelector('[data-pick="guided"]');
await page.click('[data-pick="guided"]');
await page.waitForSelector('.kamera video');
// Lagesensor: erst schief und nach unten gekippt, dann gerade
const lage = (beta, gamma) => page.evaluate(([b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g })), [beta, gamma]);
await page.waitForTimeout(800);
await lage(75, 4);
await page.waitForTimeout(700);
await page.screenshot({ path: join(ausgabe, 'app-1-kamera-schief.png') });
console.log('Hinweis (schief):', await page.textContent('.kamera-hinweis'));
for (let i = 0; i < 4; i++) { await lage(90, 0.2); await page.waitForTimeout(250); }
await page.screenshot({ path: join(ausgabe, 'app-2-kamera-gerade.png') });
console.log('Hinweis (gerade):', await page.textContent('.kamera-hinweis'));
await page.click('.kamera-ausloeser');
await page.waitForSelector('.pp-item img[src]', { timeout: 10000 });
await page.fill('input[name="name"]', 'Testbecher');
await page.fill('input[name="nass.hoehe"]', '10');
await page.click('button[type="submit"]');
await page.waitForSelector('.bp-card svg', { timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(ausgabe, 'app-3-werkstueck.png'), fullPage: true });
await page.click('a[href$="/umriss"]');
await page.waitForSelector('#bp-preview svg', { timeout: 20000 });
await page.waitForTimeout(400);
console.log('Status:', await page.textContent('#bp-status'));
await page.screenshot({ path: join(ausgabe, 'app-4-umriss.png'), fullPage: true });

// Henkel-Werkzeug: öffnet das Vollbild; einseitig gemalter Henkel darf den Körper nicht ändern
const lies = () => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => { const q = r.result.transaction('pieces').objectStore('pieces').getAll(); q.onsuccess = () => res(q.result[0].blueprint); };
}));
const vorher = await lies();
await page.click('#bp-mode input[value="henkel"] + span');
await page.waitForSelector('.bp-werkzeug.vollbild');
await page.waitForTimeout(300);
const cdp = await ctx.newCDPSession(page);
const box = await page.locator('.bp-werkzeug canvas').boundingBox();
const P = (fx, fy) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ ...p, id })) });
// Henkel rechts neben den Körper malen (ein Finger)
const bogen = [[0.62, 0.43], [0.68, 0.44], [0.71, 0.48], [0.71, 0.52], [0.68, 0.56], [0.62, 0.57]];
await touch('touchStart', [P(...bogen[0])]);
for (const b of bogen.slice(1)) { await touch('touchMove', [P(...b)]); await page.waitForTimeout(30); }
await touch('touchEnd', []);
await page.waitForTimeout(600);
console.log('Status (Henkel):', await page.textContent('#bp-status'));
await page.screenshot({ path: join(ausgabe, 'app-5-vollbild-henkel.png') });
// mit zwei Fingern hineinzoomen
await touch('touchStart', [P(0.45, 0.5), P(0.55, 0.5)]);
for (let k = 1; k <= 6; k++) { await touch('touchMove', [P(0.45 - k * 0.04, 0.5), P(0.55 + k * 0.04, 0.5)]); await page.waitForTimeout(30); }
await touch('touchEnd', []);
await page.waitForTimeout(300);
await page.screenshot({ path: join(ausgabe, 'app-6-vollbild-zoom.png') });
await page.click('#bp-fertig');
await page.click('#apply');
await page.waitForSelector('.bp-card svg', { timeout: 20000 });
const nachher = await lies();
const henkelStriche = nachher.brush.filter(b => b.henkel).length;
let abw = 0;
for (let i = 0; i < vorher.profile.length; i++) abw = Math.max(abw, Math.abs(vorher.profile[i] - nachher.profile[i]));
console.log(`Henkel-Striche gespeichert: ${henkelStriche}, Henkel in der Blaupause: ${nachher.handles.length}, größte Änderung des Körpers: ${(abw * 100).toFixed(2)} % der Höhe`);
if (!henkelStriche || !nachher.handles.length || abw > 0.005) fehler.push('Henkel-Werkzeug: Henkel fehlt oder Körper hat sich geändert');
await page.screenshot({ path: join(ausgabe, 'app-7-werkstueck-henkel.png'), fullPage: true });
const meta = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result.map(p => p.kamera)); };
}));
console.log('Aufnahmedaten:', JSON.stringify(meta));
// gespeichertes Foto zum Nachprüfen ablegen
const png = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => {
    const q = r.result.transaction('photos').objectStore('photos').getAll();
    q.onsuccess = async () => {
      const bmp = await createImageBitmap(q.result[0].blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      res(c.toDataURL('image/png'));
    };
  };
}));
await writeFile(join(ausgabe, 'app-foto.png'), Buffer.from(png.split(',')[1], 'base64'));
await writeFile(join(ausgabe, 'app-foto.json'), JSON.stringify(meta[0]));
console.log(fehler.length ? `FEHLER:\n${fehler.join('\n')}` : 'Keine Fehler in der Konsole.');
await browser.close();
server.close();
