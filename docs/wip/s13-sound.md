# Lane s13-sound: the sound of v0.13 (owner's message 41)

Plan: ShramkoGSFPV `docs/wip/v13-plan.md` (items M41-12 to M41-17, the lanes, the checks). Branch `s13-sound`, worktree
`C:/dev/sonic-s13-sound`, cut from `main` 7d4b4b9 with `vl-spec` merged (the virtual listener's design,
`docs/design/virtual-listener.md`). Sole writer: this lane. Never pushed; the lead merges.

## Ownership

Owned here: `src/cues/*`, `src/sense/*`, `src/theme/*`, `src/audio/*`, `themes/*`, `src/prefs/*`, the `layers` field of
the lesson files, and the new measuring rig (`test-audio/listen*`, `tools/listen/`, `evidence/listen/`).
Not owned: the runner, goals and every other field of the lesson files (lane s13-lessons), the world generators (lane
s13-worlds). In `src/contract.ts` this lane only adds its own types and fields; every existing field keeps working.
Shared event kinds (plan, "Lanes"): the runner emits the cue events `wrong-way`, `wrong-side`, `praise`, `stage` and
`repeat-cue` (with the cue id); this lane owns how each sounds.

## Status

- [x] 1 This lane doc: checklist, ownership, facts of v0.12 with file and line, commit 5ea4bf8 (with two sessions
  recorded by the v0.12 engine, `test/fixtures/session-v012-*.zip`, for the replay check of step 10)
- [x] 2 Height (M41-12): a continuous glide and a steady target tone on the scale (`src/cues/height.ts`,
  `test/height.test.ts`, 15 tests); `pnpm proof:audio` after it: see step 10
- [x] 3 Time to contact (M41-13): hazards by time to contact, quiet far walls when slow, always heard within 0.8 m
  (`src/sense/sampler.ts`, `src/cues/rules.ts`, `test/ttc.test.ts`, 22 tests)
- [x] 4 Free way (M41-14): the open-way chime from the free side (`src/sense/freeway.ts`, planner, engine;
  `test/freeway.test.ts`, 14 tests on box tunnels, `test/helpers/boxes.ts`)
- [x] 5 Event sounds (M41-15, M41-11, M41-5): wrong-way, wrong-side, praise, stage, repeat-cue (contract
  `CueEvent`, planner; `test/events.test.ts`, 14 tests)
- [x] 6 Motor (M41-16): on by default, under the cues, ducked under speech (engine motor bus, prefs default and
  migration, `test/prefs.test.ts`; the level is measured and calibrated by the rig in step 9)
- [x] 7 Never silence (M41-10), the planner's part (lesson layers, the pad swirl; `test/silence-layers.test.ts`, 3
  tests; it was `test/silence.test.ts` until the review fixes, renamed so it does not collide with s13-lessons' file)
