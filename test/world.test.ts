import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    canonicalJson,
    createAnalyticWorld,
    makeSpec,
    WORLD_GENERATORS,
    WorldSpecError,
    createRng,
    sha256Hex,
    type AnalyticWorldInfo,
    type AnalyticWorldSpec,
    type Vec3,
    type WorldGenerator
} from '../src';

const world = (generator: WorldGenerator, params: AnalyticWorldSpec['params'] = {}, seed = 0): AnalyticWorldInfo => createAnalyticWorld(makeSpec(generator, params, seed));

const close = (a: number, b: number, tol = 1e-3): void => {
    expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);
};
const closeVec = (a: Vec3 | null, b: Vec3, tol = 1e-3): void => {
    expect(a).not.toBeNull();
    const v = a as Vec3;
    for (let i = 0; i < 3; i++) close(v[i] as number, b[i] as number, tol);
};

describe('the hall, in closed form', () => {
    const hall = world('hall'); // 40 x 60 x 12, start at the middle, 1.5 m up
    const from = hall.start.pos;

    it.each([
        ['-Z', [0, 0, -1], 30, [0, 0, 1], 'wall'],
        ['+Z', [0, 0, 1], 30, [0, 0, -1], 'wall'],
        ['-X', [-1, 0, 0], 20, [1, 0, 0], 'wall'],
        ['+X', [1, 0, 0], 20, [-1, 0, 0], 'wall'],
        ['up', [0, 1, 0], 10.5, [0, -1, 0], 'ceiling'],
        ['down', [0, -1, 0], 1.5, [0, 1, 0], 'floor']
    ] as [string, Vec3, number, Vec3, string][])('a ray %s hits at the known distance with the known normal and material', (_name, dir, distance, normal, material) => {
        const hit = hall.castRay(from, dir, 100);
        expect(hit).not.toBeNull();
        close(hit!.distance, distance);
        closeVec(hit!.normal, normal);
        expect(hit!.material).toBe(material);
        expect(hit!.objectId).toBeNull();
        closeVec(hit!.point, [from[0] + dir[0] * distance, from[1] + dir[1] * distance, from[2] + dir[2] * distance]);
    });

    it('a diagonal ray hits the nearer wall first', () => {
        const hit = hall.castRay(from, [Math.SQRT1_2, 0, -Math.SQRT1_2], 100);
        close(hit!.distance, 20 * Math.SQRT2); // the +X wall is 20 away, the -Z wall 30
        closeVec(hit!.normal, [-1, 0, 0]);
    });

    it('a ray at 3 degrees to the floor hits it where trigonometry says', () => {
        const a = (3 * Math.PI) / 180;
        const hit = hall.castRay(from, [0, -Math.sin(a), -Math.cos(a)], 100);
        close(hit!.distance, 1.5 / Math.sin(a), 5e-3);
        expect(hit!.material).toBe('floor');
    });

    it('a ray that skims the floor does not stop at it (it finds the far wall)', () => {
        const hit = hall.castRay([0, 0.04, 0], [0, 0, -1], 100);
        close(hit!.distance, 30, 1e-2);
        expect(hit!.material).toBe('wall');
    });

    it('maxDist cuts the ray off exactly', () => {
        expect(hall.castRay(from, [0, 0, -1], 29.9)).toBeNull();
        expect(hall.castRay(from, [0, 0, -1], 30.1)).not.toBeNull();
    });

    it('answers only for sensible rays', () => {
        expect(hall.castRay(from, [0, 0, 0], 100)).toBeNull();
        expect(hall.castRay(from, [0, 0, -1], 0)).toBeNull();
        // a direction that is not a unit vector is normalised
        close(hall.castRay(from, [0, 0, -5], 100)!.distance, 30);
    });

    it('a ray that starts inside a solid hits at distance zero', () => {
        const hit = hall.castRay([0, -0.5, 0], [0, 0, -1], 100);
        expect(hit!.distance).toBe(0);
    });

    it('is a closed room: every direction hits something', () => {
        const rng = createRng(3);
        for (let i = 0; i < 300; i++) {
            const d: Vec3 = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
            if (Math.hypot(...d) < 0.1) continue;
            expect(hall.castRay(from, d, 200), JSON.stringify(d)).not.toBeNull();
        }
    });
});

