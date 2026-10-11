import { deflateSync, inflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export interface RgbaImage {
  w: number;
  h: number;
  rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function encodePng(img: RgbaImage): Buffer {
  const stride = img.w * 4;
  const raw = Buffer.alloc((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < stride; x++) raw[row + 1 + x] = img.rgba[y * stride + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function decodePng(buf: Buffer): RgbaImage {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let w = 0;
  let h = 0;
  let bit = 0;
  let color = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let palette = Buffer.alloc(0);
  let trns = Buffer.alloc(0);
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bit = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (interlace !== 0) throw new Error('interlaced png');
  const inflated = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(w * h * 4);
  if (color === 6 && bit === 8) {
    const stride = w * 4;
    let prev = new Uint8Array(stride);
    let p = 0;
    for (let y = 0; y < h; y++) {
      const filter = inflated[p++];
      const row = inflated.subarray(p, p + stride);
      p += stride;
      const cur = unfilter(filter, row, prev, 4);
      rgba.set(cur, y * stride);
      prev = cur;
    }
    return { w, h, rgba };
  }
  if (color === 2 && bit === 8) {
    const stride = w * 3;
    let prev = new Uint8Array(stride);
    let p = 0;
    for (let y = 0; y < h; y++) {
      const filter = inflated[p++];
      const row = inflated.subarray(p, p + stride);
      p += stride;
      const cur = unfilter(filter, row, prev, 3);
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        rgba[di] = cur[x * 3];
        rgba[di + 1] = cur[x * 3 + 1];
        rgba[di + 2] = cur[x * 3 + 2];
        rgba[di + 3] = 255;
      }
      prev = cur;
    }
    return { w, h, rgba };
  }
  if (color === 3 && bit === 8) {
    const stride = w;
    let prev = new Uint8Array(stride);
    let p = 0;
    for (let y = 0; y < h; y++) {
      const filter = inflated[p++];
      const row = inflated.subarray(p, p + stride);
      p += stride;
      const cur = unfilter(filter, row, prev, 1);
      for (let x = 0; x < w; x++) {
        const idx = cur[x];
        const di = (y * w + x) * 4;
        rgba[di] = palette[idx * 3];
        rgba[di + 1] = palette[idx * 3 + 1];
        rgba[di + 2] = palette[idx * 3 + 2];
        rgba[di + 3] = idx < trns.length ? trns[idx] : 255;
      }
      prev = cur;
    }
    return { w, h, rgba };
  }
  throw new Error('unsupported png color ' + color + ' bit ' + bit);
}

function unfilter(filter: number, row: Buffer, prev: Uint8Array, bpp: number): Uint8Array {
  const cur = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? cur[i - bpp] : 0;
    const up = prev[i];
    const ul = i >= bpp ? prev[i - bpp] : 0;
    const v = row[i];
    if (filter === 0) cur[i] = v;
    else if (filter === 1) cur[i] = (v + left) & 255;
    else if (filter === 2) cur[i] = (v + up) & 255;
    else if (filter === 3) cur[i] = (v + ((left + up) >> 1)) & 255;
    else if (filter === 4) cur[i] = (v + paeth(left, up, ul)) & 255;
    else throw new Error('bad png filter ' + filter);
  }
  return cur;
}

export function frameCell(img: RgbaImage, frame: number, cols = 12, cell = 16): Uint8Array {
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  const out = new Uint8Array(cell * cell * 4);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const si = ((row * cell + y) * img.w + col * cell + x) * 4;
      out.set(img.rgba.subarray(si, si + 4), (y * cell + x) * 4);
    }
  }
  return out;
}

export function firstInkRow(px: Uint8Array, w: number): number {
  const h = px.length / 4 / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 20) return y;
  }
  return -1;
}

export function inkCount(px: Uint8Array, y0: number, y1: number, w: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 20) n++;
  }
  return n;
}
