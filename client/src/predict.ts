import { applyMovement, type Motion, type SolidAt } from '../../shared/src/sim.ts';
import type { InputCmd } from '../../shared/src/inputQueue.ts';

/** Local prediction. Replay uses the same integer movement as the server. */
export class Predictor {
  seq = 0;
  pending: InputCmd[] = [];
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  facingRight = true;
  sent = 0;
  acked = 0;
  speed = 24;
  motion: Motion = { vx: 0, vy: 0 };

  reset(x: number, y: number, speed: number): void {
    this.seq = 0;
    this.pending = [];
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.facingRight = true;
    this.sent = 0;
    this.acked = 0;
    this.speed = speed;
    this.motion.vx = 0;
    this.motion.vy = 0;
  }

  step(dir: number, buttons: number, solidAt: SolidAt): InputCmd {
    this.prevX = this.x;
    this.prevY = this.y;
    this.seq = (this.seq + 1) >>> 0;
    const input: InputCmd = { seq: this.seq, dir, buttons };
    this.pending.push(input);
    const mv = applyMovement(this.x, this.y, dir, this.speed, solidAt, this.motion);
    this.x = mv.x;
    this.y = mv.y;
    if (mv.facingRight !== null) this.facingRight = mv.facingRight;
    this.sent++;
    return input;
  }

  reconcile(ack: number, sx: number, sy: number, svx: number, svy: number, solidAt: SolidAt): void {
    const before = this.pending.length;
    this.pending = this.pending.filter((i) => i.seq > ack);
    this.acked += before - this.pending.length;
    let x = sx;
    let y = sy;
    let facing = this.facingRight;
    const motion: Motion = { vx: svx, vy: svy };
    for (const i of this.pending) {
      const mv = applyMovement(x, y, i.dir, this.speed, solidAt, motion);
      x = mv.x;
      y = mv.y;
      if (mv.facingRight !== null) facing = mv.facingRight;
    }
    this.motion.vx = motion.vx;
    this.motion.vy = motion.vy;
    const err = Math.abs(this.x - x) + Math.abs(this.y - y);
    this.x = x;
    this.y = y;
    this.facingRight = facing;
    if (err > 240) {
      this.prevX = x;
      this.prevY = y;
    }
  }
}
