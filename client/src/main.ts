import Phaser from 'phaser';
import { CLASSES } from '../../shared/src/constants.ts';
import { dirFromVector } from '../../shared/src/sim.ts';
import { encodeHello, encodeLogout } from '../../shared/src/protocol.ts';
import { GameScene, bridge, type HudState } from './game.ts';
import { textCanvas } from './font.ts';
import { input } from './input.ts';

const TOKEN_KEY = 'tiny-realms-token';

interface Character {
  id: number;
  name: string;
  classId: number;
  level: number;
  xp: number;
  hp: number;
}

const authEl = document.getElementById('screen-auth')!;
const charEl = document.getElementById('screen-char')!;
const hudEl = document.getElementById('hud')!;
const authErr = document.getElementById('auth-error')!;
const charErr = document.getElementById('char-error')!;
const charList = document.getElementById('char-list')!;
const cards = document.getElementById('class-cards')!;

let token = localStorage.getItem(TOKEN_KEY) || '';
let api = 'http://localhost:8787';
let wsUrl = 'ws://localhost:8787';
let socket: WebSocket | null = null;
let intentional = false;
let playingId = 0;
let selectedClass = 0;
let reconnectTimer = 0;

function httpBase(url: string): string {
  if (url.startsWith('wss://')) return 'https://' + url.slice(6);
  if (url.startsWith('ws://')) return 'http://' + url.slice(5);
  return url;
}

function show(which: 'auth' | 'char' | 'world'): void {
  authEl.hidden = which !== 'auth';
  charEl.hidden = which !== 'char';
  hudEl.hidden = which !== 'world';
  const game = document.getElementById('game');
  if (game) {
    if (which === 'world') {
      game.classList.remove('in');
      requestAnimationFrame(() => requestAnimationFrame(() => game.classList.add('in')));
    } else {
      game.classList.remove('in');
    }
  }
  if (which !== 'world') {
    // The in-world menu is a sibling of the HUD, so close it explicitly or it
    // stays over the login form after "Log out" and swallows every tap.
    const menu = document.getElementById('menu-pop');
    if (menu) menu.hidden = true;
    document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'false');
  }
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.hidden = which === 'world';
  const tiny = (window as unknown as { __TINY__?: { screen?: string } }).__TINY__;
  if (tiny) tiny.screen = which;
  else (window as unknown as { __TINY__: { screen: string } }).__TINY__ = { screen: which };
}

function setErr(el: HTMLElement, msg: string): void {
  el.hidden = !msg;
  el.textContent = msg;
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (token) headers.set('authorization', 'Bearer ' + token);
  if (opts.body) headers.set('content-type', 'application/json');
  return fetch(api + path, { ...opts, headers });
}

function applySheet(el: HTMLElement, tile: number, scale: number): void {
  const col = tile % 12;
  const row = Math.floor(tile / 12);
  const base = import.meta.env.BASE_URL;
  el.style.backgroundImage = `url("${base}assets/tilemap_packed.png")`;
  el.style.backgroundSize = `${192 * scale}px ${176 * scale}px`;
  el.style.backgroundPosition = `${-col * 16 * scale}px ${-row * 16 * scale}px`;
  el.style.backgroundRepeat = 'no-repeat';
}

function applyWeapon(el: HTMLElement, classId: number): void {
  if (classId === 1) {
    el.style.backgroundImage = `url("${import.meta.env.BASE_URL}assets/bow.png")`;
    el.style.backgroundSize = '64px 64px';
    el.style.backgroundPosition = '0 0';
    el.style.backgroundRepeat = 'no-repeat';
    return;
  }
  applySheet(el, classId === 2 ? 130 : 104, 4);
}

function buildCards(): void {
  cards.innerHTML = '';
  for (const c of CLASSES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'class-card' + (c.id === selectedClass ? ' selected' : '');
    const hp = Math.round((c.hp / 140) * 100);
    const dmg = Math.round((c.dmg / 18) * 100);
    const range = Math.min(100, Math.round(c.range / 22));
    b.innerHTML = `<div class="sprite"><span class="held"></span></div><div><strong>${c.name}</strong><p class="role">${c.role}</p><div class="bars"><div class="bar hp"><span style="width:${hp}%"></span><em>HP</em></div><div class="bar dmg"><span style="width:${dmg}%"></span><em>DMG</em></div><div class="bar range"><span style="width:${range}%"></span><em>RANGE</em></div></div></div>`;
    const sp = b.querySelector('.sprite') as HTMLElement;
    applySheet(sp, c.tile, 5);
    applyWeapon(b.querySelector('.held') as HTMLElement, c.id);
    b.onclick = () => {
      selectedClass = c.id;
      buildCards();
    };
    cards.appendChild(b);
  }
}

