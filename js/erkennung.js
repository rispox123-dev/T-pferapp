// Formerkennung: das keramische Stück im Foto finden und seine Kontur messen.
//
// Ablauf
// 1. Farben in Lab umrechnen. Hintergrund (Bildrand, außerhalb der Aufnahme-Maske) und
//    Stück (Mitte) bekommen je ein Farbmodell. Die Modelle sind schattentolerant: Ein Farbton,
//    der nur dunkler ist (Schlagschatten, abgewandte Seite), zählt als dieselbe Farbe.
// 2. Kanten aus Helligkeit und Farbton.
// 3. Für die linke und rechte Hälfte wird je Bildzeile die Außenkante gesucht – als
//    zusammenhängender Weg von oben nach unten (dynamische Programmierung): Farbe innen
//    wie Stück, außen wie Hintergrund, möglichst auf einer Kante, ohne Sprünge.
// 4. Mittellinie aus beiden Seiten. Die Seite mit der klareren Kante ist die Leitseite;
//    wo die andere Seite abweicht (Schatten, Henkel), gilt die Leitseite gespiegelt.
// 5. Öffnung und Boden erscheinen als (flache) Ellipsen; ihre Mitte ist die wahre
//    Rand- bzw. Bodenhöhe. Bei Fotos von schräg oben wird die Perspektive herausgerechnet.
// 6. Die gemessene Kontur wird mit dem Formwissen (formprior.js) abgeglichen: unsichere
//    oder auffällig abweichende Stellen werden aus der passenden Formfamilie ergänzt.
//    Mit dieser Erwartung als Führung wird die Kontur ein zweites Mal gesucht; die
//    Farbmodelle lernen dabei aus dem ersten Ergebnis nach.
// 7. Henkel: was außerhalb des Körpers seitlich am Stück hängt.

import { formAnpassen, MODELL_N } from './formprior.js';

export const PROFILE_POINTS = 200;
export const DEFAULT_CROP = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 };
export const DEFAULT_SENS = 50;

const ANALYSIS_SIZE = 480;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Foto laden
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

// Rahmen für die Erkennung aus der Aufnahme-Maske (etwas Luft rundherum)
export function cropFromGuide(guide) {
  if (!guide) return { ...DEFAULT_CROP };
  // großzügig: Das Stück steht selten genau im Umriss
  const gw = guide.x1 - guide.x0, gh = guide.y1 - guide.y0;
  return { x0: clamp(guide.x0 - gw * 0.25, 0, 1), y0: clamp(guide.y0 - gh * 0.3, 0, 1), x1: clamp(guide.x1 + gw * 0.25, 0, 1), y1: clamp(guide.y1 + gh * 0.35, 0, 1) };
}

// ---------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const fLab = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function labBild(data, IW, x0, y0, w, h) {
  const n = w * h;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * IW + x + x0) * 4;
      const r = LIN[data[i]], g = LIN[data[i + 1]], b = LIN[data[i + 2]];
      const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
      const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
      const k = y * w + x;
      L[k] = 116 * fy - 16;
      A[k] = 500 * (fx - fy);
      B[k] = 200 * (fy - fz);
    }
  }
  return { L: weich(L, w, h), A: weich(A, w, h), B: weich(B, w, h) };
}

// Binomialfilter 5×5 (glättet Rauschen, Sprenkel und feines Craquelé)
function weich(src, w, h) {
  const k = [1, 4, 6, 4, 1];
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, ws = 0;
    for (let j = -2; j <= 2; j++) { const xx = x + j; if (xx >= 0 && xx < w) { s += src[y * w + xx] * k[j + 2]; ws += k[j + 2]; } }
    t[y * w + x] = s / ws;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, ws = 0;
    for (let j = -2; j <= 2; j++) { const yy = y + j; if (yy >= 0 && yy < h) { s += t[yy * w + x] * k[j + 2]; ws += k[j + 2]; } }
    o[y * w + x] = s / ws;
  }
  return o;
}

// k-Means auf Lab-Proben → Farbmodell (Zentren, Streuung, Anteil)
function farbmodell(lab, idx, k) {
  const { L, A, B } = lab;
  const step = Math.max(1, Math.floor(idx.length / 3000));
  const P = [];
  for (let i = 0; i < idx.length; i += step) P.push([L[idx[i]] + 16, A[idx[i]], B[idx[i]]]);
  if (!P.length) return [];
  k = Math.min(k, P.length);
  // Startwerte: k-means++ light (gleichmäßig nach Helligkeit verteilt)
  const sorted = [...P].sort((a, b) => a[0] - b[0]);
  let C = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].slice());
  const assign = new Int32Array(P.length);
  for (let it = 0; it < 10; it++) {
    for (let p = 0; p < P.length; p++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (P[p][0] - C[c][0]) ** 2 + 2 * ((P[p][1] - C[c][1]) ** 2 + (P[p][2] - C[c][2]) ** 2);
        if (d < bd) { bd = d; best = c; }
      }
      assign[p] = best;
    }
    const S = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let p = 0; p < P.length; p++) { const s = S[assign[p]]; s[0] += P[p][0]; s[1] += P[p][1]; s[2] += P[p][2]; s[3]++; }
    C = C.map((c, i) => (S[i][3] ? [S[i][0] / S[i][3], S[i][1] / S[i][3], S[i][2] / S[i][3]] : c));
  }
  const out = C.map(c => ({ m: c, n2: c[0] ** 2 + c[1] ** 2 + c[2] ** 2, sL: 0, sAB: 0, cnt: 0 }));
  for (let p = 0; p < P.length; p++) {
    const o = out[assign[p]];
    o.sL += (P[p][0] - o.m[0]) ** 2;
    o.sAB += (P[p][1] - o.m[1]) ** 2 + (P[p][2] - o.m[2]) ** 2;
    o.cnt++;
  }
  return out.filter(o => o.cnt > 0).map(o => ({
    m: o.m, n2: o.n2,
    iL: 1 / (30 + o.sL / o.cnt),
    iAB: 1 / (12 + o.sAB / (2 * o.cnt)),
    lw: 2 * Math.log(o.cnt / P.length),
  }));
}

// Abstand eines Pixels zum Farbmodell. Helligkeit darf um den Faktor cLo … cHi abweichen
// (Schatten/Glanz), kostet aber etwas; Farbton-Abweichungen kosten voll.
function kosten(model, Lp, a, b, cLo, cHi) {
  let best = Infinity;
  for (const g of model) {
    const c = clamp((Lp * g.m[0] + a * g.m[1] + b * g.m[2]) / g.n2, cLo, cHi);
    const r0 = Lp - c * g.m[0], r1 = a - c * g.m[1], r2 = b - c * g.m[2];
    const lc = Math.log(c);
    const d = r0 * r0 * g.iL + (r1 * r1 + r2 * r2) * g.iAB + lc * lc * 8 - g.lw;
    if (d < best) best = d;
  }
  return best;
}

// Wahrscheinlichkeit „Stück“ (−1 … +1) je Pixel
function stueckKarte(lab, fg, bg, w, h, bias) {
  const n = w * h;
  const q = new Float32Array(n);
  const { L, A, B } = lab;
  for (let k = 0; k < n; k++) {
    const Lp = L[k] + 16;
    const cb = kosten(bg, Lp, A[k], B[k], 0.42, 1.08);
    const cf = kosten(fg, Lp, A[k], B[k], 0.5, 1.35);
    // passt zu keinem Modell (z. B. Glanzlicht): unsicher statt Hintergrund
    q[k] = Math.tanh((cb - cf + bias) / 6) * (cb > 10 && cf > 10 ? 0.3 : 1);
  }
  return q;
}

function kanten(lab, w, h) {
  const { L, A, B } = lab;
  const n = w * h;
  const E = new Float32Array(n);
  const vals = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    let m = 0;
    for (const [ch, wt] of [[L, 1], [A, 2], [B, 2]]) {
      const gx = ch[k - w + 1] + 2 * ch[k + 1] + ch[k + w + 1] - ch[k - w - 1] - 2 * ch[k - 1] - ch[k + w - 1];
      const gy = ch[k + w - 1] + 2 * ch[k + w] + ch[k + w + 1] - ch[k - w - 1] - 2 * ch[k - w] - ch[k - w + 1];
      m += wt * (gx * gx + gy * gy);
    }
    E[k] = Math.sqrt(m);
    if ((x + y) % 3 === 0) vals.push(E[k]);
  }
  vals.sort((a, b) => a - b);
  const scale = Math.max(6, vals[Math.floor(vals.length * 0.97)] || 1);
  for (let k = 0; k < n; k++) E[k] = Math.min(1.5, E[k] / scale);
  return E;
}

