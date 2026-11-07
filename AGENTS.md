# AGENTS.md — notes for AI coding agents

Shramko Fly by Sound: the sound engine, lessons and session format that let blind and low-vision pilots fly an FPV drone by ear in the ShramkoGSFPV browser simulator. Dependency-free TypeScript; only `src/audio/` touches the browser.

## Map

| Path | What |
|---|---|
| `src/contract.ts` | Types shared with the simulator (ShramkoGSFPV compiles against them). |
| `src/world/` | Analytic lesson worlds (signed distance functions), seven seeded generators, sphere-traced rays. |
| `src/sense/` | Scene sampler: ten sectors of three rays, hysteresis, at most three hazard voices. |
| `src/cues/` | Pure cue planner: what sounds, where, how often. Runs without a browser, so replay can re-derive it. |
| `src/audio/` | Web Audio engine: HRTF panners, synth voices, limiter, fade-in, speech with captions. |
| `src/theme/` | Theme schema (`LAYER_PARAMS`), built-in themes, calm preset, pentatonic pitch helpers. |
| `src/lesson/` | Lesson library, validation, goals and the pure `LessonRunner`. |
| `src/track/` | Track files (gates with pose and size, immutable versions). |
| `src/session/` | Session package: manifest, gzip and zip codecs, writer, recovery. |
| `src/replay/` | Replay core: rebuild frames, re-run runner and planner, compare with the recording. |
| `src/i18n/`, `locales/` | Strings in en, es, pl, ru; key catalogue; formatter. |
| `src/survey/`, `src/prefs/`, `src/util/` | Surveys, pilot preferences, helpers (sha256, rng, vectors). |
| `lessons/`, `themes/` | Lessons and themes as JSON. |
| `tools/` | Report tool, layout check, locale lint (run through `node tools/run-tool.mjs`). |
| `demo/` | Stand-alone demo and Sound Lab. |
| `test/`, `test-audio/` | Node tests; browser proofs in headless Chrome. |

## Rules that matter

- **Everything in `src/` except `src/audio/` stays DOM-free.** `tsconfig.core.json` checks it.
- **The contract is shared.** Change `src/contract.ts` only together with the matching change in ShramkoGSFPV.
- **Read theme numbers by the names in `LAYER_PARAMS`** (`src/theme/schema.ts`). Build every pitch with `noteHz`, `heightNoteIndex`, `gateMelody` or `shiftNote`, never from raw frequencies: that keeps every mix in one pentatonic scale.
- **Strings go into all four locales.** Lesson ids and keys live in `src/i18n/catalog.ts`; the parity test and the speech lint fail on a missing key.
- **Generators are pinned by golden tests.** Changing a generator or its defaults needs a `GENERATOR_VERSION` bump and regenerated goldens.
- **`tools/*.ts` do not run under plain Node** (extensionless imports): use `node tools/run-tool.mjs <tool>`, vitest or a bundler.
- **Hosts must record the replay markers:** a `lesson open` event, `key` events with `reset.checkpoint`, `reset.start` or `next`, and a `speech` event with key `speech.end` whenever they call `runner.spoken(t)` (`REPLAY_KEY_ACTIONS`, `SPEECH_END_KEY` in `src/replay`). Without them the replay check fails on times.
- **Hosts pass `say.interrupt` to speech and send `setLayers({ on: [] })` when frames stop**, or the demo keeps sounding.
- **Privacy is enforced in code:** the session writer throws for a minor's package that claims `send` or `speechRecognition` without a confirmed guardian. Do not weaken it.
- **Every claim about sound needs a measurement** in `test-audio/` with a negative control (an engine broken on purpose must fail). How it feels is for human ears; say so instead of guessing.
- **Never commit** keys, `.env` files, `.cache/`, or recordings of real testers (`voice.webm`, session packages with voice). Test fixtures are synthetic.

## Checks before a PR

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test          # Node tests
pnpm proof:audio   # headless Chrome; set GPU_LOCK to a lock directory if your machine shares the GPU
```
