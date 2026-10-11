import Phaser from 'phaser';
import {
  CHUNK,
  CLASSES,
  EV,
  FLAG,
  FX,
  INTERP_MS,
  KIND,
  MONSTERS,
  SUB,
  TICK_MS,
  TILE,
  WORLD_H,
  WORLD_W,
  tileIsSolid,
} from '../../shared/src/constants.ts';
import { sampleInterp, type InterpSample } from '../../shared/src/interest.ts';
import {
  decodeAdd,
  decodeChunk,
  decodeEvents,
  decodeRegions,
  decodeRemove,
  decodeSnap,
  decodeWelcome,
  type AddEnt,
} from '../../shared/src/protocol.ts';
import { Predictor } from './predict.ts';
import { textCanvas } from './font.ts';
import { input } from './input.ts';

export const bridge = {
  scene: null as GameScene | null,
  queue: [] as Uint8Array[],
  send: (_buf: Uint8Array) => {},
  onHud: (_s: HudState) => {},
  deliver(buf: Uint8Array) {
    if (this.scene) this.scene.onPacket(buf);
    else this.queue.push(buf);
  },
};

export interface HudState {
  name: string;
  className: string;
  level: number;
  hp: number;
  hpMax: number;
  online: number;
  zone: 'safe' | 'pve' | 'pvp';
  zoneName: string;
  attackCd: number;
  skillCd: number;
  attackMax: number;
  skillMax: number;
  dead: boolean;
  deadIn: number;
  banner: string;
}

interface RegionView {
  zone: 'safe' | 'pve' | 'pvp';
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
}

interface EntView {
  id: number;
  kind: number;
  subtype: number;
  hp: number;
  flags: number;
  name: string;
  vx: number;
  vy: number;
  samples: InterpSample[];
  sprite: Phaser.GameObjects.Sprite;
  label?: Phaser.GameObjects.Image;
  bar?: Phaser.GameObjects.Graphics;
}

interface Floater {
  img: Phaser.GameObjects.Image;
  life: number;
}

// Actors sort by y (10 + y, up to ~1550). Overlays must sit above every actor.
const DEPTH_LABEL = 4000;
const DEPTH_FX = 5000;
const DEPTH_FLOAT = 6000;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function chooseZoom(w: number, h: number): number {
  return Math.min(w, h) >= 448 ? 4 : 3;
}

