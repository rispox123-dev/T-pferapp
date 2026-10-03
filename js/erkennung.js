// Formerkennung: das keramische Stück im Foto finden und seine Kontur messen.
//
// Ablauf
// 1. Farben in Lab umrechnen, Kanten als Strukturtensor (Richtung und Stärke).
// 2. Mittelachse suchen: dort, wo viele Kanten spiegelgleich links und rechts liegen.
//    Mehrere Kandidaten werden verfolgt; gewählt wird der mit dem besten Umriss, der
//    innen spiegelgleich aussieht und nahe der Bildmitte (oder dem getippten Punkt) liegt.
// 3. Umriss für beide Seiten gemeinsam als zusammenhängender Weg von oben nach unten
//    (dynamische Programmierung über die halbe Breite): Beide Seiten müssen auf einer
//    Kante liegen, deren Richtung zur Kontur passt. Ein Drehteil ist symmetrisch, Dinge
//    im Hintergrund fast nie – so stören Bilder, Regale und Nachbargefäße kaum.
// 4. Farbmodelle: Stück (Kern um die Achse) und Hintergrund (Rand, knapp außerhalb)
//    sind schattentolerant – ein nur dunklerer Farbton zählt als dieselbe Farbe.
//    Ein zweiter Durchgang nutzt zusätzlich die Farbe. Die Seite mit der klareren Kante
//    ist die Leitseite; wo die andere abweicht (Schatten, Henkel), gilt sie gespiegelt.
// 5. Öffnung und Boden erscheinen als (flache) Ellipsen; ihre Mitte ist die wahre
//    Rand- bzw. Bodenhöhe. Bei Fotos von schräg oben wird die Perspektive herausgerechnet.
// 6. Die gemessene Kontur wird mit dem Formwissen (formprior.js) abgeglichen: unsichere
//    oder auffällig abweichende Stellen werden aus der passenden Formfamilie ergänzt.
//    Mit dieser Erwartung als Führung wird die Kontur ein letztes Mal gesucht.
// 7. Henkel: was außerhalb des Körpers seitlich am Stück hängt.

import { formAnpassen, MODELL_N } from './formprior.js';

export const PROFILE_POINTS = 200;
export const DEFAULT_CROP = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 };
export const DEFAULT_SENS = 50;

const ANALYSIS_SIZE = 400;
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

// ---------------------------------------------------------------------------
// Kanten mit Richtung (Strukturtensor): wie stark ändert sich das Bild quer zu einer
// gedachten Konturlinie? So zählen nur Kanten, die zur Richtung der Kontur passen –
// waagrechte Regalkanten stören eine senkrechte Gefäßwand nicht.
// ---------------------------------------------------------------------------

function kantenTensor(lab, w, h) {
  const { L, A, B } = lab;
  const n = w * h;
  let xx = new Float32Array(n), xy = new Float32Array(n), yy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [ch, wt] of [[L, 1], [A, 2], [B, 2]]) {
      const gx = ch[k - w + 1] + 2 * ch[k + 1] + ch[k + w + 1] - ch[k - w - 1] - 2 * ch[k - 1] - ch[k + w - 1];
      const gy = ch[k + w - 1] + 2 * ch[k + w] + ch[k + w + 1] - ch[k - w - 1] - 2 * ch[k - w] - ch[k - w + 1];
      sxx += wt * gx * gx; sxy += wt * gx * gy; syy += wt * gy * gy;
    }
    xx[k] = sxx; xy[k] = sxy; yy[k] = syy;
  }
  const box = a => {
    const t = new Float32Array(n), o = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) { const k = y * w + x; t[k] = (a[k - 1] + a[k] + a[k + 1]) / 3; }
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) { const k = y * w + x; o[k] = (t[k - w] + t[k] + t[k + w]) / 3; }
    return o;
  };
  xx = box(xx); xy = box(xy); yy = box(yy);
  const vals = [];
  for (let k = 0; k < n; k += 3) vals.push(Math.sqrt(xx[k] + yy[k]));
  vals.sort((a, b) => a - b);
  const scale = Math.max(6, vals[Math.floor(vals.length * 0.97)] || 1);
  const s2 = 1 / (scale * scale);
  const E = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    xx[k] *= s2; xy[k] *= s2; yy[k] *= s2;
    E[k] = Math.min(1.5, Math.sqrt(xx[k] + yy[k]));
  }
  // Grundrauschen (Putz, Holzmaserung, Sprenkel): darüber muss eine Kante liegen
  const ev = [];
  for (let k = 0; k < n; k += 5) ev.push(E[k]);
  ev.sort((a, b) => a - b);
  const rauschen = ev[Math.floor(ev.length * 0.6)] || 0;
  // waagrechte Kanten (±3 Zeilen), zeilenweise aufsummiert
  const hy = Float32Array.from(yy, v => Math.min(1.2, Math.sqrt(Math.max(0, v))));
  const kappeSumme = new Float32Array(h * (w + 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let d = -3; d <= 3; d++) { const yy2 = y + d; if (yy2 >= 0 && yy2 < h && hy[yy2 * w + x] > m) m = hy[yy2 * w + x]; }
      s += m;
      kappeSumme[y * (w + 1) + x + 1] = s;
    }
  }
  return { xx, xy, yy, E, rauschen, kappeSumme };
}

