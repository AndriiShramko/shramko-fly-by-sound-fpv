# Review of stage1-rc1

An independent review by an agent that did not write the code, against `docs/design/stage-1-spec.md` (with section 13), `src/contract.ts` and plan section 4.1. The tag `stage1-rc1` stood on `96d39fa`; the eight fixes follow it, and the tag was moved to the last commit of the review. `src/contract.ts` is unchanged.

## Method

- Baseline on the tagged source, tails of the logs read: `pnpm typecheck` clean, `pnpm test` 18 files and 560 tests, `pnpm proof:audio` 2 files and 5 tests (the five audio proofs, each with its failing control, and the keyboard-only demo check).
- Read: the audio maths (`cues/rules.ts`, `planner.ts`, `voices.ts`, `schedule.ts`, `shape.ts`), the scene sampler and listener frame, the engine (all but the second half of `synth.ts`), the output chain, the proofs, the lesson goals and runner, the whole session format, the report's analysis (`buildReport`, not its Markdown or command-line parts), `replay.ts` and `frames.ts`, `world/analytic-world.ts`, `parts.ts` and `sdf.ts`, the demo (`main.ts`, `host.ts`, `sim.ts`, `lab-model.ts`), the theme schema, validator and calm preset, the formatter and translator, the locales, the licences, and the loudness sheet.
- Not read in depth, so only exercised through their behaviour: `world/generators.ts`, `track/`, `prefs/`, `replay/compare.ts` and `rebuild.ts`, `lesson/validate.ts`, `survey/defs.ts`, `demo/lab.ts`, `tools/locale-lint.ts` and `check-layout.ts`. The report's numbers (path length, deviation, per-gate times) were not recomputed independently.
- Every suspicion was first tried to be refuted: by reading the code path, then by a probe that can fail (a minimal test, a fuzz, or an independent implementation). Only what failed in a test is listed as a defect, and each fix has that test, one commit per fix, nothing else touched.
- Final run on the fixed source: `pnpm typecheck` clean, `pnpm test` 19 files and 577 tests (17 new, all in `test/review.test.ts`), `pnpm proof:audio` 3 files and 9 tests (the old five and four checks in `test-audio/demo-language.proof.ts`). The evidence JSON files were not regenerated: a rerun differs only by dates and by 0.02 m and 1 degree in the demo's measured flight.

## Confirmed defects

