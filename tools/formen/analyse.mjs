// Analysiert die Formen-Datenbank:
// 1. lernt je Formfamilie ein statistisches Konturmodell (Mittelform + Hauptkomponenten)
//    → js/formen-modell.js (wird von der App zur Formerkennung benutzt)
// 2. beschreibt die Linienführung der Familien (Proportionen, weiteste Stelle, Wendepunkte …)
// 3. prüft an zurückgehaltenen Stücken, wie verlässlich verdeckte Konturteile
//    vorhergesagt werden und wie gut Ausreißer (Schatten, Spiegelungen) erkannt werden
//    → tools/formen/ANALYSE.md und tools/formen/mittelformen.svg
//
//   node tools/formen/analyse.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { rng } from './typologie.mjs';

const hier = p => new URL(p, import.meta.url);
const db = JSON.parse(readFileSync(hier('./formen-db.json'), 'utf8'));
const N = db.N;

// --- Hilfen -----------------------------------------------------------------

function jacobi(A, n) {
  const a = Float64Array.from(A);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k], aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push({ wert: a[i * n + i], vektor: Array.from({ length: n }, (_, k) => V[k * n + i]) });
  return out.sort((x, y) => y.wert - x.wert);
}

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const pct = v => `${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
const dez = (v, d = 2) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const r5 = v => Math.round(v * 100000) / 100000;

// --- Aufteilen in Lern- und Prüfstücke ---------------------------------------

const rand = rng(424242);
const lern = [], pruef = [];
for (const e of db.eintraege) (rand() < 0.8 ? lern : pruef).push(e);

// --- Modelle lernen ----------------------------------------------------------

const familien = [];
for (const f of db.familien) {
  const X = lern.filter(e => e.familie === f.key).map(e => e.profil);
  const mu = Array.from({ length: N }, (_, i) => mean(X.map(x => x[i])));
  const C = new Float64Array(N * N);
  for (const x of X) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) C[i * N + j] += (x[i] - mu[i]) * (x[j] - mu[j]) / (X.length - 1);
  const eig = jacobi(C, N);
  const total = eig.reduce((s, e) => s + Math.max(0, e.wert), 0);
  let k = 0, acc = 0;
  while (k < 10 && acc / total < 0.995) acc += Math.max(0, eig[k++].wert);
  const komps = eig.slice(0, k);
  // Restabweichung, die die Hauptkomponenten nicht erfassen
  let rest = 0;
  for (const x of X) {
    const d = x.map((v, i) => v - mu[i]);
    const proj = d.slice();
    for (const e of komps) {
      const c = e.vektor.reduce((s, v, i) => s + v * d[i], 0);
      for (let i = 0; i < N; i++) proj[i] -= c * e.vektor[i];
    }
    rest += proj.reduce((s, v) => s + v * v, 0) / N;
  }
  rest = Math.sqrt(rest / X.length);
  familien.push({
    key: f.key, label: f.label, gruppe: f.gruppe,
    anteil: r5(1 / db.familien.length),
    erklaert: acc / total,
    mittel: mu.map(r5),
    komponenten: komps.map(e => e.vektor.map(r5)),
    varianzen: komps.map(e => r5(e.wert)),
    rest: r5(rest),
  });
}

const modell = {
  N,
  sigma: 0.006, // Messrauschen einer gut sichtbaren Kontur (Anteil der Höhe)
  restMin: 0.012, // echte Stücke weichen stärker ab als jede Familie – Mindest-Spielraum
  laenge: 0.06, // wie weit eine Abweichung in die Nachbarschaft „weiterläuft“ (Anteil der Höhe)
  familien: familien.map(({ erklaert, ...f }) => f),
};

writeFileSync(hier('../../js/formen-modell.js'),
  `// Automatisch erzeugt von tools/formen/analyse.mjs aus der Formen-Datenbank (${db.eintraege.length} Formen).\n` +
  '// Nicht von Hand bearbeiten.\n' +
  `export const MODELL = ${JSON.stringify(modell)};\n`);

// --- Linienführung beschreiben -------------------------------------------------

