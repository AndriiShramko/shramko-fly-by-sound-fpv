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
- [ ] 3. Merge s13-sound (3c73658), every conflict resolved and listed
- [ ] 4a. The silence control of `test/silence.test.ts` with v0.12's layers (it must fail with them, the real check pass)
- [ ] 4b. `test/repeat-plays.test.ts` passes: the repeat-cue case honours `durS` (confirmed once with `durS` ignored)
- [ ] 4c. `ONE_OFF_PLAY_S` gets the lengths of s13-sound's one-off cues
- [ ] 4d. The replay's verdict "recorded with an older build" (not FAIL), its negative control, `test/replay-v012.test.ts`
- [ ] 4e. The lines of walls-hall and the corridor say what the knocks of v0.13 mean (four languages)
- [ ] 4f. `docs/design/virtual-listener.md` section 14 without the build machine's folders
- [ ] 5. Full checks on the final commit: typecheck, test, locale lint, layout check, proof:audio, listen
- [ ] 6. Final status: what merged, the conflicts, the merge items with their commits, the checks with numbers, what
  waits for s13-worlds, what each lane needs from the simulator
