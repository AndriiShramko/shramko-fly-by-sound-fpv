// Version 2 of the room generators (v0.13, owner's message 41, M41-18 and M41-22): rooms at the scale
// of a micro drone. What changed against version 1 (src/world/v1.ts):
//   - the ranges take rooms of a few metres (width and depth from 2 m, height from 1.5 m), and the
//     defaults are such rooms: the hall's walls 2 to 3 s away at 3 m/s and its ceiling about 2 s away
//     at 1 m/s; the pillars' and the gates' rooms just large enough for every layout with its defaults
//     (a lesson names its own room);
//   - the start stands `startBackM` in front of the back wall (version 1: d / 2 - min(8, d / 4));
//   - pillars keep 1 m from the walls (version 1: 3 m), scattered ones 1.5 m from each other
//     (version 1: 3.5 m) and 2 m in front of the start (version 1: 8 m);
//   - gates keep 1 m from the walls and 0.3 m from the floor and the ceiling (version 1: 1 m from all),
//     so a gate can sit near the floor or under the ceiling;
//   - gates take `heights` (M41-22): a list of metres, or level names joined by commas: floor (as low
//     as the gate fits), ceiling (as high as it fits), middle (half the room's height). A course's
//     random walk still draws its heights in the same order and then takes the given ones. With
//     heights the craft starts at the first gate's height, else at gateY as in version 1.
// The hollow is still one box centred on (0, h / 2, 0), so the simulator's mirror of the halls
// (apps/fly/src/sonic/primitives.ts cavityBoxes) stays right for these rooms.
import type { SonicObject, WorldGenerator } from '../contract';
import type { Rng } from '../util/rng';
import { DEG } from '../util/vec';
import { hallBox, hollowBounds, n, object, requireInside, s, type Built } from './build';
import { heights, list, num, oneOf, WorldSpecError, type ResolvedParams, type Schema } from './params';
import { cavityShell, shapeHalfExtents } from './parts';

/** Gates and pillars keep this far from the walls, metres. */
export const WALL_MARGIN_M = 1;
/** Gates keep this far from the floor and the ceiling, metres. */
export const FLOOR_MARGIN_M = 0.3;
/** The level names a gate's height can be given by. */
export const LEVELS = ['floor', 'middle', 'ceiling'] as const;

const ROOM = (w: number, d: number, h: number): Schema => ({
    widthM: num(w, 2, 400),
    depthM: num(d, 2, 600),
    heightM: num(h, 1.5, 100)
});

function gateSchema(thickness: number): Schema {
    return {
        voxelM: num(0.1, 0.02, 0.5),
        ...ROOM(16, 24.5, 5.2),
        startBackM: num(1.5, 0.5, 300),
        layout: oneOf('single', 'single', 'line', 'turn', 'course'),
        count: num(3, 1, 24, true),
        sizeM: num(3, 0.5, 12),
        sizes: list(0.5, 12, 24),
        thicknessM: num(thickness, 0.06, 0.6),
        gateY: num(3, 0.3, 99),
        heights: heights(0.3, 99, 24, LEVELS),
        aheadM: num(5.5, 0, 300),
        spacingM: num(6, 2, 100),
        offsetXM: num(0, -30, 30),
        offsetYM: num(0, -10, 10),
        turnDeg: num(90, -360, 360),
        yawMaxDeg: num(35, 0, 90),
        climbMaxM: num(1.5, 0, 6)
    };
}

type RoomGenerator = 'hall' | 'pillars' | 'rings' | 'squares' | 'cube-frames';