function renderCharacters(list: Character[]): void {
  charList.innerHTML = '';
  if (list.length === 0) {
    charList.innerHTML = '<p class="lede">No hero yet. Create one below.</p>';
    return;
  }
  for (const c of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hero-card';
    const cls = CLASSES[c.classId];
    b.innerHTML = `<div class="sprite"><span class="held"></span></div><div><strong>${c.name}</strong><p class="role">${cls?.name ?? 'Adventurer'} · Lv ${c.level}</p></div>`;
    const sp = b.querySelector('.sprite') as HTMLElement;
    applySheet(sp, cls?.tile ?? 96, 5);
    applyWeapon(b.querySelector('.held') as HTMLElement, c.classId);
    b.onclick = () => enterWorld(c.id);
    charList.appendChild(b);
  }
}

async function refreshCharacters(): Promise<void> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    show('auth');
    return;
  }
  const data = (await res.json()) as { characters: Character[] };
  renderCharacters(data.characters);
  show('char');
}

async function auth(path: '/auth/register' | '/auth/login'): Promise<void> {
  setErr(authErr, '');
  const username = (document.getElementById('auth-user') as HTMLInputElement).value.trim();
  const password = (document.getElementById('auth-pass') as HTMLInputElement).value;
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify({ username, password }) });
  const data = (await res.json()) as { error?: string; token?: string; characters?: Character[] };
  if (!res.ok || !data.token) {
    setErr(authErr, data.error || 'Could not sign in.');
    return;
  }
  token = data.token;
  localStorage.setItem(TOKEN_KEY, token);
  renderCharacters(data.characters || []);
  show('char');
}

function enterWorld(characterId: number): void {
  intentional = false;
  playingId = characterId;
  const name = document.getElementById('hud-name') as HTMLCanvasElement | null;
  name?.getContext('2d')?.clearRect(0, 0, name.width, name.height);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  show('world');
  // Without this the old session keeps ticking and sends its high input seqs
  // on the new socket before WELCOME, and the server then drops every input.
  bridge.newSession();
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  socket = ws;
  bridge.send = (buf) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf);
  };
  ws.onopen = () => ws.send(encodeHello(token, characterId));
  ws.onmessage = (ev) => bridge.deliver(new Uint8Array(ev.data as ArrayBuffer));
  ws.onclose = (ev) => {
    if (intentional) return;
    if (ev.code === 4001) {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      setErr(authErr, 'Session expired. Log in again.');
      show('auth');
      return;
    }
    if (ev.code === 4003) {
      setErr(charErr, 'That hero signed in somewhere else.');
      show('char');
      return;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      if (!intentional && playingId) enterWorld(playingId);
    }, 700);
  };
}

async function logout(): Promise<void> {
  intentional = true;
  window.clearTimeout(reconnectTimer);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(encodeLogout());
    socket.close(1000, 'logout');
  }
  socket = null;
  playingId = 0;
  if (token) await apiFetch('/auth/logout', { method: 'POST' });
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  show('auth');
}

function bindJoystick(): void {
  const zone = document.getElementById('joy-zone')!;
  const base = document.getElementById('joy-base')!;
  const knob = document.getElementById('joy-knob')!;
  let pointer = -1;
  let ax = 0;
  let ay = 0;
  const place = (x: number, y: number) => {
    const dx = x - ax;
    const dy = y - ay;
    const max = 48;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(max, len);
    knob.style.left = ax + (dx / len) * cl + 'px';
    knob.style.top = ay + (dy / len) * cl + 'px';
    input.joyDir = dirFromVector(dx, dy, 12);
  };
  const start = (id: number, x: number, y: number) => {
    pointer = id;
    ax = x;
    ay = y;
    base.hidden = false;
    knob.hidden = false;
    base.style.left = x + 'px';
    base.style.top = y + 'px';
    place(x, y);
  };
  const end = () => {
    pointer = -1;
    input.joyDir = 0;
    base.hidden = true;
    knob.hidden = true;
  };
  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    start(t.identifier, t.clientX, t.clientY);
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === pointer) place(t.clientX, t.clientY);
  }, { passive: false });
  zone.addEventListener('touchend', (e) => {
    e.preventDefault();
    end();
  }, { passive: false });
  zone.addEventListener('touchcancel', () => end());
  zone.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    start(-2, e.clientX, e.clientY);
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => {
    if (pointer !== -2) return;
    place(e.clientX, e.clientY);
  });
  zone.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    end();
  });
}

