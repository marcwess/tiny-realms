/** Fixed simulation step. Snapshots use the same rate. */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Remote entities render this far behind the estimated server clock. */
export const INTERP_MS = 100;

/** World is stored in deci-pixels so movement stays integer on every JS engine. */
export const SUB = 10;
export const TILE = 16;
export const TILE_SUB = TILE * SUB;

export const CHUNK = 32;
export const WORLD_CHUNKS_X = 4;
export const WORLD_CHUNKS_Y = 3;
export const WORLD_W = CHUNK * WORLD_CHUNKS_X;
export const WORLD_H = CHUNK * WORLD_CHUNKS_Y;

/** Tiles. Enter keeps the player from seeing a pop; leave is wider so chunks don't flicker. */
export const INTEREST_ENTER_TILES = 28;
export const INTEREST_LEAVE_TILES = 36;

export const BODY_R = 4 * SUB;

export const DIR = {
  None: 0,
  N: 1,
  NE: 2,
  E: 3,
  SE: 4,
  S: 5,
  SW: 6,
  W: 7,
  NW: 8,
} as const;

/** Unit steps. Diagonals are normalized with diagSpeed(). */
export const DIR_VEC: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

export const KIND = { PLAYER: 0, MONSTER: 1, PROJECTILE: 2 } as const;
export const CLASS = { KNIGHT: 0, ARCHER: 1, MAGE: 2 } as const;
export const ZONE = { SAFE: 0, PVE: 1, PVP: 2 } as const;
export type ZoneKind = 'safe' | 'pve' | 'pvp';

export const FLAG = {
  FacingRight: 1,
  Dead: 2,
  Attacking: 4,
  Stunned: 8,
  Moving: 16,
} as const;

export const BTN = { Attack: 1, Skill: 2 } as const;

export const FX = {
  HIT: 1,
  ARROW: 2,
  MAGIC: 3,
  FIRE: 4,
  SMOKE: 5,
  STUN: 6,
} as const;

export const EV = {
  DAMAGE: 1,
  DEATH: 2,
  SWING: 3,
  BANNER: 4,
} as const;

export const BANNER = { PVP: 1, DUNGEON: 3 } as const;

export const MSG = {
  HELLO: 1,
  WELCOME: 2,
  INPUT: 3,
  ADD: 4,
  REMOVE: 5,
  SNAP: 6,
  EVENT: 7,
  CHUNK: 8,
  UNCHUNK: 9,
  REGIONS: 10,
  LOGOUT: 11,
} as const;

export const PLAYER_RESPAWN_TICKS = 60;
export const MONSTER_RESPAWN_TICKS = 160;
export const MAX_PLAYERS = 80;
export const OVERWORLD_ID = 'overworld';

export interface ClassDef {
  id: number;
  key: string;
  name: string;
  tile: number;
  hp: number;
  /** Deci-pixels per tick, orthogonal. */
  speed: number;
  role: string;
  attackCd: number;
  skillCd: number;
  range: number;
  dmg: number;
  skillDmg: number;
  skillRange: number;
  skillStun: number;
  projSpeed: number;
  projLife: number;
  aoe: number;
  skillAoe: number;
  skillSpeed: number;
  skillLife: number;
}