// ---------------------------------------------------------------------------
// Mittelachse: wo liegen viele Kantenpaare spiegelgleich links und rechts?
// Ein Drehkörper ist spiegelsymmetrisch – Dinge im Hintergrund fast nie dazu.
// ---------------------------------------------------------------------------

function achseSuchen(T, w, h, mitte, streuung) {
  const hx = Float32Array.from(T.xx, v => Math.sqrt(Math.max(0, v)));
  const S = new Float64Array(2 * w);
  const rowBest = new Float32Array(2 * w);
  const touched = [];
  const peaks = [];
  for (let y = 0; y < h; y++) {
    peaks.length = 0;
    const o = y * w;
    for (let x = 1; x < w - 1; x++) { const v = hx[o + x]; if (v > 0.15 && v >= hx[o + x - 1] && v > hx[o + x + 1]) peaks.push(x); }
    touched.length = 0;
    for (let i = 0; i < peaks.length; i++) {
      const xi = peaks[i], vi = hx[o + xi];
      for (let j = i + 1; j < peaks.length; j++) {
        const xj = peaks[j];
        if (xj - xi < 6) continue;
        const b = xi + xj, v = Math.min(vi, hx[o + xj]);
        if (v > rowBest[b]) { if (!rowBest[b]) touched.push(b); rowBest[b] = v; }
      }
    }
    for (const b of touched) { S[b] += rowBest[b]; rowBest[b] = 0; }
  }
  // glätten und mit der Erwartung (Bildmitte bzw. Mitte der Aufnahme-Maske) gewichten
  const G = new Float64Array(2 * w);
  for (let b = 0; b < 2 * w; b++) {
    let s = 0;
    for (let d = -3; d <= 3; d++) if (b + d >= 0 && b + d < 2 * w) s += S[b + d] * (4 - Math.abs(d));
    const z = (b / 2 - mitte) / (streuung * w);
    G[b] = s * Math.exp(-0.5 * z * z);
  }
  const kand = [];
  for (let b = 1; b < 2 * w - 1; b++) if (G[b] > 0 && G[b] >= G[b - 1] && G[b] >= G[b + 1]) kand.push({ a: b / 2, s: G[b] });
  kand.sort((p, q) => q.s - p.s);
  const out = [];
  for (const k of kand) {
    if (out.length >= 4) break;
    if (k.s < 0.25 * (kand[0]?.s || 0)) break;
    if (out.every(o => Math.abs(o.a - k.a) > 0.06 * w)) out.push(k);
  }
  return out.length ? out : [{ a: mitte, s: 0 }];
}

// ---------------------------------------------------------------------------
// Symmetrische Kontur: je Bildzeile die halbe Breite u, so dass links und rechts
// (Achse ± u) Kanten in Richtung der Kontur liegen. Eine starke Seite trägt auch,
// wenn die andere im Schatten liegt (die gut belichtete Seite als Vorlage).
// ---------------------------------------------------------------------------

const ALPHA_S = 6; // Gewicht der Kanten
const RHO = 0.8; // Gewicht der Farbfläche (zweiter Durchgang)
const C_ON = 8, C_OFF = 8;
const PINSEL = 5; // Gewicht gemalter / radierter Pixel beim Verfeinern

