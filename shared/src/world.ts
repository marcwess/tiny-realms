import { CHUNK, TILE_SUB, WORLD_H, WORLD_W } from './constants.ts';
import { blocked } from './sim.ts';
import {
  BRIDGE,
  BRIDGE_N,
  BRIDGE_S,
  BUSH,
  PIT_BANNER,
  GRAVE_STONE,
  LILY,
  PEBBLE,
  TARGET,
  TREE_AUTUMN,
  TREE_AUTUMN_B,
  PINE_TOP,
  PINE_TOP_AUTUMN,
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
  POST,
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

const TREES = [TREE, TREE_TRUNK, TREE_ROUND, TREE_AUTUMN, TREE_AUTUMN_B];

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

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 28; x <= 32; x++) {
      if (path.has(key(x, y))) continue;
      water.add(key(x, y));
    }
  }
  for (let y = 22; y <= 32; y++) {
    for (let x = 90; x <= 102; x++) {
      const dx = (x - 96) / 6;
      const dy = (y - 27) / 5;
      // Slightly inside the unit circle so no single-tile nub sticks out at the poles.
      if (dx * dx + dy * dy > 0.92) continue;
      if (path.has(key(x, y))) continue;
      water.add(key(x, y));
    }
  }

  const isPath = (x: number, y: number) => path.has(key(x, y));
  // Off-map rows count as water so the river runs out of the frame instead of ending in a bank.
  const isWater = (x: number, y: number) => water.has(key(x, Math.max(0, Math.min(WORLD_H - 1, y))));

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (isWater(x, y)) {
        tiles[idx(x, y)] = waterTile(x, y, isWater);
        continue;
      }
      if (isPath(x, y)) tiles[idx(x, y)] = x >= 28 && x <= 32 ? bridgeTile(x, y, isPath) : pathTile(x, y, isPath);
    }
  }

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const i = idx(x, y);
      if (tiles[i] !== GRASS) continue;
      const h = hash(x, y);
      const nearWater =
        isWater(x + 1, y) || isWater(x - 1, y) || isWater(x, y + 1) || isWater(x, y - 1);
      if (nearWater && h % 7 === 0) tiles[i] = 43;
      else if (h % 29 === 0 && hash(x + 1, y) % 2 === 0) tiles[i] = FLOWER_GRASS;
      else if (h % 5 === 0) tiles[i] = GRASS_B;
    }
  }

  paintCrypt(tiles, objects);
  paintVillage(tiles, objects);
  paintPit(objects);
  paintWilds(tiles, objects, path, water);
  paintDecor(tiles, objects, water);

  const spawns = nudgeSpawns(tiles, objects, baseSpawns());

  const solid = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    solid[i] = tileIsSolid(objects[i]) || tileIsSolid(tiles[i]) ? 1 : 0;
  }
  return { tiles, objects, solid, spawns };
}

