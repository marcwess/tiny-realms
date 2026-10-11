import type { WebSocket } from 'ws';
import {
  BANNER,
  BTN,
  CLASSES,
  EV,
  FLAG,
  FX,
  KIND,
  MONSTER_RESPAWN_TICKS,
  MONSTERS,
  PLAYER_RESPAWN_TICKS,
  TILE_SUB,
  tileOf,
  type ClassDef,
  type MonsterDef,
} from '../../shared/src/constants.ts';
import { InputQueue } from '../../shared/src/inputQueue.ts';
import { interestEnter, interestLeave } from '../../shared/src/interest.ts';
import {
  encodeAdd,
  encodeChunk,
  encodeEvents,
  encodeRegions,
  encodeRemove,
  encodeSnap,
  encodeUnchunk,
  encodeWelcome,
  type AddEnt,
  type EvMsg,
  type SnapEnt,
} from '../../shared/src/protocol.ts';
import { applyMovement, blocked, decayKnock, dirFromVector, dist2, type SolidAt } from '../../shared/src/sim.ts';
import { buildWorld, chunkSlice, openSpotNear, reachableFromSpawn, solidAtOf, type WorldData } from '../../shared/src/world.ts';
import {
  ENTRANCES,
  REGIONS,
  SPAWN_SUB,
  entranceAt,
  monsterCanHurt,
  playersCanDamage,
  zoneAt,
} from '../../shared/src/zones.ts';

interface Sent {
  x: number;
  y: number;
  hp: number;
  flags: number;
  vx: number;
  vy: number;
}

export interface Conn {
  socket: WebSocket;
  player: Player | null;
  subscribed: Set<string>;
  known: Map<number, Sent>;
  regionsSent: boolean;
  bytesOut: number;
}

interface Body {
  id: number;
  kind: number;
  subtype: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  facingRight: boolean;
  dead: boolean;
  stun: number;
  respawn: number;
  kbx: number;
  kby: number;
  attacking: number;
  moving: boolean;
  name: string;
}

interface Player extends Body {
  kind: 0;
  characterId: number;
  accountId: number;
  classId: number;
  level: number;
  xp: number;
  attackCd: number;
  skillCd: number;
  inputs: InputQueue;
  lastEntrance: string;
  conn: Conn;
}

interface Monster extends Body {
  kind: 1;
  def: MonsterDef;
  homeX: number;
  homeY: number;
  attackCd: number;
  aiDir: number;
  aiTimer: number;
  rng: () => number;
  aggro: boolean;
}

interface Proj {
  id: number;
  kind: 2;
  subtype: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  dmg: number;
  aoe: number;
  life: number;
  fx: number;
  facingRight: boolean;
  dead: boolean;
  name: string;
}

type HurtTarget = Player | Monster;

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s;
  };
}

function chunkKeyOf(x: number, y: number): string {
  const tx = tileOf(x);
  const ty = tileOf(y);
  return Math.floor(tx / 32) + ',' + Math.floor(ty / 32);
}

export interface RegionStats {
  chunks: number;
  interest: number;
  delta: number;
  bytes: number;
  players: number;
  tickMs: number;
}

/**
 * One authoritative region. M0 runs a single overworld in this process.
 * A dungeon instance would be another RegionSim with its own sockets later.
 * Player bodies are never passed to monster AI.
 */
export class RegionSim {
  readonly id = 'overworld';
  readonly world: WorldData;
  readonly solidAt: SolidAt;
  private readonly reach: Uint8Array;
  tickN = 0;
  private nextId = 1;
  private players = new Map<number, Player>();
  private byChar = new Map<number, Player>();
  private monsters: Monster[] = [];
  private projectiles: Proj[] = [];
  private events: EvMsg[] = [];
  private conns = new Set<Conn>();

  constructor() {
    this.world = buildWorld();
    this.solidAt = solidAtOf(this.world);
    this.reach = reachableFromSpawn(this.world);
    for (const s of this.world.spawns) {
      const def = MONSTERS[s.monsterId];
      const homeX = s.tx * TILE_SUB + TILE_SUB / 2;
      const homeY = s.ty * TILE_SUB + TILE_SUB / 2;
      this.monsters.push({
        id: this.nextId++,
        kind: 1,
        subtype: def.id,
        def,
        name: def.name,
        x: homeX,
        y: homeY,
        homeX,
        homeY,
        hp: def.hp,
        hpMax: def.hp,
        facingRight: true,
        dead: false,
        stun: 0,
        respawn: 0,
        kbx: 0,
        kby: 0,
        attacking: 0,
        moving: false,
        attackCd: 0,
        aiDir: 0,
        aiTimer: 0,
        aggro: false,
        rng: lcg(1000 + s.tx * 17 + s.ty),
      });
    }
  }

