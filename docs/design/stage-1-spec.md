# Fly by Sound: stage 1 specification

Stage 1 lets a blind or low-vision pilot learn to fly an FPV drone by ear in the ShramkoGSFPV browser simulator, and lets every test flight reach the author with the pilot's spoken comments. Evidence for the choices below is in `docs/research/01..03`.

**Done means:** the owner, sighted, puts on wired headphones, opens the live site, goes through the lessons with his RC radio, closes his eyes and flies three rings in the Winter Garden scan scaled x5. He talks while flying. Afterwards he saves the session on disk and sends it; the package arrives in his Telegram and in his e-mail; at home he replays the flight with his voice in sync.

Later stages, out of scope here but not to be blocked: tracks with generator, timing, rating and editing (stage 2); menus for three kinds of newcomer (stage 3); multiplayer rooms (stage 4); weak devices (stage 5); VR with the head as the drone; a vibration vest.

## 1. Principles

1. **Voice says what it is, music says where it is.** Speech carries meaning; non-speech sound carries position. A full musical language would take as long as a foreign language, so this is a hybrid.
2. **Few streams.** A beginner hears one continuous stream plus one event stream, at most two parameters each. Layers switch on lesson by lesson. Never more than 3 hazard voices.
3. **Harmony, not cacophony.** Every pitched note comes from one pentatonic scale, so any combination stays consonant. "Off course" is roughness on a consonant tone, never a wrong note. This is a hypothesis to test with people.
4. **Danger first.** The safety layer outranks everything and is never masked. Order: safety, next target, own height and speed, ambience.
5. **Rule first, then practice.** Each cue is named by voice and previewed in a glossary before it appears in flight.
6. **The pilot owns the sound.** Each layer has its own volume and pitch control. The polarity "up = higher" can be flipped. A calm preset exists.
7. **No fail state.** A touch is a soft bump and a re-centre, not a crash screen.
8. **Game first.** This is a hobby people choose, not an aid. Nothing here claims therapy or medical benefit.

## 2. Sound language v0

All audio is synthesised in the browser with Web Audio, with no sample files. The drone's body is the listener: positions go to `PannerNode`s in the drone's own frame, with `panningModel = 'HRTF'`, at most 8 moving voices, and the scene yaws at once with the stick, which is how the pilot resolves front from back.

| Layer | Purpose | Sound | Parameters |
|---|---|---|---|
| Safety | walls, floor, ceiling, obstacles | short percussive pulses from the hazard's direction, timbre by class (wall: wood, floor: low thud, ceiling: airy, obstacle: metal) | pulse period follows time to collision (distance when not closing); ping on contact |
| Height | own altitude | one continuous soft tone | pitch by height in scale steps; roughness when outside a lesson's target band |
| Speed | own motion | soft ticks or filtered air | tempo by speed |
| Target | where to go next | low-rich hum from the centre of the next gate, with a melody note | repetition rate rises when close; roughness grows with the off-axis miss; passing plays the next note of a melody, a lap completes it |
| Shape | what an object is | a point source tracing the outline: ring orbits, square has a tick at each corner, cube alternates front and back faces, pillar sweeps vertically | size in space is real, so an object grows around the head as it nears |
| Room | the master plan of the space | bed and reverb send | openness (mean free distance) |
| Voice | meaning | `speechSynthesis` for now, behind an interface so pre-rendered clips can replace it | other layers duck by 12 dB |

Direction: the scene sample uses sectors (front, back, left, right, up, down and four front diagonals), each the minimum of several rays, with hysteresis so voices do not flicker. Elevation over headphones is weak, so height in space is also coded by pitch (above sounds higher), in coarse bands.

Distance is coded redundantly and exaggerated: gentle level slope, reverb send, early low-pass, rising repetition rate, ILD boost under 2 m, own Doppler.

**Themes** are plain data (JSON), so a sound engineer can tune them without code, and a Sound Lab screen exports them: `soft` (default, mallets and pads), `clear` (sines and clicks, parking-sensor style), `race` (short and hard). Every theme uses the same layers.

