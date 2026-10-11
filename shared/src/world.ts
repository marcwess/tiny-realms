import {
  CHUNK,
  WORLD_H,
  WORLD_W,
  tileIsSolid,
} from './constants.ts';
import { CRYPT_STAIRS, PVP_PIT, SPAWN_TILE, TOWN, zoneAtTile } from './zones.ts';

export interface MonsterSpawn {
  monsterId: number;
  tx: number;
  ty: number;
}

export interface WorldData {
  tiles: Uint8Array;
  solid: Uint8Array;
  spawns: MonsterSpawn[];
}

const FLOOR_OUT = 48;
const FLOOR_IN = 0;
const ROAD = 0;
const DOOR = 68;
const STAIRS = 63;
const BANNER = 15;

function idx(tx: number, ty: number): number {
  return ty * WORLD_W + tx;
}

export function buildWorld(): WorldData {
  const tiles = new Uint8Array(WORLD_W * WORLD_H);
  tiles.fill(FLOOR_OUT);

  const paint = (tx: number, ty: number, tile: number) => {
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return;
    tiles[idx(tx, ty)] = tile;
  };

  for (let x = 0; x < WORLD_W; x++) {
    const top = x === 0 ? 2 : x === WORLD_W - 1 ? 4 : 3;
    const bot = x === 0 ? 26 : x === WORLD_W - 1 ? 28 : 27;
    paint(x, 0, top);
    paint(x, WORLD_H - 1, bot);
  }
  for (let y = 1; y < WORLD_H - 1; y++) {
    paint(0, y, 14);
    paint(WORLD_W - 1, y, 16);
  }

  // Hand-placed ruins, rocks, and a fenced camp. Scatter fills the rest.
  building(tiles, 22, 14, 12, 9, FLOOR_IN, [{ x: 28, y: 22 }]);
  building(tiles, 96, 14, 14, 10, FLOOR_IN, [{ x: 96, y: 19 }]);
  for (let x = 100; x <= 112; x++) paint(x, 78, 90);
  for (let y = 74; y <= 78; y++) {
    paint(100, y, 90);
    paint(112, y, 90);
  }
  paint(106, 78, FLOOR_OUT);

  const rocks: [number, number][] = [
    [18, 30], [19, 30], [34, 28], [88, 30], [110, 36], [18, 78], [30, 84], [90, 86], [116, 64],
  ];
  for (const [x, y] of rocks) paint(x, y, 11);

  const spawns: MonsterSpawn[] = [
    { monsterId: 0, tx: 50, ty: 64 },
    { monsterId: 0, tx: 44, ty: 70 },
    { monsterId: 0, tx: 58, ty: 68 },
    { monsterId: 0, tx: 36, ty: 78 },
    { monsterId: 6, tx: 62, ty: 80 },
    { monsterId: 6, tx: 74, ty: 86 },
    { monsterId: 7, tx: 86, ty: 74 },
    { monsterId: 8, tx: 28, ty: 82 },
    { monsterId: 4, tx: 96, ty: 50 },
    { monsterId: 4, tx: 108, ty: 42 },
    { monsterId: 6, tx: 114, ty: 56 },
    { monsterId: 2, tx: 104, ty: 70 },
    { monsterId: 2, tx: 116, ty: 84 },
    { monsterId: 1, tx: 18, ty: 18 },
    { monsterId: 3, tx: 30, ty: 20 },
    { monsterId: 4, tx: 16, ty: 32 },
    { monsterId: 5, tx: 104, ty: 22 },
    { monsterId: 5, tx: 112, ty: 30 },
    { monsterId: 3, tx: 24, ty: 62 },
    { monsterId: 6, tx: 34, ty: 36 },
  ];
  const spawnAt = new Set(spawns.map((s) => s.tx + ',' + s.ty));
  scatter(tiles, spawnAt);

  // East-west road through town doors, crypt, and the pit. North-south road out the south gate.
  for (let x = 22; x <= 69; x++) paint(x, 50, ROAD);
  for (let y = 60; y <= 74; y++) paint(50, y, ROAD);

  building(tiles, TOWN.x, TOWN.y, TOWN.w, TOWN.h, FLOOR_IN, [
    { x: 61, y: 50 },
    { x: 40, y: 50 },
    { x: 50, y: 59 },
    { x: 50, y: 42 },
  ]);
  building(tiles, 44, 44, 12, 5, FLOOR_IN, [{ x: 50, y: 48 }]);
  building(tiles, 42, 52, 7, 6, FLOOR_IN, [{ x: 48, y: 54 }]);
  building(tiles, 53, 52, 7, 6, FLOOR_IN, [{ x: 53, y: 54 }]);
  paint(46, 46, 75);
  paint(47, 46, 72);
  paint(56, 46, 82);
  paint(44, 54, 74);
  paint(57, 54, 72);
  // Square around the crossroads, off the roads so three heroes can stand on y=50.
  paint(46, 49, 72);
  paint(54, 49, 82);
  paint(46, 51, 74);
  paint(54, 51, 72);

  building(tiles, PVP_PIT.x, PVP_PIT.y, PVP_PIT.w, PVP_PIT.h, FLOOR_IN, [{ x: PVP_PIT.x, y: 50 }]);
  paint(PVP_PIT.x, 46, BANNER);
  paint(PVP_PIT.x, 54, BANNER);
  paint(PVP_PIT.x + PVP_PIT.w - 1, 44, BANNER);
  paint(PVP_PIT.x + PVP_PIT.w - 1, 57, BANNER);

  building(tiles, 8, 44, 14, 12, FLOOR_IN, [{ x: 21, y: 50 }]);
  paint(CRYPT_STAIRS.x, CRYPT_STAIRS.y, STAIRS);
  paint(15, 48, 64);

  const solid = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) solid[i] = tileIsSolid(tiles[i]) ? 1 : 0;

  return { tiles, solid, spawns };
}

