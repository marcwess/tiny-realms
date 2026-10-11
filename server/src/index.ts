import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CLASSES, MAX_PLAYERS, MSG } from '../../shared/src/constants.ts';
import { SPAWN_SUB } from '../../shared/src/zones.ts';
import { decodeHello, decodeInput } from '../../shared/src/protocol.ts';
import { clientIp, hashPassword, hashToken, newToken, rateLimit, validCharacterName, validPassword, validUsername, verifyPassword } from './auth.ts';
import { RegionSim, type Conn } from './region.ts';
import { SqliteAccountRepository, type AccountRepository, type CharacterRow } from './repo.ts';

const PORT = Number(process.env.PORT || 8787);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : path.join(ROOT, 'data'));
const DEV = process.env.NODE_ENV !== 'production';

const repo: AccountRepository = new SqliteAccountRepository(path.join(DATA_DIR, 'tiny-realms.sqlite'));
const region = new RegionSim();

const tickSamples: number[] = [];
const chunkSamples: number[] = [];
const interestSamples: number[] = [];
const deltaSamples: number[] = [];
let bytesWindow: { t: number; n: number }[] = [];
let botProc: ChildProcess | null = null;

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[i] * 1000) / 1000;
}

function avg(samples: number[]): number {
  if (samples.length === 0) return 0;
  let n = 0;
  for (const v of samples) n += v;
  return Math.round((n / samples.length) * 100) / 100;
}

function health() {
  const now = Date.now();
  bytesWindow = bytesWindow.filter((b) => now - b.t < 5000);
  const bytes = bytesWindow.reduce((s, b) => s + b.n, 0);
  const span = bytesWindow.length > 1 ? Math.max(1000, now - bytesWindow[0].t) : 1000;
  const perSec = (bytes / span) * 1000;
  const players = region.playerCount || 1;
  return {
    ok: true,
    players: region.playerCount,
    monsters: region.monsterCount,
    tickMs: {
      p50: percentile(tickSamples, 50),
      p95: percentile(tickSamples, 95),
      max: percentile(tickSamples, 100),
      samples: tickSamples.length,
    },
    bytesOutPerSec: Math.round(perSec),
    bytesPerClientPerSec: Math.round(perSec / players),
    chunksPerClient: avg(chunkSamples),
    interestEntitiesPerClient: avg(interestSamples),
    deltaEntitiesPerSnap: avg(deltaSamples),
  };
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > 4096) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function publicCharacter(c: CharacterRow) {
  return { id: c.id, name: c.name, classId: c.classId, level: c.level, xp: c.xp, hp: c.hp };
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'GET' && url === '/health') {
    sendJson(res, 200, health());
    return;
  }
  const ip = clientIp(req.headers, req.socket.remoteAddress || '');
  try {
    if (req.method === 'POST' && (url === '/auth/register' || url === '/auth/login')) {
      if (!rateLimit(ip)) {
        sendJson(res, 429, { error: 'Too many attempts. Wait a minute.' });
        return;
      }
      const body = JSON.parse(await readBody(req)) as { username?: string; password?: string };
      const username = String(body.username || '');
      const password = String(body.password || '');
      if (!validUsername(username) || !validPassword(password)) {
        sendJson(res, 400, { error: 'Username is 3-16 letters, numbers, or _. Password is 6-64 characters.' });
        return;
      }
      if (url === '/auth/register') {
        if (repo.findAccountByUsername(username)) {
          sendJson(res, 409, { error: 'That username is taken.' });
          return;
        }
        const account = repo.createAccount(username, hashPassword(password));
        const token = issue(account.id);
        sendJson(res, 201, { token, account: { id: account.id, username: account.username }, characters: [] });
        return;
      }
      const account = repo.findAccountByUsername(username);
      if (!account || !verifyPassword(password, account.passwordHash)) {
        sendJson(res, 401, { error: 'Invalid login.' });
        return;
      }
      const token = issue(account.id);
      sendJson(res, 200, {
        token,
        account: { id: account.id, username: account.username },
        characters: repo.listCharacters(account.id).map(publicCharacter),
      });
      return;
    }
    if (req.method === 'GET' && url === '/auth/me') {
      const session = repo.getSession(hashToken(bearer(req)));
      if (!session) {
        sendJson(res, 401, { error: 'Session expired.' });
        return;
      }
      sendJson(res, 200, {
        account: { id: session.accountId, username: session.username },
        characters: repo.listCharacters(session.accountId).map(publicCharacter),
      });
      return;
    }
    if (req.method === 'POST' && url === '/auth/logout') {
      const token = bearer(req);
      if (token) repo.revokeSession(hashToken(token));
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url === '/characters') {
      const session = repo.getSession(hashToken(bearer(req)));
      if (!session) {
        sendJson(res, 401, { error: 'Session expired.' });
        return;
      }
      const body = JSON.parse(await readBody(req)) as { name?: string; classId?: number };
      const name = String(body.name || '').trim();
      const classId = Number(body.classId);
      if (!validCharacterName(name) || !CLASSES[classId]) {
        sendJson(res, 400, { error: 'Name is 2-16 letters, numbers, or _, and class must be knight, archer, or mage.' });
        return;
      }
      try {
        const row = repo.createCharacter({
          accountId: session.accountId,
          name,
          classId,
          x: SPAWN_SUB.x,
          y: SPAWN_SUB.y,
          hp: CLASSES[classId].hp,
          level: 1,
          xp: 0,
        });
        sendJson(res, 201, { character: publicCharacter(row) });
      } catch {
        sendJson(res, 409, { error: 'That name is taken.' });
      }
      return;
    }
    if (DEV && req.method === 'POST' && url === '/dev/bots') {
      const body = JSON.parse(await readBody(req) || '{}') as { n?: number };
      const n = Math.max(0, Math.min(60, Number(body.n) || 0));
      startBots(n);
      sendJson(res, 200, { ok: true, n });
      return;
    }
  } catch {
    sendJson(res, 400, { error: 'Bad request.' });
    return;
  }
  sendJson(res, 404, { error: 'Not found.' });
}

