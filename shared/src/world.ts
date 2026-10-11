import { CHUNK, WORLD_H, WORLD_W } from './constants.ts';
import {
  BANNER,
  BUSH,
  CAMPFIRE,
  DUNGEON,
  DOOR,
  FENCE,
  FENCE_L,
  FENCE_R,
  FLOWER_GRASS,
  GRASS,
  GRASS_B,
  HOUSE_EAVE,
  HOUSE_ROOF,
  HOUSE_WALL,
  MUSHROOM,
  STALL,
  PEBBLE,
  POST,
  RED_BUSH,
  ROCK,
  SIGN,
  TREE,
  TREE_ROUND,
  TREE_SMALL,
  TREE_TRUNK,
  WELL,
  tileIsSolid,
} from './tiles.ts';
import { CRYPT_STAIRS, PVP_PIT, SPAWN_TILE, TOWN, zoneAtTile } from './zones.ts';

export interface MonsterSpawn {
  monsterId: number;
  tx: number;
  ty: number;
}

export interface WorldData {
  tiles: Uint8Array;
  objects: Uint8Array;
  solid: Uint8Array;
  spawns: MonsterSpawn[];
}

const FLOOR_D = DUNGEON + 0;
const FLOOR_D2 = DUNGEON + 1;
const WALL_D = DUNGEON + 40;
const STAIRS = DUNGEON + 56;
const BANNER_D = DUNGEON + 29;

const TREES = [TREE, TREE_TRUNK, TREE_SMALL, TREE_ROUND];

function idx(tx: number, ty: number): number {
  return ty * WORLD_W + tx;
}

function hash(x: number, y: number): number {
  return (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
}

function key(x: number, y: number): string {
  return x + ',' + y;
}

export function buildWorld(): WorldData {
  const tiles = new Uint8Array(WORLD_W * WORLD_H);
  const objects = new Uint8Array(WORLD_W * WORLD_H);
  tiles.fill(GRASS);

  const path = new Set<string>();
  const water = new Set<string>();

  const spine: [number, number][] = [];
  for (let x = 18; x <= 78; x++) spine.push([x, 50]);
  for (let y = 46; y <= 80; y++) spine.push([50, y]);
  for (const [x, y] of spine) {
    path.add(key(x, y));
    path.add(key(x + 1, y));
    path.add(key(x - 1, y));
    path.add(key(x, y + 1));
    path.add(key(x, y - 1));
  }

  for (let y = PVP_PIT.y + 1; y < PVP_PIT.y + PVP_PIT.h - 1; y++) {
    for (let x = PVP_PIT.x + 1; x < PVP_PIT.x + PVP_PIT.w - 1; x++) path.add(key(x, y));
  }

  for (let y = 8; y <= 88; y++) {
    for (let x = 28; x <= 32; x++) {
      if (path.has(key(x, y))) continue;
      water.add(key(x, y));
    }
  }
  for (let y = 22; y <= 32; y++) {
    for (let x = 90; x <= 102; x++) {
      const dx = (x - 96) / 6;
      const dy = (y - 27) / 5;
      if (dx * dx + dy * dy > 1) continue;
      if (path.has(key(x, y))) continue;
      water.add(key(x, y));
    }
  }

  const isPath = (x: number, y: number) => path.has(key(x, y));
  const isWater = (x: number, y: number) => water.has(key(x, y));

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (isWater(x, y)) {
        tiles[idx(x, y)] = waterTile(x, y, isWater);
        continue;
      }
      if (isPath(x, y)) tiles[idx(x, y)] = pathTile(x, y, isPath);
    }
  }

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const i = idx(x, y);
      if (tiles[i] !== GRASS) continue;
      const h = hash(x, y);
      const nearWater =
        isWater(x + 1, y) || isWater(x - 1, y) || isWater(x, y + 1) || isWater(x, y - 1);
      if (nearWater && h % 3 === 0) tiles[i] = 43;
      else if (h % 7 === 0) tiles[i] = FLOWER_GRASS;
      else if (h % 5 === 0) tiles[i] = GRASS_B;
    }
  }

  paintCrypt(tiles, objects);
  paintVillage(tiles, objects);
  paintPit(objects);
  paintWilds(tiles, objects, path, water);

  const spawns = nudgeSpawns(tiles, objects, baseSpawns());

  const solid = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    solid[i] = tileIsSolid(objects[i]) || tileIsSolid(tiles[i]) ? 1 : 0;
  }
  return { tiles, objects, solid, spawns };
}

