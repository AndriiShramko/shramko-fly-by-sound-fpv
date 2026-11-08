# Merge s13-merge: v0.13 lanes s13-lessons and s13-sound into one branch

Branch `s13-merge`, worktree `C:/dev/sonic-s13-merge`, cut from `main` 7d4b4b9 (what the live simulator ships). It
merges exactly two finished lanes, each reviewed once with every finding fixed:

- s13-lessons at 14e00f0 (lane doc `docs/wip/s13-lessons.md`: "Final status", "For the lead's merge", "Needs from other
  lanes");
- s13-sound at 3c73658 (lane doc `docs/wip/s13-sound.md`: "Final status", "Needs from other lanes"), which contains
  `vl-spec` at 3044c7c (the virtual listener's design and rig).

Lane s13-worlds is not merged here (it is still fixing its review); it merges after this branch in a step of its own,
and the corridor's goal (s13-lessons' "For the lead's merge" item 2, review R5) waits for it. No push, no deploy.

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
- [ ] 4e. The lines of walls-hall and the corridor say what the knocks of v0.13 mean (four languages)
- [ ] 4f. `docs/design/virtual-listener.md` section 14 without the build machine's folders
- [ ] 5. Full checks on the final commit: typecheck, test, locale lint, layout check, proof:audio, listen
- [ ] 6. Final status: what merged, the conflicts, the merge items with their commits, the checks with numbers, what
  waits for s13-worlds, what each lane needs from the simulator

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
