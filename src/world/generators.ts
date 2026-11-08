// The generators of analytic lesson worlds (spec section 4; contract WORLD_GENERATORS) and their
// versions. Each version is deterministic: the same generator, version, seed and parameters give the
// same geometry. A generator keeps building EVERY version it ever published, exactly as published,
// so a recording flown on its walls rebuilds them (and names them by the same digest); new geometry,
// new defaults or a new order of random draws is a new version, never a change of an old one.
//
// A version turns resolved parameters into a Built world: the room shell, the objects, bounds, the
// start pose and named landmarks (so a lesson can place checkpoints and zones without computing
// coordinates). Frames: world, metres, +Y up, floor at y = 0, nose along -Z at yaw 0. Halls are
// centred on x = 0, z = 0. Anything that rolls dice draws from `rng` in one fixed order.
import type { AnalyticWorldSpec, WorldGenerator } from '../contract';
import { WORLD_GENERATORS } from '../contract';
import { createRng } from '../util/rng';
import type { Built } from './build';
import { resolveWith, WorldSpecError, type ResolvedParams, type Schema } from './params';
import { buildV1, V1_SCHEMAS } from './v1';

export { SHELL_THICKNESS_M, type Built, type Landmark } from './build';
export { WorldSpecError, type ResolvedParams, type ResolvedValue } from './params';

/** The current geometry version of each generator: what makeSpec writes and new lessons get. */
export const GENERATOR_VERSION: Readonly<Record<WorldGenerator, number>> = {
    open: 1,
    hall: 1,
    corridor: 1,
    pillars: 1,
    rings: 1,
    squares: 1,
    'cube-frames': 1
};

interface Version {
    readonly schema: Schema;
    build(params: ResolvedParams, seed: number): Built;
}

const v1 = (generator: WorldGenerator): Version => ({ schema: V1_SCHEMAS[generator], build: (p, seed) => buildV1(generator, p, createRng(seed)) });

/** Every version each generator has published, and how to build it. */
const VERSIONS: Readonly<Record<WorldGenerator, Readonly<Record<number, Version>>>> = {
    open: { 1: v1('open') },
    hall: { 1: v1('hall') },
    corridor: { 1: v1('corridor') },
    pillars: { 1: v1('pillars') },
    rings: { 1: v1('rings') },
    squares: { 1: v1('squares') },
    'cube-frames': { 1: v1('cube-frames') }
};

/** The versions a generator builds, oldest first: every one it has published. */
export const GENERATOR_VERSIONS: Readonly<Record<WorldGenerator, readonly number[]>> = Object.fromEntries(
    WORLD_GENERATORS.map((g) => [g, Object.keys(VERSIONS[g]).map(Number).sort((a, b) => a - b)])
) as unknown as Readonly<Record<WorldGenerator, readonly number[]>>;

/** True when this build can build `version` of `generator`. */
export function buildsVersion(generator: WorldGenerator, version: unknown): version is number {
    return typeof version === 'number' && Number.isInteger(version) && Object.prototype.hasOwnProperty.call(VERSIONS[generator], version);
}

function requireVersion(generator: WorldGenerator, version: unknown): number {
    if (buildsVersion(generator, version)) return version;
    const known = GENERATOR_VERSIONS[generator];
    throw new WorldSpecError(
        `generator '${generator}' builds ${known.length === 1 ? 'version' : 'versions'} ${known.join(', ')} here (current ${GENERATOR_VERSION[generator]}), the spec asks for ${String(version)}`
    );
}

/** The parameter schema of one version of a generator; throws WorldSpecError for a version this build does not have. */
export function paramSchema(generator: WorldGenerator, version: number = GENERATOR_VERSION[generator]): Schema {
    return (VERSIONS[generator][requireVersion(generator, version)] as Version).schema;
}

/** The parameter schemas of the current versions. */
export const PARAM_SCHEMAS: Readonly<Record<WorldGenerator, Schema>> = Object.fromEntries(WORLD_GENERATORS.map((g) => [g, paramSchema(g)])) as unknown as Readonly<Record<WorldGenerator, Schema>>;

/** Checks `given` against the schema of `version` (the current one by default) and fills every default; throws WorldSpecError. */
export function resolveParams(generator: WorldGenerator, given: AnalyticWorldSpec['params'], version: number = GENERATOR_VERSION[generator]): ResolvedParams {
    return resolveWith(paramSchema(generator, version), generator, given);
}

/** Builds the geometry of a resolved spec at `version` (the current one by default). */
export function buildWorld(generator: WorldGenerator, params: ResolvedParams, seed: number, version: number = GENERATOR_VERSION[generator]): Built {
    return (VERSIONS[generator][requireVersion(generator, version)] as Version).build(params, seed);
}

export function isWorldGenerator(name: string): name is WorldGenerator {
    return (WORLD_GENERATORS as readonly string[]).includes(name);
}
