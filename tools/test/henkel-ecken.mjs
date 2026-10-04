// Prüft gezielt zwei Schwachstellen der Formerkennung an gerenderten Bechern und Tassen:
//   1. Henkel: Wie viel vom wahren Henkel wird erfasst (Abdeckung), wie viel ist zu viel (Genauigkeit)?
//   2. Obere Ecken: Wird die Kontur am Rand abgerundet? (Radius in den obersten 6 % der Höhe im
//      Vergleich zur Wand darunter, bezogen auf die wahre Kontur; negativ = abgerundet)
//
//   node tools/test/henkel-ecken.mjs [Anzahl=40] [--unschaerfe] [--bilder]
//
// --unschaerfe  Tiefenunschärfe wie bei der Handykamera aus der Nähe: scharf auf die Vorderseite
//               des Stücks, dahinter (hinterer Rand, Hintergrund) zunehmend unscharf.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { szene, rendern, wahresProfil, projiziere } from './szene.mjs';
import { schreibePng, lesePng, kontaktbogen } from './png.mjs';
import { analyze, cropFromGuide } from '../../js/erkennung.js';
import { rng } from '../formen/typologie.mjs';

const args = process.argv.slice(2);
const anzahl = Number(args.find(a => /^\d+$/.test(a))) || 40;
const unschaerfe = args.includes('--unschaerfe');
const mitBildern = args.includes('--bilder');
const ordner = new URL('./ausgabe/henkel/', import.meta.url).pathname;
mkdirSync(ordner, { recursive: true });
const FAM = ['becher', 'konisch', 'bauchig', 'tulpe'];
const W = 270, H = 360;

function testbild(seed) {
  const png = `${ordner}${seed}.png`, js = `${ordner}${seed}.json`;
  const opts = { W, Hpx: H, familie: FAM[seed % 4], henkel: true, frontal: seed % 5 !== 0 };
  if (existsSync(png) && existsSync(js)) {
    const info = JSON.parse(readFileSync(js, 'utf8'));
    return { bild: lesePng(png), info, henkel: Uint8Array.from(info.henkelMaske), koerper: Uint8Array.from(info.koerperMaske), tiefe: Float32Array.from(info.tiefe) };
  }
  const s = szene(seed, opts);
  const bild = rendern(s, { ss: 1 });
  const koerper = Uint8Array.from(bild.maske, (m, i) => (m && !bild.henkelMaske[i] ? 1 : 0));
  const info = {
    seed, opts, blick: (s.neigung * 180) / Math.PI, brennweite: s.kamera.f / Math.max(s.W, s.Hpx), profil: wahresProfil(s, 200),
    vorn: Math.min(...Array.from(bild.tiefe).filter((t, i) => koerper[i])),
    henkelMaske: Array.from(bild.henkelMaske), koerperMaske: Array.from(koerper), tiefe: Array.from(bild.tiefe, t => Math.round(t * 100) / 100),
  };
  schreibePng(png, bild);
  writeFileSync(js, JSON.stringify(info));
  return { bild: { width: bild.width, height: bild.height, data: bild.data }, info, henkel: bild.henkelMaske, koerper, tiefe: bild.tiefe };
}

// Tiefenunschärfe: Zerstreuungskreis ∝ |1 − Fokus/Tiefe| (Handy, f/1,8, ≈ 30 cm, bei 400 px)
function verwischen(bild, tiefe, vorn) {
  const { width: w, height: h, data } = bild;
  const out = Uint8ClampedArray.from(data);
  const B = 4.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = B * Math.abs(1 - vorn / tiefe[y * w + x]);
    if (r < 0.35) continue;
    const R = Math.ceil(r);
    const s = [0, 0, 0];
    let n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      // nichts Nahes in Fernes hineinmischen (Vordergrund bleibt scharf begrenzt)
      if (tiefe[yy * w + xx] < tiefe[y * w + x] - 3) continue;
      const i = (yy * w + xx) * 4;
      s[0] += data[i]; s[1] += data[i + 1]; s[2] += data[i + 2]; n++;
    }
    const o = (y * w + x) * 4;
    out[o] = s[0] / n; out[o + 1] = s[1] / n; out[o + 2] = s[2] / n;
  }
  return { width: w, height: h, data: out };
}

// Polygone (relativ) mit gerader/ungerader Regel rastern: Löcher (Henkelloch) bleiben frei
function rastern(polys) {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const yy = (y + 0.5) / H;
    const xs = [];
    for (const p of polys) for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      if ((ay <= yy) !== (by <= yy)) xs.push((ax + ((yy - ay) * (bx - ax)) / (by - ay)) * W);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(W, xs[k + 1] - 0.5); x++) m[y * W + x] = 1;
  }
  return m;
}

