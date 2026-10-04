# Formerkennung: Prüfung an Testfotos

Erzeugt mit `node tools/test/auswerten.mjs 96 --bericht` am 2026-10-04.

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
| **Neu, geführt**, ruhiger Hintergrund | 1,7 % | 0,9 % | 5,4 % | 2,4 % |
| **Neu, geführt**, mit Unordnung | 4,0 % | 1,0 % | 15,9 % | 2,6 % |
| Neu, Galerie, ruhiger Hintergrund | 2,6 % | 1,9 % | 6,1 % | 4,3 % |
| Neu, Galerie, mit Unordnung | 3,5 % | 1,9 % | 22,0 % | 4,2 % |
| Bisherige Erkennung, ruhiger Hintergrund | 10,6 % | 3,9 % | 33,1 % | 8,5 % |
| Bisherige Erkennung, mit Unordnung | 9,8 % | 4,9 % | 36,1 % | 9,0 % |

Ausreißer (Konturfehler über 4 %): geführt 13 von 96 (ruhig) bzw. 13 von 96 (Unordnung);
Galerie 20 bzw. 22. Die Mittelwerte werden von diesen wenigen Ausreißern bestimmt, die Mediane zeigen den Normalfall.

Henkel erkannt (geführt, ruhig): 31 von 31, Fehlalarme 1; mit Unordnung: 31 von 31, Fehlalarme 1.
Rechenzeit je Foto: 181 ms (Node.js, Analysegröße 400 px).

## Nach Art des Stücks (geführt, ruhiger Hintergrund)

| Art | Fotos | Kontur Median | Höhe : Ø Median |
|---|---|---|---|
| Becher / Tassen | 52 | 0,9 % | 2,2 % |
| Schüsseln / Schalen | 20 | 1,5 % | 4,3 % |
| Vasen | 24 | 0,6 % | 1,5 % |
| zweifarbig getaucht | 30 | 0,7 % | 1,9 % |

## Grenzen

- Ein helles Stück vor heller Wand, rechts und links fast spiegelgleich eingerahmt von Nachbarobjekten: Dann kann die Kontur
  zu den Nachbarn springen. Abhilfe in der App: Rahmen enger ziehen oder im Umriss-Editor auf das Stück tippen.
- Flache, weite Schalen von vorn: Die Unterseite verläuft fast waagrecht; Fuß und Unterseite werden dann teils ungenau.
- Galeriefotos ohne Lagesensor: Die Neigung wird aus den Bögen von Öffnung und Boden geschätzt; ungenauer als die
  geführte Aufnahme. Bildschirmfotos und nachträglich beschnittene Fotos verlieren die Kamerageometrie ganz.
- Die Testfotos sind gerendert. Echte Fotos haben weitere Störungen (Spiegelungen der Umgebung, Unschärfe, Rauschen).
