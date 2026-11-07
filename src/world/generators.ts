// The seven generators of analytic lesson worlds (spec section 4; contract WORLD_GENERATORS).
// Each is deterministic: the same generator, version, seed and parameters give the same geometry.
// A generator turns resolved parameters into a Built world: the room shell, the objects, bounds,
// the start pose and named landmarks (so a lesson can place checkpoints and zones without
// computing coordinates).
//
// Frames: world, metres, +Y up, floor at y = 0, nose along -Z at yaw 0. Halls are centred on
// x = 0, z = 0. Anything that rolls dice draws from `rng` in one fixed order; changing that order,
// a default or any geometry is a new generator version (GENERATOR_VERSION) and new digests.
import type { AnalyticWorldSpec, Pose, SonicObject, Vec3, WorldGenerator } from '../contract';
import { WORLD_GENERATORS } from '../contract';
import { createRng, type Rng } from '../util/rng';
import { DEG, round6, round9, yawQuat } from '../util/vec';
import { cavityShell, shapeHalfExtents, slabShell, type Box, type Part } from './parts';

/** The geometry version of each generator. Bump one when its geometry, defaults or random draws change. */
export const GENERATOR_VERSION: Readonly<Record<WorldGenerator, number>> = {
    open: 1,
    hall: 1,
    corridor: 1,
    pillars: 1,
    rings: 1,
    squares: 1,
    'cube-frames': 1
};

/** Thickness of the solid around a hollow that the collider is built over, metres. */
export const SHELL_THICKNESS_M = 1;

export class WorldSpecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorldSpecError';
    }
}

// ------------------------------------------------------------------ parameters

export type ResolvedValue = number | string | readonly number[];
export type ResolvedParams = Readonly<Record<string, ResolvedValue>>;

interface NumberParam {
    readonly kind: 'number';
    readonly def: number;
    readonly min: number;
    readonly max: number;
    readonly integer: boolean;
}
interface EnumParam {
    readonly kind: 'enum';
    readonly def: string;
    readonly values: readonly string[];
}
interface ListParam {
    readonly kind: 'list';
    readonly min: number;
    readonly max: number;
    readonly maxLength: number;
}
type ParamDef = NumberParam | EnumParam | ListParam;
type Schema = Readonly<Record<string, ParamDef>>;

const num = (def: number, min: number, max: number, integer = false): NumberParam => ({ kind: 'number', def, min, max, integer });
const oneOf = (def: string, ...values: string[]): EnumParam => ({ kind: 'enum', def, values });
const list = (min: number, max: number, maxLength: number): ListParam => ({ kind: 'list', min, max, maxLength });

const HALL = (w: number, d: number, h: number): Schema => ({
    widthM: num(w, 8, 400),
    depthM: num(d, 20, 600),
    heightM: num(h, 3, 100)
});

const GATE_LAYOUT = oneOf('single', 'single', 'line', 'turn', 'course');

function gateSchema(thickness: number, hall: Schema): Schema {
    return {
        voxelM: num(0.1, 0.02, 0.5),
        ...hall,
        layout: GATE_LAYOUT,
        count: num(3, 1, 24, true),
        sizeM: num(3, 0.5, 12),
        sizes: list(0.5, 12, 24),
        thicknessM: num(thickness, 0.06, 0.6),
        gateY: num(3, 0.5, 99),
        aheadM: num(12, 3, 300),
        spacingM: num(14, 3, 100),
        offsetXM: num(0, -30, 30),
        offsetYM: num(0, -10, 10),
        turnDeg: num(90, -360, 360),
        yawMaxDeg: num(35, 0, 90),
        climbMaxM: num(1.5, 0, 6)
    };
}

