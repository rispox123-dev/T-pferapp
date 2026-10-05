// Grundmaße nach dem Foto abfragen: ein herausgerissener Zettel mit Höhe, Öffnung,
// breitester Stelle und Fuß. Ein Maß antippen → am unteren Rand erscheint ein Maßband.
// Wischen von rechts nach links vergrößert den Wert, von links nach rechts verkleinert ihn.
// Langsam gewischt ist ein Teilstrich ein Millimeter; je schneller, desto größer die Sprünge.

export const GRUNDMASSE = [
  ['hoehe', 'Höhe'],
  ['dOben', 'Ø Öffnung'],
  ['dMax', 'Ø breiteste Stelle'],
  ['dBoden', 'Ø Fuß'],
];

const START_MM = 50; // 5 cm
const MIN_MM = 1;
const MAX_MM = 1000;
const PX_JE_MM = 8; // Abstand der Millimeterstriche auf dem Maßband

// Verstärkung nach Wischgeschwindigkeit (px/ms): langsam genau 1:1, schnell bis 12-fach
const verstaerkung = v => (v <= 0.3 ? 1 : Math.min(12, 1 + 2.5 * ((v - 0.3) / 0.5) ** 1.5));

const cmText = mm => `${(mm / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;

// gleichbleibendes „Zittern“ der Bleistiftstriche je Millimeter
const zitter = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

function zufall(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Gerissene Kante als clip-path: ruhig wandernde Risslinie mit feinen Fasern
function riss(rand, innen) {
  const kante = (n, amp) => {
    const r = [];
    let v = rand() * amp;
    for (let i = 0; i <= n; i++) {
      v = Math.max(0, Math.min(amp, v + (rand() - 0.5) * amp * 0.9));
      r.push(innen + v + rand() * amp * 0.25);
    }
    return r;
  };
  const N = 44, M = 16;
  const oben = kante(N, 7), unten = kante(N, 7), rechts = kante(M, 4), links = kante(M, 4);
  const px = v => `${v.toFixed(1)}px`;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(`${(i / N * 100).toFixed(2)}% ${px(oben[i])}`);
  for (let j = 1; j < M; j++) pts.push(`calc(100% - ${px(rechts[j])}) ${(j / M * 100).toFixed(2)}%`);
  for (let i = N; i >= 0; i--) pts.push(`${(i / N * 100).toFixed(2)}% calc(100% - ${px(unten[i])})`);
  for (let j = M - 1; j > 0; j--) pts.push(`${px(links[j])} ${(j / M * 100).toFixed(2)}%`);
  return `polygon(${pts.join(',')})`;
}

// Zusätzliche Stellen, die der Nutzer selbst einträgt (z. B. bei Zickzack-Wänden,
// die die Formerkennung schlecht trifft); je Stelle Durchmesser und Höhe vom Boden
export const STELLEN_ARTEN = [
  ['taille', 'Taille'],
  ['schulter', 'Schulter'],
  ['bauch', 'Bauch'],
];

// „Taille“, bei mehreren derselben Art „Taille 1“, „Taille 2“ …
export function stelleName(stellen, s) {
  const gleich = stellen.filter(x => x.art === s.art);
  const name = STELLEN_ARTEN.find(a => a[0] === s.art)?.[1] || 'Stelle';
  return gleich.length > 1 ? `${name} ${gleich.indexOf(s) + 1}` : name;
}

const neueId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// kleine Skizze: wo wird gemessen?
const SKIZZE = `<svg class="masse-skizze" viewBox="0 0 100 112" aria-hidden="true">
  <g class="topf">
    <path d="M32 18C26 32 16 44 18 60C20 77 30 89 34 98M68 18C74 32 84 44 82 60C80 77 70 89 66 98"/>
    <ellipse cx="50" cy="18" rx="18" ry="3.6"/>
    <path d="M34 98C40 100.5 60 100.5 66 98"/>
  </g>
  <g class="mass" data-mass="hoehe"><path d="M93 18V98M89 18H97M89 98H97"/></g>
  <g class="mass" data-mass="dOben"><path d="M32 9H68M32 5V13M68 5V13"/></g>
  <g class="mass" data-mass="dMax"><path d="M18 60H82M18 56V64M82 56V64"/></g>
  <g class="mass" data-mass="dBoden"><path d="M34 107H66M34 103V111M66 103V111"/></g>
  <g class="mass" data-mass="stelle"><path/></g>
