// Testfotos erkennen und die Blaupausen daneben zeichnen (Seite zum Anschauen).
//   node tools/test/blaupausen.mjs [Anzahl=6] [Start=0]  →  tools/test/ausgabe/blaupausen.html (+ .png)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { lesePng } from './png.mjs';
import { analyze } from '../../js/erkennung.js';
import { findPoints, renderBlueprint } from '../../js/blueprint.js';

const anzahl = Number(process.argv[2]) || 6, start = Number(process.argv[3]) || 0;
const ordner = new URL('./ausgabe/szenen/', import.meta.url).pathname;
const schrift = new URL('../../fonts/patrick-hand.woff2', import.meta.url).href;
let html = `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:"Bleistift Hand";src:url("${schrift}")}</style>` + '<body style="margin:0;background:#eee;font-family:sans-serif"><div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px">';
for (let i = start; i < start + anzahl; i++) {
  const seed = 1000 + i * 37;
  if (!existsSync(`${ordner}${seed}.png`)) { console.log('fehlt', seed, '– zuerst auswerten.mjs ausführen'); continue; }
  const info = JSON.parse(readFileSync(`${ordner}${seed}.json`, 'utf8'));
  const res = analyze(lesePng(`${ordner}${seed}.png`), { hint: { blick: info.blick, brennweite: info.brennweite } });
  const bp = { profile: res.profile, handles: res.handles, points: findPoints(res.profile) };
  const png = PNG.sync.write(PNG.sync.read(readFileSync(`${ordner}${seed}.png`)));
  html += `<div style="display:flex;gap:4px;background:#fff;padding:4px;border-radius:8px"><img src="data:image/png;base64,${png.toString('base64')}" style="width:200px;height:auto;align-self:start">
    <div style="width:260px">${renderBlueprint(bp, { title: `${res.form.label}`, info: [`Test ${seed}`], values: { hoehe: 10 }, interactive: false, seed })}</div></div>`;
}
html += '</div>';
const pfad = new URL('./ausgabe/blaupausen.html', import.meta.url).pathname;
writeFileSync(pfad, html);
execFileSync('node', [new URL('./bild.mjs', import.meta.url).pathname, pfad, pfad.replace('.html', '.png'), '1440']);
console.log('→', pfad.replace('.html', '.png'));
