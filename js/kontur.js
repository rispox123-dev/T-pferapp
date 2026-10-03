// Kontur begradigen: Messrauschen aus dem Profil nehmen, ohne Kanten zu verschleifen.
//
// Ein Profil wird Zeile für Zeile aus dem Foto gemessen und zittert deshalb um ein, zwei
// Pixel. Getöpferte Stücke bestehen aber aus geraden Wänden, ruhigen Bögen und scharfen
// Kanten (Fußring, Absatz, Rand). Darum:
// 1. Knicke suchen: Stellen, an denen die Wand links und rechts deutlich anders verläuft.
// 2. Jeden Abschnitt zwischen zwei Knicken für sich glätten (lokale Parabel, robust gegen
//    Ausreißer). Weil nie über einen Knick hinweg geglättet wird, bleiben Kanten scharf.
// 3. Fast gerade Abschnitte werden exakt gerade.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Gerade durch (x, y) mit Gewichten: y = a + b·x
function gerade(xs, ys, ws) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1;
    sw += w; sx += w * xs[i]; sy += w * ys[i]; sxx += w * xs[i] * xs[i]; sxy += w * xs[i] * ys[i];
  }
  const d = sw * sxx - sx * sx;
  const b = Math.abs(d) > 1e-12 ? (sw * sxy - sx * sy) / d : 0;
  return { a: (sy - b * sx) / (sw || 1), b };
}

// Lokale Parabel an der Stelle x0 (gewichtete kleinste Quadrate), Wert bei x0
function parabel(xs, ys, ws, x0) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws[i];
    if (!(w > 0)) continue;
    const u = xs[i] - x0, u2 = u * u;
    s0 += w; s1 += w * u; s2 += w * u2; s3 += w * u2 * u; s4 += w * u2 * u2;
    t0 += w * ys[i]; t1 += w * u * ys[i]; t2 += w * u2 * ys[i];
  }
  // 3×3-System lösen (Cramer); bei zu wenig Punkten auf Gerade bzw. Mittelwert ausweichen
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) > 1e-14 * Math.max(1, s0 * s2 * s4)) {
    return (t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)) / det;
  }
  const d2 = s0 * s2 - s1 * s1;
  if (Math.abs(d2) > 1e-14) return (t0 * s2 - s1 * t1) / d2;
  return s0 > 0 ? t0 / s0 : 0;
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  return s.length ? s[s.length >> 1] : 0;
}

// Rauschen des Profils, geschätzt aus den zweiten Differenzen (robust)
export function rauschen(prof) {
  const d2 = [];
  for (let i = 1; i < prof.length - 1; i++) d2.push(Math.abs(prof[i - 1] - 2 * prof[i] + prof[i + 1]));
  return (1.4826 * median(d2)) / Math.sqrt(6);
}

/**
 * Knickstellen eines Profils (Radius/Höhe an n gleichmäßigen Stellen von der Öffnung bis
 * zum Boden). Liefert sortierte Indizes, Anfang und Ende eingeschlossen.
 */
