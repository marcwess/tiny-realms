import { CHUNK, MSG } from './constants.ts';
import type { DungeonEntrance, RegionDef } from './zones.ts';

export interface HelloMsg {
  token: string;
  characterId: number;
}
export interface WelcomeMsg {
  entityId: number;
  tick: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  classId: number;
  level: number;
  xp: number;
}
export interface InputMsg {
  seq: number;
  dir: number;
  buttons: number;
}
export interface AddEnt {
  id: number;
  kind: number;
  subtype: number;
  flags: number;
  x: number;
  y: number;
  hp: number;
  name: string;
}
export interface SnapEnt {
  id: number;
  kind: number;
  subtype: number;
  flags: number;
  x: number;
  y: number;
  hp: number;
  vx: number;
  vy: number;
}
export interface SnapMsg {
  tick: number;
  ack: number;
  attackCd: number;
  skillCd: number;
  zone: number;
  online: number;
  ents: SnapEnt[];
}
export interface EvMsg {
  ev: number;
  a: number;
  b: number;
  x: number;
  y: number;
  n: number;
  fx: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function u8(s: string): Uint8Array {
  return enc.encode(s);
}

export function encodeHello(token: string, characterId: number): Uint8Array {
  const t = u8(token).subarray(0, 80);
  const b = new Uint8Array(1 + 1 + t.length + 4);
  b[0] = MSG.HELLO;
  b[1] = t.length;
  b.set(t, 2);
  const v = new DataView(b.buffer);
  v.setUint32(2 + t.length, characterId >>> 0, true);
  return b;
}

export function decodeHello(buf: Uint8Array): HelloMsg | null {
  if (buf.length < 6 || buf[0] !== MSG.HELLO) return null;
  const n = buf[1];
  if (buf.length < 2 + n + 4) return null;
  const token = dec.decode(buf.subarray(2, 2 + n));
  const characterId = new DataView(buf.buffer, buf.byteOffset + 2 + n, 4).getUint32(0, true);
  return { token, characterId };
}

export function encodeWelcome(m: WelcomeMsg): Uint8Array {
  const b = new Uint8Array(1 + 2 + 4 + 2 + 2 + 2 + 2 + 1 + 1 + 4);
  const v = new DataView(b.buffer);
  let o = 0;
  v.setUint8(o, MSG.WELCOME);
  o += 1;
  v.setUint16(o, m.entityId, true);
  o += 2;
  v.setUint32(o, m.tick >>> 0, true);
  o += 4;
  v.setInt16(o, m.x, true);
  o += 2;
  v.setInt16(o, m.y, true);
  o += 2;
  v.setUint16(o, m.hp, true);
  o += 2;
  v.setUint16(o, m.hpMax, true);
  o += 2;
  v.setUint8(o, m.classId);
  o += 1;
  v.setUint8(o, m.level);
  o += 1;
  v.setUint32(o, m.xp >>> 0, true);
  return b;
}

export function decodeWelcome(buf: Uint8Array): WelcomeMsg | null {
  if (buf.length < 21 || buf[0] !== MSG.WELCOME) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    entityId: v.getUint16(1, true),
    tick: v.getUint32(3, true),
    x: v.getInt16(7, true),
    y: v.getInt16(9, true),
    hp: v.getUint16(11, true),
    hpMax: v.getUint16(13, true),
    classId: v.getUint8(15),
    level: v.getUint8(16),
    xp: v.getUint32(17, true),
  };
}

export function encodeInput(m: InputMsg): Uint8Array {
  const b = new Uint8Array(7);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.INPUT);
  v.setUint32(1, m.seq >>> 0, true);
  v.setUint8(5, m.dir & 15);
  v.setUint8(6, m.buttons & 15);
  return b;
}

export function decodeInput(buf: Uint8Array): InputMsg | null {
  if (buf.length < 7 || buf[0] !== MSG.INPUT) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { seq: v.getUint32(1, true), dir: v.getUint8(5), buttons: v.getUint8(6) };
}

export function encodeRegions(regions: readonly RegionDef[], entrances: readonly DungeonEntrance[]): Uint8Array {
  let size = 2;
  for (const r of regions) {
    const name = u8(r.name);
    size += 1 + 8 + 1 + name.length;
  }
  size += 1;
  for (const e of entrances) {
    size += 4 + 1 + u8(e.name).length + 1 + u8(e.dungeonId).length;
  }
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  let o = 0;
  v.setUint8(o++, MSG.REGIONS);
  v.setUint8(o++, regions.length);
  for (const r of regions) {
    const zone = r.zone === 'safe' ? 0 : r.zone === 'pvp' ? 2 : 1;
    const rect = r.rects[0];
    v.setUint8(o++, zone);
    v.setUint16(o, rect.x, true);
    o += 2;
    v.setUint16(o, rect.y, true);
    o += 2;
    v.setUint16(o, rect.w, true);
    o += 2;
    v.setUint16(o, rect.h, true);
    o += 2;
    const name = u8(r.name);
    v.setUint8(o++, name.length);
    b.set(name, o);
    o += name.length;
  }
  v.setUint8(o++, entrances.length);
  for (const e of entrances) {
    v.setUint16(o, e.tileX, true);
    o += 2;
    v.setUint16(o, e.tileY, true);
    o += 2;
    const name = u8(e.name);
    const id = u8(e.dungeonId);
    v.setUint8(o++, name.length);
    b.set(name, o);
    o += name.length;
    v.setUint8(o++, id.length);
    b.set(id, o);
    o += id.length;
  }
  return b;
}