function pathTile(x: number, y: number, isPath: (x: number, y: number) => boolean): number {
  const n = isPath(x, y - 1);
  const e = isPath(x + 1, y);
  const s = isPath(x, y + 1);
  const w = isPath(x - 1, y);
  if (!n && !w) return 12;
  if (!n && !e) return 14;
  if (!s && !w) return 36;
  if (!s && !e) return 38;
  if (!n) return 13;
  if (!s) return 37;
  if (!w) return 24;
  if (!e) return 26;
  if (!isPath(x + 1, y - 1)) return 40;
  if (!isPath(x - 1, y - 1)) return 39;
  if (!isPath(x + 1, y + 1)) return 41;
  if (!isPath(x - 1, y + 1)) return 42;
  return 25;
}

function waterTile(x: number, y: number, isWater: (x: number, y: number) => boolean): number {
  // Shore rim sits on the land side of each tile. 60/62 are the south corners,
  // 61 is the south edge, 76/79 are the west/east edges. 63 is a boat, not a shore.
  const n = isWater(x, y - 1);
  const e = isWater(x + 1, y);
  const s = isWater(x, y + 1);
  const w = isWater(x - 1, y);
  if (!n && !w) return 48;
  if (!n && !e) return 50;
  if (!s && !w) return 60;
  if (!s && !e) return 62;
  if (!n) return 49;
  if (!s) return 61;
  if (!w) return 76;
  if (!e) return 79;
  return hash(x, y) % 4 === 0 ? 77 : 126;
}

function paintCrypt(tiles: Uint8Array, objects: Uint8Array): void {
  const x0 = 8;
  const y0 = 44;
  const w = 14;
  const h = 12;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      const door = x === 21 && y === 50;
      tiles[idx(x, y)] = edge && !door ? WALL_D : hash(x, y) % 4 === 0 ? FLOOR_D2 : FLOOR_D;
      objects[idx(x, y)] = 0;
    }
  }
  tiles[idx(CRYPT_STAIRS.x, CRYPT_STAIRS.y)] = STAIRS;
  objects[idx(15, 48)] = BANNER_D;
  objects[idx(13, 48)] = BANNER_D;
}

function paintVillage(tiles: Uint8Array, objects: Uint8Array): void {
  // Houses sit just off the 3-wide crossroads so a zoom-3 phone sees roofs at spawn.
  house(objects, 40, 43);
  house(objects, 46, 43);
  house(objects, 52, 43);
  house(objects, 56, 43);
  house(objects, 40, 53);
  house(objects, 46, 53);
  house(objects, 52, 53);
  house(objects, 56, 53);
  objects[idx(48, 47)] = WELL;
  objects[idx(46, 46)] = SIGN;
  objects[idx(53, 47)] = CAMPFIRE;
  objects[idx(54, 56)] = CAMPFIRE;
  objects[idx(48, 46)] = BUSH;
  objects[idx(52, 46)] = RED_BUSH;
  objects[idx(54, 48)] = MUSHROOM;
  objects[idx(45, 42)] = TREE;
  objects[idx(55, 42)] = TREE_ROUND;
  objects[idx(44, 56)] = TREE_SMALL;
  objects[idx(58, 57)] = TREE;
  stall(objects, 46, 57);
  objects[idx(47, 58)] = PEBBLE;
  objects[idx(55, 46)] = FENCE;
  objects[idx(55, 47)] = POST;
  for (let y = 42; y <= 58; y++) {
    for (let x = 41; x <= 59; x++) {
      const i = idx(x, y);
      if (tiles[i] !== GRASS && tiles[i] !== GRASS_B) continue;
      if (objects[i] !== 0) continue;
      if (hash(x, y) % 4 === 0) tiles[i] = FLOWER_GRASS;
    }
  }
}