function bridgeTile(x: number, y: number, isPath: (x: number, y: number) => boolean): number {
  if (!isPath(x, y - 1)) return BRIDGE_N;
  if (!isPath(x, y + 1)) return BRIDGE_S;
  return BRIDGE;
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
  objects[idx(49, 45)] = BUSH;
  objects[idx(52, 46)] = TREE_AUTUMN_B;
  objects[idx(54, 48)] = MUSHROOM;
  objects[idx(45, 42)] = TREE;
  objects[idx(55, 42)] = TREE_ROUND;
  objects[idx(44, 56)] = TREE_SMALL;
  objects[idx(58, 57)] = TREE;
  stall(objects, 46, 57);
  objects[idx(47, 58)] = MUSHROOM;
  // A short rail by the campfire (a lone rail piece over a post read as a broken sign).
  objects[idx(54, 46)] = FENCE_L;
  objects[idx(55, 46)] = FENCE;
  objects[idx(56, 46)] = FENCE_R;
  for (let y = 42; y <= 58; y++) {
    for (let x = 41; x <= 59; x++) {
      const i = idx(x, y);
      if (tiles[i] !== GRASS && tiles[i] !== GRASS_B) continue;
      if (objects[i] !== 0) continue;
      if (hash(x, y) % 13 === 0) tiles[i] = FLOWER_GRASS;
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
  objects[idx(x0 + 2, y0 + 1)] = PIT_BANNER;
  objects[idx(x1 - 2, y0 + 1)] = PIT_BANNER;
  objects[idx(74, 52)] = TARGET;
  objects[idx(80, 52)] = GRAVE_STONE;
  objects[idx(76, 54)] = TARGET;
  objects[idx(74, 48)] = GRAVE_STONE;
  objects[idx(81, 49)] = GRAVE_STONE;
  objects[idx(78, 47)] = GRAVE_STONE;
  objects[idx(82, 53)] = GRAVE_STONE;
  objects[idx(79, 55)] = GRAVE_STONE;
  objects[idx(74, 55)] = PIT_BANNER;
  objects[idx(82, 55)] = PIT_BANNER;
}

function paintDecor(tiles: Uint8Array, objects: Uint8Array, water: Set<string>): void {
  for (let y = 1; y < WORLD_H - 1; y++) {
    for (let x = 1; x < WORLD_W - 1; x++) {
      const i = idx(x, y);
      if (objects[i] !== 0) continue;
      const h = hash(x, y + 9);
      if (water.has(key(x, y))) {
        if (h % 11 === 0) objects[i] = LILY;
        continue;
      }
      const bank =
        water.has(key(x + 1, y)) || water.has(key(x - 1, y)) || water.has(key(x, y + 1)) || water.has(key(x, y - 1));
      const ground = tiles[i];
      if (bank && (ground === GRASS || ground === GRASS_B || ground === 43) && h % 9 === 0) objects[i] = PEBBLE;
    }
  }
}

/** Smooth value noise in [0, 1). Lattice spacing is `scale` tiles. */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = fx - x0;
  const sy = fy - y0;
  const u = sx * sx * (3 - 2 * sx);
  const v = sy * sy * (3 - 2 * sy);
  const at = (ix: number, iy: number) => (hash(ix * 7 + seed, iy * 13 - seed) % 1000) / 1000;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * u;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * u;
  return a + (b - a) * v;
}

/**
 * Tiny Town's 3x3 forest block: 7 is the top row of crowns, 19 the dense middle,
 * 31 the trunk row, 18 / 20 the left / right sides. The block corners (6, 8, 30, 32)
 * stick out past the clump, so corner cells are left as open grass instead.
 */
const FOREST_GREEN = { top: 7, mid: 19, bottom: 31, left: 18, right: 20 };
const FOREST_AUTUMN = { top: 10, mid: 22, bottom: 34, left: 21, right: 23 };
/** Wood where the noise is above this; open lanes follow the 0.5 contour of a second field. */
const WOOD_T = 0.48;
const LANE_W = 0.07;

function paintWilds(tiles: Uint8Array, objects: Uint8Array, path: Set<string>, water: Set<string>): void {
  const spawnAt = baseSpawns();
  const nearCamp = (x: number, y: number, r: number) => spawnAt.some((s) => Math.abs(s.tx - x) <= r && Math.abs(s.ty - y) <= r);
  const reserved = (x: number, y: number) => {
    if (path.has(key(x, y)) || water.has(key(x, y))) return true;
    if (objects[idx(x, y)] !== 0) return true;
    if (tiles[idx(x, y)] >= DUNGEON) return true;
    if (x >= TOWN.x - 1 && x < TOWN.x + TOWN.w + 1 && y >= TOWN.y - 1 && y < TOWN.y + TOWN.h + 1) return true;
    if (x >= PVP_PIT.x - 1 && x < PVP_PIT.x + PVP_PIT.w + 1 && y >= PVP_PIT.y - 1 && y < PVP_PIT.y + PVP_PIT.h + 1) return true;
    return false;
  };
  const near = (x: number, y: number, r: number, f: (x: number, y: number) => boolean) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (f(x + dx, y + dy)) return true;
    return false;
  };
  const isPath = (x: number, y: number) => path.has(key(x, y));
  const isWater = (x: number, y: number) => water.has(key(x, y));

  // 1. Forest mask: low-frequency noise for the woods, a second field whose
  //    contour lines become winding lanes, and open clearings around camps.
  const forest = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (reserved(x, y)) continue;
      const border = x <= 2 || y <= 2 || x >= WORLD_W - 3 || y >= WORLD_H - 3;
      if (border) {
        forest[idx(x, y)] = 1;
        continue;
      }
      if (near(x, y, 2, isPath) || near(x, y, 1, isWater) || nearCamp(x, y, 4)) continue;
      const wood = valueNoise(x, y, 11, 3) * 0.65 + valueNoise(x, y, 5, 17) * 0.35;
      const lane = Math.abs(valueNoise(x, y, 15, 41) - 0.5);
      if (wood > WOOD_T && lane > LANE_W) forest[idx(x, y)] = 1;
    }
  }
  const inForest = (x: number, y: number) => x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H || forest[idx(x, y)] === 1;

  // 2. Every camp must be reachable from town: cut a 2-wide trail through the
  //    wood where the flood from spawn cannot get in.
  const solidNow = (x: number, y: number) =>
    inForest(x, y) || tileIsSolid(objects[idx(x, y)]) || tileIsSolid(tiles[idx(x, y)]);
  for (const camp of spawnAt) {
    const seen = new Uint8Array(WORLD_W * WORLD_H);
    const q = [idx(SPAWN_TILE.x, SPAWN_TILE.y)];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const x = q[h] % WORLD_W;
      const y = Math.floor(q[h] / WORLD_W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H || solidNow(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    const start = idx(camp.tx, camp.ty);
    if (seen[start]) continue;
    const prev = new Int32Array(WORLD_W * WORLD_H).fill(-1);
    const bq = [start];
    prev[start] = start;
    let hit = -1;
    for (let h = 0; h < bq.length && hit < 0; h++) {
      const x = bq[h] % WORLD_W;
      const y = Math.floor(bq[h] / WORLD_W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 3 || ny < 3 || nx >= WORLD_W - 3 || ny >= WORLD_H - 3) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -1) continue;
        if (tileIsSolid(tiles[ni]) || tileIsSolid(objects[ni])) continue;
        prev[ni] = bq[h];
        if (seen[ni]) {
          hit = ni;
          break;
        }
        bq.push(ni);
      }
    }
    for (let cur = hit, guard = 0; cur >= 0 && guard < 600; guard++) {
      const x = cur % WORLD_W;
      const y = Math.floor(cur / WORLD_W);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        if (x + dx < WORLD_W - 3 && y + dy < WORLD_H - 3) forest[idx(x + dx, y + dy)] = 0;
      }
      if (cur === start) break;
      cur = prev[cur];
    }
  }

  // 3. The block art needs at least 3 cells of wood across in both axes (crowns,
  //    a middle row, trunks). Thinner strands are opened up (this only frees ground).
  const run = (x: number, y: number, dx: number, dy: number) => {
    let n = 1;
    for (let k = 1; k < 3 && inForest(x + dx * k, y + dy * k); k++) n++;
    for (let k = 1; k < 3 && inForest(x - dx * k, y - dy * k); k++) n++;
    return n;
  };
  for (let pass = 0; pass < 12; pass++) {
    let changed = 0;
    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (!forest[idx(x, y)]) continue;
        if (run(x, y, 1, 0) < 3 || run(x, y, 0, 1) < 3) {
          forest[idx(x, y)] = 0;
          changed++;
        }
      }
    }
    if (!changed) break;
  }

  // 4. Autotile. Each connected wood is either green or autumn; the outer ring
  //    and anything touching it stays green so the map edge reads as one wall.
  const tone = new Uint8Array(WORLD_W * WORLD_H);
  for (let i = 0; i < forest.length; i++) {
    if (!forest[i] || tone[i]) continue;
    const ox = i % WORLD_W;
    const oy = Math.floor(i / WORLD_W);
    const q = [i];
    let pick = hash(ox, oy) % 3 === 0 ? 2 : 1;
    tone[i] = 3;
    for (let h = 0; h < q.length; h++) {
      const x = q[h] % WORLD_W;
      const y = Math.floor(q[h] / WORLD_W);
      if (x <= 2 || y <= 2 || x >= WORLD_W - 3 || y >= WORLD_H - 3) pick = 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        const ni = idx(nx, ny);
        if (!forest[ni] || tone[ni]) continue;
        tone[ni] = 3;
        q.push(ni);
      }
    }
    for (const c of q) tone[c] = pick;
  }
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const i = idx(x, y);
      if (!forest[i]) continue;
      const set = tone[i] === 2 ? FOREST_AUTUMN : FOREST_GREEN;
      const n = inForest(x, y - 1);
      const s = inForest(x, y + 1);
      const w = inForest(x - 1, y);
      const e = inForest(x + 1, y);
      // Outer corners stay open grass: the neighbouring edge pieces already round the clump off.
      if ((!n || !s) && (!w || !e)) continue;
      objects[i] = !n ? set.top : !s ? set.bottom : !w ? set.left : !e ? set.right : set.mid;
    }
  }
  // Corner cells were left out above; drop them from the mask so step 5 treats them as open.
  for (let i = 0; i < forest.length; i++) if (forest[i] && objects[i] === 0) forest[i] = 0;

  // 5. Loose trees and undergrowth on the open ground, thicker near the wood edge.
  for (let y = 3; y < WORLD_H - 3; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      if (forest[idx(x, y)] || reserved(x, y)) continue;
      if (near(x, y, 1, isPath) || near(x, y, 1, isWater) || nearCamp(x, y, 2)) continue;
      // Leave a free ring so the loose trees never pinch a lane shut.
      if (near(x, y, 1, (ax, ay) => forest[idx(ax, ay)] === 1)) continue;
      const edge = near(x, y, 2, (ax, ay) => forest[idx(ax, ay)] === 1);
      const h = hash(x, y);
      if (h % (edge ? 9 : 41) !== 0) continue;
      if (near(x, y, 1, (ax, ay) => objects[idx(ax, ay)] !== 0)) continue;
      const pick = hash(x + 5, y) % 7;
      const placed = pick === 0 ? BUSH : pick === 1 ? MUSHROOM : TREES[pick % TREES.length];
      objects[idx(x, y)] = placed;
      if ((placed === TREE_AUTUMN || placed === TREE_ROUND) && hash(x, y + 3) % 2 === 0 && objects[idx(x, y - 1)] === 0 && !reserved(x, y - 1)) {
        objects[idx(x, y - 1)] = placed === TREE_AUTUMN ? PINE_TOP_AUTUMN : PINE_TOP;
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

/** Tiles a body can stand on and walk to from the town spawn. */
export function reachableFromSpawn(world: WorldData): Uint8Array {
  const solidAt = solidAtOf(world);
  const seen = new Uint8Array(WORLD_W * WORLD_H);
  const q = [idx(SPAWN_TILE.x, SPAWN_TILE.y)];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % WORLD_W;
    const y = Math.floor(q[h] / WORLD_W);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
      const i = idx(nx, ny);
      if (seen[i] || solidAt(nx, ny)) continue;
      seen[i] = 1;
      q.push(i);
    }
  }
  return seen;
}

