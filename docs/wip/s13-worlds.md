# Lane s13-worlds: rooms, tunnels and rings at the scale of a micro drone (v0.13, owner's message 41)

Plan: ShramkoGSFPV `docs/wip/v13-plan.md` (items M41-18, M41-20 world side, M41-21, M41-22). Branch `s13-worlds`,
worktree `C:/dev/sonic-s13-worlds`, from lane s13-lessons at `eee530b` (lesson format 2, its pass rule, progress view,
navigation and truth bot `test/helpers/truth.ts`). No push. Every step one commit with this Status in it.

## Status

- [x] 1. Lane doc: ownership, facts with file:line, the seconds-to-wall table of v0.12
- [x] 2. Versions that keep old recordings: every generator builds every version it published
- [x] 3. The hollow for the simulator: the cavity boxes in the analytic world
- [x] 4. The world's checkpoint list (M41-20)
- [x] 5. Micro-drone scale (M41-18): version 2 of the room generators, the lessons' world, start and assists
- [x] 6. Tunnels (M41-21): corridor version 2 and the tunnel lessons
- [x] 7. Rings at different heights (M41-22): the heights parameter and lesson rings-heights
- [x] 8. All checks, final status (below: Final status)

Review fixes (`docs/wip/s13-worlds-review.md`; what was done and why: "Review fixes" below):

- [x] B1. The tunnels' free sides exported as `OBSTACLE_FREE_SIDES` / `ObstacleFreeSide` (no clash with lane s13-sound)
- [x] M9. Every tunnel obstacle blocks the centre line by 0.2 m or more (the long tunnel's free ways 0.7 m)
- [ ] M3. rings-heights: no height passes rings of two levels
- [ ] M1, M2, M8. The corridor's last goal, the tunnels' lesson checkpoints, `track-end` at the merge
- [ ] M5, M7, m1, m2, m3. walls-hall's words and stop distance, the new lessons' layers, wording
- [ ] m4, m5, m7, M4, M6. AGENTS.md, this doc, the merge notes
- [ ] All checks, final status

## Ownership

Mine: `src/world/*`, the lesson files' `world`, `start` and `assists`, new lesson files, generator goldens and digests,
`docs/wip/s13-worlds.md`, the tests and helpers I add (`test/world-*.test.ts`, `test/helpers/reach.ts`,
`test/helpers/new-lessons.ts`, `test/fixtures/v012-*` of worlds and lessons). Additions only in `src/contract.ts`.
Not mine: the runner, goals, pass, intro, speech, the meaning of the lesson files' `checkpoints` (lane s13-lessons);
cues, sense, theme, audio and the lesson files' `layers` (lane s13-sound). Edits outside this that cannot be avoided
(registering new lessons, numbers in lesson files that follow the geometry) are additive and listed under "For the
lead's merge".

## Facts (v0.12 as shipped, sound repo `main` 7d4b4b9; base `eee530b` has the same worlds)

### F1. Generators and versions

- `src/world/generators.ts:17-25` `GENERATOR_VERSION`: all seven generators at 1. `PARAM_SCHEMAS` (95-137) is one
  schema per generator, no version in it. `resolveParams` (140-176) fills the defaults, sorted by name.
- `src/world/analytic-world.ts:55-57` throws `WorldSpecError` when `spec.version !== GENERATOR_VERSION[generator]`,
  so a bump of a version without a dispatch makes every v0.12 spec of that generator unbuildable.
- The digest (`analytic-world.ts:59-61`) is SHA-256 of the canonical JSON of `{ generator, version, seed, params }`
  with every default filled in; the world id is `<generator>-<digest[0..8]>` (160). A v0.12 session manifest keeps
  that id as `scene.id`; the simulator names a lesson's walls by the digest (`lesson-world.ts:80`, the flight log's
  `collisionSha256`), so a log replays only on walls of the same digest (`apps/fly/src/session/replay.ts:38`,
  "flown on other walls").
- The replay rebuilds a lesson's world from the CURRENT lesson file (`src/replay/rebuild.ts:78-88`): a lesson whose
  world changed gives the note `world-id`, its version the note `lesson-version` (75); an unbuildable spec throws
  `ReplayError('world')` (86).
- Goldens: `test/world.test.ts:541-587` pin digest, objects and a 600-point field fingerprint of 14 specs.

### F2. Every lesson with an analytic world, v0.12

Seconds at full stick from a hover, by the model in `test/helpers/reach.ts` (an ESTIMATE from the assist's constants:
target speed ramps at 6 m/s^2 to the lesson's cap, the velocity loop 0.4 s over the attitude loop 0.2 s; climb ramps
in 0.25 s, then 0.25 s; `apps/fly/src/play/game.ts:43-47,66`, `play/assist.ts:28`). Distances from the hull
(0.12 m) to the first surface a ray from the start meets. Speed / climb: `assists.maxSpeedMps` / `maxClimbMps`.

