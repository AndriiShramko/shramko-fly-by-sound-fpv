// The solid pieces an analytic world is made of. A Part answers one question, the signed distance
// to itself; the world takes the minimum over its parts (a union of solids). Objects (gates,
// pillars, boxes) become Parts through their pose; the room itself (floor, walls, ceiling, the
// corridor's hollow) is one or more 'shell' Parts with no object id.
//
// Object shapes (contract ObjectShape), as built here, all in the object's local frame with the
// opening facing local Z:
//   ring        torus in the XY plane; `diameter` is the CLEAR opening, `tube` the tube RADIUS, so the
//               centre line has radius diameter / 2 + tube
//   square      four bars `bar` x `bar`; `side` is the CLEAR opening, outer side = side + 2 * bar
//   cube-frame  twelve bars `bar` x `bar`; `side` is the clear opening of every face, outer side = side + 2 * bar
//   pillar      vertical cylinder, `height` centred on the object's position
//   box         `size` is the full extents
//   zone        no geometry (nothing to hit or to collide with)
import type { MaterialClass, ObjectShape, SonicObject, Vec3 } from '../contract';
import { quatMatrix } from '../util/vec';
import { sdBox, sdCubeFrame, sdCylinderY, sdSquareFrame, sdTorusZ } from './sdf';

export interface Bound {
    readonly cx: number;
    readonly cy: number;
    readonly cz: number;
    /** every point of the part lies within r of the centre */
    readonly r: number;
}

export interface Part {
    /** the SonicObject this is, or null for the room shell */
    readonly id: string | null;
    /** fixed timbre class, or null: decided by the surface direction (floor, ceiling, wall) */
    readonly material: MaterialClass | null;
    /** a bounding sphere, or null for a part that reaches everywhere (the shell) */
    readonly bound: Bound | null;
    /** a hollow shell: the boxes whose union is free (everything else is solid); absent for every other part */
    readonly cavities?: readonly Box[];
    sdf(x: number, y: number, z: number): number;
}

export interface Box {
    readonly cx: number;
    readonly cy: number;
    readonly cz: number;
    readonly hx: number;
    readonly hy: number;
    readonly hz: number;
}

/** Radius of a sphere around the shape's centre that holds all of it. */
export function shapeBoundRadius(shape: ObjectShape): number {
    switch (shape.kind) {
        case 'ring':
            return shape.diameter / 2 + 2 * shape.tube;
        case 'square': {
            const o = shape.side / 2 + shape.bar;
            return Math.hypot(o, o, shape.bar / 2);
        }
        case 'cube-frame': {
            const o = shape.side / 2 + shape.bar;
            return Math.hypot(o, o, o);
        }
        case 'pillar':
            return Math.hypot(shape.radius, shape.height / 2);
        case 'box':
        case 'zone':
            return Math.hypot(shape.size[0], shape.size[1], shape.size[2]) / 2;
    }
}

/** Half extents of the axis-aligned box that holds the shape before rotation. */
export function shapeHalfExtents(shape: ObjectShape): Vec3 {
    switch (shape.kind) {
        case 'ring': {
            const r = shape.diameter / 2 + 2 * shape.tube;
            return [r, r, shape.tube];
        }
        case 'square': {
            const o = shape.side / 2 + shape.bar;
            return [o, o, shape.bar / 2];
        }
        case 'cube-frame': {
            const o = shape.side / 2 + shape.bar;
            return [o, o, o];
        }
        case 'pillar':
            return [shape.radius, shape.height / 2, shape.radius];
        case 'box':
        case 'zone':
            return [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
    }
}

/** The solid Part of an object, or null for a shape with no geometry (a zone). */
export function objectPart(obj: SonicObject): Part | null {
    const shape = obj.shape;
    if (shape.kind === 'zone') return null;
    const [px, py, pz] = obj.pos;
    // local = R^T (p - pos), R the row-major rotation matrix of the object's quaternion
    const m = quatMatrix(obj.quat);
    const m0 = m[0] as number, m1 = m[1] as number, m2 = m[2] as number;
    const m3 = m[3] as number, m4 = m[4] as number, m5 = m[5] as number;
    const m6 = m[6] as number, m7 = m[7] as number, m8 = m[8] as number;

    let local: (lx: number, ly: number, lz: number) => number;
    switch (shape.kind) {
        case 'ring': {
            const R = shape.diameter / 2 + shape.tube;
            const r = shape.tube;
            local = (x, y, z) => sdTorusZ(x, y, z, R, r);
            break;
        }
        case 'square': {
            const a = shape.side / 2;
            const b = shape.bar;
            local = (x, y, z) => sdSquareFrame(x, y, z, a, b);
            break;
        }
        case 'cube-frame': {
            const a = shape.side / 2;
            const b = shape.bar;
            local = (x, y, z) => sdCubeFrame(x, y, z, a, b);
            break;
        }
        case 'pillar': {
            const r = shape.radius;
            const hh = shape.height / 2;
            local = (x, y, z) => sdCylinderY(x, y, z, r, hh);
            break;
        }
        case 'box': {
            const hx = shape.size[0] / 2, hy = shape.size[1] / 2, hz = shape.size[2] / 2;
            local = (x, y, z) => sdBox(x, y, z, hx, hy, hz);
            break;
        }
    }
    return {
        id: obj.id,
        material: obj.material,
        bound: { cx: px, cy: py, cz: pz, r: shapeBoundRadius(shape) },
        sdf(x, y, z) {
            const dx = x - px, dy = y - py, dz = z - pz;
            return local(m0 * dx + m3 * dy + m6 * dz, m1 * dx + m4 * dy + m7 * dz, m2 * dx + m5 * dy + m8 * dz);
        }
    };
}

/** The ground, and optionally a ceiling: solid below floorY and above ceilingY. */
export function slabShell(floorY: number, ceilingY: number | null): Part {
    return {
        id: null,
        material: null,
        bound: null,
        sdf: ceilingY === null ? (_x, y) => y - floorY : (_x, y) => Math.min(y - floorY, ceilingY - y)
    };
}

/**
 * A hollow: everything outside the union of the cavity boxes is solid. The value is exact outside
 * the cavities (inside the solid) and a lower bound inside them, which sphere tracing allows.
 */
export function cavityShell(boxes: readonly Box[]): Part {
    const n = boxes.length;
    const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n);
    const hx = new Float64Array(n), hy = new Float64Array(n), hz = new Float64Array(n);
    boxes.forEach((b, i) => {
        cx[i] = b.cx; cy[i] = b.cy; cz[i] = b.cz;
        hx[i] = b.hx; hy[i] = b.hy; hz[i] = b.hz;
    });
    return {
        id: null,
        material: null,
        bound: null,
        cavities: boxes.map((b) => ({ cx: b.cx, cy: b.cy, cz: b.cz, hx: b.hx, hy: b.hy, hz: b.hz })),
        sdf(x, y, z) {
            let best = Infinity;
            for (let i = 0; i < n; i++) {
                const d = sdBox(x - (cx[i] as number), y - (cy[i] as number), z - (cz[i] as number), hx[i] as number, hy[i] as number, hz[i] as number);
                if (d < best) best = d;
            }
            return -best;
        }
    };
}