describe('pillars', () => {
    it('a single pillar is where the spec says, and rays meet it', () => {
        const w = world('pillars'); // hall 40 x 60 x 12, start z = 22, pillar 15 ahead at z = 7, radius 0.5
        expect(w.objects()).toHaveLength(1);
        const p = w.objects()[0]!;
        expect(p.id).toBe('pillar-1');
        expect(p.shape).toEqual({ kind: 'pillar', radius: 0.5, height: 12 });
        expect(p.pos).toEqual([0, 6, 7]);
        expect(p.order).toBeNull();
        expect(p.solid).toBe(true);
        const head = w.castRay([0, 1.5, 22], [0, 0, -1], 100)!;
        close(head.distance, 14.5);
        expect(head.objectId).toBe('pillar-1');
        expect(head.material).toBe('obstacle');
        closeVec(head.normal, [0, 0, 1]);
        // off the middle by 0.4: the cylinder is met at z = 7 + sqrt(0.5^2 - 0.4^2)
        close(w.castRay([0.4, 1.5, 22], [0, 0, -1], 100)!.distance, 22 - (7 + 0.3));
        // off by 0.6 the ray misses it and meets the far wall
        const miss = w.castRay([0.6, 1.5, 22], [0, 0, -1], 100)!;
        close(miss.distance, 52);
        expect(miss.objectId).toBeNull();
    });

    it('a row leaves gaps a ray can pass', () => {
        const w = world('pillars', { layout: 'row', count: 5, gapM: 6 }); // pitch 7: x = -14 -7 0 7 14
        expect(w.objects().map((o) => o.pos[0])).toEqual([-14, -7, 0, 7, 14]);
        close(w.castRay([3.5, 1.5, 22], [0, 0, -1], 100)!.distance, 52); // the middle of a gap
        expect(w.castRay([7, 1.5, 22], [0, 0, -1], 100)!.objectId).toBe('pillar-4');
    });

    it('scattered pillars are seeded, apart from each other and from the walls and the start', () => {
        const a = world('pillars', { layout: 'scatter', count: 8 }, 5);
        const b = world('pillars', { layout: 'scatter', count: 8 }, 5);
        const c = world('pillars', { layout: 'scatter', count: 8 }, 6);
        expect(JSON.stringify(a.objects())).toBe(JSON.stringify(b.objects()));
        expect(JSON.stringify(a.objects())).not.toBe(JSON.stringify(c.objects()));
        const os = a.objects();
        expect(os).toHaveLength(8);
        for (const o of os) {
            expect(Math.abs(o.pos[0]) + 0.5 + 3).toBeLessThanOrEqual(20 + 1e-6);
            expect(Math.abs(o.pos[2]) + 0.5 + 3).toBeLessThanOrEqual(30 + 1e-6);
            expect(o.pos[2]).toBeLessThanOrEqual(22 - 8 + 1e-6);
        }
        for (let i = 0; i < os.length; i++) {
            for (let j = i + 1; j < os.length; j++) {
                expect(Math.hypot(os[i]!.pos[0] - os[j]!.pos[0], os[i]!.pos[2] - os[j]!.pos[2])).toBeGreaterThanOrEqual(2 * 0.5 + 3.5 - 1e-6);
            }
        }
    });
});

describe('gates', () => {
    // the default hall for gates is 60 x 160 x 20; the start is at z = 72, 3 m up; the first gate is 12 ahead, at z = 60
    it('a ring: the opening is clear, the tube is hit on its front', () => {
        const w = world('rings');
        const g = w.objects()[0]!;
        expect(g).toMatchObject({ id: 'ring-1', order: 0, solid: true, material: 'obstacle', shape: { kind: 'ring', diameter: 3, tube: 0.1 } });
        expect(g.pos).toEqual([0, 3, 60]);
        expect(g.quat).toEqual([1, 0, 0, 0]);
        const through = w.castRay([0, 3, 72], [0, 0, -1], 400)!; // down the middle: through the opening, on to the far wall
        close(through.distance, 152);
        expect(through.objectId).toBeNull();
        close(w.castRay([0, 3 + 1.45, 72], [0, 0, -1], 400)!.distance, 152); // 5 cm inside the inner edge: clear
        const tube = w.castRay([0, 3 + 1.6, 72], [0, 0, -1], 400)!; // down the centre line of the tube
        close(tube.distance, 12 - 0.1);
        expect(tube.objectId).toBe('ring-1');
        expect(tube.material).toBe('obstacle');
        closeVec(tube.normal, [0, 0, 1], 0.05);
    });

    it('a square: the bars are hit, the opening is clear', () => {
        const w = world('squares'); // side 3, bar 0.15
        expect(w.objects()[0]!.shape).toEqual({ kind: 'square', side: 3, bar: 0.15 });
        close(w.castRay([0, 3 + 1.575, 72], [0, 0, -1], 400)!.distance, 12 - 0.075); // top bar, front face
        close(w.castRay([1.575, 3, 72], [0, 0, -1], 400)!.distance, 12 - 0.075); // side bar
        close(w.castRay([0, 3 + 1.4, 72], [0, 0, -1], 400)!.distance, 152); // inside the opening
        expect(w.castRay([0, 3 + 1.575, 72], [0, 0, -1], 400)!.objectId).toBe('square-1');
    });

    it('a cube frame: the edges are hit, every face is open', () => {
        const w = world('cube-frames');
        expect(w.objects()[0]!.id).toBe('cube-1');
        close(w.castRay([1.575, 3 + 1.575, 72], [0, 0, -1], 400)!.distance, 12 - 1.65); // an edge bar along Z, its front end
        close(w.castRay([0, 3 + 1.575, 72], [0, 0, -1], 400)!.distance, 12 - 1.65); // the top front edge bar along X
        close(w.castRay([0, 3, 72], [0, 0, -1], 400)!.distance, 152); // through the front and out at the back
        close(w.castRay([0, 3, 60 + 5], [-1, 0, 0], 400)!.distance, 30); // beside the cube there is only the wall
        const inside = w.castRay([0, 3, 60], [1, 0, 0], 400)!; // from the middle of the cube out through the side face
        close(inside.distance, 30);
    });

    it('a line, a turn and the numbering of gates', () => {
        const line = world('rings', { layout: 'line', count: 3 });
        expect(line.objects().map((o) => [o.id, o.order, o.pos[2]])).toEqual([
            ['ring-1', 0, 60],
            ['ring-2', 1, 46],
            ['ring-3', 2, 32]
        ]);
        const turn = world('rings', { layout: 'turn', count: 4, turnDeg: 90 });
        const os = turn.objects();
        expect(os.map((o) => o.order)).toEqual([0, 1, 2, 3]);
        closeVec(os[1]!.pos, [0, 3, 46]);
        closeVec(os[2]!.pos, [7, 3, 46 - 14 * Math.cos(Math.PI / 6)], 1e-5);
        closeVec(os[3]!.pos, [7 + 14 * Math.sin(Math.PI / 3), 3, 46 - 14 * Math.cos(Math.PI / 6) - 7], 1e-5);
        // the last gate faces +X: a ray along +X from its middle passes, a ray along its local Z meets the tube
        const last = os[3]!;
        expect(last.quat[0]).toBeCloseTo(Math.SQRT1_2, 6);
        expect(last.quat[2]).toBeCloseTo(-Math.SQRT1_2, 6);
    });

    it('decreasing sizes: each ring has its own diameter', () => {
        const w = world('rings', { layout: 'line', sizes: [3, 2, 1.5, 1], spacingM: 12 });
        expect(w.objects().map((o) => (o.shape.kind === 'ring' ? o.shape.diameter : 0))).toEqual([3, 2, 1.5, 1]);
    });

    it('offsets move a single gate sideways and up', () => {
        const w = world('rings', { offsetXM: -4, offsetYM: 2 });
        expect(w.objects()[0]!.pos).toEqual([-4, 5, 60]);
    });
});

