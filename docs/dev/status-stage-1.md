# Stage 1: sonic-core status

Plan: ShramkoGSFPV `docs/wip/v12-plan.md`, section 4.1 (steps 1 to 13). Spec: `docs/design/stage-1-spec.md` (section 13 amendments override earlier sections). Sole writer: the sonic-core lane.

## Status

- [x] 1 Tooling and layout, commit e65cc89 (devDependencies at the simulator versions, tsconfig.core/node, layout rules in tools/check-layout.ts with test/layout.test.ts)
- [x] 2 Locales en, es, pl, ru, parity test, commit 0679bec (404 keys per language; formatter, translator, key catalogue, survey definitions, speech lint)
- [x] 3 Analytic worlds, commit c973756 (`src/world/`, `src/util/`): SDF primitives, seven generators, AnalyticWorld, canonical JSON, own SHA-256, seeded RNG, 85 world tests with goldens
- [x] 4 Scene sampler (`src/sense/`): ten sectors x 3 rays, hysteresis, surface-based time to collision, at most 3 hazard voices, 52 tests
- [ ] 5 Tracks, themes, prefs
- [ ] 6 Engine `src/audio/`
- [ ] 7 Audio proofs `test-audio/`
- [ ] 8 Lessons and runner
- [ ] 9 Session format `src/session/`
- [ ] 10 Replay core `src/replay/`
- [ ] 11 Report tool `tools/report.ts`
- [ ] 12 Demo and Sound Lab `demo/`
- [ ] 13 `docs/testing/` and tag `stage1-rc1`

## Contract changes

None yet.

## Decisions and notes

Step 2, locales
- Every locale file is flat: a SpeechLine key maps to a template. The formatter (`src/i18n/format.ts`) speaks one ICU subset: `{name}` and `{n, plural, one {# second} other {# seconds}}` (CLDR categories per language, `=0` exact branches, `#` is the number). No escaping, so a text never holds a literal brace. Spanish needs only one and other; Polish and Russian need one, few, many, other.
- `src/i18n/catalog.ts` is the one list of keys (`requiredKeys()`): 20 cue ids, 21 lesson ids in ladder order with their line counts, the free keys, and the survey keys derived from `src/survey/defs.ts`. test/locales.test.ts holds all four files to that list, in that order, and to the documented arguments (the `ARGUMENTS` table there is the interface the lesson, menu and delivery code must fill).
- Lesson ids for step 8 (module): ears-headphones, ears-glossary, ears-walls, ears-shapes, ears-game (0); hover-height, hover-turn (1); move-speed, move-stop (2); walls-hall, walls-pillar, walls-row (3); corridor (4); rings-first, rings-line, rings-small, rings-course (5); shapes-square, shapes-series, shapes-cube (6); free-garden (7). Each lesson has `title`, `intro.n`, `goal.n`, `pass`, `retry`, `hint.1`. A lesson file must use these ids and keys, and pass the parameters the text names (hover-height.goal.1 takes seconds, move-stop.intro.1 takes metres). The fast path flags are the lesson files' business.
- Key letters are never written into lesson texts: the help, recording, sending and survey lines take `{key}` (and `{skip}`) from the host, so rebinding works. Directions `dir.<sector>` are stand-alone phrases ("On your left.") spoken before a preview.
- Surveys are TypeScript data in `src/survey/defs.ts` (first flight 9 items, returning pilot 10, child 6). The workload scales are 0 to 9, not 0 to 10, so that one key press answers; convert with value * 100 / 9.
- The speech lint (`tools/locale-lint.ts`) refuses empty or padded texts, more than 240 characters, characters a synthesiser reads badly, emoji, Latin words in Russian texts outside a short name list, Cyrillic in other languages, a plural block without its language's categories, and a text copied from English. Each rule has a negative control in the test.

