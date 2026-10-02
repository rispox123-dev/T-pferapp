// Blaupause: Umriss eines Werkstücks aus einem Foto erkennen und als Zeichnung darstellen.
//
// Ablauf der Erkennung:
// 1. Foto verkleinern, Farben am Bildrand als „Hintergrund“ merken.
// 2. Vom Rand aus alles einfärben, was dem Hintergrund ähnelt (Flutfüllung).
// 3. Was übrig bleibt, ist das Werkstück. Da gedrehte Stücke symmetrisch sind,
//    wird je Bildzeile der Abstand zur Mittelachse gemessen (kürzere Seite –
//    so stören Henkel nicht).
// 4. Aus diesem Profil werden markante Stellen gesucht: Rand, Boden,
//    breiteste Stelle (Bauch) und engste Stelle (Hals/Taille).

export const PROFILE_POINTS = 200;
export const DEFAULT_CROP = { x0: 0.03, y0: 0.03, x1: 0.97, y1: 0.97 };
export const DEFAULT_SENS = 50;

const ANALYSIS_SIZE = 640;
const ELLIPSE = 0.2; // Neigung der Ellipsen in der Zeichnung (Blick leicht von oben)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Erkennung
// ---------------------------------------------------------------------------

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto konnte nicht gelesen werden')); };
    img.src = url;
  });
}

export async function loadForAnalysis(blob) {
  const img = await blobToImage(blob);
  const ratio = Math.min(1, ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * ratio));
  const height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  return { img, width, height, data: ctx.getImageData(0, 0, width, height).data };
}