function symKontur(ctx, { erwartung = null, mitFarbe = false, schwelle = 1 } = {}) {
  const { w, h, T, q, achse, pm } = ctx;
  // Vorgaben aus „Umriss verfeinern“: Ober-/Unterkante (Zeilen), äußerste Punkte (Spalten)
  const G = ctx.grenzen || {};
  const yA = G.top != null ? Math.round(G.top) : null, yB = G.bottom != null ? Math.round(G.bottom) : null;
  const TG = 2; // Spielraum in Zeilen
  const ax = Float64Array.from({ length: h }, (_, y) => achse(y));
  let U = 0;
  for (let y = 0; y < h; y++) U = Math.max(U, Math.ceil(Math.max(ax[y], w - 1 - ax[y])));
  U = Math.max(4, U);
  const NEG = -1e9;
  // Sprünge der Breite von Zeile zu Zeile: klein quadratisch, groß linear (Keramik hat am
  // Körper keine Stufen; Rand und Boden beginnen bzw. enden direkt in voller Breite, wenn
  // dort eine passende Kante liegt). Lineare Strafe → bester Vorgänger über laufende Maxima.
  const PL = 0.6, P0 = 2 - 2 * PL; // pen(d) = P0 + PL·d für d ≥ 3
  const pen = d => (d <= 2 ? 0.5 * d * d : P0 + PL * d);
  const sufW = new Float32Array(U + 2), sufA = new Int32Array(U + 2);
  let prev = new Float32Array(U + 1).fill(NEG), cur = new Float32Array(U + 1);
  const from = new Int16Array(h * (U + 1));
  const postFrom = new Int16Array(h).fill(-2);
  let post = NEG;
  const lxx = new Float32Array(U + 1), lxy = new Float32Array(U + 1), lyy = new Float32Array(U + 1);
  const rxx = new Float32Array(U + 1), rxy = new Float32Array(U + 1), ryy = new Float32Array(U + 1);
  const reg = new Float32Array(U + 1);
  const c0 = ALPHA_S * Math.sqrt(Math.max(0.17, 1.6 * T.rauschen + 0.06)) * schwelle;
  const uRand = Math.max(6, Math.round(0.1 * U));
  // Waagrechte Kante über die ganze Breite (Bogen der Öffnung oben, Standfläche unten)
  const capRausch = Math.max(0.17, 1.6 * T.rauschen + 0.06) * schwelle;
  const kappe = new Float32Array(U + 1), kappeVor = new Float32Array(U + 1);
  const KP = T.kappeSumme;
  const tens = (y, x) => (x >= 0 && x < w ? y * w + x : -1);
  // Gibt es in den nächsten Zeilen (Richtung dir) noch Seitenkanten im Abstand u?
  const seitenLaufenWeiter = (y0, u, dir) => {
    let sum = 0, n = 0;
    for (let k = 0; k < 4; k++) {
      const y = y0 + dir * k;
      if (y < 0 || y >= h) break;
      const kl = tens(y, Math.round(ax[y] - u)), kr = tens(y, Math.round(ax[y] + u));
      if (kl < 0 || kr < 0) continue;
      sum += symKante(T.xx[kl], T.xy[kl], T.yy[kl], T.xx[kr], T.xy[kr], T.yy[kr], 0, 1);
      n++;
    }
    return n > 0 && (ALPHA_S * sum) / n > c0 * 1.3;
  };

  for (let y = 0; y < h; y++) {
    const a = ax[y];
    const zeileFrei = (yA == null || y >= yA - TG) && (yB == null || y <= yB + TG);
    let uLim = U;
    if (G.xL != null || G.xR != null) uLim = Math.min(U, Math.ceil(Math.max(G.xL != null ? a - G.xL : 0, G.xR != null ? G.xR - a : 0)) + 1);
    let s = 0;
    for (let u = 0; u <= U; u++) {
      const xl = Math.round(a - u), xr = Math.round(a + u);
      if (xl >= 0 && xl < w) { const k = y * w + xl; lxx[u] = T.xx[k]; lxy[u] = T.xy[k]; lyy[u] = T.yy[k]; } else lxx[u] = lxy[u] = lyy[u] = 0;
      if (xr >= 0 && xr < w) { const k = y * w + xr; rxx[u] = T.xx[k]; rxy[u] = T.xy[k]; ryy[u] = T.yy[k]; } else rxx[u] = rxy[u] = ryy[u] = 0;
      if (mitFarbe && q) {
        const vl = xl >= 0 && xl < w ? q[y * w + xl] : -0.5, vr = xr >= 0 && xr < w ? q[y * w + xr] : -0.5;
        // klar Stück zählt, klar Hintergrund kostet; unsicher (um 0) zählt nicht
        const f = v => (v > 0.2 ? v - 0.2 : v > -0.2 ? 0 : 0.7 * (v + 0.2));
        s += RHO * 0.5 * (f(vl) + f(vr));
      }
      // Pinsel (nur beim Verfeinern): gemalt zählt kräftig als Stück, radiert als Hintergrund
      if (pm) s += PINSEL * 0.5 * ((xl >= 0 && xl < w ? pm[y * w + xl] : 0) + (xr >= 0 && xr < w ? pm[y * w + xr] : 0));
      reg[u] = s;
    }
    for (let u = 0; u <= U; u++) {
      // muss über die ganze Breite liegen: schwächstes der vier Viertel zählt
      const l = Math.round(a - u), r = Math.round(a + u);
      let m = Infinity;
      for (let i = 0; i < 4; i++) {
        const x0 = clamp(Math.round(l + ((r - l) * i) / 4), 0, w - 1), x1 = clamp(Math.round(l + ((r - l) * (i + 1)) / 4), 0, w - 1);
        m = Math.min(m, (KP[y * (w + 1) + x1 + 1] - KP[y * (w + 1) + x0]) / (x1 - x0 + 1));
      }
      kappe[u] = m;
    }
    // Ende: aus einem Zustand der Vorzeile nach „danach leer“ – schmal (Bogen der Bodenellipse)
    // oder breit, wenn dort die Standfläche als waagrechte Kante liegt
    let bestPrev = NEG, bestPrevU = -1;
    // vorgegebene Unterkante: nur dort enden, dafür in jeder Breite
    const endeFrei = yB == null || Math.abs(y - 1 - yB) <= TG;
    for (let u = 0; endeFrei && u <= U; u++) {
      // breit enden nur, wenn die Seitenkanten darunter wirklich aufhören (sonst ist es z. B.
      // eine Glasurgrenze)
      const bonus = yB != null || u <= uRand ? 0 : kappeVor[u] > capRausch + 0.08 && !seitenLaufenWeiter(y, u, 1) ? ALPHA_S * 2 * (kappeVor[u] - capRausch) : NEG;
      if (prev[u] + bonus > bestPrev) { bestPrev = prev[u] + bonus; bestPrevU = u; }
    }
    if (bestPrev - C_OFF > post) { post = bestPrev - C_OFF; postFrom[y] = bestPrevU; } else postFrom[y] = -1;

    const ue = erwartung ? erwartung.u[y] : -1;
    sufW[U + 1] = NEG; sufA[U + 1] = -1;
    for (let v = U; v >= 0; v--) {
      const val = v >= 2 && prev[v] > NEG / 2 ? prev[v] - PL * v : NEG;
      if (val > sufW[v + 1]) { sufW[v] = val; sufA[v] = v; } else { sufW[v] = sufW[v + 1]; sufA[v] = sufA[v + 1]; }
    }
    let preW = NEG, preA = -1;
    for (let u = 0; u <= U; u++) {
      if (u < 2 || u > uLim || !zeileFrei) { cur[u] = NEG; continue; }
      let extra = reg[u] - c0;
      if (erwartung) {
        if (ue >= 0) { const z = (u - ue) / erwartung.s[y]; extra -= erwartung.kraft * Math.log(1 + z * z); } else extra -= erwartung.kraft * 2.5;
      }
      // Eintritt nur schmal (Spitze der Öffnungsellipse) oder ganz oben am Bildrand
      let eintritt = NEG;
      // vorgegebene Oberkante: nur dort beginnen, dafür in jeder Breite
      if (yA != null) eintritt = Math.abs(y - yA) <= TG ? -C_ON + ALPHA_S * Math.max(symKante(lxx[u], lxy[u], lyy[u], rxx[u], rxy[u], ryy[u], 0, 1), 2 * Math.max(0, kappe[u] - capRausch)) : NEG;
      else if (u <= uRand || y === 0) eintritt = -C_ON + ALPHA_S * symKante(lxx[u], lxy[u], lyy[u], rxx[u], rxy[u], ryy[u], 0, 1);
      else if (kappe[u] > capRausch + 0.08 && !seitenLaufenWeiter(y - 1, u, -1)) eintritt = -C_ON + ALPHA_S * 2 * (kappe[u] - capRausch);
      let best = eintritt, arg = -1;
      const kante = dw => ALPHA_S * symKante(lxx[u], lxy[u], lyy[u], rxx[u], rxy[u], ryy[u], dw, 1 / (1 + dw * dw));
      // kleine Schritte genau
      for (let v = Math.max(2, u - 2); v <= Math.min(U, u + 2); v++) {
        const pv = prev[v];
        if (pv <= NEG / 2) continue;
        const c = pv - pen(Math.abs(u - v)) + kante(u - v);
        if (c > best) { best = c; arg = v; }
      }
      // große Schritte von schmaler (v ≤ u−3) und von breiter (v ≥ u+3)
      const vIn = u - 3;
      if (vIn >= 2 && prev[vIn] > NEG / 2 && prev[vIn] + PL * vIn > preW) { preW = prev[vIn] + PL * vIn; preA = vIn; }
      if (preA >= 0) { const c = preW - PL * u - P0 + kante(u - preA); if (c > best) { best = c; arg = preA; } }
      if (u + 3 <= U && sufA[u + 3] >= 0) { const v = sufA[u + 3]; const c = sufW[u + 3] + PL * u - P0 + kante(u - v); if (c > best) { best = c; arg = v; } }
      cur[u] = best + extra;
      from[y * (U + 1) + u] = arg;
    }
    [prev, cur] = [cur, prev];
    kappeVor.set(kappe);
  }
  // Rückverfolgung
  const out = new Int32Array(h).fill(-1);
  let bestEnd = NEG, uEnd = -1;
  for (let u = 0; u <= U; u++) if (prev[u] > bestEnd) { bestEnd = prev[u]; uEnd = u; }
  let y = h - 1, u;
  const score = Math.max(post, bestEnd);
  if (post >= bestEnd) {
    while (y >= 0 && postFrom[y] < 0) y--;
    if (y < 0) return { u: out, score: 0 };
    u = postFrom[y];
    y--;
  } else u = uEnd;
  while (y >= 0 && u >= 0) {
    out[y] = u;
    u = from[y * (U + 1) + u];
    y--;
  }
  return { u: out, score };
}

