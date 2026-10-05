// Glasurrezept vom Foto: Texterkennung auf dem Handy (Tesseract, liegt in vendor/ – kein Server,
// das Foto verlässt das Gerät nicht), dann ein Zettel zum Prüfen. Was die App nicht sicher lesen
// konnte, steht dort als Frage mit dem Bildausschnitt aus dem Foto; erst wenn alle Fragen
// beantwortet sind, wird das Rezept in die Maske übernommen.

import { zeilenBilden, rezeptAuswerten } from './rezept.js';
import { zettelDialog, zettelZeigen, massAbfragen, wertText } from './massband.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zahl = v => String(v).replace('.', ',');
const runden = v => Math.round(v * 1000) / 1000;

const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;
const SPRACHEN = ['deu', 'eng'];

// gezeichnete Knöpfe auf dem Zettel
const MUELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.6C9 6.1 15 6.2 19.6 6.8M9.6 6.3C9.5 4.6 10 3.9 12 3.9S14.6 4.5 14.4 6.4M6.4 7.2L7.6 19.6C7.8 20.6 8.4 20.9 9.4 20.9L14.8 20.8C15.8 20.8 16.3 20.4 16.4 19.5L17.6 7.3M10.1 10L10.4 17.8M13.9 10.1L13.6 17.7"/></svg>';
const HAKEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 12.8C6 14.4 7.6 16.2 9.2 18.6C11.8 13.2 15.4 8.6 20 4.6"/></svg>';

// ---------------------------------------------------------------------------
// Foto vorbereiten und lesen
// ---------------------------------------------------------------------------

// Foto als Canvas (aufrecht nach EXIF), Text gut 30 px hoch: lange Seite 1400–2400 px
async function bildLaden(file) {
  let bild;
  try { bild = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    bild = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Foto konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }
  const w0 = bild.width || bild.naturalWidth, h0 = bild.height || bild.naturalHeight;
  const lang = Math.max(w0, h0);
  const f = lang > 2400 ? 2400 / lang : lang < 1400 ? Math.min(2, 1400 / lang) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * f);
  c.height = Math.round(h0 * f);
  c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height);
  bild.close?.();
  return lichtAusgleichen(c);
}

