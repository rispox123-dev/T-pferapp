// Prüft die Formerkennung an gerenderten Testfotos mit bekannter Kontur.
//
//   node tools/test/auswerten.mjs [Anzahl=48] [--alt] [--sensor] [--bilder]
//   node tools/test/auswerten.mjs [Anzahl] --bericht   → tools/test/ERKENNUNG.md
//
// --alt     zum Vergleich auch die bisherige Erkennung (aus git, Stand ALT_REF)
// --sensor  Neigung der Kamera ist bekannt (wie bei der geführten Aufnahme in der App);
//           ohne: nur die Brennweite (wie aus den EXIF-Daten eines Galeriefotos)
// --bilder  Kontaktbogen mit eingezeichnetem Ergebnis nach tools/test/ausgabe/ schreiben
//
// Fehlermaß: mittlere Abweichung des Radius über die ganze Höhe, in Prozent der größeren
// Abmessung (Höhe oder Ø; beide Konturen auf ihre eigene Größe bezogen), dazu Fehler im Verhältnis Höhe : Ø.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { szene, rendern, wahresProfil } from './szene.mjs';
import { schreibePng, lesePng, kontaktbogen } from './png.mjs';
import { analyze } from '../../js/erkennung.js';

const args = process.argv.slice(2);
const anzahl = Number(args.find(a => /^\d+$/.test(a))) || 48;
const mitAlt = args.includes('--alt');
const mitBildern = args.includes('--bilder');
const mitSensor = args.includes('--sensor'); // wie bei der geführten Aufnahme: Neigung vom Lagesensor bekannt
const ALT_REF = process.env.ALT_REF || 'a88f0ad';

const ordner = new URL('./ausgabe/szenen/', import.meta.url).pathname;
mkdirSync(ordner, { recursive: true });

let altAnalyze = null;
if (mitAlt || args.includes('--bericht')) {
  const pfad = new URL('./ausgabe/alt-blueprint.mjs', import.meta.url).pathname;
  writeFileSync(pfad, execSync(`git show ${ALT_REF}:js/blueprint.js`).toString());
  altAnalyze = (await import(pfad)).analyze;
}

function testbild(seed) {
  const png = `${ordner}${seed}.png`, js = `${ordner}${seed}.json`;
  if (existsSync(png) && existsSync(js)) return { bild: lesePng(png), info: JSON.parse(readFileSync(js, 'utf8')) };
  const s = szene(seed, { W: 270, Hpx: 360 });
  const bild = rendern(s, { ss: 1 });
  const info = { seed, blick: (s.neigung * 180) / Math.PI, brennweite: s.kamera.f / Math.max(s.W, s.Hpx), familie: s.familie, gruppe: s.gruppe, frontal: s.frontal, henkel: !!s.henkel, glasur: s.glasur.name, zweiFarbig: !!s.zweiFarbig, fussBand: s.fussBand > 0, profil: wahresProfil(s, 200) };
  schreibePng(png, bild);
  writeFileSync(js, JSON.stringify(info));
  return { bild, info };
}

// Beide Konturen auf die größere Abmessung (Höhe oder Ø) beziehen – sonst zählen
// Höhenfehler bei flachen Schalen mehrfach
const fehler = (est, wahr) => {
  const ne = Math.max(1, 2 * Math.max(...est)), nw = Math.max(1, 2 * Math.max(...wahr));
  let s = 0;
  for (let i = 0; i < wahr.length; i++) s += Math.abs(est[Math.round((i / (wahr.length - 1)) * (est.length - 1))] / ne - wahr[i] / nw);
  return s / wahr.length;
};
const hd = p => 1 / (2 * Math.max(...p));

