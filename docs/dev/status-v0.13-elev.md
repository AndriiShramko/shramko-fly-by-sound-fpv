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
- [x] E1-6 Measure (details below): Node tests (`test/elevation.test.ts` 36: the elevation sign per side and per target,
  the setting off gives v0.13's plans exactly in seven flights, every note and rhythm unchanged; and the tests of E1-3
  to E1-5); the listener's new check VL-1-elevation (the chime above, ahead and below through Chrome's HRTF in headless
  Chrome: the HRTF's response over 4 to 16 kHz differs by 3.57, 3.05 and 4.94 dB rms, the notes within 0.15 cents;
  control, the direction off: 0.57 dB); the localization model `baumgartner2014` on the design probe's 26 heads
  (reported, not gated); `pnpm typecheck` clean, `pnpm test` 48 files 1120 tests, locale lint 0 problems (526 keys),
  layout check 0 problems, `pnpm proof:audio` 3 files 9 proofs, `pnpm listen` 9 of 9 checks valid and passing
  (inputs a884a229c68d)
- [x] E1-7 This lane's E1 status final (below)
- [x] E2-1 The other languages' lines measured (details below): every line without parameters of es, pl and ru (471
  each) said by the local Windows voice of its language with `test/fixtures/measure-tts.ps1`, as the English ones were
  (Microsoft Helena Desktop, Paulina Desktop, Irina Desktop; SAPI rate 0), one fixture each
  (`test/fixtures/tts-es-helena.json`, `tts-pl-paulina.json`, `tts-ru-irina.json`). `test/lesson-schedule.test.ts`:
  every shipped lesson in each language with its own measured voice, answers early or late: no sound under speech,
  every question after its sound; the v0.12 timing fails with each voice; the fact, 253, 342 and 471 of the 471 lines
  longer than the estimate, none longer than the runner waits, each fixture exactly the lines without parameters; the
  ears lessons' length per language. Controls, each failing its test, then restored: one Spanish line measured longer
  than its estimate (254, not 253), one Russian glossary line at 60 s (sounds under speech in ears-glossary), one
  Russian line missing from its fixture
