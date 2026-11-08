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
- [ ] 3 Time to contact (M41-13): hazards by time to contact, quiet far walls when slow, always heard within 0.8 m
- [ ] 4 Free way (M41-14): the open-way chime from the free side
- [ ] 5 Event sounds (M41-15, M41-11, M41-5): wrong-way, wrong-side, praise, stage, repeat-cue
- [ ] 6 Motor (M41-16): on by default, under the cues, ducked under speech
- [ ] 7 Never silence (M41-10), the planner's part
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

## Needs from the simulator

(Filled step by step.)

## Needs from other lanes

(Filled step by step.)
