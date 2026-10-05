# Töpferbuch

Eine Handy-App für Töpferinnen und Töpfer, die eigene Stücke töpfern und eigene Glasuren ansetzen.

## Was die App kann

Unten wechselst du zwischen **Töpfern**, **Glasieren**, **Glasuren** und **Mehr**. Dabei blättert die Seite um wie in einem Skizzenbuch: vorwärts nach links, zurück nach rechts (bei „Bewegung reduzieren“ im System ohne Animation). Umblättern geht auch per Wischen am Seitenrand: vom rechten Rand nach links zur nächsten, vom linken Rand nach rechts zur vorigen Seite. Das Blatt folgt dabei dem Finger; wer nicht weit genug wischt, legt es wieder zurück.

### 1. Töpfern – Werkstücke als Bibliothek zum Wiederholen
- Fotos des Stücks: gezeichnete **Kamera** („Foto“, die geführte Aufnahme für die Blaupause; ohne Kamerazugriff im Browser die Kamera des Handys) oder **Bilderrahmen** („Galerie“)
- Tonmenge (g), Tonsorte, Technik, Datum, Serie
- Maße **nass/frisch**: Höhe, Ø Öffnung, Ø breiteste Stelle, Ø Boden, Wand- und Bodenstärke
- Maße **nach dem Brand** → die App berechnet die **Schwindung** deines Tons
- Beliebige weitere Angaben (z. B. Henkellänge, Fußring)
- Notizen und Arbeitsschritte
- **„Nochmal töpfern“**: übernimmt Ton, Maße und Blaupause als Vorlage für ein neues Stück
- **Fotos oder Skizzenbuch**: Oben rechts in der Übersicht wechselt ein kleiner, mit Bleistift gezeichneter Knopf zwischen den Fotos und den Blaupausen. Als Skizzen stehen die Stücke ohne Maße, nur mit ihrem Namen, direkt auf dem Blatt – wie eine Seite im Skizzenbuch. Der Knopf zeigt, wohin es geht: ein Skizzenbuch mit Stift (zu den Skizzen) oder ein Polaroid (zurück zu den Fotos). Die gewählte Ansicht bleibt erhalten