- [x] E2-2 Round trip (details below): `pnpm listen:words` (`tools/listen-words.ts`, `tools/listen/words.py`; faster-whisper
  1.2.1 in the listener's environment, `tools/listen/requirements.txt`): all 526 lines of each locale said by its
  voice, transcribed by Whisper large-v3, word error rate per line; bound 0.2 in each language, met by every line;
  the control, the Russian lines said by David, fails it (525 of 526 over, median 1). K's help lost the key's name in
  Spanish, Polish and Russian ("Pulsa T para" heard "Púlsate para", "Naciśnij I, aby" "Naciśnij, aby", "Нажми T"
  "Нажмите", "Нажми U" "Нажми её"): the 17 lines of each that name a key now say "the key" first (la tecla, klawisz,
  клавишу) and are heard with it. No other text was wrong; 56 words the voices say otherwise are recorded with why
  (`HEARD`). Evidence `evidence/listen/VL-4-words.json`; `test/words.test.ts` (the words, the errors, the records, the
  evidence scored again). Controls: a Spanish line in Cyrillic fails the run (heard as nothing), restored; the
  Russian bound at 0.15 fails the evidence tests, restored
- [x] E2-3 The simulator's Fly by Sound lines, read only (section "Simulator lines"): its four Fly by Sound files at
  v13-host e7612d3, 249 lines a language with K's help, the same round trip and bound. Heard with no error: 230, 232,
  230 and 203 of 249 (en, es, pl, ru); over the bound 4, 4, 9 and 21, each listed with its transcript; the name "Fly
  by Sound" in Russian and Polish and the key lines are the simulator's main items
- [x] E2-4 All checks again: `pnpm typecheck` clean, `pnpm test` 49 files 1138 tests, locale lint 0 problems (526
  keys), layout check 0 problems, `pnpm proof:audio` 3 files 9 proofs (numbers as before; the evidence's dates),
  `pnpm listen` 9 of 9 checks valid and passing (inputs ee49704722ea: the locales and the rig's folder changed; the
  numbers within a render's noise of E1's), `pnpm listen:words` PASS, fresh (00c1d278316c). This lane's E2 status
  final (above)

The review of the lane (`docs/dev/review-v0.13-elev.md`, dbce5fd, findings E1 to E8), each finding first tried against
the code, then fixed with a test and its control (section "Review fixes" below):

- [x] F1 Review E1, E3, E8, the wrong way between gates: the leg's rule holds on a leg only once the craft has flown along
  it (faster than 0.5 m/s, since the gate before was passed or the attempt began); before that v0.13's rule (further
  than 8 m in front of the gate, flying away from it). The leg begins at the gate passed last (a later lap's first gate:
  the course's last); a course in any order keeps v0.13's rule. `test/direction.test.ts` (23 new, the Winter Garden track
  as a fixture); the lane's first rule kept as the control `testHooks.lineUp 'no-progress'`
- [x] F2 Review E2: the lines of the chime above and below hold with the setting off (the way by its pitch; from above
  or below only in the sentence that names the setting; the corridor's line by pitch alone), and the setting's
  description says what off does and that the ceiling and the floor come from above and below either way; four lines in
  four languages, each measured with its local voice into its fixture; `test/named-sounds.test.ts` with the lane's
  texts before the review as its control (`test/fixtures/lines-s13-elev-0dd3cd9.json`)
- [x] F3 Review E4: "the key" held by the speech lint (rule `key-word`, `test/locales.test.ts`: all 17 lines a language
  have it; v0.13's 17 each fail it), a key rule in the words check (a line that names a key is heard with the key's
  name as a word of its own; its control, v0.13's key lines said by their voices, loses the key in 4 Spanish, 1 Polish
  and 7 Russian lines), the percent records for Polish and Russian; `pnpm listen:words` PASS (217fe5790a33), the
  English, Spanish, Polish and Russian lines that name a key all heard with it
- [x] F4 Review E5: VL-6 and VL-2 hear the floor, the ceiling and the chime with their breaths: the rig flies tunnel-gaps
  along its track (the chime above and below, the ceiling and the floor, each with its breath, 152 to 205 frames);
  measured there, the motor masked the breath's lowest bands (5.7 dB at 4 kHz), so the motor's low-pass is now fourth
  order (the breath 17.8 dB or more over every craft's motor from 4 to 16 kHz); the breath costs the voice 0.10 to
  0.17 LU of its margin; the tunnel's own voice margin (1.93 to 2.88 LU, under 3) is reported, not held; `pnpm listen`
  PASS, 9 of 9 (543c687b88a2)
- [x] F5 Review E6: the target note's two timings measured (two new audio proofs, `target-note-gap` and
  `target-note-pan`, each with its control), and both found wrong on the shipped engine and fixed: the height tone now
  comes back 12 ms after a placed note (`HRTF_TAIL_S`; 6.5 ms left 2.3 to 2.8 ms of overlap), and a constant input 140 dB
  down keeps the target panner running between notes (Chrome had turned it only at the next note's onset)
- [x] F6 Review E7: rings-course in the numbers: every leg of the gate lessons measured again, 5 to 7.05 m (rings-course
  6.0, 6.10, 7.05, 6.46, 6.57, 7.05), line-up distances 2.86 to 4.03 m; the CHANGELOG and section E1-5 say so (and the
  CHANGELOG the rule of F1)
- [x] F7 Every check again (section "Final status" below)

## Final status (2026-11-08, after the review)

Branch `s13-elev`, not pushed; the lead merges. The review (`docs/dev/review-v0.13-elev.md`, dbce5fd) found eight
things; each was tried against the code first, all eight held, and each is fixed with a test and its control (section
"Review fixes"). Commits: F1 fabfbbe; F2 b6497b0; F3 1dc2d8d, a2e4250; F5 96c7ee7; F6 7c13006; F4 9f776c7, 7da428b,
e3e4cdc, 4b2a6b6; F7 this commit.

What changed for the pilot since the review:

- Up and down by direction, as the owner asked (message 42), now holds where the review found it did not. The lines:
  with Sound from above and below off, nothing says a way above or below comes from above or below; the glossary and
  tunnel-gaps tell the way by its pitch and say "from there too" only with the setting's name; the corridor tells the
  pitch; the setting's description says what off does and that the ceiling and the floor come from above and below
  either way, in four languages. The target note comes from its target from its first milliseconds (the first note
  after the target moved began from the old side: Chrome left the panner idle between notes). The height tone and a
  placed target note never sound together (the tone back 12 ms after the note; they overlapped 2.3 to 2.8 ms). The
  motor no longer masks the breath of air that carries the height cues: 17.8 dB or more under it from 4 to 16 kHz with
  every craft (5.7 dB at 4 kHz before).
- The wrong way between gates: a pilot who turns back on a leg he has flown is told within a few metres; one who carries
  on out of a gate where the course turns back (free-garden's Winter Garden, ring 4 to 5, the last lesson of both paths)
  or backs away at the start is no longer told "You are flying back"; one who flies away from the next gate is told once
  8 m from it, as in v0.13. A later lap's first gate is reached from the course's last.
- K's help and every line that names a key: in Spanish, Polish and Russian the lint holds "la tecla", "klawisz",
  "клавишу" before the key, and the words check hears every key's name.

Measured on this tree:

- `pnpm typecheck` clean; `pnpm test` 49 files, 1167 tests (1138 at the review); locale lint 0 problems (526 keys);
  layout check 0 problems.
- `pnpm proof:audio`: 3 files, 9 tests passing: the audio page's 7 proofs (two new: `target-note-gap`,
  `target-note-pan`), each passing with its control failing, and the demo's keyboard checks.
- `pnpm listen` 9 of 9 valid and passing (543c687b88a2), the tunnel flown too: the voice 4.56 to 4.74 LU over the ring
  flight's mix; the breath's cost to the voice in the tunnel 0.10 to 0.17 LU; true peak at most -1.98 dBTP; every cue
  15.0 dB or more over every craft's motor, the breath 17.8 dB or more; VL-1-elevation 3.57, 3.05 and 4.94 dB (control
  0.57).
- `pnpm listen:words` PASS (217fe5790a33): every line within 0.2 in its language; every line that names a key heard with
  it (17 of 17 in each language); the key control loses the key in 4 Spanish, 1 Polish and 7 Russian lines of v0.13.
- The reworded lines with each language's local voice: 11.7 to 23.3 s, none longer than the runner waits.

Open, with reasons:

- In a busy tunnel the voice sits 1.9 to 2.9 LU over the mix (VL-6 asks 3 to 6 on the ring flight, where the voices
  were set; the breath costs 0.1 to 0.2 LU of it): the owner's call between about 1 dB more voice (the clear theme's
  tunnel peak then near -1 dBTP) and a voice level that follows the mix (F4).
- VL-4's 2 % of a lesson's words: nine lessons' own lines are over it by one to three words on clean speech (F3); the
  check's bound is per line.
- Laps and courses in any order: the leg's rule is tested on a synthetic loop and on rings-line in any order; no shipped
  lesson has either.
- The truth bot's line in rings-small flown at 1 m/s or slower is told three times (the review's observation: it flies
  back 3 m between two rings; not a pilot's line).

Not checked by any machine:

- A person hearing it: whether pilots hear the chime above or below and the target note by their direction (the model
  predicts 7 points fewer up/down errors on average, above more than below), whether the soft hiss is pleasant, and
  whether "You are flying back" comes at the right moments in the simulator's Winter Garden; the first testers, with the
  setting to turn it off.
- A native reading of the Spanish, Polish and Russian lines: the four reworded in F2, the key lines and the habits
  recorded (Polish "węższy" heard "wyższy", Russian "пролети" and "гул"); Whisper shows the voices say every word, not
  that the words are natural.
- The simulator with this branch: the setting (W13), the panel (W14), free-garden on the real scan.
- Voices other than the four Windows desktop ones (Chrome's OneCore and online voices).

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
  front of it), and every leg of the v0.13 rooms is 5 to 7.05 m (rings-small 5; from the start to gate 1 5.5, 6 in
  rings-course; rings-line and shapes-series 6; rings-heights 6.18 with its height step; rings-course 6.0, 6.10, 7.05,
  6.46, 6.57 and 7.05: review E7), so the whole gap between two gates lay inside it.
- Scaled with the leg (the gate before, or the lesson's start for the first gate): 2.86 m for rings-small, 3.14 to
  3.53 m for the other rooms but rings-course, 3.43 to 4.03 m there; 8 m from a leg of 14 m on (since review E1, once
  the leg is flown: section "Review fixes"). The truth bot flies back up to 3 m between two gates of
  rings-small (from 4 m past one gate to 4 m before the next); it crosses the line-up distance for 1.14 m at 2.5 m/s,
  0.46 s, under the second it takes to be told.
- Against the leg, not away from the gate: with the radial rule of v0.13 and the shorter line-up distance, the review
  R1 flight in rings-small (a pilot moving 3.5 m aside, 3 m in front of ring 2, to fly round it) was told "wrong way"
  (that test failed); moving aside is not flying back. The cue still says where the gate is (its `dir`), and the
  control `lineUp 'fixed'` is v0.13's rule exactly, both parts.
- The imperfect pilot (65 % of the cap, a sideways wobble of half its clearance in each opening, 1.2 s still every
  3 m) passes rings-first, rings-line, rings-small and rings-heights in 3 attempts, the shapes in 2, rings-course in 1,
  with no touch.

### E1-6, the measurements

The listener's check VL-1-elevation (`pnpm listen`, `evidence/listen/VL-1-elevation.json`): the open-way chime of a way
above, then of a way below, played as tunnel-gaps' intro.3 plays it (repeat-cue from up, from down; soft theme), the
safety layer and its direct sound alone, rendered by the real engine in headless Chrome 156 at 48 kHz; with the
direction on and off, and each again with no panner (its dry twin, the same notes and breath). The HRTF's own response
per ear and third octave is the render over its twin, so the cue's own spectrum and pitch drop out.

| Measure | Direction on | Control: direction off |
|---|---|---|
| where the plan puts the chime above, below | 30 and -30 degrees (ahead) | 0 and 0 |
| HRTF response, rms difference over 4 to 16 kHz and both ears: above against ahead | 3.57 dB | |
| below against ahead | 3.05 dB | |
| above against below | 4.94 dB | 0.57 dB (both ahead; the rule is 1 dB) |
| 16 kHz third octave against the chime's strongest band (dry) | -11.2 dB above, -11.5 below | -58.4, -57.6 |
| the chime's energy from 4 to 16 kHz (dry, one second of a play) | -8.6 dB of the total | -23.5 (above), -37.7 (below) |
| pitch of the notes, on against off | the same within 0.15 cents (1170 and 1570 Hz above, 660 and 520 Hz below) | |

The response in dB (left ear; 4, 5, 6.3, 8, 10, 12.7, 16 kHz): above -1.9, -2.4, -3.0, -9.4, -12.3, -7.7, -5.8; ahead
-1.0, -1.9, -9.9, -12.3, -11.1, -2.4, -3.5; below -2.3, -6.3, -12.4, -6.7, -10.0, -0.4, -5.2: the notch Chrome's
composite HRTF puts at about 6 to 8 kHz ahead moves up to 10 kHz above and down to 6 kHz below. The first run, with the
reverb return in the renders and one ear's reference for both, gave 3.58, 2.87 and 4.94 dB but 1.14 dB for the
control (its bands over 8 kHz hold almost nothing of the chime without its breath), so the check takes the direct
sound alone (`EngineTestHooks.reverb`, test-only) and each ear over its own twin.

The other eight checks of the rig hold on the new engine (the target note panned and with its breath; review E5: the
rig's flights then held no chime, floor or ceiling, so their breaths were not measured until F4, section "Review
fixes"): the voice 4.67, 4.60, 4.80 LU over the mix (v0.13: 4.76, 4.66, 4.64); true peak -6.99, -3.74,
-6.26 dBTP (unchanged); every cue at least 15.0 dB over the motor (unchanged; the height layer's own bands stay 400
and 500 Hz, 40 dB over it); the height layer in its band modulated at most 1.0 % (1.1 %), its buzz out of the band
42.8 %; the height glide 3.7 cents a hop at most; two renders within 1.8e-7; stems summing to -131.6 dB.

The localization models of the design (probe F) are not runnable from this repository or from `vl-spec`: neither holds
the adapters (design step 11 is not built). They were run, as information, from the probe's own setup on the build
machine (`<tools>` Octave 9.4 and AMT 1.6.0, the probe's 26 heads: 20 ARI, 5 IRCAM LISTEN, KEMAR), outside the
repository: `baumgartner2014`, Chrome's captured HRTF as the target, each head's own DTFs as its template, the chime's
own dry signal (one second of a play, from the rig's renders) as the stimulus. Up/down error: the share of predicted
responses on the other side of the horizontal plane than the way. Median of the 26 heads (interquartile range):

| Chime | With the direction (Chrome renders it at) | Without (ahead) |
|---|---|---|
| way above | 11.5 % (8.2 to 18.0) at 30 degrees; 20.8 % at 15 | 17.4 % (12.5 to 25.5) |
| way below | 58.9 % (46.7 to 63.0) at -30; 48.3 % at -15 | 66.6 % (61.2 to 74.4) |
| mean of the two | 35.2 % (34.6 % at 15) | 42.0 % |
| broadband noise for reference, at 30 and -30 | 7.5 % and 68.2 % | |

So, by the model, the direction helps a little (7 points on average) and above more than below: with Chrome's generic
HRTF a source below the horizon is still heard above by most heads, noise included. Pitch stays the carrier, as the
design says; the direction is a second cue for the ears and headphones that can use it. `bayesian_listener` was not
run: for a cue's own spectrum it needs the stimulus-weighted target the design describes for VL-1 (not built), and its
probe run took about 65 s a head for broadband DTFs alone.

## Final status of E1 (2026-11-08)

Done, with commits (branch `s13-elev`, not pushed):

| Step | What | Commits |
|---|---|---|
| lane doc | the request and the steps | a61624f |
| E1-1 | the audit; v0.13's placement hashed before any change | a9de49c |
| E1-2 | the chime, the target note, the floor and the ceiling from above or below, with a breath of air | e09fb02 |
| E1-3 | `SonicPrefs.heightDirection`, its name and description in four languages | d3241df |
| E1-4 | the words, tunnel-gaps' plays above and below, walls-pillar's line | 8d6cff0 |
| E1-5 | the wrong way between gates | 80289e2 |
| E1-6 | the listener's check, the proofs, `pnpm listen`, the model (this doc) | 41e3677, 6880fda, ea5fddc, c605068, this commit |

Left open, with reasons:

- How it sounds to a person: whether a pilot hears the chime above or below by its direction, likes the target note
  coming from the target (it no longer sounds where the height tone does), and finds the breath of air (-10 dB against
  a unit fundamental) pleasant; the first testers, with the setting to turn it off.
- In flight the chime comes from the way's real direction, 8 to 20 degrees up or down in tunnel-gaps (Chrome's 15
  degree slices); left and right are placed at an exaggerated 60 degrees. An exaggerated elevation (say at least 30
  degrees, as the named plays have) is a choice for the owner once testers have heard both.
- The model's numbers are predictions for 26 sighted listeners' ears with a generic HRTF; blind pilots and their
  headphones may differ (design section 13). The adapters of VL-1 (the panel in the rig) are the design's step 11.
- The corridor's intro.3 says the four sides in one line now (16 s with the local voice).
- E2-1 to E2-4: the next agent's (done since: "Final status of E2").

## Final status of E2 (2026-11-08)

Done, with commits (branch `s13-elev`, not pushed):

| Step | What | Commits |
|---|---|---|
| E2-1 | the Spanish, Polish and Russian lines measured with their voices; the timing tests in four languages | 8e62a45 |
| E2-2 | `pnpm listen:words`; K's help names "the key" in es, pl, ru; bound 0.2, 56 recorded words, the control | 50064bb, e5bf963, 18c1ae4 |
| E2-3 | the simulator's Fly by Sound lines, the same round trip | e2b45d5, 269c6ed |
| E2-4 | every check again; this status | 6a432ed, this commit |

Left open, with reasons:

- How the lines sound to a person: no native speaker has heard them yet. Whisper is a word check that understands
  better than people (design, VL-4). The voices' habits recorded here are where a pilot may mishear too, and whether a
  word changes is the owner's call with a native speaker: English "height tone" heard as "high tone", Polish
  "węższy" (narrower) as "wyższy" (higher), Russian "пролети" (fly through) as "пролейте" (pour) and "гул" (hum) as
  "гол" (goal), the Russian voice spelling "Fly by Sound".
- The voices checked are the Windows desktop ones (David, Helena, Paulina, Irina). Chrome also lists the OneCore voices
  (Laura, Pablo, Adam, Pavel and the others) and online ones; their lengths and words are not measured, nor is the
  loudness of the new voices (M41-17, `evidence/voices-local.json`, now measurable on this machine).
- The bound finds a line a voice cannot say; one lost word in a long line stays under it. The simulator's long key lines
  show it; the package's key lines are all heard with their key, but no rule checks a key's name on its own.
- The English length fixture still holds 385 of its 471 lines without parameters (the lines added since take the
  estimate); Spanish, Polish and Russian hold all 471.

## E2: the lines in Spanish, Polish and Russian, said by real voices

The owner wants the Spanish, Polish and Russian lines checked with real voices (v0.13's merge left them heard by no one:
this machine had no local voice of those languages). The lead installed Windows' own voices of es-ES, pl-PL and ru-RU.
Listed from the registry on 2026-11-08 (read only): desktop SAPI voices (what `System.Speech` and the clip makers use)
David and Zira (en-US), Helena (es-ES), Paulina (pl-PL), Irina (ru-RU); OneCore voices (Chrome lists these too) David,
Mark, Zira, Helena, Laura, Pablo, Adam, Paulina, Irina, Pavel.

### E2-1, the lengths

`test/fixtures/measure-tts.ps1` with `-Locale locales/<lang>.json -Voice "Microsoft <name> Desktop"`, its output
written in the English fixture's form (UTF-8 without a byte order mark, two-space JSON). Every line without parameters,
471 per language (the English fixture holds 385 of its 471: the lines added since it was made take the estimate).

| | Spanish, Helena | Polish, Paulina | Russian, Irina | English, David (for reference) |
|---|---|---|---|---|
| lines longer than the runner's estimate (0.7 s and 65 ms a character) | 253 of 471 | 342 of 471 | 471 of 471 | 267 of 385 |
| measured over estimated, median (largest) | 1.01 (1.59) | 1.09 (1.50) | 1.30 (1.84) | 1.07 (1.45) |
| lines longer than the runner waits (twice the estimate and a second) | 0 | 0 | 0 | 0 |
| ears-glossary, ears-game, ears-headphones (minutes, answers a second after each question) | 8.6, 6.9, 1.9 | 8.8, 7.5, 1.9 | 9.9, 8.0, 2.2 | 8.4, 6.9, 1.9 |

So every lesson's timing holds in every language with its own voice (no sound under speech, every question after its
sound), and the Russian voice, the slowest, makes the glossary lesson about a minute and a half longer than in English.

### E2-2, the round trip (`pnpm listen:words`)

How (`tools/listen-words.ts`, `tools/listen/words.py`):

- Lines: all 526 keys of each locale. A line with parameters is said as a host says it: K's help with the simulator's
  keys (T record, U send, I status, Z repeat, G glossary, R reset, N next; Enter, Escape), a lesson's title, a cue's
  name, small numbers (`sampleParams`).
- Voices: each language's desktop voice (David, Helena, Paulina, Irina; `tools/listen/tts/sapi-clips.ps1`, 48 kHz),
  the clips kept in `<cache>/speech/sapi-<voice>/` by voice and text.
- Whisper large-v3 (faster-whisper 1.2.1, CTranslate2 4.8.5, float16 on the GPU) through its own `transcribe()`, as the
  design's speech probe ran it: in the line's own language, beam 5 at temperature 0, with timestamps, nothing carried
  from clip to clip, no voice-activity filter; one voice and language at a time, each under the GPU lock (about 500
  clips, 4 to 5 minutes), the lock left free for 25 s between them. A first run decoded 16 clips at a time without
  timestamps (the same text as `transcribe()` one by one on 70 clips), but without timestamps Whisper stops early now
  and then: David's "Each one leaves a single way past it: above, below, left or right." came back without its last
  four words, which `transcribe()` with timestamps hears (and so does the clip's last 4 s alone). The model sits in
  `<cache>/whisper/` (fetched at a pinned revision when missing); faster-whisper and its dependencies were added to the
  listener's environment and to `tools/listen/requirements.txt`.
- Word error rate per line: substitutions, deletions and insertions over the line's words, after normalising case and
  punctuation (lower case, every character that is not a letter, a mark or a digit a space, apostrophes dropped, the
  Russian yo as ye). Two words heard as one or one as two are no error ("Fly by" written "Flyby"); a number matches one
  to three words of the transcript, because the voices say numbers in their own words (Polish "Bramka 2 z 5" is said
  "Bramka druga z pięciu"), and costs one when nothing is heard for it.
- Evidence: `evidence/listen/VL-4-words.json`, keyed by the hash of the locales, the code that fills the lines, the
  clip maker, the transcriber and the driver; every line heard with an error is in it with its transcript.

The run (2104 lines, 2517 clips with the control; Whisper 3.5 to 5 minutes per voice and language):

| | English, David | Spanish, Helena | Polish, Paulina | Russian, Irina |
|---|---|---|---|---|
| words | 4022 | 4071 | 3448 | 3283 |
| lines heard with no error | 490 | 499 | 496 | 461 |
| lines over 0.2 before the records | 23 | 7 | 8 | 26 |
| words recorded (`HEARD`) | 16 | 6 | 11 | 23 |
| with them: lines heard exactly, mean rate, largest | 520, 0.001, 0.17 | 512, 0.003, 0.20 | 514, 0.003, 0.20 | 509, 0.004, 0.20 |

The control, the 526 Russian lines said by David: 525 over the bound, median rate 1 (David skips the Cyrillic letters:
a line comes back as nothing, a lone letter or a stray phrase); the one under it is "Fly by Sound".

What was wrong, and fixed: K's help (and every line that names a key) in Spanish, Polish and Russian, before the run
of this table. Said by the voices, a letter right after the verb ran into it or was lost: "Pulsa T para" heard as the
word "Púlsate", "Pulsa G" as "Pulsaje", the Polish "Naciśnij I, aby" (the letter I is also the word "and") as
"Naciśnij, aby", the Russian "Нажми T" as "Нажмите" (press, polite) and "Нажми U" as "Нажми её" (press her). Now "Pulsa
la tecla T", "Naciśnij klawisz I", "Нажми клавишу T": all 51 lines heard with their key. English "Press T" was heard
right and stays.

What the voices say otherwise (recorded, the text kept; the ones a pilot may mishear too, for testers and the owner):

- English, David: "height tone" is heard as "high tone" in all nine lines that say it (the t runs into tone); "Gate 2"
  as "Gay 2"; "passed" as "past" or "pest"; "Off course" alone as "of course"; one word alone ("Ears", "Race").
- Spanish, Helena: "aros" (rings) alone or first in a title as "a los"; "dron" as "dran" everywhere; "Cubo" alone.
- Polish, Paulina: "węższy" (narrower) as "wyższy" (higher), and "najwęższy" as "najwyższy", in all five tunnel lines
  that say them; "sześcianu" (of the cube) as "60" or misspelt; "dron" as "dran"; one word alone ("Słup", "Wyjdź").
- Russian, Irina: the verbs of flying with a prefix, "пролети" (fly through), "облети", "долети", "подлети", are heard
  as "пролейте" (pour) and the like in 22 of the 23 lines that say one, most of them a lesson's goal; "гул" (the hum)
  as "гол" (a goal) in 12 of its 13 lines; "Fly by" is spelt letter by letter; one or two words alone with unstressed
  endings ("Мягкая" as "Мягкое", "Тише" as "Тиши").

The rest is Whisper's writing, not the voice: American spellings, digits for number words, the percent sign, a missing
accent. A limit: the check hears what a voice cannot say or a listener may mishear, not spelling. A misspelt word that
the voice reads as written comes back as written ("las tecals", tried on purpose, passed).

## Simulator lines

The same round trip (`node tools/run-tool.mjs listen-words --sim <the simulator's packages/i18n/locales>`, the same
voices, Whisper and bound; no records: the simulator owns these texts) on its Fly by Sound files, read only: ShramkoGSFPV
v13-host at e7612d3 (2026-11-08 20:46, "stage B final"), `fly/sonic` (72 keys), `fly/sonicentry` (2), `fly/sonickeys`
(10), `fly/sonicrec` (168). Of the 252 keys a language, 3 are not lines (the recogniser's language tag and the two
lists of phrases it listens for): 249 lines a language, 996 in all. A line with parameters is said with the simulator's
own words where it has them (its key names and "Control and C", a lesson's title, its problem and reason lines) or
small numbers; K's help lines of the simulator (`sonic.say.helpShare`, `helpPrevious`, `helpRepeat`, `helpCut`) with
its keys L, B and Z, and the line at every lesson's start (`sonic.say.lessonKeys`) with Escape, Z and N.

| | English, David | Spanish, Helena | Polish, Paulina | Russian, Irina |
|---|---|---|---|---|
| lines | 249 | 249 | 249 | 249 |
| heard with no error | 230 | 232 | 230 | 203 |
| mean rate | 0.010 | 0.015 | 0.023 | 0.063 |
| over the bound 0.2 | 4 | 4 | 9 | 21 |

Every line over the bound, with what Whisper heard:

English, David

| Key | Line | Heard | Rate |
|---|---|---|---|
| `sonic.copyKeys` | Control and C | Control-N-C. | 0.33 |
| `sonic.copyKeysMac` | Command and C | Command-N-C | 0.33 |
| `sonicrec.channel.status.retrying` | will try again | We'll try again. | 0.33 |
| `sonicrec.state.savedDisk` | Saved to disk. | Save to Disk | 0.33 |

Spanish, Helena

| Key | Line | Heard | Rate |
|---|---|---|---|
| `sonic.copyKeysMac` | Comando y C | Comando IC. | 0.67 |
| `sonic.link.titleStart` | Enlace a Fly by Sound | Enlace a FlybySound. | 0.60 |
| `sonicrec.channel.telegram` | Telegram | TELAGRAM | 1.00 |
| `sonicrec.send.notice.cancelled` | No se envió. La grabación sigue en este dispositivo. | Nos envió. La grabación sigue en este dispositivo. | 0.22 |

Polish, Paulina

| Key | Line | Heard | Rate |
|---|---|---|---|
| `sonic.captions.label` | Napisy Fly by Sound | Napisy Flajby Sound | 0.50 |
| `sonic.copyKeys` | Control i C | Kontroli C. | 0.67 |
| `sonic.footer.about` | O Fly by Sound i jego kodzie źródłowym | Offline Sound i jego kodzie źródłowym. | 0.38 |
| `sonic.footer.leave` | Wyjdź z Fly by Sound i otwórz symulator | Wyjdź z Flajby Sound i otwórz symulator. | 0.25 |
| `sonic.link.titleStart` | Link do Fly by Sound | Link do Flajby Sound. | 0.40 |
| `sonic.say.menuResume` | Wznów | Wznow. | 1.00 |
| `sonicrec.channel.status.retrying` | spróbuje ponownie | Spróbuję ponownie. | 0.50 |
| `sonicrec.key.Tab` | Tab | Tabulator | 1.00 |
| `sonicrec.status.starting` | Uruchamiam. Jeśli przeglądarka zapyta o mikrofon, wybierz Zezwól. | Uruchamiam. Jeśli przeglądarka zapyta o mikrofon, wybierz ZZW-L. | 0.25 |

Russian, Irina

| Key | Line | Heard | Rate |
|---|---|---|---|
| `keys.sonic.glossary` | Fly by Sound: открыть словарь звуков | FLUI BUI SOUND Открыть словарь звуков | 0.33 |
| `keys.sonic.menu` | Fly by Sound: меню урока (Esc), меню паузы (P) | FLY BUY SOUND Меню урока Escape Меню паузы P | 0.22 |
| `keys.sonic.previous` | Fly by Sound: шаг назад | F-L-U-I-B-U-I саунд, шаг назад | 1.60 |
| `keys.sonic.status` | Fly by Sound: услышать состояние урока и записи | FLUI BUI SOUND Услышать состояние урока и записи | 0.25 |
| `sonic.copyKeys` | Control и C | Ctrl-E-C | 0.67 |
| `sonic.copyKeysMac` | Command и C | Кэйры Мэн Ти Си | 1.33 |
| `sonic.footer.about` | О Fly by Sound и его исходном коде | AFL-UI, BUISound и его исходном коде | 0.50 |
| `sonic.footer.leave` | Выйти из Fly by Sound и открыть симулятор | Выйти из FLYBUY SOUND и открыть симулятор | 0.25 |
| `sonic.link.titleStart` | Ссылка на Fly by Sound | Ссылка на флюайбьюай саунд | 0.60 |
| `sonic.menu.page` | Fly by Sound: слепым и слабовидящим | FLY BUY SOUND Слепым и слабый дящим | 0.50 |
| `sonic.progress.counted` | Засчитано 2 из 5 | За счета на 2 из 5 | 0.25 |
| `sonicrec.action.send` | Отправить автору | Отправите автору. | 0.50 |
| `sonicrec.blocked.not-a-package` | сервер говорит, что это не запись Fly by Sound. | Сервер говорит, что это не запись FLUI-BUI Sound | 0.22 |
| `sonicrec.channel.name` | Telegram: отправлено | Телеграм, отправлено | 0.50 |
| `sonicrec.channel.telegram` | Telegram | Телеграм | 1.00 |
| `sonicrec.headphones.wired` | Проводные | Приводные | 1.00 |
| `sonicrec.key.Tab` | Таб | ТАП | 1.00 |
| `sonicrec.survey.again` | Повторить вопрос | Повторите вопрос. | 0.50 |
| `sonicrec.title` | Fly by Sound: запись | FLYBUY SOUND Запись | 0.50 |
| `sonicrec.transfer.delivered` | Доставлено. Запись у автора: Telegram: отправлено. | Доставлено. Запись у автора, телеграм, отправлена. | 0.33 |
| `sonicrec.transfer.stored` | Сервер её получил. Доставка автору: Telegram: отправлено. | Сервер её получил Доставка автору, телеграм, отправлена | 0.29 |

What stands out for the simulator's owner:

- The name. Irina spells or mangles "Fly by Sound" in every Russian line that says it (10 of the 21 over the bound);
  Paulina says "Flajby", and "O Fly by Sound" was heard as "Offline Sound". The package's own Russian lines have the
  same habit, recorded (`app.name`, the menu's welcome).
- K's help and the other lines that name a key lose the key's name as the package's did, under the bound only because
  the lines are long: "pulsa T otra vez" heard as "púlsate otra vez" (`sonicrec.status.asking`), "naciśnij T jeszcze
  raz" as "naciśnij tej jeszcze raz", "Нажми B" as "Нажми бы" (`sonic.say.helpPrevious`), "Нажмите U ещё раз" as
  "Нажмите её ещё раз" (`sonicrec.send.notice.asked`). The words "the key" before the key's name, as the package now
  says them, would do the same there.
- Russian speaks to the pilot in two registers in one help: the package's K lines say "Нажми" (informal), the
  simulator's `helpShare`, `sonicrec.survey.listening` and `sonicrec.send.notice.asked` say "Нажмите" (formal), and
  `helpPrevious` says "Нажми".
- A key's name alone ("Tab" in Polish and Russian, "Control and C") and a word alone ("Wznów", "Проводные") are
  heard worst, as in the package: nothing around them tells them.

## Review fixes

### F1, the wrong way between gates (review E1, E3, E8)

Tried first: the reviewed rule, kept as `testHooks.lineUp 'no-progress'`, tells "You are flying back. Turn around." right
after ring 4 of the Winter Garden in a correct flight (1.5 m past at 1 m/s, 2 m at 1.5, 2.5 m at 2, 4 m at 3), and tells
a pilot who backs away from gate 1 at the start in all eight analytic gate lessons; its leg to gate 1 of a later lap ran
from the start. All three hold.

The rule now (`src/lesson/runner.ts` `wayForward`, `legTo`):

- The leg's rule (its line-up distance `lineUpM`, flying back against the leg along the floor) holds on a leg only once
  the craft has flown along it: its velocity along the leg over `WRONG_WAY_MPS` (0.5 m/s) at least once since the gate
  before was passed, or since the attempt began or the craft was placed. Before that v0.13's rule holds: further than
  `LINE_UP_M` (8 m) in front of the gate, flying away from it. So nothing is told before the leg is flown that v0.13 did
  not tell, and a turn back after it is told within a few metres as before.
- Why not the progress rule alone, as the review suggests: then a pilot who turns round at the start and flies away from
  gate 1 is never told, however far he goes, the very case of M41-15; with v0.13's rule under it he is told once 8 m
  away, as in v0.13.
- The leg begins at the gate passed last in the attempt (the gate before it in a course flown in order, the course's last
  for the first gate of a later lap), else at the lesson's start. A course in any order (`inOrder: false`) has no legs:
  its next gate is wherever the pilot goes, so it keeps v0.13's rule toward the gate whose hum sounds. No shipped lesson
  has laps or a course in any order.

Measured (`test/direction.test.ts`, 23 new tests; the Winter Garden track is `test/fixtures/track-7a475d38-rings-v1.json`,
the simulator's file at a8e98a9, flown as the simulator hands it over: `trackToObjects`, the start through the
transform):

| Flight | Shipped | v0.13 (`'fixed'`) | Control (`'no-progress'`) |
|---|---|---|---|
| Winter Garden, 3 m before each ring through it to 1.5, 2, 2.5, 3, 4 m past, at 1, 1.5, 2, 3 m/s (20 flights) | told once, 4 m past ring 4 at 1 m/s (4 s flying away, beyond 8 m from ring 5) | the same | told after ring 4 from 1.5 m past at 1 m/s, 2 m at 1.5, 2.5 m at 2, 4 m at 3 |
| Winter Garden, 2 m along the leg from ring 4 to ring 5, then 3 m back at 2 m/s | told (after ring 4) | never | told |
| the start of the 8 gate lessons, still 3 s | never | never | never |
| the same, backing away from gate 1 at 1 m/s to 0.3 m before the wall behind (1.2 m; every start is 1.5 m from it) | never | never | told in all 8 |
| free-garden's start (8 m in front of ring 1), turned round, 6 m away at 2 m/s | told once | told once | told |
| a square loop of 4 rings, two laps: lap 2, 5 m in front of ring 1, back toward ring 4 for 1.75 s | told (the leg from ring 4: line-up 4.04 m) | never | |
| rings-line in any order: ring 2 first, round to 5 m in front of ring 1, through it at 1 m/s | never | | |

Controls broken by hand, each failing its test, then restored: no v0.13 rule before the leg is flown (2 tests fail: the
Winter Garden at 1 m/s 4 m, the start turned round); the leg from the gate before in course order (the second lap
fails); a course in any order judged by legs (it fails); progress never needed (9 fail: the Winter Garden and the eight
starts). The review's suggestion "carried 2 s past the gate, never told" holds up to 2 m/s (4 m); at 3 m/s, 6 m past
ring 4 and 11 m from ring 5, the pilot is told as v0.13 told him.

### F2, the lines with the setting off (review E2)

Tried first: with `heightDirection: false` the planner places the chime of a way above or below at `FREE_DIRS` (ahead)
and the floor and the ceiling at the sampler's direction either way (`test/elevation.test.ts`, "the floor and the
ceiling"); the glossary, the corridor's and tunnel-gaps' intro.3 said "from above" for both, and the setting's
description named the floor and the ceiling among what it moves. It holds.

The lines now (English; Spanish, Polish and Russian say the same):

- Glossary (`cue.safety.free.glossary`): "A pair of quick notes, again and again, while the way ahead is blocked. Equal
  notes from left or right: the way is there. Like your height tone in a climb: above. The other way: below. With Sound
  from above and below on, from there too."
- The corridor's intro.3: by pitch alone, so it stays short where the fast path first names the chime: "When something
  blocks the way ahead, a pair of quick notes repeats. Equal notes come from the free side, left or right. Notes moving
  like your height tone in a climb: the way is above. The other way: below."
- Tunnel-gaps' intro.3 (then the plays from up and from down): "If the way is above, the chime moves like your height
  tone in a climb. If it is below, the other way. With Sound from above and below on, it comes from there too."
- The setting's description: "On: a way above or below an obstacle and the target height note also come from there,
  with a soft hiss good headphones can place. Off: from ahead, told by their pitch alone. The ceiling and floor come
  from above and below either way."

Where the way is and where the sound comes from are worded apart in every language ("the way is above" against "from
above"; Russian "проход вверху" against "сверху", Polish "górą" against "z góry", Spanish "arriba" against "de arriba"),
so the test can tell them: every line that names the chime tells the way above by the climb words, says "from above or
below" only in the sentence that names the setting by its own name (`menu.setting.height-direction`), and never "from
ahead"; the glossary and tunnel-gaps name it; the description's sentence that begins with the off value says "from
ahead", and the sentence that names the ceiling says "either way". The speech lint's rules held the wording (no `;`, at
most 240 characters), and the glossary keeps "again and again" (`test/events.test.ts`, s13-worlds review M8).

Lengths, measured with each language's local voice by the method of `test/fixtures/measure-tts.ps1` (unchanged lines
measured again for the check: the fixtures' values to the millisecond), seconds (before the review):

| Line | English, David | Spanish, Helena | Polish, Paulina | Russian, Irina |
|---|---|---|---|---|
| glossary | 18.425 (18.07) | 18.02 (17.895) | 18.83 (17.035) | 23.34 (20.91) |
| corridor intro.3 | 15.375 (16.035) | 15.695 (15.005) | 16.405 (16.82) | 19.49 (20.73) |
| tunnel-gaps intro.3 | 11.705 (10.23) | 12.005 (9.375) | 12.96 (10.335) | 15.54 (12.425) |
| the setting's description | 16.215 (13.275) | 16.255 (14.675) | 16.65 (14.015) | 20.885 (17.85) |

None is longer than the runner waits (twice the estimate and a second); lines longer than their estimate: English 269
of 385 (267), Spanish 254 (253), Polish 343 (342), Russian 471. Controls: the lane's texts before the review (each of
the 16 fails, a fixture in the test), and by hand the English glossary put back, the Spanish tunnel-gaps line without
the setting's name, the Russian description without "в любом случае": each fails, then restored.

### F3, the key's name (review E4)

Tried first: the Spanish `help.record` put back to v0.13's "Pulsa {key} para..." passed all 1162 tests and the locale
lint. It holds.

- The speech lint (`tools/locale-lint.ts`, `KEY_WORDS`): in Spanish, Polish and Russian a key's name (`{key}`,
  `{skip}`) has "la tecla", "klawisz", "клавишу" right before it (rule `key-word`). `test/locales.test.ts`: the 17 lines
  of each language that name a key meet it; v0.13's 17 a language (16c01a1, `tools/listen/key-lines-v013.json`) each
  fail it. By hand, the Spanish `help.record` without "la tecla": the lint and two tests fail, restored. English needs
  no such word ("Press T" is heard right).
- The words check (`tools/listen-words.ts`, `keyHeard`): a line that names a key is heard with the key's name as a
  word of its own (the transcript has "T", "Escape", "Enter" as words), whatever its rate, in every language; the
  evidence keeps every such line's transcript, and `test/words.test.ts` checks the rule on it again. Its control:
  v0.13's key lines said by their own voices must lose a key in each of Spanish, Polish and Russian, or the check is
  not valid. The bound alone let these through: Spanish `rec.ask` with "Púlsate" for "Pulsa T" is at 0.08.
- Records for Whisper's percent sign in Polish ("20 procent") and Russian ("20 процентов"), as English and Spanish had:
  `reason.height-high` and `reason.height-low` were at the bound for the sign alone.

The run (`pnpm listen:words`, evidence 217fe5790a33, words version 2): PASS. Every line of each language within 0.2;
lines heard exactly: English 519, Spanish 512, Polish 516, Russian 510 of 526; the lines that name a key: 17 of 17 in
each language heard with the key. Control, the Russian lines by David: 525 of 526 over the bound, median rate 1. Key
control, v0.13's 51 key lines: the key lost in 4 Spanish lines ("Pulsa T para" heard "Púlsate para" in `help.record`,
`rec.ask`, `rec.recover`; "Pulsa G" as "Pulsaje"), 1 Polish ("Naciśnij I, aby" as "Naciśnij, aby") and 7 Russian
("Нажми T" as "Нажмите" three times, "Нажми U" as "Нажми её" three times, "Нажми I" as "Нажми Ай"). The four reworded
lines of F2 were heard with at most one word otherwise (English "a soft hiss" as "the soft hiss", Russian "загорожен" as
"загрожен"); English "height tone" is heard "high tone" as recorded.

What the bound still lets through (the review's examples, not changed: a word for a native speaker): Russian
`fly.progress` "Засчитано" heard "Защита на" (0.17), Polish `lesson.shapes-cube.intro.3` "zapytam cię" as "zapytamy
rykcie" (0.18). The design's VL-4 asks at most 2 % of a lesson's words: counted on this run over each lesson's own lines
(`lesson.<id>.*`), nine are over it by one to three words: English rings-line (3.4 %), Spanish rings-first (4.2 %),
move-speed (3.1 %) and ears-game (2.7 %), Polish move-speed (3.3 %), shapes-cube (3.2 %) and ears-headphones (3.1 %),
Russian shapes-square (2.9 %) and move-stop (2.1 %). The check's bound is per line; a lesson bound is open.

### F4, VL-6 and VL-2 with the floor, the ceiling and the chime (review E5)

Tried first: the truth of the rig's ring flight, frame by frame (a new field: every voice and whether it has the
breath), holds the gate's hum, the ring's shape and a wall, never the chime, the floor or the ceiling; the climb renders
the height layer alone. It holds: before this step VL-6 and VL-2 said nothing of those breaths, and section E1-6 below
said they did.

The rig (`test-audio/page/listen.ts`, `tools/listen.ts`, `tools/listen/measure.py`; rig 4, driver 4, measure 4):

- The gaps flight: tunnel-gaps flown along its world's own track (the start, then its checkpoints through the four free
  ways: above, right, below, left) at 2 m/s after a still second, 18.9 s, the lesson's layers, the default craft's motor
  at 15 %, three spoken lines (1.2 s; 5 s over the way above and the ceiling; 10.5 s over the way below and the floor).
  Rendered in the three themes, the same with Sound from above and below off, its stems (safety, height, room, motor),
  every craft's motor and the raw motor at 60 % (the control).
- Cover, the condition of VL-6 and VL-2: the flight sounds the chime above (152 frames), the chime below (160), the
  ceiling (203) and the floor (205), each with its breath (at least 30 each). Control by hand: the same count on the
  flight with the setting off is 0 of each.

What the first run found, and fixed:

- The motor masked the breath's lowest bands: the breath (the safety stem's third octaves from 4 to 16 kHz, in the
  frames with a breath) stood 5.7 dB over the Air65's motor at 4 kHz, 9.2 over the Meteor65's, 8.3 over the Pavo Pico's
  at 5 kHz, where the motor bus is made to keep 12 dB or more off the cues' highs over 4 kHz. Its second-order low-pass
  at 2 kHz is now fourth order (two Butterworth sections, as its high-pass): the breath is 17.8 to 36.8 dB over every
  craft's motor in every band from 4 to 16 kHz (VL-2 holds it to 12 dB); the raw motor (the control) 4.5 dB. The cues'
  own bands are unchanged: every cue at least 15.0 dB over the motor in the ring flight, 41.7 dB in the tunnel.
- The voice in the tunnel: 1.95 to 2.91 LU over the mix, under VL-6's 3 to 6. Without the breath it is 2.03 to 3.00
  LU, so the breath costs 0.10 to 0.17 LU (VL-6 holds it to 0.5; control by hand: the breath 10 dB louder costs 0.65 to
  0.88 LU and fails, restored); the rest is the tunnel: its walls, obstacles, floor and ceiling make its mix 1.7 to 2.6
  LU louder than the ring flight's, where the voices were set to 4.5 LU (M41-17). VL-6-speech keeps 3 to 6 LU on the
  ring flight and reports the tunnel's margin.

The run (`pnpm listen`, 543c687b88a2, 9 of 9 valid and passing; 43 renders):

| Check | Ring flight | Tunnel-gaps |
|---|---|---|
| voice over the mix, LU (soft, clear, race) | 4.61, 4.56, 4.74 | 2.88, 1.99, 1.93 (reported); 3.00, 2.16, 2.03 with the setting off |
| the breath's cost to it, LU | | 0.12, 0.17, 0.10 (at most 0.5) |
| true peak with speech, dBTP | -6.96, -3.72, -6.19 | -4.89, -1.98, -4.53 (control, volume 1: +0.26, +0.55, +0.17) |
| every cue over every craft's motor, dB | 15.0 or more | 41.7 or more |
| the breath over every craft's motor, 4 to 16 kHz, dB | | 17.8 or more (raw motor: 4.5) |

The other checks, as before: VL-1-elevation 3.57, 3.05 and 4.94 dB (control 0.57), VL-0a 1.2e-7, VL-0b -131.8 dB,
VL-pitch 3.7 cents a hop at most, VL-onset 2.475 to 2.493 s, VL-3-height passing.

Open (the owner's): in a busy tunnel the voice sits 2 to 3 LU over the mix. Under every line the engine ducks the cues
by 12 dB, so the voice is far over what sounds with it, but the line over the way below is only -0.39 to 1.01 LU over
the 3 s before it. Raising the voices about 1.1 dB would put both flights within 3 to 6 LU, the clear theme's tunnel
peak (-1.98 dBTP) then near -1; a voice level that follows the mix, or the voice through the engine's limiter (design
section 13), would hold it everywhere.

### F5, the target note's two timings (review E6)

Tried first, by measurement: two audio proofs (`test-audio/page/proofs.ts`, `pnpm proof:audio`), on a scene of the
height layer alone, the craft 0.3 m under a ring 3 m away, a note every 1.25 s, the ring on the left, then (the craft
turned) on the right, behind and ahead, two notes each; rendered twice with the same schedule, the height tone alone and
the target notes alone (`EngineTestHooks.heightPart`), the direct sound only. Both claims failed on the engine as the
lane left it:

- The tone and the note together: in every note the height tone was back while the note's sound at the ears was still
  above -60 dB of its peak, for 2.3 to 2.8 ms (6.5 ms of `HRTF_ONSET_S` covered Chrome's 5.6 ms delay, not the impulse
  response ringing on after it). With the tone back at the note's end (the control) the overlap is 8.5 to 9.2 ms.
- The note from its own direction: the first note after the ring moved from the left to the right began from the left,
  its first 20 ms +1.31 dB left over right against -4.55 dB over its held part; with the 60 ms lead or without it alike
  (+1.99 dB). Chrome stops processing a panner whose input has been silent past its tail, so the target panner took its
  new direction only when the next note sounded, crossfading from the old one over the note's onset; the lead did not
  act.

Fixed in `src/audio/engine.ts`: the height tone comes back `HRTF_TAIL_S` 12 ms after a placed note (the longest tail
measured, 9.2 ms, and a margin), and a constant input of 1e-7 (`TARGET_KEEP_ALIVE`, -140 dBFS) keeps the target panner
running between the notes, so it turns during the lead. No other voice, note or timing changes; the panners made stay
33 (`voice-budget`); the cost is a 5.5 ms longer gap after each placed note and one constant source.

| Proof | Claim | Shipped | Control |
|---|---|---|---|
| `target-note-gap` | no sample with the tone and the note both above -60 dB of their peaks, in each of 8 notes | 0 ms in every note; the tone back 2.1 to 3.1 ms after the note's sound has fallen under -60 dB | `hrtfTailS` 0: 6.75 to 9.23 ms |
| `target-note-pan` | the first 20 ms of a note within 1 dB of its held part in level difference, after the ring moves from the left to the right | 0.52 dB at worst | `targetPanLeadS` 0: 6.54 dB |

By hand, each fix taken back once: the tail at 6.5 ms fails the gap (2.25 to 2.75 ms), no constant input fails the pan
(+1.31 against -4.55 dB); restored. `pnpm proof:audio`'s audio file: 7 proofs, each passing with its control failing
(`evidence/audio-proofs.json`).

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
- When the gitlink moves past 16c01a1: tunnel-gaps is version 2 and walls-pillar version 3 here, so the simulator's tests
  that hold a lesson's version read it from the package (`getLesson(id).version`, as wave 2's W20 already asks for
  walls-hall), and a recording made at 16c01a1 in those two lessons reads "recorded with an older build" on the replay
  page (W10). The engine makes one more HRTF panner (33) and the free way two more rays a frame while the chime sounds:
  worth noting in the cost bench run of W16, nothing to change.
- E2, K's help and the lines that name a key: in Spanish, Polish and Russian the package's 17 such lines now say "the
  key" before its name ("Pulsa la tecla T", "Naciśnij klawisz T", "Нажми клавишу T"). The simulator's own lines that
  name a key (`sonic.say.helpShare`, `helpPrevious`, `helpRepeat`, `sonicrec.status.asking`,
  `sonicrec.send.notice.asked`, `sonicrec.survey.listening`) lose the key's name the same way said by the local voices
  (section "Simulator lines") and would take the same words; the Russian ones would take one register with the package's
  ("Нажми"). No simulator test holds the changed texts (searched v13-host: `apps/fly`, `tools/bench`).
- Review fixes (section "Review fixes"): nothing in the host has to change. The setting's description
  (`menu.setting.height-direction-what`) now says what off does, 16 to 21 s with the local voices: the spoken settings
  (W13) should let the next item interrupt it, as any long line. free-garden on the Winter Garden no longer says "You
  are flying back" after ring 4 in a correct flight. The engine keeps one constant source on the target panner
  (-140 dBFS, inaudible) and its motor low-pass is fourth order: worth a line in the cost bench (W16).
- E2, the simulator's lines over the bound (section "Simulator lines"), above all "Fly by Sound" said by the Russian and
  Polish voices; `node tools/run-tool.mjs listen-words --sim <its packages/i18n/locales>` hears them again after a change
  (a report, not evidence: the texts are the simulator's).
