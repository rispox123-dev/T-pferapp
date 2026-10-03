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
export function renderBlueprint(bp, { values = {}, pos = {}, title = '', info = [], interactive = true, seed = 1 } = {}) {
  const uid = `bp${++svgCounter}`;
  // auch ältere, noch nicht begradigte Profile sauber zeichnen
  const prof = begradigen(bp.profile);
  const W = 400;
  const rAt = profileAt(prof);
  const v = ansicht(prof);
  const { sb, cb } = v;

  // Henkel sind aus Bildpunkten nachgezogen (Treppenstufen): ruhig glätten
  const handles = (bp.handles || []).filter(h => h.length > 3).map(h => glattGeschlossen(h));
  const hm = henkelMasse(bp);
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

  const Hd = Math.min(330 / (yMax - yMin), 184 / Math.max(0.2, extL + extR));
  const titleLines = wrap(title, 22).slice(0, 2);
  const titleH = titleLines.length ? 30 + titleLines.length * 26 : 24;
  const top = titleH + -yMin * Hd + 22; // Mitte der Öffnung
  const bottom = top + cb * Hd; // Mitte des Bodens
  const axis = (side > 0 ? 64 : 152) + extL * Hd;
  const labelX = side > 0 ? Math.min(axis + extR * Hd + 34, W - 118) : Math.max(axis - extL * Hd - 34, 118);
  const hx = side > 0 ? axis - extL * Hd - 30 : axis + extR * Hd + 30;
  const est = estimate(bp, values, pos);

  const points = effectivePoints(bp);
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
  let shape = `<path d="${umrissPfad}" class="koerper"/>`;
  shape += `<path d="${ellipse(0, rI)}" class="oeffnung"/>`;
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
    const vt = valueText(p);
    const ps = posText(p);
    labels += `<path d="M${(xA + side * 4).toFixed(1)} ${yA.toFixed(1)}L${labelX - side * 22} ${yA.toFixed(1)}L${labelX - side * 8} ${yL.toFixed(1)}" class="lead"/>`;
    labels += `<circle cx="${xA.toFixed(1)}" cy="${yA.toFixed(1)}" r="3" class="dot"/>`;
    const rx = side > 0 ? labelX - 8 : 2;
    const rw = side > 0 ? W - labelX + 6 : labelX + 6;
    labels += `<g class="lbl"${btn(p.key)}><rect x="${rx}" y="${(yL - 19).toFixed(1)}" width="${rw}" height="44" rx="8" class="hit"/>
      <text x="${labelX}" y="${(yL - 4).toFixed(1)}" class="name"${anchor}>${escXml(p.label)}</text>
      <text x="${labelX}" y="${(yL + 12).toFixed(1)}" class="${vt.cls}"${anchor}>${escXml(vt.text)}</text>
      ${ps ? `<text x="${labelX}" y="${(yL + 24).toFixed(1)}" class="pos"${anchor}>${escXml(ps)}</text>` : ''}</g>`;
  }

  // Höhenmaß auf der anderen Seite (von der Ebene der Öffnung bis zur Standfläche)
  const hp = points.find(p => p.key === 'hoehe');
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
  const infoSvg = info.map((line, i) => `<text x="22" y="${infoTop + i * 21}" class="info${i ? '' : ' strong'}">${escXml(line)}</text>`).join('');
  const H = Math.ceil(infoTop + Math.max(0, info.length - 1) * 21 + 26);

  const cr = crackle(W, H, seed);
  const titleSvg = titleLines.map((l, i) => `<text x="${W - 20}" y="${40 + i * 26}" text-anchor="end" class="title">${escXml(l)}</text>`).join('');
  const half = Math.max(extL, extR) * Hd;

  return `<svg class="blueprint" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Blaupause ${escXml(title)}">
  <style>
    #${uid} text { font-family: "Avenir Next", Futura, "Century Gothic", -apple-system, "Segoe UI", sans-serif; fill: ${INK}; }
    #${uid} .shape path { fill: none; stroke: ${LINE}; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    #${uid} .shape .koerper { fill: #fff; fill-opacity: .1; stroke: none; }
    #${uid} .shape .oeffnung { fill: ${INK}; fill-opacity: .09; stroke: none; }
    #${uid} .shape .thin { stroke-width: 1.5; opacity: .8; }
    #${uid} .shape .dash { stroke-dasharray: 7 6; stroke-width: 2; }
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
    <mask id="${uid}-hm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#fff"/>
      <path d="${umrissPfad}" fill="#000"/>
    </mask>
  </defs>
  <clipPath id="${uid}-c"><rect width="${W}" height="${H}"/></clipPath>
  <g id="${uid}" clip-path="url(#${uid}-c)">
    <rect width="${W}" height="${H}" fill="${GLAZE}"/>
    <rect width="${W}" height="${H}" filter="url(#${uid}-m)" opacity=".45"/>
    <path d="${cr.d}" fill="none" stroke="#8ea89f" stroke-width=".9" opacity=".6"/>
    <path d="${cr.fine}" fill="none" stroke="#8ea89f" stroke-width=".6" opacity=".45"/>
    ${titleSvg}
    <g class="shape">${shape}</g>
    ${interactive ? `<rect x="${(axis - half - 8).toFixed(1)}" y="${(top - 6).toFixed(1)}" width="${(2 * half + 16).toFixed(1)}" height="${(cb * Hd + 12).toFixed(1)}" class="hit add" data-bp-add data-top="${top.toFixed(2)}" data-hd="${(cb * Hd).toFixed(2)}"/>` : ''}
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
