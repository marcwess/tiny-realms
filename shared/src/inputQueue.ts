export interface InputCmd {
  seq: number;
  dir: number;
  buttons: number;
}

/**
 * Per-player input queue.
 *
 * Invariants (these shipped broken in the last game):
 * - `lastProcessed` advances only when an input is actually applied.
 * - Silence does not invent or burn sequence numbers.
 * - An input is never discarded because a wall-clock or server tick moved on
 *   while the client was stalled. Ordering is by seq alone.
 * - TCP delivers in order. A gap (client skipped a seq) still applies the
 *   later seq; we do not wait forever and we do not drop it as stale.
 * - The queue cap drops only a flood of *newest* commands past 64. A stall
 *   does not enqueue inputs, so a resume cannot hit this path.
 */
export class InputQueue {
  lastProcessed = 0;
  private q: InputCmd[] = [];

  get length(): number {
    return this.q.length;
  }

  push(input: InputCmd): void {
    if (!Number.isFinite(input.seq) || input.seq <= 0) return;
    if (input.seq <= this.lastProcessed) return;
    for (let i = 0; i < this.q.length; i++) {
      if (this.q[i].seq === input.seq) return;
    }
    if (this.q.length >= 64) return;
    this.q.push({
      seq: input.seq >>> 0,
      dir: input.dir & 15,
      buttons: input.buttons & 15,
    });
    this.q.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Apply up to `budget` queued inputs (one sim step each).
   * Returns [] and leaves `lastProcessed` unchanged when nothing is waiting.
   */
  consume(budget: number): InputCmd[] {
    const out: InputCmd[] = [];
    const n = Math.max(0, budget | 0);
    while (out.length < n && this.q.length > 0) {
      const next = this.q.shift();
      if (!next) break;
      this.lastProcessed = next.seq;
      out.push(next);
    }
    return out;
  }
}