function lauf({ sensor, alt, bilder: mitBild, still = false }) {
  const zeilen = [];
  const bilder = [];
  for (let i = 0; i < anzahl; i++) {
    const seed = 1000 + i * 37;
    const { bild, info } = testbild(seed);
    const z = { seed, familie: info.familie, gruppe: info.gruppe, frontal: info.frontal, henkel: info.henkel, glasur: info.glasur, zweiFarbig: info.zweiFarbig };
    const t0 = Date.now();
    let res = null;
    try {
      res = analyze(bild, { hint: sensor ? { blick: info.blick, brennweite: info.brennweite } : { brennweite: info.brennweite } });
      z.fehler = fehler(res.profile, info.profil);
      z.hdSigned = (hd(res.profile) - hd(info.profil)) / hd(info.profil);
      z.hd = Math.abs(z.hdSigned);
      z.form = res.form.key;
      z.henkelErkannt = res.handles.length > 0;
      z.ergaenzt = res.quality.ergaenzt;
    } catch (err) { z.fehler = 1; z.hd = 1; z.err = err.message; }
    z.ms = Date.now() - t0;
    if (alt && altAnalyze) {
      try {
        const a = altAnalyze(bild);
        z.alt = fehler(a.profile, info.profil);
        z.altHd = Math.abs(hd(a.profile) - hd(info.profil)) / hd(info.profil);
      } catch { z.alt = 1; z.altHd = 1; }
    }
    zeilen.push(z);
    if (mitBild) bilder.push(zeichne(bild, res));
    if (!still) process.stdout.write(`${String(i + 1).padStart(3)} ${info.familie.padEnd(10)} ${(info.frontal ? 'frontal' : 'oben').padEnd(8)} ${info.glasur.padEnd(12)} Fehler ${(z.fehler * 100).toFixed(1).padStart(5)} %  H:D ${(z.hd * 100).toFixed(1).padStart(5)} %${z.alt != null ? `   alt ${(z.alt * 100).toFixed(1).padStart(5)} % / ${(z.altHd * 100).toFixed(1).padStart(5)} %` : ''}  ${z.form || ''} ${info.henkel ? (z.henkelErkannt ? 'Henkel ✓' : 'Henkel ✗') : z.henkelErkannt ? 'Henkel?!' : ''} ${z.err || ''} ${z.ms} ms\n`);
  }
  if (mitBild) for (let i = 0; i < bilder.length; i += 24) schreibePng(new URL(`./ausgabe/bogen-${i / 24 + 1}.png`, import.meta.url).pathname, kontaktbogen(bilder.slice(i, i + 24), 6));
  return zeilen;
}

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p = v => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const kennzahlen = (z, k = 'fehler', kh = 'hd') => ({ m: mean(z.map(r => r[k])), md: med(z.map(r => r[k])), hm: mean(z.map(r => r[kh])), hmd: med(z.map(r => r[kh])) });

