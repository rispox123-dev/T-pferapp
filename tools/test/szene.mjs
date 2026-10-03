// Realistische Testfotos von Keramik erzeugen (Raymarching), damit die Formerkennung
// an vielen Fällen mit bekannter, exakter Kontur geprüft werden kann:
// Glasuren (glänzend, matt, dunkel, hell, zweifarbig getaucht), unglasierter Fuß,
// seitliches Licht mit weichem Schlagschatten auf Tisch und Wand, Glanzlichter,
// Henkel, Tischkante im Hintergrund, Holzmaserung, Rauschen.

import { FAMILIEN, rng, erzeuge } from '../formen/typologie.mjs';

const U = (r, a, b) => a + (b - a) * r();
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const lin = c => (c / 255) ** 2.2;
const srgb = v => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const GLASUREN = [
  { name: 'weiß', c: [236, 233, 226], gloss: 0.8 },
  { name: 'creme', c: [226, 211, 182], gloss: 0.6 },
  { name: 'seladon', c: [162, 192, 172], gloss: 0.9 },
  { name: 'blau', c: [56, 88, 140], gloss: 0.8 },
  { name: 'tenmoku', c: [62, 38, 26], gloss: 0.95 },
  { name: 'schwarz matt', c: [34, 33, 35], gloss: 0.15 },
  { name: 'hafer', c: [201, 186, 158], gloss: 0.35 },
  { name: 'rostrot', c: [150, 72, 44], gloss: 0.6 },
  { name: 'graugrün', c: [120, 132, 118], gloss: 0.5 },
  { name: 'türkis', c: [70, 150, 160], gloss: 0.85 },
];
const TON = [[208, 192, 170], [172, 104, 72], [112, 98, 88], [226, 220, 210]];
const HINTERGRUND = [[238, 238, 236], [205, 205, 202], [150, 150, 150], [232, 222, 205], [92, 98, 104], [180, 190, 200], [60, 60, 62]];
const HOLZ = [[160, 118, 82], [196, 160, 120], [110, 80, 58]];

