# Review of lane s13-lessons (v0.13 wave 1, owner's message 41)

Independent review, 2026-11-08, of branch `s13-lessons` at e0d1f0a against `main` 7d4b4b9 (66 files, +4987 -356).
Read: the plan (ShramkoGSFPV `docs/wip/v13-plan.md`), the owner's message 41, `docs/wip/s13-lessons.md`, the whole diff
(the runner in full), the branches `s13-sound` 22e3b09 and `s13-worlds` 75140b5 where they meet this lane, and the
simulator host (`apps/fly/src/sonic/*`, read only).

## Verdict

**Merge after R1 is fixed in this lane, with R2, R3 and R4 done by the lead in the same step as the merge and the
gitlink move. No blocker.** The lane does what the owner asked for its items: every named sound three times with no
speech over it (M41-5, M41-9), N, B and Z (M41-6), progress after every attempt and on I (M41-7), r counted in total
with the reason and the offer after 3 failures (M41-8, with a convincing reproduction of the endless hover-turn), praise
and stages (M41-11), wrong way and wrong side (M41-15), respawn near the crash (M41-20), the target sounding between
attempts (M41-10). The checks are real: every rule I broke on purpose was caught (one break of a single layer of the
M41-9 fix is covered by its second layer). What is not right: the wrong-way warning fires when a pilot correctly flies
back to a ring he passed beside (R1, it contradicts the target hum); the shared cue events do not have the payloads lane
s13-sound built (R2); the 'go' action as specified loses G's way back (R3); and the gitlink move turns 16 of the
simulator's own Fly by Sound tests red, which the lane doc does not say (R4).

## What I ran

- `pnpm typecheck`: pass. `pnpm test` (Node 22.13): 27 files, 631 tests pass, 9 s.
- `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio`: 3 files, 9 proofs pass, 48 s (the two evidence files it rewrote were
  restored, not committed).
- `node tools/run-tool.mjs locale-lint`: 0 problems, 4 languages, 452 keys; `check-layout`: 0 problems.
- The simulator against this package, read only (imports of the package rewritten to this worktree): `tsc` of
  `apps/fly` 0 errors (71 files of this lane in the program, none of the pinned submodule); its `tools/bench` sonic tests
  and `packages/prefs` sonic test: 16 fail, 515 pass (on its own pin 1eea4d5: 531 pass). Architecture rule 7
  (`scripts/check-architecture.mjs` on a copy): ok; a planted `playcanvas` import fails it.
- Hygiene: no non-English text in added lines outside `locales/`; no personal data in files or commit messages
  (author address as on `main`); ownership of lesson keys checked by script (only `pass`, `intro`, `speech`,
  `checkpoints`, `format`, `version` changed); the changes outside the lane's table are the ones its doc lists.

Rules broken on purpose (each broken in the source, its tests run, the file restored; worktree clean after):

| Rule broken | Result |
|---|---|
| failures reset the count (M41-8) | 3 pass-rule tests fail (every-other pilot, front/back pilot `PFFPPFFPPFFPPFF`, coin pilots median 7) |
| no offer after 3 failures | 2 tests fail (ears-headphones `FFFFFFF` with no offer; no reason line) |
| a spoken step ends at the estimate (one layer of M41-9) | all pass: the sound step's own wait for the report still holds |
| both layers: estimate ends speech and a sound does not wait | 2 schedule tests fail (every-lesson check: an issue in ears-headphones with the estimate voice; plays a second apart) |
| named sound twice, not three times (M41-5) | 2 tests fail (glossary plays, scene count); see R10 |
| no target between attempts (M41-10) | silence test fails (hover-turn 0 of 150 frames) |
| a slow drift is the wrong way | direction control fails |
| a touch goes back to the start (M41-20) | 3 respawn tests fail |

## Findings

**R1, major. The wrong-way warning fires on the right way back to a missed ring.**
- Where: `src/lesson/runner.ts` checkDirection (886-897), `src/lesson/track.ts` dirAt.
- What: in a gate course, a pilot who passes a ring beside it (farther than the near miss, so the attempt goes on and
  the ring stays the target) hears its hum behind him and flies back to its front; the runner says "You are flying back.
  Turn around." (every 5 s on a longer way). Probe on rings-line, rings-small and rings-course: ring 2 passed 6 m to its
  side, 11 m back at 3 m/s: told once in each, then the ring flown from the front counts. The voice contradicts the
  target hum for a blind pilot, the very confusion of message 41. The same holds with s13-worlds' world lists (their
  `dir` follows the course).
