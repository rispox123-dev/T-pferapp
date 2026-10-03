// Umriss verfeinern: Foto mit Umriss im Vollbild. Mit zwei Fingern zoomen und verschieben.
// Werkzeuge:
// - Linien: Mittelachse verschieben (an den Enden neigen), Regler vom Bildrand an die Oberkante,
//   die Unterkante und die äußersten Punkte links und rechts schieben
// - Pinsel: Teile hinzufügen, die zum Stück gehören
// - Radierer: Teile wegnehmen, die nicht dazugehören (Schatten, Hintergrund)
// Nach jeder Änderung wird der Umriss mit diesen Vorgaben neu berechnet.

const ICON = {
  linien: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.5"/><path d="M4 4h16M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 9v6M21 9v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pinsel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l5 5-8 8-5-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6.5 12.5c-2 0-3.5 1.5-3.5 4 0 1.5-.5 2.5-1 3 3 .5 7-.5 7.5-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 13l3 3" stroke="currentColor" stroke-width="1.8"/></svg>',
  radierer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 15.5l10-10a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 10.5l6 6M12 19h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const HINWEIS = {
  linien: 'Gelbe Regler an Oberkante, Unterkante und die breiteste Stelle links/rechts schieben (ohne Henkel). Mittelachse verschieben, an den Punkten neigen.',
  pinsel: 'Male über Teile, die zum Stück gehören.',
  radierer: 'Male über Teile, die nicht zum Stück gehören (z. B. Schatten).',
};

const LINIEN = ['oben', 'unten', 'links', 'rechts'];
const LEER = { achse: null, oben: null, unten: null, links: null, rechts: null };
const r4 = v => Math.round(v * 10000) / 10000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * img: Foto (HTMLImageElement), fein: bisherige Vorgaben, brush: bisherige Pinselstriche,
 * rechnen({ fein, brush }) → Ergebnis der Formerkennung (wirft bei Fehlern)
 * Ergebnis: { fein, brush, result } oder null (abgebrochen)
 */
export function umrissVerfeinern({ img, fein, brush, rechnen }) {
  return new Promise(resolve => {
    const NW = img.naturalWidth, NH = img.naturalHeight;
    const st = {
      fein: { ...LEER, ...structuredClone(fein || {}) },
      brush: structuredClone(brush || []),
      tool: 'linien',
      size: 14, // Pinselradius in Bildschirmpixeln
      result: null,
      error: '',
    };
    const verlauf = [];
    const merken = () => { verlauf.push(JSON.stringify({ fein: st.fein, brush: st.brush })); if (verlauf.length > 60) verlauf.shift(); };
    const zurueckholen = () => {
      const s = verlauf.pop();
      if (!s) return false;
      ({ fein: st.fein, brush: st.brush } = JSON.parse(s));
      return true;
    };

    const el = document.createElement('div');
    el.className = 'fein';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Umriss verfeinern');
    el.innerHTML = `
      <div class="fein-kopf">
        <button type="button" data-aktion="abbrechen">Abbrechen</button>
        <strong>Umriss verfeinern</strong>
        <button type="button" class="fein-ok" data-aktion="ok" disabled>Fertig</button>
      </div>
      <p class="fein-status" aria-live="polite"></p>
      <div class="fein-buehne"><canvas></canvas></div>
      <div class="fein-leiste">
        <div class="fein-werkzeuge" role="group" aria-label="Werkzeug">
          ${['linien', 'pinsel', 'radierer'].map(t => `<button type="button" data-tool="${t}" aria-pressed="${t === st.tool}">${ICON[t]}<span>${{ linien: 'Linien', pinsel: 'Pinsel', radierer: 'Radierer' }[t]}</span></button>`).join('')}
        </div>
        <p class="fein-tipp"></p>
        <div class="fein-zeile">
          <label class="fein-groesse"><span>Pinselgröße</span><input type="range" min="4" max="40" value="${st.size}"></label>
          <span class="fein-zoom">Zwei Finger: zoomen und verschieben</span>
        </div>
        <div class="fein-zeile">
          <button type="button" data-aktion="undo">Rückgängig</button>
          <button type="button" data-aktion="reset">Zurücksetzen</button>
          <button type="button" data-aktion="einpassen">Ganzes Bild</button>
        </div>
      </div>`;
    document.body.append(el);
    document.body.classList.add('fein-offen');

    const canvas = el.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const buehne = el.querySelector('.fein-buehne');
    const statusEl = el.querySelector('.fein-status');
    const okBtn = el.querySelector('.fein-ok');
    const groesse = el.querySelector('.fein-groesse');
    const tipp = el.querySelector('.fein-tipp');
    const zoomTipp = el.querySelector('.fein-zoom');
    const ebene = document.createElement('canvas'); // Pinselstriche (halbtransparent darüber)
    const ectx = ebene.getContext('2d');

    // Ansicht: Bildschirm = o + Bildpixel · S
    const PAD = 34;
    let cw = 0, ch = 0, dpr = 1, S0 = 1;
    const v = { S: 1, ox: 0, oy: 0 };
    const X = u => v.ox + u * NW * v.S, Y = t => v.oy + t * NH * v.S;
    const U = x => (x - v.ox) / (NW * v.S), T = y => (y - v.oy) / (NH * v.S);
    const einpassen = () => {
      S0 = Math.min((cw - 2 * PAD) / NW, (ch - 2 * PAD) / NH);
      v.S = S0;
      v.ox = (cw - NW * v.S) / 2;
      v.oy = (ch - NH * v.S) / 2;
    };
    const begrenzen = () => {
      v.S = clamp(v.S, S0, S0 * 10);
      const bw = NW * v.S, bh = NH * v.S;
      v.ox = bw <= cw - 2 * PAD ? (cw - bw) / 2 : clamp(v.ox, cw - PAD - bw, PAD);
      v.oy = bh <= ch - 2 * PAD ? (ch - bh) / 2 : clamp(v.oy, ch - PAD - bh, PAD);
    };
    const layout = () => {
      const r = buehne.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      const alt = { cw, ch, zoom: S0 ? v.S / S0 : 1, mu: cw ? U(cw / 2) : 0.5, mt: ch ? T(ch / 2) : 0.5 };
      cw = r.width; ch = r.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = ebene.width = Math.round(cw * dpr);
      canvas.height = ebene.height = Math.round(ch * dpr);
      einpassen();
      if (alt.cw && alt.zoom > 1.01) {
        // Zoom und Bildmitte beibehalten
        v.S = S0 * alt.zoom;
        v.ox = cw / 2 - alt.mu * NW * v.S;
        v.oy = ch / 2 - alt.mt * NH * v.S;
        begrenzen();
      }
      zeichnen();
    };

    // Mittelachse: zwei Griffpunkte (vorgegeben oder erkannt). Die erkannten liegen etwas
    // innerhalb von Rand und Boden, damit sie nicht unter den Reglergriffen liegen.
    const achsePunkte = () => {
      const a = st.fein.achse;
      if (a) return [[a.x0, a.y0], [a.x1, a.y1]];
      const e = st.result?.outline?.achse || [[0.5, 0.1], [0.5, 0.9]];
      const bei = f => [e[0][0] + (e[1][0] - e[0][0]) * f, e[0][1] + (e[1][1] - e[0][1]) * f];
      return [bei(0.15), bei(0.85)];
    };
    // x der Achse in Bildhöhe t (relativ)
    const achseX = (p, t) => {
      const [[xa, ya], [xb, yb]] = p;
      const dy = (yb - ya) * NH;
      return dy ? xa + ((xb - xa) * (t - ya) * NH) / dy : xa;
    };
    const linienWert = k => st.fein[k] ?? (k === 'oben' || k === 'links' ? 0 : 1);
    const waagrecht = k => k === 'oben' || k === 'unten';

    // Griffe der Regler: außen an der Linie, immer im sichtbaren Bereich
    const GW = 46, GH = 26;
    const griff = k => {
      const val = linienWert(k);
      if (waagrecht(k)) {
        const y = Y(val);
        const cx = clamp((X(0) + X(1)) / 2, GW / 2 + 4, cw - GW / 2 - 4);
        const yy = k === 'oben' ? clamp(y - GH - 4, 2, ch - GH - 2) : clamp(y + 4, 2, ch - GH - 2);
        return { x: cx - GW / 2, y: yy, w: GW, h: GH };
      }
      const x = X(val);
      const cy = clamp((Y(0) + Y(1)) / 2, GW / 2 + 4, ch - GW / 2 - 4);
      const xx = k === 'links' ? clamp(x - GH - 4, 2, cw - GH - 2) : clamp(x + 4, 2, cw - GH - 2);
      return { x: xx, y: cy - GW / 2, w: GH, h: GW };
    };

    const zeichnen = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, cw, ch);
      const bx = X(0), by = Y(0), bw = NW * v.S, bh = NH * v.S;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, bx, by, bw, bh);

      // außerhalb der Regler abdunkeln
      const lo = X(linienWert('links')), ro = X(linienWert('rechts')), oo = Y(linienWert('oben')), uo = Y(linienWert('unten'));
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(bx, by, bw, oo - by);
      ctx.fillRect(bx, uo, bw, by + bh - uo);
      ctx.fillRect(bx, oo, lo - bx, uo - oo);
      ctx.fillRect(ro, oo, bx + bw - ro, uo - oo);

      // Pinselstriche
      if (st.brush.length) {
        ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ectx.clearRect(0, 0, cw, ch);
        ectx.lineCap = 'round';
        ectx.lineJoin = 'round';
        for (const b of st.brush) {
          ectx.strokeStyle = ectx.fillStyle = b.erase ? '#3aa0ff' : '#ff9a4d';
          const r = b.r * NW * v.S;
          ectx.lineWidth = 2 * r;
          ectx.beginPath();
          if (b.pts.length === 1) { ectx.arc(X(b.pts[0][0]), Y(b.pts[0][1]), r, 0, Math.PI * 2); ectx.fill(); continue; }
          b.pts.forEach(([x, y], i) => (i ? ectx.lineTo(X(x), Y(y)) : ectx.moveTo(X(x), Y(y))));
          ectx.stroke();
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.45;
        ctx.drawImage(ebene, 0, 0);
        ctx.restore();
      }

      // Umriss
      const o = st.result?.outline;
      const linie = (pts, closed) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        if (closed) ctx.closePath();
        ctx.stroke();
      };
      ctx.lineJoin = 'round';
      if (o) {
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.lineWidth = 5;
        linie(o.koerper, true);
        ctx.strokeStyle = '#ff7a3d';
        ctx.lineWidth = 2.5;
        linie(o.koerper, true);
        ctx.strokeStyle = '#ff3d6e';
        for (const hk of o.henkel) linie(hk, true);
        ctx.strokeStyle = '#3aa0ff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        const ax = o.achse[0][0];
        for (const [ya, yb] of o.ergaenzt) {
          const seg = o.koerper.filter(([, y]) => y >= ya && y <= yb);
          const l = seg.filter(([x]) => x < ax), r = seg.filter(([x]) => x >= ax);
          if (l.length > 1) linie(l, false);
          if (r.length > 1) linie(r, false);
        }
        ctx.lineCap = 'butt';
      }

      // Mittelachse über die ganze Bildhöhe
      const ap = achsePunkte();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = st.fein.achse ? '#5ad1ff' : '#fff';
      ctx.beginPath();
      ctx.moveTo(X(achseX(ap, 0)), Y(0));
      ctx.lineTo(X(achseX(ap, 1)), Y(1));
      ctx.stroke();
      ctx.setLineDash([]);

      if (st.tool === 'linien') {
        for (const [x, y] of ap) {
          ctx.beginPath();
          ctx.arc(X(x), Y(y), 9, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = st.fein.achse ? '#1d8fc0' : '#b5643c';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // Regler
      for (const k of LINIEN) {
        const gesetzt = st.fein[k] != null;
        const val = linienWert(k);
        ctx.strokeStyle = gesetzt ? '#ffd23d' : 'rgba(255,210,61,.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (waagrecht(k)) { ctx.moveTo(bx, Y(val)); ctx.lineTo(bx + bw, Y(val)); } else { ctx.moveTo(X(val), by); ctx.lineTo(X(val), by + bh); }
        ctx.stroke();
        if (st.tool !== 'linien') continue;
        const g = griff(k);
        ctx.fillStyle = gesetzt ? '#ffd23d' : 'rgba(255,210,61,.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(g.x, g.y, g.w, g.h, 8);
        else ctx.rect(g.x, g.y, g.w, g.h);
        ctx.fill();
        // Pfeil zur Mitte
        ctx.fillStyle = '#3a2c00';
        const mx = g.x + g.w / 2, my = g.y + g.h / 2;
        const dir = { oben: [0, 1], unten: [0, -1], links: [1, 0], rechts: [-1, 0] }[k];
        ctx.beginPath();
        ctx.moveTo(mx + dir[0] * 6, my + dir[1] * 6);
        ctx.lineTo(mx - dir[0] * 4 + dir[1] * 7, my - dir[1] * 4 + dir[0] * 7);
        ctx.lineTo(mx - dir[0] * 4 - dir[1] * 7, my - dir[1] * 4 - dir[0] * 7);
        ctx.closePath();
        ctx.fill();
      }

      // Pinsel-Vorschau unter dem Finger
      if (pinselPos && st.tool !== 'linien') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pinselPos[0], pinselPos[1], st.size, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const status = () => {
      const r = st.result;
      const erkannt = r ? `${r.form.label}${r.handles.length ? ` · Henkel ${r.quality.henkelSeite || ''}` : ''}${r.quality.ergaenzt > 0.03 ? ` · ${Math.round(r.quality.ergaenzt * 100)} % aus Formwissen ergänzt` : ''}.` : '';
      statusEl.textContent = st.error || `Erkannt: ${erkannt}${st.fein.achse || LINIEN.some(k => st.fein[k] != null) || st.brush.length ? ' Mit deinen Vorgaben neu gezeichnet.' : ''}`;
      tipp.textContent = HINWEIS[st.tool];
      statusEl.classList.toggle('fehler', !!st.error);
      okBtn.disabled = !st.result;
    };

    // Neu berechnen (kurz verzögert, damit „Berechne …“ zu sehen ist)
    let rechnenTimer = 0;
    const neu = () => {
      clearTimeout(rechnenTimer);
      statusEl.textContent = 'Umriss wird neu berechnet …';
      statusEl.classList.remove('fehler');
      rechnenTimer = setTimeout(() => {
        try {
          st.result = rechnen({ fein: st.fein, brush: st.brush });
          st.error = '';
        } catch (err) {
          st.result = null;
          st.error = err.message;
        }
        zeichnen();
        status();
      }, 30);
    };

    // ---------------------------------------------------------------------
    // Bedienung
    // ---------------------------------------------------------------------
    const ptrs = new Map();
    let geste = null;
    let pinselPos = null;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const abstandZurStrecke = ([px, py], [ax, ay], [bx, by]) => {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
      return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    };

    const trefferLinien = p => {
      const [x, y] = p;
      for (const k of LINIEN) {
        const g = griff(k);
        if (x > g.x - 8 && x < g.x + g.w + 8 && y > g.y - 8 && y < g.y + g.h + 8) return { art: 'linie', k };
      }
      const ap = achsePunkte();
      for (let i = 0; i < 2; i++) if (Math.hypot(x - X(ap[i][0]), y - Y(ap[i][1])) < 26) return { art: 'achsenende', i };
      let best = null;
      for (const k of LINIEN) {
        const val = linienWert(k);
        const d = waagrecht(k)
          ? (x > X(0) - 10 && x < X(1) + 10 ? Math.abs(y - Y(val)) : Infinity)
          : (y > Y(0) - 10 && y < Y(1) + 10 ? Math.abs(x - X(val)) : Infinity);
        if (d < 18 && (!best || d < best.d)) best = { art: 'linie', k, d };
      }
      if (best) return best;
      if (abstandZurStrecke(p, [X(achseX(ap, 0)), Y(0)], [X(achseX(ap, 1)), Y(1)]) < 20) return { art: 'achse' };
      return null;
    };

    const zweiFinger = () => {
      const [a, b] = [...ptrs.values()];
      return { d: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    };

    // laufende Ein-Finger-Geste abbrechen (zweiter Finger kam dazu)
    const abbrechenEinFinger = () => {
      if (geste?.art === 'malen' || geste?.art === 'linie' || geste?.art === 'achse' || geste?.art === 'achsenende') zurueckholen();
      pinselPos = null;
    };

    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      ptrs.set(e.pointerId, p);
      if (ptrs.size === 2) {
        abbrechenEinFinger();
        const z = zweiFinger();
        geste = { art: 'zoom', d0: z.d, m0: z.m, S: v.S, ox: v.ox, oy: v.oy };
        zeichnen();
        return;
      }
      if (ptrs.size > 2) return;
      if (st.tool !== 'linien') {
        merken();
        const strich = { r: r4(st.size / (NW * v.S)), pts: [[r4(U(p[0])), r4(T(p[1]))]], ...(st.tool === 'radierer' ? { erase: true } : {}) };
        st.brush.push(strich);
        geste = { art: 'malen', strich, letzt: p };
        pinselPos = p;
        zeichnen();
        return;
      }
      const t = trefferLinien(p);
      if (!t) { geste = { art: 'schieben', p0: p, ox: v.ox, oy: v.oy }; return; }
      merken();
      if (t.art !== 'linie' && !st.fein.achse) {
        const ap = achsePunkte();
        st.fein.achse = { x0: ap[0][0], y0: ap[0][1], x1: ap[1][0], y1: ap[1][1] };
      }
      // Abstand Finger – Linie beibehalten (der Griff sitzt neben der Linie)
      const versatz = t.art === 'linie' ? (waagrecht(t.k) ? Y(linienWert(t.k)) - p[1] : X(linienWert(t.k)) - p[0]) : 0;
      geste = { ...t, p0: p, versatz, bewegt: false, achse0: st.fein.achse ? { ...st.fein.achse } : null };
    });

    canvas.addEventListener('pointermove', e => {
      const p = pos(e);
      if (!ptrs.has(e.pointerId)) {
        if (st.tool !== 'linien' && e.pointerType === 'mouse') { pinselPos = p; zeichnen(); }
        return;
      }
      ptrs.set(e.pointerId, p);
      if (!geste) return;
      if (geste.art === 'zoom') {
        if (ptrs.size < 2) return;
        const z = zweiFinger();
        const S = clamp(geste.S * (z.d / geste.d0), S0, S0 * 10);
        // der Bildpunkt unter der Fingermitte bleibt unter der Fingermitte
        const iu = (geste.m0[0] - geste.ox) / geste.S, it = (geste.m0[1] - geste.oy) / geste.S;
        v.S = S;
        v.ox = z.m[0] - iu * S;
        v.oy = z.m[1] - it * S;
        begrenzen();
        zeichnen();
        return;
      }
      if (geste.art === 'schieben') {
        v.ox = geste.ox + p[0] - geste.p0[0];
        v.oy = geste.oy + p[1] - geste.p0[1];
        begrenzen();
        zeichnen();
        return;
      }
      if (geste.art === 'malen') {
        pinselPos = p;
        const [lx, ly] = geste.letzt;
        if (Math.hypot(p[0] - lx, p[1] - ly) > Math.max(2, st.size * 0.3)) {
          geste.strich.pts.push([r4(U(p[0])), r4(T(p[1]))]);
          geste.letzt = p;
        }
        zeichnen();
        return;
      }
      const MIN = 0.04;
      if (!geste.bewegt && Math.hypot(p[0] - geste.p0[0], p[1] - geste.p0[1]) < 4) return;
      geste.bewegt = true;
      if (geste.art === 'linie') {
        const k = geste.k;
        const ty = T(p[1] + geste.versatz), ux = U(p[0] + geste.versatz);
        if (k === 'oben') st.fein.oben = clamp(ty, 0, linienWert('unten') - MIN);
        if (k === 'unten') st.fein.unten = clamp(ty, linienWert('oben') + MIN, 1);
        if (k === 'links') st.fein.links = clamp(ux, 0, linienWert('rechts') - MIN);
        if (k === 'rechts') st.fein.rechts = clamp(ux, linienWert('links') + MIN, 1);
      } else {
        const a0 = geste.achse0, du = U(p[0]) - U(geste.p0[0]);
        if (geste.art === 'achse') st.fein.achse = { ...a0, x0: clamp(a0.x0 + du, 0, 1), x1: clamp(a0.x1 + du, 0, 1) };
        else if (geste.i === 0) st.fein.achse = { ...a0, x0: clamp(a0.x0 + du, 0, 1) };
        else st.fein.achse = { ...a0, x1: clamp(a0.x1 + du, 0, 1) };
      }
      zeichnen();
    });

    const loslassen = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (!geste) return;
      if (geste.art === 'zoom') {
        // nach dem Zoomen erst wieder reagieren, wenn alle Finger oben sind
        if (!ptrs.size) geste = null;
        return;
      }
      const g = geste;
      geste = null;
      if (e.pointerType !== 'mouse') pinselPos = null;
      if (g.art === 'schieben') return;
      // nur angetippt: nichts ändern
      if (g.art !== 'malen' && !g.bewegt) { zurueckholen(); zeichnen(); return; }
      if (g.art === 'linie') {
        // ganz an den Bildrand zurückgeschoben: Regler nicht gesetzt
        const val = st.fein[g.k];
        if (val != null && (val < 0.004 || val > 0.996)) st.fein[g.k] = null;
      }
      for (const k of ['x0', 'y0', 'x1', 'y1']) if (st.fein.achse) st.fein.achse[k] = r4(st.fein.achse[k]);
      for (const k of LINIEN) if (st.fein[k] != null) st.fein[k] = r4(st.fein[k]);
      neu();
    };
    canvas.addEventListener('pointerup', loslassen);
    canvas.addEventListener('pointercancel', loslassen);
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { pinselPos = null; zeichnen(); } });

    // Mausrad / Trackpad: zoomen
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = pos(e);
      const S = clamp(v.S * Math.exp(-e.deltaY * 0.0015), S0, S0 * 10);
      const iu = (p[0] - v.ox) / v.S, it = (p[1] - v.oy) / v.S;
      v.S = S;
      v.ox = p[0] - iu * S;
      v.oy = p[1] - it * S;
      begrenzen();
      zeichnen();
    }, { passive: false });

    const werkzeug = t => {
      st.tool = t;
      el.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      groesse.hidden = t === 'linien';
      zoomTipp.hidden = t !== 'linien';
      pinselPos = null;
      zeichnen();
      status();
    };
    el.querySelector('.fein-werkzeuge').addEventListener('click', e => {
      const b = e.target.closest('[data-tool]');
      if (b) werkzeug(b.dataset.tool);
    });
    groesse.querySelector('input').addEventListener('input', e => {
      st.size = Number(e.target.value);
      pinselPos = [cw / 2, ch / 2];
      zeichnen();
    });
    groesse.querySelector('input').addEventListener('change', () => { pinselPos = null; zeichnen(); });

    // Schließen (auch mit der Zurück-Taste des Handys)
    let offen = true;
    const schliessen = (wert, ausVerlauf = false) => {
      if (!offen) return;
      offen = false;
      clearTimeout(rechnenTimer);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      ro.disconnect();
      el.remove();
      document.body.classList.remove('fein-offen');
      if (!ausVerlauf) history.back();
      resolve(wert);
    };
    const onPop = () => schliessen(null, true);
    const onKey = e => { if (e.key === 'Escape') schliessen(null); };
    history.pushState({ ...(history.state || {}), fein: true }, '');
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);

    el.querySelector('.fein-kopf').addEventListener('click', e => {
      const a = e.target.closest('[data-aktion]')?.dataset.aktion;
      if (a === 'abbrechen') schliessen(null);
      if (a === 'ok' && st.result) schliessen({ fein: st.fein, brush: st.brush, result: st.result });
    });
    el.querySelector('.fein-leiste').addEventListener('click', e => {
      const a = e.target.closest('[data-aktion]')?.dataset.aktion;
      if (a === 'undo') { if (zurueckholen()) neu(); }
      if (a === 'reset') {
        if (!st.brush.length && LINIEN.every(k => st.fein[k] == null) && !st.fein.achse) return;
        merken();
        st.fein = { ...LEER };
        st.brush = [];
        neu();
      }
      if (a === 'einpassen') { einpassen(); zeichnen(); }
    });

    const ro = new ResizeObserver(layout);
    ro.observe(buehne);
    werkzeug('linien');
    layout();
    neu();
  });
}
