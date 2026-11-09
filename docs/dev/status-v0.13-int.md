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
- [x] I4. A flight dead ahead at a wall replays as it was flown (K1 of the simulator's v0.13 review): the scene sampler's
  mirror tie with a dead band (`MIRROR_PAIRS`, `mirrorDeadBand`, default 2 %), the same rule live and in the replay.
- [x] I5. The mode's name in the package's own Russian and Polish lines (K3 of the simulator's review): `app.name` and
  `menu.welcome`, their lengths measured with the local voices, the words check again.
- [x] I6. The checks on the new head (I4 changed the planner: the audio proofs and `pnpm listen` too), on eafd417:
  `pnpm typecheck` clean; `pnpm test` 51 files, 1191 tests; locale lint 0 problems (4 languages, 526 keys); layout 0;
  `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio` 3 files, 9 tests (the 8 audio proofs, each with its broken control, and the
  demo's keyboard checks); `pnpm listen` 9 of 9 valid and passing, the evidence keyed again (88d883ccff54: src and
  locales changed). Every measured number as before but three, all far inside their bounds: the stems' residual against
  the mix (VL-0b) -131.8 -> -132.7 dB, one third-octave margin of VL-2 95.8 -> 95.9 dB (the order of two tied voices
  changes their slots: I4), and the demo's keyboard climb 1.25 -> 1.27 m (a flight timed by the browser). `pnpm
  listen:words` PASS (I5).
- [x] I3. The checks on the branch's head: typecheck, tests, locale lint, layout, the audio proofs (the engine changed),
  `pnpm listen` (the engine's files changed, so its evidence is keyed again).
  - `pnpm typecheck` clean; `pnpm test` 50 files, 1172 tests (1167 at s13-elev's end, 5 new); locale lint 0 problems in 4
    languages (526 keys); layout check 0 problems.
  - `pnpm proof:audio` with the GPU lock: 3 files, 9 tests: the audio page's 8 proofs (`engine-reset` new), each passing on
    the engine as shipped and failing on its broken control, and the demo's keyboard checks (2985f8c).
  - `pnpm listen`: 9 of 9 valid and passing, the evidence keyed again (d0f4d5a92ed7: the inputs changed with I1's engine,
    planner and contract); every measured number the same as s13-elev's last run (only the keys, hashes and dates of the
    evidence changed): the reset is called by hosts only and changes no flight the rig renders.

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
simulator's doc lists each line. This package's own `app.name` and `menu.welcome` said "Fly by Sound" in every
language until I5 (below): the simulator's review (its K3) asked the Russian and Polish ones to follow.

Not checked by a machine: a native reading of the reworded Russian and Polish lines, the Polish name above all.

## I4, the mirror tie (K1)

Why: the simulator's page proof sonic-v13-page F2 flew rings-first with W alone, dead ahead at its front wall (the craft
at x 0 to the millimetre), recorded it and replayed the recording: 0 events different, 100 % of the sounds by kind, but
83.7 % of 172 frames by cue id, so the verdict was FAIL. For 28 frames the live engine voiced `safety.wall:front-right`
and the replay's planner `safety.wall:front-left`. The two front-side sectors see the wall at the same angle on the
room's axis: their risks tie. Live, a yaw far below what a recording keeps (the quaternion to 1e-4: up to about 0.01
degrees) broke the tie toward one side, and stickiness (1.25) kept that voice; the replay's frame, rounded to no yaw at
all, saw the tie exact and broke it by the order of `SECTORS` (front-left first). Reproduced in Node: the simulator's
lesson rig with a yaw of 1e-5 rad at the attempt's start replayed with 89.2 % of its sounds by id (front-right live,
front-left in the replay), with a yaw of +1e-5 rad or none at 100 %.

What it does: two mirror sectors (front-left and front-right, left and right, front-up and front-down, up and down)
whose risks lie within `mirrorDeadBand` of each other (default 2 % of the higher) both take the higher risk for turning
on, holding, turning off and ranking, so they turn on together and the order of `SECTORS` chooses, live and in the replay
alike. A voice keeps its own urgency (its loudness and rhythm); only which of two tied sectors sounds, and in what order,
follows the tie. The recording's rounding moves the two front-side risks apart by under 0.05 % (measured in the test: a
yaw of 0.0115 degrees at 2.6 to 7.2 m), 40 times under the band; a yaw of 0.6 degrees moves them 2 % apart, and beyond
that the side that faces the wall more squarely is voiced as before.

Checks: `test/mirror-tie.test.ts` (12 tests): the approach at 60 Hz live and every second frame rounded as a recording
keeps it (`roundFrame`), with a yaw of +-1e-5 rad and none: the same sectors at every frame, front-left; control, the rule
before (`mirrorDeadBand: 0`): with the yaw to the right, front-right live and front-left in the replay for more than 20
frames. A real yaw of 3 degrees still voices its own side in both. The tie itself (`mirrorTie`), two tied sectors turning
on together (risks 1.01 and 0.995: both voiced; control: one), the band checked (0 to 0.2). Negative control in the code,
run once and restored: `MIRROR_DEAD_BAND` 0 fails 3 of the tests. `test/elevation.test.ts`: the plans with
`heightDirection` off are v0.13's exactly with v0.13's rule for mirror ties (the placement helper takes sampler options);
with the tie, the same voices in every frame, only two tied voices change their order: 90 of 1044 frames of tunnel-gaps
in each theme (the ceiling ahead and above; their urgencies differed by 3e-16) and 10 of 1545 of rings-heights (the floor
and the ceiling through a ring), none in the other flights. `pnpm test` 51 files, 1191 tests.

## I5, the mode's name in Russian and Polish (K3)

`app.name` is «Полёт по звуку» in Russian and „Lot na słuch” in Polish; `menu.welcome` says «Добро пожаловать в режим «Полёт по
звуку».» and „Witaj w trybie „Lot na słuch”.”, the rest of each line as it was: the name stands after the word for "mode" in its
case, in quotes, as the simulator writes it (its v13-int step 6). Spanish keeps the English name (Helena says it).

- Lengths with the local voices (`test/fixtures/measure-tts.ps1`, SAPI rate 0): Irina `app.name` 2.6 -> 2.08 s,
  `menu.welcome` 15.2 -> 15.405 s; Paulina `app.name` 1.79 -> 1.675 s, `menu.welcome` 12.535 -> 12.705 s. Every other
  line measured the same to the millisecond (471 lines in each), so only these four values changed in the fixtures.
- The words check (`pnpm listen:words`, the same voices, Whisper large-v3, bound 0.2): before, Irina's `app.name` was
  heard "F.L.Y.B.Y. Sound" (raw rate 1, put back to 0 by a record) and her `menu.welcome` "... FLUI BUI SOUND ..." (0.087);
  Paulina's `app.name` "Flajby Sound" (raw 0.667, put back by a record). After, all four lines are heard exactly (raw rate 0)
  and the two records are gone. ru 511 of 526 lines heard exactly (510 before), mean 0.0031 (0.0033); pl 516 of 526, mean
  0.0025 (as before); every language 0 over the bound, PASS. `test/locales.test.ts`: the text kept from English is
  `app.name` in Spanish only.

Not checked by a machine: a native reading of the two names (the Polish one above all, a non-native choice).
