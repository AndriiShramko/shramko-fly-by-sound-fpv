# Review of lane s13-sound (v0.13 sound, the owner's message 41)

Independent review, 2026-11-08, of branch `s13-sound` at 22e3b09 (worktree `<sound checkout>`) against `main`
7d4b4b9. Read against the plan (ShramkoGSFPV `docs/wip/v13-plan.md`, items M41-12 to M41-17 and the checks), the owner's
words (message 41 of the brief) and the lane doc `docs/dev/status-v0.13-sound.md`. No code was changed by the review: every file
broken on purpose was restored with `git checkout`, so was the evidence the runs rewrote, and this file is the review's
only commit. Numbers marked "measured" come from runs listed under "Checks run".

## Verdict

Not ready to merge: 2 blockers, 6 majors, 8 minors.

The planner and engine work is careful and mostly what the owner asked. The height tone glides (rendered: at most 3.7
cents per 10 ms in a climb, control 118.7). Walls are heard 2.48 s before contact at 1, 3 and 5 m/s, and a slow craft no
longer hears far walls. The open-way chime and the five event sounds exist, the motor has a bus of its own, and every
flying lesson keeps a bed and the height tone. The voice level comes from a measurement, and the new rig's checks fail
when the engine is broken (motor raised 8 dB: VL-2-motor failed). Typecheck, 650 Node tests and 9 audio proofs pass,
and the rig's evidence is fresh for the head.

What stops it, as a pilot in headphones would meet it:

- obstacles and pillars are heard late, later than in v0.12 (B1), which is the complaint M41-13 answers;
- merged with s13-lessons, each repeated sound of M41-5 plays 0.9 s and is followed by 1.3 to 2.6 s of silence, and
  every stage sounds alike (B2): the two lanes gave the shared events different fields;
- the open-way chime stays silent in tunnels narrower than about 2 m (M1);
- the target tone's beating sounds like "out of the band" and like "off to one side", and the shipped lesson lines
  still say a buzz means too high or too low (M2);
- the motor and the voice are calibrated on a 5-inch quad and on a voice the owner's Chrome does not use, and on the
  default craft the rig's own motor check fails (M3, M4);
- at the gitlink move the motor hookup has no owner, and five simulator tests fail, three of them not in the lane's
  list (M5, M6).

## Findings

| Id | Severity | Where | What |
|---|---|---|---|
| B1 | blocker | `src/sense/sampler.ts` | the object filter delays hazards on big objects and pillars, below v0.12 and below 2 s |
| B2 | blocker | `src/contract.ts`, `src/cues/planner.ts`, engine `cue()` | the shared events' fields disagree with s13-lessons' runner |
| M1 | major | `src/sense/freeway.ts` | no open-way chime in tunnels narrower than about 2 m |
| M2 | major | `src/cues/height.ts`, lesson `layers`, lesson lines | the target beat sounds like the "out of band" and "off aim" cues |
| M3 | major | engine motor bus, `test-audio/page/listen.ts` | motor level set on a 5-inch quad; with the default craft VL-2-motor fails |
| M4 | major | themes `voice.volume`, `measure.py`, `speech.ts` | voice level set on Microsoft David; the owner's Chrome speaks network voices |
| M5 | major | ShramkoGSFPV `app/builtin/sound.ts`, plan wave 2 | the motor hookup has no owner; until it lands the default-on motor goes raw |
| M6 | major | lane doc "Needs from the simulator" | 5 simulator tests fail at the gitlink move, 3 not listed |
| m1 | minor | `src/sense/freeway.ts` | the chime fires on a ring's tube and can point outside the ring |
| m2 | minor | `freeVoice`, `cue.safety.free.glossary` | up and down by absolute register; the line is wrong for up-lower |
| m3 | minor | engine `MOTOR_LEVELLER` | the pilot cannot set the motor's level in the mode, throttle loudness flattened |
| m4 | minor | walls-hall and corridor lines (s13-lessons) | time to contact makes these lines wrong; not changed in s13-lessons |
| m5 | minor | `locales/*.json` | a few new lines are not natural in their language |
| m6 | minor | `src/contract.ts`, lane doc step 6 | stale statements about the motor bus |
| m7 | minor | ShramkoGSFPV replay page | every v0.12 recording will show FAIL there |
| m8 | minor | `docs/wip/`, `docs/design/virtual-listener.md` | build-machine folders in documents bound for the public repo |

### B1 blocker: big objects and pillars are heard late, later than in v0.12

