// The world's checkpoint list (M41-20, lane s13-worlds step 4): a world with a track (a corridor, a
// course of gates) hands out checkpoints along it, so a crash or a short R puts the craft back near
// where it was, never at the far start. Held here: at most 6 m between consecutive checkpoints along
// the whole track; one about 1.5 m before each gate, facing it; every dir a horizontal unit vector
// along the free way; the straight line between consecutive checkpoints free for a craft. Each check
// has a control that must fail (a 10 m gap, a dir into a wall, a corner cut, a missing approach).
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, Vec3, WorldCheckpoint } from '../src/contract';
import { WORLD_GENERATORS } from '../src/contract';
import { BODY_RADIUS_M, getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { canonicalJson } from '../src/util/canonical';
import { sha256Hex } from '../src/util/sha256';
import { quatRotate } from '../src/util/vec';
import { createAnalyticWorld, GENERATOR_VERSIONS, makeSpec, paramSchema, type AnalyticWorldInfo } from '../src/world';
import { LARGEST_CRAFT_M } from './helpers/reach';

const TRACK_GENERATORS = ['corridor', 'rings', 'squares', 'cube-frames'] as const;

function trackWorlds(): { name: string; world: AnalyticWorldInfo }[] {
    const specs = new Map<string, { name: string; spec: AnalyticWorldSpec }>();
    for (const id of SHIPPED_LESSON_IDS) {
        const l = getLesson(id);
        if (l.world.kind === 'analytic' && (TRACK_GENERATORS as readonly string[]).includes(l.world.spec.generator)) specs.set(JSON.stringify(l.world.spec), { name: id, spec: l.world.spec });
    }
    for (const g of TRACK_GENERATORS) {
        for (const v of GENERATOR_VERSIONS[g]) {
            const layout = paramSchema(g, v)['layout'];
            for (const value of layout !== undefined && layout.kind === 'enum' ? layout.values : ['']) {
                const spec = makeSpec(g, value === '' ? {} : { layout: value }, 3, v);
                if (!specs.has(JSON.stringify(spec))) specs.set(JSON.stringify(spec), { name: `${g} v${v} ${value}`, spec });
            }
        }
    }
    specs.set('rings course seed 4', { name: 'rings v1 course seed 4', spec: makeSpec('rings', { layout: 'course', count: 6 }, 4, 1) });
    return [...specs.values()].map((s) => ({ name: s.name, world: createAnalyticWorld(s.spec) }));
}
const WORLDS = trackWorlds();

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The largest distance between consecutive checkpoints. */
export function largestGap(list: readonly WorldCheckpoint[]): number {
    let worst = 0;
    for (let i = 1; i < list.length; i++) worst = Math.max(worst, dist((list[i - 1] as WorldCheckpoint).pos, (list[i] as WorldCheckpoint).pos));
    return worst;
}

/** Why a checkpoint's dir is not a horizontal unit vector along the free way, or null. */
export function dirProblem(w: AnalyticWorldInfo, list: readonly WorldCheckpoint[], i: number): string | null {
    const cp = list[i] as WorldCheckpoint;
    const d = cp.dir;
    if (Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) > 1e-6) return `not a unit vector: ${JSON.stringify(d)}`;
    if (d[1] !== 0) return `not horizontal: ${JSON.stringify(d)}`;
    const ahead: Vec3 = [cp.pos[0] + d[0] * 0.5, cp.pos[1], cp.pos[2] + d[2] * 0.5];
    if (w.solidAt(...ahead)) return `0.5 m ahead along dir is solid: ${JSON.stringify(ahead)}`;
    const next = list[i + 1];
    if (next !== undefined) {
        const to: Vec3 = [next.pos[0] - cp.pos[0], 0, next.pos[2] - cp.pos[2]];
        const l = Math.hypot(to[0], to[2]);
        if (l > 0.05 && (d[0] * to[0] + d[2] * to[2]) / l < -1e-6) return `points back along the track (toward ${JSON.stringify(next.pos)})`;
    }
    return null;
}

