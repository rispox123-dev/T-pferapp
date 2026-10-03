// Fotos verkleinern, damit der Speicher auf dem Handy nicht vollläuft.

const FULL_SIZE = 1600;
const THUMB_SIZE = 400;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

function scaleTo(img, maxSide, quality) {
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * ratio);
  const h = Math.round(img.naturalHeight * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht gespeichert werden'))), 'image/jpeg', quality);
  });
}

export async function processImage(file) {
  const img = await loadImage(file);
  const [blob, thumb] = await Promise.all([scaleTo(img, FULL_SIZE, 0.85), scaleTo(img, THUMB_SIZE, 0.8)]);
  return { blob, thumb };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

// Brennweite (Kleinbild-Äquivalent, mm) aus den EXIF-Daten eines JPEG-Fotos – die
// Formerkennung rechnet damit die Perspektive heraus. null, wenn nicht vorhanden.
export async function brennweiteAusExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10;
        const le = v.getUint16(t) === 0x4949;
        const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
        const eintrag = (ifd, tag) => {
          const n = u16(t + ifd);
          for (let i = 0; i < n; i++) {
            const e = t + ifd + 2 + i * 12;
            if (u16(e) === tag) return e;
          }
          return -1;
        };
        const exifPtr = eintrag(u32(t + 4), 0x8769);
        if (exifPtr < 0) return null;
        const f = eintrag(u32(exifPtr + 8), 0xa405);
        if (f < 0) return null;
        const mm = u16(f + 8);
        return mm > 0 ? mm : null;
      }
      if ((marker & 0xff00) !== 0xff00) return null;
      o += 2 + len;
    }
  } catch { /* keine EXIF-Daten */ }
  return null;
}
