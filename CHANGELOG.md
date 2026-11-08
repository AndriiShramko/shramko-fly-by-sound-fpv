# Changelog

## Unreleased

- Lessons a pilot understands the first time (v0.13, the owner's flight of v0.12):
  - Lesson format 2 (`shramko-sonic-lesson/2`, breaking): `pass` is r counted attempts in total (1 to 3, failures in
    between do not reset) and, after `attempts` failures in a row (1 to 3), the reason and the offer of the next lesson
    (a lesson that does not block moves on by itself and is saved as skipped). Format 1 files are migrated on load.
    `intro` lines may name sounds (`cues`: cue ids, or `{ cue, from }` to play one from a side); checkpoints may end
    stages (`stage`). Every shipped lesson is version 2; recordings of version 1 are told apart by the replay.
  - Every sound a step names plays three times, a second apart, after the speech has ended (the runner waits for the
    host's `spoken(t)`): the "press 1, press 2, but no sound" of v0.12 is gone. Progress after every attempt ("Attempt
    k. Counted m of r."), praise, "Better than last time", stages, the next lesson named on a pass; the wrong way along
    a track or to the next gate, and a gate crossed from its back; a touch or a failed attempt in a corridor goes back
    to the last point passed, not to the far start, and every attempt of a course begins at its start (the first one
    too); the target keeps sounding between attempts; the lesson waits while the flight is paused.
  - The sounds with no words of their own are named where a path first meets them, and played three times: the
    target note in hover-height (the fast path's first flight), the open-way chime in the corridor and in tunnel-gaps;
    rings-heights calls the target a short note. The corridor names its stages and the reset after a touch, and the
    end of the corridor and of every tunnel is the fanfare alone: the last checkpoint of a lesson that ends on
    `track-end` no longer chimes half a second before it.
  - Runner API: `next`, `previous`, `repeat` (N, B, Z), `nextLesson`, `previousLesson`, `pause`, `resume`, `view()`,
    `statusLine()`; the action `{ kind: 'go', to }`; options `path`, `speechRate`, `keys`, `returnTo` (a lesson opened
    with G leads back); `lessonAfter`, `lessonBefore`. Contract additions: cue events `repeat-cue`, `praise`, `stage`,
    `wrong-way`, `wrong-side`; `IntroLine`, `IntroCue`, `Checkpoint.stage`, `LessonProgress.skipped`, the goal
    `track-end`. Replay key actions `previous`, `repeat`, `next-lesson`, `previous-lesson`; the replay also takes the
    host's `session` pause and resume events.
- The sounds of v0.13:
  - Height: the height tone glides with the height, never in steps, and a short target note about once a second sounds
    the height to reach (the next gate's centre, else the lesson's band centre), the height tone giving way to it; at
    the target the two are the same pitch. `SonicPrefs.heightTarget` turns the note off.
  - Walls, floor, ceiling and objects are heard by their time to contact (under about 2.5 s, and always within 0.8 m):
    fast flight hears far walls early, a slow or stopped craft does not hear walls it is not closing on; five rays
    along the path tell a collision course.
  - The open-way chime (`safety.free`): when an obstacle ahead is closer than about 3 s, a pair of quick notes repeats
    from the free side; left and right by direction, above and below by contour (like the height tone in a climb, with
    the pilot's height polarity) and, with the item below, from above or below too. None at a gate.
  - Up and down by direction too (lane s13-elev, owner's message 42), on top of the pitch that carries them: the
    open-way chime for a way above or below comes from the middle of that way (`FreeWay.dir`, `middleM`), the target
    note from the next gate's centre or the band's middle 2 m ahead, the floor and the ceiling from below and above as
    before, and each carries a breath of air from 4 to 16 kHz where the HRTF tells height. Notes, intervals and rhythm
    are unchanged. `SonicPrefs.heightDirection` (on by default) turns it off and gives back the placement without it.
    The glossary and the corridor say so in the four languages, tunnel-gaps' intro.3 plays the chime above and below
    (version 2), and walls-pillar names the chime at its pillar in a line of its own (version 3).
  - Event sounds of their own for the wrong way, a gate passed from its back, praise (three figures in turn) and a
    stage (each a step higher); a named sound plays for as long as the runner gives it (`repeat-cue`, `durS`).
  - The motor is on by default and sits under the cues: `engine.motorInput` (a 1.1 to 2 kHz band, levelled, ducked),
    `SonicPrefs.motorGainDb`. Never silence: the height tone and a quiet room bed in every flying lesson, between
    attempts too. The voice sits 3 to 6 LU over the mix, and a local voice of the language comes first.
  - Six new cue ids with names and glossary lines in the four languages: `safety.free`, `safety.wrong-way`,
    `safety.wrong-side`, `height.target`, `target.praise`, `target.stage`; the sound glossary (G) names all 26 cues.
    `engine.plan` gives the host's panel the height, the target and the free way.
  - The virtual listener's first rig, `pnpm listen`: scripted flights rendered through the real engine and measured
    (stems that sum to the mix, the height glide, hazard onsets, the cues over the motor, the voice over the mix), each
    check with a control broken on purpose; its evidence is keyed by the hash of every input.
- Rooms, tunnels and rings at the scale of a micro drone (v0.13):
  - Every world generator builds every version it published (`GENERATOR_VERSIONS`, `buildsVersion`, `paramSchema`,
    `NEWEST_VERSION`), so a recording's walls can always be built again. Version 2 of hall, pillars, rings, squares and
    cube frames builds rooms of a few metres, gates at chosen heights (floor, middle, ceiling or metres); version 2 of
    the corridor builds tunnels (layouts `tunnel`, `gaps`, `long`).
  - The rooms are small: every wall and every leg from gate to gate take 2 to 3 s at full stick, the ceiling 1.5 to
    2.5 s; the first room, walls-hall ("A small room"), is the smallest, and its stop counts within 1.5 m of a wall.
    The corridor is 2.5 x 2.5 m and 125 m long, and ends where it ends (its last goal `track-end`, 350 s an attempt).
  - Seven new lessons: six tunnels after the corridor (wide, narrow, narrower, bends, gaps, long; tunnel-gaps on the
    fast path) and rings-heights after rings-small: 28 lessons, a fast path of 8. A lesson's `order` is its place on
    the full path. The tunnels end on `track-end`.
  - Contract additions: `AnalyticWorld.cavities` (`CavityBox`: the room's hollow, for the simulator to draw it) and
    `AnalyticWorld.checkpoints` (`WorldCheckpoint` `pos`, `dir`, `stage`: the world's track, a point every 5 m or
    less, which the runner follows for the respawn, the wrong way and the stages).
- The replay check has a verdict of its own for a recording of an older build: `ReplayCheck.verdict` ('pass',
  'older-build', 'fail'; `replayVerdict(check)` for a check put together elsewhere) and the line "replay check:
  recorded with an older build (the versions), so this build cannot verify it" when a recording does not re-derive
  and names a lesson or theme version older than this build's, none newer. The same build not re-deriving is still
  FAIL. `ReplayNote` carries `recorded` and `here` for the two version notes; the report's `replayCheck` has `verdict`.
  A frame's touch counts after the points of the track it crossed, so a recording with a touch in the corridor or a
  tunnel re-derives where the live run put the craft back; a host's recorder must keep every sample with a touch as a
  frame, also between two due ones.
- Live in the simulator: ShramkoGSFPV v0.12 (2026-11-08) ships this engine as its submodule at 1eea4d5; the mode starts at https://gsfpv.flyreelstudio.eu/en/sound/ (es, pl, ru too). Ordinary pages of the simulator load none of it.
- Spoken lines asked for by the simulator's recorder: `survey.howto` no longer tells the pilot to say the number (that works only with speech recognition on, now `survey.howto-voice`); new `survey.mic-on` (the microphone stays on during the questions), `send.none` (nothing to send) and `send.cancelled` (not sent, the flight stays on the device). English, Spanish, Polish and Russian.

## 0.1.0-rc1 — 2026-11-07 (tag `stage1-rc1`)

First release candidate of stage 1, not yet built into the live simulator.

- Audio engine: object-based HRTF voices (8 moving, 24 static), pentatonic cues, rhythm on the audio clock, redundant distance code, limiter at -6 dBFS, 1 s fade-in, speech with captions and ducking.
- Cue planner, scene sampler and analytic lesson worlds without a browser, so a replay can re-derive cues.
- 21 lessons in modules 0 to 7 (ears, hover, move and stop, walls, corridor, rings, shapes, free flight) and a fast path of 7; the lesson runner.
- Themes `soft`, `clear`, `race` and a calm preset; strings in English, Spanish, Polish and Russian.
- Session package (`.zip`), replay core and report tool (`pnpm report`).
- Stand-alone demo and Sound Lab (`pnpm demo`), keyboard only.
- Test protocol, consent template and school loudness sheet in `docs/testing` (not legal advice).
- Audio proofs in headless Chrome with negative controls; 577 Node tests.
- Independent review: eight defects found and fixed, see `docs/dev/review-stage-1.md`.