**Output chain:** master gain, then limiter with a ceiling of -6 dBFS, 1 s fade-in on start, resume and device change. Motor sound off by default in this mode, because it masks cues.

## 3. Curriculum

A lesson is data: world, assists, layers on, spoken intro, goals, pass rule, checkpoints. Every lesson can be opened directly: the ladder is a recommendation, not a gate, because the evidence for the order is thin. Progress is saved, and the pilot hears a short fanfare when a step is passed.

| Module | Lessons | Pass rule (to tune in pilots) |
|---|---|---|
| 0. Ears (before arming) | headphone left, right, behind check; the cue glossary; narrated walls approaching from front, left, right, above, below; ring, square and pillar approaching; the game "what is it, where is it, is it moving" answered by keys or voice | names cues at 90 % in two blocks; the game never blocks progress |
| 1. Hover | height tone, hold a band; turn toward a sound | in band 80 % of 20 s, 4 of 5 |
| 2. Move and stop | speed by tempo; fly 30 m and stop in a zone | 8 of 10 |
| 3. Walls | empty wide hall: approach each wall and stop; one pillar, fly around it, then a row | at most one touch in 8 of 10 |
| 4. Corridor | one long corridor with checkpoints: straight and empty for 100 m, then a simple obstacle, then left-right bends, then up-down bends, then bends with obstacles | 50 m with at most 2 touches, 3 of 4 |
| 5. Rings | one big ring ahead; offset left, right, up, down; 2 and 3 in line; with a turn; smaller rings (3, 2, 1.5, 1 m) | 8 of 10, then 6 rings clean |
| 6. Shapes | square, series of squares, cube frame; name the shape after passing | optional |
| 7. Free flight | Winter Garden x5 with a chain of rings, timed | best time saved |

A fast path of about six lessons (hover, walls, corridor, rings) is offered next to the full path; a test records which path was used, because the owner wants to find out whether the brain learns faster than the ladder assumes.

## 4. World

Sound never reads the renderer. It reads a `SonicWorld`: rays against walls with a material class, plus a list of objects (gates, pillars) with pose, size and order. Two implementations:

- **Analytic lesson worlds** (signed distance functions): hall, corridor with bends, pillars, rings, squares, cube frames. Seeded and deterministic. The simulator renders them as plain primitives on a dark background so a sighted helper sees what the pilot hears, and the collider comes from the same geometry.
- **Scan worlds:** the simulator's existing voxel walls, with gates from a track file.

The **track file** is the seed of stage 2, so keep it general: scene id, scene version, scale, ordered gates with type, pose and size, author, generator info. Never edited in place: a change is a new version.

## 5. Flight

Lessons start in self-levelling with low speed caps and with a pilot-friendly thrust assist; assists are data per lesson and are removed step by step. No arming step for the pilot in lessons. Works with keyboard, gamepad and RC radio; a radio is calibrated once by a sighted helper in this stage. Reset: to the last checkpoint on one key, to the lesson start on a long press; the simulator's existing rewind is reused if it fits.

## 6. Accessibility

Everything works with keyboard or sticks and without a mouse or screen. The start page is plain HTML with real buttons and landmarks. The app speaks for itself; a "my screen reader speaks" switch silences self-voicing for menus and uses `aria-live`. Captions of all speech appear on screen for the helper. Languages: English, Polish, Russian, Spanish; strings live in this repository's `locales/`.

## 7. Session package

Recording is off until the pilot allows it. One key starts it, the app explains by voice, the browser asks for the microphone.

One `.zip` per session, written without a server: `manifest.json` (versions, scene, lesson, theme, settings, device, consent), `flight.jsonl.gz` (30 Hz: time, pose, velocity, sticks, active cues), `events.jsonl` (lesson steps, touches, gates, speech spoken, keys), `voice.webm` (Opus, one clock with the flight), `survey.json`. Chunks go to the browser's origin private file system as they are made, so a closed tab loses at most a few seconds; an unfinished session is offered again next time.

