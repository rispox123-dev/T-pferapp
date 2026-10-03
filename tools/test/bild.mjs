// Hilfsskript: SVG/HTML-Datei mit Chromium als PNG speichern (zum Anschauen von Ergebnissen).
//   node tools/test/bild.mjs eingabe.svg ausgabe.png [breite]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , ein, aus, breite = '900'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: Number(breite), height: 600 } });
if (ein.endsWith('.svg')) await page.setContent(`<body style="margin:0">${readFileSync(ein, 'utf8')}</body>`);
else await page.goto('file://' + resolve(ein));
await page.screenshot({ path: aus, fullPage: true });
await browser.close();
