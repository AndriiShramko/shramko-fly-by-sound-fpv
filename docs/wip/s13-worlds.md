# Lane s13-worlds: rooms, tunnels and rings at the scale of a micro drone (v0.13, owner's message 41)

Plan: ShramkoGSFPV `docs/wip/v13-plan.md` (items M41-18, M41-20 world side, M41-21, M41-22). Branch `s13-worlds`,
worktree `C:/dev/sonic-s13-worlds`, from lane s13-lessons at `eee530b` (lesson format 2, its pass rule, progress view,
navigation and truth bot `test/helpers/truth.ts`). No push. Every step one commit with this Status in it.

## Status

- [x] 1. Lane doc: ownership, facts with file:line, the seconds-to-wall table of v0.12
- [ ] 2. Versions that keep old recordings: every generator builds every version it published
- [ ] 3. The hollow for the simulator: the cavity boxes in the analytic world
- [ ] 4. The world's checkpoint list (M41-20)
- [ ] 5. Micro-drone scale (M41-18): version 2 of the room generators, the lessons' world, start and assists
- [ ] 6. Tunnels (M41-21): corridor version 2 and the tunnel lessons
- [ ] 7. Rings at different heights (M41-22): the heights parameter and lesson rings-heights
- [ ] 8. All checks, final status

## Ownership

Mine: `src/world/*`, the lesson files' `world`, `start` and `assists`, new lesson files, generator goldens and digests,
`docs/wip/s13-worlds.md`, the test helpers I add (`test/helpers/reach.ts`). Additions only in `src/contract.ts`.
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

(filled per step)

## Needs from the simulator

(filled per step)

## Needs from other lanes

(filled per step)

## For the lead's merge

(filled per step)