// Kantenstärke quer zur Kontur auf beiden Seiten (Steigung dw Pixel je Zeile)
function symKante(lxx, lxy, lyy, rxx, rxy, ryy, dw, inv) {
  const pr = (rxx - 2 * dw * rxy + dw * dw * ryy) * inv;
  const pl = (lxx + 2 * dw * lxy + dw * dw * lyy) * inv;
  const er = Math.min(1.2, Math.sqrt(pr > 0 ? pr : 0)), el = Math.min(1.2, Math.sqrt(pl > 0 ? pl : 0));
  // vor allem das Spiegelpaar zählt; eine einzelne Kante ohne Gegenstück nur wenig.
  // Wurzel: schwache, aber echte Kanten (weiß vor hellem Grund) gehen neben kräftigen
  // Kanten im Hintergrund nicht unter
  const v = er < el ? er + 0.15 * el : el + 0.15 * er;
  return Math.sqrt(v);
}

// Kantenstärke je Seite entlang des gefundenen Wegs; dazu die genaue Lage der Kante
// (±4 px um die symmetrische Lage), um die Achse nachzuführen
function seitenMessen(ctx, us) {
  const { w, h, T, achse } = ctx;
  const res = { cL: new Float32Array(h), cR: new Float32Array(h), xL: new Float32Array(h).fill(-1), xR: new Float32Array(h).fill(-1) };
  for (let y = 0; y < h; y++) {
    const u = us[y];
    if (u < 0) continue;
    const up = y > 0 && us[y - 1] >= 0 ? us[y - 1] : u, dn = y < h - 1 && us[y + 1] >= 0 ? us[y + 1] : u;
    const dw = (dn - up) / 2, inv = 1 / (1 + dw * dw);
    const a = achse(y);
    for (const side of [-1, 1]) {
      let best = 0, bx = -1;
      for (let d = -4; d <= 4; d++) {
        const x = Math.round(a + side * (u + d));
        if (x < 0 || x >= w) continue;
        const k = y * w + x;
        const p = (T.xx[k] - side * 2 * dw * T.xy[k] + dw * dw * T.yy[k]) * inv;
        const e = Math.sqrt(p > 0 ? p : 0) * (1 - 0.04 * Math.abs(d));
        if (e > best) { best = e; bx = x; }
      }
      if (side < 0) { res.cL[y] = clamp(best / 0.7, 0, 1); res.xL[y] = bx; } else { res.cR[y] = clamp(best / 0.7, 0, 1); res.xR[y] = bx; }
    }
  }
  return res;
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
 * hint: { gruppe, familie, guide: {x0,y0,x1,y1}, blick: Grad nach unten (Lagesensor), brennweite,
 *         punkt: {x,y} angetipptes Stück (relativ) }
 * fein: Vorgaben aus „Umriss verfeinern“ (alles relativ, jeweils null = nicht gesetzt):
 *       { achse: {x0,y0,x1,y1} Mittelachse durch zwei Punkte, oben, unten: Ober-/Unterkante,
 *         links, rechts: äußerste Punkte des Körpers (ohne Henkel) }
 *       Pinselstriche wirken dann direkt auf den Umriss.
 */
export function analyze(src, { crop = DEFAULT_CROP, sens = DEFAULT_SENS, brush = [], hint = {}, fein = null } = {}) {
  const { width: IW, height: IH, data } = src;
  if (fein) {
    // Rahmen so erweitern, dass die Vorgaben sicher darin liegen
    crop = { ...crop };
    if (fein.links != null) crop.x0 = Math.min(crop.x0, fein.links - 0.03);
    if (fein.rechts != null) crop.x1 = Math.max(crop.x1, fein.rechts + 0.03);
    if (fein.oben != null) crop.y0 = Math.min(crop.y0, fein.oben - 0.03);
    if (fein.unten != null) crop.y1 = Math.max(crop.y1, fein.unten + 0.03);
  }
  const x0 = clamp(Math.round(crop.x0 * IW), 0, IW - 16);
  const x1 = clamp(Math.round(crop.x1 * IW), x0 + 16, IW);
  const y0 = clamp(Math.round(crop.y0 * IH), 0, IH - 16);
  const y1 = clamp(Math.round(crop.y1 * IH), y0 + 16, IH);
  const w = x1 - x0, h = y1 - y0, n = w * h;
  const lab = labBild(data, IW, x0, y0, w, h);
  const T = kantenTensor(lab, w, h);
  const bias = ((sens - 50) / 50) * 4;
  const schwelle = 2 ** ((50 - sens) / 50);
  const band = Math.max(3, Math.round(0.035 * Math.min(w, h)));

  // Pinsel: „Entfernen“ löscht dort die Kanten, „Hinzufügen“ zählt im zweiten Durchgang als Stück
  // (beim Verfeinern wirken beide direkt auf den Umriss)
  let pm = null;
  if (brush.length) {
    const m = new Float32Array(n);
    pinsel(m, brush, w, h, IW, IH, x0, y0);
    for (let k = 0; k < n; k++) if (m[k] < 0) { T.xx[k] = T.xy[k] = T.yy[k] = 0; T.E[k] = 0; }
    if (fein) pm = m;
  }
  // Vorgaben in Pixeln des Ausschnitts
  const grenzen = fein ? {
    top: fein.oben != null ? fein.oben * IH - y0 : null,
    bottom: fein.unten != null ? fein.unten * IH - y0 : null,
    xL: fein.links != null ? fein.links * IW - x0 : null,
    xR: fein.rechts != null ? fein.rechts * IW - x0 : null,
  } : null;
  let festeAchse = null;
  if (fein?.achse) {
    const { x0: ax0, y0: ay0, x1: ax1, y1: ay1 } = fein.achse;
    const pa = [ax0 * IW - x0, ay0 * IH - y0], pb = [ax1 * IW - x0, ay1 * IH - y0];
    const dy = pb[1] - pa[1];
    const b = Math.abs(dy) > 1 ? (pb[0] - pa[0]) / dy : 0;
    festeAchse = y => pa[0] + b * (y - pa[1]);
  } else if (grenzen && grenzen.xL != null && grenzen.xR != null) {
    // Ein Drehteil ist symmetrisch: die Achse liegt mitten zwischen den äußersten Punkten
    const a = (grenzen.xL + grenzen.xR) / 2;
    festeAchse = () => a;
  }

  // Aufnahme-Maske im Ausschnitt
  const guide = hint.guide ? {
    x0: hint.guide.x0 * IW - x0, x1: hint.guide.x1 * IW - x0, y0: hint.guide.y0 * IH - y0, y1: hint.guide.y1 * IH - y0,
  } : null;
  const ctx = {
    w, h, T, E: T.E, lab, band, q: null, achse: null, pm, grenzen,
    // Kamera: optische Achse in der Bildmitte, Brennweite (Anteil der langen Bildseite), Neigung
    geo: {
      cy: IH / 2 - y0,
      f: (hint.brennweite || 0.75) * Math.max(IW, IH),
      e: ((Number.isFinite(hint.blick) ? hint.blick : 0) * Math.PI) / 180,
      bekannt: Number.isFinite(hint.blick),
    },
  };

  // 1. Mittelachse: Kandidaten aus spiegelgleichen Kantenpaaren, für jeden die
  //    symmetrische Kontur suchen und die überzeugendste nehmen
  // Mitte: angetipptes Stück, sonst Mitte der Aufnahme-Maske, sonst Bildmitte
  const punkt = hint.punkt ? hint.punkt.x * IW - x0 : null;
  const mitte = punkt ?? (guide ? (guide.x0 + guide.x1) / 2 : w / 2);
  const streu = punkt != null ? 0.07 : guide ? 0.18 : 0.24;
  let best = null;
  for (const k of festeAchse ? [] : achseSuchen(T, w, h, mitte, streu)) {
    const p = symKontur({ ...ctx, achse: () => k.a }, { schwelle });
    // Ein Drehteil ist auch innen spiegelgleich: Farben links und rechts der Achse ähneln sich
    // (Helligkeit zählt wenig – eine Seite liegt oft im Schatten). Wand + Gefäß ist das nicht.
    const ung = spiegelUngleichheit(lab, w, h, k.a, p.u);
    const z = (k.a - mitte) / (streu * w);
    p.wert = Math.max(0, p.score) * Math.exp(-ung / 25) * Math.exp(-0.5 * z * z);
    if (!best || p.wert > best.p.wert) best = { k, p };
  }
  // 2. Achse nachführen (Handy etwas schief, Stück nicht genau im Bild ausgerichtet)
  let achse = festeAchse || (() => best.k.a);
  let pfad = festeAchse ? symKontur({ ...ctx, achse }, { schwelle }) : best.p;
  for (let it = 0; it < (festeAchse ? 0 : 1); it++) {
    const m = seitenMessen({ ...ctx, achse }, pfad.u);
    const rows = [];
    for (let y = 0; y < h; y++) {
      if (m.xL[y] < 0 || m.xR[y] < 0) continue;
      const g = Math.min(m.cL[y], m.cR[y]);
      if (g > 0.3) rows.push({ y, x: (m.xL[y] + m.xR[y]) / 2, w: g * g });
    }
    achse = achseAnpassen(rows, achse);
    pfad = symKontur({ ...ctx, achse }, { schwelle });
  }
  ctx.achse = achse;
  if (pfad.u.filter(u => u >= 0).length < 20) throw new Error('Kein Werkstück erkannt. Ziehe den Rahmen enger um das Stück oder ändere die Empfindlichkeit.');

  // 3. Farbmodelle: innen = Stück, gleich daneben = Hintergrund (nicht der ganze Bildrand)
  const { fg, bg } = farbmodelleAus(lab, pfad.u, achse, w, h, band);
  const q = stueckKarte(lab, fg, bg, w, h, bias);
  pinsel(q, brush, w, h, IW, IH, x0, y0);
  ctx.q = q;

  // 4. Messen, Perspektive, Formwissen; dann mit Farbe und Erwartung ein zweites Mal suchen
  // mit Farbe ohne Vorgabe neu suchen, damit ein zu weiter erster Umriss nicht weiterwirkt
  const pfadF = symKontur(ctx, { mitFarbe: true, schwelle });
  if (pfadF.u.filter(u => u >= 0).length >= 20) pfad = pfadF;
  let erg = messen(ctx, pfad, hint);
  if (!erg) throw new Error('Kein Werkstück erkannt. Ziehe den Rahmen enger um das Stück oder ändere die Empfindlichkeit.');
  const pfad2 = symKontur(ctx, { erwartung: erwartungAus(erg, h), mitFarbe: true, schwelle });
  const erg2 = messen(ctx, pfad2, hint);
  if (erg2) erg = erg2;
  if (grenzen) erg = breiteAnpassen(erg, grenzen);

  const henkel = henkelFinden(ctx, erg, brush.length > 0);
  return ergebnis(erg, henkel, { IW, IH, x0, y0, w, h, manuell: !!fein });
}

// Vorgegebene äußerste Punkte: Profil so skalieren, dass die breiteste Stelle sie genau trifft
function breiteAnpassen(erg, G) {
  if (G.xL == null && G.xR == null) return erg;
  let { profil, silh } = erg;
  for (let it = 0; it < 2; it++) {
    let ym = -1;
    for (let y = 0; y < silh.length; y++) if (silh[y] > 0 && (ym < 0 || silh[y] > silh[ym])) ym = y;
    if (ym < 0) return erg;
    const a = erg.achse(ym);
    const ziel = [G.xL != null ? a - G.xL : null, G.xR != null ? G.xR - a : null].filter(v => v != null && v > 2);
    if (!ziel.length) return erg;
    const f = ziel.reduce((s, v) => s + v, 0) / ziel.length / silh[ym];
    if (!(f > 0.6 && f < 1.6) || Math.abs(f - 1) < 0.005) break;
    profil = Float32Array.from(profil, v => v * f);
    silh = erg.silhAus(profil);
  }
  return { ...erg, profil, silh };
}

function spiegelUngleichheit(lab, w, h, a, us) {
  const { L, A, B } = lab;
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += 2) {
    const u = us[y];
    if (u < 6) continue;
    for (let f = 0.15; f < 0.9; f += 0.15) {
      const d = f * u, xl = Math.round(a - d), xr = Math.round(a + d);
      if (xl < 0 || xr >= w) continue;
      const kl = y * w + xl, kr = y * w + xr;
      sum += Math.sqrt(0.15 * (L[kl] - L[kr]) ** 2 + (A[kl] - A[kr]) ** 2 + (B[kl] - B[kr]) ** 2);
      n++;
    }
  }
  return n ? sum / n : 99;
}