export const PARAM_SCHEMAS: Readonly<Record<WorldGenerator, Schema>> = {
    open: {
        voxelM: num(0.1, 0.02, 0.5),
        ceilingM: num(0, 0, 200),
        halfSizeM: num(80, 10, 500),
        heightM: num(40, 5, 200),
        startHeightM: num(1.5, 0.2, 100),
        zoneDistanceM: num(0, 0, 300),
        zoneSizeM: num(6, 1, 40)
    },
    hall: {
        voxelM: num(0.1, 0.02, 0.5),
        ...HALL(40, 60, 12),
        startHeightM: num(1.5, 0.2, 99)
    },
    pillars: {
        voxelM: num(0.1, 0.02, 0.5),
        ...HALL(40, 60, 12),
        startHeightM: num(1.5, 0.2, 99),
        layout: oneOf('single', 'single', 'row', 'scatter'),
        count: num(5, 1, 24, true),
        radiusM: num(0.5, 0.1, 3),
        pillarHeightM: num(0, 0, 100),
        gapM: num(6, 1, 30),
        aheadM: num(15, 3, 300)
    },
    corridor: {
        voxelM: num(0.1, 0.02, 0.5),
        widthM: num(5, 1.5, 30),
        heightM: num(4, 1.5, 30),
        startHeightM: num(2, 0.2, 29),
        layout: oneOf('full', 'full', 'straight', 'obstacle', 'bends', 'jogs'),
        straightM: num(100, 10, 400),
        segmentM: num(15, 4, 80),
        bendCount: num(6, 2, 20, true),
        jogCount: num(4, 2, 12, true),
        riseM: num(3, 1, 12),
        obstacleRadiusM: num(0.5, 0.1, 3)
    },
    rings: gateSchema(0.1, HALL(60, 160, 20)),
    squares: gateSchema(0.15, HALL(60, 160, 20)),
    'cube-frames': gateSchema(0.15, HALL(60, 160, 20))
};

/** Checks `given` against the generator's schema and fills every default; throws WorldSpecError. */
export function resolveParams(generator: WorldGenerator, given: AnalyticWorldSpec['params']): ResolvedParams {
    const schema = PARAM_SCHEMAS[generator];
    for (const key of Object.keys(given)) {
        if (!(key in schema)) throw new WorldSpecError(`unknown parameter '${key}' for generator '${generator}'`);
    }
    const out: Record<string, ResolvedValue> = {};
    for (const name of Object.keys(schema).sort()) {
        const def = schema[name] as ParamDef;
        const v = given[name];
        const where = `parameter '${name}' of '${generator}'`;
        switch (def.kind) {
            case 'number': {
                if (v === undefined) out[name] = def.def;
                else if (typeof v !== 'number' || !Number.isFinite(v)) throw new WorldSpecError(`${where} must be a finite number`);
                else if (v < def.min || v > def.max) throw new WorldSpecError(`${where} must be between ${def.min} and ${def.max}, got ${v}`);
                else if (def.integer && !Number.isInteger(v)) throw new WorldSpecError(`${where} must be an integer, got ${v}`);
                else out[name] = v;
                break;
            }
            case 'enum': {
                if (v === undefined) out[name] = def.def;
                else if (typeof v !== 'string' || !def.values.includes(v)) throw new WorldSpecError(`${where} must be one of ${def.values.join(', ')}, got ${String(v)}`);
                else out[name] = v;
                break;
            }
            case 'list': {
                if (v === undefined) out[name] = [];
                else if (!Array.isArray(v) || v.length > def.maxLength) throw new WorldSpecError(`${where} must be a list of at most ${def.maxLength} numbers`);
                else if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= def.min && x <= def.max)) {
                    throw new WorldSpecError(`${where} must hold numbers between ${def.min} and ${def.max}`);
                } else out[name] = [...v];
                break;
            }
        }
    }
    return out;
}

// ------------------------------------------------------------------ the built world

export interface Landmark {
    readonly id: string;
    readonly pos: Vec3;
}

export interface Built {
    /** everything solid that is not an object: floor, walls, ceiling, the corridor's hollow */
    readonly shell: Part;
    readonly objects: SonicObject[];
    readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
    readonly landmarks: Landmark[];
    readonly start: Pose;
}

const n = (p: ResolvedParams, name: string): number => p[name] as number;
const s = (p: ResolvedParams, name: string): string => p[name] as string;

function hollowBounds(boxes: readonly Box[]): { min: Vec3; max: Vec3 } {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of boxes) {
        minX = Math.min(minX, b.cx - b.hx); maxX = Math.max(maxX, b.cx + b.hx);
        minY = Math.min(minY, b.cy - b.hy); maxY = Math.max(maxY, b.cy + b.hy);
        minZ = Math.min(minZ, b.cz - b.hz); maxZ = Math.max(maxZ, b.cz + b.hz);
    }
    const t = SHELL_THICKNESS_M;
    return { min: [round6(minX - t), round6(minY - t), round6(minZ - t)], max: [round6(maxX + t), round6(maxY + t), round6(maxZ + t)] };
}

