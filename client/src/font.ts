const G: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '011', '001'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ' ': ['000', '000', '000', '000', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '+': ['000', '010', '111', '010', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '.': ['000', '000', '000', '000', '010'],
};

const OUTLINE = '#140c0a';

function bitmapMask(text: string): { mask: Uint8Array; w: number; h: number } {
  const rows = 5;
  const gw = 3;
  const gap = 1;
  const chars = [...text].map((ch) => G[ch.toUpperCase()] ?? G[ch] ?? G[' ']);
  const w = Math.max(1, chars.length * (gw + gap) - gap);
  const mask = new Uint8Array(w * rows);
  chars.forEach((glyph, ci) => {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < gw; x++) {
        if (glyph[y][x] === '1') mask[y * w + ci * (gw + gap) + x] = 1;
      }
    }
  });
  return { mask, w, h: rows };
}

/** Kenney Mini Square is a 1px grid at 8px. Threshold so the canvas raster stays crisp. */
function kenneyMask(text: string): { mask: Uint8Array; w: number; h: number } | null {
  if (typeof document === 'undefined' || !document.fonts?.check?.('8px "Kenney Mini"')) return null;
  const fontPx = 8;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = `${fontPx}px "Kenney Mini"`;
  const tw = Math.max(4, Math.ceil(measure.measureText(text).width) + 4);
  const th = fontPx + 6;
  const src = document.createElement('canvas');
  src.width = tw;
  src.height = th;
  const g = src.getContext('2d');
  if (!g) return null;
  g.font = `${fontPx}px "Kenney Mini"`;
  g.textBaseline = 'top';
  g.fillStyle = '#fff';
  g.fillText(text, 2, 1);
  const img = g.getImageData(0, 0, tw, th).data;
  let minX = tw;
  let minY = th;
  let maxX = -1;
  let maxY = -1;
  const raw = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (img[(y * tw + x) * 4 + 3] > 140) {
        raw[y * tw + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) mask[y * w + x] = raw[(y + minY) * tw + (x + minX)];
  }
  return { mask, w, h };
}

function paintMask(mask: Uint8Array, w: number, h: number, color: string, scale: number): HTMLCanvasElement {
  const pad = 1;
  const c = document.createElement('canvas');
  c.width = (w + pad * 2) * scale;
  c.height = (h + pad * 2) * scale;
  const g = c.getContext('2d');
  if (!g) return c;
  g.imageSmoothingEnabled = false;
  const put = (x: number, y: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(x * scale, y * scale, scale, scale);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) put(x + pad + dx, y + pad + dy, OUTLINE);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) put(x + pad, y + pad, color);
    }
  }
  return c;
}

/** Integer-scaled pixel text with a 1px dark outline. `scale` is whole font pixels. */
export function textCanvas(text: string, color: string, scale = 1): HTMLCanvasElement {
  const shown = text.length ? text : ' ';
  const glyph = kenneyMask(shown) ?? bitmapMask(shown);
  return paintMask(glyph.mask, glyph.w, glyph.h, color, Math.max(1, scale | 0));
}
