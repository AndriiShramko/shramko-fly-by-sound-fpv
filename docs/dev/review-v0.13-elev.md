# Review of lane s13-elev: up and down by direction, the wrong way between gates, the lines heard back

Independent review, 2026-11-08, of branch `s13-elev` at 0dd3cd9 against `main` 16c01a1 (19 commits, 56 files, +6651
-254): E1 (owner's message 42: the cues of up and down also from their direction, the setting that turns it off, the
words, the wrong way between gates, the measurements) and E2 (the Spanish, Polish and Russian lines measured and heard
back with their local voices). Read first `docs/dev/status-v0.13-elev.md`; what it already says is not repeated here.
The simulator ShramkoGSFPV was read at `v13-host` d75bf84 (its Winter Garden track and track check), read only.
Nothing pushed and nothing fixed: every file broken on purpose was restored by hand and the tree compared clean with
`git status` after each; the probes ran from a test file and from a copy of 16c01a1's sources in a gitignored folder,
both removed afterwards; this file is the review's only commit.

## Verdict

**Up and down by direction is done as asked: with the setting off every plan is v0.13's, with it on only the cues of
up and down move and every note stays. The wrong way between gates needs one change before the simulator takes it
(E1): in free-garden, the last lesson of both paths, on its Winter Garden track, it tells "You are flying back" after
a correct pass.**

- The setting off is v0.13 exactly: the placement fixture re-derived here from 16c01a1's own planner gives the
  fixture's seven hashes, and 79,912 frames of truth flights through the 23 analytic flying lessons (soft and race),
  planned in lockstep by 16c01a1's planner and by this one, differ in 0 frames.
- The setting on, in the same frames: only the open-way chime above and below (in flight, its active cue, and
  tunnel-gaps' six plays) and the target note's direction move; the floor and the ceiling keep their direction and get
  the breath; no other voice, cue or note moves.
- The length fixtures and the words check are real measurements: 12 lines measured again with the fixtures' own
  script and voices give their lengths to the millisecond; the evidence of `pnpm listen` and `pnpm listen:words` is
  fresh for this tree.
- What is not right: a false "wrong way" after a hairpin (E1), something new at the start of every attempt (E3), the
  lines with the setting off (E2), what the words check's bound and the rig's renders can show (E4, E5), small things.

## Findings

| Id | Severity | Where | What |
|---|---|---|---|
| E1 | major | `src/lesson/runner.ts:1053-1055`, `:1065-1071` | after a hairpin the new rule tells "wrong way" in a correct flight: free-garden, right after ring 4 |
| E2 | minor | `locales/*.json`: `cue.safety.free.glossary`, `lesson.corridor.intro.3`, `lesson.tunnel-gaps.intro.3`, `menu.setting.height-direction-what` | with the setting off the lines say "from above" while the chime comes from ahead; the setting's description says it moves the floor and the ceiling, which it does not |
| E3 | minor | `src/lesson/runner.ts:1068` | something new at the start of every attempt: backing away from gate 1 is told now, and no test holds either behaviour |
| E4 | minor | `tools/listen-words.ts:215`, `:226`; the key lines of es, pl, ru | the words check's bound lets through the defect it found, its control does not test the bound, and nothing in `pnpm test` holds "the key" |
| E5 | minor | `test-audio/page/listen.ts:249`, `tools/listen/measure.py:261-371`, `docs/dev/status-v0.13-elev.md:209` | VL-6 and VL-2 render no chime, floor or ceiling, so they say nothing of those breaths; the doc says they do |
| E6 | nit | `src/audio/engine.ts:61`, `:63`, `:925` | the target panner's two timings have no measurement |
| E7 | nit | `CHANGELOG.md:46`, `docs/dev/status-v0.13-elev.md:170-173` | rings-course's legs and line-up distances are left out of the numbers |
| E8 | nit | `src/lesson/runner.ts:1065-1068` | the leg to gate 1 of a second lap, and the leg of a course out of order, are not the leg flown |

### E1, major. After a hairpin the new rule tells "wrong way" in a correct flight

- What: the line-up distance now follows the leg, and flying back is flying against the leg along the floor. Where a
  course turns back more than 90 degrees after a gate, the craft that has just passed it is already further than the
  line-up distance in front of the next gate, and its own momentum along the gate's axis is against the new leg, so
  the one-second timer starts at the pass. free-garden (the last lesson of the fast path and of the full path) flies the
  simulator's only track, the Winter Garden ring track (`apps/fly/public/sonic/tracks/7a475d38-rings-v1.json`, scaled
  5 times), which turns 134.6 degrees from ring 4 to ring 5; the simulator's own track check reports it (`axisOutDeg`
  134.5) and allows it by design ("after a gate the course may turn back"). At ring 4 the craft is in front of ring 5
  and 6.0 m from it, beyond its line-up distance of 3.44 m.