export function szene(seed, opts = {}) {
  const r = rng(seed);
  const fam = opts.familie ? FAMILIEN.find(f => f.key === opts.familie) : pick(r, FAMILIEN);
  const fr = rng(seed * 31 + 7);
  const { profil } = erzeuge(fam, fr, 401);
  const H = fam.gruppe === 'schale' ? U(r, 6, 10) : fam.gruppe === 'vase' ? U(r, 16, 28) : U(r, 8, 12);
  const R = profil.map(v => v * H); // Index 0 = oben
  const wall = U(r, 0.35, 0.7);
  const henkel = fam.gruppe === 'becher' && (opts.henkel ?? r() < 0.6);
  const s = {
    seed, familie: fam.key, gruppe: fam.gruppe, H, R, wall, floor: U(r, 0.5, 0.9),
    glasur: pick(r, GLASUREN), innen: null, ton: pick(r, TON), fussBand: r() < 0.6 ? U(r, 0.3, 1.4) : 0,
    zweiFarbig: r() < 0.25 ? { g: pick(r, GLASUREN), y: H * U(r, 0.35, 0.7) } : null,
    tisch: r() < 0.3 ? { holz: pick(r, HOLZ) } : { c: pick(r, HINTERGRUND) },
    wand: pick(r, HINTERGRUND), wandAbstand: U(r, 8, 30),
    licht: null, frontal: opts.frontal ?? r() < 0.7,
  };
  if (r() < 0.3) s.wand = s.tisch.c || s.wand; // nahtloser Hintergrund
  s.innen = r() < 0.7 ? s.glasur : pick(r, GLASUREN);
  const az = (r() < 0.5 ? -1 : 1) * U(r, 25, 80) * Math.PI / 180;
  const el = U(r, 25, 60) * Math.PI / 180;
  s.licht = { dir: norm([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]), I: U(r, 0.85, 1.15), amb: U(r, 0.22, 0.42), weich: U(r, 5, 14), fill: U(r, 0, 0.18) };

  // Henkel: Bogen seitlich in der Ebene z = 0 (leicht zur Kamera gedreht)
  if (henkel) {
    const side = r() < 0.5 ? -1 : 1;
    const y1 = H * U(r, 0.68, 0.86), y2 = H * U(r, 0.18, 0.4);
    const rAt = y => R[Math.round((1 - y / H) * 400)];
    const reach = H * U(r, 0.22, 0.38);
    const rt = U(r, 0.38, 0.6);
    const rot = U(r, -0.35, 0.35);
    const P = [[rAt(y1) - wall, y1], [rAt(y1) + reach, y1 + H * U(r, 0.02, 0.12)], [rAt(y2) + reach * U(r, 0.7, 1.1), y2 - H * U(r, 0.0, 0.08)], [rAt(y2) - wall, y2]];
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3;
      const x = a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0];
      const y = a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1];
      pts.push([side * x * Math.cos(rot), y, side * x * Math.sin(rot)]);
    }
    s.henkel = { pts, rt, side, rot };
  }

  // Kamera
  const Rmax = Math.max(...R) + (henkel ? H * 0.4 : 0);
  void Rmax;
  if (s.frontal) {
    s.kamHoehe = H * U(r, 0.35, 0.65);
    s.blick = U(r, -2, 2) * Math.PI / 180;
  } else {
    s.blick = U(r, 12, 34) * Math.PI / 180; // nach unten
  }
  s.roll = U(r, -1.2, 1.2) * Math.PI / 180;
  s.W = opts.W || 300;
  s.Hpx = opts.Hpx || 400;
  // Handy-Optik: Hauptkamera ≈ 26 mm KB (Brennweite 0,75 × lange Bildseite), oft auch 2× oder 3× Zoom
  const zr = r();
  s.zoom = zr < 0.6 ? 1 : zr < 0.85 ? 2 : 3;
  const f = 0.75 * s.zoom * Math.max(s.W, s.Hpx);
  const fuell = opts.fuell ?? U(r, 0.55, 0.8);
  const zielY = H / 2 + U(r, -0.05, 0.05) * H + (opts.zielVersatz || 0) * H;
  const stelle = dist => {
    const camY = s.frontal ? s.kamHoehe : H / 2 + dist * Math.sin(s.blick);
    const horiz = s.frontal ? dist : dist * Math.cos(s.blick);
    s.cam = [0, camY, horiz];
    // auf die Mitte des Stücks zielen (Bildmitte = optische Achse, wie beim Handy)
    const fwd = norm(sub([0, zielY, 0], s.cam));
    s.neigung = Math.asin(-fwd[1]); // Blick nach unten (Lagesensor)
    let right = norm(cross(fwd, [0, 1, 0]));
    let up = cross(right, fwd);
    const cr = Math.cos(s.roll), sr = Math.sin(s.roll);
    [right, up] = [add(mul(right, cr), mul(up, sr)), add(mul(up, cr), mul(right, -sr))];
    s.kamera = { pos: s.cam, fwd, right, up, f, cx: s.W / 2, cy: s.Hpx / 2 };
    const P = [];
    for (let i = 0; i <= 40; i++) {
      const y = (i / 40) * H, rr = R[Math.round((1 - i / 40) * 400)];
      for (let a = 0; a < 24; a++) P.push(projiziere(s, [rr * Math.cos((a / 24) * 2 * Math.PI), y, rr * Math.sin((a / 24) * 2 * Math.PI)]));
    }
    for (const q of s.henkel?.pts || []) P.push(projiziere(s, q));
    const dx = Math.max(...P.map(q => Math.abs(q[0] - s.W / 2))), dy = Math.max(...P.map(q => Math.abs(q[1] - s.Hpx / 2)));
    return Math.max(dy / (fuell * s.Hpx / 2), dx / (0.45 * s.W));
  };
  // Abstand so wählen, dass das Stück ganz ins Bild passt und 55–80 % der Höhe füllt
  let dist = Math.max(H, 2 * Rmax) * 2;
  for (let it = 0; it < 8; it++) dist *= stelle(dist);
  stelle(dist);
  s.abstand = dist;
  s.rauschen = U(r, 1.5, 4);
  return s;
}

function rAt(s, y) {
  const p = (1 - y / s.H) * 400;
  if (p <= 0) return s.R[0];
  if (p >= 400) return s.R[400];
  const a = Math.floor(p);
  return s.R[a] + (s.R[Math.min(400, a + 1)] - s.R[a]) * (p - a);
}
function slope(s, y) { return (rAt(s, y + 0.05) - rAt(s, y - 0.05)) / 0.1; }

