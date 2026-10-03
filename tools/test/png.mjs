// PNG lesen/schreiben (für Testbilder und Ergebnisbilder)
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

export function schreibePng(pfad, { width, height, data }) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
  writeFileSync(pfad, PNG.sync.write(png));
}

export function lesePng(pfad) {
  const png = PNG.sync.read(readFileSync(pfad));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

// Mehrere Bilder nebeneinander zu einem Kontaktbogen zusammensetzen
export function kontaktbogen(bilder, spalten) {
  const w = Math.max(...bilder.map(b => b.width)), h = Math.max(...bilder.map(b => b.height));
  const zeilen = Math.ceil(bilder.length / spalten);
  const W = spalten * w, H = zeilen * h;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  bilder.forEach((b, i) => {
    const ox = (i % spalten) * w, oy = Math.floor(i / spalten) * h;
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
      const s = (y * b.width + x) * 4, d = ((oy + y) * W + ox + x) * 4;
      data[d] = b.data[s]; data[d + 1] = b.data[s + 1]; data[d + 2] = b.data[s + 2]; data[d + 3] = 255;
    }
  });
  return { width: W, height: H, data };
}