### Blaupause aus dem Foto
- **Geführte Aufnahme** (Knopf „Foto“): Eine Maske zeigt den Umriss einer typischen Form (Becher/Tasse, Schüssel, Vase), die Mittellinie, die Standlinie und die Augenhöhe. Eine **Wasserwaage** (Lagesensor) wird grün, wenn das Handy senkrecht und gerade ist. Hinweise wie „Näher heran“, „Standfläche auf die Standlinie“ oder „Mehr Licht“ führen zum besten Winkel: **frontal, Kamera auf halber Höhe, Henkel zur Seite**.
- **Maße gleich nach dem Foto**: Sobald ein Foto hinzugefügt ist (Foto oder Galerie), erscheint ein herausgerissener Zettel mit **Höhe, Ø Öffnung, Ø breiteste Stelle und Ø Fuß**. Ein Maß antippen → am unteren Rand erscheint ein **Maßband**. Nach links wischen macht den Wert größer, nach rechts kleiner; langsam gewischt ist jeder Teilstrich **genau 1 mm**, schnell gewischt springt der Wert in großen Schritten. Startwert 5 cm. Mit den genauen Maßen wird die Blaupause am besten
- **Eigene Stellen auf dem Zettel**: Mit dem kleinen **+** eine **Taille, Schulter oder einen Bauch** hinzufügen und mit dem Maßband **Durchmesser und Höhe vom Boden** einstellen. Mehrere derselben Art stehen einzeln auf dem Zettel (Taille 1, Taille 2 …); der gezeichnete **Mülleimer** löscht eine Stelle wieder. Gedacht für Formen, die die Erkennung schlecht trifft (z. B. Zickzack-Wände): Die eigenen Stellen ersetzen die automatisch gefundenen derselben Art, und die Blaupause wird genau an sie angepasst. Den Zettel gibt es auch in der Werkstückansicht („Maße & Stellen ändern“) und im Formular
- Die Neigung des Handys und die Brennweite werden mit dem Foto gespeichert; damit rechnet die Erkennung die Perspektive genau heraus (bei Galeriefotos wird die Brennweite aus den EXIF-Daten gelesen).
- **Erkennung**: Zuerst wird die **Mittelachse** gesucht – dort, wo viele Kanten spiegelgleich links und rechts liegen und das Stück auch innen spiegelgleich aussieht. Dann wird der Umriss **für beide Seiten gemeinsam** verfolgt: Ein Drehteil ist symmetrisch, Dinge im Hintergrund (Bilder, Regalkanten, Nachbargefäße) fast nie dazu. Die besser belichtete Seite (**Leitseite**) trägt den Umriss auch dort, wo die andere im Schatten liegt. Farbmodelle für Stück und Hintergrund vertragen Schatten und Glanzlichter. Was im Schatten, in Spiegelungen oder hinter Farbwechseln (z. B. zweifarbig getaucht, unglasierter Fuß) verloren geht, ergänzt die App aus ihrem **Formwissen** – gelernt aus einer Datenbank mit 3200 Bechern, Tassen, Schüsseln, Schalen und Vasen.
- Henkel werden erkannt und vermessen: Höhe, wie weit er absteht, Ansatzhöhen. Glanzlichter und Schattenseiten zerreißen den Henkel nicht mehr in Teilstücke; ragt er über den Rahmen der Aufnahme-Maske hinaus, erweitert die App den Ausschnitt selbst
- Obere Ecken: Ist die Neigung vom Lagesensor oder die Brennweite nicht ganz genau, gerät ein Stück des Randbogens ins Profil und die Ecken würden rund. Biegt das Profil nur ganz oben und viel stärker als die Wand darunter ein, setzt die App die Wand bis zum Rand fort
- **Zeichnung leicht von oben**, damit Öffnung und Boden als Ellipsen zu sehen sind – auch wenn frontal fotografiert wurde. Gezeichnet mit Bleistift in Handschrift auf off-white Aquarellpapier; markante Stellen (nur wo sich die Form wirklich ändert): **Öffnung, Schulter, Bauch (größter Durchmesser), Taille (Einziehung), Fuß bzw. Fußring, Höhe**
- Fehlt eine Stelle, **auf die Form tippen** und eine eigene Stelle hinzufügen; Stellen lassen sich umbenennen oder ausblenden
- **Maß antippen** → Wert mit dem **Maßband** eintragen (wie auf dem Zettel; Startwert ist die Schätzung aus dem Foto, der gezeichnete **Radiergummi** löscht einen Wert wieder). Bei Stellen zwischen Öffnung und Fuß lässt sich auch die Höhe vom Boden mit dem Maßband einstellen, der Name der Stelle bleibt änderbar. Schon ein Maß reicht: alle anderen Maße und die Höhe der Stellen werden aus dem Foto **geschätzt (≈)**
- **Abgleich mit deinen Maßen**: Die Zeichnung wird so angepasst, dass jedes eingetragene Maß genau stimmt. Zwischen zwei eingetragenen Stellen bleibt der Verlauf erhalten; steigt oder fällt die Wand dort nur, wird sie genau auf die Maße gestreckt – sind beide gleich (z. B. Taille = Öffnung), wird sie gerade. Eine eingetragene Höhenlage („auf welcher Höhe“) verschiebt die Stelle. Henkel wandern mit. Die eingetragene Höhe legt den Maßstab fest
- Auf der Werkstückseite zeigt ein kleines Foto mit eingezeichnetem Umriss, **wie die App das Stück erkannt hat** – bei Unsicherheit mit dem Hinweis „Bitte prüfen“
- „Umriss anpassen“: Rahmen, Empfindlichkeit, Art des Stücks, anderes oder neues Foto; **auf das Stück tippen**, wenn die App ein Nachbarobjekt erwischt hat; mit **Henkel** den Henkel nachmalen (der Körper bleibt dabei unverändert), mit **Hinzufügen / Entfernen** den Körper korrigieren. Einseitig Hinzugefügtes zählt als Henkel, nicht als Körper
- Zum Malen öffnet sich das Foto im **Vollbild**: mit **zwei Fingern zoomen** und verschieben (am Rechner mit dem Mausrad); der Pinsel wird beim Zoomen feiner
- „Groß anzeigen“ für die Drehscheibe – der Bildschirm bleibt dabei an

