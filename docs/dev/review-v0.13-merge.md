# Review of the v0.13 merge: `s13-merge` before it becomes `main`

Independent review, 2026-11-08, of branch `s13-merge` at e101f7c against `main` 7d4b4b9 (171 files, +21195 -1339),
as one product: the three merges (5db2b1d s13-lessons, 9eb98d7 s13-sound with vl-spec, 4559896 s13-worlds) and the
lead's merge items a to f and 8a to 8j. Read first `docs/dev/status-v0.13-merge.md`, then each lane's notes and review
(`status-v0.13-*.md`, `review-v0.13-*.md`) for what they already covered, which is not reviewed again here. The
simulator ShramkoGSFPV was measured at `v03-lead` 093fbbd (v12-optin merged), read only. Nothing pushed. Every file
broken on purpose was restored with `git checkout`; the probes ran from a test file that was removed afterwards; this
file is the review's only commit.

## Verdict

**The merges are sound. Three things a pilot meets only now that the three lanes run together should be fixed in this
repository before the branch becomes `main` (M1 to M3); then the gitlink moves with the wave 2 list below.**

- Nothing of any side was lost: every file only one side changed is that side's file in each merge commit, every file
  both changed merged by itself but the ten conflicts the merge doc lists, and their resolutions keep both sides; no
  export, locale key or lesson field of a lane is missing. No assertion was weakened to pass: the test edits of items
  8a to 8j take positions from the worlds, scale numbers that followed the old geometry, and three got stronger.
- `pnpm typecheck` clean, `pnpm test` 1042 of 1042; nine merged rules broken on purpose, each caught.
- Through the ears of a blind pilot, with the merged runner, planner and worlds on every frame: every one of the 23
  flying lessons passes with the truth bot and with an imperfect pilot, no touch where a lesson forbids it, not one
  silent frame from the lesson's open to its pass, no wrong way and no wrong side in a correct flight, praise and each
  stage once; a touch in the corridor or a tunnel goes back at most 4.5 m along the track; the open-way chime names the
  free side at every tunnel obstacle and never sounds at a gate; rings-heights' target follows the next ring.
- What is not right: a genuine recording with a touch in the corridor or any tunnel reads FAIL in the replay (M1); the
  target note sounds from the second lesson of the fast path on and nothing tells the pilot what it is (M2); the
  open-way chime sounds for about 20 s in the corridor and in four tunnels before the one lesson that teaches it (M3).

## Findings

| Id | Severity | Where | What |
|---|---|---|---|
| M1 | major | `src/lesson/runner.ts` `fly()`, `test/helpers/record.ts`; simulator `sonic-session/frames.ts` | a genuine recording with a touch in the corridor or a tunnel reads FAIL |
| M2 | major | `lessons/hover-height.json`, `lessons/rings-heights.json` and their lines | the target note is never explained where it first sounds; rings-heights calls it steady and does not play it |
| M3 | major | `lessons/corridor.json`, `lessons/tunnel-gaps.json` and their lines | the open-way chime sounds long before it is taught, and its lesson does not play it |
| m1 | minor | corridor `intro.3`; the last checkpoint of every tunnel | the corridor teaches the checkpoint chime but plays the stage figure; a tunnel's end chimes a second before its fanfare |
| m2 | minor | `CITATION.cff`, `src/contract.ts:447`, `docs/testing/test-protocol.md:12` | "21 lessons", "about six lessons" |
| m3 | minor | `test/` | the six tunnels' respawn and the chime at the shipped obstacles hold (measured here) but no test holds them |
| n1 | nit | `test/progress.test.ts` | the merge dropped s13-worlds' exact Russian sentence; it could stay as `\u` escapes |

### M1, major. A genuine recording with a touch in the corridor or a tunnel reads FAIL

