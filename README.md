# Töpferbuch

Eine Handy-App für Töpferinnen und Töpfer, die eigene Stücke töpfern und eigene Glasuren ansetzen.

## Was die App kann

### 1. Werkstücke – Bibliothek zum Wiederholen
- Fotos des Stücks (direkt mit der Kamera oder aus der Galerie)
- Tonmenge (g), Tonsorte, Technik, Datum, Serie
- Maße **nass/frisch**: Höhe, Ø Öffnung, Ø breiteste Stelle, Ø Boden, Wand- und Bodenstärke
- Maße **nach dem Brand** → die App berechnet die **Schwindung** deines Tons
- Beliebige weitere Angaben (z. B. Henkellänge, Fußring)
- Notizen und Arbeitsschritte
- **„Nochmal töpfern“**: übernimmt Ton, Maße und Blaupause als Vorlage für ein neues Stück

### Blaupause aus dem Foto
- **Geführte Aufnahme** („Foto für Blaupause“): Eine Maske zeigt den Umriss einer typischen Form (Becher/Tasse, Schüssel, Vase), die Mittellinie, die Standlinie und die Augenhöhe. Eine **Wasserwaage** (Lagesensor) wird grün, wenn das Handy senkrecht und gerade ist. Hinweise wie „Näher heran“, „Standfläche auf die Standlinie“ oder „Mehr Licht“ führen zum besten Winkel: **frontal, Kamera auf halber Höhe, Henkel zur Seite**.
- Die Neigung des Handys und die Brennweite werden mit dem Foto gespeichert; damit rechnet die Erkennung die Perspektive genau heraus (bei Galeriefotos wird die Brennweite aus den EXIF-Daten gelesen).
- **Erkennung**: Zuerst wird die **Mittelachse** gesucht – dort, wo viele Kanten spiegelgleich links und rechts liegen und das Stück auch innen spiegelgleich aussieht. Dann wird der Umriss **für beide Seiten gemeinsam** verfolgt: Ein Drehteil ist symmetrisch, Dinge im Hintergrund (Bilder, Regalkanten, Nachbargefäße) fast nie dazu. Die besser belichtete Seite (**Leitseite**) trägt den Umriss auch dort, wo die andere im Schatten liegt. Farbmodelle für Stück und Hintergrund vertragen Schatten und Glanzlichter. Was im Schatten, in Spiegelungen oder hinter Farbwechseln (z. B. zweifarbig getaucht, unglasierter Fuß) verloren geht, ergänzt die App aus ihrem **Formwissen** – gelernt aus einer Datenbank mit 3200 Bechern, Tassen, Schüsseln, Schalen und Vasen.
- Henkel werden erkannt (auch über das Henkelloch) und vermessen: Höhe, wie weit er absteht, Ansatzhöhen
- **Zeichnung leicht von oben**, damit Öffnung und Boden als Ellipsen zu sehen sind – auch wenn frontal fotografiert wurde. als Bleistiftzeichnung in Handschrift auf cremeweißem Aquarellpapier; markante Stellen: **Öffnung, Hals/Taille, Bauch/Schulter, Rillen, Absatz/Fußansatz, Boden, Höhe**
- Fehlt eine Stelle, **auf die Form tippen** und eine eigene Stelle hinzufügen; Stellen lassen sich umbenennen oder ausblenden
- **Maß antippen** → Wert eintragen. Schon ein Maß reicht: alle anderen Maße und die Höhe der Stellen werden aus dem Foto **geschätzt (≈)**
- Auf der Werkstückseite zeigt ein kleines Foto mit eingezeichnetem Umriss, **wie die App das Stück erkannt hat** – bei Unsicherheit mit dem Hinweis „Bitte prüfen“
- „Umriss anpassen“: Rahmen, Empfindlichkeit, Art des Stücks, anderes oder neues Foto; **auf das Stück tippen**, wenn die App ein Nachbarobjekt erwischt hat; mit **Hinzufügen / Entfernen** den Umriss mit dem Finger korrigieren
- „Groß anzeigen“ für die Drehscheibe – der Bildschirm bleibt dabei an

### 2. Glasieren – Vorher-Nachher-Protokoll
- **Foto der glasierten Schrühware vor dem Brand**
- Je Glasurschicht: Glasur, Auftragsart, **Tauchdauer**, **Wiederholungen**, Pause, Litergewicht
- Auffälligkeiten beim Glasieren antippen (Tropfnasen, Griffstellen, zu dünn …)
- Nach dem Glasurbrand: **Foto danach**, Ergebnis, Auffälligkeiten nach dem Brand, Brenndaten
- **Vergleich** von vorher und nachher: Schieberegler, Überblenden oder nebeneinander