Where: `src/sense/sampler.ts` (`pathMissM`, `OBJECT_CLEARANCE_M`, the `ttc = null` line in `sample`); `test/ttc.test.ts`
("objects: a time to contact only on a collision course").

What: a time to contact with an object now counts only when the straight path passes within 0.42 m (hull plus 0.3 m) of
the point the ray found. That is right for a ring's tube. For anything wider it is wrong: the path hits the same face
elsewhere. Measured (reviewer's scratch test, 60 Hz frames; onset = first frame with a hazard on the obstacle; time to
contact along the path; "v0.12 rules" = the v0.12 enter distances, 3 s and no filter):

| Object, speed, angle of the path to the nearest sampler ray | v0.13 | v0.13 without the filter | v0.12 rules |
|---|---|---|---|
| box across a 20 m wide hall, 5 m/s, straight | 2.49 s | 2.49 s | 2.99 s |
| same box, 0.2 m/s sideways (2.3 deg) | 2.08 s | 2.49 s | 2.99 s |
| same box, 0.3 m/s sideways (3.4 deg) | 1.38 s | 2.49 s | 2.99 s |
| same box, sinking 0.4 m/s (4.6 deg) | 1.03 s | 2.49 s | 2.99 s |
| same box, 0.9 m/s sideways (10 deg) | 0.44 s | 2.49 s | 2.99 s |
| the free-way tests' 3 m tunnel block, 3 m/s, 0.3 m/s sideways | 1.36 s | 2.49 s | |
| walls-pillar's pillar (radius 0.5 m), 3 m/s, path 0.5 m off its axis | 0.41 s | 0.78 s | 0.81 s |
| same pillar, path 0.3 m off its axis, 10 deg | 0.77 s | 1.14 s | 1.34 s |

The plan's rule is at least 2 s; a gentle sink at 5 m/s halves it, and the tunnels of M41-21 put exactly such obstacles
in the way. The pillar rows also show that objects seen by the 20-degree ray fan start under 2 s even without the
filter (straight at the pillar, 5 deg: 1.19 s in v0.13, 1.69 s in v0.12), because the 0.8 m floor and the 2.5 s onset
leave no backstop. The lane's pillar control only checks that a hazard comes at some frame, not when.

Fix: decide "on a collision course" from the object's own extent along the path: cast the velocity direction (centre and
plus or minus the hull radius) once a frame and keep an object's time to contact only when one of those rays hits the
same `objectId` within range. Through a ring's opening they pass, so the tube stays quiet and the recorded rings-course
flight should still replay. Add tests: a box face at 2, 5 and 10 deg off a ray at 3 and 5 m/s (onset at least 2 s), a
0.5 m pillar with the path 0, 0.3 and 0.5 m off its axis, each with the v0.12 rule or the current filter as the
control. Re-run `test/replay.test.ts` and the ring test. Whether the ray fan's resolution also needs help (more rays
ahead, or the velocity rays as a sector of their own) is the lane's call; state the pillar numbers either way.

### B2 blocker: the shared events disagree with s13-lessons' runner

