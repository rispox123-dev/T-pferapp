// Test im Browser: Alle Zahlen der App werden mit dem Maßband eingestellt – im Werkstück-
// Formular (Tonmenge, Maße nass und nach dem Brand, Wand/Boden, Gewicht), im Glasurprotokoll
// (Glasurschicht, Brand) und bei den Glasuren (Litergewicht, Anteile im Rezept). Keine
// Zahlenfelder mehr; Werte landen richtig gespeichert in der Datenbank. Dazu das Umblättern
// beim Wechsel in der Tableiste.
// Screenshots in tools/test/ausgabe/werte-*.png.
//
//   node tools/test/werte-test.mjs

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const wurzel = new URL('../../', import.meta.url).pathname;
const ausgabe = new URL('./ausgabe/', import.meta.url).pathname;
await mkdir(ausgabe, { recursive: true });

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
const alle = store => page.evaluate(s => new Promise(res => {
  const r = indexedDB.open('toepferbuch');
  r.onsuccess = () => { const q = r.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); };
}), store);
const zeile = f => page.textContent(`dialog.masse [data-f="${f}"] .masse-wert`);
const tasten = async (taste, n) => { for (let i = 0; i < n; i++) await page.keyboard.press(taste); };
const uebernehmen = async () => {
  await page.click('dialog.masse [data-ende="ok"]');
  await page.waitForSelector('dialog.masse', { state: 'detached' });
};
const keineZahlenfelder = async wo => pruefe(!(await page.$('input[type="number"]')), `${wo}: keine Zahlenfelder`);

// ---------- Werkstück ----------
await page.goto(`http://localhost:${port}/#/werkstueck/neu`);
await page.waitForSelector('#f');
await keineZahlenfelder('Werkstück');
await page.fill('input[name="name"]', 'Maßband-Becher');

await page.click('[data-wert="tonmenge"]');
await page.waitForSelector('dialog.masse[open] .massband.offen');
pruefe((await zeile('tonmenge')) === '500 g', `Tonmenge startet bei 500 g (${await zeile('tonmenge')})`);
pruefe(!(await page.$('dialog.masse .masse-skizze')), 'Tonmenge: keine Topfskizze');
await tasten('Shift+ArrowRight', 3);
await tasten('ArrowLeft', 2);
pruefe((await zeile('tonmenge')) === '528 g', `Tonmenge 528 g (${await zeile('tonmenge')})`);
await page.screenshot({ path: join(ausgabe, 'werte-1-tonmenge.png') });
await uebernehmen();
pruefe((await page.textContent('[data-wert="tonmenge"]')).trim() === '528 g', 'Tonmenge im Formular angezeigt');

// Grundmaße nass: Zettel mit Stellen, das angetippte Maß gleich gewählt
await page.click('[data-wert="nass.dMax"]');
await page.waitForSelector('dialog.masse[open] .plus-knopf');
pruefe((await page.getAttribute('[data-f="dMax"]', 'aria-pressed')) === 'true' && await page.isVisible('.massband.offen'), 'Ø breiteste Stelle angetippt: Zettel mit Stellen, Maß gewählt');
await tasten('Shift+ArrowRight', 3);
await uebernehmen();
pruefe((await page.textContent('[data-wert="nass.dMax"]')).trim() === '8,0 cm', `Ø breiteste Stelle 8,0 cm (${(await page.textContent('[data-wert="nass.dMax"]')).trim()})`);

// Wand- und Bodenstärke in mm, zusammen auf einem Zettel
await page.click('[data-wert="nass.boden"]');
await page.waitForSelector('dialog.masse[open] .massband.offen');
pruefe((await page.$$('dialog.masse .masse-zeile')).length === 2 && (await zeile('nass.boden')) === '5,0 mm', 'Wand und Boden auf einem Zettel, Boden startet bei 5,0 mm');
await tasten('ArrowRight', 3);
await page.click('[data-f="nass.wand"]');
await tasten('ArrowLeft', 10);
await uebernehmen();

// Maße nach dem Brand mit Topfskizze, Radiergummi
await page.click('[data-wert="fertig.hoehe"]');
await page.waitForSelector('dialog.masse[open] .massband.offen');
pruefe((await page.$$('dialog.masse .masse-zeile')).length === 4 && await page.isVisible('dialog.masse .masse-skizze .mass.an[data-mass="hoehe"]'), 'Maße nach dem Brand: vier Maße, Skizze zeigt die Höhe');
await tasten('Shift+ArrowRight', 4);
await page.click('[data-f="fertig.dOben"]');
await page.click('[data-leeren="fertig.dOben"]');
pruefe((await zeile('fertig.dOben')) === '–', 'Radiergummi leert Ø Öffnung');
await page.screenshot({ path: join(ausgabe, 'werte-2-brand.png') });
await uebernehmen();

await page.click('button[type="submit"]');
await page.waitForSelector('.card h2');
await page.waitForTimeout(300);
const stueck = (await alle('pieces'))[0];
console.log('Werkstück:', JSON.stringify({ ton: stueck.tonmenge, nass: stueck.nass, fertig: stueck.fertig }));
pruefe(stueck.tonmenge === 528 && stueck.nass.dMax === 8 && stueck.nass.boden === 5.3 && stueck.nass.wand === 4
  && stueck.fertig.hoehe === 9 && stueck.fertig.dOben == null, 'Werkstück richtig gespeichert');