function issue(accountId: number): string {
  const token = newToken();
  repo.createSession(accountId, hashToken(token), Date.now() + 30 * 24 * 3600 * 1000);
  return token;
}

function startBots(n: number): void {
  if (botProc) {
    botProc.kill('SIGTERM');
    botProc = null;
  }
  if (n <= 0) return;
  botProc = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(ROOT, 'bots/src/main.ts'), '--n', String(n), '--url', `ws://127.0.0.1:${PORT}`],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

function toBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

const server = createServer((req, res) => {
  void handleHttp(req, res);
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on('connection', (socket: WebSocket) => {
  if (region.playerCount >= MAX_PLAYERS) {
    socket.close(4000, 'full');
    return;
  }
  const conn: Conn = region.addConn(socket);
  socket.on('message', (data) => {
    const buf = toBytes(data);
    if (buf.length === 0) return;
    if (buf[0] === MSG.HELLO && !conn.player) {
      const hello = decodeHello(buf);
      if (!hello) {
        socket.close(4001, 'bad hello');
        return;
      }
      const session = repo.getSession(hashToken(hello.token));
      const character = session ? repo.findCharacter(hello.characterId) : null;
      if (!session || !character || character.accountId !== session.accountId) {
        socket.close(4001, 'bad session');
        return;
      }
      region.attach(conn, {
        characterId: character.id,
        accountId: character.accountId,
        name: character.name,
        classId: character.classId,
        x: character.x,
        y: character.y,
        hp: character.hp,
        level: character.level,
        xp: character.xp,
      });
      return;
    }
    if (!conn.player) return;
    if (buf[0] === MSG.INPUT) {
      const input = decodeInput(buf);
      if (input) region.pushInput(conn, input.seq, input.dir, input.buttons);
      return;
    }
    if (buf[0] === MSG.LOGOUT) {
      saveOne(conn);
      socket.close(1000, 'logout');
    }
  });
  socket.on('close', () => {
    saveOne(conn);
    region.removeConn(conn);
  });
});

function saveOne(conn: Conn): void {
  const p = conn.player;
  if (!p || p.conn !== conn) return;
  if (p.dead) repo.saveCharacter({ id: p.characterId, x: SPAWN_SUB.x, y: SPAWN_SUB.y, hp: p.hpMax, level: p.level, xp: p.xp });
  else repo.saveCharacter({ id: p.characterId, x: p.x, y: p.y, hp: p.hp, level: p.level, xp: p.xp });
}

function saveAll(): void {
  for (const row of region.snapshotPlayers()) {
    repo.saveCharacter({ id: row.characterId, x: row.x, y: row.y, hp: row.hp, level: row.level, xp: row.xp });
  }
}

let nextTick = Date.now() + 50;
function loop(): void {
  const stat = region.step();
  tickSamples.push(stat.tickMs);
  if (tickSamples.length > 200) tickSamples.shift();
  if (stat.players > 0) {
    chunkSamples.push(stat.chunks / stat.players);
    interestSamples.push(stat.interest / stat.players);
    deltaSamples.push(stat.delta / stat.players);
    if (chunkSamples.length > 200) chunkSamples.shift();
    if (interestSamples.length > 200) interestSamples.shift();
    if (deltaSamples.length > 200) deltaSamples.shift();
  }
  if (stat.bytes) bytesWindow.push({ t: Date.now(), n: stat.bytes });
  nextTick += 50;
  const delay = Math.max(0, nextTick - Date.now());
  setTimeout(loop, delay);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tiny-realms listening on :${PORT} data=${DATA_DIR}`);
  loop();
});

setInterval(saveAll, 15_000);

function shutdown(): void {
  saveAll();
  if (botProc) botProc.kill('SIGTERM');
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