Where: `src/contract.ts` (`CueEvent`), `src/cues/planner.ts` (`cue()`, `eventCue`), `src/audio/engine.ts` (`cue()`);
s13-lessons at e0d1f0a (`src/lesson/runner.ts`, `src/lesson/sounds.ts`, its `docs/dev/status-v0.13-lessons.md` "Needs from other
lanes").

What: the plan fixed the five kinds; each lane gave them its own fields.

| Kind | s13-lessons' runner emits | this lane's planner reads |
|---|---|---|
| `repeat-cue` | `cue`, `dir`, `index`, `of`, `durS` (2.5 s continuous, 1.2 s one-off; the next play 1 s after `durS`) | `cue`, `dir?`; always 0.9 s (`REPEAT_CUE_S`) |
| `stage` | `index` | `stage?` (absent: 1) |
| `wrong-way` | `dir` (the way the track goes) | nothing (centred) |
| `wrong-side` | `dir` (where the gate is) | nothing (centred) |
| `praise` | (none) | (none) |

Merged as they are, each play of a named sound lasts 0.9 s and is followed by 2.6 s of silence for a continuous sound
(1.3 s for a one-off): not "three times, about 1 s apart". `e.stage` is never set, so every stage plays the same figure
(and a union of both members does not compile in the planner). The way to turn to is not heard. s13-lessons also asked
that the engine plan a frame at once for `repeat-cue`, as it does for `preview` (engine `cue()`); without it the first
play starts a frame late. A trial merge (`git merge-tree --write-tree s13-lessons s13-sound`) conflicts in
`src/contract.ts`, `src/cues/planner.ts` (s13-lessons put placeholders in this lane's file), `test/silence.test.ts`
(both lanes added it), `test/replay.test.ts`, `test/report.test.ts` and the two evidence files.

Fix: agree one text of the five members with s13-lessons before the merge; the planner then honours the runner's
fields: play a `repeat-cue` for `durS` (or agree on one length and have the runner use it), lift the stage by `index`,
sound `wrong-way` and `wrong-side` from `dir`, and plan at once for `repeat-cue` in the engine. Update the lane doc's
API section and the events tests to the agreed fields.

### M1 major: the open-way chime finds no way in narrow tunnels

Where: `src/sense/freeway.ts` (`FREE_OFFSETS_M` 0.7, 1.2, 1.8; `FREE_HALF_WIDTH_M` 0.2); `test/freeway.test.ts` (3 x 3 m
tunnels only).

What: a side counts only when a point 0.7, 1.2 or 1.8 m off the craft's line is free with 0.2 m to either side of it, so
the passage must reach at least 0.9 m from the line. Measured with the craft centred, at 3 m/s:
- 1.6 m wide, 2 m high, 0.6 m free on the left: no chime (found only from a 0.2 m band of positions on the blocked side);
- 1.2 m wide, 1.5 m high, 0.5 m free above: no chime;
- 2 m wide, 0.8 m free on the right: right; 1.6 m wide, 0.6 m free above: up; 3 m wide, 1.2 m free on the left: left.

M41-18 and M41-21 ask for micro-drone rooms and "narrow, narrower" tunnels. There the obstacle knocks and no chime
comes, which reads as "no way through".

Fix: find the free interval at the obstacle's front (rays across that plane to the left, right, up and down from the
line, then the passage's depth checked over the hull's width), or probe from about 0.3 m in steps of about 0.15 m with
the hull's own half width. Test 1.2, 1.6 and 2 m tunnels, a gap on each side, and the craft at three lateral positions.

### M2 major: the target tone's beat sounds like two "you are off" cues

Where: `src/cues/height.ts`, engine `renderHeight` (target tone -6 dB, sines); the lesson `layers` (height on in every
ring and gate lesson); the shipped lines `lesson.hover-height.intro.2`, `lesson.hover-height.hint.1`,
`lesson.rings-first.intro.2` and `cue.height.rough.glossary` in all four locales (unchanged in s13-lessons at e0d1f0a).

What: measured in the planner, hover-height (band 2 to 3 m, soft): the two tones beat at 62, 51, 39, 26, 13 and 7 Hz at
2.0, 2.1, 2.2, 2.3, 2.4 and 2.45 m, and at 9, 19, 28, 38 and 48 Hz at 2.6 to 3.0 m, about 50 % deep. Over most of the
band the pair is as rough as the out-of-band buzz (38 Hz, depth 0.6), which the lesson says means "too high or too
low"; the tone is steady only within a few centimetres of 2.5 m (5 cm off, it already beats at 5 to 7 Hz). Within
about 2 to 10 cm of a gate's height the pair wobbles at 2 to 13 Hz, the rate of the target hum's "off to one side"
beat (2 to 7 Hz, `TARGET_BEAT_MAX_HZ`), and the ring and gate
lessons now carry both. The lines still say "a smooth tone means the right height, and a buzzing tone means too high
or too low" and "if the hum is rough, you are off to one side". The rig does not measure this (VL-3 is not built); the
lane noted only the A4 overlap with the shape trace.

Fix: give each meaning its own sound before shipping. For example: the target as a short reference note at the target
pitch about once a second (no continuous beat), or the out-of-band cue as a slow pulse instead of a 38 Hz buzz. Or keep
the design, and have s13-lessons rewrite those lines in the same merge. Either way, add a check that the in-band pair
and the out-of-band cue differ (VL-3, or at least their modulation spectra).

### M3 major: the motor level is set on a 5-inch quad; with the default craft the rig's motor check fails

Where: `src/audio/engine.ts` (`MOTOR_LEVEL_DB` 14, `MOTOR_HIGHPASS_HZ` 400, `MOTOR_LOWPASS_HZ` 1500);
`test-audio/page/listen.ts` (`ROTOR_FULL_HZ`: KV 1950 on 6S); `evidence/listen/VL-2-motor.json`.

What: the simulator's default craft is the Pavo20 Pro on 3S (ShramkoGSFPV `apps/fly/src/presets.ts`, `DEFAULT_PRESET`;
7200 KV, 3 blades), the micro-drone scale the owner asked for. Its rotor turns at about 1 kHz at full output and at
450 to 550 Hz in the rig's flight, inside the cues' 500 Hz bands. Measured: `pnpm listen` with only `ROTOR_FULL_HZ` set
to that craft (7200 x 0.75 x 11.1 V): VL-2-motor FAILS. The shape trace is 5.6 dB over the motor at 500 Hz (needs 6),
the target 6.9 dB, the height 11.3 dB; the motor sits 13.9 LU under the cues. VL-0a also failed (two renders 1.85e-5
apart, limit 1e-6), so the determinism threshold does not hold for a motor through the leveller. The motor is on by
default now, so this is what a pilot meets first. The lane doc names the stand-in; the claim "motor under the cues by
at least 6 dB" holds for a craft the mode does not fly by default.

