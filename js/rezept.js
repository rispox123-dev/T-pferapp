// Glasurrezept aus dem Text eines Fotos herauslesen. Ohne DOM, damit es auch in Node getestet
// werden kann (tools/test/rezept-test.mjs).
//
// zeilenBilden: Die Texterkennung liest Tabellen spaltenweise (erst alle Rohstoffe, dann alle
// Zahlen) – hier werden die Zeilen wieder zusammengesetzt, auch bei schräg gehaltenem Handy.
// rezeptAuswerten: ordnet die Zeilen Name, Beschreibung, Brennbereich, Litergewicht, Rezept und
// Notizen zu. Alles, wobei die App nicht sicher ist, bekommt einen Grund und wird im Prüf-Zettel
// nachgefragt: schlecht lesbar, korrigierte Schreibweise, fehlende Menge, Summe ≠ 100,
// ungewöhnlich viel Färbeoxid …

// ---------------------------------------------------------------------------
// Bekannte Rohstoffe (Schreibweisen, wie sie in Rezepten stehen)
// ---------------------------------------------------------------------------

export const ROHSTOFFE = [
  // Feldspäte und Flussmittel
  'Kalifeldspat', 'Natronfeldspat', 'Feldspat', 'Kalinatronfeldspat', 'Nephelin-Syenit', 'Nephelinsyenit',
  'Lithiumfeldspat', 'Petalit', 'Spodumen', 'Lepidolith', 'Kornischer Stein', 'Cornish Stone',
  'Kreide', 'Calciumcarbonat', 'Kalziumkarbonat', 'Kalkspat', 'Wollastonit', 'Dolomit', 'Talkum', 'Talk',
  'Magnesit', 'Magnesiumcarbonat', 'Magnesiumoxid', 'Zinkoxid', 'Bariumcarbonat', 'Bariumkarbonat',
  'Strontiumcarbonat', 'Strontiumkarbonat', 'Lithiumcarbonat', 'Lithiumkarbonat', 'Knochenasche',
  'Holzasche', 'Asche', 'Borax', 'Colemanit', 'Gerstley Borate', 'Borfritte', 'Fritte', 'Bleifritte',
  'Alkalifritte', 'Calciumborat', 'Pottasche', 'Soda', 'Natriumcarbonat', 'Kaliumcarbonat',
  // Kieselsäure und Tonerde
  'Quarz', 'Quarzmehl', 'Quarzsand', 'Kieselsäure', 'Flint', 'Silica', 'Kaolin', 'China Clay', 'EPK',
  'Grolleg', 'Ton', 'Ball Clay', 'Bentonit', 'Tonerde', 'Tonerdehydrat', 'Aluminiumoxid', 'Aluminiumhydroxid',
  'Kalzinierter Kaolin', 'Lehm', 'Rotton', 'Schiefer', 'Basalt', 'Basaltmehl', 'Granitmehl', 'Bimsmehl',
  // Trübungs- und Färbemittel
  'Zinnoxid', 'Zirkon', 'Zirkonsilikat', 'Zirkonoxid', 'Zircopax', 'Superpax', 'Titandioxid', 'Titanoxid',
  'Rutil', 'Ilmenit', 'Eisenoxid', 'Eisenoxid rot', 'Eisenoxid schwarz', 'Eisen(III)-oxid', 'Rotes Eisenoxid',
  'Schwarzes Eisenoxid', 'Magnetit', 'Ocker', 'Kobaltoxid', 'Kobaltcarbonat', 'Kobaltkarbonat',
  'Kupferoxid', 'Kupfercarbonat', 'Kupferkarbonat', 'Manganoxid', 'Mangandioxid', 'Mangancarbonat',
  'Braunstein', 'Chromoxid', 'Nickeloxid', 'Vanadiumpentoxid', 'Farbkörper', 'Glasurfarbkörper',
  'Siliziumcarbid', 'Siliciumcarbid',
  // englisch
  'Custer Feldspar', 'Potash Feldspar', 'Soda Feldspar', 'G-200 Feldspar', 'Minspar', 'Nepheline Syenite',
  'Neph Sy', 'Whiting', 'Wollastonite', 'Dolomite', 'Talc', 'Zinc Oxide', 'Barium Carbonate',
  'Strontium Carbonate', 'Lithium Carbonate', 'Bone Ash', 'Wood Ash', 'Frit', 'Ferro Frit', 'Kaolin',
  'Tin Oxide', 'Zircopax', 'Titanium Dioxide', 'Rutile', 'Red Iron Oxide', 'Black Iron Oxide', 'Iron Oxide',
  'Yellow Iron Oxide', 'Cobalt Carbonate', 'Cobalt Oxide', 'Copper Carbonate', 'Copper Oxide',
  'Manganese Dioxide', 'Manganese Carbonate', 'Chrome Oxide', 'Chromium Oxide', 'Nickel Oxide',
  'Magnesium Carbonate', 'Bentonite', 'Silicon Carbide', 'Mason Stain', 'Stain',
];

