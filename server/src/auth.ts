import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!N || !r || !p || salt.length === 0 || expected.length === 0) return false;
  const hash = scryptSync(password, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;
const NAME_RE = /^[a-zA-Z0-9_]{2,16}$/;

export function validUsername(s: string): boolean {
  return USER_RE.test(s);
}
export function validCharacterName(s: string): boolean {
  return NAME_RE.test(s);
}
export function validPassword(s: string): boolean {
  return s.length >= 6 && s.length <= 64;
}

const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(ip: string): boolean {
  const now = Date.now();
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const cap = loopback ? 400 : 8;
  const row = hits.get(ip);
  if (!row || now > row.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  row.n++;
  return row.n <= cap;
}

export function clientIp(headers: NodeJS.Dict<string | string[] | undefined>, fallback: string): string {
  const fly = headers['fly-client-ip'];
  if (typeof fly === 'string' && fly) return fly;
  return fallback;
}
