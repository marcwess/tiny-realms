import { readFileSync } from 'node:fs';
import { buildWorld } from '../shared/src/world.ts';
import {
  BRIDGE,
  BRIDGE_N,
  BRIDGE_S,
  CAMPFIRE,
  DOOR,
  DUNGEON,
  LILY,
  PEBBLE,
  PIT_BANNER,
  tileFrame,
} from '../shared/src/tiles.ts';
import { decodePng, encodePng, type RgbaImage } from './png.ts';

const TILE = 16;
const COLS = 12;
export const TITLE_Y0 = 38;
export const TITLE_ROWS = 20;

const WATER = new Set([48, 49, 50, 60, 61, 62, 76, 77, 79, 126]);
const WATER_N = new Set([48, 49, 50]);
const WATER_S = new Set([60, 61, 62]);
const WATER_W = new Set([48, 60, 76]);
const WATER_E = new Set([50, 62, 79]);

function hex(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function loadSheets(): { town: RgbaImage; dungeon: RgbaImage } {
  const root = new URL('../client/public/assets/', import.meta.url);
  return {
    town: decodePng(readFileSync(new URL('town_packed.png', root))),
    dungeon: decodePng(readFileSync(new URL('tilemap_packed.png', root))),
  };
}

function blit(dst: Uint8Array, dw: number, sheet: RgbaImage, frame: number, dx: number, dy: number): void {
  const col = frame % COLS;
  const row = Math.floor(frame / COLS);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si = ((row * TILE + y) * sheet.w + col * TILE + x) * 4;
      const a = sheet.rgba[si + 3];
      if (a < 16) continue;
      const di = ((dy + y) * dw + dx + x) * 4;
      dst[di] = sheet.rgba[si];
      dst[di + 1] = sheet.rgba[si + 1];
      dst[di + 2] = sheet.rgba[si + 2];
      dst[di + 3] = 255;
    }
  }
}

function fill(dst: Uint8Array, dw: number, dh: number, x: number, y: number, w: number, h: number, color: number): void {
  const [r, g, b] = hex(color);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const px = x + xx;
      const py = y + yy;
      if (px < 0 || py < 0 || px >= dw || py >= dh) continue;
      const i = (py * dw + px) * 4;
      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = 255;
    }
  }
}

function paintWater(dst: Uint8Array, dw: number, dh: number, id: number, dx: number, dy: number): void {
  fill(dst, dw, dh, dx, dy, TILE, TILE, 0x3d7fd0);
  const h = (Math.imul(dx + 7, 374761393) ^ Math.imul(dy + 3, 668265263)) >>> 0;
  fill(dst, dw, dh, dx + (h % 9) + 1, dy + ((h >>> 4) % 5) + 3, 5, 1, 0x5b9ee6);
  fill(dst, dw, dh, dx + ((h >>> 8) % 8) + 2, dy + ((h >>> 12) % 4) + 10, 4, 1, 0x5b9ee6);
  if (id === 77) fill(dst, dw, dh, dx + ((h >>> 16) % 10) + 2, dy + 7, 3, 1, 0x9fd0f5);
  if (WATER_N.has(id)) {
    fill(dst, dw, dh, dx, dy, TILE, 3, 0x2d63a8);
    fill(dst, dw, dh, dx, dy, TILE, 1, 0x24442b);
    fill(dst, dw, dh, dx + 2, dy + 1, 2, 2, 0x6fbf4a);
    fill(dst, dw, dh, dx + 8, dy + 2, 3, 1, 0x6fbf4a);
    fill(dst, dw, dh, dx + 13, dy + 1, 2, 2, 0x6fbf4a);
  }
  if (WATER_S.has(id)) {
    fill(dst, dw, dh, dx, dy + TILE - 2, TILE, 1, 0xbfe3f7);
    fill(dst, dw, dh, dx, dy + TILE - 1, TILE, 1, 0x24442b);
  }
  if (WATER_W.has(id)) {
    fill(dst, dw, dh, dx + 1, dy, 1, TILE, 0xbfe3f7);
    fill(dst, dw, dh, dx, dy, 1, TILE, 0x24442b);
  }
  if (WATER_E.has(id)) {
    fill(dst, dw, dh, dx + TILE - 2, dy, 1, TILE, 0xbfe3f7);
    fill(dst, dw, dh, dx + TILE - 1, dy, 1, TILE, 0x24442b);
  }
}

function paintBridge(dst: Uint8Array, dw: number, dh: number, id: number, dx: number, dy: number): void {
  fill(dst, dw, dh, dx, dy, TILE, TILE, 0xb07440);
  for (let x = 3; x < TILE; x += 4) fill(dst, dw, dh, dx + x, dy, 1, TILE, 0x8a5530);
  for (let x = 0; x < TILE; x += 4) fill(dst, dw, dh, dx + x, dy + ((x >> 2) % 2 ? 5 : 11), 3, 1, 0xc98d55);
  if (id === BRIDGE_N || id === BRIDGE_S) {
    const ry = id === BRIDGE_N ? dy : dy + TILE - 4;
    fill(dst, dw, dh, dx, ry, TILE, 4, 0x3b2416);
    fill(dst, dw, dh, dx, ry + 1, TILE, 2, 0x7a4a28);
    fill(dst, dw, dh, dx + 7, ry, 2, 4, 0x3b2416);
  }
}

