import { WebSocket } from 'ws';
import { BTN } from '../../shared/src/constants.ts';
import { encodeHello, encodeInput } from '../../shared/src/protocol.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const n = Math.max(1, Math.min(60, Number(arg('--n', '8')) || 8));
const wsUrl = arg('--url', 'ws://127.0.0.1:8787');
const httpBase = wsUrl.startsWith('wss://') ? 'https://' + wsUrl.slice(6) : 'http://' + wsUrl.slice(5);

async function json(path: string, body: unknown, token?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(httpBase + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

async function one(index: number): Promise<void> {
  const username = 'bot' + String(index).padStart(3, '0');
  const password = 'loadtest1';
  let token = '';
  let created = await json('/auth/register', { username, password });
  if (created.status === 409 || created.status === 401) {
    created = await json('/auth/login', { username, password });
  }
  if (!created.data.token) {
    const again = await json('/auth/login', { username, password });
    token = String(again.data.token || '');
    if (!token) {
      console.error('bot auth failed', username, created.status, again.status);
      return;
    }
  } else token = String(created.data.token);

  let characters = (created.data.characters as { id: number }[] | undefined) ?? [];
  if (characters.length === 0) {
    const me = await fetch(httpBase + '/auth/me', { headers: { authorization: 'Bearer ' + token } });
    const body = (await me.json()) as { characters?: { id: number }[] };
    characters = body.characters ?? [];
  }
  if (characters.length === 0) {
    const made = await json('/characters', { name: 'Bot' + String(index).padStart(2, '0'), classId: index % 3 }, token);
    const ch = made.data.character as { id: number } | undefined;
    if (!ch) {
      console.error('bot character failed', username, made.status, made.data);
      return;
    }
    characters = [ch];
  }
  const characterId = characters[0].id;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(encodeHello(token, characterId));
  let seq = 0;
  let dir = 1 + (index % 8);
  let ticks = 0;
  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(timer);
      return;
    }
    ticks++;
    if (ticks % (20 + (index % 15)) === 0) dir = 1 + ((dir + index) % 8);
    if (ticks % 80 === 0) dir = 0;
    let buttons = 0;
    if (ticks % 4 === index % 4) buttons |= BTN.Attack;
    if (ticks % 90 === 0) buttons |= BTN.Skill;
    seq++;
    ws.send(encodeInput({ seq, dir, buttons }));
  }, 50);
  ws.on('close', () => clearInterval(timer));
}

async function main(): Promise<void> {
  console.log(`starting ${n} bots -> ${wsUrl}`);
  for (let i = 1; i <= n; i++) {
    void one(i).catch((err) => console.error('bot', i, err));
    await new Promise((r) => setTimeout(r, 40));
  }
}

void main();