**Replay:** open a package, watch the same flight with the same cues and the pilot's voice in sync. **Report:** a command-line tool turns a package into a timeline and metrics (success, time, touches, path deviation) that a person or an agent can read and that can be joined with a speech transcript.

## 8. Delivery

Not losing a package is the requirement. The client keeps it until the server confirms it. Upload is in chunks with a final hash check. The server stores first and confirms, then delivers to Telegram and to e-mail from a persistent queue with retries. Telegram gets the file (up to 50 MB) and e-mail gets it as an attachment (up to about 20 MB); larger packages go as a link to the owner's admin. Each channel has its own status; if one keeps failing the other channel says so. The pilot hears "delivered" only after both channels confirm. The owner's admin lists sessions with channel status, download and resend.

Sending can be done by a helper, by a key, or by voice ("send it to the author"), using the browser's speech recognition, which is disclosed because it sends audio to the browser vendor. Keys remain the default.

## 9. Survey

Spoken and answered by number keys or by voice into the same recording. Two sets: first flight, and returning pilot. Short: unweighted NASA-TLX, UEQ-S or a smaller set, open questions about which sounds helped or annoyed, and a child-friendly variant read aloud (Again-Again table). The survey can be skipped.

## 10. Safety and privacy

- Loudness: limiter as above, a hearing note, 75 dBA reference for children and 80 for adults, which a page cannot measure, so school devices are calibrated once (`docs/testing/`).
- Wired headphones are recommended because Bluetooth adds 180-250 ms; Windows Sonic or Atmos should be off.
- Voice is personal data. Local recording stays local. Sending requires a separate confirmation, and for anyone under 18 the helper confirms a parent's signed consent. The site's privacy page in all four languages must say what is collected, why and for how long. `docs/testing/` holds a consent template and a test protocol, marked as not legal advice.
- No names are required; a nickname is optional and random IDs are used.

## 11. Repositories

- `ShramkoSonicFPV` (this repository, public): engine, themes, lessons, worlds, session format, report tool, a stand-alone demo page, research, docs. Dependency-free TypeScript. No keys, no personal data.
- `ShramkoGSFPV` (the simulator): adapters to its flight loop, walls and UI, the API routes, the admin. It links this repository so that the link is visible on GitHub, and the README of each names the other.

## 12. Verification

An agent cannot judge how a sound feels. Everything that can be measured is measured: offline rendering with `OfflineAudioContext` proves direction (left is louder on the left), pulse rates, limiter ceiling, voice count; unit tests cover lessons, pass rules and the session format; replay of a recorded flight must reproduce the events. The owner's ears, and later blind testers, decide the rest. Tests that find nothing stay until the end: a branch runs only what its change touches, the full gates run once before release, and long logs go to files.

## 13. Amendments after the code study (2026-11-07)

The simulator's plan (`docs/wip/v12-plan.md` in ShramkoGSFPV, section 6) found nine places where the code differs; these override the sections above.

1. Section 2: the listener uses the heading frame (yaw only, tilt ignored) by default; the body frame is a pilot option.
2. Section 6: this repository's `locales/` holds lesson, cue, survey and spoken strings; the simulator's own menus, key labels, GPU hint, admin and site texts live in the simulator's dictionaries.
3. Section 7: the package may carry an optional `sim-log.json` (the simulator's input log) for exact re-simulation; replay itself plays the 30 Hz track.
4. Section 8: mail attachments up to 15 MB; bigger packages go as an admin link.
5. Section 5: resets use the respawn-to-checkpoint path, not the time-based rewind.
6. Section 4: scans carry no material; scan surfaces are floor, ceiling or wall by surface direction; 'obstacle' is for track objects and lesson worlds.
7. Section 6: there are two start pages: the site's static `/{lang}/sound/` and the simulator's start screen.
8. Done means: Winter Garden's walls are 3.2 cm voxels, 16 cm at x5; a refined grid is shipped if possible.
9. Section 8: for mail, "confirmed" means Gmail's SMTP server accepted the message.