// Färbende Oxide: mehr als die Grenze (in %) ist in einem Rezept sehr ungewöhnlich – meist
// fehlt das Komma („15“ statt „1,5“)
const FAERBEND = [
  [/kobalt|cobalt/i, 6],
  [/chrom/i, 6],
  [/nickel/i, 6],
  [/vanad/i, 10],
  [/kupfer|copper/i, 10],
  [/mangan|braunstein/i, 15],
  [/eisen|iron|magnetit|ocker|ilmenit/i, 12],
  [/rutil|titan/i, 15],
  [/zinn|tin\b/i, 15],
  [/carbid|carbide/i, 5],
];

// Abschnitte im Rezept
const ZUSATZ_KOPF = /^(zus(ä|ae|a)tze?|zus(ä|a)tzlich|darauf|dazu|färb(ung|ende\s+oxide|emittel)|farb(körper|zus(ä|a)tze?)|oxide|additions?|add(ed)?|colou?rants?|plus)\b/i;
const BASIS_KOPF = /^(basis|grundglasur|grundrezept|base|rezept(ur)?|glasurrezept|recipe|versatz|zusammensetzung|rohstoffe|zutaten|ingredients?|mischung|rohstoff|menge|anteil|teile|amount|material)\b/i;
const SUMME_ZEILE = /^(summe|gesamt|insgesamt|zusammen|total|sum)\b/i;
const NAME_LABEL = /^(name|glasur(name)?|bezeichnung|titel|title|glaze)\s*[:\-–]\s*(.+)$/i;
const BESCHREIBUNG_LABEL = /^(beschreibung|oberfl(ä|ae)che|charakter|aussehen|farbe|description|surface)\s*[:\-–]\s*(.+)$/i;
const BESCHREIBUNG_WORT = /\b(gl(ä|a)nzend|seidenmatt|halbmatt|matt|samtmatt|transparent|opak|deckend|halbdeckend|durchscheinend|craquel(é|e)|krakel(ee|é)|seladon|celadon|tenmoku|temmoku|shino|chun|ochsenblut|kristall|lasur|glossy|gloss|satin|matte|semi-?matte?|clear|opaque|translucent|crackle|weiß|weiss|schwarz|blau|grün|gruen|rot|gelb|braun|türkis|tuerkis|grau|beige|creme|honig|white|black|blue|green|red|yellow|brown|turquoise|grey|gray)\b/i;

// Einheiten hinter einer Zahl, die keine Rezeptmenge ist
const KEINE_MENGE = /^(h|std\.?|stunden?|min\.?|minuten?|sek\.?|s|sec|°c?|grad|mm|cm|m|x|mal|mesh|er|tage?|days?|hours?|l|ml|liter|kg\/l|g\/l)$/i;

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const norm = s => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[ckq]/g, 'k').replace(/[^a-z0-9]/g, '');