describe('the corridor, in closed form', () => {
    const full = world('corridor'); // 5 wide, 4 high, start (0, 2, 0), 100 m straight, then a pillar 15 m on
    it('the walls around the start', () => {
        const s = full.start.pos;
        for (const [dir, distance, material] of [
            [[1, 0, 0], 2.5, 'wall'],
            [[-1, 0, 0], 2.5, 'wall'],
            [[0, 0, 1], 2.5, 'wall'],
            [[0, 1, 0], 2, 'ceiling'],
            [[0, -1, 0], 2, 'floor']
        ] as [Vec3, number, string][]) {
            const hit = full.castRay(s, dir, 50)!;
            close(hit.distance, distance);
            expect(hit.material).toBe(material);
        }
    });

    it('looking down the straight, the first obstacle is the pillar, 114.5 m on', () => {
        const hit = full.castRay(full.start.pos, [0, 0, -1], 300)!;
        close(hit.distance, 114.5);
        expect(hit.objectId).toBe('pillar-1');
    });

    it('layouts: the end of a straight, a corner, a shaft', () => {
        const straight = world('corridor', { layout: 'straight' });
        close(straight.castRay(straight.start.pos, [0, 0, -1], 300)!.distance, 102.5);
        const bends = world('corridor', { layout: 'bends' });
        close(bends.castRay(bends.start.pos, [0, 0, -1], 300)!.distance, 17.5); // the outside of the first corner
        close(bends.castRay([0, 2, -15], [1, 0, 0], 300)!.distance, 17.5); // along the first bend to its outer corner
        const jogs = world('corridor', { layout: 'jogs' });
        close(jogs.castRay([0, 2, -15], [0, 1, 0], 300)!.distance, 5); // up the shaft to y = 7
        close(jogs.castRay([0, 2, 0], [0, 1, 0], 300)!.distance, 2); // away from the shaft the ceiling is at 4
    });

    it('every layout is one connected passage from the start to the end', () => {
        for (const layout of ['full', 'straight', 'obstacle', 'bends', 'jogs']) {
            const w = world('corridor', { layout });
            const [min, max] = [w.bounds.min, w.bounds.max];
            const nx = Math.ceil(max[0] - min[0]), ny = Math.ceil(max[1] - min[1]), nz = Math.ceil(max[2] - min[2]);
            const cell = (v: Vec3): number => {
                const i = Math.floor(v[0] - min[0]), j = Math.floor(v[1] - min[1]), k = Math.floor(v[2] - min[2]);
                return (i * ny + j) * nz + k;
            };
            const free = new Uint8Array(nx * ny * nz);
            for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) free[(i * ny + j) * nz + k] = w.sdf(min[0] + i + 0.5, min[1] + j + 0.5, min[2] + k + 0.5) > 0.3 ? 1 : 0;
            const seen = new Uint8Array(free.length);
            const start = cell(w.start.pos);
            const end = cell(w.landmarks.find((l) => l.id === 'end')!.pos);
            expect(free[start], `${layout} start is free`).toBe(1);
            expect(free[end], `${layout} end is free`).toBe(1);
            const stack = [start];
            seen[start] = 1;
            while (stack.length > 0) {
                const c = stack.pop()!;
                const k = c % nz, j = Math.floor(c / nz) % ny, i = Math.floor(c / (nz * ny));
                for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
                    const a = i + di, b = j + dj, d = k + dk;
                    if (a < 0 || b < 0 || d < 0 || a >= nx || b >= ny || d >= nz) continue;
                    const n = (a * ny + b) * nz + d;
                    if (free[n] === 1 && seen[n] === 0) {
                        seen[n] = 1;
                        stack.push(n);
                    }
                }
            }
            expect(seen[end], `${layout}: the end is reachable`).toBe(1);
        }
    });

    it('the sections are marked, in order, in free space', () => {
        const ids = full.landmarks.map((l) => l.id);
        expect(ids).toEqual(['start', 'section-straight', 'section-obstacle', 'section-bends', 'section-jogs', 'section-mixed', 'end']);
        for (const l of full.landmarks) expect(full.sdf(...l.pos), l.id).toBeGreaterThan(1.9);
        closeVec(full.landmarks.find((l) => l.id === 'section-bends')!.pos, [0, 2, -130]);
        closeVec(full.landmarks.find((l) => l.id === 'end')!.pos, [90, 2, -295]);
        expect(full.objects().map((o) => o.id)).toEqual(['pillar-1', 'pillar-2', 'pillar-3', 'pillar-4', 'pillar-5', 'pillar-6', 'pillar-7']);
    });

    it('odd bend and jog counts are made even so the path returns to its heading', () => {
        const a = world('corridor', { bendCount: 5, jogCount: 3 });
        const b = world('corridor', { bendCount: 6, jogCount: 4 });
        expect(a.landmarks.find((l) => l.id === 'end')!.pos).toEqual(b.landmarks.find((l) => l.id === 'end')!.pos);
    });
});