  get playerCount(): number {
    return this.players.size;
  }

  get monsterCount(): number {
    return this.monsters.length;
  }

  addConn(socket: WebSocket): Conn {
    const conn: Conn = {
      socket,
      player: null,
      subscribed: new Set(),
      known: new Map(),
      regionsSent: false,
      bytesOut: 0,
    };
    this.conns.add(conn);
    return conn;
  }

  removeConn(conn: Conn): void {
    this.conns.delete(conn);
    const p = conn.player;
    if (!p || p.conn !== conn) return;
    this.byChar.delete(p.characterId);
    this.players.delete(p.id);
    conn.player = null;
  }

  /** Rebind keeps the in-world body so a resume does not rewind the character. */
  attach(conn: Conn, opts: {
    characterId: number;
    accountId: number;
    name: string;
    classId: number;
    x: number;
    y: number;
    hp: number;
    level: number;
    xp: number;
  }): Player {
    const existing = this.byChar.get(opts.characterId);
    if (existing) {
      const old = existing.conn;
      existing.inputs = new InputQueue();
      existing.conn = conn;
      conn.player = existing;
      old.player = null;
      if (old.socket !== conn.socket) old.socket.close(4003, 'replaced');
      this.send(
        conn,
        encodeWelcome({
          entityId: existing.id,
          tick: this.tickN,
          x: existing.x,
          y: existing.y,
          hp: existing.hp,
          hpMax: existing.hpMax,
          classId: existing.classId,
          level: existing.level,
          xp: existing.xp,
        }),
      );
      this.syncConn(conn);
      return existing;
    }
    const def = CLASSES[opts.classId] ?? CLASSES[0];
    let x = opts.x;
    let y = opts.y;
    let hp = opts.hp;
    const spot = hp > 0 ? openSpotNear(this.world, this.reach, x, y) : null;
    if (spot) {
      x = spot.x;
      y = spot.y;
    } else {
      x = SPAWN_SUB.x;
      y = SPAWN_SUB.y;
      if (hp <= 0) hp = def.hp;
    }
    const player: Player = {
      id: this.nextId++,
      kind: 0,
      subtype: def.id,
      characterId: opts.characterId,
      accountId: opts.accountId,
      name: opts.name,
      classId: def.id,
      level: opts.level,
      xp: opts.xp,
      x,
      y,
      hp,
      hpMax: def.hp,
      facingRight: true,
      dead: false,
      stun: 0,
      respawn: 0,
      kbx: 0,
      kby: 0,
      attacking: 0,
      moving: false,
      attackCd: 0,
      skillCd: 0,
      inputs: new InputQueue(),
      lastEntrance: '',
      conn,
    };
    this.players.set(player.id, player);
    this.byChar.set(player.characterId, player);
    conn.player = player;
    this.send(
      conn,
      encodeWelcome({
        entityId: player.id,
        tick: this.tickN,
        x: player.x,
        y: player.y,
        hp: player.hp,
        hpMax: player.hpMax,
        classId: player.classId,
        level: player.level,
        xp: player.xp,
      }),
    );
    this.syncConn(conn);
    return player;
  }

  pushInput(conn: Conn, seq: number, dir: number, buttons: number): void {
    conn.player?.inputs.push({ seq, dir, buttons });
  }

  step(): RegionStats {
    const t0 = process.hrtime.bigint();
    this.tickN++;
    for (const p of this.players.values()) this.updatePlayer(p);
    this.updateProjectiles();
    for (const m of this.monsters) this.updateMonster(m);
    let chunks = 0;
    let interest = 0;
    let delta = 0;
    let bytes = 0;
    for (const conn of this.conns) {
      if (!conn.player) continue;
      const before = conn.bytesOut;
      const stat = this.syncConn(conn);
      chunks += stat.chunks;
      interest += stat.interest;
      delta += stat.delta;
      bytes += conn.bytesOut - before;
    }
    this.events.length = 0;
    const tickMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return { chunks, interest, delta, bytes, players: this.players.size, tickMs };
  }