export interface RegionsMsg {
  regions: { zone: 'safe' | 'pve' | 'pvp'; x: number; y: number; w: number; h: number; name: string }[];
  entrances: { x: number; y: number; name: string; dungeonId: string }[];
}

export function decodeRegions(buf: Uint8Array): RegionsMsg | null {
  if (buf.length < 3 || buf[0] !== MSG.REGIONS) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 1;
  const rc = v.getUint8(o++);
  const regions: RegionsMsg['regions'] = [];
  for (let i = 0; i < rc; i++) {
    if (o + 10 > buf.length) return null;
    const z = v.getUint8(o++);
    const x = v.getUint16(o, true);
    o += 2;
    const y = v.getUint16(o, true);
    o += 2;
    const w = v.getUint16(o, true);
    o += 2;
    const h = v.getUint16(o, true);
    o += 2;
    const nl = v.getUint8(o++);
    if (o + nl > buf.length) return null;
    const name = dec.decode(buf.subarray(o, o + nl));
    o += nl;
    regions.push({ zone: z === 0 ? 'safe' : z === 2 ? 'pvp' : 'pve', x, y, w, h, name });
  }
  if (o >= buf.length) return null;
  const ec = v.getUint8(o++);
  const entrances: RegionsMsg['entrances'] = [];
  for (let i = 0; i < ec; i++) {
    if (o + 5 > buf.length) return null;
    const x = v.getUint16(o, true);
    o += 2;
    const y = v.getUint16(o, true);
    o += 2;
    const nl = v.getUint8(o++);
    if (o + nl + 1 > buf.length) return null;
    const name = dec.decode(buf.subarray(o, o + nl));
    o += nl;
    const il = v.getUint8(o++);
    if (o + il > buf.length) return null;
    const dungeonId = dec.decode(buf.subarray(o, o + il));
    o += il;
    entrances.push({ x, y, name, dungeonId });
  }
  return { regions, entrances };
}

const CHUNK_CELLS = CHUNK * CHUNK;

export function encodeChunk(cx: number, cy: number, ground: Uint8Array, object: Uint8Array): Uint8Array {
  const b = new Uint8Array(3 + CHUNK_CELLS * 2);
  b[0] = MSG.CHUNK;
  b[1] = cx;
  b[2] = cy;
  b.set(ground.subarray(0, CHUNK_CELLS), 3);
  b.set(object.subarray(0, CHUNK_CELLS), 3 + CHUNK_CELLS);
  return b;
}

export function decodeChunk(buf: Uint8Array): { cx: number; cy: number; ground: Uint8Array; object: Uint8Array } | null {
  if (buf.length < 3 + CHUNK_CELLS * 2 || buf[0] !== MSG.CHUNK) return null;
  return {
    cx: buf[1],
    cy: buf[2],
    ground: buf.slice(3, 3 + CHUNK_CELLS),
    object: buf.slice(3 + CHUNK_CELLS, 3 + CHUNK_CELLS * 2),
  };
}

export function encodeUnchunk(cx: number, cy: number): Uint8Array {
  return new Uint8Array([MSG.UNCHUNK, cx, cy]);
}

export function encodeAdd(ents: AddEnt[]): Uint8Array {
  let size = 2;
  const names = ents.map((e) => u8(e.name).subarray(0, 16));
  for (const n of names) size += 11 + n.length;
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.ADD);
  v.setUint8(1, ents.length);
  let o = 2;
  ents.forEach((e, i) => {
    v.setUint16(o, e.id, true);
    o += 2;
    v.setUint8(o++, e.kind);
    v.setUint8(o++, e.subtype);
    v.setUint8(o++, e.flags);
    v.setInt16(o, e.x, true);
    o += 2;
    v.setInt16(o, e.y, true);
    o += 2;
    v.setUint8(o++, Math.max(0, Math.min(255, e.hp)));
    v.setUint8(o++, names[i].length);
    b.set(names[i], o);
    o += names[i].length;
  });
  return b;
}

