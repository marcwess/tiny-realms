/** Tiny Town tile ids (12 columns) plus dungeon frames stored at DUNGEON + frame. */

export const DUNGEON = 160;

export const GRASS = 0;
export const GRASS_B = 1;
export const FLOWER_GRASS = 2;
export const BLUE_FLOWER_GRASS = 43;

export const TREE = 5;
export const TREE_TRUNK = 16;
// 3 and 4 are only the tops of two-tile pines (open at the bottom), so the
// standalone trees are the full pines 27/28 and the round trees 15/16.
export const TREE_SMALL = 28;
export const TREE_AUTUMN = 27;
export const TREE_AUTUMN_B = 15;
export const PINE_TOP_AUTUMN = 3;
export const PINE_TOP = 4;
export const TREE_ROUND = 28;
/** Small sprout. 6-11, 18-23 and 30-35 are pieces of a 3x3 forest block, not standalone trees. */
export const BUSH = 17;

// Tiny Town has no rocks, banners or campfire. 93 is a coin, 94 a beehive, 115 a pickaxe,
// 131 a backpack and 57 a cart, so those are not used as scenery.
export const TARGET = 95;
export const SIGN = 83;
export const WELL = 104;
/** Log pile; the client draws the flame and smoke on top. */
export const CAMPFIRE = 106;
export const FENCE = 45;
export const FENCE_L = 44;
export const FENCE_R = 46;
export const POST = 47;

export const HOUSE_ROOF = [52, 53, 54] as const;
export const HOUSE_EAVE = [64, 65, 66] as const;
export const HOUSE_WALL = [84, 74, 87] as const;
export const STALL = [72, 73, 75] as const;
export const DOOR = 74;
export const MUSHROOM = 29;

export const WATER_C = 126;
export const WATER_SHIMMER = 109;
/** Not a sheet frame: the client paints wooden planks for it. */
export const BRIDGE = 150;
export const BRIDGE_N = 151;
export const BRIDGE_S = 152;

/** Not a sheet frame (Tiny Dungeon's banner is baked onto a brick wall): the client paints a pole and pennant. */
export const PIT_BANNER = 153;
export const GRAVE_STONE = DUNGEON + 65;

const TALL_IDS = [
  TREE, TREE_TRUNK, TREE_SMALL, TREE_ROUND, TREE_AUTUMN, TREE_AUTUMN_B, PINE_TOP_AUTUMN, PINE_TOP, 6, 8, 19, 22, 30,
  TARGET, SIGN, WELL, CAMPFIRE, PIT_BANNER, GRAVE_STONE,
  FENCE, FENCE_L, FENCE_R, POST, 81,
  52, 53, 54, 55, 64, 65, 66, 72, 73, DOOR, 75, 84, 85, 86, 87,
];

const SOLID_IDS = [
  TREE, TREE_TRUNK, TREE_SMALL, TREE_ROUND, TREE_AUTUMN, TREE_AUTUMN_B, PINE_TOP_AUTUMN, PINE_TOP, 6, 8, 19, 22, 30,
  TARGET, SIGN, WELL, CAMPFIRE, PIT_BANNER, GRAVE_STONE,
  FENCE, FENCE_L, FENCE_R, POST, 81,
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