function farbmodelleAus(lab, us, achse, w, h, band) {
  let top = -1, bottom = -1, umax = 0;
  for (let y = 0; y < h; y++) if (us[y] >= 0) { if (top < 0) top = y; bottom = y; umax = Math.max(umax, us[y]); }
  const H = bottom - top;
  const inn = [], aus = [];
  for (let y = 0; y < h; y++) {
    const u = us[y], a = achse(y);
    for (let x = y & 1; x < w; x += 2) {
      const d = Math.abs(x - a), k = y * w + x;
      // Stück: nur der sichere Kern um die Achse (falls die erste Kontur zu weit ist)
      if (u > 3 && d < Math.max(2, 0.45 * u)) { inn.push(k); continue; }
      if (u > 3 && d < u + 4) continue;
      const nah = u >= 0
        ? d < u + 4 + Math.max(12, 0.5 * u)
        : y > top - 0.15 * H && y < bottom + 0.15 * H && d < umax + 12;
      if (nah || x < band || x >= w - band || y < band) aus.push(k);
    }
  }
  const fg = farbmodell(lab, inn, 7);
  // Proben neben dem Stück, die genauso aussehen wie das Stück (z. B. der Henkel), nicht als
  // Hintergrund lernen – außer der Hintergrund sieht wirklich so aus (weiß auf weiß)
  const { L, A, B } = lab;
  const anders = aus.filter(k => kosten(fg, L[k] + 16, A[k], B[k], 0.5, 1.35) > 3);
  const bg = farbmodell(lab, anders.length > aus.length * 0.75 ? anders : aus, 7);
  return { fg, bg };
}