export const V2_ROOM_SCHEMAS: Readonly<Record<RoomGenerator, Schema>> = {
    hall: {
        voxelM: num(0.1, 0.02, 0.5),
        ...ROOM(10, 12, 3.2),
        startHeightM: num(1.5, 0.2, 99)
    },
    pillars: {
        voxelM: num(0.1, 0.02, 0.5),
        ...ROOM(12, 12.5, 3.2),
        startHeightM: num(1.5, 0.2, 99),
        startBackM: num(1.5, 0.5, 300),
        layout: oneOf('single', 'single', 'row', 'scatter'),
        count: num(5, 1, 24, true),
        radiusM: num(0.3, 0.05, 3),
        pillarHeightM: num(0, 0, 100),
        gapM: num(1.7, 0.5, 30),
        aheadM: num(5.5, 1, 300)
    },
    rings: gateSchema(0.1),
    squares: gateSchema(0.15),
    'cube-frames': gateSchema(0.15)
};

/** z of the start: `startBackM` in front of the back wall (+Z end), so the room lies ahead. */
function startZ(p: ResolvedParams): number {
    const d = n(p, 'depthM');
    const back = n(p, 'startBackM');
    if (back > d - 0.5) throw new WorldSpecError(`the start ${back} m from the back wall does not fit a room ${d} m deep`);
    return d / 2 - back;
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

function buildPillars(p: ResolvedParams, rng: Rng): Built {
    const w = n(p, 'widthM'), d = n(p, 'depthM'), h = n(p, 'heightM'), y = n(p, 'startHeightM');
    requireInside('pillars', y, h);
    const r = n(p, 'radiusM');
    const ph = n(p, 'pillarHeightM') > 0 ? n(p, 'pillarHeightM') : h;
    if (ph > h) throw new WorldSpecError(`pillars: pillarHeightM ${ph} is taller than the room ${h}`);
    const z0 = startZ(p);
    const zFront = z0 - n(p, 'aheadM');
    const margin = WALL_MARGIN_M;
    const spots: [number, number][] = [];
    const layout = s(p, 'layout');
    if (layout === 'single') {
        spots.push([0, zFront]);
    } else if (layout === 'row') {
        const count = n(p, 'count');
        const pitch = 2 * r + n(p, 'gapM');
        for (let i = 0; i < count; i++) spots.push([(i - (count - 1) / 2) * pitch, zFront]);
        const reach = ((count - 1) / 2) * pitch + r;
        if (reach + margin > w / 2) throw new WorldSpecError(`pillars: a row of ${count} does not fit a room ${w} m wide`);
    } else {
        const count = n(p, 'count');
        const xMax = w / 2 - margin - r;
        const zMin = -(d / 2 - margin - r);
        const zMax = z0 - 2;
        const minDist = 2 * r + 1.5;
        for (let attempt = 0; attempt < 4000 && spots.length < count; attempt++) {
            const x = rng.range(-xMax, xMax);
            const z = rng.range(zMin, zMax);
            if (spots.every(([ox, oz]) => Math.hypot(ox - x, oz - z) >= minDist)) spots.push([x, z]);
        }
        if (spots.length < count) throw new WorldSpecError(`pillars: cannot place ${count} pillars in the room without crowding`);
    }
    for (const [x, z] of spots) {
        if (z - r < -d / 2 + margin || z + r > d / 2 - margin || Math.abs(x) + r + margin > w / 2) {
            throw new WorldSpecError('pillars: a pillar does not fit in the room; make the room larger or aheadM smaller');
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

    // the heights asked for, one per gate (the last one repeats): metres, or levels
    const asked = p['heights'] as string | readonly number[];
    const levels = typeof asked === 'string' ? asked.split(',') : null;
    const heightOf = (i: number): number | null => {
        const r = reach[i] as { side: number; vertical: number };
        if (levels !== null) {
            const level = levels[Math.min(i, levels.length - 1)] as string;
            return level === 'floor' ? FLOOR_MARGIN_M + r.vertical : level === 'ceiling' ? h - FLOOR_MARGIN_M - r.vertical : h / 2;
        }
        const list = asked as readonly number[];
        return list.length === 0 ? null : (list[Math.min(i, list.length - 1)] as number);
    };

    const z0 = startZ(p);
    /** gate i at (gx, gy, gz) keeps WALL_MARGIN_M from the walls and FLOOR_MARGIN_M from the floor and the ceiling (to a nanometre: a level is placed exactly at its margin) */
    const fits = (gx: number, gy: number, gz: number, i: number): boolean => {
        const r = reach[i] as { side: number; vertical: number };
        const e = 1e-9;
        return Math.abs(gx) + r.side + WALL_MARGIN_M <= w / 2 + e && Math.abs(gz) + r.side + WALL_MARGIN_M <= d / 2 + e && gy - r.vertical >= FLOOR_MARGIN_M - e && gy + r.vertical + FLOOR_MARGIN_M <= h + e;
    };

    const gates: GateAt[] = [];
    const ahead = n(p, 'aheadM');
    const spacing = n(p, 'spacingM');
    const fail = (i: number): never => {
        throw new WorldSpecError(`${kind}: gate ${i + 1} does not fit in a room ${w} x ${d} x ${h} m; make the room larger or the course shorter`);
    };

    if (layout === 'single') {
        gates.push({ x: n(p, 'offsetXM'), y: heightOf(0) ?? gateY + n(p, 'offsetYM'), z: z0 - ahead, yaw: 0 });
    } else if (layout === 'line') {
        for (let i = 0; i < count; i++) gates.push({ x: 0, y: heightOf(i) ?? gateY, z: z0 - ahead - i * spacing, yaw: 0 });
    } else if (layout === 'turn') {
        const total = n(p, 'turnDeg');
        let gx = 0, gz = z0 - ahead;
        for (let i = 0; i < count; i++) {
            const yaw = count === 1 ? 0 : (total * i) / (count - 1);
            gates.push({ x: gx, y: heightOf(i) ?? gateY, z: gz, yaw });
            gx += spacing * Math.sin(yaw * DEG);
            gz -= spacing * Math.cos(yaw * DEG);
        }
    } else {
        // course: a weaving path, as version 1 (src/world/v1.ts) with this version's margins. Per leg, in
        // this order, the draws are: heading change, spacing factor, height change; given heights replace
        // the drawn ones after the walk, so the draws stay the same.
        const yawMax = n(p, 'yawMaxDeg');
        const climbMax = n(p, 'climbMaxM');
        const sideMax = Math.max(...reach.map((r) => r.side));
        const upMax = Math.max(...reach.map((r) => r.vertical));
        const xLimit = w / 2 - WALL_MARGIN_M - sideMax;
        const yLow = FLOOR_MARGIN_M + upMax, yHigh = h - FLOOR_MARGIN_M - upMax;
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
            gates.push({ x, y: heightOf(i) ?? y, z, yaw });
        });
    }
    gates.forEach((g, i) => {
        if (!fits(g.x, g.y, g.z, i)) fail(i);
    });

    const prefix = kind === 'cube-frame' ? 'cube' : kind;
    const objects = gates.map((g, i) => object(`${prefix}-${i + 1}`, shapeOf(sizes[i] as number), [g.x, g.y, g.z], g.yaw, i, true, 'obstacle'));
    // the craft starts at gateY (as in version 1), or at the first gate's height when heights are given
    const startY = heightOf(0) ?? gateY;
    requireInside(kind, startY, h);
    const boxes = [hallBox(w, d, h)];
    return {
        shell: cavityShell(boxes),
        objects,
        bounds: hollowBounds(boxes),
        landmarks: [{ id: 'start', pos: [0, startY, z0] }],
        start: { pos: [0, startY, z0], yawDeg: 0 }
    };
}

// ------------------------------------------------------------------ dispatch

/** Builds the geometry of a resolved version-2 spec of a room generator. */
export function buildRoomV2(generator: WorldGenerator, params: ResolvedParams, rng: Rng): Built {
    switch (generator) {
        case 'hall':
            return buildHall(params);
        case 'pillars':
            return buildPillars(params, rng);
        case 'rings':
            return buildGates('ring', params, rng);
        case 'squares':
            return buildGates('square', params, rng);
        case 'cube-frames':
            return buildGates('cube-frame', params, rng);
        default:
            throw new WorldSpecError(`generator '${generator}' has no room of version 2`);
    }
}
