# Lane s13-lessons: lessons a pilot understands the first time (v0.13, owner's message 41)

Plan: ShramkoGSFPV `docs/wip/v13-plan.md` (items M41-n). Branch `s13-lessons`, worktree `C:/dev/sonic-s13-lessons`,
from `main` 7d4b4b9. No push. Every step one commit with this Status in it.

## Status

- [x] 1. Lane doc, facts of M41-8 and M41-9 reproduced in Node (`test/pass-rule.test.ts`, `test/lesson-schedule.test.ts`)
- [ ] 2. Pass rule: r counted attempts in total, the reason and the go-on offer after 3 failures in a row, lesson format 2
- [ ] 3. Progress line after every attempt and the progress view (I, the host's panel)
- [ ] 4. Navigation: next step, previous step, next lesson (skipped), previous lesson, repeat the task
- [ ] 5. Every named sound three times with no speech over it; validator rule and schedule check
- [ ] 6. Praise and stages (M41-11)
- [ ] 7. Direction: wrong way, wrong side (M41-15)
- [ ] 8. Respawn near the crash (M41-20, runner side)
- [ ] 9. Never silence between attempts (M41-10, runner side)
- [ ] 10. Strings in four languages, speech lint, all checks

## Ownership

Mine: `src/lesson/*`, the lesson files' `pass`, `intro`, `speech`, `checkpoints`, `lessons/paths.json` order, lesson
strings (`src/i18n/catalog.ts` and `locales/*`). Additions only in `src/contract.ts`. Not mine: world generators
(s13-worlds), `src/cues`, `src/sense`, `src/theme`, `src/audio`, the lesson files' `layers` (s13-sound).

## Facts (v0.12 as shipped, `main` 7d4b4b9)

### F1. Why hover-height needed about 12 attempts and hover-turn ran 15 without passing (M41-8)

The block rule, `src/lesson/runner.ts` 519-576 at 7d4b4b9: a block is `pass.attempts` attempts and passes with
`pass.required` successes (537-544); a block that can no longer reach `required` ends at once (544), and its counters go
back to zero (546-549). hover-height and hover-turn ship `attempts 5, required 4, blocks 1`: two failures in one block
throw away every success of that block. After a counted attempt the pilot hears only a chime (568), never how many
counted or how many are left; the next attempt says "Attempt n" (399).

- hover-turn, `test/pass-rule.test.ts`: the attempts start turned by `TURN_OFFSETS = [0, 180, 90, -135]` (116, 366-371),
  so the ring (83 degrees left of the start, -25 m, 3 m ahead) is at -83, +97, -173, +52 degrees. A pilot who turns to
  every sound in front of the ears and mistakes a sound behind for one in front (research 01: 10 to 50 % front/back
  reversals with a generic HRTF) gives `PFFPPFFPPFFPPFF`: 7 counted attempts in 15, and every block meets two failures in
  a row before its fourth success. He never passes, whatever he does right. The same pilot passes the new rule (r = 3 in
  total) at attempt 5.
- hover-height, `test/pass-rule.test.ts`: 200 seeded pilots who each hold the band in 6 of 10 attempts need 9 attempts
  at the median, 13.1 on average, 16 at the 75th and 27 at the 90th percentile. The rule alone, 20 000 seeded runs
  (Node, not committed): success share 0.7 gives mean 7.6 and 90th percentile 14; 0.6 gives mean 11.0, median 9, 75th 14;
  the 8 of 10 lessons (move-stop, rings-first, walls-hall) at 0.7 need 20 on average. With 3 counted in total: 0.7 gives
  mean 4.3 (90th 6), 0.6 gives 4.9 (90th 7).

### F2. "The voice says press 1, press 2, but there is no sound" (M41-9)

The cause is in the runner, not in the host. `src/lesson/runner.ts` at 7d4b4b9:

- A spoken step ends at the EARLIER of the host's report and the runner's own estimate: `c.spoken || age >= sayS(lines)`
  (327-328). The estimate is 0.7 s plus 65 ms per character per line (261-265): no speech rate, no gap between lines,
  no start delay of a network voice, and each step's estimate starts when the step starts while its speech starts only
  when the lines before it end, so the shortfall adds up over consecutive steps.
- The next cue or scene starts at once (304-310), whether the queue is empty or not; `spoken(t)` marks only a current
  `say` step (344) and is dropped while a cue, a scene or a question is current.
- While any line is queued or spoken the engine ducks every layer by 12 dB (`src/audio/engine.ts` 516-529 and 787-813:
  each line goes to `engine.say` when the host takes it, so `speakingCount` counts the queue; `src/cues/planner.ts`
  219-227). A sound that starts before the queue is empty is played under the voice.

Measured (`test/lesson-schedule.test.ts`, model host `src/lesson/schedule.ts`, voice lengths `test/fixtures/tts-en-david.json`
made by `test/fixtures/measure-tts.ps1` with the Windows voice Microsoft David at rate 1): 262 of 376 English lines take
longer than the estimate, 5.3 % in total. In ears-headphones the first sound (left) plays 34.94 to 37.94 s while the
last intro line ("Please switch off Windows Sonic...") runs to 37.45 s: 2.5 s of its 3 s under the voice, then "Where is
this sound? Press 1 for left, 2 for right". Every ears lesson has sounds that overlap speech with this voice; with a
voice 30 % slower than the estimate (speech rate 0.77) all 20 glossary sounds are more than half under speech; with a
voice 30 % faster none overlap. An answer given while the question is still read starts the next sound under the rest
of it (the 'early' answer of the model host).

Schedule of the five lessons in v0.12 (each sound one play, right after the line's estimated end):

| Lesson | Steps | Sound vs speech |
|---|---|---|
| ears-headphones | intro 4 lines; 3 check lines; per trial: preview `target.hum` from left, right, behind (3 s, wait 3.3 s), question | first preview 2.5 s under speech (measured voice); later trials clear only when the pilot answers after the question ends |
| ears-glossary | intro; per cue: name and description, preview (3 s), "Next sound" | 18 of 20 previews overlap speech, up to 2.0 s; 3 are more than half under it |
| ears-walls | intro; per wall: "Coming: wall. In front.", scene 5 s | every scene begins 0.1 to 0.7 s before its line ends |
| ears-shapes | intro; per shape: line, scene 5 s | the first scene 2.1 s under the intro, the others 0.2 s |
| ears-game | intro; per round: "Here comes the next sound", scene 4 s, what, where, moving | every one of 28 scenes starts under speech, 0.4 to 3.0 s of it |

(measured voice, answers 1 s after each question ends; `test/lesson-schedule.test.ts` and the model host reproduce it)

What the host does, read only in `C:/dev/gsfpv-v03/apps/fly/src/sonic/`: it feeds `runner.demoFrame(t)` to the engine
while a scene is on (`lessons.ts` 291-296), carries cue actions to `engine.cue` (`lessons.ts` 316-317), keeps the
lesson's layers on while frames run and silences them while the flight is paused (`bridge.ts` 262-314), and calls
`runner.spoken(t)` with a `speech.end` marker whenever its whole queue runs empty (`bridge.ts` 377-418, 443-451). That is
all a scene needs to sound; no host defect causes M41-9. The host's own lines (the recorder's notices, I, the coarse
walls line) go through the same queue, so the fix (wait for the report) also waits for them.

## Needs from the simulator

(filled as the API is fixed, steps 2 to 9)

## Needs from other lanes

(filled in steps 5, 7 and 9)
