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

The server is `server/Dockerfile` plus `server/fly.toml` (app `tiny-realms`, region `sjc`, shared-cpu-1x, 256MB, always on). Create the volume before the first deploy, then deploy from the repo root so the Dockerfile path resolves:

```bash
fly volumes create tiny_realms_data --region sjc --size 1
fly deploy
```

`fly.toml` mounts `tiny_realms_data` at `/data`. `GET /health` reports player count and tick time.

## World

One seamless overworld, 128×96 tiles, split into 32×32 chunks (4×3). The client only keeps chunks inside an interest radius: subscribe at 28 tiles, drop at 36, so the map can grow and later be split across processes by region. A dungeon instance is a separate region later. M0 has the data model and one entrance: the stairs in the west crypt. Standing on them shows a banner. Nothing is teleported.

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

## Not in M0

Shapes for loot, gear, quests, parties, and crafting live in `shared/src/future.ts` and are not implemented. There is no player trading. Dungeon instances and multi-process region shards are the next split, not this build.
