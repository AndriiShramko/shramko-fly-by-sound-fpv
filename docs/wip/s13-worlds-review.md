# Review of lane s13-worlds (v0.13, owner's message 41)

Independent review, 2026-11-08. Branch `s13-worlds` at fef8869, base `eee530b` (lane s13-lessons step 4). Read: the plan
(ShramkoGSFPV `docs/wip/v13-plan.md`), the owner's message 41, `docs/wip/s13-worlds.md`, the diff `eee530b..fef8869`, and
ShramkoGSFPV `apps/fly/src/sonic/` (read only). Evidence at the end.

## Verdict

**Merge after fixes.** The lane delivers what the plan gave it, and the engineering is sound:

- The first room is now the smallest (walls-hall 10 x 12 x 3.2 m). By the assist model, every wall and leg of every room
  lesson comes in 2 to 3 s at full stick, and the ceiling in about 2 s.
- The corridor and every course carry a checkpoint list at most 5 m apart.
- Six tunnels get narrower and harder, and the long one marks five stages.
- rings-heights puts rings at floor, middle and ceiling.
- Every published generator version still builds exactly as it did. I checked the v0.12 fixture against `main` 7d4b4b9
  myself.
- The contract additions (`CavityBox`, `cavities`, `WorldCheckpoint { pos, dir, stage? }`) are exactly what lane
  s13-lessons feature-detects. Its tip already uses them for respawn, wrong way and stage praise.
- Ownership is respected, and every edit outside it is listed.
- All five rules I broke on purpose were caught.

**Before the merge, the lane should fix:**

- B1: a name clash that breaks the typecheck once merged with s13-sound.
- Three things a pilot would notice:
  - the corridor counts an attempt before its last section (M1);
  - the tunnels count it before, or right at, their last obstacle (M2);
  - rings-heights can be flown at nearly one height (M3).

**M4 to M8 are the lead's merge items** (simulator drawing, cross-lane fields, layers, stale tests, chimes).

**As the owner would fly it:**

- "One, two, three, oops, a wall": yes. walls-hall's walls are 2.5 to 2.8 s away and its ceiling 1.95 s. But the
  lesson still calls it "The big hall" and passes after 2 m of flight (M5).
- Respawn near the crash: yes, once merged with s13-lessons' runner (the world list, about 1 to 6 m back). In this
  lane alone, the corridor's own checkpoints are up to 37 m apart (m5).
- Tunnels progressively harder: yes. But "lesson passed" can come before the last obstacle (M2). In tunnel-gaps, a
  checkpoint chime sounds at every obstacle inside the open-way chime's window (M8).
- Rings at different heights: placed right. But a pilot holding 1.62 to 2.38 m passes four of the five rings (M3).

## Findings

### B1 (blocker): `FREE_SIDES` and `FreeSide` are exported twice once merged with s13-sound

- **Where:** `src/world/index.ts:7` (defined in `src/world/tunnels.ts:26-27`). Lane s13-sound exports the same names
  from `src/sense/freeway.ts:17-18`. `src/index.ts` re-exports both modules with `export *`.
- **What:** a trial merge of s13-sound (c48de8c) and s13-worlds has no textual conflict, but `pnpm typecheck` fails:
  `src/index.ts(17,1): error TS2308: Module './sense' has already exported a member named 'FREE_SIDES'`, and the same
  for `FreeSide`. Both lists hold the same four names in a different order. Under ESM, a clashing `export *` name is
  also dropped from the package namespace. The simulator imports the package's `src/index.ts`, so its typecheck at the
  gitlink move would meet the same error.
- **Fix:** drop `FREE_SIDES` and `type FreeSide` from the export in `src/world/index.ts`: nothing outside
  `src/world/tunnels.ts` imports them (only `tunnelStages` is used, by `test/world-tunnels.test.ts`). Or export them
  as `OBSTACLE_FREE_SIDES` / `ObstacleFreeSide`. One line.

### M1 (major): the corridor counts an attempt at 100 m of its 126 m track; the last section is never finished