function house(objects: Uint8Array, x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    objects[idx(x + i, y)] = HOUSE_ROOF[i];
    objects[idx(x + i, y + 1)] = HOUSE_EAVE[i];
    objects[idx(x + i, y + 2)] = HOUSE_WALL[i];
  }
}

function stall(objects: Uint8Array, x: number, y: number): void {
  for (let i = 0; i < 3; i++) objects[idx(x + i, y)] = STALL[i];
}

function paintPit(objects: Uint8Array): void {
  const x0 = PVP_PIT.x + 1;
  const y0 = PVP_PIT.y + 1;
  const x1 = PVP_PIT.x + PVP_PIT.w - 2;
  const y1 = PVP_PIT.y + PVP_PIT.h - 2;
  for (let x = x0; x <= x1; x++) {
    objects[idx(x, y0)] = x === x0 ? FENCE_L : x === x1 ? FENCE_R : FENCE;
    objects[idx(x, y1)] = x === x0 ? FENCE_L : x === x1 ? FENCE_R : FENCE;
  }
  for (let y = y0 + 1; y < y1; y++) {
    const gate = y >= 49 && y <= 51;
    if (!gate) objects[idx(x0, y)] = POST;
    objects[idx(x1, y)] = POST;
  }
  objects[idx(x0 + 2, y0 + 1)] = BANNER;
  objects[idx(x1 - 2, y0 + 1)] = BANNER;
  objects[idx(74, 52)] = ROCK;
  objects[idx(80, 52)] = PEBBLE;
  objects[idx(76, 54)] = RED_BUSH;
  objects[idx(74, 48)] = DUNGEON + 61;
  objects[idx(81, 49)] = DUNGEON + 60;
  objects[idx(78, 47)] = DUNGEON + 62;
  objects[idx(82, 53)] = DUNGEON + 61;
  objects[idx(75, 54)] = DUNGEON + 60;
  objects[idx(79, 55)] = DUNGEON + 62;
  objects[idx(74, 55)] = BANNER;
  objects[idx(82, 55)] = BANNER;
}

function paintWilds(tiles: Uint8Array, objects: Uint8Array, path: Set<string>, water: Set<string>): void {
  const spawnAt = new Set(baseSpawns().map((s) => key(s.tx, s.ty)));
  const blocked = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= WORLD_W - 1 || y >= WORLD_H - 1) return true;
    if (path.has(key(x, y)) || water.has(key(x, y))) return true;
    if (objects[idx(x, y)] !== 0) return true;
    if (tiles[idx(x, y)] >= DUNGEON) return true;
    if (x >= TOWN.x && x < TOWN.x + TOWN.w && y >= TOWN.y && y < TOWN.y + TOWN.h) return true;
    if (x >= PVP_PIT.x && x < PVP_PIT.x + PVP_PIT.w && y >= PVP_PIT.y && y < PVP_PIT.y + PVP_PIT.h) return true;
    if (spawnAt.has(key(x, y))) return true;
    return false;
  };
  const nearPath = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) if (path.has(key(x + dx, y + dy))) return true;
    }
    return false;
  };

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const border = x <= 2 || y <= 2 || x >= WORLD_W - 3 || y >= WORLD_H - 3;
      if (border) {
        if (!path.has(key(x, y)) && tiles[idx(x, y)] < DUNGEON) objects[idx(x, y)] = hash(x, y) % 3 === 0 ? TREE_TRUNK : TREE;
        continue;
      }
      if (blocked(x, y) || nearPath(x, y)) continue;
      const h = hash(x, y);
      if (h % 17 === 0) {
        const clump: [number, number][] = [
          [0, 0],
          [1, 0],
          [0, 1],
          [-1, 0],
          [1, 1],
          [-1, 1],
        ];
        for (const [dx, dy] of clump) {
          const nx = x + dx;
          const ny = y + dy;
          if (blocked(nx, ny) || nearPath(nx, ny)) continue;
          if (dx !== 0 && hash(nx, ny) % 3 === 0) continue;
          const pick = hash(nx, ny) % 6;
          objects[idx(nx, ny)] = pick === 0 ? BUSH : pick === 1 ? 22 : TREES[pick % TREES.length];
        }
      } else if (h % 29 === 0) {
        objects[idx(x, y)] = ROCK;
      } else if (h % 11 === 0) {
        objects[idx(x, y)] = h % 3 === 0 ? MUSHROOM : h % 2 === 0 ? FLOWER_GRASS : RED_BUSH;
      }
    }
  }
}