// Ungleichmäßiges Licht (Schatten von Hand oder Handy, Papier wölbt sich) ausgleichen: das Papier
// wird überall gleich hell, die Schrift bleibt dunkel. Sonst trennt die Texterkennung Schrift und
// Papier nur in der hellen Bildhälfte und liest im Schatten Buchstabensalat.
function lichtAusgleichen(c) {
  const W = c.width, H = c.height;
  const ctx = c.getContext('2d');
  const px = ctx.getImageData(0, 0, W, H);
  const d = px.data;
  const grau = new Float32Array(W * H);
  for (let i = 0, j = 0; j < grau.length; i += 4, j++) grau[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // Papierhelligkeit je Kachel: ein helles Quantil (Schrift ist dunkel und schmal) …
  const K = Math.max(16, Math.round(Math.max(W, H) / 60));
  const bw = Math.ceil(W / K), bh = Math.ceil(H / K);
  const kachel = new Float32Array(bw * bh);
  const werte = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    werte.length = 0;
    for (let y = by * K; y < Math.min(H, (by + 1) * K); y += 2) for (let x = bx * K; x < Math.min(W, (bx + 1) * K); x += 2) werte.push(grau[y * W + x]);
    werte.sort((a, b) => a - b);
    kachel[by * bw + bx] = werte[Math.floor(werte.length * 0.9)] || 255;
  }
  // … und das Maximum der Nachbarn, damit auch Kacheln voller Schrift Papier finden
  const papier = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(bh - 1, Math.max(0, y + dy)), xx = Math.min(bw - 1, Math.max(0, x + dx));
      m = Math.max(m, kachel[yy * bw + xx]);
    }
    papier[y * bw + x] = m;
  }
  // jedes Pixel durch die (zwischen den Kacheln verlaufende) Papierhelligkeit teilen
  const bx1 = Math.max(0, bw - 1.001), by1 = Math.max(0, bh - 1.001);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(by1, Math.max(0, y / K - 0.5)), y0 = Math.floor(fy), ty = fy - y0, y2 = Math.min(bh - 1, y0 + 1);
    for (let x = 0; x < W; x++) {
      const fx = Math.min(bx1, Math.max(0, x / K - 0.5)), x0 = Math.floor(fx), tx = fx - x0, x2 = Math.min(bw - 1, x0 + 1);
      const p = (papier[y0 * bw + x0] * (1 - tx) + papier[y0 * bw + x2] * tx) * (1 - ty)
        + (papier[y2 * bw + x0] * (1 - tx) + papier[y2 * bw + x2] * tx) * ty;
      const v = Math.max(0, Math.min(255, (255 * grau[y * W + x]) / Math.max(1, p)));
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

function drehen(c, grad) {
  const d = document.createElement('canvas');
  d.width = c.height;
  d.height = c.width;
  const x = d.getContext('2d');
  x.translate(d.width / 2, d.height / 2);
  x.rotate((grad * Math.PI) / 180);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return d;
}

// Wie gut ist ein Leseergebnis? Buchstaben in gut gelesenen Wörtern, Rezeptzeilen zählen viel
const rezeptZeilen = zeilen => rezeptAuswerten(zeilen).rezept.filter(p => p.anteil != null).length;
const guete = zeilen => zeilen.reduce((s, z) => s + z.woerter.reduce((t, w) => t + (w.conf >= 70 ? w.text.replace(/[^\p{L}\d]/gu, '').length : 0), 0), 0)
  + 40 * rezeptZeilen(zeilen);

// Texterkennung; meldet den Fortschritt (0…1) mit fortschritt(text, anteil). abbruch.stoppen()
// beendet sie vorzeitig.
async function lesen(canvas, fortschritt, abbruch) {
  const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
  let phase = 0;
  const worker = await Tesseract.createWorker(SPRACHEN, 1, {
    workerPath: `${VENDOR}worker.min.js`,
    corePath: `${VENDOR}core`,
    langPath: `${VENDOR}lang`,
    cacheMethod: 'none', // die Dateien liegen ohnehin im Zwischenspeicher der App
    logger: m => {
      if (m.status === 'recognizing text') fortschritt('Text wird gelesen …', 0.25 + 0.75 * (phase + m.progress) / (phase + 1));
      else if (/load|initializ/i.test(m.status)) fortschritt('Texterkennung wird vorbereitet …', 0.25 * (m.progress || 0));
    },
  });
  abbruch.stoppen = () => worker.terminate();
  try {
    if (abbruch.abgebrochen) return null;
    // Spalten erkennt die Zeilenbildung selbst; Lücken zwischen Wörtern bleiben erhalten
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const versuch = async c => zeilenBilden((await worker.recognize(c, {}, { blocks: true, text: false })).data.blocks);
    let zeilen = await versuch(canvas);
    let bild = canvas;
    // Hochkant fotografiert und quer liegendes Blatt (oder umgekehrt): gedreht nochmal lesen
    const mittel = zeilen.length ? zeilen.reduce((s, z) => s + z.conf, 0) / zeilen.length : 0;
    if (!abbruch.abgebrochen && (zeilen.length < 3 || mittel < 60 || rezeptZeilen(zeilen) < 2)) {
      let beste = guete(zeilen);
      for (const grad of [90, -90]) {
        if (abbruch.abgebrochen) break;
        phase++;
        const d = drehen(canvas, grad);
        const z = await versuch(d);
        const g = guete(z);
        if (g > beste * 1.3 + 10) { zeilen = z; bild = d; beste = g; }
      }
    }
    // Gegenprobe für die Mengen: jede Zahl im Rezept noch einmal lesen, diesmal nur mit Ziffern.
    // Weichen die Lesungen ab (meist ein verlorenes Komma), fragt der Prüf-Zettel nach.
    const mengen = rezeptAuswerten(zeilen).rezept.map(p => p.wort).filter(w => w?.bbox);
    if (mengen.length && !abbruch.abgebrochen) {
      fortschritt('Zahlen werden nachgeprüft …', 1);
      await worker.setParameters({ tessedit_char_whitelist: '0123456789,.%', tessedit_pageseg_mode: '7' });
      for (const w of mengen) {
        if (abbruch.abgebrochen) break;
        const h = w.bbox.y1 - w.bbox.y0, rand = Math.round(h * 0.5);
        const left = Math.max(0, w.bbox.x0 - rand), top = Math.max(0, w.bbox.y0 - rand);
        const rectangle = { left, top, width: Math.min(bild.width - left, w.bbox.x1 - w.bbox.x0 + 2 * rand), height: Math.min(bild.height - top, h + 2 * rand) };
        w.zweit = (await worker.recognize(bild, { rectangle })).data.text.trim();
      }
    }
    return { zeilen, bild };
  } finally {
    abbruch.stoppen = null;
    worker.terminate();
  }
}

// Zettel, solange gelesen wird
function leseZettel() {
  const { dlg } = zettelDialog('Rezept wird gelesen', `
    <h2>Rezept wird gelesen …</h2>
    <p class="hint rf-status" aria-live="polite">Foto wird vorbereitet …</p>
    <div class="rf-fortschritt" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    <p class="hint small">Die Texterkennung läuft auf deinem Handy, das Foto bleibt hier.</p>
    <div class="sheet-buttons"><button type="button" class="btn" data-ende="abbrechen">Abbrechen</button></div>`,
  { massband: false, klasse: 'rezept-zettel' });
  const status = dlg.querySelector('.rf-status');
  const balken = dlg.querySelector('.rf-fortschritt');
  return {
    dlg,
    zeigen: () => zettelZeigen(dlg),
    setzen(text, anteil) {
      status.textContent = text;
      const p = Math.round(Math.max(0, Math.min(1, anteil)) * 100);
      balken.setAttribute('aria-valuenow', String(p));
      balken.firstElementChild.style.width = `${p}%`;
    },
  };
}

// ---------------------------------------------------------------------------
// Prüf-Zettel
// ---------------------------------------------------------------------------

// Bildausschnitt der Zeilen (für die Fragen)
function schnipsel(bild, zeilen, idx) {
  const zs = idx.map(i => zeilen[i]).filter(Boolean);
  if (!zs.length) return '';
  const pad = Math.max(...zs.map(z => z.hoehe)) * 0.6;
  const x0 = Math.max(0, Math.min(...zs.map(z => z.bbox.x0)) - pad);
  const y0 = Math.max(0, Math.min(...zs.map(z => z.bbox.y0)) - pad);
  const x1 = Math.min(bild.width, Math.max(...zs.map(z => z.bbox.x1)) + pad);
  const y1 = Math.min(bild.height, Math.max(...zs.map(z => z.bbox.y1)) + pad);
  const f = Math.min(1, 900 / (x1 - x0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((x1 - x0) * f));
  c.height = Math.max(1, Math.round((y1 - y0) * f));
  c.getContext('2d').drawImage(bild, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return `<img class="rf-schnipsel" src="${c.toDataURL('image/jpeg', 0.85)}" alt="Ausschnitt aus dem Foto">`;
}

const frageTeil = (offen, grund, bild) => (offen ? `
  <div class="rf-frage-info">${bild}<p class="rf-grund">${esc(grund)}</p>
    <button type="button" class="rf-stimmt" data-stimmt aria-label="Stimmt so">${HAKEN}<span>Stimmt so</span></button></div>` : '');

const leer = v => v == null || String(v).trim() === '';

// erg: aus rezeptAuswerten; aktuell: was schon im Formular steht
// { name, beschreibung, brennbereich, litergewicht, rezept: [{ rohstoff, anteil }] }.
// Ergebnis: { name, beschreibung, brennbereich, litergewicht, rezept, rezeptModus, notizen } oder null
function pruefen(erg, zeilen, bild, aktuell) {
  return new Promise(resolve => {
    const st = {
      name: erg.name.wert,
      beschreibung: erg.beschreibung.wert,
      brennbereich: erg.brennbereich.wert,
      litergewicht: erg.litergewicht.wert,
      rezept: erg.rezept.map(p => ({ ...p })),
      notizen: erg.notizen.map(n => ({ ...n })),
      rezeptModus: aktuell.rezept.length ? null : 'ersetzen',
    };
    // offene Fragen: Schlüssel → true
    const offen = new Set();
    const textFelder = [
      ['name', 'Name', 'z. B. Seladon hell'],
      ['beschreibung', 'Beschreibung', 'z. B. glänzend, transparent-grün'],
      ['brennbereich', 'Brennbereich', 'z. B. 1220–1250 °C'],
    ];
    const bisher = k => (!leer(aktuell[k]) && !leer(st[k]) && String(aktuell[k]).trim() !== String(st[k]).trim() ? aktuell[k] : null);

    const feldHtml = ([k, label, ph]) => {
      const e = erg[k];
      const alt = bisher(k);
      const unsicher = !e.sicher;
      if (unsicher || alt != null) offen.add(k);
      const grund = [unsicher ? e.grund : '', alt != null ? `Im Formular steht schon „${alt}“.` : ''].filter(Boolean).join(' ');
      const bildchen = unsicher ? schnipsel(bild, zeilen, e.zeilen) : '';
      const kand = k === 'name' && e.kandidaten.length > 1 ? `<datalist id="rf-namen">${e.kandidaten.map(t => `<option value="${esc(t)}">`).join('')}</datalist>` : '';
      return `<div class="rf-feld ${offen.has(k) ? 'rf-offen' : ''}" data-frage="${k}">
        <label class="field"><span>${label}</span><input data-feld="${k}" value="${esc(st[k])}" placeholder="${esc(ph)}" autocomplete="off" ${kand ? 'list="rf-namen"' : ''}></label>${kand}
        ${frageTeil(offen.has(k), grund, bildchen)}
        ${alt != null ? `<button type="button" class="btn small rf-behalten" data-behalten="${k}">„${esc(alt)}“ behalten</button>` : ''}
      </div>`;
    };
    const literHtml = () => {
      const e = erg.litergewicht;
      const alt = !leer(aktuell.litergewicht) && st.litergewicht != null && Number(aktuell.litergewicht) !== st.litergewicht ? aktuell.litergewicht : null;
      if (!e.sicher || alt != null) offen.add('litergewicht');
      if (st.litergewicht == null && e.sicher) return '';
      const grund = [!e.sicher ? e.grund : '', alt != null ? `Im Formular steht schon ${wertText(alt, 'gl')}.` : ''].filter(Boolean).join(' ');
      return `<div class="rf-feld ${offen.has('litergewicht') ? 'rf-offen' : ''}" data-frage="litergewicht">
        <div class="field"><span>Litergewicht</span><button type="button" class="wert-knopf" data-liter>${st.litergewicht != null ? esc(wertText(st.litergewicht, 'gl')) : '<span class="wert-leer">–</span>'}</button></div>
        ${frageTeil(offen.has('litergewicht'), grund, !e.sicher ? schnipsel(bild, zeilen, e.zeilen) : '')}
        ${alt != null ? `<button type="button" class="btn small rf-behalten" data-behalten="litergewicht">${esc(wertText(alt, 'gl'))} behalten</button>` : ''}
      </div>`;
    };
    const zeileHtml = (p, i) => {
      if (!p.sicher) offen.add(`rezept.${i}`);
      const o = offen.has(`rezept.${i}`);
      return `<li class="rf-zeile ${o ? 'rf-offen' : ''}" data-frage="rezept.${i}" data-i="${i}">
        <div class="rf-zeile-felder">
          <button type="button" class="rf-zusatz" data-zusatz aria-pressed="${p.zusatz}" aria-label="Zusatz (zählt nicht zur Summe)" title="Zusatz">+</button>
          <input data-roh value="${esc(p.rohstoff)}" placeholder="Rohstoff" aria-label="Rohstoff" autocomplete="off">
          <button type="button" class="wert-knopf rf-anteil" data-anteil aria-label="Anteil">${p.anteil != null ? esc(wertText(p.anteil, 'anteil')) : '<span class="wert-leer">Anteil</span>'}</button>
          <button type="button" class="muell" data-weg aria-label="Zeile entfernen">${MUELL}</button>
        </div>
        ${frageTeil(o, p.grund, o ? schnipsel(bild, zeilen, [p.zeile]) : '')}
        ${o && p.alternativ != null ? `<button type="button" class="btn small rf-behalten" data-alternativ>stattdessen ${esc(wertText(p.alternativ, 'anteil'))}</button>` : ''}
      </li>`;
    };
    const notizHtml = (n, i) => {
      if (!n.sicher) offen.add(`notiz.${i}`);
      const o = offen.has(`notiz.${i}`);
      return `<li class="rf-zeile ${o ? 'rf-offen' : ''}" data-frage="notiz.${i}" data-i="${i}">
        <div class="rf-zeile-felder rf-notiz">
          <input data-notiz value="${esc(n.text)}" aria-label="Notiz" autocomplete="off">
          <button type="button" class="muell" data-weg-notiz aria-label="Notiz weglassen">${MUELL}</button>
        </div>
        ${frageTeil(o, `${n.grund} – stimmt der Text? Sonst ändern oder weglassen.`, o ? schnipsel(bild, zeilen, [n.zeile]) : '')}
      </li>`;
    };

    const gefunden = erg.rezept.length || st.name || st.brennbereich || st.litergewicht != null;
    if (aktuell.rezept.length && erg.rezept.length) offen.add('modus');
    if (erg.summe && !erg.summe.sicher) offen.add('summe');

    const inhalt = gefunden ? `
      <h2>Vom Foto gelesen</h2>
      <p class="hint rf-kopf"></p>
      <div class="rf-teil">${textFelder.map(feldHtml).join('')}${literHtml()}</div>
      ${erg.rezept.length ? `<h3 class="rf-titel">Rezept</h3>
        ${aktuell.rezept.length ? `<div class="rf-feld rf-offen" data-frage="modus">
          <p class="rf-grund">Im Formular steht schon ein Rezept (${aktuell.rezept.length} Rohstoff${aktuell.rezept.length > 1 ? 'e' : ''}).</p>
          <div class="segmented rf-modus">
            <label><input type="radio" name="rf-modus" value="ersetzen"><span>ersetzen</span></label>
            <label><input type="radio" name="rf-modus" value="anhaengen"><span>anhängen</span></label>
          </div></div>` : ''}
        <ul class="rf-liste rf-rezept">${st.rezept.map(zeileHtml).join('')}</ul>
        <div class="rf-feld" data-frage="summe"><p class="rf-summe small"></p>
          <div class="rf-frage-info rf-summe-frage" hidden><p class="rf-grund"></p>
            <button type="button" class="rf-stimmt" data-stimmt aria-label="Stimmt so">${HAKEN}<span>Stimmt so</span></button></div></div>
        <p class="hint small">Das <strong>+</strong> vor einem Rohstoff macht ihn zum Zusatz (z. B. Färbeoxide); Zusätze zählen nicht zur Summe.</p>` : ''}
      ${st.notizen.length ? `<h3 class="rf-titel">Weiterer Text → Notizen</h3>
        <ul class="rf-liste rf-notizen">${st.notizen.map(notizHtml).join('')}</ul>` : ''}
      <div class="sheet-buttons">
        <button type="button" class="btn primary" data-ende="ok">Übernehmen</button>
        <button type="button" class="btn" data-ende="abbrechen">Abbrechen</button>
      </div>`
      : `<h2>Kein Rezept gefunden</h2>
      <p>Auf dem Foto konnte die App kein Rezept lesen.</p>
      <p class="hint">Tipps: das Rezept gerade von oben und formatfüllend fotografieren, gutes Licht ohne Schatten, scharf stellen. Gedruckte Rezepte gelingen am besten; Handschrift nur, wenn sie sehr deutlich ist.</p>
      <div class="sheet-buttons"><button type="button" class="btn" data-ende="abbrechen">Schließen</button></div>`;

    const { dlg, fetzen, reissen } = zettelDialog('Vom Foto gelesen', inhalt, { massband: false, klasse: 'rezept-zettel' });
    const kopf = dlg.querySelector('.rf-kopf');
    const okKnopf = dlg.querySelector('[data-ende="ok"]');

    const summeZeigen = () => {
      const el = dlg.querySelector('.rf-summe');
      if (!el) return;
      const basis = st.rezept.filter(p => !p.zusatz && p.anteil != null);
      const zus = st.rezept.filter(p => p.zusatz && p.anteil != null);
      const sB = runden(basis.reduce((s, p) => s + p.anteil, 0));
      const sZ = runden(zus.reduce((s, p) => s + p.anteil, 0));
      el.textContent = basis.length ? `Summe: ${zahl(sB)}${sZ ? ` (dazu ${zahl(sZ)} Zusätze)` : ''}` : '';
      // Summenfrage: verschwindet, sobald die Summe aufgeht
      const frage = dlg.querySelector('.rf-summe-frage');
      if (offen.has('summe') && erg.summe?.prozent && Math.abs(sB - 100) <= 0.6) offen.delete('summe');
      frage.hidden = !offen.has('summe');
      if (offen.has('summe')) frage.querySelector('.rf-grund').textContent = `Die Anteile ergeben zusammen ${zahl(sB)} statt 100. Ist eine Zahl falsch gelesen, fehlt ein Rohstoff – oder stimmt es so?`;
      frage.closest('[data-frage]').classList.toggle('rf-offen', offen.has('summe'));
    };
    const stand = () => {
      if (!okKnopf) return;
      summeZeigen();
      const n = offen.size;
      okKnopf.setAttribute('aria-disabled', String(n > 0));
      okKnopf.textContent = n ? `Noch ${n} ${n > 1 ? 'Fragen' : 'Frage'}` : 'Übernehmen';
      kopf.textContent = n
        ? `Bei ${n > 1 ? `${n} Stellen` : 'einer Stelle'} war sich die App nicht sicher – bitte prüfen (markiert). Ändern oder „Stimmt so“ antippen.`
        : 'Alles gut lesbar. Bitte kurz prüfen und übernehmen.';
    };
    const erledigt = schluessel => {
      if (!offen.delete(schluessel)) return;
      const el = [...dlg.querySelectorAll('[data-frage]')].find(x => x.dataset.frage === schluessel);
      if (el) {
        el.classList.remove('rf-offen');
        el.querySelector('.rf-frage-info:not(.rf-summe-frage)')?.remove();
        el.querySelector('[data-behalten], [data-alternativ]')?.remove();
      }
      stand();
      reissen();
    };
    const frageVon = el => el.closest('[data-frage]')?.dataset.frage;

    fetzen.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.feld) st[t.dataset.feld] = t.value;
      else if (t.hasAttribute('data-roh')) st.rezept[t.closest('[data-i]').dataset.i].rohstoff = t.value;
      else if (t.hasAttribute('data-notiz')) st.notizen[t.closest('[data-i]').dataset.i].text = t.value;
      else if (t.name === 'rf-modus') st.rezeptModus = t.value;
      const k = frageVon(t);
      if (k) erledigt(k); // geändert = beantwortet
    });
    fetzen.addEventListener('change', e => {
      if (e.target.name === 'rf-modus') { st.rezeptModus = e.target.value; erledigt('modus'); }
    });
    fetzen.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-stimmt')) return erledigt(frageVon(b));
      if (b.dataset.behalten) {
        const k = b.dataset.behalten;
        st[k] = aktuell[k];
        const inp = dlg.querySelector(`[data-feld="${k}"]`);
        if (inp) inp.value = aktuell[k];
        else dlg.querySelector('[data-liter]').innerHTML = esc(wertText(aktuell[k], 'gl'));
        return erledigt(k);
      }
      if (b.hasAttribute('data-liter')) {
        const res = await massAbfragen({ titel: 'Litergewicht', felder: [{ f: 'l', name: 'Litergewicht', wert: st.litergewicht, skala: 'gl', leeren: true }], waehlen: 'l' });
        if (!res) return;
        st.litergewicht = res.werte.l;
        b.innerHTML = st.litergewicht != null ? esc(wertText(st.litergewicht, 'gl')) : '<span class="wert-leer">–</span>';
        return erledigt('litergewicht');
      }
      const zeile = b.closest('.rf-rezept [data-i]');
      if (zeile) {
        const i = Number(zeile.dataset.i);
        const p = st.rezept[i];
        if (b.hasAttribute('data-zusatz')) {
          p.zusatz = !p.zusatz;
          b.setAttribute('aria-pressed', String(p.zusatz));
          return stand();
        }
        if (b.hasAttribute('data-alternativ')) {
          [p.anteil, p.alternativ] = [p.alternativ, p.anteil];
          zeile.querySelector('[data-anteil]').innerHTML = esc(wertText(p.anteil, 'anteil'));
          return erledigt(`rezept.${i}`);
        }
        if (b.hasAttribute('data-anteil')) {
          const res = await massAbfragen({
            titel: p.rohstoff || 'Anteil', hinweis: p.gelesen ? `Gelesen: „${p.gelesen}“` : '',
            felder: [{ f: 'a', name: 'Anteil', wert: p.anteil, skala: 'anteil', leeren: true }], waehlen: 'a',
          });
          if (!res) return;
          p.anteil = res.werte.a;
          b.innerHTML = p.anteil != null ? esc(wertText(p.anteil, 'anteil')) : '<span class="wert-leer">Anteil</span>';
          return erledigt(`rezept.${i}`);
        }
        if (b.hasAttribute('data-weg')) {
          p.weg = true;
          zeile.hidden = true;
          erledigt(`rezept.${i}`);
          return stand();
        }
      }
      const notiz = b.closest('.rf-notizen [data-i]');
      if (notiz && b.hasAttribute('data-weg-notiz')) {
        st.notizen[notiz.dataset.i].weg = true;
        notiz.hidden = true;
        erledigt(`notiz.${notiz.dataset.i}`);
        stand();
        return;
      }
      if (b.dataset.ende === 'ok') {
        if (offen.size) {
          // zur ersten offenen Frage
          const el = [...dlg.querySelectorAll('.rf-offen')][0];
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el?.classList.add('rf-blink');
          setTimeout(() => el?.classList.remove('rf-blink'), 900);
          return;
        }
        return dlg.close('ok');
      }
      if (b.dataset.ende) dlg.close(b.dataset.ende);
    });
    // neben den Zettel getippt: nichts tun (sonst gingen Antworten verloren)

    dlg.addEventListener('cancel', e => { if (gefunden && !confirm('Das gelesene Rezept verwerfen?')) e.preventDefault(); });
    dlg.addEventListener('close', () => {
      let res = null;
      if (dlg.returnValue === 'ok') {
        res = {
          name: String(st.name ?? '').trim(),
          beschreibung: String(st.beschreibung ?? '').trim(),
          brennbereich: String(st.brennbereich ?? '').trim(),
          litergewicht: st.litergewicht,
          rezept: st.rezept.filter(p => !p.weg && String(p.rohstoff).trim())
            .map(p => ({ rohstoff: `${p.zusatz ? '+ ' : ''}${String(p.rohstoff).trim().replace(/^\+\s*/, '')}`, anteil: p.anteil })),
          rezeptModus: st.rezeptModus || 'ersetzen',
          notizen: st.notizen.filter(n => !n.weg && n.text.trim()).map(n => n.text.trim()).join('\n'),
        };
      }
      dlg.remove();
      resolve(res);
    });
    zettelZeigen(dlg);
    stand();
    reissen();
  });
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

