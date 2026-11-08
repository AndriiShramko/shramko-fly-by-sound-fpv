# Lane s13-elev: up and down by direction too (owner's message 42)

Branch `s13-elev`, in a worktree of its own, cut from `main` 16c01a1 (v0.13 merged and pushed, not yet released in
the simulator). Never pushed; the lead merges. Read first: `AGENTS.md`, `docs/design/virtual-listener.md` (why height
is carried by pitch: with Chrome's generic HRTF, up/down and front/back quadrant errors are 29 to 37 %; its rule: do not
rely on the HRTF alone, and make every HRTF-reliant cue broadband to about 16 kHz), `docs/dev/status-v0.13-sound.md`
(the cue design) and `docs/dev/review-v0.13-merge.md` (observations, open items).

## The request

The owner (message 42), about the sentence "height and the way past an obstacle above or below are carried by pitch,
not by the direction of the sound": keep the direction of the sound for up and down too, because someone with very
good headphones or very good hearing may tell it. So pitch stays the primary carrier and the direction is added on top
of it, never instead of it: every cue that means up or down also comes from its real direction in 3D through the
browser's HRTF (the open-way chime from the way above or below the obstacle, the target height note from the target,
a ceiling or floor hazard from above or below), with energy up to about 16 kHz so the HRTF has something to shape,
while every pitch contour, interval and timing stays as in v0.13. One setting, on by default, turns the up/down
direction off and gives back v0.13's placement exactly. The words that say the chime comes "from ahead" for above
and below change with it. In the same lane: "wrong way" between gates, which the 8 m line-up rule never told in the
5 to 7 m gaps of the v0.13 rooms (M41-15).

## Status

- [x] E1-1 Audit: every cue that means up or down or has a place above or below the pilot, its placement and spectrum
  today (table below). Before any change, v0.13's placement recorded: the planner of 16c01a1 flown through tunnel-gaps
  (soft; race calm with the polarity turned over), hover-height, rings-heights, floor and ceiling in walls-hall and the
  previews (soft, clear), every frame's plan hashed (`test/helpers/placement.ts`, `test/fixtures/placement-v013.json`)
- [x] E1-2 Direction for up and down: the open-way chime from the middle of the way past the obstacle, the target note
  from the target (a gate's centre, a band's middle 2 m ahead), the floor and the ceiling from below and above as
  before, each with a breath of air from 4 to 16 kHz; pitch, intervals, rhythm and levels unchanged
  (`test/elevation.test.ts`, 36 tests; decisions below). The setting is read as `SonicPrefs.heightDirection` (absent or
  true: on); with it off every frame of the seven flights is v0.13's exactly
- [x] E1-3 The setting: `SonicPrefs.heightDirection` (optional; absent or true: on, the default; false: v0.13's placement
  exactly), validated and read like `heightTarget` (a v0.13 document without it reads as on, with no issue); its label
  `menu.setting.height-direction` ("Sound from above and below") and spoken description
  `menu.setting.height-direction-what` in en, es, pl, ru, the English measured (2.33 s and 13.28 s with the local
  voice, `test/fixtures/tts-en-david.json`); `test/prefs.test.ts`. Control: the default broken to false fails 7 tests
  (the defaults, the setting's own test, the chime and target directions in `test/elevation.test.ts`, the freeway
  test)