- Measured: the runner with the track's gates and start as the simulator hands them over; a pilot flies from 3 m
  before each ring straight on through it to some distance past it at a steady speed, then on to the next ring. Told
  "You are flying back. Turn around." right after ring 4 whenever it carries on more than a second: 1.5 m past at
  1 m/s, 2 m at 1.5 m/s, 2.5 m at 2 m/s, 4 m at 3 m/s. With v0.13's rule (`testHooks.lineUp 'fixed'`) the same
  flights are told only at 4 m and 1 m/s (beyond 8 m from ring 5), never at 1.5 to 3 m/s within 4 m. At the pass
  ring 5's hum jumps behind the pilot; a beginner by ear needs a moment to hear it, brake and turn. The cue comes from
  ring 5, and "turn around" is good advice there, but "you are flying back" is false: he is carrying on out of a
  correct pass.
- Why no test saw it: the lane's "never told in a correct flight" flies the eight analytic gate lessons, whose legs
  turn at most 15 degrees (measured here); free-garden is flown only over the straight stand-in gates of
  `test/pass-rule.test.ts`.
- Fix: judge flying back on a leg only once the craft has gone along it (its velocity along the leg above
  `WRONG_WAY_MPS` at least once since the gate before was passed, or since the attempt began for the first leg). A turn
  back after progress is told as now; momentum carried out of a hairpin is not; E3 goes away with it. Test in
  `test/direction.test.ts`: a course with a hairpin (the Winter Garden's eight gates as a fixture, or two gates side by
  side facing opposite ways), carried 2 s past the gate before the turn: never told; control: the present rule tells
  it; the lane's turn-back tests unchanged.

### E2, minor. With the setting off the lines describe the setting on

- The setting is there for the pilot who does not want up and down by direction. With `heightDirection: false` the
  chime of a way above or below, and its three plays each in tunnel-gaps' intro.3, come from straight ahead
  (`FREE_DIRS`, `src/cues/planner.ts:547`; check 2: v0.13 exactly). The glossary ("From above, notes moving like your
  height tone in a climb: the way is above. From below, the other way: below."), the corridor's intro.3 ("They come
  from where the way goes on: left, right, above or below.") and tunnel-gaps' intro.3 ("the chime comes from above ...
  from below") say otherwise, in all four languages, and `test/named-sounds.test.ts` forbids "from ahead" in them.
- `menu.setting.height-direction-what` ("The way above or below an obstacle, the target height note, the ceiling and
  the floor also come from above or below you.") tells the pilot that the setting moves the floor and the ceiling. It
  does not: they come from below and above with it off too (`hazardVoice` keeps the sampler's `h.dir`;
  `test/elevation.test.ts:268` holds it); only their breath goes.
- Fix, in four languages with the English measured into the fixture: lines that hold either way, the pitch first and
  the direction as the setting's, e.g. the glossary "...Notes moving like your height tone in a climb: the way is
  above; the other way: below. With the sound from above and below on, they also come from there.", tunnel-gaps'
  intro.3 the same; and the description says what off does: "...With it off, a way above or below comes from ahead and
  only its pitch tells it; the floor and the ceiling still come from below and above." The test then asks for the
  setting's words wherever a line places the chime above or below.

### E3, minor. Something new at the start of every attempt

- The first leg runs from the lesson's start (`runner.ts:1068`), and every attempt begins there, the whole leg (5 to
  6 m) in front of gate 1 and beyond its line-up distance (2.86 to 3.43 m). A pilot who backs straight away from gate 1
  at the start (1 m/s for 2 s) is told "You are flying back. Turn around." in all eight analytic gate lessons; v0.13 in
  none (within 8 m). A pilot who backs away still faces the gate, so "turn around" is wrong for him. Holding still 3 s
  at the start is never told, in every lesson.
- The lane's doc does not mention it, and no test holds either behaviour: the first leg measured from gate 1 itself
  (v0.13's 8 m there) passes all 1138 tests.
- Fix: decide it. The progress rule of E1 gives v0.13's behaviour back at the start (no progress yet on the first
  leg); either way a test at the start of an attempt (hold; back away) with its control.

### E4, minor. The words check: its bound, its control, and the wording it found

- The bound is 0.2 a line in every language (`tools/listen-words.ts:215`), met by every line after 56 recorded words;
  the worst Spanish, Polish and Russian lines are at 0.20 exactly, so the bound is the worst line. The design's VL-4
  asks that Whisper find every word of the caption (at most 2 % per lesson). The control (`:226`, the Russian lines
  said by the English voice) fails at a median rate of 1: it shows the round trip works, not that 0.2 catches what a
  pilot would mishear.
- The defect the check found, a key's name run into the verb ("Pulsa T para" heard as "Púlsate para"), costs two
  errors. Of v0.13's 17 key lines, 7 in Spanish, 5 in Polish and 5 in Russian have 10 words or more and stay at or
  under 0.2 with the key lost (`rec.ask`, 24 words in Spanish: 0.08). Under the bound now: Russian `fly.progress`
  "Засчитано 1 из 3" heard as "Защита на один из трёх" (counted as protection, 0.17) and Polish
  `lesson.shapes-cube.intro.3` "zapytam cię" as "zapytamy rykcie" (0.18); at the bound, Russian `reason.height-high`
  and `reason.height-low` only for Whisper's percent sign (English and Spanish have a record for it, Polish and Russian
  do not).