// ---------------------------------------------------------------------------
// Kontur einer Seite: bester zusammenhängender Weg von oben nach unten
// ---------------------------------------------------------------------------

const ALPHA = 5; // Gewicht einer Kante gegenüber der Farbfläche
const RHO = 0.5; // Gewicht der Farbfläche
const C_ON = 10, C_OFF = 10;

function konturSeite(ctx, side, erwartung) {
  const { w, h, q, E, achse } = ctx;
  let Umax = 0;
  const ax = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    ax[y] = Math.round(achse(y));
    Umax = Math.max(Umax, side > 0 ? w - 1 - ax[y] : ax[y]);
  }
  const U = Umax + 1;
  const J = Math.max(4, Math.min(70, Math.round(U * 0.3)));
  const NEG = -1e9;
  let prev = new Float32Array(U).fill(NEG);
  let cur = new Float32Array(U);
  const from = new Int16Array(h * U);
  const postFrom = new Int16Array(h).fill(-2);
  let post = NEG;
  const pre = new Float32Array(U), raw = new Float32Array(U);
  const pen = new Float32Array(J + 1);
  for (let d = 0; d <= J; d++) pen[d] = d <= 2 ? 0.6 * d * d : 2.4 + 1.1 * (d - 2);

  for (let y = 0; y < h; y++) {
    const lim = side > 0 ? w - 1 - ax[y] : ax[y];
    // Fläche: aufsummiert von der Achse nach außen
    let s = 0, sr = 0;
    for (let u = 0; u < U; u++) {
      if (u <= lim) {
        const v = q[y * w + ax[y] + side * u];
        // klar Stück zählt voll, klar Hintergrund kostet; „unsicher“ (um 0) ist neutral
        s += RHO * (v > 0 ? v : v > -0.25 ? 0 : 0.35 * (v + 0.25));
        sr += v;
      }
      pre[u] = s;
      raw[u] = sr;
    }
    // Ende: aus einem Objektzustand der Vorzeile in „danach leer“ wechseln
    let bestPrev = NEG, bestPrevU = -1;
    for (let u = 0; u < U; u++) if (prev[u] > bestPrev) { bestPrev = prev[u]; bestPrevU = u; }
    if (bestPrev - C_OFF > post) { post = bestPrev - C_OFF; postFrom[y] = bestPrevU; } else postFrom[y] = -1;

    const ew = erwartung?.u[y];
    for (let u = 0; u < U; u++) {
      if (u < 2 || u > lim) { cur[u] = NEG; continue; }
      // Kante zählt nur, wenn innen eher Stück und außen eher Hintergrund ist
      const qi = (raw[u - 1] - raw[Math.max(0, u - 5)]) / Math.max(1, Math.min(4, u - 1));
      const qo = (raw[Math.min(lim, u + 4)] - raw[Math.min(lim, u)]) / Math.max(1, Math.min(4, lim - u));
      const g = clamp(0.5 + 0.5 * (qi - qo), 0, 1) * clamp(1 + qi, 0, 1);
      let obj = pre[u] + ALPHA * g * E[y * w + ax[y] + side * u] - 0.6;
      if (erwartung) {
        if (ew >= 0) { const z = (u - ew) / erwartung.s[y]; obj -= erwartung.kraft * Math.log(1 + z * z); } else obj -= erwartung.kraft * 2.5;
      }
      // Vorgänger: Eintritt aus „davor leer“ oder Fortsetzung
      let best = -C_ON, arg = -1;
      const lo = Math.max(2, u - J), hi = Math.min(U - 1, u + J);
      for (let v = lo; v <= hi; v++) {
        const c = prev[v] - pen[Math.abs(v - u)];
        if (c > best) { best = c; arg = v; }
      }
      cur[u] = obj + best;
      from[y * U + u] = arg;
    }
    [prev, cur] = [cur, prev];
  }
  // Rückverfolgung
  const out = new Int32Array(h).fill(-1);
  let bestEnd = NEG, uEnd = -1;
  for (let u = 0; u < U; u++) if (prev[u] > bestEnd) { bestEnd = prev[u]; uEnd = u; }
  let y = h - 1;
  let u;
  if (post >= bestEnd) {
    // im Zustand „danach leer“ geendet: Zeile suchen, in der gewechselt wurde
    while (y >= 0 && postFrom[y] < 0) y--;
    if (y < 0) return out;
    u = postFrom[y];
    y--;
  } else u = uEnd;
  while (y >= 0 && u >= 0) {
    out[y] = u;
    u = from[y * U + u];
    y--;
  }
  return out;
}

// Wie sicher ist die gefundene Kante je Zeile? (0 … 1)
function sicherheit(ctx, side, us) {
  const { w, h, q, E, achse } = ctx;
  const c = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const u = us[y];
    if (u < 0) continue;
    const ax = Math.round(achse(y));
    const px = d => { const x = ax + side * d; return x >= 0 && x < w ? q[y * w + x] : -1; };
    let inn = 0, aus = 0;
    for (let d = 2; d <= 6; d++) { inn += px(u - d); aus += px(u + d); }
    const kontrast = clamp((inn - aus) / 10, 0, 1);
    let e = 0;
    for (let d = -1; d <= 1; d++) { const x = ax + side * (u + d); if (x >= 0 && x < w) e = Math.max(e, E[y * w + x]); }
    c[y] = clamp(0.55 * kontrast + 0.45 * Math.min(1, e / 0.7), 0, 1);
  }
  // leicht glätten
  const o = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    if (us[y] < 0) continue;
    let s = 0, n = 0;
    for (let j = -3; j <= 3; j++) if (y + j >= 0 && y + j < h && us[y + j] >= 0) { s += c[y + j]; n++; }
    o[y] = s / n;
  }
  return o;
}

// Robuste Gerade x = a + b·(y − y0) durch die Mittelpunkte
function achseAnpassen(rows, fallback) {
  if (rows.length < 10) return fallback;
  const y0 = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  let a = fallback(y0), b = 0;
  {
    const srt = [...rows].sort((p, q) => p.x - q.x);
    const tot = srt.reduce((s, r) => s + r.w, 0);
    let acc = 0;
    for (const r of srt) { acc += r.w; if (acc >= tot / 2) { a = r.x; break; } }
  }
  for (let it = 0; it < 8; it++) {
    const res = rows.map(r => r.x - a - b * (r.y - y0));
    const sc = Math.max(0.7, 1.5 * median(res.map(Math.abs)));
    let sw = 0, sx = 0, sy = 0, sxy = 0, syy = 0;
    rows.forEach((r, i) => {
      const z = res[i] / (4 * sc);
      const wt = r.w * (Math.abs(z) < 1 ? (1 - z * z) ** 2 : 0);
      const dy = r.y - y0;
      sw += wt; sx += wt * r.x; sy += wt * dy; sxy += wt * r.x * dy; syy += wt * dy * dy;
    });
    if (sw < 1e-6) break;
    const det = sw * syy - sy * sy;
    b = det > 1e-6 ? clamp((sw * sxy - sy * sx) / det, -0.06, 0.06) : 0;
    a = (sx - b * sy) / sw;
  }
  return y => a + b * (y - y0);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = Float64Array.from(arr).sort();
  return s[s.length >> 1];
}

// Wie gut passt ein Ellipsenbogen der Tiefe ry an den oberen Rand der Silhouette? Die Zeilen
// darüber sollen dem Bogen folgen, die darunter einer ruhig weiterlaufenden Wand (keine Knicke).
function kappeKosten(hw, ry) {
  const K = 8;
  ry = Math.round(ry);
  if (ry < 0 || ry + K >= hw.length) return Infinity;
  const rx = hw[ry];
  if (!(rx > 0)) return Infinity;
  let cost = 0;
  for (let k = 0; k < ry; k++) {
    const pred = rx * Math.sqrt(Math.max(0, 1 - ((ry - k) / ry) ** 2));
    cost += Math.min(25, (hw[k] - pred) ** 2);
  }
  // Wand darunter: Abweichung von einer Geraden durch die nächsten K Zeilen
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < K; k++) { sx += k; sy += hw[ry + k]; sxx += k * k; sxy += k * hw[ry + k]; }
  const sl = (K * sxy - sx * sy) / (K * sxx - sx * sx), ic = (sy - sl * sx) / K;
  for (let k = 0; k < K; k++) cost += 2 * Math.min(25, (hw[ry + k] - ic - sl * k) ** 2);
  return cost;
}

