// Baut die Formen-Datenbank: viele Becher, Tassen, Schüsseln, Schalen und Vasen
// mit realistischen Proportionen. Ausgabe: tools/formen/formen-db.json
//
//   node tools/formen/bauen.mjs [Anzahl je Familie]
//
// Jeder Eintrag ist reproduzierbar (Familie + Startwert); das Profil ist Radius / Höhe
// an N Stellen von der Öffnung (Index 0) bis zum Boden (Index N-1).

import { writeFileSync } from 'node:fs';
import { FAMILIEN, N, rng, erzeuge } from './typologie.mjs';

const proFamilie = Number(process.argv[2]) || 400;
const r3 = v => Math.round(v * 1000) / 1000;

const eintraege = [];
FAMILIEN.forEach((fam, fi) => {
  for (let i = 0; i < proFamilie; i++) {
    const seed = (fi + 1) * 100003 + i * 7919;
    const { profil, params } = erzeuge(fam, rng(seed));
    const dMax = 2 * Math.max(...profil);
    eintraege.push({
      id: `${fam.key}-${String(i + 1).padStart(4, '0')}`,
      familie: fam.key,
      seed,
      hoeheZuDurchmesser: r3(1 / dMax),
      params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, r3(v)])),
      profil: profil.map(r3),
    });
  }
});

const db = {
  beschreibung: 'Formen-Datenbank Töpferbuch: Außenkonturen gedrehter Gefäße. profil = Radius/Höhe an N gleichmäßig verteilten Stellen von der Öffnung (0) bis zum Boden (N-1).',
  erzeugt: new Date().toISOString().slice(0, 10),
  N,
  familien: FAMILIEN.map(f => ({ key: f.key, label: f.label, gruppe: f.gruppe, text: f.text })),
  eintraege,
};
const pfad = new URL('./formen-db.json', import.meta.url);
writeFileSync(pfad, JSON.stringify(db).replace(/\},\{"id"/g, '},\n{"id"'));
console.log(`${eintraege.length} Formen gespeichert → ${pfad.pathname}`);