| # | Defect | Test that failed before the fix | Commit |
|---|---|---|---|
| D1 | After "Leave the lesson" the demo went on sounding the lesson it had left. `DemoHost.leave()` kept the engine's layer set, and the engine re-plans the last frame for as long as no new one comes. In the real page the active cues 1.5 s after Leave were still `['height.rough']` (the engine's 25 ms wake-up repeats the last frame for as long as nothing replaces it). | `review D1` (fake engine); checked again in headless Chrome: now `[]` | `9d2b345` |
| D2 | N, an answer and R never cut the speech already queued: no `say` action ever carried `interrupt`, so "N: next step, which skips the speech" (the page's own words) was not true, "Go." waited behind the whole intro, and the feedback to an answer waited behind the options still being read. | `review D2` (4 tests) | `d5ac589` |
| D3 | The headphone check, first lesson of the fast path, needed 3 of 3 right including "in front or behind". Research 01 puts front/back errors at 10 to 50 % for generic HRTFs (27 % reversals measured) and Chrome's built-in one is generic, so honest pilots would loop on it and be told "I could not tell left from right, check the plug". Only left and right are graded now; the question is still asked and its answer still recorded. | `review D3` (3 tests) | `567f1d3` |
| D4 | The report said `passed, success: true` for an optional lesson in which every attempt failed, because the runner ends a non-blocking lesson with a `passed` event whatever the score. A `passed` event now counts only after a `block-pass`. | `review D4` (2 tests) | `84b0777` |
| D5 | `hover-turn`: the ring is 83 degrees to the left, and the start turned -90 faced it (6.8 degrees off, inside the 12 degree tolerance), so attempt 4 of every cycle was met after 0.6 s with the sticks untouched. The offset is -135 now. | `review D5`: a pilot who touches nothing passes no attempt of any flying lesson in 20 minutes, and the sound starts at least 45 degrees off the nose in every attempt | `b8508f0` |
| D6 | `applyCalm` could invert an ordered pair of a valid custom theme: pulse periods 299 and 300 ms became 418.6 and 390 ms (the pulse slows as a wall comes nearer), ticks 5 and 6 Hz became 5 and 4.2 Hz. A pair that the preset would turn round is left as the theme has it. The shipped themes were never affected. | `review D6` (5 tight pairs, and the preset still calms the shipped themes) | `edc3c0c` |
| D7 | Demo: the captions, the lesson buttons and the lesson title in Polish, Russian or Spanish carried no `lang`, so a screen reader reads them with the English voice, which the "my screen reader speaks" switch is there to avoid. | `test-audio/demo-language.proof.ts`: real page, pl, ru and es, with a control that must fail | `c0d62e7` |
| D8 | The manifest validator, the gate the writer passes before recording, accepted `send` or `speechRecognition` for a minor whose guardian was not confirmed, against spec section 10 and the consent template. Now refused with the path `consent.guardianConfirmed`; local recording of a minor stays valid. | `review D8` (3 tests, incl. the writer refusing to start) | `412723a` |

## Suspicions refuted

- **Direction and signs.** `headingBasis`, `bodyBasis`, `worldToListener`, `SECTOR_AXES`, `pannerDirection`, the ILD side and the channel mapping were checked by hand, and `yawQuat`, the heading basis and `attitudeFromQuat` against the simulator's own `reset()` and `attitude()` in `sim-core` (nose along -z at yaw 0, a right turn is positive, the same atan2 formulas). Left is -x, right +x, up +y, front -z everywhere; Doppler is positive when closing; "up is higher" follows the polarity.
- **Pulse rate and time to collision.** The period is monotonic in time to collision and in distance, and it is the smaller of the two urgencies. This is documented in `rules.ts`; the proof measures 0.02 to 0.1 % error. Not a defect (see the observations).
- **Limiter.** One path reaches the destination (master, compressor, soft clipper with `oversample = 'none'`, a fade of gain at most 1); theme ceilings are validated to -24 to -6 dBFS. Fuzz in headless Chrome: 120 random scenes, 17 880 frames, 433 cues, per-layer gains up to +12 dB, pitch shifts of 12 steps, master at 0 dB: no exception, no non-finite sample, the worst peak 0.008 dB under the ceiling.
- **Voice count.** `VoiceAllocator` holds a fixed array, the sampler slices to at most 3 hazards and throws above 3, 8 + 24 panners are all the engine makes; the proof and its control agree.
- **Timers against the audio clock.** The only `setInterval` is the engine's own 25 ms wake-up, which asks which pulses fall before now + 100 ms and places them at exact audio times; `setTimeout` is used only for speech-length estimates.
- **Session format.** 240 random seeds: write, pack and read back is exact (unicode and emoji events, any chunk size and flush order, voice, survey, sim log); a crash with a torn tail recovers every whole chunk and nothing more. `finish()` queues the open chunk before it closes.
- **Zip and CRC.** A zip written by `ZipWriter` (sizes 0 to 300 001, unicode names, entries from several parts) passes Python's `zipfile.testzip()` and `unzip -t`; Python's zips read back (the committed fixtures). `sha256`, `crc32`, `inflateRaw`, `gunzipMembers` (levels 0, 1, 6 and 9, several members) and the UTF-8 codec equal Node's own for thousands of inputs.
- **Rays.** About 12 000 rays in ten worlds aimed through ring tubes and square and cube bars, against a brute-force march: no miss, no wrong distance, no normal facing away from the ray or off the SDF gradient (the five odd cases were sub-millimetre grazes the 1 cm march stepped over).
- **Planner robustness.** 6 000 degenerate frames (craft at an object's centre, inside walls, zero speed, both listener frames, calm on and off): no non-finite number, every direction a unit vector, every period positive.
- **Lessons that cannot be passed or are too easy.** A do-nothing pilot passes no blocking lesson (after D5, no attempt either). An ideal pilot flying through every gate centre passes all seven gate lessons; the corridor has about 335 m of centreline for its 240 m goal.
- **Locales.** 407 keys in four languages with the same placeholders, plural structure and order; the numbered options in the quiz texts match the digits the runner expects.
- **Secrets and personal data.** None: no e-mail, phone number, address, IP or key in any tracked file. The README credits a second person by name as co-developer (a credit, not contact data); the owner should confirm that he agreed to be named.
- **Dependencies.** No runtime dependency and no third-party import in `src/` or `demo/`. The 40 installed packages are development tools: MIT mostly, Apache-2.0 (five: TypeScript, Playwright, Playwright's core, `detect-libc`, `expect-type`), BSD-3-Clause, ISC and MPL-2.0 (`lightningcss`, a part of Vite). None is imported by `src/` or `demo/`, so none is in the demo bundle.
- **Loudness sheet.** The hours-per-week table and the 109 dB SPL figure recompute correctly.

## Left as it is (design, to decide)

- **Free attempts.** Lessons with only hold-height, approach-stop or around goals keep the craft where it is, so after one success the next attempts of `walls-hall` need a 2 m shuffle at the wall and a stop, and those of `hover-height` need nothing under altitude hold. By design in Status; a lead decision whether to send the craft back for `approach-stop`.
- **Proxy goals.** `corridor` (240 m of path) and `walls-row` (22 m of path) can be met by shuttling in an open stretch; `turn-to` by a slow constant spin (the window is 24 degrees for 0.6 s, so up to 40 degrees per second). Stand-ins already listed in Status.
- **Optional lessons.** After a failed block the runner still plays the fanfare and the pass line ("You finished the Winter Garden.") and saves `passed: true`. The report is honest now (D4); the runner's behaviour follows "never blocks".
- **`quiz.wrong`** says "Let's listen again." after a wrong place or movement answer, where the scene is not played again.
- **Ducking.** Speech ducks the safety layer by 12 dB unless a hazard is urgent (under 1.5 s or 1 m), while principle 4 says safety is never masked. A reading of the spec, flagged for ears.
- **`FlyBySoundEngine.start()`** called on a suspended engine sets a second pump timer and listeners (the contract has `resume()` for that). Not tested: it needs Web Audio.
- **Sound Lab** labels put a translated cue name inside an English sentence.
- **`Replayer.seek(i)`** returns `null` when `i` is the frame it already stands on.
- **Ears game** at 90 % of 8 questions means 8 of 8.

## What the lanes must know

- Hosts must hand `RunnerAction.say.interrupt` to `SpeechOut.speak({ interrupt })` (the demo already does). The first line said after N, after an answer and after R (flying lessons) interrupts; the other lines of a step queue as before (D2).
- A host that stops sending frames must silence the engine with `setLayers({ on: [], heightBandM: null, hazardVoices: 3 })`: the engine plans on from the last frame by design, for menus (D1).
- `ears-headphones` grades left and right only; front and behind is an `answer` event with the id ending `:front-back` (D3).
- The report reads success as "a `passed` event right after a `block-pass`" (D4). A package recorded before D5 replays differently from the fourth attempt of `hover-turn`; none exists outside the tests.
- `SessionWriter.start` throws for `minor: true`, `guardianConfirmed: false` with `send` or `speechRecognition` true (D8). The consent screen must still ask. The consent template says that without a guardian "nothing is recorded or sent"; the format enforces only the sending half, as the spec does.

## Not verifiable without human ears and devices

How any of it sounds: whether the cues are legible, the pentatonic harmony is pleasant, the roughness reads as "off course", the thresholds (distances, times to collision, pass rules) are right, front and back and height by pitch work for real heads, and ducking under speech (speech is outside the audio graph). Real loudness at the ear (needs the coupler procedure in `docs/testing`), Bluetooth delay, the voices each system has for Polish and Russian, a screen reader driving the demo (NVDA, JAWS, VoiceOver: whether its browse mode lets W, A, S, D and the digits through), radio and gamepad input, and whether a child or a blind pilot can learn the ladder. The audio proofs show that the engine renders what the maths says; they cannot show that it is good.