// Gefundene Kontur auswerten: Sicherheit je Seite, Leitseite, dann Profil
function messen(ctx, pfad, hint) {
  const { h, w, q, achse, pm } = ctx;
  const m = seitenMessen(ctx, pfad.u);
  const hw = new Float32Array(h).fill(-1), wt = new Float32Array(h);
  const fest = new Uint8Array(h); // Kante vom Pinsel bestimmt: gilt, Formwissen ergänzt hier nicht
  const rL = new Float32Array(h).fill(-1), rR = new Float32Array(h).fill(-1);
  let top = -1, bottom = -1, sL = 0, sR = 0, nb = 0;
  for (let y = 0; y < h; y++) {
    const u = pfad.u[y];
    if (u < 0) continue;
    const a = achse(y);
    hw[y] = u + 0.5;
    let c = 0.6 * Math.max(m.cL[y], m.cR[y]) + 0.4 * Math.min(m.cL[y], m.cR[y]);
    if (q) {
      // Farbe innen wie Stück, außen wie Hintergrund?
      let inn = 0, aus = 0, n = 0;
      for (const side of [-1, 1]) for (let d = 2; d <= 5; d++) {
        const xi = Math.round(a + side * (u - d)), xo = Math.round(a + side * (u + d));
        if (xi >= 0 && xi < w && xo >= 0 && xo < w) { inn += q[y * w + xi]; aus += q[y * w + xo]; n++; }
      }
      if (n) c = 0.7 * c + 0.3 * clamp((inn - aus) / (2 * n), 0, 1);
    }
    wt[y] = clamp(c, 0.05, 1);
    if (pm) {
      for (const side of [-1, 1]) {
        const xi = Math.round(a + side * (u - 2)), xo = Math.round(a + side * (u + 2));
        if ((xi >= 0 && xi < w && pm[y * w + xi] > 0) || (xo >= 0 && xo < w && pm[y * w + xo] < 0)) { fest[y] = 1; wt[y] = 1; }
      }
    }
    if (m.xL[y] >= 0) rL[y] = a - m.xL[y];
    if (m.xR[y] >= 0) rR[y] = m.xR[y] - a;
    if (top < 0) top = y;
    bottom = y;
    sL += m.cL[y]; sR += m.cR[y]; nb++;
  }
  if (nb < 20 || bottom - top < 24) return null;
  return profilBerechnen(ctx, achse, hw, wt, top, bottom, hint, { fest, rL, rR, cL: m.cL, cR: m.cR, leit: sL >= sR ? -1 : 1, qL: sL / nb, qR: sR / nb });
}