- [x] E1-4 Words, in en, es, pl and ru: the glossary (`cue.safety.free.glossary`: "From above, notes moving like your
  height tone in a climb: the way is above. From below, the other way: below.") and the corridor's intro.3 ("left,
  right, above or below. Above, they move like your height tone in a climb, below the other way.") no longer say
  "from ahead"; tunnel-gaps' intro.3 says the chime comes from above or below and plays it from up and from down
  (version 2); walls-pillar's new intro.3 names the chime at its pillar and plays it from the left (version 3). "Rise
  or fall" is said as "moving like your height tone in a climb, or the other way", so the lines hold for either
  height polarity (lane s13-sound's review m2). English measured with the local voice: 18.07, 16.04, 10.23 and
  6.41 s (`test/fixtures/tts-en-david.json`). Tests: `test/named-sounds.test.ts` (the plays, the words per language,
  never "from ahead"), `test/world-tunnels.test.ts`, `test/lessons.test.ts` (the two versions)
- [x] E1-5 Wrong way between gates (`src/lesson/runner.ts` `lineUpM`, `wayForward`): the line-up distance follows the
  leg to the gate that counts next, `LINE_UP_M` x leg / `LINE_UP_SPACING_M` (8 m x leg / 14 m, at most 8 m), and flying
  back is flying against the leg along the floor. Turned back 1 m past gate 1 or halfway to gate 2 and flown back at
  2 m/s, a pilot is told after 2.04 m (1 m past) and 2.36 to 2.51 m (halfway) in rings-line, rings-small,
  rings-heights, rings-course and shapes-series; the truth bot and the new imperfect pilot (`test/helpers/imperfect.ts`)
  fly all eight gate lessons to their pass and are never told. Control: the 8 m rule of v0.13 (`testHooks.lineUp
  'fixed'`) never tells the turned pilot; `lineUpM` broken to 8 m fails 6 tests (`test/direction.test.ts`, 19 new)
- [ ] E1-6 Measure: Node tests, the listener check of the placement (Chrome's HRTF, headless), the localization models
  where runnable; all repository checks, the proofs and `pnpm listen`. In progress: the Node tests are in (E1-2 to
  E1-5); the rig has the check VL-1-elevation (scenario `free-chime`, four renders: the direction on and off, each with
  its dry twin; `tools/listen/measure.py` `check_elevation`), not run yet
- [ ] E1-7 This lane's E1 status final
- [ ] E2-1 (the next agent's; its task names it)
- [ ] E2-2 (the next agent's)
- [ ] E2-3 (the next agent's)
- [ ] E2-4 (the next agent's)

## E1-1 Audit: the cues of up and down in v0.13 (code as of 16c01a1)

Chrome's HRTF (the engine's panners, `panningModel 'HRTF'`) takes the elevation slice at or below the direction, in
15 degree steps from -45 to +90 (at most +45 to +75 away from straight ahead, `kMaxElevations`); the engine raises
every elevation by 7.5 degrees first (`src/cues/rules.ts:150-169` `pannerDirection`), so a slice is taken around its
middle. The spectral cues of height live from about 4 to 16 kHz (the design's probe F: a cue whose highs end at 6 kHz
gives 38 % quadrant errors even with one's own ears). Notes in the soft theme's scale (C3 = 130.8 Hz, pentatonic).

| Cue | What it says of up or down | Placement in v0.13 | Spectrum in v0.13 (what reaches 4 to 16 kHz) | E1 |
|---|---|---|---|---|
| `safety.free` above, below | the way past an obstacle is above or below | a moving voice (HRTF) from straight ahead, `FREE_DIRS` (`src/cues/planner.ts:200-205`); above or below by contour only: a rising pair D6 to G6 (1175, 1568 Hz) for above, a falling pair E5 to C5 (659, 523 Hz) for below, turned over with the polarity (`planner.ts:494-528`) | the target layer's note timbre (`NOTE_TIMBRE`: mallet soft, sine clear, pluck race; `src/audio/synth.ts:68-80, 141-154, 171-181`): the fundamental, a quiet 4th partial (mallet), a 14 to 16 ms noise click at 3.5 to 4.5 kHz; the voice's low-pass at 12 kHz (`planner.ts:517`) | from the way's own direction, broadband |
| `safety.free` left, right | (sides) | 60 degrees to that side; equal notes G5, G5 (784 Hz) | as above | unchanged |
| `height.target` | the height to fly at: the note above or below the height tone | no panner: straight into the height bus (`src/audio/engine.ts:588-593`, `playTargetNote` 859-890); a note 280 ms long every 1.25 s | a sine and its octave at 0.12 (`engine.ts:871-883`): nothing over about 3 kHz | from the target, broadband |
| `height.tone`, `height.rough` | the craft's own height, by pitch | no panner (the height bus) | a sine glide, 38 Hz roughness out of the band | unchanged (the owner's "drone's own tone") |
| `safety.floor` | a floor below | a hazard voice (HRTF) from the sampler's ray that saw it: straight down (sector `down`; Chrome takes -45) or 45 degrees down ahead (`front-down`) (`src/sense/sampler.ts`, `planner.ts:551-582`); note C3 (130.8 Hz) | `thud` in every theme (`synth.ts:95-105`): a sine under a 700 Hz low-pass with a pitch drop, and a 2 kHz noise click of 22 ms: almost nothing over 3 kHz | broadband |
| `safety.ceiling` | a ceiling above | a hazard voice from straight up (sector `up`, Chrome's 90 degree slice at azimuth 0) or 45 degrees up ahead; note E5 (659 Hz) | `air` (soft, clear; `synth.ts:106-114`): a quiet sine and a noise band at 4 x the note (2.6 kHz, Q 1.1), about 1.5 to 4 kHz; `noise` (race, `synth.ts:182-189`): noise high-passed at the note, broadband | broadband (soft, clear; race already is) |
| `safety.obstacle`, `safety.wall` | a block or a wall seen above or below (sectors `up`, `down`, `front-up`, `front-down`) | a hazard voice from the ray that saw it | `metal` (soft, race: partials 1, 2.76, 5.4 x A4 under a 6 kHz low-pass, a 6 kHz click), `click` (clear), `wood`, `sine` (walls): highs end at about 6 kHz | unchanged (they mean an obstacle, not up or down) |
| `safety.touch` | a touch of the floor or the ceiling | a static voice (HRTF) from the touch's direction | the safety timbre's ping and the material's note | unchanged |
| `safety.wrong-way`, `safety.wrong-side` | where forward is, where the gate is (may be above or below) | static voices from the event's `dir` (3D) | the safety timbre | unchanged |
| `target.hum`, `target.off` | the gate above or below | a moving voice from the gate's 3D direction, and one or two scale steps up or down by its elevation (`rules.ts:175-178` `elevationSteps`, `planner.ts:597`) | pad (soft: triangles under a low-pass at 4 x the note, a 3.2 kHz breath), sine (clear), pluck (race); the distance low-pass 9 kHz near to 1.4 kHz at 40 m | unchanged (already from its direction, with pitch) |
| `shape.*` | the traced outline's points above and below (a pillar sweeps up and down) | a moving voice tracing the outline in 3D, with the elevation steps (`planner.ts:642-678`) | the shape timbre and a 3.5 kHz breath (`engine.ts:41-42`, `synth.ts` `ToneVoice`); the distance low-pass 9 to 2 kHz | unchanged |
| `target.note`, `.lap`, `.checkpoint`, `.fanfare`, `.praise`, `.stage`, `speed.tick`, `room.bed` | nothing of up or down | centred | | unchanged |

So in v0.13 the three cues that mean up or down most plainly are placed against it or not at all: the open-way chime
for a way above or below comes from ahead, the target note has no direction, and the floor and ceiling hazards come
from below and above but carry almost nothing in the band where the HRTF tells height (the race theme's ceiling is the
one exception).

## Decisions

### E1-2, up and down by direction too

- The open-way chime above or below comes from the way itself: `findFreeWay` (`src/sense/freeway.ts`) now measures the
  free span at the probe's depth (two rays from the probe point: back toward the craft's line to the obstacle's edge,
  out to the far surface, each at most `FREE_SPAN_MAX_M` 1.8 m) and gives its middle (`FreeWay.middleM`) and the
  listener-frame direction to it (`FreeWay.dir`). The middle, not the probe point: in tunnel-gaps the first probe that
  fits is 0.55 m up while the way's middle is 0.9 m up, 22 degrees against 14 at 2 m, and Chrome's slices are 15
  degrees apart. Measured on the box tunnels (a 1.2 m way past a block, at 3 m/s): the middle is 0.9 m out at every
  frame, the chime 8.2 degrees above (or below) ahead with the block 5.9 m away, 14.8 at 3 m, 20.2 at 2.1 m and 31.0 at
  1.1 m (the probe point alone: 5.0, 9.2, 12.7, 20.1). In tunnel-gaps, flown along its track at 2 m/s, the chime
  above comes from 8 to 20 degrees up (median 13) and the one below from 8 to 20 down (median 12): Chrome's 15 and -15
  degree slices, against 0 straight ahead. That is the real direction the task asks for; left and right keep their 60
  degrees (`FREE_DIRS`, an exaggeration of the real one), their notes and spectrum: only the cues of up and down change.
- A named or previewed chime (an intro's cue from up or down, the glossary's preview) has no obstacle to measure:
  `FREE_PREVIEW_DIRS`, 30 degrees above or below ahead (Chrome's 30 and -30 degree slices after the engine's +7.5).
- The target note: from the next gate's centre (the hum's direction); a band (hover-height, hover-turn) has no point,
  so from the band's middle `TARGET_AHEAD_M` (2 m) ahead along the heading: 0.3 m under the middle is 8.5 degrees up,
  0.5 m is 14, 0.9 m over it is 24 degrees down. There was no look-ahead in the planner to reuse; 2 m keeps the
  direction a smooth function of the height (a point right over the craft would flip from straight up to straight
  down at the middle). The glossary's preview comes from above while the tone climbs to it and from ahead at the end
  (from below with the polarity turned over). The engine gives the target notes a panner of their own (8 + 24 + 1
  panners; the voice-budget proof's bound says so) and brings the height tone back 6.5 ms later after a placed note
  (Chrome's HRTF begins 5.6 ms late), so the tone and the note still never sound together.
- The floor and the ceiling already came from below and above (the sampler's rays); what they lacked is the band where
  the HRTF tells height. They, the chime above and below and the target note now carry a breath of air: white noise
  through a second-order high-pass at 4 kHz and low-pass at 16 kHz (`AIR_BAND_HZ`), under the note's own envelope for
  at most 0.25 s after the attack (`AIR_MAX_S`; the whole 280 ms of a target note), at `ELEVATION_AIR_DB` -10 dB
  against a unit fundamental (`VoicePlan.airDb`, `TargetTone.airDb`). The chime's low-pass goes from 12 to 18 kHz
  (`ELEVATION_LOWPASS_HZ`) so the breath reaches 16 kHz; the hazards keep their distance low-pass (16 kHz near).
- Unchanged by construction and held by the tests: every note, interval, period, note length, level, roughness, beat
  and Doppler of every voice, the height plans but for the target's `dir` and `airDb`, the one-off notes, the voice
  slots and what is dropped, in all seven flights with the setting on against off.

### E1-4, the words

- Lesson versions: tunnel-gaps 1 to 2 and walls-pillar 2 to 3, because `main` 16c01a1 is public and the simulator's
  wave 2 pins it: a recording of that build in either lesson would re-derive other plays and lines here and read
  FAIL; with the new version it reads "recorded with an older build". The corridor's lesson file is unchanged (only its
  line's text), so its version stays 2.
- The corridor's intro.3 is long now (16 s with the local voice, 11.5 before); it says left, right, above or below in
  one line, as the glossary does.

### E1-5, the wrong way between gates

- Why 8 m failed: it was set for rings 14 m apart (review R1: a pilot back from beside a missed ring ends about 5 m in
  front of it), and every leg of the v0.13 rooms is 5 to 6.2 m (rings-small 5, rings-line and shapes-series 6,
  rings-course's first 6.1, rings-heights 6.18 with its height step), so the whole gap between two gates lay inside it.
- Scaled with the leg (the gate before, or the lesson's start for the first gate): 2.86 m for rings-small, 3.43 to
  3.53 m for the others; 8 m from a leg of 14 m on. The truth bot flies back up to 3 m between two gates of
  rings-small (from 4 m past one gate to 4 m before the next); it crosses the line-up distance for 1.14 m at 2.5 m/s,
  0.46 s, under the second it takes to be told.
- Against the leg, not away from the gate: with the radial rule of v0.13 and the shorter line-up distance, the review
  R1 flight in rings-small (a pilot moving 3.5 m aside, 3 m in front of ring 2, to fly round it) was told "wrong way"
  (that test failed); moving aside is not flying back. The cue still says where the gate is (its `dir`), and the
  control `lineUp 'fixed'` is v0.13's rule exactly, both parts.
- The imperfect pilot (65 % of the cap, a sideways wobble of half its clearance in each opening, 1.2 s still every
  3 m) passes rings-first, rings-line, rings-small and rings-heights in 3 attempts, the shapes in 2, rings-course in 1,
  with no touch.

## Needs from the simulator

- The panel (M41-25, wave 2 W14): `engine.plan.freeWay` has two new fields, `dir` (where the way's middle is, listener
  frame) and `middleM` (how far beside the craft's line); `engine.plan.height.target.dir` is where the target note comes
  from, and the active cue `height.target` carries that direction (it had none). Nothing in the host has to change for
  the sound itself.
- The mode's spoken settings (M41-3, M41-4; wave 2 W13, beside `heightTarget` and `motorGainDb`): offer
  `heightDirection`, on and off (`menu.value.on`, `menu.value.off`), named by `menu.setting.height-direction` ("Sound
  from above and below") and explained by `menu.setting.height-direction-what` when the pilot lands on it (as
  `menu.setting.calm-what` explains calm mode), saved through `setup.update()` with the whole document. Nothing else:
  the engine reads it from the prefs it is given.
