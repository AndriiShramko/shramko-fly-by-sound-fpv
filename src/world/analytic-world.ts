// AnalyticWorld: a lesson world built from its spec (contract AnalyticWorld). The geometry is a
// union of solids, each with a signed distance function (sdf.ts, parts.ts); rays are sphere
// traced against it; the simulator builds its collider from `solidAt` and names the walls by
// `digest`, so a flight log replays on the same walls.
import type { AnalyticWorld, AnalyticWorldSpec, CavityBox, MaterialClass, Pose, RayHit, SonicObject, Vec3, WorldGenerator } from '../contract';
import { canonicalJson } from '../util/canonical';
import { sha256Hex } from '../util/sha256';
import { buildsVersion, buildWorld, GENERATOR_VERSION, GENERATOR_VERSIONS, isWorldGenerator, resolveParams, WorldSpecError, type Landmark, type ResolvedParams } from './generators';
import { objectPart, type Part } from './parts';

/** A ray that comes this close to a surface (metres) has hit it. */
export const HIT_EPSILON_M = 2e-4;
/**
 * Sphere tracing steps by the distance to the nearest surface, which is slow for a ray that skims
 * a surface (a craft hugging a wall). After this many such steps the ray marches at least
 * COARSE_STEP_M at a time and bisects when it lands inside a solid, so it still finds its true
 * first hit instead of giving up. Nothing thicker than COARSE_STEP_M can be skipped (the thinnest
 * generated bar is 6 cm).
 */
const FINE_STEPS = 64;
const COARSE_STEP_M = 0.05;
const BISECTIONS = 14;
/** a hard stop, far beyond what maxDist / COARSE_STEP_M needs */
const MAX_STEPS = 50000;
const NORMAL_STEP_M = 5e-4;

/** An AnalyticWorld with what lessons need to place a craft, checkpoints and zones without computing coordinates. */
export interface AnalyticWorldInfo extends AnalyticWorld {
    /** every parameter, defaults filled in; `spec.params` equals this */
    readonly resolved: ResolvedParams;
    /** where a craft starts */
    readonly start: Pose;
    /** world y of the floor: the height layer's zero */
    readonly floorY: number;
    /** named points: start, wall middles, corridor sections, ... (positions at the start height) */
    readonly landmarks: readonly Landmark[];
    /** the boxes of the room's hollow (the shell exactly); null for the open world */
    readonly cavities: readonly CavityBox[] | null;
}

/** A complete spec of a generator at `version` (the current one by default): defaults for everything not given. */
export function makeSpec(generator: WorldGenerator, params: AnalyticWorldSpec['params'] = {}, seed = 0, version: number = GENERATOR_VERSION[generator]): AnalyticWorldSpec {
    return { generator, version, seed, params: resolveParams(generator, params, version) };
}

function classify(normal: Vec3 | null): MaterialClass {
    if (normal === null) return 'wall';
    if (normal[1] > 0.7) return 'floor';
    if (normal[1] < -0.7) return 'ceiling';
    return 'wall';
}

