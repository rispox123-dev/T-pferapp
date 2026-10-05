// Test im Browser: Umblättern zwischen den Bereichen der Tableiste – per Wischen am Seitenrand
// (Blatt folgt dem Finger, zu kurzes Wischen legt es zurück) und mit den Skizzen der Blaupausen
// auf dem Blatt (dürfen beim Umblättern nicht schwarz werden). Screenshots in
// tools/test/ausgabe/umblaettern-*.png.
//
//   node tools/test/umblaettern-test.mjs

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PNG } from 'pngjs';
import { szene, rendern } from './szene.mjs';

const wurzel = new URL('../../', import.meta.url).pathname;
const ausgabe = new URL('./ausgabe/', import.meta.url).pathname;
await mkdir(ausgabe, { recursive: true });

const bild = rendern(szene(1703, { W: 360, Hpx: 480, frontal: true }), { ss: 1 });
const png = new PNG({ width: bild.width, height: bild.height });
png.data = Buffer.from(bild.data);
const foto = PNG.sync.write(png);

const typen = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const datei = join(wurzel, pfad === '/' ? 'index.html' : pfad);
    res.writeHead(200, { 'content-type': typen[extname(datei)] || 'application/octet-stream' });
    res.end(await readFile(datei));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const fehler = [];
page.on('pageerror', e => fehler.push(e.message));
page.on('console', m => { if (m.type() === 'error') fehler.push(m.text()); });
const pruefe = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FEHLER'} ${text}`); if (!ok) fehler.push(text); };
const titel = () => page.textContent('#page-title');

// Fingerbewegung über das Chrome-DevTools-Protokoll
const cdp = await ctx.newCDPSession(page);
const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function wischen(x0, x1, { y = 420, schritte = 12, pause = 16, halt = null } = {}) {
  await finger('touchStart', x0, y);
  for (let i = 1; i <= schritte; i++) {
    await finger('touchMove', x0 + (x1 - x0) * i / schritte, y);
    await page.waitForTimeout(pause);
    if (halt && i === halt.bei) await halt.tun();
  }
  await finger('touchEnd');
}

// ein Stück mit Blaupause anlegen
await page.goto(`http://localhost:${port}/#/werkstueck/neu`);
await page.waitForSelector('.pp-lib', { state: 'attached' });
await page.fill('input[name="name"]', 'Wisch-Becher');
await page.setInputFiles('.pp-lib', { name: 'becher.png', mimeType: 'image/png', buffer: foto });
await page.waitForSelector('dialog.masse[open]', { timeout: 10000 });
await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
await page.click('button[type="submit"]');
await page.waitForSelector('.bp-card svg', { timeout: 20000 });

// Übersicht als Skizzenbuch
await page.goto(`http://localhost:${port}/#/werkstuecke`);
await page.waitForSelector('#ansicht');
await page.click('#ansicht');
await page.waitForSelector('.skizze-tile svg.skizze');
const kachel = await page.locator('.skizze-tile .skizze-bild').boundingBox();
const vorher = await page.screenshot({ clip: kachel });

// Anteil fast schwarzer Bildpunkte: Bleistiftstriche sind dünn, eine schwarz gefüllte Form nicht
const dunkel = buf => { const p = PNG.sync.read(buf); let n = 0; for (let i = 0; i < p.data.length; i += 4) if ((p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3 < 90) n++; return n / (p.data.length / 4); };

// ---------- vom rechten Rand nach links wischen, Finger in der Mitte anhalten ----------
let mitte = null;
await wischen(385, 60, {
  halt: {
    bei: 6,
    tun: async () => {
      mitte = await page.evaluate(() => {
        const b = document.querySelector('.blatt');
        if (!b) return null;
        const refs = [...b.querySelectorAll('svg *')].flatMap(n => [...n.attributes].map(a => a.value))
          .flatMap(v => [...v.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]));
        return {
          ziehen: b.classList.contains('ziehen') && b.classList.contains('vor'),
          winkel: b.style.getPropertyValue('--winkel'),
          refs: refs.length,
          fehlend: refs.filter(id => !b.querySelector(`[id="${CSS.escape(id)}"]`)),
          titelDarunter: document.getElementById('page-title').textContent,
        };
      });
      await page.screenshot({ path: join(ausgabe, 'umblaettern-1-wischen.png') });
    },
  },
});
console.log('mitten im Wischen:', JSON.stringify(mitte));
pruefe(mitte?.ziehen, 'Wischen vom rechten Rand hebt das Blatt nach vorn');
pruefe(mitte && parseFloat(mitte.winkel) < -20 && parseFloat(mitte.winkel) > -91, `Blatt folgt dem Finger (${mitte?.winkel})`);
pruefe(mitte?.titelDarunter === 'Glasieren', 'darunter liegt schon „Glasieren“');
pruefe(mitte?.refs > 0 && mitte.fehlend.length === 0, `Skizzen auf dem Blatt: alle Filter/Masken gefunden (${mitte?.refs} Verweise, fehlend: ${mitte?.fehlend.join(', ') || '–'})`);
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });
pruefe((await titel()) === 'Glasieren', 'nach dem Wischen: Glasieren');