export const CLASSES: readonly ClassDef[] = [
  {
    id: CLASS.KNIGHT,
    key: 'knight',
    name: 'Knight',
    tile: 96,
    hp: 140,
    speed: 24,
    role: 'Melee sword, high HP',
    attackCd: 9,
    skillCd: 80,
    range: 240,
    dmg: 18,
    skillDmg: 12,
    skillRange: 280,
    skillStun: 16,
    projSpeed: 0,
    projLife: 0,
    aoe: 0,
    skillAoe: 0,
    skillSpeed: 0,
    skillLife: 0,
  },
  {
    id: CLASS.ARCHER,
    key: 'archer',
    name: 'Archer',
    tile: 112,
    hp: 86,
    speed: 30,
    role: 'Fast arrows, long range',
    attackCd: 6,
    skillCd: 70,
    range: 2200,
    dmg: 11,
    skillDmg: 8,
    skillRange: 2200,
    skillStun: 0,
    projSpeed: 100,
    projLife: 18,
    aoe: 0,
    skillAoe: 0,
    skillSpeed: 100,
    skillLife: 18,
  },
  {
    id: CLASS.MAGE,
    key: 'mage',
    name: 'Mage',
    tile: 84,
    hp: 74,
    speed: 26,
    role: 'Magic bolts and a fireball',
    attackCd: 11,
    skillCd: 90,
    range: 2000,
    dmg: 14,
    skillDmg: 24,
    skillRange: 2000,
    skillStun: 0,
    projSpeed: 55,
    projLife: 24,
    aoe: 180,
    skillAoe: 300,
    skillSpeed: 42,
    skillLife: 30,
  },
];

export interface MonsterDef {
  id: number;
  name: string;
  tile: number;
  hp: number;
  dmg: number;
  speed: number;
  aggro: number;
  range: number;
  cd: number;
}

export const MONSTERS: readonly MonsterDef[] = [
  { id: 0, name: 'Slime', tile: 108, hp: 30, dmg: 6, speed: 14, aggro: 1100, range: 150, cd: 20 },
  { id: 1, name: 'Cyclops', tile: 109, hp: 72, dmg: 14, speed: 14, aggro: 1200, range: 180, cd: 22 },
  { id: 2, name: 'Crab', tile: 110, hp: 40, dmg: 10, speed: 16, aggro: 1000, range: 160, cd: 18 },
  { id: 3, name: 'Hood', tile: 111, hp: 48, dmg: 12, speed: 16, aggro: 1300, range: 170, cd: 20 },
  { id: 4, name: 'Bat', tile: 120, hp: 22, dmg: 7, speed: 26, aggro: 1200, range: 140, cd: 14 },
  { id: 5, name: 'Ghost', tile: 121, hp: 36, dmg: 9, speed: 18, aggro: 1300, range: 160, cd: 18 },
  { id: 6, name: 'Spider', tile: 122, hp: 28, dmg: 8, speed: 22, aggro: 1100, range: 150, cd: 16 },
  { id: 7, name: 'Orc', tile: 123, hp: 56, dmg: 12, speed: 15, aggro: 1100, range: 170, cd: 20 },
  { id: 8, name: 'Beast', tile: 124, hp: 24, dmg: 6, speed: 24, aggro: 1200, range: 150, cd: 14 },
];

const SOLID_IDS = [
  2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 26, 27, 28, 30, 31, 32, 33, 36, 37,
  38, 39, 40, 42, 43, 44, 45, 46, 47, 50, 51, 52, 53, 65, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83,
  90, 91, 92, 93, 94, 95,
];

const SOLID = new Uint8Array(132);
for (const id of SOLID_IDS) SOLID[id] = 1;

export function tileIsSolid(id: number): boolean {
  return id >= 0 && id < SOLID.length && SOLID[id] === 1;
}

/** round(speed / sqrt(2)) in integer arithmetic. */
export function diagSpeed(speed: number): number {
  return Math.floor((speed * 1000 + 707) / 1414);
}

export function tileOf(sub: number): number {
  return Math.floor(sub / TILE_SUB);
}

export function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SUB + TILE_SUB / 2, y: ty * TILE_SUB + TILE_SUB / 2 };
}

export function chunkOfTile(tx: number, ty: number): { cx: number; cy: number } {
  return { cx: Math.floor(tx / CHUNK), cy: Math.floor(ty / CHUNK) };
}

export function chunkKey(cx: number, cy: number): string {
  return cx + ',' + cy;
}

/**
 * Which sim process owns a chunk. M0 is one process; the key is here so a
 * later split can route chunks without changing the map format.
 */
export function chunkShard(_cx: number, _cy: number): string {
  return OVERWORLD_ID;
}
