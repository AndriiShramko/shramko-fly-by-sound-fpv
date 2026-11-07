// The shape layer (spec section 2): one point source traces the outline of an object at its real
// size, so the object grows around the head as it nears. A ring is a smooth orbit; a square is the
// same lap with a tick at each corner; a cube frame runs the square lap while the source jumps
// between its front and back faces (a tick at each jump); a pillar is a sweep up and down its
// height on the side that faces the listener (a soft tick at the top and the bottom).
//
// Times are seconds of whatever clock the caller keeps (the engine: the audio clock). Positions are
// in the object's own frame: the opening faces local Z, and a forward pass travels along local -Z,
// so the face a craft meets first is the +Z one.
import type { ObjectShape, Vec3 } from '../contract';

export interface ShapeRule {
    /** turns per second of a ring orbit, and laps per second of a square or a cube face */
    readonly orbitHz: number;
    /** sweeps (up and down) per second along a pillar */
    readonly sweepHz: number;
    /** alternations per second between the front and back of a cube */
    readonly faceHz: number;
}

export type TraceKind = 'ring' | 'square' | 'cube-frame' | 'pillar';

export function traceKind(shape: ObjectShape): TraceKind | null {
    switch (shape.kind) {
        case 'ring':
        case 'square':
        case 'cube-frame':
        case 'pillar':
            return shape.kind;
        default:
            return null;
    }
}

const frac = (x: number): number => x - Math.floor(x);

/** A point of a square lap of half-side h at lap phase u (0..1): corners at u = 0, 1/4, 1/2, 3/4. */
function squareLap(h: number, u: number): [number, number] {
    const corners: [number, number][] = [
        [h, h],
        [h, -h],
        [-h, -h],
        [-h, h]
    ];
    const s = frac(u) * 4;
    const k = Math.floor(s) % 4;
    const f = s - Math.floor(s);
    const a = corners[k] as [number, number];
    const b = corners[(k + 1) % 4] as [number, number];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * Where the traced point is at time `tS`, in the object's local frame. `toward` is the horizontal
 * unit direction, in the local frame, from the object's axis to the listener: a pillar is swept on
 * that side. Null for a shape the layer does not trace (box, zone).
 */
export function shapePoint(shape: ObjectShape, rule: ShapeRule, tS: number, toward: Vec3 = [0, 0, 1]): Vec3 | null {
    switch (shape.kind) {
        case 'ring': {
            const r = shape.diameter / 2 + shape.tube;
            const a = 2 * Math.PI * frac(rule.orbitHz * tS);
            return [r * Math.cos(a), r * Math.sin(a), 0];
        }
        case 'square': {
            const [x, y] = squareLap(shape.side / 2 + shape.bar / 2, rule.orbitHz * tS);
            return [x, y, 0];
        }
        case 'cube-frame': {
            const h = shape.side / 2 + shape.bar / 2;
            const [x, y] = squareLap(h, rule.orbitHz * tS);
            const front = Math.floor(rule.faceHz * tS) % 2 === 0;
            return [x, y, front ? h : -h];
        }
        case 'pillar': {
            const u = frac(rule.sweepHz * tS);
            const tri = u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
            const len = Math.hypot(toward[0], toward[2]);
            const tx = len > 1e-9 ? toward[0] / len : 0;
            const tz = len > 1e-9 ? toward[2] / len : 1;
            return [shape.radius * tx, (shape.height / 2) * tri, shape.radius * tz];
        }
        default:
            return null;
    }
}

/** Times in (t0, t1] when `k / rate` falls, for integer k. */
function ticks(rate: number, t0: number, t1: number): number[] {
    if (!(rate > 0) || !(t1 > t0)) return [];
    const out: number[] = [];
    const first = Math.floor(t0 * rate) + 1;
    const last = Math.floor(t1 * rate);
    for (let k = first; k <= last && out.length < 256; k++) out.push(k / rate);
    return out;
}

/** The accents of the trace in (t0, t1]: square corners, cube face jumps, the ends of a pillar sweep. A ring has none. */
export function shapeAccents(shape: ObjectShape, rule: ShapeRule, t0: number, t1: number): number[] {
    switch (shape.kind) {
        case 'square':
            return ticks(4 * rule.orbitHz, t0, t1);
        case 'cube-frame':
            return ticks(rule.faceHz, t0, t1);
        case 'pillar':
            return ticks(2 * rule.sweepHz, t0, t1);
        default:
            return [];
    }
}

/** Radius of the outline the trace runs on, m: how big the object is to the ear. */
export function traceRadius(shape: ObjectShape): number {
    switch (shape.kind) {
        case 'ring':
            return shape.diameter / 2 + shape.tube;
        case 'square':
            return Math.SQRT2 * (shape.side / 2 + shape.bar / 2);
        case 'cube-frame':
            return Math.sqrt(3) * (shape.side / 2 + shape.bar / 2);
        case 'pillar':
            return Math.hypot(shape.radius, shape.height / 2);
        case 'box':
            return Math.hypot(shape.size[0], shape.size[1], shape.size[2]) / 2;
        case 'zone':
            return 0;
    }
}