export class GameScene extends Phaser.Scene {
  predictor = new Predictor();
  selfId = 0;
  joined = false;
  classId = 0;
  level = 1;
  hp = 1;
  hpMax = 1;
  online = 1;
  attackCd = 0;
  skillCd = 0;
  zone: HudState['zone'] = 'safe';
  zoneName = 'Wilds';
  private acc = 0;
  private lastZone: HudState['zone'] = 'safe';
  private serverTick = 0;
  private serverAt = 0;
  private tileImg: CanvasImageSource | null = null;
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private solids = new Map<string, Uint8Array>();
  private ents = new Map<number, EntView>();
  private regions: RegionView[] = [];
  private zoneGfx: Phaser.GameObjects.Graphics | null = null;
  private entrances: { x: number; y: number; name: string }[] = [];
  private floaters: Floater[] = [];
  private banner = '';
  private bannerUntil = 0;
  private deadUntil = 0;
  private minimap: HTMLCanvasElement | null = null;
  private frameDts: number[] = [];
  private debug = false;
  private stepDir = 0;
  private miniTick = 0;
  private missing = 0;
  private tilesetOk = false;
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
    F: Phaser.Input.Keyboard.Key;
    UP: Phaser.Input.Keyboard.Key;
    DOWN: Phaser.Input.Keyboard.Key;
    LEFT: Phaser.Input.Keyboard.Key;
    RIGHT: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('game');
  }

  preload(): void {
    const base = import.meta.env.BASE_URL;
    this.load.spritesheet('tiles', base + 'assets/tilemap_packed.png', {
      frameWidth: 16,
      frameHeight: 16,
      spacing: 0,
      margin: 0,
    });
    this.load.spritesheet('fx-hit', base + 'assets/fx/hit_yellow.png', { frameWidth: 48, frameHeight: 48 });
    this.load.spritesheet('fx-arrow', base + 'assets/fx/hit_blue.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('fx-magic', base + 'assets/fx/magic_blue.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('fx-fire', base + 'assets/fx/fire_orange.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('fx-smoke', base + 'assets/fx/smoke_brown.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('fx-stun', base + 'assets/fx/stun_violet.png', { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    this.tileImg = this.textures.get('tiles').getSourceImage() as CanvasImageSource;
    const anim = (key: string, end: number) => {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: 15, hideOnComplete: true });
    };
    anim('fx-hit', 6);
    anim('fx-arrow', 6);
    anim('fx-magic', 13);
    anim('fx-fire', 7);
    anim('fx-smoke', 9);
    anim('fx-stun', 7);
    this.makeProjTextures();
    const kb = this.input.keyboard!;
    // No Phaser key capture: it calls preventDefault on window keydown, which
    // swallowed W/A/S/D/F/space/arrows in the login and name fields. The
    // listener below blocks page scrolling only outside text fields.
    this.keys = kb.addKeys('W,A,S,D,SPACE,F,UP,DOWN,LEFT,RIGHT', false) as GameScene['keys'];
    kb.clearCaptures();
    window.addEventListener('keydown', (e) => {
      if (isEditable(e.target)) return;
      if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    });
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setBackgroundColor('#141014');
    // Phaser's camera matrix applies zoom to the origin offset. With the
    // default origin of 0.5 and zoom 3, the view is shifted by a full screen
    // and the player is culled. Origin 0 keeps scroll as the top-left.
    this.cameras.main.setOrigin(0, 0);
    this.scale.on('resize', () => this.applyZoom());
    this.applyZoom();
    this.tilesetOk = this.assertTileset();
    this.minimap = document.getElementById('minimap') as HTMLCanvasElement | null;
    this.debug = new URLSearchParams(location.search).has('debug');
    bridge.scene = this;
    const queued = bridge.queue.splice(0);
    for (const b of queued) this.onPacket(b);
    const prev = (window as unknown as { __TINY__?: Record<string, unknown> }).__TINY__ ?? {};
    (window as unknown as { __TINY__: Record<string, unknown> }).__TINY__ = {
      ...prev,
      getState: () => this.debugState(),
    };
  }

  private applyZoom(): void {
    const cam = this.cameras.main;
    cam.setZoom(chooseZoom(this.scale.width, this.scale.height));
  }

  /** tilemap_packed.png is 12 columns, no spacing. Frame N is row*12+col. */
  private assertTileset(): boolean {
    const tex = this.textures.get('tiles');
    const src = tex.getSourceImage() as { width?: number; height?: number };
    const cols = 12;
    const okSize = src.width === 192 && src.height === 176;
    let ok = okSize;
    for (let i = 0; i < cols * 11; i++) {
      const frame = tex.get(i);
      const missing = !tex.has(String(i)) || frame.texture.key === '__MISSING' || String(frame.name) === '__MISSING';
      const col = i % cols;
      const row = Math.floor(i / cols);
      if (missing || frame.cutX !== col * 16 || frame.cutY !== row * 16 || frame.cutWidth !== 16 || frame.cutHeight !== 16) {
        ok = false;
        console.error('[tiny] bad tile frame', i, frame?.cutX, frame?.cutY, frame?.name);
      }
    }
    if (!ok) console.error('[tiny] tileset check failed', src.width, src.height);
    return ok;
  }

  private makeProjTextures(): void {
    const paint = (key: string, draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const g = c.getContext('2d');
      if (!g) return;
      draw(g);
      this.textures.addCanvas(key, c);
    };
    paint('orb', (g) => {
      g.fillStyle = '#7eb6ff';
      g.fillRect(6, 5, 4, 6);
      g.fillRect(5, 6, 6, 4);
    });
    paint('fireball', (g) => {
      g.fillStyle = '#ffb03a';
      g.fillRect(5, 4, 6, 8);
      g.fillRect(4, 6, 8, 4);
      g.fillStyle = '#fff1c2';
      g.fillRect(7, 7, 2, 2);
    });
    const dirs = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    dirs.forEach(([dx, dy], i) => {
      paint('arrow' + i, (g) => {
        g.fillStyle = '#f4efe2';
        for (let s = 0; s < 5; s++) g.fillRect(8 + dx * (s - 2), 8 + dy * (s - 2), 2, 2);
      });
    });
  }

  onPacket(buf: Uint8Array): void {
    const t = buf[0];
    if (t === 2) {
      const w = decodeWelcome(buf);
      if (!w) return;
      this.selfId = w.entityId;
      this.classId = w.classId;
      this.level = w.level;
      this.hp = w.hp;
      this.hpMax = w.hpMax;
      this.predictor.reset(w.x, w.y, CLASSES[w.classId]?.speed ?? 24);
      this.joined = true;
      this.serverTick = w.tick;
      this.serverAt = performance.now();
      return;
    }
    if (t === 10) {
      const r = decodeRegions(buf);
      if (!r) return;
      this.regions = r.regions;
      this.entrances = r.entrances;
      this.drawZoneMarks();
      return;
    }
    if (t === 8) {
      const c = decodeChunk(buf);
      if (c) this.addChunk(c.cx, c.cy, c.tiles);
      return;
    }
    if (t === 9 && buf.length >= 3) {
      this.removeChunk(buf[1], buf[2]);
      return;
    }
    if (t === 4) {
      const adds = decodeAdd(buf);
      if (adds) for (const a of adds) this.addEnt(a);
      return;
    }
    if (t === 5) {
      const ids = decodeRemove(buf);
      if (ids) for (const id of ids) this.removeEnt(id);
      return;
    }
    if (t === 6) {
      const snap = decodeSnap(buf);
      if (!snap) return;
      this.serverTick = snap.tick;
      this.serverAt = performance.now();
      this.online = snap.online;
      this.attackCd = snap.attackCd;
      this.skillCd = snap.skillCd;
      const z = snap.zone === 0 ? 'safe' : snap.zone === 2 ? 'pvp' : 'pve';
      this.noteZone(z);
      for (const e of snap.ents) {
        if (e.id === this.selfId) {
          this.hp = e.hp;
          this.predictor.reconcile(snap.ack, e.x, e.y, (tx, ty) => this.solidAt(tx, ty));
          this.ensureEnt(e.id, e.kind, e.subtype, e.hp, e.flags, '');
        }
        const view = this.ents.get(e.id);
        if (!view) continue;
        view.hp = e.hp;
        view.flags = e.flags;
        view.vx = e.vx;
        view.vy = e.vy;
        if (e.id !== this.selfId) view.samples.push({ t: snap.tick * TICK_MS, x: e.x, y: e.y });
      }
      return;
    }
    if (t === 7) {
      const evs = decodeEvents(buf);
      if (!evs) return;
      for (const ev of evs) {
        if (ev.ev === EV.DAMAGE) {
          if (ev.n > 0) this.float(ev.x, ev.y, String(ev.n), '#ffe08a');
          this.playFx(ev.fx || FX.HIT, ev.x, ev.y);
          const target = this.ents.get(ev.a);
          if (target) {
            target.sprite.setTintFill(0xffffff);
            this.time.delayedCall(70, () => target.sprite.clearTint());
          }
        } else if (ev.ev === EV.DEATH) {
          this.playFx(FX.SMOKE, ev.x, ev.y);
          if (ev.a === this.selfId) this.deadUntil = performance.now() + 3000;
        } else if (ev.ev === EV.SWING && ev.a !== this.selfId) {
          this.playFx(ev.fx || FX.HIT, ev.x, ev.y);
        } else if (ev.ev === EV.BANNER && ev.n === 3) {
          this.showBanner('The crypt is sealed. Dungeon instances come later.');
        }
      }
    }
  }

  private drawZoneMarks(): void {
    if (!this.zoneGfx) this.zoneGfx = this.add.graphics().setDepth(1);
    const g = this.zoneGfx;
    g.clear();
    for (const r of this.regions) {
      if (r.zone !== 'pvp') continue;
      const x = r.x * TILE;
      const y = r.y * TILE;
      const w = r.w * TILE;
      const h = r.h * TILE;
      g.fillStyle(0xff2a2a, 0.22);
      g.fillRect(x, y, w, h);
      g.lineStyle(2, 0xff2a2a, 1);
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      g.lineStyle(1, 0xffd0c8, 1);
      g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    }
  }

  private noteZone(z: HudState['zone']): void {
    if (z === 'pvp' && this.lastZone !== 'pvp') this.showBanner('Entering PvP zone');
    if (z !== 'pvp' && this.lastZone === 'pvp') this.showBanner('Leaving PvP zone');
    this.lastZone = z;
    this.zone = z;
    const hit = this.regions.find((r) => r.zone === z && this.tileIn(r));
    this.zoneName = z === 'pvp' ? 'Blood Pit' : z === 'safe' ? 'Millcross' : hit?.name || 'Wilds';
  }

  private tileIn(r: RegionView): boolean {
    const tx = Math.floor(this.predictor.x / (TILE * SUB));
    const ty = Math.floor(this.predictor.y / (TILE * SUB));
    return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
  }

  private showBanner(text: string): void {
    this.banner = text;
    this.bannerUntil = performance.now() + 2400;
  }

  private addChunk(cx: number, cy: number, tiles: Uint8Array): void {
    const key = cx + ',' + cy;
    this.solids.set(key, tiles);
    if (!this.tileImg) return;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK * TILE;
    canvas.height = CHUNK * TILE;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    for (let i = 0; i < tiles.length; i++) {
      const id = tiles[i];
      const sx = (id % 12) * TILE;
      const sy = Math.floor(id / 12) * TILE;
      g.drawImage(this.tileImg, sx, sy, TILE, TILE, (i % CHUNK) * TILE, Math.floor(i / CHUNK) * TILE, TILE, TILE);
    }
    if (this.textures.exists('chunk-' + key)) this.textures.remove('chunk-' + key);
    this.textures.addCanvas('chunk-' + key, canvas);
    const prev = this.chunks.get(key);
    prev?.destroy();
    const img = this.add.image(cx * CHUNK * TILE, cy * CHUNK * TILE, 'chunk-' + key).setOrigin(0, 0).setDepth(0);
    this.chunks.set(key, img);
    this.drawMinimap();
  }

  private removeChunk(cx: number, cy: number): void {
    const key = cx + ',' + cy;
    this.chunks.get(key)?.destroy();
    this.chunks.delete(key);
    this.solids.delete(key);
    if (this.textures.exists('chunk-' + key)) this.textures.remove('chunk-' + key);
    this.drawMinimap();
  }

  private solidAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const tiles = this.solids.get(cx + ',' + cy);
    if (!tiles) return true;
    const lx = tx - cx * CHUNK;
    const ly = ty - cy * CHUNK;
    return tileIsSolid(tiles[ly * CHUNK + lx]);
  }

  private addEnt(a: AddEnt): void {
    this.ensureEnt(a.id, a.kind, a.subtype, a.hp, a.flags, a.name);
    const view = this.ents.get(a.id);
    if (!view) return;
    view.samples.push({ t: this.serverTick * TICK_MS, x: a.x, y: a.y });
  }

  private ensureEnt(id: number, kind: number, subtype: number, hp: number, flags: number, name: string): void {
    let view = this.ents.get(id);
    if (!view) {
      const frame = kind === KIND.PLAYER ? CLASSES[subtype]?.tile ?? 96 : kind === KIND.MONSTER ? MONSTERS[subtype]?.tile ?? 108 : 0;
      const key = kind === KIND.PROJECTILE ? (subtype === 2 ? 'fireball' : subtype === 1 ? 'orb' : 'arrow0') : 'tiles';
      const sprite = (kind === KIND.PROJECTILE ? this.add.sprite(0, 0, key) : this.add.sprite(0, 0, key, frame)).setDepth(2);
      sprite.setOrigin(0.5, 0.5);
      if (sprite.texture.key === '__MISSING' || String(sprite.frame?.name) === '__MISSING') this.missing++;
      view = { id, kind, subtype, hp, flags, name, vx: 0, vy: 0, samples: [], sprite };
      if (kind === KIND.MONSTER) view.bar = this.add.graphics().setDepth(DEPTH_LABEL);
      this.ents.set(id, view);
    }
    view.kind = kind;
    view.subtype = subtype;
    view.hp = hp;
    view.flags = flags;
    if (name) view.name = name;
    if (kind === KIND.PLAYER && view.name && !view.label) {
      const color = subtype === 0 ? '#d5deea' : subtype === 1 ? '#b6e39a' : '#e0c6ff';
      const tex = 'name-' + view.name + '-' + subtype;
      if (!this.textures.exists(tex)) this.textures.addCanvas(tex, textCanvas(view.name, color, 1));
      view.label = this.add.image(0, 0, tex).setDepth(DEPTH_LABEL).setOrigin(0.5, 1);
    }
  }

  private removeEnt(id: number): void {
    const view = this.ents.get(id);
    if (!view || id === this.selfId) return;
    view.sprite.destroy();
    view.label?.destroy();
    view.bar?.destroy();
    this.ents.delete(id);
  }

  private playFx(fx: number, x: number, y: number): void {
    const key =
      fx === FX.ARROW ? 'fx-arrow' : fx === FX.MAGIC ? 'fx-magic' : fx === FX.FIRE ? 'fx-fire' : fx === FX.SMOKE ? 'fx-smoke' : fx === FX.STUN ? 'fx-stun' : 'fx-hit';
    const s = this.add.sprite(x / SUB, y / SUB, key).setDepth(DEPTH_FX).setOrigin(0.5, 0.5);
    s.play(key);
    s.once('animationcomplete', () => s.destroy());
  }

  private float(x: number, y: number, text: string, color: string): void {
    const tex = 'dmg-' + text + color;
    if (!this.textures.exists(tex)) this.textures.addCanvas(tex, textCanvas(text, color, 2));
    const img = this.add.image(x / SUB, y / SUB - 10, tex).setDepth(DEPTH_FLOAT).setOrigin(0.5, 1);
    this.floaters.push({ img, life: 700 });
  }

  update(_time: number, delta: number): void {
    this.frameDts.push(delta);
    if (this.frameDts.length > 180) this.frameDts.shift();
    if (!this.joined) return;
    if (delta > 200) this.acc = 0;
    else {
      this.acc += delta;
      let n = 0;
      while (this.acc >= TICK_MS && n < 3) {
        this.simStep();
        this.acc -= TICK_MS;
        n++;
      }
    }
    const alpha = Math.max(0, Math.min(1, this.acc / TICK_MS));
    this.render(alpha, delta);
  }

  private simStep(): void {
    const typing = document.activeElement?.tagName === 'INPUT';
    let dir = input.joyDir;
    const k = this.keys;
    if (!typing) {
      let x = 0;
      let y = 0;
      if (k.A.isDown || k.LEFT.isDown) x -= 1;
      if (k.D.isDown || k.RIGHT.isDown) x += 1;
      if (k.W.isDown || k.UP.isDown) y -= 1;
      if (k.S.isDown || k.DOWN.isDown) y += 1;
      if (x !== 0 || y !== 0) {
        dir = y < 0 && x === 0 ? 1 : y < 0 && x > 0 ? 2 : y === 0 && x > 0 ? 3 : y > 0 && x > 0 ? 4 : y > 0 && x === 0 ? 5 : y > 0 && x < 0 ? 6 : y === 0 && x < 0 ? 7 : 8;
      }
      if (Phaser.Input.Keyboard.JustDown(k.F)) input.skillEdge = true;
      input.attack = input.pointerAttack || k.SPACE.isDown;
    }
    this.stepDir = dir;
    let buttons = 0;
    if (input.attack) buttons |= 1;
    if (input.skillEdge) {
      buttons |= 2;
      input.skillEdge = false;
    }
    const cmd = this.predictor.step(dir, buttons, (tx, ty) => this.solidAt(tx, ty));
    bridge.send(encodeInputBytes(cmd.seq, cmd.dir, cmd.buttons));
  }

  private render(alpha: number, delta: number): void {
    const now = performance.now();
    const est = this.serverTick * TICK_MS + (now - this.serverAt);
    const renderT = est - INTERP_MS;
    const rx = this.predictor.prevX + (this.predictor.x - this.predictor.prevX) * alpha;
    const ry = this.predictor.prevY + (this.predictor.y - this.predictor.prevY) * alpha;
    const bob = this.stepDir !== 0 && Math.floor(now / 140) % 2 === 0 ? -1 : 0;
    for (const view of this.ents.values()) {
      let x: number;
      let y: number;
      if (view.id === this.selfId) {
        x = rx / SUB;
        y = ry / SUB;
        view.sprite.setFlipX(!this.predictor.facingRight);
      } else {
        while (view.samples.length > 8 && view.samples[0].t < renderT - 400) view.samples.shift();
        const s = sampleInterp(view.samples, renderT);
        if (!s) continue;
        x = s.x / SUB;
        y = s.y / SUB;
        view.sprite.setFlipX((view.flags & FLAG.FacingRight) === 0);
        if (view.kind === KIND.PROJECTILE) {
          const idx = arrowFrame(view.vx, view.vy);
          if (view.subtype === 0) view.sprite.setTexture('arrow' + idx);
        }
      }
      const dead = (view.flags & FLAG.Dead) !== 0;
      view.sprite.setVisible(!dead);
      view.label?.setVisible(!dead && view.kind === KIND.PLAYER);
      const moving = view.id === this.selfId ? bob !== 0 : (view.flags & FLAG.Moving) !== 0;
      const oy = moving && Math.floor(now / 140) % 2 === 0 ? -1 : 0;
      view.sprite.setPosition(Math.round(x), Math.round(y + oy));
      view.sprite.setDepth(10 + y);
      if (view.label) view.label.setPosition(Math.round(x), Math.round(y) - 10);
      if (view.bar) {
        view.bar.clear();
        if (!dead && view.kind === KIND.MONSTER) {
          const max = MONSTERS[view.subtype]?.hp ?? 1;
          view.bar.fillStyle(0x000000, 0.8);
          view.bar.fillRect(Math.round(x) - 7, Math.round(y) - 12, 14, 3);
          view.bar.fillStyle(0xd4533c, 1);
          view.bar.fillRect(Math.round(x) - 7, Math.round(y) - 12, Math.round(14 * Math.max(0, view.hp) / max), 3);
        }
      }
    }
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    const viewX = rx / SUB;
    const viewY = ry / SUB;
    cam.setScroll(Math.round(viewX - cam.width / z / 2), Math.round(viewY - cam.height / z / 2));
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= delta;
      f.img.y -= delta * 0.02;
      f.img.setAlpha(Math.max(0, f.life / 700));
      if (f.life <= 0) {
        f.img.destroy();
        this.floaters.splice(i, 1);
      }
    }
    const tx = Math.floor(this.predictor.x / (TILE * SUB));
    const ty = Math.floor(this.predictor.y / (TILE * SUB));
    let local: HudState['zone'] = 'pve';
    let localName = 'Wilds';
    for (const r of this.regions) {
      if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) {
        local = r.zone;
        localName = r.name;
      }
    }
    if (local !== this.zone) this.noteZone(local);
    else this.zoneName = localName;
    const banner = now < this.bannerUntil ? this.banner : '';
    const selfEnt = this.ents.get(this.selfId);
    const selfFlags = selfEnt?.flags ?? 0;
    const dead = (selfFlags & FLAG.Dead) !== 0 || this.hp <= 0;
    bridge.onHud({
      name: this.ents.get(this.selfId)?.name || '',
      className: CLASSES[this.classId]?.name ?? '',
      level: this.level,
      hp: this.hp,
      hpMax: this.hpMax,
      online: this.online,
      zone: this.zone,
      zoneName: this.zoneName,
      attackCd: this.attackCd,
      skillCd: this.skillCd,
      attackMax: CLASSES[this.classId]?.attackCd ?? 1,
      skillMax: CLASSES[this.classId]?.skillCd ?? 1,
      dead,
      deadIn: Math.max(0, this.deadUntil - now),
      banner,
    });
    if (++this.miniTick % 8 === 0) this.drawMinimap();
    if (this.debug && Math.floor(now / 500) !== Math.floor((now - delta) / 500)) {
      const st = this.debugState();
      console.log('[tiny]', JSON.stringify({ selfId: st.selfId, x: st.x, y: st.y, sent: st.sent, acked: st.acked, chunks: st.chunks.length, others: st.entities.filter((e) => e.id !== st.selfId).slice(0, 8) }));
    }
  }

  private drawMinimap(): void {
    const c = this.minimap;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1a1214';
    g.fillRect(0, 0, 64, 48);
    for (const [key, tiles] of this.solids) {
      const [cx, cy] = key.split(',').map(Number);
      for (let ly = 0; ly < CHUNK; ly += 2) {
        for (let lx = 0; lx < CHUNK; lx += 2) {
          const id = tiles[ly * CHUNK + lx];
          g.fillStyle = tileIsSolid(id) ? '#9aabbf' : id === 0 || id === 24 ? '#6a3832' : '#e0a56c';
          g.fillRect(cx * 16 + lx / 2, cy * 16 + ly / 2, 1, 1);
        }
      }
    }
    g.strokeStyle = '#ff4040';
    g.lineWidth = 1;
    for (const r of this.regions) {
      if (r.zone !== 'pvp') continue;
      g.strokeRect(r.x / 2 + 0.5, r.y / 2 + 0.5, r.w / 2 - 1, r.h / 2 - 1);
    }
    const px = Math.floor(this.predictor.x / SUB / TILE / 2);
    const py = Math.floor(this.predictor.y / SUB / TILE / 2);
    g.fillStyle = '#fff6d8';
    g.fillRect(px, py, 2, 2);
  }

  private debugState() {
    const ents = [];
    for (const v of this.ents.values()) {
      const last = v.samples[v.samples.length - 1];
      ents.push({
        id: v.id,
        kind: v.kind,
        hp: v.hp,
        x: v.id === this.selfId ? this.predictor.x / SUB : (last ? last.x / SUB : v.sprite.x),
        y: v.id === this.selfId ? this.predictor.y / SUB : (last ? last.y / SUB : v.sprite.y),
        subtype: v.subtype,
        sx: v.sprite.x,
        sy: v.sprite.y,
        vis: v.sprite.visible,
      });
    }
    const dts = [...this.frameDts].sort((a, b) => a - b);
    const fpsOf = (dt: number) => (dt > 0 ? 1000 / dt : 0);
    const median = dts.length ? fpsOf(dts[Math.floor(dts.length / 2)]) : 0;
    const p10 = dts.length ? fpsOf(dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.9))]) : 0;
    const selfEnt = this.ents.get(this.selfId);
    const frame = selfEnt?.sprite.frame;
    const tx = Math.floor(this.predictor.x / (TILE * SUB));
    const ty = Math.floor(this.predictor.y / (TILE * SUB));
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const local = this.solids.get(cx + ',' + cy);
    const tileUnder = local ? local[(ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK)] : -1;
    return {
      selfId: this.selfId,
      x: this.predictor.x / SUB,
      y: this.predictor.y / SUB,
      hp: this.hp,
      tileUnder,
      tilesetOk: this.tilesetOk,
      missing: this.missing,
      frame: frame ? { name: String(frame.name), x: frame.cutX, y: frame.cutY, w: frame.cutWidth, h: frame.cutHeight, u0: frame.u0, v0: frame.v0, u1: frame.u1, v1: frame.v1 } : null,
      source: frame ? { w: frame.source.width, h: frame.source.height } : null,
      zone: this.zone,
      cam: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY, z: this.cameras.main.zoom },
      sent: this.predictor.sent,
      acked: this.predictor.acked,
      pending: this.predictor.pending.length,
      lastAck: this.predictor.sent - this.predictor.pending.length,
      chunks: [...this.chunks.keys()],
      entities: ents,
      banner: this.banner,
      screen: 'world',
      fpsMedian: Math.round(median),
      fpsP10: Math.round(p10),
    };
  }
}

function encodeInputBytes(seq: number, dir: number, buttons: number): Uint8Array {
  const b = new Uint8Array(7);
  const v = new DataView(b.buffer);
  v.setUint8(0, 3);
  v.setUint32(1, seq >>> 0, true);
  v.setUint8(5, dir & 15);
  v.setUint8(6, buttons & 15);
  return b;
}

function arrowFrame(vx: number, vy: number): number {
  if (vy < 0 && vx === 0) return 6;
  if (vy < 0 && vx > 0) return 7;
  if (vy === 0 && vx > 0) return 0;
  if (vy > 0 && vx > 0) return 1;
  if (vy > 0 && vx === 0) return 2;
  if (vy > 0 && vx < 0) return 3;
  if (vy === 0 && vx < 0) return 4;
  if (vy < 0 && vx < 0) return 5;
  return 0;
}
