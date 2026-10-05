// Test im Browser: Nach dem Hinzufügen eines Fotos fragt die App die vier Grundmaße ab
// (Zettel + Maßband). Prüft Startwert 5 cm, langsames Wischen auf 1 mm genau, schnelles
// Wischen mit großen Sprüngen, Übernahme ins Formular; Maße in der Blaupause der Werkstückseite
// ebenfalls mit dem Maßband; Übersicht als Fotos oder Skizzenbuch. Screenshots in tools/test/ausgabe/.
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

const wert = k => page.textContent(`[data-f="${k}"] .masse-wert`);
pruefe(!(await page.$('[data-ende="spaeter"]')), 'kein „Überspringen“');
await page.click('[data-f="dOben"]');
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
await page.click('[data-f="hoehe"]');
pruefe((await wert('hoehe')) === '5,0 cm', 'Höhe startet bei 5 cm');
for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('ArrowRight');
pruefe((await wert('hoehe')) === '10,1 cm', `Pfeiltasten → 10,1 cm (${await wert('hoehe')})`);

// eigene Stellen: + → Taille, Schulter oder Bauch; je Stelle Ø und Höhe mit dem Maßband
const stelleWert = (i, f) => page.textContent(`.stelle:nth-child(${i}) [data-f$=":${f}"] .masse-wert`);
const namen = () => page.$$eval('.stelle .masse-name', l => l.map(e => e.textContent));
await page.click('.plus-knopf');
pruefe(await page.isVisible('.plus-wahl [data-art="schulter"]'), '+ zeigt Taille, Schulter, Bauch');
await page.click('.plus-wahl [data-art="taille"]');
pruefe((await stelleWert(1, 'd')) === '5,0 cm' && await page.isVisible('.massband.offen'), 'neue Taille: Ø startet bei 5 cm, Maßband offen');
await wisch(300, -8, 10, 60);
pruefe((await stelleWert(1, 'd')) === '6,0 cm', `Taille Ø gewischt → 6,0 cm (${await stelleWert(1, 'd')})`);
await page.click('.stelle:nth-child(1) [data-f$=":h"]');
for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
pruefe((await stelleWert(1, 'h')) === '7,0 cm', `Taille Höhe → 7,0 cm (${await stelleWert(1, 'h')})`);
await page.click('.plus-knopf');
await page.click('.plus-wahl [data-art="taille"]');
pruefe(JSON.stringify(await namen()) === '["Taille 1","Taille 2"]', `zwei Taillen einzeln (${await namen()})`);
await page.click('.plus-knopf');
await page.click('.plus-wahl [data-art="bauch"]');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
await page.click('.stelle:nth-child(3) [data-f$=":h"]');
for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft');
await page.screenshot({ path: join(ausgabe, 'massband-4-stellen.png') });
await page.click('.stelle:nth-child(2) .muell');
pruefe(JSON.stringify(await namen()) === '["Taille","Bauch"]', `Mülleimer löscht Taille 2 (${await namen()})`);
pruefe((await stelleWert(2, 'd')) === '8,0 cm' && (await stelleWert(2, 'h')) === '3,0 cm', 'Bauch: Ø 8,0 cm auf 3,0 cm');

await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
const formular = await page.evaluate(() => Object.fromEntries(['hoehe', 'dOben', 'dMax', 'dBoden'].map(k => [k, document.querySelector(`input[name="nass.${k}"]`).value])));
console.log('Formular:', JSON.stringify(formular));
pruefe(formular.hoehe === '10.1' && Number(formular.dOben) === schnell && formular.dMax === '' && formular.dBoden === '', 'nur angetippte Maße ins Formular übernommen');
const liste = await page.textContent('#stellen');
pruefe(liste.includes('Ø Taille') && liste.includes('Ø Bauch'), `Stellen im Formular (${liste.trim().replace(/\s+/g, ' ')})`);

// zweites Foto: Zettel zeigt die eingetragenen Werte und Stellen
await page.setInputFiles('.pp-lib', { name: 'becher2.png', mimeType: 'image/png', buffer: foto });
await page.waitForSelector('dialog.masse[open]', { timeout: 10000 });
pruefe((await wert('hoehe')) === '10,1 cm' && (await namen()).length === 2, 'zweites Foto: Zettel zeigt Höhe und Stellen');
await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
pruefe((await page.inputValue('input[name="nass.hoehe"]')) === '10.1', 'unverändert übernommen');

// speichern → Blaupause mit den eigenen Stellen
await page.fill('input[name="name"]', 'Zickzack-Becher');
await page.click('button[type="submit"]');
await page.waitForSelector('.bp-card svg', { timeout: 20000 });
const bpText = await page.textContent('.bp-card svg');
pruefe(bpText.includes('Ø Taille') && bpText.includes('Ø Bauch') && bpText.includes('6 cm') && bpText.includes('auf 7 cm Höhe'), 'Blaupause zeigt Taille (6 cm auf 7 cm Höhe) und Bauch');
await page.screenshot({ path: join(ausgabe, 'massband-5-werkstueck.png'), fullPage: true });

// in der Werkstückansicht: Zettel öffnen, Schulter hinzufügen
await page.click('#zettel');
await page.waitForSelector('dialog.masse[open]');
await page.click('.plus-knopf');
await page.click('.plus-wahl [data-art="schulter"]');
await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
await page.waitForSelector('.bp-card svg');
const gespeichert = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => { const q = r.result.transaction('pieces').objectStore('pieces').getAll(); q.onsuccess = () => res(q.result[0].stellen); };
}));
console.log('Stellen gespeichert:', JSON.stringify(gespeichert));
pruefe(gespeichert.length === 3 && gespeichert[2].art === 'schulter' && (await page.textContent('.bp-card svg')).includes('Ø Schulter'), 'Werkstückansicht: Schulter hinzugefügt und gespeichert');

