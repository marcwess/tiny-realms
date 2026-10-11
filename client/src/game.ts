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
import { BRIDGE, BRIDGE_N, BRIDGE_S, CAMPFIRE, DUNGEON, PIT_BANNER, tileFrame, tileIsTall } from '../../shared/src/tiles.ts';
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
  /** A new socket is opening: stop sending until its WELCOME resets the predictor. */
  newSession() {
    if (this.scene) this.scene.joined = false;
    this.queue.length = 0;
  },
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
  xp: number;
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
  hpMax: number;
  flags: number;
  name: string;
  vx: number;
  vy: number;
  samples: InterpSample[];
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Image;
  bar?: Phaser.GameObjects.Graphics;
  bang?: Phaser.GameObjects.Image;
  aggroAt: number;
}

interface Floater {
  img: Phaser.GameObjects.Image;
  life: number;
  born: number;
}

interface ChunkDraw {
  ground: Phaser.GameObjects.Image;
  rows: Phaser.GameObjects.Image[];
  fires: Phaser.GameObjects.Sprite[];
  roofs: Phaser.GameObjects.Image[];
}

const WATER_IDS = new Set([48, 49, 50, 60, 61, 62, 76, 77, 79, 126]);
// Tiny Town has no water frames. The shore ids from world.ts only say which
// sides touch land; the water itself is painted here.
const WATER_N = new Set([48, 49, 50]);
const WATER_S = new Set([60, 61, 62]);
const WATER_W = new Set([48, 60, 76]);
const WATER_E = new Set([50, 62, 79]);

function paintWater(g: CanvasRenderingContext2D, id: number, dx: number, dy: number): void {
  g.fillStyle = '#3d7fd0';
  g.fillRect(dx, dy, TILE, TILE);
  const h = (Math.imul(dx + 7, 374761393) ^ Math.imul(dy + 3, 668265263)) >>> 0;
  g.fillStyle = '#5b9ee6';
  g.fillRect(dx + (h % 9) + 1, dy + ((h >>> 4) % 5) + 3, 5, 1);
  g.fillRect(dx + ((h >>> 8) % 8) + 2, dy + ((h >>> 12) % 4) + 10, 4, 1);
  if (id === 77) {
    g.fillStyle = '#9fd0f5';
    g.fillRect(dx + ((h >>> 16) % 10) + 2, dy + 7, 3, 1);
  }
  const foam = '#bfe3f7';
  const bank = '#24442b';
  if (WATER_N.has(id)) {
    g.fillStyle = '#2d63a8';
    g.fillRect(dx, dy, TILE, 3);
    g.fillStyle = bank;
    g.fillRect(dx, dy, TILE, 1);
  }
  if (WATER_S.has(id)) {
    g.fillStyle = foam;
    g.fillRect(dx, dy + TILE - 2, TILE, 1);
    g.fillStyle = bank;
    g.fillRect(dx, dy + TILE - 1, TILE, 1);
  }
  if (WATER_W.has(id)) {
    g.fillStyle = foam;
    g.fillRect(dx + 1, dy, 1, TILE);
    g.fillStyle = bank;
    g.fillRect(dx, dy, 1, TILE);
  }
  if (WATER_E.has(id)) {
    g.fillStyle = foam;
    g.fillRect(dx + TILE - 2, dy, 1, TILE);
    g.fillStyle = bank;
    g.fillRect(dx + TILE - 1, dy, 1, TILE);
  }
}

/** Planks run across the river (east-west road), with rails on the open edges. */
function paintBridge(g: CanvasRenderingContext2D, id: number, dx: number, dy: number): void {
  g.fillStyle = '#b07440';
  g.fillRect(dx, dy, TILE, TILE);
  g.fillStyle = '#8a5530';
  for (let x = 3; x < TILE; x += 4) g.fillRect(dx + x, dy, 1, TILE);
  g.fillStyle = '#c98d55';
  for (let x = 0; x < TILE; x += 4) g.fillRect(dx + x, dy + ((x >> 2) % 2 ? 5 : 11), 3, 1);
  if (id === BRIDGE_N || id === BRIDGE_S) {
    const ry = id === BRIDGE_N ? dy : dy + TILE - 4;
    g.fillStyle = '#3b2416';
    g.fillRect(dx, ry, TILE, 4);
    g.fillStyle = '#7a4a28';
    g.fillRect(dx, ry + 1, TILE, 2);
    g.fillStyle = '#3b2416';
    g.fillRect(dx + 7, ry, 2, 4);
  }
}