export function analyze(src, { crop = DEFAULT_CROP, sens = DEFAULT_SENS } = {}) {
  const { width: IW, height: IH, data } = src;
  const x0 = clamp(Math.round(crop.x0 * IW), 0, IW - 8);
  const x1 = clamp(Math.round(crop.x1 * IW), x0 + 8, IW);
  const y0 = clamp(Math.round(crop.y0 * IH), 0, IH - 8);
  const y1 = clamp(Math.round(crop.y1 * IH), y0 + 8, IH);
  const w = x1 - x0;
  const h = y1 - y0;
  const n = w * h;

  // Farben in Helligkeit + Farbanteil zerlegen; Helligkeit zählt weniger,
  // damit Schatten eher zum Hintergrund gerechnet werden.
  const Y = new Float32Array(n);
  const U = new Float32Array(n);
  const V = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * IW + x + x0) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const k = y * w + x;
      Y[k] = l * 0.6;
      U[k] = b - l;
      V[k] = r - l;
    }
  }

  // Hintergrundfarben am Rand des Ausschnitts sammeln
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const step = Math.max(1, Math.floor(border.length / 160));
  const samples = [];
  for (let i = 0; i < border.length; i += step) {
    const k = border[i];
    if (!samples.some(s => Math.abs(s[0] - Y[k]) + Math.abs(s[1] - U[k]) + Math.abs(s[2] - V[k]) < 4)) samples.push([Y[k], U[k], V[k]]);
  }

  // Abstand jedes Pixels zur nächsten Randfarbe
  const dist = new Float32Array(n);
  let dMax = 0;
  for (let k = 0; k < n; k++) {
    let best = Infinity;
    for (const s of samples) {
      const d = (Y[k] - s[0]) ** 2 + (U[k] - s[1]) ** 2 + (V[k] - s[2]) ** 2;
      if (d < best) best = d;
    }
    dist[k] = Math.sqrt(best);
    if (dist[k] > dMax) dMax = dist[k];
  }

  // Schwelle automatisch bestimmen (Otsu); der Regler verschiebt sie
  const T = Math.max(4, otsu(dist, dMax) * 2 ** ((50 - sens) / 50));

  // Flutfüllung vom Rand: alles Hintergrundähnliche, das mit dem Rand verbunden ist
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const visit = q => {
    if (!bg[q] && dist[q] < T) { bg[q] = 1; queue[qt++] = q; }
  };
  for (const k of border) visit(k);
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < n - w) visit(p + w);
  }

  // Größte zusammenhängende Fläche = Werkstück
  const comp = new Int32Array(n);
  let bestId = 0, bestArea = 0, id = 0;
  for (let s = 0; s < n; s++) {
    if (bg[s] || comp[s]) continue;
    id++;
    let area = 0;
    qh = qt = 0;
    queue[qt++] = s;
    comp[s] = id;
    while (qh < qt) {
      const p = queue[qh++];
      area++;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
      for (const q of nb) if (q >= 0 && !bg[q] && !comp[q]) { comp[q] = id; queue[qt++] = q; }
    }
    if (area > bestArea) { bestArea = area; bestId = id; }
  }
  if (bestArea < n * 0.02) throw new Error('Kein Werkstück erkannt. Ziehe den Rahmen enger oder erhöhe die Empfindlichkeit.');
  if (bestArea > n * 0.96) throw new Error('Werkstück und Hintergrund lassen sich nicht trennen. Verringere die Empfindlichkeit.');

  // Linker und rechter Rand je Zeile
  const left = new Int32Array(h).fill(-1);
  const right = new Int32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (comp[y * w + x] === bestId) { left[y] = x; break; }
    for (let x = w - 1; x >= 0; x--) if (comp[y * w + x] === bestId) { right[y] = x; break; }
  }
  let top = 0, bottom = h - 1;
  while (left[top] < 0) top++;
  while (left[bottom] < 0) bottom--;

  // Mittelachse: häufigste Zeilenmitte (Zeilen mit Henkel weichen ab und zählen kaum)
  const bins = new Map();
  for (let y = top; y <= bottom; y++) {
    const b = Math.round((left[y] + right[y]) / 4);
    bins.set(b, (bins.get(b) || 0) + 1);
  }
  let modeBin = 0, modeCount = -1;
  for (const [b, c] of bins) {
    const c3 = c + (bins.get(b - 1) || 0) + (bins.get(b + 1) || 0);
    if (c3 > modeCount) { modeCount = c3; modeBin = b; }
  }
  let sum = 0, cnt = 0;
  for (let y = top; y <= bottom; y++) {
    const mid = (left[y] + right[y]) / 2;
    if (Math.abs(mid / 2 - modeBin) <= 1.5) { sum += mid; cnt++; }
  }
  const axis = cnt ? sum / cnt : w / 2;

  // Halbe Breite je Zeile (kürzere Seite), dann glätten
  let hw = [];
  for (let y = top; y <= bottom; y++) hw.push(Math.max(0, Math.min(axis - left[y], right[y] - axis) + 0.5));
  hw = smooth(median(hw, 5), Math.max(1, Math.round(hw.length * 0.008)));

  // Spitzen der perspektivischen Ellipsen oben und unten abschneiden
  const maxCut = Math.round(hw.length * 0.08);
  let cutTop = 0;
  while (cutTop < maxCut && hw[cutTop + 2] - hw[cutTop] > 3) cutTop++;
  let cutBot = 0;
  while (cutBot < maxCut && hw[hw.length - 3 - cutBot] - hw[hw.length - 1 - cutBot] > 3) cutBot++;
  hw = hw.slice(cutTop, hw.length - cutBot);
  top += cutTop;
  bottom -= cutBot;

  // Von leicht oben fotografiert liegt die breiteste Stelle der Randellipse etwas
  // unter der Oberkante (unten entsprechend). Die Zeichnung setzt die Ellipsen-
  // mitte an die Kante, also wird bis dorthin abgeschnitten.
  const ellTop = ellipseCut(hw);
  const ellBot = ellipseCut([...hw].reverse());
  if (ellTop + ellBot < hw.length * 0.5) {
    hw = hw.slice(ellTop, hw.length - ellBot);
    top += ellTop;
    bottom -= ellBot;
  }

  const hgt = hw.length;
  if (hgt < 20) throw new Error('Das erkannte Stück ist zu klein. Ziehe den Rahmen enger.');

  const profile = [];
  for (let i = 0; i < PROFILE_POINTS; i++) {
    const pos = (i / (PROFILE_POINTS - 1)) * (hgt - 1);
    const a = Math.floor(pos);
    const b = Math.min(hgt - 1, a + 1);
    const v = hw[a] + (hw[b] - hw[a]) * (pos - a);
    profile.push(Math.round((v / hgt) * 10000) / 10000);
  }

  // Umriss in relativen Bildkoordinaten (für die Anzeige über dem Foto)
  const toRel = (x, y) => [(x + x0) / IW, (y + y0) / IH];
  const outlineL = [], outlineR = [];
  for (let i = 0; i < PROFILE_POINTS; i += 2) {
    const y = top + (i / (PROFILE_POINTS - 1)) * (hgt - 1);
    const r = profile[i] * hgt;
    outlineL.push(toRel(axis - r, y));
    outlineR.push(toRel(axis + r, y));
  }

  return {
    profile,
    outline: { left: outlineL, right: outlineR, axis: (axis + x0) / IW, top: (top + y0) / IH, bottom: (bottom + y0) / IH },
  };
}

