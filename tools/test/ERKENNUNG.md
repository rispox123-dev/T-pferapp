# Formerkennung: Prüfung an Testfotos

Erzeugt mit `node tools/test/auswerten.mjs 96 --bericht` am 2026-10-03.

96 gerenderte Testfotos (`szene.mjs`) mit exakt bekannter Kontur: Formen aus allen Familien der Formen-Datenbank,
glänzende und matte Glasuren (hell, dunkel, farbig), zweifarbig getauchte Stücke, unglasierte Füße, Henkel,
seitliches Licht mit Schlagschatten auf Tisch und Wand, Holztische, Handy-Optik (1×/2×/3×) aus der Nähe,
frontal und von schräg oben.

**Fehler Kontur**: mittlere Abweichung des Radius über die ganze Höhe, in Prozent der größeren Abmessung.
**Fehler Höhe : Ø**: Abweichung des Verhältnisses von Höhe zu größtem Durchmesser – das sieht man in der Blaupause sofort.

| Verfahren | Kontur Mittel | Kontur Median | Höhe : Ø Mittel | Höhe : Ø Median |
|---|---|---|---|---|
| **Neu, geführte Aufnahme** (Neigung vom Lagesensor) | 2,0 % | 1,0 % | 8,6 % | 3,4 % |
| Neu, Foto aus der Galerie (nur EXIF-Brennweite) | 3,4 % | 2,2 % | 16,2 % | 5,6 % |
| Bisherige Erkennung | 10,6 % | 3,9 % | 33,1 % | 8,5 % |

Henkel erkannt (geführt): 26 von 31, Fehlalarme 1. Rechenzeit je Foto: 178 ms (Node.js, Analysegröße 480 px).

## Nach Art des Stücks (geführte Aufnahme)

| Art | Fotos | Kontur Median | Höhe : Ø Median |
|---|---|---|---|
| Becher / Tassen | 52 | 1,2 % | 3,8 % |
| Schüsseln / Schalen | 20 | 1,2 % | 5,8 % |
| Vasen | 24 | 0,6 % | 1,9 % |
| zweifarbig getaucht | 30 | 1,1 % | 2,7 % |

## Grenzen

- Weiß auf Weiß/Creme ohne Schatten: Der Körper wird über die Kanten gut gefunden, ein gleichfarbiger Henkel aber nicht immer –
  dann im Umriss-Editor mit „Hinzufügen“ nachmalen.
- Galeriefotos von schräg oben ohne Lagesensor: Die Neigung wird aus den Bögen von Öffnung und Boden geschätzt;
  das ist ungenauer als die geführte Aufnahme.
- Die Testfotos sind gerendert. Echte Fotos haben weitere Störungen (Spiegelungen der Umgebung, Unschärfe, Rauschen bei wenig Licht).