function hallBox(w: number, d: number, h: number): Box {
    return { cx: 0, cy: h / 2, cz: 0, hx: w / 2, hy: h / 2, hz: d / 2 };
}

function requireInside(what: string, startHeight: number, h: number): void {
    if (startHeight > h - 0.5) throw new WorldSpecError(`${what}: the start height ${startHeight} is too close to the ceiling at ${h}`);
}

function object(id: string, shape: SonicObject['shape'], pos: Vec3, yawDeg: number, order: number | null, solid: boolean, material: SonicObject['material']): SonicObject {
    const q = yawQuat(yawDeg);
    return {
        id,
        shape,
        pos: [round6(pos[0]), round6(pos[1]), round6(pos[2])],
        quat: [round9(q[0]), round9(q[1]), round9(q[2]), round9(q[3])],
        order,
        solid,
        material
    };
}

// ------------------------------------------------------------------ open

function buildOpen(p: ResolvedParams): Built {
    const half = n(p, 'halfSizeM');
    const ceiling = n(p, 'ceilingM');
    const top = ceiling > 0 ? ceiling : n(p, 'heightM');
    const startY = n(p, 'startHeightM');
    if (ceiling > 0) requireInside('open', startY, ceiling);
    const objects: SonicObject[] = [];
    const landmarks: Landmark[] = [{ id: 'start', pos: [0, startY, 0] }];
    const zoneDistance = n(p, 'zoneDistanceM');
    if (zoneDistance > 0) {
        const size = n(p, 'zoneSizeM');
        objects.push(object('zone-1', { kind: 'zone', size: [size, size, size] }, [0, startY, -zoneDistance], 0, 0, false, 'floor'));
        landmarks.push({ id: 'zone', pos: [0, startY, -zoneDistance] });
    }
    const t = SHELL_THICKNESS_M;
    return {
        shell: slabShell(0, ceiling > 0 ? ceiling : null),
        objects,
        bounds: { min: [-half, -t, -half], max: [half, top + (ceiling > 0 ? t : 0), half] },
        landmarks,
        start: { pos: [0, startY, 0], yawDeg: 0 }
    };
}

// ------------------------------------------------------------------ hall

function buildHall(p: ResolvedParams): Built {
    const w = n(p, 'widthM'), d = n(p, 'depthM'), h = n(p, 'heightM'), y = n(p, 'startHeightM');
    requireInside('hall', y, h);
    const boxes = [hallBox(w, d, h)];
    return {
        shell: cavityShell(boxes),
        objects: [],
        bounds: hollowBounds(boxes),
        landmarks: [
            { id: 'start', pos: [0, y, 0] },
            { id: 'wall-front', pos: [0, y, -d / 2] },
            { id: 'wall-back', pos: [0, y, d / 2] },
            { id: 'wall-left', pos: [-w / 2, y, 0] },
            { id: 'wall-right', pos: [w / 2, y, 0] }
        ],
        start: { pos: [0, y, 0], yawDeg: 0 }
    };
}

// ------------------------------------------------------------------ pillars

/** z of the start in a hall with objects ahead: near the +Z end, so the room lies ahead. */
function startZ(d: number): number {
    return d / 2 - Math.min(8, d / 4);
}

