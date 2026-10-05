// Blaupause: markante Stellen einer Kontur, Maße schätzen und die Zeichnung.
//
// Die Kontur (Profil) kommt aus der Formerkennung (erkennung.js): Radius/Höhe an
// PROFILE_POINTS Stellen von der Öffnung (t = 0) bis zum Boden (t = 1), dazu Henkel.
// Gezeichnet wird das Stück aus leicht erhöhter Sicht, damit Öffnung und Boden als
// Ellipsen erscheinen – auch wenn das Foto frontal aufgenommen wurde.

export { PROFILE_POINTS } from './erkennung.js';
import { begradigen, glattGeschlossen, glatterPfad } from './kontur.js';

// Blickwinkel der Zeichnung (Grad über der Waagrechten)
export const BLICK = 18;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Markante Stellen
// ---------------------------------------------------------------------------

// Begriffe am Gefäß (wie am menschlichen Körper, von oben nach unten):
//   Öffnung  – oberer Rand (Mündung)
//   Schulter – oberer Teil des Körpers, wo die Wand vom Bauch zur engeren Öffnung
//              (oder Taille) hin einbiegt; Stelle der stärksten Biegung dort
//   Bauch    – größter Durchmesser, nur wenn die Wand darüber und darunter wieder enger wird
//   Taille   – Einziehung: engste Stelle zwischen zwei weiteren Teilen
//   Fuß      – Standfläche unten; Fußring, wenn sie durch eine Stufe/Kante abgesetzt ist
// Eine Stelle wird nur markiert, wenn sich die Form dort wirklich ändert – eine gerade
// oder gleichmäßig konische Wand hat weder Bauch noch Taille.
export function findPoints(roh) {
  const profile = begradigen(roh);
  const n = profile.length;
  const rmax = Math.max(...profile);
  // spürbare Formänderung: 5 % des größten Radius, mindestens 1,5 % der Höhe
  const minProm = Math.max(0.05 * rmax, 0.015);
  const lo = Math.round(n * 0.06), hi = Math.round(n * 0.94);
  const t = i => Math.round((i / (n - 1)) * 1000) / 1000;
  const m = i => Math.round(2 * profile[i] * 10000) / 10000;
  const maxBis = (a, b) => { let v = -Infinity; for (let i = a; i <= b; i++) v = Math.max(v, profile[i]); return v; };
  const minBis = (a, b) => { let v = Infinity; for (let i = a; i <= b; i++) v = Math.min(v, profile[i]); return v; };

  // Bauch: weiteste Stelle innen, oberhalb und unterhalb deutlich enger
  let bauch = -1;
  for (let i = lo; i <= hi; i++) {
    const v = profile[i];
    if (bauch >= 0 && v <= profile[bauch]) continue;
    if (v - minBis(0, i) > minProm && v - minBis(i, n - 1) > minProm) bauch = i;
  }
  if (bauch >= 0 && maxBis(0, n - 1) > profile[bauch] + 1e-6) {
    // es gibt eine weitere Stelle (z. B. ausgestellte Öffnung): Bauch nur, wenn er dort ein echtes Maximum ist
    const umg = Math.round(n * 0.04);
    if (profile[bauch] < maxBis(Math.max(0, bauch - umg), Math.min(n - 1, bauch + umg)) - 1e-6) bauch = -1;
  }

  // Taille: engste Stelle mit deutlich weiteren Teilen darüber und darunter
  const taillen = [];
  for (let i = lo; i <= hi; i++) {
    const v = profile[i];
    const umg = Math.round(n * 0.03);
    if (v > minBis(Math.max(0, i - umg), Math.min(n - 1, i + umg)) + 1e-9) continue;
    const prom = Math.min(maxBis(0, i), maxBis(i, n - 1)) - v;
    if (prom > minProm && !taillen.some(c => Math.abs(c.i - i) <= umg)) taillen.push({ i, prom });
  }
  // höchstens eine Taille oberhalb und eine unterhalb des Bauchs
  const wahl = list => list.sort((x, y) => y.prom - x.prom)[0];
  const tl = bauch >= 0
    ? [wahl(taillen.filter(c => c.i < bauch)), wahl(taillen.filter(c => c.i > bauch))].filter(Boolean)
    : [wahl(taillen)].filter(Boolean);

  // Fußring: unten ein abgesetztes Stück mit (fast) senkrechter Wand, darüber eine Stufe bzw.
  // ein Knick, an dem die Wand deutlich einspringt. Ein runder Boden ist kein Fußring.
  const dt = 1 / (n - 1);
  const k = Math.max(3, Math.round(n * 0.03));
  let ring = false;
  for (let i = Math.round(n * 0.7); i <= n - 1 - k && !ring; i++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    for (let j = i; j < n; j++) { const x = j * dt, y = profile[j]; sx += x; sy += y; sxx += x * x; sxy += x * y; c++; }
    const sB = (c * sxy - sx * sy) / (c * sxx - sx * sx || 1);
    let rest = 0;
    for (let j = i; j < n; j++) rest = Math.max(rest, Math.abs(profile[j] - (sy / c + sB * (j * dt - sx / c))));
    const sprung = Math.abs(profile[i - k] - profile[i] - -sB * k * dt);
    if (Math.abs(sB) < 0.5 && rest < 0.006 && sprung > Math.max(0.06 * rmax, 0.015)) ring = true;
  }

  // Schulter: über dem Bauch biegt die Wand zur engeren Öffnung/Taille ein; Stelle der
  // stärksten Biegung, deutlich vom Bauch abgesetzt
  let schulter = -1;
  if (bauch >= 0) {
    const oben = tl.find(c => c.i < bauch)?.i ?? 0;
    if (profile[bauch] - profile[oben] > 2 * minProm) {
      const d = Math.max(2, Math.round(n * 0.03));
      let best = 0;
      for (let i = oben + d; i <= bauch - d; i++) {
        const kr = profile[i - d] - 2 * profile[i] + profile[i + d]; // < 0: Wand biegt nach innen
        if (-kr > best) { best = -kr; schulter = i; }
      }
      const abstand = Math.round(n * 0.07);
      if (schulter >= 0 && (bauch - schulter < abstand || schulter - oben < abstand || best < 0.004
        // sichtbar enger als der Bauch und sichtbar weiter als Öffnung/Taille darüber
        || profile[bauch] - profile[schulter] < 0.5 * minProm || profile[schulter] - profile[oben] < minProm)) schulter = -1;
    }
  }

  const points = [
    { key: 'hoehe', label: 'Höhe', t: null, m: 1 },
    { key: 'rand', label: 'Ø Öffnung', t: 0, m: m(0) },
  ];
  if (schulter >= 0) points.push({ key: 'schulter', label: 'Ø Schulter', t: t(schulter), m: m(schulter) });
  if (bauch >= 0) points.push({ key: 'bauch', label: 'Ø Bauch', t: t(bauch), m: m(bauch) });
  tl.sort((x, y) => x.i - y.i).forEach((c, idx) => {
    points.push({ key: idx ? 'taille2' : 'taille', label: 'Ø Taille', t: t(c.i), m: m(c.i) });
  });
  points.push({ key: 'fuss', label: ring ? 'Ø Fußring' : 'Ø Fuß', t: 1, m: m(n - 1) });
  return points.sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
}