function bindHold(el: HTMLElement, down: () => void, up: () => void): void {
  el.addEventListener('touchstart', (e) => {
    e.preventDefault();
    down();
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    e.preventDefault();
    up();
  }, { passive: false });
  el.addEventListener('touchcancel', () => up());
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    down();
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    up();
  });
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') up();
  });
}

const sheetImg = new Image();
const bowImg = new Image();
sheetImg.src = import.meta.env.BASE_URL + 'assets/tilemap_packed.png';
bowImg.src = import.meta.env.BASE_URL + 'assets/bow.png';

function paintPortrait(tile: number, classId: number): void {
  const portrait = document.getElementById('portrait') as HTMLElement | null;
  if (!portrait) return;
  const key = tile + ':' + classId;
  if (portrait.dataset.tile === key) return;
  if (!sheetImg.complete || !bowImg.complete || sheetImg.naturalWidth === 0 || bowImg.naturalWidth === 0) return;
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 40;
  const g = c.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = false;
  // Full 16px cell, with room above the head so the weapon tip is not cropped.
  g.drawImage(sheetImg, (tile % 12) * 16, Math.floor(tile / 12) * 16, 16, 16, 2, 8, 32, 32);
  if (classId === 1) g.drawImage(bowImg, 0, 0, 16, 16, 16, 2, 24, 24);
  else {
    const frame = classId === 2 ? 130 : 104;
    g.drawImage(sheetImg, (frame % 12) * 16, Math.floor(frame / 12) * 16, 16, 16, 14, 0, 26, 26);
  }
  portrait.style.backgroundImage = `url("${c.toDataURL()}")`;
  portrait.style.backgroundSize = '40px 40px';
  portrait.style.backgroundPosition = 'center';
  portrait.dataset.tile = key;
}

function paintText(id: string, text: string, color: string, scale = 2): void {
  const el = document.getElementById(id) as HTMLCanvasElement | null;
  if (!el) return;
  const src = textCanvas(text, color, scale);
  if (el.width !== src.width || el.height !== src.height) {
    el.width = src.width;
    el.height = src.height;
  }
  const g = el.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, el.width, el.height);
  g.drawImage(src, 0, 0);
}

bridge.onHud = (s: HudState) => {
  if (s.name) paintText('hud-name', `${s.name} Lv ${s.level}`, '#ffd56a', 2);
  const fill = document.getElementById('hp-fill') as HTMLElement;
  fill.style.width = Math.max(0, Math.min(100, (s.hp / Math.max(1, s.hpMax)) * 100)) + '%';
  const xp = document.getElementById('xp-fill') as HTMLElement;
  xp.style.width = Math.max(4, Math.min(100, s.xp % 100)) + '%';
  paintText('hud-hp', `${s.hp}/${s.hpMax}`, '#fff6e8', 1);
  paintText('hud-online', `Online ${s.online}`, '#f4efe4', 1);
  const zoneColor = s.zone === 'pvp' ? '#ffb0a4' : s.zone === 'safe' ? '#d8f0c4' : '#ffe0a8';
  paintText('hud-zone', s.zoneName || 'Wilds', zoneColor, 1);
  const cls = CLASSES.find((c) => c.name === s.className);
  if (cls) paintPortrait(cls.tile, cls.id);
  const icon = document.getElementById('attack-icon') as HTMLImageElement | null;
  if (icon) {
    const file = s.className === 'Archer' ? 'icon_arrow.png' : s.className === 'Mage' ? 'icon_fire.png' : 'icon_sword.png';
    if (!icon.src.endsWith(file)) icon.src = import.meta.env.BASE_URL + 'assets/ui/' + file;
  }
  const ring = document.getElementById('skill-ring') as SVGCircleElement | null;
  if (ring) {
    const left = s.skillMax > 0 ? s.skillCd / s.skillMax : 0;
    ring.style.strokeDashoffset = String((1 - left) * 100);
  }
  const atk = document.getElementById('btn-attack') as HTMLButtonElement;
  atk.style.opacity = s.attackCd > 0 ? '0.55' : '1';
  const banner = document.getElementById('banner')!;
  banner.hidden = !s.banner;
  if (s.banner) paintText('banner-text', s.banner, '#ffd0c8', 3);
  const dead = document.getElementById('dead')!;
  dead.hidden = !s.dead;
  if (s.dead) paintText('dead-text', `You fell. Town in ${Math.max(0, s.deadIn / 1000).toFixed(1)}`, '#f3e6d0', 2);
};