function baseSpawns(): MonsterSpawn[] {
  return [
    { monsterId: 0, tx: 50, ty: 64 },
    { monsterId: 0, tx: 44, ty: 70 },
    { monsterId: 0, tx: 58, ty: 68 },
    { monsterId: 0, tx: 36, ty: 78 },
    { monsterId: 6, tx: 62, ty: 80 },
    { monsterId: 6, tx: 74, ty: 86 },
    { monsterId: 7, tx: 86, ty: 74 },
    { monsterId: 8, tx: 22, ty: 70 },
    { monsterId: 4, tx: 96, ty: 50 },
    { monsterId: 4, tx: 108, ty: 42 },
    { monsterId: 6, tx: 114, ty: 56 },
    { monsterId: 2, tx: 104, ty: 70 },
    { monsterId: 2, tx: 116, ty: 84 },
    { monsterId: 1, tx: 18, ty: 18 },
    { monsterId: 3, tx: 36, ty: 22 },
    { monsterId: 4, tx: 16, ty: 32 },
    { monsterId: 5, tx: 104, ty: 22 },
    { monsterId: 5, tx: 112, ty: 30 },
    { monsterId: 3, tx: 24, ty: 62 },
    { monsterId: 6, tx: 40, ty: 36 },
  ];
}

function nudgeSpawns(tiles: Uint8Array, objects: Uint8Array, spawns: MonsterSpawn[]): MonsterSpawn[] {
  return spawns.map((s) => {
    if (!occupied(tiles, objects, s.tx, s.ty)) return s;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = s.tx + dx;
          const y = s.ty + dy;
          if (occupied(tiles, objects, x, y)) continue;
          if (zoneAtTile(x, y) === 'safe') continue;
          return { ...s, tx: x, ty: y };
        }
      }
    }
    return s;
  });
}

function occupied(tiles: Uint8Array, objects: Uint8Array, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= WORLD_W - 1 || y >= WORLD_H - 1) return true;
  return tileIsSolid(objects[idx(x, y)]) || tileIsSolid(tiles[idx(x, y)]);
}

export function solidAtOf(world: WorldData): (tx: number, ty: number) => boolean {
  return (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    return world.solid[ty * WORLD_W + tx] === 1;
  };
}

export function chunkSlice(world: WorldData, cx: number, cy: number): { ground: Uint8Array; object: Uint8Array } {
  const ground = new Uint8Array(CHUNK * CHUNK);
  const object = new Uint8Array(CHUNK * CHUNK);
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  let o = 0;
  for (let y = 0; y < CHUNK; y++) {
    const row = (y0 + y) * WORLD_W + x0;
    for (let x = 0; x < CHUNK; x++) {
      ground[o] = world.tiles[row + x];
      object[o] = world.objects[row + x];
      o++;
    }
  }
  return { ground, object };
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
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
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
