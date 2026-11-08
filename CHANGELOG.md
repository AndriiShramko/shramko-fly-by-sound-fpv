# Changelog

## Unreleased

- Live in the simulator: ShramkoGSFPV v0.12 (2026-11-08) ships this engine as its submodule at 1eea4d5; the mode starts at https://gsfpv.flyreelstudio.eu/en/sound/ (es, pl, ru too). Ordinary pages of the simulator load none of it.
- Spoken lines asked for by the simulator's recorder: `survey.howto` no longer tells the pilot to say the number (that works only with speech recognition on, now `survey.howto-voice`); new `survey.mic-on` (the microphone stays on during the questions), `send.none` (nothing to send) and `send.cancelled` (not sent, the flight stays on the device). English, Spanish, Polish and Russian.

## 0.1.0-rc1 — 2026-11-07 (tag `stage1-rc1`)

First release candidate of stage 1, not yet built into the live simulator.

- Audio engine: object-based HRTF voices (8 moving, 24 static), pentatonic cues, rhythm on the audio clock, redundant distance code, limiter at -6 dBFS, 1 s fade-in, speech with captions and ducking.
- Cue planner, scene sampler and analytic lesson worlds without a browser, so a replay can re-derive cues.
- 21 lessons in modules 0 to 7 (ears, hover, move and stop, walls, corridor, rings, shapes, free flight) and a fast path of 7; the lesson runner.
- Themes `soft`, `clear`, `race` and a calm preset; strings in English, Spanish, Polish and Russian.
- Session package (`.zip`), replay core and report tool (`pnpm report`).
- Stand-alone demo and Sound Lab (`pnpm demo`), keyboard only.
- Test protocol, consent template and school loudness sheet in `docs/testing` (not legal advice).
- Audio proofs in headless Chrome with negative controls; 577 Node tests.
- Independent review: eight defects found and fixed, see `docs/dev/review-stage-1.md`.
