// Grundmaße nach dem Foto abfragen: ein herausgerissener Zettel mit Höhe, Öffnung,
// breitester Stelle und Fuß. Ein Maß antippen → am unteren Rand erscheint ein Maßband.
// Wischen von rechts nach links vergrößert den Wert, von links nach rechts verkleinert ihn.
// Langsam gewischt ist ein Teilstrich ein Millimeter; je schneller, desto größer die Sprünge.
// Dasselbe Maßband dient überall in der App, wo Werte eingestellt werden (massAbfragen: einzelne
// Maße der Blaupause mit der Schätzung aus dem Foto als Startwert, Gewichte, Zeiten, Temperatur …);
// jede Einheit hat ihre eigene Skala (SKALEN).

export const GRUNDMASSE = [
  ['hoehe', 'Höhe'],
  ['dOben', 'Ø Öffnung'],
  ['dMax', 'Ø breiteste Stelle'],
  ['dBoden', 'Ø Fuß'],
];

// Skalen des Maßbands. Ein Teilstrich ist ein Schritt; jeder „gross“-te Strich ist lang und
// beschriftet (beim Überschreiten vibriert es leicht), jeder „mittel“-te halblang. px: Abstand
// der Teilstriche; schnell: größte Verstärkung beim schnellen Wischen (lange Skalen mehr);
// fest: Nachkommastellen, die immer gezeigt werden; start: Startwert ohne Eintrag.
export const SKALEN = {
  cm: { einheit: 'cm', schritt: 0.1, fest: 1, gross: 10, mittel: 5, px: 8, min: 0.1, max: 100, start: 5 },
  mm: { einheit: 'mm', schritt: 0.1, fest: 1, gross: 10, mittel: 5, px: 8, min: 0.1, max: 50, start: 5 },
  g: { einheit: 'g', schritt: 1, gross: 10, mittel: 5, px: 8, min: 1, max: 20000, start: 500, schnell: 40 },
  gl: { einheit: 'g/l', schritt: 1, gross: 10, mittel: 5, px: 8, min: 1000, max: 2500, start: 1450, schnell: 20 },
  sek: { einheit: 'Sek.', schritt: 0.5, gross: 2, px: 20, min: 0, max: 600, start: 3 },
  mal: { einheit: '×', schritt: 1, gross: 1, px: 48, min: 1, max: 30, start: 1, schnell: 3 },
  grad: { einheit: '°C', schritt: 1, gross: 10, mittel: 5, px: 8, min: 500, max: 1400, start: 1240, schnell: 20 },
  min: { einheit: 'min', schritt: 1, gross: 5, px: 14, min: 0, max: 600, start: 10 },
  anteil: { einheit: '', schritt: 0.1, gross: 10, mittel: 5, px: 8, min: 0, max: 1000, start: 10, schnell: 20 },
};

const skalaVon = s => (typeof s === 'string' ? SKALEN[s] : s) || SKALEN.cm;
const stellenVon = x => (String(x).split('.')[1] || '').length;
// Wert ↔ Teilstriche (ganze Zahl); leer, 0 bei Skalen ohne 0 oder keine Zahl → null
export function zuStrichen(v, skala) {
  const sk = skalaVon(skala);
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (v == null || v === '' || !Number.isFinite(n) || (sk.min > 0 && n <= 0)) return null;
  return Math.round(n / sk.schritt);
}
const ausStrichen = (t, skala) => Math.round(t * skalaVon(skala).schritt * 1000) / 1000;
const zahlText = (v, sk) => v.toLocaleString('de-DE', { useGrouping: false, minimumFractionDigits: sk.fest || 0, maximumFractionDigits: Math.max(sk.fest || 0, stellenVon(sk.schritt)) });
// „6,3 cm“, „3,5 Sek.“, „1240 °C“
export function wertText(v, skala) {
  const sk = skalaVon(skala);
  return `${zahlText(Number(v), sk)}${sk.einheit ? ` ${sk.einheit}` : ''}`;
}

// Grundmaße und Stellen auf dem Zettel: Zentimeter, ein Teilstrich = 1 mm
const START_MM = 50; // 5 cm
const cmText = mm => wertText(mm / 10, SKALEN.cm);

