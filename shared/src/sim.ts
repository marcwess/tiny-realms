import { BODY_R, DIR_VEC, TILE_SUB, WORLD_H, WORLD_W, diagSpeed } from './constants.ts';

export type SolidAt = (tx: number, ty: number) => boolean;

export function blocked(x: number, y: number, solidAt: SolidAt): boolean {
  const minX = x - BODY_R;
  const maxX = x + BODY_R - 1;
  const minY = y - BODY_R;
  const maxY = y + BODY_R - 1;
  const x0 = Math.floor(minX / TILE_SUB);
  const x1 = Math.floor(maxX / TILE_SUB);
  const y0 = Math.floor(minY / TILE_SUB);
  const y1 = Math.floor(maxY / TILE_SUB);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
      if (solidAt(tx, ty)) return true;
    }
  }
  return false;
}

export function applyMovement(
  x: number,
  y: number,
  dir: number,
  speed: number,
  solidAt: SolidAt,
): { x: number; y: number; facingRight: boolean | null; moved: boolean } {
  if (dir <= 0 || dir >= DIR_VEC.length) {
    return { x, y, facingRight: null, moved: false };
  }
  const [sx, sy] = DIR_VEC[dir];
  const step = sx !== 0 && sy !== 0 ? diagSpeed(speed) : speed;
  const dx = sx * step;
  const dy = sy * step;
  let nx = x;
  let ny = y;
  let moved = false;
  if (!blocked(x + dx, y + dy, solidAt)) {
    nx = x + dx;
    ny = y + dy;
    moved = true;
  } else {
    if (dx !== 0 && !blocked(x + dx, y, solidAt)) {
      nx = x + dx;
      moved = true;
    }
    if (dy !== 0 && !blocked(nx, y + dy, solidAt)) {
      ny = y + dy;
      moved = true;
    }
  }
  const facingRight = sx > 0 ? true : sx < 0 ? false : null;
  return { x: nx, y: ny, facingRight, moved };
}

/** 8-direction from a vector. Deadzone is in the same units as dx/dy. */
export function dirFromVector(dx: number, dy: number, dead = 0): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= dead && ay <= dead) return 0;
  if (ay * 1000 < ax * 414) return dx > 0 ? 3 : 7;
  if (ax * 1000 < ay * 414) return dy > 0 ? 5 : 1;
  if (dx > 0 && dy < 0) return 2;
  if (dx > 0 && dy > 0) return 4;
  if (dx < 0 && dy > 0) return 6;
  return 8;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Integer knockback decay. */
export function decayKnock(v: number): number {
  return (v * 3) / 5 | 0;
}