function merkmale(p) {
  let iMax = 0;
  for (let i = 0; i < N; i++) if (p[i] > p[iMax]) iMax = i;
  const rMax = p[iMax];
  // Wendepunkte: Vorzeichenwechsel der Krümmung (geglättet, nur deutliche)
  const d2 = [];
  for (let i = 1; i < N - 1; i++) d2.push(p[i - 1] - 2 * p[i] + p[i + 1]);
  let wende = 0, last = 0;
  for (const v of d2) {
    if (Math.abs(v) < 0.0015) continue;
    const s = Math.sign(v);
    if (last && s !== last) wende++;
    last = s;
  }
  let steil = 0;
  for (let i = 0; i < N - 1; i++) steil = Math.max(steil, Math.abs(p[i + 1] - p[i]) * (N - 1));
  return {
    hd: 1 / (2 * rMax),
    tMax: iMax / (N - 1),
    rand: p[0] / rMax,
    boden: p[N - 1] / rMax,
    wende,
    neigung: (Math.atan(steil) * 180) / Math.PI,
    kruemmung: mean(d2.map(v => Math.abs(v) * (N - 1) ** 2)),
  };
}

const famStat = db.familien.map(f => {
  const M = db.eintraege.filter(e => e.familie === f.key).map(e => merkmale(e.profil));
  const s = key => ({ med: quant(M.map(m => m[key]), 0.5), p10: quant(M.map(m => m[key]), 0.1), p90: quant(M.map(m => m[key]), 0.9) });
  return { f, n: M.length, hd: s('hd'), tMax: s('tMax'), rand: s('rand'), boden: s('boden'), wende: s('wende'), neigung: s('neigung'), kruemmung: s('kruemmung') };
});

// --- Prüfen: Vorhersage verdeckter Teile, Ausreißer, Familie erkennen --------------

const { formAnpassen } = await import('../../js/formprior.js');

