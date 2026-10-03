// Formfamilien gedrehter Gefäße als Bauanleitung für die Formen-Datenbank.
//
// Jede Familie beschreibt, wie sich die Außenkontur einer typischen Form zusammensetzt
// (Standfläche, Fase oder Standring, Bauch, Taille, Schulter, Hals, Lippe) und in welchen
// Grenzen die Proportionen bei gedrehter Gebrauchskeramik üblicherweise liegen.
// Daraus werden viele Einzelstücke mit zufälligen, aber realistischen Maßen erzeugt.
//
// Profil: Radius / Höhe an N Stellen von oben (t = 0, Öffnung) nach unten (t = 1, Boden).

export const N = 48;

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Monotone kubische Interpolation (Fritsch–Carlson): keine Überschwinger,
// Extremstellen bleiben dort, wo sie angegeben sind – wie beim Drehen.
export function pchip(xs, ys) {
  const n = xs.length;
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return x => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = Math.max(0, Math.min(1, (x - xs[i]) / h[i]));
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

const U = (rand, a, b) => a + (b - a) * rand();
const chance = (rand, p) => rand() < p;

// Gemeinsame Details am Fuß und an der Lippe
function fuss(rand, r) {
  // Fase / gerundete Kante an der Standfläche
  const hb = U(rand, 0.015, 0.08);
  const bev = chance(rand, 0.8) ? U(rand, 0.02, 0.14) : 0;
  return { hb, pts: [[0, r * (1 - bev)], [hb, r]] };
}

function lippe(rand, f, rTop) {
  // Wulst- oder Rolllippe: kleine Ausbuchtung ganz oben
  if (!chance(rand, 0.3)) return f;
  const amt = rTop * U(rand, 0.015, 0.04);
  const w = U(rand, 0.015, 0.035);
  return z => f(z) + amt * Math.exp(-(((1 - z) / w) ** 2));
}

// Körper einer Schüssel/Schale: vom Standring nach außen bis zum Rand
function schalenKoerper(rand, { R, rF, hF, form }) {
  const pts = [[0, rF * U(rand, 0.95, 1)], [hF * 0.55, rF], [hF, rF * U(rand, 1.0, 1.06)]];
  const g = form;
  for (const s of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) pts.push([hF + s * (1 - hF), rF + (R - rF) * g(s)]);
  pts.push([1, R * U(rand, 0.97, 1.03)]);
  return pts;
}

export const FAMILIEN = [
  {
    key: 'becher', label: 'Becher', gruppe: 'becher',
    text: 'Gerader oder leicht konischer Becher, Höhe etwa so groß wie der Durchmesser oder etwas größer.',
    gen(rand) {
      const R = U(rand, 0.3, 0.48);
      const taper = U(rand, -0.06, 0.16);
      const belly = U(rand, -0.015, 0.045);
      const rB = R * (1 - taper / 2), rT = R * (1 + taper / 2);
      const f = fuss(rand, rB);
      const flare = chance(rand, 0.4) ? U(rand, 0.01, 0.05) : 0;
      const pts = [...f.pts, [0.5, (rB + rT) / 2 + belly * R], [0.95, rT], [1, rT * (1 + flare)]];
      return { pts, rTop: rT, params: { R, taper, belly } };
    },
  },
  {
    key: 'konisch', label: 'Konischer Becher', gruppe: 'becher',
    text: 'Deutlich konisch: oben weit, unten schmal (oder selten umgekehrt).',
    gen(rand) {
      const R = U(rand, 0.27, 0.45);
      const taper = chance(rand, 0.85) ? U(rand, 0.2, 0.55) : -U(rand, 0.15, 0.35);
      const curve = U(rand, -0.035, 0.035);
      const rB = R * (1 - taper / 2), rT = R * (1 + taper / 2);
      const f = fuss(rand, rB);
      const pts = [...f.pts, [0.35, rB + (rT - rB) * 0.33 + curve * R], [0.7, rB + (rT - rB) * 0.68 + curve * R], [1, rT]];
      return { pts, rTop: rT, params: { R, taper, curve } };
    },
  },
  {
    key: 'bauchig', label: 'Bauchige Tasse', gruppe: 'becher',
    text: 'Weiteste Stelle im unteren Drittel bis zur Mitte, Öffnung enger als der Bauch.',
    gen(rand) {
      const rMax = U(rand, 0.36, 0.58);
      const zMax = U(rand, 0.22, 0.5);
      const rRim = rMax * U(rand, 0.72, 0.95);
      const rBase = rMax * U(rand, 0.6, 0.86);
      const f = fuss(rand, rBase);
      const zS = zMax + (1 - zMax) * U(rand, 0.45, 0.65);
      const pts = [...f.pts, [Math.max(f.hb + 0.03, zMax * 0.5), rBase + (rMax - rBase) * U(rand, 0.6, 0.85)], [zMax, rMax], [zS, rRim + (rMax - rRim) * U(rand, 0.35, 0.65)], [1, rRim]];
      return { pts, rTop: rRim, params: { rMax, zMax, rRim, rBase } };
    },
  },
  {
    key: 'tulpe', label: 'Tulpenbecher', gruppe: 'becher',
    text: 'S-Linie: Bauch unten, Taille, ausgestellte Lippe.',
    gen(rand) {
      const rW = U(rand, 0.24, 0.38);
      const zW = U(rand, 0.38, 0.62);
      const rBelly = rW * U(rand, 1.08, 1.32);
      const zB = U(rand, 0.12, Math.min(0.3, zW - 0.12));
      const rRim = rW * U(rand, 1.12, 1.45);
      const rBase = rBelly * U(rand, 0.68, 0.92);
      const f = fuss(rand, rBase);
      const pts = [...f.pts, [Math.max(zB, f.hb + 0.04), rBelly], [zW, rW], [zW + (1 - zW) * U(rand, 0.5, 0.7), rW + (rRim - rW) * U(rand, 0.3, 0.55)], [1, rRim]];
      return { pts, rTop: rRim, params: { rW, zW, rBelly, zB, rRim } };
    },
  },
  {
    key: 'schuessel', label: 'Schüssel', gruppe: 'schale',
    text: 'Runde Schüssel mit Standring, Höhe etwa ein Drittel bis die Hälfte des Durchmessers.',
    gen(rand) {
      const R = U(rand, 0.9, 1.6);
      const rF = R * U(rand, 0.3, 0.52);
      const hF = U(rand, 0.04, 0.15);
      const k = U(rand, 1.5, 2.8);
      const form = s => (1 - (1 - s) ** k) ** (1 / k);
      return { pts: schalenKoerper(rand, { R, rF, hF, form }), rTop: R, params: { R, rF, hF, k } };
    },
  },
  {
    key: 'schale', label: 'Offene Schale', gruppe: 'schale',
    text: 'Flache, weit geöffnete Schale mit kleinem Fuß, Wand gerade bis leicht gewölbt.',
    gen(rand) {
      const R = U(rand, 1.25, 2.3);
      const rF = R * U(rand, 0.2, 0.38);
      const hF = U(rand, 0.05, 0.16);
      const c = U(rand, -0.15, 0.7);
      const form = s => Math.min(1, s + c * s * (1 - s));
      return { pts: schalenKoerper(rand, { R, rF, hF, form }), rTop: R, params: { R, rF, hF, c } };
    },
  },
  {
    key: 'kugelvase', label: 'Kugelvase / Flasche', gruppe: 'vase',
    text: 'Runder Bauch, deutliche Schulter, enger Hals, oft ausgestellte Lippe.',
    gen(rand) {
      const rMax = U(rand, 0.26, 0.5);
      const zB = U(rand, 0.28, 0.52);
      const rBase = rMax * U(rand, 0.42, 0.76);
      const zN = U(rand, 0.72, 0.9);
      const rN = rMax * U(rand, 0.2, 0.5);
      const rRim = rN * U(rand, 1.0, 1.9);
      const f = fuss(rand, rBase);
      const pts = [...f.pts,
        [Math.max(f.hb + 0.03, zB * 0.45), rBase + (rMax - rBase) * U(rand, 0.65, 0.85)],
        [zB, rMax],
        [zB + (zN - zB) * 0.5, rN + (rMax - rN) * U(rand, 0.55, 0.82)],
        [zN, rN],
        [zN + (1 - zN) * 0.5, rN * U(rand, 1.0, 1.12)],
        [1, rRim]];
      return { pts, rTop: rRim, params: { rMax, zB, rN, zN, rRim } };
    },
  },
  {
    key: 'hohevase', label: 'Hohe Vase', gruppe: 'vase',
    text: 'Schlank, weiteste Stelle an der Schulter, kurzer Hals.',
    gen(rand) {
      const rMax = U(rand, 0.16, 0.32);
      const zS = U(rand, 0.52, 0.84);
      const rBase = rMax * U(rand, 0.55, 0.92);
      const zN = U(rand, Math.max(zS + 0.08, 0.84), 0.96);
      const rN = rMax * U(rand, 0.5, 0.86);
      const rRim = rN * U(rand, 0.95, 1.35);
      const f = fuss(rand, rBase);
      const pts = [...f.pts,
        [Math.max(f.hb + 0.04, zS * 0.5), rBase + (rMax - rBase) * U(rand, 0.45, 0.8)],
        [zS, rMax],
        [zS + (zN - zS) * 0.5, rN + (rMax - rN) * U(rand, 0.5, 0.8)],
        [zN, rN],
        [1, rRim]];
      return { pts, rTop: rRim, params: { rMax, zS, rN, zN, rRim } };
    },
  },
];

// Ein Stück erzeugen: Kontrollpunkte → glatte Kontur → N Stützstellen (oben → unten)
export function erzeuge(fam, rand, n = N) {
  const { pts, rTop, params } = fam.gen(rand);
  pts.sort((a, b) => a[0] - b[0]);
  const xs = [], ys = [];
  for (const [z, r] of pts) {
    if (xs.length && z - xs[xs.length - 1] < 1e-3) continue;
    xs.push(z); ys.push(r);
  }
  const f = lippe(rand, pchip(xs, ys), rTop);
  const profil = [];
  for (let i = 0; i < n; i++) profil.push(Math.max(0.01, f(1 - i / (n - 1))));
  return { profil, params };
}

// Profil mit beliebig vielen Stützstellen neu abtasten
export function resample(arr, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (arr.length - 1);
    const a = Math.floor(p), b = Math.min(arr.length - 1, a + 1);
    out.push(arr[a] + (arr[b] - arr[a]) * (p - a));
  }
  return out;
}
