import {
  CHUNK,
  INTEREST_ENTER_TILES,
  INTEREST_LEAVE_TILES,
  TILE_SUB,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Y,
  chunkKey,
} from './constants.ts';

export function chunksWithin(subX: number, subY: number, radiusTiles: number): string[] {
  const tx = subX / TILE_SUB;
  const ty = subY / TILE_SUB;
  const r = radiusTiles;
  const c0x = Math.max(0, Math.floor((tx - r) / CHUNK));
  const c1x = Math.min(WORLD_CHUNKS_X - 1, Math.floor((tx + r) / CHUNK));
  const c0y = Math.max(0, Math.floor((ty - r) / CHUNK));
  const c1y = Math.min(WORLD_CHUNKS_Y - 1, Math.floor((ty + r) / CHUNK));
  const keys: string[] = [];
  const r2 = r * r;
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const nearestX = Math.max(cx * CHUNK, Math.min(tx, (cx + 1) * CHUNK));
      const nearestY = Math.max(cy * CHUNK, Math.min(ty, (cy + 1) * CHUNK));
      const dx = nearestX - tx;
      const dy = nearestY - ty;
      if (dx * dx + dy * dy <= r2) keys.push(chunkKey(cx, cy));
    }
  }
  return keys;
}

export function interestEnter(subX: number, subY: number): string[] {
  return chunksWithin(subX, subY, INTEREST_ENTER_TILES);
}

export function interestLeave(subX: number, subY: number): string[] {
  return chunksWithin(subX, subY, INTEREST_LEAVE_TILES);
}

export interface InterpSample {
  t: number;
  x: number;
  y: number;
}

/** Refresh-rate independent. Clamps to the buffer ends instead of extrapolating. */
export function sampleInterp(samples: readonly InterpSample[], renderT: number): { x: number; y: number } | null {
  const n = samples.length;
  if (n === 0) return null;
  if (n === 1 || renderT <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[n - 1];
  if (renderT >= last.t) return { x: last.x, y: last.y };
  let i = 1;
  while (i < n && samples[i].t < renderT) i++;
  const b = samples[i];
  const a = samples[i - 1];
  const span = b.t - a.t;
  const u = span <= 0 ? 1 : (renderT - a.t) / span;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