/** The least clearance (sdf) on the straight lines between consecutive checkpoints, and where. */
export function leastClearance(w: AnalyticWorldInfo, list: readonly WorldCheckpoint[]): { metres: number; at: Vec3 | null } {
    let best = Infinity;
    let at: Vec3 | null = null;
    for (let i = 0; i < list.length; i++) {
        const a = (list[i] as WorldCheckpoint).pos;
        const b = (list[i + 1] ?? list[i] as WorldCheckpoint).pos;
        const steps = Math.max(1, Math.ceil(dist(a, b) / 0.05));
        for (let k = 0; k <= steps; k++) {
            const p: Vec3 = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps, a[2] + ((b[2] - a[2]) * k) / steps];
            const d = w.sdf(...p);
            if (d < best) {
                best = d;
                at = p;
            }
        }
    }
    return { metres: best, at };
}

/** The gates whose approach checkpoint (about 1.5 m before, on the axis, facing it) is missing. */
export function gatesWithoutApproach(w: AnalyticWorldInfo, list: readonly WorldCheckpoint[]): string[] {
    const missing: string[] = [];
    for (const g of w.objects().filter((o) => o.order !== null && o.shape.kind !== 'zone')) {
        const pass = quatRotate(g.quat, [0, 0, -1]);
        const want: Vec3 = [g.pos[0] - pass[0] * 1.5, g.pos[1] - pass[1] * 1.5, g.pos[2] - pass[2] * 1.5];
        const ok = list.some((cp) => dist(cp.pos, want) <= 0.2 && cp.dir[0] * pass[0] + cp.dir[2] * pass[2] >= 0.999);
        if (!ok) missing.push(g.id);
    }
    return missing;
}