function buildPillars(p: ResolvedParams, rng: Rng): Built {
    const w = n(p, 'widthM'), d = n(p, 'depthM'), h = n(p, 'heightM'), y = n(p, 'startHeightM');
    requireInside('pillars', y, h);
    const r = n(p, 'radiusM');
    const ph = n(p, 'pillarHeightM') > 0 ? n(p, 'pillarHeightM') : h;
    if (ph > h) throw new WorldSpecError(`pillars: pillarHeightM ${ph} is taller than the hall ${h}`);
    const z0 = startZ(d);
    const zFront = z0 - n(p, 'aheadM');
    const margin = 3;
    const spots: [number, number][] = [];
    const layout = s(p, 'layout');
    if (layout === 'single') {
        spots.push([0, zFront]);
    } else if (layout === 'row') {
        const count = n(p, 'count');
        const pitch = 2 * r + n(p, 'gapM');
        for (let i = 0; i < count; i++) spots.push([(i - (count - 1) / 2) * pitch, zFront]);
        const reach = ((count - 1) / 2) * pitch + r;
        if (reach + margin > w / 2) throw new WorldSpecError(`pillars: a row of ${count} does not fit a hall ${w} m wide`);
    } else {
        const count = n(p, 'count');
        const xMax = w / 2 - margin - r;
        const zMin = -(d / 2 - margin - r);
        const zMax = z0 - 8;
        const minDist = 2 * r + 3.5;
        for (let attempt = 0; attempt < 4000 && spots.length < count; attempt++) {
            const x = rng.range(-xMax, xMax);
            const z = rng.range(zMin, zMax);
            if (spots.every(([ox, oz]) => Math.hypot(ox - x, oz - z) >= minDist)) spots.push([x, z]);
        }
        if (spots.length < count) throw new WorldSpecError(`pillars: cannot place ${count} pillars in the hall without crowding`);
    }
    for (const [x, z] of spots) {
        if (z - r < -d / 2 + margin || z + r > d / 2 - margin || Math.abs(x) + r + margin > w / 2) {
            throw new WorldSpecError('pillars: a pillar does not fit in the hall; make the hall larger or aheadM smaller');
        }
    }
    const objects = spots.map(([x, z], i) => object(`pillar-${i + 1}`, { kind: 'pillar', radius: r, height: ph }, [x, ph / 2, z], 0, null, true, 'obstacle'));
    const boxes = [hallBox(w, d, h)];
    return {
        shell: cavityShell(boxes),
        objects,
        bounds: hollowBounds(boxes),
        landmarks: [{ id: 'start', pos: [0, y, z0] }],
        start: { pos: [0, y, z0], yawDeg: 0 }
    };
}

// ------------------------------------------------------------------ corridor

function buildCorridor(p: ResolvedParams): Built {
    const w = n(p, 'widthM'), h = n(p, 'heightM'), startY = n(p, 'startHeightM');
    requireInside('corridor', startY, h);
    const layout = s(p, 'layout');
    const seg = n(p, 'segmentM');
    const rise = n(p, 'riseM');
    const obstacleR = n(p, 'obstacleRadiusM');
    if (2 * obstacleR > w - 1) throw new WorldSpecError(`corridor: an obstacle of radius ${obstacleR} leaves less than 0.5 m on each side in a corridor ${w} m wide`);
    const even = (k: number): number => (k % 2 === 0 ? k : k + 1);
    const bends = even(n(p, 'bendCount'));
    const jogs = even(n(p, 'jogCount'));

    const boxes: Box[] = [];
    const objects: SonicObject[] = [];
    const landmarks: Landmark[] = [];
    let x = 0, y = 0, z = 0;
    let hx = 0, hz = -1; // heading on the floor plane: -Z first

    const mark = (id: string): void => {
        landmarks.push({ id, pos: [round6(x), round6(y + startY), round6(z)] });
    };
    const forward = (len: number): void => {
        const nx = x + hx * len, nz = z + hz * len;
        const alongX = hx !== 0;
        const half = len / 2 + w / 2; // each end reaches w / 2 past the corner, so two segments meet in a full square
        boxes.push({ cx: (x + nx) / 2, cy: y + h / 2, cz: (z + nz) / 2, hx: alongX ? half : w / 2, hy: h / 2, hz: alongX ? w / 2 : half });
        x = nx;
        z = nz;
    };
    const turn = (dir: 'left' | 'right'): void => {
        const [a, b] = dir === 'right' ? [-hz, hx] : [hz, -hx];
        hx = a + 0;
        hz = b + 0;
    };
    const jog = (dy: number): void => {
        const lo = Math.min(y, y + dy), hi = Math.max(y, y + dy);
        boxes.push({ cx: x, cy: (lo + hi + h) / 2, cz: z, hx: w / 2, hy: (hi - lo + h) / 2, hz: w / 2 });
        y += dy;
    };
    const pillar = (along: number, lateral: number): void => {
        const px = x + hx * along + -hz * lateral;
        const pz = z + hz * along + hx * lateral;
        objects.push(object(`pillar-${objects.length + 1}`, { kind: 'pillar', radius: obstacleR, height: h }, [px, y + h / 2, pz], 0, null, true, 'obstacle'));
    };

    const straight = (): void => {
        mark('section-straight');
        forward(n(p, 'straightM'));
    };
    const obstacle = (): void => {
        mark('section-obstacle');
        pillar(seg, 0);
        forward(2 * seg);
    };
    const bendSection = (): void => {
        mark('section-bends');
        for (let i = 0; i < bends; i++) {
            turn(i % 2 === 0 ? 'right' : 'left');
            forward(seg);
        }
    };
    const jogSection = (): void => {
        mark('section-jogs');
        forward(seg);
        for (let i = 0; i < jogs; i++) {
            jog(i % 2 === 0 ? rise : -rise);
            forward(seg);
        }
    };
    const mixedSection = (): void => {
        mark('section-mixed');
        for (let i = 0; i < bends; i++) {
            turn(i % 2 === 0 ? 'right' : 'left');
            pillar(seg * 0.55, (i % 2 === 0 ? 1 : -1) * (w / 6));
            forward(seg);
        }
    };

    mark('start');
    switch (layout) {
        case 'straight':
            straight();
            break;
        case 'obstacle':
            forward(seg);
            obstacle();
            break;
        case 'bends':
            forward(seg);
            bendSection();
            break;
        case 'jogs':
            jogSection();
            break;
        default: // full: straight, obstacle, left-right bends, up-down bends, bends with obstacles
            straight();
            obstacle();
            bendSection();
            jogSection();
            mixedSection();
    }
    mark('end');

    return {
        shell: cavityShell(boxes),
        objects,
        bounds: hollowBounds(boxes),
        landmarks,
        start: { pos: [0, startY, 0], yawDeg: 0 }
    };
}

