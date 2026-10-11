/** Tiny Town tile ids (12 columns) plus dungeon frames stored at DUNGEON + frame. */

export const DUNGEON = 160;

export const GRASS = 0;
export const GRASS_B = 1;
export const FLOWER_GRASS = 2;
export const BLUE_FLOWER_GRASS = 43;

export const TREE = 5;
export const TREE_TRUNK = 16;
export const TREE_SMALL = 4;
export const TREE_ROUND = 28;
export const BUSH = 7;

export const ROCK = 94;
export const PEBBLE = 93;
export const RED_BUSH = 95;
export const BANNER = 29;
export const SIGN = 115;
export const WELL = 131;
export const CAMPFIRE = 57;
export const FENCE = 45;
export const FENCE_L = 44;
export const FENCE_R = 46;
export const POST = 47;

export const HOUSE_ROOF = [52, 53, 54] as const;
export const HOUSE_EAVE = [64, 65, 66] as const;
export const HOUSE_WALL = [84, 74, 87] as const;
export const STALL = [72, 73, 75] as const;
export const DOOR = 74;
export const MUSHROOM = 3;

export const WATER_C = 126;
export const WATER_SHIMMER = 109;

const TALL_IDS = [
  TREE, TREE_TRUNK, TREE_SMALL, TREE_ROUND, BUSH, 6, 8, 15, 17, 19, 22, 30,
  ROCK, PEBBLE, RED_BUSH, BANNER, SIGN, 116, WELL, CAMPFIRE,
  FENCE, FENCE_L, FENCE_R, POST, 81,
  52, 53, 54, 55, 64, 65, 66, 72, 73, DOOR, 75, 84, 85, 86, 87,
];

const SOLID_IDS = [
  TREE, TREE_TRUNK, TREE_SMALL, TREE_ROUND, 6, 8, 15, 17, 19, 22, 30,
  ROCK, PEBBLE, WELL, CAMPFIRE,
  FENCE, FENCE_L, FENCE_R, POST, 81, SIGN, 116,
  52, 53, 54, 55, 64, 65, 66, 72, 73, 75, 84, 85, 86, 87,
  48, 49, 50, 60, 61, 62, 76, 77, 79, 126,
  DUNGEON + 40,
];

const SOLID = new Uint8Array(256);
for (const id of SOLID_IDS) SOLID[id] = 1;

const TALL = new Uint8Array(256);
for (const id of TALL_IDS) TALL[id] = 1;

export function tileIsSolid(id: number): boolean {
  return id > 0 && id < SOLID.length && SOLID[id] === 1;
}

export function tileIsTall(id: number): boolean {
  return id > 0 && id < TALL.length && TALL[id] === 1;
}

export function tileSheet(id: number): 'town' | 'dungeon' {
  return id >= DUNGEON ? 'dungeon' : 'town';
}

export function tileFrame(id: number): number {
  return id >= DUNGEON ? id - DUNGEON : id;
}