// ---------------------------------------------------------------------------
// Pinselstriche (Hinzufügen / Entfernen) in die Stück-Karte einrechnen
// ---------------------------------------------------------------------------

function pinsel(q, brush, w, h, IW, IH, x0, y0) {
  for (const st of brush) {
    const R = st.r * IW;
    const pts = st.pts.map(([x, y]) => [x * IW - x0, y * IH - y0]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const bx0 = Math.max(0, Math.floor(Math.min(...xs) - R)), bx1 = Math.min(w - 1, Math.ceil(Math.max(...xs) + R));
    const by0 = Math.max(0, Math.floor(Math.min(...ys) - R)), by1 = Math.min(h - 1, Math.ceil(Math.max(...ys) + R));
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      let d = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
        d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
      if (d <= R) q[y * w + x] = st.erase ? -1 : 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

/**
 * src: { width, height, data } (RGBA)
 * crop: Rahmen (relativ), sens: Empfindlichkeit 0–100, brush: Pinselstriche
 * hint: { gruppe, familie, guide: {x0,y0,x1,y1}, blick: Grad nach unten (Lagesensor) }
 */
export function analyze(src, { crop = DEFAULT_CROP, sens = DEFAULT_SENS, brush = [], hint = {} } = {}) {
  const { width: IW, height: IH, data } = src;
  const x0 = clamp(Math.round(crop.x0 * IW), 0, IW - 16);
  const x1 = clamp(Math.round(crop.x1 * IW), x0 + 16, IW);
  const y0 = clamp(Math.round(crop.y0 * IH), 0, IH - 16);
  const y1 = clamp(Math.round(crop.y1 * IH), y0 + 16, IH);
  const w = x1 - x0, h = y1 - y0, n = w * h;
  const lab = labBild(data, IW, x0, y0, w, h);
  const E = kanten(lab, w, h);
  const bias = ((sens - 50) / 50) * 4;

  // Aufnahme-Maske im Ausschnitt
  const guide = hint.guide ? {
    x0: hint.guide.x0 * IW - x0, x1: hint.guide.x1 * IW - x0, y0: hint.guide.y0 * IH - y0, y1: hint.guide.y1 * IH - y0,
  } : null;

  // --- Hintergrund: Rand des Ausschnitts (und alles weit außerhalb der Maske)
  const band = Math.max(3, Math.round(0.035 * Math.min(w, h)));
  const bgIdx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // unten nur seitlich: dort steht oft noch der Fuß des Stücks im Rahmen
    const rand = x < band || y < band || x >= w - band || (y >= h - band && (x < w * 0.2 || x > w * 0.8));
    const aussen = guide && (x < guide.x0 - 0.12 * w || x > guide.x1 + 0.12 * w || y < guide.y0 - 0.08 * h);
    if (rand || aussen) bgIdx.push(y * w + x);
  }
  let bgModel = farbmodell(lab, bgIdx, 6);

  // --- Erster Eindruck vom Stück: was sich klar vom Hintergrund abhebt, nahe der Mitte
  const cb = new Float32Array(n);
  for (let k = 0; k < n; k++) cb[k] = kosten(bgModel, lab.L[k] + 16, lab.A[k], lab.B[k], 0.42, 1.08);
  const sortedCb = Float32Array.from(cb).sort();
  const thr = Math.max(12, sortedCb[Math.floor(n * 0.5)] * 3, otsu(cb));
  const fg0 = new Uint8Array(n);
  for (let k = 0; k < n; k++) fg0[k] = cb[k] > thr + bias * 2 ? 1 : 0;
  pinselMaske(fg0, brush, w, h, IW, IH, x0, y0);
  const cx = guide ? (guide.x0 + guide.x1) / 2 : w / 2;
  const cy = guide ? (guide.y0 + guide.y1) / 2 : h / 2;
  const { lab: comp, info } = komponenten(erode(fg0, w, h, 1), w, h, 1);
  let bestId = 0, bestScore = 0;
  info.forEach((c, i) => {
    const d = Math.hypot((c.sx / c.area - cx) / w, (c.sy / c.area - cy) / h);
    // Flächen, die mehrere Bildränder berühren, sind meist Tisch oder Wand
    // … und ein Stück ist nicht nur ein kleiner Fleck (z. B. ein Glanzlicht auf dunkler Glasur)
    const s = c.area * Math.exp(-4 * d * d) * [1, 0.4, 0.05, 0.02, 0.01][c.kanten] * (c.hoehe < 0.15 * h && c.breite < 0.3 * w ? 0.05 : 1);
    if (s > bestScore) { bestScore = s; bestId = i + 1; }
  });
  const fgIdx = [];
  const bi = bestId ? info[bestId - 1] : null;
  const klar = bi && bi.area > n * 0.01 && (bi.hoehe >= 0.15 * h || bi.breite >= 0.3 * w);
  if (klar) {
    const core = erode(Uint8Array.from(comp, v => (v === bestId ? 1 : 0)), w, h, 2);
    for (let k = 0; k < n; k++) if (core[k]) fgIdx.push(k);
  } else bestId = 0;
  if (fgIdx.length < 50 || (bi.hoehe < 0.35 * h && bi.breite < 0.35 * w)) {
    // Stück hebt sich kaum ab (z. B. dunkel vor dunkler Wand): auch den Kern der Mitte nehmen
    const gx0 = guide ? guide.x0 : w * 0.3, gx1 = guide ? guide.x1 : w * 0.7;
    const gy0 = guide ? guide.y0 : h * 0.25, gy1 = guide ? guide.y1 : h * 0.75;
    for (let y = Math.round(gy0 + (gy1 - gy0) * 0.25); y < gy0 + (gy1 - gy0) * 0.8; y++) {
      for (let x = Math.round(cx - (gx1 - gx0) * 0.12); x < cx + (gx1 - gx0) * 0.12; x++) if (x >= 0 && x < w && y >= 0 && y < h) fgIdx.push(y * w + x);
    }
  }
  let fgModel = farbmodell(lab, fgIdx, 6);
  let q = stueckKarte(lab, fgModel, bgModel, w, h, bias);
  pinsel(q, brush, w, h, IW, IH, x0, y0);

  // Erste Achse: häufigste Zeilenmitte des ersten Eindrucks
  let achse0 = cx;
  if (bestId) {
    const mids = [];
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) if (comp[y * w + x] === bestId) { if (l < 0) l = x; r = x; }
      if (l >= 0 && r - l > 4) mids.push((l + r) / 2);
    }
    if (mids.length > 10) achse0 = modus(mids, w);
  }

  const ctx = {
    w, h, q, E, achse: () => achse0,
    // Kamera: optische Achse in der Bildmitte, Brennweite (Anteil der langen Bildseite), Neigung
    geo: {
      cy: IH / 2 - y0,
      f: (hint.brennweite || 0.75) * Math.max(IW, IH),
      e: ((Number.isFinite(hint.blick) ? hint.blick : 0) * Math.PI) / 180,
      bekannt: Number.isFinite(hint.blick),
    },
  };
  let erg = null;
  for (let pass = 0; pass < 2; pass++) {
    const erw = pass && erg ? erwartungAus(erg, h) : null;
    const uL = konturSeite(ctx, -1, erw?.links);
    const uR = konturSeite(ctx, 1, erw?.rechts);
    erg = auswerten(ctx, uL, uR, hint);
    if (!erg) throw new Error('Kein Werkstück erkannt. Ziehe den Rahmen enger um das Stück oder ändere die Empfindlichkeit.');
    if (pass === 0) {
      // Farbmodelle aus dem ersten Ergebnis nachlernen (innen = Stück, außen = Hintergrund)
      const inn = [], aus = [];
      for (let y = 0; y < h; y++) {
        const wv = erg.silh[y];
        const a = erg.achse(y);
        for (let x = 0; x < w; x += 2) {
          const d = Math.abs(x - a);
          if (wv > 3 && d < wv - 3) inn.push(y * w + x);
          // Henkel und andere klar zum Stück gehörende Teile nicht als Hintergrund lernen
          else if ((wv < 0 || d > wv + 4) && q[y * w + x] < 0.3) aus.push(y * w + x);
        }
      }
      if (inn.length > 100 && aus.length > 100) {
        fgModel = farbmodell(lab, inn, 7);
        bgModel = farbmodell(lab, aus, 7);
        const q2 = stueckKarte(lab, fgModel, bgModel, w, h, bias);
        pinsel(q2, brush, w, h, IW, IH, x0, y0);
        ctx.q = q2;
      }
      ctx.achse = erg.achse;
    }
  }

  const henkel = henkelFinden({ ...ctx, q1: q, lab, band }, erg, brush.length > 0);
  return ergebnis(erg, henkel, { IW, IH, x0, y0, w, h });
}