// Wie viele Zeilen vom Anfang gehören zur Ellipsen-Rundung? (wächst schnell, dann langsamer)
function ellipseCut(arr) {
  const lim = Math.round(arr.length * 0.12);
  let j = 0;
  for (let i = 1; i <= lim; i++) if (arr[i] > arr[j]) j = i;
  if (j < 2 || arr[j] < arr[0] * 1.01 || j > 0.35 * arr[j]) return 0;
  const h = Math.floor(j / 2);
  const s1 = (arr[h] - arr[0]) / h;
  const s2 = (arr[j] - arr[h]) / (j - h);
  return s1 >= s2 ? j : 0;
}

function otsu(values, max) {
  const bins = 128;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v / (max || 1)) * bins))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, bestI = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB || wB === total) continue;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / (total - wB);
    const between = wB * (total - wB) * (mB - mF) ** 2;
    if (between > best) { best = between; bestI = i; }
  }
  return ((bestI + 1) / bins) * max;
}

function median(arr, win) {
  const half = Math.floor(win / 2);
  return arr.map((_, i) => {
    const s = arr.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
}

function smooth(arr, half) {
  return arr.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) { s += arr[j]; c++; }
    return s / c;
  });
}

// ---------------------------------------------------------------------------
// Markante Stellen
// ---------------------------------------------------------------------------

