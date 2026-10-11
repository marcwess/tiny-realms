# Tiny Realms

Mobile-first browser MMORPG. M0 is one shared overworld where people log in, walk together, and fight. The owner plays on an iPhone at 120Hz, so the client stays pixel-crisp and the simulation does not depend on the display refresh rate.

Tiles are Kenney Tiny Dungeon (CC0). Pixel effects: Super Pixel Effects Gigapack - Will Tice / unTied Games.

## Run locally

```bash
npm install
npm run dev
```

- Client: http://localhost:5173/tiny-realms/
- Server: `ws://localhost:8787` (HTTP on the same port)
- `?server=ws://host:port` overrides the socket URL
- Dev `config.json` points at localhost. The committed file points at `wss://tiny-realms.fly.dev` for GitHub Pages.

`npm run selftest` checks the world graph, input-queue rules, zone flags, the binary snapshot codec, and a SQLite save.

## Accounts

The first screen is **Create account** or **Log in** (username and password). Passwords are hashed with scrypt (`N=16384`, `r=8`, `p=1`). The server returns a session token; the client keeps it in `localStorage`. Login and registration are rate-limited to 8 attempts per minute per IP (loopback is higher so local bots can sign in).

After login you create or select a character and pick Knight, Archer, or Mage. Entering the world resumes the saved position, HP, level, and XP. Level and XP are stored and shown. They do not change yet.

The character is written on logout, on disconnect, and every 15 seconds. SQLite (`node:sqlite`) sits behind `AccountRepository` so the storage can move to Postgres later. Development uses `./data/tiny-realms.sqlite`. Production uses `DATA_DIR`.

## Deploy

The client builds with Vite (`base` `/tiny-realms/`) and GitHub Actions publishes `client/dist` to GitHub Pages on push to `main`.

The server is `server/Dockerfile` plus the root `fly.toml` (app `tiny-realms`, region `sjc`, shared-cpu-1x, 256MB, always on). Create the volume before the first deploy, then deploy from the repo root so the Dockerfile path resolves:

```bash
fly volumes create tiny_realms_data --region sjc --size 1
fly deploy
```

`fly.toml` mounts `tiny_realms_data` at `/data`. `GET /health` reports player count and tick time.

## World

One seamless overworld, 128×96 tiles, split into 32×32 chunks (4×3). The client only keeps chunks inside an interest radius: subscribe at 28 tiles, drop at 36, so the map can grow and later be split across processes by region. A dungeon instance is a separate region later. M0 has the data model and one entrance: the stairs in the west crypt. Standing on them shows a banner. Nothing is teleported.

`tilemap_packed.png` is loaded as a 16×16 spritesheet with no spacing and no margin (12 columns). Frame N is row×12+col: mage 84, knight 96, archer 112. The sheet has no green grass; outdoor ground is the sand tiles (48, 49) with rock piles (42). Walls are the full brick frame (40); frames 1-3, 13-15 and 25-27 are outline pieces of a brick block and are not used as a ring wall. Town and pit floors are the brown ground (0, rubble 24), house floors are sand, doors are openings, pit banners are 29. Blank white frames (60–62) are not used.

Zone flags live on region rectangles:

| Place | Flag |
| --- | --- |
| Millcross (the town) | safe — monsters do not enter or hurt you |
| Blood Pit (east of town) | PvP — players damage each other only when both are inside |
| Everything else | PvE |

The pit has a wall, a red overlay border, and an "Entering PvP zone" banner.

## Combat and netcode

Action combat with auto-aim. Knight: short melee arc and a shield bash. Archer: arrows and a triple shot. Mage: a bolt with a small blast and a fireball. The server decides hits, HP, knockback, and respawn (town, after 3 seconds).

- Fixed 20Hz simulation. Positions are integer deci-pixels so the same step matches on the server and in the browser.
- Your character is predicted and reconciled. Other players and monsters render about 100ms behind the server, interpolated, with no extrapolation.
- Each input carries a sequence number. Silence does not burn sequences, and a late input is not dropped as stale. The server applies one queued input per tick, or two when the queue is long.
- The entity you follow comes only from that socket's welcome. Human players are never driven by monster AI.
- Snapshots are compact binary deltas at 20Hz. Your own entity is always included. Chunk tiles stream in and out with the interest set.

`npm run bots -- --n 40` or, in dev, `?bots=40` fills the town with headless clients that walk and attack.

## What was measured

Playwright drove Chromium and WebKit at 390×844, devicePixelRatio 3, through a proxy that delays each WebSocket direction by 50ms. The canvas backing store stayed 390×844 (the camera zoom is the integer scale). Headless Chromium reported fps median 120 and p10 120.

- Three players in town saw each other. Two seconds of east movement gained about 94px with no backward reconciliation snaps. After the stream settled, 173 inputs had been sent and 169 acknowledged.
- A real touch drag on the left-half joystick moved the archer and showed the knob.
- Knight, archer, and mage each killed the slime south of the gate. Hits were 18, 11, and 14, with the impact effects and floating numbers.
- At spawn the client held 9 chunks (columns 0–2). In the Blood Pit it had dropped column 0 and gained column 3 (`3,0`, `3,1`, `3,2`), still 9 chunks.
- Inside the pit a hit took 18 HP off the other player. A shot fired after stepping back into the wilds did not.
- Log out and log back in restored the same point: pixel position 1244.3, 806.5 and HP 134.

Forty bot clients on this machine, all piled into town:

| | |
| --- | --- |
| tick p50 / p95 / max | 1.63 / 1.94 / 2.38 ms |
| bandwidth | about 10.6 KB/s per client |
| chunks per client | 7 |
| entities in interest | about 46 |
| entities in each delta | about 33 |

Deltas stay large while everyone is moving inside one interest radius. Idle players outside that radius are not in the snapshot.

## Known issues

- `node:sqlite` logs an experimental warning. The Fly image was not booted here.
- Snapshot positions are signed 16-bit deci-pixels, and HP is one byte. Both fit M0. A much larger map or health pool needs a wider field.
- The crypt stairs show a banner only. There is no dungeon instance yet.
- Level and XP are saved and shown. Nothing awards them yet.

## Not in M0

Shapes for loot, gear, quests, parties, and crafting live in `shared/src/future.ts` and are not implemented. There is no player trading. Dungeon instances and multi-process region shards are the next split, not this build.