describe('rays and solids agree (no tunnelling)', () => {
    const cases: [string, AnalyticWorldInfo][] = [
        ...WORLD_GENERATORS.map((g): [string, AnalyticWorldInfo] => [g, world(g)]),
        ['corridor bends', world('corridor', { layout: 'bends' })],
        ['corridor jogs', world('corridor', { layout: 'jogs' })],
        ['pillars scatter', world('pillars', { layout: 'scatter', count: 10 }, 9)],
        ['rings course', world('rings', { layout: 'course', count: 6 }, 4)],
        ['squares turn', world('squares', { layout: 'turn', count: 4 })],
        ['cube line', world('cube-frames', { layout: 'line', count: 3, sizeM: 3.5 })]
    ];

    it.each(cases)('%s', (_name, w) => {
        const rng = createRng(77);
        const [lo, hi] = [w.bounds.min, w.bounds.max];
        let rays = 0;
        for (let tries = 0; tries < 5000 && rays < 80; tries++) {
            const o: Vec3 = [rng.range(lo[0], hi[0]), rng.range(lo[1], hi[1]), rng.range(lo[2], hi[2])];
            if (w.sdf(...o) <= 0.2) continue;
            const d: Vec3 = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
            const len = Math.hypot(...d);
            if (len < 0.2) continue;
            const dir: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
            rays++;
            const hit = w.castRay(o, dir, 60);
            const upTo = hit === null ? 60 : Math.max(0, hit.distance - 0.03);
            for (let t = 0; t <= upTo; t += 0.05) {
                if (w.solidAt(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t)) {
                    throw new Error(`ray from ${o} along ${dir} reported ${hit === null ? 'no hit' : hit.distance} but is solid at ${t}`);
                }
            }
            if (hit !== null) {
                expect(Math.abs(w.sdf(...hit.point)), 'the hit point is on a surface').toBeLessThan(2e-3);
                expect(hit.distance).toBeLessThanOrEqual(60);
            }
        }
        expect(rays).toBe(80);
    });

    it('solidAt is exactly sdf <= 0 (and the check can fail: a tunnelling ray is detected)', () => {
        const w = world('hall');
        const rng = createRng(5);
        for (let i = 0; i < 2000; i++) {
            const p: Vec3 = [rng.range(-25, 25), rng.range(-3, 15), rng.range(-35, 35)];
            expect(w.solidAt(...p)).toBe(w.sdf(...p) <= 0);
        }
        // negative control: a ray tracer that steps by twice the distance does tunnel through a thin ring
        const ring = world('rings');
        const o: Vec3 = [0, 3 + 1.6, 72];
        let t = 0;
        let hitByFast = false;
        for (let i = 0; i < 200 && t < 100; i++) {
            const d = ring.sdf(o[0], o[1], o[2] - t);
            if (d < 1e-3) {
                hitByFast = true;
                break;
            }
            t += 2 * d + 0.25; // too bold: jumps over the 0.2 m tube
        }
        expect(hitByFast).toBe(false);
        expect(ring.castRay(o, [0, 0, -1], 100)!.objectId).toBe('ring-1'); // the real tracer does not
    });
});