- Fix: in a course, judge the direction against the way to the current target gate (no warning while the velocity
  points toward it), keep the track rule for corridors; add the probe as a test, with the corridor case as its control.

**R2, major. The shared cue events have other payloads in lane s13-sound.**
- Where: `src/contract.ts` CueEvent 551-559, `src/cues/planner.ts` placeholders 211-223 and 692-720; s13-sound's
  `src/contract.ts` and `src/cues/planner.ts`.
- What: here `repeat-cue {cue, dir, index, of, durS}`, `stage {index}`, `wrong-way {dir}`, `wrong-side {dir}`; there
  `repeat-cue {cue, dir?}` played for `REPEAT_CUE_S` = 0.9 s whatever `durS` says, `stage {stage?}` (each stage a step
  higher), `wrong-way {}`, `wrong-side {}`. A union merge does not compile (`e.stage` on this lane's variant).
  Reconciled naively, the runner still times each play of a continuous cue as 2.5 s plus 1 s, so the pilot hears 0.9 s
  plays with 2.6 s of silence between them, not "about 1 s apart", while this lane's schedule check, which models a play
  as `durS`, stays green. And s13-sound's `test/replay-v012.test.ts` asserts that only lesson events differ on its v0.12
  sessions; with this runner goal, gate, reset and speech events differ too (probe: rings-first 2 of 10 events
  re-derived, walls-hall 5 of 14), so it fails after the merge.
- Fix (lead, at the merge): one payload per kind; the play length owned by the planner and used by the runner (or the
  planner honours `durS`; 2.5 s suits a continuous cue better than 0.9 s); one field name for the stage; keep `dir` on
  the two direction kinds; take s13-sound's planner cases and drop these placeholders; relax that v0.12 assertion to
  "told as an older build" when the lesson version differs.

**R3, major. 'go next' as specified loses G's way back to the lesson.**
- Where: this lane doc, "Needs from the simulator" item 2; `leave()` (1469-1478); the host's `LessonHost.advance()`.
- What: G opens the glossary with a way back; N through it ends, from its last step, in `go next`. Built as specified
  (open `lessonAfter(id, path)`), the host goes on along the path instead of back to the lesson G left, the regression
  the v0.12 review I3 fixed. Today's host ignores 'go': the pilot stays in a glossary that no longer moves. A glossary
  left that way is also saved skipped although it was heard. The simulator tests "G opens the sound glossary and comes
  back" and "review I3" fail with this package.
- Fix: specify 'go next' as the host's `advance()` (the way back first, then the next lesson on the path, else the
  menu) and 'go previous' as `lessonBefore`; do not mark a lesson opened by G as skipped.

**R4, major. The gitlink move breaks the simulator's Fly by Sound tests, and the lane doc does not list them.**
- Where: the simulator's `tools/bench/test/sonic-*.test.ts` and `sonicrec-*.test.ts`.
- What: 16 tests fail with this package (531 pass on the current pin).
  - Format 2 pass rule: sonic-lessons modules 1 to 5 ("four attempts of five", "eight stops", "three attempts of
    four", "eight of ten") and "progress is saved at every attempt".
  - Named sounds are `repeat-cue`, not `preview`: the rig's answerer reads the last preview, so module 0
    (ears-headphones) and the two-lesson ears replay never pass.
  - The task is said in parts: sonic-int-reader "the intro" (2 lines at once, not 4). Lesson version 2:
    sonicrec-recorder. Changed lines: sonicrec-replay "feeds the engine what the lesson said".
  - N while flying now leaves the lesson and the runner goes inert: sonic-bridge walls-hall (no touch recorded) and the
    sonicrec-replay controls (a moved flight no longer changes anything). G: the two tests of R3.
  - One needs a look: sonic-int-replay rings-first, a wall touch re-derived a frame later at 0.19 m/s for 0.52 recorded
    (30 Hz grid), now reached because the scripted pilot flies on through the longer pause.
  - Until v13-host handles 'go', N in any flying lesson is a dead end.
- Fix: move the gitlink on the v13-host branch together with the host changes and these test updates, not on the
  simulator's main first; add this list to the lane doc.

**R5, major (owner-visible; the goals are outside this lane). The corridor ends at 240 m and says the whole corridor was flown.**
- Where: `lessons/corridor.json` goals (fly-distance 240) and `speech.pass`; lane doc open item 4.
- What: with r = 1 and no touch limit, the first attempt that reaches 240 m passes, in the fourth section of 335 m: the
  pilot never flies the last section, never hears "Stage 4 passed", and hears "You flew the whole corridor." The owner
  asked to go on along the tunnel and check every obstacle.
- Fix (lead or s13-worlds at the merge): end the corridor at its last checkpoint or at its length.

**R6, minor. Stages are said twice when the world's checkpoint list carries stages.**
- Where: `fly()` 805-813 and `passWorldPoints()` 839-851.
- What: probe, the corridor with a world list ending stage 1 at -30 m: "Stage 1 passed." at -30 m and again at cp-2
  (-50 m). The respawn already takes the world's list only; the stages do not.
- Fix: take stages from the track's source only (skip a lesson checkpoint's stage when the track comes from the world).