| Lesson | World (v1) | Start | Speed / climb | Ahead | Left | Right | Ceiling |
|---|---|---|---|---|---|---|---|
| hover-height | open `startHeightM 1` | (0, 1, 0) | 0.5 / 1 | none | none | none | none |
| hover-turn | rings single, `offsetXM -25`, `aheadM 3`, hall 60 x 160 x 20 | (0, 3, 72) | 0.5 / 0.5 | 304 s (152 m) | 60 s (30 m) | 60 s | 34 s (17 m) |
| move-speed | open, zone 14 m ahead, 16 m | (0, 1.5, 0) | 3 / 1 | none | none | none | none |
| move-stop | open, zone 30 m ahead, 6 m | (0, 1.5, 0) | 4 / 1 | none | none | none | none |
| walls-hall | hall 40 x 60 x 12 | (0, 1.5, 0) | 3 / 1 | 10.8 s (29.9 m) | 7.5 s (19.9 m) | 7.5 s | 10.8 s (10.4 m) |
| walls-pillar | pillars single, 15 m ahead, hall 40 x 60 x 12 | (0, 1.5, 22) | 3 / 1 | 5.6 s (pillar, 14.4 m) | 7.5 s | 7.5 s | 10.8 s |
| walls-row | pillars row of 5, gaps 6 m, 15 m ahead | (0, 1.5, 22) | 3 / 1 | 5.6 s (pillar-3) | 7.5 s | 7.5 s | 10.8 s |
| corridor | corridor full, `straightM 50`, 5 x 4 m | (0, 2, 0) | 3 / 1.5 | 22.3 s (pillar, 64 m) | 1.6 s (2.4 m) | 1.6 s | 1.6 s (1.9 m) |
| rings-first | rings single, 12 m ahead, size 3 | (0, 3, 72) | 3 / 1.5 | 51 s (wall through the ring, 152 m) | 10.8 s (29.9 m) | 10.8 s | 11.6 s (16.9 m) |
| rings-line | rings line of 3, spacing 14 | (0, 3, 72) | 3 / 1.5 | 51 s | 10.8 s | 10.8 s | 11.6 s |
| rings-small | rings line, sizes 3 2 1.5 1, spacing 14 | (0, 3, 72) | 2.5 / 1 | 62 s | 12.8 s | 12.8 s | 17.3 s |
| rings-course | rings course of 6, spacing 16, seed 7 | (0, 3, 72) | 4 / 1.5 | 39 s | 8.4 s | 8.4 s | 11.6 s |
| shapes-square | squares single, 12 m ahead | (0, 3, 72) | 3 / 1.5 | 51 s | 10.8 s | 10.8 s | 11.6 s |
| shapes-series | squares turn of 4, 40 degrees, spacing 14 | (0, 3, 72) | 3 / 1.5 | 51 s | 10.8 s | 10.8 s | 11.6 s |
| shapes-cube | cube-frames single, 12 m ahead | (0, 3, 72) | 3 / 1.5 | 51 s | 10.8 s | 10.8 s | 11.6 s |

Thing to thing (the start to the first gate, gate to gate, the last gate to the far wall): hover-turn's ring 25.2 m
away is 51 s at its cap; rings-first 4.9 s to the ring, then 47 s to the wall; rings-line 4.9, 5.5, 5.5, 38 s;
rings-small 5.6, 6.4, 6.4, 6.4, 40 s; rings-course 3.9 to 5.0 s per leg, 17.8 s after the last; shapes-series 4.9,
5.5, 5.5, 5.5, 11.4 s; walls-pillar and walls-row 5.6 s to the pillars, 13.1 s from them to the far wall. Zones:
move-speed's near face 2.8 s (centre 5.5 s), move-stop's near face 7.7 s (centre 8.4 s). The owner's count of eight
before the wall (message 41) is walls-hall's 10.8 s; the corridor is the only world whose side walls and ceiling are
near.

### F3. The corridor's checkpoints

`lessons/corridor.json` (v0.12 and `eee530b`): five checkpoints at the starts of the sections (`test/lessons.test.ts`
holds them to the landmarks, 98-102): (0, 2, 0), (0, 2, -50), (0, 2, -80), (45, 2, -125), (45, 2, -200), radius 2.5 m. Along
the track they are 50, 30, 90 and 75 m apart, and the last section (bends with pillars, 90 m) has none: 17.5 to 31 s
of flight between two of them. A touch sends the craft to the last one reached (`onTouch: bump-recentre`,
`src/lesson/runner.ts:633-640`); a failed attempt starts the next one at the lesson's start (`runner.ts:558-562`, every
lesson with a goal other than hold-height, approach-stop or around): the owner's "it throws me far back".

### F4. How the simulator flies, draws and resets a lesson world (ShramkoGSFPV `C:/dev/gsfpv-v03`, read only)

- Collision: `apps/fly/src/sonic/lesson-world.ts:71-84` `buildLessonWorld`: `analyticCollision(bounds, voxelM,
  solidAt, sdf)` (74), a voxel solid when `solidAt` is true at its centre, culled by cells of 8^3 voxels
  (`packages/collision/src/analytic.ts:1-12, 24-30`); the contact world over it (79); the walls' hash is the digest
  (80); the spawn is the lesson's start (81). Every v0.12 world has `voxelM` 0.1.
- The craft's collision: spheres from the drone preset (`packages/sim-core/src/params.ts:276-306`); `boundRadius` is
  the farthest sphere surface. Default preset `pavo20pro-3s` (`apps/fly/src/presets.ts:12`, kept when the mode opens
  a lesson, `apps/fly/src/sonic/feature.ts:180`): four 30 mm duct spheres at 33.1 mm and a 25 mm body, bound 0.077 m.
  Other presets: air65 and meteor65 0.043, pavopico 0.065, pavo20pro2 0.077, machr5sport 0.165, nazgulf5v3 0.186,
  taurusx8-komodo 0.318 m. The package's own craft radius is 0.12 m (`src/lesson/goals.ts:27` `BODY_RADIUS_M`, the
  sampler's `bodyRadiusM`).
- Drawing: `apps/fly/src/sonic/primitives.ts`. The room is the boundary of the hollow, as slabs 0.05 m thick outside it
  (`SLAB_M` 27, `exposedFaces` 268-291, `roomPrims` 315-324); the open world is a floor slab (and a ceiling slab with
  `ceilingM`). The hollow is `cavityBoxes(world)` (215-231): a MIRROR of the generators by name, `corridorCavities`
  (135-208) walks v1's corridor, and every hall-type generator is one box `widthM x heightM x depthM` centred on
  (0, h/2, 0). `tools/bench/test/sonic-primitives.test.ts:83-115` holds the mirror to the package's `solidAt` on 20 000
  points per shipped world (control: the corridor mirrored left for right). Objects (`shapePrims` 72-113): ring as a
  torus, square as four bars, cube frame as twelve bars, pillar as a cylinder, box as a box, zone as its twelve edges.
