// Ende-zu-Ende-Test im Browser: Rezeptfotos (im Browser gerendert – gedruckt, schräg, mit
// Schatten, Handschrift, englisch) → „Rezept vom Foto“ im Glasur-Formular → Prüf-Zettel →
// Übernehmen → Speichern. Prüft die gelesenen Werte und dass Unsicheres nachgefragt wird.
// Screenshots landen in tools/test/ausgabe/rezept-*.png.
//
//   node tools/test/rezept-foto-test.mjs

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

// Rezeptbild im Browser zeichnen; zeilen: [{ t, x, y, gr, fett, hand }]
async function rezeptBild(opt) {
  const b64 = await page.evaluate(async o => {
    await document.fonts.load('40px "Bleistift Hand"');
    const c = document.createElement('canvas');
    c.width = o.w || 1200; c.height = o.h || 1600;
    const x = c.getContext('2d');
    x.fillStyle = o.papier || '#f4efe4';
    x.fillRect(0, 0, c.width, c.height);
    if (o.schatten) { // Licht von links oben, Schatten unten rechts
      const g = x.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(60,50,40,.45)');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    }
    x.save();
    x.translate(c.width / 2, c.height / 2); x.rotate((o.drehung || 0) * Math.PI / 180); x.translate(-c.width / 2, -c.height / 2);
    x.fillStyle = o.tinte || '#222';
    for (const z of o.zeilen) {
      x.font = `${z.fett ? 'bold ' : ''}${z.gr || 34}px ${z.hand || o.hand ? '"Bleistift Hand"' : z.serif ? 'serif' : 'sans-serif'}`;
      x.fillText(z.t, z.x ?? 100, z.y);
    }
    x.restore();
    if (o.rauschen) {
      const d = x.getImageData(0, 0, c.width, c.height);
      let s = 7;
      for (let i = 0; i < d.data.length; i += 4) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const n = ((s / 4294967296) - 0.5) * o.rauschen;
        d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
      }
      x.putImageData(d, 0, 0);
    }
    if (o.quer) { // Blatt quer fotografiert
      const q = document.createElement('canvas');
      q.width = c.height; q.height = c.width;
      const y = q.getContext('2d');
      y.translate(q.width / 2, q.height / 2); y.rotate(-Math.PI / 2); y.drawImage(c, -c.width / 2, -c.height / 2);
      return q.toDataURL('image/jpeg', 0.9).split(',')[1];
    }
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, opt);
  return Buffer.from(b64, 'base64');
}

// Formular öffnen, Foto „aus der Galerie“ wählen, auf den Prüf-Zettel warten
async function lesen(name, bild, { neu = true } = {}) {
  if (neu) {
    await page.goto(`http://localhost:${port}/#/glasuren/neu`);
    await page.waitForSelector('#rezept-foto [data-pick="lib"]');
  }
  const t0 = Date.now();
  await page.setInputFiles('#rezept-foto .rf-lib', { name: `${name}.jpg`, mimeType: 'image/jpeg', buffer: bild });
  await page.waitForSelector('dialog.rezept-zettel h2:text-matches("Vom Foto gelesen|Kein Rezept")', { timeout: 120000 });
  const dauer = Date.now() - t0;
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(ausgabe, `rezept-${name}.png`), fullPage: false });
  const zettel = await page.evaluate(() => {
    const d = document.querySelector('dialog.rezept-zettel[open]');
    const wert = k => d.querySelector(`[data-feld="${k}"]`)?.value ?? null;
    return {
      titel: d.querySelector('h2').textContent,
      name: wert('name'), beschreibung: wert('beschreibung'), brennbereich: wert('brennbereich'),
      liter: d.querySelector('[data-liter]')?.textContent.trim() ?? null,
      rezept: [...d.querySelectorAll('.rf-rezept [data-i]')].map(z => ({
        roh: z.querySelector('[data-roh]').value,
        anteil: z.querySelector('[data-anteil]').textContent.trim(),
        zusatz: z.querySelector('[data-zusatz]').getAttribute('aria-pressed') === 'true',
        offen: z.classList.contains('rf-offen'),
        grund: z.querySelector('.rf-grund')?.textContent || '',
      })),
      notizen: [...d.querySelectorAll('.rf-notizen [data-notiz]')].map(i => i.value),
      offen: [...d.querySelectorAll('.rf-offen')].map(e => `${e.dataset.frage}: ${e.querySelector('.rf-grund')?.textContent || ''}`),
      knopf: d.querySelector('[data-ende="ok"]')?.textContent || null,
    };
  });
  console.log(`  (${dauer} ms) ${zettel.titel}: ${zettel.name} | ${zettel.beschreibung} | ${zettel.brennbereich} | ${zettel.liter}`);
  for (const r of zettel.rezept) console.log(`    ${r.zusatz ? '+' : ' '} ${r.roh} = ${r.anteil}${r.offen ? `  ? ${r.grund}` : ''}`);
  for (const n of zettel.notizen) console.log(`    Notiz: ${n}`);
  for (const o of zettel.offen) console.log(`    offen → ${o}`);
  return zettel;
}