- What: the corridor and the six tunnels re-centre on a touch (`onTouch: bump-recentre`), now to 1 m before the last
  point of the world's list. Flights recorded by this build's own host, one touch each, checked by this build's replay:
  corridor "FAIL: events 28 of 29 re-derived ... wall at 46717 ms: position differs by 1.00 m"; tunnel-gaps the same
  (a floor touch, 1.00 m); tunnel-long a reset to `w10` recorded and `w9` re-derived. rings-heights with a touch (it
  does not re-centre) passes. The same three fail with a host that records as the simulator does (the kept frame is the
  sample the runner was given, one sample in two of 60 Hz). In the simulator every touch is then a coin toss for the
  replay page, and a beginner touches the tunnels' walls often: the check the replay is for says FAIL on honest flights.
- Why, two causes:
  1. The replay applies a recorded touch on the first frame at or after its time (`src/replay/replay.ts`, `step()`).
     When the touch's own sample was not kept (30 Hz of 60), the next frame is already at the respawn, so the
     re-derived touch has the respawn's position: 1 to 6 m off, against a tolerance of 0.15 m.
  2. `fly()` takes the frame's touch, and its respawn, before the checkpoints and world points the frame crossed. Live,
     the craft crossed point k one 60 Hz frame before it touched; in the 30 Hz replay one frame does both, and the
     respawn goes before point k-1.
  v0.12 had both (only its corridor re-centred, to a checkpoint tens of metres back), but no test replays a touch with
  a respawn; v0.13 puts the re-centre in seven lessons and a track point every 5 m or less.