</svg>`;

// halbe Breite des Skizzen-Topfs auf Höhe y (für die Linie einer eigenen Stelle)
const TOPF = [[18, 18], [32, 27], [44, 31], [60, 32], [77, 30], [89, 23], [98, 16]];
function topfBreite(y) {
  for (let i = 1; i < TOPF.length; i++) {
    if (y <= TOPF[i][0]) {
      const [a, b] = [TOPF[i - 1], TOPF[i]];
      return a[1] + ((y - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return 16;
}

// gezeichneter Mülleimer
const MUELL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.6C9 6.1 15 6.2 19.6 6.8M9.6 6.3C9.5 4.6 10 3.9 12 3.9S14.6 4.5 14.4 6.4M6.4 7.2L7.6 19.6C7.8 20.6 8.4 20.9 9.4 20.9L14.8 20.8C15.8 20.8 16.3 20.4 16.4 19.5L17.6 7.3M10.1 10L10.4 17.8M13.9 10.1L13.6 17.7"/></svg>`;
const PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.2 6.4C12 10 12.1 14.5 11.9 17.8M6.3 12.1C10 11.9 14.2 12.2 17.8 11.9"/><path d="M12 2.8C6.6 2.6 2.9 6.6 3 12.1S7 21.3 12.3 21.1 21.2 17 21 11.7 17.2 2.9 11.4 3.1" class="kreis"/></svg>`;

