import * as db from './db.js';
import { processImage, blobToDataUrl, dataUrlToBlob } from './image.js';
import { analyze, findPoints, estimate, effectivePoints, renderBlueprint, loadForAnalysis, hashSeed, DEFAULT_CROP, DEFAULT_SENS } from './blueprint.js';

// ---------------------------------------------------------------------------
// Fachliche Listen
// ---------------------------------------------------------------------------

const TECHNIKEN = ['Drehscheibe', 'Aufbaukeramik', 'Plattentechnik', 'Daumenschale (Pinch)', 'Gießen', 'Sonstiges'];

// [Schlüssel, Bezeichnung, Einheit]
const MASSE = [
  ['hoehe', 'Höhe', 'cm'],
  ['dOben', 'Ø Öffnung', 'cm'],
  ['dMax', 'Ø breiteste Stelle', 'cm'],
  ['dBoden', 'Ø Boden', 'cm'],
];
const MASSE_NUR_NASS = [
  ['wand', 'Wandstärke', 'mm'],
  ['boden', 'Bodenstärke', 'mm'],
];

const AUFTRAGSARTEN = ['Tauchen', 'Schütten', 'Pinsel', 'Sprühen'];

const AUFFAELLIG_VORHER = [
  'Zu dünn', 'Zu dick', 'Ungleichmäßig / Streifen', 'Tropfnasen', 'Griffstellen / Fingerabdrücke',
  'Doppelter Tauchrand', 'Bläschen in Rohglasur', 'Risse in Rohglasur', 'Fehlstellen / Abplatzer',
  'Staub / Fett auf Schrühware', 'Boden nicht sauber',
];
const AUFFAELLIG_NACHHER = [
  'Gelaufen', 'Am Boden festgeschmolzen', 'Abrollen / Kriechen', 'Nadelstiche', 'Blasen / Krater',
  'Haarrisse (ungewollt)', 'Abplatzer', 'Zu dünn / durchscheinend', 'Zu matt', 'Zu glänzend',
  'Farbe weicht ab', 'Fleckig / wolkig',
];

const ERGEBNISSE = {
  gut: { label: 'Gelungen', cls: 'good' },
  ok: { label: 'Geht so', cls: 'warn' },
  schlecht: { label: 'Misslungen', cls: 'bad' },
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const $app = document.getElementById('app');
const $title = document.getElementById('page-title');
const $back = document.getElementById('back-btn');
const $actions = document.getElementById('top-actions');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isNum = v => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
const fmt = (v, digits = 1) => (isNum(v) ? Number(v).toLocaleString('de-DE', { maximumFractionDigits: digits }) : '');
const withUnit = (v, unit, digits) => (isNum(v) ? `${fmt(v, digits)} ${unit}` : '–');

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const fmtDate = s => (s ? new Date(s + 'T12:00').toLocaleDateString('de-DE') : '');

const byDateDesc = (a, b) => (b.datum || b.createdAt || '').localeCompare(a.datum || a.createdAt || '');

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

// Jeder Verlaufseintrag bekommt eine laufende Nummer, damit „Zurück“ weiß,
// ob es innerhalb der App zurückgehen kann.
let historyIdx = -1;

function go(hash, replace = false) {
  if (replace) history.replaceState({ idx: historyIdx }, '', hash);
  else history.pushState({ idx: historyIdx + 1 }, '', hash);
  router();
}

// Nach dem Speichern: beim Bearbeiten zurück zur vorherigen Seite, sonst zur neuen Detailseite
function finish(hash, edited) {
  if (edited && historyIdx > 0) history.back();
  else go(hash, true);
}

function setHeader({ title, back = null, actions = '' }) {
  $title.textContent = title;
  document.title = title === 'Töpferbuch' ? title : `${title} · Töpferbuch`;
  $back.hidden = !back;
  $back.onclick = back ? () => (historyIdx > 0 ? history.back() : go(back, true)) : null;
  $actions.innerHTML = actions;
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const ICON_CAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

const urlCache = new Map();

async function photoUrl(id, thumb) {
  const key = id + (thumb ? ':t' : '');
  if (urlCache.has(key)) return urlCache.get(key);
  const p = await db.get('photos', id);
  if (!p) return null;
  const url = URL.createObjectURL(thumb ? p.thumb || p.blob : p.blob);
  urlCache.set(key, url);
  return url;
}

function forgetPhoto(id) {
  for (const key of [id, id + ':t']) {
    if (urlCache.has(key)) URL.revokeObjectURL(urlCache.get(key));
    urlCache.delete(key);
  }
}

async function deletePhoto(id) {
  if (!id) return;
  forgetPhoto(id);
  await db.del('photos', id);
}

// Platzhalter für ein Foto – das Bild wird nach dem Rendern nachgeladen.
function thumb(id, { full = false, placeholder = 'Kein Foto', zoom = false, cls = '' } = {}) {
  if (!id) return `<span class="thumb ${cls}"><span class="ph">${esc(placeholder)}</span></span>`;
  return `<span class="thumb ${cls}" ${zoom ? `data-zoom="${id}"` : ''}><img data-photo="${id}" ${full ? 'data-full' : ''} alt=""></span>`;
}

async function hydratePhotos(root = $app) {
  const imgs = root.querySelectorAll('img[data-photo]:not([src])');
  await Promise.all([...imgs].map(async img => {
    const url = await photoUrl(img.dataset.photo, !img.hasAttribute('data-full'));
    if (url) img.src = url;
  }));
}

async function savePhotoFromFile(file) {
  const { blob, thumb: t } = await processImage(file);
  const id = db.newId();
  await db.put('photos', { id, blob, thumb: t, createdAt: new Date().toISOString() });
  return id;
}

// Vollbildansicht
const $viewer = document.getElementById('viewer');
$viewer.addEventListener('click', () => { $viewer.hidden = true; $viewer.querySelector('img').removeAttribute('src'); });
async function openViewer(id) {
  const url = await photoUrl(id, false);
  if (!url) return;
  $viewer.querySelector('img').src = url;
  $viewer.hidden = false;
}
document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoom]');
  if (z) openViewer(z.dataset.zoom);
});

// ---------------------------------------------------------------------------
// Formular-Hilfen
// ---------------------------------------------------------------------------

function field(label, name, value, { type = 'text', unit = '', placeholder = '', list = '' } = {}) {
  const numeric = type === 'number';
  const input = `<input name="${name}" type="${type}" ${numeric ? 'inputmode="decimal" step="any" min="0"' : ''}
    value="${esc(value)}" placeholder="${esc(placeholder)}" ${list ? `list="${list}"` : ''}>`;
  return `<label class="field"><span>${esc(label)}</span>${unit ? `<span class="unit-input">${input}<em>${esc(unit)}</em></span>` : input}</label>`;
}

function selectField(label, name, value, options, { empty = '– bitte wählen –' } = {}) {
  const opts = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  return `<label class="field"><span>${esc(label)}</span><select name="${name}">
    ${empty !== null ? `<option value="">${esc(empty)}</option>` : ''}
    ${opts.map(o => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
  </select></label>`;
}