export function knicke(prof, { fenster = 0.04, winkel = 28, sigma = rauschen(prof) } = {}) {
  const n = prof.length;
  const dt = 1 / (n - 1);
  const k = Math.max(3, Math.round(fenster * (n - 1)));
  // Richtungsunterschied, den schon das Rauschen erzeugt (Steigung einer Ausgleichsgeraden
  // über k + 1 Stellen); ein Knick muss deutlich darüber liegen
  let sxx = 0;
  for (let j = 0; j <= k; j++) sxx += (j - k / 2) ** 2;
  const rauschWinkel = Math.atan((Math.SQRT2 * sigma) / (dt * Math.sqrt(sxx))) * 180 / Math.PI;
  const minWinkel = Math.max(winkel, 4 * rauschWinkel);
  const set = new Set([0, n - 1]);

  // Stufen: senkrechter Sprung zwischen zwei Messstellen (z. B. Fußring)
  const sprung = i => Math.abs(prof[i + 1] - prof[i]);
  const minSprung = Math.max(6 * sigma, 2.5 * dt);
  const stufen = [];
  for (let i = 1; i < n - 2; i++) {
    if (sprung(i) > minSprung && sprung(i) >= sprung(i - 1) && sprung(i) > sprung(i + 1)) {
      stufen.push(i);
      set.add(i); set.add(i + 1);
    }
  }

  // Knicke: die Wand verläuft links und rechts der Stelle deutlich anders
  const score = new Float64Array(n);
  for (let i = k; i < n - k; i++) {
    const xl = [], yl = [], xr = [], yr = [];
    for (let j = i - k; j <= i; j++) { xl.push(j * dt); yl.push(prof[j]); }
    for (let j = i; j <= i + k; j++) { xr.push(j * dt); yr.push(prof[j]); }
    const l = gerade(xl, yl), r = gerade(xr, yr);
    score[i] = Math.abs(Math.atan(l.b) - Math.atan(r.b)) * 180 / Math.PI;
  }
  const rad = Math.ceil(k / 2);
  for (let i = k; i < n - k; i++) {
    if (score[i] < minWinkel || stufen.some(s => Math.abs(s - i) <= k)) continue;
    let istMax = true;
    for (let j = Math.max(0, i - rad); j <= Math.min(n - 1, i + rad); j++) {
      if (score[j] > score[i] || (score[j] === score[i] && j < i)) { istMax = false; break; }
    }
    if (istMax) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

// Abschnitt a…b für sich glätten (robuste lokale Parabel)
function abschnitt(prof, a, b, dt, band, tolGerade, sigma) {
  const xs = [], ys = [];
  for (let i = a; i <= b; i++) { xs.push(i * dt); ys.push(prof[i]); }
  const m = xs.length;
  if (m < 4) {
    // sehr kurz: Gerade zwischen den Enden (Stufe, Kante)
    return xs.map((x, i) => ys[0] + ((ys[m - 1] - ys[0]) * i) / Math.max(1, m - 1));
  }
  const h = Math.max(band, 3.5 * dt);
  let robust = new Float64Array(m).fill(1);
  let fit = new Array(m);
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < m; i++) {
      const ws = new Float64Array(m);
      for (let j = 0; j < m; j++) {
        const u = Math.abs(xs[j] - xs[i]) / h;
        ws[j] = u < 1 ? (1 - u * u * u) ** 3 * robust[j] : 0;
      }
      fit[i] = parabel(xs, ys, ws, xs[i]);
    }
    const res = ys.map((y, i) => Math.abs(y - fit[i]));
    const sc = Math.max(1e-4, 6 * median(res));
    robust = Float64Array.from(res, r => (r < sc ? (1 - (r / sc) ** 2) ** 2 : 0));
  }
  // fast gerade Abschnitte exakt gerade: wenn die Glättung kaum von einer Geraden abweicht
  // oder die Messung nicht weiter von der Geraden entfernt liegt, als das Rauschen erklärt
  const g = gerade(xs, ys, robust);
  let maxAbw = 0, q = 0, sw = 0;
  for (let i = 0; i < m; i++) {
    const l = g.a + g.b * xs[i];
    maxAbw = Math.max(maxAbw, Math.abs(fit[i] - l));
    q += robust[i] * (ys[i] - l) ** 2; sw += robust[i];
  }
  if (maxAbw < tolGerade || (m >= 8 && Math.sqrt(q / (sw || 1)) < 1.15 * sigma)) fit = xs.map(x => g.a + g.b * x);
  return fit;
}

/**
 * Profil begradigen. prof: Radius/Höhe an n Stellen (Öffnung … Boden).
 * band: Glättungsbreite in Anteilen der Höhe; gerade: Toleranz für exakt gerade Abschnitte.
 */