// Seiten zusammenführen, Ellipsen an Rand und Boden, Formwissen
function auswerten(ctx, uL, uR, hint) {
  const { h } = ctx;
  // Henkel mit sichtbarem Loch: von außen über Henkel und Loch nach innen bis zur Körperkante
  const kL = koerperKante(ctx, -1, uL), kR = koerperKante(ctx, 1, uR);
  uL = kL.u; uR = kR.u;
  const henkelSpans = { '-1': kL, '1': kR };
  let cL = sicherheit(ctx, -1, uL), cR = sicherheit(ctx, 1, uR);

  // Mittellinie: robuste Gerade durch die Zeilenmitten; im zweiten Schritt nur Zeilen,
  // in denen beide Seiten gleich weit reichen (ohne Henkel)
  const mitten = [];
  for (let y = 0; y < h; y++) {
    if (uL[y] < 0 || uR[y] < 0) continue;
    const a0 = Math.round(ctx.achse(y));
    const wt = Math.min(cL[y], cR[y]);
    if (wt > 0.2) mitten.push({ y, x: a0 + (uR[y] - uL[y]) / 2, w: wt * wt, l: a0 - uL[y], r: a0 + uR[y] });
  }
  let achse = achseAnpassen(mitten, ctx.achse);
  const sym = mitten.filter(m => { const a = achse(m.y), dl = a - m.l, dr = m.r - a; return Math.abs(dl - dr) < 0.12 * Math.max(dl, dr) + 3; });
  if (sym.length >= 10) achse = achseAnpassen(sym, achse);
  const rL = new Float32Array(h).fill(-1), rR = new Float32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    const a0 = Math.round(ctx.achse(y)), a = achse(y);
    if (uL[y] >= 0) rL[y] = Math.max(0, a - (a0 - uL[y]) + 0.5);
    if (uR[y] >= 0) rR[y] = Math.max(0, a0 + uR[y] - a + 0.5);
  }

  // Leitseite: klarere Kante über die ganze Höhe
  let qL = 0, qR = 0, nb = 0;
  for (let y = 0; y < h; y++) if (rL[y] >= 0 && rR[y] >= 0) { qL += cL[y]; qR += cR[y]; nb++; }
  if (nb < 12) return null;
  qL /= nb; qR /= nb;
  const leit = qL >= qR ? -1 : 1;

  // Henkel: eine Seite reicht über längere Strecke deutlich weiter hinaus
  const henkelZeile = new Int8Array(h);
  for (const s of [-1, 1]) {
    const a = s < 0 ? rL : rR, b = s < 0 ? rR : rL;
    let run = [];
    const flush = () => {
      if (run.length > Math.max(6, nb * 0.08)) for (const y of run) henkelZeile[y] = s;
      run = [];
    };
    for (let y = 0; y < h; y++) {
      // Henkel: deutlich, aber nicht unplausibel weit; die schmalere Seite muss sicher sein
      const cn = s < 0 ? cR[y] : cL[y];
      if (a[y] >= 0 && b[y] >= 0 && a[y] > b[y] * 1.15 + 4 && a[y] < b[y] * 2 + 4 && cn > 0.4) run.push(y); else flush();
    }
    flush();
  }
  let henkelSeite = 0;
  {
    let l = 0, r = 0;
    for (let y = 0; y < h; y++) { if (henkelZeile[y] < 0 || kL.loch[y]) l++; if (henkelZeile[y] > 0 || kR.loch[y]) r++; }
    henkelSeite = l > r ? -1 : r > l ? 1 : 0;
  }

  // Zusammenführen
  const hw = new Float32Array(h).fill(-1), wt = new Float32Array(h);
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    const a = rL[y], b = rR[y];
    if (a < 0 && b < 0) continue;
    const ca = cL[y], cb = cR[y];
    let r, c;
    if (a >= 0 && b >= 0) {
      const tol = Math.max(1.8, 0.04 * Math.max(a, b));
      if (henkelZeile[y]) {
        // Henkelseite: Körperkante vor dem Henkelloch suchen; mit der anderen Seite vergleichen
        const hs = henkelZeile[y];
        const [ro, co] = hs < 0 ? [b, cb] : [a, ca];
        const inn = innereKante(ctx, achse, y, hs, hs < 0 ? a : b, ro);
        if (inn && (Math.abs(inn.r - ro) <= tol * 2 || inn.c > co)) {
          r = Math.abs(inn.r - ro) <= tol * 2 ? (inn.r * inn.c + ro * co) / (inn.c + co + 1e-6) : inn.r;
          c = Math.max(inn.c, co) * 0.9;
        } else { r = ro; c = co; }
      } else if (Math.abs(a - b) <= tol) { r = (a * ca + b * cb) / (ca + cb + 1e-6); c = Math.max(ca, cb); } else {
        const [rt, ct, ro, co] = leit < 0 ? [a, ca, b, cb] : [b, cb, a, ca];
        if (ct >= 0.3 || ct >= co) { r = rt; c = ct * 0.85; } else { r = ro; c = co * 0.85; }
      }
    } else {
      // nur eine Seite gefunden (z. B. ganz oben an der Ellipse)
      r = a >= 0 ? a : b; c = (a >= 0 ? ca : cb) * 0.6;
    }
    hw[y] = r; wt[y] = c;
    if (top < 0) top = y;
    bottom = y;
  }
  if (top < 0 || bottom - top < 24) return null;
  // Über Farbwechsel hinweg: läuft die Kontur oben oder unten auf beiden Seiten
  // spiegelgleich weiter (Kanten im selben Abstand zur Mittellinie), gehört das noch zum Stück.
  for (const dir of [1, -1]) {
    const ext = symmetrischVerlaengern(ctx, achse, hw, wt, top, bottom, dir, Math.round((bottom - top) * 0.9));
    if (dir > 0) bottom += ext; else top -= ext;
  }

  // Öffnung und Boden erscheinen als Ellipsen; die Silhouette reicht oben und unten über die
  // eigentliche Rand- bzw. Bodenhöhe hinaus. Wie weit, folgt aus der Kamerageometrie
  // (Lochkamera: Neigung des Handys vom Lagesensor, Brennweite). Ohne Sensor (Galeriefoto)
  // wird die Neigung aus den Bögen oben und unten und der sichtbaren Öffnung geschätzt.
  const seg = Array.from(hw.slice(top, bottom + 1), v => Math.max(0, v));
  const Lr = seg.length;
  const geo = ctx.geo;
  const hwAt = y => seg[clamp(Math.round(y - top), 0, Lr - 1)];
  const segU = seg.slice().reverse();
  const kappen = e => {
    const P = lochkamera(geo, e);
    let yr = top + 1, yb = bottom - 1;
    for (let it = 0; it < 6; it++) {
      const Yr = P.Y(yr), Yb = P.Y(yb);
      const kr = P.kreis(Yr, P.rho(Yr, hwAt(yr)));
      const kb = P.kreis(Yb, P.rho(Yb, hwAt(yb)));
      yr = clamp(yr + (top - kr.oben), top, top + 0.45 * Lr);
      yb = clamp(yb + (bottom - kb.unten), bottom - 0.45 * Lr, bottom);
    }
    return { P, yr, yb, rt: yr - top, rb: bottom - yb };
  };
  let e = geo.e;
  if (!geo.bekannt) {
    // Von oben gesehen ist außerdem die vordere Hälfte der Öffnung als Bogen im Stück sichtbar.
    const { E: Ek, w: W } = ctx;
    const kante = (x, y) => {
      let m = 0;
      for (let d = -1; d <= 1; d++) {
        const yy = Math.round(y) + d, xx = Math.round(x);
        if (yy >= 0 && yy < ctx.h && xx >= 0 && xx < W) m = Math.max(m, Ek[yy * W + xx]);
      }
      return m;
    };
    const innenE = [];
    for (let y = top; y <= bottom; y += 3) {
      const a = achse(y), r = Math.max(0, hw[y]);
      for (let x = -0.6 * r; x <= 0.6 * r; x += 3) innenE.push(kante(a + x, y));
    }
    innenE.sort((p1, q1) => p1 - q1);
    const basis = innenE.length ? innenE[Math.floor(innenE.length * 0.75)] : 0.2;
    let bestC = Infinity;
    for (let deg = -12; deg <= 50; deg += 2) {
      const ee = (deg * Math.PI) / 180;
      const k = kappen(ee);
      let c = kappeKosten(seg, k.rt) + 0.5 * kappeKosten(segU, k.rb) + 0.02 * Math.abs(deg);
      const aRim = ee + Math.atan((k.yr - geo.cy) / geo.f);
      if (aRim > 0.05 && k.rt > 2) {
        // vorderer Bogen der Öffnung
        const kr = k.P.kreis(k.P.Y(k.yr), k.P.rho(k.P.Y(k.yr), hwAt(k.yr)));
        let sum = 0, cnt = 0;
        for (const [u, row, vorn] of kr.punkte) if (vorn) { sum += kante(achse(row) + u, row); cnt++; }
        if (cnt) c -= 40 * (sum / cnt - basis - 0.05); // erwarteter Bogen fehlt → kostet
      }
      if (c < bestC) { bestC = c; e = ee; }
    }
  }
  const kp = kappen(e);
  const P = kp.P;
  const randZeile = kp.yr, bodenZeile = kp.yb;
  const hImg = bodenZeile - randZeile;
  if (hImg < 20) return null;
  const Yr = P.Y(randZeile), Yb = P.Y(bodenZeile);
  const HD = Yr - Yb; // Höhe des Stücks im Verhältnis zum Abstand
  if (!(HD > 1e-4)) return null;
  const hTrue = hImg; // Maßstab in Pixeln (für Schwellen)

  // Querschnitte gleichmäßig über die wahre Höhe; ihre Mitte liegt auf der Achse
  const M = PROFILE_POINTS;
  const Ys = Float64Array.from({ length: M }, (_, i) => Yr - (i / (M - 1)) * HD);
  const zeilen = Float64Array.from(Ys, Y => P.zeile(Y));
  const ab = y => {
    const a = clamp(Math.floor(y), 0, h - 1), b = Math.min(h - 1, a + 1), f = clamp(y - a, 0, 1);
    const va = hw[a], vb = hw[b];
    if (va < 0 || vb < 0) return { v: va >= 0 ? va : vb, c: Math.min(wt[a], wt[b]) * 0.5 };
    return { v: va + (vb - va) * f, c: wt[a] + (wt[b] - wt[a]) * f };
  };
  const rho = new Float64Array(M), mw = new Float32Array(M), wMess = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const { v, c } = ab(zeilen[i]);
    wMess[i] = v >= 0 ? v : 0;
    mw[i] = v >= 0 ? c : 0;
    rho[i] = v > 0 ? P.rho(Ys[i], v) : 0;
  }
  // Radius so nachführen, dass die berechnete Silhouette die gemessene trifft
  for (let it = 0; it < 3; it++) {
    const sil = P.silhouette(Ys, rho, h);
    for (let i = 1; i < M - 1; i++) {
      if (!(mw[i] > 0)) continue;
      const k = P.kreis(Ys[i], rho[i]);
      const row = clamp(Math.round(k.zeileMax), 0, h - 1);
      const wm = hw[row] >= 0 ? hw[row] : wMess[i];
      // nur Querschnitte nachführen, die an dieser Stelle die Silhouette bilden
      if (!(sil[row] > 0) || k.wMax < sil[row] - 1) continue;
      const d = clamp(0.8 * (wm - sil[row]) * P.zc(Ys[i]) / geo.f, -0.1 * rho[i], 0.1 * rho[i]);
      rho[i] = Math.max(1e-4, rho[i] + d);
    }
  }
  const r = Float64Array.from(rho, v => v / HD); // Radius / Höhe

  // Formwissen: auf N Stellen zusammenfassen, Familie anpassen
  const N = MODELL_N;
  const m48 = new Float64Array(N), w48 = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const lo = ((j - 0.5) / (N - 1)) * (M - 1), hi = ((j + 0.5) / (N - 1)) * (M - 1);
    let s = 0, sw = 0;
    for (let i = Math.max(0, Math.ceil(lo)); i <= Math.min(M - 1, Math.floor(hi)); i++) { s += r[i] * mw[i]; sw += mw[i]; }
    const cnt = Math.max(1, Math.min(M - 1, Math.floor(hi)) - Math.max(0, Math.ceil(lo)) + 1);
    m48[j] = sw > 1e-6 ? s / sw : 0;
    w48[j] = sw / cnt;
  }
  const form = formAnpassen(m48, w48, { gruppe: hint.gruppe, familie: hint.familie });
  const modAt = (arr, i) => {
    const p = (i / (M - 1)) * (N - 1), a = Math.floor(p), b = Math.min(N - 1, a + 1);
    return arr[a] + (arr[b] - arr[a]) * (p - a);
  };
  const profil = new Float32Array(M), anteil = new Float32Array(M);
  let ergaenzt = 0;
  for (let i = 0; i < M; i++) {
    const rm = modAt(form.profil, i);
    const u = modAt(form.gewichtRobust, i);
    const sd = modAt(form.sd, i);
    // Messung zählt, wenn sicher und mit dem Formwissen verträglich
    let lam = mw[i] * u;
    if (mw[i] > 0) {
      const z = (r[i] - rm) / Math.max(0.01, 2.5 * sd + 0.006 / Math.sqrt(mw[i]));
      lam *= 1 / (1 + z * z * 0.25);
    }
    lam = clamp(lam * 1.4, 0, 1);
    profil[i] = lam * (mw[i] > 0 ? r[i] : rm) + (1 - lam) * rm;
    anteil[i] = lam;
    ergaenzt += 1 - lam;
  }
  // leichte Glättung, Details (Rillen, Fuß) bleiben
  const glatt = Float32Array.from(profil, (v, i) => (i > 0 && i < M - 1 ? 0.25 * profil[i - 1] + 0.5 * v + 0.25 * profil[i + 1] : v));

  // Silhouette im Bild (für Anzeige, Henkel, zweiten Durchgang)
  const silh = P.silhouette(Ys, Float64Array.from(glatt, v => v * HD), h);
  const aMitte = e + Math.atan(((randZeile + bodenZeile) / 2 - geo.cy) / geo.f);
  return {
    achse, rL, rR, cL, cR, uL, uR, leit, qL, qR, henkelSeite, henkelZeile, henkelSpans,
    top, bottom, randZeile, bodenZeile, hImg, hTrue, neigung: Math.abs(Math.sin(aMitte)), blick: e,
    profil: glatt, anteil, ergaenzt: ergaenzt / M, form, silh, sdModell: form.sd,
    // Bildpunkt → Lage am Stück (x: Abstand zur Achse, t: 0 = Rand … 1 = Boden; beides in Höhen)
    tVon: y => (Yr - P.Y(y)) / HD,
    xVon: (dx, y) => (dx * P.zc(P.Y(y))) / geo.f / HD,
    zeileVon: t => P.zeile(Yr - t * HD),
  };
}

