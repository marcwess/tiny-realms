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

export interface Motion {
  vx: number;
  vy: number;
}

/** About 80ms: most of the speed arrives on the first tick, the rest on the second. */
function approach(cur: number, target: number): number {
  const d = target - cur;
  if (d === 0) return cur;
  const span = Math.max(Math.abs(target), Math.abs(cur), 1);
  const mag = Math.max(1, Math.round(span * 0.8));
  if (Math.abs(d) <= mag) return target;
  return cur + Math.sign(d) * mag;
}

function slide(x: number, y: number, dx: number, dy: number, solidAt: SolidAt): { x: number; y: number; moved: boolean } {
  if (dx === 0 && dy === 0) return { x, y, moved: false };
  if (!blocked(x + dx, y + dy, solidAt)) return { x: x + dx, y: y + dy, moved: true };
  let nx = x;
  let ny = y;
  let moved = false;
  if (dx !== 0 && !blocked(x + dx, y, solidAt)) {
    nx = x + dx;
    moved = true;
  }
  if (dy !== 0 && !blocked(nx, y + dy, solidAt)) {
    ny = y + dy;
    moved = true;
  }
  if (moved) return { x: nx, y: ny, moved };
  // A full step is caught on a corner. A half step still slides along the free face.
  const hx = dx === 0 ? 0 : Math.trunc(dx / 2) || Math.sign(dx);
  const hy = dy === 0 ? 0 : Math.trunc(dy / 2) || Math.sign(dy);
  if (hx !== 0 && !blocked(x + hx, y, solidAt)) {
    nx = x + hx;
    moved = true;
  }
  if (hy !== 0 && !blocked(nx, y + hy, solidAt)) {
    ny = y + hy;
    moved = true;
  }
  return { x: nx, y: ny, moved };
}

export function applyMovement(
  x: number,
  y: number,
  dir: number,
  speed: number,
  solidAt: SolidAt,
  motion?: Motion,
): { x: number; y: number; facingRight: boolean | null; moved: boolean } {
  const moving = dir > 0 && dir < DIR_VEC.length;
  const [sx, sy] = moving ? DIR_VEC[dir] : [0, 0];
  const step = sx !== 0 && sy !== 0 ? diagSpeed(speed) : speed;
  const tvx = sx * step;
  const tvy = sy * step;
  const vx = motion ? approach(motion.vx, tvx) : tvx;
  const vy = motion ? approach(motion.vy, tvy) : tvy;
  if (motion) {
    motion.vx = vx;
    motion.vy = vy;
  }
  const next = slide(x, y, vx, vy, solidAt);
  const facingRight = sx > 0 ? true : sx < 0 ? false : null;
  return { x: next.x, y: next.y, facingRight, moved: next.moved };
}

/** Soft push so two bodies cannot occupy the same pixels. */
export function separateBodies(
  bodies: { x: number; y: number; dead?: boolean }[],
  solidAt: SolidAt,
  minDist = 140,
  maxPush = 6,
): void {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.dead) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (b.dead) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= minDist) continue;
      if (dist < 1) {
        dx = ((i * 3 + j) % 2 === 0 ? 1 : -1);
        dy = 0;
        dist = 1;
      }
      // Capped so it is a nudge, not a shove: walking through someone is still
      // possible, and stacked bodies drift apart over a few ticks.
      const push = Math.min(maxPush, (minDist - dist) / 2);
      const ux = dx / dist;
      const uy = dy / dist;
      const ax = Math.round(a.x - ux * push);
      const ay = Math.round(a.y - uy * push);
      const bx = Math.round(b.x + ux * push);
      const by = Math.round(b.y + uy * push);
      if (!blocked(ax, ay, solidAt)) {
        a.x = ax;
        a.y = ay;
      }
      if (!blocked(bx, by, solidAt)) {
        b.x = bx;
        b.y = by;
      }
    }
  }
}

/** True when the segment does not cross a solid tile. Low decor is not solid, so shots pass over it. */
export function lineClear(x0: number, y0: number, x1: number, y1: number, solidAt: SolidAt): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / (TILE_SUB / 2)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const tx = Math.floor(x / TILE_SUB);
    const ty = Math.floor(y / TILE_SUB);
    if (solidAt(tx, ty)) return false;
  }
  return true;
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
