# AGENTS.md — notes for AI coding agents

Shramko Fly by Sound: the sound engine, lessons and session format that let blind and low-vision pilots fly an FPV drone by ear in the ShramkoGSFPV browser simulator. Dependency-free TypeScript; only `src/audio/` touches the browser.

## Map

| Path | What |
|---|---|
| `src/contract.ts` | Types shared with the simulator (ShramkoGSFPV compiles against them). |
| `src/world/` | Analytic lesson worlds (signed distance functions), seven seeded generators version by version (`v1.ts`, `rooms-v2.ts`, `tunnels.ts`), sphere-traced rays, the room's hollow (`cavities`) and the world's track (`checkpoints`, `track.ts`). |
| `src/sense/` | Scene sampler: ten sectors of three rays and five rays along the path, hazards by time to contact, hysteresis, at most three hazard voices; the open way past an obstacle (`freeway.ts`). |
| `src/cues/` | Pure cue planner: what sounds, where, how often. Runs without a browser, so replay can re-derive it. |
| `src/audio/` | Web Audio engine: HRTF panners, synth voices, limiter, fade-in, speech with captions. |
| `src/theme/` | Theme schema (`LAYER_PARAMS`), built-in themes, calm preset, pentatonic pitch helpers. |
| `src/lesson/` | Lesson library, validation, goals and the pure `LessonRunner`. |
| `src/track/` | Track files (gates with pose and size, immutable versions). |
| `src/session/` | Session package: manifest, gzip and zip codecs, writer, recovery. |
| `src/replay/` | Replay core: rebuild frames, re-run runner and planner, compare with the recording. |
| `src/i18n/`, `locales/` | Strings in en, es, pl, ru; key catalogue; formatter. |
| `src/survey/`, `src/prefs/`, `src/util/` | Surveys, pilot preferences, helpers (sha256, rng, vectors). |
| `lessons/`, `themes/` | Lessons (28; `paths.json`: the full path and a fast path of 8) and themes as JSON. |
| `tools/` | Report tool, layout check, locale lint (run through `node tools/run-tool.mjs`). |
| `tools/listen.ts`, `tools/listen/`, `test-audio/page/listen*.ts` | The virtual listener's first rig: scripted flights rendered through the real engine, stems, truth, measurements (`measure.py`), clip maker. |
| `evidence/` | Audio proofs, demo check, and `evidence/listen/` (the rig's checks, keyed by the hash of their inputs). |
| `demo/` | Stand-alone demo and Sound Lab. |
| `test/`, `test-audio/` | Node tests; browser proofs in headless Chrome. |
| `docs/dev/` | Development notes and independent reviews: stage 1, and v0.13 (`status-v0.13-merge.md` and each lane's status and review). |

## Rules that matter

- **Everything in `src/` except `src/audio/` stays DOM-free.** `tsconfig.core.json` checks it.
- **The contract is shared.** Change `src/contract.ts` only together with the matching change in ShramkoGSFPV.
- **Read theme numbers by the names in `LAYER_PARAMS`** (`src/theme/schema.ts`). Build every pitch with `noteHz`, `gateMelody` or `shiftNote`, never from raw frequencies: that keeps every mix in one pentatonic scale. **The height tone glides, everything else stays on the scale:** the height tone is a position on the scale (`heightPosition`, `noteHzAt`; `src/cues/height.ts`), continuous in height, never rounded to a note; its target note (about once a second, the height tone giving way to it) is a note again. A theme parameter added after v0.12 is `optional` in `LAYER_PARAMS`, so older exported themes still load.
- **Strings go into all four locales.** Lesson ids and keys live in `src/i18n/catalog.ts`; the parity test and the speech lint fail on a missing key.
- **Every sound a pilot can hear is in the glossary, and a flying lesson is never silent.** A new cue id in `CUE_IDS` gets its name and glossary lines and goes into `lessons/ears-glossary.json` (the G key; `test/lessons.test.ts`); every flying lesson has the `height` and `room` layers (`test/silence-layers.test.ts`).
- **Generators are pinned by golden tests, version by version.** A change of a generator's geometry, defaults, random draws or track is a new version in its version table (`src/world/generators.ts`), with its own goldens; a published version never changes, so the walls a recording was flown on can always be built again. The replay builds a lesson's world from the lesson it is handed: a recording made with an older version of a lesson rebuilds on its own walls only when the replay gets that lesson (`checkSession(pkg, { lessons })`, `test/world-versions.test.ts`); with the shipped one it is reported as flown with another lesson version. `GENERATOR_VERSION` is only what `makeSpec` writes when no version is named (1); lesson files name theirs. `NEWEST_VERSION` is the newest of each generator; for the corridor that is version 2, the tunnels (layouts `tunnel`, `gaps`, `long`), and a corridor with version 1's layouts (`full`, `straight`, `obstacle`, `bends`, `jogs`) names version 1.
- **`tools/*.ts` do not run under plain Node** (extensionless imports): use `node tools/run-tool.mjs <tool>`, vitest or a bundler.
- **Hosts must record the replay markers:** a `lesson open` event, `key` events with the actions of `REPLAY_KEY_ACTIONS` (resets, next, previous, repeat, next and previous lesson) before the runner's call, a `speech` event with key `speech.end` whenever they call `runner.spoken(t)` (`SPEECH_END_KEY` in `src/replay`), and `session` pause and resume events where they call `runner.pause(t)` and `runner.resume(t)`. Without them the replay check fails on times.
- **Hosts pass `say.interrupt` to speech and send `setLayers({ on: [] })` when frames stop**, or the demo keeps sounding.
- **Privacy is enforced in code:** the session writer throws for a minor's package that claims `send` or `speechRecognition` without a confirmed guardian. Do not weaken it.
- **Every claim about sound needs a measurement** in `test-audio/` or `pnpm listen` with a negative control (an engine broken on purpose must fail). How it feels is for human ears; say so instead of guessing.
- **A change of the engine, a theme or a lesson re-runs `pnpm listen`** (its evidence is keyed by the hash of every input, so stale evidence shows). It needs the Python environment of `tools/listen/requirements.txt` (`SHRAMKO_LISTEN_PY`), a cache on a data disk (`SHRAMKO_LISTEN_CACHE`), and takes the GPU lock (`GPU_LOCK`) while headless Chrome renders.
- **Never commit** keys, `.env` files, `.cache/`, or recordings of real testers (`voice.webm`, session packages with voice). Test fixtures are synthetic.

## Checks before a PR

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test          # Node tests
pnpm proof:audio   # headless Chrome; set GPU_LOCK to a lock directory if your machine shares the GPU
pnpm listen        # the virtual listener's checks (needs SHRAMKO_LISTEN_PY; renders cached in SHRAMKO_LISTEN_CACHE)
```
