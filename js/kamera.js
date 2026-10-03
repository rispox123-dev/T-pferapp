// Geführte Aufnahme für die Blaupause.
//
// Der beste Winkel für die Formerkennung ist frontal: Handy senkrecht, Kamera auf halber
// Höhe des Stücks, Henkel zur Seite. Eine Maske zeigt, wo das Stück stehen soll (Umriss
// einer typischen Form aus der Formen-Datenbank, Mittellinie, Standlinie, Augenhöhe).
// Eine Wasserwaage aus dem Lagesensor zeigt Neigung und Schieflage; eine schnelle
// Bildprüfung sagt, ob das Stück mittig, groß genug, ganz im Bild und hell genug ist.
// Die Neigung beim Auslösen wird mit dem Foto gespeichert – die Erkennung rechnet damit
// die Perspektive genau heraus. (Die Blaupause selbst wird später aus leicht erhöhter
// Sicht gezeichnet, damit Öffnung und Boden als Ellipsen erscheinen.)

import { MODELL } from './formen-modell.js';

export const GRUPPEN = [
  { key: 'becher', label: 'Becher / Tasse', familie: 'bauchig' },
  { key: 'schale', label: 'Schüssel', familie: 'schuessel' },
  { key: 'vase', label: 'Vase', familie: 'kugelvase' },
];

export function kameraVerfuegbar() {
  return !!(navigator.mediaDevices?.getUserMedia) && window.isSecureContext !== false;
}

// iOS fragt nach der Erlaubnis für den Lagesensor – muss direkt im Klick passieren
function lageErlauben() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    return DOE.requestPermission().then(r => r === 'granted').catch(() => false);
  }
  return Promise.resolve(!!DOE);
}

const grad = r => (r * 180) / Math.PI;
const rad = d => (d * Math.PI) / 180;

// Lage des Handys → Neigung der Kamera (Grad nach unten) und Schieflage (Grad)
export function lageAus(beta, gamma, bildschirmWinkel = 0) {
  const b = rad(beta), g = rad(gamma);
  // Richtung „oben“ in Gerätekoordinaten
  let ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  if (bildschirmWinkel) {
    const a = rad(bildschirmWinkel);
    [ux, uy] = [ux * Math.cos(a) + uy * Math.sin(a), -ux * Math.sin(a) + uy * Math.cos(a)];
  }
  return { blick: grad(Math.asin(Math.max(-1, Math.min(1, uz)))), schief: grad(Math.atan2(ux, uy)) };
}

/**
 * Öffnet die Kamera mit Maske. Liefert { blob, meta }, null (abgebrochen) oder { fehler }.
 * galerie: Funktion, die stattdessen die Galerie öffnet (Knopf in der Kamera).
 */