describe('thin features are never skipped', () => {
    // rays aimed at the centre line of a tube or bar must hit that gate, from near and far, at any angle
    function aimed(kind: 'rings' | 'squares' | 'cube-frames', id: string, points: (rng: ReturnType<typeof createRng>) => Vec3): void {
        const w = world(kind);
        const gate = w.objects()[0]!;
        expect(gate.id).toBe(id);
        const rng = createRng(31);
        for (let i = 0; i < 400; i++) {
            const target = points(rng); // relative to the gate's centre (it faces -Z, no rotation)
            const aim: Vec3 = [gate.pos[0] + target[0], gate.pos[1] + target[1], gate.pos[2] + target[2]];
            const origin: Vec3 = [rng.range(-12, 12), rng.range(1.5, 9), rng.range(gate.pos[2] + 1, gate.pos[2] + 14)];
            const dir: Vec3 = [aim[0] - origin[0], aim[1] - origin[1], aim[2] - origin[2]];
            const dist = Math.hypot(...dir);
            const hit = w.castRay(origin, [dir[0] / dist, dir[1] / dist, dir[2] / dist], 100);
            expect(hit, `${kind} ray ${i} from ${origin} at ${aim}`).not.toBeNull();
            expect(hit!.objectId, `${kind} ray ${i}`).toBe(id);
            expect(hit!.distance, `${kind} ray ${i}`).toBeLessThanOrEqual(dist + 0.2);
        }
    }

    it('the tube of a ring', () => aimed('rings', 'ring-1', (r) => {
        const a = r.range(0, 2 * Math.PI);
        return [1.6 * Math.cos(a), 1.6 * Math.sin(a), 0];
    }));

    it('the bars of a square', () => aimed('squares', 'square-1', (r) => {
        const t = r.range(-1.575, 1.575);
        const side = Math.floor(r.range(0, 4));
        return side === 0 ? [t, 1.575, 0] : side === 1 ? [t, -1.575, 0] : side === 2 ? [1.575, t, 0] : [-1.575, t, 0];
    }));

    it('the edges of a cube frame', () => aimed('cube-frames', 'cube-1', (r) => {
        const t = r.range(-1.65, 1.65);
        const axis = Math.floor(r.range(0, 3));
        const a = r.sign() * 1.575, b = r.sign() * 1.575;
        return axis === 0 ? [t, a, b] : axis === 1 ? [a, t, b] : [a, b, t];
    }));
});

describe('seeded courses stay inside the hall and clear of it', () => {
    it('40 seeds of a six-ring course', () => {
        const shapes = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            const w = world('rings', { layout: 'course', count: 6 }, seed);
            const os = w.objects();
            expect(os.map((o) => o.order)).toEqual([0, 1, 2, 3, 4, 5]);
            expect(os.map((o) => o.id)).toEqual(['ring-1', 'ring-2', 'ring-3', 'ring-4', 'ring-5', 'ring-6']);
            shapes.add(JSON.stringify(os));
            for (let i = 0; i < os.length; i++) {
                const o = os[i]!;
                expect(Math.abs(o.pos[0]) + 1.7 + 1, `seed ${seed} x`).toBeLessThanOrEqual(30 + 1e-6);
                expect(Math.abs(o.pos[2]) + 1.7 + 1, `seed ${seed} z`).toBeLessThanOrEqual(80 + 1e-6);
                expect(o.pos[1] - 1.7, `seed ${seed} floor`).toBeGreaterThanOrEqual(1 - 1e-6);
                expect(o.pos[1] + 1.7 + 1, `seed ${seed} ceiling`).toBeLessThanOrEqual(20 + 1e-6);
                const yawDeg = (-2 * Math.atan2(o.quat[2], o.quat[0]) * 180) / Math.PI; // the gate's heading, from its quaternion
                expect(Math.abs(yawDeg), `seed ${seed} gate ${i} yaw`).toBeLessThanOrEqual(35 + 1e-6);
                if (i > 0) {
                    const prev = os[i - 1]!;
                    const gap = Math.hypot(o.pos[0] - prev.pos[0], o.pos[1] - prev.pos[1], o.pos[2] - prev.pos[2]);
                    expect(gap, `seed ${seed} gap ${i}`).toBeGreaterThan(14 * 0.85 - 1e-6);
                    expect(gap, `seed ${seed} gap ${i}`).toBeLessThan(Math.hypot(14 * 1.15, 1.5) + 1e-6);
                    // the line between two gate centres keeps clear of the walls and the other gates by half the opening
                    for (let t = 0; t <= 1; t += 0.02) {
                        const p: Vec3 = [prev.pos[0] + (o.pos[0] - prev.pos[0]) * t, prev.pos[1] + (o.pos[1] - prev.pos[1]) * t, prev.pos[2] + (o.pos[2] - prev.pos[2]) * t];
                        // inside a gate's own plane the tube is half the opening away; elsewhere the walls and floor are further
                        expect(w.sdf(...p), `seed ${seed} leg ${i} t=${t}`).toBeGreaterThanOrEqual(0.5);
                    }
                }
            }
        }
        expect(shapes.size).toBeGreaterThanOrEqual(38); // seeds give different courses
    });

    it('a line of shrinking rings keeps a clearance of half the smallest opening', () => {
        const w = world('rings', { layout: 'line', sizes: [3, 2, 1.5, 1], spacingM: 12 }, 3);
        const os = w.objects();
        for (let i = 1; i < os.length; i++) {
            const a = os[i - 1]!.pos, b = os[i]!.pos;
            for (let t = 0; t <= 1; t += 0.02) {
                const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
                expect(w.sdf(...p)).toBeGreaterThanOrEqual(0.5 - 1e-6);
            }
        }
    });
});