  snapshotPlayers(): { characterId: number; x: number; y: number; hp: number; level: number; xp: number }[] {
    const out = [];
    for (const p of this.players.values()) {
      if (p.dead) {
        out.push({ characterId: p.characterId, x: SPAWN_SUB.x, y: SPAWN_SUB.y, hp: p.hpMax, level: p.level, xp: p.xp });
      } else {
        out.push({ characterId: p.characterId, x: p.x, y: p.y, hp: p.hp, level: p.level, xp: p.xp });
      }
    }
    return out;
  }

  private updatePlayer(p: Player): void {
    p.moving = false;
    if (p.attacking > 0) p.attacking--;
    if (p.attackCd > 0) p.attackCd--;
    if (p.skillCd > 0) p.skillCd--;
    this.applyKnock(p);
    if (p.dead) {
      if (p.respawn > 0) p.respawn--;
      if (p.respawn <= 0) {
        p.dead = false;
        p.hp = p.hpMax;
        p.x = SPAWN_SUB.x;
        p.y = SPAWN_SUB.y;
        p.kbx = 0;
        p.kby = 0;
      }
    }
    const queued = p.inputs.length;
    const budget = queued > 6 ? 2 : 1;
    const inputs = p.inputs.consume(budget);
    const def = CLASSES[p.classId];
    for (const input of inputs) {
      if (p.dead) continue;
      const mv = applyMovement(p.x, p.y, input.dir, def.speed, this.solidAt);
      p.x = mv.x;
      p.y = mv.y;
      if (mv.facingRight !== null) p.facingRight = mv.facingRight;
      if (mv.moved) p.moving = true;
      if (input.buttons & BTN.Attack) this.tryAttack(p, def, false);
      if (input.buttons & BTN.Skill) this.tryAttack(p, def, true);
    }
    if (!p.dead) {
      const door = entranceAt(tileOf(p.x), tileOf(p.y));
      if (door && p.lastEntrance !== door.dungeonId) {
        p.lastEntrance = door.dungeonId;
        this.events.push({ ev: EV.BANNER, a: p.id, b: 0, x: p.x, y: p.y, n: BANNER.DUNGEON, fx: 0 });
      } else if (!door) p.lastEntrance = '';
    }
  }

  private tryAttack(p: Player, def: ClassDef, skill: boolean): void {
    if (skill) {
      if (p.skillCd > 0) return;
      p.skillCd = def.skillCd;
    } else {
      if (p.attackCd > 0) return;
      p.attackCd = def.attackCd;
    }
    p.attacking = 4;
    const range = skill ? def.skillRange : def.range;
    const target = this.nearestHostile(p, range);
    if (target) {
      p.facingRight = target.x >= p.x;
    }
    if (p.classId === 0) {
      const reach = skill ? def.skillRange : def.range;
      this.events.push({
        ev: EV.SWING,
        a: p.id,
        b: p.facingRight ? 3 : 7,
        x: p.x,
        y: p.y,
        n: skill ? 2 : 1,
        fx: skill ? FX.STUN : FX.HIT,
      });
      if (target && dist2(p.x, p.y, target.x, target.y) <= reach * reach) {
        this.hurt(target, skill ? def.skillDmg : def.dmg, p, skill ? FX.STUN : FX.HIT);
        if (skill && target.kind === KIND.MONSTER) target.stun = def.skillStun;
      }
      return;
    }
    const speed = skill ? def.skillSpeed : def.projSpeed;
    const life = skill ? def.skillLife : def.projLife;
    const dmg = skill ? def.skillDmg : def.dmg;
    const aoe = skill ? def.skillAoe : def.aoe;
    const aim = target ? { x: target.x, y: target.y } : { x: p.x + (p.facingRight ? 200 : -200), y: p.y };
    const dx = aim.x - p.x;
    const dy = aim.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const vx = Math.round((dx / len) * speed);
    const vy = Math.round((dy / len) * speed);
    const fx = p.classId === 2 ? (skill ? FX.FIRE : FX.MAGIC) : FX.ARROW;
    const subtype = p.classId === 2 ? (skill ? 2 : 1) : 0;
    if (skill && p.classId === 1) {
      this.spawnProj(p, vx, vy, life, dmg, 0, subtype, fx);
      const a = spread(vx, vy, -16);
      const b = spread(vx, vy, 16);
      this.spawnProj(p, a[0], a[1], life, dmg, 0, subtype, fx);
      this.spawnProj(p, b[0], b[1], life, dmg, 0, subtype, fx);
    } else {
      this.spawnProj(p, vx, vy, life, dmg, aoe, subtype, fx);
    }
    this.events.push({ ev: EV.SWING, a: p.id, b: p.facingRight ? 3 : 7, x: p.x, y: p.y, n: skill ? 2 : 1, fx });
  }

