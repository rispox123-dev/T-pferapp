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

export function analyze(src, { crop = DEFAULT_CROP, sens = DEFAULT_SENS, brush = [] } = {}) {
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

  // Halbe Breite je Zeile. Sind beide Seiten gleich, wird gemittelt. Sonst zählt die
  // schmalere Seite (Henkel und Schatten machen eine Seite breiter) – außer sie hat dort
  // eine kurze Delle, z. B. durch eine Spiegelung am Rand; dann zählt die andere Seite.
  const A = [], B = [];
  for (let y = top; y <= bottom; y++) {
    A.push(Math.max(0, axis - left[y] + 0.5));
    B.push(Math.max(0, right[y] - axis + 0.5));
  }
  const win = Math.max(3, Math.round(A.length * 0.08));
  const medA = median(A, 2 * win + 1);
  const medB = median(B, 2 * win + 1);
  let hw = A.map((a, i) => {
    const b = B[i];
    const tol = Math.max(2, 0.03 * Math.max(a, b));
    if (Math.abs(a - b) <= tol) return (a + b) / 2;
    const aSmall = a < b;
    const dented = aSmall ? medA[i] - a > tol : medB[i] - b > tol;
    return aSmall !== dented ? a : b;
  });
  hw = smooth(median(hw, 5), Math.max(1, Math.round(hw.length * 0.008)));

  // Perspektive ausgleichen: Von oben fotografiert ist die Öffnung eine Ellipse, deren
  // hintere Hälfte oben die Silhouette bildet. An diesen Bogen wird eine Ellipse angepasst
  // (robust gegen Glanzlichter am Rand); ihre Mitte ist die eigentliche Randhöhe.
  // Die Neigung (Tiefe/Breite) bestimmt dann, wie tief die Bodenellipse unten reicht.
  const L = hw.length;
  const lim = Math.round(L * 0.15);
  let walk = 0;
  while (walk < lim && (hw[Math.min(L - 1, walk + 4)] - hw[walk]) / 4 > 0.35) walk++;
  const rimEnd = Math.min(Math.round(L * 0.2), 2 * walk + 10);
  let rx = 0;
  for (let i = 0; i <= rimEnd; i++) rx = Math.max(rx, hw[i]);
  // Für jede Zeile im Bogen: Abstand zur Spitze = ry · (1 − √(1 − (w/rx)²)) → lineare Regression
  // nur der Teil, in dem die Breite von oben her zunimmt (bis zur ersten vollen Breite)
  let rimMax = 0;
  while (rimMax < rimEnd && hw[rimMax] < rx * 0.99) rimMax++;
  const fit = [];
  for (let i = 0; i <= rimMax; i++) {
    const q = hw[i] / rx;
    if (q >= 0.25 && q <= 0.95) fit.push([1 - Math.sqrt(1 - q * q), i]);
  }
  let ryTop = walk;
  if (fit.length >= 4) {
    const mf = fit.reduce((a, p) => a + p[0], 0) / fit.length;
    const mi = fit.reduce((a, p) => a + p[1], 0) / fit.length;
    let cov = 0, vf = 0;
    for (const [f, i] of fit) { cov += (f - mf) * (i - mi); vf += (f - mf) ** 2; }
    if (vf > 1e-6) {
      const ry = cov / vf;
      const tip = mi - ry * mf;
      if (ry > 0) ryTop = clamp(Math.round(tip + ry), walk, Math.max(walk, rimMax));
    }
  }
  const tilt = Math.min(0.5, ryTop / Math.max(1, rx));

  // Unten: sichtbaren Bogen der Bodenellipse messen und mit der Neigung von oben abgleichen
  let up = 0;
  while (up < lim && (hw[Math.max(0, L - 5 - up)] - hw[L - 1 - up]) / 4 > 0.35) up++;
  const footW = hw[L - 1 - up];
  const expected = tilt * footW;
  const ryBot = Math.min(Math.round(L * 0.12), Math.round(clamp(up, expected * 0.7, expected * 1.4)));
  hw = hw.slice(ryTop, L - ryBot);
  top += ryTop;
  bottom -= ryBot;

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

  // Ausschnitt: tatsächliche Silhouette aus dem Foto (mit Henkel, so wie fotografiert)
  const sil = buildSilhouette({ comp, bestId, dist, T, w, h, axis, top, hw, ryTop, ryBot, brush, IW, IH, x0, y0, hgt });
  // Sichtbare Linien im Stück (Öffnung, Rillen, Fußkante …)
  const inner = detectInnerLines({ Y, U, V, w, h, mask: sil.mask, axis, top, hgt, rmax: Math.max(...hw), rimZone: tilt * hw[0] * 1.6 + 0.02 * hgt });

  return {
    profile,
    tilt: Math.round(tilt * 1000) / 1000,
    silhouette: { outlines: sil.outlines, inner },
    outline: {
      left: outlineL, right: outlineR, axis: (axis + x0) / IW, top: (top + y0) / IH, bottom: (bottom + y0) / IH,
      silhouette: sil.outlineRel,
    },
  };
}

