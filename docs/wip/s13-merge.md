# Merge s13-merge: v0.13 lanes s13-lessons and s13-sound into one branch

Branch `s13-merge`, worktree `C:/dev/sonic-s13-merge`, cut from `main` 7d4b4b9 (what the live simulator ships). It
merges exactly two finished lanes, each reviewed once with every finding fixed:

- s13-lessons at 14e00f0 (lane doc `docs/wip/s13-lessons.md`: "Final status", "For the lead's merge", "Needs from other
  lanes");
- s13-sound at 3c73658 (lane doc `docs/wip/s13-sound.md`: "Final status", "Needs from other lanes"), which contains
  `vl-spec` at 3044c7c (the virtual listener's design and rig).

Lane s13-worlds was not merged in steps 1 to 6 (it was still fixing its review); it merges after them, in steps 7 to
11, at 067278f (lane doc `docs/wip/s13-worlds.md`: "For the lead's merge", "Needs from other lanes", "Needs from the
simulator", "Final status"; review `docs/wip/s13-worlds-review.md`), and the corridor's goal (s13-lessons' "For the
lead's merge" item 2, review R5) is set then. No push, no deploy.

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
    and 10 m wide). They now pass ring 2 beside it by its frame and 2.5 m on the side with more room, 3 m past it
    (short of ring 3), fly back to its front short of ring 1, and the control flies back to 0.6 m before the room's back wall (further
    than `LINE_UP_M` from ring 2 for about 1.5 s). The probe then logs no sample in a wall. Broken on purpose once (the
    wrong way judged against the track in a course too, R1 undone), the three R1 cases fail; restored, 10 of 10.
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
  and "A short double chime" (ru "Две быстрые ноты", "Короткий двойной звон"), the same thing in other words. Now:
  `cue.safety.free.glossary` "A pair of quick notes, again and again, while something blocks the way ahead. ..." (es
  "Un par de notas rápidas, una y otra vez, ...", pl "Para szybkich nut, raz za razem, ...", ru "Пара быстрых нот, снова
  и снова, ..."; the rest of each line as it was), `cue.target.checkpoint.glossary` "One chime from low to high, only
  once, when you reach a checkpoint." (es "Una campanilla de grave a agudo, una sola vez, ...", pl "Jeden dzwonek od
  niskiego do wysokiego, tylko raz, ...", ru "Один перезвон снизу вверх, только раз, ..."). A new test in
  `test/events.test.ts` checks the sounds (the open-way voice's period longer than its note; the checkpoint two notes,
  the second higher) and the words in the four languages ("again and again" for the one, "only once" for the other,
  never the other's); on the merged lines it failed ("en: expected 'Two quick notes ...' to match /again and
  again/"). Found while reading the lines that name the open-way chime: tunnel-gaps' intro.3 (s13-worlds) said "A high
  chime means the way is above it, a low one below", by register, which s13-sound's review m2 replaced by the contour
  with the pilot's height polarity (for a pilot with 'up-lower' a way above sounds lower); it now says "If the chime
  moves like your height tone in a climb, the way is above it. If it moves the other way, below." in the four
  languages, as the glossary does, and `test/world-tunnels.test.ts` checks that wording (no "high chime"). The English
  checkpoint line was measured as goal.1 was: 5.175 s, longer than its estimate (the old line, 3.295 s, was shorter),
  so the schedule test's fact is 264 of 376 lines (was 263). Locale lint 0 problems (521 keys), layout 0, full suite
  1032 of 1032. No person has read the new lines aloud in Spanish, Polish or Russian.
- [ ] 8f. `ears-glossary` names s13-sound's six new cues
- [ ] 8g. The truth bot in the ring lessons raises no wrong-way event
- [ ] 8h. rings-heights: the target tone follows the next ring and the glide meets it in unison there
- [ ] 8i. A recording that differs only in the world's id stays FAIL
- [ ] 8j. CHANGELOG (Unreleased) for s13-sound and s13-worlds; README, llms.txt and AGENTS.md agree
- [ ] 9. Full checks on the final code with fresh evidence
- [ ] 10. The lanes' notes as public dev notes (`docs/dev/`); no build-machine folder in `docs/`, README, AGENTS, llms
- [ ] 11. Final status of the whole merge

## Final status (2026-11-08)

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

- `docs/wip/s13-lessons.md`, "For the lead's merge" item 2 (review R5: the corridor's `goals[1]` and cp-6 with the
  world's geometry, the tunnels' goals), and its "Left open" items 4 and 5 (the corridor passed at 240 m, the respawn
  points' density until the world's checkpoint list).
- `docs/wip/s13-sound.md`, "Needs from other lanes", the s13-worlds items (target heights on one 0.5 m grid; the
  height and room layers of s13-worlds' new lessons) and the corridor line of review m4 for s13-worlds' own tunnel
  lines (the corridor's own line is done here, item e).
- After that merge: `pnpm proof:audio` and `pnpm listen` again (their inputs change), and left open 4 above.

What each lane needs from the simulator (wave 2, lane v13-host, with the gitlink move; by reference):

- s13-lessons: `docs/wip/s13-lessons.md`, "Needs from the simulator" items 1 to 7, and the simulator test updates of
  its "Review R4" table.
- s13-sound: `docs/wip/s13-sound.md`, "Needs from the simulator" (the motor on `motorInput` and who owns that change,
  review M5; the five sound tests, M6; the settings `motorGainDb` and `heightTarget`; the panel's `plan` and the
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
| `locales/{en,es,pl,ru}.json` (walls-hall's title, intro.1, intro.2) | title and intro.1 s13-worlds' ("A small room", "You are in a small, empty room. ..."); intro.2 item 4e's ("Fly slowly toward a wall until you hear knocks, then stop."). Read as one text with the goal of 1.5 m, `goal.1` said only "stop before you touch it", which a stop 3 m away keeps and the goal fails: it is now "Fly to each wall and stop close to it without touching it." (es "... y para cerca de ella sin tocarla.", pl "... zatrzymaj się blisko niej, nie dotykając jej.", ru "... остановись близко к ней, не коснувшись её."). The other lines (intro.3, pass, retry, hint.1) say nothing that a 1.5 m stop or a small room contradicts. |
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