// ---------- Glasurprotokoll ----------
await page.goto(`http://localhost:${port}/#/glasieren/neu`);
await page.waitForSelector('#layers [data-wert="dauer"]');
await keineZahlenfelder('Glasurprotokoll');
pruefe((await page.textContent('[data-wert="wdh"]')).trim() === '1 ×', 'Wiederholungen: 1 ×');
await page.click('[data-wert="dauer"]');
await page.waitForSelector('dialog.masse[open] .massband.offen');
pruefe((await page.$$('dialog.masse .masse-zeile')).length === 4 && (await page.textContent('dialog.masse h2')) === '1. Glasurschicht', 'Glasurschicht: alle vier Werte auf einem Zettel');
pruefe((await zeile('dauer')) === '3 Sek.', `Tauchdauer startet bei 3 Sek. (${await zeile('dauer')})`);
await tasten('ArrowRight', 3);
pruefe((await zeile('dauer')) === '4,5 Sek.', `Tauchdauer in halben Sekunden (${await zeile('dauer')})`);
await page.click('[data-f="wdh"]');
await page.keyboard.press('ArrowRight');
await page.click('[data-f="litergewicht"]');
await tasten('Shift+ArrowRight', 2);
await page.screenshot({ path: join(ausgabe, 'werte-3-glasurschicht.png') });
await uebernehmen();
await page.fill('input[name="titel"]', 'Probe');
await page.click('[data-wert="brand.temperatur"]');
await page.waitForSelector('dialog.masse[open] .massband.offen');
pruefe((await zeile('brand.temperatur')) === '1240 °C', `Temperatur startet bei 1240 °C (${await zeile('brand.temperatur')})`);
await tasten('Shift+ArrowLeft', 1);
await page.click('[data-f="brand.haltezeit"]');
await tasten('ArrowRight', 5);
await uebernehmen();
await page.fill('#layers input[name="glazeName"]', 'Seladon');
await page.click('button[type="submit"]');
await page.waitForTimeout(500);
const brand = (await alle('firings'))[0];
console.log('Glasurprotokoll:', JSON.stringify({ lagen: brand.lagen, brand: brand.brand }));
const l0 = brand.lagen[0];
pruefe(l0.dauer === 4.5 && l0.wdh === 2 && l0.litergewicht === 1470 && l0.pause == null
  && brand.brand.temperatur === 1230 && brand.brand.haltezeit === 15, 'Glasurprotokoll richtig gespeichert');

// ---------- Glasur ----------
await page.goto(`http://localhost:${port}/#/glasuren/neu`);
await page.waitForSelector('[data-wert="litergewicht"]');
await keineZahlenfelder('Glasur');
await page.fill('input[name="name"]', 'Seladon hell');
await page.fill('.repeat-row input[data-k="a"]', 'Kalifeldspat');
await page.click('.repeat-wert');
await page.waitForSelector('dialog.masse[open] .massband.offen');
pruefe((await page.textContent('dialog.masse h2')) === 'Kalifeldspat', 'Anteil: Zettel trägt den Rohstoff als Überschrift');
await tasten('Shift+ArrowRight', 2);
await tasten('ArrowRight', 5);
await uebernehmen();
pruefe((await page.textContent('#summe')).includes('12,5'), `Summe aktualisiert (${await page.textContent('#summe')})`);
await page.screenshot({ path: join(ausgabe, 'werte-4-glasur.png'), fullPage: true });
await page.click('button[type="submit"]');
await page.waitForTimeout(500);
const glasur = (await alle('glazes'))[0];
console.log('Glasur:', JSON.stringify({ lg: glasur.litergewicht, rezept: glasur.rezept }));
pruefe(glasur.rezept[0].anteil === 12.5 && glasur.litergewicht == null, 'Glasur richtig gespeichert');

// ---------- Umblättern in der Tableiste ----------
pruefe((await page.textContent('.tabbar a[data-tab="werkstuecke"]')).trim() === 'Töpfern', 'Tableiste: „Töpfern“ statt „Werkstücke“');
await page.click('.tabbar a[data-tab="werkstuecke"]');
await page.waitForSelector('#piece-grid');
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });
pruefe((await page.textContent('#page-title')) === 'Töpfern', 'Überschrift „Töpfern“');
await page.click('.tabbar a[data-tab="glasuren"]');
pruefe(!!(await page.$('.blatt.vor')), 'Töpfern → Glasuren: Blatt wird nach vorn umgeblättert');
await page.waitForTimeout(260);
await page.screenshot({ path: join(ausgabe, 'werte-5-umblaettern.png') });
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });
pruefe((await page.textContent('#page-title')) === 'Glasuren', 'danach: Glasuren');
await page.click('.tabbar a[data-tab="glasieren"]');
pruefe(!!(await page.$('.blatt.zurueck')), 'Glasuren → Glasieren: zurückblättern');
await page.waitForSelector('.blatt', { state: 'detached', timeout: 3000 });

console.log(fehler.length ? `\nFEHLER:\n${fehler.join('\n')}` : '\nAlles in Ordnung.');
await browser.close();
server.close();
process.exitCode = fehler.length ? 1 : 0;