### 2. Glasieren – Vorher-Nachher-Protokoll
- **Foto der glasierten Schrühware vor dem Brand**
- Je Glasurschicht: Glasur, Auftragsart, **Tauchdauer**, **Wiederholungen**, Pause, Litergewicht
- Auffälligkeiten beim Glasieren antippen (Tropfnasen, Griffstellen, zu dünn …)
- Nach dem Glasurbrand: **Foto danach**, Ergebnis, Auffälligkeiten nach dem Brand, Brenndaten
- **Vergleich** von vorher und nachher: Schieberegler, Überblenden oder nebeneinander

### 3. Glasuren – Rezepte und Auswertung
- Rezept (Rohstoffe und Anteile), Brennbereich, Litergewicht, Foto der Testkachel
- **Rezept vom Foto**: Oben im Glasur-Formular ein Rezept fotografieren (**Foto**) oder ein Bild wählen (**Galerie**) – aus einem Buch, von einem Zettel, einem Bildschirmfoto. Die App liest Name, Beschreibung, Brennbereich (Temperatur, Kegel, oxidierend/reduzierend), Litergewicht, Rohstoffe mit Anteilen und Zusätze (z. B. „Zusätze:“, „+ Eisenoxid 2“, „Add:“); übriger Text kommt in die Notizen. Die Texterkennung läuft **auf dem Handy**, das Foto verlässt das Gerät nicht. Funktioniert auch mit Tabellen (Rohstoff links, Menge rechts), Mengen vorn („20 Silica“), schräg oder quer gehaltenem Handy und Schatten auf dem Blatt; deutliche Handschrift geht oft, gedruckt gelingt am besten
- **Nachfragen statt raten**: Vor dem Eintragen erscheint ein Zettel mit allem Gelesenen. Wo die App unsicher ist, ist die Stelle markiert, mit dem **Bildausschnitt aus dem Foto** und dem Grund – schlecht lesbar, Schreibweise korrigiert („gelesen: Kalifeldspal“), Menge fehlt, Zahl unklar („1,5 oder 15?“ – jede Zahl wird zur Gegenprobe ein zweites Mal gelesen), Summe ergibt nicht 100, ungewöhnlich viel Färbeoxid („fehlt ein Komma?“), steht schon etwas anderes im Formular, Rezept ersetzen oder anhängen. Ändern oder „Stimmt so“ antippen; erst wenn alle Fragen beantwortet sind, lässt sich übernehmen. Anteile werden auch hier mit dem Maßband eingestellt
- Zusätze stehen im Rezept mit **+** davor und zählen nicht zur Summe. Das Foto des Rezepts wird mit der Glasur gespeichert
- **Auswertung**: alle Stücke mit dieser Glasur, sortiert nach Tauchdauer, mit Vorher-/Nachher-Fotos und Ergebnis