export function decodeAdd(buf: Uint8Array): AddEnt[] | null {
  if (buf.length < 2 || buf[0] !== MSG.ADD) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = v.getUint8(1);
  const ents: AddEnt[] = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    if (o + 11 > buf.length) return null;
    const id = v.getUint16(o, true);
    o += 2;
    const kind = v.getUint8(o++);
    const subtype = v.getUint8(o++);
    const flags = v.getUint8(o++);
    const x = v.getInt16(o, true);
    o += 2;
    const y = v.getInt16(o, true);
    o += 2;
    const hp = v.getUint8(o++);
    const nl = v.getUint8(o++);
    if (o + nl > buf.length) return null;
    const name = dec.decode(buf.subarray(o, o + nl));
    o += nl;
    ents.push({ id, kind, subtype, flags, x, y, hp, name });
  }
  return ents;
}

export function encodeRemove(ids: number[]): Uint8Array {
  const n = Math.min(255, ids.length);
  const b = new Uint8Array(2 + n * 2);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.REMOVE);
  v.setUint8(1, n);
  for (let i = 0; i < n; i++) v.setUint16(2 + i * 2, ids[i], true);
  return b;
}

export function decodeRemove(buf: Uint8Array): number[] | null {
  if (buf.length < 2 || buf[0] !== MSG.REMOVE) return null;
  const n = buf[1];
  if (buf.length < 2 + n * 2) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(v.getUint16(2 + i * 2, true));
  return ids;
}

/** Header is 15 bytes: msg, tick, ack, cds, zone, online, count. Each ent is 12. */
export function encodeSnap(m: SnapMsg): Uint8Array {
  const n = Math.min(255, m.ents.length);
  const b = new Uint8Array(15 + n * 12);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.SNAP);
  v.setUint32(1, m.tick >>> 0, true);
  v.setUint32(5, m.ack >>> 0, true);
  v.setUint8(9, Math.min(255, m.attackCd));
  v.setUint8(10, Math.min(255, m.skillCd));
  v.setUint8(11, m.zone);
  v.setUint16(12, Math.min(65535, m.online), true);
  v.setUint8(14, n);
  let o = 15;
  for (let i = 0; i < n; i++) {
    const e = m.ents[i];
    v.setUint16(o, e.id, true);
    v.setUint8(o + 2, e.kind);
    v.setUint8(o + 3, e.subtype);
    v.setUint8(o + 4, e.flags);
    v.setInt16(o + 5, e.x, true);
    v.setInt16(o + 7, e.y, true);
    v.setUint8(o + 9, Math.max(0, Math.min(255, e.hp)));
    v.setInt8(o + 10, Math.max(-127, Math.min(127, e.vx | 0)));
    v.setInt8(o + 11, Math.max(-127, Math.min(127, e.vy | 0)));
    o += 12;
  }
  return b;
}

export function decodeSnap(buf: Uint8Array): SnapMsg | null {
  if (buf.length < 15 || buf[0] !== MSG.SNAP) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tick = v.getUint32(1, true);
  const ack = v.getUint32(5, true);
  const attackCd = v.getUint8(9);
  const skillCd = v.getUint8(10);
  const zone = v.getUint8(11);
  const online = v.getUint16(12, true);
  const n = v.getUint8(14);
  if (buf.length < 15 + n * 12) return null;
  const ents: SnapEnt[] = [];
  let o = 15;
  for (let i = 0; i < n; i++) {
    ents.push({
      id: v.getUint16(o, true),
      kind: v.getUint8(o + 2),
      subtype: v.getUint8(o + 3),
      flags: v.getUint8(o + 4),
      x: v.getInt16(o + 5, true),
      y: v.getInt16(o + 7, true),
      hp: v.getUint8(o + 9),
      vx: v.getInt8(o + 10),
      vy: v.getInt8(o + 11),
    });
    o += 12;
  }
  return { tick, ack, attackCd, skillCd, zone, online, ents };
}

export function encodeEvents(evs: EvMsg[]): Uint8Array {
  const n = Math.min(255, evs.length);
  const b = new Uint8Array(2 + n * 11);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.EVENT);
  v.setUint8(1, n);
  let o = 2;
  for (let i = 0; i < n; i++) {
    const e = evs[i];
    v.setUint8(o, e.ev);
    v.setUint16(o + 1, e.a, true);
    v.setUint16(o + 3, e.b, true);
    v.setInt16(o + 5, e.x, true);
    v.setInt16(o + 7, e.y, true);
    v.setUint8(o + 9, Math.min(255, e.n));
    v.setUint8(o + 10, e.fx);
    o += 11;
  }
  return b;
}

export function decodeEvents(buf: Uint8Array): EvMsg[] | null {
  if (buf.length < 2 || buf[0] !== MSG.EVENT) return null;
  const n = buf[1];
  if (buf.length < 2 + n * 11) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const evs: EvMsg[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    evs.push({
      ev: v.getUint8(o),
      a: v.getUint16(o + 1, true),
      b: v.getUint16(o + 3, true),
      x: v.getInt16(o + 5, true),
      y: v.getInt16(o + 7, true),
      n: v.getUint8(o + 9),
      fx: v.getUint8(o + 10),
    });
    o += 11;
  }
  return evs;
}

export function encodeLogout(): Uint8Array {
  return new Uint8Array([MSG.LOGOUT]);
}
