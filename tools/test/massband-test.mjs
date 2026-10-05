// Test im Browser: Nach dem Hinzufügen eines Fotos fragt die App die vier Grundmaße ab
// (Zettel + Maßband). Prüft Startwert 5 cm, langsames Wischen auf 1 mm genau, schnelles
// Wischen mit großen Sprüngen, Übernahme ins Formular. Screenshots in tools/test/ausgabe/.
//
//   node tools/test/massband-test.mjs

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

await page.goto(`http://localhost:${port}/#/werkstueck/neu`);
await page.waitForSelector('.pp-lib', { state: 'attached' });
await page.setInputFiles('.pp-lib', { name: 'becher.png', mimeType: 'image/png', buffer: foto });
await page.waitForSelector('dialog.masse[open]', { timeout: 10000 });
await page.waitForTimeout(400);
pruefe(!(await page.isVisible('.massband.offen')), 'Maßband erst nach dem Antippen eines Maßes');
await page.screenshot({ path: join(ausgabe, 'massband-1-zettel.png') });

const wert = k => page.textContent(`.masse-zeile[data-k="${k}"] .masse-wert`);
await page.click('.masse-zeile[data-k="dOben"]');
await page.waitForTimeout(400);
const band = await page.locator('.massband canvas').boundingBox();
pruefe(Math.abs(band.height - 844 * 0.15) < 2, `Maßband 15 % der Bildschirmhöhe (${band.height.toFixed(1)} px)`);
pruefe(band.y + band.height > 843, 'Maßband am unteren Rand');
pruefe((await wert('dOben')) === '5,0 cm', `Startwert 5 cm (${await wert('dOben')})`);
await page.screenshot({ path: join(ausgabe, 'massband-2-offen.png') });

const cdp = await ctx.newCDPSession(page);
const y = band.y + band.height / 2;
const wisch = async (x0, schritt, n, pause) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 1 }] });
  for (let i = 1; i <= n; i++) {
    await page.waitForTimeout(pause);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + schritt * i, y, id: 1 }] });
  }
  await page.waitForTimeout(pause);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700); // Nachlauf und Einrasten
};

// langsam von rechts nach links: 10 Teilstriche (je 8 px) → +1 cm
await wisch(300, -8, 10, 60);
pruefe((await wert('dOben')) === '6,0 cm', `langsam 80 px nach links → 6,0 cm (${await wert('dOben')})`);
// ein einzelner Teilstrich → +1 mm
await wisch(250, -8, 1, 80);
pruefe((await wert('dOben')) === '6,1 cm', `langsam 8 px nach links → 6,1 cm (${await wert('dOben')})`);
// langsam zurück (links nach rechts) → −3 mm
await wisch(150, 8, 3, 80);
pruefe((await wert('dOben')) === '5,8 cm', `langsam 24 px nach rechts → 5,8 cm (${await wert('dOben')})`);
// schnell von rechts nach links: großer Sprung
await wisch(330, -50, 5, 12);
const schnell = parseFloat((await wert('dOben')).replace(',', '.'));
pruefe(schnell > 10, `schnell 250 px nach links → großer Sprung (${await wert('dOben')})`);
await page.screenshot({ path: join(ausgabe, 'massband-3-gewischt.png') });

// zweites Maß: Höhe mit den Pfeiltasten
await page.click('.masse-zeile[data-k="hoehe"]');
pruefe((await wert('hoehe')) === '5,0 cm', 'Höhe startet bei 5 cm');
for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('ArrowRight');
pruefe((await wert('hoehe')) === '10,1 cm', `Pfeiltasten → 10,1 cm (${await wert('hoehe')})`);

await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
const formular = await page.evaluate(() => Object.fromEntries(['hoehe', 'dOben', 'dMax', 'dBoden'].map(k => [k, document.querySelector(`input[name="nass.${k}"]`).value])));
console.log('Formular:', JSON.stringify(formular));
pruefe(formular.hoehe === '10.1' && Number(formular.dOben) === schnell && formular.dMax === '' && formular.dBoden === '', 'nur angetippte Maße ins Formular übernommen');

// zweites Foto: Zettel zeigt die eingetragenen Werte, Überspringen ändert nichts
await page.setInputFiles('.pp-lib', { name: 'becher2.png', mimeType: 'image/png', buffer: foto });
await page.waitForSelector('dialog.masse[open]', { timeout: 10000 });
pruefe((await wert('hoehe')) === '10,1 cm', 'zweites Foto: Zettel zeigt die eingetragene Höhe');
await page.click('[data-ende="spaeter"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
pruefe((await page.inputValue('input[name="nass.hoehe"]')) === '10.1', 'Überspringen lässt die Maße unverändert');

console.log(fehler.length ? `\nFEHLER:\n${fehler.join('\n')}` : '\nAlles in Ordnung.');
await browser.close();
server.close();
process.exitCode = fehler.length ? 1 : 0;