// ---------------------------------------------------------------------------
// Ausschnitt (Silhouette)
// ---------------------------------------------------------------------------

function buildSilhouette({ comp, bestId, dist, T, w, h, axis, top, hw, ryTop, ryBot, brush, IW, IH, x0, y0, hgt }) {
  const n = w * h;
  const L = hw.length;
  const r0 = hw[0], rN = hw[L - 1];
  // Halbe Breite des gedrehten Körpers in Zeile y (inkl. Rand- und Bodenellipse)
  const bodyHalf = y => {
    const row = y - top;
    if (row < 0) {
      if (ryTop <= 0 || row < -ryTop) return -1;
      return r0 * Math.sqrt(Math.max(0, 1 - (row / ryTop) ** 2));
    }
    if (row >= L) {
      const d = row - (L - 1);
      if (ryBot <= 0 || d > ryBot) return -1;
      return rN * Math.sqrt(Math.max(0, 1 - (d / ryBot) ** 2));
    }
    return hw[row];
  };
  const margin = 1.5 + 0.006 * hgt;

  let M = new Uint8Array(n);
  let area = 0;
  for (let k = 0; k < n; k++) if (comp[k] === bestId) { M[k] = 1; area++; }

  for (let y = 0; y < h; y++) {
    const r = bodyHalf(y);
    const nearBase = y - top > L * 0.92;
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const off = Math.abs(x - axis) - r;
      if (r >= 0 && off <= 0) M[k] = 1; // Dellen durch Spiegelungen im Körper füllen
      else if (M[k] && (r < 0 || nearBase) && off > margin) M[k] = 0; // Schatten am Fuß / über dem Rand
    }
  }

  // Löcher außerhalb des Körpers (z. B. im Henkel): hintergrundfarbene Flächen ausschneiden
  const holeCand = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const r = bodyHalf(y);
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (M[k] && dist[k] < T && (r < 0 || Math.abs(x - axis) - r > margin)) holeCand[k] = 1;
    }
  }
  {
    const { lab, info } = components(holeCand, w, h, 1);
    for (let k = 0; k < n; k++) if (lab[k] && info[lab[k] - 1].area >= Math.max(20, area * 0.002)) M[k] = 0;
  }

  // Schatten auf dem Tisch: Teile außerhalb des Körpers, die nur im unteren Bereich liegen
  {
    const outside = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const r = bodyHalf(y);
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (M[k] && (r < 0 || Math.abs(x - axis) - r > margin)) outside[k] = 1;
      }
    }
    const { lab, info } = components(outside, w, h, 1);
    const minY = new Float32Array(info.length + 1).fill(Infinity);
    const maxY = new Float32Array(info.length + 1).fill(-Infinity);
    for (let k = 0; k < n; k++) if (lab[k]) {
      const y = Math.floor(k / w);
      if (y < minY[lab[k]]) minY[lab[k]] = y;
      if (y > maxY[lab[k]]) maxY[lab[k]] = y;
    }
    for (let k = 0; k < n; k++) {
      const id = lab[k];
      if (id && minY[id] > top + L * 0.45 && maxY[id] > top + L * 0.8) M[k] = 0;
    }
  }

  // Korrekturen mit dem Finger: Hinzufügen / Entfernen (spätere Striche gewinnen)
  if (brush.length) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of brush) {
      ctx.strokeStyle = ctx.fillStyle = st.erase ? '#000' : '#fff';
      ctx.lineWidth = 2 * st.r * IW;
      const px = ([x, y]) => [x * IW - x0, y * IH - y0];
      ctx.beginPath();
      st.pts.forEach((q, i) => { const [x, y] = px(q); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (st.pts.length === 1) { const [x, y] = px(st.pts[0]); ctx.arc(x, y, st.r * IW, 0, Math.PI * 2); ctx.fill(); }
      else ctx.stroke();
    }
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let k = 0; k < n; k++) {
      if (d[k * 4 + 3] < 128) continue;
      if (d[k * 4] > 128) { if (dist[k] >= T * 0.5) M[k] = 1; } else M[k] = 0;
    }
  }

  // Bereinigen
  M = dilate(erode(M, w, h, 1), w, h, 1);
  M = erode(dilate(M, w, h, 1), w, h, 1);
  M = keepLarge(M, w, h);
  M = fillHolesBelow(M, w, h, Math.max(20, area * 0.002));

  const outlines = [];
  const outlineRel = [];
  for (const c of traceContours(M, w, h)) {
    if (c.length < 12) continue;
    const pts = smoothClosed(simplifyClosed(c, 0.7), 2);
    outlineRel.push(pts.map(([x, y]) => [(x + x0) / IW, (y + y0) / IH]));
    outlines.push(pts.map(([x, y]) => [Math.round(((x - axis) / hgt) * 10000) / 10000, Math.round(((y - top) / hgt) * 10000) / 10000]));
  }
  return { mask: M, outlines, outlineRel };
}