// Rezept von einem Foto lesen und prüfen lassen. aktuell: was schon im Formular steht (siehe
// pruefen). Ergebnis siehe pruefen, null bei Abbruch.
export async function rezeptVomFoto(file, aktuell) {
  const z = leseZettel();
  const abbruch = { abgebrochen: false, stoppen: null };
  let abgebrochen;
  const abbruchWarten = new Promise(r => { abgebrochen = r; });
  z.dlg.addEventListener('close', () => { abbruch.abgebrochen = true; abbruch.stoppen?.(); abgebrochen(null); });
  z.dlg.querySelector('[data-ende]').addEventListener('click', () => z.dlg.close('abbrechen'));
  z.zeigen();
  let gelesen;
  try {
    const canvas = await bildLaden(file);
    if (abbruch.abgebrochen) return null;
    z.setzen('Texterkennung wird vorbereitet …', 0);
    gelesen = await Promise.race([lesen(canvas, z.setzen, abbruch), abbruchWarten]);
  } catch (err) {
    if (abbruch.abgebrochen) return null;
    z.dlg.close();
    z.dlg.remove();
    throw err;
  }
  if (abbruch.abgebrochen || !gelesen) { z.dlg.remove(); return null; }
  z.dlg.close();
  z.dlg.remove();
  const erg = rezeptAuswerten(gelesen.zeilen);
  return pruefen(erg, gelesen.zeilen, gelesen.bild, aktuell);
}