function paintBanner(g: CanvasRenderingContext2D, dx: number, dy: number): void {
  g.fillStyle = '#2a1a12';
  g.fillRect(dx + 4, dy + 1, 3, 15);
  g.fillRect(dx + 6, dy + 2, 8, 9);
  g.fillRect(dx + 7, dy + 11, 6, 2);
  g.fillRect(dx + 8, dy + 13, 4, 1);
  g.fillStyle = '#8a5a34';
  g.fillRect(dx + 5, dy + 1, 1, 15);
  g.fillStyle = '#c8322c';
  g.fillRect(dx + 7, dy + 3, 6, 7);
  g.fillRect(dx + 8, dy + 10, 4, 2);
  g.fillStyle = '#f2a33a';
  g.fillRect(dx + 9, dy + 5, 2, 3);
}

const ROOF_IDS = new Set([52, 53, 54, 64, 65, 66, 72, 73, 75]);
const PATH_IDS = new Set([12, 13, 14, 24, 25, 26, 36, 37, 38, 39, 40, 41, 42]);

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
  xp = 0;
  zone: HudState['zone'] = 'pve';
  zoneName = 'Wilds';
  private acc = 0;
  private lastZone: HudState['zone'] = 'pve';
  private serverTick = 0;
  private serverAt = 0;
  private tileImg: CanvasImageSource | null = null;
  private townImg: CanvasImageSource | null = null;
  private chunkDraw = new Map<string, ChunkDraw>();
  private solids = new Map<string, { ground: Uint8Array; object: Uint8Array }>();
  private ents = new Map<number, EntView>();
  private regions: RegionView[] = [];
  private zoneGfx: Phaser.GameObjects.Graphics | null = null;
  private entrances: { x: number; y: number; name: string }[] = [];
  private floaters: Floater[] = [];
  private banner = '';
  private bannerUntil = 0;
  private deadUntil = 0;
  private minimap: HTMLCanvasElement | null = null;
  private motes: { img: Phaser.GameObjects.Image; vx: number; vy: number; bob: number }[] = [];
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
    this.load.spritesheet('town', base + 'assets/town_packed.png', {
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
    this.townImg = this.textures.get('town').getSourceImage() as CanvasImageSource;
    const anim = (key: string, end: number) => {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: 15, hideOnComplete: true });
    };
    anim('fx-hit', 6);
    anim('fx-arrow', 6);
    anim('fx-magic', 13);
    anim('fx-fire', 7);
    anim('fx-smoke', 9);
    anim('fx-stun', 7);
    this.anims.create({
      key: 'fx-fire-loop',
      frames: this.anims.generateFrameNumbers('fx-fire', { start: 0, end: 7 }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: 'fx-smoke-loop',
      frames: this.anims.generateFrameNumbers('fx-smoke', { start: 0, end: 9 }),
      frameRate: 8,
      repeat: -1,
    });
    this.makeDecorTextures();
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
    this.spawnMotes();
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

  private makeDecorTextures(): void {
    const paint = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!g) return;
      draw(g);
      this.textures.addCanvas(key, c);
    };
    // Three-frame campfire flame. The Gigapack fire/smoke strips are bursts
    // (an expanding ring), which read as a pulsing circle when looped.
    const FLAMES = [
      ['..o.....', '..oo..o.', '.oyo..o.', '.oyyooo.', 'oyywyyo.', 'oywwwyoo', 'oywwwyyo', '.oyyyyo.'],
      ['....o...', '.o..oo..', '.o.oyo..', '.ooyyo.o', '.oyywyoo', 'ooywwwyo', 'oyywwwyo', '.oyyyyo.'],
      ['...o....', '...oo.o.', '..oyo.o.', 'o.oyyoo.', 'ooyywyo.', 'oyywwwoo', 'oyywwwyo', '.oyyyyo.'],
    ];
    paint('campflame', 8 * FLAMES.length, 8, (g) => {
      const col: Record<string, string> = { o: '#e2531f', y: '#f7b733', w: '#fff3b0' };
      FLAMES.forEach((rows, f) => {
        rows.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            const c = col[row[x]];
            if (!c) continue;
            g.fillStyle = c;
            g.fillRect(f * 8 + x, y, 1, 1);
          }
        });
      });
    });
    const flameTex = this.textures.get('campflame');
    for (let f = 0; f < FLAMES.length; f++) flameTex.add(String(f), 0, f * 8, 0, 8, 8);
    this.anims.create({
      key: 'campflame-loop',
      frames: FLAMES.map((_, f) => ({ key: 'campflame', frame: String(f) })),
      frameRate: 7,
      repeat: -1,
    });
    paint('shadow', 12, 6, (g) => {
      g.fillStyle = 'rgba(20, 28, 16, 0.45)';
      g.beginPath();
      g.ellipse(6, 3, 5, 2, 0, 0, Math.PI * 2);
      g.fill();
    });
    paint('leaf', 3, 3, (g) => {
      g.fillStyle = '#7dba55';
      g.fillRect(0, 1, 3, 1);
      g.fillRect(1, 0, 1, 3);
    });
    paint('bug', 2, 2, (g) => {
      g.fillStyle = '#ffe27a';
      g.fillRect(0, 0, 2, 2);
    });
    paint('ripple', 4, 2, (g) => {
      g.fillStyle = 'rgba(186, 220, 255, 0.85)';
      g.fillRect(0, 0, 4, 1);
      g.fillRect(1, 1, 2, 1);
    });
  }

  private spawnMotes(): void {
    for (let i = 0; i < 18; i++) {
      const bug = i >= 10 && i < 15;
      const ripple = i >= 15;
      const key = ripple ? 'ripple' : bug ? 'bug' : 'leaf';
      const img = this.add.image(0, 0, key).setDepth(2500).setAlpha(ripple ? 0.55 : bug ? 0.9 : 0.8);
      this.motes.push({ img, vx: ripple ? 4 : bug ? 6 : 10 + (i % 3) * 4, vy: bug ? -4 : ripple ? 3 : 6, bob: i * 40 });
    }
  }

  private driftMotes(sx: number, sy: number, vw: number, vh: number, now: number): void {
    const spanX = vw + 24;
    const spanY = vh + 24;
    for (const m of this.motes) {
      const t = (now + m.bob) / 1000;
      let x = sx - 12 + ((m.vx * t * 8 + m.bob * 13) % spanX);
      let y = sy - 12 + ((m.vy * t * 6 + m.bob * 17) % spanY);
      if (m.vy < 0) y = sy + vh - ((-m.vy * t * 10 + m.bob) % spanY);
      m.img.setPosition(Math.round(x), Math.round(y + Math.sin(t * 3 + m.bob) * 2));
    }
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
      this.xp = w.xp;
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
      if (c) this.addChunk(c.cx, c.cy, c.ground, c.object);
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
          const crit = (ev.fx & 128) !== 0;
          const fx = ev.fx & 127;
          if (ev.n > 0) this.float(ev.x, ev.y, String(ev.n), crit ? '#ffe14a' : '#fff1c4');
          this.playFx(fx || FX.HIT, ev.x, ev.y - 40);
          if (crit || ev.n >= 14) this.cameras.main.shake(70, 0.0016);
          const target = this.ents.get(ev.a);
          if (target) {
            target.sprite.setTintFill(0xfff6e8);
            this.time.delayedCall(70, () => target.sprite.clearTint());
          }
        } else if (ev.ev === EV.DEATH) {
          this.playFx(FX.SMOKE, ev.x, ev.y);
          if (ev.a === this.selfId) this.deadUntil = performance.now() + 3000;
        } else if (ev.ev === EV.SWING) {
          const ox = ev.b === 3 ? 140 : ev.b === 7 ? -140 : 0;
          this.playFx(ev.fx || FX.HIT, ev.x + ox, ev.y);
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
      g.fillStyle(0xff2a2a, 0.05);
      g.fillRect(x, y, w, h);
      g.lineStyle(1, 0xff6a5a, 0.7);
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      g.lineStyle(1, 0xffd0c8, 1);
      g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    }
  }

  private noteZone(z: HudState['zone']): void {
    if (z !== this.lastZone) {
      if (z === 'pvp') this.showBanner('Blood Pit - PvP');
      else if (z === 'safe') this.showBanner('Millcross');
      else if (this.lastZone === 'safe' || this.lastZone === 'pvp') this.showBanner('Wilds');
    }
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

  private addChunk(cx: number, cy: number, ground: Uint8Array, object: Uint8Array): void {
    const key = cx + ',' + cy;
    this.solids.set(key, { ground, object });
    if (!this.townImg || !this.tileImg) return;
    const size = CHUNK * TILE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    const rows = new Map<number, HTMLCanvasElement>();
    const rowCtx = new Map<number, CanvasRenderingContext2D>();
    const fires: { x: number; y: number }[] = [];
    const roofCells: { lx: number; ly: number; id: number }[] = [];
    for (let i = 0; i < ground.length; i++) {
      const lx = i % CHUNK;
      const ly = Math.floor(i / CHUNK);
      const dx = lx * TILE;
      const dy = ly * TILE;
      this.blitTile(g, ground[i], dx, dy);
      const obj = object[i];
      if (!obj) continue;
      if (ROOF_IDS.has(obj)) {
        roofCells.push({ lx, ly, id: obj });
        g.fillStyle = 'rgba(20, 30, 16, 0.28)';
        g.beginPath();
        g.ellipse(dx + 8, dy + 14, 6, 2, 0, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      if (tileIsTall(obj)) {
        let rg = rowCtx.get(ly);
        if (!rg) {
          const c = document.createElement('canvas');
          c.width = size;
          c.height = TILE;
          const ctx = c.getContext('2d');
          if (!ctx) continue;
          ctx.imageSmoothingEnabled = false;
          rows.set(ly, c);
          rowCtx.set(ly, ctx);
          rg = ctx;
        }
        g.fillStyle = 'rgba(20, 30, 16, 0.3)';
        g.beginPath();
        g.ellipse(dx + 8, dy + 13, 5, 2.2, 0, 0, Math.PI * 2);
        g.fill();
        this.blitTile(rg, obj, dx, 0);
        if (obj === CAMPFIRE) fires.push({ x: cx * size + dx + 8, y: cy * size + dy + 12 });
      } else {
        this.blitTile(g, obj, dx, dy);
      }
    }
    this.destroyChunk(key);
    if (this.textures.exists('chunk-' + key)) this.textures.remove('chunk-' + key);
    this.textures.addCanvas('chunk-' + key, canvas);
    const img = this.add.image(cx * size, cy * size, 'chunk-' + key).setOrigin(0, 0).setDepth(0);
    const rowImages: Phaser.GameObjects.Image[] = [];
    for (const [ly, c] of rows) {
      const name = 'chunkrow-' + key + '-' + ly;
      if (this.textures.exists(name)) this.textures.remove(name);
      this.textures.addCanvas(name, c);
      const bottom = (cy * CHUNK + ly + 1) * TILE;
      rowImages.push(this.add.image(cx * size, (cy * CHUNK + ly) * TILE, name).setOrigin(0, 0).setDepth(bottom));
    }
    const roofImages: Phaser.GameObjects.Image[] = [];
    for (const r of roofCells) {
      const ty = cy * CHUNK + r.ly;
      const img = this.add
        .image(cx * size + r.lx * TILE, ty * TILE, 'town', tileFrame(r.id))
        .setOrigin(0, 0)
        .setDepth((ty + 2) * TILE - 1);
      roofImages.push(img);
    }
    const fireSprites: Phaser.GameObjects.Sprite[] = [];
    for (const f of fires) {
      const flame = this.add.sprite(f.x, f.y - 3, 'campflame', '0').setDepth(f.y + 5).setOrigin(0.5, 1);
      flame.play({ key: 'campflame-loop', startFrame: (f.x >> 4) % 3 });
      fireSprites.push(flame);
    }
    this.chunkDraw.set(key, { ground: img, rows: rowImages, fires: fireSprites, roofs: roofImages });
    this.drawMinimap();
  }

  private blitTile(g: CanvasRenderingContext2D, id: number, dx: number, dy: number): void {
    const sheet = id >= DUNGEON ? this.tileImg : this.townImg;
    if (!sheet) return;
    const frame = tileFrame(id);
    const sx = (frame % 12) * TILE;
    const sy = Math.floor(frame / 12) * TILE;
    if (WATER_IDS.has(id)) {
      paintWater(g, id, dx, dy);
      return;
    }
    if (id === PIT_BANNER) {
      paintBanner(g, dx, dy);
      return;
    }
    if (id === BRIDGE || id === BRIDGE_N || id === BRIDGE_S) {
      paintBridge(g, id, dx, dy);
      return;
    }
    g.drawImage(sheet, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
  }

  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratch(): HTMLCanvasElement {
    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas');
      this.scratchCanvas.width = TILE;
      this.scratchCanvas.height = TILE;
    }
    return this.scratchCanvas;
  }

  private destroyChunk(key: string): void {
    const prev = this.chunkDraw.get(key);
    if (!prev) return;
    prev.ground.destroy();
    for (const row of prev.rows) {
      const name = row.texture.key;
      row.destroy();
      if (this.textures.exists(name)) this.textures.remove(name);
    }
    for (const fire of prev.fires) fire.destroy();
    for (const roof of prev.roofs) roof.destroy();
    this.chunkDraw.delete(key);
  }

  private removeChunk(cx: number, cy: number): void {
    const key = cx + ',' + cy;
    this.destroyChunk(key);
    this.solids.delete(key);
    if (this.textures.exists('chunk-' + key)) this.textures.remove('chunk-' + key);
    this.drawMinimap();
  }

  private solidAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const cell = this.solids.get(cx + ',' + cy);
    if (!cell) return true;
    const lx = tx - cx * CHUNK;
    const ly = ty - cy * CHUNK;
    const i = ly * CHUNK + lx;
    return tileIsSolid(cell.object[i]) || tileIsSolid(cell.ground[i]);
  }

  private addEnt(a: AddEnt): void {
    const created = !this.ents.has(a.id);
    this.ensureEnt(a.id, a.kind, a.subtype, a.hp, a.flags, a.name);
    const view = this.ents.get(a.id);
    if (!view) return;
    view.samples.push({ t: this.serverTick * TICK_MS, x: a.x, y: a.y });
    if (created && a.kind === KIND.PLAYER) this.playFx(FX.MAGIC, a.x, a.y - 20);
  }

  private ensureEnt(id: number, kind: number, subtype: number, hp: number, flags: number, name: string): void {
    let view = this.ents.get(id);
    if (!view) {
      const frame = kind === KIND.PLAYER ? CLASSES[subtype]?.tile ?? 96 : kind === KIND.MONSTER ? MONSTERS[subtype]?.tile ?? 108 : 0;
      const key = kind === KIND.PROJECTILE ? (subtype === 2 ? 'fireball' : subtype === 1 ? 'orb' : 'arrow0') : 'tiles';
      const sprite = (kind === KIND.PROJECTILE ? this.add.sprite(0, 0, key) : this.add.sprite(0, 0, key, frame)).setDepth(2);
      sprite.setOrigin(0.5, kind === KIND.PROJECTILE ? 0.5 : 0.85);
      if (sprite.texture.key === '__MISSING' || String(sprite.frame?.name) === '__MISSING') this.missing++;
      const shadow = this.add.image(0, 0, 'shadow').setOrigin(0.5, 0.5);
      const hpMax = kind === KIND.PLAYER ? CLASSES[subtype]?.hp ?? 1 : kind === KIND.MONSTER ? MONSTERS[subtype]?.hp ?? 1 : 1;
      view = { id, kind, subtype, hp, hpMax, flags, name, vx: 0, vy: 0, samples: [], sprite, shadow, aggroAt: 0 };
      if (kind === KIND.MONSTER || kind === KIND.PLAYER) view.bar = this.add.graphics().setDepth(DEPTH_LABEL);
      this.ents.set(id, view);
    }
    view.kind = kind;
    view.subtype = subtype;
    view.hp = hp;
    view.flags = flags;
    if (name) view.name = name;
    if (kind === KIND.PLAYER && view.name && !view.label) {
      const color = id === this.selfId ? '#ffd56a' : '#f4efe4';
      const tex = 'name-' + view.name + '-' + subtype;
      if (!this.textures.exists(tex)) this.textures.addCanvas(tex, textCanvas(view.name, color, 1));
      view.label = this.add.image(0, 0, tex).setDepth(DEPTH_LABEL).setOrigin(0.5, 1);
    }
  }

  private removeEnt(id: number): void {
    const view = this.ents.get(id);
    if (!view || id === this.selfId) return;
    view.sprite.destroy();
    view.shadow.destroy();
    view.label?.destroy();
    view.bar?.destroy();
    view.bang?.destroy();
    this.ents.delete(id);
  }

  private playFx(fx: number, x: number, y: number): void {
    const key =
      fx === FX.ARROW ? 'fx-arrow' : fx === FX.MAGIC ? 'fx-magic' : fx === FX.FIRE ? 'fx-fire' : fx === FX.SMOKE ? 'fx-smoke' : fx === FX.STUN ? 'fx-stun' : 'fx-hit';
    const s = this.add.sprite(x / SUB, y / SUB - 4, key).setDepth(DEPTH_FX).setOrigin(0.5, 0.7);
    s.setScale(key === 'fx-hit' ? 0.5 : 0.62);
    s.play(key);
    s.once('animationcomplete', () => s.destroy());
  }

  private float(x: number, y: number, text: string, color: string): void {
    const tex = 'dmg-' + text + color;
    if (!this.textures.exists(tex)) this.textures.addCanvas(tex, textCanvas(text, color, 2));
    const img = this.add.image(x / SUB, y / SUB - 14, tex).setDepth(DEPTH_FLOAT).setOrigin(0.5, 1);
    this.floaters.push({ img, life: 780, born: performance.now() });
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
      view.shadow.setVisible(!dead && view.kind !== KIND.PROJECTILE);
      view.label?.setVisible(!dead && view.kind === KIND.PLAYER);
      const moving = view.id === this.selfId ? bob !== 0 : (view.flags & FLAG.Moving) !== 0;
      const step = Math.floor(now / 140) % 2 === 0;
      let oy = 0;
      if (moving && step) oy = -1;
      else if (!moving && view.kind === KIND.MONSTER && Math.floor(now / 280) % 2 === 0) oy = -1;
      const px = Math.round(x);
      const py = Math.round(y + oy);
      view.sprite.setPosition(px, py);
      if (view.kind !== KIND.PROJECTILE) {
        if (moving) view.sprite.setDisplaySize(step ? 15 : 16, step ? 16 : 15);
        else view.sprite.setDisplaySize(16, 16);
      }
      view.sprite.setDepth(py);
      view.shadow.setPosition(px, Math.round(y) + 2);
      view.shadow.setDepth(py - 1);
      if (view.label) view.label.setPosition(px, py - 12);
      const aggro = view.kind === KIND.MONSTER && (view.flags & FLAG.Aggro) !== 0 && !dead;
      if (aggro && view.aggroAt === 0) view.aggroAt = now;
      if (!aggro) view.aggroAt = 0;
      if (aggro) {
        if (!view.bang) {
          if (!this.textures.exists('bang')) this.textures.addCanvas('bang', textCanvas('!', '#ffe14a', 2));
          view.bang = this.add.image(0, 0, 'bang').setDepth(DEPTH_LABEL).setOrigin(0.5, 1);
        }
        const pop = Math.min(1, (now - view.aggroAt) / 140);
        view.bang.setVisible(true).setPosition(px, py - 18).setScale(0.6 + pop * 0.4);
      } else view.bang?.setVisible(false);
      if (view.bar) {
        view.bar.clear();
        const max = view.hpMax || 1;
        if (!dead && view.hp < max && view.kind !== KIND.PROJECTILE) {
          view.bar.fillStyle(0x1a100e, 0.9);
          view.bar.fillRect(px - 7, py - 16, 14, 3);
          view.bar.fillStyle(0xe25a4a, 1);
          view.bar.fillRect(px - 7, py - 16, Math.max(0, Math.round((14 * view.hp) / max)), 3);
        }
      }
    }
    const labels = [...this.ents.values()].filter((v) => v.label?.visible);
    labels.sort((a, b) => a.sprite.y - b.sprite.y || a.sprite.x - b.sprite.x);
    const stacked: { x: number; y: number; w: number; h: number; px: number; py: number }[] = [];
    for (const view of labels) {
      const lab = view.label!;
      const w = lab.displayWidth || lab.width;
      const h = lab.displayHeight || lab.height;
      let y = Math.round(view.sprite.y - 14);
      const crowded = stacked.some((s) => Math.hypot(s.px - view.sprite.x, s.py - view.sprite.y) < 20);
      if (crowded) y -= h + 1;
      let guard = 0;
      while (
        guard++ < 5 &&
        stacked.some((s) => Math.abs(s.x - lab.x) < (s.w + w) / 2 + 1 && Math.abs(s.y - y) < (s.h + h) / 2)
      ) {
        y -= h + 1;
      }
      lab.setPosition(Math.round(lab.x), y);
      stacked.push({ x: lab.x, y, w, h, px: view.sprite.x, py: view.sprite.y });
    }
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    const viewX = rx / SUB;
    const viewY = ry / SUB;
    cam.setScroll(Math.round(viewX - cam.width / z / 2), Math.round(viewY - cam.height / z / 2));
    // Roofs and walls are solid, so a hero can never stand under one; no fade is
    // needed (a fading roof only flickered whenever someone walked past the eaves).
    this.driftMotes(cam.scrollX, cam.scrollY, cam.width / z, cam.height / z, now);
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= delta;
      const age = now - f.born;
      const pop = age < 90 ? 1.4 - (age / 90) * 0.4 : 1;
      f.img.setScale(pop);
      f.img.y -= delta * (age < 180 ? 0.04 : 0.018);
      f.img.setAlpha(Math.max(0, f.life / 780));
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
      xp: this.xp,
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
    g.fillStyle = '#1d3a28';
    g.fillRect(0, 0, 64, 48);
    for (const [key, cell] of this.solids) {
      const [cx, cy] = key.split(',').map(Number);
      for (let ly = 0; ly < CHUNK; ly += 2) {
        for (let lx = 0; lx < CHUNK; lx += 2) {
          const id = cell.ground[ly * CHUNK + lx];
          const obj = cell.object[ly * CHUNK + lx];
          let color = '#5eae4c';
          if (id >= DUNGEON) color = '#6d625c';
          else if (WATER_IDS.has(id)) color = '#3f86c4';
          else if (id >= BRIDGE && id <= BRIDGE_S) color = '#9a6236';
          else if (PATH_IDS.has(id)) color = '#d2a15c';
          if (obj && tileIsSolid(obj)) color = '#2c6a38';
          g.fillStyle = color;
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
    const tileUnder = local ? local.ground[(ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK)] : -1;
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
      chunks: [...this.chunkDraw.keys()],
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
