# ShramkoSonicFPV

Fly by Sound: an open-source sound engine, lessons and session format that let blind and low-vision pilots fly an FPV drone by ear in the [ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) browser simulator, and let sighted pilots train their ears too. It is a game people choose to play. Nothing here claims therapy or medical benefit.

Dependency-free TypeScript under the MIT licence. No network at runtime, no keys, no personal data.

## The idea

- **Voice says what it is, music says where it is.** Speech carries meaning, non-speech sound carries position.
- **Few streams.** A beginner hears one continuous stream and one event stream. Never more than three hazard voices.
- **Harmony, not cacophony.** Every pitched note comes from one pentatonic scale, so any mix stays consonant. "Off course" is roughness, never a wrong note.
- **Danger first.** The safety layer outranks everything and is never masked.
- **The pilot owns the sound.** Each layer has its own volume and pitch, "up = higher" can be flipped, and a calm preset exists.
- **No fail state.** A touch is a soft bump, not a crash screen.

All sound is synthesised in the browser with Web Audio, no sample files. The full design is in [docs/design/stage-1-spec.md](docs/design/stage-1-spec.md); the evidence behind it is in [docs/research](docs/research).

## How it fits with the simulator

ShramkoGSFPV links this repository as a git submodule at `packages/sonic-fpv` and consumes it as the workspace package `@shramko/sonic-fpv`. The simulator holds the adapters (its flight loop, its walls, its screens, the server); this repository holds everything the simulator does not need to know about sound:

- the shared contract (`src/contract.ts`): the types both repositories compile against;
- the analytic lesson worlds, the scene sampler, tracks, themes and pilot preferences;
- the strings in English, Spanish, Polish and Russian (`locales/`);
- the audio engine in `src/audio/`, the only code that touches the browser.

Sound never reads the renderer: it reads a `SonicWorld` (rays and a list of objects).

## Layout

| Path | What |
|---|---|
| `src/` | DOM-free TypeScript (checked by `tsconfig.core.json`), except `src/audio/` |
| `test/` | Node tests, run by `pnpm test` |
| `test-audio/` | browser proofs (headless Chromium, `OfflineAudioContext`) |
| `locales/` | `en.json`, `es.json`, `pl.json`, `ru.json`: cue names, lessons, surveys, spoken menus |
| `themes/` | sound themes as JSON |
| `lessons/` | lessons as JSON |
| `tools/` | Node tools (layout check, session report) |
| `demo/` | stand-alone demo page and Sound Lab |
| `docs/` | spec, research, development status, test protocol |

## Development

Node 22 and pnpm 11.

```
pnpm install
pnpm typecheck
pnpm test
pnpm proof:audio
```

`pnpm test` runs Node tests only. `pnpm proof:audio` renders the engine offline in headless Chrome and measures it (direction, pulse rate, ceiling, fade-in, voice budget), each check also run on an engine broken on purpose that must fail; the numbers go to `evidence/audio-proofs.json`. Directories above that do not exist yet are added by later steps; the progress is in [docs/dev/status-stage-1.md](docs/dev/status-stage-1.md).

## Licence

MIT, see [LICENSE](LICENSE).