function building(
  tiles: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  floor: number,
  doors: { x: number; y: number }[],
): void {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) continue;
      const L = tx === x;
      const R = tx === x + w - 1;
      const T = ty === y;
      const B = ty === y + h - 1;
      let tile = floor;
      if (!L && !R && !T && !B && floor === FLOOR_IN) {
        const h = (Math.imul(tx, 2246822519) ^ Math.imul(ty, 3266489917)) >>> 0;
        if (h % 4 === 0) tile = 1;
      }
      if (L || R || T || B) {
        if (T && L) tile = 2;
        else if (T && R) tile = 4;
        else if (B && L) tile = 26;
        else if (B && R) tile = 28;
        else if (T) tile = 3;
        else if (B) tile = 27;
        else if (L) tile = 14;
        else tile = 16;
      }
      tiles[idx(tx, ty)] = tile;
    }
  }
  for (const d of doors) {
    if (d.x < 0 || d.y < 0 || d.x >= WORLD_W || d.y >= WORLD_H) continue;
    tiles[idx(d.x, d.y)] = DOOR;
  }
}

function scatter(tiles: Uint8Array, spawnAt: Set<string>): void {
  for (let y = 2; y < WORLD_H - 2; y++) {
    for (let x = 2; x < WORLD_W - 2; x++) {
      if (tiles[idx(x, y)] !== FLOOR_OUT) continue;
      if (y === 50 && x >= 14 && x <= 90) continue;
      if (x === 50 && y >= 48 && y <= 78) continue;
      const h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
      // 48 and 49 are the walkable sand. 60/61 are blank white frames, so they stay unused.
      if (h % 3 === 0) tiles[idx(x, y)] = 49;
      const around = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].every(([dx, dy]) => tiles[idx(x + dx, y + dy)] === FLOOR_OUT || tiles[idx(x + dx, y + dy)] === 49);
      if (h % 37 === 0 && around && !spawnAt.has(x + ',' + y)) tiles[idx(x, y)] = 11;
    }
  }
}

export function solidAtOf(world: WorldData): (tx: number, ty: number) => boolean {
  return (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    return world.solid[ty * WORLD_W + tx] === 1;
  };
}

export function chunkTiles(world: WorldData, cx: number, cy: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK);
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  let o = 0;
  for (let y = 0; y < CHUNK; y++) {
    const row = (y0 + y) * WORLD_W + x0;
    for (let x = 0; x < CHUNK; x++) out[o++] = world.tiles[row + x];
  }
  return out;
}

export function validateWorld(world: WorldData): string[] {
  const errors: string[] = [];
  const solidAt = solidAtOf(world);
  const seen = new Uint8Array(WORLD_W * WORLD_H);
  const qx = [SPAWN_TILE.x];
  const qy = [SPAWN_TILE.y];
  if (solidAt(SPAWN_TILE.x, SPAWN_TILE.y)) errors.push('spawn is solid');
  if (zoneAtTile(SPAWN_TILE.x, SPAWN_TILE.y) !== 'safe') errors.push('spawn is not safe');
  let qh = 0;
  while (qh < qx.length) {
    const x = qx[qh];
    const y = qy[qh];
    qh++;
    const i = idx(x, y);
    if (seen[i]) continue;
    seen[i] = 1;
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of steps) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
      if (solidAt(nx, ny)) continue;
      if (!seen[idx(nx, ny)]) {
        qx.push(nx);
        qy.push(ny);
      }
    }
  }
  const must: [number, number, string][] = [
    [78, 50, 'pvp center'],
    [CRYPT_STAIRS.x, CRYPT_STAIRS.y, 'crypt stairs'],
    [50, 64, 'gate slime'],
  ];
  for (const s of world.spawns) must.push([s.tx, s.ty, `spawn ${s.monsterId}@${s.tx},${s.ty}`]);
  for (const [x, y, label] of must) {
    if (solidAt(x, y)) errors.push(label + ' is solid');
    if (!seen[idx(x, y)]) errors.push(label + ' is unreachable');
  }
  if (zoneAtTile(78, 50) !== 'pvp') errors.push('pvp center is not pvp');
  if (zoneAtTile(69, 50) === 'pvp') errors.push('tile west of the pit is already pvp');
  if (world.tiles[idx(CRYPT_STAIRS.x, CRYPT_STAIRS.y)] !== STAIRS) errors.push('stairs tile missing');
  return errors;
}