// Lochkamera: Kamera im Ursprung, um e nach unten geneigt; die Achse des Stücks steht
// senkrecht im waagrechten Abstand 1 vor der Kamera. Y = Höhe relativ zur Kamera.
function lochkamera(geo, e) {
  const { f, cy } = geo;
  const ce = Math.cos(e), se = Math.sin(e);
  const n = 48;
  const cos = Float64Array.from({ length: n }, (_, j) => Math.cos((2 * Math.PI * j) / n));
  const sin = Float64Array.from({ length: n }, (_, j) => Math.sin((2 * Math.PI * j) / n));
  const P = {
    Y: row => -Math.tan(e + Math.atan((row - cy) / f)),
    zeile: Y => cy + (f * (-Y * ce - se)) / (ce - Y * se),
    zc: Y => ce - Y * se,
    // Projektion eines waagrechten Kreises (Radius rho) um die Achse in Höhe Y
    kreis(Y, rho) {
      let oben = Infinity, unten = -Infinity, wMax = 0, zeileMax = 0;
      const punkte = [];
      for (let j = 0; j < n; j++) {
        const x = rho * cos[j], z = 1 - rho * sin[j]; // sin > 0: vordere Hälfte (zur Kamera)
        const Zc = z * ce - Y * se;
        const u = (f * x) / Zc, row = cy + (f * (-Y * ce - z * se)) / Zc;
        punkte.push([u, row, sin[j] > 0.2]);
        if (row < oben) oben = row;
        if (row > unten) unten = row;
        if (Math.abs(u) > wMax) { wMax = Math.abs(u); zeileMax = row; }
      }
      return { oben, unten, wMax, zeileMax, punkte };
    },
    // Radius, dessen Kreis in dieser Höhe die halbe Breite w (Pixel) hat
    rho(Y, w) {
      let r = (w * P.zc(Y)) / f;
      for (let it = 0; it < 3 && r > 0; it++) r *= w / Math.max(1e-6, P.kreis(Y, r).wMax);
      return Math.max(0, r);
    },
    // halbe Breite der Silhouette je Bildzeile (Vereinigung aller projizierten Querschnitte)
    silhouette(Ys, rhos, h) {
      const out = new Float32Array(h).fill(-1);
      const put = (row, v) => { const k = Math.round(row); if (k >= 0 && k < h && v > out[k]) out[k] = v; };
      let prevRow = null, prevW = 0;
      for (let i = 0; i < Ys.length; i++) {
        if (!(rhos[i] > 0)) continue;
        const k = P.kreis(Ys[i], rhos[i]);
        const pts = k.punkte;
        for (let j = 0; j < pts.length; j++) {
          const [u1, r1] = pts[j], [u2, r2] = pts[(j + 1) % pts.length];
          const a = Math.min(r1, r2), b = Math.max(r1, r2);
          for (let row = Math.ceil(a); row <= b; row++) put(row, Math.abs(r2 === r1 ? Math.max(Math.abs(u1), Math.abs(u2)) : u1 + ((u2 - u1) * (row - r1)) / (r2 - r1)));
          put(r1, Math.abs(u1));
        }
        // zwischen zwei Querschnitten linear verbinden (sehr flache Ellipsen)
        if (prevRow != null) {
          const a = Math.min(prevRow, k.zeileMax), b = Math.max(prevRow, k.zeileMax);
          for (let row = Math.ceil(a); row <= b; row++) put(row, prevW + ((k.wMax - prevW) * (row - prevRow)) / ((k.zeileMax - prevRow) || 1));
        }
        prevRow = k.zeileMax; prevW = k.wMax;
      }
      return out;
    },
  };
  return P;
}