Step 3, analytic worlds
- `createAnalyticWorld(spec)` (`src/world/analytic-world.ts`) returns `AnalyticWorldInfo`: the contract's AnalyticWorld plus `resolved` (every parameter, defaults filled), `start` (Pose), `floorY` (0) and `landmarks` (named points, so lessons place checkpoints and zones without computing coordinates). `makeSpec(generator, params, seed)` gives a complete spec at the current version. A spec with an unknown generator, parameter, value out of range, wrong version or a layout that does not fit throws `WorldSpecError` with the reason.
- Digest = SHA-256 of the canonical JSON (sorted keys, no spaces, `src/util/canonical.ts`) of the resolved spec `{generator, params, seed, version}`; omitted and explicit defaults are one spec. The id is `<generator>-<8 hex>`, never bare hex. The digest covers the spec only, so test/world.test.ts also pins a hash of each world's objects and of its distance field at 600 fixed points: change a generator, a default or a draw order and those fail until GENERATOR_VERSION is bumped and the goldens regenerated.
- Shapes (src/world/parts.ts header): ring `diameter` is the CLEAR opening and `tube` the tube RADIUS; square and cube-frame `side` is the clear opening and `bar` the bar thickness (outer side = side + 2 bar); pillar `height` is centred on `pos`. A gate faces local -Z for a 'forward' pass; `yawQuat(yaw)` makes the quaternion. Zones are not solid and carry material 'floor' and order 0.
- Generators and their landmarks: open (floor, optional ceiling, optional stop zone: start); hall (wall-front/back/left/right at start height); pillars (single, row, scatter; hall 40 x 60 x 12); corridor (5 x 4 m; layouts straight, obstacle, bends, jogs, full = 100 m straight, pillar, 6 left-right bends, 4 up-down jogs, 6 bends with pillars; landmarks section-straight, -obstacle, -bends, -jogs, -mixed and end); rings, squares, cube-frames (hall 60 x 160 x 20; layouts single with offsets, line, turn, course; `sizes` gives a size per gate; ids ring-N, square-N, cube-N; order 0..). Hall-based worlds start near the +Z end and look along -Z. Everything is seeded by `createRng` (mulberry32); the order of draws is part of the version.
- Rays: sphere tracing (64 exact steps, then at least 5 cm steps with bisection, so a ray skimming a wall still finds its true first hit); 30 000 rays cost 20 to 360 ms here. A ray from inside a solid hits at distance 0. Material: objects are 'obstacle'; the room's surfaces are floor, ceiling or wall by normal. `voxelM` is 0.1 by default (a `voxelM` parameter).
- Mutation check done by hand: stepping the tracer by 2 d fails 20 tests.

Step 4, scene sampler
- `createSceneSampler(options).sample(flightSample, world | null, frame = 'heading')` returns a `SceneSample`: ten `SectorReading`s in SECTORS order (30 rays: the axis and two rays 20 degrees to either side), the voiced `hazards` (at most `maxVoices`, 0 to 3, most urgent first, each with sector, rank, urgency, distance, ttcS, dir, material, objectId) and `meanFreeDistanceM` for the room layer. Directions are in the listener frame (heading: yaw only; body: full attitude). One sampler per craft; hysteresis and stickiness remember the previous call; `reset()` on a new lesson or a seek (a clock that runs backwards is also handled).
- A sector's distance is the minimum over its rays (to the hull, `bodyRadiusM` 0.12), its time to collision the soonest over its rays, and its direction, material and object those of its most threatening ray. Time to collision is to the SURFACE: hull distance along the hit normal over the speed toward it, so flying along a wall has none whichever ray sees it (without a normal the line of sight stands in). A line-of-sight time was tried first and failed the corridor test: at 45 m/s the oblique rays at the side walls outranked the end wall.
- Risk = max(enterDist / distance, enterTtc / ttc): 1 at the threshold. On at risk >= 1 at once; off when risk < releaseRatio (0.8) and holdMs (300) have passed since it last reached 1. Ranking = risk x sector weight (ahead over behind) x stickiness (1.25) for a voice already sounding. All defaults are in `DEFAULT_SAMPLER_CONFIG` and are starting values for pilot tests: enter distances front 6 m, diagonals 5, front-up 3, front-down 1.8, left and right 4, back 3, up and down 1.5; enter time 3 s. A low hover (under 1.6 m) makes the floor voice sound.
- Data for the engine (step 6): hazard `ttcS` null means use `distance` for the pulse period; `material` picks the safety timbre (obstacle for pillars and gates); `sector` is a stable voice key.

## Risks for the next agent

(filled in as the steps are done)