**R7, minor. A lesson that moves on by itself is saved as passed.**
- Where: `moveOn()` 1071-1079.
- What: a lesson that does not block, failed 3 times in a row, is saved `passed: true, skipped: false`; the start screen
  of M41-2 will show it passed, while the same lesson left by N shows skipped.
- Fix: keep the phase 'passed' for the host, save `passed: false, skipped: true`.

**R8, minor. The host contract says nothing about pause.**
- Where: `spoken()` 641-650, "Timing contract" in the lane doc.
- What: the Escape menu of M41-3 pauses the flight and speaks through the same queue; when the queue empties the runner
  goes on: it says its next lines over the menu or starts the next named sound (a preview sounds with the layers
  silenced), and plays 2 and 3 then wait for frames.
- Fix: write in the contract that the host holds `spoken(t)` while paused and reports it on resume (or give the runner
  pause and resume).

**R9, minor. A failed corridor attempt says "from the last checkpoint" and starts at the start.**
- Where: `lessons/corridor.json` `speech.retry`, `startAttempt()` 711-715.
- What: now rare (only the 15-minute limit fails an attempt), but the line and the placement disagree.
- Fix: start the next attempt of a course at the last checkpoint passed, or say "from the start".

**R10, minor. The schedule's repeat rule checks against its own constant.**
- Where: `checkSchedule()` 370.
- What: with `REPEAT_PLAYS = 2` the whole-lesson schedule test stays green; only the glossary example (a literal 3)
  fails.
- Fix: pin 3 (M41-5) in the rule, or assert `REPEAT_PLAYS === 3`.

**R11, minor. hover-turn plays its named hum from straight ahead.**
- Where: `lessons/hover-turn.json` intro 1, `introBlock()` (dir null: the planner's front fallback).
- What: "A sound will come from one side. Turn until it is straight ahead." and then the hum three times from the front.
- Fix: let an intro cue carry a direction and play it from the side the line names.

**R12, minor. Wording of a few new lines.**
- Where: `locales/ru.json`, `locales/pl.json`, `locales/en.json`.
- What: ru `praise.8` reads as agreement ("exactly"), not praise; ru and pl `fly.wrong-way` read as flying in reverse
  rather than back along the track; ru `fly.wrong-side` says "fly them from in front", which is awkward; the second
  sentence of pl `reason.stop-far` ("you need at most N metres") is not how a speaker says it; ru and pl `praise.7`
  ("clean") is slang; en `reason.around` can say "Only 0 degrees". Spanish reads natively; the plurals and cases of the
  numbers are right in all four.
- Fix: rephrase those keys with a native speaker of each language.

**R13, minor. v0.12 recordings play back with lines the pilot never heard.**
- Where: the replay (by design, lane doc open item 6) and the simulator's replay player.
- What: they are told plainly as an older build, but do not verify, and the player re-derives lines and cues with the
  v0.13 rules.
- Fix: when the build is not the recording's own, the player uses the recorded speech events (or keep the v1 lesson
  files for exact replays).

**R14, minor. Public docs.**
- Where: `README.md` 60 and `AGENT_SETUP.md` 16 (keys "N next, R reset": no B, Z), `CHANGELOG.md` (no entry for lesson
  format 2, a breaking file format, nor the new API), `docs/design/stage-1-spec.md` (pass rules "8 of 10").
- Fix: update with the merge.

**R15, minor. Test machinery ships in the runner.**
- Where: `RunnerOptions.testHooks` (the v0.12 pass rule and timing), `src/lesson/schedule.ts` exported from the package.
- Fix: acceptable; mark them internal, or move the v0.12 rule to `test/helpers`.

## Not checked

How it sounds: the three plays, the praise, the stage and the wrong-way cues with the real planner and a person's ears
(lane s13-sound's rig, then people). The simulator with the host changes (wave 2). Voices other than the measured
English one.