### 3. Glasuren – Rezepte und Auswertung
- Rezept (Rohstoffe und Anteile), Brennbereich, Litergewicht, Foto der Testkachel
- **Auswertung**: alle Stücke mit dieser Glasur, sortiert nach Tauchdauer, mit Vorher-/Nachher-Fotos und Ergebnis

### Daten
Alle Daten und Fotos bleiben **auf deinem Handy**. Es gibt keinen Server und kein Konto.
Unter **Mehr → Sicherung erstellen** speicherst du alles in einer Datei (am besten regelmäßig!).

---

## Die App aufs Handy bringen (einmalig, ca. 5 Minuten)

Die App ist eine *Web-App* (PWA). Du brauchst keinen App-Store. GitHub stellt sie kostenlos im Internet bereit:

1. Öffne auf github.com dein Repository **T-pferapp**.
2. Klicke auf **Settings** (Einstellungen), links auf **Pages**.
3. Wähle unter **Build and deployment → Source** „**Deploy from a branch**“.
4. Wähle unter **Branch** den Zweig mit der App (z. B. `main`) und den Ordner `/ (root)`. Klicke auf **Save**.
5. Nach 1–2 Minuten erscheint oben auf der Seite die Adresse, z. B.
   `https://rispox123-dev.github.io/T-pferapp/`
6. Öffne diese Adresse auf dem Handy:
   - **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“
   - **Android (Chrome):** Menü ⋮ → „App installieren“

Danach startet die App wie jede andere App vom Startbildschirm und funktioniert auch ohne Internet.

> Hinweis: Bei einem *privaten* Repository ist GitHub Pages nur mit einem kostenpflichtigen GitHub-Tarif möglich. Die Daten aus der App landen aber ohnehin **nie** auf GitHub, nur der Programmcode.

## Für Entwickler

Die App selbst ist reines HTML/CSS/JavaScript ohne Build-Schritt. Zum lokalen Testen:

```sh
npx http-server -p 8080
# dann http://localhost:8080 öffnen
```

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst, Tableiste |
| `js/app.js` | Alle Ansichten und Abläufe |
| `js/db.js` | Speicherung auf dem Gerät (IndexedDB) |
| `js/image.js` | Fotos verkleinern, Brennweite aus EXIF |
| `js/kamera.js` | Geführte Aufnahme: Maske, Wasserwaage, Live-Hinweise |
| `js/kontur.js` | Umriss begradigen: gerade Wände, ruhige Bögen, scharfe Kanten |
| `js/erkennung.js` | Formerkennung: Stück vom Hintergrund trennen, Kontur je Seite, Leitseite, Perspektive, Henkel |
| `js/formprior.js` | Formwissen: Kontur an die gelernten Formfamilien anpassen, verdeckte Stellen vorhersagen |
| `js/formen-modell.js` | Gelernte Formmodelle (automatisch erzeugt) |
| `js/blueprint.js` | Markante Stellen, Maße schätzen, Zeichnung der Blaupause |
| `sw.js` | Offline-Betrieb (bei Änderungen `CACHE`-Version erhöhen) |
| `css/style.css` | Gestaltung (hell und dunkel) |

### Formen-Datenbank und Tests (`tools/`, braucht Node.js)

```sh
npm install                              # nur für die Werkzeuge (pngjs, playwright-core)
npm run formen                           # Datenbank bauen, Modelle lernen → js/formen-modell.js, tools/formen/ANALYSE.md
node tools/test/auswerten.mjs 96 --bericht   # Erkennung an gerenderten Testfotos prüfen → tools/test/ERKENNUNG.md
node tools/test/echt.mjs foto.png        # echtes Foto erkennen und Ergebnis einzeichnen
node tools/test/blaupausen.mjs 6         # Testfotos und Blaupausen nebeneinander ansehen
node tools/test/app-test.mjs             # Ende-zu-Ende im Browser mit simulierter Kamera
```

- `tools/formen/typologie.mjs` – Formfamilien gedrehter Gefäße (Proportionen, Fuß, Bauch, Taille, Schulter, Hals, Lippe)
- `tools/formen/formen-db.json` – die Datenbank (3200 Konturen); eigene Profile können ergänzt werden
- `tools/formen/ANALYSE.md` – Linienführung je Familie und wie genau verdeckte Konturteile vorhergesagt werden
- `tools/test/szene.mjs` – realistische Testfotos (Raymarching): Glasuren, Schatten, Glanzlichter, Henkel, Handy-Optik; mit `--unordnung` zusätzlich Bilder an der Wand, Nachbargefäße, Regalkanten, Putz