function paintBanner(dst: Uint8Array, dw: number, dh: number, dx: number, dy: number): void {
  fill(dst, dw, dh, dx + 4, dy + 1, 3, 15, 0x2a1a12);
  fill(dst, dw, dh, dx + 6, dy + 2, 8, 9, 0x2a1a12);
  fill(dst, dw, dh, dx + 7, dy + 11, 6, 2, 0x2a1a12);
  fill(dst, dw, dh, dx + 8, dy + 13, 4, 1, 0x2a1a12);
  fill(dst, dw, dh, dx + 5, dy + 1, 1, 15, 0x8a5a34);
  fill(dst, dw, dh, dx + 7, dy + 3, 6, 7, 0xc8322c);
  fill(dst, dw, dh, dx + 8, dy + 10, 4, 2, 0xc8322c);
  fill(dst, dw, dh, dx + 9, dy + 5, 2, 3, 0xf2a33a);
}

function paintCell(dst: Uint8Array, dw: number, dh: number, sheets: { town: RgbaImage; dungeon: RgbaImage }, id: number, dx: number, dy: number): void {
  if (!id) return;
  if (WATER.has(id)) {
    paintWater(dst, dw, dh, id, dx, dy);
    return;
  }
  if (id === PIT_BANNER) {
    paintBanner(dst, dw, dh, dx, dy);
    return;
  }
  if (id === BRIDGE || id === BRIDGE_N || id === BRIDGE_S) {
    paintBridge(dst, dw, dh, id, dx, dy);
    return;
  }
  if (id === LILY) {
    fill(dst, dw, dh, dx + 4, dy + 8, 8, 2, 0x2f7a34);
    fill(dst, dw, dh, dx + 6, dy + 7, 4, 1, 0x2f7a34);
    fill(dst, dw, dh, dx + 7, dy + 6, 2, 2, 0xd46ab0);
    return;
  }
  if (id === PEBBLE) {
    fill(dst, dw, dh, dx + 5, dy + 11, 5, 2, 0x6e675f);
    fill(dst, dw, dh, dx + 6, dy + 10, 3, 2, 0xb3aa9e);
    return;
  }
  const sheet = id >= DUNGEON ? sheets.dungeon : sheets.town;
  blit(dst, dw, sheet, tileFrame(id), dx, dy);
}

/** Login / class-select strip of the live map, with the same painted water as the game. */
export function renderTitle(sheets = loadSheets()): RgbaImage {
  const world = buildWorld();
  const w = 128 * TILE;
  const h = TITLE_ROWS * TILE;
  const rgba = new Uint8Array(w * h * 4);
  rgba.fill(255);
  for (let y = 0; y < TITLE_ROWS; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y + TITLE_Y0) * 128 + x;
      const dx = x * TILE;
      const dy = y * TILE;
      paintCell(rgba, w, h, sheets, world.tiles[i], dx, dy);
      if (world.objects[i] === DOOR) fill(rgba, w, h, dx + 3, dy + 2, 10, 14, 0x120e0c);
    }
  }
  for (let y = 0; y < TITLE_ROWS; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y + TITLE_Y0) * 128 + x;
      const obj = world.objects[i];
      if (!obj || WATER.has(obj)) continue;
      paintCell(rgba, w, h, sheets, obj, x * TILE, y * TILE);
      if (obj === CAMPFIRE) {
        fill(rgba, w, h, x * TILE + 6, y * TILE + 2, 4, 4, 0xffb03a);
        fill(rgba, w, h, x * TILE + 7, y * TILE + 1, 2, 2, 0xfff1c2);
      }
    }
  }
  return { w, h, rgba };
}

/** Hand-authored 16px bow in the Tiny Dungeon outline palette. Grip sits left of center. */
export function bowImage(): RgbaImage {
  const O = [42, 26, 20, 255];
  const W = [196, 138, 74, 255];
  const D = [138, 85, 48, 255];
  const S = [244, 239, 226, 255];
  const rows = [
    '..WWWWWW........',
    '.W......W.......',
    'W........W......',
    'W........W......',
    'W.....S..W......',
    '.W....S..W......',
    '.W....S..D......',
    '..W...S..DD.....',
    '..W...S.DD......',
    '..W...S.D.......',
    '..W..S.W........',
    '.W...S.W........',
    '.W....SW........',
    'W......W........',
    '.WWWWWW.........',
    '................',
  ];
  const rgba = new Uint8Array(16 * 16 * 4);
  const pix: Record<string, number[]> = { W, D, S, O };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const c = pix[ch];
      // Outline any wood pixel that touches empty space.
      let edge = false;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx > 15 || ny > 15 || rows[ny][nx] === '.') edge = true;
      }
      const src = ch === 'S' ? S : edge ? O : c;
      rgba.set(src, (y * 16 + x) * 4);
    }
  }
  return { w: 16, h: 16, rgba };
}

export function titlePng(): Buffer {
  return encodePng(renderTitle());
}

export function bowPng(): Buffer {
  return encodePng(bowImage());
}
