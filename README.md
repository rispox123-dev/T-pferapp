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
- Beim Speichern eines Werkstücks mit Foto **schneidet die App das Stück aus dem Foto aus** – mit Henkel, genau in Lage und Perspektive wie fotografiert
- Dieser Ausschnitt wird als Zeichnung im Stil einer Seladon-Glasur mit Craquelé nachgezogen: weiße Außenkontur, sichtbare Linien im Stück (Öffnung, Kanten, Fußkante) und Ellipsen an den Messstellen
- Markante Stellen werden automatisch gefunden: **Öffnung, Hals/Taille, Bauch/Schulter, Rillen, Absatz/Fußansatz, Boden, Höhe**
- Fehlt eine Stelle, **auf die Form tippen** und eine eigene Stelle hinzufügen; Stellen lassen sich umbenennen oder ausblenden
- **Maß antippen** → Wert eintragen. Schon ein Maß reicht: alle anderen Maße und die Höhe der Stellen werden aus dem Foto **geschätzt (≈)**
- „Umriss anpassen“: Rahmen enger ziehen, Empfindlichkeit einstellen oder ein anderes Foto wählen
- **Hinzufügen / Entfernen**: im Umriss-Editor den Ausschnitt mit dem Finger korrigieren (fehlende Teile dazumalen, Schatten wegnehmen)
- Henkel werden automatisch erkannt und vermessen: Höhe, wie weit er absteht, Ansatzhöhen
- „Groß anzeigen“ für die Drehscheibe – der Bildschirm bleibt dabei an
- Tipp: Foto **genau von der Seite**, vor einem ruhigen, einfarbigen Hintergrund

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

Reines HTML/CSS/JavaScript ohne Build-Schritt. Zum lokalen Testen:

```sh
npx http-server -p 8080
# dann http://localhost:8080 öffnen
```

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst, Tableiste |
| `js/app.js` | Alle Ansichten und Abläufe |
| `js/db.js` | Speicherung auf dem Gerät (IndexedDB) |
| `js/image.js` | Fotos verkleinern |
| `js/blueprint.js` | Formerkennung und Blaupausen-Zeichnung |
| `sw.js` | Offline-Betrieb (bei Änderungen `CACHE`-Version erhöhen) |
| `css/style.css` | Gestaltung (hell und dunkel) |
