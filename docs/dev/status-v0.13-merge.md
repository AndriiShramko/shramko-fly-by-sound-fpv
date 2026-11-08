# Merge s13-merge: the v0.13 lanes s13-lessons, s13-sound and s13-worlds in one branch

Branch `s13-merge`, worktree `<sound checkout>`, cut from `main` 7d4b4b9 (what the live simulator ShramkoGSFPV v0.12
ships). It merges the three lanes of v0.13 of the sound package, each finished and reviewed once with every finding
fixed:

- s13-lessons at 14e00f0 (its notes `docs/dev/status-v0.13-lessons.md`, review `review-v0.13-lessons.md`);
- s13-sound at 3c73658, which contains `vl-spec` at 3044c7c, the virtual listener's design and rig (its notes
  `docs/dev/status-v0.13-sound.md`, review `review-v0.13-sound.md`);
- s13-worlds at 067278f (its notes `docs/dev/status-v0.13-worlds.md`, review `review-v0.13-worlds.md`).

Steps 1 to 6 merged the first two (b3b86de); s13-worlds was still fixing its review and merged after them, in steps 7
to 11. No push, no deploy. The lanes' notes were `docs/wip/` until step 10 made them public dev notes.

## Status

- [x] 1. Worktree and this doc with the checklist
- [x] 2. Merge s13-lessons (14e00f0): clean, main had not moved (74 files)
- [x] 3. Merge s13-sound (3c73658), every conflict resolved and listed ("Conflicts and their resolution" below)
- [x] 4a. The silence control of `test/silence.test.ts` with v0.12's layers (the lesson's layers without 'height' and
  'room'): with them and no target between attempts the pause of hover-turn and of move-stop is silent in 104 of 150
  frames (69 %, the control holds); with the lessons' own layers it is silent in 0 of 150 (the control as merged,
  failing: broken on purpose once, as in the merge's first test run). The real check now runs with both: a target in
  every pause frame and no silent frame in all 9 lessons, own layers and v0.12's.
- [x] 4b. `test/repeat-plays.test.ts` passes (2 of 2) with s13-sound's repeat-cue case, which honours `durS`
  (`REPEAT_PLAY_DEFAULT_S` 2.5 only when absent). With `durS` ignored on purpose (the planner always 2.5 s), once,
  then restored: its main check still passed (the default is the runner's continuous play, and a one-off cue ends
  inside its slot by itself), its control failed (0 plays cut short, at least 30 wanted: the 0.9 s plays it asks
  for were not short any more), and `test/events.test.ts` failed (a fanfare given a 0.5 s play lasted 1.19 s). The
  test's header and the control's title now say so; nothing else changed.
- [x] 4c. `ONE_OFF_PLAY_S` (`src/lesson/sounds.ts`) gets s13-sound's one-off cues: `safety.wrong-way` 0.65 s,
  `safety.wrong-side` 0.55, `target.praise` 0.5, `target.stage` 1.0 (their notes end at 0.63, 0.54, 0.46 and 0.96 s
  in every built-in theme, calm or not). No lesson names them yet, so a new test in `test/repeat-plays.test.ts` holds
  the whole table to the planner for every cue of `CUE_IDS`: a cue played as notes has a slot no shorter than its
  notes and its next play within 2 s, a continuous cue has none. Before the four entries it failed on exactly those
  four cues (24 cases: 3 themes, calm or not); with them it passes, and the full suite is 754 of 754.
- [x] 4d. The replay's verdict (`src/replay/compare.ts`, the package's place for the check's text: English lines for
  logs and reports, as PASS and FAIL were): `ReplayVerdict` 'pass' | 'older-build' | 'fail', `ReplayCheck.verdict`
  (optional in the type, always set by `compareReplay`, so the simulator's own `mergeChecks` still compiles) and
  `replayVerdict(check)`. 'older-build' when the recording does not re-derive and a lesson or theme version in it is
  lower than this build's, none higher (`ReplayNote.recorded` and `here` on the two version notes); the line is
  "replay check: recorded with an older build (lesson rings-first is version 2 here, the session was flown with 1;
  theme soft is version 2 here, the session was flown with 1), so this build cannot verify it: events 2 of 10 ...".
  The report tool's `replayCheck` carries `verdict`; README and CHANGELOG say so. `test/replay-v012.test.ts` relaxed
  to it (both v0.12 recordings: 'older-build', no FAIL; rings-first 2 of 10 events re-derived, walls-hall 5 of 14,
  cues 0 % of their frames: goal, gate, reset and speech events differ besides the lesson's version). Negative
  controls: the same recording claiming this build's versions, and the moved flight of `test/replay.test.ts` with
  its own manifest, are FAIL; a newer lesson version, an older lesson with a newer theme, another world or an unknown
  theme are FAIL too. Broken on purpose twice, then restored: every failure told as an older build fails 4 tests
  (both controls of the v0.12 file, the moved flight, the verdict table); any version difference told as older fails
  2. Full suite 756 of 756.
- [x] 4e. The lines of walls-hall and the corridor say what the knocks of v0.13 mean (s13-sound review m4; the goal
  stayed `stopWithinM` 3 here; since the s13-worlds merge, step 7, it is 1.5). en: `lesson.walls-hall.intro.2` "Fly
  slowly toward a wall until you hear knocks, then stop.", `lesson.walls-hall.hint.1` "Fly to the wall slowly. Stop as
  soon as you hear knocks.",
  `lesson.corridor.intro.2` "Stay in the middle. Knocks from one side mean you are drifting toward that wall. Move
  away from it."; es, pl and ru say the same as people say it there (`locales/*.json`). Locale lint 0 problems (4
  languages, 469 keys), layout check 0 problems. The three English lines were measured again with the Windows voice
  of `test/fixtures/tts-en-david.json` (Microsoft David Desktop, the same method; an unchanged line, walls-hall's
  intro.1, measured 8.64 s as in the fixture): 4.56, 4.92 and 7.515 s; the schedule test's recorded fact is now 263
  of the 376 English lines longer than the estimate (262 before, with the old lines). No person has heard the new
  lines yet; es, pl and ru have no local voice on this machine (s13-sound's M4).
- [x] 4f. `docs/design/virtual-listener.md` without the build machine's install folders (review m8 of s13-sound). The
  install steps are the document's section 8, "Install" (it has sections 0 to 13 and Sources; the "section 14" of the
  merge brief is that one): the commands, the environment line and the probe environments now use `<venv>`,
  `<cache>`, `<tools>` and `<downloads>`, defined above the block as `tools/listen/requirements.txt` has them, and
  `7z` for 7-Zip's command line. No drive-letter folder is left but `GPU_LOCK`'s default `C:/dev/.gpu-lock` in
  section 6.5, which is the default in the code itself (`tools/listen.ts`, the proofs on `main`), so it stays.
  `test/docs.test.ts` 8 of 8.
- [x] 5. Full checks on the final code (8eae637; the commits after it hold only evidence and this doc), all passing:
  `pnpm typecheck` clean; `pnpm test` 36 files, 756 tests (9.4 s); locale lint 0 problems (4 languages, 469 keys);
  layout check 0 problems; `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio` 3 files, 9 proofs, 48.8 s (headless Chrome
  156.0.8078.80; the five audio proofs pass and their broken controls fail; both evidence files rewritten, only their
  dates changed; 371afd8); `pnpm listen` with `SHRAMKO_LISTEN_PY` (the environment of `tools/listen/requirements.txt`,
  Python 3.11.9), `SHRAMKO_LISTEN_CACHE` on the data disk and `GPU_LOCK` as the lane ran it: 24 of 24 renders, 8 of 8
  checks valid and passing, 88.6 s, fresh for inputs 67e227c5d9ad (112 files; s13-sound's last run was ca2ea78c02fb).
  Its numbers did not move from s13-sound's (table in "Final status").
- [x] 6. Final status: what merged, the conflicts, the merge items with their commits, the checks with numbers, what
  waits for s13-worlds, what each lane needs from the simulator ("Final status" below)

Steps 7 to 11, lane s13-worlds:

- [x] 7. Merge s13-worlds (067278f): conflicts in `lessons/corridor.json`, the four locales (walls-hall),
  `test/lesson-schedule.test.ts` and `test/progress.test.ts`, each resolved as s13-worlds' "For the lead's merge" says
  ("Conflicts and their resolution, step 7" below). walls-hall's lines read as one text in the four languages: a small
  room, and `goal.1` now asks for a stop close to the wall (its goal is `stopWithinM` 1.5, s13-worlds' review M5; the
  note of item 4e that the goal stays 3 m is superseded). After the merge: `pnpm typecheck` clean, `pnpm test` 1004 of
  1030 (44 files, 20 s); the 26 that fail are step 8's: the seven merged cases of `test/world-track-end.test.ts` (item
  a), 16 tests of s13-lessons that fly v0.12's numbers (item c; its `test/progress.test.ts` pair was already taken from
  the world by s13-worlds' own edit, which git merged), s13-sound's two (item c) and `test/world-versions.test.ts`'s
  line for a v0.12 recording, written before item d's verdict (item c).