describe('determinism, digests and specs', () => {
    it('the same spec gives the same geometry, JSON and digest, and a world rebuilt from its own spec is the same world', () => {
        for (const g of WORLD_GENERATORS) {
            const a = world(g, {}, 3), b = world(g, {}, 3);
            expect(JSON.stringify(a.objects())).toBe(JSON.stringify(b.objects()));
            expect(a.digest).toBe(b.digest);
            expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
            const again = createAnalyticWorld(a.spec);
            expect(again.digest).toBe(a.digest);
            expect(again.id).toBe(a.id);
            expect(a.id).toBe(`${g}-${a.digest.slice(0, 8)}`);
            expect(/^[0-9a-f]+$/.test(a.id)).toBe(false); // never a bare hex id: it must not look like a scan id
        }
    });

    it('the digest is the SHA-256 of the canonical JSON of the full spec (checked against node:crypto)', () => {
        const w = world('hall');
        const text = '{"generator":"hall","params":{"depthM":60,"heightM":12,"startHeightM":1.5,"voxelM":0.1,"widthM":40},"seed":0,"version":1}';
        expect(canonicalJson(w.spec)).toBe(text);
        expect(w.digest).toBe(createHash('sha256').update(text).digest('hex'));
    });

    it('the digest follows the spec and nothing else', () => {
        const base = world('hall');
        expect(world('hall', {}, 1).digest).not.toBe(base.digest);
        expect(world('hall', { widthM: 41 }).digest).not.toBe(base.digest);
        expect(world('open').digest).not.toBe(base.digest);
        // omitted and explicit defaults are one spec, and the order of the keys does not matter
        expect(world('hall', { widthM: 40 }).digest).toBe(base.digest);
        const a = createAnalyticWorld({ generator: 'hall', version: 1, seed: 0, params: { widthM: 30, depthM: 50 } });
        const b = createAnalyticWorld({ generator: 'hall', version: 1, seed: 0, params: { depthM: 50, widthM: 30 } });
        expect(a.digest).toBe(b.digest);
    });

    it('the resolved parameters are in the spec and in `resolved`', () => {
        const w = world('pillars', { layout: 'row' });
        expect(w.resolved).toEqual(w.spec.params);
        expect(w.resolved['count']).toBe(5);
        expect(w.voxelM).toBe(0.1);
        expect(world('hall', { voxelM: 0.05 }).voxelM).toBe(0.05);
    });

    it.each([
        ['an unknown generator', () => createAnalyticWorld({ generator: 'maze' as WorldGenerator, version: 1, seed: 0, params: {} }), /unknown generator/],
        ['an unknown parameter', () => world('hall', { bogus: 1 }), /unknown parameter 'bogus'/],
        ['a value below its range', () => world('hall', { widthM: 5 }), /between 8 and 400/],
        ['a value above its range', () => world('hall', { heightM: 500 }), /between 3 and 100/],
        ['a number that is not one', () => world('hall', { widthM: 'wide' }), /finite number/],
        ['a number that is infinite', () => world('hall', { widthM: Infinity }), /finite number/],
        ['an unknown choice', () => world('pillars', { layout: 'zigzag' }), /one of single, row, scatter/],
        ['a fraction for a count', () => world('pillars', { count: 2.5 }), /integer/],
        ['a list entry out of range', () => world('rings', { sizes: [3, 99] }), /between 0.5 and 12/],
        ['a list that is not a list', () => world('rings', { sizes: 3 as never }), /list/],
        ['a seed with a fraction', () => world('hall', {}, 1.5), /seed/],
        ['a version this build lacks', () => createAnalyticWorld({ ...makeSpec('hall'), version: 3 }), /builds versions 1, 2 here, the spec asks for 3/],
        ['a start under the ceiling', () => world('hall', { startHeightM: 11.8 }), /too close to the ceiling/],
        ['gates that do not fit the hall', () => world('rings', { layout: 'line', count: 24, spacingM: 14 }), /does not fit/],
        ['a row that is too wide', () => world('pillars', { layout: 'row', count: 24 }), /does not fit/],
        ['pillars that cannot all be placed', () => world('pillars', { layout: 'scatter', count: 24, widthM: 20, depthM: 40 }), /cannot place 24 pillars/],
        ['an obstacle that fills the corridor', () => world('corridor', { obstacleRadiusM: 2.2 }), /less than 0.5 m/]
    ] as [string, () => unknown, RegExp][])('refuses %s', (_name, build, reason) => {
        expect(build).toThrow(WorldSpecError);
        expect(build).toThrow(reason);
    });

    it('the bounds hold the room, the objects and the start', () => {
        for (const g of WORLD_GENERATORS) {
            const w = world(g);
            const { min, max } = w.bounds;
            for (const p of [w.start.pos, ...w.objects().map((o) => o.pos)]) {
                for (let i = 0; i < 3; i++) {
                    expect(p[i]!, `${g} axis ${i}`).toBeGreaterThanOrEqual(min[i]!);
                    expect(p[i]!, `${g} axis ${i}`).toBeLessThanOrEqual(max[i]!);
                }
            }
            expect(w.sdf(...w.start.pos), `${g} start clearance`).toBeGreaterThanOrEqual(1.4);
            expect(w.solidAt(...w.start.pos)).toBe(false);
            expect(w.kind).toBe('analytic');
            expect(w.floorY).toBe(0);
        }
    });

    it('lists gates by order first, then the other objects by id', () => {
        const w = world('open', { zoneDistanceM: 30 });
        expect(w.objects().map((o) => [o.id, o.order, o.solid])).toEqual([['zone-1', 0, false]]);
        // a zone is not solid: rays pass through it
        expect(w.castRay(w.start.pos, [0, 0, -1], 100)).toBeNull();
        expect(w.solidAt(0, 1.5, -30)).toBe(false);
    });

});