function textarea(label, name, value, placeholder = '') {
  return `<label class="field"><span>${esc(label)}</span><textarea name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
}

function chips(name, options, selected = []) {
  return `<div class="chips">${options.map(o => `<label class="chip"><input type="checkbox" name="${name}" value="${esc(o)}" ${selected.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
}

function numVal(form, name) {
  const v = form.elements[name]?.value?.trim().replace(',', '.');
  return isNum(v) ? Number(v) : null;
}
function strVal(form, name) {
  return form.elements[name]?.value?.trim() ?? '';
}
function checkedVals(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
}

// Fotos, die in einem Formular neu aufgenommen, aber nicht gespeichert wurden,
// werden beim Verlassen wieder gelöscht.
let pendingCleanup = null;

function photoSession() {
  const added = new Set();
  const removed = new Set();
  pendingCleanup = async () => { for (const id of added) await deletePhoto(id); };
  return {
    add(id) { added.add(id); },
    remove(id) { if (added.has(id)) { added.delete(id); deletePhoto(id); } else removed.add(id); },
    async commit() {
      pendingCleanup = null;
      for (const id of removed) await deletePhoto(id);
    },
  };
}

function fileInputs(cls, multiple) {
  return `<input type="file" accept="image/*" capture="environment" class="${cls}-cam">
          <input type="file" accept="image/*" ${multiple ? 'multiple' : ''} class="${cls}-lib">`;
}

async function handleFiles(input, onId) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  toast(files.length > 1 ? `${files.length} Fotos werden verarbeitet …` : 'Foto wird verarbeitet …');
  for (const f of files) {
    try { await onId(await savePhotoFromFile(f)); } catch (err) { toast(err.message); }
  }
}

// Mehrere Fotos (Werkstück)
function mountMultiPhoto(container, ids, session) {
  const render = () => {
    container.innerHTML = `<div class="photo-picker">
      ${ids.map(id => `<div class="pp-item">${thumb(id, { zoom: true })}<button type="button" class="pp-remove" data-id="${id}" aria-label="Foto entfernen">×</button></div>`).join('')}
      <button type="button" class="pp-add" data-pick="cam">${ICON_CAMERA}Foto<br>aufnehmen</button>
      <button type="button" class="pp-add" data-pick="lib">${ICON_PLUS}Aus<br>Galerie</button>
      ${fileInputs('pp', true)}
    </div>`;
    hydratePhotos(container);
  };
  container.addEventListener('click', e => {
    const rm = e.target.closest('.pp-remove');
    if (rm) {
      e.stopPropagation();
      ids.splice(ids.indexOf(rm.dataset.id), 1);
      session.remove(rm.dataset.id);
      render();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) container.querySelector(pick.dataset.pick === 'cam' ? '.pp-cam' : '.pp-lib').click();
  });
  container.addEventListener('change', e => {
    if (e.target.type === 'file') handleFiles(e.target, id => { ids.push(id); session.add(id); render(); });
  });
  render();
}

// Ein einzelnes Foto (vorher / nachher)
function mountSinglePhoto(container, state, key, session, placeholder) {
  const render = () => {
    const id = state[key];
    container.innerHTML = `<div class="single-photo">
      ${thumb(id, { placeholder, zoom: true })}
      <div class="btn-row">
        <button type="button" class="btn small" data-pick="cam">${ICON_CAMERA.replace('<svg', '<svg width="20" height="20"')} ${id ? 'Neu aufnehmen' : 'Foto aufnehmen'}</button>
        <button type="button" class="btn small" data-pick="lib">Aus Galerie</button>
        ${id ? '<button type="button" class="btn small danger" data-remove>Entfernen</button>' : ''}
      </div>
      ${fileInputs('sp', false)}
    </div>`;
    hydratePhotos(container);
  };
  const replace = newId => {
    if (state[key]) session.remove(state[key]);
    state[key] = newId;
    if (newId) session.add(newId);
    render();
  };
  container.addEventListener('click', e => {
    if (e.target.closest('[data-remove]')) return replace(null);
    const pick = e.target.closest('[data-pick]');
    if (pick) container.querySelector(pick.dataset.pick === 'cam' ? '.sp-cam' : '.sp-lib').click();
  });
  container.addEventListener('change', e => {
    if (e.target.type === 'file') handleFiles(e.target, replace);
  });
  render();
}

// Einfache Wiederhol-Zeilen (Name + Wert)
function mountRepeat(container, rows, { labelA, labelB, typeB = 'text', addLabel, onChange }) {
  const render = () => {
    container.innerHTML = rows.map((r, i) => `<div class="repeat-row" data-i="${i}">
        <input data-k="a" value="${esc(r.a)}" placeholder="${esc(labelA)}" aria-label="${esc(labelA)}">
        <input data-k="b" value="${esc(r.b)}" placeholder="${esc(labelB)}" aria-label="${esc(labelB)}" ${typeB === 'number' ? 'type="number" inputmode="decimal" step="any" min="0"' : ''}>
        <button type="button" class="remove-btn" aria-label="Zeile entfernen">×</button>
      </div>`).join('') + `<button type="button" class="btn small" data-add>${ICON_PLUS.replace('<svg', '<svg width="18" height="18"')} ${esc(addLabel)}</button>`;
    onChange?.();
  };
  container.addEventListener('input', e => {
    const row = e.target.closest('.repeat-row');
    if (!row) return;
    rows[row.dataset.i][e.target.dataset.k] = e.target.value;
    onChange?.();
  });
  container.addEventListener('click', e => {
    if (e.target.closest('[data-add]')) { rows.push({ a: '', b: '' }); render(); container.querySelector('.repeat-row:last-of-type input')?.focus(); }
    const rm = e.target.closest('.remove-btn');
    if (rm) { rows.splice(rm.closest('.repeat-row').dataset.i, 1); render(); }
  });
  render();
}

// ---------------------------------------------------------------------------
// Werkstücke
// ---------------------------------------------------------------------------

let pieceSearch = '';

async function viewPieces() {
  setHeader({ title: 'Werkstücke' });
  const pieces = (await db.getAll('pieces')).sort(byDateDesc);

  if (!pieces.length) {
    $app.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24"><path d="M8 3h8M9 3c0 3-4 5-4 10a7 7 0 0 0 14 0c0-5-4-7-4-10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        <p><strong>Noch keine Werkstücke</strong></p>
        <p>Halte fest, wie viel Ton du genommen hast und welche Maße das Stück hat – so kannst du es später genau wiederholen.</p>
      </div>
      <a class="fab" href="#/werkstueck/neu">${ICON_PLUS} Neues Werkstück</a>`;
    return;
  }

  $app.innerHTML = `<input class="search" type="search" placeholder="Suchen: Name, Ton, Serie …" value="${esc(pieceSearch)}">
    <div class="grid" id="piece-grid"></div>
    <a class="fab" href="#/werkstueck/neu">${ICON_PLUS} Neu</a>`;

  const grid = $app.querySelector('#piece-grid');
  const renderGrid = () => {
    const q = pieceSearch.toLowerCase();
    const list = pieces.filter(p => !q || [p.name, p.tonsorte, p.serie, p.technik, p.notizen].join(' ').toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map(p => `<a class="tile" href="#/werkstueck/${p.id}">
        ${thumb(p.photos?.[0])}
        <div class="tile-body">
          <div class="tile-title">${esc(p.name || 'Ohne Namen')}</div>
          <div class="tile-sub">${esc([isNum(p.tonmenge) ? `${fmt(p.tonmenge, 0)} g` : '', p.tonsorte].filter(Boolean).join(' · ') || fmtDate(p.datum))}</div>
        </div>
      </a>`).join('') : '<p class="muted">Nichts gefunden.</p>';
    hydratePhotos(grid);
  };
  $app.querySelector('.search').addEventListener('input', e => { pieceSearch = e.target.value; renderGrid(); });
  renderGrid();
}

function shrink(nass, fertig) {
  if (!isNum(nass) || !isNum(fertig) || Number(nass) <= 0) return null;
  return (1 - Number(fertig) / Number(nass)) * 100;
}

async function viewPiece(id) {
  const p = await db.get('pieces', id);
  if (!p) return notFound();
  setHeader({ title: p.name || 'Werkstück', back: '#/werkstuecke', actions: `<a class="icon-btn" href="#/werkstueck/${id}/bearbeiten">Bearbeiten</a>` });

  const firings = (await db.getAll('firings')).filter(f => f.pieceId === id).sort(byDateDesc);
  const nass = p.nass || {};
  const fertig = p.fertig || {};
  const hatFertig = MASSE.some(([k]) => isNum(fertig[k]));
  const masseRows = [...MASSE, ...MASSE_NUR_NASS].filter(([k]) => isNum(nass[k]) || isNum(fertig[k]));
  const schwindung = MASSE.map(([k]) => shrink(nass[k], fertig[k])).filter(v => v !== null);

  $app.innerHTML = `
    ${p.photos?.length ? `<div class="gallery">${p.photos.map(ph => thumb(ph, { full: true, zoom: true })).join('')}</div>` : ''}

    ${p.blueprint ? `<div class="card bp-card">
        <div class="bp-head"><h2>Blaupause</h2><span class="small muted">Maß oder Form antippen</span></div>
        <div id="bp"></div>
        <div class="btn-row" style="margin:12px 0 2px">
          <a class="btn small primary" href="#/werkstueck/${id}/blaupause">Groß anzeigen</a>
          <a class="btn small" href="#/werkstueck/${id}/umriss">Umriss anpassen</a>
        </div>
      </div>`
    : p.photos?.length ? `<div class="card">
        <h2>Blaupause</h2>
        <p class="small muted" style="margin-top:0">Aus einem Foto deines Stücks (genau von der Seite) zeichnet die App eine Blaupause mit allen wichtigen Maßen.</p>
        <a class="btn small primary" href="#/werkstueck/${id}/umriss" style="margin-bottom:6px">Blaupause erstellen</a>
      </div>` : ''}

    <div class="card">
      <h2>Ton</h2>
      <dl class="facts">
        <dt>Tonmenge</dt><dd>${withUnit(p.tonmenge, 'g', 0)}</dd>
        <dt>Tonsorte</dt><dd>${esc(p.tonsorte) || '–'}</dd>
        ${p.technik ? `<dt>Technik</dt><dd>${esc(p.technik)}</dd>` : ''}
        ${p.serie ? `<dt>Serie</dt><dd>${esc(p.serie)}</dd>` : ''}
        ${p.datum ? `<dt>Getöpfert am</dt><dd>${fmtDate(p.datum)}</dd>` : ''}
      </dl>
    </div>

    ${masseRows.length || p.extra?.length ? `<div class="card">
      <h2>Maße</h2>
      ${masseRows.length ? `<table class="measure">
        <thead><tr><th></th><th>Nass / frisch</th>${hatFertig ? '<th>Fertig</th><th>Schwund</th>' : ''}</tr></thead>
        <tbody>${masseRows.map(([k, label, unit]) => {
          const s = shrink(nass[k], fertig[k]);
          return `<tr><td>${esc(label)}</td><td>${withUnit(nass[k], unit)}</td>${hatFertig ? `<td>${MASSE_NUR_NASS.some(m => m[0] === k) ? '' : withUnit(fertig[k], unit)}</td><td>${s !== null ? fmt(s) + ' %' : ''}</td>` : ''}</tr>`;
        }).join('')}</tbody>
      </table>` : ''}
      ${schwindung.length ? `<p class="small muted">Durchschnittliche Schwindung: <strong>${fmt(schwindung.reduce((a, b) => a + b, 0) / schwindung.length)} %</strong></p>` : ''}
      ${p.extra?.length ? `<dl class="facts" style="margin-top:12px">${p.extra.map(e => `<dt>${esc(e.label)}</dt><dd>${esc(e.wert)}</dd>`).join('')}</dl>` : ''}
    </div>` : ''}

    ${isNum(p.gewichtFertig) ? `<div class="card"><dl class="facts"><dt>Gewicht fertig</dt><dd>${withUnit(p.gewichtFertig, 'g', 0)}</dd></dl></div>` : ''}

    ${p.notizen ? `<div class="card"><h2>Notizen &amp; Arbeitsschritte</h2><p class="notes">${esc(p.notizen)}</p></div>` : ''}

    <h3 class="section-title">Glasurprotokolle</h3>
    ${firings.length ? `<div class="list">${firings.map(firingRow).join('')}</div>` : '<p class="muted small">Für dieses Stück gibt es noch kein Glasurprotokoll.</p>'}

    <div class="btn-row">
      <a class="btn primary" href="#/glasieren/neu?stueck=${id}">Glasur protokollieren</a>
      <a class="btn" href="#/werkstueck/neu?vorlage=${id}">Nochmal töpfern</a>
    </div>
    <div class="btn-row"><button class="btn danger" id="del">Werkstück löschen</button></div>`;

  hydratePhotos();
  if (p.blueprint) {
    mountBlueprint($app.querySelector('#bp'), p, async () => {
      const y = window.scrollY;
      await viewPiece(id);
      window.scrollTo(0, y);
    });
  }
  $app.querySelector('#del').onclick = async () => {
    if (!confirm(`„${p.name || 'Werkstück'}“ wirklich löschen? Glasurprotokolle bleiben erhalten.`)) return;
    for (const ph of p.photos || []) await deletePhoto(ph);
    for (const f of firings) { f.pieceId = null; await db.put('firings', f); }
    await db.del('pieces', id);
    toast('Gelöscht');
    go('#/werkstuecke', true);
  };
}

async function viewPieceForm(id, params) {
  let p = id ? await db.get('pieces', id) : null;
  if (id && !p) return notFound();
  const vorlage = !id && params.get('vorlage') ? await db.get('pieces', params.get('vorlage')) : null;

  if (!p) {
    p = vorlage
      ? { ...structuredClone(vorlage), id: null, photos: [], datum: today(), fertig: {}, gewichtFertig: null, createdAt: null }
      : { datum: today(), photos: [], nass: {}, fertig: {}, extra: [] };
  }
  const photos = [...(p.photos || [])];
  const extra = (p.extra || []).map(e => ({ a: e.label, b: e.wert }));
  const session = photoSession();
  const nass = p.nass || {};
  const fertig = p.fertig || {};
  const tonsorten = [...new Set((await db.getAll('pieces')).map(x => x.tonsorte).filter(Boolean))];

  setHeader({ title: id ? 'Werkstück bearbeiten' : 'Neues Werkstück', back: id ? `#/werkstueck/${id}` : '#/werkstuecke' });

  $app.innerHTML = `<form id="f" novalidate>
    ${vorlage ? `<div class="info-box"><p>Vorlage: <strong>${esc(vorlage.name)}</strong>. Ton und Maße sind übernommen – trage ein, was diesmal anders ist.</p></div>` : ''}
    <div class="card">
      <h2>Fotos</h2>
      <div id="photos"></div>
      ${field('Name', 'name', p.name, { placeholder: 'z. B. Müslischale groß' })}
      <div class="fields-2">
        ${field('Datum', 'datum', p.datum, { type: 'date' })}
        ${field('Serie / Set', 'serie', p.serie, { placeholder: 'optional' })}
      </div>
      ${selectField('Technik', 'technik', p.technik, TECHNIKEN)}
    </div>

    <div class="card">
      <h2>Ton</h2>
      <div class="fields-2">
        ${field('Tonmenge', 'tonmenge', p.tonmenge, { type: 'number', unit: 'g' })}
        ${field('Tonsorte', 'tonsorte', p.tonsorte, { placeholder: 'z. B. Steinzeug weiß', list: 'tonsorten' })}
      </div>
      <datalist id="tonsorten">${tonsorten.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    </div>

    <div class="card">
      <h2>Maße nass / frisch gedreht</h2>
      <div class="fields-2">
        ${[...MASSE, ...MASSE_NUR_NASS].map(([k, label, unit]) => field(label, `nass.${k}`, nass[k], { type: 'number', unit })).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Maße nach dem Brand</h2>
      <p class="hint" style="margin-top:0">Optional – daraus berechnet die App die Schwindung deines Tons.</p>
      <div class="fields-2">
        ${MASSE.map(([k, label, unit]) => field(label, `fertig.${k}`, fertig[k], { type: 'number', unit })).join('')}
        ${field('Gewicht fertig', 'gewichtFertig', p.gewichtFertig, { type: 'number', unit: 'g' })}
      </div>
    </div>

    <div class="card">
      <h2>Weitere Maße &amp; Angaben</h2>
      <p class="hint" style="margin-top:0">z. B. Henkellänge, Deckel-Ø, Fußring, Drehzeit …</p>
      <div id="extra"></div>
      <div style="height:14px"></div>
    </div>

    <div class="card">
      ${textarea('Notizen & Arbeitsschritte', 'notizen', p.notizen, 'Wie bist du vorgegangen? Was würdest du nächstes Mal anders machen?')}
    </div>

    <div class="sticky-save">
      <button type="button" class="btn" id="cancel">Abbrechen</button>
      <button type="submit" class="btn primary">Speichern</button>
    </div>
  </form>`;

  mountMultiPhoto($app.querySelector('#photos'), photos, session);
  mountRepeat($app.querySelector('#extra'), extra, { labelA: 'Bezeichnung', labelB: 'Wert', addLabel: 'Angabe hinzufügen' });

  const form = $app.querySelector('#f');
  $app.querySelector('#cancel').onclick = () => $back.click();
  form.onsubmit = async e => {
    e.preventDefault();
    const now = new Date().toISOString();
    const obj = {
      ...p,
      id: id || db.newId(),
      name: strVal(form, 'name'),
      datum: strVal(form, 'datum'),
      serie: strVal(form, 'serie'),
      technik: strVal(form, 'technik'),
      tonmenge: numVal(form, 'tonmenge'),
      tonsorte: strVal(form, 'tonsorte'),
      nass: Object.fromEntries([...MASSE, ...MASSE_NUR_NASS].map(([k]) => [k, numVal(form, `nass.${k}`)])),
      fertig: Object.fromEntries(MASSE.map(([k]) => [k, numVal(form, `fertig.${k}`)])),
      gewichtFertig: numVal(form, 'gewichtFertig'),
      extra: extra.filter(r => r.a.trim() || r.b.trim()).map(r => ({ label: r.a.trim(), wert: r.b.trim() })),
      notizen: strVal(form, 'notizen'),
      photos,
      createdAt: p.createdAt || now,
      updatedAt: now,
    };
    if (!obj.name) obj.name = obj.tonsorte ? `Stück aus ${obj.tonsorte}` : 'Werkstück';
    // Neues Foto → Form automatisch erkennen und Blaupause zeichnen
    if (photos.length && !photos.includes(obj.blueprint?.photoId)) {
      toast('Form wird erkannt …');
      try { obj.blueprint = await createBlueprint(photos[0], obj.blueprint); } catch (err) { console.warn('Blaupause:', err.message); }
    }
    await db.put('pieces', obj);
    await session.commit();
    toast('Gespeichert');
    finish(`#/werkstueck/${obj.id}`, !!id);
  };
}

// ---------------------------------------------------------------------------
// Blaupause
// ---------------------------------------------------------------------------

// Diese Stellen der Blaupause entsprechen den Maßfeldern „nass / frisch“ des Werkstücks
const BP_FIELDS = { hoehe: 'hoehe', rand: 'dOben', bauch: 'dMax', fuss: 'dBoden' };

function bpData(p) {
  const values = { ...(p.blueprint?.values || {}) };
  for (const [key, f] of Object.entries(BP_FIELDS)) values[key] = isNum(p.nass?.[f]) ? Number(p.nass[f]) : null;
  return { values, pos: { ...(p.blueprint?.pos || {}) } };
}

function bpInfo(p) {
  const lines = [];
  const ton = [isNum(p.tonmenge) ? `Ton ${fmt(p.tonmenge, 0)} g` : '', p.tonsorte].filter(Boolean).join(' · ');
  if (ton) lines.push(ton);
  const rest = [isNum(p.nass?.wand) ? `Wand ${fmt(p.nass.wand)} mm` : '', isNum(p.nass?.boden) ? `Boden ${fmt(p.nass.boden)} mm` : '', p.technik].filter(Boolean).join(' · ');
  if (rest) lines.push(rest);
  return lines;
}

function blueprintSvg(p, profile, interactive) {
  const bp = profile ? { profile, points: findPoints(profile) } : p.blueprint;
  return renderBlueprint(bp, { ...bpData(p), title: p.name, info: bpInfo(p), interactive, seed: hashSeed(p.id || p.name) });
}

function makeBlueprint(photoId, crop, sens, profile, prev) {
  return {
    photoId, crop, sens, profile,
    points: findPoints(profile),
    values: prev?.values || {},
    pos: prev?.pos || {},
    labels: prev?.labels || {},
    hidden: prev?.hidden || [],
    custom: prev?.custom || [],
  };
}

async function createBlueprint(photoId, prev) {
  const photo = await db.get('photos', photoId);
  if (!photo) throw new Error('Foto nicht gefunden');
  const src = await loadForAnalysis(photo.blob);
  const { profile } = analyze(src, { crop: DEFAULT_CROP, sens: DEFAULT_SENS });
  return makeBlueprint(photoId, { ...DEFAULT_CROP }, DEFAULT_SENS, profile, prev);
}

function measureDialog({ title, isHeight, value, est, showPos, pos, posEst, label, removeText }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>
      ${label !== undefined ? field('Bezeichnung', 'label', label, { placeholder: 'z. B. Ø untere Rille' }) : ''}
      ${field(isHeight ? 'Höhe gesamt' : 'Durchmesser', 'value', value ?? '', { type: 'number', unit: 'cm', placeholder: est ? `≈ ${fmt(est)}` : '' })}
      ${showPos ? field('Auf welcher Höhe? (vom Boden gemessen)', 'pos', pos ?? '', { type: 'number', unit: 'cm', placeholder: posEst ? `≈ ${fmt(posEst)}` : '' }) : ''}
      <p class="hint">${est && value == null ? `Aus dem Foto geschätzt: ≈ ${fmt(est)} cm. ` : ''}Leeres Feld löscht den Wert.</p>
      <div class="sheet-buttons"><button class="btn primary" value="ok">Speichern</button><button class="btn" value="cancel">Abbrechen</button></div>
      ${removeText ? `<button class="btn danger block" value="remove" style="margin-bottom:12px">${esc(removeText)}</button>` : ''}
    </form>`;
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close('cancel'); });
    dlg.addEventListener('close', () => {
      const f = dlg.querySelector('form');
      const action = dlg.returnValue;
      const res = action === 'ok' || action === 'remove'
        ? { action, value: numVal(f, 'value'), pos: showPos ? numVal(f, 'pos') : null, label: label !== undefined ? strVal(f, 'label') : undefined }
        : null;
      dlg.remove();
      resolve(res);
    });
    dlg.showModal();
    dlg.querySelector('input').focus();
  });
}

// Blaupause anzeigen; Maße lassen sich durch Antippen eintragen,
// eigene Stellen durch Antippen der Form hinzufügen
function mountBlueprint(container, p, onSaved) {
  const render = () => { container.innerHTML = blueprintSvg(p, null, true); };
  const save = async () => {
    p.updatedAt = new Date().toISOString();
    await db.put('pieces', p);
    render();
    onSaved?.();
  };
  const bp = () => p.blueprint;

  const edit = async key => {
    const pt = effectivePoints(bp()).find(x => x.key === key);
    if (!pt) return;
    const { values, pos } = bpData(p);
    const est = estimate(bp(), values, pos);
    const interior = pt.t > 0 && pt.t < 1;
    const res = await measureDialog({
      title: pt.label, isHeight: key === 'hoehe', value: values[key], est: est.value(pt),
      showPos: interior, pos: pos[key], posEst: est.pos(pt),
      label: key === 'hoehe' ? undefined : pt.label,
      removeText: key === 'hoehe' ? '' : pt.custom ? 'Stelle löschen' : 'Stelle ausblenden',
    });
    if (!res) return;
    if (res.action === 'remove') {
      if (pt.custom) bp().custom = (bp().custom || []).filter(c => c.key !== key);
      else bp().hidden = [...(bp().hidden || []), key];
      return save();
    }
    if (BP_FIELDS[key]) p.nass = { ...(p.nass || {}), [BP_FIELDS[key]]: res.value };
    else bp().values = { ...bp().values, [key]: res.value };
    if (interior) bp().pos = { ...bp().pos, [key]: res.pos };
    if (res.label !== undefined) bp().labels = { ...(bp().labels || {}), [key]: res.label || undefined };
    return save();
  };

  const add = async t => {
    const { values, pos } = bpData(p);
    const probe = { key: '_neu', t, m: 0 };
    const est = estimate(bp(), values, pos);
    const r = p.blueprint.profile[Math.round(t * (p.blueprint.profile.length - 1))];
    probe.m = 2 * r;
    const res = await measureDialog({
      title: 'Neue Stelle', value: null, est: est.value(probe), showPos: true, pos: null, posEst: est.pos(probe), label: 'Ø Stelle',
    });
    if (!res || res.action !== 'ok') return;
    const key = `eigene-${Date.now().toString(36)}`;
    bp().custom = [...(bp().custom || []), { key, t: Math.round(t * 1000) / 1000 }];
    bp().labels = { ...(bp().labels || {}), [key]: res.label || 'Ø Stelle' };
    bp().values = { ...bp().values, [key]: res.value };
    bp().pos = { ...bp().pos, [key]: res.pos };
    return save();
  };

  container.addEventListener('click', e => {
    const g = e.target.closest('[data-bp-key]');
    if (g) return edit(g.dataset.bpKey);
    const shape = e.target.closest('[data-bp-add]');
    if (shape) {
      const svg = shape.ownerSVGElement;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const t = (loc.y - Number(shape.dataset.top)) / Number(shape.dataset.hd);
      add(Math.max(0.02, Math.min(0.98, t)));
    }
  });
  container.addEventListener('keydown', e => {
    const g = e.target.closest?.('[data-bp-key]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(g.dataset.bpKey); }
  });
  render();
}

let wakeLock = null;

async function viewBlueprint(id) {
  const p = await db.get('pieces', id);
  if (!p) return notFound();
  if (!p.blueprint) return go(`#/werkstueck/${id}/umriss`, true);
  setHeader({ title: 'Blaupause', back: `#/werkstueck/${id}`, actions: `<a class="icon-btn" href="#/werkstueck/${id}/umriss">Umriss</a>` });
  const hiddenCount = p.blueprint.hidden?.length || 0;
  $app.innerHTML = `<div class="bp-full" id="bp"></div>
    <p class="small muted" style="text-align:center">Tippe auf ein Maß, um es einzutragen oder umzubenennen.<br>
      Tippe auf die Form, um eine weitere Stelle zu markieren.<br>Werte mit ≈ sind aus dem Foto geschätzt.</p>
    ${hiddenCount ? `<div class="btn-row"><button class="btn small" id="unhide">Ausgeblendete Stellen zeigen (${hiddenCount})</button></div>` : ''}`;
  mountBlueprint($app.querySelector('#bp'), p);
  $app.querySelector('#unhide')?.addEventListener('click', async () => {
    p.blueprint.hidden = [];
    await db.put('pieces', p);
    router();
  });
  // Bildschirm anlassen, solange die Blaupause an der Drehscheibe offen ist
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
}

async function viewBlueprintEditor(id) {
  const p = await db.get('pieces', id);
  if (!p) return notFound();
  setHeader({ title: 'Umriss erkennen', back: `#/werkstueck/${id}` });
  if (!p.photos?.length) {
    $app.innerHTML = `<div class="empty"><p>Füge dem Werkstück zuerst ein Foto hinzu – am besten genau von der Seite.</p>
      <a class="btn primary" href="#/werkstueck/${id}/bearbeiten">Foto hinzufügen</a></div>`;
    return;
  }
  const prev = p.blueprint;
  const st = {
    photoId: prev && p.photos.includes(prev.photoId) ? prev.photoId : p.photos[0],
    crop: { ...(prev?.crop || DEFAULT_CROP) },
    sens: prev?.sens ?? DEFAULT_SENS,
    src: null,
    result: null,
  };

  $app.innerHTML = `
    <div class="info-box"><p>Am besten klappt es mit einem Foto <strong>genau von der Seite</strong> vor einem ruhigen Hintergrund. Ziehe die Ränder des Rahmens eng um dein Stück (ohne Schatten).</p></div>
    ${p.photos.length > 1 ? `<div class="bp-choice">${p.photos.map(ph => `<button type="button" data-photo-id="${ph}" class="${ph === st.photoId ? 'active' : ''}" aria-label="Dieses Foto verwenden">${thumb(ph)}</button>`).join('')}</div>` : ''}
    <div class="bp-editor"><canvas></canvas></div>
    <label class="range-field"><span>Empfindlichkeit</span>
      <input type="range" min="0" max="100" value="${st.sens}" id="sens" class="compare-range"></label>
    <p class="hint" id="bp-status" style="margin:0 0 4px"></p>
    <div class="btn-row">
      <button type="button" class="btn" id="cancel">Abbrechen</button>
      <button type="button" class="btn primary" id="apply" disabled>Übernehmen</button>
    </div>
    <h3 class="section-title">Vorschau</h3>
    <div class="bp-full" id="bp-preview"></div>
    ${prev ? '<div class="btn-row"><button class="btn danger" id="bp-remove">Blaupause entfernen</button></div>' : ''}`;
  hydratePhotos();

  const canvas = $app.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const statusEl = $app.querySelector('#bp-status');
  const previewEl = $app.querySelector('#bp-preview');
  const applyBtn = $app.querySelector('#apply');
  let box = { w: 0, h: 0 };

  const layout = () => {
    const img = st.src.img;
    const maxW = canvas.parentElement.clientWidth;
    const maxH = Math.min(window.innerHeight * 0.55, 560);
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    box = { w: Math.round(img.naturalWidth * ratio), h: Math.round(img.naturalHeight * ratio) };
    const dpr = window.devicePixelRatio || 1;
    canvas.width = box.w * dpr;
    canvas.height = box.h * dpr;
    canvas.style.width = `${box.w}px`;
    canvas.style.height = `${box.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    const { w, h } = box;
    const c = st.crop;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(st.src.img, 0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, 0, w, c.y0 * h);
    ctx.fillRect(0, c.y1 * h, w, h - c.y1 * h);
    ctx.fillRect(0, c.y0 * h, c.x0 * w, (c.y1 - c.y0) * h);
    ctx.fillRect(c.x1 * w, c.y0 * h, w - c.x1 * w, (c.y1 - c.y0) * h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x0 * w, c.y0 * h, (c.x1 - c.x0) * w, (c.y1 - c.y0) * h);
    const o = st.result?.outline;
    if (o) {
      ctx.strokeStyle = '#ff7a3d';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      for (const side of [o.left, o.right]) {
        ctx.beginPath();
        side.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
        ctx.stroke();
      }
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(o.axis * w, o.top * h);
      ctx.lineTo(o.axis * w, o.bottom * h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [x, y] of [[(c.x0 + c.x1) / 2, c.y0], [(c.x0 + c.x1) / 2, c.y1], [c.x0, (c.y0 + c.y1) / 2], [c.x1, (c.y0 + c.y1) / 2]]) {
      ctx.beginPath();
      ctx.arc(x * w, y * h, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#b5643c';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  };

  const run = () => {
    let error = '';
    try {
      st.result = analyze(st.src, { crop: st.crop, sens: st.sens });
    } catch (err) {
      st.result = null;
      error = err.message;
    }
    draw();
    statusEl.textContent = error || 'Orange = erkannter Umriss. Passt er nicht, verschiebe den Rahmen oder die Empfindlichkeit.';
    statusEl.style.color = error ? 'var(--bad)' : '';
    previewEl.innerHTML = st.result ? blueprintSvg(p, st.result.profile, false) : '';
    applyBtn.disabled = !st.result;
  };

  const load = async () => {
    statusEl.textContent = 'Foto wird analysiert …';
    const photo = await db.get('photos', st.photoId);
    st.src = await loadForAnalysis(photo.blob);
    layout();
    run();
  };

  // Rahmen an den Kanten ziehen
  let drag = null;
  const rel = e => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  canvas.addEventListener('pointerdown', e => {
    const [x, y] = rel(e);
    const c = st.crop;
    const tx = 32 / box.w, ty = 32 / box.h;
    const inY = y > c.y0 - ty && y < c.y1 + ty;
    const inX = x > c.x0 - tx && x < c.x1 + tx;
    const cand = [['x0', Math.abs(x - c.x0) / tx, inY], ['x1', Math.abs(x - c.x1) / tx, inY], ['y0', Math.abs(y - c.y0) / ty, inX], ['y1', Math.abs(y - c.y1) / ty, inX]]
      .filter(a => a[2] && a[1] < 1)
      .sort((a, b) => a[1] - b[1]);
    if (!cand.length) return;
    drag = cand[0][0];
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const [x, y] = rel(e);
    const c = st.crop;
    const min = 0.08;
    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (drag === 'x0') c.x0 = cl(x, 0, c.x1 - min);
    if (drag === 'x1') c.x1 = cl(x, c.x0 + min, 1);
    if (drag === 'y0') c.y0 = cl(y, 0, c.y1 - min);
    if (drag === 'y1') c.y1 = cl(y, c.y0 + min, 1);
    draw();
  });
  const endDrag = () => { if (drag) { drag = null; run(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  let timer;
  $app.querySelector('#sens').addEventListener('input', e => {
    st.sens = Number(e.target.value);
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });

  $app.querySelector('.bp-choice')?.addEventListener('click', e => {
    const b = e.target.closest('[data-photo-id]');
    if (!b || b.dataset.photoId === st.photoId) return;
    st.photoId = b.dataset.photoId;
    st.crop = { ...DEFAULT_CROP };
    $app.querySelectorAll('.bp-choice button').forEach(x => x.classList.toggle('active', x === b));
    load();
  });

  $app.querySelector('#cancel').onclick = () => $back.click();
  applyBtn.onclick = async () => {
    if (!st.result) return;
    p.blueprint = makeBlueprint(st.photoId, st.crop, st.sens, st.result.profile, prev);
    p.updatedAt = new Date().toISOString();
    await db.put('pieces', p);
    toast('Blaupause gespeichert');
    finish(`#/werkstueck/${id}`, true);
  };
  $app.querySelector('#bp-remove')?.addEventListener('click', async () => {
    if (!confirm('Blaupause entfernen? Deine eingetragenen Maße bleiben erhalten.')) return;
    delete p.blueprint;
    await db.put('pieces', p);
    finish(`#/werkstueck/${id}`, true);
  });

  try { await load(); } catch (err) { statusEl.textContent = err.message; }
}

// ---------------------------------------------------------------------------
// Glasieren (Protokoll mit Vorher-/Nachher-Foto)
// ---------------------------------------------------------------------------

function layerSummary(l) {
  const parts = [l.glazeName || 'Glasur'];
  if (l.art && l.art !== 'Tauchen') parts.push(l.art);
  if (isNum(l.dauer)) parts.push(`${fmt(l.dauer)} s`);
  if (isNum(l.wdh) && Number(l.wdh) > 1) parts.push(`${fmt(l.wdh, 0)}×`);
  return parts.join(' · ');
}

function firingStatus(f) {
  if (!f.afterPhoto && !f.ergebnis) return '<span class="badge accent">Wartet auf Brand</span>';
  const e = ERGEBNISSE[f.ergebnis];
  return e ? `<span class="badge ${e.cls}">${e.label}</span>` : '<span class="badge">Gebrannt</span>';
}

function firingRow(f) {
  const issues = (f.vorher?.length || 0) + (f.nachher?.length || 0);
  return `<a class="row-card" href="#/glasieren/${f.id}">
    <span class="pair">${thumb(f.beforePhoto, { placeholder: 'vorher' })}${thumb(f.afterPhoto, { placeholder: 'nachher' })}</span>
    <span class="row-body">
      <span class="row-title">${esc(f.titel || 'Glasur')}</span>
      <span class="row-sub">${esc((f.lagen || []).map(layerSummary).join(' + ') || '–')}</span>
      <span class="row-sub">${fmtDate(f.datum)}</span>
      <span class="badges">${firingStatus(f)}${issues ? `<span class="badge">${issues} Auffälligkeit${issues > 1 ? 'en' : ''}</span>` : ''}</span>
    </span>
  </a>`;
}

let firingFilter = 'alle';

async function viewFirings() {
  setHeader({ title: 'Glasieren' });
  const firings = (await db.getAll('firings')).sort(byDateDesc);

  if (!firings.length) {
    $app.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="13" y="5" width="8" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        <p><strong>Noch keine Glasurprotokolle</strong></p>
        <p>So geht’s: Schrühware glasieren → <strong>Foto vor dem Brand</strong> machen und Tauchdauer &amp; Wiederholungen notieren → nach dem Glasurbrand das <strong>Foto danach</strong> ergänzen und vergleichen.</p>
      </div>
      <a class="fab" href="#/glasieren/neu">${ICON_PLUS} Neues Protokoll</a>`;
    return;
  }

  const offen = firings.filter(f => !f.afterPhoto && !f.ergebnis).length;
  $app.innerHTML = `<div class="segmented" role="radiogroup" aria-label="Filter">
      ${[['alle', 'Alle'], ['offen', `Wartet auf Brand${offen ? ` (${offen})` : ''}`], ['fertig', 'Gebrannt']].map(([v, l]) =>
        `<label><input type="radio" name="flt" value="${v}" ${firingFilter === v ? 'checked' : ''}><span class="none">${l}</span></label>`).join('')}
    </div>
    <div class="list" id="firing-list"></div>
    <a class="fab" href="#/glasieren/neu">${ICON_PLUS} Neu</a>`;

  const listEl = $app.querySelector('#firing-list');
  const render = () => {
    const list = firings.filter(f => {
      const done = !!(f.afterPhoto || f.ergebnis);
      return firingFilter === 'alle' || (firingFilter === 'offen' ? !done : done);
    });
    listEl.innerHTML = list.length ? list.map(firingRow).join('') : '<p class="muted">Keine Einträge.</p>';
    hydratePhotos(listEl);
  };
  $app.querySelector('.segmented').addEventListener('change', e => { firingFilter = e.target.value; render(); });
  render();
}

async function viewFiring(id) {
  const f = await db.get('firings', id);
  if (!f) return notFound();
  const piece = f.pieceId ? await db.get('pieces', f.pieceId) : null;
  setHeader({ title: f.titel || 'Glasurprotokoll', back: '#/glasieren', actions: `<a class="icon-btn" href="#/glasieren/${id}/bearbeiten">Bearbeiten</a>` });

  const hasBoth = f.beforePhoto && f.afterPhoto;
  const b = f.brand || {};

  $app.innerHTML = `
    <div id="compare"></div>
    ${!f.afterPhoto ? `<div class="info-box"><p><strong>Nach dem Glasurbrand:</strong> Tippe auf „Ergebnis nach Brand eintragen“, mache ein Foto aus dem gleichen Blickwinkel wie vorher und notiere, was dir auffällt.</p></div>
      <a class="btn primary block" href="#/glasieren/${id}/bearbeiten?schritt=nachher" style="margin-bottom:14px">${ICON_CAMERA.replace('<svg', '<svg width="22" height="22"')} Ergebnis nach Brand eintragen</a>` : ''}

    <div class="card">
      <h2>Glasurauftrag</h2>
      ${(f.lagen || []).map((l, i) => `<dl class="facts" style="${i ? 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border)' : ''}">
        <dt>${f.lagen.length > 1 ? `${i + 1}. Glasur` : 'Glasur'}</dt><dd>${l.glazeId ? `<a href="#/glasuren/${l.glazeId}">${esc(l.glazeName)}</a>` : esc(l.glazeName || '–')}</dd>
        <dt>Auftrag</dt><dd>${esc(l.art || 'Tauchen')}</dd>
        <dt>${l.art === 'Tauchen' || !l.art ? 'Tauchdauer' : 'Dauer'}</dt><dd>${withUnit(l.dauer, 'Sek.')}</dd>
        <dt>Wiederholungen</dt><dd>${isNum(l.wdh) ? `${fmt(l.wdh, 0)}×` : '–'}</dd>
        ${isNum(l.pause) ? `<dt>Pause dazwischen</dt><dd>${withUnit(l.pause, 'Sek.')}</dd>` : ''}
        ${isNum(l.litergewicht) ? `<dt>Litergewicht</dt><dd>${withUnit(l.litergewicht, 'g/l', 0)}</dd>` : ''}
      </dl>`).join('') || '<p class="muted">Keine Angaben.</p>'}
      ${f.datum ? `<p class="small muted" style="margin:12px 0 0">Glasiert am ${fmtDate(f.datum)}</p>` : ''}
    </div>

    ${f.vorher?.length || f.nachher?.length ? `<div class="card">
      ${f.vorher?.length ? `<h2>Auffällig vor dem Brand</h2><div class="badges" style="margin-bottom:12px">${f.vorher.map(v => `<span class="badge warn">${esc(v)}</span>`).join('')}</div>` : ''}
      ${f.nachher?.length ? `<h2>Auffällig nach dem Brand</h2><div class="badges">${f.nachher.map(v => `<span class="badge bad">${esc(v)}</span>`).join('')}</div>` : ''}
    </div>` : ''}

    <div class="card">
      <h2>Glasurbrand</h2>
      <dl class="facts">
        <dt>Ergebnis</dt><dd>${firingStatus(f)}</dd>
        ${b.datum ? `<dt>Gebrannt am</dt><dd>${fmtDate(b.datum)}</dd>` : ''}
        ${isNum(b.temperatur) ? `<dt>Temperatur</dt><dd>${withUnit(b.temperatur, '°C', 0)}</dd>` : ''}
        ${b.kegel ? `<dt>Kegel</dt><dd>${esc(b.kegel)}</dd>` : ''}
        ${isNum(b.haltezeit) ? `<dt>Haltezeit</dt><dd>${withUnit(b.haltezeit, 'min', 0)}</dd>` : ''}
        ${b.ofen ? `<dt>Ofen / Programm</dt><dd>${esc(b.ofen)}</dd>` : ''}
        ${b.position ? `<dt>Platz im Ofen</dt><dd>${esc(b.position)}</dd>` : ''}
      </dl>
    </div>

    ${piece ? `<h3 class="section-title">Werkstück</h3><a class="row-card" href="#/werkstueck/${piece.id}">
        <span class="pair">${thumb(piece.photos?.[0])}</span>
        <span class="row-body"><span class="row-title">${esc(piece.name)}</span><span class="row-sub">${esc([isNum(piece.tonmenge) ? `${fmt(piece.tonmenge, 0)} g` : '', piece.tonsorte].filter(Boolean).join(' · '))}</span></span>
      </a>` : ''}

    ${f.notizen ? `<div class="card" style="margin-top:14px"><h2>Notizen</h2><p class="notes">${esc(f.notizen)}</p></div>` : ''}

    <div class="btn-row">
      <a class="btn" href="#/glasieren/neu?vorlage=${id}">Gleich nochmal glasieren</a>
      <button class="btn danger" id="del">Löschen</button>
    </div>`;

  const cmp = $app.querySelector('#compare');
  if (hasBoth) mountCompare(cmp, f.beforePhoto, f.afterPhoto);
  else cmp.innerHTML = `<div class="compare-side" style="margin-bottom:14px">
      <figure>${thumb(f.beforePhoto, { full: true, zoom: true, placeholder: 'Kein Foto vor dem Brand' })}<figcaption>Vor dem Brand</figcaption></figure>
      <figure>${thumb(f.afterPhoto, { full: true, zoom: true, placeholder: 'Noch nicht gebrannt' })}<figcaption>Nach dem Brand</figcaption></figure>
    </div>`;
  hydratePhotos();

  $app.querySelector('#del').onclick = async () => {
    if (!confirm('Dieses Glasurprotokoll wirklich löschen?')) return;
    await deletePhoto(f.beforePhoto);
    await deletePhoto(f.afterPhoto);
    await db.del('firings', id);
    toast('Gelöscht');
    go('#/glasieren', true);
  };
}

let compareMode = 'schieber';

function mountCompare(container, beforeId, afterId) {
  const render = () => {
    container.innerHTML = `<div class="segmented compare-modes" role="radiogroup" aria-label="Vergleichsansicht">
        ${[['schieber', 'Schieberegler'], ['blende', 'Überblenden'], ['neben', 'Nebeneinander']].map(([v, l]) =>
          `<label><input type="radio" name="cmode" value="${v}" ${compareMode === v ? 'checked' : ''}><span class="none">${l}</span></label>`).join('')}
      </div>
      ${compareMode === 'neben' ? `<div class="compare-side">
          <figure>${thumb(beforeId, { full: true, zoom: true })}<figcaption>Vor dem Brand</figcaption></figure>
          <figure>${thumb(afterId, { full: true, zoom: true })}<figcaption>Nach dem Brand</figcaption></figure>
        </div>` : `<div class="compare-stack">
          <img data-photo="${beforeId}" data-full alt="Vor dem Brand">
          <img data-photo="${afterId}" data-full alt="Nach dem Brand" class="top">
          ${compareMode === 'schieber' ? '<div class="divider"></div>' : ''}
          <span class="lbl l">Vorher</span><span class="lbl r">Nachher</span>
        </div>
        <input type="range" class="compare-range" min="0" max="100" value="50" aria-label="${compareMode === 'schieber' ? 'Trennlinie verschieben' : 'Überblenden'}">
        <p class="small muted" style="margin:0 0 14px;text-align:center">${compareMode === 'schieber' ? 'Ziehe im Bild oder am Regler, um vorher und nachher zu vergleichen.' : 'Regler nach rechts = mehr „Nachher“. Ideal, um Stellen genau übereinanderzulegen.'}</p>`}`;
    hydratePhotos(container);

    const stack = container.querySelector('.compare-stack');
    if (!stack) return;
    const top = stack.querySelector('img.top');
    const divider = stack.querySelector('.divider');
    const range = container.querySelector('.compare-range');
    const apply = v => {
      if (compareMode === 'schieber') {
        top.style.clipPath = `inset(0 0 0 ${v}%)`;
        divider.style.left = `${v}%`;
      } else {
        top.style.opacity = v / 100;
      }
    };
    range.addEventListener('input', () => apply(range.value));
    if (compareMode === 'schieber') {
      const fromPointer = e => {
        const r = stack.getBoundingClientRect();
        range.value = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
        apply(range.value);
      };
      stack.addEventListener('pointerdown', e => { stack.setPointerCapture(e.pointerId); fromPointer(e); });
      stack.addEventListener('pointermove', e => { if (stack.hasPointerCapture(e.pointerId)) fromPointer(e); });
    }
    apply(range.value);
  };
  container.addEventListener('change', e => {
    if (e.target.name === 'cmode') { compareMode = e.target.value; render(); }
  });
  render();
}

function layerHtml(l, i, glazes) {
  const opts = glazes.map(g => ({ value: g.id, label: g.name }));
  const selected = l.glazeId || (l.glazeName ? '__frei' : '');
  return `<div class="layer" data-i="${i}">
    <div class="layer-head"><span>${i + 1}. Glasurschicht</span>${i ? '<button type="button" class="remove-btn" data-remove-layer aria-label="Schicht entfernen">×</button>' : ''}</div>
    ${glazes.length
      ? selectField('Glasur', 'glazeId', selected, [...opts, { value: '__frei', label: 'Andere (Name eingeben) …' }])
      : ''}
    <div class="free-name" ${glazes.length && selected !== '__frei' ? 'hidden' : ''}>
      ${field('Name der Glasur', 'glazeName', l.glazeId ? '' : l.glazeName, { placeholder: 'z. B. Seladon hell' })}
    </div>
    ${selectField('Auftrag', 'art', l.art || 'Tauchen', AUFTRAGSARTEN, { empty: null })}
    <div class="fields-2">
      ${field('Tauchdauer', 'dauer', l.dauer, { type: 'number', unit: 'Sek.' })}
      ${field('Wiederholungen', 'wdh', l.wdh ?? 1, { type: 'number', unit: '×' })}
      ${field('Pause dazwischen', 'pause', l.pause, { type: 'number', unit: 'Sek.' })}
      ${field('Litergewicht', 'litergewicht', l.litergewicht, { type: 'number', unit: 'g/l' })}
    </div>
  </div>`;
}

function readLayers(container, glazes) {
  return [...container.querySelectorAll('.layer')].map(el => {
    const q = n => el.querySelector(`[name="${n}"]`)?.value?.trim().replace(',', '.') ?? '';
    const num = n => (isNum(q(n)) ? Number(q(n)) : null);
    const sel = el.querySelector('[name="glazeId"]');
    const free = el.querySelector('[name="glazeName"]')?.value?.trim() || '';
    let glazeId = sel ? sel.value : '';
    let glazeName = '';
    if (!sel || glazeId === '__frei') { glazeId = ''; glazeName = free; }
    else if (glazeId) glazeName = glazes.find(g => g.id === glazeId)?.name || '';
    return { glazeId: glazeId || null, glazeName, art: q('art') || 'Tauchen', dauer: num('dauer'), wdh: num('wdh'), pause: num('pause'), litergewicht: num('litergewicht') };
  });
}

async function viewFiringForm(id, params) {
  let f = id ? await db.get('firings', id) : null;
  if (id && !f) return notFound();
  const glazes = (await db.getAll('glazes')).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const pieces = (await db.getAll('pieces')).sort(byDateDesc);

  if (!f) {
    const vorlage = params.get('vorlage') ? await db.get('firings', params.get('vorlage')) : null;
    const glazeParam = params.get('glasur') && glazes.find(g => g.id === params.get('glasur'));
    f = {
      datum: today(),
      pieceId: params.get('stueck') || vorlage?.pieceId || '',
      titel: vorlage?.titel || '',
      lagen: vorlage ? structuredClone(vorlage.lagen) : [{ glazeId: glazeParam?.id || '', glazeName: glazeParam?.name || '', art: 'Tauchen', wdh: 1, litergewicht: glazeParam?.litergewicht ?? null }],
      brand: vorlage ? { ...vorlage.brand, datum: '' } : {},
      vorher: [],
      nachher: [],
    };
  }
  const state = { beforePhoto: f.beforePhoto || null, afterPhoto: f.afterPhoto || null };
  const lagen = structuredClone(f.lagen?.length ? f.lagen : [{ art: 'Tauchen', wdh: 1 }]);
  const session = photoSession();
  const b = f.brand || {};
  const nachherZuerst = params.get('schritt') === 'nachher';

  setHeader({ title: id ? 'Protokoll bearbeiten' : 'Glasur protokollieren', back: id ? `#/glasieren/${id}` : '#/glasieren' });

  const vorherCard = `<div class="card" id="card-vorher">
      <h2>1 · Vor dem Brand</h2>
      <p class="hint" style="margin-top:0">Fotografiere die glasierte Schrühware – am besten immer vor dem gleichen Hintergrund und aus dem gleichen Winkel.</p>
      <div id="before"></div>
      ${field('Glasiert am', 'datum', f.datum, { type: 'date' })}
      ${selectField('Werkstück', 'pieceId', f.pieceId || '', pieces.map(p => ({ value: p.id, label: p.name })), { empty: '– kein Werkstück verknüpft –' })}
      ${field('Titel', 'titel', f.titel, { placeholder: 'z. B. Becher Seladon, Probe 3' })}
    </div>
    <div class="card">
      <h2>Glasurauftrag</h2>
      <div id="layers"></div>
      <button type="button" class="btn small" id="add-layer" style="margin-bottom:14px">${ICON_PLUS.replace('<svg', '<svg width="18" height="18"')} Weitere Glasur darüber</button>
    </div>
    <div class="card">
      <h2>Auffälligkeiten beim Glasieren</h2>
      ${chips('vorher', AUFFAELLIG_VORHER, f.vorher || [])}
    </div>`;

  const nachherCard = `<div class="card" id="card-nachher">
      <h2>2 · Nach dem Glasurbrand</h2>
      <p class="hint" style="margin-top:0">Fotografiere das fertige Stück aus dem gleichen Blickwinkel wie vorher.</p>
      <div id="after"></div>
      <span class="field"><span>Ergebnis</span></span>
      <div class="segmented">
        ${Object.entries(ERGEBNISSE).map(([k, e]) => `<label><input type="radio" name="ergebnis" value="${k}" ${f.ergebnis === k ? 'checked' : ''}><span class="${e.cls}">${e.label}</span></label>`).join('')}
      </div>
      <span class="field"><span>Auffälligkeiten nach dem Brand</span></span>
      ${chips('nachher', AUFFAELLIG_NACHHER, f.nachher || [])}
    </div>
    <div class="card">
      <h2>Brand</h2>
      <div class="fields-2">
        ${field('Gebrannt am', 'brand.datum', b.datum, { type: 'date' })}
        ${field('Temperatur', 'brand.temperatur', b.temperatur, { type: 'number', unit: '°C' })}
        ${field('Kegel', 'brand.kegel', b.kegel, { placeholder: 'z. B. 6' })}
        ${field('Haltezeit', 'brand.haltezeit', b.haltezeit, { type: 'number', unit: 'min' })}
      </div>
      ${field('Ofen / Programm', 'brand.ofen', b.ofen, { placeholder: 'z. B. Nabertherm, Programm 4' })}
      ${field('Platz im Ofen', 'brand.position', b.position, { placeholder: 'z. B. oben links' })}
    </div>`;

  $app.innerHTML = `<form id="f" novalidate>
    ${nachherZuerst ? nachherCard + vorherCard : vorherCard + nachherCard}
    <div class="card">${textarea('Notizen', 'notizen', f.notizen, 'Was ist dir aufgefallen? Was probierst du beim nächsten Mal?')}</div>
    <div class="sticky-save">
      <button type="button" class="btn" id="cancel">Abbrechen</button>
      <button type="submit" class="btn primary">Speichern</button>
    </div>
  </form>`;

  mountSinglePhoto($app.querySelector('#before'), state, 'beforePhoto', session, 'Foto vor dem Brand');
  mountSinglePhoto($app.querySelector('#after'), state, 'afterPhoto', session, 'Foto nach dem Brand');

  const layersEl = $app.querySelector('#layers');
  const renderLayers = () => { layersEl.innerHTML = lagen.map((l, i) => layerHtml(l, i, glazes)).join(''); };
  const syncLayers = () => { lagen.splice(0, lagen.length, ...readLayers(layersEl, glazes)); };
  renderLayers();
  layersEl.addEventListener('change', e => {
    if (e.target.name === 'glazeId') {
      const layer = e.target.closest('.layer');
      layer.querySelector('.free-name').hidden = e.target.value !== '__frei';
      const g = glazes.find(x => x.id === e.target.value);
      const lg = layer.querySelector('[name="litergewicht"]');
      if (g && isNum(g.litergewicht) && !lg.value) lg.value = g.litergewicht;
    }
  });
  layersEl.addEventListener('click', e => {
    if (e.target.closest('[data-remove-layer]')) {
      syncLayers();
      lagen.splice(e.target.closest('.layer').dataset.i, 1);
      renderLayers();
    }
  });
  $app.querySelector('#add-layer').onclick = () => {
    syncLayers();
    lagen.push({ art: 'Tauchen', wdh: 1 });
    renderLayers();
  };

  const form = $app.querySelector('#f');
  $app.querySelector('#cancel').onclick = () => $back.click();
  form.onsubmit = async e => {
    e.preventDefault();
    const now = new Date().toISOString();
    const lagenNeu = readLayers(layersEl, glazes).filter(l => l.glazeName || isNum(l.dauer));
    const obj = {
      ...f,
      id: id || db.newId(),
      datum: strVal(form, 'datum'),
      pieceId: strVal(form, 'pieceId') || null,
      titel: strVal(form, 'titel'),
      lagen: lagenNeu,
      vorher: checkedVals(form, 'vorher'),
      nachher: checkedVals(form, 'nachher'),
      ergebnis: form.querySelector('input[name="ergebnis"]:checked')?.value || null,
      brand: {
        datum: strVal(form, 'brand.datum'),
        temperatur: numVal(form, 'brand.temperatur'),
        kegel: strVal(form, 'brand.kegel'),
        haltezeit: numVal(form, 'brand.haltezeit'),
        ofen: strVal(form, 'brand.ofen'),
        position: strVal(form, 'brand.position'),
      },
      notizen: strVal(form, 'notizen'),
      beforePhoto: state.beforePhoto,
      afterPhoto: state.afterPhoto,
      createdAt: f.createdAt || now,
      updatedAt: now,
    };
    if (!obj.titel) {
      const piece = pieces.find(p => p.id === obj.pieceId);
      obj.titel = [piece?.name, lagenNeu.map(l => l.glazeName).filter(Boolean).join(' + ')].filter(Boolean).join(' – ') || 'Glasurprobe';
    }
    if (obj.afterPhoto && !obj.brand.datum) obj.brand.datum = today();
    await db.put('firings', obj);
    await session.commit();
    toast('Gespeichert');
    finish(`#/glasieren/${obj.id}`, !!id);
  };
}

// ---------------------------------------------------------------------------
// Glasuren (Rezepte + Auswertung)
// ---------------------------------------------------------------------------

async function viewGlazes() {
  setHeader({ title: 'Glasuren' });
  const glazes = (await db.getAll('glazes')).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const firings = await db.getAll('firings');
  const count = id => firings.filter(f => f.lagen?.some(l => l.glazeId === id)).length;

  if (!glazes.length) {
    $app.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24"><path d="M4 8h16l-1.5 11a2 2 0 0 1-2 1.8h-9a2 2 0 0 1-2-1.8z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        <p><strong>Noch keine Glasuren</strong></p>
        <p>Lege deine selbst angesetzten Glasuren mit Rezept und Litergewicht an. Danach siehst du hier, wie sich verschiedene Tauchzeiten auf das Ergebnis auswirken.</p>
      </div>
      <a class="fab" href="#/glasuren/neu">${ICON_PLUS} Neue Glasur</a>`;
    return;
  }

  $app.innerHTML = `<div class="list">${glazes.map(g => {
    const n = count(g.id);
    return `<a class="row-card" href="#/glasuren/${g.id}">
      <span class="pair">${thumb(g.photo, { placeholder: 'Testkachel' })}</span>
      <span class="row-body">
        <span class="row-title">${esc(g.name)}</span>
        <span class="row-sub">${esc([g.brennbereich, isNum(g.litergewicht) ? `${fmt(g.litergewicht, 0)} g/l` : ''].filter(Boolean).join(' · ') || g.beschreibung || '')}</span>
        <span class="badges">${n ? `<span class="badge accent">${n} Protokoll${n > 1 ? 'e' : ''}</span>` : '<span class="badge">noch nicht verwendet</span>'}</span>
      </span>
    </a>`;
  }).join('')}</div>
  <a class="fab" href="#/glasuren/neu">${ICON_PLUS} Neu</a>`;
  hydratePhotos();
}

async function viewGlaze(id) {
  const g = await db.get('glazes', id);
  if (!g) return notFound();
  setHeader({ title: g.name, back: '#/glasuren', actions: `<a class="icon-btn" href="#/glasuren/${id}/bearbeiten">Bearbeiten</a>` });

  // Alle Protokolle, in denen diese Glasur vorkommt – sortiert nach Tauchdauer
  const uses = (await db.getAll('firings'))
    .flatMap(f => (f.lagen || []).map((l, i) => ({ f, l, i })).filter(x => x.l.glazeId === id))
    .sort((a, b) => (a.l.dauer ?? 1e9) - (b.l.dauer ?? 1e9) || (a.l.wdh ?? 0) - (b.l.wdh ?? 0));
  const summe = (g.rezept || []).reduce((s, r) => s + (isNum(r.anteil) ? Number(r.anteil) : 0), 0);

  // Kleine Statistik: Ergebnis je Tauchdauer
  const groups = new Map();
  for (const { f, l } of uses) {
    if (!f.ergebnis) continue;
    const key = `${isNum(l.dauer) ? fmt(l.dauer) + ' s' : '? s'}${isNum(l.wdh) && l.wdh > 1 ? ` · ${fmt(l.wdh, 0)}×` : ''}`;
    if (!groups.has(key)) groups.set(key, { gut: 0, ok: 0, schlecht: 0 });
    groups.get(key)[f.ergebnis]++;
  }

  $app.innerHTML = `
    ${g.photo ? `<div class="gallery">${thumb(g.photo, { full: true, zoom: true })}</div>` : ''}
    <div class="card">
      <dl class="facts">
        ${g.beschreibung ? `<dt>Beschreibung</dt><dd>${esc(g.beschreibung)}</dd>` : ''}
        ${g.brennbereich ? `<dt>Brennbereich</dt><dd>${esc(g.brennbereich)}</dd>` : ''}
        <dt>Litergewicht</dt><dd>${withUnit(g.litergewicht, 'g/l', 0)}</dd>
        ${g.angesetzt ? `<dt>Angesetzt am</dt><dd>${fmtDate(g.angesetzt)}</dd>` : ''}
      </dl>
    </div>

    ${g.rezept?.length ? `<div class="card"><h2>Rezept</h2>
      <table class="recipe-table">${g.rezept.map(r => `<tr><td>${esc(r.rohstoff)}</td><td>${isNum(r.anteil) ? fmt(r.anteil, 2) : esc(r.anteil)}</td></tr>`).join('')}
      <tr class="sum"><td>Summe</td><td>${fmt(summe, 2)}</td></tr></table></div>` : ''}

    ${g.notizen ? `<div class="card"><h2>Notizen</h2><p class="notes">${esc(g.notizen)}</p></div>` : ''}

    <h3 class="section-title">Auswertung: Tauchdauer → Ergebnis</h3>
    ${groups.size ? `<div class="card"><table class="measure">
      <thead><tr><th>Auftrag</th><th>Gelungen</th><th>Geht so</th><th>Misslungen</th></tr></thead>
      <tbody>${[...groups].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.gut || ''}</td><td>${v.ok || ''}</td><td>${v.schlecht || ''}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${uses.length ? `<div class="card">
      <p class="small muted" style="margin-top:0">Alle Stücke mit dieser Glasur, sortiert nach Tauchdauer. Links vorher, rechts nachher.</p>
      ${uses.map(({ f, l }) => `<a class="eval-row" href="#/glasieren/${f.id}">
        ${thumb(f.beforePhoto, { placeholder: 'vorher' })}${thumb(f.afterPhoto, { placeholder: 'nachher' })}
        <span>
          <span class="eval-main">${isNum(l.dauer) ? fmt(l.dauer) + ' Sek.' : 'Dauer ?'}${isNum(l.wdh) ? ` · ${fmt(l.wdh, 0)}×` : ''}${l.art && l.art !== 'Tauchen' ? ` · ${esc(l.art)}` : ''}</span><br>
          <span class="small muted">${esc(f.titel)}${isNum(l.litergewicht) ? ` · ${fmt(l.litergewicht, 0)} g/l` : ''}</span>
          <span class="badges">${firingStatus(f)}${[...(f.vorher || []), ...(f.nachher || [])].slice(0, 3).map(v => `<span class="badge">${esc(v)}</span>`).join('')}</span>
        </span>
      </a>`).join('')}
    </div>` : '<p class="muted small">Noch keine Glasurprotokolle mit dieser Glasur.</p>'}

    <div class="btn-row">
      <a class="btn primary" href="#/glasieren/neu?glasur=${id}">Mit dieser Glasur glasieren</a>
    </div>
    <div class="btn-row"><button class="btn danger" id="del">Glasur löschen</button></div>`;

  hydratePhotos();
  $app.querySelector('#del').onclick = async () => {
    if (!confirm(`Glasur „${g.name}“ löschen? Protokolle behalten den Namen der Glasur.`)) return;
    for (const f of new Set(uses.map(u => u.f))) {
      f.lagen.forEach(l => { if (l.glazeId === id) l.glazeId = null; });
      await db.put('firings', f);
    }
    await deletePhoto(g.photo);
    await db.del('glazes', id);
    toast('Gelöscht');
    go('#/glasuren', true);
  };
}

async function viewGlazeForm(id) {
  const g = id ? await db.get('glazes', id) : { angesetzt: today(), rezept: [] };
  if (!g) return notFound();
  const state = { photo: g.photo || null };
  const rezept = (g.rezept || []).map(r => ({ a: r.rohstoff, b: r.anteil ?? '' }));
  if (!rezept.length) rezept.push({ a: '', b: '' });
  const session = photoSession();

  setHeader({ title: id ? 'Glasur bearbeiten' : 'Neue Glasur', back: id ? `#/glasuren/${id}` : '#/glasuren' });

  $app.innerHTML = `<form id="f" novalidate>
    <div class="card">
      ${field('Name', 'name', g.name, { placeholder: 'z. B. Seladon hell' })}
      ${field('Beschreibung', 'beschreibung', g.beschreibung, { placeholder: 'z. B. glänzend, transparent-grün' })}
      <div class="fields-2">
        ${field('Brennbereich', 'brennbereich', g.brennbereich, { placeholder: 'z. B. 1220–1250 °C' })}
        ${field('Litergewicht', 'litergewicht', g.litergewicht, { type: 'number', unit: 'g/l' })}
      </div>
      <p class="hint">Das Litergewicht (Gewicht von 1 Liter Glasurschlicker) beeinflusst stark, wie dick die Glasur beim Tauchen aufträgt.</p>
      ${field('Angesetzt am', 'angesetzt', g.angesetzt, { type: 'date' })}
    </div>
    <div class="card">
      <h2>Rezept</h2>
      <div id="rezept"></div>
      <p class="small muted" id="summe" style="margin:12px 0 14px"></p>
    </div>
    <div class="card">
      <h2>Foto der Testkachel</h2>
      <div id="photo"></div>
    </div>
    <div class="card">${textarea('Notizen', 'notizen', g.notizen, 'Rohstoff-Lieferant, Siebgröße, Zusätze …')}</div>
    <div class="sticky-save">
      <button type="button" class="btn" id="cancel">Abbrechen</button>
      <button type="submit" class="btn primary">Speichern</button>
    </div>
  </form>`;

  const summeEl = $app.querySelector('#summe');
  mountRepeat($app.querySelector('#rezept'), rezept, {
    labelA: 'Rohstoff', labelB: 'Anteil', typeB: 'number', addLabel: 'Rohstoff hinzufügen',
    onChange: () => {
      const s = rezept.reduce((a, r) => a + (isNum(String(r.b).replace(',', '.')) ? Number(String(r.b).replace(',', '.')) : 0), 0);
      summeEl.textContent = s ? `Summe: ${fmt(s, 2)}` : '';
    },
  });
  mountSinglePhoto($app.querySelector('#photo'), state, 'photo', session, 'Testkachel');

  const form = $app.querySelector('#f');
  $app.querySelector('#cancel').onclick = () => $back.click();
  form.onsubmit = async e => {
    e.preventDefault();
    const name = strVal(form, 'name');
    if (!name) { toast('Bitte gib der Glasur einen Namen.'); form.elements.name.focus(); return; }
    const now = new Date().toISOString();
    const obj = {
      ...g,
      id: id || db.newId(),
      name,
      beschreibung: strVal(form, 'beschreibung'),
      brennbereich: strVal(form, 'brennbereich'),
      litergewicht: numVal(form, 'litergewicht'),
      angesetzt: strVal(form, 'angesetzt'),
      rezept: rezept.filter(r => String(r.a).trim()).map(r => {
        const v = String(r.b).trim().replace(',', '.');
        return { rohstoff: String(r.a).trim(), anteil: isNum(v) ? Number(v) : null };
      }),
      notizen: strVal(form, 'notizen'),
      photo: state.photo,
      createdAt: g.createdAt || now,
      updatedAt: now,
    };
    await db.put('glazes', obj);
    // Namen in bestehenden Protokollen aktuell halten
    if (id && g.name !== name) {
      for (const f of await db.getAll('firings')) {
        if (f.lagen?.some(l => l.glazeId === id)) {
          f.lagen.forEach(l => { if (l.glazeId === id) l.glazeName = name; });
          await db.put('firings', f);
        }
      }
    }
    await session.commit();
    toast('Gespeichert');
    finish(`#/glasuren/${obj.id}`, !!id);
  };
}

// ---------------------------------------------------------------------------
// Mehr: Datensicherung & Hilfe
// ---------------------------------------------------------------------------

async function viewMore() {
  setHeader({ title: 'Mehr' });
  const [pieces, glazes, firings, photos] = await Promise.all(db.STORES.map(s => db.getAll(s)));
  let usage = '';
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    usage = `${fmt(est.usage / 1024 / 1024)} MB belegt`;
  }
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;

  $app.innerHTML = `
    <div class="card">
      <h2>Deine Daten</h2>
      <dl class="facts">
        <dt>Werkstücke</dt><dd>${pieces.length}</dd>
        <dt>Glasurprotokolle</dt><dd>${firings.length}</dd>
        <dt>Glasuren</dt><dd>${glazes.length}</dd>
        <dt>Fotos</dt><dd>${photos.length}${usage ? ` <span class="muted small">(${usage})</span>` : ''}</dd>
        <dt>Dauerhaft</dt><dd>${persisted ? 'Ja ✓' : 'Nicht garantiert'}</dd>
      </dl>
      <p class="small muted" style="margin-bottom:0">Alle Daten und Fotos sind <strong>nur auf diesem Gerät</strong> gespeichert. Mache regelmäßig eine Sicherung!</p>
    </div>

    <div class="card">
      <h2>Datensicherung</h2>
      <p class="small muted" style="margin-top:0">Die Sicherung ist eine einzelne Datei mit allen Einträgen und Fotos. Speichere sie z. B. in deiner Cloud oder schicke sie dir per E-Mail.</p>
      <div class="btn-row" style="margin-bottom:6px">
        <button class="btn primary" id="export">Sicherung erstellen</button>
        <button class="btn" id="import">Sicherung laden</button>
      </div>
      <input type="file" id="import-file" accept=".json,application/json" hidden>
    </div>

    <div class="card">
      <h2>Als App installieren</h2>
      <p class="small" style="margin-top:0"><strong>iPhone/iPad (Safari):</strong> Teilen-Symbol <span aria-hidden="true">⬆︎</span> → „Zum Home-Bildschirm“.</p>
      <p class="small" style="margin-bottom:0"><strong>Android (Chrome):</strong> Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.</p>
    </div>

    <div class="card">
      <h2>So funktioniert die Blaupause</h2>
      <ol class="small" style="padding-left:20px;margin:0">
        <li>Fotografiere dein Stück <strong>genau von der Seite</strong> vor einem ruhigen Hintergrund.</li>
        <li>Beim Speichern erkennt die App die Form und markiert Rand, Bauch, Hals, Fußansatz und Boden.</li>
        <li>Tippe ein Maß an, um es einzutragen. Schon ein Maß (z. B. die Höhe) reicht – die übrigen werden aus dem Foto geschätzt (≈).</li>
        <li>Fehlt eine Stelle (z. B. eine Rille)? Tippe auf die Form an dieser Höhe. Stellen lassen sich auch umbenennen oder ausblenden.</li>
        <li>Vor dem Töpfern: Werkstück öffnen → „Groß anzeigen“. Der Bildschirm bleibt dabei an.</li>
      </ol>
    </div>

    <div class="card">
      <h2>So funktioniert der Glasurvergleich</h2>
      <ol class="small" style="padding-left:20px;margin:0">
        <li>Glasur ansetzen und unter <strong>Glasuren</strong> mit Litergewicht anlegen.</li>
        <li>Schrühware glasieren, unter <strong>Glasieren</strong> ein Protokoll anlegen: Foto, Tauchdauer, Wiederholungen und Auffälligkeiten (z. B. Tropfnasen, Griffstellen).</li>
        <li>Nach dem Glasurbrand das Protokoll öffnen → „Ergebnis nach Brand eintragen“ → Foto aus gleichem Winkel.</li>
        <li>Mit dem <strong>Schieberegler</strong> siehst du, was aus jeder Auffälligkeit geworden ist. Bei der Glasur findest du alle Versuche sortiert nach Tauchdauer.</li>
      </ol>
    </div>
    <p class="small muted" style="text-align:center">Töpferbuch · Version 1.1</p>`;

  $app.querySelector('#export').onclick = () => exportBackup({ pieces, glazes, firings, photos });
  const fileIn = $app.querySelector('#import-file');
  $app.querySelector('#import').onclick = () => fileIn.click();
  fileIn.onchange = () => fileIn.files[0] && importBackup(fileIn.files[0]);
}

async function exportBackup({ pieces, glazes, firings, photos }) {
  toast('Sicherung wird erstellt …');
  const data = {
    app: 'toepferbuch',
    version: 1,
    exportedAt: new Date().toISOString(),
    pieces, glazes, firings,
    photos: await Promise.all(photos.map(async p => ({
      id: p.id, createdAt: p.createdAt,
      blob: await blobToDataUrl(p.blob),
      thumb: p.thumb ? await blobToDataUrl(p.thumb) : null,
    }))),
  };
  const file = new File([JSON.stringify(data)], `toepferbuch-sicherung-${today()}.json`, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Töpferbuch-Sicherung' }); return; } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Die Datei ist keine gültige Sicherung.'); return; }
  if (data.app !== 'toepferbuch') { toast('Die Datei ist keine Töpferbuch-Sicherung.'); return; }
  if (!confirm(`Sicherung vom ${new Date(data.exportedAt).toLocaleString('de-DE')} laden?\n\n${(data.pieces || []).length} Werkstücke, ${(data.firings || []).length} Protokolle, ${(data.glazes || []).length} Glasuren.\n\nVorhandene Einträge bleiben erhalten; gleiche Einträge werden durch die Sicherung ersetzt.`)) return;
  toast('Sicherung wird geladen …');
  for (const p of data.photos || []) {
    forgetPhoto(p.id);
    await db.put('photos', { id: p.id, createdAt: p.createdAt, blob: await dataUrlToBlob(p.blob), thumb: p.thumb ? await dataUrlToBlob(p.thumb) : null });
  }
  for (const s of ['pieces', 'glazes', 'firings']) for (const x of data[s] || []) await db.put(s, x);
  toast('Sicherung geladen');
  router();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function notFound() {
  setHeader({ title: 'Nicht gefunden', back: '#/werkstuecke' });
  $app.innerHTML = '<div class="empty"><p>Dieser Eintrag existiert nicht (mehr).</p></div>';
}

const ROUTES = [
  [/^\/werkstuecke$/, viewPieces, 'werkstuecke'],
  [/^\/werkstueck\/neu$/, (m, q) => viewPieceForm(null, q), 'werkstuecke'],
  [/^\/werkstueck\/([\w-]+)$/, m => viewPiece(m[1]), 'werkstuecke'],
  [/^\/werkstueck\/([\w-]+)\/bearbeiten$/, (m, q) => viewPieceForm(m[1], q), 'werkstuecke'],
  [/^\/werkstueck\/([\w-]+)\/blaupause$/, m => viewBlueprint(m[1]), 'werkstuecke'],
  [/^\/werkstueck\/([\w-]+)\/umriss$/, m => viewBlueprintEditor(m[1]), 'werkstuecke'],
  [/^\/glasieren$/, viewFirings, 'glasieren'],
  [/^\/glasieren\/neu$/, (m, q) => viewFiringForm(null, q), 'glasieren'],
  [/^\/glasieren\/([\w-]+)$/, m => viewFiring(m[1]), 'glasieren'],
  [/^\/glasieren\/([\w-]+)\/bearbeiten$/, (m, q) => viewFiringForm(m[1], q), 'glasieren'],
  [/^\/glasuren$/, viewGlazes, 'glasuren'],
  [/^\/glasuren\/neu$/, () => viewGlazeForm(null), 'glasuren'],
  [/^\/glasuren\/([\w-]+)$/, m => viewGlaze(m[1]), 'glasuren'],
  [/^\/glasuren\/([\w-]+)\/bearbeiten$/, m => viewGlazeForm(m[1]), 'glasuren'],
  [/^\/mehr$/, viewMore, 'mehr'],
];

let routeToken = 0;

async function router() {
  const token = ++routeToken;
  if (typeof history.state?.idx === 'number') historyIdx = history.state.idx;
  else history.replaceState({ idx: ++historyIdx }, '', location.href);
  if (pendingCleanup) { const c = pendingCleanup; pendingCleanup = null; await c(); }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  const [path, query = ''] = (location.hash.slice(1) || '/werkstuecke').split('?');
  const params = new URLSearchParams(query);
  for (const [re, view, tab] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    $app.innerHTML = '';
    try {
      await view(m, params);
    } catch (err) {
      console.error(err);
      if (token === routeToken) $app.innerHTML = `<div class="empty"><p>Da ist etwas schiefgelaufen:</p><p class="small">${esc(err.message)}</p></div>`;
    }
    if (token === routeToken) window.scrollTo(0, 0);
    return;
  }
  go('#/werkstuecke', true);
}

window.addEventListener('hashchange', router);
router();

// Browser bitten, die Daten nicht automatisch zu löschen
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
}