/**
 * A saved position from an older map can sit inside a tree, a house or the
 * river now. Keep it if the body is free and connected to town; otherwise move
 * to the nearest open tile centre within 8 tiles, or null (use the spawn).
 */
export function openSpotNear(world: WorldData, reach: Uint8Array, x: number, y: number): { x: number; y: number } | null {
  const solidAt = solidAtOf(world);
  const ok = (px: number, py: number) => {
    const tx = Math.floor(px / TILE_SUB);
    const ty = Math.floor(py / TILE_SUB);
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return false;
    return reach[idx(tx, ty)] === 1 && !blocked(px, py, solidAt);
  };
  if (Number.isFinite(x) && Number.isFinite(y) && ok(x, y)) return { x, y };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tx0 = Math.floor(x / TILE_SUB);
  const ty0 = Math.floor(y / TILE_SUB);
  for (let r = 1; r <= 8; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let ty = ty0 - r; ty <= ty0 + r; ty++) {
      for (let tx = tx0 - r; tx <= tx0 + r; tx++) {
        if (Math.max(Math.abs(tx - tx0), Math.abs(ty - ty0)) !== r) continue;
        const px = tx * TILE_SUB + TILE_SUB / 2;
        const py = ty * TILE_SUB + TILE_SUB / 2;
        if (!ok(px, py)) continue;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < bestD) {
          bestD = d;
          best = { x: px, y: py };
        }
      }
    }
    if (best) return best;
  }
  return null;
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