export function gefuehrteAufnahme({ gruppe = 'becher', galerie = null } = {}) {
  const erlaubnis = lageErlauben(); // synchron im Klick anstoßen
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'kamera';
    el.innerHTML = `
      <video playsinline muted autoplay></video>
      <canvas class="kamera-maske"></canvas>
      <div class="kamera-oben">
        <button type="button" class="kamera-zu" aria-label="Schließen">×</button>
        <div class="kamera-chips" role="radiogroup" aria-label="Art des Stücks">
          ${GRUPPEN.map(g => `<button type="button" role="radio" data-gruppe="${g.key}" aria-checked="${g.key === gruppe}">${g.label}</button>`).join('')}
        </div>
      </div>
      <div class="kamera-hinweis" aria-live="polite"></div>
      <div class="kamera-unten">
        <button type="button" class="kamera-galerie">${galerie ? 'Galerie' : ''}</button>
        <button type="button" class="kamera-ausloeser" aria-label="Foto aufnehmen"><span></span></button>
        <button type="button" class="kamera-tipp" aria-label="Tipps">?</button>
      </div>
      <div class="kamera-tipps" hidden>
        <h3>So wird die Blaupause genau</h3>
        <ul>
          <li><strong>Frontal:</strong> Handy senkrecht halten, Kamera auf <strong>halber Höhe</strong> des Stücks.</li>
          <li><strong>Henkel zur Seite</strong> drehen, damit man ihn im Profil sieht.</li>
          <li>Etwas Abstand halten (am besten 2× zoomen) – dann verzerrt die Perspektive weniger.</li>
          <li>Ruhiger, einfarbiger Hintergrund; Licht von der Seite oder von vorn.</li>
          <li>Das Stück soll den Umriss etwa ausfüllen: unten auf der Standlinie, Mitte auf der Mittellinie.</li>
        </ul>
        <button type="button" class="btn primary">Verstanden</button>
      </div>`;
    document.body.append(el);
    document.body.classList.add('kamera-offen');
    const video = el.querySelector('video');
    const maske = el.querySelector('canvas');
    const ctx = maske.getContext('2d');
    const hinweisEl = el.querySelector('.kamera-hinweis');
    const tipps = el.querySelector('.kamera-tipps');
    let stream = null, lage = null, laeuft = true, zone = null, pruefung = null;
    let aktGruppe = gruppe;

    const ende = ergebnis => {
      laeuft = false;
      window.removeEventListener('deviceorientation', onLage);
      window.removeEventListener('resize', layout);
      stream?.getTracks().forEach(t => t.stop());
      el.remove();
      document.body.classList.remove('kamera-offen');
      resolve(ergebnis);
    };

    const onLage = e => {
      if (e.beta == null || e.gamma == null) return;
      const winkel = screen.orientation?.angle ?? window.orientation ?? 0;
      lage = lageAus(e.beta, e.gamma, winkel);
    };
    erlaubnis.then(ok => { if (ok && laeuft) window.addEventListener('deviceorientation', onLage); });

    // Sichtbarer Ausschnitt des Videos (object-fit: cover)
    const ausschnitt = () => {
      const vw = video.videoWidth, vh = video.videoHeight, cw = el.clientWidth, ch = el.clientHeight;
      const s = Math.max(cw / vw, ch / vh);
      const sw = cw / s, sh = ch / s;
      return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, s };
    };

    // Zielbereich und Umriss der typischen Form (aus der Formen-Datenbank)
    const layout = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = el.clientWidth, ch = el.clientHeight;
      maske.width = cw * dpr; maske.height = ch * dpr;
      maske.style.width = `${cw}px`; maske.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fam = MODELL.familien.find(f => f.key === GRUPPEN.find(g => g.key === aktGruppe).familie) || MODELL.familien[0];
      const prof = fam.mittel;
      const rmax = Math.max(...prof);
      const maxW = cw * (aktGruppe === 'schale' ? 0.88 : 0.8), maxH = ch * 0.56;
      const Hpx = Math.min(maxH, maxW / (2 * rmax + (aktGruppe === 'becher' ? 0.35 : 0)));
      const cx = cw / 2, top = ch * 0.47 - Hpx / 2;
      zone = { cx, top, bottom: top + Hpx, Hpx, prof, rmax, cw, ch };
    };

    const zeichne = () => {
      if (!zone) return;
      const { cx, top, bottom, Hpx, prof, rmax, cw, ch } = zone;
      ctx.clearRect(0, 0, cw, ch);
      // Abdunkeln außerhalb des Zielbereichs
      const m = Hpx * 0.12, half = rmax * Hpx + m + (aktGruppe === 'becher' ? Hpx * 0.17 : 0);
      ctx.fillStyle = 'rgba(0,0,0,.38)';
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      if (ctx.roundRect) ctx.roundRect(cx - half, top - m, 2 * half, Hpx + 2 * m, 18);
      else ctx.rect(cx - half, top - m, 2 * half, Hpx + 2 * m);
      ctx.fill('evenodd');
      const gut = pruefung?.gut && lageGut();
      const farbe = gut ? '#7cf29a' : '#ffffff';
      // Umriss der typischen Form, frontal gesehen
      ctx.strokeStyle = farbe;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      prof.forEach((r, i) => { const y = top + (i / (prof.length - 1)) * Hpx; i ? ctx.lineTo(cx + r * Hpx, y) : ctx.moveTo(cx + r * Hpx, y); });
      for (let i = prof.length - 1; i >= 0; i--) ctx.lineTo(cx - prof[i] * Hpx, top + (i / (prof.length - 1)) * Hpx);
      ctx.closePath();
      ctx.stroke();
      // Mittellinie
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(cx, top - m * 1.5); ctx.lineTo(cx, bottom + m * 1.5); ctx.stroke();
      // Standlinie
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - half, bottom); ctx.lineTo(cx + half, bottom); ctx.stroke();
      // Augenhöhe: Kamera auf halber Höhe des Stücks
      const mitte = (top + bottom) / 2;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(cx - half, mitte); ctx.lineTo(cx + half, mitte); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = '600 12px -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = farbe;
      ctx.textAlign = 'left';
      ctx.fillText('Standlinie', cx - half + 6, bottom + 16);
      ctx.fillText('Kamera auf dieser Höhe', cx - half + 6, mitte - 6);
      // Wasserwaage
      if (lage) {
        const ok = lageGut();
        const r = Math.min(cw, ch) * 0.3;
        ctx.save();
        ctx.translate(cx, mitte);
        ctx.rotate(rad(lage.schief));
        ctx.strokeStyle = ok ? '#7cf29a' : '#ffcf5a';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * 0.25, 0); ctx.moveTo(r * 0.25, 0); ctx.lineTo(r, 0); ctx.stroke();
        ctx.restore();
        // Neigung: Blase am rechten Rand (Mitte = senkrecht)
        const bx = cw - 22, by = ch * 0.47, hh = ch * 0.18;
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, by - hh); ctx.lineTo(bx, by + hh); ctx.moveTo(bx - 8, by); ctx.lineTo(bx + 8, by); ctx.stroke();
        const off = Math.max(-1, Math.min(1, lage.blick / 25)) * hh;
        ctx.fillStyle = Math.abs(lage.blick) < 5 ? '#7cf29a' : '#ffcf5a';
        ctx.beginPath(); ctx.arc(bx, by + off, 7, 0, Math.PI * 2); ctx.fill();
      }
    };

    const lageGut = () => !lage || (Math.abs(lage.blick) < 5 && Math.abs(lage.schief) < 2);

    // Schnelle Bildprüfung: Stück vom Rand-Hintergrund trennen, Lage und Größe prüfen
    const klein = document.createElement('canvas');
    const kctx = klein.getContext('2d', { willReadFrequently: true });
    const pruefen = () => {
      if (!video.videoWidth || !zone) return null;
      const a = ausschnitt();
      const W = 72, H = Math.round((W * a.sh) / a.sw);
      klein.width = W; klein.height = H;
      kctx.drawImage(video, a.sx, a.sy, a.sw, a.sh, 0, 0, W, H);
      const d = kctx.getImageData(0, 0, W, H).data;
      let sr = 0, sg = 0, sb = 0, n = 0, hell = 0;
      const rand = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        hell += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        if (x < 3 || x >= W - 3 || y < 3) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; rand.push(i); }
      }
      hell /= W * H;
      sr /= n; sg /= n; sb /= n;
      let streu = 0;
      for (const i of rand) streu += Math.hypot(d[i] - sr, d[i + 1] - sg, d[i + 2] - sb);
      streu /= rand.length;
      const thr = Math.max(28, streu * 2.2);
      // Stück: Pixel, die sich deutlich vom Rand unterscheiden, im mittleren Bereich
      let x0 = W, x1 = -1, y0 = H, y1 = -1, cnt = 0;
      const zx0 = (zone.cx - zone.cw * 0.45) / zone.cw * W, zx1 = (zone.cx + zone.cw * 0.45) / zone.cw * W;
      const zyMax = (zone.bottom + zone.Hpx * 0.12) / zone.ch * H;
      for (let y = 0; y < H; y++) for (let x = Math.max(0, Math.floor(zx0)); x < Math.min(W, zx1); x++) {
        if (y > zyMax) continue; // Tisch vor dem Stück nicht mitzählen
        const i = (y * W + x) * 4;
        if (Math.hypot(d[i] - sr, d[i + 1] - sg, d[i + 2] - sb) > thr) { cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const res = { hell, unruhig: streu > 38 };
      if (cnt < W * H * 0.02) return { ...res, gefunden: false };
      const fy = v => (v / H) * zone.ch, fx = v => (v / W) * zone.cw;
      return { ...res, gefunden: true, oben: fy(y0), unten: fy(y1 + 1), mitte: fx((x0 + x1 + 1) / 2) };
    };

    const hinweis = () => {
      const p = pruefung;
      if (lage && lage.blick > 5) return 'Handy senkrechter halten – nicht nach unten kippen';
      if (lage && lage.blick < -5) return 'Handy nicht nach hinten kippen';
      if (lage && Math.abs(lage.schief) >= 2) return 'Handy gerade halten';
      if (!p) return 'Stück in den Umriss stellen';
      if (p.hell < 45) return 'Zu dunkel – mehr Licht';
      if (!p.gefunden) return 'Stück in den Umriss stellen';
      const { top, bottom, Hpx, cx, cw } = zone;
      const h = p.unten - p.oben;
      if (Math.abs(p.mitte - cx) > cw * 0.08) return p.mitte < cx ? 'Handy etwas nach links' : 'Handy etwas nach rechts';
      if (p.oben < top - Hpx * 0.18 || p.unten > bottom + Hpx * 0.15) return 'Etwas weiter weg (oder weniger zoomen)';
      if (h < Hpx * 0.6) return 'Näher heran (oder zoomen)';
      if (p.unten < bottom - Hpx * 0.15) return 'Standfläche auf die Standlinie';
      if (p.unten > bottom + Hpx * 0.1) return 'Standfläche auf die Standlinie';
      if (p.unruhig) return 'Tipp: ruhiger, einfarbiger Hintergrund wird genauer';
      return '';
    };

    const schleife = () => {
      if (!laeuft) return;
      zeichne();
      requestAnimationFrame(schleife);
    };
    const pruefSchleife = () => {
      if (!laeuft) return;
      try { pruefung = pruefen(); if (pruefung) pruefung.gut = !hinweis(); } catch { pruefung = null; }
      const t = hinweis();
      hinweisEl.textContent = t || (lage ? 'Gut so – auslösen' : 'Gut so – Handy senkrecht halten und auslösen');
      hinweisEl.classList.toggle('gut', !t);
      setTimeout(pruefSchleife, 280);
    };

    el.querySelector('.kamera-zu').onclick = () => ende(null);
    el.querySelector('.kamera-tipp').onclick = () => { tipps.hidden = false; };
    tipps.querySelector('button').onclick = () => { tipps.hidden = true; };
    if (galerie) el.querySelector('.kamera-galerie').onclick = () => { ende(null); galerie(); };
    el.querySelector('.kamera-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-gruppe]');
      if (!b) return;
      aktGruppe = b.dataset.gruppe;
      el.querySelectorAll('[data-gruppe]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      layout();
    });
    el.querySelector('.kamera-ausloeser').onclick = () => {
      if (!video.videoWidth) return;
      const a = ausschnitt();
      const c = document.createElement('canvas');
      c.width = Math.round(a.sw); c.height = Math.round(a.sh);
      c.getContext('2d').drawImage(video, a.sx, a.sy, a.sw, a.sh, 0, 0, c.width, c.height);
      const { top, bottom, Hpx, cx, rmax, cw, ch } = zone;
      const halb = rmax * Hpx + (aktGruppe === 'becher' ? Hpx * 0.17 : 0);
      // Brennweite: Hauptkamera ≈ 26 mm KB → 0,75 × lange Seite des vollen Videobilds
      const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
      const zoom = settings.zoom || 1;
      const brennweite = (0.75 * zoom * Math.max(video.videoWidth, video.videoHeight)) / Math.max(a.sw, a.sh);
      const meta = {
        gefuehrt: true,
        gruppe: aktGruppe,
        blick: lage ? Math.round(lage.blick * 10) / 10 : null,
        schief: lage ? Math.round(lage.schief * 10) / 10 : null,
        brennweite: Math.round(brennweite * 1000) / 1000,
        guide: { x0: (cx - halb) / cw, x1: (cx + halb) / cw, y0: top / ch, y1: bottom / ch },
      };
      c.toBlob(blob => ende(blob ? { blob, meta } : null), 'image/jpeg', 0.92);
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(s => {
        if (!laeuft) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        layout();
        window.addEventListener('resize', layout);
        schleife();
        pruefSchleife();
      })
      .catch(err => ende({ fehler: err?.name === 'NotAllowedError' ? 'Kein Zugriff auf die Kamera – bitte in den Einstellungen erlauben.' : 'Kamera nicht verfügbar.' }));
  });
}