// Frühere Schlüssel und automatische Namen (vor der Umstellung der Begriffe)
const ALTE_SCHLUESSEL = { hals: 'taille', hals2: 'taille2' };
const ALTE_NAMEN = new Set(['Ø Öffnung', 'Ø Hals', 'Ø Taille', 'Ø Einschnürung', 'Ø Bauch', 'Ø Schulter', 'Ø Wölbung', 'Ø Rille', 'Ø Absatz', 'Ø Fußansatz', 'Ø Boden', 'Ø Fuß', 'Ø Fußring']);
export const istAutoName = name => ALTE_NAMEN.has(name);

// Eingetragene Werte unter früheren Schlüsseln übernehmen
export function alteWerte(obj = {}) {
  const out = { ...obj };
  for (const [alt, neu] of Object.entries(ALTE_SCHLUESSEL)) if (out[neu] == null && out[alt] != null) out[neu] = out[alt];
  return out;
}

// Automatisch gefundene Stellen (ohne ausgeblendete) plus eigene Stellen, mit eigenen Namen
export function effectivePoints(bp) {
  const hidden = bp.hidden || [];
  const labels = bp.labels || {};
  const rAt = profileAt(bp.profile);
  // Stellen immer aus dem (begradigten) Profil neu bestimmen, damit auch ältere Blaupausen
  // die heutigen Begriffe und Regeln bekommen; frühere automatische Namen zählen nicht als eigene
  const name = (key, auto) => (labels[key] && !istAutoName(labels[key]) ? labels[key] : auto);
  const pts = findPoints(bp.profile).filter(p => !hidden.includes(p.key)).map(p => ({ ...p, label: name(p.key, p.label) }));
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
  // Die eingetragene Höhe legt den Maßstab fest; die Durchmesser passen dann die Form an (abgleich)
  const hoehe = Number(values.hoehe);
  const pts = values.hoehe != null && values.hoehe !== '' && hoehe > 0 ? (scales.push(hoehe), []) : effectivePoints(bp);
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
// Abgleich: die Zeichnung an die eingetragenen Maße anpassen
// ---------------------------------------------------------------------------

// Das Foto liefert die Form, eingetragene Maße sind genauer. Darum wird das Profil so
// verformt, dass jedes eingetragene Maß genau getroffen wird:
// - Durchmesser: Zwischen zwei eingetragenen Stellen bleibt der Verlauf erhalten, wird aber
//   auf die beiden Maße gestreckt. Steigt oder fällt die Wand dort nur, gilt das genau: Sind
//   beide Maße gleich, wird die Wand dazwischen gerade (z. B. Taille = Öffnung → senkrecht bis
//   zum Rand; eine im Foto abgerundete Ecke verschwindet). Hat die Wand dazwischen einen eigenen
//   Bauch oder eine Einziehung, wird stattdessen anteilig vergrößert bzw. verkleinert. Über die
//   äußersten eingetragenen Stellen hinaus gilt deren Verhältnis.
// - Höhenlage einer Stelle („auf welcher Höhe“): Die Stelle rückt dorthin, die Abschnitte
//   darüber und darunter werden gestaucht bzw. gestreckt.
// Henkel wandern mit dem Körper mit.
// Liefert Profil, Stellen (mit angepasster Lage t und Durchmesser m), Henkel, Maßstab und
// Umrechnung der Lage (neu → wie im Foto).
export function abgleich(bp, values = {}, pos = {}) {
  const prof0 = begradigen(bp.profile);
  const n = prof0.length;
  const at0 = profileAt(prof0);
  const pts0 = effectivePoints(bp);
  const scale = estimate(bp, values, pos).scale;
  const zahl = v => (v != null && v !== '' && Number(v) > 0 ? Number(v) : null);
  // Schätzung eines Maßes (cm) aus Durchmesser m bzw. Lage t einer Stelle
  const value = p => (scale ? p.m * scale : null);
  const lage = p => (scale && p.t != null ? (1 - p.t) * scale : null);
  if (!scale) return { profile: prof0, points: pts0, handles: bp.handles || [], scale, value, pos: lage, angepasst: false, tFoto: t => t };

  // Höhenlagen: t (Foto) → t (Maß), stückweise linear und streng steigend
  const lagen = [[0, 0]];
  for (const p of [...pts0].filter(p => p.t > 0 && p.t < 1 && zahl(pos[p.key])).sort((a, b) => a.t - b.t)) {
    const tn = clamp(1 - zahl(pos[p.key]) / scale, 0.01, 0.99);
    if (tn > lagen[lagen.length - 1][1] + 0.01 && p.t > lagen[lagen.length - 1][0] + 0.005) lagen.push([p.t, tn]);
  }
  lagen.push([1, 1]);
  const stueck = (pairs, a, b) => t => {
    if (t <= 0 || t >= 1) return t;
    for (let i = 1; i < pairs.length; i++) {
      if (t <= pairs[i][a]) { const [p, q] = [pairs[i - 1], pairs[i]]; return p[b] + ((t - p[a]) / (q[a] - p[a])) * (q[b] - p[b]); }
    }
    return t;
  };
  const tNeu = stueck(lagen, 0, 1), tFoto = stueck(lagen, 1, 0);

  // Durchmesser: Ankerstellen (Lage wie im Foto, Radius im Foto, Radius laut Maß, in Höhen)
  const anker = [];
  for (const p of pts0) {
    const v = zahl(values[p.key]);
    if (!v || p.t == null) continue;
    const r0 = at0(p.t);
    if (!(r0 > 1e-4)) continue;
    const a = { t: p.t, r0, r: v / 2 / scale };
    const gleich = anker.findIndex(x => Math.abs(x.t - a.t) < 1e-3);
    if (gleich >= 0) anker[gleich] = a; else anker.push(a);
  }
  anker.sort((a, b) => a.t - b.t);
  // Liegt zwischen zwei Ankern eine eigene weiteste oder engste Stelle, wird sie ein Zwischenanker:
  // Sie bekommt die kleinere der beiden Korrekturen (die größere ist meist ein örtlicher Messfehler,
  // z. B. ein im Foto abgerundeter Rand); die Abschnitte daneben steigen bzw. fallen dann nur.
  for (let k = anker.length - 2; k >= 0; k--) {
    const a = anker[k], b = anker[k + 1];
    if (gleichmaessig(a, b)) continue;
    const fa = a.r / a.r0, fb = b.r / b.r0;
    const f = Math.abs(fa - 1) <= Math.abs(fb - 1) ? fa : fb;
    const lo = Math.min(a.r0, b.r0), hi = Math.max(a.r0, b.r0), tol = Math.max(0.006, 0.03 * hi);
    let iMax = -1, iMin = -1;
    for (let i = Math.ceil(a.t * (n - 1)) + 1; i < Math.floor(b.t * (n - 1)); i++) {
      if (prof0[i] > hi + tol && (iMax < 0 || prof0[i] > prof0[iMax])) iMax = i;
      if (prof0[i] < lo - tol && (iMin < 0 || prof0[i] < prof0[iMin])) iMin = i;
    }
    const neu = [iMax, iMin].filter(i => i >= 0).sort((x, y) => x - y).map(i => ({ t: i / (n - 1), r0: prof0[i], r: prof0[i] * f }));
    anker.splice(k + 1, 0, ...neu);
  }
  const radius = t => {
    const r = at0(t);
    if (!anker.length) return r;
    const A = anker[0], Z = anker[anker.length - 1];
    if (t <= A.t) return (r * A.r) / A.r0;
    if (t >= Z.t) return (r * Z.r) / Z.r0;
    let k = 0;
    while (anker[k + 1].t < t) k++;
    const a = anker[k], b = anker[k + 1];
    const s = (t - a.t) / (b.t - a.t || 1);
    const anteilig = r * ((1 - s) * (a.r / a.r0) + s * (b.r / b.r0));
    const d0 = b.r0 - a.r0;
    if (Math.abs(d0) < 0.004) {
      // im Foto gleich weit: gleich weit lassen, aber auf die Maße schieben
      return Math.abs(b.r - a.r) < 1e-6 && gleichmaessig(a, b) ? a.r : anteilig;
    }
    // Wand steigt bzw. fällt dazwischen nur (Bauch oder Einziehung fehlen): genau strecken
    if (!gleichmaessig(a, b)) return anteilig;
    const f = (b.r - a.r) / d0;
    if (f < 0 || f > 4) return anteilig;
    return a.r + (r - a.r0) * f;
  };
  // Liegt die Wand zwischen a und b innerhalb der beiden Radien (kleine Toleranz)?
  function gleichmaessig(a, b) {
    const lo = Math.min(a.r0, b.r0), hi = Math.max(a.r0, b.r0);
    const tol = Math.max(0.006, 0.03 * hi);
    for (let i = Math.ceil(a.t * (n - 1)); i <= Math.floor(b.t * (n - 1)); i++) if (prof0[i] < lo - tol || prof0[i] > hi + tol) return false;
    return true;
  }

  const profile = Array.from({ length: n }, (_, i) => Math.max(0, radius(tFoto(i / (n - 1)))));
  let abw = 0;
  for (let i = 0; i < n; i++) abw = Math.max(abw, Math.abs(profile[i] - prof0[i]));
  const at = profileAt(profile);
  const points = pts0.map(p => {
    if (p.t == null) return p;
    const t = Math.round(tNeu(p.t) * 1000) / 1000;
    return { ...p, t, m: Math.round(2 * at(t) * 10000) / 10000 };
  });
  // Henkel: Lage mitnehmen, seitlich um die Änderung des Körpers verschieben
  const handles = (bp.handles || []).map(h => h.map(([x, t]) => {
    const tk = clamp(t, 0, 1);
    const d = radius(tk) - at0(tk);
    return [x + Math.sign(x) * d, t + (tNeu(tk) - tk)];
  }));
  return { profile, points, handles, scale, value, pos: lage, angepasst: abw > 0.004, tFoto };
}

// ---------------------------------------------------------------------------
// Zeichnung
// ---------------------------------------------------------------------------

// Bleistift auf Aquarellpapier (off-white, kräftige Körnung)
const GRAPHIT = '#3d3b38';
const PAPIER = '#f7f5f0';
const SCHRIFT = '"Bleistift Hand", "Patrick Hand", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

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

const fmtCm = v => `${Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 })} cm`;
const escXml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ansicht aus leicht erhöhter Sicht (Parallelprojektion): Der Querschnitt bei t liegt in der
// Zeichnung bei Y = t·cos β und erscheint als Ellipse mit den Halbachsen r und r·sin β.
// Die Silhouette ist die Vereinigung all dieser Ellipsen.
export function ansicht(prof, blick = BLICK) {
  const sb = Math.sin((blick * Math.PI) / 180), cb = Math.cos((blick * Math.PI) / 180);
  const n = prof.length;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), r = Math.max(0, prof[i]);
    ymin = Math.min(ymin, t * cb - r * sb);
    ymax = Math.max(ymax, t * cb + r * sb);
  }
  const rows = 600;
  const dy = (ymax - ymin) / rows;
  const w = new Float64Array(rows + 1).fill(-1);
  const Y = k => ymin + k * dy;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), r = Math.max(0, prof[i]), yc = t * cb, b = r * sb;
    const k0 = Math.max(0, Math.ceil((yc - b - ymin) / dy)), k1 = Math.min(rows, Math.floor((yc + b - ymin) / dy));
    for (let k = k0; k <= k1; k++) {
      const z = b > 1e-9 ? (Y(k) - yc) / b : 0;
      const v = r * Math.sqrt(Math.max(0, 1 - z * z));
      if (v > w[k]) w[k] = v;
    }
    if (i < n - 1) {
      // zwischen zwei Querschnitten linear verbinden
      const r2 = Math.max(0, prof[i + 1]), yc2 = ((i + 1) / (n - 1)) * cb;
      for (let k = Math.ceil((yc - ymin) / dy); k <= Math.floor((yc2 - ymin) / dy); k++) {
        const f = (Y(k) - yc) / (yc2 - yc || 1);
        const v = r + (r2 - r) * f;
        if (k >= 0 && k <= rows && v > w[k]) w[k] = v;
      }
    }
  }
  return { sb, cb, ymin, ymax, Y, w, rows };
}

