# Lane s13-lessons: lessons a pilot understands the first time (v0.13, owner's message 41)

Plan: ShramkoGSFPV `docs/wip/v13-plan.md` (items M41-n). Branch `s13-lessons`, worktree `C:/dev/sonic-s13-lessons`,
from `main` 7d4b4b9. No push. Every step one commit with this Status in it.

## Status

- [x] 1. Lane doc, facts of M41-8 and M41-9 reproduced in Node (`test/pass-rule.test.ts`, `test/lesson-schedule.test.ts`)
- [x] 2. Pass rule: r counted attempts in total, the reason and the go-on offer after 3 failures in a row, lesson format 2
- [x] 3. Progress line after every attempt and the progress view (I, the host's panel)
- [x] 4. Navigation: next step, previous step, next lesson (skipped), previous lesson, repeat the task
- [x] 5. Every named sound three times with no speech over it; validator rule and schedule check
- [x] 6. Praise and stages (M41-11)
- [x] 7. Direction: wrong way, wrong side (M41-15)
- [x] 8. Respawn near the crash (M41-20, runner side)
- [x] 9. Never silence between attempts (M41-10, runner side)
- [x] 10. Strings in four languages, speech lint, all checks

Review fixes (`docs/wip/s13-lessons-review.md`, one commit per fix or small group):

- [x] R1 wrong way in a course: judged against the gate that counts next, not the track
- [x] R2 shared cue events: payloads that take lane s13-sound's, the play length checked against the planner
- [x] R3 G's way back: 'go next' is the host's advance(), a lesson opened by G is not marked skipped
- [ ] R4 the simulator's tests the gitlink move breaks, listed
- [ ] R5 the corridor ends at its end: a goal 'track-end'
- [x] R6 a stage said once: from the world's list when it marks stages, else from the lesson's checkpoints
- [x] R7 a lesson that moves on by itself is saved skipped, not passed
- [ ] R8 pause: the host contract
- [x] R9 the corridor's retry line and where the next attempt starts
- [x] R10 the schedule's repeat rule pinned to 3 plays
- [x] R11 an intro cue from the side its line names
- [x] R12 wording of the new lines in ru, pl, en
- [ ] R13 v0.12 recordings played back
- [x] R14 public docs
- [x] R15 test machinery marked internal
- [ ] Checks after the fixes, final status

## Final status (2026-11-08)

Done, one commit per step (branch `s13-lessons`, not pushed): step 1 7f83292, 2 318a8c5, 3 91c6dd5, 4 eee530b, 5 4b276e8,
6 8a67aac, 7 3041e63, 8 1ec02b4, 9 6798f1e, 10 fc389e3 and the last commit (this Status, the replay building the runner
with the manifest's path and speech rate, the proofs' evidence files).

Checks, all passing on the last commit: `pnpm typecheck`; `pnpm test` (27 files, 631 tests); `GPU_LOCK=C:/dev/.gpu-lock
pnpm proof:audio` (headless Chrome 156, 3 files, 9 proofs: the engine proofs with their broken controls, the demo by
keyboard alone, the demo's language marks; 49 s); `node tools/run-tool.mjs locale-lint` (0 problems, 4 languages, 452
keys); `node tools/run-tool.mjs check-layout` (0 problems).

Left open, with the reason:

1. How it sounds and feels: the three plays, the praise, the stage and the wrong-way cues are placeholders in
   `src/cues/planner.ts` until lane s13-sound designs them; no person has heard them. The schedule check proves timing
   against five speech models, not that a person notices a sound.
2. Real voice lengths were measured for English only (Windows voice Microsoft David; this machine has no Russian, Polish
   or Spanish voice). The other languages are covered by the slow and very slow models (1.4 x and 2 x the estimate, with
   0.3 s and 0.6 s to start each line), which pass.
3. The owner's own flights were not recorded, so the hover-turn failure is reproduced by a model pilot (front/back
   reversal) that gives exactly "15 attempts without a pass" under the v0.12 rule; other causes cannot be ruled out.
4. The corridor is passed at 240 m flown, during its fourth section (goals are not in my ownership): its last section and
   stage 4 are never flown in a passing attempt. For the lead or s13-worlds: end it at its last checkpoint, or 335 m.
5. Respawn points are as dense as the checkpoints: 30 to 75 m apart in the corridor until lane s13-worlds gives the
   world's checkpoint list (the runner already reads it).
