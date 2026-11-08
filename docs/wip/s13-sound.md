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
- [x] 7 Never silence (M41-10), the planner's part (lesson layers, the pad swirl; `test/silence.test.ts`, 3 tests)
- [ ] 8 Speech level (M41-17): speech 3 to 6 LU over the mix, true peak at most -1 dBTP
- [ ] 9 The first measuring rig of the virtual listener (VL-0, part of VL-2 and VL-6)
- [ ] 10 The full checks

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
- Objects (rings, pillars, bars): a time to contact counts only when the straight path passes within the hull plus
  0.3 m of the point the ray found (`pathMissM`). Without it, flying through a ring made its tube look like a wall
  closing in 0.7 s in one frame; every side sector came on, and the 300 ms hold then voiced the far hall walls they
  saw next. That frame-sized flash also broke the replay check of the recorded rings-course flight (94.1 % of the
  frames agreed, under the 95 % rule) because a 30 Hz replay never sees it; with the filter the recorded flights
  replay again. Walls, floor and ceiling (no object id) keep the time to their plane along its normal.

### Step 4, free way (M41-14)

- Trigger: one ray straight along the nose; something closing on it in under 3 s (`FREE_TTC_S`). Not the front
  sector: its side rays see a side wall the craft drifts toward, which the first version took for "an obstacle
  ahead" (and then said "free on the right" inside the left gap). A dead end gives the trigger and no free side.
- Search (`findFreeWay`): a point 0.25 m past the obstacle's front, 0.7, 1.2 or 1.8 m to the left, right, above or
  below the craft's line (nearest first; at one offset the side already sounding first, then the side of the drift,
  then left, right, up, down). A side is free when the straight line there is clear (hull included) and the passage
  past the front stays free for 1.5 m at its middle and 0.2 m to either side (a 0.35 m slot is no way). At most 4 rays
  a probe, 12 probes, only while the trigger holds.
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
  right chime from 36 starts (three lateral positions, three heights, four drifts). What it cannot show: whether a
  pilot takes a high two-note figure from ahead for "over" without training (the glossary line says it).

### Step 5, event sounds (M41-15, M41-11, M41-5)

- Contract (`src/contract.ts`, `CueEvent`, added members only): `{ kind: 'wrong-way' }`, `{ kind: 'wrong-side' }`,
  `{ kind: 'praise' }`, `{ kind: 'stage'; stage?: number }`, `{ kind: 'repeat-cue'; cue: CueId; dir?: Vec3 | null }`.
  Cue ids (glossary names and lines in four languages): `safety.wrong-way`, `safety.wrong-side`, `target.praise`,
  `target.stage`.
- The figures, all notes of the scale, around the gate melody's root (note 5, C4) and an octave above it:
  wrong-way, two falling pairs (2 to 0, twice, 0.34 s apart) in the safety layer's own timbre; wrong-side, three notes
  falling from the gate notes' register to the root (5, 3, 0); praise, a short bright rise an octave up, one of three
  figures in turn (0 2 4, 2 4 5, 0 3 5) so it does not tire; stage, a run of five notes and a soft root under its end,
  one step higher with each stage (four at most). Shorter and lighter than the fanfare (the lesson's pass). Every
  event's figure is unlike every other earcon's (onset times and notes compared for all ten, in every theme and calm).
- Never louder than the safety sound: planned peaks (layer gain plus note gains, notes within 20 ms summed) are at
  least 3 dB under a hazard pulse at 1 m in every theme and calm (wrong-way and wrong-side 3 dB, praise and stage on the
  target bus 4 dB lower again); the rendered check is the rig's (step 9).
- repeat-cue plays the cue's glossary sound in a short form: one-off cues as they are, cut to end by 0.9 s
  (`REPEAT_CUE_S`); continuous cues as a 0.9 s preview (a wall approach from 3 m, not 8 m, so it still has four or more
  pulses). ONE event is ONE play: for M41-5 the runner emits three 'repeat-cue' events with onsets at least 1 s apart
  (each play is over by 0.9 s). An unknown cue id plays nothing.

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

## Needs from the simulator

- M41-16, motor (`apps/fly/src/app/builtin/sound.ts:112-121`, `startOnEngine`): connect the motor sound to
  `ctx.sonic.engine.motorInput` instead of `auxInput` (fall back to `auxInput` when `motorInput` is undefined: an
  older package). Its `context` is the engine's AudioContext, as `auxInput`'s. `enabled()` (`sound.ts:84`) already
  reads `prefs.motorSound`, which is now true by default; nothing else changes there. `apps/fly/src/sonic/audio.ts:16`
  `PageEngine`: add `'motorInput'` to the Pick. The bench tests that hold the old default
  (`tools/bench/test/sonic-audio.test.ts:177` and `:428`, `motorSound` false) must expect true.

## Needs from other lanes

- s13-lessons: the lessons whose `layers` this lane changed are version 2 (all 16 flying lessons); a lesson changed by
  both lanes needs one version 2, not 3. The tests that held lesson version 1 (`test/replay.test.ts`,
  `test/report.test.ts`) now read the lesson's own version.
- s13-worlds: target heights (band centres, gate centres) on one 0.5 m grid per lesson, counted from its first gate (or
  its band centre), keep every target tone a note of the scale; a target off the grid is still in exact unison and only
  off the scale (`onScale` false).

- s13-lessons (runner): emit `{ kind: 'repeat-cue', cue }` once per play, three times about 1 s apart (onsets at least
  `REPEAT_CUE_S` + 0.1 s apart, `REPEAT_CUE_S` = 0.9 from `src/cues`), with no speech over them; `{ kind: 'praise' }` on
  each counted attempt (the planner varies the figure), `{ kind: 'stage', stage: k }` for stage k of the long tunnel,
  `{ kind: 'wrong-way' }` after more than 1 s of flying back, `{ kind: 'wrong-side' }` for a ring passed from its back;
  the glossary can name the new cues (`safety.free`, `safety.wrong-way`, `safety.wrong-side`, `height.target`,
  `target.praise`, `target.stage` are in `CUE_IDS` with their lines).

- s13-lessons: `walls-hall` asks to stop within 3 m of a wall (`approach-stop`, `stopWithinM` 3). Since v0.13 a
  slowing craft stops hearing a wall once its time to contact is over about 3 s (and the distance over 1 m): stopping
  where the knocks start (about 1.25 m at 0.5 m/s) passes, braking at 6 m does not. The intro line "The knocks speed up
  as you get close" still holds; a hint like "Fly slowly until you hear knocks, then stop" would fit the new rule.
- s13-lessons and s13-worlds: in a corridor a centred, straight flight is quiet now (side walls sound when drifting
  toward them under 2.5 s, or within 0.8 m).
