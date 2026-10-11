import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TICK_MS } from '../shared/src/constants.ts';
import { InputQueue } from '../shared/src/inputQueue.ts';
import { sampleInterp } from '../shared/src/interest.ts';
import { applyMovement, blocked } from '../shared/src/sim.ts';
import { decodeAdd, decodeSnap, encodeAdd, encodeInput, decodeInput, encodeSnap } from '../shared/src/protocol.ts';
import { playersCanDamage, SPAWN_SUB, zoneAtTile } from '../shared/src/zones.ts';
import { buildWorld, openSpotNear, reachableFromSpawn, solidAtOf, validateWorld } from '../shared/src/world.ts';
import { hashPassword, verifyPassword } from '../server/src/auth.ts';
import { SqliteAccountRepository } from '../server/src/repo.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

{
  // Re-login / reconnect: stale high seqs from the old session, then seq 1.. again.
  const q = new InputQueue();
  q.push({ seq: 2458, dir: 3, buttons: 0 });
  q.push({ seq: 2459, dir: 3, buttons: 0 });
  q.consume(2);
  q.push({ seq: 1, dir: 3, buttons: 0 });
  q.push({ seq: 2, dir: 3, buttons: 0 });
  assert(q.consume(2).length === 2, 'input queue accepts a restarted client');
  q.push({ seq: 1, dir: 3, buttons: 0 });
  assert(q.length === 0, 'input queue still drops a duplicate');
}
const world = buildWorld();
const problems = validateWorld(world);
assert(problems.length === 0, 'world: ' + problems.join('; '));
assert(world.tiles.length === 128 * 96 && world.objects.length === world.tiles.length, 'world layers');
{
  const reach = reachableFromSpawn(world);
  const solidAt = solidAtOf(world);
  // Every saved position, including ones from the old map inside new trees,
  // houses or the river, must load into a free spot connected to town.
  for (let ty = 0; ty < 96; ty++) {
    for (let tx = 0; tx < 128; tx++) {
      for (const [ox, oy] of [[80, 80], [20, 140], [150, 30]]) {
        const spot = openSpotNear(world, reach, tx * 160 + ox, ty * 160 + oy);
        if (!spot) continue;
        assert(!blocked(spot.x, spot.y, solidAt), 'relocated spot is free at ' + tx + ',' + ty);
        assert(reach[Math.floor(spot.y / 160) * 128 + Math.floor(spot.x / 160)] === 1, 'relocated spot reachable');
      }
    }
  }
  assert(!blocked(SPAWN_SUB.x, SPAWN_SUB.y, solidAt), 'spawn body is free');
}

const png = readFileSync(new URL('../client/public/assets/tilemap_packed.png', import.meta.url));
assert(png.readUInt32BE(16) === 192 && png.readUInt32BE(20) === 176, 'tilemap_packed is 192x176');
const frameOf = (n: number) => ({ col: n % 12, row: Math.floor(n / 12), x: (n % 12) * 16, y: Math.floor(n / 12) * 16 });
assert(frameOf(84).y === 112 && frameOf(96).y === 128 && frameOf(108).y === 144 && frameOf(112).x === 64 && frameOf(112).y === 144, 'frame N = row*12+col');

const q = new InputQueue();
q.push({ seq: 1, dir: 3, buttons: 0 });
const first = q.consume(1);
assert(first.length === 1 && first[0].seq === 1, 'consume first');
assert(q.lastProcessed === 1, 'ack 1');
for (let i = 0; i < 100; i++) assert(q.consume(1).length === 0, 'silence yields nothing');
assert(q.lastProcessed === 1, 'silence must not burn seq');
q.push({ seq: 2, dir: 3, buttons: 1 });
const second = q.consume(1);
assert(second.length === 1 && second[0].seq === 2, 'input after stall is applied');
q.push({ seq: 10, dir: 4, buttons: 0 });
const jumped = q.consume(1);
assert(jumped.length === 1 && jumped[0].seq === 10, 'gapped seq is not dropped as stale');
q.push({ seq: 10, dir: 1, buttons: 0 });
assert(q.consume(1).length === 0, 'duplicate seq ignored');