// werte: { hoehe, dOben, dMax, dBoden } in cm (oder leer); stellen: [{ id, art, d, h }] in cm.
// Ergebnis: { werte: geänderte Grundmaße in cm, stellen: alle Stellen in cm } oder null (Esc)
export function masseAbfragen(werte = {}, stellen = []) {
  return new Promise(resolve => {
    const zuMm = v => (v != null && v !== '' && Number(v) > 0 ? Math.round(Number(v) * 10) : null);
    const start = {};
    const mm = {};
    for (const [k] of GRUNDMASSE) start[k] = mm[k] = zuMm(werte[k]);
    const st = stellen.map(s => ({ id: s.id, art: s.art, d: zuMm(s.d) ?? START_MM, h: zuMm(s.h) ?? START_MM }));
    let aktiv = null; // gewähltes Feld: Grundmaß-Schlüssel oder „<id>:d“ / „<id>:h“
    let pos = START_MM; // Lage des Maßbands (mm, stufenlos); der Wert ist die gerundete Lage

    const stelleVon = f => st.find(s => f.startsWith(`${s.id}:`));
    const lies = f => { const s = stelleVon(f); return s ? s[f.slice(-1)] : mm[f]; };
    const schreib = (f, v) => { const s = stelleVon(f); if (s) s[f.slice(-1)] = v; else mm[f] = v; };
    const feldName = f => {
      const s = stelleVon(f);
      if (!s) return GRUNDMASSE.find(m => m[0] === f)[1];
      return f.endsWith(':d') ? `Ø ${stelleName(st, s)}` : `Höhe ${stelleName(st, s)}`;
    };

    const dlg = document.createElement('dialog');
    dlg.className = 'masse';
    dlg.setAttribute('aria-label', 'Maße deines Stücks');
    dlg.innerHTML = `
      <div class="masse-buehne">
        <div class="fetzen-schatten">
          <div class="fetzen-rand"></div>
          <div class="fetzen">
            <h2>Maße deines Stücks</h2>
            <p class="hint">Mit den genauen Maßen wird die Blaupause am besten.</p>
            <div class="masse-inhalt">
              ${SKIZZE}
              <ul class="masse-liste">
                ${GRUNDMASSE.map(([k, label]) => `<li><button type="button" class="masse-zeile" data-f="${k}" aria-pressed="false">
                  <span class="masse-name">${label}</span><span class="masse-wert"></span></button></li>`).join('')}
              </ul>
            </div>
            <ul class="masse-stellen"></ul>
            <div class="masse-plus">
              <button type="button" class="plus-knopf" aria-label="Stelle hinzufügen" aria-expanded="false">${PLUS}</button>
              <div class="plus-wahl" hidden>
                ${STELLEN_ARTEN.map(([art, label]) => `<button type="button" data-art="${art}">${label}</button>`).join('')}
              </div>
            </div>
            <p class="hint masse-tipp">Tippe ein Maß an.</p>
            <div class="sheet-buttons">
              <button type="button" class="btn primary" data-ende="ok">Übernehmen</button>
            </div>
          </div>
        </div>
      </div>
      <div class="massband" aria-hidden="true">
        <canvas role="slider" tabindex="-1" aria-label="Maßband" aria-valuemin="${MIN_MM / 10}" aria-valuemax="${MAX_MM / 10}"></canvas>
      </div>`;
    document.body.append(dlg);

    const rand = zufall(Date.now());
    const fetzen = dlg.querySelector('.fetzen');
    const fetzenRand = dlg.querySelector('.fetzen-rand');
    // Risskante passend zur Größe des Zettels (er wächst mit den Stellen)
    const reissen = () => {
      fetzen.style.clipPath = riss(rand, 3);
      fetzenRand.style.clipPath = riss(rand, 0);
    };
    reissen();

    const band = dlg.querySelector('.massband');
    const canvas = band.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const tipp = dlg.querySelector('.masse-tipp');
    const stellenListe = dlg.querySelector('.masse-stellen');
    const plusKnopf = dlg.querySelector('.plus-knopf');
    const plusWahl = dlg.querySelector('.plus-wahl');
    const feld = f => dlg.querySelector(`[data-f="${f}"]`);

    const zeigeWert = f => {
      const el = feld(f)?.querySelector('.masse-wert');
      if (!el) return;
      const v = lies(f);
      el.textContent = v == null ? '–' : cmText(v);
      if (f === aktiv) {
        canvas.setAttribute('aria-valuenow', String(v / 10));
        canvas.setAttribute('aria-valuetext', cmText(v));
      }
    };

    const zeigeStellen = () => {
      stellenListe.innerHTML = st.map(s => `<li class="stelle" data-id="${s.id}">
        <span class="masse-name">${stelleName(st, s)}</span>
        <button type="button" class="stelle-feld" data-f="${s.id}:d" aria-pressed="false" aria-label="Durchmesser ${stelleName(st, s)}"><small>Ø</small><span class="masse-wert"></span></button>
        <button type="button" class="stelle-feld" data-f="${s.id}:h" aria-pressed="false" aria-label="Höhe vom Boden ${stelleName(st, s)}"><small>auf Höhe</small><span class="masse-wert"></span></button>
        <button type="button" class="muell" data-weg="${s.id}" aria-label="${stelleName(st, s)} löschen">${MUELL}</button>
      </li>`).join('');
      for (const s of st) { zeigeWert(`${s.id}:d`); zeigeWert(`${s.id}:h`); }
      markieren();
      reissen();
    };

    // gewähltes Feld hervorheben und in der Skizze zeigen
    const markieren = () => {
      for (const b of dlg.querySelectorAll('[data-f]')) b.setAttribute('aria-pressed', String(b.dataset.f === aktiv));
      const s = aktiv && stelleVon(aktiv);
      for (const g of dlg.querySelectorAll('.masse-skizze .mass')) g.classList.toggle('an', s ? g.dataset.mass === 'stelle' : g.dataset.mass === aktiv);
      if (s) {
        const H = mm.hoehe || Math.max(100, s.h + 20);
        const y = Math.max(20, Math.min(96, 98 - (s.h / H) * 80));
        const b = topfBreite(y);
        dlg.querySelector('[data-mass="stelle"] path').setAttribute('d', aktiv.endsWith(':d')
          ? `M${50 - b} ${y}H${50 + b}M${50 - b} ${y - 4}V${y + 4}M${50 + b} ${y - 4}V${y + 4}`
          : `M7 ${y}V98M3 ${y}H11M3 98H11M11 ${y}H${50 - b}`);
      }
    };

    for (const [k] of GRUNDMASSE) zeigeWert(k);
    zeigeStellen();

    // ---------- Zeichnen ----------
    let geplant = false;
    const zeichnenBald = () => {
      if (geplant) return;
      geplant = true;
      requestAnimationFrame(() => { geplant = false; zeichnen(); });
    };

    function zeichnen() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const d = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
        canvas.width = Math.round(w * d);
        canvas.height = Math.round(h * d);
      }
      const css = getComputedStyle(dlg);
      const stift = css.getPropertyValue('--text').trim() || '#3d3b38';
      const akzent = css.getPropertyValue('--accent').trim() || '#a4532f';
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mitte = w / 2;
      const von = Math.max(0, Math.floor(pos - mitte / PX_JE_MM) - 1);
      const bis = Math.min(MAX_MM, Math.ceil(pos + mitte / PX_JE_MM) + 1);
      const schrift = Math.round(Math.max(15, Math.min(24, h * 0.2)));
      ctx.font = `${schrift}px "Bleistift Hand", "Patrick Hand", cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineCap = 'round';
      ctx.strokeStyle = ctx.fillStyle = stift;
      for (let n = von; n <= bis; n++) {
        const x = mitte + (n - pos) * PX_JE_MM;
        const cm = n % 10 === 0, halb = n % 5 === 0;
        const z = zitter(n);
        const lang = h * (cm ? 0.36 : halb ? 0.25 : 0.15) + (z - 0.5) * 2.5;
        ctx.globalAlpha = cm ? 0.85 : halb ? 0.65 : 0.42 + z * 0.12;
        ctx.lineWidth = cm ? 1.6 : 1.1;
        ctx.beginPath();
        ctx.moveTo(x + (z - 0.5) * 0.8, 0);
        ctx.lineTo(x - (z - 0.5) * 0.8, lang);
        ctx.stroke();
        if (cm) {
          ctx.globalAlpha = 0.8;
          ctx.fillText(String(n / 10), x, lang + 5);
        }
      }
      // Ablesemarke in der Mitte
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ctx.fillStyle = akzent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mitte, 0);
      ctx.lineTo(mitte, h * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mitte - 7, 0);
      ctx.lineTo(mitte + 7, 0);
      ctx.lineTo(mitte, 9);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    document.fonts?.load?.('20px "Bleistift Hand"').then(zeichnenBald, () => {});

    // ---------- Wert ändern ----------
    const setze = neu => {
      pos = Math.max(MIN_MM, Math.min(MAX_MM, neu));
      const wert = Math.round(pos);
      const alt = aktiv ? lies(aktiv) : null;
      if (aktiv && wert !== alt) {
        // beim Überschreiten eines Zentimeters ganz leicht vibrieren
        if (alt != null && Math.floor(wert / 10) !== Math.floor(alt / 10)) navigator.vibrate?.(4);
        schreib(aktiv, wert);
        zeigeWert(aktiv);
        if (stelleVon(aktiv) || aktiv === 'hoehe') markieren();
      }
      zeichnenBald();
    };

    const bandZu = () => {
      aktiv = null;
      band.classList.remove('offen');
      band.setAttribute('aria-hidden', 'true');
      canvas.tabIndex = -1;
      tipp.textContent = 'Tippe ein Maß an.';
      markieren();
    };

    const waehle = f => {
      aktiv = f;
      if (lies(f) == null) schreib(f, START_MM);
      pos = lies(f);
      schwung = 0;
      markieren();
      zeigeWert(f);
      canvas.setAttribute('aria-label', `Maßband: ${feldName(f)}`);
      canvas.tabIndex = 0;
      band.removeAttribute('aria-hidden');
      band.classList.add('offen');
      const s = stelleVon(f);
      tipp.textContent = s && f.endsWith(':h')
        ? `Höhe vom Boden bis ${s.art === 'bauch' ? 'zum' : 'zur'} ${stelleName(st, s)}. Maßband nach links wischen: größer, nach rechts: kleiner.`
        : 'Maßband nach links wischen: größer, nach rechts: kleiner. Langsam wischen für Millimeter.';
      zeichnenBald();
    };

    fetzen.addEventListener('click', e => {
      const b = e.target.closest('[data-f]');
      if (b) return waehle(b.dataset.f);
      const weg = e.target.closest('[data-weg]');
      if (weg) {
        const i = st.findIndex(s => s.id === weg.dataset.weg);
        if (aktiv && stelleVon(aktiv) === st[i]) bandZu();
        st.splice(i, 1);
        zeigeStellen();
        return;
      }
      if (e.target.closest('.plus-knopf')) {
        plusWahl.hidden = !plusWahl.hidden;
        plusKnopf.setAttribute('aria-expanded', String(!plusWahl.hidden));
        reissen();
        return;
      }
      const art = e.target.closest('[data-art]');
      if (art) {
        const s = { id: neueId(), art: art.dataset.art, d: START_MM, h: START_MM };
        st.push(s);
        plusWahl.hidden = true;
        plusKnopf.setAttribute('aria-expanded', 'false');
        zeigeStellen();
        waehle(`${s.id}:d`);
        feld(`${s.id}:d`).focus();
      }
    });

    // ---------- Wischen ----------
    let zug = null;   // laufende Wischbewegung
    let schwung = 0;  // Nachlauf nach schnellem Loslassen (mm/ms)
    let lauf = 0;     // requestAnimationFrame des Nachlaufs

    canvas.addEventListener('pointerdown', e => {
      if (!aktiv) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      zug = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0, mmMs: 0 };
      schwung = 0;
    });
    canvas.addEventListener('pointermove', e => {
      if (!zug || e.pointerId !== zug.id) return;
      const dx = e.clientX - zug.x;
      const dt = Math.max(1, e.timeStamp - zug.t);
      zug.v = zug.v * 0.6 + (Math.abs(dx) / dt) * 0.4;
      const dmm = (-dx / PX_JE_MM) * verstaerkung(zug.v);
      zug.mmMs = zug.mmMs * 0.6 + (dmm / dt) * 0.4;
      zug.x = e.clientX;
      zug.t = e.timeStamp;
      setze(pos + dmm);
    });
    const loslassen = e => {
      if (!zug || e.pointerId !== zug.id) return;
      // schnell losgelassen: das Maßband läuft ein Stück nach
      if (zug.v > 0.6 && e.timeStamp - zug.t < 80) schwung = Math.max(-0.6, Math.min(0.6, zug.mmMs * 0.5));
      zug = null;
      nachlauf();
    };
    canvas.addEventListener('pointerup', loslassen);
    canvas.addEventListener('pointercancel', loslassen);

    // Nachlauf, danach auf den nächsten Millimeter einrasten
    function nachlauf() {
      cancelAnimationFrame(lauf);
      let t0 = performance.now();
      const schritt = t => {
        const dt = Math.min(50, t - t0);
        t0 = t;
        if (zug || !aktiv) return;
        if (schwung) {
          setze(pos + schwung * dt);
          schwung *= 0.985 ** dt;
          if (Math.abs(schwung) < 0.005 || pos <= MIN_MM || pos >= MAX_MM) schwung = 0;
        } else {
          const ziel = Math.round(pos);
          if (Math.abs(ziel - pos) < 0.02) { setze(ziel); return; }
          setze(pos + (ziel - pos) * Math.min(1, dt / 50));
        }
        lauf = requestAnimationFrame(schritt);
      };
      lauf = requestAnimationFrame(schritt);
    }

    // Mausrad / Trackpad am Rechner
    canvas.addEventListener('wheel', e => {
      if (!aktiv) return;
      e.preventDefault();
      schwung = 0;
      setze(pos + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY) / PX_JE_MM);
      clearTimeout(canvas.rast);
      canvas.rast = setTimeout(nachlauf, 120);
    }, { passive: false });

    // Pfeiltasten: 1 mm, mit Umschalt 1 cm
    dlg.addEventListener('keydown', e => {
      if (!aktiv || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (!e.target.closest('[data-f]') && e.target !== canvas) return;
      e.preventDefault();
      const s = (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      schwung = 0;
      setze(Math.round(pos) + s);
    });

    const onResize = () => zeichnenBald();
    window.addEventListener('resize', onResize);

    // ---------- Ende ----------
    dlg.querySelector('[data-ende="ok"]').addEventListener('click', () => dlg.close('ok'));
    dlg.addEventListener('close', () => {
      cancelAnimationFrame(lauf);
      window.removeEventListener('resize', onResize);
      let res = null;
      if (dlg.returnValue === 'ok') {
        res = { werte: {}, stellen: st.map(s => ({ id: s.id, art: s.art, d: s.d / 10, h: s.h / 10 })) };
        for (const [k] of GRUNDMASSE) if (mm[k] != null && mm[k] !== start[k]) res.werte[k] = mm[k] / 10;
      }
      dlg.remove();
      resolve(res);
    });
    dlg.showModal();
    // kein Eingabefeld: nicht gleich ein Maß fokussieren
    dlg.querySelector('.fetzen h2').tabIndex = -1;
    dlg.querySelector('.fetzen h2').focus();
  });
}
