// Formwissen: Aus der Formen-Datenbank gelernte Modelle typischer Gefäßformen.
//
// Jede Formfamilie (Becher, Tasse, Schüssel, Vase …) ist als statistisches Modell
// gespeichert: mittlere Kontur + die wichtigsten Arten, wie Stücke davon abweichen
// (Hauptkomponenten), plus eine glatte Restabweichung. Damit lässt sich zu einer
// teilweise gemessenen Kontur verlässlich vorhersagen, wie sie weiterläuft:
// Stellen, die im Foto gut zu sehen sind, bestimmen die Form; Stellen im Schatten,
// in Spiegelungen oder hinter Farbwechseln werden aus dem Formwissen ergänzt.

import { MODELL } from './formen-modell.js';

const cache = new Map();

// Vorab: Kovarianz der Konturen einer Familie (Hauptkomponenten + glatter Rest)
function vorbereiten(fam, modell) {
  const key = `${modell.N}:${fam.key}`;
  if (cache.has(key)) return cache.get(key);
  const N = modell.N;
  const C = new Float64Array(N * N);
  const tau2 = Math.max(fam.rest, modell.restMin) ** 2;
  const l = modell.laenge;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let k = 0; k < fam.varianzen.length; k++) s += fam.komponenten[k][i] * fam.varianzen[k] * fam.komponenten[k][j];
      const d = (i - j) / (N - 1) / l;
      C[i * N + j] = s + tau2 * Math.exp(-0.5 * d * d);
    }
  }
  const out = { C, mittel: Float64Array.from(fam.mittel) };
  cache.set(key, out);
  return out;
}

function cholesky(A, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  return L;
}

function vorwaerts(L, b, n) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  return y;
}

function rueckwaerts(L, y, n) {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

// Gemessene Kontur an eine Familie anpassen (robust: Ausreißer werden erkannt und
// zählen kaum). Liefert die vorhergesagte Kontur samt Unsicherheit je Stelle.
function anpassenFamilie(fam, mess, gewicht, modell, { robust = true, sigma = modell.sigma } = {}) {
  const N = modell.N;
  const { C, mittel } = vorbereiten(fam, modell);
  const O = [];
  for (let i = 0; i < N; i++) if (gewicht[i] > 0.02 && Number.isFinite(mess[i])) O.push(i);
  const n = O.length;
  const u = new Float64Array(N).fill(1);
  let L, alpha, post, resid;
  const c = 2.5;
  for (let it = 0; it < (robust ? 7 : 1); it++) {
    const S = new Float64Array(n * n);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) S[a * n + b] = C[O[a] * N + O[b]];
      S[a * n + a] += (sigma * sigma) / (gewicht[O[a]] * u[O[a]]);
    }
    L = cholesky(S, n);
    const r = new Float64Array(n);
    for (let a = 0; a < n; a++) r[a] = mess[O[a]] - mittel[O[a]];
    alpha = rueckwaerts(L, vorwaerts(L, r, n), n);
    post = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = mittel[i];
      for (let a = 0; a < n; a++) s += C[i * N + O[a]] * alpha[a];
      post[i] = s;
    }
    resid = r;
    if (!robust) break;
    for (const i of O) {
      const si = sigma / Math.sqrt(gewicht[i]);
      const e = (mess[i] - post[i]) / (c * si);
      u[i] = 1 / (1 + e * e);
    }
  }
  // Bewertung: negative Log-Wahrscheinlichkeit der Messung unter dieser Familie
  let quad = 0, logdet = 0, strafe = 0;
  for (let a = 0; a < n; a++) { quad += resid[a] * alpha[a]; logdet += Math.log(L[a * n + a]); }
  for (const i of O) strafe += 0.5 * Math.log(1 / u[i]);
  const score = 0.5 * quad + logdet + strafe - Math.log(fam.anteil || 1 / modell.familien.length);
  // Unsicherheit der Vorhersage je Stelle
  const sd = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const k = new Float64Array(n);
    for (let a = 0; a < n; a++) k[a] = C[O[a] * N + i];
    const v = vorwaerts(L, k, n);
    let s = C[i * N + i];
    for (let a = 0; a < n; a++) s -= v[a] * v[a];
    sd[i] = Math.sqrt(Math.max(s, 0));
  }
  return { key: fam.key, label: fam.label, gruppe: fam.gruppe, score, profil: post, sd, gewichtRobust: u };
}

/**
 * Kontur mit dem Formwissen vervollständigen.
 * mess: Radius/Höhe an modell.N Stellen (oben → unten), gewicht: 0 … 1 je Stelle
 * (0 = nicht gesehen). gruppe: optionaler Hinweis ('becher' | 'schale' | 'vase').
 */
export function formAnpassen(mess, gewicht, { gruppe = null, familie = null, modell = MODELL, robust = true, sigma } = {}) {
  const kandidaten = [];
  const sicht = gewicht.filter(w => w > 0.02).length;
  for (const fam of modell.familien) {
    if (familie && fam.key !== familie) continue;
    if (sicht < 3) {
      kandidaten.push({ key: fam.key, label: fam.label, gruppe: fam.gruppe, score: -Math.log(fam.anteil), profil: Float64Array.from(fam.mittel), sd: new Float64Array(modell.N).fill(0.1), gewichtRobust: new Float64Array(modell.N).fill(1) });
      continue;
    }
    const r = anpassenFamilie(fam, mess, gewicht, modell, { robust, sigma });
    if (gruppe && fam.gruppe === gruppe) r.score -= 2;
    kandidaten.push(r);
  }
  kandidaten.sort((a, b) => a.score - b.score);
  const best = kandidaten[0];
  return { ...best, kandidaten: kandidaten.map(k => ({ key: k.key, label: k.label, score: k.score })) };
}

export function familienListe(modell = MODELL) {
  return modell.familien.map(f => ({ key: f.key, label: f.label, gruppe: f.gruppe }));
}

export const MODELL_N = MODELL.N;