describe('the checkpoint list of a world with a track', () => {
    it('is there for every corridor and course, and only there', () => {
        for (const { name, world } of WORLDS) expect((world.checkpoints ?? []).length, name).toBeGreaterThan(1);
        for (const g of WORLD_GENERATORS.filter((x) => !(TRACK_GENERATORS as readonly string[]).includes(x))) {
            for (const v of GENERATOR_VERSIONS[g]) expect(createAnalyticWorld(makeSpec(g, {}, 0, v)).checkpoints, `${g} v${v}`).toBeUndefined();
        }
        expect(WORLDS.length).toBeGreaterThanOrEqual(15);
    });

    for (const { name, world } of WORLDS) {
        it(`${name}: at most 6 m apart, dirs along the free way, free lines between them, an approach before each gate`, () => {
            const list = world.checkpoints as WorldCheckpoint[];
            expect(largestGap(list)).toBeLessThanOrEqual(6);
            // the track starts at the world's start and every checkpoint stands in free space a craft fits in
            expect(dist((list[0] as WorldCheckpoint).pos, world.start.pos)).toBeLessThan(1e-6);
            for (let i = 0; i < list.length; i++) {
                expect(dirProblem(world, list, i), `${name} checkpoint ${i}`).toBeNull();
                expect(world.sdf(...(list[i] as WorldCheckpoint).pos), `${name} checkpoint ${i} clearance`).toBeGreaterThan(LARGEST_CRAFT_M);
            }
            const c = leastClearance(world, list);
            expect(c.metres, `${name}: closest at ${JSON.stringify(c.at)}`).toBeGreaterThan(BODY_RADIUS_M);
            expect(gatesWithoutApproach(world, list), name).toEqual([]);
        });
    }

    it('the corridor of the corridor lesson: no gap over 6 m from start to end (v0.12 had 30 to 90 m)', () => {
        const l = getLesson('corridor');
        const w = createAnalyticWorld((l.world as { spec: AnalyticWorldSpec }).spec);
        const list = w.checkpoints as WorldCheckpoint[];
        const end = w.landmarks.find((m) => m.id === 'end')!.pos;
        expect(dist((list[list.length - 1] as WorldCheckpoint).pos, end)).toBeLessThan(1e-6);
        expect(largestGap(list)).toBeLessThanOrEqual(6);
        // control: the lesson file's own checkpoints (v0.12, at the starts of the sections) fail the same check
        expect(largestGap(l.checkpoints.map((cp) => ({ pos: cp.at, dir: [0, 0, -1] as Vec3 })))).toBeGreaterThan(6);
    });

    describe('controls: each check fails when its rule is broken', () => {
        const w = WORLDS.find((x) => x.world.spec.generator === 'corridor')!.world;
        const list = w.checkpoints as WorldCheckpoint[];

        it('a list with a 10 m gap', () => {
            const i = list.findIndex((cp, k) => k > 0 && Math.abs(cp.dir[2] + 1) < 1e-9 && Math.abs((list[k - 1] as WorldCheckpoint).dir[2] + 1) < 1e-9);
            const gapped = [...list.slice(0, i), { ...(list[i] as WorldCheckpoint), pos: [(list[i - 1] as WorldCheckpoint).pos[0], (list[i - 1] as WorldCheckpoint).pos[1], (list[i - 1] as WorldCheckpoint).pos[2] - 10] as Vec3 }, ...list.slice(i + 1)];
            expect(largestGap(gapped)).toBeGreaterThan(6);
        });

        it('a dir that points back, or into a wall, or is not horizontal', () => {
            const back = list.map((cp, k) => (k === 3 ? { ...cp, dir: [-cp.dir[0], 0, -cp.dir[2]] as Vec3 } : cp));
            expect(dirProblem(w, back, 3)).toMatch(/points back/);
            // a checkpoint 0.3 m from the side wall of the first straight, facing that wall
            const first = list[1] as WorldCheckpoint;
            const wall = w.castRay(first.pos, [1, 0, 0], 50)!;
            const nearWall = list.map((cp, k) => (k === 1 ? { pos: [first.pos[0] + wall.distance - 0.3, first.pos[1], first.pos[2]] as Vec3, dir: [1, 0, 0] as Vec3 } : cp));
            expect(dirProblem(w, nearWall, 1)).toMatch(/solid/);
            const tilted = list.map((cp, k) => (k === 2 ? { ...cp, dir: [0, Math.SQRT1_2, -Math.SQRT1_2] as Vec3 } : cp));
            expect(dirProblem(w, tilted, 2)).toMatch(/not horizontal/);
        });

        it('a straight line that cuts a corner', () => {
            // the corridor's centre line itself, corner to corner, without the nodes that go round the corners
            const corners: WorldCheckpoint[] = [];
            for (let k = 0; k < list.length; k++) {
                const cp = list[k] as WorldCheckpoint;
                const next = list[k + 1];
                if (k === 0 || next === undefined || next.dir[0] !== cp.dir[0] || next.dir[2] !== cp.dir[2]) corners.push(cp);
            }
            const cut = corners.filter((_cp, k) => k % 2 === 0);
            expect(leastClearance(w, cut).metres).toBeLessThan(BODY_RADIUS_M);
        });

        it('a course without its approach checkpoints', () => {
            const course = WORLDS.find((x) => x.world.spec.generator === 'rings' && x.world.objects().length > 2)!.world;
            const all = course.checkpoints as WorldCheckpoint[];
            const gates = course.objects().filter((o) => o.order !== null);
            const without = all.filter((cp) => !gates.some((g) => dist(cp.pos, g.pos) < 1.6 && dist(cp.pos, g.pos) > 1.4));
            expect(gatesWithoutApproach(course, without).length).toBe(gates.length);
        });
    });
});

describe('golden tracks: a change here means a new generator version', () => {
    const GOLDEN: { name: string; spec: AnalyticWorldSpec; track: string }[] = [
        { name: 'corridor v1 default', spec: makeSpec('corridor', {}, 0, 1), track: '322bf696e121d04b94b69efe4f9a833efdca90af1b8b0d6ad8e0ae604f641ebe' },
        { name: 'rings v1 course seed 4', spec: makeSpec('rings', { layout: 'course', count: 6 }, 4, 1), track: '3c7944547d953be5d32ca3fc40c6cdfcc9f9d9bf2b8b1c4aa19562ab46e54b4c' },
        { name: 'squares v1 turn', spec: makeSpec('squares', { layout: 'turn', count: 4 }, 0, 1), track: 'bcee132f1c019516d7bda1a3f81f0e4bc90d0162bfe064d2c1aba66aef34b3da' }
    ];
    it.each(GOLDEN)('$name', (g) => {
        expect(g.track).toMatch(/^[0-9a-f]{64}$/);
        const w = createAnalyticWorld(g.spec);
        expect(sha256Hex(canonicalJson(w.checkpoints ?? []))).toBe(g.track);
    });
});