- Reset (`apps/fly/src/sonic/mode.ts:238-268`): R short = the runner's `reset('checkpoint')`, held = `reset('start')`;
  the pose goes to `place()`: the session's spawn moves there and `respawnStart()` makes a logged 'manual-start'
  respawn onto the respawn platform (a one-way disc, `bridge.ts:67-71`). The runner's checkpoint is the last of the
  lesson file's checkpoints reached within `radiusM` (`runner.ts:642-648`), else the start (`runner.ts:1198-1203`).
  The runner's `place` actions (touch with bump-recentre, a new attempt) take the same path (`lessons.ts:319-320`).

## Done

### Step 2: versions that keep old recordings

- `src/world/generators.ts`: a version table per generator (schema and builder per version). `GENERATOR_VERSIONS`
  lists every version this build builds, `buildsVersion()`, `paramSchema(generator, version)`; `resolveParams`,
  `buildWorld` and `makeSpec` take an optional version (default `GENERATOR_VERSION`, which stays 1: see step 5),
  `PARAM_SCHEMAS` stays the default versions' schemas. `createAnalyticWorld` builds the spec's own version and refuses
  only a version this build lacks: "generator 'hall' builds versions 1, 2 here, the spec asks for 99" (the replay
  passes it on as `ReplayError('world')`).
- Version 1 moved unchanged to `src/world/v1.ts` (the builders byte for byte; parameters `src/world/params.ts`, shared
  helpers `src/world/build.ts`). Its goldens in `test/world.test.ts` are untouched and pass.
- Fixtures written by the v0.12 build itself (sources of 7d4b4b9 under `U:/Temp`, its own test host):
  `test/fixtures/v012-worlds.json` (the 15 v0.12 lessons with an analytic world: spec, id, digest, objects and field
  fingerprint), `test/fixtures/v012-session-walls-hall.zip` (a session it recorded on walls-hall) and
  `test/fixtures/v012-lesson-walls-hall.json` (that lesson file as v0.12 shipped it).
- Tests (`test/world-versions.test.ts`): every v0.12 spec gives its v0.12 id, digest, objects, bounds and field; the
  v0.12 recording rebuilds on its own walls with its own lesson (world id = recorded scene id, the same field, no
  `world-id` note, its first goal met when it was recorded); with the shipped lesson it is reported "not the
  recording's own build: lesson walls-hall is version 2 here, the session was flown with 1" (and `world-id` once the
  shipped world differs); a spec of version 0, 99, 1.5 or -1 fails with the versions this build has, in the world and
  in the replay. Controls: walls 1 cm off fail the digest and field comparison; the recording on other walls (a hall of
  200 x 200 m) does not meet its first goal when it was recorded.