export function begradigen(prof, { band = 0.05, gerade: tolGerade = 0.0035, ...opt } = {}) {
  const n = prof.length;
  if (n < 8) return Array.from(prof);
  const dt = 1 / (n - 1);
  const sigma = rauschen(prof);
  const ks = knicke(prof, { sigma, ...opt });

  // Abschnitte glätten; wo die Glättung systematisch neben der Messung liegt, war dort ein
  // übersehener Knick: teilen und neu glätten
  let fits;
  for (let runde = 0; runde < 8; runde++) {
    fits = [];
    let neu = null;
    for (let s = 0; s < ks.length - 1; s++) {
      const a = ks[s], b = ks[s + 1];
      const fit = abschnitt(prof, a, b, dt, band, tolGerade, sigma);
      fits.push(fit);
      if (neu != null || b - a < 6) continue;
      let best = 0, idx = -1;
      for (let i = a + 2; i <= b - 2; i++) {
        const r = prof[i] - fit[i - a];
        const rl = prof[i - 1] - fit[i - 1 - a], rr = prof[i + 1] - fit[i + 1 - a];
        // drei Stellen in Folge deutlich daneben, gleiche Richtung: kein Ausreißer
        if (Math.abs(r) > 4 * sigma + 0.002 && Math.sign(rl) === Math.sign(r) && Math.sign(rr) === Math.sign(r)
          && Math.abs(rl) > 2.5 * sigma && Math.abs(rr) > 2.5 * sigma && Math.abs(r) > best) {
          best = Math.abs(r); idx = i;
        }
      }
      if (idx > 0) neu = idx;
    }
    if (neu == null) break;
    ks.push(neu);
    ks.sort((p, q) => p - q);
  }

  // an den Knicken treffen sich zwei Abschnitte: Mittelwert
  const sum = new Float64Array(n), cnt = new Float64Array(n);
  fits.forEach((fit, s) => fit.forEach((v, i) => { sum[ks[s] + i] += v; cnt[ks[s] + i]++; }));
  return Array.from(sum, (v, i) => Math.max(0, cnt[i] ? v / cnt[i] : prof[i]));
}

/**
 * Geschlossene Kontur (Henkel) glätten: gleichmäßig neu abtasten und ringförmig mit einer
 * Glockenkurve mitteln. sigma: Anteil des Umfangs.
 */
export function glattGeschlossen(pts, { sigma = 0.025, punkte = 120 } = {}) {
  if (pts.length < 4) return pts;
  const L = [0];
  for (let i = 1; i <= pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i % pts.length];
    L.push(L[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const U = L[L.length - 1];
  if (!(U > 0)) return pts;
  const N = punkte;
  const res = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = (k / N) * U;
    while (j < pts.length - 1 && L[j + 1] < s) j++;
    const [ax, ay] = pts[j], [bx, by] = pts[(j + 1) % pts.length];
    const f = clamp((s - L[j]) / ((L[j + 1] - L[j]) || 1), 0, 1);
    res.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
  }
  const sg = Math.max(0.5, sigma * N);
  const r = Math.ceil(3 * sg);
  const kern = [];
  let ks = 0;
  for (let d = -r; d <= r; d++) { const w = Math.exp(-(d * d) / (2 * sg * sg)); kern.push(w); ks += w; }
  return res.map((_, i) => {
    let x = 0, y = 0;
    for (let d = -r; d <= r; d++) {
      const [px, py] = res[(((i + d) % N) + N) % N];
      x += kern[d + r] * px; y += kern[d + r] * py;
    }
    return [x / ks, y / ks];
  });
}

// Geschlossene, glatte Kurve als SVG-Pfad (Catmull-Rom → kubische Bézierkurven)
export function glatterPfad(pts) {
  const n = pts.length;
  if (n < 3) return '';
  const P = i => pts[((i % n) + n) % n];
  let d = `M${P(0)[0].toFixed(1)} ${P(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P(i - 1), [x1, y1] = P(i), [x2, y2] = P(i + 1), [x3, y3] = P(i + 2);
    d += `C${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)} ${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return d + 'Z';
}