// ---------- Skizze beim Umblättern über die Tableiste: nicht schwarz ----------
await page.goto(`http://localhost:${port}/#/werkstuecke`);
await page.waitForSelector('.skizze-tile svg.skizze');
await page.waitForTimeout(300);
await page.click('.tabbar a[data-tab="glasieren"]');
const fehlend = await page.evaluate(() => {
  const b = document.querySelector('.blatt');
  return [...b.querySelectorAll('svg *')].flatMap(n => [...n.attributes].map(a => a.value))
    .flatMap(v => [...v.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]))
    .filter(id => !b.querySelector(`[id="${CSS.escape(id)}"]`));
});
pruefe(fehlend.length === 0, `Tableiste: Skizzen auf dem Blatt behalten ihre Filter/Masken (fehlend: ${fehlend.join(', ') || '–'})`);
await page.waitForTimeout(90); // Blatt hat sich erst wenig gedreht
const imFlug = await page.screenshot({ clip: kachel });
await page.screenshot({ path: join(ausgabe, 'umblaettern-2-skizze.png') });
const dVorher = dunkel(vorher), dFlug = dunkel(imFlug);
console.log(`dunkle Bildpunkte der Skizze: vorher ${(dVorher * 100).toFixed(1)} %, beim Umblättern ${(dFlug * 100).toFixed(1)} %`);
pruefe(dFlug < 0.08 && dFlug < dVorher * 3 + 0.02, 'Skizze bleibt beim Umblättern eine Bleistiftzeichnung (nicht schwarz gefüllt)');
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });

// ---------- zu kurz gewischt: Blatt fällt zurück ----------
await page.goto(`http://localhost:${port}/#/glasuren`);
await page.waitForSelector('#page-title:text("Glasuren")');
await wischen(385, 340, { schritte: 6, pause: 40 });
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });
await page.waitForTimeout(200);
pruefe((await titel()) === 'Glasuren', 'zu kurz gewischt: bleibt bei Glasuren');

// ---------- vom linken Rand nach rechts: zurückblättern ----------
let zurueck = null;
await wischen(5, 330, { halt: { bei: 4, tun: async () => { zurueck = await page.evaluate(() => document.querySelector('.blatt')?.className); } } });
pruefe(/zurueck/.test(zurueck || ''), `vom linken Rand: zurückblättern (${zurueck})`);
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });
pruefe((await titel()) === 'Glasieren', 'Glasuren → Glasieren');

// ---------- nicht am Rand: kein Umblättern; am Ende der Folge auch nicht ----------
await wischen(200, 20);
await page.waitForTimeout(300);
pruefe((await titel()) === 'Glasieren' && !(await page.$('.blatt')), 'Wischen in der Mitte blättert nicht um');
await page.goto(`http://localhost:${port}/#/werkstuecke`);
await page.waitForSelector('#piece-grid');
let blattDa = null;
await wischen(5, 330, { halt: { bei: 6, tun: async () => { blattDa = !!(await page.$('.blatt')); } } });
pruefe(blattDa === false, 'vor „Töpfern“ gibt es nichts zum Zurückblättern');
await page.waitForTimeout(300);

// ---------- „Bewegung reduzieren“: ohne Blatt, erst beim Loslassen umblättern ----------
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(`http://localhost:${port}/#/glasuren`);
await page.waitForSelector('#page-title:text("Glasuren")');
let ruhig = null;
await wischen(385, 120, { halt: { bei: 6, tun: async () => { ruhig = { blatt: !!(await page.$('.blatt')), titel: await titel() }; } } });
await page.waitForTimeout(300);
pruefe(ruhig && !ruhig.blatt && ruhig.titel === 'Glasuren' && (await titel()) === 'Mehr', 'Bewegung reduzieren: ohne Animation, nach dem Loslassen „Mehr“');
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ---------- Unterseiten: kein Umblättern per Wischen ----------
await page.goto(`http://localhost:${port}/#/glasuren/neu`);
await page.waitForSelector('#back-btn:not([hidden])');
await wischen(385, 60);
await page.waitForTimeout(300);
pruefe((await page.evaluate(() => location.hash)) === '#/glasuren/neu', 'auf Unterseiten wird nicht umgeblättert');

console.log(fehler.length ? `\nFEHLER:\n${fehler.join('\n')}` : '\nAlles in Ordnung.');
await browser.close();
server.close();
process.exitCode = fehler.length ? 1 : 0;