async function boot(): Promise<void> {
  await Promise.all([
    document.fonts.load('8px "Kenney Mini"'),
    document.fonts.load('64px "Kenney Square"'),
  ]).catch(() => undefined);
  const params = new URLSearchParams(location.search);
  const override = params.get('server');
  if (!override) {
    try {
      const cfg = (await (await fetch(import.meta.env.BASE_URL + 'config.json')).json()) as { serverUrl: string };
      wsUrl = cfg.serverUrl;
    } catch {
      wsUrl = 'ws://localhost:8787';
    }
  } else wsUrl = override;
  api = httpBase(wsUrl);
  buildCards();
  document.getElementById('btn-login')!.onclick = () => void auth('/auth/login');
  document.getElementById('btn-register')!.onclick = () => void auth('/auth/register');
  document.getElementById('btn-create')!.onclick = async () => {
    setErr(charErr, '');
    const name = (document.getElementById('char-name') as HTMLInputElement).value.trim();
    const res = await apiFetch('/characters', { method: 'POST', body: JSON.stringify({ name, classId: selectedClass }) });
    const data = (await res.json()) as { error?: string; character?: Character };
    if (!res.ok || !data.character) {
      setErr(charErr, data.error || 'Could not create that hero.');
      return;
    }
    enterWorld(data.character.id);
  };
  document.getElementById('btn-account-out')!.onclick = () => void logout();
  document.getElementById('btn-logout')!.onclick = () => void logout();
  const menuBtn = document.getElementById('btn-menu')!;
  const menuPop = document.getElementById('menu-pop')!;
  const closeMenu = () => {
    menuPop.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  menuBtn.onclick = () => {
    const open = menuPop.hidden;
    menuPop.hidden = !open;
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  menuPop.addEventListener('click', (e) => {
    if (e.target === menuPop) closeMenu();
  });
  document.getElementById('menu-close')!.onclick = () => closeMenu();
  const modal = document.getElementById('modal')!;
  const modalBody = document.getElementById('modal-body')!;
  const openModal = (text: string) => {
    modalBody.textContent = text;
    modal.hidden = false;
    closeMenu();
  };
  document.getElementById('link-credits')!.onclick = () =>
    openModal('Kenney Tiny Town, Tiny Dungeon, Pixel Adventure UI, Mobile Controls, and Kenney fonts (CC0). Pixel effects: Super Pixel Effects Gigapack - Will Tice / unTied Games.');
  document.getElementById('btn-credits')!.onclick = () =>
    openModal('Kenney Tiny Town, Tiny Dungeon, Pixel Adventure UI, Mobile Controls, and Kenney fonts (CC0). Pixel effects: Super Pixel Effects Gigapack - Will Tice / unTied Games.');
  document.getElementById('btn-settings')!.onclick = () =>
    openModal('Move with the stick or WASD. Attack and skill are the two buttons on the right. Space attacks, F uses the skill.');
  document.getElementById('modal-close')!.onclick = () => {
    modal.hidden = true;
  };
  bindJoystick();
  bindHold(
    document.getElementById('btn-attack')!,
    () => {
      input.attack = true;
      input.pointerAttack = true;
    },
    () => {
      input.attack = false;
      input.pointerAttack = false;
    },
  );
  bindHold(
    document.getElementById('btn-skill')!,
    () => {
      input.skillEdge = true;
    },
    () => {},
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !intentional && playingId && (!socket || socket.readyState !== WebSocket.OPEN)) {
      enterWorld(playingId);
    }
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#141014',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    antialiasGL: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoRound: true,
      zoom: 1,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    render: { pixelArt: true, antialias: false, roundPixels: true, powerPreference: 'high-performance' },
    fps: { target: 120, forceSetTimeOut: false },
    audio: { noAudio: true },
    banner: false,
    scene: [GameScene],
  });
  game.canvas.style.imageRendering = 'pixelated';
  // Phaser's RESIZE mode can read the parent size before the browser has
  // applied a rotation, leaving the canvas at the old aspect and stretched by
  // CSS. Re-fit to the real viewport on the next frame and once more after
  // iOS settles its bars.
  const fit = () => {
    const w = Math.round(window.innerWidth);
    const h = Math.round(window.innerHeight);
    if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
  };
  const refit = () => {
    requestAnimationFrame(fit);
    window.setTimeout(fit, 350);
  };
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  window.visualViewport?.addEventListener('resize', refit);
  if (import.meta.env.DEV && params.get('bots')) {
    const n = Number(params.get('bots'));
    void fetch(api + '/dev/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n }) });
  }
  if (token) {
    const res = await apiFetch('/auth/me');
    if (res.ok) {
      const data = (await res.json()) as { characters: Character[] };
      renderCharacters(data.characters);
      show('char');
      return;
    }
    token = '';
    localStorage.removeItem(TOKEN_KEY);
  }
  show('auth');
}

void boot();