- [x] 8a. The corridor and the six tunnels end on `track-end` (s13-lessons R5, s13-worlds M1 and M2): the six tunnels'
  `goals` are `[{ "kind": "track-end" }]`, the corridor's `[{ "kind": "fly-distance", "metres": 15 }, { "kind":
  "track-end" }]` (its straight first, so its two goal lines stay). `test/world-track-end.test.ts` runs its seven merged
  cases, none skipped, and all pass (the truth bot and a pilot whose path is 10 % longer are counted only past the last
  obstacle and corner, at the end of the track); with the goals as merged (fly-distance) the same seven failed in step
  7's run ("expected [ 'fly-distance' ] to deeply equal [ 'track-end' ]"). `test/world-tunnels.test.ts`' truth bot in
  tunnel-long now fails (FF: the attempt never ends), which is item b.
- [x] 8b. `passWorldPoints` (`src/lesson/runner.ts`, s13-worlds' "Needs from other lanes" 7): a point of the world's
  track is passed when `before < -PASS_POINT_TOLERANCE_M && after >= -PASS_POINT_TOLERANCE_M`, the new constant 1e-6 m
  (the truth bot stops on the last point and can be left 1e-12 m short of it in tunnel-long, so a `track-end` attempt
  never ended). Broken on purpose once (the constant 0, the rule as merged), then restored: 3 tests fail
  (`test/world-tunnels.test.ts`, the truth bot in tunnel-long, FF; `test/pass-rule.test.ts`, the truth bot in exactly r
  attempts and the pilot who fails every other attempt); with 1e-6 they pass, with `test/world-track-end.test.ts` and
  `test/track.test.ts` (133 tests in the four files).
- [x] 8c. The tests that flew v0.12's numbers take their positions from the worlds (landmarks, objects' `pos`, the
  world's checkpoints and the lesson's), as s13-worlds did for its own; no assertion was dropped or loosened, three got
  stronger. The 19 that failed after item b, each passing now (full suite 1030 of 1030):
  - `test/direction.test.ts` 3: the corridor's wrong way flown on its first straight (to `section-obstacle`, 15 m, and
    14 m back at 2 m/s: 2 lines, as before); "the world's own list" now starts from the shipped world having one (it
    rules), the reversed list lies along that straight, a broken list hands the track to the lesson's checkpoints, and a
    new control flies the same way with the shipped list (no line); the gate crossed from its back side flown in the
    gates' own frame, beside ring 2 by its frame and 2.5 m (inside the 10 m room). Two passing tests of the file that
    also flew v0.12's corridor and hall numbers through walls (the slow drift back, the same way back) take the same
    positions; the drift also asserts that no touch moved the craft.
  - `test/navigation.test.ts` 1, `test/pause.test.ts` 2: rings-first through its ring from 3 m before to 3 m past it.
  - `test/praise.test.ts` 4: rings-first the same way; the corridor's stages: its line now reaches cp-6, the end
    checkpoint the merge moved to the world's end, so the list is cp-1 to cp-6; R6's world list lies along the first
    straight (stage 1 marked at -8 m, the lesson's cp-2 at -15 m reached at -14 m) and asserts no touch; R5's control,
    whose "shipped 240 m" is gone (item a), is now a distance goal of the track less 5 m (120 m, s13-worlds' own goal
    until item a), which passes in the last section without its end (cp-6), after the four stages.
  - `test/respawn.test.ts` 4 (and three passing ones that flew through walls): the lesson-checkpoint respawn is tested
    on the corridor's world without a list of its own (as v0.12 built it: `lessonTrack` source 'checkpoints'), at cp-3
    facing the bends; 1 m before it lies 0.25 m from the straight's side wall, so the runner's rule (more than the hull
    and 0.2 m clear) places the craft on cp-3 with its pose, which the test now says and checks; the world-list respawn
    flies the same way into the first bend with the shipped list (back 1 m before `w10`, facing +X, not cp-3); "the
    path flown goes back" now records where the goal is met (it returned the end of the flight, so it could not fail)
    and touches at 13 m, back to 1 m before the world's point at 10 m; R9's attempt runs out 1 m past cp-2, which is
    the world's point `w4`, and starts again 1 m before it.
  - `test/runner.test.ts` 2: 1 m past cp-2, the last point passed is the world's `w4` at cp-2: back 1 m before it.
  - s13-sound's `test/ttc.test.ts` "the 0.5 m pillar": v0.12's pillar pinned, `makeSpec('pillars', { layout:
    'single', aheadM: 15 }, 0, 1)`.
  - `test/replay-v012.test.ts`, the control "claiming the current versions": replayed on the recording's own walls
    (this build's rings-first with v0.12's world, start, assists and goals from
    `test/fixtures/v012-lesson-geometry.json`): no note, exact, verdict 'fail' and "replay check FAIL", never "older
    build".
  - `test/world-versions.test.ts` (s13-worlds, written before item d): the v0.12 walls-hall recording replayed with the
    shipped lesson is verdict 'older-build', "recorded with an older build (lesson walls-hall is version 2 here, ...",
    and names the walls it was flown in.
  - Then every test flight was checked for walls (a probe, not committed: the scripted pilot, the recording host and the
    runner test's pilot logged each sample whose centre lay inside a solid of the lesson's world, over the whole suite):
    three tests still flew through walls, all passing, all s13-lessons' review R1 in `test/direction.test.ts`
    (rings-line 222 samples, rings-small 299, the course control 52: v0.12's 6 m beside a ring and 12 m back, in rooms 9
    and 10 m wide). They now pass ring 2 beside it by its frame and 2.5 m on the side with more room, 3 m past it (short
    of ring 3), fly back to its front short of ring 1, and the control flies back to 0.6 m before the room's back wall
    (further than `LINE_UP_M` from ring 2 for about 1.5 s). The probe then logs no sample in a wall. Broken on purpose
    once (the wrong way judged against the track in a course too, R1 undone), the three R1 cases fail; restored, 10 of
    10.
- [x] 8d. The corridor's `attemptLimitS` was v0.12's 900 s, set for v0.12's corridor (5 x 4 m, its world's track 323.5
  m, its sections 335 m: 2.8 s a metre, about 8 times the track at the cap of 3 m/s). The corridor's track is 125.2 m
  now: the same 2.8 s a metre is 348 s, so its limit is 350 s. Every limit of the seven lessons that end on
  `track-end` lets a pilot at 1 m/s fly the track twice (s; the track in m, twice it at 1 m/s in s): corridor 350
  (125.2, 250), tunnel-wide 120 (31.5, 63), tunnel-narrow 120 (26.3, 53), tunnel-narrower 120 (20.7, 41), tunnel-bends
  150 (40.6, 81), tunnel-gaps 150 (34.8, 70), tunnel-long 600 (149.8, 300); the tunnels' limits stay as s13-worlds
  set them. A new test in `test/world-track-end.test.ts` holds both rules (twice the track at 1 m/s; the corridor's
  seconds per metre v0.12's, to 10 s). Broken on purpose twice, then restored: the corridor at 900 s as merged fails
  ("900 s against 348 s"), tunnel-long at 250 s fails ("149.8 m of track: expected 250 to be greater than or equal to
  299.5"). Full suite 1031 of 1031.
- [x] 8e. The glossary tells the open-way chime from the checkpoint chime (s13-worlds review M8). Both are two notes;
  what tells them apart is that the open way repeats its pair (every 0.6 s, 0.16 s notes) from the free side while
  something blocks the way, and the checkpoint sounds its two notes once, low to high. The lines said "Two quick notes"
  and "A short double chime" (and the same in the three other languages; the Russian words for the two were the
  closest), the same thing in other words. Now `cue.safety.free.glossary` begins "A pair of quick notes, again and
  again, while something blocks the way ahead." (the rest of the line as it was) and `cue.target.checkpoint.glossary` is
  "One chime from low to high, only once, when you reach a checkpoint."; Spanish, Polish and Russian say the same with
  their own words for "again and again" and "only once". A new test in `test/events.test.ts` checks the sounds (the
  open-way voice's period longer than its note; the checkpoint two notes, the second higher) and the words in the four
  languages ("again and again" for the one, "only once" for the other, never the other's); on the merged lines it failed
  ("en: expected 'Two quick notes ...' to match /again and again/"). Found while reading the lines that name the
  open-way chime: tunnel-gaps' intro.3 (s13-worlds) said "A high chime means the way is above it, a low one below", by
  register, which s13-sound's review m2 replaced by the contour with the pilot's height polarity (for a pilot with
  'up-lower' a way above sounds lower); it now says "If the chime moves like your height tone in a climb, the way is
  above it. If it moves the other way, below." in the four languages, as the glossary does, and
  `test/world-tunnels.test.ts` checks that wording (no "high chime"). The English checkpoint line was measured as goal.1
  was: 5.175 s, longer than its estimate (the old line, 3.295 s, was shorter), so the schedule test's fact is 264 of 376
  lines (was 263). Locale lint 0 problems (521 keys), layout 0, full suite 1032 of 1032. No person has read the new
  lines aloud in Spanish, Polish or Russian.
- [x] 8f. `ears-glossary` (the G key's dictionary, "you meet every sound you will hear while flying") names every cue
  id of `CUE_IDS`, 26 in the catalogue's order: s13-sound's `safety.free`, `safety.wrong-way`, `safety.wrong-side`,
  `height.target`, `target.praise` and `target.stage` beside the 20 of v0.12 (left open 1 of step 6). Their lines and
  play lengths were there (`ONE_OFF_PLAY_S` of item 4c for the four one-off cues, the continuous play for the other
  two). The lesson stays version 2 (unreleased since v0.12). Tests: `test/lessons.test.ts` "keep the promises their
  texts make" now holds the glossary to `CUE_IDS` (on the merged lesson it failed: 20 against 26);
  `test/repeat-plays.test.ts` 78 plays (was 60), `test/progress.test.ts` and `test/navigation.test.ts` 1 + 26 steps
  (was 21); the schedule's every-sound-three-times check passes with all five speech models; the glossary takes 8.4
  minutes with the measured voice (its bound in `test/lesson-schedule.test.ts` is 9). Full suite 1032 of 1032.
- [x] 8g. The truth bot in the ring and shape lessons (rings-first, rings-line, rings-small, rings-heights,
  rings-course, shapes-square, shapes-series, shapes-cube), flown to each lesson's pass (a probe, then a test): no
  wrong-way event. Its 4 m before and past each gate does fly back 1 to 3 m between gates 5 to 7 m apart, but that stays
  within `LINE_UP_M` (8 m) in front of the gate that counts next, where s13-lessons' rule (review R1) tells nothing, so
  its track stays as it is and the pass-rule tests keep their exact numbers. The same probe found a wrong-SIDE event at
  the start of every attempt after the first in seven of them (rings-first, -line, -small, -heights 2 each, the three
  shapes 1 each): s13-lessons' runner places the craft at the start for a new attempt without setting its last sample
  aside (the resume branch and every reset did), so the jump from past the gate to the start crossed the gate from its
  back side through its opening. A pilot would have heard "That gate was passed from the wrong side" at the "Go." of
  attempts 2 and 3. `src/lesson/runner.ts`: that place sets the last sample aside too, and a move of `JUMP_M` (3 m, the
  rule the path flown already had) or more from one frame to the next crosses no gate, point or checkpoint, nor does the
  frame of a place; without the second rule the replay of a host that never reports the end of speech
  (`test/replay.test.ts`, 'estimate') began the attempt two frames before the recorded jump and derived the line the
  live run no longer said. New test in `test/direction.test.ts`: the truth bot flies each of the eight lessons to its
  pass, no touch, no wrong-way and no wrong-side cue or line. Broken on purpose (neither rule): 7 of the 8 fail
  (rings-course passes in one attempt); either rule alone makes them pass, the jump rule also the replay. Full suite
  1040 of 1040.
- [x] 8h. rings-heights' target tone follows the next ring, and the glide meets it in unison there; its rings are on
  the lesson's 0.5 m grid (s13-sound's item for s13-worlds), which they were not: the rings' centres were 2.5, 1.2, 3.8,
  1.2 and 2.5 m (middle, floor, ceiling, floor, middle in a 5 m room), 1.3 m (2.6 steps) from the first ring, the
  reference the height mapping is aligned on, so the target notes of rings 2 to 4 were off the scale (`onScale` false;
  in exact unison all the same). The levels follow the room (floor and ceiling 0.3 m plus the ring's reach of 0.9 m,
  the middle half the height), so a grid needs the middle 1.5 m from the floor and the ceiling (1 m would join the
  bands of 1.4 m rings, review M3), and then a floor-to-ceiling change of 3 m does not fit a 6 m leg at the climb cap
  of 1.5 m/s. Now: a room 5.4 m high (9 x 36.5 x 5.4) and the order middle, floor, middle, ceiling, middle: centres
  2.7, 1.2, 2.7, 4.2, 2.7 m, every leg a change of 1.5 m (3 notes; 1.37 s of climb in the 2.34 s of the leg), the bands
  floor 0.62 to 1.78, middle 2.12 to 3.28, ceiling 3.62 to 4.78 m (0.34 m apart), the start at 2.7 m, the ceiling 2.09
  s from it; ring size, spacing, caps, layers, goals and lines as s13-worlds set them (the intro names no order). New
  test in `test/height.test.ts`: the truth bot flies the five rings with the planner of the lesson's layers; in every
  frame the target is the centre of the ring that counts next and a note of the scale, every ring is on the 0.5 m grid
  of the first, and on the last metres to each ring the glide is in unison with the target (the same position and
  frequency). On the merged lesson it failed ("ring-2: expected 0.6000000000000001 to be less than 1e-9"). s13-worlds'
  tests pass on the new layout (the bands, the margins, every change fits its leg, the truth bot, the room in 2 to 3 s);
  the M3 control (the same lesson with 2 m rings) still finds one height through four of the five rings, now 2 m
  through rings 1, 2, 3 and 5. Full suite 1041 of 1041.
- [x] 8i. A recording whose only difference is the world's id (the lesson's and the theme's versions equal) stays FAIL,
  as item d made it (the verdict table of `test/replay.test.ts`: "the world is ..." under the build's own versions is
  'fail'), and the code and the tests now say why: a lesson's world changes only with a new lesson version, so a world
  changed under the same version is a defect, never an older build (`ReplayVerdict`'s comment in
  `src/replay/compare.ts`; the verdict table's name and comment). New test in `test/world-versions.test.ts`: every
  lesson whose world changed since v0.12 (14 of the 15 in s13-worlds' fixture of the v0.12 worlds) has a newer lesson
  version than v0.12's, so its v0.12 recordings read "recorded with an older build". Broken on purpose once (walls-hall
  at version 1): "walls-hall: the world hall-67e9057a of v0.12 is hall-4fed66a6 here: expected 1 to be greater than 1";
  restored.
- [x] 8j. `CHANGELOG.md` (Unreleased) has, beside s13-lessons' entry and the replay verdict, "The sounds of v0.13"
  (the height glide and its target note, walls by time to contact, the open-way chime, the event sounds, the motor
  under the cues, never silence, the voice level, the six new cue ids and the glossary of 26, `engine.plan`, the
  listener's rig) and "Rooms, tunnels and rings at the scale of a micro drone" (generators version by version, the
  small rooms and walls-hall's 1.5 m, the corridor of 125 m ending on `track-end` in 350 s, the seven new lessons:
  28, a fast path of 8, `cavities` and `checkpoints`). README: the idea's new bullet on the new sounds, the Sound Lab's
  26 cues (it previews every id of `CUE_IDS`; it said 20), "28 in modules 0 to 7, and a fast path of 8", and that every
  published generator version still builds. llms.txt: the layers of v0.13, the micro-drone rooms, the generators
  pinned version by version. AGENTS.md: the map's world, sense and lessons rows (28, the fast path of 8) and a rule
  that every cue id is in the glossary and every flying lesson has the height and room layers; its generator rule was
  s13-worlds'. Also "21 lessons" in the full tier of `docs/design/virtual-listener.md` and the examples of two
  comments in `src/lesson/runner.ts` ("Lesson 6 of 28"). `test/docs.test.ts` 8 of 8, full suite 1042 of 1042. The
  typecheck was not clean from item g's commit (7a60194) to this one (04f1b9c): item g's new test compared
  `p.run.phase` with 'passed' after the loop had narrowed it (TS2367; vitest does not typecheck). Fixed in the next
  commit (the phase read through a function, as the other tests do); the typecheck is clean since.
- [x] 9. Full checks on the final code with fresh evidence, all passing (the code of a393b74; the commits after it hold
  only evidence and documents, which no check is keyed by):
  - part 1 (a393b74): `pnpm typecheck` clean (three projects, 10.6 s); `pnpm test` 44 files, 1042 tests (17.1 s); `node
    tools/run-tool.mjs locale-lint` 0 problems (4 languages, 521 keys); `node tools/run-tool.mjs check-layout` 0
    problems; `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio` 3 files, 9 proofs, 48.5 s (headless Chrome 156.0.8078.80; the
    five audio proofs pass and their broken controls fail, the demo's keyboard-only check passes; both evidence files
    rewritten: their dates, and the demo flight's turn 60 degrees, was 61)
  - part 2: `pnpm listen` with `SHRAMKO_LISTEN_PY` (`tools/listen/requirements.txt`'s environment),
    `SHRAMKO_LISTEN_CACHE` on the data disk and `GPU_LOCK`: 24 of 24 renders, 8 of 8 checks valid and passing, 88.7 s,
    fresh for inputs 418eab75ba5d (125 files; step 5's run was 67e227c5d9ad, 112 files); a second run says the evidence
    is fresh, nothing to run. Its numbers are step 5's but VL-0a's (1.8e-7, was 2.4e-7): VL-0b residual -131.1 dB (a
    stem left out: -3.0 dB); VL-pitch largest step 3.7 cents per 10 ms (v0.12's stepped tone 118.7); VL-onset 2.475,
    2.493, 2.475 s at 1, 3, 5 m/s (distance only at 5 m/s: 1.18 s); VL-6-speech soft 4.76, clear 4.66, race 4.64 LU
    (volume 1: 11.26, 7.91, 10.39); VL-6-peak -6.99, -3.74, -6.26 dBTP (volume 1: -0.52, -0.51, -0.49); VL-2-motor worst
    15.0 dB (Air65, shape; Pavo20 30.3, Meteor65 20.1, Pavo Pico 22.3, 5-inch 24.2; the motor 11.0 to 12.1 LU under the
    cues, 14.05 for the 5-inch; raw motor at 60 %: shape 0.9 dB); VL-3-height in the band at most 1.1 % (2 to 70 Hz),
    out of it a 43 % buzz (the steady pair of before review M2: 44 %).
- [x] 10. The lanes' notes are public dev notes, as stage 1's are (`docs/dev/status-stage-1.md`, `review-stage-1.md`):
  `git mv` of `docs/wip/s13-lessons.md` to `docs/dev/status-v0.13-lessons.md`, `s13-lessons-review.md` to
  `review-v0.13-lessons.md`, the same for sound and worlds, and `s13-merge.md` to `status-v0.13-merge.md` (this doc);
  `docs/wip/` is gone. Every reference to the seven files in the tree points at the new paths
  (`docs/design/stage-1-spec.md`, the notes themselves, this doc; the code's four in part 1); the references to the
  simulator's own `docs/wip/v12-plan.md` and `v13-plan.md` stay, they are in ShramkoGSFPV, and so do four sentences of
  the sound lane's notes about whether `docs/wip/` would be published (review m8), which say what was true then.
  README's development section and AGENTS.md's map link the v0.13 notes. The build machine's folders in `docs/`, README,
  AGENTS.md and llms.txt are placeholders: the simulator's checkout is `<simulator checkout>` (four places), the lanes'
  and the merge's worktrees `<sound checkout>` (four), the scratch folder of the v0.12 fixtures `<scratch>` (one); a
  grep for a drive-letter path, a user's folder or a home folder there finds only `GPU_LOCK`'s default
  `C:/dev/.gpu-lock`, the default in the code (`tools/listen.ts`, the proofs), which stays. `test/docs.test.ts` 8 of 8.
  - part 1, before step 9 (done): the four comments in `src/` and `test/` that named a lane's note now name its public
    path (`docs/dev/status-v0.13-lessons.md`, `status-v0.13-worlds.md`), so the code step 9 checks is the final code
    (the listener's evidence is keyed by every file of `src/`; the rest of step 10 touches only `docs/`, README,
    AGENTS.md and llms.txt, which no check's evidence is keyed by).
- [x] 11. Final status of the whole merge ("Final status" below; the status of steps 1 to 6 follows it as it was). In
  the same commit: item 8e's test held its Russian words as Cyrillic letters, which the tests write as `\u` escapes;
  they are escapes now (the test file only, nothing the proofs or the listener read), and this doc says the lines of the
  other languages in English. On that tree: typecheck clean, `pnpm test` 44 files, 1042 tests, locale lint and layout 0
  problems, the listener's evidence fresh (418eab75ba5d).

Steps 12 to 19, the review of the merge (`docs/dev/review-v0.13-merge.md`, at ab7f591): each finding first tried against
the code and a run, then fixed with a test that fails without the fix (what was done and why: "Review fixes" below). The
simulator's part stays in the review's wave 2 list.

- [x] 12. M1. A recording with a touch in the corridor or a tunnel replays PASS: a frame's points before its touch; the
  test host writes what the simulator writes, and every touched sample (W11)
- [x] 13. M2. The target note named and played where it first sounds (hover-height); rings-heights' words for it
- [x] 14. M3. The open-way chime named and played in the corridor and in tunnel-gaps
- [x] 15. m1. The corridor's checkpoints line and its plays; the chime of a track's last checkpoint (one commit with 14)
- [x] 16. m2. The stale lesson counts in `CITATION.cff`, `src/contract.ts` and `docs/testing/test-protocol.md`
- [x] 17. m3. Tests for the six tunnels' respawn and the open-way chime at the shipped obstacles
- [x] 18. n1. s13-worlds' Russian sentence in `test/progress.test.ts`, as `\u` escapes
- [ ] 19. All checks on the final code with fresh evidence; the final status
  - part 1 (done): `CHANGELOG.md` (Unreleased) says what the fixes change for a pilot and for a host's recorder;
    AGENTS.md's glossary rule names `test/named-sounds.test.ts`
  - part 2 (done, on 626d38e): `pnpm typecheck` clean (three projects); `pnpm test` 47 files, 1062 tests (17.3 s);
    locale lint 0 problems (4 languages, 523 keys); layout check 0 problems; `GPU_LOCK=C:/dev/.gpu-lock pnpm
    proof:audio` 3 files, 9 proofs, 48.6 s (headless Chrome 156.0.8078.80; the five audio proofs pass and their broken
    controls fail, the demo's keyboard-only check passes; both evidence files rewritten: their dates, and the demo
    flight's turn 61 degrees, was 60)

## Review fixes (steps 12 to 19)

### 12. M1: a recording with a touch in the corridor or a tunnel reads PASS

- Tried first (a probe, not committed): the corridor, tunnel-gaps, tunnel-long and tunnel-narrow recorded by
  `test/helpers/record.ts` with one touch each, after the sixth point of the world's list (at it, the frame after its
  crossing, or halfway to the next; on a frame the recording keeps or not): all 16 read FAIL ("wall at 47133 ms:
  position differs by 1.00 m", "wall at 24650 ms is recorded but the replay did not derive it", "speed 0 m/s recorded, 2
  m/s re-derived"). Both causes hold. The test host wrote a frame's position after the runner's place (the respawn), and
  the simulator's `FrameSampler` drops a touch's own sample when it is not due (one in two of 60 Hz): either way the
  replay derives the touch at the respawn. And `fly()` took a frame's touch, and its respawn, before the points the
  frame crossed: with the host fixed alone, the corridor's touch the frame after crossing `w6` (a crossing frame the
  recording drops) still re-derived its reset to `w5`, where the live run went to `w6`.
- Fix: `fly()` (`src/lesson/runner.ts`) counts the lesson's checkpoints and `passWorldPoints` first and the touch after
  them (the two blocks moved, nothing else; the header's respawn paragraph says why). `test/helpers/record.ts` writes the
  sample the runner was given, as the simulator's sampler does (a place shows in the next frame), one in two, and every
  sample with a touch (`keepTouched`, default true: W11's rule; false is the sampler as it is). The replay's header
  says a recorder keeps every touched sample. With both, the 16 probe flights read PASS.
- Test, new `test/replay-touch.test.ts`: the corridor, tunnel-gaps and tunnel-long, each with two touches (the frame
  after crossing the sixth point, a frame the recording keeps while it drops the crossing one; halfway between the 10th
  and 11th on a frame that is not due), each back 1 m before `w6` and `w10`: the replay re-derives every event (touches
  and resets 2 of 2) and says PASS. Its control: the same tunnel-gaps flight written by a host that keeps only the due
  samples reads FAIL on the second touch. Broken on purpose, then restored: the old order in `fly()` fails the three PASS
  cases ("checkpoint:w6 ... is recorded but the replay did not derive it", `w5` derived instead), and so does the host
  writing the position after the place (the touches at the respawn). Full suite 1046 of 1046, typecheck clean.
- The simulator's half, `FrameSampler.take` keeping every sample with `touched`, is W11 of the review's wave 2 list.

### 13. M2: the target note is named and played where it first sounds

- Tried first (a probe, not committed): the truth bot flew 15 lessons with the planner given every frame and each
  lesson's layers. `height.target` sounds in every flying frame of hover-height (3052 of 3052 at 50 Hz), hover-turn,
  rings-first, rings-course and rings-heights; on the fast path no line names it (the glossary, lesson 1 of the full
  path, does; rings-heights, lesson 22, called it "the second, steady tone" and played nothing). The finding holds.
- Fix: hover-height has `intro.3` after the height tone and its buzz, with `cues: ["height.target"]`: "About once a
  second, a short note marks the best height. When your tone sounds the same, you are there." (es and pl say the same in
  their words, ru "the height you need"). rings-heights' `intro.2` is "You
  hear your height as a gliding tone. About once a second, a short note marks the height of the next ring." with
  `cues: ["height.tone", "height.target"]`, and `hint.1` "Before each ring, move up or down until your tone sounds the
  same as the short note."; its intro.3 and retry ("the two tones") stand for the tone and the note. The catalogue
  gives hover-height three intro lines; the lessons stay version 2 (unreleased).
- The English lines measured as the others were (Microsoft David Desktop, `measure-tts.ps1`'s method; hover-height's
  unchanged intro.2 measured 10.255 s, as in the fixture): hover-height's intro.3 7.715 s, rings-heights' intro.2 7.34
  s and hint.1 5.62 s, added to `test/fixtures/tts-en-david.json`. The schedule test's fact is 265 of 379 lines longer
  than the estimate (264 of 376 before; of the three only hover-height's line is longer).
- Tests: new `test/named-sounds.test.ts` flies every lesson of the fast path that has a world with the truth bot, the
  planner given every frame: each watched sound it hears (here the target note) must be named, by an intro line's
  `cues` or a name-cues goal, in that lesson or one before it on the path; it sees the note first in hover-height. The
  full path names it in its second lesson, the glossary; hover-height's line plays only the note, after the tone.
  `test/world-heights.test.ts`: rings-heights' intro says the short note and plays the tone and the note, no line of
  the lesson says "steady", the hint names the short note. `test/lesson-schedule.test.ts`: hover-height plays the tone,
  the buzz and the note three times each, each after its line; `test/demo.test.ts`: the demo host says intro.3 after the
  six plays, then the note three times, then the goal. Broken on purpose (both lesson files as merged), then restored:
  the three checks fail ("height.target sounds while flying hover-height, and no lesson so far named it"). Full suite
  1049 of 1049, typecheck clean, locale lint 0 problems (522 keys), layout 0.

### 14 and 15. M3 and m1: the corridor names the open way, its stages and the reset; a track's end is the fanfare

One commit: both change the corridor's intro.

- Tried first (the same probe as step 13): the open-way chime sounds in 988 of the corridor's 2147 flying frames at 50
  Hz (about 20 s, the first 4 s into the flight), in 64 of walls-pillar's (head-on to its pillar at the start), 140 to
  438 in tunnel-wide, -narrow, -narrower and -bends; tunnel-gaps' intro.2 names it and plays nothing. And in the truth
  bot's flights the corridor's cp-2 to cp-5 give the stage figure with "Stage k passed.", the checkpoint chime sounds
  once, at cp-6, 0.56 s before the fanfare, and every tunnel chimes its cp-2 0.5 to 0.84 s before its fanfare; a touch
  goes back 1 m before the last point of the world's list, not to a checkpoint. Both findings hold.
- M3: the corridor's new `intro.3`, after the walls' line, with `cues: [{ "cue": "safety.free", "from": "left" }]`:
  "When something blocks the way ahead, you hear a pair of quick notes again and again. They come from where the way
  goes on: left or right, or ahead if it goes up or down." (the glossary's words; es, pl and ru the same, Polish with
  "two quick notes", which cannot be heard as "a few"). tunnel-gaps' intro.2 plays the same cue. walls-pillar keeps its
  lines (the review left it to the owner: the full path names the chime in its second lesson, the glossary).
- m1: the corridor's checkpoint line is `intro.4` now, with `cues: ["target.stage", "safety.reset"]`: "The corridor
  has several stages. A sound tells you when you finish each one. If you touch a wall, you go back only a little way."
  And the runner chimes no checkpoint for the last of a lesson's checkpoints when its last goal is `track-end`
  (`endsTrack`, `src/lesson/runner.ts`; the header says so): the end of the corridor and of every tunnel is the
  fanfare alone, and the checkpoint chime is neither named nor heard in the corridor. The retry line ("from the last
  checkpoint") stands: a failed attempt begins again at the last point passed. The catalogue gives the corridor four
  intro lines.
- English lines measured the same way (the corridor's unchanged intro.2 again 7.515 s): intro.3 11.455 s (shorter
  than its estimate; the checkpoint line it replaces, 6.755 s, was 0.01 s longer than its own), intro.4 9.64 s
  (longer): 265 of 380 lines longer than the estimate.
- Tests: `test/named-sounds.test.ts` watches the open-way chime too and sees it first in the corridor, which names it;
  the corridor's and tunnel-gaps' lines that name the chime play it from the left; the corridor's intro.4 plays the
  stage figure and the reset, and names no checkpoint chime. `test/praise.test.ts`: the truth bot flies the corridor
  and the six tunnels to the pass; each reaches its last checkpoint, no checkpoint chime sounds, the last cue is the
  fanfare, the corridor says 4 stages and tunnel-long 5; control: the corridor without its stages chimes at cp-2 to
  cp-5 and not at its end, cp-6. Broken on purpose, then restored: both lesson files as merged fail three checks
  ("safety.free sounds while flying corridor, and no lesson so far named it"); the runner without the rule fails the
  end-of-track test ("corridor: expected [ { kind: 'checkpoint' } ] to deeply equal []"). Full suite 1052 of 1052,
  typecheck clean, locale lint 0 problems (523 keys), layout 0.

### 16. m2: the lesson counts in the public files

- Tried first: `CITATION.cff`'s abstract said "a curriculum of 21 lessons" (28 ship), `src/contract.ts` "part of the
  short path of about six lessons" and `docs/testing/test-protocol.md` "the short path (about six lessons)" (the fast
  path is 8); a grep found the same "about six" in `docs/design/stage-1-spec.md` and in the title of a test in
  `test/lessons.test.ts`, which asserts 5 to 8. The finding holds.
- Fix: the citation says 28; the contract's `fastPath` comment names `lessons/paths.json` and no number; the protocol
  says "the short path (8 lessons)"; the specification keeps its "about six" as the design said it and adds "8 since
  v0.13" with the lessons; the test's title says 5 to 8. The changelog keeps each release as it was.
- Test, `test/docs.test.ts`: the citation, the README, llms.txt, AGENTS.md and the protocol give the number of
  `SHIPPED_LESSON_IDS` and of the fast path of `lessonPaths()`; no public file but the changelog and the dev notes
  gives the fast path as about six lessons. Broken on purpose (the four files as merged), then restored: both fail
  ("expected ... to contain 'a curriculum of 28 lessons'"; the specification, the contract and the protocol listed).
  Full suite 1054 of 1054, typecheck clean, layout 0.

### 17. m3: the tunnels' respawn and the open-way chime at their obstacles, held by tests

- Tried first: `test/respawn.test.ts` tests the respawn on the corridor's world only, and `test/freeway.test.ts` flies
  box tunnels of its own; nothing flew the six tunnels' respawn or the lessons' own obstacles. The finding holds (the
  behaviour itself held, as the review measured).
- New `test/tunnels-flown.test.ts`. (1) The corridor and the six tunnels: the points of each world's track are 5 m
  apart or less; the scripted pilot flies the track and touches 0.3 m past every third point (corridor 17 touches,
  tunnel-long 20, the others 3 to 7): each reset names that point, the craft is 1 m before it (at the point itself in
  5 cases where 1 m before is too near a wall, as the runner's rule says), facing along the track, at least 0.35 m
  from every surface, 0.3 to 1.3 m back along the track (6 m at most, M41-20), and the lesson is passed in that same
  attempt. (2) Every obstacle of tunnel-gaps (4) and tunnel-long (5), flown straight at down the middle of the tunnel
  at the lesson's cap, from where its straight begins: in every frame under 3 s from it (47 to 68 frames) the planner
  names the side the generator left free and sounds the chime, and names no other side.
- Broken on purpose, then restored: `RESPAWN_BEFORE_M` 6.5 fails all seven respawn cases ("corridor w3: expected 5.5
  to be less than 1e-9"; before, one test failed); left and right swapped in `FREE_SIDE_AXES` fails the chime
  ("tunnel-gaps block-2: expected [ 'left' ] to deeply equal [ 'right' ]"). Full suite 1062 of 1062, typecheck clean.

### 18. n1: the Russian status line word for word

- Tried first: the merged test builds the Russian line from the locale's own template, so it holds the composition
  (the title, the numbers in their places) but not the words; a template reworded in `locales/ru.json` ("credited"
  said another way) still passed. The nit holds.
- Fix, `test/progress.test.ts`: s13-worlds' literal is back beside the composition, as `\u` escapes (the file stays
  ASCII): the title "Hold your height" in Russian, and the whole sentence "Lesson 6 of 28: Hold your height. Step 2 of
  2. Attempt 2. Counted 0 of 3." in Russian. Broken on purpose (that one word of the template changed), then restored:
  the literal fails, the composition alone would not. Full suite 1062 of 1062.

## Final status (2026-11-08, the whole merge)

Done, branch `s13-merge`, not pushed, nothing deployed; `main` (7d4b4b9) and the three lanes' branches are untouched.

What merged: s13-lessons at 14e00f0 (5db2b1d, clean), s13-sound at 3c73658 with vl-spec at 3044c7c (9eb98d7, three
conflicts) and s13-worlds at 067278f (4559896, seven conflicts). Every conflict and its resolution is in the two
tables at the end ("Conflicts and their resolution", steps 3 and 7); every other file both sides changed merged by
itself and was checked field by field (the contract as a union, the lesson files, the locales, the catalogue, the
registrations, every lesson's `order` and `fastPath`).

| Merge item | What | Commit |
|---|---|---|
| a | the silence control of `test/silence.test.ts` with v0.12's layers; the real check with both | aacabfd |
| b | `test/repeat-plays.test.ts` passes; `durS` honoured, checked broken once | a329d4d |
| c | `ONE_OFF_PLAY_S` for s13-sound's four event sounds, and a test of the whole table | aa3e789 |
| d | the replay's verdict "recorded with an older build", its negative controls | 6dc1a44 |
| e | walls-hall's and the corridor's lines for the knocks of v0.13, four languages | 543a5cb |
| f | placeholders for the build machine's folders in `docs/design/virtual-listener.md` | 8eae637 |
| 7 | merge s13-worlds; walls-hall's lines one text with its 1.5 m goal | 4559896 |
| 8a | the corridor `[fly-distance 15, track-end]`, the six tunnels `[track-end]` | 51a84d8 |
| 8b | `PASS_POINT_TOLERANCE_M`: a track point is crossed with a micrometre of tolerance | e3e1687 |
| 8c | the tests that flew v0.12's numbers fly the worlds; no test flight through a wall | c5d3e85, e8db244 |
| 8d | the corridor's `attemptLimitS` 350 s (v0.12's 2.8 s a metre), every limit twice the track at 1 m/s | f742f3d |
| 8e | the open-way chime and the checkpoint chime told apart in the glossary; tunnel-gaps by contour | c851a23 |
| 8f | `ears-glossary` names all 26 cue ids | bb20cb5 |
| 8g | no wrong way from the truth bot; no "wrong side" at a new attempt's start (`JUMP_M`) | 7a60194, 520f21f |
| 8h | rings-heights on the 0.5 m grid (5.4 m room, middle, floor, middle, ceiling, middle) | 4f51cc3 |
| 8i | a recording that differs only in its world stays FAIL, and the code says why | ca76c66 |
| 8j | CHANGELOG, README, llms.txt, AGENTS.md for v0.13 | 04f1b9c |
| 9 | full checks with fresh evidence | 4796e5f, 49ca9ae |
| 10 | the lanes' notes in `docs/dev/`, placeholders for the build machine's folders | a393b74, 9cdf984 |

Checks on the final code (a393b74; the commits after it hold only evidence, documents and, in step 11, the escapes of
one test's Russian words, after which the Node checks ran again with the same numbers and `pnpm listen` found its
evidence fresh), all passing: `pnpm typecheck` clean (three projects); `pnpm test` 44 files,
1042 tests (17.1 s; 1042 again after step 10); `node tools/run-tool.mjs locale-lint` 0 problems, 4 languages, 521
keys; `node tools/run-tool.mjs check-layout` 0 problems; `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio` 3 files, 9
proofs, 48.5 s in headless Chrome 156.0.8078.80, every broken control failing; `pnpm listen` 24 renders, 8 of 8
checks valid and passing for inputs 418eab75ba5d (125 files), 88.7 s. The listener's numbers:

| Check | Measured | Control |
|---|---|---|
| VL-0a two renders the same | max difference 1.8e-7 (limit 1e-6) | noise seed 2: 0.045 |
| VL-0b stems sum to the mix | residual -131.1 dB (limit -90) | a stem left out: -3.0 dB |
| VL-pitch height track | largest step 3.7 cents per 10 ms (limit 25) | v0.12 stepped tone: 118.7 cents |
| VL-onset hazard before impact | 2.475, 2.493, 2.475 s at 1, 3, 5 m/s (at least 2) | distance-only rule at 5 m/s: 1.18 s |
| VL-6-speech voice over the mix | soft 4.76, clear 4.66, race 4.64 LU (3 to 6) | volume 1: 11.26, 7.91, 10.39 LU |
| VL-6-peak engine and voice | -6.99, -3.74, -6.26 dBTP (at most -1) | volume 1: -0.52, -0.51, -0.49 |
| VL-2-motor cues over the motor | worst 15.0 dB (Air65, shape); Pavo20 30.3, Meteor65 20.1, Pavo Pico 22.3, 5-inch 24.2 dB; motor 11.0 to 12.1 LU under the cues (micro), 14.05 (5-inch) | raw motor at 60 %: shape 0.9 dB |
| VL-3-height band | in the band at most 1.1 % (2 to 70 Hz), out of it a 43 % buzz | steady pair: 44 % in the band |

Found while merging s13-worlds, beyond the items as given (each in its item's entry above, with its test):

- s13-lessons' runner placed the craft at the start for a new attempt without setting its last sample aside, so in
  every ring and shape lesson the jump back from past the gate told "That gate was passed from the wrong side" at the
  "Go." of attempts 2 and 3; and a replay with estimated speech saw the same jump a frame later (item 8g).
- rings-heights' rings were off the lesson's 0.5 m grid, their target notes off the scale (item 8h).
- tunnel-gaps told above and below by register, "a high chime", where the sound gives them by contour with the pilot's
  height polarity (item 8e); walls-hall's goal line did not ask for a stop close to the wall (step 7).
- Three passing tests of review R1 flew v0.12's offsets through the walls of the smaller rooms (item 8c, part 2), and
  "the path flown goes back" returned the end of its flight instead of where the goal was met (item 8c).
- The typecheck was not clean from 7a60194 to 04f1b9c (item 8g's test, TS2367); fixed in 520f21f.

Left open, with the reason:

1. Nothing of v0.13 has been heard by a person: the new and reworded lines (walls-hall's goal, the two glossary lines,
   tunnel-gaps' intro.3), the sounds, the smaller rooms. English lines were measured with the Windows voice only; this
   machine has no Spanish, Polish or Russian voice (s13-sound's M4). Three English lines s13-worlds reworded keep the
   length measured for their old text (`MEASURED_TEXT`), as the merge note asked; the lines added in v0.13 have no
   measured length (the fixture holds 376 of the 521 keys) and the schedule takes the estimate for them.
2. rings-heights says "the second, steady tone is the height of the next ring" and, in the hint, "the steady one"; since
   s13-sound's review M2 the target is a short note about once a second, the height tone giving way to it, so "steady"
   means its pitch, not a second tone that holds. A rewording ("a short note, about once a second, gives the height of
   the next ring") is a lesson text change for the lessons' owner, with s13-worlds' test of that phrase.
3. tunnel-gaps' intro names the open-way chime but carries no `cues`, so the task does not play it three times as
   every named sound is (M41-5); an intro cue from a side (`{ cue: 'safety.free', from: 'left' }`) is the lessons'
   owner's to add (s13-worlds' "Needs from other lanes" 5).
4. `LINE_UP_M` (8 m, s13-lessons' review R1, set for rings 14 m apart): in the rooms of v0.13 (gates 5 to 7 m apart)
   it covers the whole gap in front of the gate that counts next, so flying back between two gates is never told. No
   pilot has flown it; whether it should follow the spacing is a decision for the lessons' owner.
5. The simulator, wave 2 (lane v13-host, with the gitlink move), by reference: s13-worlds' "Needs from the simulator" 1
   (draw the room from `world.cavities`, in the same commit as the gitlink move, review M4), 3 and 4, and tunnel-long's
   collider cost (lane v13-look); s13-lessons' "Needs from the simulator" 1 to 7 and its "Review R4" table; s13-sound's
   "Needs from the simulator"; and from item d, the replay page reading `replayVerdict(check)`.
6. s13-worlds' m6 (one long tunnel with one kind of obstacle; the owner asked for several) and m4's replay table of the
   v0.12 lessons: the lead's to plan; corridor version 2 is unpublished and can grow.
7. The lane notes keep their own words as written: a few of their lines run past 120 columns after the paths changed,
   and four mentions in the sound lane's notes ask whether `docs/wip/` would be published (it was, here, as
   `docs/dev/`).

Of the list left open after step 6: item 1 (the glossary) is done (8f), 2 (the changelog) done (8j), 4 (a recording
that differs only in its world) settled (8i), 3 and 5 stand (1 above); everything that waited for the s13-worlds merge
is done: s13-lessons' R5 and its "Left open" 4 and 5 (8a, the world's track), s13-sound's items for s13-worlds (8h,
the layers as merged, the corridor's and tunnel-gaps' lines), and the proofs and the listener again (step 9).

## Status after steps 1 to 6 (2026-11-08, before s13-worlds), as it was

Done, branch `s13-merge`, not pushed, nothing deployed. `main` (7d4b4b9) is untouched; s13-worlds is not merged.

What merged: s13-lessons at 14e00f0 (5db2b1d, clean: main had not moved) and s13-sound at 3c73658, which carries
vl-spec at 3044c7c (9eb98d7). Conflicts: three files, each resolved as the table under "Conflicts and their
resolution" says: `src/cues/planner.ts` s13-sound's side (s13-lessons' planner hunks were placeholders only, every one
covered by s13-sound's cases), the two proofs' evidence files s13-sound's side and then rewritten by the proofs. Every
other file both lanes changed merged by itself and was checked field by field (contract, lesson files, locales,
catalog, tools, tests), as listed there.

| Merge item | What | Commit |
|---|---|---|
| a | the silence control of `test/silence.test.ts` with v0.12's layers; the real check with both | aacabfd |
| b | `test/repeat-plays.test.ts` passes; `durS` honoured, checked broken once | a329d4d |
| c | `ONE_OFF_PLAY_S` for s13-sound's four event sounds, and a test of the whole table | aa3e789 |
| d | the replay's verdict "recorded with an older build", its negative controls | 6dc1a44 |
| e | walls-hall's and the corridor's lines for the knocks of v0.13, four languages | 543a5cb |
| f | placeholders for the build machine's folders in `docs/design/virtual-listener.md` | 8eae637 |
| 5 | fresh evidence: proofs 371afd8, listener 7083089 | |

Checks on the final code (8eae637; after it only evidence and this doc changed), all passing: `pnpm typecheck` clean;
`pnpm test` 36 files, 756 tests; `node tools/run-tool.mjs locale-lint` 0 problems, 4 languages, 469 keys; `node
tools/run-tool.mjs check-layout` 0 problems; `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio` 3 files, 9 proofs, 48.8 s,
every broken control failing; `pnpm listen` 8 of 8 checks valid and passing for inputs 67e227c5d9ad (a second run
says the evidence is fresh: nothing to run). The listener's numbers:

| Check | Measured | Control |
|---|---|---|
| VL-0a two renders the same | max difference 2.4e-7 (limit 1e-6) | noise seed 2: 0.045 |
| VL-0b stems sum to the mix | residual -131.4 dB (limit -90) | a stem left out: -3.0 dB |
| VL-pitch height track | largest step 3.7 cents per 10 ms (limit 25) | v0.12 stepped tone: 118.7 cents |
| VL-onset hazard before impact | 2.475, 2.493, 2.475 s at 1, 3, 5 m/s (at least 2) | distance-only rule at 5 m/s: 1.18 s |
| VL-6-speech voice over the mix | soft 4.76, clear 4.66, race 4.64 LU (3 to 6) | volume 1: 11.26, 7.91, 10.39 LU |
| VL-6-peak engine and voice | -6.99, -3.74, -6.26 dBTP (at most -1) | volume 1: -0.52, -0.51, -0.49 |
| VL-2-motor cues over the motor | worst 15.0 dB (Air65, shape); Pavo20 30.3, Meteor65 20.1, Pavo Pico 22.3, 5-inch 24.2 dB; motor 11.0 to 12.1 LU under the cues (micro), 14.05 (5-inch) | raw motor at 60 %: shape 0.9 dB |
| VL-3-height band | in the band at most 1.1 % (2 to 70 Hz), out of it a 43 % buzz | steady pair: 44 % in the band |

Found while merging (a probe, not committed): with the merged layers move-speed is never silent, 0 of 150 frames of
the pause between attempts and 0 of 786 flying frames (with v0.12's layers 104 of 150 and 84 of 786, s13-lessons'
own measure). That closes s13-lessons' "Left open" 7; its item 1 (the event sounds as placeholders) is closed by the
merge too: s13-sound's sounds play now. No person has heard any of it.

Left open by this merge:

1. `ears-glossary` does not name s13-sound's six new cues (`safety.free`, `safety.wrong-way`, `safety.wrong-side`,
   `height.target`, `target.praise`, `target.stage`); their lines and play lengths are ready. Naming them changes the
   glossary lesson (its goals, its version, its length, the 60 plays `test/repeat-plays.test.ts` counts): a lesson
   decision, not a merge one.
2. `CHANGELOG.md` (Unreleased) has s13-lessons' entry and the replay verdict, nothing yet of s13-sound's changes.
3. `test/fixtures/tts-en-david.json` has no measured length for s13-sound's new English lines (the six cues, the two
   settings); the schedule takes the estimate for them. No shipped lesson's schedule says them yet.
4. A recording whose only difference is the world's id (a generator changed, the lesson's version did not) still
   reads FAIL with "not the recording's own build"; whether that is an older build too is a question for the
   s13-worlds merge, which changes worlds.
5. The new lines of item e were heard by no person; this machine has no local Spanish, Polish or Russian voice.
6. The lanes' own "Left open" lists stand otherwise (s13-lessons "Final status", s13-sound "Final status").

What waits for the s13-worlds merge (by reference, not copied):

- `docs/dev/status-v0.13-lessons.md`, "For the lead's merge" item 2 (review R5: the corridor's `goals[1]` and cp-6 with
  the world's geometry, the tunnels' goals), and its "Left open" items 4 and 5 (the corridor passed at 240 m, the
  respawn points' density until the world's checkpoint list).
- `docs/dev/status-v0.13-sound.md`, "Needs from other lanes", the s13-worlds items (target heights on one 0.5 m grid;
  the height and room layers of s13-worlds' new lessons) and the corridor line of review m4 for s13-worlds' own tunnel
  lines (the corridor's own line is done here, item e).
- After that merge: `pnpm proof:audio` and `pnpm listen` again (their inputs change), and left open 4 above.

What each lane needs from the simulator (wave 2, lane v13-host, with the gitlink move; by reference):

- s13-lessons: `docs/dev/status-v0.13-lessons.md`, "Needs from the simulator" items 1 to 7, and the simulator test
  updates of its "Review R4" table.
- s13-sound: `docs/dev/status-v0.13-sound.md`, "Needs from the simulator" (the motor on `motorInput` and who owns that
  change, review M5; the five sound tests, M6; the settings `motorGainDb` and `heightTarget`; the panel's `plan` and the
  repeat-cue; every line through `engine.say()`; one run of the cost bench).
- From this merge (item d, s13-sound's m7): the replay page (`apps/fly/src/sonic-session/replay-control.ts`,
  `summary`) picks its pass or fail line from `check.ok`; it should read `replayVerdict(check)` and say "recorded with
  an older build" in the simulator's own locales for 'older-build'. The details line (`formatReplayCheck`) says it
  already, and the simulator's `mergeChecks` compiles as it is (`verdict` is optional).

## Conflicts and their resolution (step 3)

Three files conflicted; every other file both lanes changed merged by itself and was checked against both sides.

| File | Resolution |
|---|---|
| `src/cues/planner.ts` (two hunks: `eventCue` and `cue()`) | s13-sound's side, the file as at 3c73658. s13-lessons' own hunks (`git diff 7d4b4b9 14e00f0 -- src/cues/planner.ts`) are all placeholders: praise, stage, wrong-way and wrong-side mapped to the checkpoint chime, the lap chime and the re-centre sweep, and repeat-cue played as a preview of `durS` (with `dir` absent read as null). s13-sound's cases cover every one of them: repeat-cue honours `durS` (`REPEAT_PLAY_DEFAULT_S` 2.5 when absent, held to 0.2 to 6 s), reads `dir ?? null`, and `eventCue` maps repeat-cue to its cue. Nothing that is not a placeholder was dropped. |
| `evidence/audio-proofs.json`, `evidence/demo-check.json` | s13-sound's side; rewritten by `pnpm proof:audio` in step 5. |

Merged by git, checked by script against both lanes (the scripts compare every field and key, not the text):

- `src/contract.ts`: the union. The five shared `CueEvent` members appear once, word for word the same on both sides
  (s13-sound took s13-lessons' text in c48de8c); s13-lessons' additions (lesson format 2, `track-end`, `IntroLine`,
  `IntroCue`, `Checkpoint.stage`, `LessonProgress.skipped`) and s13-sound's (`heightTarget`, `motorGainDb`,
  `motorInput`, the motor's comment) are all there.
- `lessons/*.json`: the 16 flying lessons both lanes changed have s13-sound's `layers` and s13-lessons' every other
  field, `version` 2 once, format `shramko-sonic-lesson/2`; the five ears lessons are s13-lessons' alone.
- `locales/{en,es,pl,ru}.json`: the union by keys, 469 keys each (s13-lessons 455, s13-sound 425, `main` 411); no key
  was changed by both lanes, no key appears twice.
- `src/i18n/catalog.ts`: the union; s13-sound's new `CUE_IDS` entries stand after `safety.obstacle`, `safety.reset`,
  `height.rough` and `target.fanfare`, `menu.setting.height-target` and `menu.setting.motor-level` after
  `menu.setting.motor`.
- `tools/locale-lint.ts`, `tools/check-layout.ts`: s13-lessons' (with the `main()` that `tools/run-tool.mjs` needs);
  s13-sound did not change them.
- `test/replay.test.ts`, `test/report.test.ts`: s13-lessons' text (s13-sound had carried its lines for the lesson
  version). `AGENTS.md`: both lanes' lines. `package.json`: s13-sound's `listen` script; no dependency changed, the
  lockfile is `main`'s.
- `pnpm typecheck` on the merged tree before the commit: clean.

## Conflicts and their resolution (step 7, s13-worlds at 067278f)

Seven files conflicted; each is resolved as s13-worlds' "For the lead's merge" says (checked there in trial merges with
each lane). Every other file both sides changed merged by itself and was checked as listed below the table.

| File | Resolution |
|---|---|
| `lessons/corridor.json` (cp-3's and cp-5's pose, cp-6) | s13-worlds' world, start and checkpoint positions, cp-3 and cp-5 at yaw 90 (both sides had it); s13-lessons' `stage` 1 to 4 on cp-2 to cp-5 and its intro `cues` (merged by git); s13-lessons' cp-6 moved to the world's `end` landmark, `[36, 1.25, -93]`, yaw 0 (read from the built world: its landmarks are start, the five `section-*` and `end`; its own track is 54 points, 125.2 m, the last at z = -91.75). `layers` s13-sound's, `goals` s13-worlds' 15 and 120 m (both merged by git) until item 8a. |
| `locales/{en,es,pl,ru}.json` (walls-hall's title, intro.1, intro.2) | title and intro.1 s13-worlds' ("A small room", "You are in a small, empty room. ..."); intro.2 item 4e's ("Fly slowly toward a wall until you hear knocks, then stop."). Read as one text with the goal of 1.5 m, `goal.1` said only "stop before you touch it", which a stop 3 m away keeps and the goal fails: it is now "Fly to each wall and stop close to it without touching it.", and the same in Spanish, Polish and Russian ("stop close to it" in each). The other lines (intro.3, pass, retry, hint.1) say nothing that a 1.5 m stop or a small room contradicts. |
| `test/lesson-schedule.test.ts` | the merged branch's test with s13-worlds' `MEASURED_TEXT` in the fact "263 of the 376 English lines take the Windows voice longer than the estimate": item e's three lines were measured again (262 -> 263), s13-worlds' three (module 4's name, walls-hall's title and intro.1) count with the text that was measured. walls-hall's new `goal.1` was measured the same way (`measure-tts.ps1`'s method, Microsoft David Desktop): 3.975 s (the old text 3.415 s again, as in the fixture; the retry 3.77, the old intro.1 8.64, the old title 1.64 and module 4's old name 1.36 as well), written to `test/fixtures/tts-en-david.json`; neither text is longer than the estimate, so the count stays 263 (262 without `MEASURED_TEXT`). |
| `test/progress.test.ts` | s13-lessons' form (the title through the translator, no Cyrillic in the test) with the lesson count from the path, `lessonPaths().full.length`, in its three places; s13-worlds' rings-first and corridor flights from the world merged by git. |

Is walls-hall's text true for its goal? A probe with the merged planner (not committed: walls-hall's world and layers,
each built-in theme alike) flew at the nearest wall and found the first knock (`safety.wall`) at 0.80, 1.25, 1.87, 2.50,
3.11 and 3.73 m from the hull at 0.3, 0.5, 0.75, 1, 1.25 and 1.5 m/s. A pilot who stops at the first knock (a reaction
of 0.6 or 0.3 s, then the assist's braking as `test/helpers/reach.ts` models it) stops 0.44 to 0.53 m from the wall at
0.3 m/s, 0.63 to 0.78 at 0.5, 0.93 to 1.15 at 0.75, 1.22 to 1.52 at 1 (on the limit), 1.49 to 1.86 at 1.25 and 1.75 to
2.2 m at 1.5 m/s. So "fly slowly, stop at the knocks" passes the 1.5 m goal up to about 0.75 to 1 m/s, a quarter to a
third of the lesson's cap of 3 m/s, which is what "slowly" has to mean. A model, not a flight; no person has heard it.

Merged by git and checked:

- `src/contract.ts`: the union; every line s13-worlds added (`CavityBox`, `AnalyticWorld.cavities?`,
  `AnalyticWorld.checkpoints?`, `WorldCheckpoint`) is in the file, and the merge removes no line of this branch's.
- Registrations: `src/lesson/library.ts`, `lessons/paths.json`, `src/i18n/catalog.ts` and the locales hold the six
  tunnels and rings-heights beside s13-lessons' and s13-sound's entries; 28 lesson files, the full path 28 and the fast
  path 8 (tunnel-gaps after corridor), every `order` its place on the full path and every `fastPath` flag its path (a
  script over the files); README and llms.txt say 28 lessons and a fast path of 8; `AGENTS.md` has s13-worlds' rule on
  generators. Locale lint 0 problems (4 languages, 521 keys), layout check 0 problems.
- `pnpm typecheck` clean before the commit.