const solid = solidAtOf(world);
const start = { ...SPAWN_SUB };
const step1 = applyMovement(start.x, start.y, 3, 24, solid);
const step2 = applyMovement(step1.x, step1.y, 3, 24, solid);
const replay = applyMovement(step1.x, step1.y, 3, 24, solid);
assert(replay.x === step2.x && replay.y === step2.y, 'replay matches');
assert(step2.x > start.x, 'moved east');

assert(zoneAtTile(50, 50) === 'safe', 'town safe');
assert(zoneAtTile(78, 50) === 'pvp', 'pit pvp');
assert(zoneAtTile(50, 70) === 'pve', 'field pve');
assert(!playersCanDamage(start.x, start.y, start.x + 100, start.y), 'no pvp in town');
const pitX = 78 * 160 + 80;
const pitY = 50 * 160 + 80;
assert(playersCanDamage(pitX, pitY, pitX + 40, pitY), 'pvp inside the pit');

const samples = [
  { t: 0, x: 0, y: 0 },
  { t: 50, x: 100, y: 0 },
];
const pts = [];
for (let i = 0; i <= 6; i++) pts.push(sampleInterp(samples, (TICK_MS * i) / 6)!.x);
for (let i = 1; i < pts.length; i++) assert(pts[i] >= pts[i - 1] - 0.001, 'interp monotonic');
assert(Math.abs(pts[pts.length - 1] - 100) < 0.001, 'interp end');
const mid = sampleInterp(samples, 25)!;
assert(Math.abs(mid.x - 50) < 0.001, 'interp mid');

const encoded = encodeInput({ seq: 42, dir: 6, buttons: 3 });
const decoded = decodeInput(encoded);
assert(decoded?.seq === 42 && decoded.dir === 6 && decoded.buttons === 3, 'input codec');
const snap = encodeSnap({
  tick: 9,
  ack: 4,
  attackCd: 2,
  skillCd: 8,
  zone: 2,
  online: 3,
  ents: [{ id: 7, kind: 0, subtype: 1, flags: 1, x: 1000, y: -20, hp: 80, vx: 0, vy: 0 }],
});
const back = decodeSnap(snap);
assert(back?.tick === 9 && back.ack === 4 && back.zone === 2 && back.ents[0].x === 1000 && back.ents[0].hp === 80, 'snap codec');
const added = encodeAdd([
  { id: 3, kind: 0, subtype: 1, flags: 1, x: 4000, y: 8000, hp: 140, name: 'Mara' },
  { id: 9, kind: 1, subtype: 0, flags: 0, x: 100, y: 200, hp: 30, name: 'Slime' },
]);
const addBack = decodeAdd(added);
assert(addBack?.length === 2 && addBack[0].name === 'Mara' && addBack[0].hp === 140 && addBack[1].x === 100, 'add codec');

const dir = mkdtempSync(path.join(tmpdir(), 'tiny-'));
const repo = new SqliteAccountRepository(path.join(dir, 't.sqlite'));
const hash = hashPassword('secret12');
assert(verifyPassword('secret12', hash), 'password ok');
assert(!verifyPassword('nope', hash), 'password reject');
const account = repo.createAccount('Mara', hash);
const row = repo.createCharacter({
  accountId: account.id,
  name: 'Mara',
  classId: 0,
  x: 1234,
  y: 5678,
  hp: 90,
  level: 1,
  xp: 0,
});
repo.saveCharacter({ id: row.id, x: 2222, y: 3333, hp: 40, level: 1, xp: 0 });
const loaded = repo.findCharacter(row.id);
assert(loaded?.x === 2222 && loaded.y === 3333 && loaded.hp === 40, 'character save');

console.log('selftest ok', { tiles: world.tiles.length, monsters: world.spawns.length });