// Henkel aus einer Blaupause: Lage und Maße (Anteile der Höhe)
export function henkelMasse(bp) {
  const rAt = profileAt(bp.profile);
  const out = [];
  // Konturen, die ganz in einer anderen liegen (das Henkelloch), gehören zu dieser
  const box = h => [Math.min(...h.map(p => p[0])), Math.max(...h.map(p => p[0])), Math.min(...h.map(p => p[1])), Math.max(...h.map(p => p[1]))];
  const alle = (bp.handles || []).filter(h => h.length > 3);
  const boxes = alle.map(box);
  const aussen = alle.filter((h, i) => !boxes.some((b, j) => j !== i && b[0] <= boxes[i][0] && b[1] >= boxes[i][1] && b[2] <= boxes[i][2] && b[3] >= boxes[i][3]));
  for (const h of aussen) {
    const off = h.filter(([x, t]) => t > -0.05 && t < 1.05 && Math.abs(x) - rAt(clamp(t, 0, 1)) > 0.02);
    if (off.length < 4) continue;
    const ts = off.map(p => p[1]);
    out.push({
      t0: Math.min(...ts), t1: Math.max(...ts),
      side: Math.sign(off.reduce((a, p) => a + p[0], 0)) || 1,
      reach: Math.max(...off.map(([x, t]) => Math.abs(x) - rAt(clamp(t, 0, 1)))),
    });
  }
  return out;
}