function fillHolesBelow(A, W, H, maxArea) {
  const { lab, info } = components(A, W, H, 0);
  const out = A.slice();
  for (let k = 0; k < W * H; k++) {
    if (lab[k]) { const i = info[lab[k] - 1]; if (!i.border && i.area < maxArea) out[k] = 1; }
  }
  return out;
}

// Linien im Stück finden: Kanten (Canny-artig) auf geglättetem Bild, nur lange,
// eher waagrechte Linien – so bleiben Rand, Rillen und Fußkante, das Craquelé fällt weg.
function detectInnerLines({ Y, U, V, w, h, mask, axis, top, hgt, rmax, rimZone }) {
  const n = w * h;
  const blur = src => {
    let a = Float32Array.from(src);
    const k = [1, 4, 6, 4, 1];
    for (let pass = 0; pass < 3; pass++) {
      const t = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, ws = 0;
        for (let j = -2; j <= 2; j++) { const xx = x + j; if (xx >= 0 && xx < w) { s += a[y * w + xx] * k[j + 2]; ws += k[j + 2]; } }
        t[y * w + x] = s / ws;
      }
      const o = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, ws = 0;
        for (let j = -2; j <= 2; j++) { const yy = y + j; if (yy >= 0 && yy < h) { s += t[yy * w + x] * k[j + 2]; ws += k[j + 2]; } }
        o[y * w + x] = s / ws;
      }
      a = o;
    }
    return a;
  };
  const bY = blur(Y), bU = blur(U), bV = blur(V);
  // Innenbereich (Abstand zur Silhouette)
  const inside = erode(mask, w, h, 4);
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n);
  const vals = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (!inside[k]) continue;
    let gx = 0, gy = 0;
    for (const ch of [bY, bU, bV]) {
      const wgt = ch === bY ? 1.6 : 0.6;
      const cx = (ch[k + 1] - ch[k - 1]) * wgt, cy = (ch[k + w] - ch[k - w]) * wgt;
      gx += cx * Math.abs(cx); gy += cy * Math.abs(cy);
    }
    gx = Math.sign(gx) * Math.sqrt(Math.abs(gx)); gy = Math.sign(gy) * Math.sqrt(Math.abs(gy));
    const m = Math.hypot(gx, gy);
    mag[k] = m;
    const ang = (Math.atan2(gy, gx) * 180) / Math.PI;
    const a = (ang + 180) % 180;
    dir[k] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    vals.push(m);
  }
  if (vals.length < 100) return [];
  vals.sort((a, b) => a - b);
  const hi = vals[Math.floor(vals.length * 0.93)];
  const lo = hi * 0.45;
  // Nicht-Maximum-Unterdrückung
  const edge = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    const m = mag[k];
    if (m < lo) continue;
    const [a, b] = [[k - 1, k + 1], [k - w - 1, k + w + 1], [k - w, k + w], [k - w + 1, k + w - 1]][dir[k]];
    if (m >= mag[a] && m >= mag[b]) edge[k] = m >= hi ? 2 : 1;
  }
  // Hysterese: schwache Kanten nur, wenn mit starken verbunden
  const strong = new Uint8Array(n);
  const queue = [];
  for (let k = 0; k < n; k++) if (edge[k] === 2) { strong[k] = 1; queue.push(k); }
  while (queue.length) {
    const k = queue.pop();
    for (const d of [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1]) {
      const q = k + d;
      if (q >= 0 && q < n && edge[q] && !strong[q]) { strong[q] = 1; queue.push(q); }
    }
  }
  // Ketten verfolgen
  const nb = k => [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1].map(d => k + d).filter(q => q >= 0 && q < n && strong[q]);
  const seen = new Uint8Array(n);
  const chains = [];
  const walk = s => {
    const chain = [];
    let cur = s;
    while (cur !== undefined && !seen[cur]) {
      seen[cur] = 1;
      chain.push([cur % w, Math.floor(cur / w)]);
      cur = nb(cur).find(q => !seen[q]);
    }
    return chain;
  };
  for (let k = 0; k < n; k++) if (strong[k] && !seen[k] && nb(k).length <= 1) chains.push(walk(k));
  for (let k = 0; k < n; k++) if (strong[k] && !seen[k]) chains.push(walk(k));

  const minLen = 0.25 * 2 * rmax;
  const lines = [];
  for (const c of chains) {
    if (c.length < minLen) continue;
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    if (bw < minLen || bh > bw * 0.5) continue; // nur lange, eher waagrechte Linien
    if (Math.max(...ys) < top + rimZone) continue; // Öffnung wird als Ellipse gezeichnet
    const [sx, sy] = c[0], [ex, ey] = c[c.length - 1];
    if (Math.hypot(ex - sx, ey - sy) < bw * 0.3 && bw < 1.4 * rmax) continue; // geschlossene Ringe = Glanzlichter
    const pts = smoothOpen(simplifyOpen(c, 1), 2);
    lines.push(pts.map(([x, y]) => [Math.round(((x - axis) / hgt) * 10000) / 10000, Math.round(((y - top) / hgt) * 10000) / 10000]));
  }
  return lines.slice(0, 12);
}