export function findPoints(profile) {
  const n = profile.length;
  const rmax = Math.max(...profile);
  const minProm = 0.04 * rmax;
  const lo = Math.round(n * 0.08);
  const hi = Math.round(n * 0.92);
  const win = 3;
  const maxes = [];
  const mins = [];

  for (let i = lo; i <= hi; i++) {
    const v = profile[i];
    let isMax = true, isMin = true;
    for (let j = i - win; j <= i + win; j++) {
      if (j === i || j < 0 || j >= n) continue;
      if (profile[j] > v) isMax = false;
      if (profile[j] < v) isMin = false;
    }
    const before = profile.slice(0, i + 1);
    const after = profile.slice(i);
    if (isMax) {
      const prom = v - Math.max(Math.min(...before), Math.min(...after));
      if (prom > minProm) maxes.push({ i, prom });
    }
    if (isMin) {
      const prom = Math.min(Math.max(...before), Math.max(...after)) - v;
      if (prom > minProm) mins.push({ i, prom });
    }
  }

  // Höchstens zwei Stellen je Art; zwei Bäuche brauchen eine echte Einschnürung dazwischen
  const pick = (list, isMax, max) => {
    const out = [];
    for (const c of list.sort((a, b) => b.prom - a.prom)) {
      if (out.length >= max) break;
      const ok = out.every(o => {
        const between = profile.slice(Math.min(o.i, c.i), Math.max(o.i, c.i) + 1);
        return isMax
          ? Math.min(...between) < Math.min(profile[o.i], profile[c.i]) - minProm
          : Math.max(...between) > Math.max(profile[o.i], profile[c.i]) + minProm;
      });
      if (ok) out.push(c);
    }
    return out;
  };
  const t = i => Math.round((i / (n - 1)) * 1000) / 1000;
  const m = i => Math.round(2 * profile[i] * 10000) / 10000;

  const points = [
    { key: 'hoehe', label: 'Höhe', t: null, m: 1 },
    { key: 'rand', label: 'Ø Öffnung', t: 0, m: m(0) },
  ];
  const bulges = pick(maxes, true, 2);
  bulges.forEach((c, idx) => {
    if (idx === 0) points.push({ key: 'bauch', label: 'Ø Bauch', t: t(c.i), m: m(c.i) });
    else points.push({ key: 'bauch2', label: c.i < bulges[0].i ? 'Ø Schulter' : 'Ø Wölbung', t: t(c.i), m: m(c.i) });
  });
  // Engstellen: zwischen zwei Wölbungen ist es eine Rille, sonst Hals bzw. Taille
  let rillen = 0, engen = 0;
  pick(mins, false, 3).sort((a, b) => a.i - b.i).forEach(c => {
    const zwischen = bulges.some(b => b.i < c.i) && bulges.some(b => b.i > c.i);
    if (zwischen) {
      rillen++;
      points.push({ key: `rille${rillen}`, label: 'Ø Rille', t: t(c.i), m: m(c.i) });
    } else {
      engen++;
      if (engen === 1) points.push({ key: 'hals', label: c.i < n / 2 ? 'Ø Hals' : 'Ø Taille', t: t(c.i), m: m(c.i) });
      else points.push({ key: 'hals2', label: 'Ø Einschnürung', t: t(c.i), m: m(c.i) });
    }
  });

  // Absatz: kurzer, steiler Sprung im Profil (z. B. Übergang von Schale zu Fußring)
  const k = Math.max(2, Math.round(n * 0.025));
  let step = null;
  for (let i = Math.round(n * 0.1); i < n - k; i++) {
    const drop = Math.abs(profile[i - k] - profile[i + k]);
    if (drop > 0.12 * rmax && (!step || drop > step.drop)) step = { i, drop };
  }
  if (step && !points.some(p => p.t != null && Math.abs(p.t - t(step.i)) < 0.08) && t(step.i) < 0.95) {
    const wide = Math.max(profile[step.i - k], profile[step.i + k]);
    points.push({ key: 'absatz', label: step.i > n * 0.6 ? 'Ø Fußansatz' : 'Ø Absatz', t: t(step.i), m: Math.round(2 * wide * 10000) / 10000 });
  }

  points.push({ key: 'fuss', label: 'Ø Boden', t: 1, m: m(n - 1) });
  return points;
}

// Automatisch gefundene Stellen (ohne ausgeblendete) plus eigene Stellen, mit eigenen Namen
export function effectivePoints(bp) {
  const hidden = bp.hidden || [];
  const labels = bp.labels || {};
  const rAt = profileAt(bp.profile);
  const pts = bp.points.filter(p => !hidden.includes(p.key)).map(p => ({ ...p, label: labels[p.key] || p.label }));
  for (const c of bp.custom || []) {
    pts.push({ key: c.key, label: labels[c.key] || 'Ø Stelle', t: c.t, m: Math.round(2 * rAt(c.t) * 10000) / 10000, custom: true });
  }
  return pts;
}

export function profileAt(prof) {
  const n = prof.length;
  return t => {
    const p = Math.max(0, Math.min(1, t)) * (n - 1);
    const a = Math.floor(p);
    const b = Math.min(n - 1, a + 1);
    return prof[a] + (prof[b] - prof[a]) * (p - a);
  };
}

// ---------------------------------------------------------------------------
// Schätzung: aus einem eingetragenen Maß alle anderen ableiten
// ---------------------------------------------------------------------------