- What does not verify, and why: replayed with its own v0.12 lesson, the events after the first attempt differ ("fly.progress",
  the next attempts): lane s13-lessons changed the pass rule and the lines (their doc, step 2: "it does not verify, by
  design"). The walls are the same walls.

### Step 3: the hollow for the simulator

- Contract (added): `CavityBox { cx, cy, cz, hx, hy, hz }` and `AnalyticWorld.cavities?: readonly CavityBox[] | null`
  (optional in the contract so an older package's world still compiles; always set by this package).
  `AnalyticWorldInfo.cavities: readonly CavityBox[] | null`: the boxes whose union is the room's free space, the shell
  exactly (objects not included), null for the open world (its shell is the ground and an optional ceiling slab). Taken
  from the shell itself (`cavityShell` keeps a copy of its boxes, `src/world/parts.ts`), so every generator and version
  gives them without a line of any builder changing; the world hands out a copy.
- Test (`test/world-cavities.test.ts`, 40 worlds: every shipped lesson, every generator at every version with its
  defaults and each of its layouts): on 20 000 random points of the bounds per world (points within 3 mm of a box face
  and within an object's bounding sphere left out, at least 8 000 checked), a point inside a box is free and one outside
  every box is solid; the open world has none. Control: the first box moved by 0.5 m disagrees on more than 20 points in
  walls-hall and in the corridor.

### Step 4: the world's checkpoint list (M41-20)

- Contract (added): `WorldCheckpoint { pos: Vec3; dir: Vec3; stage?: number }` and `AnalyticWorld.checkpoints?: readonly
  WorldCheckpoint[]`, the shape lane s13-lessons feature-detects (`test/helpers/truth.ts` `worldTrack`). Present for
  every world with a track (corridor, rings, squares, cube-frames, every layout and version), absent for open, hall
  and pillars. `pos` is on the track's centre line at flying height (through the free way past an obstacle); `dir` is
  a HORIZONTAL unit vector, the track's heading there (a corridor's heading, a gate's pass direction, a leg's
  direction), so a respawn can face it even where the track climbs; `stage` = k on the checkpoint that ends stage k.
- `src/world/track.ts`: a builder gives nodes, `densify` adds points so consecutive checkpoints are at most 5 m apart
  (the contract promises 6). Corridors (`corridorNodes`): a corner or a step (jog) is left `half` before it and joined
  `half` after it, so the line between stays in the corner square or the shaft, `half * sqrt(2) / 2` from the inner
  corner; past an obstacle the track moves to the centre of the free way over 3 m per metre of offset, reaches it
  1.5 m before the obstacle's front, keeps it 1 m past its back and comes back. Courses (`gateNodes`): the start, then
  for each gate 1.5 m before it on its axis facing it, and 1 m past it.
- Version 1 of the corridor records its runs and pillars as it walks (no geometry changed: its goldens and the v0.12
  digests pass); the wider gap beside a pillar is the free way. The corridor lesson's world now has 87 checkpoints, at
  most 5 m apart, from the start to the end (the lesson file's five are 30 to 90 m apart, none in the last 90 m).
- Tests (`test/world-track.test.ts`, every shipped corridor and course and every track generator's layouts at every
  version, 16 worlds): no gap over 6 m; the first checkpoint is the world's start; every dir a horizontal unit vector,
  the point 0.5 m ahead along it free, never pointing back along the track; every checkpoint with room for the largest
  drone (0.318 m); the straight line between consecutive checkpoints clear by more than the craft's radius (0.12 m);
  a checkpoint 1.5 m before every gate on its axis, facing it. Controls: a list with a 10 m gap; a dir reversed, one
  into a wall 0.3 m away, one tilted; the corridor's corners joined straight (the line cuts them); a course without
  its approach checkpoints. Golden tracks pin the lists of three version-1 worlds: a change of the track of a
  published version needs a new version, as its geometry does.
- The truth bot of lane s13-lessons now flies the corridor along the world's checkpoints (its `worldTrack`, found by
  feature detection) instead of its own corridor line, and still passes it in exactly r attempts with no touch.

### Step 5: micro-drone scale (M41-18)

- Version 2 of hall, pillars, rings, squares and cube-frames (`src/world/rooms-v2.ts`): ranges down to rooms of a few
  metres (width and depth from 2 m, height from 1.5 m), defaults at that scale (hall 10 x 12 x 3.2; the pillars' and
  gates' rooms just large enough for each of their layouts), the start `startBackM` (1.5 m) in front of the back wall,
  pillars 1 m from the walls (scattered ones 1.5 m apart, 2 m in front of the start), gates 1 m from the walls and
  0.3 m from the floor and the ceiling, and gates at `heights` (step 7's parameter, built here so the version is
  complete: a list of metres or levels floor, middle, ceiling; a new parameter kind in `src/world/params.ts`). The
  hollow is still one box centred on (0, h/2, 0), so the simulator's mirror of the halls stays right for them.
- `GENERATOR_VERSION` (what `makeSpec` writes without a version) stays 1 for every generator: the ears lessons' scenes
  (`src/lesson/runner.ts:1346,1365`) and tests of the other lanes build `makeSpec('hall')` and mean v0.12's 40 x 60 x
  12 hall. `NEWEST_VERSION` names the newest (2 for the five rooms); lesson files always name their version.
- The lessons (world and start; no assists changed: every speed and climb cap stays):

| Lesson | World now | Start | Ahead | Left | Right | Ceiling | Legs (s) |
|---|---|---|---|---|---|---|---|
| walls-hall | hall v2 10 x 12 x 3.2 | (0, 1.5, 0) | 2.81 s (5.88 m) | 2.47 s (4.88 m) | 2.47 s | 1.95 s (1.58 m) | |
| walls-pillar | pillars v2 single, r 0.3, 5.5 m ahead, 10 x 12.5 x 3.2 | (0, 1.5, 4.75) | 2.54 s (pillar) | 2.47 s | 2.47 s | 1.95 s | 2.54, 2.64 |
| walls-row | pillars v2 row of 5, gaps 1.7, r 0.3, 5.3 m ahead, 12 x 13 x 3.2 | (0, 1.5, 5) | 2.47 s (pillar-3) | 2.81 s | 2.81 s | 1.95 s | 2.47, 2.87 |
| rings-first | rings v2 single, 5.5 m ahead, 10 x 12.5 x 5.2 | (0, 3, 4.75) | (through) | 2.47 s | 2.47 s | 1.76 s | 2.68, 2.64 |
| rings-line | rings v2 line of 3, spacing 6, 10 x 24.5 x 5.2 | (0, 3, 10.75) | (through) | 2.47 s | 2.47 s | 1.76 s | 2.68, 2.85, 2.85, 2.64 |
| rings-small | rings v2 line 3 2 1.5 1, spacing 5, gateY 2.5, 9 x 26.5 x 4.5 | (0, 2.5, 11.75) | (through) | 2.56 s | 2.56 s | 2.25 s | 2.8 x 4, 2.76 |
| rings-course | rings v2 course of 6, spacing 7, seed 7, 15 x 43.5 x 5.5 | (0, 3, 20.25) | (through) | 2.77 s | 2.77 s | 1.96 s | 2.43 to 2.69, 2.17 |
| shapes-square | squares v2 single, 10 x 12.5 x 5.2 | (0, 3, 4.75) | (through) | 2.47 s | 2.47 s | 1.76 s | 2.68, 2.64 |
| shapes-series | squares v2 turn of 4, 15 degrees (was 40), spacing 6, 10 x 30.5 x 5.2 | (0, 3, 13.75) | (through) | 2.47 s | 2.47 s | 1.76 s | 2.68, 2.85 x 3, 2.74 |
| shapes-cube | cube-frames v2 single, 10 x 12.5 x 5.2 | (0, 3, 4.75) | (through) | 2.47 s | 2.47 s | 1.76 s | 2.68, 2.64 |
| hover-turn | rings v2 single, the ring 4 m left and 0.5 m ahead (82.9 degrees, was 83.2), 14 x 10 x 5.2 | (0, 3, 1) | hover lesson, 0.5 m/s | | | | ring 4.0 m away (was 25.2) |
| move-speed | open v1, zone 7 m ahead (was 14), 6 m (was 16); fly 4 m first (was 6) | (0, 1.5, 0) | zone's near face 2.13 s (was 2.81) | | | | |
| move-stop | open v1, zone 9 m ahead (was 30), 6 m | (0, 1.5, 0) | zone's near face 2.40 s (was 7.65) | | | | |
| corridor | corridor v1 2.5 x 2.5 m (was 5 x 4), straight 15 (was 50), sections 6 (was 15), steps 1.25, pillars r 0.3 | (0, 1.25, 0) | 7.7 s (pillar, 20.6 m) | 1.13 s | 1.13 s | 1.12 s | a section every 2.85 s |

  "(through)": the ray straight ahead passes through the gate; the legs say what comes ahead (the start to the first
  gate, gate to gate, the last to the far wall). Hover lessons (hover-height, hover-turn: goals hold-height, turn-to)
  fly at 0.5 m/s: a wall 2 to 3 s away would stand 1 to 1.5 m off, inside hover-turn's 3 m ring, so the rule does not
  apply to them; hover-turn's ring is now 4 m away on the same bearing (the runner's turned starts put it in front and
  behind as before). The first room without obstacles, walls-hall (384 m3), is the smallest room of the ladder
  (walls-pillar 400, walls-row 499, the gate rooms 650 to 3589). The corridor is not a room: its side walls and ceiling
  were already near; its sections now come every 2.85 s and its first straight takes 5.8 s (was 17.5 s).
- Numbers of lesson files that follow the geometry, moved with it (their meaning stays lane s13-lessons'): walls-row
  `goals[0].metres` 22 -> 9; move-speed `goals[0].metres` 6 -> 4 (the zone's near face); move-stop
  `intro[0].params.metres` 30 -> 9 (the zone's distance, said aloud); corridor `goals` 50 / 240 -> 15 / 100 (the
  straight, then 115 of the 126 m track, as v0.12 had 290 of 335) and its five `checkpoints` (`at`, `pose.pos`) to the
  new starts of the sections. Lesson versions stay 2 (none released since v0.12, whose recordings are version 1 and are
  reported so).
- Tests (`test/world-scale.test.ts`): every room lesson's walls and legs in 2 to 3 s and its ceiling in 1.5 to 2.5 s;
  walls-hall the smallest room; the zones in 2 to 3 s; hover-turn's ring within 5 m on the same bearing (within 1
  degree); the corridor's sections in 2 to 3 s and its straight under 6 s; the goals follow the corridor's track; the
  truth bot passes each of the 14 changed lessons in at most 2 x r attempts with no touch. Controls: every room lesson
  at its v0.12 size fails the same check (`test/fixtures/v012-lesson-geometry.json`, the v0.12 files' world, start,
  assists and goals); v0.12's walls-hall was as large as walls-pillar's room; v0.12's move-stop zone took 7.7 s,
  hover-turn's ring was 25 m away, the corridor took 5.7 s per section and 17.5 s for its straight.
  `test/world-rooms-v2.test.ts`: version 2 in closed form (the hall's six walls, the pillars' placing and margins, a
  gate 0.3 m above the floor that version 1 refuses, levels and metres, a course that keeps its draws, five ways to give
  bad heights), goldens of nine version-2 worlds and their control.
- Tests of other lanes that flew v0.12's numbers now take them from the worlds (no expectation changed except where a
  number was the room's): `test/runner.test.ts` (zone, front wall, pillar, gap of the row, ring, cube, corridor
  checkpoint), `test/progress.test.ts`, `test/pass-rule.test.ts`, `test/navigation.test.ts`, `test/demo.test.ts` (backs
  off 0.6 s instead of 2 s: the room is 12 m deep), `test/replay.test.ts` and `test/report.test.ts` (the walls-hall
  flight inside the room; rings-course flown at its own cap of 4 m/s instead of 6: at 6 m/s the v0.12 sampler's replay
  agreed on 94.9 % of the frames in the smaller room, under the 95 % rule; at 4 m/s 95.2 %, at 3 m/s 96.1 %).

### Step 6: tunnels (M41-21)

- Corridor version 2 (`src/world/tunnels.ts`; version 1 stays for the corridor lesson): a tunnel `widthM` x `heightM`
  walked in straight runs and 90 degree bends that turn right and left in turn (it zigzags forward, never doubles back),
  layouts `tunnel` (a straight, `bendCount` bends with legs of `segmentM`, a last straight), `gaps` (an obstacle per
  side of `gaps` in the middle of a run of `obstacleRunM`) and `long` (stages: `stageWidths`, `stageBends`,
  `stageGaps`; the last checkpoint of stage k carries `stage: k`). An obstacle is a box (`block-k`, shape `box`, which
  the simulator already draws) that fills the cross section but for a free way `gapM` across, above it, under it, left
  or right of it; it reaches 5 cm into the surfaces it stands on (no face of it lies on a face of the room). New
  parameter kinds: `names` (the free sides, "up,right,down,left") and lists with defaults. Landmarks: `start`, `bend-k`
  (the first point of the leg after a corner), `gap-k` (1.5 m before obstacle k, on its free way), `stage-k`, `end`.
- The lessons (module 4, after corridor, format 2, version 1: new in v0.13; `onTouch: bump-recentre`; required 1):

| Lesson | Tunnel | Cap (m/s) | A turn or obstacle every | Track | Widest sphere on the track | Goal |
|---|---|---|---|---|---|---|
| tunnel-wide | 3 x 3 m, 4 bends, legs 6 m | 3 / climb 1 | 2.85 s | 32.5 m | 1.08 m | fly 29 m |
| tunnel-narrow | 1.8 x 2 m, 4 bends, legs 5 m | 2.5 / 1 | 2.80 s | 27.9 m | 0.63 m | fly 25 m |
| tunnel-narrower | 1.2 x 1.8 m, 4 bends, legs 4 m (voxel 0.05) | 2 / 0.8 | 2.76 s | 22.6 m | 0.42 m (corners: 0.6 / sqrt 2) | fly 20 m |
| tunnel-bends | 2 x 2 m, 10 bends, legs 4 m | 2.5 / 1 | 2.40 s | 42.1 m | 0.73 m | fly 39 m |
| tunnel-gaps | 3 x 3 m, free up, right, down, left, gaps 1.2 m | 2.5 / 1.2 | 3.0 s | 35.8 m | 0.60 m | fly 33 m |
| tunnel-long | 2.4 m high, 5 stages | 2.5 / 1.2 | 2.80 s | 151.7 m (about 60 s at the cap) | 0.34 m (review M9: free ways 0.7 m) | fly 148 m |

  The long tunnel's stages: widths 3, 2.4, 1.8, 1.4, 1.2 m; bends 2, 3, 4, 4, 6; obstacles 0, 0, 1, 2, 2 (free right,
  up, down, up, down; free ways 0.7 m since review M9, so each obstacle reaches 0.2 m (beside) or 0.5 m (above, below)
  past the middle of the tunnel at flying height; they were 1.0 m, and the first one left the middle open). The
  measure of a stage (taken from the world, not the parameters): d = (1 + turns + 2 x obstacles) / (width / 2 - 0.12 m),
  width the least wall-to-wall distance across its checkpoints: 2.17, 3.70, 8.97, 15.52, 22.92 (s1..s5), and each part is
  no easier than the stage before (width not wider, turns and obstacles not fewer). Margins (the widest sphere that
  follows the whole track, sampled on 52 points of it every 5 cm): the default drone (0.077 m) has 0.27 m to spare in
  the narrowest tunnels (the long tunnel's free ways of 0.7 m since review M9; 0.37 m at the 1.2 m tunnels' corners) and
  the largest preset (0.318 m, an 8-inch X8) 0.03 m; both pass every tunnel.
- The lessons' own checkpoints (the present runner's respawn, M41-20 until lane s13-lessons reads the world's): the
  start, the first point after each bend, 1.5 m before each obstacle on its free way, each stage's start; radius half
  the cross section's diagonal (and 0.6 m more before an obstacle, so a craft not yet off the middle reaches it). The
  world's own track has 11 to 63 checkpoints, at most 5 m apart, the stage ends marked.
- Registered (additive): `src/lesson/library.ts`, `lessons/paths.json` (full: all six after corridor; fast: tunnel-gaps
  only, the one lesson that teaches finding the free way past an obstacle by the open-way chime of M41-14, which no other
  lesson of the fast path has; the others train what the corridor starts), `src/i18n/catalog.ts` and the four locales
  (44 keys each; tunnel-gaps says the chime comes from the free side and a high one means the way is above).
  `order` of every lesson is now its place on the full path (rings-first 13 -> 19 ... free-garden 20 -> 26): the
  simulator's start screen sorts by it (`apps/fly/src/sonic/start-model.ts:40`).
- Tests (`test/world-tunnels.test.ts`): the six on the ladder after corridor, one on the fast path, every order its
  place; wide, narrow, narrower get narrower; a turn or an obstacle every 2 to 3.2 s at the lesson's cap; the goal the
  track's length less under 4 m; the lesson's checkpoints on the track; a flood fill at 0.12 m from start to end and
  the widest sphere over the largest drone; the truth bot passes each in at most 2 x r with no touch; every obstacle
  open on its stated side only (a sphere swept along each of the four strips); the long tunnel's five stage marks, its
  measure and its parts, its widths; the intro's promise; five bad specs refused. Controls: each obstacle grown over its
  free way makes the tunnel impassable to the same flood fill; a stage 3 made wider (2.8 m) fails the measure.
  `test/world-cavities.test.ts` and `test/world-track.test.ts` take every layout of version 2 too (its cavities are the
  shell; its tracks keep the gaps, dirs and free lines).

### Step 7: rings at different heights (M41-22)

- The `heights` parameter of version 2 of rings, squares and cube-frames (built in step 5): levels `floor` (0.3 m plus
  the gate's own vertical reach above the floor), `ceiling` (the same under the ceiling), `middle` (half the room's
  height), or a list of metres; one per gate, the last repeating; with heights the craft starts at the first gate's
  height. A gate may sit exactly at its margin (the fit check allows a nanometre of rounding).
- Lesson `rings-heights` (module 5, after rings-small, before rings-course; format 2, version 1; not on the fast path,
  which keeps rings-first and rings-course): rings v2 `line` of five 2 m rings at middle, floor, ceiling, floor, middle
  (2.5, 1.5, 3.5, 1.5, 2.5 m), 6 m apart, the first 5.5 m ahead, in a room 9 x 36.5 x 5 m; start (0, 2.5, 16.75);
  caps 3 and 1.5 m/s (rings-line's). Legs 2.68, 2.85 (four times) and 2.64 s, side walls 2.3 s, ceiling 1.96 s; each
  height change (1 or 2 m) fits its leg at the climb cap. Layers safety, target, height and voice (lane s13-sound
  tunes them: the target tone of M41-12 is the next ring's centre). Goal: every ring in order; 3 counted attempts.
  Intro (four languages): the rings at the floor, in the middle and under the ceiling; "the gliding one is your height,
  the second, steady tone is the height of the next ring"; "when the two tones sound the same, you are at the right
  height". It does not say "lower means climb": that flips with the pilot's height polarity (prefs), so the hint says
  "move up or down until your tone matches the steady one".
- Tests (`test/world-heights.test.ts`): the place on the ladder; every ring at its asked level, all three levels, a
  span of 2 m and every leg changing the height by at least 1 m (the first at the start's height); every ring 1 m from
  the walls and 0.3 m from the floor and the ceiling; each change fits its leg at the caps and the truth bot passes in
  at most 2 x r with no touch, gates in order; the intro's two promises in English and a translation in the three
  others; the same heights in squares and cube frames. Controls: rings-line's rings are all at one height (span 0); the
  same rings 2 m apart make a climb that does not fit its leg. rings-heights is also a room lesson of
  `test/world-scale.test.ts` (its table inside the rule).

## Review fixes

The review (`docs/wip/s13-worlds-review.md`, at fef8869 and 030f7d0): one blocker, nine majors, seven minors. Each fix
below is one commit; the findings that are other lanes' or the lead's are answered under the merge notes.

### B1: the free sides of a tunnel's obstacles under their own names

`src/world/tunnels.ts` exported `FREE_SIDES` and `FreeSide`, the names lane s13-sound exports from `src/sense/freeway.ts`;
`src/index.ts` re-exports both modules with `export *`, so the merge failed the typecheck (TS2308) and dropped the name.
They are now `OBSTACLE_FREE_SIDES` / `ObstacleFreeSide` (the vocabulary of the `gaps` parameter; nothing outside
`tunnels.ts` used them).

### M9: every obstacle stands in the middle of the tunnel

- Corridor version 2 (unpublished) refuses an obstacle that reaches less than `OBSTACLE_COVER_M` (0.2 m) past the middle
  of the tunnel at flying height (`obstacleCoverM`: beside, half the width less the free way; above, the block's top
  less the flying height; below, the flying height less its underside), naming the obstacle and the widest way it may
  have. A craft flying the middle meets every obstacle, so the open-way chime, which listens straight ahead of the
  nose, hears it.
- tunnel-long's free ways are 0.7 m (were 1.0): the first obstacle (stage 3, 1.8 m wide, free right) now reaches 0.2 m
  past the middle (it stopped 0.1 m short), the four above and below 0.5 m (were 0.2). One width for every obstacle of
  the tunnel keeps the hardest window in the last stages (1.2 x 0.7 m). The default `gapM` is 0.7 (was 1.2, which the
  rule refuses in the default 2 x 2.4 m tunnel) and the default `stageWidths` 3, 2.6, 2.2, 2, 1.8 (a side way of 0.7 m
  needs 1.8 m). tunnel-gaps (3 x 3 m, ways 1.2 m) reaches 0.3 m past the middle at all four obstacles.
- Still true: the truth bot passes tunnel-long at its caps with no touch; the widest sphere along its track is 0.344 m
  (the X8, 0.318 m, still passes; the default drone has 0.27 m to spare); its stages stay each harder; its track is
  151.7 m (was 150.8, the dodges are deeper).
- Tests (`test/world-tunnels.test.ts`): every obstacle of the six tunnels (nine) reaches at least 0.2 m past the line
  down the middle at flying height, measured on the world's own distance field along the run; refused: the long
  tunnel's first obstacle as it was ("reaches 0.1 m short of the middle"), and a way below that comes within 0.1 m of
  the flying height. Control: the review's block-1 rebuilt by hand in a straight tunnel of its stage measures -0.1 m.

## Needs from the simulator

1. Draw the room from the package's boxes (`apps/fly/src/sonic/primitives.ts:215-231`, `cavityBoxes`), and delete the
   mirror (`corridorCavities` 135-208 and the switch by generator name):

   ```ts
   export function cavityBoxes(world: AnalyticWorldInfo): Cavity[] | null {
       return world.cavities === null ? null : world.cavities.map((b) => ({ ...b }));
   }
   ```

   (`Cavity` has the fields of the contract's `CavityBox` and can become an alias of it.) Why: the mirror walks
   version 1 of the corridor and treats every other generator as one box; the tunnels (corridor version 2, step 6) are
   other boxes, so until this switch the helper's view draws walls where there are none and none where there are.
   `tools/bench/test/sonic-primitives.test.ts:83-115` keeps working (it then holds the package's boxes to `solidAt`;
   its left-for-right control stays meaningful). Expected meanwhile, checked here with a copy of the mirror (135-231)
   run against every shipped world of this branch: the six tunnels (corridor version 2) disagree with `solidAt` on
   430 to 4 028 of 20 000 points (the mirror walks them as version 1's `full` corridor: 7 to 23 boxes for 6 to 31);
   every other world agrees on every point and its boxes are equal to the package's (the version-2 rooms are one box
   centred on (0, h/2, 0), the corridor lesson is version 1). So that test fails for exactly tunnel-wide,
   tunnel-narrow, tunnel-narrower, tunnel-bends, tunnel-gaps and tunnel-long until the switch above.
2. Nothing else is needed for the new worlds to fly: the obstacles are `box` objects (`shapePrims` 101-102 draws them,
   the collider takes them through `solidAt`); a respawn at a checkpoint pose in mid air (1.5 m before an obstacle, on
   its free way, up to 2.4 m high) rests on the respawn platform as any start does. Two tunnels name `voxelM` 0.05
   (tunnel-narrower, tunnel-long, for walls 1.2 m apart): `lesson-world.ts:74` builds the collider at it; tunnel-long's
   bounds are 102 x 4.4 x 65 m, 455 000 cells of 8^3 voxels, under `ANALYTIC_MAX_CELLS` (2^25) and the distance cache's
   2^22 (`packages/collision/src/analytic.ts:26-28`); its frame cost is lane v13-look's to measure.
3. The start screen lists 28 lessons (`start-model.ts:40` sorts by `order`, which is now each lesson's place on the full
   path; 7 new: six tunnels in module 4, rings-heights in module 5).
4. The seconds-to-wall table is a model of the lesson pilot (`test/helpers/reach.ts`, from `play/game.ts` and
   `play/assist.ts`); a flight in the page (full stick from the start of walls-hall, time to the first touch) would
   measure it: worth one headless run in wave 2.

## Needs from other lanes

Lane s13-lessons (owner of the strings, goals and the truth bot):

1. walls-hall's title and first line say "The big hall" and "You are in a big, empty hall"; it is now the smallest room
   (10 x 12 x 3.2 m). Proposed English: "A small room" / "You are in a small, empty room. The walls, the floor and the
   ceiling make knocks, thuds and puffs when you come near."; the Spanish, Polish and Russian lines are in this lane's
   report to the lead (this repository keeps every language but English in `locales/`).
2. walls-hall's goal `approach-stop` `stopWithinM: 3` is now 60 % of the room's half width (5 m): two metres of
   flight toward a side wall and a stop pass it. 1.5 m keeps the v0.12 task ("fly to the wall, stop before it").
3. The truth bot's pass-gates flight goes 4 m before and 4 m past every gate (`test/helpers/truth.ts`); with gates 5 to
   7 m apart it flies back between two gates (rings-small: 3 m back, 1.2 s at 2.5 m/s), which a wrong-way rule of more
   than 1 s (M41-15) would hear. The world's checkpoints (1.5 m before, 1 m past each gate) are a track to fly.
4. corridor's `attemptLimitS` 900 s was for a 335 m corridor; the track is 126 m now (about 50 s at 3 m/s).
5. The six tunnels' lesson-file checkpoints (above) are for the present runner; when it reads the world's
   checkpoints (M41-20), keep or drop them. Their intro lines carry no `cues` (format 2 at eee530b has none):
   tunnel-gaps' intro.2 names the open-way chime (`safety.free`, lane s13-sound) for the three plays of M41-5.

Lane s13-sound: rings-heights has `layers` safety, target, height and voice: it is the lesson of the steady target
tone (M41-12); check that the target tone follows the NEXT ring's centre and that the glide meets it in unison there.

Lane s13-sound: the six tunnels have `layers` safety and voice, as the corridor; give them the height layer and the
room bed as every flying lesson (their step 7). The free-way chime has its own lesson now: tunnel-gaps (3 x 3 m, free
ways 1.2 m, as their box tunnels) and tunnel-long (2.4 m high, free ways 0.7 m since review M9: their middles 0.55 m
beside the line, 0.85 m above or below it).

Lane s13-sound: the rings-course replay check now flies at the lesson's cap (4 m/s) and agrees on 95.2 % of the frames
with the v0.12 sampler (side walls 7.4 m away flicker in and out of the three hazard voices); their time-to-contact
rule and `pathMissM` filter are expected to raise it. Nothing to do unless it drops under 95 % after the merge.

## For the lead's merge

- `src/contract.ts`: added `CavityBox`, `WorldCheckpoint`, `AnalyticWorld.cavities?`, `AnalyticWorld.checkpoints?`
  (nothing else changed).
- Lesson files (step 5): `world` and `start` are this lane's; besides them `goals[*].metres` of walls-row, move-speed
  and corridor, move-stop's `intro[0].params.metres`, and corridor's `checkpoints[*].at` and `.pose.pos` moved with the
  geometry (see step 5). Merge by field: lane s13-lessons' `pass`, `intro` (`cues`), `speech`, `checkpoints` meaning
  and lane s13-sound's `layers` do not touch these lines.
- Registering the tunnels (step 6, additive): `src/lesson/library.ts` (six imports and entries), `lessons/paths.json`,
  `src/i18n/catalog.ts` (six `LESSONS` entries after corridor), `locales/{en,es,pl,ru}.json` (44 keys each after
  `lesson.corridor.hint.1`), `README.md` and `llms.txt` (then 27 lessons, a fast path of 8). Not additive but needed:
  the `order` of the eight lessons after corridor (their place on the full path).
- Registering rings-heights (step 7, additive): `src/lesson/library.ts`, `lessons/paths.json` (full, after rings-small),
  `src/i18n/catalog.ts`, the four locales (8 keys each after `lesson.rings-small.hint.1`), README and llms.txt (28
  lessons); the `order` of rings-course to free-garden moved one on (23 to 27).
- Tests of other lanes, step 6: `test/lessons.test.ts` (a lesson new in v0.13 is version 1), `test/pass-rule.test.ts`
  (the v0.12 rules fixture covers the lessons v0.12 shipped), `test/progress.test.ts` (the lesson count from the path);
  the list of new lessons is `test/helpers/new-lessons.ts`.
- Tests of other lanes edited only to take positions from the worlds (step 5 lists them); when lane s13-lessons or
  s13-sound adds a flight with v0.12's numbers (z = 72, -27.5, -55, a zone at 30 m ...), it needs the same treatment.
- `AGENTS.md`: the rule on generators now says version by version (a change is a new version; `GENERATOR_VERSION` is
  only `makeSpec`'s default).

## Final status

Done, one commit per step on `s13-worlds` (base `eee530b`, not pushed): d4876e5 (1, facts), ea90804 (2, versions),
32c2163 (3, cavities), 75140b5 (4, world checkpoints), b56085a (5, micro scale), 8e28b36 (6, tunnels), 5b7c29c (7,
rings at heights), and the commit of step 8 (this status, `AGENTS.md`).

Checks at the end (Node 22.13, pnpm 11.5): `pnpm install --frozen-lockfile`; `pnpm typecheck` (three projects) passes;
`pnpm test` 30 files, 855 tests pass, among them the lesson validation (`test/lessons.test.ts`: every shipped file
valid, canonical, its world built, its start and checkpoints free, its keys in the catalogue), the locale parity and
lint (`test/locales.test.ts`) and the layout check (`test/layout.test.ts`). `node tools/run-tool.mjs check-layout` and
`... locale-lint` cannot run: those two tools export no `main` (they are libraries of those tests), so the tests are
how they run. No browser was needed; `pnpm proof:audio` was not run (no sound changed here).

Left open, with the reason:

- The simulator draws the tunnels wrong until it reads `world.cavities` (Needs from the simulator 1): not this lane's
  repository.
- The runner does not yet use the world's checkpoints for respawn, wrong way and stage praise (M41-20 runner side,
  M41-15, M41-11): lane s13-lessons; until then the tunnels' own lesson checkpoints (bends, obstacles, stages) and the
  corridor's five keep the present respawn near the crash.
- The sounds the new lessons teach (the steady target tone, M41-12; the open-way chime, M41-14) and the new lessons'
  `layers`: lane s13-sound.
- walls-hall's title, first line and stop distance (Needs from other lanes 1 and 2): lane s13-lessons' strings and goal.
- The hover lessons are outside the 2 to 3 s rule (their cap is 0.5 m/s); hover-turn's room is small and its ring 4 m
  away, on the same bearing.
- The seconds are a model, not a flight (Needs from the simulator 4). The tunnels' margins are the widest sphere
  sampled on 52 points along the track; the exact corner clearance of the 1.2 m tunnels is 0.424 m.
- A v0.12 recording rebuilds on its own walls and is reported as flown with lesson version 1; its events after the
  first attempt do not re-derive, because lane s13-lessons changed the pass rule (by design, their step 2).
