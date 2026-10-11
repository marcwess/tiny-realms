import { TILE_SUB, tileOf, type ZoneKind } from './constants.ts';

export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RegionDef {
  id: string;
  name: string;
  zone: ZoneKind;
  /** Hint for a later multi-process split. M0 runs every region in one process. */
  shardId: string;
  rects: RegionRect[];
}

export interface DungeonDef {
  id: string;
  name: string;
  instanced: true;
}

export interface DungeonEntrance {
  dungeonId: string;
  name: string;
  tileX: number;
  tileY: number;
}

export const TOWN: RegionRect = { x: 40, y: 42, w: 22, h: 18 };
export const PVP_PIT: RegionRect = { x: 70, y: 44, w: 16, h: 14 };
export const SPAWN_TILE = { x: 50, y: 50 };
export const CRYPT_STAIRS = { x: 14, y: 50 };

export const REGIONS: readonly RegionDef[] = [
  {
    id: 'millcross',
    name: 'Millcross',
    zone: 'safe',
    shardId: 'overworld',
    rects: [TOWN],
  },
  {
    id: 'blood-pit',
    name: 'Blood Pit',
    zone: 'pvp',
    shardId: 'overworld',
    rects: [PVP_PIT],
  },
];

export const DUNGEONS: readonly DungeonDef[] = [{ id: 'crypt', name: 'The Crypt', instanced: true }];

export const ENTRANCES: readonly DungeonEntrance[] = [
  { dungeonId: 'crypt', name: 'The Crypt', tileX: CRYPT_STAIRS.x, tileY: CRYPT_STAIRS.y },
];

export function zoneAtTile(tx: number, ty: number): ZoneKind {
  for (const region of REGIONS) {
    for (const r of region.rects) {
      if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) return region.zone;
    }
  }
  return 'pve';
}

export function zoneNameAtTile(tx: number, ty: number): string {
  for (const region of REGIONS) {
    for (const r of region.rects) {
      if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) return region.name;
    }
  }
  return 'Wilds';
}

export function zoneAt(subX: number, subY: number): ZoneKind {
  return zoneAtTile(tileOf(subX), tileOf(subY));
}

export function entranceAt(tx: number, ty: number): DungeonEntrance | null {
  for (const e of ENTRANCES) {
    if (e.tileX === tx && e.tileY === ty) return e;
  }
  return null;
}

/** Player damage lands only when both stand in a PvP region. */
export function playersCanDamage(ax: number, ay: number, bx: number, by: number): boolean {
  return zoneAt(ax, ay) === 'pvp' && zoneAt(bx, by) === 'pvp';
}

export function monsterCanHurt(playerX: number, playerY: number): boolean {
  return zoneAt(playerX, playerY) !== 'safe';
}

export function rectContains(r: RegionRect, tx: number, ty: number): boolean {
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}

export const SPAWN_SUB = {
  x: SPAWN_TILE.x * TILE_SUB + TILE_SUB / 2,
  y: SPAWN_TILE.y * TILE_SUB + TILE_SUB / 2,
};