export function estimate(bp, values = {}, pos = {}) {
  const scales = [];
  const pts = effectivePoints(bp);
  for (const p of pts) {
    const v = Number(values[p.key]);
    if (values[p.key] != null && v > 0 && p.m > 0) scales.push(v / p.m);
  }
  for (const p of pts) {
    const v = Number(pos[p.key]);
    if (pos[p.key] != null && v > 0 && p.t != null && p.t < 1) scales.push(v / (1 - p.t));
  }
  scales.sort((a, b) => a - b);
  const scale = scales.length ? scales[Math.floor(scales.length / 2)] : null;
  return {
    scale,
    value: p => (scale ? p.m * scale : null),
    pos: p => (scale && p.t != null ? (1 - p.t) * scale : null),
  };
}

// ---------------------------------------------------------------------------
// Zeichnung
// ---------------------------------------------------------------------------

const INK = '#22302c';
const INK_SOFT = '#4b5d57';
const CLAY = '#9a4a24';
const LINE = '#ffffff';
const GLAZE = '#b8cdc5';

let svgCounter = 0;

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str = '') {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Craquelé-Netz wie bei einer Seladonglasur
function crackle(W, H, seed) {
  const rand = rng(seed);
  const g = 44;
  const cols = Math.ceil(W / g) + 2;
  const rows = Math.ceil(H / g) + 2;
  const P = [];
  for (let i = 0; i < cols; i++) {
    P.push([]);
    for (let j = 0; j < rows; j++) P[i].push([(i - 0.5) * g + (rand() - 0.5) * g * 0.8, (j - 0.5) * g + (rand() - 0.5) * g * 0.8]);
  }
  const seg = (a, b) => {
    const mx = (a[0] + b[0]) / 2 + (rand() - 0.5) * 10;
    const my = (a[1] + b[1]) / 2 + (rand() - 0.5) * 10;
    return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };
  let d = '';
  let fine = '';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (i + 1 < cols) d += seg(P[i][j], P[i + 1][j]);
      if (j + 1 < rows) d += seg(P[i][j], P[i][j + 1]);
      if (i + 1 < cols && j + 1 < rows) {
        const r = rand();
        if (r < 0.3) fine += seg(P[i][j], P[i + 1][j + 1]);
        else if (r < 0.55) fine += seg(P[i + 1][j], P[i][j + 1]);
      }
    }
  }
  return { d, fine };
}

const fmtCm = v => `${Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 })} cm`;
const escXml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * bp: { profile, points }
 * values/pos: eingetragene Maße je Stelle (cm)
 */
