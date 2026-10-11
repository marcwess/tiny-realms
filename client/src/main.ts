import Phaser from 'phaser';
import { CLASSES } from '../../shared/src/constants.ts';
import { dirFromVector } from '../../shared/src/sim.ts';
import { encodeHello, encodeLogout } from '../../shared/src/protocol.ts';
import { GameScene, bridge, type HudState } from './game.ts';
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

function spriteStyle(tile: number): string {
  const col = tile % 12;
  const row = Math.floor(tile / 12);
  const s = 5;
  const base = import.meta.env.BASE_URL;
  return [
    `url("${base}assets/tilemap_packed.png")`,
    `${192 * s}px ${176 * s}px`,
    `${-col * 16 * s}px ${-row * 16 * s}px`,
  ].join(' ');
}

function buildCards(): void {
  cards.innerHTML = '';
  for (const c of CLASSES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'class-card' + (c.id === selectedClass ? ' selected' : '');
    b.innerHTML = `<div class="sprite"></div><div><strong>${c.name}</strong><p class="role">${c.role}</p></div>`;
    const sp = b.querySelector('.sprite') as HTMLElement;
    const bg = spriteStyle(c.tile).split(' ');
    sp.style.backgroundImage = bg[0];
    sp.style.backgroundSize = bg[1] + ' ' + bg[2];
    sp.style.backgroundPosition = bg[3] + ' ' + bg[4];
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
    b.innerHTML = `<div class="sprite"></div><div><strong>${c.name}</strong><p class="role">${cls?.name ?? 'Hero'} · Lv ${c.level}</p></div>`;
    const sp = b.querySelector('.sprite') as HTMLElement;
    const parts = spriteStyle(cls?.tile ?? 96).split(' ');
    sp.style.backgroundImage = parts[0];
    sp.style.backgroundSize = parts[1] + ' ' + parts[2];
    sp.style.backgroundPosition = parts[3] + ' ' + parts[4];
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
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  show('world');
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

bridge.onHud = (s: HudState) => {
  const id = document.getElementById('identity')!;
  id.textContent = `${s.name || 'Hero'} · ${s.className} · Lv ${s.level}`;
  const fill = document.getElementById('hp-fill') as HTMLElement;
  fill.style.width = Math.max(0, Math.min(100, (s.hp / Math.max(1, s.hpMax)) * 100)) + '%';
  document.getElementById('hp-text')!.textContent = `${s.hp} / ${s.hpMax}`;
  document.getElementById('online')!.textContent = `Online ${s.online}`;
  const tag = document.getElementById('zone-tag')!;
  tag.textContent = s.zone === 'pvp' ? 'PvP' : s.zone === 'safe' ? 'Town' : 'Wilds';
  tag.className = s.zone;
  const ring = document.getElementById('skill-ring') as SVGCircleElement | null;
  if (ring) {
    const left = s.skillMax > 0 ? s.skillCd / s.skillMax : 0;
    ring.style.strokeDashoffset = String((1 - left) * 100);
  }
  const atk = document.getElementById('btn-attack') as HTMLButtonElement;
  atk.style.opacity = s.attackCd > 0 ? '0.55' : '1';
  const banner = document.getElementById('banner')!;
  banner.hidden = !s.banner;
  banner.textContent = s.banner;
  const dead = document.getElementById('dead')!;
  dead.hidden = !s.dead;
  document.getElementById('dead-t')!.textContent = (s.deadIn / 1000).toFixed(1);
};

async function boot(): Promise<void> {
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
