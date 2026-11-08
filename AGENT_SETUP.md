# AGENT_SETUP.md — protocol for a user's AI agent

Use this when a person asks their AI agent to "let me try flying a drone by sound", "analyse this recorded test flight" or "use this spatial-audio engine in my project".

## A. Try it

1. In the simulator: open <https://gsfpv.flyreelstudio.eu/en/sound/> in desktop Chrome or Edge (also `/es/`, `/pl/`, `/ru/`) and press Start. Ordinary pages of the simulator do not load the sound mode.
2. Stand-alone demo (Node 22+, pnpm 11):

   ```bash
   git clone https://github.com/AndriiShramko/shramko-fly-by-sound-fpv && cd shramko-fly-by-sound-fpv
   pnpm install --frozen-lockfile
   pnpm demo          # serves http://127.0.0.1:5173/
   ```

3. Tell the user: wired headphones, volume low at first, press **Start the sound**, then the keyboard (W S A D, arrows, N next step, B previous step, Z the step again, R reset, digits to answer, P pause). Everything works without a mouse or screen.

## B. Analyse a recorded flight

A session is one `.zip` from the simulator (`manifest.json`, `flight.jsonl.gz`, `events.jsonl`, optional `voice.webm`, `survey.json`).

```bash
pnpm report session.zip                                   # Markdown timeline and metrics
pnpm report session.zip --transcript talk.json --json report.json
```

The transcript of the pilot's voice can be JSON, SRT or WebVTT; the report joins it to the timeline. Voice is personal data: keep packages private and delete them when the pilot or a parent asks.

## C. Use the engine in your own project

The package is TypeScript source (`@shramko/sonic-fpv`, entry `src/index.ts`), consumed through a bundler such as Vite. The simulator adds it as a git submodule:

```bash
git submodule add https://github.com/AndriiShramko/shramko-fly-by-sound-fpv packages/sonic-fpv
```

Feed the engine a `SonicWorld` (rays and objects) and the drone pose each frame; see `src/contract.ts` and `demo/host.ts` for a complete host. Read [AGENTS.md](AGENTS.md) before changing code.

## D. Checks

```bash
pnpm typecheck && pnpm test && pnpm proof:audio
```

`pnpm proof:audio` needs Chrome or Edge installed (headless).

## Update

```bash
git pull && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
```

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Remove

Delete the folder. Nothing is installed globally, and the demo stores nothing in the browser.