export function renderBlueprint(bp, { values = {}, pos = {}, title = '', info = [], interactive = true, seed = 1 } = {}) {
  const uid = `bp${++svgCounter}`;
  const prof = bp.profile;
  const n = prof.length;
  const rmax = Math.max(...prof, 0.02);
  const W = 400;
  const Hd = Math.min(340, 92 / rmax);
  const half = rmax * Hd;
  const titleLines = wrap(title, 22).slice(0, 2);
  const titleH = titleLines.length ? 30 + titleLines.length * 26 : 24;
  const top = titleH + prof[0] * Hd * ELLIPSE + 22;
  const bottom = top + Hd;
  const axis = 64 + half;
  const labelX = Math.min(axis + half + 34, W - 118);
  const est = estimate(bp, values, pos);

  const rAt = profileAt(prof);
  const points = effectivePoints(bp);
  const yOf = t => top + t * Hd;

  // Kontur
  const contour = sign => prof.map((r, i) => `${i ? 'L' : 'M'}${(axis + sign * r * Hd).toFixed(1)} ${yOf(i / (n - 1)).toFixed(1)}`).join('');
  const arc = (t, front) => {
    const rx = rAt(t) * Hd;
    const ry = rx * ELLIPSE;
    const y = yOf(t);
    return `M${(axis - rx).toFixed(1)} ${y.toFixed(1)}A${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 ${front ? 0 : 1} ${(axis + rx).toFixed(1)} ${y.toFixed(1)}`;
  };

  const interior = points.filter(p => p.t != null && p.t > 0 && p.t < 1);
  let shape = `<path d="${contour(-1)}"/><path d="${contour(1)}"/>`;
  shape += `<ellipse cx="${axis}" cy="${top}" rx="${(prof[0] * Hd).toFixed(1)}" ry="${(prof[0] * Hd * ELLIPSE).toFixed(1)}"/>`;
  shape += `<path d="${arc(1, true)}"/><path d="${arc(1, false)}" class="dash"/>`;
  for (const p of interior) shape += `<path d="${arc(p.t, true)}" class="thin"/><path d="${arc(p.t, false)}" class="dash"/>`;

  // Beschriftungen rechts, ohne Überlappung
  const items = points.filter(p => p.t != null).map(p => ({ p, yA: yOf(p.t), xA: axis + rAt(p.t) * Hd })).sort((a, b) => a.yA - b.yA);
  let prevY = -Infinity;
  for (const it of items) {
    it.yL = Math.max(it.yA, prevY + 46);
    prevY = it.yL;
  }

  const valueText = p => {
    if (values[p.key] != null && values[p.key] !== '') return { text: fmtCm(values[p.key]), cls: 'val' };
    const e = est.value(p);
    if (e) return { text: `≈ ${fmtCm(e)}`, cls: 'val est' };
    return { text: interactive ? '+ eintragen' : '–', cls: 'val empty' };
  };
  const posText = p => {
    if (!(p.t > 0 && p.t < 1)) return '';
    if (pos[p.key] != null && pos[p.key] !== '') return `auf ${fmtCm(pos[p.key])} Höhe`;
    const e = est.pos(p);
    return e ? `auf ≈ ${fmtCm(e)} Höhe` : `bei ${Math.round((1 - p.t) * 100)} % der Höhe`;
  };

  const btn = key => (interactive ? ` data-bp-key="${key}" role="button" tabindex="0"` : '');
  let labels = '';
  for (const { p, yA, xA, yL } of items) {
    const v = valueText(p);
    const ps = posText(p);
    labels += `<path d="M${(xA + 4).toFixed(1)} ${yA.toFixed(1)}L${labelX - 22} ${yA.toFixed(1)}L${labelX - 8} ${yL.toFixed(1)}" class="lead"/>`;
    labels += `<circle cx="${xA.toFixed(1)}" cy="${yA.toFixed(1)}" r="3" class="dot"/>`;
    labels += `<g class="lbl"${btn(p.key)}><rect x="${labelX - 8}" y="${(yL - 19).toFixed(1)}" width="${W - labelX + 6}" height="44" rx="8" class="hit"/>
      <text x="${labelX}" y="${(yL - 4).toFixed(1)}" class="name">${escXml(p.label)}</text>
      <text x="${labelX}" y="${(yL + 12).toFixed(1)}" class="${v.cls}">${escXml(v.text)}</text>
      ${ps ? `<text x="${labelX}" y="${(yL + 24).toFixed(1)}" class="pos">${escXml(ps)}</text>` : ''}</g>`;
  }

  // Höhenmaß links
  const hp = points.find(p => p.key === 'hoehe');
  const hx = axis - half - 30;
  let height = '';
  if (hp) {
    const v = valueText(hp);
    const mid = (top + bottom) / 2;
    height += `<path d="M${hx} ${top}V${bottom}M${hx - 6} ${top}h12M${hx - 6} ${bottom}h12M${hx - 4} ${top + 7}l4 -7l4 7M${hx - 4} ${bottom - 7}l4 7l4 -7" class="dim"/>`;
    for (const p of interior) {
      const y = yOf(p.t);
      height += `<path d="M${hx - 4} ${y.toFixed(1)}h8" class="dim"/><path d="M${hx + 6} ${y.toFixed(1)}L${(axis - rAt(p.t) * Hd - 6).toFixed(1)} ${y.toFixed(1)}" class="guide"/>`;
    }
    height += `<g class="lbl"${btn('hoehe')}><rect x="${hx - 34}" y="${mid - 80}" width="30" height="160" rx="8" class="hit"/>
      <text transform="translate(${hx - 12} ${mid}) rotate(-90)" text-anchor="middle" class="${v.cls}">Höhe ${escXml(v.text)}</text></g>`;
  }

  const lastLabel = items.length ? items[items.length - 1].yL + 34 : 0;
  const infoTop = Math.max(bottom + rAt(1) * Hd * ELLIPSE + 40, lastLabel + 16);
  const infoSvg = info.map((line, i) => `<text x="22" y="${infoTop + i * 21}" class="info${i ? '' : ' strong'}">${escXml(line)}</text>`).join('');
  const H = Math.ceil(infoTop + Math.max(0, info.length - 1) * 21 + 26);

  const cr = crackle(W, H, seed);
  const titleSvg = titleLines.map((l, i) => `<text x="${W - 20}" y="${40 + i * 26}" text-anchor="end" class="title">${escXml(l)}</text>`).join('');

  return `<svg class="blueprint" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Blaupause ${escXml(title)}">
  <style>
    #${uid} text { font-family: "Avenir Next", Futura, "Century Gothic", -apple-system, "Segoe UI", sans-serif; fill: ${INK}; }
    #${uid} .shape path, #${uid} .shape ellipse { fill: none; stroke: ${LINE}; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    #${uid} .shape .thin { stroke-width: 1.6; opacity: .8; }
    #${uid} .shape .dash { stroke-dasharray: 7 6; stroke-width: 2.2; }
    #${uid} .lead { fill: none; stroke: ${INK}; stroke-width: 1; opacity: .5; }
    #${uid} .dot { fill: ${INK}; }
    #${uid} .dim { fill: none; stroke: ${INK}; stroke-width: 1.2; opacity: .7; stroke-linecap: round; stroke-linejoin: round; }
    #${uid} .guide { fill: none; stroke: ${INK}; stroke-width: 1; stroke-dasharray: 1.5 4; opacity: .45; }
    #${uid} .hit { fill: transparent; }
    #${uid} [data-bp-key], #${uid} [data-bp-add] { cursor: pointer; }
    #${uid} [data-bp-key]:hover .hit, #${uid} [data-bp-key]:focus .hit { fill: rgba(255,255,255,.28); }
    #${uid} [data-bp-key]:focus { outline: none; }
    #${uid} .title { font-size: 23px; font-weight: 500; letter-spacing: .2px; }
    #${uid} .name { font-size: 12px; fill: ${INK_SOFT}; letter-spacing: .3px; }
    #${uid} .val { font-size: 16px; font-weight: 600; }
    #${uid} .val.est { font-weight: 500; font-style: italic; fill: ${INK_SOFT}; }
    #${uid} .val.empty { font-size: 14px; fill: ${CLAY}; }
    #${uid} .pos { font-size: 11px; fill: ${INK_SOFT}; }
    #${uid} .info { font-size: 14px; }
    #${uid} .info.strong { font-size: 15px; font-weight: 600; }
  </style>
  <defs>
    <filter id="${uid}-m" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="${seed % 97}"/>
      <feColorMatrix values="0 0 0 0 0.33  0 0 0 0 0.47  0 0 0 0 0.43  1.3 0 0 0 -0.55"/>
    </filter>
  </defs>
  <clipPath id="${uid}-c"><rect width="${W}" height="${H}"/></clipPath>
  <g id="${uid}" clip-path="url(#${uid}-c)">
    <rect width="${W}" height="${H}" fill="${GLAZE}"/>
    <rect width="${W}" height="${H}" filter="url(#${uid}-m)" opacity=".45"/>
    <path d="${cr.d}" fill="none" stroke="#8ea89f" stroke-width=".9" opacity=".6"/>
    <path d="${cr.fine}" fill="none" stroke="#8ea89f" stroke-width=".6" opacity=".45"/>
    ${titleSvg}
    <g class="shape">${shape}</g>
    ${interactive ? `<rect x="${(axis - half - 8).toFixed(1)}" y="${(top - 6).toFixed(1)}" width="${(2 * half + 16).toFixed(1)}" height="${(Hd + 12).toFixed(1)}" class="hit add" data-bp-add data-top="${top.toFixed(2)}" data-hd="${Hd.toFixed(2)}"/>` : ''}
    ${height}
    ${labels}
    ${infoSvg}
  </g>
</svg>`;
}

function wrap(text, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}
