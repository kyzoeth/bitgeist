# BITGEIST

Instant 10-ghost retro micro-sprints in the browser. Zero menus, zero sign-ups, 10ms save-state retries, and 1-tap **"Beat My Ghost"** dare links (`/vs/[slug]`).

## Architecture

- **Multi-Console WebAssembly Cores:** Self-hosted `fceumm_libretro.wasm` (`NES`) + `nostalgist` Libretro cores for `SNES` (`snes9x`), `Sega Genesis` (`genesis_plus_gx`), `Game Boy / GBC` (`gambatte`), and `GBA` (`mgba`) running client-side at 60 FPS inside a pixel-locked `512×384` `4:3` viewport.
- **System RAM Telemetry Bridge (`lib/nesRamBridge.ts`, `lib/romProfiles.ts`):** Locates CPU/WRAM inside `Module.HEAPU8` (`2KB` NES RAM `$0000`–`$07FF`, `128KB` SNES WRAM, and generic save-state WRAM block matching) to stream live 2D camera scroll (`cameraX`, `cameraY`), pixel-exact player coordinates, death states, and finish-gate crossings without modifying ROM binaries.
- **Default Cartridge:** Pre-loaded open-source demake *CelesteNES* (`demo-1.00` by `iProgramInCpp`; *Celeste* IP © Maddy Makes Games / EXOK) with automatic cold-boot title/overworld/postcard skip + room warp, 6 rotating multi-room Daily Sprint `#NNN` / Free-Sprint courses across *Forsaken City*, *Old Site*, and *Prologue* (`lib/dailySprints.ts`), and IndexedDB `00.00s` starting-line snapshot caching (`lib/romVault.ts`).
- **Multi-Console Forever Vault (`lib/romVault.ts`, `lib/romProfiles.ts`):** Drag-and-drop `.nes`, `.sfc`/`.smc`, `.md`/`.gen`/`.bin`, `.gb`/`.gbc`, or `.gba` cartridges to cache locally in IndexedDB forever (zero server ROM uploads), featuring exact RAM profiles (*CelesteNES*, *Twin Dragons*, *Super Mario Bros. 1 & 3*, *Mega Man 1 & 2*, *Contra*, *Castlevania*, *Ninja Gaiden*, *Nova the Squirrel*, *Super Mario World*, *Sonic the Hedgehog*, *Super Mario Land*) plus universal OAM/kinematic sprint fallbacks.
- **SQLite WAL Persistence, Collision-Proof Dare Slugs & Skill-Bracketed Matchmaking (`lib/ghostStore.ts`, `app/api/ghosts/route.ts`):**
  - Built-in `node:sqlite` (`DatabaseSync`) ACID store in WAL mode (`BITGEIST_DB_PATH`, defaulting to `data/bitgeist.sqlite`) with automatic migration from legacy `data/ghosts.json` and `GET /api/health` (`app/api/health/route.ts`).
  - Unique collision-proof short dare slugs (`/vs/ali-7x2k`) with `clientRunId` ownership verification on tag rename and backwards-compatible plain-tag PB lookup (`/vs/alex`).
  - Per-sprint Personal Best (`pbMs`) skill-bracketed 10-ghost matchmaking (1 Crowned Dare Target + 2 faster "rabbit" pace-setters + 5 neck-and-neck rivals + 2 overtake/perishing rivals).
- **Tactile CRT Television & Live 3D Controllers (`components/HardwareSkinControls.tsx`):** `4:3` curved-glass CRT chassis (`512×384` viewport + top-bezel LED speedrun clock) paired with a bold `#111111`-inked 3D `144×58` console-matched **NES-004**, **SNES-005**, **Sega Genesis 3-Button**, or **Game Boy / GBA** controller featuring live 60Hz button depression and illumination.
- **Live Ghost Differentials & Finish Gate (`components/GhostCanvasOverlay.tsx`):** Translucent hologram runners with live `±0.00s` pace differentials, coasting finish-gate exit (zero flagpole pileup), and a `1.2s` pixel-confetti finish celebration before the share modal opens.
- **Anti-Cheat & Hardware Polish:** 60Hz RLE joypad input-log verification (horizontal & vertical wall-climb/air-dash correlation) + deterministic WASM replay (`lib/inputReplay.ts`), 60Hz W3C hardware gamepad polling (`lib/gamepadBridge.ts`), and 2A03 WebAudio micro-SFX (`lib/retroAudio.ts`).

## Controls

- **Move / Aim Dash:** `Arrow Keys` (or `W` / `A` / `S` / `D`)
- **Jump (`A`):** `Space` (or `X` / `K`)
- **Air Dash (`B`):** `Z` (or `Left Shift` / `J`)
- **Climb Wall:** Hold `↑` (`Up` / `W`) against a wall
- **Toggle Cartridge Music:** `M`
- **Instant Starting-Line Reset:** `R`

## Local Development & Production Docker

```bash
npm install
npm run dev
```

Open `http://localhost:3000` (health check: `http://localhost:3000/api/health`).

For containerized cloud deployment with persistent SQLite WAL storage:

```bash
docker build -t bitgeist .
docker run -p 3000:3000 -v bitgeist-data:/app/data bitgeist
```