// Auf der Henkelseite: erste Stelle von der Achse aus, an der ein Stück Hintergrund beginnt
// (das Henkelloch) – dort endet der Körper.
function koerperKante(ctx, side, us) {
  const { w, h, q, achse } = ctx;
  const out = Int32Array.from(us), loch = new Uint8Array(h);
  const spanA = new Int32Array(h).fill(-1), spanB = new Int32Array(h).fill(-1);
  let first = -1, last = -1;
  for (let y = 0; y < h; y++) if (us[y] >= 0) { if (first < 0) first = y; last = y; }
  for (let y = 0; y < h; y++) {
    const u0 = us[y];
    if (u0 < 8) continue;
    const ax = Math.round(achse(y));
    const at = d => { const x = ax + side * d; return x >= 0 && x < w ? q[y * w + x] : -1; };
    const minD = Math.max(3, Math.round(u0 * 0.4));
    let d = u0 - 1;
    while (d > minD && at(d) > -0.4) d--; // durch den Henkel
    if (d <= minD || u0 - d > u0 * 0.5) continue;
    let g = d;
    while (g > minD && at(g) <= -0.1) g--; // durch das Loch
    if (d - g < 3 || g <= minD) continue;
    out[y] = g;
    loch[y] = 1;
    spanA[y] = d + 1; spanB[y] = u0;
  }
  // nur zusammenhängende Strecken im mittleren Bereich gelten (sonst z. B. dunkle Öffnung)
  const minLen = Math.max(6, Math.round((last - first) * 0.06));
  for (let y = 0; y < h;) {
    if (!loch[y]) { y++; continue; }
    let e = y;
    while (e < h && loch[e]) e++;
    const mitte = (y + e) / 2;
    if (e - y < minLen || mitte < first + 0.1 * (last - first) || mitte > first + 0.92 * (last - first)) {
      for (let k = y; k < e; k++) { loch[k] = 0; out[k] = us[k]; spanA[k] = spanB[k] = -1; }
      y = e;
      continue;
    }
    // Ansätze oberhalb und unterhalb des Lochs: Henkel geht dort in den Körper über
    const L = Math.round((last - first) * 0.12);
    for (const [start, step, ref] of [[y - 1, -1, out[y]], [e, 1, out[e - 1]]]) {
      for (let k = start, n = 0; n < L && k >= 0 && k < h && us[k] >= 0; k += step, n++) {
        if (us[k] <= ref * 1.08 + 2) break;
        out[k] = ref; spanA[k] = ref + 1; spanB[k] = us[k];
      }
    }
    y = e;
  }
  return { u: out, loch, spanA, spanB };
}

function innereKante(ctx, achse, y, side, rAussen, rAndere) {
  const { w, q, E } = ctx;
  const a = achse(y);
  const at = d => { const x = Math.round(a + side * d); return x >= 0 && x < w ? q[y * w + x] : -1; };
  // nur in der Nähe der Breite der anderen Seite suchen (Glanzlichter weiter innen stören sonst)
  for (let d = Math.max(3, Math.round(rAndere * 0.7)); d < Math.min(rAussen - 4, rAndere * 1.35); d++) {
    if (at(d) < -0.4 && at(d + 1) < -0.4 && at(d + 2) < -0.4) {
      const x = Math.round(a + side * d);
      let e = 0;
      for (let k = -2; k <= 1; k++) { const xx = x - side * k; if (xx >= 0 && xx < w) e = Math.max(e, E[y * w + xx]); }
      return { r: d - 0.5, c: clamp(0.35 + 0.65 * Math.min(1, e / 0.7), 0, 1) };
    }
  }
  return null;
}

function symmetrischVerlaengern(ctx, achse, hw, wt, top, bottom, dir, maxExt) {
  const { w, h, E } = ctx;
  const start = dir > 0 ? bottom : top;
  const w0 = hw[start];
  const rows = [];
  for (let k = 1; k <= maxExt; k++) { const y = start + dir * k; if (y < 0 || y >= h) break; rows.push(y); }
  if (rows.length < 3 || !(w0 > 3)) return 0;
  const U = Math.ceil(w0 * 1.3 + 6);
  const NEG = -1e9;
  const ed = (y, x) => {
    let m = 0;
    for (let d = -1; d <= 1; d++) { const xx = Math.round(x) + d; if (xx >= 0 && xx < w) m = Math.max(m, E[y * w + xx]); }
    return m;
  };
  const pen = d => (d <= 2 ? 0.6 * d * d : 2.4 + 1.1 * (d - 2));
  const J = Math.max(4, Math.round(w0 * 0.12));
  let prev = new Float32Array(U + 1).fill(NEG);
  for (let u = 2; u <= U; u++) prev[u] = -pen(Math.abs(u - w0)) * 0.5;
  const from = [];
  let cum = 0, bestK = 0, bestCum = 0;
  for (let k = 0; k < rows.length; k++) {
    const y = rows[k], a = achse(y);
    // Kantenniveau des Hintergrunds in dieser Zeile
    const bgE = [];
    for (let x = 0; x < w; x += 2) if (Math.abs(x - a) > w0 * 1.35 + 4) bgE.push(E[y * w + x]);
    bgE.sort((p, q) => p - q);
    const base = (bgE.length ? bgE[Math.floor(bgE.length * 0.6)] : 0) + 0.12;
    const cur = new Float32Array(U + 1).fill(NEG);
    const fr = new Int16Array(U + 1);
    let rowBest = NEG;
    for (let u = 2; u <= U; u++) {
      if (a - u < 0 || a + u >= w) continue;
      const eL = ed(y, a - u), eR = ed(y, a + u);
      const sc = Math.min(eL, eR) + 0.25 * Math.max(eL, eR) - base;
      let b = NEG, arg = -1;
      for (let v = Math.max(2, u - J); v <= Math.min(U, u + J); v++) { const c = prev[v] - pen(Math.abs(v - u)); if (c > b) { b = c; arg = v; } }
      cur[u] = b + sc;
      fr[u] = arg;
      if (cur[u] > rowBest) rowBest = cur[u];
    }
    from.push(fr);
    prev = cur;
    cum = rowBest;
    if (cum > bestCum + 1e-6) { bestCum = cum; bestK = k + 1; }
  }
  if (bestK < 3 || bestCum / bestK < 0.12) return 0;
  // Weg zurückverfolgen (ab der besten Zeile)
  // dafür einmal neu rechnen bis bestK und Endzustand wählen
  let u = -1, best = NEG;
  {
    // Endzustand: höchster Wert in Zeile bestK-1 – erneut aus `from` rekonstruieren ist nur mit
    // gespeicherten Werten möglich; deshalb Pfad über die Vorgänger ab dem besten Endpunkt suchen
    let p = new Float32Array(U + 1).fill(NEG);
    for (let uu = 2; uu <= U; uu++) p[uu] = -pen(Math.abs(uu - w0)) * 0.5;
    for (let k = 0; k < bestK; k++) {
      const y = rows[k], a = achse(y);
      const bgE = [];
      for (let x = 0; x < w; x += 2) if (Math.abs(x - a) > w0 * 1.35 + 4) bgE.push(E[y * w + x]);
      bgE.sort((p1, q1) => p1 - q1);
      const base = (bgE.length ? bgE[Math.floor(bgE.length * 0.6)] : 0) + 0.12;
      const c = new Float32Array(U + 1).fill(NEG);
      for (let uu = 2; uu <= U; uu++) {
        if (a - uu < 0 || a + uu >= w) continue;
        const v = from[k][uu];
        if (v < 0) continue;
        c[uu] = p[v] - pen(Math.abs(v - uu)) + Math.min(ed(y, a - uu), ed(y, a + uu)) + 0.25 * Math.max(ed(y, a - uu), ed(y, a + uu)) - base;
      }
      p = c;
    }
    for (let uu = 2; uu <= U; uu++) if (p[uu] > best) { best = p[uu]; u = uu; }
  }
  for (let k = bestK - 1; k >= 0 && u >= 2; k--) {
    const y = rows[k];
    hw[y] = u; wt[y] = 0.3;
    u = from[k][u];
  }
  return bestK;
}

