// Echtes Foto erkennen und Ergebnis einzeichnen (PNG, wird wie in der App auf 480 px verkleinert).
//   node tools/test/echt.mjs foto.png [ausgabe.png]
import { lesePng, schreibePng, kontaktbogen } from './png.mjs';
import { analyze } from '../../js/erkennung.js';

const [, , ein, aus = ein.replace(/\.png$/, '-ergebnis.png')] = process.argv;
const b = lesePng(ein);
const sc = Math.min(1, 400 / Math.max(b.width, b.height)), W = Math.round(b.width * sc), H = Math.round(b.height * sc);
const d = new Uint8ClampedArray(W * H * 4);
// Flächenmittel beim Verkleinern (wie drawImage)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const x0 = Math.floor(x / sc), x1 = Math.max(x0 + 1, Math.floor((x + 1) / sc)), y0 = Math.floor(y / sc), y1 = Math.max(y0 + 1, Math.floor((y + 1) / sc));
  const s = [0, 0, 0]; let n = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * b.width + xx) * 4; s[0] += b.data[i]; s[1] += b.data[i + 1]; s[2] += b.data[i + 2]; n++; }
  const o = (y * W + x) * 4; d[o] = s[0] / n; d[o + 1] = s[1] / n; d[o + 2] = s[2] / n; d[o + 3] = 255;
}
const src = { width: W, height: H, data: d };
const t0 = Date.now();
let r;
try { r = analyze(src, { hint: process.env.BW ? { brennweite: Number(process.env.BW) } : {} }); } catch (e) { console.log('Fehler:', e.message); process.exit(1); }
console.log(`${Date.now() - t0} ms`, r.form.label, JSON.stringify(r.quality));
console.log('Profil (alle 10 %):', [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 199].map(i => r.profile[i].toFixed(3)).join(' '));
const out = { width: W, height: H, data: Uint8ClampedArray.from(d) };
const px = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; };
const linie = (pts, c, closed) => { for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; const n = Math.ceil(Math.hypot((bx - ax) * W, (by - ay) * H)) + 1; for (let k = 0; k <= n; k++) px((ax + (bx - ax) * k / n) * W, (ay + (by - ay) * k / n) * H, c); } };
const o = r.outline;
linie(o.links, [40, 220, 60], false); linie(o.rechts, [250, 230, 30], false);
linie(o.koerper, [255, 90, 20], true);
for (const hk of o.henkel) linie(hk, [230, 30, 30], true);
linie(o.achse, [255, 255, 255], false);
schreibePng(aus, kontaktbogen([src, out], 2));
console.log('→', aus);