/** Builds the world of a spec; throws WorldSpecError for a spec this build cannot build. */
export function createAnalyticWorld(spec: AnalyticWorldSpec): AnalyticWorldInfo {
    if (typeof spec.generator !== 'string' || !isWorldGenerator(spec.generator)) throw new WorldSpecError(`unknown generator '${String(spec.generator)}'`);
    const generator = spec.generator;
    // every version a generator ever published still builds, exactly as it did (a v0.12 recording's walls)
    if (!buildsVersion(generator, spec.version)) {
        const known = GENERATOR_VERSIONS[generator];
        throw new WorldSpecError(`generator '${generator}' builds ${known.length === 1 ? 'version' : 'versions'} ${known.join(', ')} here (current ${GENERATOR_VERSION[generator]}), the spec asks for ${String(spec.version)}`);
    }
    const version = spec.version;
    if (!Number.isInteger(spec.seed) || Math.abs(spec.seed) > Number.MAX_SAFE_INTEGER) throw new WorldSpecError(`seed must be an integer, got ${String(spec.seed)}`);
    const resolved = resolveParams(generator, spec.params, version);
    const full: AnalyticWorldSpec = { generator, version, seed: spec.seed, params: resolved };
    const digest = sha256Hex(canonicalJson(full));

    const built = buildWorld(generator, resolved, spec.seed, version);
    const objects: SonicObject[] = [...built.objects].sort((a, b) => {
        if (a.order !== null && b.order !== null) return a.order - b.order;
        if (a.order !== null) return -1;
        if (b.order !== null) return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const parts: Part[] = [built.shell];
    for (const o of objects) {
        const part = objectPart(o);
        if (part !== null && o.solid) parts.push(part);
    }

    const sdf = (x: number, y: number, z: number): number => {
        let best = Infinity;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i] as Part;
            const b = part.bound;
            if (b !== null) {
                const dx = x - b.cx, dy = y - b.cy, dz = z - b.cz;
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r >= best) continue;
            }
            const d = part.sdf(x, y, z);
            if (d < best) best = d;
        }
        return best;
    };

    const solidAt = (x: number, y: number, z: number): boolean => {
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i] as Part;
            const b = part.bound;
            if (b !== null) {
                const dx = x - b.cx, dy = y - b.cy, dz = z - b.cz;
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r > 0) continue;
            }
            if (part.sdf(x, y, z) <= 0) return true;
        }
        return false;
    };

    const hitAt = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, distance: number): RayHit => {
        const x = ox + dx * distance, y = oy + dy * distance, z = oz + dz * distance;
        let nearest = parts[0] as Part;
        let nearestD = Infinity;
        for (const part of parts) {
            const d = part.sdf(x, y, z);
            // an object wins a tie with the shell: it is the more specific thing to name
            if (d < nearestD - 1e-9 || (d <= nearestD + 1e-9 && part.id !== null && nearest.id === null)) {
                nearest = part;
                nearestD = d;
            }
        }
        const h = NORMAL_STEP_M;
        const gx = nearest.sdf(x + h, y, z) - nearest.sdf(x - h, y, z);
        const gy = nearest.sdf(x, y + h, z) - nearest.sdf(x, y - h, z);
        const gz = nearest.sdf(x, y, z + h) - nearest.sdf(x, y, z - h);
        const gl = Math.hypot(gx, gy, gz);
        const normal: Vec3 | null = gl > 1e-9 ? [gx / gl, gy / gl, gz / gl] : null;
        return { distance, point: [x, y, z], normal, material: nearest.material ?? classify(normal), objectId: nearest.id };
    };

    const castRay = (origin: Vec3, dir: Vec3, maxDist: number): RayHit | null => {
        let dx = dir[0], dy = dir[1], dz = dir[2];
        const len = Math.hypot(dx, dy, dz);
        if (!(len > 0) || !(maxDist > 0)) return null;
        if (Math.abs(len - 1) > 1e-9) {
            dx /= len; dy /= len; dz /= len;
        }
        const ox = origin[0], oy = origin[1], oz = origin[2];
        let t = 0;
        let free = 0; // the last point known to be outside every solid
        for (let i = 0; i < MAX_STEPS; i++) {
            const d = sdf(ox + dx * t, oy + dy * t, oz + dz * t);
            if (d <= HIT_EPSILON_M) {
                if (i <= FINE_STEPS) {
                    // for a head-on approach the surface lies exactly d further on
                    const distance = d > 0 ? t + d : t;
                    return distance <= maxDist ? hitAt(ox, oy, oz, dx, dy, dz, distance) : null;
                }
                let lo = free, hi = t;
                for (let k = 0; k < BISECTIONS; k++) {
                    const mid = (lo + hi) / 2;
                    if (sdf(ox + dx * mid, oy + dy * mid, oz + dz * mid) <= HIT_EPSILON_M) hi = mid;
                    else lo = mid;
                }
                return hi <= maxDist ? hitAt(ox, oy, oz, dx, dy, dz, hi) : null;
            }
            free = t;
            t += i < FINE_STEPS ? d : Math.max(d, COARSE_STEP_M);
            if (t > maxDist) return null;
        }
        return null;
    };

    return {
        kind: 'analytic',
        id: `${generator}-${digest.slice(0, 8)}`,
        version,
        bounds: built.bounds,
        castRay,
        objects: () => objects,
        spec: full,
        digest,
        sdf,
        solidAt,
        voxelM: resolved['voxelM'] as number,
        resolved,
        start: built.start,
        floorY: 0,
        landmarks: built.landmarks,
        cavities: built.shell.cavities === undefined ? null : built.shell.cavities.map((b) => ({ ...b }))
    };
}