// ------------------------------------------------------------------ gates (rings, squares, cube frames)

interface GateAt {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
}

function buildGates(kind: 'ring' | 'square' | 'cube-frame', p: ResolvedParams, rng: Rng): Built {
    const w = n(p, 'widthM'), d = n(p, 'depthM'), h = n(p, 'heightM');
    const gateY = n(p, 'gateY');
    const layout = s(p, 'layout');
    const thickness = n(p, 'thicknessM');
    const given = p['sizes'] as readonly number[];
    const count = layout === 'single' ? 1 : given.length > 0 ? given.length : n(p, 'count');
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) sizes.push(given.length > 0 ? (given[Math.min(i, given.length - 1)] as number) : n(p, 'sizeM'));

    const shapeOf = (size: number): SonicObject['shape'] =>
        kind === 'ring' ? { kind: 'ring', diameter: size, tube: thickness } : kind === 'square' ? { kind: 'square', side: size, bar: thickness } : { kind: 'cube-frame', side: size, bar: thickness };
    // how far each gate reaches from its centre: sideways whatever its yaw (a circle), and up and down
    const reach = sizes.map((size) => {
        const [ex, ey, ez] = shapeHalfExtents(shapeOf(size));
        return { side: Math.hypot(ex, ez), vertical: ey };
    });

    const margin = 1;
    const z0 = startZ(d);
    /** gate i at (gx, gy, gz) stays at least `margin` clear of the walls, the floor and the ceiling */
    const fits = (gx: number, gy: number, gz: number, i: number): boolean => {
        const r = reach[i] as { side: number; vertical: number };
        return Math.abs(gx) + r.side + margin <= w / 2 && Math.abs(gz) + r.side + margin <= d / 2 && gy - r.vertical >= margin && gy + r.vertical + margin <= h;
    };

    const gates: GateAt[] = [];
    const ahead = n(p, 'aheadM');
    const spacing = n(p, 'spacingM');
    const fail = (i: number): never => {
        throw new WorldSpecError(`${kind}: gate ${i + 1} does not fit in a hall ${w} x ${d} x ${h} m; make the hall larger or the course shorter`);
    };

    if (layout === 'single') {
        gates.push({ x: n(p, 'offsetXM'), y: gateY + n(p, 'offsetYM'), z: z0 - ahead, yaw: 0 });
    } else if (layout === 'line') {
        for (let i = 0; i < count; i++) gates.push({ x: 0, y: gateY, z: z0 - ahead - i * spacing, yaw: 0 });
    } else if (layout === 'turn') {
        const total = n(p, 'turnDeg');
        let gx = 0, gz = z0 - ahead;
        for (let i = 0; i < count; i++) {
            const yaw = count === 1 ? 0 : (total * i) / (count - 1);
            gates.push({ x: gx, y: gateY, z: gz, yaw });
            gx += spacing * Math.sin(yaw * DEG);
            gz -= spacing * Math.cos(yaw * DEG);
        }
    } else {
        // course: a weaving path. Every leg runs within yawMaxDeg of straight ahead, so the course
        // always advances; the heading wanders by at most 0.7 * yawMaxDeg from leg to leg, flips
        // toward the middle when a leg would leave the hall, and the height wanders within the
        // hall. Per leg, in this order, the draws are: heading change, spacing factor, height
        // change. A gate faces along the bisector of the legs on either side of it (the first and
        // the last along their one leg), so a craft meets every gate at most yawMaxDeg off its axis.
        const yawMax = n(p, 'yawMaxDeg');
        const climbMax = n(p, 'climbMaxM');
        const sideMax = Math.max(...reach.map((r) => r.side));
        const upMax = Math.max(...reach.map((r) => r.vertical));
        const xLimit = w / 2 - margin - sideMax;
        const yLow = margin + upMax, yHigh = h - margin - upMax;
        let gx = 0, gy = Math.min(Math.max(gateY, yLow), yHigh), gz = z0 - ahead, heading = 0;
        const points: [number, number, number][] = [[gx, gy, gz]];
        const legs: number[] = [];
        for (let i = 1; i < count; i++) {
            heading = Math.min(Math.max(heading + rng.range(-0.7 * yawMax, 0.7 * yawMax), -yawMax), yawMax);
            const step = spacing * rng.range(0.85, 1.15);
            const dy = rng.range(-climbMax, climbMax);
            if (Math.abs(gx + step * Math.sin(heading * DEG)) > xLimit) heading = -Math.sign(gx) * Math.abs(heading);
            gx += step * Math.sin(heading * DEG);
            gz -= step * Math.cos(heading * DEG);
            gy = Math.min(Math.max(gy + dy, yLow), yHigh);
            points.push([gx, gy, gz]);
            legs.push(heading);
        }
        points.forEach(([x, y, z], i) => {
            const incoming = legs[i - 1];
            const outgoing = legs[i];
            const yaw = incoming === undefined ? (outgoing ?? 0) : outgoing === undefined ? incoming : incoming + (outgoing - incoming) / 2;
            gates.push({ x, y, z, yaw });
        });
    }
    gates.forEach((g, i) => {
        if (!fits(g.x, g.y, g.z, i)) fail(i);
    });

    const prefix = kind === 'cube-frame' ? 'cube' : kind;
    const objects = gates.map((g, i) => object(`${prefix}-${i + 1}`, shapeOf(sizes[i] as number), [g.x, g.y, g.z], g.yaw, i, true, 'obstacle'));
    const boxes = [hallBox(w, d, h)];
    return {
        shell: cavityShell(boxes),
        objects,
        bounds: hollowBounds(boxes),
        landmarks: [{ id: 'start', pos: [0, gateY, z0] }],
        start: { pos: [0, gateY, z0], yawDeg: 0 }
    };
}

// ------------------------------------------------------------------ dispatch

/** Builds the geometry of a resolved spec. */
export function buildWorld(generator: WorldGenerator, params: ResolvedParams, seed: number): Built {
    const rng = createRng(seed);
    switch (generator) {
        case 'open':
            return buildOpen(params);
        case 'hall':
            return buildHall(params);
        case 'pillars':
            return buildPillars(params, rng);
        case 'corridor':
            return buildCorridor(params);
        case 'rings':
            return buildGates('ring', params, rng);
        case 'squares':
            return buildGates('square', params, rng);
        case 'cube-frames':
            return buildGates('cube-frame', params, rng);
    }
}

export function isWorldGenerator(name: string): name is WorldGenerator {
    return (WORLD_GENERATORS as readonly string[]).includes(name);
}

