# Formerkennung: Prüfung an Testfotos

Erzeugt mit `node tools/test/auswerten.mjs 96 --bericht` am 2026-10-03.

Gerenderte Testfotos (`szene.mjs`) mit exakt bekannter Kontur: Formen aus allen Familien der Formen-Datenbank,
glänzende und matte Glasuren (hell, dunkel, farbig), zweifarbig getauchte Stücke, unglasierte Füße, Henkel,
seitliches Licht mit Schlagschatten, Holztische, Handy-Optik (1×/2×/3×) aus der Nähe, frontal und von schräg oben.
Die Sätze „mit Unordnung“ haben zusätzlich Bilder an der Wand, Nachbargefäße, Regalkanten, Putzwände und
Stücke, die nicht in der Bildmitte stehen.

**Fehler Kontur**: mittlere Abweichung des Radius über die ganze Höhe, in Prozent der größeren Abmessung.
**Fehler Höhe : Ø**: Abweichung des Verhältnisses von Höhe zu größtem Durchmesser.
**Geführt** = wie die Aufnahme mit Maske in der App (Neigung vom Lagesensor, Stück ungefähr in der Maske).
**Galerie** = Foto ohne Maske und Lagesensor (nur Brennweite aus EXIF).

| Verfahren | Kontur Mittel | Kontur Median | Höhe : Ø Mittel | Höhe : Ø Median |
|---|---|---|---|---|
| **Neu, geführt**, ruhiger Hintergrund | 1,9 % | 1,0 % | 5,8 % | 3,1 % |
| **Neu, geführt**, mit Unordnung | 4,2 % | 1,2 % | 16,8 % | 3,0 % |
| Neu, Galerie, ruhiger Hintergrund | 2,5 % | 1,7 % | 6,2 % | 3,8 % |
| Neu, Galerie, mit Unordnung | 3,6 % | 1,9 % | 22,8 % | 4,1 % |
| Bisherige Erkennung, ruhiger Hintergrund | 10,6 % | 3,9 % | 33,1 % | 8,5 % |
| Bisherige Erkennung, mit Unordnung | 9,8 % | 4,9 % | 36,1 % | 9,0 % |

Ausreißer (Konturfehler über 4 %): geführt 13 von 96 (ruhig) bzw. 12 von 96 (Unordnung);
Galerie 19 bzw. 24. Die Mittelwerte werden von diesen wenigen Ausreißern bestimmt, die Mediane zeigen den Normalfall.

Henkel erkannt (geführt, ruhig): 28 von 31, Fehlalarme 1; mit Unordnung: 29 von 31, Fehlalarme 0.
Rechenzeit je Foto: 141 ms (Node.js, Analysegröße 400 px).

## Nach Art des Stücks (geführt, ruhiger Hintergrund)

| Art | Fotos | Kontur Median | Höhe : Ø Median |
|---|---|---|---|
| Becher / Tassen | 52 | 1,1 % | 3,9 % |
| Schüsseln / Schalen | 20 | 1,8 % | 4,9 % |
| Vasen | 24 | 0,8 % | 1,6 % |
| zweifarbig getaucht | 30 | 0,9 % | 2,5 % |

## Grenzen

- Ein helles Stück vor heller Wand, rechts und links fast spiegelgleich eingerahmt von Nachbarobjekten: Dann kann die Kontur
  zu den Nachbarn springen. Abhilfe in der App: Rahmen enger ziehen oder im Umriss-Editor auf das Stück tippen.
- Flache, weite Schalen von vorn: Die Unterseite verläuft fast waagrecht; Fuß und Unterseite werden dann teils ungenau.
- Galeriefotos ohne Lagesensor: Die Neigung wird aus den Bögen von Öffnung und Boden geschätzt; ungenauer als die
  geführte Aufnahme. Bildschirmfotos und nachträglich beschnittene Fotos verlieren die Kamerageometrie ganz.
- Die Testfotos sind gerendert. Echte Fotos haben weitere Störungen (Spiegelungen der Umgebung, Unschärfe, Rauschen).