- **Where:**
  - `lessons/corridor.json:68` (`"metres": 100`);
  - `test/world-scale.test.ts:141-142`, which sums the goals;
  - `src/lesson/goals.ts:298-301`, where `fly-distance` is met when `ctx.attemptPathM() >= goal.metres`;
  - the path resets only when an attempt starts (`src/lesson/runner.ts:549, 1209`).
- **What:** the goals are cumulative, not additive. The second goal is met at 100 m of the attempt's path, not at
  15 + 100 = 115 m. The lane doc's reasoning ("the straight, then 115 of the 126 m track") does not hold, and the test
  `goals[0] + goals[1] > 0.8 * length` encodes the wrong reading.
- **Flown:** the truth bot, flying the ideal line, is counted at 100.3 m along the 126.2 m track (t = 34.0 s). The
  mixed section (bends with pillars) runs from 89 to 126 m, with its six pillars at about 95, 101, 107, 113, 119 and
  125 m. A passing attempt flies past one of them.
- **Same defect as v0.12:** lane s13-lessons found it there ("passed at 240 m ... its last section ... never flown")
  and asked the lead or this lane to end the corridor at its end.
- **Fix:** set the second goal to the track's length less a small margin (about 121 m), and test `goals.at(-1)`
  against the track length, not the sum. The robust fix is M2's.

### M2 (major): a tunnel attempt counts by metres flown, so extra path counts it before the last obstacle

- **Where:** the `fly-distance` goals of the six tunnels:
  - `lessons/tunnel-wide.json:64` (29 m), `tunnel-narrow.json:64` (25 m), `tunnel-narrower.json:64` (20 m);
  - `tunnel-bends.json:118` (39 m), `tunnel-gaps.json:64` (33 m), `tunnel-long.json:289` (148 m).
- **What:** the goal measures the path flown, not progress along the tunnel. The truth bot flies the ideal line:
  - tunnel-gaps: counted at 30.8 m of the 35.8 m track; block-4 ends at about 29.5 m.
  - tunnel-long: counted at 145.8 of 150.8 m; block-5 is at about 144 m.

  That leaves about 1.3 m of path between leaving the last obstacle and the count. A pilot whose path is longer than
  the bot's by that much is counted in front of the last obstacle, or before it. A sideways or up-and-down search for
  the free way (what tunnel-gaps teaches), or the usual corrections in a 1.2 m tunnel, adds that much easily. The pilot
  then hears "lesson passed" mid-tunnel, and the last obstacles of the hardest stage go unflown.
- **Fix, either:**
  - (a) Corridor version 2 is unpublished, so its builder can add a non-solid zone at the `end` landmark (`zone-end`,
    which the simulator already draws as twelve edges). The tunnels' goal then becomes `reach-zone`.
  - (b) Lane s13-lessons adds a goal measured along the world's track. Its runner already tracks the furthest point
    passed.

  Then hold "counted only after the last obstacle" with a pilot whose path is 10 % longer than the bot's. Control:
  today's goals fail it.

### M3 (major): rings-heights can be flown at nearly one height

- **Where:**
  - `lessons/rings-heights.json:85-87` (2 m rings, `heights` middle, floor, ceiling, floor, middle; a 5 m room);
  - `test/world-heights.test.ts:62-65`, which checks the ring centres.
- **What:** the heights at which a craft (0.12 m) passes each opening without a touch:

  | Ring | Level | Passes at |
  |---|---|---|
  | 1 | middle | 1.62 to 3.38 m |
  | 2 | floor | 0.62 to 2.38 m |
  | 3 | ceiling | 2.62 to 4.38 m |
  | 4 | floor | 0.62 to 2.38 m |
  | 5 | middle | 1.62 to 3.38 m |

  One height band, 1.62 to 2.38 m, passes four of the five rings. The whole lesson needs about 0.25 m up and back for
  the ceiling ring. The lane's "every leg changes the height by at least 1 m" is true of the centres, not of what the
  pilot must do. The owner asked for rings at different heights "to learn to find the height and enter it right". For
  context, rings-course is the same: one height (2.13 m) passes all six of its rings.