function simplifyOpen(arr, eps) {
  if (arr.length < 3) return arr;
  const [ax, ay] = arr[0], [bx, by] = arr[arr.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let maxD = -1, idx = 0;
  for (let i = 1; i < arr.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - arr[i][1]) - (ax - arr[i][0]) * (by - ay)) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [arr[0], arr[arr.length - 1]];
  return [...simplifyOpen(arr.slice(0, idx + 1), eps).slice(0, -1), ...simplifyOpen(arr.slice(idx), eps)];
}

function smoothOpen(pts, iterations) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const out = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i], [bx, by] = cur[i + 1];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

function erode(A, W, H, r) {
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

function dilate(A, W, H, r) {
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
function components(A, W, H, val) {
  const N = W * H;
  const lab = new Int32Array(N);
  const queue = new Int32Array(N);
  const info = [];
  for (let s = 0; s < N; s++) {
    if (A[s] !== val || lab[s]) continue;
    const id = info.length + 1;
    let qh = 0, qt = 0, area = 0, border = false;
    queue[qt++] = s;
    lab[s] = id;
    while (qh < qt) {
      const p = queue[qh++];
      area++;
      const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && A[p - 1] === val && !lab[p - 1]) { lab[p - 1] = id; queue[qt++] = p - 1; }
      if (x < W - 1 && A[p + 1] === val && !lab[p + 1]) { lab[p + 1] = id; queue[qt++] = p + 1; }
      if (y > 0 && A[p - W] === val && !lab[p - W]) { lab[p - W] = id; queue[qt++] = p - W; }
      if (y < H - 1 && A[p + W] === val && !lab[p + W]) { lab[p + W] = id; queue[qt++] = p + W; }
    }
    info.push({ area, border });
  }
  return { lab, info };
}

function keepLarge(A, W, H) {
  const { lab, info } = components(A, W, H, 1);
  const maxArea = Math.max(0, ...info.map(i => i.area));
  const out = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) if (lab[k] && info[lab[k] - 1].area >= Math.max(30, maxArea * 0.1)) out[k] = 1;
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
      // Kantenmitten (doppelt, damit ganzzahlig): oben, rechts, unten, links
      const T_ = [2 * x + 1, 2 * y], R = [2 * x + 2, 2 * y + 1], B = [2 * x + 1, 2 * y + 2], L = [2 * x, 2 * y + 1];
      const segs = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T_, R]], 5: [[T_, L], [B, R]], 6: [[T_, B]], 7: [[T_, L]],
        8: [[T_, L]], 9: [[T_, B]], 10: [[T_, R], [L, B]], 11: [[T_, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      }[c];
      for (const [a, b] of segs) link(a, b);
    }
  }
  const seen = new Set();
  const contours = [];
  for (const [start, node] of adj) {
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
    void node;
  }
  return contours;
}