if (args.includes('--bericht')) {
  const mitS = lauf({ sensor: true, still: true });
  const ohne = lauf({ sensor: false, alt: true, still: true });
  const zeile = (name, k) => `| ${name} | ${p(k.m)} | ${p(k.md)} | ${p(k.hm)} | ${p(k.hmd)} |`;
  const gruppen = [['becher', 'Becher / Tassen'], ['schale', 'Schüsseln / Schalen'], ['vase', 'Vasen']];
  const henkel = z => { const h = z.filter(r => r.henkel); return `${h.filter(r => r.henkelErkannt).length} von ${h.length}, Fehlalarme ${z.filter(r => !r.henkel && r.henkelErkannt).length}`; };
  const md = `# Formerkennung: Prüfung an Testfotos

Erzeugt mit \`node tools/test/auswerten.mjs ${anzahl} --bericht\` am ${new Date().toISOString().slice(0, 10)}.

${anzahl} gerenderte Testfotos (\`szene.mjs\`) mit exakt bekannter Kontur: Formen aus allen Familien der Formen-Datenbank,
glänzende und matte Glasuren (hell, dunkel, farbig), zweifarbig getauchte Stücke, unglasierte Füße, Henkel,
seitliches Licht mit Schlagschatten auf Tisch und Wand, Holztische, Handy-Optik (1×/2×/3×) aus der Nähe,
frontal und von schräg oben.

**Fehler Kontur**: mittlere Abweichung des Radius über die ganze Höhe, in Prozent der größeren Abmessung.
**Fehler Höhe : Ø**: Abweichung des Verhältnisses von Höhe zu größtem Durchmesser – das sieht man in der Blaupause sofort.

| Verfahren | Kontur Mittel | Kontur Median | Höhe : Ø Mittel | Höhe : Ø Median |
|---|---|---|---|---|
${zeile('**Neu, geführte Aufnahme** (Neigung vom Lagesensor)', kennzahlen(mitS))}
${zeile('Neu, Foto aus der Galerie (nur EXIF-Brennweite)', kennzahlen(ohne))}
${zeile('Bisherige Erkennung', kennzahlen(ohne, 'alt', 'altHd'))}

Henkel erkannt (geführt): ${henkel(mitS)}. Rechenzeit je Foto: ${Math.round(mean(mitS.map(r => r.ms)))} ms (Node.js, Analysegröße 480 px).

## Nach Art des Stücks (geführte Aufnahme)

| Art | Fotos | Kontur Median | Höhe : Ø Median |
|---|---|---|---|
${gruppen.map(([g, name]) => { const z = mitS.filter(r => r.gruppe === g); const k = kennzahlen(z); return `| ${name} | ${z.length} | ${p(k.md)} | ${p(k.hmd)} |`; }).join('\n')}
| zweifarbig getaucht | ${mitS.filter(r => r.zweiFarbig).length} | ${p(kennzahlen(mitS.filter(r => r.zweiFarbig)).md)} | ${p(kennzahlen(mitS.filter(r => r.zweiFarbig)).hmd)} |

## Grenzen

- Weiß auf Weiß/Creme ohne Schatten: Der Körper wird über die Kanten gut gefunden, ein gleichfarbiger Henkel aber nicht immer –
  dann im Umriss-Editor mit „Hinzufügen“ nachmalen.
- Galeriefotos von schräg oben ohne Lagesensor: Die Neigung wird aus den Bögen von Öffnung und Boden geschätzt;
  das ist ungenauer als die geführte Aufnahme.
- Die Testfotos sind gerendert. Echte Fotos haben weitere Störungen (Spiegelungen der Umgebung, Unschärfe, Rauschen bei wenig Licht).
`;
  writeFileSync(new URL('./ERKENNUNG.md', import.meta.url), md);
  console.log(md);
} else {
  const zeilen = lauf({ sensor: mitSensor, alt: mitAlt, bilder: mitBildern });
  const k = kennzahlen(zeilen);
  console.log(`\nNeu:  Fehler Kontur Mittel ${p(k.m)}, Median ${p(k.md)}; Höhe:Ø Mittel ${p(k.hm)}, Median ${p(k.hmd)}`);
  if (mitAlt) { const a = kennzahlen(zeilen, 'alt', 'altHd'); console.log(`Alt:  Fehler Kontur Mittel ${p(a.m)}, Median ${p(a.md)}; Höhe:Ø Mittel ${p(a.hm)}, Median ${p(a.hmd)}`); }
  const mitH = zeilen.filter(z => z.henkel);
  console.log(`Henkel erkannt: ${mitH.filter(z => z.henkelErkannt).length}/${mitH.length}, Fehlalarme: ${zeilen.filter(z => !z.henkel && z.henkelErkannt).length}`);
  console.log(`Ausreißer (> 4 %): ${zeilen.filter(z => z.fehler > 0.04).map(z => z.seed).join(', ') || 'keine'}`);
  console.log(`Zeit je Foto: ${Math.round(mean(zeilen.map(z => z.ms)))} ms`);
  writeFileSync(new URL('./ausgabe/ergebnis.json', import.meta.url), JSON.stringify(zeilen, null, 1));
}

// Ergebnis ins Bild zeichnen: Körperumriss orange, Henkel rot, Achse weiß, Ergänztes blau
function zeichne(bild, res) {
  const { width: W, height: H } = bild;
  const out = { width: W, height: H, data: Uint8ClampedArray.from(bild.data) };
  const px = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2];
  };
  const linie = (pts, c, closed) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const n = Math.ceil(Math.hypot((bx - ax) * W, (by - ay) * H)) + 1;
      for (let k = 0; k <= n; k++) px((ax + (bx - ax) * k / n) * W, (ay + (by - ay) * k / n) * H, c);
    }
  };
  if (!res) return out;
  const o = res.outline;
  if (process.env.ROH) { linie(o.links, [40, 220, 60], false); linie(o.rechts, [250, 230, 30], false); }
  linie(o.koerper, [255, 122, 61], true);
  for (const hk of o.henkel) linie(hk, [230, 30, 30], true);
  linie(o.achse, [255, 255, 255], false);
  for (const [ya, yb] of o.ergaenzt) linie([[0.02, ya], [0.02, yb]], [40, 120, 255], false);
  return out;
}