- Nothing in `pnpm test` or the locale lint holds the fix: the Spanish `help.record` put back to "Pulsa {key} para..."
  passes all 1138 tests and the lint; only a new `pnpm listen:words` run would see it, and only because that line is
  short.
- Fix: a Node test that every es, pl and ru line with `{key}` or `{skip}` has "la tecla", "klawisz" or "клавишу" right
  before it, v0.13's texts as its control; in the words check a rule for the key itself (its letter heard as a word of
  its own in each line that names one), v0.13's key lines said by their voices as its control; the percent records for
  Polish and Russian.

### E5, minor. VL-6 and VL-2 do not hear the new breaths of the chime, the floor and the ceiling

- VL-6-speech, VL-6-peak and VL-2-motor are measured on the rig's `flight` renders (`measure.py:261`, `:286`, `:341`,
  `:365`): rings-first at 2.4 to 3 m, then a run at a wall. Their truth (inputs ee49704722ea) has hazards in the front
  and front-left sectors only and not one frame of the open-way chime; the climb renders the height layer alone. Only
  the target note's breath is in them. The doc (`status-v0.13-elev.md:209`) says the eight checks "hold on the new
  engine (the target note panned and with its breath, the floor and ceiling with theirs)".
- The levels make a failure unlikely (the breath is -10 dB against a unit fundamental, 8.6 dB under the chime's own
  total), but it is not measured.
- Fix: in VL-6 and VL-2 a scenario with the floor and the ceiling near (walls-hall low, then high) and one with the
  chime (a tunnel-gaps obstacle), each under a spoken line and the motor; or the doc says only the target note was
  covered.

### E6, nit. The target panner's two timings have no measurement