function simplifyClosed(pts, eps) {
  const dp = (arr) => {
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

// Chaikin-Glättung für geschlossene Linien
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
  const rAt = profileAt(prof);
  const sil = bp.silhouette;
  const ell = sil ? Math.max(0.04, bp.tilt ?? ELLIPSE) : ELLIPSE;

  // Ältere Blaupausen ohne Ausschnitt: Anbauten links zeichnen
  const rawAtt = sil ? [] : bp.attachments || [];
  const flip = rawAtt.length && rawAtt.every(a => a.side === 'right') ? -1 : 1;
  const atts = rawAtt.map(a => ({ ...a, lines: a.lines.map(l => l.map(([x, t]) => [x * flip, t])) }));

  // Henkel im Ausschnitt finden: Teile der Außenkontur, die deutlich über den Körper hinausragen
  let handle = null;
  if (sil?.outlines.length) {
    const outer = sil.outlines.reduce((a, b) => (b.length > a.length ? b : a));
    const off = outer.filter(([x, t]) => t > -0.05 && t < 1.05 && Math.abs(x) - rAt(Math.max(0, Math.min(1, t))) > 0.05);
    if (off.length >= 8) {
      const ts = off.map(p => p[1]);
      const t0 = Math.min(...ts), t1 = Math.max(...ts);
      if (t1 - t0 > 0.1) {
        const side = Math.sign(off.reduce((a, p) => a + p[0], 0)) || 1;
        handle = { t0, t1, side, reach: Math.max(...off.map(([x, t]) => Math.abs(x) - rAt(Math.max(0, Math.min(1, t))))) };
      }
    }
  }
  // Beschriftung auf die Seite ohne Henkel, Höhenmaß auf die andere
  const side = handle?.side > 0 ? -1 : 1;

  const ext = sil ? [...sil.outlines.flat(), ...sil.inner.flat()] : atts.flatMap(a => a.lines.flat());
  const extL = Math.max(rmax, ...ext.map(p => -p[0]));
  const extR = Math.max(rmax, ...ext.map(p => p[0]));
  const minT = Math.min(0, ...ext.map(p => p[1]));
  const maxT = Math.max(1, ...ext.map(p => p[1]));

  const Hd = Math.min(340, 184 / (extL + extR));
  const half = rmax * Hd;
  const titleLines = wrap(title, 22).slice(0, 2);
  const titleH = titleLines.length ? 30 + titleLines.length * 26 : 24;
  const top = titleH + Math.max(prof[0] * Hd * ell, -minT * Hd) + 22;
  const bottom = top + Hd;
  const axis = (side > 0 ? 64 : 152) + extL * Hd;
  const labelX = side > 0 ? Math.min(axis + extR * Hd + 34, W - 118) : Math.max(axis - extL * Hd - 34, 118);
  const hx = side > 0 ? axis - extL * Hd - 30 : axis + extR * Hd + 30;
  const est = estimate(bp, values, pos);

  const points = effectivePoints(bp);
  const yOf = t => top + t * Hd;
  const X = x => (axis + x * Hd).toFixed(1);
  const Yt = t => yOf(t).toFixed(1);
  const arc = (t, front) => {
    const rx = rAt(t) * Hd;
    const ry = rx * ell;
    const y = yOf(t);
    return `M${(axis - rx).toFixed(1)} ${y.toFixed(1)}A${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 ${front ? 0 : 1} ${(axis + rx).toFixed(1)} ${y.toFixed(1)}`;
  };

  const interior = points.filter(p => p.t != null && p.t > 0 && p.t < 1);
  let shape = '';
  if (sil) {
    // Ausschnitt wie fotografiert: Außenkontur, Löcher, Linien im Stück
    for (const o of sil.outlines) shape += `<path d="${o.map(([x, t], i) => `${i ? 'L' : 'M'}${X(x)} ${Yt(t)}`).join('')}Z"/>`;
    for (const l of sil.inner) shape += `<path d="${l.map(([x, t], i) => `${i ? 'L' : 'M'}${X(x)} ${Yt(t)}`).join('')}" class="inner"/>`;
    shape += `<path d="${arc(0, true)}"/>`;
    shape += `<path d="${arc(1, false)}" class="dash"/>`;
  } else {
    const contour = sgn => prof.map((r, i) => `${i ? 'L' : 'M'}${(axis + sgn * r * Hd).toFixed(1)} ${yOf(i / (n - 1)).toFixed(1)}`).join('');
    shape += `<path d="${contour(-1)}"/><path d="${contour(1)}"/>`;
    shape += `<ellipse cx="${axis}" cy="${top}" rx="${(prof[0] * Hd).toFixed(1)}" ry="${(prof[0] * Hd * ell).toFixed(1)}"/>`;
    shape += `<path d="${arc(1, true)}"/><path d="${arc(1, false)}" class="dash"/>`;
    for (const a of atts) for (const l of a.lines) shape += `<path d="${l.map(([x, t], i) => `${i ? 'L' : 'M'}${X(x)} ${Yt(t)}`).join('')}"/>`;
  }
  for (const p of interior) shape += `<path d="${arc(p.t, true)}" class="thin"/><path d="${arc(p.t, false)}" class="dash"/>`;

  // Henkelmaße als Text: Ansatzhöhen und wie weit er absteht
  const handles = handle ? [{ ...handle, name: 'Henkel' }] : atts.map((a, i) => {
    const pts = a.lines.flat();
    return {
      t0: Math.min(...pts.map(p => p[1])), t1: Math.max(...pts.map(p => p[1])),
      reach: Math.max(0, ...pts.map(([x, t]) => Math.abs(x) - rAt(Math.max(0, Math.min(1, t))))),
      name: a.label || (atts.length > 1 ? `Anbau ${i + 1}` : 'Henkel'),
    };
  });
  const attInfo = [];
  for (const a of handles) {
    if (est.scale) {
      attInfo.push(`${a.name}: ≈ ${fmtCm((a.t1 - a.t0) * est.scale)} hoch, steht ≈ ${fmtCm(a.reach * est.scale)} ab`);
      attInfo.push(`ansetzen auf ≈ ${fmtCm(Math.max(0, 1 - a.t1) * est.scale)} und ≈ ${fmtCm(Math.max(0, 1 - a.t0) * est.scale)} Höhe`);
    } else {
      attInfo.push(`${a.name}: ${Math.round((a.t1 - a.t0) * 100)} % der Höhe, steht ${Math.round(a.reach * 100)} % ab`);
    }
  }
  info = [...info, ...attInfo];

  // Beschriftungen ohne Überlappung
  const items = points.filter(p => p.t != null).map(p => ({ p, yA: yOf(p.t), xA: axis + side * rAt(p.t) * Hd })).sort((a, b) => a.yA - b.yA);
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
  const anchor = side > 0 ? '' : ' text-anchor="end"';
  let labels = '';
  for (const { p, yA, xA, yL } of items) {
    const v = valueText(p);
    const ps = posText(p);
    labels += `<path d="M${(xA + side * 4).toFixed(1)} ${yA.toFixed(1)}L${labelX - side * 22} ${yA.toFixed(1)}L${labelX - side * 8} ${yL.toFixed(1)}" class="lead"/>`;
    labels += `<circle cx="${xA.toFixed(1)}" cy="${yA.toFixed(1)}" r="3" class="dot"/>`;
    const rx = side > 0 ? labelX - 8 : 2;
    const rw = side > 0 ? W - labelX + 6 : labelX + 6;
    labels += `<g class="lbl"${btn(p.key)}><rect x="${rx}" y="${(yL - 19).toFixed(1)}" width="${rw}" height="44" rx="8" class="hit"/>
      <text x="${labelX}" y="${(yL - 4).toFixed(1)}" class="name"${anchor}>${escXml(p.label)}</text>
      <text x="${labelX}" y="${(yL + 12).toFixed(1)}" class="${v.cls}"${anchor}>${escXml(v.text)}</text>
      ${ps ? `<text x="${labelX}" y="${(yL + 24).toFixed(1)}" class="pos"${anchor}>${escXml(ps)}</text>` : ''}</g>`;
  }

  // Höhenmaß auf der anderen Seite
  const hp = points.find(p => p.key === 'hoehe');
  let height = '';
  if (hp) {
    const v = valueText(hp);
    const mid = (top + bottom) / 2;
    height += `<path d="M${hx} ${top}V${bottom}M${hx - 6} ${top}h12M${hx - 6} ${bottom}h12M${hx - 4} ${top + 7}l4 -7l4 7M${hx - 4} ${bottom - 7}l4 7l4 -7" class="dim"/>`;
    for (const p of interior) {
      const y = yOf(p.t).toFixed(1);
      const edge = axis - side * (rAt(p.t) * Hd + 6);
      height += `<path d="M${hx - 4} ${y}h8" class="dim"/><path d="M${hx + side * 6} ${y}L${edge.toFixed(1)} ${y}" class="guide"/>`;
    }
    const tx = side > 0 ? hx - 12 : hx + 22;
    height += `<g class="lbl"${btn('hoehe')}><rect x="${tx - 22}" y="${mid - 80}" width="30" height="160" rx="8" class="hit"/>
      <text transform="translate(${tx} ${mid}) rotate(-90)" text-anchor="middle" class="${v.cls}">Höhe ${escXml(v.text)}</text></g>`;
  }

  const lastLabel = items.length ? items[items.length - 1].yL + 34 : 0;
  const infoTop = Math.max(Math.max(bottom + rAt(1) * Hd * ell, top + maxT * Hd) + 40, lastLabel + 16);
  const infoSvg = info.map((line, i) => `<text x="22" y="${infoTop + i * 21}" class="info${i ? '' : ' strong'}">${escXml(line)}</text>`).join('');
  const H = Math.ceil(infoTop + Math.max(0, info.length - 1) * 21 + 26);

  const cr = crackle(W, H, seed);
  const titleSvg = titleLines.map((l, i) => `<text x="${W - 20}" y="${40 + i * 26}" text-anchor="end" class="title">${escXml(l)}</text>`).join('');

  return `<svg class="blueprint" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Blaupause ${escXml(title)}">
  <style>
    #${uid} text { font-family: "Avenir Next", Futura, "Century Gothic", -apple-system, "Segoe UI", sans-serif; fill: ${INK}; }
    #${uid} .shape path, #${uid} .shape ellipse { fill: none; stroke: ${LINE}; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    #${uid} .shape .thin { stroke-width: 1.6; opacity: .8; }
    #${uid} .shape .inner { stroke-width: 1.8; opacity: .9; }
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