// Erwartete Kontur je Seite (für den zweiten Durchgang)
function erwartungAus(erg, h) {
  const mk = side => {
    const u = new Float32Array(h).fill(-1), s = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      const wv = erg.silh[y];
      if (wv < 1) continue;
      u[y] = wv; // Abstand zur Achse (die Achse ist im zweiten Durchgang dieselbe)
      const t = clamp(erg.tVon(y), 0, 1);
      const sd = erg.sdModell[Math.round(t * (erg.sdModell.length - 1))] * erg.hTrue;
      s[y] = Math.max(2.5, 2 * sd + 0.012 * erg.hTrue);
    }
    // Auf der Henkelseite darf die Kontur weiter hinaus (wird beim Zusammenführen erkannt)
    if (erg.henkelSeite === side) for (let y = 0; y < h; y++) if (erg.henkelZeile[y]) s[y] *= 4;
    return { u, s, kraft: 2.2 };
  };
  return { links: mk(-1), rechts: mk(1) };
}

// ---------------------------------------------------------------------------
// Henkel
// ---------------------------------------------------------------------------

function henkelFinden(ctx, erg, mitPinsel) {
  const { w, h, q } = ctx;
  const n = w * h;
  const koerper = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const wv = erg.silh[y];
    if (wv <= 0) continue;
    const a = erg.achse(y);
    for (let x = Math.max(0, Math.ceil(a - wv)); x <= Math.min(w - 1, Math.floor(a + wv)); x++) koerper[y * w + x] = 1;
  }
  const nahe = dilate(koerper, w, h, Math.max(6, Math.round(0.06 * erg.hImg)));
  const weit = dilate(koerper, w, h, 2);
  const yMin = erg.randZeile - 0.08 * erg.hImg, yMax = erg.bodenZeile - 0.05 * erg.hImg;
  const kand = new Uint8Array(n);
  let koerperFl = 0;
  for (let k = 0; k < n; k++) koerperFl += koerper[k];
  const { L, A, B } = ctx.lab;
  const thr = mitPinsel ? 0.05 : 0.15;
  for (let y = Math.max(0, Math.floor(yMin)); y <= Math.min(h - 1, yMax); y++) {
    // Hintergrund in dieser Höhe (linker und rechter Bildrand): Farben, die dem gleichen, sind kein Henkel
    const ref = [];
    for (const xs of [[0, ctx.band], [w - ctx.band, w]]) {
      let sL = 0, sA = 0, sB = 0, c = 0;
      for (let yy = Math.max(0, y - 3); yy <= Math.min(h - 1, y + 3); yy++) for (let x = xs[0]; x < xs[1]; x++) { const k = yy * w + x; sL += L[k]; sA += A[k]; sB += B[k]; c++; }
      if (c) ref.push([sL / c, sA / c, sB / c]);
    }
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (weit[k]) continue;
      if (q[k] <= thr && ctx.q1[k] <= thr) continue;
      if (q[k] < 0.9 && ref.some(r => 0.5 * (L[k] - r[0]) ** 2 + (A[k] - r[1]) ** 2 + (B[k] - r[2]) ** 2 < 64)) continue;
      kand[k] = 1;
    }
  }
  // Henkelquerschnitte, die beim Suchen der Körperkante gefunden wurden
  for (const side of [-1, 1]) {
    const sp = erg.henkelSpans?.[side];
    if (!sp) continue;
    for (let y = 0; y < h; y++) {
      if (sp.spanA[y] < 0) continue;
      const a = Math.round(ctx.achse(y));
      for (let d = sp.spanA[y]; d <= sp.spanB[y]; d++) { const x = a + side * d; if (x >= 0 && x < w && !koerper[y * w + x]) kand[y * w + x] = 1; }
    }
  }
  const sauber = dilate(erode(kand, w, h, 1), w, h, 1);
  const { lab, info } = komponenten(sauber, w, h, 1);
  const henkel = [];
  info.forEach((c, i) => {
    if (c.area < Math.max(25, koerperFl * 0.006)) return;
    // muss am Körper hängen
    let beruehrt = 0, minY = Infinity, maxY = -Infinity, reach = 0, sx = 0;
    for (let k = 0; k < n; k++) {
      if (lab[k] !== i + 1) continue;
      const y = (k / w) | 0, x = k % w;
      if (nahe[k] || (x > 0 && nahe[k - 1]) || (x < w - 1 && nahe[k + 1])) beruehrt++;
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const a = erg.achse(y);
      reach = Math.max(reach, Math.abs(x - a) - Math.max(0, erg.silh[y]));
      sx += x - a;
    }
    if (beruehrt < 3) return;
    if (maxY - minY < 0.12 * erg.hImg || maxY - minY > 1.05 * erg.hImg || reach < 0.09 * erg.hTrue || reach > 0.8 * erg.hTrue || c.area / (maxY - minY + 1) < 3) return;
    if (minY > erg.randZeile + 0.6 * erg.hImg) return; // nur unten: Schatten auf dem Tisch
    henkel.push({ id: i + 1, side: Math.sign(sx) || 1 });
  });
  if (!henkel.length) return null;
  // Henkel samt Ansatzstücken in den Körper hinein (damit die Kontur geschlossen ist)
  const M = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (henkel.some(hk => hk.id === lab[k])) M[k] = 1;
  const ans = dilate(M, w, h, 4);
  for (let k = 0; k < n; k++) if (ans[k] && koerper[k]) M[k] = 1;
  const voll = fillHolesBelow(dilate(erode(M, w, h, 1), w, h, 1), w, h, Math.max(12, koerperFl * 0.002));
  return { maske: voll, side: henkel[0].side };
}

// ---------------------------------------------------------------------------
// Ergebnis zusammenstellen
// ---------------------------------------------------------------------------