  private spawnProj(owner: Player, vx: number, vy: number, life: number, dmg: number, aoe: number, subtype: number, fx: number): void {
    this.projectiles.push({
      id: this.nextId++,
      kind: 2,
      subtype,
      ownerId: owner.id,
      x: owner.x + Math.sign(vx || (owner.facingRight ? 1 : -1)) * 80,
      y: owner.y,
      vx,
      vy,
      hp: 1,
      dmg,
      aoe,
      life,
      fx,
      facingRight: vx >= 0,
      dead: false,
      name: '',
    });
  }

  private updateProjectiles(): void {
    const keep: Proj[] = [];
    for (const proj of this.projectiles) {
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.life--;
      const owner = this.players.get(proj.ownerId);
      let hit = false;
      if (this.solidAt(tileOf(proj.x), tileOf(proj.y)) || proj.life <= 0) {
        if (proj.aoe > 0) this.explode(proj, owner ?? null);
        hit = true;
      } else {
        for (const t of this.hostilesOf(owner ?? null)) {
          if (dist2(proj.x, proj.y, t.x, t.y) <= 200 * 200) {
            if (proj.aoe > 0) this.explode(proj, owner ?? null);
            else this.hurt(t, proj.dmg, owner ?? null, proj.fx);
            hit = true;
            break;
          }
        }
      }
      if (!hit) keep.push(proj);
    }
    this.projectiles = keep;
  }

  private explode(proj: Proj, owner: Player | null): void {
    this.events.push({ ev: EV.DAMAGE, a: 0, b: proj.ownerId, x: proj.x, y: proj.y, n: 0, fx: proj.fx });
    for (const t of this.hostilesOf(owner)) {
      if (dist2(proj.x, proj.y, t.x, t.y) <= proj.aoe * proj.aoe) this.hurt(t, proj.dmg, owner, proj.fx);
    }
  }

  private hostilesOf(owner: Player | null): HurtTarget[] {
    const out: HurtTarget[] = [];
    for (const m of this.monsters) if (!m.dead) out.push(m);
    if (owner) {
      for (const p of this.players.values()) {
        if (p.dead || p.id === owner.id) continue;
        if (playersCanDamage(owner.x, owner.y, p.x, p.y)) out.push(p);
      }
    }
    return out;
  }