function vereinfachen(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let maxD = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...vereinfachen(pts.slice(0, idx + 1), eps).slice(0, -1), ...vereinfachen(pts.slice(idx), eps)];
}

const pfad = (pts, closed) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (closed ? 'Z' : '');

/**
 * bp: { profile, points, handles }
 * values/pos: eingetragene Maße je Stelle (cm)
 */
// papier: eigenes Aquarellpapier zeichnen (sonst liegt die Zeichnung direkt auf dem Papier der App)
// skizze: nur die Form, ohne Maße, Beschriftung und Titel – quadratisch und mittig, wie eine
// Skizze auf einer Seite im Skizzenbuch (Übersicht der Werkstücke)
export function renderBlueprint(bp, { values = {}, pos = {}, title = '', info = [], interactive = true, seed = 1, papier = false, skizze = false } = {}) {
  if (skizze) { interactive = false; info = []; title = ''; }
  const uid = `bp${++svgCounter}`;
  // von Hand geschrieben: jede Beschriftung sitzt ein wenig anders
  const hand = rng(seed);
  const schief = (x, y) => ` transform="rotate(${((hand() - 0.5) * 2.4).toFixed(2)} ${x} ${y})"`;
  // an die eingetragenen Maße angeglichen (auch ältere, noch nicht begradigte Profile sauber)
  const abg = abgleich(bp, values, pos);
  const prof = abg.profile;
  const W = 400;
  const rAt = profileAt(prof);
  const v = ansicht(prof);
  const { sb, cb } = v;

  // Henkel sind aus Bildpunkten nachgezogen (Treppenstufen): ruhig glätten
  const handles = abg.handles.filter(h => h.length > 3).map(h => glattGeschlossen(h));
  const hm = henkelMasse({ profile: prof, handles: abg.handles });
  // Beschriftung auf die Seite ohne Henkel, Höhenmaß auf die andere
  const side = hm[0]?.side > 0 ? -1 : 1;

  // Ausdehnung in Höhen-Einheiten
  let extL = 0, extR = 0;
  for (let k = 0; k <= v.rows; k++) if (v.w[k] > 0) { extL = Math.max(extL, v.w[k]); extR = extL; }
  let yMin = v.ymin, yMax = v.ymax;
  for (const h of handles) for (const [x, t] of h) {
    extL = Math.max(extL, -x); extR = Math.max(extR, x);
    yMin = Math.min(yMin, t * cb); yMax = Math.max(yMax, t * cb);
  }

  // als Skizze: jedes Stück gleich groß, damit die Striche überall gleich kräftig wirken
  const Hd = skizze
    ? 200 / Math.max(yMax - yMin, extL + extR, 0.2)
    : Math.min(330 / (yMax - yMin), 184 / Math.max(0.2, extL + extR));
  const titleLines = wrap(title, 22).slice(0, 2);
  const titleH = titleLines.length ? 30 + titleLines.length * 26 : 24;
  const top = titleH + -yMin * Hd + 22; // Mitte der Öffnung
  const bottom = top + cb * Hd; // Mitte des Bodens
  const axis = (side > 0 ? 64 : 152) + extL * Hd;
  const labelX = side > 0 ? Math.min(axis + extR * Hd + 34, W - 118) : Math.max(axis - extL * Hd - 34, 118);
  const hx = side > 0 ? axis - extL * Hd - 30 : axis + extR * Hd + 30;
  const est = abg;

  const points = abg.points;
  const yOf = t => top + t * cb * Hd;
  const arc = (t, front, r = rAt(t)) => {
    const rx = r * Hd, ry = rx * sb, y = yOf(t);
    return `M${(axis - rx).toFixed(1)} ${y.toFixed(1)}A${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 ${front ? 0 : 1} ${(axis + rx).toFixed(1)} ${y.toFixed(1)}`;
  };
  const ellipse = (t, r) => `M${(axis - r * Hd).toFixed(1)} ${yOf(t).toFixed(1)}a${(r * Hd).toFixed(1)} ${(r * Hd * sb).toFixed(1)} 0 1 0 ${(2 * r * Hd).toFixed(1)} 0a${(r * Hd).toFixed(1)} ${(r * Hd * sb).toFixed(1)} 0 1 0 ${(-2 * r * Hd).toFixed(1)} 0Z`;

  // Umriss: rechts von oben nach unten, links zurück
  const rechts = [], links = [];
  for (let k = 0; k <= v.rows; k++) {
    if (v.w[k] < 0) continue;
    const y = top + v.Y(k) * Hd;
    rechts.push([axis + v.w[k] * Hd, y]);
    links.push([axis - v.w[k] * Hd, y]);
  }
  const umriss = [...vereinfachen(rechts, 0.4), ...vereinfachen(links.reverse(), 0.4)];
  const umrissPfad = pfad(umriss, true);

  const r0 = rAt(0), rI = Math.max(0, r0 - Math.max(0.018, 0.07 * r0));
  const interior = points.filter(p => p.t != null && p.t > 0 && p.t < 1);
  let shape = `<path d="${ellipse(0, rI)}" class="oeffnung"/>`;
  // Mittellinie als feine Hilfslinie
  shape += `<path d="M${axis.toFixed(1)} ${(top - 14).toFixed(1)}V${(bottom + 14).toFixed(1)}" class="achse"/>`;
  // Umriss zweimal leicht versetzt nachgezogen, wie mit dem Bleistift
  shape += `<path d="${umrissPfad}" class="zweit" transform="translate(.45 .3)"/>`;
  shape += `<path d="${umrissPfad}"/>`;
  shape += `<path d="${ellipse(0, r0)}"/>`;
  shape += `<path d="${ellipse(0, rI)}" class="thin"/>`;
  shape += `<path d="${arc(1, false)}" class="dash"/>`;
  for (const p of interior) shape += `<path d="${arc(p.t, true)}" class="thin"/><path d="${arc(p.t, false)}" class="dash"/>`;
  // Henkel liegen seitlich in der Bildebene; was hinter dem Körper liegt, ist verdeckt
  let henkel = '';
  for (const h of handles) henkel += `<path d="${glatterPfad(h.map(([x, t]) => [axis + x * Hd, yOf(t)]))}"/>`;
  if (henkel) shape += `<g mask="url(#${uid}-hm)">${henkel}</g>`;

  // Henkelmaße als Text: Ansatzhöhen und wie weit er absteht
  const attInfo = [];
  hm.forEach((a, i) => {
    const name = hm.length > 1 ? `Henkel ${i + 1}` : 'Henkel';
    if (est.scale) {
      attInfo.push(`${name}: ≈ ${fmtCm((a.t1 - a.t0) * est.scale)} hoch, steht ≈ ${fmtCm(a.reach * est.scale)} ab`);
      attInfo.push(`ansetzen auf ≈ ${fmtCm(Math.max(0, 1 - a.t1) * est.scale)} und ≈ ${fmtCm(Math.max(0, 1 - a.t0) * est.scale)} Höhe`);
    } else {
      attInfo.push(`${name}: ${Math.round((a.t1 - a.t0) * 100)} % der Höhe, steht ${Math.round(a.reach * 100)} % ab`);
    }
  });
  if (!skizze) {
    info = [...info, ...attInfo];
    if (abg.angepasst) info.push('Form an die eingetragenen Maße angepasst');
  }

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
  for (const { p, yA, xA, yL } of skizze ? [] : items) {
    const vt = valueText(p);
    const ps = posText(p);
    labels += `<path d="M${(xA + side * 4).toFixed(1)} ${yA.toFixed(1)}L${labelX - side * 22} ${yA.toFixed(1)}L${labelX - side * 8} ${yL.toFixed(1)}" class="lead"/>`;
    labels += `<circle cx="${xA.toFixed(1)}" cy="${yA.toFixed(1)}" r="3" class="dot"/>`;
    const rx = side > 0 ? labelX - 8 : 2;
    const rw = side > 0 ? W - labelX + 6 : labelX + 6;
    labels += `<g class="lbl"${btn(p.key)}${schief(labelX, yL)}><rect x="${rx}" y="${(yL - 19).toFixed(1)}" width="${rw}" height="44" rx="8" class="hit"/>
      <text x="${labelX}" y="${(yL - 4).toFixed(1)}" class="name"${anchor}>${escXml(p.label)}</text>
      <text x="${labelX}" y="${(yL + 12).toFixed(1)}" class="${vt.cls}"${anchor}>${escXml(vt.text)}</text>
      ${ps ? `<text x="${labelX}" y="${(yL + 24).toFixed(1)}" class="pos"${anchor}>${escXml(ps)}</text>` : ''}</g>`;
  }

  // Höhenmaß auf der anderen Seite (von der Ebene der Öffnung bis zur Standfläche)
  const hp = !skizze && points.find(p => p.key === 'hoehe');
  let height = '';
  if (hp) {
    const vt = valueText(hp);
    const mid = (top + bottom) / 2;
    height += `<path d="M${hx} ${top}V${bottom}M${hx - 6} ${top}h12M${hx - 6} ${bottom}h12M${hx - 4} ${top + 7}l4 -7l4 7M${hx - 4} ${bottom - 7}l4 7l4 -7" class="dim"/>`;
    for (const p of interior) {
      const y = yOf(p.t).toFixed(1);
      const edge = axis - side * (rAt(p.t) * Hd + 6);
      height += `<path d="M${hx - 4} ${y}h8" class="dim"/><path d="M${hx + side * 6} ${y}L${edge.toFixed(1)} ${y}" class="guide"/>`;
    }
    const tx = side > 0 ? hx - 12 : hx + 22;
    height += `<g class="lbl"${btn('hoehe')}><rect x="${tx - 22}" y="${mid - 80}" width="30" height="160" rx="8" class="hit"/>
      <text transform="translate(${tx} ${mid}) rotate(-90)" text-anchor="middle" class="${vt.cls}">Höhe ${escXml(vt.text)}</text></g>`;
  }

  const lastLabel = items.length ? items[items.length - 1].yL + 34 : 0;
  const infoTop = Math.max(top + yMax * Hd + 40, lastLabel + 16);
  const infoSvg = info.map((line, i) => `<text x="22" y="${infoTop + i * 22}" class="info${i ? '' : ' strong'}"${schief(22, infoTop + i * 22)}>${escXml(line)}</text>`).join('');
  const H = Math.ceil(infoTop + Math.max(0, info.length - 1) * 22 + 26);

  const titleSvg = titleLines.map((l, i) => `<text x="${W - 20}" y="${40 + i * 26}" text-anchor="end" class="title"${schief(W - 20, 40 + i * 26)}>${escXml(l)}</text>`).join('');
  const half = Math.max(extL, extR) * Hd;
  // Bildausschnitt: als Skizze ein Quadrat um die Form, sonst das ganze Blatt
  let vb = [0, 0, W, H];
  if (skizze) {
    const x0 = axis - extL * Hd, x1 = axis + extR * Hd, y0 = top + yMin * Hd, y1 = top + yMax * Hd;
    const S = Math.max(x1 - x0, y1 - y0) * 1.16;
    vb = [(x0 + x1) / 2 - S / 2, (y0 + y1) / 2 - S / 2, S, S].map(z => Math.round(z * 10) / 10);
  }
  const bereich = `x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}"`;

  return `<svg class="blueprint${skizze ? ' skizze' : ''}" viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${skizze ? 'Skizze' : `Blaupause ${escXml(title)}`}">
  <style>
    #${uid} text { font-family: ${SCHRIFT}; fill: ${GRAPHIT}; }
    #${uid} .shape path { fill: none; stroke: ${GRAPHIT}; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; opacity: .9; }
    #${uid} .shape .zweit { stroke-width: 1.1; opacity: .35; }
    #${uid} .shape .oeffnung { fill: ${GRAPHIT}; fill-opacity: .07; stroke: none; }
    #${uid} .shape .achse { stroke-width: .6; stroke-dasharray: 10 4 2 4; opacity: .4; }
    #${uid} .shape .thin { stroke-width: 1; opacity: .7; }
    #${uid} .shape .dash { stroke-dasharray: 6 5; stroke-width: 1; opacity: .55; }${skizze ? `
    #${uid} .shape path { stroke-width: 2.3; }
    #${uid} .shape .zweit { stroke-width: 1.5; }
    #${uid} .shape .thin, #${uid} .shape .dash { stroke-width: 1.3; }` : ''}
    #${uid} .lead { fill: none; stroke: ${GRAPHIT}; stroke-width: .7; opacity: .6; stroke-linecap: round; }
    #${uid} .dot { fill: ${GRAPHIT}; opacity: .85; }
    #${uid} .dim { fill: none; stroke: ${GRAPHIT}; stroke-width: .75; opacity: .75; stroke-linecap: round; stroke-linejoin: round; }
    #${uid} .guide { fill: none; stroke: ${GRAPHIT}; stroke-width: .6; stroke-dasharray: 1.5 4; opacity: .45; }
    #${uid} .hit { fill: transparent; }
    #${uid} [data-bp-key], #${uid} [data-bp-add] { cursor: pointer; }
    #${uid} [data-bp-key]:hover .hit, #${uid} [data-bp-key]:focus .hit { fill: ${GRAPHIT}; fill-opacity: .06; }
    #${uid} [data-bp-key]:focus { outline: none; }
    #${uid} .title { font-size: 28px; letter-spacing: .3px; }
    #${uid} .name { font-size: 14px; opacity: .78; letter-spacing: .2px; }
    #${uid} .val { font-size: 19px; }
    #${uid} .val.est { opacity: .72; }
    #${uid} .val.empty { font-size: 16px; opacity: .55; }
    #${uid} .pos { font-size: 13px; opacity: .7; }
    #${uid} .info { font-size: 16px; opacity: .85; }
    #${uid} .info.strong { font-size: 17px; opacity: 1; }
  </style>
  <defs>
    <!-- Aquarellpapier: Körnung als Relief (Licht von links oben), dazu leichte Wolken -->
    <filter id="${uid}-papier" filterUnits="userSpaceOnUse" ${bereich} color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="4" seed="${seed % 89}" result="korn"/>
      <feDiffuseLighting in="korn" surfaceScale="1.5" diffuseConstant="1" lighting-color="#ffffff" result="licht">
        <feDistantLight azimuth="225" elevation="58"/>
      </feDiffuseLighting>
      <!-- Relief nur andeuten: hell lassen, Täler leicht abdunkeln -->
      <feComponentTransfer in="licht" result="relief">
        <feFuncR type="linear" slope=".3" intercept=".73"/>
        <feFuncG type="linear" slope=".3" intercept=".73"/>
        <feFuncB type="linear" slope=".3" intercept=".73"/>
      </feComponentTransfer>
      <feBlend in="relief" in2="SourceGraphic" mode="multiply" result="papier"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="3" seed="${(seed % 53) + 7}" result="wolken"/>
      <feColorMatrix in="wolken" values="0 0 0 0 0.60  0 0 0 0 0.58  0 0 0 0 0.55  0 0 0 .22 -.09" result="flecken"/>
      <feComposite in="flecken" in2="papier" operator="over"/>
    </filter>
    <!-- Bleistift: Graphit bleibt nur auf den Spitzen der Papierkörnung hängen -->
    <filter id="${uid}-blei" filterUnits="userSpaceOnUse" ${bereich}>
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 71}" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.5" result="zahn"/>
      <feComposite in="SourceGraphic" in2="zahn" operator="in" result="g"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="1" seed="${(seed % 61) + 3}" result="w"/>
      <feDisplacementMap in="g" in2="w" scale=".8" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <radialGradient id="${uid}-rand" cx="50%" cy="45%" r="75%">
      <stop offset="70%" stop-color="#6e6a63" stop-opacity="0"/>
      <stop offset="100%" stop-color="#6e6a63" stop-opacity=".12"/>
    </radialGradient>
    <mask id="${uid}-hm" maskUnits="userSpaceOnUse" ${bereich}>
      <rect ${bereich} fill="#fff"/>
      <path d="${umrissPfad}" fill="#000"/>
    </mask>
  </defs>
  <clipPath id="${uid}-c"><rect ${bereich}/></clipPath>
  <g id="${uid}" clip-path="url(#${uid}-c)">
    ${papier ? `<rect width="${W}" height="${H}" fill="${PAPIER}" filter="url(#${uid}-papier)"/>
    <rect width="${W}" height="${H}" fill="url(#${uid}-rand)"/>` : ''}
    <g filter="url(#${uid}-blei)">
    ${titleSvg}
    <g class="shape">${shape}</g>
    ${interactive ? `<rect x="${(axis - half - 8).toFixed(1)}" y="${(top - 6).toFixed(1)}" width="${(2 * half + 16).toFixed(1)}" height="${(cb * Hd + 12).toFixed(1)}" class="hit add" data-bp-add data-top="${top.toFixed(2)}" data-hd="${(cb * Hd).toFixed(2)}"/>` : ''}
    ${height}
    ${labels}
    ${infoSvg}
    </g>
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