function profilBerechnen(ctx, achse, hw, wt, top, bottom, hint, info) {
  const { h } = ctx;
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
    if (info.fest[clamp(Math.round(zeilen[i]), 0, h - 1)]) lam = 1;
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
    ...info, achse,
    top, bottom, randZeile, bodenZeile, hImg, hTrue, neigung: Math.abs(Math.sin(aMitte)), blick: e,
    profil: glatt, anteil, ergaenzt: ergaenzt / M, form, silh, sdModell: form.sd, fitRest: fitRest(m48, w48, form.profil),
    silhAus: prof => P.silhouette(Ys, Float64Array.from(prof, v => v * HD), h),
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
// Erwartete Kontur (für den zweiten Durchgang): halbe Breite je Zeile und Spielraum
// Wie weit weicht die gemessene Kontur von der passendsten Formfamilie ab (Anteil der Höhe)?
function fitRest(m, w, post) {
  let s = 0, n = 0;
  for (let i = 0; i < m.length; i++) if (w[i] > 0.05) { s += w[i] * Math.abs(m[i] - post[i]); n += w[i]; }
  return n ? s / n : 1;
}

function erwartungAus(erg, h) {
  const u = new Float32Array(h).fill(-1), s = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const wv = erg.silh[y];
    if (wv < 1) continue;
    u[y] = wv;
    const t = clamp(erg.tVon(y), 0, 1);
    const sd = erg.sdModell[Math.round(t * (erg.sdModell.length - 1))] * erg.hTrue;
    s[y] = Math.max(2.5, 2 * sd + 0.012 * erg.hTrue);
  }
  return { u, s, kraft: 1.5 };
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
      if (q[k] <= thr) continue;
      if (q[k] < 0.9 && ref.some(r => 0.5 * (L[k] - r[0]) ** 2 + (A[k] - r[1]) ** 2 + (B[k] - r[2]) ** 2 < 64)) continue;
      kand[k] = 1;
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

function ergebnis(erg, henkel, { IW, IH, x0, y0, w, h, manuell = false }) {
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
      // schwache Kanten oder viel aus dem Formwissen ergänzt: Umriss bitte prüfen
      // passt schlecht zu jeder bekannten Form oder viel ergänzt: Umriss bitte prüfen
      // von Hand verfeinert: gilt als geprüft
      unsicher: !manuell && (erg.fitRest > 0.006 || erg.ergaenzt > 0.15),
      manuell,
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