`HRTF_ONSET_S` (the height tone comes back 6.5 ms after a placed note, so the two never sound together) and
`TARGET_PAN_LEAD_S` (the panner moves 60 ms before the note, past Chrome's crossfade): both set to 0, all 1138 Node
tests pass, and no check of the rig measures the gap (VL-3-height measures the modulation inside the plain tone and
inside each note). AGENTS.md asks a measurement with a negative control for every claim about sound: a proof that
renders one placed target note over the height tone and measures their overlap above -60 dB, 0 ms as its control.

### E7, nit. rings-course left out of the numbers

The CHANGELOG ("2.9 to 3.5 m in the v0.13 rooms") and the doc ("every leg of the v0.13 rooms is 5 to 6.2 m", "3.43 to
3.53 m for the others") leave out rings-course: legs 6.0, 6.10, 7.05, 6.46, 6.57 and 7.05 m, line-up distances 3.43 to
4.03 m (the runner's own comment says 4 m for its 7 m legs).

### E8, nit. Legs the pilot does not fly

`legTo` takes the gate before in course order, or the lesson's start for the first gate. In a course of two laps or
more (a track file allows 1 to 99) the leg to gate 1 of the second lap is measured from the start, not from the last
gate; in `pass-gates` with `inOrder: false` the gate before in course order is not where the pilot comes from. No
shipped lesson has either (free-garden flies one lap, every course is in order); worth a line when laps come.

### Observations, no change asked

- By the localization model the lane ran outside the repository (`baumgartner2014`), a chime below is heard above by
  most heads with the direction (58.9 % at -30 degrees) and without it (66.6 %): the direction is a weak second cue,
  as the lane says, and the pitch carries it. Testers decide.
- In flight the chime comes from 8 to 20 degrees up or down (Chrome's 15 degree slices); the named plays and
  VL-1-elevation are at 30 degrees (the 30 degree slices). The plays teach a colour the flight does not have; plays at
  the elevation tunnel-gaps' ways really have (median 13 degrees) would teach the flown one. The owner's call, with
  the exaggeration the lane leaves open.
- The floor and the ceiling now share one breath, so their timbres (one of the design's channels of up and down for
  hazards) are a little closer, and the floor's "low, soft thud" carries a hiss; VL-3 is not built. For testers.
- The target note from a gate's centre carries the gate's left, right and behind as well: its real direction, as asked.
- The truth bot's line in rings-small flies back 3 m between rings (4 m past one, 4 m before the next): flown at 1 m/s
  or slower it is told three times (v0.13: never). The lane notes the 0.46 s margin at 2.5 m/s; the bots' "never
  told" holds above about 1.15 m/s on that line. It is not a pilot's line.
- The voice-budget proof's bound went from 32 to 33 panners: the design's one more panner, not a loosening; its
  control still fails.
- `tools/listen-words.ts` repeats the GPU lock's machine default (`<gpu-lock>`), as `tools/listen.ts` and the proofs
  do; accepted at the merge.
- Of the words the voices say otherwise (recorded, not changed: the lane leaves them to a native speaker), the Polish
  "węższy" heard as "wyższy" in all five tunnel lines turns "narrower" into "higher", a height word, in the lessons
  about narrowing tunnels; first on that list, before Russian "гул" as "гол" and "пролети" as "пролейте".
- The replay compares cue ids, not directions, so a 16c01a1 recording of any lesson but the two with new versions
  replays as before although an absent setting reads as on.

## The seven checks

1. Up and down keep their notes and gain their direction; nothing else moves. Three planners in lockstep (16c01a1's,
   this one with the setting off, with it on) over the truth bot's flights of the 23 analytic flying lessons, soft and
   race, 79,912 frames, every frame's cue events given to all three. With the setting on, against off, the only
   directions that change: the chime above and below in the corridor, tunnel-gaps and tunnel-long, its active cues,
   tunnel-gaps' six plays of intro.3, and the active cue `height.target` in every band and gate lesson. The floor and
   the ceiling carry the breath with their direction unchanged (walls-hall 750 voice frames, the ring lessons a few);
   left and right, the hum, the shapes, the walls and every one-off note are untouched. The lane's test of notes,
   periods, levels and rhythm (seven flights) holds here on every lesson. In the engine the target note goes through
   its own panner; its two timings are unmeasured (E6).
2. The setting off is v0.13 exactly. 16c01a1's `src`, `lessons`, `themes` and `locales` (git archive) fly the seven
   placement flights with the lane's own helper: 1044, 1044, 360, 1545, 342, 1728 and 1728 frames, every hash the
   fixture's, so the fixture is v0.13's. In check 1 the setting off differs from 16c01a1 in 0 of 79,912 frames.
3. The high band, VL-6 and VL-2. `pnpm listen` is fresh for these inputs (ee49704722ea), 9 of 9 valid and passing:
   VL-1-elevation 3.57, 3.05 and 4.94 dB (control 0.57 dB, the rule 1 dB), the 16 kHz third octave 11 dB under the
   chime's strongest band with the breath and 58 dB without; VL-6 4.67, 4.60 and 4.80 LU; true peak -6.99 to -3.74
   dBTP; every cue at least 15.0 dB over the motor. Only the target note's breath is in the VL-6 and VL-2 renders (E5).
4. The wrong way between gates. Told after a short turn back in all five courses with more than one gate (2.04 to
   2.51 m, the lane's test; the 8 m rule and the radial rule each fail it, below). Never in the correct flights of the
   eight analytic gate lessons (truth bot, imperfect pilot); the truth line flown slower is told only in rings-small at
   1 m/s and below (observations). Told in a correct flight of free-garden on its real track (E1). New at the start of
   an attempt: backing away is told; holding still is not (E3).
5. The lines. Every new and changed line read in en, es, pl and ru: they say what the sound does with the setting on
   and read naturally ("la tecla", "klawisz", "клавишу" included); with it off three of them do not, and the
   setting's own description claims the floor and the ceiling (E2). walls-pillar's
   intro.3 is right: its pillar stands floor to ceiling (3.2 m), and flying straight at it from 0.6, 1.5 and 2.4 m up,
   on its axis and 0.3 m to either side, finds the way on the left or the right only.
6. The fixtures and the round trip. Three lines a voice (David, Helena, Paulina, Irina) measured again with
   `measure-tts.ps1`'s method: the fixtures' lengths to the millisecond; each fixture holds exactly the lines without
   parameters (its test). The words evidence's key is this tree's inputs (00c1d278316c): valid, passing, the control
   failing (525 of 526 lines over the bound). The bound and the control are E4.
7. The public tree. The added lines of the 19 commits: no build-machine folder but the GPU lock's default in
   `tools/listen-words.ts` (observations), no key, token or password, no personal data; the evidence holds no local
   path; the new Python pins `httpx2` and `httpcore2` are huggingface_hub 2.4.0's own dependencies (its package
   metadata); every commit ends with its Co-Authored-By line.

## Rules broken on purpose

Each was put in by hand, the targeted test files or the whole suite run, and taken out again; the tree was clean after
each.

| Rule broken | Tests that failed |
|---|---|
| the setting off places the chime above and below anyway | 6: `elevation.test.ts` (tunnel-gaps soft and race, both previews, the breath), `freeway.test.ts` (up and down from ahead with it off) |
| a prefs document without the setting reads as off | 1: `elevation.test.ts` (absent: on) |
| the chime from the probe point, not the way's middle | 6: `elevation.test.ts` |
| the band's target ahead mirrored left for right | 1: `elevation.test.ts` (hover-height, headings -60 to 90 degrees) |
| the breath on walls too | 1: `elevation.test.ts` |
| the line-up distance 8 m whatever the leg | 6: `direction.test.ts` (five turn-backs, `lineUpM`) |
| flying back judged toward the gate, v0.13's way, with the scaled distance | 1: `direction.test.ts` (rings-small, review R1's flight round ring 2) |
| the Spanish glossary "De frente" again | 1: `named-sounds.test.ts` |
| `heightDirection` required; a Polish length dropped from its fixture; the "height tone" record dropped (together, each caught by its own test) | 20 in 7 files: prefs and the recorded packages without the setting (replay, session, report); `lesson-schedule.test.ts` (each fixture holds every line); `words.test.ts` (the evidence scored again) |
| the first leg from gate 1 itself (v0.13's 8 m there) | none of 1138 (E3) |
| `HRTF_ONSET_S` 0, `TARGET_PAN_LEAD_S` 0 and the Spanish `help.record` without "la tecla", together | none of 1138; locale lint 0 problems (E4, E6) |

## What I ran

- `pnpm typecheck`: clean. `pnpm test`: 49 files, 1138 tests, all pass (20 s). Locale lint: 0 problems, 526 keys.
  Layout check: 0 problems. `pnpm listen`: fresh for these inputs, nothing to run. `pnpm proof:audio` and
  `pnpm listen:words` not run again: none of their inputs changed since their evidence.
- Probes (a test file in this tree, removed after): the placement fixture re-derived from 16c01a1's sources; the
  three planners over every analytic flying lesson; free-garden over the simulator's track at four speeds and seven
  distances carried past each ring, with its control; the start of an attempt in the eight gate lessons; the truth
  line at lower speeds; the legs and turns of every course; walls-pillar head-on; v0.13's key lines counted against
  the bound; 12 lines measured again with the local voices.
- The rules broken on purpose above.

Not checked: how any of it sounds to a person (the direction, the breath, the target note away from the height tone);
the simulator with this branch; the localization models (not runnable from the repository); the Spanish, Polish and
Russian lines with a native speaker.