describe('golden worlds: any change here means a new generator version', () => {
    // digest: of the spec. objects: of the objects' canonical JSON. field: of the signed distance at 600 fixed points,
    // so a change of the room's geometry is caught even when the spec (and so the digest) stays the same.
    const GOLDEN: { name: string; generator: WorldGenerator; params: AnalyticWorldSpec['params']; seed: number; digest: string; objects: string; field: string }[] = [
        { name: "open", generator: "open", params: {}, seed: 0, digest: 'b8163ece0c79db1eb914a17866e94890e1452619595474dbcb97b534728fd37e', objects: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', field: '6bfb54e7e8ae38f0bd248aacf6383e716f147a467ab0708c0e1eea1336211bc2' },
        { name: "hall", generator: "hall", params: {}, seed: 0, digest: '67e9057ac22a5c874077eb8f8efc61f29fef50df3acc80432fe324aba4debc41', objects: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', field: 'b6393adf1959dc5c8835bbafc18038fe7bf407d4d7e3593ecb4fb183dc15cc80' },
        { name: "corridor", generator: "corridor", params: {}, seed: 0, digest: '89d5c46d1121cca8e08944f5f838dd20c01d4463bdb3b1fbfd33ac7041194568', objects: '869b41211b9a66f992b0fd642d1bf4bd022aa8044b3c9d9a54c4b9a86c6e76e1', field: 'bc5af20f32dc49889a230d2618ebab842cf1641ac9f7b91eb5827904196056e8' },
        { name: "pillars", generator: "pillars", params: {}, seed: 0, digest: 'fa96b763e15b1db899b53d9c0943f5810d58f55395cc8783e68b43354ae36af3', objects: 'cd8a555741e72b2008e0b205fbde31422712901ca91242e5232609a6a4af6267', field: 'd5f64ff69705be1f12371a6390bb1687a1ed0e490d7ba6d2a326adcaf992d2d7' },
        { name: "rings", generator: "rings", params: {}, seed: 0, digest: '2bd64a5c598ae3691973ee55f883c048007caa362df568da6d9e48b3625285ef', objects: '9987f466dbf87a596e62fe0d3e2e59d46a93cc6a70f1ce688314121a06ce071a', field: '8d1d1316f8f9261412d4a3d39ec326b10ff3a66a24548cbc2e3e7568e01a0b1e' },
        { name: "squares", generator: "squares", params: {}, seed: 0, digest: '47710812f9400a8c8d80c5442f81f15a0e3c36e7b4b588a58deee911f41e56e5', objects: '1de6e293f9361ffe2b7b5c73afb95d15e9aa65db1f935c13f39511bd074544a7', field: '6e0f0004210028ee0a0faaed3fbe762b99f6d33a012c80871d405384c7d3ac18' },
        { name: "cube-frames", generator: "cube-frames", params: {}, seed: 0, digest: '40f72dec16e97dfe1b8cb30aa3f3c3264d7812318de4c500f5ecb7c7d1dfda92', objects: 'b2e2cbe531e98ebc6455f2e6af9b22dd39846d45f4b8cdbaf6bd98f96708b117', field: 'f8d7a802622736761b69dd9ad0a9e5cefdc44d8c316810cd7e7178a97da86cb4' },
        { name: "open zone", generator: "open", params: {"zoneDistanceM":30}, seed: 0, digest: '7b79caf2c2cd7363f2c1015d7578848df8922b522a3d4057ebcbfbffe1fe04cf', objects: '4278c0d1a5eaa80b3ca457433d261a850c4fb28166125c78517ef865f8fcb7e0', field: '6bfb54e7e8ae38f0bd248aacf6383e716f147a467ab0708c0e1eea1336211bc2' },
        { name: "pillars row", generator: "pillars", params: {"layout":"row"}, seed: 0, digest: 'f74a7bad382ef8476cfaa7b83f7368f9c0f1ba2e2652ea256e52cf1eef0855a7', objects: '8db5a37c5d2280792a30751843a21d5a25ab2d674f51265d8b055f985e349ecf', field: '191812ce6467d02dd45003b25c049743e2501311b0f16c7a2f3602590ccb7565' },
        { name: "pillars scatter", generator: "pillars", params: {"layout":"scatter","count":10}, seed: 9, digest: '7bb42b54a88b4546b7f39e40312aac6b654e7fb7650ac4d9ff5294e0e247460c', objects: '980e2a8cecb027ac12c29c2dfb1a86f7c49dceffd740a0b7b90cb84933d75554', field: '5e2a9576c1aa209298502214d5835890baf62a070fa33221eadebf4790eb2d06' },
        { name: "corridor bends", generator: "corridor", params: {"layout":"bends"}, seed: 0, digest: '47a22dc1b250ce8bc07586191a115244e07728e97699c6b090e5f85ff0f8aaa1', objects: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', field: '7676759354b42b24b00a81f2a741c2c6aa632723c6e859b8a53c248827efcdb1' },
        { name: "rings course", generator: "rings", params: {"layout":"course","count":6}, seed: 4, digest: '6147f23361626ab35b0548cd7fe3a3c779f32322d85f930c5ac3b369c97bd353', objects: '296683504f37ad61193f8ab2db42c5a6d593d44c948f0c479a3a54586f9e7566', field: 'dc7429ef379f1cdaebadc194d606f6e6aa9a5851f034640ed546ff366000e4cd' },
        { name: "rings small", generator: "rings", params: {"layout":"line","sizes":[3,2,1.5,1],"spacingM":12}, seed: 0, digest: '337d6309f6c8055aa526d51e6acd9c34d5cd76cfcdd145b5fdef11960819e4ed', objects: '2c253dcedb92b67bd197fcada05bb5b13ba8f0e3579d65e52c511d28e42cd174', field: 'a20a22229b2aa593a5ca3911e8e66caaf1a2dcf5f98d2bdc14aa98dd44e937d0' },
        { name: "squares turn", generator: "squares", params: {"layout":"turn","count":4}, seed: 0, digest: 'baf3cc80080da8755abfc23d263338ec4576b50de69be1f867905ece32d85b8a', objects: '65d369295463d193dab6623365f3c3471b904106d5e4424744e28b48ef335256', field: 'c5c14212837d210e57a4fa5b3955254e6b2228d77b74a35c49176d2063478517' }
    ];

    function fingerprint(w: AnalyticWorldInfo): string {
        const rng = createRng(2024);
        const [lo, hi] = [w.bounds.min, w.bounds.max];
        const values: number[] = [];
        for (let i = 0; i < 600; i++) {
            const p: Vec3 = [rng.range(lo[0], hi[0]), rng.range(lo[1], hi[1]), rng.range(lo[2], hi[2])];
            values.push(Math.round(w.sdf(...p) * 1e4));
        }
        return sha256Hex(canonicalJson(values));
    }

    it.each(GOLDEN)('$name', (g) => {
        const w = world(g.generator, g.params, g.seed);
        expect(w.digest).toBe(g.digest);
        expect(sha256Hex(canonicalJson(w.objects()))).toBe(g.objects);
        expect(fingerprint(w)).toBe(g.field);
    });

    it('the fingerprints see a change of geometry (negative control)', () => {
        const hall = GOLDEN.find((g) => g.name === 'hall')!;
        expect(fingerprint(world('hall', { widthM: 41 }))).not.toBe(hall.field);
        expect(fingerprint(world('hall', { heightM: 13 }))).not.toBe(hall.field);
        const rings = GOLDEN.find((g) => g.name === 'rings')!;
        expect(sha256Hex(canonicalJson(world('rings', { sizeM: 3.1 }).objects()))).not.toBe(rings.objects);
    });
});