### Werte mit dem Maßband einstellen
Zahlen werden nirgends getippt: Ein Wert (Tonmenge, Maße nass und nach dem Brand, Wand- und Bodenstärke, Gewicht, Tauchdauer, Wiederholungen, Pause, Litergewicht, Brenntemperatur, Haltezeit, Anteile im Glasurrezept) wird angetippt, dann erscheint der Zettel mit allen Werten, die zusammengehören (z. B. alle vier Maße nach dem Brand mit der Topfskizze), und unten das **Maßband**. Jede Einheit hat ihre eigene Skala: Zentimeter und Millimeter auf 0,1 genau, Gramm und g/l in 1er-Schritten, Sekunden in halben Schritten, °C ab 500 mit Startwert 1240 °C. Langsam wischen für feine Schritte, schnell wischen für große Sprünge; der **Radiergummi** löscht einen Wert.

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
| `js/massband.js` | Maße mit dem Maßband eintragen: Zettel mit Risskante, Maßband mit geschwindigkeitsabhängigem Wischen; Grundmaße nach dem Foto und einzelne Maße der Blaupause |
| `js/kontur.js` | Umriss begradigen: gerade Wände, ruhige Bögen, scharfe Kanten |
| `js/erkennung.js` | Formerkennung: Stück vom Hintergrund trennen, Kontur je Seite, Leitseite, Perspektive, Henkel |
| `js/formprior.js` | Formwissen: Kontur an die gelernten Formfamilien anpassen, verdeckte Stellen vorhersagen |
| `js/formen-modell.js` | Gelernte Formmodelle (automatisch erzeugt) |
| `js/blueprint.js` | Markante Stellen, Maße schätzen, Zeichnung der Blaupause |
| `js/rezept.js` | Rezept aus dem erkannten Text: Zeilen zusammensetzen (auch spaltenweise gelesene Tabellen, schräge Fotos), Rohstoff-Wörterbuch, Mengen, Brennbereich, Litergewicht, Prüfungen und Gründe für Nachfragen |
| `js/rezept-foto.js` | Rezept vom Foto: Licht ausgleichen, Texterkennung (mit Gegenprobe der Zahlen), Zettel zum Prüfen |
| `vendor/tesseract/` | Texterkennung [Tesseract.js](https://github.com/naptha/tesseract.js) 6.0.1 mit Sprachdaten Deutsch und Englisch (Apache-2.0); wird erst beim ersten Rezeptfoto geladen und dann offline behalten |
| `sw.js` | Offline-Betrieb (bei Änderungen `CACHE`-Version erhöhen) |
| `css/style.css` | Gestaltung (hell und dunkel) |

### Formen-Datenbank und Tests (`tools/`, braucht Node.js)

```sh
npm install                              # nur für die Werkzeuge (pngjs, playwright-core)
npm run formen                           # Datenbank bauen, Modelle lernen → js/formen-modell.js, tools/formen/ANALYSE.md
node tools/test/auswerten.mjs 96 --bericht   # Erkennung an gerenderten Testfotos prüfen → tools/test/ERKENNUNG.md
node tools/test/echt.mjs foto.png        # echtes Foto erkennen und Ergebnis einzeichnen
node tools/test/blaupausen.mjs 6         # Testfotos und Blaupausen nebeneinander ansehen
node tools/test/henkel-ecken.mjs 40      # Henkel (wie viel erfasst) und obere Ecken an Bechern/Tassen, mit --unschaerfe
node tools/test/app-test.mjs             # Ende-zu-Ende im Browser mit simulierter Kamera, Vollbild, Zoom, Henkel-Werkzeug
node tools/test/massband-test.mjs        # Maßband: Startwert, 1-mm-genaues und schnelles Wischen, Übernahme, Blaupause, Skizzenbuch-Ansicht
node tools/test/werte-test.mjs           # alle Zahlen der Formulare mit dem Maßband (Werkstück, Glasurprotokoll, Glasur)
node tools/test/umblaettern-test.mjs     # Umblättern per Wischen am Rand, Skizzen auf dem Blatt (nicht schwarz)
node tools/test/rezept-foto-test.mjs     # Rezept vom Foto: gedruckt, schräg mit Schatten, englisch, Handschrift quer, Nachfragen, Übernahme
```

- `tools/formen/typologie.mjs` – Formfamilien gedrehter Gefäße (Proportionen, Fuß, Bauch, Taille, Schulter, Hals, Lippe)
- `tools/formen/formen-db.json` – die Datenbank (3200 Konturen); eigene Profile können ergänzt werden
- `tools/formen/ANALYSE.md` – Linienführung je Familie und wie genau verdeckte Konturteile vorhergesagt werden
- `tools/test/szene.mjs` – realistische Testfotos (Raymarching): Glasuren, Schatten, Glanzlichter, Henkel, Handy-Optik; mit `--unordnung` zusätzlich Bilder an der Wand, Nachbargefäße, Regalkanten, Putz