- Fix: in this repository, `fly()` counts the frame's lesson checkpoints and `passWorldPoints` before the touch (the two
  blocks moved above `if (s.touched)`, nothing else), and the test host `test/helpers/record.ts` records what the
  simulator records (the sample's position, not the one after a `place`) and keeps every touched sample; a test replays
  a corridor and a tunnel flight with touches. In the simulator, `FrameSampler.take` keeps every sample with `touched`
  (wave 2, W11). Tried here, then restored: with both, the four recordings re-derive (PASS) and the suite stays 1042 of
  1042.

### M2, major. The target note is never explained where it first sounds

- What: since s13-sound's review M2 the target height is a short note about once a second. It sounds wherever there is
  a band or a gate: hover-height (fast path, second lesson), hover-turn, every ring and shape lesson and free-garden
  (the cue `height.target` is active in 79 to 100 % of their flying frames). The lines that explain it are the glossary
  (lesson 1, not on the fast path) and rings-heights (lesson 22, not on the fast path). hover-height's intro plays
  `height.tone` and `height.rough` three times each and says nothing of the note; rings-first's says nothing either.
  rings-heights, the lesson of the target note, says "The second, steady tone is the height of the next ring" and "until
  your tone matches the steady one", and its intro carries no `cues`, so neither tone is played three times (M41-5).
  A fast-path pilot hears the note in four of its seven flying lessons (hover-height, rings-first, rings-course,
  free-garden), and no line on that path names it.
- Fix (the lessons' owner, four languages): a line in hover-height's intro after `intro.2` with `cues:
  ["height.target"]`, for example "About once a second a short note gives the middle of the band. When your tone sounds
  the same, you are there."; rings-heights `intro.2` "You hear your height as a gliding tone. About once a second a
  short note gives the height of the next ring." with `cues: ["height.tone", "height.target"]`, and `hint.1` "... until
  your tone sounds the same as the short note." (the merge doc's open item 2, with the plays added).

### M3, major. The open-way chime sounds long before it is taught

- What: the chime (`safety.free`) sounds wherever something is ahead under 3 s with a way past it, not only at the
  tunnels' blocks: measured with the merged planner on the truth bot's flights, walls-pillar 64 frames (lesson 10),
  the corridor 988 frames, about 20 s of its 62 s (lesson 12, the fast path's fourth: at the pillar, at every bend from
  the side it turns to, at every jog from ahead as above or below), tunnel-wide, -narrow, -narrower and -bends 140 to
  438 frames each. The one lesson that teaches it is tunnel-gaps (lesson 17), and its `intro.2` names the chime without
  `cues`, so it is not played three times either (the merge doc's open item 3). The corridor's lines name walls,
  checkpoints and the reset, not the chime. What the chime says is right everywhere (below, check 6); the pilot is
  simply never told it is there until he has heard it for minutes.
- Fix (the lessons' owner): name it where each path first meets it: the corridor (both paths), a line such as "When
  something blocks the way ahead, a pair of quick notes repeats from where the way goes on: left or right, or from
  ahead for above and below." with `cues: [{ "cue": "safety.free", "from": "left" }]`; tunnel-gaps `intro.2` with the
  same cue. walls-pillar meets it only head-on to its pillar; a line there is the owner's choice.

### m1, minor. The corridor teaches one checkpoint sound and plays another

The corridor's `intro.3` ("There are checkpoints along the way. If you touch a wall, you go back to the last
checkpoint.") plays `target.checkpoint` three times. In flight cp-2 to cp-5 end stages (R6: the world's list marks
none), so they play the stage figure with "Stage k passed."; the checkpoint chime sounds once, at cp-6, about a
second before the fanfare. A touch goes back to the last point of the world's list (5 m apart or less), not to a
checkpoint. Every tunnel also chimes its end checkpoint `cp-2` about a second before its fanfare. Fix: `intro.3` with
`cues: ["target.stage", "safety.reset"]` and words for stages ("Each stage you pass is told. If you touch a wall, you
go back only a little way."); and either no chime for a last checkpoint that ends a `track-end` lesson, or accept it.

### m2, minor. Stale counts in public metadata

`CITATION.cff` (the abstract GitHub and Zenodo show) still says "a curriculum of 21 lessons"; `src/contract.ts:447`
says "the short path of about six lessons" and `docs/testing/test-protocol.md:12` "about six lessons" (the fast path
is 8). README, llms.txt and AGENTS.md say 28 and 8.

### m3, minor. Two cross-lane promises hold but no test holds them

The respawn of the six tunnels (only the corridor's world list is tested: `RESPAWN_BEFORE_M` set to 6.5 fails one
test) and the open-way chime at the shipped obstacles (`test/freeway.test.ts` flies box tunnels, not the lessons'
blocks). Both were measured here (checks 5 and 6); the probes are cheap enough to be tests.

### n1, nit

`test/progress.test.ts`: the conflict kept s13-lessons' form (the Russian line built from the locale's template) and
dropped s13-worlds' literal Russian sentence, because tests write Cyrillic as escapes. The composition is still held;
the literal, written with `\u` escapes, would also pin the wording. No defect.

### Observations, no change asked

- tunnel-long: a block 2.3 to 2.9 m past a corner gives the chime from the first frame the craft faces it, about 1 s
  at the cap; tunnel-gaps' blocks are 4.5 m apart, so its chime runs on from one to the next. Testers will say whether
  that is enough.
- In the rings rooms (9 to 12 m wide) a nose turned about 40 degrees off the motion meets the side wall inside 3 s and
  hears the chime; it came from the scripted pilot turning while it moves, never with a gate ahead.
- walls-hall: knocks start by time to contact, so "fly slowly, stop at the knocks" passes 1.5 m up to about 0.75 to
  1 m/s (the merge doc's model); the lines say "slowly", which holds.
- The merge doc's open item 4 (`LINE_UP_M`): confirmed in both pilots' flights, no wrong way between gates.
- The replay's cue share tolerates small cue edits by design: one cue id dropped from 30 frames (3.4 % of a flight)
  still passes; a moved event or a moved flight fails.

## The ten checks

1. Merges and merge items. For each merge commit, every file changed on one side only equals that side's file (a
   script over `git diff` of base, both parents and the merge); `git show --remerge-diff` shows only the conflicts the
   merge doc lists (step 3: the planner, two evidence files; step 7: the corridor, four locales, two tests, and the
   walls-hall measurement in the fixture). The planner hunk dropped only s13-lessons' placeholders; the corridor keeps
   s13-worlds' geometry, s13-lessons' stages and cues, cp-6 at the world's end; walls-hall reads as one text with its
   1.5 m goal. No exported name of a lane tip is missing but `SCENE_S`, which s13-lessons itself replaced and the
   simulator does not use; no locale key of a lane tip is missing. Every changed assertion in the items' tests read:
   positions and numbers taken from the worlds, counts re-measured (262, 263, 264 lines; 60 to 78 plays; 21 to 27
   glossary steps), three strengthened (`metAt`, the no-touch checks, the v0.12 replay's verdict), none dropped.
2. Every lesson passes. A probe flew the 23 flying lessons (22 worlds, free-garden over stand-in gates) with the
   merged planner planning every frame: the truth bot passes each in exactly r attempts with no touch; an imperfect
   pilot (65 % of the cap, a sideways wobble that keeps half its clearance, a 1.2 s hesitation every few metres) passes
   each in r attempts with no touch, but rings-heights in 4 (one ring crossed beside its opening). walls-row and
   rings-course allow no touch, walls-hall and walls-pillar one: none was used.
3. Never silence. Not one frame without a cue from the lesson's open to its pass in either pilot's flights (36 000 and
   52 000 frames at 50 Hz), nor through 56 crashes and respawns.
4. Event sounds. In every correct flight no `wrong-way` and no `wrong-side` cue or line; praise r-1 times; the corridor
   says stages 1 to 4 and tunnel-long 1 to 5, each once with its cue, also after crashes. Flying back 7 to 12 m at
   1.5 m/s in the corridor and every tunnel is told once or twice (at most once every 5 s). The three plays with no
   speech over them are `test/lesson-schedule.test.ts`'s (every lesson, five speech models), unchanged by the merge.
5. Respawn. 56 crashes in the corridor and the six tunnels (half a touch where the craft flew, half into the side
   wall), at every third point of the world's list: each reset names the last point passed, the craft goes 1 m before
   it (at it where that is too near a wall), facing the track (0 degrees off), at least 0.23 m clear of every surface
   (tunnel-long's 0.7 m ways); along the track 0.1 to 4.5 m back from the touch (0.1 m where it was put at the point
   itself, just past it); every lesson then passed in that attempt. A side-wall crash beside a corner projects onto
   the next leg and so measures "ahead": not a defect.
6. Open-way chime. Straight at each of the 4 blocks of tunnel-gaps and the 5 of tunnel-long from the middle of the
   tunnel at the cap: the chime names the side the generator left free and no other, from the first frame of the
   approach. In the truth flights it names, at every bend, the side the tunnel turns to, and never sounds with a gate
   ahead (the ring lessons' chimes come from side walls in front of a turned nose).
7. rings-heights. Item 8h's test (the target is the next ring's centre, every target on the 0.5 m grid, unison at each
   ring) holds; with the room at 5 m again three tests fail.
8. Replay. Both v0.12 recordings read "recorded with an older build", naming the versions; the same recording claiming
   this build's versions, a newer version, another world or an unknown theme read FAIL (`test/replay-v012.test.ts`,
   `test/replay.test.ts`, `test/world-versions.test.ts`, run here). A same-build recording of rings-heights passes, and
   an event moved 3 s or the flight moved 0.6 m reads FAIL. But see M1: an honest same-build recording with a touch in
   the corridor or a tunnel reads FAIL too.
9. Lines. All 75 new or changed lesson, cue, module and menu lines read in en, es, pl and ru. They read naturally aloud
   and agree with the lessons, but for M2 (hover-height, rings-heights), M3 (corridor, tunnel-gaps) and m1 (the
   corridor's checkpoints). The tunnels' words fit the merged knocks: in tunnel-narrow (1.8 m) and -narrower (1.2 m)
   both walls knock in the middle, as their lines say; in the corridor and tunnel-wide the middle is quiet, as the
   corridor's line now says.
10. Public tree. `gh_precheck` over 7d4b4b9..HEAD (a scratch clone, the range staged): the secrets scan flags two
    Spanish pass lines (`...pass` followed by an opening exclamation mark), false positives; the word "token" in ten
    lines is SAPI's voice token; three zips are synthetic session fixtures (host "vitest-host", pilot "testPilot01", no
    voice). No key, token or password; no address but the owner's public contact, as on `main`; no build-machine path
    in `docs/`, README, AGENTS.md or llms.txt (or anywhere) but `GPU_LOCK`'s default, which the code has.

## Rules broken on purpose

Each was broken alone in the merged tree, the whole suite run, the file restored with `git checkout`:

| Rule broken | Tests that failed |
|---|---|
| a respawn 6.5 m before the last point passed (M41-20, more than 6 m back) | 1: `respawn.test.ts`, the world's own list |
| stages from the lesson's checkpoints even when the world's list marks some (R6: a stage said twice) | 1: `praise.test.ts`, a stage is said once |
| the jump rule of item 8g off (`JUMP_M` 1000) | 1: `replay.test.ts`, the host that never reports speech |
| tunnel-long without the height tone and the room bed (M41-10) | 2: `silence-layers.test.ts`, `world-tunnels.test.ts` |
| rings-heights in a 5 m room (item 8h, off the 0.5 m grid) | 3: `height.test.ts`, `world-heights.test.ts`, `world-scale.test.ts` |
| a recording that differs only in its world told as an older build (items d, 8i) | 1: `replay.test.ts`, the verdict table |
| tunnel-gaps' above and below by register again (item 8e) | 1: `world-tunnels.test.ts` |
| the glossary without the open-way chime (item 8f) | 4: `lessons.test.ts`, `navigation.test.ts`, `progress.test.ts`, `repeat-plays.test.ts` |
| tunnel-narrow's limit 50 s, under twice its track at 1 m/s (item 8d) | 1: `world-track-end.test.ts` |

## The simulator against this branch

The simulator's Fly by Sound tests (`tools/bench/test/sonic-*.test.ts`, `sonicrec-*.test.ts` but the headers test,
`packages/prefs/test/sonic.test.ts`), with every import of the package (`@shramko/sonic-fpv`, its `audio`, the
relative `packages/sonic-fpv/src`, its test host and locales) aliased to this branch by a vitest config kept outside
both repositories, cache on the data disk, Node 22.13; the simulator's tree was the same before and after.

- On its own pin (1eea4d5): 572 tests, 564 pass, 8 skipped, none fail (29 files, 54 s).
- Against this branch: 593 tests (the new lessons add per-world cases), 533 pass, 52 fail, 8 skipped (57 s).
- `tsc` of `apps/fly` with the package mapped to this branch: clean (79 files of this branch in the program, none of
  the pin); the control, a type error planted in this branch's `src/index.ts`, is reported; on the pin: clean.

Every failure, why, and what wave 2 changes (all in `tools/bench/test/`, on the branch that moves the gitlink):

| Test (file:line) | Why it fails with this branch | Change |
|---|---|---|
| `sonic-audio:181`, `:629` | `motorSound` is true by default (M41-16) | expect true; the "off mix" control sets it false |
| `sonic-bridge:183` | the craft is placed at z = -10, beyond the front wall of the 10 x 12 m room | a floor point inside the room (from `wall-front`) |
| `sonic-bridge:527` | N pressed while flying leaves the lesson (M41-6); the flight's z of -27.5, -20, -24 is beyond the room | N in the task; positions from the landmarks |
| `sonic-bridge:582` | reset at z = -28.5, "1.5 m before the front wall" of v0.12's hall | `wall-front` plus 1.5 m |
| `sonic-int-reader:47` | the task is said in parts (lines up to a named sound, its three plays, the rest): first batch 2 lines | measure the whole task to `flying` |
| `sonic-int-replay:245` | rings-first's cue kinds agree on 98.7 % of 2225 frames (99 % wanted); likely the edges of nine plays (3 cues, 3 plays) on the 33 ms grid, not pinned down | a bound from the plays' edges, looked at with W9 |
| `sonic-int-replay:208`, `:285` | the rig answers from the last `preview` cue; a named sound is a `repeat-cue` now | read `repeat-cue` too |
| `sonic-int-replay:328` | hovering 1.5 m over a floor is silent since the 0.8 m rule (M41-13) | hover within 0.8 m, or sink |
| `sonic-lessons:116` | module 0: the trials' sounds are `repeat-cue` events, not `preview` | count `repeat-cue` |
| `sonic-lessons:143` | hover-height: r = 3 counted in total, not 4 of 5 | expect 3 |
| `sonic-lessons:163` | move-speed: the pilot stops at 9 m; the zone is 7 m out now | stop by the zone's position from the world |
| `sonic-lessons:174` (and `:178`) | walls-hall: 3 counted stops within 1.5 m (the pilot stops 2.4 m out); layers safety, height, room, voice | stop about 1 m out; expect 3; layers include safety |
| `sonic-lessons:186` | corridor: 125 m, goals 15 m then `track-end`, r = 1; resets name world points `wN`; checkpoints cp-1 to cp-6 | expect 1 pass, `wN`, cp-6 |
| `sonic-lessons:202` | rings-first: r = 3, not 8 of 10 | expect 3 gates |
| `sonic-lessons:213` | the wrong-height control climbs toward 7 m but the ring is only 5.5 m ahead: it crosses at about 4.1 m, inside | climb above the ring first, then fly at it |
| `sonic-lessons:257` | the control waits 60 s for a touch of the front wall while the attempts pass and restart | a plain forward flight once the lesson flies |
| `sonic-lessons:340`, `:354` | the glossary ends in `go next`, which the host ignores | W3, W4 |
| `sonic-lessons:432` | three counted attempts now pass the lesson | stop at two, or expect passed |
| `sonic-pilot:172` | walls-hall caps: 5 s at 3 m/s is 15 m in a 12 m room | the caps in an open world with walls-hall's assists |
| `sonic-primitives:94`, `:184`, `:185`, `:220`, `:221` (18 tunnel cases) | `cavityBoxes` mirrors the corridor of version 1; the tunnels are version 2 | W2 |
| `sonic-primitives:290`, `:299` (rings-first, shapes-square, control) | the rays start on a sphere that now lies mostly inside the 12 m rooms' walls: 60 to 73 hits, 100 wanted | a radius inside the room, or more rays |
| `sonic-start:24`, `:37` | 28 lessons, a fast path of 8 | `SHIPPED_LESSON_IDS.length`, the paths' fast list |
| `sonic-world:122` (walls-hall, walls-pillar, rings-first, shapes-cube) | `cellsUniform` 682 to 922 in the small rooms, 1000 wanted | a bound by the world's cell count |
| `sonic-world:276`, `:281`, `:335` | the cost benches fly v0.12's hall numbers (x -15..15, z -20..20) | pin v0.12's hall (`makeSpec('hall', ..., 0, 1)`) for the benches |
| `sonicrec-recorder:303` | walls-hall is version 2 | `getLesson('walls-hall').version` |

## Wave 2: one list

Every "Needs from the simulator" of the three lanes and the merge, and what the run above shows, once each. Lines are
the simulator's at `v03-lead` 093fbbd. Owners: v13-host owns `apps/fly/src/sonic/*` and `app/builtin/sonic-flight.ts`,
v13-look `lesson-world.ts`, `primitives.ts` and collision; `app/builtin/sound.ts`, `apps/fly/src/sonic-session/*`,
`packages/prefs` and `tools/bench/test` are in neither list: the lead assigns them (suggested: v13-host).

| # | Lane | Where | What | How to check | From |
|---|---|---|---|---|---|
| W1 | lead | the gitlink commit | move the gitlink to the new `main` with W2 in the same commit and W20 on the same branch, never on the simulator's `main` first | the 52 tests above pass; on the old pin they fail | R4, worlds M4 |
| W2 | v13-look | `primitives.ts:215-231` `cavityBoxes`, delete `corridorCavities` 135-208 and the switch by generator | draw the hollow from `world.cavities` | `sonic-primitives` 18 tunnel cases pass; the left-for-right control still fails | worlds 1 |
| W3 | v13-host | `sonic/lessons.ts:189-196` `createLessonRunner` | add `path`, `keys` (N, B, Z), `returnTo`, `speechRate` | `sonic-lessons:340`, `:354`; I says "Lesson 6 of 28" | lessons 1 |
| W4 | v13-host | `sonic/lessons.ts:314-336` `act()` | `case 'go'`: next = `advance()` (G's way back first), previous = way back, `lessonBefore`, menu; no second `advance()` | N in a flying lesson moves on; G goes and comes back | lessons 2 |
| W5 | v13-host | `mode-keys.ts` (bindings), `mode.ts:125-143`, `feature.ts:337`, `bridge.ts:341-362`, `lessons.ts:398-401` | B, Z and the Escape menu's next and previous step and lesson and repeat call the runner, each recorded first as a `key` event with its `REPLAY_KEY_ACTIONS` value; Z is `runner.repeat(t)`, not the last line | a recording with B, Z and the menu replays PASS | lessons 3 |
| W6 | v13-host | `sonic/lessons.ts:390-396` `status()`, `feature.ts:339-345` | I says `runner.statusLine()`; the panel of M41-7 draws `runner.view()` | "Lesson 6 of 28: ... Step 2 of 2. Attempt 2. Counted 0 of 3." | lessons 4 |
| W7 | assign | `packages/prefs/src/doc.ts:212-221`, `sonic/start-model.ts:44` | keep `skipped` in saved progress; a skipped state on the start screen | `packages/prefs/test/sonic.test.ts` with a skipped lesson | lessons 5 |
| W8 | v13-host | `sonic/bridge.ts:268-271` (the session pause and resume), `:443-451` `spoken()` | `runner.pause(t)` and `resume(t)` with the same t; no `spoken` while paused, once after resume | a question asked before the menu does not time out; a paused session replays PASS | lessons 6 |
| W9 | assign | `sonic-session/replay-player.ts` | with a `lesson-version` note, speak the recorded speech text at its t and say once it was flown with an older version | `sonicrec-replay` "the player feeds the engine" with the v0.12 fixture: every recorded line | lessons 7 |
| W10 | assign | `sonic-session/replay-control.ts:161-166` `summary()` | the line from `replayVerdict(check)`: pass, "recorded with an older build" (new key in the simulator's locales), fail | the v0.12 fixture shows the older-build line, a moved flight FAIL | merge item d |
| W11 | assign | `sonic-session/frames.ts:58-69` `FrameSampler.take` | keep every sample with `touched` (with this repository's M1 fix) | a bench flight into tunnel-narrow's walls three times replays PASS; without the rule FAIL on the touch's position | this review, M1 |
| W12 | assign | `app/builtin/sound.ts:113-121`, `sonic/audio.ts:16` | the motor into `engine.motorInput ?? auxInput`; `PageEngine` picks `motorInput` and `plan` | a bench test that the mode's motor reaches `motorInput`; `sonic-audio:181`, `:629` | sound M41-16 |
| W13 | v13-host | the mode's settings (M41-3, M41-4), `sonic/entry.ts:85` `update()` | offer `motorGainDb` ("Motor volume", -24 to 6 dB in 3 dB steps) and `heightTarget` ("Target height note") | saved and read back; said through `engine.say()` | sound |
| W14 | v13-host | the panel of M41-25 | the height bar from `engine.plan.height` (tone, target, note every `periodS`), the radar from the active cues and `plan.freeWay.side`; a repeat step shows the cue it plays | page proof | sound |
| W15 | v13-host | every menu, progress and status line | through `engine.say()` (the theme's voice level; a separate `speechSynthesis` call is 7 to 11 LU louder) | no `speechSynthesis` outside the engine | sound |
| W16 | v13-look | `lesson-world.ts:74`, `tools/bench/src/sonic-analytic-cost.ts` | tunnel-long's collider (voxel 0.05 m, bounds 102 x 4.4 x 65 m) and the planner's extra rays (6 a frame, up to 160 near a block): one run of the cost benches | within v0.12's frame budget | worlds 2, sound |
| W17 | v13-look | a headless page flight | full stick in walls-hall to the first touch (the model says 2 to 3 s); a respawn in a tunnel's way under a block rests on the respawn platform (with M41-19) | the measured seconds; no stuck craft | worlds 2, 4 |
| W18 | v13-host | `sonic/start-model.ts:40` | 28 lessons by `order` (already sorted so) | `sonic-start:24`, `:37` with the new counts | worlds 3 |
| W19 | v13-host | `tools/bench/test/sonic-int-replay.test.ts:245` | pin down rings-first's 1.3 % of cue kinds (play edges or not) with W9 | the bound explained, not only lowered | R4 |
| W20 | assign | `tools/bench/test/*` | the 52 test changes of the table above | 593 of 593 but the 8 skipped | this review, R4, sound M6 |

After the fixes in this repository (`docs/dev/status-v0.13-merge.md`, steps 12 to 19) the list stands as written, W11
with this repository's half of M1 done. The table above was measured at e101f7c: since then hover-height's and the
corridor's tasks each have one more line with three plays, tunnel-gaps' task plays the open-way chime three times, the
last checkpoint of the corridor and of every tunnel no longer chimes (the fanfare alone ends them), and the corridor's
intro has four lines. W20 runs the simulator's tests against the tip it moves the gitlink to, and takes its numbers
there.

## Before `main`, in this repository

Done on `s13-merge` after this review: items 1 to 3 below, each with a test that fails without it, and the checks with
fresh evidence (`docs/dev/status-v0.13-merge.md`, steps 12 to 19, "Final status after the review").

For the lead, on `s13-merge`, before it becomes `main` (wave 2 changes only the simulator):

1. M1: `fly()` counts the frame's checkpoints and world points before the touch; `test/helpers/record.ts` records the
   sample's position and every touched sample; a test replays corridor and tunnel flights with touches (PASS), with its
   control (the old order: FAIL).
2. M2 and M3: the lines and `cues` of hover-height, rings-heights, the corridor and tunnel-gaps, in four languages; the
   English lines measured as the others were (`test/fixtures/tts-en-david.json`); `pnpm listen` again (its evidence is
   keyed by the lessons).
3. m1 to m3 when convenient: the corridor's `intro.3` and the tunnels' last chime; the three stale counts; the two
   probes of checks 5 and 6 as tests.

## What I ran

- `pnpm typecheck` (three projects, 10 s): clean. `pnpm test`: 44 files, 1042 tests, 16 s, all pass. `pnpm listen`
  with its environment: the evidence is fresh for these inputs (418eab75ba5d), nothing to run. `pnpm proof:audio` not
  run: no code changed and its evidence is the merge's step 9.
- Probes (a test file in this tree, removed after): the 23 flying lessons with the truth bot and the imperfect pilot,
  the planner on every frame; 56 crashes; the chime at 9 blocks; flying back in 7 track lessons; same-build recordings
  of the corridor, tunnel-gaps, tunnel-long and rings-heights, honest and tampered; M1's fix tried and restored.
- The nine rules broken on purpose above; the merges' file-by-file and export and key checks; `gh_precheck` over the
  range in a scratch clone; the simulator's tests and `tsc` of `apps/fly` against this branch and against its pin.

Not checked: how any of it sounds to a person (no one has heard v0.13); the Spanish, Polish and Russian lines by a
native speaker aloud; the simulator with wave 2's changes; the page's frame cost.