// Verstärkung nach Wischgeschwindigkeit (px/ms): langsam genau 1:1, schnell bis max-fach
const verstaerkung = (v, max = 12) => (v <= 0.3 ? 1 : Math.min(max, 1 + 2.5 * ((v - 0.3) / 0.5) ** 1.5 * (max / 12)));

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

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// gezeichneter Radiergummi: eingetragenen Wert wieder löschen
const RADIERER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.3 15.4L12.9 6.3C13.6 5.6 14.5 5.6 15.2 6.2L19.1 9.9C19.8 10.6 19.8 11.5 19.1 12.2L11.5 20.2 7.5 20.3 4.4 17.2C3.9 16.7 3.9 15.9 4.3 15.4Z"/><path d="M8.9 10.8L14.5 16.2M11.6 20.2C14.6 20.1 17.6 20.3 20.4 20" class="duenn"/></svg>`;

// Zettel mit Risskante und Maßband darunter; inhalt: HTML auf dem Zettel. Auch für andere
// Zettel der App (z. B. das Rezept vom Foto), dann ohne Maßband und mit eigener Klasse.
export function zettelDialog(titel, inhalt, { massband = true, klasse = '' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `masse ${klasse}`.trim();
  dlg.setAttribute('aria-label', titel);
  dlg.innerHTML = `
    <div class="masse-buehne">
      <div class="fetzen-schatten">
        <div class="fetzen-rand"></div>
        <div class="fetzen">${inhalt}</div>
      </div>
    </div>
    ${massband ? `<div class="massband" aria-hidden="true">
      <canvas role="slider" tabindex="-1" aria-label="Maßband"></canvas>
    </div>` : ''}`;
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
  return { dlg, fetzen, reissen };
}

// Kein Eingabefeld: nicht gleich ein Maß fokussieren (sonst springt die Tastatur auf)
export function zettelZeigen(dlg) {
  dlg.showModal();
  const h2 = dlg.querySelector('.fetzen h2');
  h2.tabIndex = -1;
  h2.focus();
}

// Messlinie in der Skizze hervorheben. mass: 'hoehe', 'dOben', 'dMax', 'dBoden' oder
// 'stelle'; stelle: { was: 'd' | 'h', h: Höhe der Stelle vom Boden (mm), H: Höhe des Stücks (mm) }
function skizzeMarkieren(svg, mass, stelle) {
  for (const g of svg.querySelectorAll('.mass')) g.classList.toggle('an', g.dataset.mass === mass);
  if (mass !== 'stelle' || !stelle) return;
  const H = stelle.H || Math.max(100, stelle.h + 20);
  const y = Math.max(20, Math.min(96, 98 - (stelle.h / H) * 80));
  const b = topfBreite(y);
  svg.querySelector('[data-mass="stelle"] path').setAttribute('d', stelle.was === 'd'
    ? `M${50 - b} ${y}H${50 + b}M${50 - b} ${y - 4}V${y + 4}M${50 + b} ${y - 4}V${y + 4}`
    : `M7 ${y}V98M3 ${y}H11M3 98H11M11 ${y}H${50 - b}`);
}

// Das Maßband am unteren Rand eines Zettels: Zeichnen, Wischen mit Nachlauf, Mausrad,
// Pfeiltasten. aendern(t) wird bei jedem neuen (auf den Teilstrich gerundeten) Wert gerufen;
// t zählt Teilstriche der gerade gezeigten Skala (bei Zentimetern also Millimeter).
function massbandAnbringen(dlg, aendern) {
  const band = dlg.querySelector('.massband');
  const canvas = band.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let an = false;     // Maßband offen
  let sk = SKALEN.cm; // gezeigte Skala
  let minT = 1, maxT = 1000; // Grenzen in Teilstrichen
  let pos = START_MM; // Lage des Maßbands (Teilstriche, stufenlos); der Wert ist die gerundete Lage
  let wert = null;    // zuletzt gemeldeter Wert (Teilstriche)

  const zeigeWert = () => {
    canvas.setAttribute('aria-valuenow', String(ausStrichen(wert, sk)));
    canvas.setAttribute('aria-valuetext', wertText(ausStrichen(wert, sk), sk));
  };

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
    const von = Math.max(minT, Math.floor(pos - mitte / sk.px) - 1);
    const bis = Math.min(maxT, Math.ceil(pos + mitte / sk.px) + 1);
    const schrift = Math.round(Math.max(15, Math.min(24, h * 0.2)));
    ctx.font = `${schrift}px "Bleistift Hand", "Patrick Hand", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineCap = 'round';
    ctx.strokeStyle = ctx.fillStyle = stift;
    for (let n = von; n <= bis; n++) {
      const x = mitte + (n - pos) * sk.px;
      const cm = n % sk.gross === 0, halb = !!sk.mittel && n % sk.mittel === 0;
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
        ctx.fillText(zahlText(ausStrichen(n, sk), { schritt: sk.gross * sk.schritt }), x, lang + 5);
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
    pos = Math.max(minT, Math.min(maxT, neu));
    const w = Math.round(pos);
    if (an && w !== wert) {
      // beim Überschreiten eines beschrifteten Strichs (z. B. eines Zentimeters) leicht vibrieren
      if (wert != null && Math.floor(w / sk.gross) !== Math.floor(wert / sk.gross)) navigator.vibrate?.(4);
      wert = w;
      zeigeWert();
      aendern(w);
    }
    zeichnenBald();
  };

  // ---------- Wischen ----------
  let zug = null;   // laufende Wischbewegung
  let schwung = 0;  // Nachlauf nach schnellem Loslassen (mm/ms)
  let lauf = 0;     // requestAnimationFrame des Nachlaufs

  canvas.addEventListener('pointerdown', e => {
    if (!an) return;
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
    const dmm = (-dx / sk.px) * verstaerkung(zug.v, sk.schnell);
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
      if (zug || !an) return;
      if (schwung) {
        setze(pos + schwung * dt);
        schwung *= 0.985 ** dt;
        if (Math.abs(schwung) < 0.005 || pos <= minT || pos >= maxT) schwung = 0;
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
    if (!an) return;
    e.preventDefault();
    schwung = 0;
    setze(pos + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY) / sk.px);
    clearTimeout(canvas.rast);
    canvas.rast = setTimeout(nachlauf, 120);
  }, { passive: false });

  // Pfeiltasten (auf dem gewählten Maß oder dem Maßband): ein Teilstrich (1 mm), mit Umschalt
  // bis zum nächsten beschrifteten Strich weit (1 cm)
  dlg.addEventListener('keydown', e => {
    if (!an || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    if (!e.target.closest('[data-f]') && e.target !== canvas) return;
    e.preventDefault();
    const s = (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? sk.gross : 1);
    schwung = 0;
    setze(Math.round(pos) + s);
  });

  const onResize = () => zeichnenBald();
  window.addEventListener('resize', onResize);

  return {
    // Maßband für einen Wert öffnen: Startwert (Teilstriche), Name für Bildschirmleser, Skala
    zeigen(t, name, skala = SKALEN.cm) {
      an = true;
      sk = skalaVon(skala);
      minT = zuStrichen(sk.min, { ...sk, min: 0 });
      maxT = zuStrichen(sk.max, sk);
      canvas.setAttribute('aria-valuemin', String(sk.min));
      canvas.setAttribute('aria-valuemax', String(sk.max));
      pos = wert = Math.max(minT, Math.min(maxT, Math.round(t)));
      schwung = 0;
      zeigeWert();
      canvas.setAttribute('aria-label', `Maßband: ${name}`);
      canvas.tabIndex = 0;
      band.removeAttribute('aria-hidden');
      band.classList.add('offen');
      zeichnenBald();
    },
    verbergen() {
      an = false;
      band.classList.remove('offen');
      band.setAttribute('aria-hidden', 'true');
      canvas.tabIndex = -1;
    },
    abbauen() {
      an = false;
      cancelAnimationFrame(lauf);
      window.removeEventListener('resize', onResize);
    },
  };
}

const wischTipp = (sk = SKALEN.cm) => `Maßband nach links wischen: größer, nach rechts: kleiner. Langsam wischen für ${sk.einheit === 'cm' || sk.einheit === 'mm' ? 'Millimeter' : 'feine Schritte'}.`;

// werte: { hoehe, dOben, dMax, dBoden } in cm (oder leer); stellen: [{ id, art, d, h }] in cm.
// Ergebnis: { werte: geänderte Grundmaße in cm, stellen: alle Stellen in cm } oder null (Esc)
// waehlen: dieses Grundmaß gleich antippen (Maßband offen)
export function masseAbfragen(werte = {}, stellen = [], { waehlen } = {}) {
  return new Promise(resolve => {
    const zuMm = v => zuStrichen(v, SKALEN.cm);
    const start = {};
    const mm = {};
    for (const [k] of GRUNDMASSE) start[k] = mm[k] = zuMm(werte[k]);
    const st = stellen.map(s => ({ id: s.id, art: s.art, d: zuMm(s.d) ?? START_MM, h: zuMm(s.h) ?? START_MM }));
    let aktiv = null; // gewähltes Feld: Grundmaß-Schlüssel oder „<id>:d“ / „<id>:h“

    const stelleVon = f => st.find(s => f.startsWith(`${s.id}:`));
    const lies = f => { const s = stelleVon(f); return s ? s[f.slice(-1)] : mm[f]; };
    const schreib = (f, v) => { const s = stelleVon(f); if (s) s[f.slice(-1)] = v; else mm[f] = v; };
    const feldName = f => {
      const s = stelleVon(f);
      if (!s) return GRUNDMASSE.find(m => m[0] === f)[1];
      return f.endsWith(':d') ? `Ø ${stelleName(st, s)}` : `Höhe ${stelleName(st, s)}`;
    };

    const { dlg, fetzen, reissen } = zettelDialog('Maße deines Stücks', `
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
      </div>`);

    const tipp = dlg.querySelector('.masse-tipp');
    const skizze = dlg.querySelector('.masse-skizze');
    const stellenListe = dlg.querySelector('.masse-stellen');
    const plusKnopf = dlg.querySelector('.plus-knopf');
    const plusWahl = dlg.querySelector('.plus-wahl');
    const feld = f => dlg.querySelector(`[data-f="${f}"]`);

    const zeigeWert = f => {
      const el = feld(f)?.querySelector('.masse-wert');
      if (!el) return;
      const v = lies(f);
      el.textContent = v == null ? '–' : cmText(v);
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
      skizzeMarkieren(skizze, s ? 'stelle' : aktiv, s && { was: aktiv.slice(-1), h: s.h, H: mm.hoehe });
    };

    for (const [k] of GRUNDMASSE) zeigeWert(k);
    zeigeStellen();

    const band = massbandAnbringen(dlg, wert => {
      schreib(aktiv, wert);
      zeigeWert(aktiv);
      if (stelleVon(aktiv) || aktiv === 'hoehe') markieren();
    });

    const bandZu = () => {
      aktiv = null;
      band.verbergen();
      tipp.textContent = 'Tippe ein Maß an.';
      markieren();
    };

    const waehle = f => {
      aktiv = f;
      if (lies(f) == null) schreib(f, START_MM);
      markieren();
      zeigeWert(f);
      band.zeigen(lies(f), feldName(f));
      const s = stelleVon(f);
      tipp.textContent = s && f.endsWith(':h')
        ? `Höhe vom Boden bis ${s.art === 'bauch' ? 'zum' : 'zur'} ${stelleName(st, s)}. Maßband nach links wischen: größer, nach rechts: kleiner.`
        : wischTipp();
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

    // ---------- Ende ----------
    dlg.querySelector('[data-ende="ok"]').addEventListener('click', () => dlg.close('ok'));
    dlg.addEventListener('close', () => {
      band.abbauen();
      let res = null;
      if (dlg.returnValue === 'ok') {
        res = { werte: {}, stellen: st.map(s => ({ id: s.id, art: s.art, d: s.d / 10, h: s.h / 10 })) };
        for (const [k] of GRUNDMASSE) if (mm[k] != null && mm[k] !== start[k]) res.werte[k] = mm[k] / 10;
      }
      dlg.remove();
      resolve(res);
    });
    zettelZeigen(dlg);
    if (waehlen && feld(waehlen)) { waehle(waehlen); feld(waehlen).focus(); }
  });
}

// Einen oder mehrere Werte mit dem Maßband einstellen – Maße der Blaupause, aber auch
// Gewicht, Tauchdauer, Temperatur …
//   titel:       Überschrift des Zettels (z. B. „Ø Taille“)
//   felder:      [{ f, name, wert, skala, start, schaetzung, skizze, leeren }]
//                skala: Schlüssel aus SKALEN (Vorgabe 'cm'); start: Startwert ohne Eintrag (sonst
//                der der Skala); schaetzung wird als „≈“ gezeigt und ist dann der Startwert;
//                skizze: 'hoehe', 'dOben', 'dMax', 'dBoden' oder 'd' / 'h' (Ø bzw. Höhenlage einer
//                Stelle) – nur wenn alle Felder eine haben, steht die Skizze auf dem Zettel;
//                leeren: der Radiergummi löscht den Wert wieder
//   waehlen:     dieses Feld gleich antippen (Maßband offen)
//   hinweis:     kleiner Text unter der Überschrift
//   hoehe:       Höhe des Stücks in cm (für die Skizze)
//   bezeichnung: Name der Stelle zum Ändern (undefined: kein Namensfeld)
//   entfernen:   Beschriftung des Knopfs, der die Stelle löscht oder ausblendet
// Ergebnis: { aktion: 'ok' | 'entfernen', werte: { f: Wert oder null }, bezeichnung } oder null
export function massAbfragen({ titel, felder, waehlen, hinweis = '', hoehe = null, bezeichnung, entfernen = '' }) {
  return new Promise(resolve => {
    const fd = f => felder.find(x => x.f === f);
    const sk = f => skalaVon(fd(f).skala);
    const t = {}; // Werte in Teilstrichen der jeweiligen Skala
    const geaendert = new Set();
    for (const x of felder) t[x.f] = zuStrichen(x.wert, x.skala);
    const geschaetzt = f => zuStrichen(fd(f).schaetzung, fd(f).skala);
    let aktiv = null;
    const mitSkizze = felder.every(x => x.skizze);
    const ruhe = `Tippe ${felder.length > 1 ? 'einen Wert' : 'den Wert'} an.${felder.some(x => x.schaetzung > 0) ? ' Werte mit ≈ sind aus dem Foto geschätzt.' : ''}`;

    const { dlg, fetzen } = zettelDialog(titel, `
      <h2>${escHtml(titel)}</h2>
      ${hinweis ? `<p class="hint">${escHtml(hinweis)}</p>` : ''}
      ${bezeichnung !== undefined ? `<label class="field masse-bezeichnung"><span>Bezeichnung</span>
        <input name="bezeichnung" value="${escHtml(bezeichnung)}" placeholder="z. B. Ø untere Rille" autocomplete="off"></label>` : ''}
      <div class="masse-inhalt">
        ${mitSkizze ? SKIZZE : ''}
        <ul class="masse-liste">
          ${felder.map(x => `<li class="masse-einzeln"><button type="button" class="masse-zeile" data-f="${escHtml(x.f)}" aria-pressed="false">
            <span class="masse-name">${escHtml(x.name)}</span><span class="masse-wert"></span></button>
            ${x.leeren ? `<button type="button" class="radierer" data-leeren="${escHtml(x.f)}" aria-label="${escHtml(x.name)} löschen" hidden>${RADIERER}</button>` : ''}</li>`).join('')}
        </ul>
      </div>
      <p class="hint masse-tipp">${ruhe}</p>
      <div class="sheet-buttons">
        <button type="button" class="btn primary" data-ende="ok">Übernehmen</button>
        <button type="button" class="btn" data-ende="abbrechen">Abbrechen</button>
      </div>
      ${entfernen ? `<div class="sheet-buttons"><button type="button" class="btn danger small" data-ende="entfernen">${escHtml(entfernen)}</button></div>` : ''}`);

    const tipp = dlg.querySelector('.masse-tipp');
    const skizze = dlg.querySelector('.masse-skizze');
    const feld = f => [...dlg.querySelectorAll('[data-f]')].find(b => b.dataset.f === f);

    const zeigeWert = f => {
      const el = feld(f).querySelector('.masse-wert');
      const s = geschaetzt(f);
      el.classList.toggle('geschaetzt', t[f] == null && s != null);
      el.textContent = t[f] != null ? wertText(ausStrichen(t[f], sk(f)), sk(f))
        : s != null ? `≈ ${wertText(ausStrichen(s, sk(f)), sk(f))}` : '–';
      const r = [...dlg.querySelectorAll('[data-leeren]')].find(b => b.dataset.leeren === f);
      if (r) r.hidden = t[f] == null;
    };

    // Lage einer Stelle für die Skizze (mm): eingetragen, sonst geschätzt
    const stelleMm = () => {
      const h = felder.find(x => x.skizze === 'h');
      return h ? t[h.f] ?? geschaetzt(h.f) : null;
    };
    const markieren = () => {
      for (const b of dlg.querySelectorAll('[data-f]')) b.setAttribute('aria-pressed', String(b.dataset.f === aktiv));
      if (!skizze) return;
      // ohne gewähltes Maß das erste zeigen, damit klar ist, wo gemessen wird
      const art = fd(aktiv ?? felder[0].f).skizze;
      const H = zuStrichen(hoehe, SKALEN.cm);
      const h = stelleMm() ?? (H ? H / 2 : START_MM);
      skizzeMarkieren(skizze, art === 'd' || art === 'h' ? 'stelle' : art, { was: art, h, H });
    };

    for (const x of felder) zeigeWert(x.f);
    markieren();

    const band = massbandAnbringen(dlg, wert => {
      t[aktiv] = wert;
      geaendert.add(aktiv);
      zeigeWert(aktiv);
      markieren();
    });

    const waehle = f => {
      aktiv = f;
      if (t[f] == null) {
        // Startwert: die Schätzung aus dem Foto, sonst der übliche Wert
        t[f] = geschaetzt(f) ?? zuStrichen(fd(f).start ?? sk(f).start, { ...sk(f), min: 0 });
        geaendert.add(f);
      }
      zeigeWert(f);
      markieren();
      band.zeigen(t[f], fd(f).name, sk(f));
      tipp.textContent = fd(f).skizze === 'h'
        ? 'Höhe vom Boden bis zu dieser Stelle. Maßband nach links wischen: größer, nach rechts: kleiner.'
        : wischTipp(sk(f));
    };

    fetzen.addEventListener('click', e => {
      const b = e.target.closest('[data-f]');
      if (b) return waehle(b.dataset.f);
      const r = e.target.closest('[data-leeren]');
      if (r) {
        const f = r.dataset.leeren;
        t[f] = null;
        geaendert.add(f);
        if (aktiv === f) {
          aktiv = null;
          band.verbergen();
          tipp.textContent = ruhe;
        }
        zeigeWert(f);
        markieren();
        feld(f).focus();
      }
    });
    // neben den Zettel getippt: abbrechen
    dlg.querySelector('.masse-buehne').addEventListener('click', e => {
      if (e.target === e.currentTarget) dlg.close('abbrechen');
    });

    // ---------- Ende ----------
    for (const b of dlg.querySelectorAll('[data-ende]')) b.addEventListener('click', () => dlg.close(b.dataset.ende));
    dlg.addEventListener('close', () => {
      band.abbauen();
      const aktion = dlg.returnValue;
      let res = null;
      if (aktion === 'ok' || aktion === 'entfernen') {
        const werte = {};
        // unverändert: der eingetragene Wert bleibt genau erhalten
        for (const x of felder) {
          werte[x.f] = geaendert.has(x.f) ? (t[x.f] == null ? null : ausStrichen(t[x.f], x.skala)) : x.wert ?? null;
        }
        const name = dlg.querySelector('[name="bezeichnung"]');
        res = { aktion, werte, bezeichnung: name ? name.value.trim() : undefined };
      }
      dlg.remove();
      resolve(res);
    });
    zettelZeigen(dlg);
    if (waehlen && fd(waehlen)) { waehle(waehlen); feld(waehlen).focus(); }
  });
}