function sdGefaess(s, p) {
  const rho = Math.hypot(p[0], p[2]);
  const y = p[1];
  const yc = Math.min(s.H, Math.max(0, y));
  const r = rAt(s, yc);
  const k = 1 / Math.sqrt(1 + slope(s, yc) ** 2);
  const outer = Math.max((rho - r) * k, -y, y - s.H);
  const cav = Math.max((rho - (r - s.wall)) * k, s.floor - y);
  return Math.max(outer, -cav);
}

function sdHenkel(s, p) {
  if (!s.henkel) return Infinity;
  const pts = s.henkel.pts;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ab = sub(b, a), ap = sub(p, a);
    const t = Math.max(0, Math.min(1, dot(ap, ab) / dot(ab, ab)));
    const d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
    if (d < best) best = d;
  }
  return best - s.henkel.rt;
}

const sdf = (s, p) => Math.min(sdGefaess(s, p), sdHenkel(s, p));

function schatten(s, p, L) {
  let res = 1, t = 0.08;
  for (let i = 0; i < 64 && t < 80; i++) {
    const h = sdf(s, add(p, mul(L, t)));
    if (h < 0.002) return 0;
    res = Math.min(res, (s.licht.weich * h) / t);
    t += Math.min(Math.max(h, 0.05), 2);
  }
  return Math.max(0, Math.min(1, res));
}

function normale(s, p) {
  const e = 0.01;
  return norm([
    sdf(s, [p[0] + e, p[1], p[2]]) - sdf(s, [p[0] - e, p[1], p[2]]),
    sdf(s, [p[0], p[1] + e, p[2]]) - sdf(s, [p[0], p[1] - e, p[2]]),
    sdf(s, [p[0], p[1], p[2] + e]) - sdf(s, [p[0], p[1], p[2] - e]),
  ]);
}

