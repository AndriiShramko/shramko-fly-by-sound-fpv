# Changelog

## Unreleased

- Lessons a pilot understands the first time (v0.13, the owner's flight of v0.12):
  - Lesson format 2 (`shramko-sonic-lesson/2`, breaking): `pass` is r counted attempts in total (1 to 3, failures in
    between do not reset) and, after `attempts` failures in a row (1 to 3), the reason and the offer of the next lesson
    (a lesson that does not block moves on by itself and is saved as skipped). Format 1 files are migrated on load.
    `intro` lines may name sounds (`cues`: cue ids, or `{ cue, from }` to play one from a side); checkpoints may end
    stages (`stage`). Every shipped lesson is version 2; recordings of version 1 are told apart by the replay.
  - Every sound a step names plays three times, a second apart, after the speech has ended (the runner waits for the
    host's `spoken(t)`): the "press 1, press 2, but no sound" of v0.12 is gone. Progress after every attempt ("Attempt
    k. Counted m of r."), praise, "Better than last time", stages, the next lesson named on a pass; the wrong way along
    a track or to the next gate, and a gate crossed from its back; a touch or a failed attempt in a corridor goes back
    to the last point passed, not to the far start; the target keeps sounding between attempts.
  - Runner API: `next`, `previous`, `repeat` (N, B, Z), `nextLesson`, `previousLesson`, `view()`, `statusLine()`; the
    action `{ kind: 'go', to }`; options `path`, `speechRate`, `keys`, `returnTo` (a lesson opened with G leads back);
    `lessonAfter`, `lessonBefore`. Contract additions: cue events `repeat-cue`, `praise`, `stage`, `wrong-way`,
    `wrong-side`; `IntroLine`, `IntroCue`, `Checkpoint.stage`, `LessonProgress.skipped`. Replay key actions `previous`,
    `repeat`, `next-lesson`, `previous-lesson`.
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