function abstand(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let vor = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const akt = [i];
    for (let j = 1; j <= n; j++) {
      akt[j] = Math.min(vor[j] + 1, akt[j - 1] + 1, vor[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    vor = akt;
  }
  return vor[n];
}

const ROH_NORM = [...new Set(ROHSTOFFE)].map(r => ({ r, n: norm(r) }));
const erlaubt = len => (len <= 4 ? 0 : len <= 6 ? 1 : len <= 12 ? 2 : 3);

// Rohstoffname im Wörterbuch suchen.
//   { art: 'genau' } – bekannt; { art: 'korrigiert', wert } – sehr wahrscheinlich ein bekannter
//   Rohstoff mit Lesefehlern; null – unbekannt
export function rohstoffSuchen(name) {
  const woerter = name.trim().split(/\s+/);
  // ganze Bezeichnung, dann die ersten Wörter („Kaolin (Zettlitz)“, „Fritte 90420“, „Eisenoxid rot“)
  for (let k = woerter.length; k >= 1; k--) {
    const teil = norm(woerter.slice(0, k).join(' '));
    if (teil.length < 3) continue;
    if (ROH_NORM.some(x => x.n === teil)) return { art: 'genau' };
  }
  let best = null;
  for (let k = woerter.length; k >= 1; k--) {
    const kopf = woerter.slice(0, k).join(' ');
    const teil = norm(kopf);
    if (teil.length < 4) continue;
    const rest = woerter.slice(k).join(' ');
    for (const x of ROH_NORM) {
      const d = abstand(teil, x.n);
      if (d > erlaubt(Math.max(teil.length, x.n.length))) continue;
      if (!best || d < best.d || (d === best.d && k > best.k)) best = { d, k, wert: [x.r, rest].filter(Boolean).join(' '), zweiter: best?.d ?? Infinity };
      else if (d === best.d && k === best.k && norm(best.wert) !== norm([x.r, rest].join(' '))) best.zweideutig = true;
    }
    if (best) break; // längster passender Anfang gewinnt
  }
  if (!best || best.zweideutig) return null;
  return { art: 'korrigiert', wert: best.wert };
}

// Zahl aus einem Wort der Texterkennung; typische Verwechslungen (O → 0, l → 1, S → 5)
// werden korrigiert und gemeldet. null: keine Zahl.
export function zahlLesen(wort) {
  let t = String(wort).trim().replace(/^(ca\.?|~|≈|\(|\+)+/i, '').replace(/[),;:]+$|(?<=\d)\.$/g, '');
  const prozent = /%$/.test(t);
  t = t.replace(/%$/, '').replace(/(gr?|gramm|t|teile)$/i, '');
  if (!t || !/[0-9]/.test(t) && !(prozent && /^[OoIlS|]{1,3}$/.test(t))) return null;
  const roh = t;
  t = t.replace(/[Oo]/g, '0').replace(/[Il|!]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  const korrigiert = t !== roh;
  let zahl;
  if (/^\d{1,3}(\.\d{3})+$/.test(t) && /g/i.test(wort)) zahl = Number(t.replace(/\./g, '')); // 1.250 g
  else if (/^\d+([.,]\d+)?$/.test(t)) zahl = Number(t.replace(',', '.'));
  else if (/^[.,]\d+$/.test(t)) zahl = Number('0' + t.replace(',', '.'));
  else if (/^\d+[-'`´]\d+$/.test(t)) return { zahl: Number(t.replace(/[-'`´]/, '.')), korrigiert: true, roh: String(wort) }; // „1-5“: Komma?
  else return null;
  return Number.isFinite(zahl) ? { zahl, korrigiert, roh: String(wort) } : null;
}

const istEinheit = w => /^(%|g|gr|gramm|teile|t|pt|parts?|gew\.?-?%)$/i.test(w);
const aufzaehlung = /^(\d{1,2}[.)]|[a-z][.)]|[•·*\-–—+]|\(\d{1,2}\))$/i;
const fuehrer = /^[.·…_\-–—=:]+$/;
const buchstaben = s => (String(s).match(/\p{L}/gu) || []).length;
const runden = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const komma = v => String(v).replace('.', ',');

// ---------------------------------------------------------------------------
// Zeilen aus dem Ergebnis der Texterkennung bilden
// ---------------------------------------------------------------------------

// blocks: Ergebnis von Tesseract (blocks → paragraphs → lines → words). Liefert Zeilen
// { text, woerter: [{ text, conf, bbox }], conf, hoehe, bbox } von oben nach unten.
export function zeilenBilden(blocks) {
  const linien = (blocks || []).flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || []))
    .map(l => ({
      woerter: (l.words || []).filter(w => w.text?.trim()).map(w => ({ text: w.text.trim(), conf: w.confidence, bbox: w.bbox })),
      bbox: l.bbox,
      baseline: l.baseline,
      hoehe: l.rowAttributes?.row_height || (l.bbox.y1 - l.bbox.y0),
    }))
    .filter(l => l.woerter.length);
  if (!linien.length) return [];

  // Schräglage aus den Grundlinien (gewichtet nach Länge)
  const winkel = [];
  for (const l of linien) {
    const b = l.baseline;
    const lang = b ? b.x1 - b.x0 : 0;
    if (b && lang > 2 * l.hoehe) winkel.push([Math.atan2(b.y1 - b.y0, lang), lang]);
  }
  winkel.sort((a, b) => a[0] - b[0]);
  let a = 0;
  if (winkel.length) {
    const ges = winkel.reduce((s, w) => s + w[1], 0);
    let s = 0;
    for (const w of winkel) { s += w[1]; if (s >= ges / 2) { a = w[0]; break; } }
  }
  const cos = Math.cos(a), sin = Math.sin(a);
  for (const l of linien) {
    const cx = (l.bbox.x0 + l.bbox.x1) / 2, cy = (l.bbox.y0 + l.bbox.y1) / 2;
    l.y = -sin * cx + cos * cy;
    l.x0 = cos * l.bbox.x0 + sin * cy;
    l.x1 = cos * l.bbox.x1 + sin * cy;
  }

  // Linien gleicher Höhe, die sich nicht überdecken, gehören zu einer Zeile
  linien.sort((p, q) => p.y - q.y);
  const zeilen = [];
  for (const l of linien) {
    const z = zeilen.find(z => Math.abs(z.y - l.y) < 0.55 * Math.max(z.hoehe, l.hoehe)
      && z.teile.every(t => l.x1 < t.x0 || l.x0 > t.x1));
    if (z) { z.teile.push(l); z.hoehe = Math.max(z.hoehe, l.hoehe); }
    else zeilen.push({ y: l.y, hoehe: l.hoehe, teile: [l] });
  }
  return zeilen.sort((p, q) => p.y - q.y).map(z => {
    z.teile.sort((p, q) => p.x0 - q.x0);
    const woerter = z.teile.flatMap(t => t.woerter);
    const bbox = {
      x0: Math.min(...z.teile.map(t => t.bbox.x0)), y0: Math.min(...z.teile.map(t => t.bbox.y0)),
      x1: Math.max(...z.teile.map(t => t.bbox.x1)), y1: Math.max(...z.teile.map(t => t.bbox.y1)),
    };
    const gewicht = woerter.reduce((s, w) => s + w.text.length, 0) || 1;
    return {
      text: woerter.map(w => w.text).join(' '),
      woerter,
      conf: woerter.reduce((s, w) => s + w.conf * w.text.length, 0) / gewicht,
      hoehe: Math.min(...z.teile.map(t => t.hoehe)),
      bbox,
    };
  });
}

// ---------------------------------------------------------------------------
// Einzelne Zeilen deuten
// ---------------------------------------------------------------------------

const minConf = ws => (ws.length ? Math.min(...ws.map(w => w.conf ?? 100)) : 100);

// Rohstoffzeile: Name und Menge (Menge hinten oder vorn), Zusatz mit „+“
function rohstoffZeile(zeile) {
  let ws = zeile.woerter.map(w => ({ ...w, text: w.text.replace(/^[.·…_]{2,}|[.·…_]{2,}$/g, ''), orig: w.orig || w }))
    .filter(w => w.text && !fuehrer.test(w.text));
  let zusatz = false;
  if (ws[0] && /^\+/.test(ws[0].text)) {
    zusatz = true;
    ws[0] = { ...ws[0], text: ws[0].text.slice(1) };
    if (!ws[0].text) ws = ws.slice(1);
  }
  if (ws[0] && aufzaehlung.test(ws[0].text) && ws.length > 2) ws = ws.slice(1);
  if (ws.length < 1) return null;

  let menge = null, mengenWoerter = [], nameWoerter = ws, prozent = false, einheit = '';
  // hinten: „Kalifeldspat 25 %“, „Quarz 30%“, „Kaolin 15 g“
  let i = ws.length - 1;
  if (i > 0 && istEinheit(ws[i].text)) { einheit = ws[i].text; i--; }
  let hinten = i > 0 ? zahlLesen(ws[i].text) : null;
  // „20 Ferro Frit 3134“: die Zahl hinten ist eine Nummer, die Menge steht vorn
  const nummer = hinten && !einheit && !/[%.,]/.test(ws[i].text)
    && (/^(frit+e?|ferro|nr\.?|no\.?|stain|farbk(ö|oe)rper|mason|typ|type)$/i.test(ws[i - 1].text) || hinten.zahl >= 1000)
    && zahlLesen(ws[0].text) && i > 1;
  if (nummer) hinten = null;
  if (hinten) {
    menge = hinten;
    mengenWoerter = ws.slice(i);
    nameWoerter = ws.slice(0, i);
  } else {
    // vorn: „25 Kalifeldspat“, „25 % Quarz“, „2 g Eisenoxid“
    const vorn = ws.length > 1 ? zahlLesen(ws[0].text) : null;
    let j = 1;
    if (vorn && ws[1] && istEinheit(ws[1].text)) { einheit = ws[1].text; j = 2; }
    if (vorn && ws[j] && !KEINE_MENGE.test(ws[j].text.replace(/[.,:;]$/, ''))) {
      menge = vorn;
      mengenWoerter = ws.slice(0, j);
      nameWoerter = ws.slice(j);
    }
  }
  if (menge) prozent = /%/.test(mengenWoerter.map(w => w.text).join('') + einheit);
  if (menge && /^(g|gr|gramm)$/i.test(einheit)) einheit = 'g';
  let name = nameWoerter.map(w => w.text).join(' ').replace(/^[:\-–—•·*]+\s*|\s*[:\-–—=.]+$/g, '').trim();
  if (/^\+\s*/.test(name)) { zusatz = true; name = name.replace(/^\+\s*/, ''); }
  if (buchstaben(name) < 2) return null;
  return {
    name, zusatz, menge, prozent, einheit,
    mengeWort: menge ? mengenWoerter.find(w => zahlLesen(w.text))?.orig : null, // Wort der Texterkennung
    nameConf: minConf(nameWoerter),
    mengeConf: minConf(mengenWoerter),
    woerter: nameWoerter.length,
  };
}

// Brennbereich: Temperatur(bereich), Kegel, Atmosphäre
function brennbereichLesen(text) {
  const t = text.replace(/[–—]/g, '-');
  const teile = [];
  let temp = false, grenzwertig = false;
  const kegel = t.match(/\b(kegel|cone|segerkegel|sk|orton|\^|Δ)\s*(?:nr\.?\s*)?(0?\d{1,2}[a-z]?)\b/i);
  if (kegel) {
    const art = /^(sk|segerkegel)$/i.test(kegel[1]) ? 'SK' : /^cone|orton|\^|Δ$/i.test(kegel[1]) ? 'Cone' : 'Kegel';
    teile.push(`${art} ${kegel[2]}`);
  }
  const bereich = t.match(/(\d{3,4})\s*(?:°\s*c?|grad)?\s*(?:-|bis|to)\s*(\d{3,4})\s*(?:°\s*c?|grad\b|c\b)/i);
  const einzeln = t.match(/(\d{3,4})\s*(?:°\s*c?|grad\b|(?<=\d\s?)c\b)/i);
  if (bereich) {
    teile.push(`${bereich[1]}–${bereich[2]} °C`);
    temp = true;
    grenzwertig = [bereich[1], bereich[2]].some(v => v < 600 || v > 1400);
  } else if (einzeln) {
    teile.push(`${einzeln[1]} °C`);
    temp = true;
    grenzwertig = einzeln[1] < 600 || einzeln[1] > 1400;
  }
  const atmo = t.match(/\b(oxid(ation|ierend)|redu(ktion|ziert|zierend)|reduction|oxidation|neutral)\b/i);
  if (atmo && (temp || kegel || /brand|brenn|firing|atmos/i.test(t))) {
    teile.push(/redu/i.test(atmo[1]) ? 'reduzierend' : /neutral/i.test(atmo[1]) ? 'neutral' : 'oxidierend');
  }
  if (!temp && !kegel) return null;
  return { wert: teile.join(', '), grenzwertig };
}

const BRENN_LABEL = /^(brand|glasurbrand|brenntemperatur|brennbereich|brenntemp\.?|temperatur|temp\.?|brennen|firing|fire|atmosph(ä|ae)re)\b\s*:?\s*/i;
const LITER_LABEL = /(?:liter\s*-?\s*gewicht|litergew\.?|spez(?:\.|ifisches)?\s*gew(?:\.|icht)?|dichte|specific\s+gravity|\bs\.?\s?g\.?)\s*[:=]?\s*(?:ca\.?|~|≈)?\s*(?<zahl>[0-9OoIl][0-9OoIl.,]*)/i;

// Wassermenge: in Prozent vom Trockengewicht („Wasser 80 %“, „Wassermenge: 75-85 %“, „water 90%“);
// in ml oder g wird sie später auf das Rezept umgerechnet
const WASSER = /\b(wasser(menge|zugabe|anteil)?|water)\b\s*[:=]?\s*(?:ca\.?|~|≈)?\s*(?<a>[0-9OoIl][0-9OoIl.,]*)(?:\s*(?:-|–|bis|to)\s*(?<b>\d[\d.,]*))?\s*(?<e>%|ml|g\b|l\b)?/i;
function wasserLesen(zeile) {
  const m = zeile.text.match(WASSER);
  if (!m) return null;
  const a = zahlLesen(m.groups.a), b = m.groups.b ? zahlLesen(m.groups.b) : null;
  if (!a) return { wert: null };
  const wort = zeile.woerter.find(w => w.text.includes(m.groups.a) || m.groups.a.includes(w.text));
  return {
    wert: b ? runden((a.zahl + b.zahl) / 2, 0) : a.zahl,
    bereich: b ? `${komma(a.zahl)}–${komma(b.zahl)}` : '',
    einheit: (m.groups.e || '%').toLowerCase(),
    korrigiert: a.korrigiert,
    conf: wort?.conf ?? zeile.conf,
  };
}

function litergewichtLesen(zeile) {
  const t = zeile.text;
  let m = t.match(LITER_LABEL);
  let roh = m?.groups.zahl;
  if (!m) {
    m = t.match(/\b(\d{4})\s*g\s*\/\s*l\b/i);
    roh = m?.[1];
  }
  if (!m) return null;
  const z = zahlLesen(roh);
  if (!z) return { wert: null, grenzwertig: true };
  let wert = z.zahl < 5 ? z.zahl * 1000 : z.zahl; // 1,45 g/cm³ → 1450 g/l
  wert = Math.round(wert);
  const wort = zeile.woerter.find(w => w.text.includes(roh) || roh.includes(w.text));
  return { wert, korrigiert: z.korrigiert, conf: wort?.conf ?? zeile.conf, grenzwertig: wert < 1000 || wert > 2500 };
}

// ---------------------------------------------------------------------------
// Ganzes Rezept auswerten
// ---------------------------------------------------------------------------

const UNSICHER_TEXT = 75;   // Zeilen/Namen mit weniger Vertrauen nachfragen
const UNSICHER_ZAHL = 70;   // Zahlen ohne Bestätigung durch die Summe
const UNSICHER_SUMME = 90;  // Zahlen, wenn die Summe nicht aufgeht

// zeilen: aus zeilenBilden. Liefert
//   { name, beschreibung, brennbereich, litergewicht: { wert, sicher, grund, zeilen }, rezept: [
//     { rohstoff, anteil, zusatz, sicher, grund, gelesen, zeile }], notizen: [{ text, sicher, grund, zeile }],
//     summe: { basis, zusatz, prozent, sicher, grund } }
// zeile/zeilen verweisen auf die Zeilen (für den Bildausschnitt im Prüf-Zettel).
export function rezeptAuswerten(zeilen) {
  const erg = {
    name: { wert: '', sicher: true, zeilen: [], kandidaten: [] },
    beschreibung: { wert: '', sicher: true, zeilen: [] },
    brennbereich: { wert: '', sicher: true, zeilen: [] },
    litergewicht: { wert: null, sicher: true, zeilen: [] },
    wasser: { wert: null, sicher: true, zeilen: [] },
    rezept: [],
    notizen: [],
    summe: null,
  };
  const art = zeilen.map(() => null); // Zuordnung jeder Zeile
  const roh = zeilen.map(z => rohstoffZeile(z));

  // 1. eindeutige Zeilen: Name/Beschreibung mit Bezeichnung, Litergewicht, Brennbereich, Abschnitte
  zeilen.forEach((z, i) => {
    const text = z.text.trim();
    if (buchstaben(text) + (text.match(/\d/g) || []).length < 2) { art[i] = 'leer'; return; }
    if (SUMME_ZEILE.test(text)) { art[i] = 'kopf'; return; }
    let m = text.match(NAME_LABEL);
    if (m && !roh[i]?.menge) {
      art[i] = 'name';
      Object.assign(erg.name, { wert: m[3].trim(), sicher: z.conf >= UNSICHER_TEXT, zeilen: [i] });
      if (!erg.name.sicher) erg.name.grund = 'schlecht lesbar';
      return;
    }
    m = text.match(BESCHREIBUNG_LABEL);
    if (m) { art[i] = 'beschreibung'; return; }
    const lg = litergewichtLesen(z);
    if (lg) {
      art[i] = 'litergewicht';
      const grund = lg.wert == null ? 'Zahl nicht lesbar' : lg.grenzwertig ? 'ungewöhnlicher Wert' : lg.korrigiert ? `Zahl war unklar („${z.text}“)` : lg.conf < UNSICHER_ZAHL ? 'schlecht lesbar' : '';
      Object.assign(erg.litergewicht, { wert: lg.wert, sicher: !grund, grund, zeilen: [i] });
      return;
    }
    const wa = wasserLesen(z);
    if (wa) {
      art[i] = 'wasser';
      Object.assign(erg.wasser, { wert: wa.wert, einheit: wa.einheit, zeilen: [i] });
      erg.wasser.grund = wa.wert == null ? 'Zahl nicht lesbar'
        : wa.bereich ? `als Bereich angegeben (${wa.bereich} %) – Mitte genommen`
        : wa.korrigiert ? `Zahl war unklar („${z.text}“)`
        : wa.conf < UNSICHER_ZAHL ? 'schlecht lesbar'
        : wa.einheit === '%' && (wa.wert < 20 || wa.wert > 200) ? 'ungewöhnlicher Wert' : '';
      erg.wasser.sicher = !erg.wasser.grund;
      return;
    }
    const bb = brennbereichLesen(text);
    const rest = bb && text.replace(BRENN_LABEL, '').replace(/[\d.,]+|°\s*c?|grad|kegel|cone|sk|segerkegel|orton|bis|to|oxid\w*|redu\w*|neutral|[-–—/:^Δ()]/gi, ' ').trim();
    if (bb) {
      const nurBrand = !rest || rest.split(/\s+/).filter(w => buchstaben(w) > 1).length <= 1;
      art[i] = nurBrand ? 'brennbereich' : 'notiz-brand';
      if (!erg.brennbereich.wert) {
        const grund = bb.grenzwertig ? 'ungewöhnliche Temperatur' : z.conf < UNSICHER_TEXT || minConf(z.woerter.filter(w => /\d/.test(w.text))) < UNSICHER_ZAHL ? 'schlecht lesbar' : nurBrand ? '' : 'aus einem Satz gelesen';
        Object.assign(erg.brennbereich, { wert: bb.wert, sicher: !grund, grund, zeilen: [i] });
      }
      return;
    }
    if (ZUSATZ_KOPF.test(text)) {
      const nach = text.replace(ZUSATZ_KOPF, '').replace(/^\s*[:\-–]?\s*/, '');
      art[i] = buchstaben(nach) >= 2 && roh[i] ? 'zusatz-kopf+' : 'zusatz-kopf';
      if (art[i] === 'zusatz-kopf+') {
        const k = z.woerter.slice(0, 3).findIndex(w => /:$/.test(w.text));
        const ws = z.woerter.slice(k + 1 || 1).filter(w => !/^[:\-–]$/.test(w.text));
        roh[i] = rohstoffZeile({ ...z, woerter: ws });
      }
      return;
    }
    if (BASIS_KOPF.test(text) && !roh[i]?.menge && text.split(/\s+/).length <= 4) art[i] = 'kopf';
  });

  // 2. Rohstoffe: sichere (bekannter Name + Menge) und alle Zeilen mit Menge dazwischen
  const treffer = roh.map((r, i) => (r && (!art[i] || art[i] === 'zusatz-kopf+') ? rohstoffSuchen(r.name) : null));
  const kurz = r => r.woerter <= 4 && !/[.!?]$/.test(r.name);
  const stark = roh.map((r, i) => !!(r && (!art[i] || art[i] === 'zusatz-kopf+') && (
    (treffer[i] && r.menge) || (treffer[i]?.art === 'genau' && r.woerter <= 2 && kurz(r)) || (r.menge && (r.prozent || r.einheit) && kurz(r)))));
  const starkeIdx = stark.flatMap((s, i) => (s ? [i] : []));
  const von = starkeIdx.length ? starkeIdx[0] : -1, bis = starkeIdx.length ? starkeIdx.at(-1) : -1;
  let zusatzModus = false;
  zeilen.forEach((z, i) => {
    if (art[i] === 'zusatz-kopf') { zusatzModus = true; return; }
    if (art[i] === 'zusatz-kopf+') zusatzModus = true;
    const r = roh[i];
    if (!r || (art[i] && art[i] !== 'zusatz-kopf+')) return;
    const imBlock = i >= von - 1 && i <= bis + 1 && von >= 0;
    if (!(stark[i] || (imBlock && r.menge && kurz(r)))) return;
    art[i] = 'rohstoff';
    const t = treffer[i];
    const posten = {
      rohstoff: t?.art === 'korrigiert' ? t.wert : r.name,
      anteil: r.menge ? runden(r.menge.zahl, 3) : null,
      zusatz: r.zusatz || zusatzModus,
      gelesen: z.text,
      zeile: i,
      nameGrund: '',
      mengeGrund: '',
      _r: r,
    };
    // das Wort mit der Menge (für die Gegenprobe in rezept-foto.js; nicht aufzählbar)
    Object.defineProperty(posten, 'wort', { value: r.mengeWort });
    // Gegenprobe: die Zahl wurde ein zweites Mal nur mit Ziffern gelesen (zweit, siehe rezept-foto.js)
    const zweit = r.mengeWort?.zweit != null ? zahlLesen(r.mengeWort.zweit) : null;
    if (zweit && r.menge && zweit.zahl !== r.menge.zahl) {
      // meist geht das Komma verloren („1,5“ → „15“) – die Lesung mit Komma zuerst
      const mitKomma = x => /[.,]/.test(x);
      let [haupt, alt] = [r.menge.zahl, zweit.zahl];
      if (!mitKomma(r.menge.roh) && mitKomma(r.mengeWort.zweit)) [haupt, alt] = [alt, haupt];
      posten.anteil = runden(haupt, 3);
      posten.alternativ = runden(alt, 3);
    } else if (zweit && r.menge) posten.bestaetigt = true;
    if (t?.art === 'korrigiert') posten.nameGrund = `gelesen: „${r.name}“`;
    else if (!t && (r.nameConf < UNSICHER_TEXT || buchstaben(r.name) < 0.6 * r.name.replace(/\s/g, '').length)) posten.nameGrund = 'unbekannter Rohstoff, schlecht lesbar';
    if (!r.menge) posten.mengeGrund = 'Menge fehlt';
    else if (posten.alternativ != null) posten.mengeGrund = `Zahl unklar: ${komma(posten.anteil)} oder ${komma(posten.alternativ)}?`;
    else if (r.menge.korrigiert && !posten.bestaetigt) posten.mengeGrund = `Zahl war unklar („${r.menge.roh}“)`;
    erg.rezept.push(posten);
  });

  // 3. Mengen prüfen: geht die Summe auf, sind die Zahlen bestätigt
  const basis = erg.rezept.filter(p => !p.zusatz && p.anteil != null);
  const zus = erg.rezept.filter(p => p.zusatz && p.anteil != null);
  const sB = runden(basis.reduce((s, p) => s + p.anteil, 0));
  const sZ = runden(zus.reduce((s, p) => s + p.anteil, 0));
  const gramm = erg.rezept.some(p => p._r.einheit === 'g');
  const prozent = !gramm && (erg.rezept.some(p => p._r.prozent) || (sB >= 85 && sB <= 115));
  let aufgegangen = prozent && Math.abs(sB - 100) <= 0.6;
  // Geht die Summe mit der anderen Lesung einer unklaren Zahl auf, ist die wohl richtig
  if (prozent && !aufgegangen) {
    const passend = basis.filter(p => p.alternativ != null && Math.abs(sB - p.anteil + p.alternativ - 100) <= 0.6);
    if (passend.length === 1) {
      const p = passend[0];
      [p.anteil, p.alternativ] = [p.alternativ, p.anteil];
      p.mengeGrund = `Zahl unklar: ${komma(p.anteil)} oder ${komma(p.alternativ)}? Mit ${komma(p.anteil)} ergibt die Summe 100.`;
      aufgegangen = true;
    }
  }
  const sBasis = runden(basis.reduce((s, p) => s + p.anteil, 0));
  for (const p of erg.rezept) {
    if (p.anteil == null || p.mengeGrund) continue;
    const c = p.bestaetigt ? 100 : p._r.mengeConf;
    if (aufgegangen ? c < 40 : prozent ? c < UNSICHER_SUMME && !p.zusatz : c < UNSICHER_ZAHL) p.mengeGrund = prozent && !aufgegangen ? 'schlecht lesbar – die Summe ergibt nicht 100' : 'schlecht lesbar';
    if (!p.mengeGrund && p.zusatz && c < UNSICHER_ZAHL) p.mengeGrund = 'schlecht lesbar';
    const grenze = FAERBEND.find(([re]) => re.test(p.rohstoff));
    if (prozent && grenze && p.anteil > grenze[1]) p.mengeGrund = `ungewöhnlich viel – fehlt ein Komma (${String(p.anteil / 10).replace('.', ',')})?`;
    else if (prozent && p.zusatz && p.anteil > 20) p.mengeGrund = 'ungewöhnlich viel für einen Zusatz – stimmt die Zahl?';
    if (prozent && p.anteil > 100) p.mengeGrund = 'mehr als 100 – stimmt die Zahl?';
  }
  for (const p of erg.rezept) {
    p.grund = [p.nameGrund, p.mengeGrund].filter(Boolean).join('; ');
    p.sicher = !p.grund;
    delete p._r;
    delete p.bestaetigt;
    delete p.nameGrund;
    delete p.mengeGrund;
  }
  // Wasser in ml/g: auf das Rezept beziehen (Prozent vom Trockengewicht)
  if (erg.wasser.wert != null && erg.wasser.einheit !== '%') {
    const ml = erg.wasser.einheit === 'l' ? erg.wasser.wert * 1000 : erg.wasser.wert;
    const trocken = sBasis + sZ;
    if (trocken > 0) {
      erg.wasser.wert = Math.round((ml / trocken) * 100);
      Object.assign(erg.wasser, { sicher: false, grund: `${komma(ml)} ml Wasser auf ${komma(trocken)} g Trockenglasur umgerechnet – stimmt das?` });
    } else Object.assign(erg.wasser, { wert: null, sicher: false, grund: 'Wasser in ml angegeben – bitte in % vom Trockengewicht eintragen' });
  }
  delete erg.wasser.einheit;
  if (basis.length) {
    erg.summe = { basis: sBasis, zusatz: sZ, prozent, sicher: true, grund: '' };
    // Geht die Summe nicht auf und ist keine Zahl als unsicher markiert: als eigene Frage
    if (prozent && !aufgegangen && erg.rezept.every(p => p.zusatz || p.sicher)) {
      Object.assign(erg.summe, { sicher: false, grund: `Die Anteile ergeben zusammen ${komma(sBasis)} statt 100.` });
    }
  }

  // 4. Name: mit Bezeichnung, sonst die größte (bzw. erste) freie Zeile vor dem Rezept
  const ersteRoh = art.indexOf('rohstoff');
  const frei = i => !art[i] && buchstaben(zeilen[i].text) >= 2;
  const vorher = zeilen.map((_, i) => i).filter(i => frei(i) && (ersteRoh < 0 || i < ersteRoh));
  const hoehen = zeilen.filter((_, i) => art[i] !== 'leer').map(z => z.hoehe).sort((a, b) => a - b);
  const mittel = hoehen[Math.floor(hoehen.length / 2)] || 1;
  if (!erg.name.wert) {
    const kand = vorher.filter(i => !BESCHREIBUNG_LABEL.test(zeilen[i].text) && zeilen[i].text.split(/\s+/).length <= 6
      && !(BESCHREIBUNG_WORT.test(zeilen[i].text) && zeilen[i].text.includes(',')));
    const sortiert = [...kand].sort((p, q) => zeilen[q].hoehe - zeilen[p].hoehe || p - q);
    const i = sortiert[0];
    erg.name.kandidaten = sortiert.slice(0, 3).map(k => zeilen[k].text);
    if (i == null) Object.assign(erg.name, { sicher: false, grund: 'kein Name gefunden' });
    else {
      art[i] = 'name';
      const gross = zeilen[i].hoehe >= 1.15 * mittel && (sortiert.length < 2 || zeilen[i].hoehe > 1.1 * zeilen[sortiert[1]].hoehe);
      const eindeutig = gross || (kand.length === 1 && i === vorher[0]);
      const grund = zeilen[i].conf < UNSICHER_TEXT ? 'schlecht lesbar' : eindeutig ? '' : 'nicht sicher, welche Zeile der Name ist';
      Object.assign(erg.name, { wert: zeilen[i].text.replace(/[:.]$/, ''), sicher: !grund, grund, zeilen: [i] });
    }
  }

  // 5. Beschreibung: mit Bezeichnung oder beschreibende Wörter vor dem Rezept
  const beschr = [];
  zeilen.forEach((z, i) => {
    const m = z.text.match(BESCHREIBUNG_LABEL);
    if (art[i] === 'beschreibung' && m) beschr.push([i, m[3].trim()]);
    else if (frei(i) && (ersteRoh < 0 || i < ersteRoh) && BESCHREIBUNG_WORT.test(z.text) && z.text.split(/\s+/).length <= 8) {
      art[i] = 'beschreibung';
      beschr.push([i, z.text]);
    }
  });
  if (beschr.length) {
    const unsicher = beschr.some(([i]) => zeilen[i].conf < UNSICHER_TEXT);
    Object.assign(erg.beschreibung, {
      wert: beschr.map(b => b[1]).join(', '),
      sicher: !unsicher,
      grund: unsicher ? 'schlecht lesbar' : '',
      zeilen: beschr.map(b => b[0]),
    });
  }

  // 6. Der Rest sind Notizen
  zeilen.forEach((z, i) => {
    if (art[i] && art[i] !== 'notiz-brand') return;
    const unsicher = z.conf < UNSICHER_TEXT;
    erg.notizen.push({ text: z.text, sicher: !unsicher, grund: unsicher ? 'schlecht lesbar' : '', zeile: i });
  });
  return erg;
}

// Fragen, die vor dem Übernehmen beantwortet werden müssen
export function offeneFragen(erg) {
  const f = [];
  for (const k of ['name', 'beschreibung', 'brennbereich', 'litergewicht', 'wasser']) if (!erg[k].sicher) f.push(k);
  erg.rezept.forEach((p, i) => { if (!p.sicher) f.push(`rezept.${i}`); });
  if (erg.summe && !erg.summe.sicher) f.push('summe');
  erg.notizen.forEach((n, i) => { if (!n.sicher) f.push(`notiz.${i}`); });
  return f;
}