// Blaupause antippen: auch hier das Maßband statt Zahlenfeldern
const stueck = () => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => { const q = r.result.transaction('pieces').objectStore('pieces').getAll(); q.onsuccess = () => res(q.result[0]); };
}));
const einzeln = f => page.textContent(`[data-f="${f}"] .masse-wert`);
await page.click('[data-bp-key="rand"]');
await page.waitForSelector('dialog.masse[open]');
pruefe(!(await page.$('dialog.masse input[type="number"]')), 'Blaupause: keine Zahlenfelder mehr');
pruefe(await page.isVisible('dialog.masse [name="bezeichnung"]'), 'Blaupause: Bezeichnung lässt sich ändern');
pruefe(!(await page.isVisible('.massband.offen')), 'Blaupause: Maßband erst nach dem Antippen');
await page.click('[data-f="wert"]');
pruefe(await page.isVisible('.massband.offen'), 'Blaupause: Maßband offen');
for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
const oeffnung = Math.round((schnell + 2) * 10) / 10;
pruefe((await einzeln('wert')) === `${oeffnung.toLocaleString('de-DE', { minimumFractionDigits: 1 })} cm`, `Ø Öffnung mit dem Maßband → ${await einzeln('wert')}`);
await page.screenshot({ path: join(ausgabe, 'massband-6-blaupause.png') });
await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
await page.waitForTimeout(300);
pruefe((await stueck()).nass.dOben === oeffnung, `Ø Öffnung gespeichert (${(await stueck()).nass.dOben})`);

// eigene Stelle aus der Blaupause: Ø und Höhe vom Boden mit dem Maßband
const taille = (await stueck()).stellen.find(x => x.art === 'taille');
await page.click(`[data-bp-key="stelle-${taille.id}"]`);
await page.waitForSelector('dialog.masse[open]');
pruefe((await einzeln('wert')) === '6,0 cm' && (await einzeln('pos')) === '7,0 cm', 'Taille: Ø 6,0 cm auf 7,0 cm Höhe');
await page.click('[data-f="pos"]');
await page.keyboard.press('Shift+ArrowLeft');
await page.keyboard.press('ArrowRight');
await page.click('[data-ende="ok"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
await page.waitForTimeout(300);
const taille2 = (await stueck()).stellen.find(x => x.id === taille.id);
pruefe(taille2.h === 6.1 && taille2.d === 6, `Taille auf 6,1 cm Höhe (${taille2.d} / ${taille2.h})`);

// ohne Eintrag: Schätzung (≈) als Startwert, Radiergummi löscht wieder
await page.click('[data-bp-key="fuss"]');
await page.waitForSelector('dialog.masse[open]');
const geschaetzt = await einzeln('wert');
pruefe(geschaetzt.startsWith('≈'), `Ø Fuß zeigt die Schätzung (${geschaetzt})`);
await page.click('[data-f="wert"]');
pruefe((await einzeln('wert')) === geschaetzt.slice(2) && await page.isVisible('[data-leeren="wert"]'), `Startwert = Schätzung (${await einzeln('wert')})`);
await page.click('[data-leeren="wert"]');
pruefe((await einzeln('wert')) === geschaetzt && !(await page.isVisible('.massband.offen')), 'Radiergummi: wieder geschätzt');
await page.click('[data-ende="abbrechen"]');
await page.waitForSelector('dialog.masse', { state: 'detached' });
pruefe((await stueck()).nass.dBoden == null, 'Abbrechen ändert nichts');

// Übersicht: oben rechts zwischen Fotos und Skizzen wechseln
await page.goto(`http://localhost:${port}/#/werkstuecke`);
await page.waitForSelector('#ansicht');
pruefe((await page.getAttribute('#ansicht', 'aria-label')) === 'Skizzen zeigen' && await page.isVisible('.tile .thumb'), 'Übersicht: Fotos, Knopf „Skizzen zeigen“');
await page.screenshot({ path: join(ausgabe, 'massband-7-fotos.png') });
await page.click('#ansicht');
await page.waitForSelector('.skizze-tile svg.skizze');
const skizzeText = await page.$eval('.skizze-tile', el => [...el.querySelectorAll('svg text, .skizze-name')].map(t => t.textContent).join(' '));
pruefe(skizzeText.includes('Zickzack-Becher') && !/\d\s*cm|Ø/.test(skizzeText), `Skizze mit Namen, ohne Maße („${skizzeText.trim().replace(/\s+/g, ' ')}“)`);
pruefe((await page.getAttribute('#ansicht', 'aria-label')) === 'Fotos zeigen' && !(await page.$('.tile .thumb')), 'Skizzenbuch: keine Fotos, Knopf „Fotos zeigen“');
await page.screenshot({ path: join(ausgabe, 'massband-8-skizzen.png') });
await page.reload();
await page.waitForSelector('#ansicht');
pruefe(!!(await page.$('.skizze-tile')), 'Ansicht bleibt nach dem Neuladen');
await page.click('#ansicht');
pruefe(!!(await page.$('.tile .thumb')) && !(await page.$('.skizze-tile')), 'zurück zu den Fotos');

console.log(fehler.length ? `\nFEHLER:\n${fehler.join('\n')}` : '\nAlles in Ordnung.');
await browser.close();
server.close();
process.exitCode = fehler.length ? 1 : 0;