// alle offenen Fragen mit „Stimmt so“ bestätigen
async function allesBestaetigen() {
  for (let i = 0; i < 40; i++) {
    const b = page.locator('dialog.rezept-zettel [data-stimmt]:visible').first();
    if (!(await b.count())) break;
    await b.click();
  }
  // Rezept ersetzen/anhängen
  const modus = page.locator('dialog.rezept-zettel input[name="rf-modus"][value="ersetzen"]');
  if (await modus.count()) await modus.check({ force: true });
}

const ROH = [['Kalifeldspat', '25'], ['Quarz', '30'], ['Kreide', '20'], ['Kaolin', '15'], ['Zinkoxid', '10']];
const gedruckt = {
  zeilen: [
    { t: 'Seladon hell', y: 160, gr: 58, fett: true, serif: true },
    { t: 'glänzend, transparent-grün', y: 230 },
    { t: 'Kegel 6 / 1240 °C', y: 290 },
    ...ROH.flatMap(([a, b], i) => [{ t: a, x: 120, y: 400 + i * 60 }, { t: `${b} %`, x: 700, y: 400 + i * 60 }]),
    { t: 'Zusätze:', y: 760 },
    { t: 'Eisenoxid rot', x: 120, y: 820 }, { t: '1,5', x: 700, y: 820 },
    { t: 'Litergewicht 1450 g/l', y: 920 },
    { t: 'Gut sieben (80er Sieb), 24 h quellen lassen.', y: 1000, gr: 30 },
  ],
};