6. Recordings made with v0.12 (lesson version 1) do not verify: the rules changed. The replay says so ("lesson X is
   version 2 here, the session was flown with 1", `test/replay.test.ts`).
7. move-speed still goes silent at rest and between attempts (its layers: speed and voice): the planner's bed (s13-sound).
8. Outside my ownership, changed because the API needed it and nobody else owns them: `src/replay/replay.ts` (the new key
   actions, the runner built with the manifest's path and speech rate), `tools/locale-lint.ts` and
   `tools/check-layout.ts` (a `main()` each), `demo/*` (B, Z, the 'go' action), and two placeholder blocks in
   `src/cues/planner.ts` (the new cue kinds compile and sound like existing ones).

## The API the host needs (summary)

From `@shramko/sonic-fpv` (all in `src/lesson/*` unless said):

- `createLessonRunner(lesson, options)`: new options `path: 'full' | 'fast'` (the pilot's path: lesson index, the next
  lesson a pass names), `speechRate: number` (prefs.speechRate: how long a host that never reports speech is waited for),
  `keys: { next, previous, repeat }` (the key names lines say; default N, B, Z).
- `LessonSession` (beside begin, step, takeActions, spoken, answer, reset, demoFrame, target, progress):
  `next(t)` N, `previous(t)` B, `repeat(t)` Z, `nextLesson(t)` and `previousLesson(t)` (the lesson menu), `view():
  LessonView`, `statusLine(): SpeechLine` (I). Each returns the events like the other calls.
- `RunnerAction`: new `{ kind: 'go', to: 'next' | 'previous' }` (open `lessonAfter(id, path)` / `lessonBefore(id, path)`, the
  start screen when null); `scene` actions carry `play: { index, of }`.
- `LessonView`: lessonId, title, lessonIndex, lessonCount, path, step, steps, stepKind ('task' | 'fly' | 'intro' | 'sound'
  | 'scene' | 'trial' | 'round'), goal, goals, attempt, counted, required, failsInARow, offered, touches, maxTouches, phase,
  passed, skipped, listening, playing ({ cue, index, of } or null). `statusLine(view, title)` is the pure form.
- Contract (`src/contract.ts`, additions only): `CueEvent` kinds `repeat-cue` { cue, dir?, index?, of?, durS? }, `praise`,
  `stage` { stage? }, `wrong-way` { dir? }, `wrong-side` { dir? } (the host passes them to `engine.cue` as any cue action;
  every field either lane gives them, review R2);
  `LessonProgress.skipped?`; `IntroLine` (`intro` items may carry `cues`: cue ids or `IntroCue` { cue, from }, review
  R11); `Checkpoint.stage?`; `FORMATS.lesson` is
  'shramko-sonic-lesson/2' (format 1 files are migrated on load); `PassRule` fields keep their names with format 2 meaning.
- Events: the runner writes a lesson event `leave` when the pilot leaves for another lesson.
- Replay: `REPLAY_KEY_ACTIONS` adds `previous`, `repeat`, `next-lesson`, `previous-lesson`; the host records each key event
  with its action before the runner's call, as it does for N and R.
- Timing contract: the runner now waits for `spoken(t)` (the host's whole speech queue empty) before a sound or the next
  step; the simulator's bridge already reports it.

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

## Done

### Step 2: the pass rule (M41-8)

- Lesson format 2 (`FORMATS.lesson`, `src/lesson/validate.ts`): `pass` is `{ required, attempts, maxTouches, blocking }`.
  `required` (1 to 3) counted attempts in total pass the lesson, failures in between do not reset; `attempts` (1 to 3)
  failures in a row bring the reason and, in a blocking lesson, "Press N to go on to the next lesson" (again after
  every further `attempts` in a row), while a lesson that does not block moves on by itself ("Let's go on to the next
  lesson"). Format 1 files are read and migrated: required = min(3, required x blocks), attempts = 3 (blocking) or
  min(3, attempts x blocks). `LessonDef.pass.blocks` stays in the type, always 1.
- Every shipped lesson is format 2 and version 2. hover-*, move-*, walls-*, rings-first/line/small: 3 counted;
  corridor and rings-course 1 (corridor: touches no longer fail it, a touch sends the craft back to the last checkpoint);
  shapes-*: 2 (do not block); ears-headphones 1; ears-game 1 (moves on after 2 failed games).
- Each goal says why it was not met (`GoalTracker.reason()`): above or below the band and for what share of the time,
  the sound still left or right or behind, past or short of the zone, stopped too far, part of the circle, metres flown,
  the gate missed, touches, the time. Spoken before the offer.
- Tests (`test/pass-rule.test.ts`, truth bot `test/helpers/truth.ts`): the truth bot passes every shipped flying lesson
  in exactly r attempts with no touch; a pilot who fails every other attempt passes each in at most 2 x r; an idle pilot
  never runs more than 3 failed attempts in a row without the reason and the offer, in every shipped lesson; the
  front/back pilot passes hover-turn at attempt 5; 200 coin pilots (6 in 10) pass hover-height in 5 at the median.
  Controls (the v0.12 block rule with the v0.12 numbers, `test/fixtures/v012-pass-rules.json`): the front/back pilot
  never passes in 15, the every-other pilot never passes hover-turn, an idle pilot gets no offer, the coin pilots need 9
  at the median. Migration: `test/lessons.test.ts`.
- Replays: a v0.12 recording (lesson version 1) replayed now is reported "lesson X is version 2 here, the session was
  flown with 1" (`test/replay.test.ts`); it does not verify, by design: the rules changed.

### Step 3: progress always known (M41-7)

- After every attempt that does not pass the lesson: "Attempt k. Counted m of r." (`fly.progress`); after the one that
  passes, the pass line instead. Every attempt now starts with "Go." (the count line said its number).
- The runner's script is a list of steps (`Block`s): a flying lesson has 2 (the task: title and intro lines; flying: the
  attempts), a lesson without a world has its intro and one step per glossary sound, narrated scene, headphone trial or
  game round (glossary 21, walls 6, shapes 4, headphones 4, game 9). Answers of module 0 are kept per question id, so a
  step heard again replaces its answers.
- `LessonSession.view(): LessonView` and `statusLine()` (exported pure `statusLine(view, title)`): lesson index on the
  pilot's path (`RunnerOptions.path`, the full ladder when the lesson is not on it), step k of N and its kind, goal k of N,
  attempt, counted m of r, failures in a row, whether the go-on offer was made, touches and the limit, phase, passed.
  Spoken: `status.progress` "Lesson 6 of 21: Hold your height. Step 2 of 2. Attempt 4. Counted 2 of 3." or, before an
  attempt and in module 0, `status.progress-step`. Tests: `test/progress.test.ts` (control: the v0.12 rule says no count).

### Step 4: N, B, Z and the lesson menu (M41-6, package side of M41-3)

- Steps (documented in the runner's header): a flying lesson has 1 the task (title, intro lines) and 2 flying (the
  attempts, the pause between them, the pass); a lesson of module 0 has 1 its intro, then one step per glossary sound,
  narrated scene, headphone trial ("Sound 2 of 3." begins each, `headphones.trial`) or game round. Every step begins with a
  line, so a key that moves to it cuts the speech going on (the first line interrupts).
- `next(t)` N: one step on; from the last step (flying, the pause, the pass, the last sound) the next lesson.
  `previous(t)` B: one step back; from step 1 the previous lesson; while flying (or in the pause, or after the pass) back
  to the task, the attempt dropped and not counted, the next attempt from the lesson's start. `repeat(t)` Z: the step
  again from its first line; while flying the task is said again and the attempt waits (its goals and its time limit
  stop: `pausedMs`), then "Go on." (`fly.go-on`); in the pause the task, then the next attempt; after the pass the pass
  line. `nextLesson(t)` and `previousLesson(t)` (the Escape menu): at once. Leaving gives the action
  `{ kind: 'go', to: 'next' | 'previous' }` and the lesson event `leave`; leaving forward without a pass marks the
  progress `skipped: true` (new optional field of `LessonProgress`); the runner is inert afterwards. A question left by a
  key is recorded as skipped (answer null, via 'skip'), as a timeout is.
- `lessonAfter(id, path)` and `lessonBefore(id, path)` (library): where a 'go' leads, the full ladder when the lesson is
  not on the pilot's path, null at either end.
- Replay: `REPLAY_KEY_ACTIONS` gains `previous`, `repeat`, `next-lesson`, `previous-lesson` (src/replay/replay.ts, the only
  change there: four inputs mapped to the runner's calls). The demo host and page take B and Z and open the lesson a 'go'
  names. Tests: `test/navigation.test.ts` (every move, N and B exactly one step, a glossary flown with N, B, Z and the menu
  replays to the same events; control: without the key events it does not), `test/demo.test.ts`.

### Step 5: every named sound three times, no speech over it (M41-5, M41-9)

- The runner now waits for the host's report: a spoken step is over when `spoken(t)` says the queue ran empty (a host
  that never reports is waited for at most twice the estimate and a second per line, scaled by `RunnerOptions.speechRate`).
  A sound waits for that silence, then plays 3 times, 1 s apart, and the step goes on 1 s after the last play
  (`src/lesson/sounds.ts`: `REPEAT_PLAYS`, `REPEAT_GAP_S`, 2.5 s a play; a one-off sound its own length, review R2). A question's 20 s to
  answer run from the end of its lines.
- Sounds a step names: intro lines name their sounds in a new field `cues` (lesson format 2; `IntroLine` in the contract)
  and each plays three times after its line (hover-height: the height tone, then the buzzing tone; walls-hall: wall,
  floor, ceiling, touch; 14 flying lessons name sounds); the glossary plays each cue three times; the headphone trial its
  hum from the side three times before the question; the narrated scenes and the game's scenes run three times (4 s and
  3.5 s each; the game's replay after a wrong answer once).
- Each play is a cue event `{ kind: 'repeat-cue', cue, dir, index, of, durS }` (contract, the kind the plan fixes); a scene
  play is the scene action with `play: { index, of }`; `view().playing` says which sound plays now, for the host's panel.
  `src/cues/planner.ts` got a two-line placeholder (a repeat-cue sounds as the cue's preview for `durS`) so the package
  compiles; lane s13-sound owns how it sounds.
- The check (`checkSchedule` in `src/lesson/schedule.ts`): no sound under speech (more than 50 ms), every question has an
  audible sound of its step before its lines, every named sound plays three times in its step, every scene can be heard
  with the lesson's layers. The validator (`src/lesson/validate.ts`) refuses a module-0 lesson whose layers cannot sound
  one of its scenes (for example ears-shapes without the shape layer, ears-walls with no hazard voice).
- Tests (`test/lesson-schedule.test.ts`): every shipped lesson (ears lessons whole, the task of each flying lesson) with 5
  voices (0.6 x the estimate, the estimate, the measured Windows voice, 1.4 x with 0.3 s to start each line, 2 x with
  0.6 s) and answers early or late: no issue. The planner sounds the scene's cue in at least 90 % of every scene's frames.
  Controls: the v0.12 timing (`testHooks.speechWait: 'v012'`) with the measured voice puts sounds under speech in the
  headphone check, the glossary and the game, and with a slower voice the first question of the check comes with no
  sound heard; with a fast voice v0.12 overlaps nothing but plays each sound once (the defect needs speech slower than
  the estimate); a scene with its layer off sounds in 0 % of its frames and the loader refuses the lesson.
- Length now (measured voice, right answers): headphones 1.8 min (v0.12: 1.4), glossary 6.5 (4.2), walls 1.9 (0.9),
  shapes 1.3 (0.7), game 6.9 (5.4); a flying lesson's task 0.2 to 1.1 min. N skips a step at any time.

### Step 6: praise and stages (M41-11)

- A counted attempt that does not yet pass the lesson: the cue event `{ kind: 'praise' }` and a short line from a pool of
  8 (`praise.1` .. `praise.8`, at most 16 characters, never the same twice in a row), or "Better than last time!"
  (`praise.better`) when the attempt's score improved by at least 5 % on the last counted one of the sitting: the share
  in the height band, the mean miss of the gates' centres, the distance of the stop, else the attempt's time on the
  goals' clock. A timed course says its time instead. Then "Attempt k. Counted m of r.".
- The pass: the fanfare, the lesson's own pass line, then "Lesson passed. Next, a bit harder: <title>" with the next lesson
  on the pilot's path (`fly.lesson-passed`, `RunnerOptions.path`), or "That was the last lesson." (`fly.last-lesson`).
- Stages: a lesson checkpoint may carry `stage: k` (format 2; stages count up along the list, validated). Crossing it
  gives the cue event `{ kind: 'stage', index: k }` and "Stage k passed." (`fly.stage`) in place of the checkpoint chime.
  The corridor's cp-2 to cp-5 end stages 1 to 4. A world's checkpoint list may carry stages too (step 7).
- Placeholders in `src/cues/planner.ts` (two cases): praise sounds as the checkpoint chime, stage as the lap chime.
- Tests (`test/praise.test.ts`): pool lines distinct and short in four languages, two praises in a row differ; "better"
  after 85 % then 100 % in the band and after a faster turn (controls: the same score, a worse one: no "better"); the pass
  lines with the next lesson on the full and the fast path, the last lesson; the corridor flown to its end says stages
  1 to 4 (control: the same corridor without stages says none and chimes).
- Found: the shipped corridor is passed at 240 m flown (its second fly-distance goal), during its fourth section, so its
  last section (bends with pillars) and stage 4 are never flown in a passing attempt. The goals are not in my ownership
  table; for the lead or lane s13-worlds: end the corridor at its last checkpoint (or raise the goal to its length, 335 m).

### Step 7: which way is forward (M41-15, detection and lines)

- `src/lesson/track.ts`: a lesson's track from the first source that exists: the world's own checkpoint list
  (`checkpoints: { pos, dir, stage? }[]` on the analytic world, feature-detected for lane s13-worlds; a malformed list is
  ignored), the lesson's checkpoints (at least two, each pointing at the next), or a course's gates (the start, then each
  gate along its axis). `dirAt(p)` is the way the track goes near p (null further than 15 m from it).
- Flying against the track faster than 0.5 m/s for more than 1 s: the cue event `{ kind: 'wrong-way', dir }` (dir: the
  way the track goes, listener frame) and "You are flying back. Turn around." (`fly.wrong-way`), at most once every 5 s.
- Review R1: while the goal is a course of gates, forward is the way to the gate that counts next, judged only in front
  of it and further than `LINE_UP_M` (8 m); behind it, beside it or close in front of it the pilot may be flying round
  to its front. The probe of the review is a test: ring 2 passed 6 m beside it, 11 m back at 3 m/s, then through it
  from the front, in rings-line, rings-small and rings-course: never told, ring 2 counts (it was told once in each with
  the track rule). Controls: the same way back along the corridor is told; flying back from the next gate toward the
  start is told, the cue toward that gate.
- A gate that counts next crossed through its opening from its back side: `{ kind: 'wrong-side', dir }` (dir: where the
  gate is) and "That gate was passed from the wrong side. Go back and fly it from the front." (`fly.wrong-side`), at most
  every 3 s; not counted (a forward crossing still counts). `gateCrossingBack` in goals.ts, a `wrongSide` callback in the
  tracker's context.
- Placeholders in `src/cues/planner.ts`: both sound as the re-centre sweep.
- Tests (`test/direction.test.ts`): flying back 7 s in the corridor is told twice, with the track's way behind the pilot;
  flying forward, a slow drift back (0.3 m/s), a short move back (0.6 s) and a hall with no track are never told
  (controls); a world list reversed makes forward the wrong way (the world's list wins); a ring crossed backward is told
  and not counted, then counted forward; a whole course flown forward is never told.

### Step 8: respawn near the crash (M41-20, runner side)

- A touch in a lesson that re-centres (`bump-recentre`, the corridor) or a short R puts the craft 1 m before the furthest
  point of the track passed in the attempt (`RESPAWN_BEFORE_M`), facing along the track: a lesson checkpoint's own pose
  yaw and height, or a world point's `dir`. With the world's checkpoint list (lane s13-worlds) its points are the respawn
  points (passed by crossing their plane forward within 4 m) and the lesson's checkpoints no longer move it; without it,
  the lesson's checkpoints. A respawn point inside a wall falls back to the checkpoint itself. With nothing passed yet a
  short R goes to the attempt's start; a long R always to the start (the same attempt again, as before).
- The attempt's flown path goes back to what it was at that point, so the corridor's fly-distance goals are not met by
  flying one stretch twice.
- A checkpoint is reached when the craft's segment between two frames comes within its radius (a fast craft no longer
  skips it). The corridor's cp-3 and cp-5 now face +X (yaw 90), the way the bends that begin there go: the old yaw 0
  faced the wall 2.5 m ahead.
- Tests (`test/respawn.test.ts`): after cp-3 a touch places the craft at (-1, 2, -80) facing the bends (more than 15 m
  free ahead; the old pose had less than 3 m), a short R the same, a long R the start; the 50 m goal is met where it is
  met without a touch; with a world list, back to 1 m before its last point passed; a lesson without checkpoints goes
  back to its start.
- The density of respawn points is the worlds lane's: the corridor's own checkpoints are 30 to 75 m apart.

### Step 9: never silence, the runner's part (M41-10)

- Between attempts `target()` gives the next attempt's first target (the sound to turn to, the zone, the first gate, the
  pillar), so the target layer goes on while the attempt's lines are said and the pause runs (v0.12 gave null outside an
  attempt). Every step that waits begins with a line (step 4), and every attempt that ends says so (steps 2, 3, 6).
- Measured (`test/silence.test.ts`, the cue planner with each lesson's own layers, the truth bot): every frame of the pause
  between attempts sounds in the 9 flying lessons whose attempts begin with a target (control: without the target, as in
  v0.12, more than 60 % of the pause of hover-turn and move-stop is silent; the rest is the praise chime).
- Still silent with the shipped layers (probe, not committed; for lane s13-sound): move-speed (layers speed and voice) is
  silent in 68 % of its pause between attempts and in 11 % of its flying frames (the ticks stop at rest); the task step
  of hover-turn, move-speed, move-stop, rings-line and rings-course is silent between its lines and plays where no layer
  sounds (the planner hears no frame there; speech covers part of it in a real host).

### Review R2: the shared cue events, one payload per kind

- Contract: each of the five kinds takes every field either lane gives it, so the code of both compiles against one
  variant: `repeat-cue { cue, dir?, index?, of?, durS? }`, `stage { stage? }` (the field named as lane s13-sound named
  it; it was `index` here), `wrong-way { dir? }`, `wrong-side { dir? }`, `praise {}`. The runner sets them all.
- The play length: the runner gives each play a slot (`durS`) and sends the next play `REPEAT_GAP_S` after it; the
  planner sounds a continuous cue for `durS` (this lane's placeholder does; lane s13-sound's plays `REPEAT_CUE_S` = 0.9 s
  whatever `durS` says). A one-off cue's slot is now its own length (`ONE_OFF_PLAY_S` per cue: touch 0.2 s, reset 0.4,
  gate note 0.4, lap 1.1, checkpoint 0.5, fanfare 1.2), measured from the planner's notes in all three built-in themes;
  one slot of 1.2 s for all left a ping 2.1 s of silence between plays.
- Check (`test/repeat-plays.test.ts`): every `repeat-cue` the runner sends in every shipped lesson (the ears lessons'
  first attempt, a flying lesson's task) is fed to the real `CuePlanner` at its time, in each built-in theme, and read
  frame by frame (a continuous cue's preview, a one-off cue's notes): each play sounds from its first frame, a continuous
  one in at least 90 % of its slot, none after its slot, and the next play of the same sound follows after at most 1.2 s
  of silence (a one-off: 2 s). Control: the same events given to the planner as 0.9 s plays (lane s13-sound's planner as
  it stands) fail it: 30 or more plays sound in 36 % of their slot, 2.6 s of silence between plays; the per-cue table's
  predecessor (one 1.2 s slot) failed it with the ping. What it cannot show: how a play sounds at the ear.

### Review R3: the way back of a lesson opened with G

- `RunnerOptions.returnTo` (the lesson G left): the lesson is a detour. Leaving it forward (N from its last step, the
  menu's next lesson) does not mark it skipped (it was heard; the ladder's state of the glossary stays as it was), and
  its pass says "Lesson passed. Back to the lesson: <title>" (`fly.back-to`, four languages) instead of the next lesson on
  the path, which the host would not open. The 'go' action is specified as the host's `advance()` (next) and the way
  back, else `lessonBefore` (previous): "Needs from the simulator" item 2. B on a detour goes back too, not to the
  lesson before the glossary on the ladder: the pilot came from the lesson he left, and B means back.
- Tests (`test/navigation.test.ts`): N through the glossary with `returnTo` leaves it neither passed nor skipped, heard
  to its end its pass says the way back with the left lesson's title; controls: the same glossary on the ladder is
  marked skipped, and its pass names the next lesson on the path (ears-walls). Each rule broken on its own fails its test.

### Review R6 and R7

- R6: a course's stages come from one source, the world's checkpoint list when it marks any, else the lesson's
  checkpoints; a lesson checkpoint whose stage the world's list replaces only chimes. The review's fix ("skip a lesson
  checkpoint's stage when the track comes from the world") would lose every stage of the corridor after the merge: lane
  s13-worlds' list for the corridor (world version 1) marks none, only its tunnels of version 2 do. Test
  (`test/praise.test.ts`): a world list that ends stage 1 at -30 m says it there and not again at cp-2 (-50 m); control:
  a list with no stages leaves stage 1 to cp-2. The old rule fails the test.
- R7: a lesson that does not block and moves on after its failures in a row keeps the phase 'passed' (the host goes on)
  but is saved `passed: false, skipped: true` (unless it was passed before), as a lesson left with N; Z then says that
  it moves on, not the pass line. Test (`test/pass-rule.test.ts`, every shipped lesson that does not block, a pilot who
  does nothing); the old rule fails it.

### Review R9, R10 and R11

- R9: the review's two ways were "start the next attempt at the last checkpoint, or say 'from the start'". The first is
  what the owner asked ("do not throw the pilot back so far") and what M41-20 says ("never to the far start"): when an
  attempt of a lesson that re-centres on a touch (the corridor, the tunnels of lane s13-worlds) fails (only its time
  limit fails it now), the next attempt begins 1 m before the furthest point it passed, facing along the track, with
  the path flown there and the stages already said kept; the line "Let's try again from the last checkpoint" is then
  true. B back to the task, and a long R in the pause, still begin the next attempt at the start. Tests
  (`test/respawn.test.ts`): the corridor with a 40 s limit run out after cp-2 begins attempt 2 1 m before cp-2 (reset
  event to cp-2), its 50 m goal met again 7 m on, stage 1 not said twice; controls: the same course with a plain bump,
  and B in the pause, begin at the start. Without the rule the test fails.
- R10: the schedule's repeat rule takes its number from `NAMED_SOUND_PLAYS` = 3 (M41-5, `src/lesson/schedule.ts`), not
  from the runner's `REPEAT_PLAYS`. With `REPEAT_PLAYS` set to 2 on purpose the whole-lesson schedule test now fails
  (it stayed green before); a test also takes the third play off every named sound of each ears lesson's schedule and
  expects 'not-repeated'.
- R11: an intro line's `cues` may hold `{ cue, from }` (from: left, right, front, back, up, down; contract `IntroCue`,
  validated) beside plain cue ids: the cue plays from that side. hover-turn's "A sound will come from one side" plays the
  hum three times from the left. Tests (`test/lessons.test.ts`): its task's plays come from [-1, 0, 0]; control: the
  same line with the plain id plays them from the cue's default (dir null, ahead); the loader refuses an unknown side,
  an unknown cue, an unknown key and a repeat.

### Review R12: wording

- ru: `praise.7` "Красиво!" (was "Чисто.", slang), `praise.8` "Прекрасно." (was "Точно.", agreement, not praise),
  `fly.wrong-way` "Ты летишь обратно. Развернись." ("обратно": back the way you came; "назад" read as flying in
  reverse), `fly.wrong-side` "Ворота пройдены не с той стороны. Вернись и войди в них спереди." ("войти в ворота" is
  how a gate is said; "пролети их спереди" was awkward).
- pl: `praise.7` "Pięknie!" (was "Czysto."), `fly.wrong-way` "Lecisz w złą stronę. Zawróć." ("do tyłu" read as in
  reverse), `reason.stop-far` second sentence "Zatrzymaj się nie dalej niż N metrów." (was "Trzeba najwyżej N metrów").
- es: `fly.wrong-way` "Vas en sentido contrario. Da la vuelta." ("hacia atrás" has the same reverse sense as the ru
  and pl lines the review flagged).
- en and all: a pilot who flew none of the circle round the pillar now hears `reason.around-none` ("You did not fly
  around it.") instead of "Only 0 degrees of the full circle" (test: walls-pillar, an idle pilot, `test/pass-rule.test.ts`).
- Written by this lane as a native speaker of Russian and Polish would say them; no person has read them aloud yet.
  Locale lint and parity pass (four languages).

### Review R14 and R15

- R14: `README.md` and `AGENT_SETUP.md` give the demo's keys with B and Z; `CHANGELOG.md` (Unreleased) has the entry for
  lesson format 2 (a breaking file format, format 1 migrated on load) and the new API; `docs/design/stage-1-spec.md`
  keeps its table of the stage-1 rules and says what v0.13 replaced them with.
- R15: `src/lesson/schedule.ts` (the model host and its checks) is no longer exported from `src/lesson` (the tests import
  it by path); `RunnerOptions.testHooks`, `RunnerTestHooks` and `V012PassRule` are marked `@internal` (the package's
  own negative controls; a host never sets them). Moving the v0.12 rule out of the runner would need a pass-rule hook,
  which is the same machinery under another name.

## Needs from the simulator

All in `C:/dev/gsfpv-v03/apps/fly/src/sonic/` (read only here; lane v13-host):

1. `lessons.ts` 183-190, `createLessonRunner(lesson, { ... })`: also pass `path: this.p.path()` (the view's lesson index
   and, step 6, the next lesson's title), `keys: { next: 'N', previous: 'B', repeat: 'Z' }` (the names the lines say) and
   `returnTo: o.returnTo ?? null` (the lesson G left: the glossary's pass then says "Back to the lesson: <title>" and N
   through it does not mark it skipped; review R3).
2. `lessons.ts` 308-329, `act()`: a new action `{ kind: 'go', to }` (review R3). 'next': `void this.advance()`, as after a
   pass (the way back to the lesson G left first, then the next lesson on the path, the full ladder's off it, then the
   menu; `open()` saves the progress first). 'previous': the way back first too (`returnTo`, then cleared), else
   `lessonBefore(id, path)`, else `showMenu()`. Built as `lessonAfter` instead, the host would go on along the path from a
   glossary entered by G, the regression of the v0.12 review I3. After a 'go' the runner is inert: keep `checkPassed()`
   from calling `advance()` a second time (the runner may be in phase 'passed' when N is pressed). Until then the host
   ignores 'go' and the pilot stays in a lesson that no longer moves (N in any flying lesson is a dead end).
3. Keys, each recorded as a `key` event with its `REPLAY_KEY_ACTIONS` value before the call, like N and R today
   (`bridge.ts` 341-364): B -> `runner.previous(t)` ('previous'); Z -> `runner.repeat(t)` ('repeat') instead of the bridge's
   last line again (`lessons.ts` 392-395, `bridge.ts` 425-429); the Escape menu's Next lesson and Previous lesson ->
   `runner.nextLesson(t)` / `runner.previousLesson(t)` ('next-lesson', 'previous-lesson'), Repeat the task -> repeat, Next
   step -> next, Previous step -> previous. N keeps `bridge.next`.
4. I: say `runner.statusLine()` (`lessons.ts` 384-390 builds `status.lesson` today); the large panel of M41-7 draws
   `runner.view()` (lesson k of n, step k of N, attempt, counted m of r, failures in a row, the offer, phase).
5. Progress: keep the new `skipped` field when the prefs store a lesson's progress (`packages/prefs/src/doc.ts` 212-220,
   `validSonicProgress` drops unknown fields) and show it on the start screen (`start-model.ts` 44-49 `stateOf`: a
   'skipped' state beside passed, current, new).


## Needs from other lanes

Lane s13-sound (`src/cues/*`, `src/audio/*`):

1. `repeat-cue` (contract `CueEvent`): sound play `index` of `of` of `cue` for `durS` seconds from `dir` (listener frame, or
   the cue's default when null or absent). My placeholder in `src/cues/planner.ts` plays it as the cue's preview with that
   length; replace it with your design, keeping the length (review R2, below). The runner sends the next play 1 s after
   one's `durS` ends and nothing over speech.
2. `src/audio/engine.ts` 757 starts a preview at once (it plans the frame inside `cue()`); do the same for `repeat-cue`, or
   the first play starts with the next frame (up to a frame late).
3. `praise` and `stage` (contract `CueEvent`): my placeholders play the checkpoint chime and the lap chime; design them
   (the praise is said with a line at the same time; the stage comes over the flight).
4. `wrong-way` and `wrong-side` (contract `CueEvent`, each with `dir`, listener frame): my placeholders play the re-centre
   sweep; design them (the wrong-way cue could sound from `dir`, the way to turn to).
5. M41-10: keep a quiet bed (the room layer) sounding in every flying lesson whatever `lesson.layers.on` says (or add
   'room' to the layers of every flying lesson: the files' `layers` are yours), ducked under speech, never stopped between
   attempts; with the motor (M41-16) that makes silence mean something is wrong. move-speed is the lesson that goes
   silent today (above). The runner keeps the target between attempts; the height tone inside the band is M41-12.
6. Z while flying plays the task's named sounds (for example the height tone) while the live layers go on: a `repeat-cue`
   of `height.tone` replaces the live height plan for its length (the planner's preview rule). Decide whether the live
   layers duck under a repeat-cue in flight, or the preview layers sound beside them.

## For the lead's merge

1. Review R2, the five shared cue events (`src/contract.ts`, `src/cues/planner.ts`):
   - Take this lane's five `CueEvent` variants: each is a superset of lane s13-sound's (`stage?`, `dir?` on the two
     direction kinds, `repeat-cue` with `dir?`, `index?`, `of?`, `durS?`), so the planner of s13-sound and this runner
     both compile against them. Take s13-sound's planner cases and drop this lane's placeholders.
   - The play length: s13-sound's `repeat-cue` case must honour `durS`, one line:
     `return this.previewCue(e.cue, e.dir ?? null, t, e.durS ?? REPEAT_CUE_S);`. Until then `test/repeat-plays.test.ts`
     fails (its control is that planner: 0.9 s plays, 2.6 s of silence between them). If the sound lane keeps 0.9 s, set
     `REPEAT_PLAY_S` in `src/lesson/sounds.ts` to 0.9 instead and the check passes again; this lane's view: 2.5 s keeps a
     sound that changes as it plays (a wall coming closer, the height glide) long enough to hear the change.
   - A one-off cue a lesson names plays in a slot of its own length (`ONE_OFF_PLAY_S`); s13-sound's new one-off cues
     (`target.praise`, `target.stage`, `safety.wrong-way`, `safety.wrong-side`) are named by no lesson yet; a lesson that
     names one needs its length there (the check says which).
   - s13-sound's `test/replay-v012.test.ts` asserts that only lesson events differ on its v0.12 sessions; with this
     runner goal, gate, reset and speech events differ too (review probe: rings-first 2 of 10 events re-derived,
     walls-hall 5 of 14): relax it to "told as an older build" when the lesson version differs.