  private nearestHostile(p: Player, range: number): HurtTarget | null {
    let best: HurtTarget | null = null;
    let bestD = range * range;
    for (const t of this.hostilesOf(p)) {
      const d = dist2(p.x, p.y, t.x, t.y);
      if (d <= bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  /** Monsters only. Player records never reach this function. */
  private updateMonster(m: Monster): void {
    m.moving = false;
    m.aggro = false;
    if (m.attacking > 0) m.attacking--;
    if (m.dead) {
      if (m.respawn > 0) m.respawn--;
      if (m.respawn <= 0) {
        m.dead = false;
        m.hp = m.hpMax;
        m.x = m.homeX;
        m.y = m.homeY;
        m.kbx = 0;
        m.kby = 0;
        m.stun = 0;
      }
      return;
    }
    this.applyKnock(m);
    if (m.attackCd > 0) m.attackCd--;
    if (m.stun > 0) {
      m.stun--;
      return;
    }
    const target = this.nearestPlayer(m);
    const leash = dist2(m.x, m.y, m.homeX, m.homeY) > 2200 * 2200;
    if (target && !leash) {
      m.aggro = true;
      const d = dist2(m.x, m.y, target.x, target.y);
      if (d <= m.def.range * m.def.range && m.attackCd <= 0) {
        m.attackCd = m.def.cd;
        m.attacking = 4;
        m.facingRight = target.x >= m.x;
        this.hurt(target, m.def.dmg, m, FX.HIT);
        this.events.push({ ev: EV.SWING, a: m.id, b: m.facingRight ? 3 : 7, x: m.x, y: m.y, n: 1, fx: FX.HIT });
      } else {
        this.stepActor(m, dirFromVector(target.x - m.x, target.y - m.y), m.def.speed, true);
      }
    } else if (leash) {
      this.stepActor(m, dirFromVector(m.homeX - m.x, m.homeY - m.y), m.def.speed, true);
    } else {
      if (m.aiTimer <= 0) {
        m.aiDir = 1 + (m.rng() % 8);
        m.aiTimer = 8 + (m.rng() % 24);
      }
      m.aiTimer--;
      const before = m.x + m.y;
      this.stepActor(m, m.aiDir, m.def.speed, true);
      if (m.x + m.y === before) m.aiTimer = 0;
    }
  }

  private nearestPlayer(m: Monster): Player | null {
    let best: Player | null = null;
    let bestD = m.def.aggro * m.def.aggro;
    for (const p of this.players.values()) {
      if (p.dead || !monsterCanHurt(p.x, p.y)) continue;
      const d = dist2(m.x, m.y, p.x, p.y);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  private stepActor(body: Player | Monster, dir: number, speed: number, avoidSafe: boolean): void {
    const mv = applyMovement(body.x, body.y, dir, speed, (tx, ty) => {
      if (this.solidAt(tx, ty)) return true;
      if (avoidSafe && zoneAt(tx * TILE_SUB + 80, ty * TILE_SUB + 80) === 'safe') return true;
      return false;
    });
    body.x = mv.x;
    body.y = mv.y;
    if (mv.facingRight !== null) body.facingRight = mv.facingRight;
    if (mv.moved) body.moving = true;
  }

  private applyKnock(body: Player | Monster): void {
    if (body.kbx === 0 && body.kby === 0) return;
    // Test the whole body, not just its centre, so a hit can't shove anyone
    // half into a tree or fence where every move is then blocked.
    if (!blocked(body.x + body.kbx, body.y, this.solidAt)) body.x += body.kbx;
    if (!blocked(body.x, body.y + body.kby, this.solidAt)) body.y += body.kby;
    body.kbx = decayKnock(body.kbx);
    body.kby = decayKnock(body.kby);
  }

  private hurt(target: HurtTarget, amount: number, src: Player | Monster | null, fx: number): void {
    if (target.dead || amount <= 0) return;
    if (target.kind === KIND.PLAYER && src && src.kind === KIND.PLAYER) {
      if (!playersCanDamage(src.x, src.y, target.x, target.y)) return;
    }
    if (target.kind === KIND.PLAYER && src && src.kind === KIND.MONSTER) {
      if (!monsterCanHurt(target.x, target.y)) return;
    }
    const crit = src?.kind === KIND.PLAYER && ((this.tickN + target.id * 13) & 7) === 0;
    const dealt = crit ? Math.min(255, amount * 2) : amount;
    target.hp = Math.max(0, target.hp - dealt);
    const fromX = src ? src.x : target.x;
    const fromY = src ? src.y : target.y;
    const dx = target.x - fromX;
    const dy = target.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    target.kbx = Math.round((dx / len) * 50);
    target.kby = Math.round((dy / len) * 40);
    this.events.push({
      ev: EV.DAMAGE,
      a: target.id,
      b: src ? src.id : 0,
      x: target.x,
      y: target.y,
      n: dealt,
      fx: crit ? fx | 128 : fx,
    });
    if (target.hp <= 0) {
      target.dead = true;
      target.respawn = target.kind === KIND.PLAYER ? PLAYER_RESPAWN_TICKS : MONSTER_RESPAWN_TICKS;
      this.events.push({ ev: EV.DEATH, a: target.id, b: 0, x: target.x, y: target.y, n: 0, fx: FX.SMOKE });
    }
  }

  private syncConn(conn: Conn): { chunks: number; interest: number; delta: number } {
    const p = conn.player;
    if (!p || conn.socket.readyState !== 1) return { chunks: 0, interest: 0, delta: 0 };
    if (!conn.regionsSent) {
      this.send(conn, encodeRegions(REGIONS, ENTRANCES));
      conn.regionsSent = true;
    }
    const enter = new Set(interestEnter(p.x, p.y));
    const leave = new Set(interestLeave(p.x, p.y));
    for (const key of [...conn.subscribed]) {
      if (!leave.has(key)) {
        conn.subscribed.delete(key);
        const [cx, cy] = key.split(',');
        this.send(conn, encodeUnchunk(Number(cx), Number(cy)));
      }
    }
    for (const key of enter) {
      if (!conn.subscribed.has(key)) {
        conn.subscribed.add(key);
        const [cx, cy] = key.split(',');
        const slice = chunkSlice(this.world, Number(cx), Number(cy));
        this.send(conn, encodeChunk(Number(cx), Number(cy), slice.ground, slice.object));
      }
    }
    const visible = new Map<number, Player | Monster | Proj>();
    const consider = (e: Player | Monster | Proj) => {
      if (e.id === p.id || conn.subscribed.has(chunkKeyOf(e.x, e.y))) visible.set(e.id, e);
    };
    for (const o of this.players.values()) consider(o);
    for (const m of this.monsters) consider(m);
    for (const proj of this.projectiles) consider(proj);

    const removed: number[] = [];
    for (const id of conn.known.keys()) {
      if (!visible.has(id)) {
        removed.push(id);
        conn.known.delete(id);
      }
    }
    if (removed.length) this.send(conn, encodeRemove(removed));

    const added: AddEnt[] = [];
    const delta: SnapEnt[] = [];
    for (const e of visible.values()) {
      const flags = flagsOf(e);
      const vx = e.kind === 2 ? (e as Proj).vx : 0;
      const vy = e.kind === 2 ? (e as Proj).vy : 0;
      const prev = conn.known.get(e.id);
      if (!prev) {
        added.push({
          id: e.id,
          kind: e.kind,
          subtype: e.subtype,
          flags,
          x: e.x,
          y: e.y,
          hp: e.hp,
          name: e.name,
        });
        conn.known.set(e.id, { x: e.x, y: e.y, hp: e.hp, flags, vx, vy });
      }
      const changed =
        !prev ||
        prev.x !== e.x ||
        prev.y !== e.y ||
        prev.hp !== e.hp ||
        prev.flags !== flags ||
        prev.vx !== vx ||
        prev.vy !== vy;
      if (e.id === p.id || changed) {
        const sent = conn.known.get(e.id);
        if (sent) {
          sent.x = e.x;
          sent.y = e.y;
          sent.hp = e.hp;
          sent.flags = flags;
          sent.vx = vx;
          sent.vy = vy;
        }
        delta.push({ id: e.id, kind: e.kind, subtype: e.subtype, flags, x: e.x, y: e.y, hp: e.hp, vx, vy });
      }
    }
    if (added.length) this.send(conn, encodeAdd(added));
    const mine: EvMsg[] = [];
    for (const ev of this.events) {
      if (ev.a === p.id || ev.b === p.id || conn.subscribed.has(chunkKeyOf(ev.x, ev.y))) mine.push(ev);
    }
    if (mine.length) this.send(conn, encodeEvents(mine));
    const zone = zoneAt(p.x, p.y);
    this.send(
      conn,
      encodeSnap({
        tick: this.tickN,
        ack: p.inputs.lastProcessed,
        attackCd: p.attackCd,
        skillCd: p.skillCd,
        zone: zone === 'safe' ? 0 : zone === 'pvp' ? 2 : 1,
        online: this.players.size,
        ents: delta,
      }),
    );
    return { chunks: conn.subscribed.size, interest: visible.size, delta: delta.length };
  }

  private send(conn: Conn, bytes: Uint8Array): void {
    if (conn.socket.readyState !== 1) return;
    conn.socket.send(bytes);
    conn.bytesOut += bytes.byteLength;
  }
}

function flagsOf(e: { facingRight?: boolean; dead?: boolean; attacking?: number; stun?: number; moving?: boolean; aggro?: boolean }): number {
  let f = 0;
  if (e.facingRight) f |= FLAG.FacingRight;
  if (e.dead) f |= FLAG.Dead;
  if ((e.attacking ?? 0) > 0) f |= FLAG.Attacking;
  if ((e.stun ?? 0) > 0) f |= FLAG.Stunned;
  if (e.moving) f |= FLAG.Moving;
  if (e.aggro) f |= FLAG.Aggro;
  return f;
}

function spread(vx: number, vy: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [Math.round(vx * c - vy * s), Math.round(vx * s + vy * c)];
}