Fix: calibrate on the default craft and the micro presets (meteor65pro-1s, air65-1s, pavopico-2s), ideally with the
simulator's own motor code (design VL-0e), and set the level (or the band) by the worst of them. Revisit VL-0a's limit,
or the leveller's part in it.

### M4 major: the voice level is set on a voice the owner's Chrome does not use

Where: themes' `voice.volume` (0.74, 0.87, 0.77); `tools/listen/measure.py` (`sapi_gain`, 0.25 dB per step);
`src/audio/speech.ts` (`pickVoice`).

What: the calibration uses Microsoft David Desktop and SAPI's volume law. The owner's PC (this build machine) has only
en-US local voices: SAPI lists David and Zira, and headless Chrome lists David, Mark and Zira. `pickVoice` takes any
en-GB voice before a local en-US one, and there is no local es, pl or ru voice. Headed Chrome adds Google's network
voices when it is online (not checked in the owner's own Chrome), so it would speak every language with one of them.
A network voice's loudness is unknown, and SAPI's law does not describe how it applies `utterance.volume`. The 4.7 LU of VL-6-speech and the -7 dBTP of VL-6-peak are therefore not what the owner hears, and
his M41-17 complaint (the voice far over the flight) may persist. The lane doc says Chrome "may" take a network voice;
on this machine it will.

Fix: measure what this Chrome really speaks: a loopback recording of headed Chrome, one line per language at volume 1
and 0.5. Then set the volume per voice family or per locale from it, or prefer a local voice of the language family
(en-US for en), or speak pre-rendered clips through the engine (design section 13). Until then, mark M41-17 open for
the owner's set-up.

### M5 major: at the gitlink move the motor hookup has no owner

Where: ShramkoGSFPV `apps/fly/src/app/builtin/sound.ts` (`startOnEngine` connects to `auxInput`); the plan's wave 2
table.

What: `motorSound` is true by default and every v0.12 document now reads as true. The simulator still plays the motor
into `auxInput`: no band, no leveller, no duck, following the slider. `app/builtin/sound.ts` is in neither wave 2
lane's list (v13-host owns `apps/fly/src/sonic/*` and `app/builtin/sonic-flight.ts`). From the gitlink move until
someone changes it, every pilot in the mode hears the raw motor. At the default slider (15 %) that is about 10 dB under
the bus's level (computed from the rig's raw render at 60 %: the slider's curve gives 18 dB less at 15 %). With the
slider raised it masks the cues (the rig's control at 60 %: the shape cue 0.6 dB over the motor). M41-16 reaches the pilot only with that host change.

Fix: the lead assigns `startOnEngine` (`motorInput ?? auxInput`) and the `PageEngine` Pick (`apps/fly/src/sonic/
audio.ts:16`) to v13-host, or makes the change in the gitlink-move merge itself, with a bench test that the mode's
motor reaches `motorInput`.

### M6 major: five simulator tests fail with this package, three not in the lane's list

Where: lane doc "Needs from the simulator"; ShramkoGSFPV `tools/bench/test/`.

What: measured, the simulator's sound tests (27 files `sonic-*` and `sonicrec-*`, all but `sonicrec-headers`) through
a vitest alias to this branch, with no simulator file changed. At the gitlink 1eea4d5, 507 pass and 8 are skipped; with
s13-sound, 5 fail in 4 files:
- `sonic-audio.test.ts:177` and `:428`, the motor default false: listed in the lane doc;
- `sonic-int-replay.test.ts:328`, the glossary control "heard over a floor, voices the floor below": hovering 1.5 m
  over the floor no longer sounds it (the 0.8 m rule): not listed;
- `sonic-lessons.test.ts:178`, walls-hall's layers "the safety layer only (and the voice)": now four layers; the
  scripted pilot itself still passes: not listed;
- `sonicrec-recorder.test.ts:303`, walls-hall `version: 1`: not listed (s13-lessons' lesson format bumps it as well).

The app itself (`apps/fly` src and lab) typechecks clean against this branch.

Fix: add the three to "Needs from the simulator" with their new expectations: the floor control hovering within 0.8 m
of the floor or sinking toward it; walls-hall's layers as shipped; the lesson version read from the package.

### m1 minor: the open-way chime fires on a ring's tube and can point outside the ring

Where: `src/sense/freeway.ts` (the trigger takes any hit; the side order is left first).

What: measured, rings world (ring 3 m across), craft at the ring's height 6 m before it, 3 m/s. Nose on the left tube:
"left", outside the ring, while the target hum points right. Nose on the right tube: "left", into the ring. Gate frames
(squares, cubes) take the same path in the code (not run).

Fix: no trigger on gates (`order !== null`), since the target layer leads there, or try the side toward the gate's
centre first.

### m2 minor: above and below by absolute register, and the glossary is wrong for up-lower

Where: planner `freeVoice` (`FREE_ELEVATION_STEPS`); `cue.safety.free.glossary`.

What: up and down are the same rising two-note figure from straight ahead, three steps above or below a side chime
that is not sounding at that moment, so the pilot must remember a register. With `heightPolarity` 'up-lower' the up
chime is the low one, while the line says "a high chime means the way is above".

Fix: a contour that needs no reference (rising figure for above, falling for below, kept with the polarity), and a line
that matches it, or one line per polarity.

### m3 minor: the leveller takes the motor's level away from the pilot

Where: engine motor bus (`MOTOR_LEVELLER`: threshold -50 dB, ratio 4).

What: in the mode the simulator's slider moves the motor by about 4.5 dB from 15 % to 60 % (computed: 18 dB at the
input, ratio 4), and the throttle's loudness swing is cut 4:1 as well (the pitch still follows it). The pilot's sound settings have the motor
on or off, but no level. The owner asked to hear throttle and climb "as in real flight".

Fix: a pilot gain for the motor after the leveller (prefs and menu), or the slider's gain applied after the leveller;
consider a gentler ratio once M3 is measured.

### m4 minor: walls-hall and the corridor need their lines changed in s13-lessons

Where: `lesson.walls-hall.intro.2`, `lesson.walls-hall.hint.1`, `lesson.corridor.intro.2` (s13-lessons' strings,
unchanged at e0d1f0a); lane doc "Needs from other lanes".

What: braking from 2 m/s, the knocks stop once the time to contact passes about 3.1 s. A pilot who stops 3 to 4 m short
hears nothing and fails "within 3 m" without knowing why. In the corridor a centred flight is silent, while the line
says "if the knocks are louder on one side". The lane flagged both.

Fix: the lead checks at the merge that s13-lessons changed these lines (or the walls-hall goal) to the time-to-contact
rule.

### m5 minor: some new lines are not natural in their language

Where: `locales/*.json`, the new cue lines.
- en `cue.safety.free.name` "Open way" reads as a translation; "Way through" or "Clear way" is the idiom.
  `cue.safety.wrong-side.glossary` "a ring was passed from its back": "you flew through a ring from behind".
- ru `cue.safety.wrong-way.glossary`: "the flight goes back along the track" is a calque; say "you are flying the track
  the wrong way" with the present-tense "you fly" (no gender). `cue.height.target.glossary`: the second tone "sounds at
  the height where you need to fly"; better "marks the height".
- pl `cue.safety.wrong-way.glossary` "flight along the track backwards" is clipped; "you are flying the track the
  wrong way" in the present tense avoids gender too.
- es `cue.safety.wrong-way.glossary` "you fly backwards along the track" says the craft flies in reverse; "you fly the
  track the other way" is meant.

Fix: a native read of these lines (the v12 open item R8 g asks for the same).

### m6 minor: stale statements about the motor bus

Where: `src/contract.ts` (`SonicEngine.motorInput` doc); lane doc step 6.

What: the contract says the bus "low-passes the motor ... about 10 dB under the cues". It also high-passes at 400 Hz,
and the measured level is 14.5 LU under. Step 6 says the low-pass keeps "the low wash", which the 400 Hz high-pass
removes.

Fix: describe the band and the measured level (after M3, the new one).

### m7 minor: every v0.12 recording will show FAIL on the simulator's replay page

Where: ShramkoGSFPV `apps/fly/src/sonic-session/replay-control.ts` and `replay-check.ts`; `src/replay`
`formatReplayCheck`.

What: in the package the v0.12 recordings are handled well. `test/replay-v012.test.ts` passes, the line names the
versions, and the control (the same recording claiming today's versions) fails with no word about why. On the
simulator's replay page, though, every v0.12 session will read "FAIL ... not the recording's own build".

Fix: the lead takes the lane's proposal: a verdict of its own for an older build, landed with the merge.

### m8 minor: build-machine folders in documents bound for the public repository

Where: `docs/dev/status-v0.13-sound.md` (and `docs/design/virtual-listener.md`, which rides in from `vl-spec`).

What: no personal data was found, and English only outside `locales/` holds (the Cyrillic in `test/report.test.ts` is
older than this lane). These documents do name the build machine's folders and install steps. `docs/wip/` does not
exist on `main` yet.

Fix: the lead decides whether `docs/wip/` is published; if it is, use placeholders (`<venv>`, `<cache>`) as
`tools/listen/requirements.txt` already does.

## Checks run

- `pnpm typecheck`: clean. `pnpm test` (Node 22.13): 25 files, 650 tests pass.
- `pnpm proof:audio` with `GPU_LOCK=C:/dev/.gpu-lock`: 3 files, 9 tests, 37 s; every shipped proof passes and every
  control (no HRTF, pulses 15 % slow, no limiter, no fade, 16 voices) fails. The evidence it rewrote was restored.
- `pnpm listen`: the evidence is fresh for the inputs 61b845a05094.
- Broken on purpose, Node, each restored after: the height position rounded to a note (height tests: 5 of 16 fail);
  onset at 1.2 s (ttc tests: 6 of 22 fail); the free-way left and right axes swapped (5 free-way tests fail); the object
  filter removed (the ring test and the recorded rings-course replay fail); 'room' taken out of walls-hall (the
  silence test fails); the motor migration switched off (the prefs test fails).
- Broken on purpose, rig: `MOTOR_LEVEL_DB` 22 instead of 14: VL-2-motor fails (shape -0.2 dB, motor 6.5 LU under the
  cues), the other six pass. Restored, evidence restored, the run's renders deleted.
- Rig with the default craft's motor (M3): only `ROTOR_FULL_HZ` changed; restored, renders deleted.
- Reviewer's scratch tests for B1, M1, M2 and m1 (flights through the package's own sampler, planner and worlds), not
  committed.
- Simulator (M6): its sound tests at the gitlink and through a vitest alias to this branch; `apps/fly` typecheck against
  this branch through `paths`. No simulator file changed.
- Voices (M4): SAPI's installed voices, and `speechSynthesis.getVoices()` in headless system Chrome.
- Trial merge with s13-lessons (B2): `git merge-tree`, no worktree touched.

## What holds

- M41-12: continuous in height in every theme, polarity, calm and pitch shift; unison exactly at band centres and gate
  centres, on the 0.5 m grid and off it; the rendered pitch track is continuous.
- M41-13 for walls, floor and ceiling: onset 2.48 s at 1, 3 and 5 m/s, rendered and in Node; quiet when slow; heard
  within 0.8 m; urgency follows the time to contact.
- M41-14 in wide tunnels: each gap gives its own side, no right chime for a left gap in 36 starts, none in a closed
  tunnel.
- M41-15, M41-11, M41-5: the five sounds exist, are distinct, are on the scale, and are planned at least 3 dB under a
  hazard pulse. The rendered checks (three onsets in a repeat step; never louder than the safety sound) are open,
  pending the runner: keep them on the merge list.
- M41-10: every flying lesson has the height tone and the bed; hover-height sounds in every frame, between attempts too.
- M41-16 migration: a v0.12 document reads the motor as on, a v0.13 choice is kept, strict session reading is
  unchanged. The simulator's store keeps unknown prefs keys, so `heightTarget` survives saving.
- Ownership: only the lane's own files, plus the lesson `version` bump (it auto-merges with s13-lessons') and two shared
  tests made to read versions. The `vl-spec` design document rides in with this branch; the lead's handoff does not
  mention it.
- Public repository: no keys, no personal data, synthetic fixtures (`vitest-host`, `testPilot01`); commit metadata as on
  `main`.
