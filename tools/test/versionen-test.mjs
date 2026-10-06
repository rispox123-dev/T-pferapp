// Ende-zu-Ende-Test: Versionen einer Glasur. Original mit Testkachel → „Neue Version davon“
// (Rezept vorausgefüllt, Anteil ändern, Foto, Bewertung) → Änderungen und Vergleich →
// Version der Version über den Versions-Zettel → wechseln → mit einer Version glasieren →
// löschen. Screenshots: tools/test/ausgabe/versionen-*.png
//
//   node tools/test/versionen-test.mjs

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
    const inhalt = await readFile(datei);
    res.writeHead(200, { 'content-type': typen[extname(datei)] || 'application/octet-stream' });
    res.end(inhalt);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const url = h => `http://localhost:${port}/${h}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const fehler = [];
page.on('pageerror', e => fehler.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) fehler.push(m.text()); });
page.on('dialog', d => d.accept());

let ok = 0, falsch = 0;
function pruefe(bed, text) {
  if (bed) { ok++; console.log(`  ✓ ${text}`); } else { falsch++; console.log(`  ✗ ${text}`); }
}
const text = sel => page.locator(sel).first().textContent().then(t => t.replace(/\s+/g, ' ').trim());
const kachel = farbe => page.evaluate(async f => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 500;
  const x = c.getContext('2d'); x.fillStyle = f; x.fillRect(0, 0, 400, 500);
  return (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)).then(b => b.arrayBuffer()).then(a => [...new Uint8Array(a)]));
}, farbe).then(a => Buffer.from(a));

try {
  // ---------- Glasur mit Testkachel anlegen ----------
  await page.goto(url('#/glasuren'));
  await page.waitForSelector('#page-title:text("Glasuren")');
  const id = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const c = document.createElement('canvas'); c.width = 400; c.height = 500;
    const x = c.getContext('2d'); x.fillStyle = '#7fa38a'; x.fillRect(0, 0, 400, 500);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    await db.put('photos', { id: 'foto-original', blob, thumb: blob, createdAt: new Date().toISOString() });
    const g = {
      id: 'seladon', name: 'Seladon hell', photo: 'foto-original', wasser: 80, litergewicht: 1450, brennbereich: '1240 °C',
      rezept: [{ rohstoff: 'Kalifeldspat', anteil: 25 }, { rohstoff: 'Quarz', anteil: 30 }, { rohstoff: 'Kreide', anteil: 20 }, { rohstoff: 'Kaolin', anteil: 25 }, { rohstoff: '+ Eisenoxid rot', anteil: 1.5 }],
      createdAt: new Date().toISOString(),
    };
    await db.put('glazes', g);
    return g.id;
  });

  console.log('1. Original');
  await page.goto(url(`#/glasuren/${id}`));
  await page.waitForSelector('.versions-knopf');
  pruefe((await text('.versions-knopf')) === 'Original', 'Versions-Knopf neben dem Namen zeigt „Original“');
  await page.screenshot({ path: join(ausgabe, 'versionen-1-original.png') });

  // ---------- Neue Version davon ----------
  console.log('2. Rev. 1 anlegen');
  await page.click('a.btn:text("Neue Version davon")');
  await page.waitForSelector('#page-title:text("Neue Version: Rev. 1")');
  const zeilen = await page.$$eval('#rezept .repeat-row', rs => rs.map(r => `${r.querySelector('input').value}=${r.querySelector('.repeat-wert').textContent.trim()}`));
  pruefe(zeilen.length === 5 && zeilen[1] === 'Quarz=30', 'Rezept des Originals vorausgefüllt');
  pruefe(await page.inputValue('[name="wasser"]') === '80', 'Wassermenge übernommen');
  await page.fill('[name="aenderung"]', '5 mehr Quarz, 5 weniger Kaolin');
  // Quarz 30 → 35, Kaolin 25 → 20 mit dem Maßband (Pfeiltasten: ein Teilstrich = 0,1)
  for (const [i, taste] of [[1, 'ArrowRight'], [3, 'ArrowLeft']]) {
    await page.locator('#rezept .repeat-wert').nth(i).click();
    await page.waitForSelector('dialog.masse[open] .massband.offen');
    for (let k = 0; k < 5; k++) await page.keyboard.press(`Shift+${taste}`);
    await page.click('dialog.masse [data-ende="ok"]');
    await page.waitForSelector('dialog.masse', { state: 'detached' });
  }
  const neu = await page.$$eval('#rezept .repeat-row', rs => rs.map(r => `${r.querySelector('input').value}=${r.querySelector('.repeat-wert').textContent.trim()}`));
  console.log('  ', JSON.stringify(neu));
  await page.setInputFiles('#fotos .pp-lib', { name: 'kachel.jpg', mimeType: 'image/jpeg', buffer: await kachel('#5d8a9e') });
  await page.waitForSelector('#fotos .pp-item img[src]');
  await page.check('[name="bewertung"][value="gut"]', { force: true });
  await page.fill('[name="notizen"]', 'Glatter, weniger Krakelee.');
  await page.screenshot({ path: join(ausgabe, 'versionen-2-formular.png'), fullPage: true });
  await page.click('button[type="submit"]');
  await page.waitForSelector('.version-kopf');
  pruefe((await text('.versions-knopf')).startsWith('Rev. 1'), 'nach dem Speichern: Rev. 1 gewählt');
  pruefe(/aus Original/.test(await text('.version-kopf')), 'Kopf: Rev. 1 – aus Original');
  const geaendert = await page.$$eval('.recipe-table tr.geaendert', rs => rs.map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' ')));
  console.log('  geändert:', JSON.stringify(geaendert));
  pruefe(geaendert.length === 2 && geaendert.some(t => /Quarz 30 → 35/.test(t)), 'Änderungen am Rezept markiert (Quarz 30 → 35)');
  pruefe(await page.locator('#vergleich .compare-stack, #vergleich .compare-side').count() === 1, 'Vergleich mit dem Original');
  pruefe(/Original/.test(await text('#vergleich .lbl.l')) && /Rev\. 1/.test(await text('#vergleich .lbl.r')), 'Vergleich beschriftet: Original | Rev. 1');
  await page.screenshot({ path: join(ausgabe, 'versionen-3-rev1.png'), fullPage: true });

  // ---------- Version der Version über den Zettel ----------
  console.log('3. Rev. 1.1 über den Versions-Zettel');
  await page.click('.versions-knopf');
  await page.waitForSelector('dialog.versionen-zettel[open]');
  await page.click('dialog.versionen-zettel [data-neu]');
  await page.waitForSelector('#page-title:text("Neue Version: Rev. 1.1")');
  pruefe(true, 'Neue Version von Rev. 1 heißt Rev. 1.1');
  const quarz = await page.$$eval('#rezept .repeat-row', rs => rs.map(r => r.querySelector('.repeat-wert').textContent.trim())[1]);
  pruefe(quarz.replace(/,0$/, '') === '35', 'Rev. 1.1 übernimmt das Rezept von Rev. 1');
  await page.fill('[name="aenderung"]', 'Brand 20 °C höher');
  await page.fill('[name="brennbereich"]', '1260 °C');
  await page.setInputFiles('#fotos .pp-lib', { name: 'kachel2.jpg', mimeType: 'image/jpeg', buffer: await kachel('#3b6f86') });
  await page.waitForSelector('#fotos .pp-item img[src]');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.version-kopf');
  pruefe((await text('.versions-knopf')).startsWith('Rev. 1.1'), 'Rev. 1.1 gewählt');
  pruefe(/vorher 1240 °C/.test(await text('dl.facts')), 'Brennbereich: vorher 1240 °C');
  pruefe(await page.locator('#vergleich .vergleich-wahl input').count() === 2, 'Vergleich: Original oder Rev. 1 wählbar');

  await page.click('.versions-knopf');
  await page.waitForSelector('dialog.versionen-zettel[open]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ausgabe, 'versionen-4-zettel.png') });
  const liste = await page.$$eval('.versionen-liste .version-name', n => n.map(x => x.textContent.trim()));
  console.log('   Zettel:', JSON.stringify(liste));
  pruefe(liste.length === 3 && liste[0] === 'Original' && liste[1].startsWith('Rev. 1') && liste[2].startsWith('Rev. 1.1'), 'Zettel zeigt den Baum Original → Rev. 1 → Rev. 1.1');
  await page.click('dialog.versionen-zettel [data-v="original"]');
  await page.waitForSelector('dialog.versionen-zettel', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.versions-knopf span')?.textContent === 'Original');
  pruefe(!(await page.locator('.version-kopf').count()), 'gewechselt zum Original');
  pruefe((await text('.versions-knopf')) === 'Original3', 'Knopf zeigt die Anzahl der Versionen (3)');

  // ---------- Glasieren mit einer Version ----------
  console.log('4. Mit Rev. 1 glasieren');
  const rev1 = await page.evaluate(async () => (await (await import('/js/db.js')).get('glazes', 'seladon')).versionen.find(v => v.nr.join('.') === '1').id);
  await page.goto(url(`#/glasuren/${id}?v=${rev1}`));
  await page.waitForSelector('.version-kopf');
  await page.click('a.btn:text("Mit dieser Version glasieren")');
  await page.waitForSelector('[name="glazeId"]');
  pruefe(await page.inputValue('[name="glazeId"]') === `${id}|${rev1}`, 'Glasurschicht: Seladon hell – Rev. 1 gewählt');
  pruefe(await page.inputValue('[name="litergewicht"]') === '1450', 'Litergewicht der Version übernommen');
  await page.click('button[type="submit"]');
  await page.waitForSelector('dl.facts');
  pruefe(/Seladon hell · Rev\. 1/.test(await text('.card dl.facts')), 'Protokoll zeigt „Seladon hell · Rev. 1“');
  await page.goto(url(`#/glasuren/${id}?v=${rev1}`));
  await page.waitForSelector('.version-kopf');
  pruefe(await page.locator('.eval-row').count() === 1, 'Protokoll erscheint bei Rev. 1');
  await page.goto(url(`#/glasuren/${id}?v=original`));
  await page.waitForSelector('.versions-knopf');
  pruefe(await page.locator('.eval-row').count() === 0, '… und nicht beim Original');

  // ---------- Löschen ----------
  console.log('5. Löschen');
  await page.goto(url(`#/glasuren/${id}?v=${rev1}`));
  await page.waitForSelector('#del-version');
  await page.click('#del-version');
  await page.waitForTimeout(300);
  pruefe((await page.evaluate(async () => (await (await import('/js/db.js')).get('glazes', 'seladon')).versionen.length)) === 2, 'Rev. 1 hat eine Version darunter: wird nicht gelöscht');
  await page.click('.versions-knopf');
  await page.click('dialog.versionen-zettel .version-zeile >> nth=2');
  await page.waitForFunction(() => document.querySelector('.versions-knopf span')?.textContent === 'Rev. 1.1');
  await page.click('#del-version');
  await page.waitForFunction(() => document.querySelector('.versions-knopf span')?.textContent === 'Rev. 1');
  pruefe((await page.evaluate(async () => (await (await import('/js/db.js')).get('glazes', 'seladon')).versionen.length)) === 1, 'Rev. 1.1 gelöscht, zurück bei Rev. 1');
  await page.goto(url('#/glasuren'));
  await page.waitForSelector('.row-card');
  pruefe(/2 Versionen/.test(await text('.row-card')), 'Übersicht: „2 Versionen“');
} catch (err) {
  falsch++;
  console.log('Fehler:', err.message);
  await page.screenshot({ path: join(ausgabe, 'versionen-fehler.png') });
}

pruefe(!fehler.length, `keine Fehler im Browser${fehler.length ? `: ${fehler.join(' | ')}` : ''}`);
console.log(`\n${ok} bestanden, ${falsch} fehlgeschlagen`);
await browser.close();
server.close();
process.exit(falsch ? 1 : 0);