function ergebnis(erg, henkel, { IW, IH, x0, y0, w, h }) {
  const toRel = (x, y) => [round4((x + x0) / IW), round4((y + y0) / IH)];
  const profile = Array.from(erg.profil, v => round4(v));
  // Körperumriss im Bild (mit Ellipsen an Rand und Boden)
  const rechts = [], links = [];
  let yTop = -1, yBot = -1;
  for (let y = 0; y < h; y++) {
    const wv = erg.silh[y];
    if (wv <= 0.3) continue;
    if (yTop < 0) yTop = y;
    yBot = y;
    const a = erg.achse(y);
    rechts.push(toRel(a + wv, y));
    links.push(toRel(a - wv, y));
  }
  const koerper = [...rechts, ...links.reverse()];
  // Wo das Formwissen ergänzt hat (für die Anzeige)
  const ergaenzt = [];
  let start = -1;
  for (let i = 0; i <= PROFILE_POINTS; i++) {
    const weg = i < PROFILE_POINTS && erg.anteil[i] < 0.4;
    if (weg && start < 0) start = i;
    if (!weg && start >= 0) {
      if (i - start > 3) {
        const yA = erg.zeileVon(start / (PROFILE_POINTS - 1)), yB = erg.zeileVon((i - 1) / (PROFILE_POINTS - 1));
        ergaenzt.push([round4((yA + y0) / IH), round4((yB + y0) / IH)]);
      }
      start = -1;
    }
  }
  // Gemessene Kanten je Seite (dünn anzeigen)
  const gemessen = side => {
    const pts = [];
    const r = side < 0 ? erg.rL : erg.rR;
    for (let y = 0; y < h; y++) if (r[y] >= 0) pts.push(toRel(erg.achse(y) + side * r[y], y));
    return pts;
  };

  // Henkel: Konturen relativ zu Achse (x) und Höhe (t)
  const handles = [];
  const henkelRel = [];
  if (henkel) {
    for (const c of traceContours(henkel.maske, w, h)) {
      if (c.length < 16) continue;
      const pts = smoothClosed(simplifyClosed(c, 0.8), 2);
      henkelRel.push(pts.map(([x, y]) => toRel(x, y)));
      handles.push(pts.map(([x, y]) => [round4(erg.xVon(x - erg.achse(y), y)), round4(erg.tVon(y))]));
    }
  }
  const sideName = s => (s < 0 ? 'links' : 'rechts');
  return {
    profile,
    handles,
    tilt: round4(erg.neigung),
    form: { key: erg.form.key, label: erg.form.label, gruppe: erg.form.gruppe },
    quality: {
      leitseite: sideName(erg.leit),
      guete: round4(Math.max(erg.qL, erg.qR)),
      ergaenzt: round4(erg.ergaenzt),
      henkelSeite: henkel ? sideName(henkel.side) : null,
    },
    outline: {
      koerper,
      links: gemessen(-1),
      rechts: gemessen(1),
      henkel: henkelRel,
      ergaenzt,
      achse: [toRel(erg.achse(yTop), yTop), toRel(erg.achse(yBot), yBot)],
      rand: round4((erg.randZeile + y0) / IH),
      boden: round4((erg.bodenZeile + y0) / IH),
      leit: sideName(erg.leit),
    },
  };
}

const round4 = v => Math.round(v * 10000) / 10000;

// ---------------------------------------------------------------------------
// Bildhilfen
// ---------------------------------------------------------------------------

function modus(vals, w) {
  const bins = new Map();
  for (const v of vals) { const b = Math.round(v / 2); bins.set(b, (bins.get(b) || 0) + 1); }
  let mb = 0, mc = -1;
  for (const [b] of bins) {
    const c = (bins.get(b - 1) || 0) + bins.get(b) + (bins.get(b + 1) || 0);
    if (c > mc) { mc = c; mb = b; }
  }
  const near = vals.filter(v => Math.abs(v / 2 - mb) <= 1.5);
  return near.length ? near.reduce((a, b) => a + b, 0) / near.length : w / 2;
}

function otsu(values) {
  let max = 0;
  for (const v of values) if (v > max) max = v;
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
    const between = wB * (total - wB) * (sumB / wB - (sumAll - sumB) / (total - wB)) ** 2;
    if (between > best) { best = between; bestI = i; }
  }
  return ((bestI + 1) / bins) * max;
}

function pinselMaske(M, brush, w, h, IW, IH, x0, y0) {
  if (!brush.length) return;
  const q = Float32Array.from(M, v => (v ? 1 : 0));
  pinsel(q, brush, w, h, IW, IH, x0, y0);
  for (let k = 0; k < M.length; k++) M[k] = q[k] > 0 ? 1 : 0;
}

export function erode(A, W, H, r) {
  let cur = A;
  for (let it = 0; it < r; it++) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      out[k] = cur[k] && (x === 0 || cur[k - 1]) && (x === W - 1 || cur[k + 1]) && (y === 0 || cur[k - W]) && (y === H - 1 || cur[k + W]) ? 1 : 0;
    }
    cur = out;
  }
  return cur;
}

export function dilate(A, W, H, r) {
  let cur = A;
  for (let it = 0; it < r; it++) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      out[k] = cur[k] || (x > 0 && cur[k - 1]) || (x < W - 1 && cur[k + 1]) || (y > 0 && cur[k - W]) || (y < H - 1 && cur[k + W]) ? 1 : 0;
    }
    cur = out;
  }
  return cur;
}

// Zusammenhängende Flächen mit Wert `val` beschriften
function komponenten(A, W, H, val) {
  const N = W * H;
  const lab = new Int32Array(N);
  const queue = new Int32Array(N);
  const info = [];
  for (let s = 0; s < N; s++) {
    if (A[s] !== val || lab[s]) continue;
    const id = info.length + 1;
    let qh = 0, qt = 0, area = 0, border = false, sx = 0, sy = 0, minX = W, maxX = -1, minY = H, maxY = -1;
    queue[qt++] = s;
    lab[s] = id;
    while (qh < qt) {
      const p = queue[qh++];
      area++;
      const x = p % W, y = (p / W) | 0;
      sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && A[p - 1] === val && !lab[p - 1]) { lab[p - 1] = id; queue[qt++] = p - 1; }
      if (x < W - 1 && A[p + 1] === val && !lab[p + 1]) { lab[p + 1] = id; queue[qt++] = p + 1; }
      if (y > 0 && A[p - W] === val && !lab[p - W]) { lab[p - W] = id; queue[qt++] = p - W; }
      if (y < H - 1 && A[p + W] === val && !lab[p + W]) { lab[p + W] = id; queue[qt++] = p + W; }
    }
    info.push({ area, border, sx, sy, kanten: (minX === 0) + (maxX === W - 1) + (minY === 0) + (maxY === H - 1), hoehe: maxY - minY + 1, breite: maxX - minX + 1 });
  }
  return { lab, info };
}

function fillHolesBelow(A, W, H, maxArea) {
  const { lab, info } = komponenten(A, W, H, 0);
  const out = A.slice();
  for (let k = 0; k < W * H; k++) if (lab[k]) { const i = info[lab[k] - 1]; if (!i.border && i.area < maxArea) out[k] = 1; }
  return out;
}

// Marching Squares: geschlossene Konturen um die Fläche
function traceContours(A, W, H) {
  const v = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && A[y * W + x] ? 1 : 0);
  const adj = new Map();
  const link = (a, b) => {
    const ka = a.join(','), kb = b.join(',');
    if (!adj.has(ka)) adj.set(ka, { p: a, n: [] });
    if (!adj.has(kb)) adj.set(kb, { p: b, n: [] });
    adj.get(ka).n.push(kb);
    adj.get(kb).n.push(ka);
  };
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const c = v(x, y) * 8 + v(x + 1, y) * 4 + v(x + 1, y + 1) * 2 + v(x, y + 1);
      if (c === 0 || c === 15) continue;
      const T = [2 * x + 1, 2 * y], R = [2 * x + 2, 2 * y + 1], B = [2 * x + 1, 2 * y + 2], L = [2 * x, 2 * y + 1];
      const segs = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[T, L], [B, R]], 6: [[T, B]], 7: [[T, L]],
        8: [[T, L]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      }[c];
      for (const [a, b] of segs) link(a, b);
    }
  }
  const seen = new Set();
  const contours = [];
  for (const [start] of adj) {
    if (seen.has(start)) continue;
    const poly = [];
    let prev = null, cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const nd = adj.get(cur);
      poly.push([nd.p[0] / 2, nd.p[1] / 2]);
      const next = nd.n.find(k => k !== prev && !seen.has(k));
      prev = cur;
      cur = next;
    }
    if (poly.length > 2) contours.push(poly);
  }
  return contours;
}

function simplifyClosed(pts, eps) {
  const dp = arr => {
    if (arr.length < 3) return arr;
    const [ax, ay] = arr[0], [bx, by] = arr[arr.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let maxD = -1, idx = 0;
    for (let i = 1; i < arr.length - 1; i++) {
      const d = Math.abs((bx - ax) * (ay - arr[i][1]) - (ax - arr[i][0]) * (by - ay)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= eps) return [arr[0], arr[arr.length - 1]];
    return [...dp(arr.slice(0, idx + 1)).slice(0, -1), ...dp(arr.slice(idx))];
  };
  const half = Math.floor(pts.length / 2);
  return [...dp(pts.slice(0, half + 1)).slice(0, -1), ...dp([...pts.slice(half), pts[0]]).slice(0, -1)];
}

function smoothClosed(pts, iterations) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0; i < cur.length; i++) {
      const [ax, ay] = cur[i], [bx, by] = cur[(i + 1) % cur.length];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    cur = out;
  }
  return cur;
}