function hash3(x, y, z) {
  let h = Math.imul(Math.floor(x * 7.3) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(Math.floor(y * 7.3), 0x85ebca6b) ^ Math.imul(Math.floor(z * 7.3), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function strahl(s, o, d) {
  // Begrenzung: Zylinder um das Stück
  const Rb = Math.max(...s.R) + (s.henkel ? s.H * 0.45 : 0) + 0.5;
  const a = d[0] ** 2 + d[2] ** 2, b = 2 * (o[0] * d[0] + o[2] * d[2]), c = o[0] ** 2 + o[2] ** 2 - Rb * Rb;
  const disc = b * b - 4 * a * c;
  let hit = null;
  if (disc > 0) {
    let t = Math.max(0, (-b - Math.sqrt(disc)) / (2 * a));
    const t1 = (-b + Math.sqrt(disc)) / (2 * a);
    for (let i = 0; i < 220 && t < t1; i++) {
      const p = add(o, mul(d, t));
      const h = sdf(s, p);
      if (h < 0.003) { hit = { t, p, obj: true }; break; }
      t += Math.max(h * 0.8, 0.004);
    }
  }
  if (hit) return hit;
  // Tisch (y = 0) bzw. Wand (z = -wandAbstand)
  const tt = d[1] < 0 ? -o[1] / d[1] : Infinity;
  const tw = d[2] < 0 ? (-s.wandAbstand - o[2]) / d[2] : Infinity;
  if (tt < tw) return { t: tt, p: add(o, mul(d, tt)), tisch: true };
  return { t: tw, p: add(o, mul(d, tw)), wand: true };
}

function farbe(s, hit, d) {
  const L = s.licht.dir;
  if (hit.obj) {
    const p = hit.p;
    const n = normale(s, p);
    const rho = Math.hypot(p[0], p[2]);
    const imHenkel = sdHenkel(s, p) < sdGefaess(s, p);
    const innen = !imHenkel && rho < rAt(s, Math.min(s.H, p[1])) - s.wall * 0.5 && p[1] > s.floor - 0.01;
    let g = innen ? s.innen : s.glasur;
    if (!innen && s.zweiFarbig && p[1] > s.zweiFarbig.y) g = s.zweiFarbig.g;
    let alb = g.c.map(lin), gloss = g.gloss;
    if (!innen && !imHenkel && p[1] < s.fussBand) { alb = s.ton.map(lin); gloss = 0.05; }
    // Sprenkel
    const sp = hash3(p[0] * 9, p[1] * 9, p[2] * 9);
    if (sp > 0.985) alb = mul(alb, 0.55);
    const sh = schatten(s, add(p, mul(n, 0.02)), L);
    const diff = Math.max(0, dot(n, L)) * sh * s.licht.I;
    const fillDir = norm([-L[0], 0.3, L[2]]);
    const fill = Math.max(0, dot(n, fillDir)) * s.licht.fill;
    // Umgebungslicht mit Verdeckung (innen dunkler)
    let ao = 1;
    for (let i = 1; i <= 4; i++) { const h = i * 0.35; ao -= (h - Math.min(h, sdf(s, add(p, mul(n, h))))) / (h * 4.5); }
    ao = Math.max(0.15, ao);
    const amb = s.licht.amb * (0.6 + 0.4 * n[1]) * ao;
    const v = mul(d, -1);
    const hv = norm(add(L, v));
    const spec = gloss * sh * s.licht.I * Math.pow(Math.max(0, dot(n, hv)), 20 + 100 * gloss) * 1.6;
    const fres = gloss * 0.12 * (1 - Math.max(0, dot(n, v))) ** 4 * ao;
    return alb.map(c => c * (diff + fill + amb) + spec + fres);
  }
  const p = hit.p;
  let alb;
  if (hit.tisch && s.tisch.holz) {
    const grain = 0.85 + 0.15 * Math.sin(p[0] * 1.7 + Math.sin(p[2] * 0.4) * 3) + 0.05 * Math.sin(p[0] * 13);
    alb = s.tisch.holz.map(c => lin(c) * grain);
  } else alb = (hit.tisch ? s.tisch.c || s.wand : s.wand).map(lin);
  const n = hit.tisch ? [0, 1, 0] : [0, 0, 1];
  const sh = schatten(s, add(p, mul(n, 0.01)), L);
  const diff = Math.max(0, dot(n, L)) * sh * s.licht.I;
  // Kontaktschatten am Fuß
  const dObj = sdf(s, p);
  const ao = Math.min(1, 0.35 + 0.65 * Math.min(1, dObj / 1.2));
  return alb.map(c => c * (diff * 0.85 + s.licht.amb * 1.1 * ao + s.licht.fill * 0.3));
}

// Bild rendern: liefert RGBA-Daten, Maske (Stück ja/nein) und Lage von Rand und Boden im Bild
export function rendern(s, { ss = 2 } = {}) {
  const { W, Hpx: Hh } = s;
  const data = new Uint8ClampedArray(W * Hh * 4);
  const maske = new Uint8Array(W * Hh);
  const k = s.kamera;
  const rnd = rng(s.seed ^ 0x5bd1e995);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      let acc = [0, 0, 0], objCount = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const u = (x + (sx + 0.5) / ss - k.cx) / k.f, v = (y + (sy + 0.5) / ss - k.cy) / k.f;
        const d = norm(add(add(k.fwd, mul(k.right, u)), mul(k.up, -v)));
        const hit = strahl(s, k.pos, d);
        if (hit.obj) objCount++;
        acc = add(acc, farbe(s, hit, d));
      }
      acc = mul(acc, 1 / (ss * ss));
      const i = (y * W + x) * 4;
      const nz = () => (rnd() + rnd() + rnd() - 1.5) * s.rauschen;
      data[i] = srgb(acc[0]) + nz();
      data[i + 1] = srgb(acc[1]) + nz();
      data[i + 2] = srgb(acc[2]) + nz();
      data[i + 3] = 255;
      maske[y * W + x] = objCount * 2 >= ss * ss ? 1 : 0;
    }
  }
  return { width: W, height: Hh, data, maske };
}

// Punkt der Szene ins Bild projizieren
export function projiziere(s, p) {
  const k = s.kamera;
  const d = sub(p, k.pos);
  const z = dot(d, k.fwd);
  return [k.cx + (dot(d, k.right) / z) * k.f, k.cy - (dot(d, k.up) / z) * k.f];
}

// Wahres Profil (Radius/Höhe, oben → unten) mit n Stützstellen
export function wahresProfil(s, n = 200) {
  return Array.from({ length: n }, (_, i) => s.R[Math.round((i / (n - 1)) * 400)] / s.H);
}