- **Fix:** make the three levels' windows disjoint:
  - 1.4 m rings in the same room give 0.62-1.78, 1.92-3.08 and 3.22-4.38 m;
  - or keep 2 m rings in a taller room.

  Keep the climbs inside the legs at 1.5 m/s (the lane's own fit test; the spacing may go from 6 to 7 or 8 m). Add a
  test that no height passes rings of two different levels, with today's lesson as the control.

### M4 (major, the lead at the gitlink move): the simulator draws the six tunnels from the wrong boxes

- **Where:** ShramkoGSFPV `apps/fly/src/sonic/primitives.ts:134-231` (`corridorCavities`, `cavityBoxes`).
- **What:** the mirror walks every corridor as version 1. The tunnels' layouts (`tunnel`, `gaps`, `long`) fall into
  `default` (`full`). `jogCount` and `riseM` are undefined, so its loops run on NaN and draw boxes that are not the
  tunnel, without an error. A sighted pilot sees walls where there are none and misses real ones, in tunnel-wide,
  tunnel-narrow, tunnel-narrower, tunnel-bends, tunnel-gaps and tunnel-long. Collision is right (it is built from
  `solidAt`). The lane documents this ("Needs from the simulator 1"), including the bench test that then fails for
  exactly these six.
- **Fix:** land the three-line switch to `world.cavities` (lane doc, Needs from the simulator 1) in the same
  simulator commit as the gitlink move, not later with wave 2.

### M5 (major, cross-lane: s13-lessons' fields): walls-hall says "big hall" and passes after 2 m of flight

- **Where:**
  - `locales/*.json`: `lesson.walls-hall.title` and `.intro.1` (en.json:138-139, the same in the other three
    languages; unchanged on the s13-lessons tip 1862a33);
  - `lessons/walls-hall.json:19` (`stopWithinM: 3`).
- **What:** the smallest room of the ladder is announced as "The big hall" and "a big, empty hall". `approach-stop`
  needs 2 m of flight (`APPROACH_MIN_M`) and a stop with a wall within 3 m (eight horizontal rays). From the centre the
  side walls are 4.88 m from the hull, so flying 2 m toward one and stopping passes. The owner asked for a small room
  so a wall comes "one, two, three, oops"; the lesson no longer asks him to approach it. The lane raised both (Needs
  from other lanes 1 and 2); neither is fixed on the s13-lessons tip.
- **Fix:** lane s13-lessons, or the lead at the merge, takes the lane's proposed English line ("A small room", "You
  are in a small, empty room ...") with its three translations, and sets `stopWithinM` to 1.5.

### M6 (major, the lead's merge): two conflicts and twelve stale tests of the other lanes

- **Where and what:**
  - **corridor.json conflict.** A trial merge of s13-lessons (1862a33) and s13-worlds conflicts in
    `lessons/corridor.json`, on the poses of cp-3 and cp-5. s13-lessons turned them to yaw 90 (the bends start there,
    and yaw 0 faces the wall) and added `stage` 1 to 4. This lane moved their positions. The lane doc's "Merge by
    field ... do not touch these lines" is stale: s13-lessons touched these lines after eee530b.
  - **progress.test.ts conflict.** `test/progress.test.ts` conflicts too (the lesson count, 21 against the path's 28).
  - **Nine s13-lessons tests fail** after resolving. All fly v0.12 coordinates (z = 64 and 56 around a ring at 60; -49
    and -80 in the corridor; an injected list flown through the corridor's pillar, now at z = -21), or expect the
    corridor's track to come from its lesson checkpoints, where it now comes from the world:
    - `test/direction.test.ts`: three tests;
    - `test/praise.test.ts`: "comes from a pool of short lines ...";
    - `test/respawn.test.ts`: three tests;
    - `test/runner.test.ts`: "the corridor: checkpoints are reached in turn ..." and "reset to the last checkpoint
      ...".

    None points at the shape of the world list.
  - **Three s13-sound tests fail** in a trial merge of s13-sound and s13-worlds:
    - `test/replay-v012.test.ts`, the control: it assumes rings-first's world is unchanged, and it now gets a
      `world-id` note;
    - `test/ttc.test.ts`, "the 0.5 m pillar": it pins walls-pillar's v0.12 pillar (radius 0.5, a 22 m run-up); the
      pillar is now 0.3 m in a 12.5 m room;
    - `test/silence-layers.test.ts`: see M7.
- **Fix:**
  - corridor.json: resolve cp-3 and cp-5 as `pos` from s13-worlds with `yawDeg: 90` and `stage` from s13-lessons,
    that is (0, 1.25, -27) and (18, 1.25, -75), both facing +X. Taken whole, s13-worlds' side makes both respawns
    face a wall 1.25 m ahead.
  - progress.test.ts: s13-lessons' form, with the count taken from the path.
  - The twelve tests: take positions from the worlds, as this lane did for its own (doc, step 5).
  - ttc.test.ts: either pin `makeSpec('pillars', ..., 0, 1)` (version 1 still builds) or rerun the M41-13 check on the
    new pillar. The 0.3 m pillar is the one pilots meet.

  With these resolutions the s13-lessons merge typechecks and 872 of 881 tests pass before the nine are updated.

### M7 (major, the lead's merge with s13-sound): the seven new lessons lack the layers every flying lesson now has

- **Where:**
  - `layers.on` of the six tunnels: `["safety", "voice"]`;
  - `lessons/rings-heights.json`: no `room`;
  - s13-sound's rule in `test/silence-layers.test.ts:28-31`.
- **What:** s13-sound now requires `height` and `room` in every flying lesson (M41-10, never silence: "silence always
  means something is wrong"). Merged as they are, the tunnels go quiet at rest in a straight run, and the s13-sound
  test fails, first on tunnel-wide.
- **Fix:** at the merge, add `height` and `room` to the six tunnels and `room` to rings-heights (`layers` are
  s13-sound's field). The lane asked s13-sound for the tunnels, but not for rings-heights.

### M8 (major, at the merge): in tunnel-gaps a checkpoint chime sounds at every obstacle inside the open-way chime's window

- **Where:**
  - `lessons/tunnel-gaps.json` cp-2 to cp-5: 1.5 m before each block, radius 2.5 m;
  - the same kind of checkpoints in tunnel-long (29 lesson checkpoints);
  - s13-lessons' runner (tip) pushes a `checkpoint` cue for every lesson checkpoint, even when the world list does the
    respawn;
  - one-off cues are not gated by the lesson's layers (s13-sound `src/cues/planner.ts`, `cue()`).
- **What:** I measured this in the merged sound engine (s13-sound + s13-worlds, its recording host, flying the world
  track at 2.5 m/s). At each of the four blocks, `safety.free:<side>` starts 7.5 to 9.0 m before the block, and the
  two-note `target.checkpoint` fires 3.9 to 4.4 m before it, inside that window. Locating the open-way chime by ear is
  the one thing tunnel-gaps teaches. The Russian glossary on the s13-sound tip describes both cues with the same words
  ("a short double chime"). In tunnel-long, the 29 lesson checkpoints chime about every 2 s at the cap.
- **Fix:** once the world list does the respawn (the s13-lessons merge), drop the six tunnels' lesson checkpoints, or
  at least those before obstacles. The lane doc already says "keep or drop them". Ask s13-sound to give the two
  glossary lines different words.

### m1 (minor): Russian "narrower" is a homograph a speech engine reads as "already"

- **Where:** `locales/ru.json:177` (`lesson.tunnel-narrow.intro.1`), `:184` (`lesson.tunnel-narrower.intro.1`), `:207`
  (`lesson.tunnel-long.intro.2`).
- **What:** the lines use "uzhe" (narrower, stressed on the first syllable), which is spelled exactly like "uzhe"
  (already, stressed on the second). The lessons are spoken, and a voice usually says "already": "this tunnel
  already", "now even already".
- **Fix:** the verb "suzhaetsya" (narrows), "pouzhe", or "eshchyo tesnee" (tighter still).

### m2 (minor): wording that a native speaker would change

- **Polish:** `locales/pl.json:171, 175` say "gdzie jest wolno", which reads as "where it is slow" or "where it is
  allowed". Use "wolna strona" (the free side) or "wolna droga", the glossary's name of the cue.
  `pl.json:237`: the gliding tone "plynie" (flows) and the steady tone "rowny" (even) are better as "zmienia sie
  plynnie" and "staly".
- **Russian:**
  - `ru.json:198, 201`: "obojti" (walk around) should be "obletet'" (fly around).
  - `ru.json:208`: "sovsem nenamnogo nazad" reads better as "sovsem nedaleko nazad".
- **Spanish:** `es.json:209` "Vuela todas las etapas" reads better as "Recorre todas las etapas".
- **English** reads naturally throughout.

### m3 (minor, s13-lessons' strings): module 4 is still called "Corridor"

- **Where:** `locales/*.json:64` (`module.4.name`).
- **What:** the start screen groups lessons by module name (`start-model.ts:70`). Six tunnels now sit under
  "Corridor". `llms.txt` already says "corridor and tunnels".
- **Fix:** "Corridor and tunnels" in the four languages.

### m4 (minor): a v0.12 recording rebuilds on its own walls only when the replay is handed its v0.12 lesson

- **Where:** `src/replay/rebuild.ts:66-88` (`options.lessons`); `AGENTS.md`, the generator rule.
- **What:** the mechanism is right, and `test/world-versions.test.ts` proves it with the v0.12 lesson fixture. But
  `checkSession` and the report tool, run with the shipped lessons, rebuild a v0.12 walls-hall recording on the new
  10 x 12 m walls, with `world-id` and `lesson-version` notes. AGENTS.md's "so every recording rebuilds on its own
  walls" holds only when the caller has the old lesson. No owner recordings of v0.12 exist (s13-lessons doc, left
  open 3), so the cost is low today.
- **Fix:** ship the v0.12 geometry (`test/fixtures/v012-lesson-geometry.json` already holds every v0.12 world, start
  and goals) as a replay table keyed by lesson id and version. Or reword AGENTS.md to say the replay needs the
  recording's lesson.

### m5 (minor): the lane doc overstates two things

- **Where:** `docs/wip/s13-worlds.md:419-420` and `:169`.
- **What:**
  - "the corridor's five keep the present respawn near the crash": along the track they are 15, 11, 33 and 30 m
    apart, and the last is 37 m from the end. The bends and mixed sections (33 and 37 m) have none inside. Respawn is
    near only after s13-lessons' runner reads the world list, which its tip does.
  - Step 4's "87 checkpoints" was before step 5. The corridor's world now has 54.
- **Fix:** correct both lines.

### m6 (minor, for the lead): one long tunnel and one kind of obstacle, where the owner asked for several

- **Where:** the six tunnel lessons.
- **What:** the owner asked for several different long tunnels with different obstacles ("sdelay neskol'ko raznykh
  takikh dlinnykh tunneley s raznymi prepyatstviyami"). The plan reduced this to one long tunnel in stages, and the
  lane followed the plan. Five tunnels are 22 to 42 m (9 to 17 s). The only tunnel obstacle is a block that leaves one
  side free.
- **Fix:** none needed for v0.13 against the plan. A second long tunnel (pillars, steps, a ring or a doorway, a
  different order of stages) would answer his words; corridor version 2 is unpublished, so it can still grow.

### m7 (minor): `NEWEST_VERSION.corridor` is the tunnel family, which lacks version 1's layouts

- **Where:** `src/world/generators.ts:26, 62-65`; AGENTS.md says a new lesson names `NEWEST_VERSION`.
- **What:** corridor version 2 builds only `tunnel`, `gaps` and `long`. A new corridor lesson that follows the advice
  cannot get `full`, `straight`, `obstacle`, `bends` or `jogs`.
- **Fix:** one sentence in the comment and in AGENTS.md: for the corridor, version 2 is the tunnels, and version 1
  remains the corridor's.

## Evidence

- **Checks** (Node 22.13, pnpm 11.5, in the lane worktree): `pnpm typecheck` passes (three projects); `pnpm test`: 30
  files, 855 tests pass.
- **Rules broken on purpose** (each restored with `git checkout`; the worktree ends clean):

  | Rule broken | Tests failed |
  |---|---|
  | Checkpoint spacing allowed 9 m (`CHECKPOINT_SPACING_M` 5 -> 9) | 14 in `world-track` |
  | A "free left" obstacle built with its free way on the right (`tunnels.ts`) | 6 (`world-tunnels` 3, `world-track` 3) |
  | Version 1's start moved by 1 cm (`v1.ts` `Math.min(8, ...)` -> 7.99) | 25 (the ten v0.12 fixture worlds and 15 goldens) |
  | The `ceiling` level built at mid-height (`rooms-v2.ts`) | 4 (`world-heights`, `world-rooms-v2`) |
  | The long tunnel's stage marks shifted by one | 1 in `world-tunnels` |

- **The v0.12 fixture against main:** `test/fixtures/v012-worlds.json`, rebuilt with `main` (7d4b4b9) in a scratch
  clone, gives the same id (digest) and bounds for all 15 worlds, with main's own specs. The session fixture's
  `scene.id` (hall-67e9057a) is v0.12's walls-hall. The session is synthetic (test host, test pilot, no voice): no
  personal data.
- **Trial merges** (scratch clones, nothing pushed, lane branches untouched):
  - s13-lessons + s13-worlds: two conflicts (M6). Resolved as M6 says: typecheck passes, 872 of 881 tests pass.
  - s13-sound + s13-worlds: no conflict. Typecheck fails (B1); 935 of 938 tests pass (M6, M7).
- **Contract:** s13-lessons' `worldCheckpoints` (its `src/lesson/track.ts`) accepts the lists as they are: two or more
  points, finite `pos` and `dir`, an integer `stage`. Its runner respawns 1 m before the last world point passed and
  says "Stage k passed" from the world's `stage`. s13-sound's target tone takes the next gate's height
  (`targetHeightM`), so rings-heights' "the steady tone is the height of the next ring" holds once merged.
- **Simulator** (`apps/fly/src/sonic/` only):
  - Nothing there uses `GENERATOR_VERSION` or `PARAM_SCHEMAS`.
  - `AnalyticWorldInfo` comes only from `createAnalyticWorld`, so the new required `cavities` compiles.
  - `box` objects are drawn at full extents, as the package collides them.
  - The respawn platform takes mid-air checkpoint poses as it takes starts.
  - The only break is M4.
- **Collider work**, by a model of the culling: cells of 8^3 voxels, `solidAt` at every voxel of a cell within half its
  diagonal of a surface. tunnel-long at 0.05 m: 455 422 cells, 11 819 near a surface, 6.05 M calls, 5.0 s in Node. The
  shipped v0.12 corridor: 9.38 M calls, 4.7 s. Same order as what already shipped; the frame cost stays lane
  v13-look's.
- **Hygiene:** no personal data, machine paths or non-English text in the lane's files outside `locales/`. The
  Cyrillic in `test/progress.test.ts` predates the lane, and s13-lessons' form, taken in M6, removes it. The commit
  identity is the repository's own.
- **Ownership:** every edit outside `src/world/*`, the lesson files' world, start and assists, the new lessons and the
  generator goldens is listed in the lane doc's "For the lead's merge" or step 5:
  - the contract additions;
  - goals, checkpoints and an intro number that follow the geometry;
  - registration of the new lessons;
  - `order`;
  - other lanes' tests, given positions from the worlds;
  - README, llms.txt and AGENTS.md.
