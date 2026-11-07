# ShramkoSonicFPV

**Fly by Sound**: an open-source sound engine, lessons and session format that let blind and low-vision pilots fly an FPV drone **by ear** in the [ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) browser simulator (live at [gsfpv.flyreelstudio.eu](https://gsfpv.flyreelstudio.eu)), and let sighted pilots train their ears too. It is a game people choose to play. Nothing here claims therapy or medical benefit.

Dependency-free TypeScript under the MIT licence. All sound is synthesised in the browser with Web Audio, with no sample files. No network at runtime, no keys, no personal data.

## Who it is for

- **Blind and low-vision pilots**, who get a way to learn to fly with sound that carries position, distance, height, speed and the next gate, and a voice that says what each thing is.
- **Sighted pilots** who want to train their ears, or to fly with their eyes closed.
- **Teachers and schools**, who get lessons, a test protocol, a consent template and a loudness sheet in [docs/testing](docs/testing).
- **Sound designers and researchers**, who can tune every sound without code in the Sound Lab and read the evidence behind each choice in [docs/research](docs/research).

## The idea

- **Voice says what it is, music says where it is.** Speech carries meaning, non-speech sound carries position.
- **Few streams.** A beginner hears one continuous stream and one event stream. Never more than three hazard voices.
- **Harmony, not cacophony.** Every pitched note comes from one pentatonic scale, so any mix stays consonant. "Off course" is roughness, never a wrong note.
- **Danger first.** The safety layer outranks everything and is never masked.
- **The pilot owns the sound.** Each layer has its own volume and pitch, "up = higher" can be flipped, and a calm preset exists.
- **No fail state.** A touch is a soft bump, not a crash screen.

The full design is in [docs/design/stage-1-spec.md](docs/design/stage-1-spec.md).

### Spatial sound on two headphone speakers

On headphones every format ends as two channels, so the question is how little detail is lost on the way. The research ([docs/research/01](docs/research/01-spatial-audio-on-headphones.md)) found:

- **Each important sound is its own object with its own head-related transfer function (HRTF).** This is the reference. 5.1, 7.1, Atmos and Windows Sonic beds add panning error and no resolution on headphones, and no browser interface reaches them.
- **Ambisonics** is used only for the ambience bed: order 3 is the minimum worth using and order 4 the most that fits one 32-channel bus; order 5 and above has no evidence of benefit. The theme parameter `room.bedOrder` carries the choice; the first engine renders order 0.
- **Elevation and front/back are weak over headphones**, so height is also coded by pitch, the scene turns at once with the stick, and distance is coded several ways at once.
- Today the engine uses the browser's built-in HRTF panner (8 moving and 24 static voices); an own renderer with measured HRTF sets (SADIE II, HUTUBS) is the planned upgrade, and the research lists what must be tested with people first.

## Try it

Node 22 and pnpm 11.

```
pnpm install
pnpm demo
```

`pnpm demo` builds the stand-alone page and serves it at http://127.0.0.1:5173/. It holds two things:

- **The flight demo**: the first lessons (hearing the sounds, hover, move and stop) flown with the keyboard (W S A D, arrows, N next, R reset, digits to answer, P pause) in a simple point-mass world. Press **Start the sound** first, with the volume low.
- **The Sound Lab**: a slider for every layer's gain and pitch, every number of the theme, a preview of each of the 20 cues, and an export of the theme as a JSON file that goes into [themes/](themes) or to the author.

Everything works with the keyboard alone, and a headless check proves it (`pnpm proof:audio`). `pnpm demo:build` writes the page to `demo/dist/`, a folder of three files that opens by double click or from any web server.

## How it fits with the simulator

[ShramkoGSFPV](https://github.com/AndriiShramko/ShramkoGSFPV) links this repository as a git submodule at `packages/sonic-fpv` and consumes it as the workspace package `@shramko/sonic-fpv`. The simulator holds the adapters (its flight loop, its walls, its screens, the server and the delivery of recorded sessions); this repository holds everything the simulator does not need to know about sound:

- the shared contract (`src/contract.ts`): the types both repositories compile against;
- the analytic lesson worlds, the scene sampler, tracks, themes and pilot preferences;
- the lessons (21, modules 0 to 7) and the lesson runner;
- the strings in English, Spanish, Polish and Russian (`locales/`);
- the audio engine in `src/audio/`, the only code that touches the browser;
- the session package format, the replay core and the report tool.

Sound never reads the renderer: it reads a `SonicWorld` (rays and a list of objects).

## Sessions, replay and reports

A recorded flight is **one `.zip`** (spec section 7): `manifest.json`, `flight.jsonl.gz` (30 Hz, one gzip member per chunk so that a closed tab loses at most a few seconds), `events.jsonl`, an optional `voice.webm`, `survey.json`. It is written without a server, read back by `src/session/`, and checked against the privacy rules (voice only with consent, a minor's package says whether a guardian confirmed). The replay core (`src/replay/`) runs the lesson runner and the cue planner on the recorded frames again and checks that they re-derive the recorded events and cues.

```
pnpm report session.zip                       Markdown timeline and metrics
pnpm report session.zip --transcript talk.json --json report.json
```

The report says whether the lesson was passed, the time, the touches, the time of each gate, how far the flown path strayed from the line through the gates, the survey answers, and joins a transcript of what the pilot said (JSON, SRT or WebVTT) to the timeline.

## Testing with people

An agent cannot judge how a sound feels, so everything that can be measured is measured and the rest is for ears. [docs/testing](docs/testing) holds the **test protocol** for first-time and returning testers with the metrics, a **consent template** for parents and schools in Polish and English (marked as not legal advice), and a **school loudness sheet** (75 dBA for children, 80 dBA for adults).

## Layout

| Path | What |
|---|---|
| `src/` | DOM-free TypeScript (checked by `tsconfig.core.json`), except `src/audio/` |
| `test/` | Node tests, run by `pnpm test` |
| `test-audio/` | browser proofs (headless Chromium): the audio proofs and the keyboard-only check of the demo |
| `locales/` | `en.json`, `es.json`, `pl.json`, `ru.json`: cue names, lessons, surveys, spoken menus |
| `themes/` | sound themes as JSON |
| `lessons/` | lessons as JSON |
| `tools/` | Node tools: the report tool and the layout check |
| `demo/` | stand-alone demo page and Sound Lab |
| `docs/` | specification, research, development status, test protocol |
| `evidence/` | numbers measured by the proofs |

## Development

```
pnpm typecheck
pnpm test
pnpm proof:audio
```

`pnpm test` runs Node tests only. `pnpm proof:audio` renders the engine offline in headless Chrome and measures it (direction, pulse rate, ceiling, fade-in, voice budget), each check also run on an engine broken on purpose that must fail, and then drives the demo with the keyboard alone; the numbers go to `evidence/`. The progress of the work is in [docs/dev/status-stage-1.md](docs/dev/status-stage-1.md).

## Licence

The code is under the **MIT licence**, see [LICENSE](LICENSE). The research and every other document under `docs/` are under **CC BY 4.0**, see [docs/LICENSE.md](docs/LICENSE.md).

## Credits

The sound design is developed by Andrii Shramko together with the spatial-audio researcher Bartłomiej Mróz (Gdansk University of Technology).
