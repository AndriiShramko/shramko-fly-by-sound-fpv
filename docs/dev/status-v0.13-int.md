# v0.13 s13-int: the engine's reset and the simulator's integration

Branch `s13-int`, from lane s13-elev's head 512d7d2 (`docs/dev/status-v0.13-elev.md`). It carries what the simulator's
integration branch (ShramkoGSFPV `v13-int`: its lanes v13-host and v13-look merged, the gitlink moved to this branch)
needs from the package. Not pushed; the lead merges it to `main` after gh_precheck.

## Status

- [x] I1. The engine forgets what is sounding when a host opens the next lesson or a replay seeks (the simulator's lane
  v13-host, "Needs from the package" 2): `SonicEngine.reset?()` in the contract (optional), `FlyBySoundEngine.reset()`,
  `CuePlanner.reset()` stamps the next cue at 0; a Node test and an audio proof, each with its control; a changelog line
  and a rule in AGENTS.md.
- [x] I2. The words check on the simulator's Fly by Sound lines after the simulator's rewording (its key lines, its
  Russian register, the mode's name in Russian and Polish): before and after, per language.
- [ ] I3. The checks on the branch's head: typecheck, tests, locale lint, layout, the audio proofs (the engine changed),
  `pnpm listen` (the engine's files changed, so its evidence is keyed again).

## I1, the reset

Why: a host starts its frame clock again at every lesson it opens (the simulator's bridge does, at each `lesson open`).
The scene sampler keeps an active sector `holdMs` (300 ms) on when the clock goes back (`src/sense/sampler.ts`, meant for
a seek), and nothing called `CuePlanner.reset()`: the engine had no reset a host could call. So the first 0.3 s of the
next lesson voiced the last one's sectors with the new geometry (in the simulator's rig, rings-first to rings-line: the
ceiling above and the front-up sector for 9 to 12 frames with the craft at rest 2.2 m under the ceiling), which the
replay, a new planner per lesson, does not derive. A one-off note of the last lesson also stayed in the plan's cues
until the new clock reached its end on the old clock (a gate note at 60 s stays listed for a minute of the next lesson).

What it does: `FlyBySoundEngine.reset()` resets the planner (the sampler's held sectors, the moving voices, previews,
notes, the open way, the praise figure, the height alignment), forgets the last frame and its plan (the pump no longer
plans on from the last lesson's frame; a cue before the next frame is stamped at 0, the host's new clock, as a new
planner and the replay stamp it), releases the moving voices at once, stops the target notes until a frame asks for one
and lifts the urgent duck. Settings, layers, speech and the audio graph stay. `CuePlanner.reset()` also sets its last
time to 0, so a reset planner and a new one plan the same.

Checks:

- `test/reset.test.ts` (Node, 5 tests): walls-hall's room; the last lesson flies at the front wall until 60 s and ends
  on a gate note; the next frame's clock is 0 with the craft at rest in the room's middle (every surface 1.6 m or more
  away, under the sampler's release, where a new planner voices nothing). With `reset()`: no hazard and no note of the
  last lesson, and 121 frames after it planned exactly as by a new planner; a cue before the first frame stamped at 0.
  Control, the same frames without `reset()`: the ceiling's and the floor's held sectors voiced at 0 and at 280 ms, none
  at 320 ms (the hold), the gate note still listed at 320 ms; the preview stamped at 60 s, not heard at 0. Negative
  controls in the code, each run once and restored: without `this.sampler.reset()` in the planner's reset two tests fail;
  without its `this.lastT = 0` one fails.
- The audio proof `engine-reset` (`test-audio/page/proofs.ts`, the real engine rendered offline in headless Chrome): the
  craft flies at the left wall of the v1 hall (voicing the left, front-left and front walls at the switch), then the next
  lesson's clock starts at 0 with the craft at rest 3 m over the floor and 20 m from every wall (a new engine voices
  nothing there). With `engine.reset()` at the switch: 0 of the 18 frames of the hold (0 to 283 ms) has a hazard active or
  a moving voice holding one. Control, no reset: 18 of 18 (the floor ahead and below, the ceiling ahead and above, the
  wall front-left, all held).

Not checked by a machine: how the switch sounds to a person (the released voices fade in about 20 ms).

## I2, the simulator's lines heard again

The tool: `--sim` reads the simulator's `fly/soniclook` too (the sound panel's and the attitude display's words, said by
its spoken settings list since the integration branch; ea9ae36), fills the parameters the integration branch added
(`{here}`, the replay's version of a lesson) and leaves out `sonic.say.text`, which only carries a text put together
elsewhere (43ed9a3). Before that the simulator's newest lines stopped the run (no sample value for `here`).

The simulator's integration branch reworded its lines (its `docs/wip/v13-int.md`, step 6): "the key" before a key's name
in Spanish, Polish and Russian, as this package says it; one register in Russian (the informal one this package uses);
the mode named in Russian and Polish in their own words (the voices garbled the English name); Spanish keeps the
English name. Heard with the same voices, Whisper large-v3 and bound 0.2 (the report is the simulator's, not evidence):

| | lines | heard exactly | mean rate | over the bound |
|---|---|---|---|---|
| en, David, before | 268 | 249 | 0.0092 | 4 |
| en, after | 269 | 250 | 0.0091 | 4 |
| es, Helena, before | 268 | 251 | 0.0137 | 4 |
| es, after | 269 | 254 | 0.0128 | 4 |
| pl, Paulina, before | 268 | 248 | 0.0227 | 10 |
| pl, after | 269 | 254 | 0.0133 | 5 |
| ru, Irina, before | 268 | 219 | 0.0603 | 22 |
| ru, after | 269 | 245 | 0.0266 | 10 |

What is left is Whisper's spelling (the brand Telegram written in Cyrillic, "1,5 metra" for "1.5 m", "Control-N-C") or a
habit of a voice that no rewording here fixes (a key's name alone, the copy keys, a browser's own button name); the
simulator's doc lists each line. This package's own `app.name` and `menu.welcome` still say "Fly by Sound" in every
language (the simulator names the mode with a key of its own now); whether the package's Russian and Polish lines follow
is the owner's call (they would need new lengths measured and the package's words check again).

Not checked by a machine: a native reading of the reworded Russian and Polish lines, the Polish name above all.