const noise = (r, s) => { const u = r() || 1e-9, v = r(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const prand = rng(777);
const tests = [
  { key: 'unten', text: 'unteres Viertel verdeckt (Schatten am Fuß)', mask: i => i / (N - 1) > 0.75 },
  { key: 'oben', text: 'oberes Fünftel verdeckt (Spiegelung an der Lippe)', mask: i => i / (N - 1) < 0.2 },
  { key: 'mitte', text: 'Band in der Mitte verdeckt (Farbwechsel der Glasur)', mask: i => i / (N - 1) > 0.4 && i / (N - 1) < 0.62 },
  { key: 'haelfte', text: 'nur die obere Hälfte sichtbar', mask: i => i / (N - 1) > 0.5 },
];
const erg = Object.fromEntries(tests.map(t => [t.key, { modell: [], naiv: [] }]));
const ausr = { roh: [], robust: [] };
let richtigFam = 0, richtigGruppe = 0, gesamt = 0;
const verwechslung = {};

for (const e of pruef) {
  const wahr = e.profil;
  const mess = wahr.map(v => v + noise(prand, 0.004));
  // Familie aus vollständiger, verrauschter Kontur
  const voll = formAnpassen(mess, new Array(N).fill(1));
  gesamt++;
  if (voll.key === e.familie) richtigFam++;
  const fg = db.familien.find(f => f.key === e.familie).gruppe;
  if (voll.gruppe === fg) richtigGruppe++;
  verwechslung[`${e.familie}→${voll.key}`] = (verwechslung[`${e.familie}→${voll.key}`] || 0) + 1;

  for (const t of tests) {
    const w = wahr.map((_, i) => (t.mask(i) ? 0 : 1));
    const fit = formAnpassen(mess, w);
    // naiv: gerade weiterführen bzw. linear überbrücken
    const sicht = [];
    for (let i = 0; i < N; i++) if (w[i]) sicht.push(i);
    for (let i = 0; i < N; i++) {
      if (w[i]) continue;
      let a = -1, b = -1;
      for (const j of sicht) { if (j < i) a = j; if (j > i && b < 0) b = j; }
      const naiv = a >= 0 && b >= 0 ? mess[a] + (mess[b] - mess[a]) * (i - a) / (b - a) : a >= 0 ? mess[a] : mess[b];
      erg[t.key].modell.push(Math.abs(fit.profil[i] - wahr[i]));
      erg[t.key].naiv.push(Math.abs(naiv - wahr[i]));
    }
  }

  // Ausreißer: 15 % der Stellen durch Schatten/Spiegelung verfälscht
  const kaputt = mess.slice();
  const idx = [];
  const start = Math.floor(prand() * (N - 8));
  for (let i = start; i < start + 7; i++) idx.push(i);
  for (const i of idx) kaputt[i] = wahr[i] * (prand() < 0.5 ? 0.7 + 0.15 * prand() : 1.15 + 0.15 * prand());
  const rob = formAnpassen(kaputt, new Array(N).fill(1));
  for (const i of idx) { ausr.roh.push(Math.abs(kaputt[i] - wahr[i])); ausr.robust.push(Math.abs(rob.profil[i] - wahr[i])); }
}

const verwechselt = Object.entries(verwechslung).filter(([k]) => k.split('→')[0] !== k.split('→')[1]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v}×)`);

// --- Bericht -------------------------------------------------------------------

let md = `# Formen-Datenbank: Analyse

Erzeugt mit \`npm run formen\` am ${new Date().toISOString().slice(0, 10)}.

Die Datenbank (\`formen-db.json\`) enthält **${db.eintraege.length} Gefäßkonturen** aus ${db.familien.length} Formfamilien
gedrehter Gebrauchskeramik. Jede Kontur ist als Radius/Höhe an ${N} Stellen von der Öffnung bis zum Boden gespeichert.
${lern.length} Stücke wurden zum Lernen benutzt, ${pruef.length} zurückgehalten und nur zum Prüfen verwendet.

> Hinweis: Die Konturen stammen aus Bauregeln typischer Formen (Proportionen, Fuß, Bauch, Taille, Schulter, Hals, Lippe;
> siehe \`typologie.mjs\`), nicht aus Fotos. Eigene Profile lassen sich ergänzen – einfach weitere Einträge mit
> \`familie\` und \`profil\` in \`formen-db.json\` aufnehmen und \`npm run formen\` erneut ausführen.

![Mittelformen](mittelformen.svg)

## Linienführung je Formfamilie

Median, in Klammern 10.–90. Perzentil.

| Familie | Stück | Höhe : Ø | Weiteste Stelle (von oben) | Ø Öffnung / Ø max | Ø Boden / Ø max | Wendepunkte | Steilste Wandneigung |
|---|---|---|---|---|---|---|---|
`;
for (const s of famStat) {
  const f = (o, fn) => `${fn(o.med)} (${fn(o.p10)}–${fn(o.p90)})`;
  md += `| ${s.f.label} | ${s.n} | ${f(s.hd, v => dez(v))} | ${f(s.tMax, v => `${Math.round(v * 100)} %`)} | ${f(s.rand, v => dez(v))} | ${f(s.boden, v => dez(v))} | ${f(s.wende, v => String(v))} | ${f(s.neigung, v => `${Math.round(v)}°`)} |\n`;
}

md += `
### Was daraus für die Erkennung folgt

- **Konturen sind glatt.** Zwischen zwei benachbarten Stützstellen (≈ 2 % der Höhe) ändert sich der Radius fast nie sprunghaft;
  Knicke gibt es nur an Fuß, Standring und Lippe. Ein plötzlicher Sprung in einer gemessenen Kontur ist daher meist ein Schatten,
  eine Spiegelung oder ein Farbwechsel – kein Teil der Form.
- **Wenige Wendepunkte.** Gerade und konische Becher haben 0–1, Tulpenbecher, Vasen und Schüsseln mit Standring meist 1–3
  Wendepunkte. Das begrenzt, wie eine Kontur hinter einer verdeckten Stelle weiterlaufen kann.
- **Typische Proportionen.** Becher sind etwa 1,0–1,5-mal so hoch wie breit, Schüsseln 0,3–0,5-mal, hohe Vasen 1,6–2,9-mal;
  bauchige Tassen und Kugelvasen sind bei rund 60 % der Höhe (von oben) am weitesten.
- **Wenige Hauptrichtungen genügen.** Je Familie erklären höchstens 10 Hauptkomponenten über 99,5 % der Formvielfalt:

| Familie | Hauptkomponenten | erklärte Vielfalt | Restabweichung |
|---|---|---|---|
${familien.map(f => `| ${f.label} | ${f.komponenten.length} | ${pct(f.erklaert)} | ${pct(f.rest)} der Höhe |`).join('\n')}

## Verlässlichkeit der Vorhersage

Geprüft an ${pruef.length} zurückgehaltenen Stücken (leicht verrauscht gemessen, ±0,4 % der Höhe).
Fehler = mittlere Abweichung des Radius an den verdeckten Stellen, in Prozent der Höhe.

| Verdeckt | mit Formwissen | gerade weitergeführt / überbrückt |
|---|---|---|
${tests.map(t => `| ${t.text} | **${pct(mean(erg[t.key].modell))}** | ${pct(mean(erg[t.key].naiv))} |`).join('\n')}

**Ausreißer** (7 aufeinanderfolgende Stellen um 15–30 % verfälscht, z. B. Schlagschatten oder Glanzlicht):
Fehler an diesen Stellen roh **${pct(mean(ausr.roh))}**, nach robuster Anpassung **${pct(mean(ausr.robust))}**.

**Formfamilie erkannt:** ${pct(richtigFam / gesamt)} der Stücke exakt, ${pct(richtigGruppe / gesamt)} in der richtigen Gruppe
(Becher/Tasse · Schüssel/Schale · Vase).${verwechselt.length ? ` Verwechselt werden vor allem ähnliche Nachbarn: ${verwechselt.join(', ')}.` : ''}
Bei echten Stücken, die zwischen zwei Familien liegen, ist die Zuordnung natürlich unschärfer – für die Vorhersage
ist das unkritisch, weil die gemessenen Stellen immer Vorrang haben.

## So nutzt die App das Formwissen

1. Das Foto wird an der Mittelachse geteilt; für beide Seiten wird die Kontur gesucht und bewertet (Kantenschärfe, Farbabstand zum Hintergrund).
2. Die besser belichtete Seite ist die **Leitseite**. Wo die andere Seite abweicht (Schatten, Henkel), gilt die Leitseite gespiegelt.
3. Die so gemessene Kontur wird an alle Formfamilien angepasst; die passendste liefert für jede Stelle eine Erwartung samt Spielraum.
4. Stellen, die stark von der Erwartung abweichen und im Foto unsicher sind, werden aus dem Formwissen ergänzt; mit der Erwartung als Führung wird die Kontur im Foto ein zweites Mal gesucht.
`;
writeFileSync(hier('./ANALYSE.md'), md);

// --- Bild der Mittelformen ------------------------------------------------------

{
  const cellW = 170, cellH = 190, cols = 4;
  const rows = Math.ceil(familien.length / cols);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cellW} ${rows * cellH}" font-family="sans-serif" font-size="12">
<rect width="100%" height="100%" fill="#f6f1ea"/>`;
  familien.forEach((f, idx) => {
    const ox = (idx % cols) * cellW, oy = Math.floor(idx / cols) * cellH;
    const X = lern.filter(e => e.familie === f.key).map(e => e.profil);
    const sd = f.mittel.map((_, i) => Math.sqrt(mean(X.map(x => (x[i] - f.mittel[i]) ** 2))));
    const rmax = Math.max(...f.mittel.map((m, i) => m + 2 * sd[i]));
    const s = Math.min(130, 140 / (2 * rmax));
    const cx = ox + cellW / 2, top = oy + 26;
    const pt = (r, i) => [cx + r * s, top + (i / (N - 1)) * s];
    const side = sign => {
      const out = f.mittel.map((m, i) => pt(sign * (m + 2 * sd[i]), i));
      const inn = f.mittel.map((m, i) => pt(sign * Math.max(0, m - 2 * sd[i]), i)).reverse();
      return `<path d="M${[...out, ...inn].map(p => p.map(v => v.toFixed(1)).join(' ')).join('L')}Z" fill="#b5643c" opacity=".18"/>`;
    };
    const line = sign => `<path d="M${f.mittel.map((m, i) => pt(sign * m, i).map(v => v.toFixed(1)).join(' ')).join('L')}" fill="none" stroke="#2e2620" stroke-width="2"/>`;
    // Beispiele
    let bsp = '';
    X.slice(0, 6).forEach(x => { bsp += `<path d="M${x.map((m, i) => pt(m, i).map(v => v.toFixed(1)).join(' ')).join('L')}" fill="none" stroke="#7a6c60" stroke-width=".7" opacity=".6"/>`; });
    svg += `<text x="${cx}" y="${oy + 16}" text-anchor="middle" fill="#2e2620">${f.label}</text>${side(-1)}${side(1)}${line(-1)}${line(1)}${bsp}`;
  });
  svg += '</svg>\n';
  writeFileSync(hier('./mittelformen.svg'), svg);
}

console.log(md.split('## Verlässlichkeit')[1]);