- [x] 8 Speech level (M41-17): speech 3 to 6 LU over the mix, true peak at most -1 dBTP (themes' `voice.volume`
  from the rig's measurements; `evidence/listen/VL-6-speech.json`, `VL-6-peak.json`)
- [x] 9 The first measuring rig of the virtual listener (VL-0, part of VL-2 and VL-6): `pnpm listen`, 7 checks with
  their controls, all valid and passing (`evidence/listen/`)
- [x] 10 The full checks: `pnpm typecheck` clean; `pnpm test` 25 files, 650 tests (the locale lint and the layout
  check run inside it: `test/locales.test.ts`, `test/layout.test.ts`); `pnpm proof:audio` 3 files, 9 tests, 39 s, every
  proof passing and every broken control failing; `pnpm listen` 7 of 7 checks valid and passing, fresh for inputs
  61b845a05094; the v0.12 recordings replay as recorded with an older build (`test/replay-v012.test.ts`)

Fixes after the review (`docs/wip/s13-sound-review.md`), one commit per fix or small group:

- [x] B1 objects by the craft's path: five rays along the velocity decide the collision course and give an object
  between two sector rays its time to contact (`src/sense/sampler.ts` `pathObjects`, `collisionCourse`); box faces and
  the walls-pillar pillar heard 2.48 to 2.50 s before contact at every angle tried (`test/ttc.test.ts`, 8 new tests)
- [x] B2 the five shared cue events with s13-lessons' fields: the same text of the five `CueEvent` members as
  s13-lessons' (its worktree at 1862a33 plus its uncommitted R2 fix, read 2026-11-08); the planner sounds a repeat-cue
  for the play's `durS`, a stage by `stage`, wrong-way and wrong-side from `dir`; the engine plans a repeat-cue at once
  (`test/events.test.ts`, 16 tests; `test/replay-v012.test.ts` relaxed as s13-lessons' review R2 asks)
- [x] M1 the open way in narrow tunnels: probes from 0.25 m out in steps of 0.15 m with the hull's half width and
  3 cm; tunnels 2, 1.6 and 1.2 m wide, a way on every side, the craft at three places across the obstacle: each way
  named, never another (`src/sense/freeway.ts`, `test/freeway.test.ts`, 21 tests with the controls)
- [ ] M2 the target height without a beat that sounds like "out of band" or "off aim"
- [ ] M3 the motor calibrated on the default craft and the micro presets
- [ ] M4 the voice the owner's Chrome speaks
- [ ] M5, M6, m4, m7 what the simulator, the lead and s13-lessons must do, in this doc
- [x] m1 no open-way chime at a gate ahead (the target layer leads through it), with its control (same commit as M1)
- [ ] m2 the open-way chime's above and below
- [ ] m3 the pilot's motor level
- [ ] m5 the new lines in their languages
- [ ] m6, m8 stale statements, build-machine folders
- [ ] The full checks again, the final status

## Final status (2026-11-08)

Done, with commits (branch `s13-sound`, not pushed):

| Step | Item | Commit |
|---|---|---|
| 1 | lane doc, facts of v0.12, two v0.12 recordings | 5ea4bf8 |
| 2 | M41-12 height glide and target tone | f601639 |
| 3 | M41-13 walls by time to contact (and the proofs after it) | 8e87fb4, 0ee1ec3 |
| 4 | M41-14 open-way chime | 27d13f8 |
| 5 | M41-15, M41-11, M41-5 event sounds | 7b7bee8 |
| 6 | M41-16 motor on, under the cues | f1afa7f |
| 7 | M41-10 never silence, the planner's part | 00efe02 |
| 9 | the rig, its code and its first runs | 1452641, faa630b |
| 8 | M41-17 speech level, and the rig's passing evidence | e5bdaae |
| 10 | the full checks, the v0.12 replay test, the proofs' evidence | 2a35675, and the first-note fix after it |

Left open, with reasons:

- Not rendered by the rig yet: the open-way chime and the five event earcons (their checks are the planner's: on the
  scale, distinct, planned peaks at least 3 dB under a hazard pulse); a rendered "never louder than the safety sound"
  and a three-onset check of repeat-cue need the runner's events (lane s13-lessons) in a scripted lesson.
- The motor sits 14.5 LU under the cues, not "about 10": louder, the shape trace's 630 Hz band would fall under 6 dB
  over the motor (the plan's own masking rule binds first). Measured with a stand-in of the simulator's motor (a
  5-inch quad on 6S); a whoop's rotor sings higher and needs the simulator's own motor in its bench (design VL-0e).
- The target tone of a 3 m gate is A4 in soft and clear, the shape trace's note; where both layers are on they can
  beat together. Not measured yet (design VL-2's informational-masking flag).
- Target heights off the lesson's 0.5 m grid (rings-course's random gate heights) give target tones off the scale (in
  exact unison still).
- A slowing craft no longer hears a wall it has stopped short of (over about 1 m and 3 s): `walls-hall`'s "stop
  within 3 m" (lane s13-lessons) and the corridor's quiet middle are the new behaviour to confirm with pilots.
- Speech: measured with the Windows desktop voice; Chrome may use a network voice whose level is unknown. Per line,
  the voice is 4 LU over a busy moment and up to 13 LU over a quiet one.
- The rig is the design's VL-0a, VL-0b and a cheap part of VL-2 and VL-6. VL-0c to 0e, VL-1 to 5 and 7 to 9, the head
  panel, the bots and clips through Web Audio are not built.
- v0.12 recordings: reported as recorded with an older build (theme soft version 2 here, flown with 1; lesson version
  2 here); their cue ids no longer match frame by frame (every flying frame now has the height tone and the bed).
- How any of it feels to a person: not measurable here; the first testers calibrate the "proposal" thresholds.

## API for the host (exact)

- `SonicEngine.motorInput?: object | null` (contract) and `FlyBySoundEngine.motorInput` (getter): the AudioNode for the
  simulator's motor sound; the engine's AudioContext as `.context`; silent while `SonicPrefs.motorSound` is false.
- `SonicPrefs.motorSound`: default `true`. `SonicPrefs.heightTarget?: boolean` (new, optional; absent or true: the
  target tone on); its setting text `menu.setting.height-target`.
- `readPrefs(stored)`: a pre-v0.13 document (no `heightTarget`) with `motorSound: false` reads as true, with an issue
  at path `motorSound`.
- `CueEvent` new members (one text with lane s13-lessons, review B2): `{ kind: 'repeat-cue'; cue: CueId; dir?: Vec3 |
  null; index?: number; of?: number; durS?: number }`, `{ kind: 'praise' }`, `{ kind: 'stage'; stage?: number }`,
  `{ kind: 'wrong-way'; dir?: Vec3 | null }`, `{ kind: 'wrong-side'; dir?: Vec3 | null }`; the host plays every one
  with `engine.cue(e)` as the runner hands it over. A repeat-cue sounds from its first audio frame (the engine plans
  at once, as for a preview) and for its `durS` (`REPEAT_PLAY_DEFAULT_S` = 2.5 when absent, held to 0.2 to 6 s).
- For the panel (M41-25): `FlyBySoundEngine.plan` (getter, the last `FramePlan`): `plan.height.heightM`,
  `plan.height.hz`, `plan.height.target` (`heightM`, `hz`, `onScale`, `noteIndex`, `gainDb`) or null, `plan.freeWay`
  (`side` 'left' | 'right' | 'up' | 'down', `offsetM`, `obstacleM`, `ttcS`) or null; active cue ids `height.target`,
  `safety.free:<side>`, `safety.wrong-way`, `safety.wrong-side`, `target.praise`, `target.stage` besides the old ones.
- Speak every line through `engine.say()`: the theme's `voice.volume` (0.74 soft, 0.87 clear, 0.77 race) sets the voice
  under the mix; a line spoken past the engine would be 7 to 11 LU louder.


## How v0.12 sounds: facts with file and line (code as of 7d4b4b9)

### Height

- `src/theme/pitch.ts:76-81` `heightNoteIndex`: `Math.round(heightM / metresPerStep)` (line 78), held to
  `[baseStep, maxStep]`. The height tone is one note of the pentatonic scale per `metresPerStep`: in soft and clear
  0.5 m per step, from note 3 (G3, 196 Hz) at the floor to note 17 (E6, 1318.5 Hz) at 7 m; race 0.4 m from note 4.
  A step is 2 or 3 semitones, so the tone jumps 2 or 3 semitones every 0.5 m and says nothing of the height in
  between: the owner hears the jumps and cannot tell where he is between them (message 41).
- `src/cues/rules.ts:187-192` `heightTone` takes that note; `src/cues/planner.ts:546-552` `heightPlan` turns it into a
  frequency; the engine glides to each new note (`src/audio/engine.ts:653-670`, `ToneVoice.setNote`,
  `src/audio/synth.ts:392-399`, time constant glideMs / 3: 27 ms in soft).
- The soft theme's height timbre is `pad`: two triangles 0.3 Hz apart (`src/audio/synth.ts:365`), a slow swirl at
  every pitch. A second tone beating against it would beat against the swirl too.
- Out of the lesson's band the tone is amplitude-modulated at 38 Hz up to depth 0.6 over 0.3 m (`rules.ts:179-184`).
- No target height is sounded. The target hum (`planner.ts:463`) moves by whole scale steps with the elevation of the
  gate's direction (`rules.ts:143-146`: one step at |dir.y| >= 0.2, two at >= 0.5), which says "above or below" only
  roughly and nothing about the height to enter at.
- Only `hover-height` has the height layer on (lesson files' `layers`); no ring or gate lesson has it.

### Hazards

- `src/sense/sampler.ts:65-99` `DEFAULT_SAMPLER_CONFIG`: range 40 m, ten sectors of three rays (20 degrees apart),
  hull radius 0.12 m; enter distances front 6 m, front-left and front-right 5, front-up 3, front-down 1.8, left and
  right 4, back 3, up and down 1.5; enter time to contact 3 s; release at risk 0.8 after a hold of 300 ms;
  stickiness 1.25; closing slower than 0.2 m/s is not closing.
- `sampler.ts:168-172` `riskOf` = max(enterDist / distance, enterTtc / ttc); on at risk >= 1 at once
  (`sampler.ts:258-263`), off when the risk is under 0.8 and the hold has passed. The time to contact is to the
  surface along its normal, a slanted ray stretched by 1 / cos^2 (`sampler.ts:209-224`). Ranking risk x sector weight,
  at most three voices (`sampler.ts:32`, `sampler.ts:266-290`).
- So a slow craft hears a wall ahead from 6 m whatever its speed: at 0.5 m/s that is 12 s before contact (the owner:
  far walls when slow are not wanted). A fast one hears it at 3 s (15 m at 5 m/s), but the code of that first
  moment is far-and-calm: the level slope is -4 dB per doubling of distance (`rules.ts:93-103`, -15.6 dB at 15 m
  against -5.3 dB at 2.5 m), the low-pass closes toward 2.5 kHz with distance, and the pulse period
  (`rules.ts:40-44`) takes x = min(ttc / ttcFarS, distance / distFarM) with distFarM 12 m, so under 12 m the
  distance, not the time, sets the rhythm. The first pulse period is 741 ms at 3 and 5 m/s (onset at 3 s) but
  392 ms at 0.5 and 1 m/s (onset at 6 m, 12 and 6 s before contact); at one time to contact of 2.5 s it is 187 ms at
  1 m/s (2.5 m) and 540 ms at 5 m/s (12.5 m). Urgency follows distance, not time to contact.
- Urgent (other layers 9 dB down): time to contact under 1.5 s or distance under 1 m (`rules.ts:47-55`).

### Motor

- `src/contract.ts:276-277` and `src/prefs/prefs.ts:31`: `motorSound` false by default ("it masks cues").
- `src/audio/engine.ts:227-229` `auxInput` is a plain gain node into the master (`engine.ts:444-445`): before the
  limiter, but not low-passed, not set under the cues and not ducked under speech or an urgent hazard.
- The simulator (ShramkoGSFPV `apps/fly/src/app/builtin/sound.ts:84` and `:112-121`) plays its motors into `auxInput`
  when `motorSound` is on, at its own `sound.volume` (15 % by default: master 0.7 x 0.15^1.5 = 0.041, -27.8 dB,
  `apps/fly/src/audio/motor-sound.ts:85-90`).

### Speech

- Web Speech (`src/audio/speech.ts`), outside the Web Audio graph: the limiter and the -6 dBFS ceiling
  (`src/audio/output.ts`) never touch it. `engine.ts:787-813` `say()` ducks the other layers by `duckDb` (12 dB)
  while a line is spoken; the utterance volume is the theme's `voice.volume` (1 in every theme) times the pilot's
  voice gain (`engine.ts:802`).
- The virtual listener's probe (`docs/design/virtual-listener.md`, section 0, item 1): Windows OneCore David at
  volume 1 is -16.6 LUFS with a true peak of -0.17 dBTP; a 12 s ring flight is -27.7 (clear), -28.4 (race) and
  -30.3 LUFS (soft): the voice is 11 to 14 LU over the flight.

### Silence in a flying lesson

- The room bed (`engine.ts:462-477`) is on only in `ears-glossary` and `free-garden`; `hover-height` has the height
  tone and the voice only, the walls lessons the safety layer only, so between hazards a walls lesson is silent.

## Decisions

### Step 2, height (M41-12)

- `src/cues/height.ts`: the height tone is a POSITION on the scale (`heightPosition`, `src/theme/pitch.ts`), one
  scale step per `metresPerStep`, never rounded; its frequency is `noteHzAt` (linear in semitones between two notes,
  exactly the note at a whole position). Between 1 cm steps it moves at most about 7 cents (3-semitone steps at
  0.5 m per step: 6 semitones per metre).
- The target tone: the next gate's centre when the runner's target is a gate (ring, square, cube frame), else the
  centre of the lesson's band, else none (a zone is not a height). It comes from the same mapping, so at the target
  height the two tones are in unison exactly; near it they beat (at 2.55 m against 2.5 m in soft: a few Hz), the beat
  slows to nothing at the target. Up-higher: the craft's tone under the target's means climb; up-lower turns both
  over.
- On the scale: the mapping is moved, once per lesson world (and band), by under half a step so that the lesson's
  REFERENCE height lands on a note: the first gate of the world, else the band centre. Every target on that
  reference's 0.5 m grid is then a note of the scale (hover-height 2.5 m, all rings and gates of the shipped lessons
  but the course's); a target off the grid keeps its exact unison and is marked `onScale: false` (rings-course's
  random heights 4.43, 4.15, 4.31, 3.28 m are off it). The other way round (every target a note, unison off by up to
  a quarter metre; or the mapping re-anchored at each new gate, so the craft's own tone would drift by up to a step
  at each gate) breaks "unison at the target" or "a function of height". `race` now has 0.5 m per step like the
  others (was 0.4), so the grid is one for every theme.
- Both height tones are soft sines in every theme (engine `renderHeight`): the soft theme's pad had its own 0.3 Hz
  swirl, which would beat as well, and a gliding tone rich in partials roughens against the mix. The target tone is
  one partial (no sub-octave) and sits `height.targetDb` under the height tone (-6 dB; calm another -4 dB), so the
  beat is a wobble of about 9.5 dB, not a hole. The band roughness stays on the height tone only.
- Theme parameter `height.targetDb` (new, `optional` in `LAYER_PARAMS`: a theme exported before v0.13 without it still
  loads and gets -6). Shipped themes are now version 2. Prefs field `heightTarget` (optional; absent or true: on),
  setting text `menu.setting.height-target`, cue `height.target` with its glossary line; `cue.height.tone.glossary`
  now says it slides.
- Lessons with the height layer on now: hover-height (as before) and every ring and gate lesson (rings-first,
  rings-line, rings-small, rings-course, shapes-square, shapes-series, shapes-cube, free-garden); each changed lesson
  is version 2 (only its `layers` changed here).
- Known overlap, not fixed here: in soft and clear the target tone of a 3 m gate is A4 (440 Hz), the shape layer's
  note, and the shape trace bends by Doppler around it; where both layers are on (rings-first, shapes-*) the two can
  beat against each other. The virtual listener's informational-masking flag (VL-2) is the check for it.

### Step 3, time to contact (M41-13)

- Sampler (`DEFAULT_SAMPLER_CONFIG`): enter distance 0.8 m in every sector (`ALWAYS_HEARD_M`), enter time to contact
  2.5 s (`ONSET_TTC_S`); range 40 m kept (3 s up to 13 m/s; the fastest shipped lesson is 5 m/s, a Node test holds it
  for every lesson). Release (risk 0.8, hold 300 ms) and ranking unchanged. Measured on the analytic plane at 60 frames
  a second: onset 2.5 s before contact at 1, 3 and 5 m/s (12.4 m at 5 m/s, 2.4 m at 1 m/s); at 0.5 m/s nothing until
  1.25 m (v0.12: 6 m). Control: the v0.12 distance rule alone gives 1.2 s at 5 m/s.
- Side walls follow the same rule (no "rails"): in a corridor the pilot hears a wall when drifting toward it (under
  2.5 s) or within 0.8 m, and nothing when centred and flying straight. One rule for every sector is what the owner
  asked ("everything by speed"); the corridor's intro ("if the knocks are louder on one side, move away from that
  side") still holds, but a 5 m corridor is quiet in the middle now.
- Urgency follows the time to contact: the pulse rhythm's distance floor has its own scale, `safety.pulseDistM` (2 m,
  new and optional; it was `distFarM`, 12 m, so under 12 m the distance set the rhythm), and the level and brightness of
  a closing hazard follow `min(distance, ttc x 1 m/s)` (`urgencyDistanceM`, `hazardDistanceCode`): a wall 12.5 m ahead
  at 5 m/s is as loud and bright as one 2.5 m ahead at 1 m/s, while its reverb send still says far. Measured in the
  planner: the same time to contact (2.4, 1.6, 1 s) gives the same period (within 2 %), level (0.5 dB) and low-pass
  (5 %) at 1, 3 and 5 m/s; control: the v0.12 rules give a 1.3 times slower rhythm and 6 dB less level at 5 m/s.
- Urgent (the other layers 9 dB down): time to contact under 1.5 s, or within 0.4 m (was 1 m), so a narrow tunnel
  whose walls are 0.7 m away does not keep every other layer ducked.
- Objects (rings, pillars, bars, boxes), as fixed after the review (B1): five rays along the velocity (the centre
  line and four lines at the hull's edge, `pathObjects`) find what the craft would hit flying straight on. A sector
  ray's hit on an object keeps its time to contact only when one of them meets the same object, and each object they
  meet is also a reading of the sector it lies in, with its time along the path. Without any rule, flying through a
  ring made its tube look like a wall closing in 0.7 s in one frame; every side sector came on, and the 300 ms hold
  then voiced the far hall walls they saw next; that frame-sized flash also broke the replay check of the recorded
  rings-course flight (94.1 % of the frames agreed, under the 95 % rule). Through a ring's opening the path rays pass,
  so the ring test and the recorded flights replay as before. The first rule (the path within the hull plus 0.3 m of
  the point a sector ray found, now the control 'hit-point') heard wide objects late. Measured (60 Hz frames, time
  to contact at the first frame with a hazard on the object; shipped, 'hit-point', 'none' = no rule as v0.12):

  | Object, speed, path | shipped | hit-point | none |
  |---|---|---|---|
  | box face across a 20 m hall, 3 m/s, sinking 2, 5, 10 deg | 2.50, 2.49, 2.49 s | 2.50, 1.57, 0.77 s | 2.50, 2.49, 2.49 s |
  | same, 5 m/s | 2.50, 2.49, 2.49 s | 2.38, 0.94, 0.46 s | 2.50, 2.49, 2.49 s |
  | walls-pillar's pillar (0.5 m), 3 m/s, path 0, 0.3, 0.5 m off its axis | 2.49, 2.49, 2.48 s | 2.49, 1.60, 0.41 s | 2.49, 1.60, 0.78 s |
  | same, the path at 10 deg to the hall | 2.49, 2.49, 2.48 s | 0.64, 0.77, 0.83 s | 0.64, 1.14, 1.49 s |
  | same, 5 m/s, straight, 0, 0.3, 0.5 m off | 2.49, 2.49, 2.48 s | 2.49, 1.59, 0.24 s | 2.49, 1.59, 0.48 s |
  | the pillar straight ahead, the nose 5 and 10 deg off the path, 3 m/s | 2.49, 2.49 s | 1.19, 0.64 s | 1.19, 0.64 s |

  The last rows are the ray fan's resolution (20 degrees between sector rays): without the path's own reading a thin
  pillar is seen only once it is wide enough to meet a sector ray. A path that passes the pillar by more than the hull
  gives it no time to contact; it is heard within 0.8 m only. Walls, floor and ceiling (no object id) keep the time
  to their plane along its normal. Cost: five more rays a frame while moving.

### Step 4, free way (M41-14)

- Trigger: one ray straight along the nose; something closing on it in under 3 s (`FREE_TTC_S`). Not the front
  sector: its side rays see a side wall the craft drifts toward, which the first version took for "an obstacle
  ahead" (and then said "free on the right" inside the left gap). A dead end gives the trigger and no free side.
- Search (`findFreeWay`), as fixed after the review (M1): a point 0.25 m past the obstacle's front, 0.25 to 1.8 m to
  the left, right, above or below the craft's line in steps of 0.15 m (0.2 m past 1 m; nearest first; at one offset the
  side already sounding first, then the side of the drift, then left, right, up, down). A side is free when the
  straight line there is clear (hull included) and the passage past the front stays free for 1.5 m at its middle and
  0.15 m to either side (the hull and 3 cm: a way is at least 0.3 m wide; a 0.26 m slot is no way). At most 4 rays a
  probe (one when the probe cannot see its point), 40 probes, only while the trigger holds. The first probes (0.7, 1.2
  and 1.8 m, 0.2 m to either side) needed a way reaching 0.9 m from the line: in 48 starts (tunnels 3, 2, 1.6 and
  1.2 m wide, a way of 1.2, 0.8, 0.6 and 0.5 m on each side, the craft at three places where the obstacle is ahead)
  they named the way in 27, the new probes in all 48, each from the first frame (1.96 s before the obstacle here).
- No chime when the obstacle ahead is a gate (a ring, a square or a cube frame with a place in the course; review m1):
  the target hum leads through it, and the first version, flying at a ring's tube, said "left" outside the ring while
  the hum said "right". The hazard still sounds when the path meets the tube (B1).
- The chime (`safety.free`, safety layer, priority 90: under every hazard, over the target): a quick two-note figure on
  the scale (the note and two steps up, 70 ms apart), every `safety.freePeriodMs` (600 ms; calm x 1.3), at -4 dB in the
  safety bus. Left and right: from 60 degrees to that side. Above and below: from straight ahead, the figure three
  steps higher (above) or lower (below) than the side chime's `safety.freeStep` (note 13, G5 in the shipped scale),
  turned over with the polarity like the height tone; no HRTF elevation is relied on. Held 400 ms past the last
  frame that found it, so it does not stutter at the obstacle's edge. Active cue `safety.free:<side>`, and
  `FramePlan.freeWay` (side, offset, distance, time) for the host's panel (M41-25). The glossary preview with no
  direction plays the four sides in turn.
- Measured on box tunnels (3 x 3 m, an obstacle leaving 1.2 m free on one side): each gap gives its side and no other;
  control: a closed tunnel gives no chime while the obstacle's knocks sound; control: a gap on the left gives no
  right chime from 36 starts (three lateral positions, three heights, four drifts). Narrow tunnels (review M1): 2 x 2,
  1.6 x 2 and 1.2 x 1.5 m with a way of 0.8, 0.6 and 0.5 m on each side, the craft at three places: that side and no
  other every time; controls: the same tunnels closed give none, and the first probes miss 6 or more of the 8 ways of
  the 1.6 and 1.2 m tunnels. What it cannot show: whether a
  pilot takes a high two-note figure from ahead for "over" without training (the glossary line says it).

### Step 5, event sounds (M41-15, M41-11, M41-5)

- Contract (`src/contract.ts`, `CueEvent`, added members only), as fixed after the review (B2) to lane s13-lessons'
  text: `repeat-cue` { cue, dir?, index?, of?, durS? }, `praise`, `stage` { stage? }, `wrong-way` { dir? },
  `wrong-side` { dir? }. Cue ids (glossary names and lines in four languages): `safety.wrong-way`,
  `safety.wrong-side`, `target.praise`, `target.stage`.
- The figures, all notes of the scale, around the gate melody's root (note 5, C4) and an octave above it:
  wrong-way, two falling pairs (2 to 0, twice, 0.34 s apart) in the safety layer's own timbre, from `dir` (the way
  forward: where to turn to; centred without it); wrong-side, three notes falling from the gate notes' register to the
  root (5, 3, 0), from `dir` (where the gate is); praise, a short bright rise an octave up, one of three
  figures in turn (0 2 4, 2 4 5, 0 3 5) so it does not tire; stage, a run of five notes and a soft root under its end,
  one step higher with each stage (four at most). Shorter and lighter than the fanfare (the lesson's pass). Every
  event's figure is unlike every other earcon's (onset times and notes compared for all ten, in every theme and calm).
- Never louder than the safety sound: planned peaks (layer gain plus note gains, notes within 20 ms summed) are at
  least 3 dB under a hazard pulse at 1 m in every theme and calm (wrong-way and wrong-side 3 dB, praise and stage on the
  target bus 4 dB lower again); the rendered check is the rig's (step 9).
- repeat-cue plays the cue's glossary sound for the play's own length, `durS`, which the runner gives (s13-lessons:
  2.5 s for a continuous cue, 1.2 s for a one-off one, the next play 1 s after): a one-off cue as its own notes, cut at
  `durS`; a continuous cue as a preview of exactly `durS` (a wall approach from 8 m to 0.8 m; a play under 1.5 s starts
  at 3 m so it still has four or more pulses). The engine plans the frame at once, so a play starts with the event,
  not with the next frame. ONE event is ONE play. An unknown cue id plays nothing. Until the review the planner played
  every repeat-cue for 0.9 s whatever the runner said, which left 2.6 s of silence between two plays of a continuous
  cue (review B2; the 0.9 s play is the test's control now).
- Previews in flight (s13-lessons' question 6): a repeat-cue or preview of a height, speed or room cue takes that live
  layer's place for its length (one height tone at a time); any other sounds beside the live layers, which do not
  duck. Ducking them would also duck the named sound when it shares their bus, and a pilot asked for the repeat.

### Step 6, motor (M41-16)

- `SonicPrefs.motorSound` is true by default. The setting stays (`menu.setting.motor`).
- v0.12 saved prefs: the simulator saves the whole document at any change, so a v0.12 document holds
  `motorSound: false` (the v0.12 default) whether or not the pilot ever touched the motor. `readPrefs` (the lenient
  reader the simulator loads with) therefore turns `false` into `true` for a document saved before v0.13 (it has no
  `heightTarget` key, which every v0.13 document has) and reports it as an issue; `true` stays `true`. The one choice
  that is lost: a v0.12 pilot who turned the motor on and then off again gets it on once. From the first v0.13 save
  every value is kept. The prefs format stays `shramko-sonic-prefs/1`; the strict `validatePrefs` (session manifests)
  never changes a recorded value, so v0.12 packages read as before.
- Engine motor bus (`motorInput`, new optional member of `SonicEngine`): input, 2nd-order low-pass at 1.5 kHz
  (the rotor's note and the low wash stay, the hiss over 2 kHz where the cues' direction lives goes), a leveller
  (compressor at -50 dB, ratio 4, knee 6 dB, its make-up gain taken back out) so a motor played at any position of the
  simulator's volume slider stays within a few dB, `MOTOR_LEVEL_DB` after it, a gate that is shut while
  `motorSound` is off, and a duck like the layers': 12 dB under speech (theme `duckDb`), 9 dB under an urgent hazard.
  `auxInput` is unchanged: a raw input before the limiter.

### Step 7, never silence (M41-10, the planner's part)

- Every flying lesson (16, modules 1 to 7) has the height layer and the room bed on now (lesson files' `layers`;
  each changed lesson is version 2). In a hover or between attempts the pilot hears the height tone (with its target
  tone where there is a target height) and the quiet bed; the motor (step 6) is the third. Measured on the test host:
  hover-height, every 30 Hz frame from the first attempt on, the pause between attempts included, has the height tone
  and the bed; walls-hall hovering mid-hall has no hazard and still sounds; control: the same frames with the v0.12
  layers (safety and voice) are silent in all 90 frames.
- Found while doing it: v0.12's soft height tone was a pad of two equal triangles 0.3 Hz apart, so every 3.3 s it fell
  to its sub-octave alone, a near-silence inside the band. The height tones are sines since step 2; the pad's swirl
  (still used by soft's shape trace) now dips 6 dB (second triangle a quarter of the pad, was half).
- Note for VL-3c (at most two streams in modules 0 to 2): hover-turn and move-stop now carry the height tone and the
  bed besides their own layer. The bed is the owner's request (silence must mean something is wrong).

### Step 8, speech level (M41-17)

Measured, not guessed (the rig, step 9, and the clip maker `tools/listen/tts/sapi-clips.ps1`):

- The Windows desktop voice (SAPI, Microsoft David Desktop: the local voice family Chrome's speechSynthesis offers on
  Windows) at volume 100: the hint line is -16.5 LUFS with a true peak of -0.46 dBTP. Its volume law, measured at
  100, 90, 80, 70, 60, 50, 40, 25 and 10: 0.25 dB per step, linear in dB (50 is -12.5 dB, 25 is -18.8 dB, 10 is
  -22.5 dB). That Chrome hands `utterance.volume` x 100 to that voice is an assumption: the browser's voice cannot be
  captured (design, section 2.6).
- The flight's mix (the ring flight of the rig, the motor at the simulator's 15 %, from the end of the fade-in):
  soft -28.5, clear -25.2, race -27.6 LUFS. The voice (all three lines, integrated) at volume 1 is -17.3 LUFS: 11.2,
  7.9 and 10.2 LU over the mix (the probe's 11 to 14 LU, measured on other flights).
- Set: the themes' `voice.volume` for 4.5 LU (the middle of 3 to 6): soft 0.74, clear 0.87, race 0.77. Measured
  after (final run): 4.66, 4.65 and 4.73 LU; the true peak of what reaches the ears (engine and voice) -6.98, -3.73
  and -6.27 dBTP (control, volume 1: -0.52, -0.50, -0.49 dBTP, over the limit). The pilot's own voice gain still
  scales it (`layerGainDb.voice`).
- The master gain stays: the engine's own true peak is -10.9 (soft), -11.3 (clear) and -13.6 dBTP (race), at the
  output compressor's threshold of -10 dBFS (ceiling -6 minus 4): a louder master would start squeezing the cues'
  pulses, so the voice's volume is the knob that moves.
- Per line (information, `VL-6-speech.json`): against the 3 s before it a line sits 3.8 to 4.7 LU over a busy
  moment and 10.7 to 13.2 LU over a quiet one (the turn after the ring: only the height tone, the bed and the
  motor). One utterance volume cannot hold 3 to 6 LU against both; the engine's 12 dB duck lowers the cues under
  every line anyway.
- Not measured: the voice and level Chrome really uses (the engine asks for en-GB; on a machine with only en-US
  local voices Chrome may take a network voice, whose level is unknown); how loud a person sets the headphones.
  Playing pre-rendered clips through the engine's limiter (design, section 13) would make both exact.

### Step 9, the first measuring rig (VL-0, a cheap part of VL-2 and VL-6)

Found by the rig and fixed in step 10: a ToneVoice's first note glided up from the oscillator's own 440 Hz while the
voice faded in (the new target tone at its first frame, and the room's drone at every start since v0.12); the first
note is now set at once.

One command: `pnpm listen` (`node tools/run-tool.mjs listen`, `--force` to run again with nothing changed).
Environment: `SHRAMKO_LISTEN_PY` (the Python of `tools/listen/requirements.txt`; on the build machine
`U:/venvs/shramko-listen/Scripts/python.exe`), `SHRAMKO_LISTEN_CACHE` (on the build machine
`U:/cache/shramko-listen`; default `.cache/listen`), `GPU_LOCK` (default `C:/dev/.gpu-lock`).

- Render (`test-audio/page/listen.ts`, `test-audio/page/listen-types.ts`): scripted flights through the real engine,
  OfflineAudioContext at 48 kHz, frames at 60 Hz by suspend and resume, four channels (the ears after the output
  chain, the master before it), solo stems (the engine's `solo` hook feeds what it leaves out into a silent node, so
  every voice is processed as in the mix), the truth per frame (height, target height and tone, hazards with
  distance and time to contact, the free way, urgent, speaking, the motor), speech that keeps the time of its clip,
  and a motor stand-in that follows the simulator's motor recipe. Scenarios: a climb (0.5 to 4.5 m at 0.5 m/s), three
  approaches at 1, 3 and 5 m/s, a 16 s ring flight (ring at 3 m, a height dip, a gate note, praise, a turn, a run at
  a wall at 4 m/s, three spoken lines). Controls: v0.12 stepped height, the distance-only sampler, the raw motor at
  60 %, another noise seed.
- Driver (`tools/listen.ts`): clips by `tools/listen/tts/sapi-clips.ps1`, 18 renders in headless Chrome under the GPU
  lock (about 40 s), `tools/listen/measure.py` (about 10 s), evidence `evidence/listen/<check>.json` and `index.json`
  under the sha256 of every input (106 files: src, themes, lessons, locales, the rig's own code, package.json, the
  lockfile); renders cached in `SHRAMKO_LISTEN_CACHE/renders/<hash>/`. Nothing changed and the last run passed:
  nothing runs.
- The checks, each valid only when its control fails (final run 2026-11-08, Chrome 156.0.8078.80, inputs
  61b845a05094):

| Check | Measured | Control |
|---|---|---|
| VL-0a two renders the same | max difference 1.8e-7 (float32 rounding; limit 1e-6) | noise seed 2: 0.045 |
| VL-0b stems sum to the pre-chain mix | residual -127.6 dB (limit -90) | the height stem left out: -2.6 dB |
| height pitch track continuous | largest change 3.7 cents per 10 ms in the climb (limit 25), 7.8 cents median behind the plan (the glide's smoothing) | v0.12 stepped tone: 118.7 cents |
| hazard onset before impact | 2.475, 2.493, 2.475 s at 1, 3, 5 m/s (at least 2) | distance-only rule at 5 m/s: 1.18 s |
| voice over the mix | soft 4.66, clear 4.65, race 4.73 LU (3 to 6) | volume 1: 11.2, 7.9, 10.5 LU |
| true peak, engine and voice | -6.98, -3.73, -6.27 dBTP (at most -1) | volume 1: -0.52, -0.50, -0.49 |
| cues over the motor in their own third-octave bands | safety 28.3, height 24.8, target 18.3, shape 7.8 dB (at least 6); motor 14.5 LU under the cues | raw motor at 60 %: shape 0.6 dB |

- What it cannot show: how any of it feels to a person; other heads than the HRTF's own (no panel yet); the voice
  Chrome really uses; masking between cues (VL-2's glimpses), telling cues apart (VL-3), intelligibility (VL-4) and
  music (VL-5) are not built yet. The design's later steps (panel, bots, clips through Web Audio) are untouched.

## Needs from the simulator

- M41-16, motor (`apps/fly/src/app/builtin/sound.ts:112-121`, `startOnEngine`): connect the motor sound to
  `ctx.sonic.engine.motorInput` instead of `auxInput` (fall back to `auxInput` when `motorInput` is undefined: an
  older package). Its `context` is the engine's AudioContext, as `auxInput`'s. `enabled()` (`sound.ts:84`) already
  reads `prefs.motorSound`, which is now true by default; nothing else changes there. `apps/fly/src/sonic/audio.ts:16`
  `PageEngine`: add `'motorInput'` to the Pick. The bench tests that hold the old default
  (`tools/bench/test/sonic-audio.test.ts:177` and `:428`, `motorSound` false) must expect true.
- M41-25, the panel: draw the height bar from `engine.plan.height` (the craft's `heightM`, the target's
  `target.heightM`, both tones' `hz`), the radar from the active cues' `dir` and `plan.freeWay.side`; add `'plan'` to
  the `PageEngine` Pick. A step that plays a sound three times (M41-5) shows the cue named in the `repeat-cue` event.
- M41-4 and M41-3, the mode's settings: offer `heightTarget` ("Target height tone", `menu.setting.height-target`) beside
  `motorSound`; both through `setup.update()` (`apps/fly/src/sonic/entry.ts:51`), which saves the whole document (a
  saved v0.13 document keeps the pilot's motor choice).
- The voice: the menus and the progress lines of M41-3, 4 and 7 must go through the engine's `say()` so they get the
  theme's measured volume (a separate speechSynthesis call would be 7 to 11 LU louder than the mix).
- The cost bench (`tools/bench/src/sonic-analytic-cost.ts`): the planner now casts six more rays a frame while flying
  (the five path rays of B1 and the free way's trigger), and while something closes straight ahead in under 3 s up to
  160 more (40 probes of 4; a probe that cannot see its point costs one, so a dead end costs about 40); worth one
  bench run.

## Needs from other lanes

- s13-lessons: the lessons whose `layers` this lane changed are version 2 (all 16 flying lessons); a lesson changed by
  both lanes needs one version 2, not 3. The tests that held lesson version 1 (`test/replay.test.ts`,
  `test/report.test.ts`) now read the lesson's own version.
- s13-worlds: target heights (band centres, gate centres) on one 0.5 m grid per lesson, counted from its first gate (or
  its band centre), keep every target tone a note of the scale; a target off the grid is still in exact unison and only
  off the scale (`onScale` false).

- s13-lessons (runner) and the lead at the merge (review B2): the five `CueEvent` members here are, word for word, the
  text in s13-lessons' worktree on 2026-11-08 (its uncommitted R2 fix over 1862a33: `repeat-cue` { cue, dir?, index?,
  of?, durS? }, `stage` { stage? }, `wrong-way` and `wrong-side` { dir? }), so that hunk merges clean if s13-lessons
  commits it as it was; if it changed later, take s13-lessons' text: the planner reads only `cue`, `dir`, `durS` and
  `stage`. In `src/cues/planner.ts` take this lane's side and drop s13-lessons' placeholder cases (`eventCue` and
  `cue()`). `test/replay.test.ts` and `test/report.test.ts` now carry s13-lessons' own lines for the lesson version, and
  this lane's never-silence test is `test/silence-layers.test.ts`, so neither collides. The glossary can name the new
  cues (`safety.free`, `safety.wrong-way`, `safety.wrong-side`, `height.target`, `target.praise`, `target.stage` are
  in `CUE_IDS` with their lines); a one-off cue of them is its own notes (s13-lessons' `ONE_OFF_CUES` should list
  `safety.wrong-way`, `safety.wrong-side`, `target.praise` and `target.stage` too, so their plays get the one-off
  length and check).

- s13-lessons: `walls-hall` asks to stop within 3 m of a wall (`approach-stop`, `stopWithinM` 3). Since v0.13 a
  slowing craft stops hearing a wall once its time to contact is over about 3 s (and the distance over 1 m): stopping
  where the knocks start (about 1.25 m at 0.5 m/s) passes, braking at 6 m does not. The intro line "The knocks speed up
  as you get close" still holds; a hint like "Fly slowly until you hear knocks, then stop" would fit the new rule.
- s13-lessons and s13-worlds: in a corridor a centred, straight flight is quiet now (side walls sound when drifting
  toward them under 2.5 s, or within 0.8 m).
- The lead (replay, owned by no lane): `formatReplayCheck` says FAIL for a recording of an older build and then names
  the versions; "recorded with an older build" as its own verdict would read better. After the merge, `pnpm listen`
  re-runs (the evidence is keyed by every input, the other lanes' files included).