try {
  // ---------- 1. gedrucktes Rezept ----------
  console.log('1. Gedrucktes Rezept');
  let z = await lesen('gedruckt', await rezeptBild(gedruckt));
  pruefe(z.name === 'Seladon hell', 'Name');
  pruefe(/glänzend/.test(z.beschreibung), 'Beschreibung');
  pruefe(/Kegel 6/.test(z.brennbereich) && /1240 °C/.test(z.brennbereich), 'Brennbereich');
  pruefe(/1450/.test(z.liter), 'Litergewicht');
  pruefe(z.rezept.length === 6, 'sechs Rohstoffe');
  pruefe(ROH.every(([a, b], i) => z.rezept[i]?.roh === a && z.rezept[i]?.anteil.replace(/,0$/, '') === b && !z.rezept[i].zusatz), 'Rohstoffe und Anteile in der richtigen Zeile');
  pruefe(z.rezept[5]?.roh === 'Eisenoxid rot' && z.rezept[5]?.zusatz && /^1,5/.test(z.rezept[5].anteil), 'Zusatz Eisenoxid rot 1,5');
  pruefe(z.notizen.some(n => /sieben/.test(n)), 'Rest als Notiz');
  await allesBestaetigen();
  await page.click('dialog.rezept-zettel [data-ende="ok"]');
  await page.waitForSelector('dialog.rezept-zettel', { state: 'detached' });
  await page.waitForSelector('#rezept-foto .pp-item img[src]');
  const form = await page.evaluate(() => {
    const f = document.querySelector('#f');
    return {
      name: f.elements.name.value, brenn: f.elements.brennbereich.value, liter: f.elements.litergewicht.value,
      zeilen: [...document.querySelectorAll('#rezept .repeat-row')].map(r => `${r.querySelector('input').value}=${r.querySelector('.repeat-wert').textContent.trim()}`),
      summe: document.querySelector('#summe').textContent, notizen: f.elements.notizen.value,
      foto: !!document.querySelector('#rezept-foto .pp-item img'),
    };
  });
  console.log('  Formular:', JSON.stringify(form));
  pruefe(form.name === 'Seladon hell' && form.liter === '1450', 'Name und Litergewicht im Formular');
  pruefe(form.zeilen.length === 6 && form.zeilen[5].startsWith('+ Eisenoxid rot'), 'Rezept im Formular (Zusatz mit +)');
  pruefe(/Summe: 100 \(dazu 1,5 Zusätze\)/.test(form.summe), 'Summe ohne Zusätze');
  pruefe(form.foto, 'Foto des Rezepts im Formular');
  await page.screenshot({ path: join(ausgabe, 'rezept-formular.png'), fullPage: true });
  await page.click('button[type="submit"]');
  await page.waitForSelector('.recipe-table');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(ausgabe, 'rezept-ansicht.png'), fullPage: true });
  pruefe(await page.locator('.rezept-foto img').count() === 1, 'Foto des Rezepts in der Ansicht');
  pruefe(/Summe ohne Zusätze/.test(await page.locator('.recipe-table tr.sum').textContent()), 'Summenzeile in der Ansicht');

  // ---------- 2. Bearbeiten: Formular hat schon Werte → Nachfrage ----------
  console.log('2. Vorhandene Glasur bearbeiten');
  await page.click('a.icon-btn:text("Bearbeiten")');
  await page.waitForSelector('#rezept-foto [data-pick="lib"]');
  z = await lesen('bearbeiten', await rezeptBild({ ...gedruckt, zeilen: gedruckt.zeilen.map(r => (r.t === 'Seladon hell' ? { ...r, t: 'Seladon dunkel' } : r)) }), { neu: false });
  pruefe(z.offen.some(o => o.startsWith('name') && /Seladon hell/.test(o)), 'fragt nach, ob der alte Name bleiben soll');
  pruefe(z.offen.some(o => o.startsWith('modus')), 'fragt: Rezept ersetzen oder anhängen');
  pruefe(/Noch \d/.test(z.knopf), 'Übernehmen erst nach Antworten');
  await page.click('dialog.rezept-zettel [data-behalten="name"]');
  await allesBestaetigen();
  await page.click('dialog.rezept-zettel [data-ende="ok"]');
  await page.waitForSelector('dialog.rezept-zettel', { state: 'detached' });
  pruefe(await page.inputValue('#f [name="name"]') === 'Seladon hell', 'alter Name behalten');
  pruefe(await page.locator('#rezept .repeat-row').count() === 6, 'Rezept ersetzt, nicht verdoppelt');

  // ---------- 3. schräg, Schatten, Rauschen, Komma vergessen ----------
  console.log('3. Schräg fotografiert mit Schatten; Kobaltoxid 15 statt 1,5');
  z = await lesen('schraeg', await rezeptBild({
    drehung: 4, schatten: true, rauschen: 40,
    zeilen: [
      { t: 'Kobaltblau', y: 170, gr: 60, fett: true },
      { t: 'Brand: 1220-1250 °C, oxidierend', y: 250 },
      ...[['Natronfeldspat', '40'], ['Quarz', '20'], ['Wollastonit', '20'], ['Kaolin', '20']].flatMap(([a, b], i) => [{ t: a, x: 110, y: 360 + i * 58 }, { t: b, x: 720, y: 360 + i * 58 }]),
      { t: '+ Kobaltoxid', x: 110, y: 640 }, { t: '15', x: 720, y: 640 },
    ],
  }));
  pruefe(z.name === 'Kobaltblau', 'Name');
  pruefe(/1220–1250 °C/.test(z.brennbereich) && /oxidierend/.test(z.brennbereich), 'Brennbereich mit Atmosphäre');
  const kobalt = z.rezept.find(r => /Kobalt/.test(r.roh));
  pruefe(kobalt?.zusatz && kobalt.offen && /Komma/.test(kobalt.grund), 'fragt bei 15 % Kobaltoxid nach (Komma?)');
  pruefe(z.rezept.filter(r => !r.zusatz).length === 4, 'vier Grundrohstoffe');
  await page.locator('dialog.rezept-zettel .rf-zeile.rf-offen').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(ausgabe, 'rezept-frage.png') });
  pruefe(await page.locator('dialog.rezept-zettel .rf-zeile.rf-offen .rf-schnipsel').count() === 1, 'Frage zeigt den Bildausschnitt');
  await page.click('dialog.rezept-zettel [data-ende="abbrechen"]');

  // ---------- 4. englisch, Mengen vorn ----------
  console.log('4. Englisches Rezept, Mengen vorn');
  z = await lesen('englisch', await rezeptBild({
    zeilen: [
      { t: 'Glossy Clear', y: 150, gr: 56, fett: true },
      { t: 'Cone 6 oxidation', y: 220 },
      ...[['20', 'Custer Feldspar'], ['20', 'Silica'], ['20', 'Whiting'], ['20', 'EPK'], ['20', 'Ferro Frit 3134']].map(([a, b], i) => ({ t: `${a}  ${b}`, x: 110, y: 330 + i * 56 })),
      { t: 'Add: Bentonite 2', y: 640 },
    ],
  }));
  pruefe(z.name === 'Glossy Clear', 'Name');
  pruefe(/Cone 6/.test(z.brennbereich), 'Kegel (Cone)');
  pruefe(z.rezept.length === 6 && z.rezept[4]?.roh === 'Ferro Frit 3134' && /^20/.test(z.rezept[4].anteil), 'Mengen vorn, Fritte mit Nummer');
  pruefe(z.rezept[5]?.roh === 'Bentonite' && z.rezept[5]?.zusatz, 'Add: als Zusatz');
  await page.click('dialog.rezept-zettel [data-ende="abbrechen"]');

  // ---------- 5. Handschrift, quer fotografiert ----------
  console.log('5. Handschrift, Blatt quer fotografiert');
  z = await lesen('hand', await rezeptBild({
    hand: true, quer: true, papier: '#fbf8ef', tinte: '#26324a',
    zeilen: [
      { t: 'Tenmoku', y: 170, gr: 70 },
      { t: '1260 °C reduziert', y: 250, gr: 44 },
      ...[['Kalifeldspat', '45'], ['Quarz', '25'], ['Kreide', '15'], ['Kaolin', '15']].flatMap(([a, b], i) => [{ t: a, x: 110, y: 360 + i * 70, gr: 46 }, { t: b, x: 720, y: 360 + i * 70, gr: 46 }]),
      { t: '+ Eisenoxid  10', x: 110, y: 680, gr: 46 },
    ],
  }));
  pruefe(z.rezept.filter(r => /Kalifeldspat|Quarz|Kreide|Kaolin/.test(r.roh)).length >= 3, 'Handschrift: Rohstoffe gelesen');
  pruefe(/1260/.test(z.brennbereich), 'Handschrift: Brennbereich');
  await page.click('dialog.rezept-zettel [data-ende="abbrechen"]');

  // ---------- 6. Foto ohne Text ----------
  console.log('6. Foto ohne Rezept');
  z = await lesen('leer', await rezeptBild({ zeilen: [] }));
  pruefe(z.titel === 'Kein Rezept gefunden', 'meldet: kein Rezept gefunden');
  await page.click('dialog.rezept-zettel [data-ende="abbrechen"]');
} catch (err) {
  falsch++;
  console.log('Fehler:', err.message);
  await page.screenshot({ path: join(ausgabe, 'rezept-fehler.png') });
}

pruefe(!fehler.length, `keine Fehler im Browser${fehler.length ? `: ${fehler.join(' | ')}` : ''}`);
console.log(`\n${ok} bestanden, ${falsch} fehlgeschlagen`);
await browser.close();
server.close();
process.exit(falsch ? 1 : 0);