const zeilen = [], bilder = [];
for (let i = 0; i < anzahl; i++) {
  const seed = 5000 + i * 41;
  let { bild, info, henkel, koerper, tiefe } = testbild(seed);
  if (unschaerfe) bild = verwischen(bild, tiefe, info.vorn);
  // wie die geführte Aufnahme: Neigung vom Lagesensor, Stück ungefähr in der Maske
  const sz = szene(seed, { W, Hpx: H, ...info.opts });
  const r = rng(seed * 13 + 1), j = () => (r() - 0.5) * 0.16;
  const ax = projiziere(sz, [0, sz.H / 2, 0])[0], rk = Math.max(...sz.R);
  const halb = projiziere(sz, [rk, sz.H / 2, 0])[0] - ax;
  const yo = projiziere(sz, [0, sz.H, 0])[1], yu = projiziere(sz, [0, 0, 0])[1], hh = yu - yo;
  const guide = { x0: (ax - halb * 1.15 + halb * 2 * j()) / W, x1: (ax + halb * 1.15 + halb * 2 * j()) / W, y0: (yo + hh * j()) / H, y1: (yu + hh * j()) / H };
  const z = { seed, familie: info.opts.familie, frontal: info.opts.frontal };
  let res = null;
  try {
    res = analyze(bild, { hint: { blick: info.blick, brennweite: info.brennweite, guide }, crop: cropFromGuide(guide) });
    // Henkel außerhalb des Körpers vergleichen
    const erk = rastern(res.outline.henkel), kb = rastern([res.outline.koerper]);
    let gt = 0, tp = 0, det = 0;
    for (let k = 0; k < W * H; k++) {
      const g = henkel[k] && !koerper[k];
      const d = erk[k] && !kb[k] && !koerper[k];
      gt += g; det += d; tp += g && d;
    }
    z.abdeckung = gt ? tp / gt : 0;
    z.genau = det ? tp / det : 0;
    // Ecken oben: Radius relativ zur wahren Kontur, oben gegen Wand darunter
    const wahr = info.profil, est = res.profile;
    const rel = (a, b) => { let s = 0, n = 0; for (let t = a; t <= b; t++) { s += est[t] / Math.max(1e-3, wahr[t]); n++; } return s / n; };
    z.ecke = rel(0, 12) / rel(20, 60) - 1; // obere 6 % gegen 10–30 %
    z.boden = rel(188, 199) / rel(140, 180) - 1;
  } catch (err) { z.err = err.message; z.abdeckung = 0; z.genau = 0; z.ecke = -1; z.boden = -1; }
  zeilen.push(z);
  if (mitBildern) bilder.push(zeichne(bild, res));
  process.stdout.write(`${String(i + 1).padStart(3)} ${seed} ${z.familie.padEnd(8)} ${z.frontal ? 'frontal' : 'oben   '} Henkel ${(z.abdeckung * 100).toFixed(0).padStart(3)} % erfasst, ${(z.genau * 100).toFixed(0).padStart(3)} % genau   Ecke oben ${(z.ecke * 100).toFixed(1).padStart(6)} %  unten ${(z.boden * 100).toFixed(1).padStart(6)} % ${z.err || ''}\n`);
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p = v => `${(v * 100).toFixed(1)} %`;
console.log(`\nHenkel erfasst: Mittel ${p(mean(zeilen.map(z => z.abdeckung)))}, Median ${p(med(zeilen.map(z => z.abdeckung)))}; unter 60 %: ${zeilen.filter(z => z.abdeckung < 0.6).length} von ${zeilen.length}`);
console.log(`Henkel genau:   Mittel ${p(mean(zeilen.map(z => z.genau)))}, Median ${p(med(zeilen.map(z => z.genau)))}`);
console.log(`Ecke oben:      Mittel ${p(mean(zeilen.map(z => z.ecke)))}, Median ${p(med(zeilen.map(z => z.ecke)))}; stärker als −3 %: ${zeilen.filter(z => z.ecke < -0.03).length}`);
console.log(`Ecke unten:     Mittel ${p(mean(zeilen.map(z => z.boden)))}, Median ${p(med(zeilen.map(z => z.boden)))}`);
if (mitBildern) for (let i = 0; i < bilder.length; i += 24) schreibePng(`${ordner}../henkel-bogen-${i / 24 + 1}${unschaerfe ? '-u' : ''}.png`, kontaktbogen(bilder.slice(i, i + 24), 6));

function zeichne(bild, res) {
  const out = { width: W, height: H, data: Uint8ClampedArray.from(bild.data) };
  const px = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; };
  const linie = (pts, c) => { for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; const n = Math.ceil(Math.hypot((bx - ax) * W, (by - ay) * H)) + 1; for (let k = 0; k <= n; k++) px((ax + (bx - ax) * k / n) * W, (ay + (by - ay) * k / n) * H, c); } };
  if (!res) return out;
  linie(res.outline.koerper, [255, 122, 61]);
  for (const hk of res.outline.henkel) linie(hk, [230, 30, 30]);
  return out;
}
