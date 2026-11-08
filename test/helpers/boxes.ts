// A world of axis-aligned boxes with exact ray casts, for tests that need a tunnel with an obstacle
// leaving a gap on one side (the free-way chime, M41-14): the inside of `room` is free, `blocks` are
// solid. A ray that starts inside a solid hits at once, as in the analytic worlds.
import type { MaterialClass, RayHit, SonicWorld, Vec3 } from '../../src/contract';

export interface Block {
    readonly min: Vec3;
    readonly max: Vec3;
}

const inside = (p: Vec3, b: Block): boolean => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];

/** Entry of a ray into a box: distance and outward normal of the face it enters, or null. */
function enter(o: Vec3, d: Vec3, b: Block): { t: number; n: Vec3 } | null {
    let t0 = -Infinity;
    let t1 = Infinity;
    let n: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
        const oa = o[a] as number, da = d[a] as number, lo = b.min[a] as number, hi = b.max[a] as number;
        if (Math.abs(da) < 1e-12) {
            if (oa <= lo || oa >= hi) return null;
            continue;
        }
        let ta = (lo - oa) / da, tb = (hi - oa) / da;
        let face = -1;
        if (ta > tb) {
            [ta, tb] = [tb, ta];
            face = 1;
        }
        if (ta > t0) {
            t0 = ta;
            const m: number[] = [0, 0, 0];
            m[a] = face;
            n = m as unknown as Vec3;
        }
        t1 = Math.min(t1, tb);
    }
    return t0 <= t1 && t0 >= 0 ? { t: t0, n } : null;
}

/** Exit of a ray out of the room box: distance and the inward normal of that face. */
function exit(o: Vec3, d: Vec3, room: Block): { t: number; n: Vec3 } {
    let best = Infinity;
    let n: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
        const da = d[a] as number;
        if (Math.abs(da) < 1e-12) continue;
        const wall = da > 0 ? (room.max[a] as number) : (room.min[a] as number);
        const t = (wall - (o[a] as number)) / da;
        if (t >= 0 && t < best) {
            best = t;
            const m: number[] = [0, 0, 0];
            m[a] = da > 0 ? -1 : 1;
            n = m as unknown as Vec3;
        }
    }
    return { t: best, n };
}

/** A tunnel along -Z (3 m wide, 3 m high by default) with solid `blocks` in it. */
export function boxTunnel(blocks: readonly Block[], room: Block = { min: [-1.5, 0, -200], max: [1.5, 3, 20] }): SonicWorld {
    return {
        kind: 'analytic',
        id: 'tunnel',
        version: 1,
        bounds: room,
        objects: () => [],
        castRay(o, d, maxDist): RayHit | null {
            if (!inside(o, room) || blocks.some((b) => inside(o, b))) return { distance: 0, point: o, normal: null, material: 'obstacle', objectId: 'block' };
            const wall = exit(o, d, room);
            let best: { t: number; n: Vec3; material: MaterialClass; id: string | null } = { t: wall.t, n: wall.n, material: wall.n[1] > 0.5 ? 'floor' : wall.n[1] < -0.5 ? 'ceiling' : 'wall', id: null };
            for (const b of blocks) {
                const e = enter(o, d, b);
                if (e !== null && e.t < best.t) best = { t: e.t, n: e.n, material: 'obstacle', id: 'block' };
            }
            if (best.t > maxDist) return null;
            return { distance: best.t, point: [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t], normal: best.n, material: best.material, objectId: best.id };
        }
    };
}

/** An obstacle across the tunnel from z0 to z1 (z1 > z0), x0..x1 by y0..y1. */
export function block(x0: number, x1: number, y0: number, y1: number, z0 = -8, z1 = -6): Block {
    return { min: [x0, y0, z0], max: [x1, y1, z1] };
}
