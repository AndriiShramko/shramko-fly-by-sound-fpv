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
- [ ] 4a. The silence control of `test/silence.test.ts` with v0.12's layers (it must fail with them, the real check pass)
- [ ] 4b. `test/repeat-plays.test.ts` passes: the repeat-cue case honours `durS` (confirmed once with `durS` ignored)
- [ ] 4c. `ONE_OFF_PLAY_S` gets the lengths of s13-sound's one-off cues
- [ ] 4d. The replay's verdict "recorded with an older build" (not FAIL), its negative control, `test/replay-v012.test.ts`
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
