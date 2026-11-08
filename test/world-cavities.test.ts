// The hollow for the simulator (lane s13-worlds step 3): every analytic world hands out the boxes its
// room is carved from (AnalyticWorld.cavities), so the simulator draws the room from the package
// instead of mirroring each generator (ShramkoGSFPV apps/fly/src/sonic/primitives.ts cavityBoxes).
// The boxes must BE the shell: on dense random points of the bounds, a point inside a box is free and
// a point outside every box is solid, wherever no object stands. Control: one box moved is caught.
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, CavityBox, Vec3 } from '../src/contract';
import { WORLD_GENERATORS } from '../src/contract';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { createRng } from '../src/util/rng';
import { createAnalyticWorld, GENERATOR_VERSIONS, makeSpec, paramSchema, shapeBoundRadius, type AnalyticWorldInfo } from '../src/world';

/** Every shipped lesson's world, and every generator at every version with its defaults and each of its layouts. */
function worlds(): { name: string; world: AnalyticWorldInfo }[] {
    const specs = new Map<string, { name: string; spec: AnalyticWorldSpec }>();
    for (const id of SHIPPED_LESSON_IDS) {
        const l = getLesson(id);
        if (l.world.kind === 'analytic') specs.set(JSON.stringify(l.world.spec), { name: id, spec: l.world.spec });
    }
    for (const g of WORLD_GENERATORS) {
        for (const v of GENERATOR_VERSIONS[g]) {
            specs.set(JSON.stringify(makeSpec(g, {}, 3, v)), { name: `${g} v${v}`, spec: makeSpec(g, {}, 3, v) });
            const layout = paramSchema(g, v)['layout'];
            if (layout !== undefined && layout.kind === 'enum') {
                for (const value of layout.values) {
                    const spec = makeSpec(g, { layout: value }, 3, v);
                    specs.set(JSON.stringify(spec), { name: `${g} v${v} ${value}`, spec });
                }
            }
        }
    }
    specs.set('open-ceiling', { name: 'open v1 ceiling', spec: makeSpec('open', { ceilingM: 6, halfSizeM: 30 }, 1, 1) });
    return [...specs.values()].map((s) => ({ name: s.name, world: createAnalyticWorld(s.spec) }));
}
const WORLDS = worlds();

const insideAny = (boxes: readonly CavityBox[], p: Vec3, grow = 0): boolean =>
    boxes.some((b) => Math.abs(p[0] - b.cx) <= b.hx + grow && Math.abs(p[1] - b.cy) <= b.hy + grow && Math.abs(p[2] - b.cz) <= b.hz + grow);

/** Within `tol` of a face of the union: inside some box grown by tol, but not deep inside any box shrunk by tol. */
const nearBoundary = (boxes: readonly CavityBox[], p: Vec3, tol: number): boolean => insideAny(boxes, p, tol) && !insideAny(boxes, p, -tol);

const nearObject = (w: AnalyticWorldInfo, p: Vec3): boolean =>
    w.objects().some((o) => o.solid && Math.hypot(p[0] - o.pos[0], p[1] - o.pos[1], p[2] - o.pos[2]) <= shapeBoundRadius(o.shape) + 0.05);

/** Points where the boxes and the world disagree, of `n` random points of the bounds (near faces and objects skipped). */
function disagreements(w: AnalyticWorldInfo, boxes: readonly CavityBox[], n: number, seed: number): { checked: number; wrong: number; first: Vec3 | null } {
    const rng = createRng(seed);
    const { min, max } = w.bounds;
    let checked = 0, wrong = 0;
    let first: Vec3 | null = null;
    for (let i = 0; i < n; i++) {
        const p: Vec3 = [rng.range(min[0], max[0]), rng.range(min[1], max[1]), rng.range(min[2], max[2])];
        if (nearBoundary(boxes, p, 0.003) || nearObject(w, p)) continue;
        checked++;
        if (insideAny(boxes, p) === w.solidAt(...p)) {
            wrong++;
            first ??= p;
        }
    }
    return { checked, wrong, first };
}

describe('the cavity boxes are the shell', () => {
    it('cover every generator at every version, and every shipped lesson', () => {
        const names = WORLDS.map((w) => w.name);
        for (const g of WORLD_GENERATORS) for (const v of GENERATOR_VERSIONS[g]) expect(names.some((x) => x.startsWith(`${g} v${v}`)), `${g} v${v}`).toBe(true);
        expect(WORLDS.length).toBeGreaterThanOrEqual(20);
    });

    for (const { name, world } of WORLDS) {
        if (world.spec.generator === 'open') {
            it(`${name}: no hollow (null), the ground below y = 0 is solid`, () => {
                expect(world.cavities).toBeNull();
                expect(world.solidAt(3, -0.01, 3)).toBe(true);
                expect(world.solidAt(3, 0.5, 3)).toBe(false);
            });
            continue;
        }
        it(`${name}: free inside the boxes and solid outside them, on 20 000 points (${world.cavities?.length ?? 0} boxes)`, () => {
            const boxes = world.cavities;
            expect(boxes).not.toBeNull();
            expect((boxes as CavityBox[]).length).toBeGreaterThan(0);
            const r = disagreements(world, boxes as CavityBox[], 20000, 7);
            expect(r.checked).toBeGreaterThan(8000);
            expect(r.wrong, `first at ${JSON.stringify(r.first)}`).toBe(0);
            // every box lies inside the bounds, with the shell's thickness around it
            for (const b of boxes as CavityBox[]) {
                expect(b.cx - b.hx).toBeGreaterThanOrEqual(world.bounds.min[0]);
                expect(b.cx + b.hx).toBeLessThanOrEqual(world.bounds.max[0]);
                expect(b.cy - b.hy).toBeGreaterThanOrEqual(world.bounds.min[1]);
                expect(b.cz + b.hz).toBeLessThanOrEqual(world.bounds.max[2]);
            }
        });
    }

    it('control: one box moved by half a metre is caught', () => {
        for (const name of ['walls-hall', 'corridor']) {
            const w = WORLDS.find((x) => x.name === name)!.world;
            const boxes = w.cavities as CavityBox[];
            const moved = boxes.map((b, i) => (i === 0 ? { ...b, cx: b.cx + 0.5 } : b));
            const r = disagreements(w, moved, 20000, 11);
            expect(r.wrong, name).toBeGreaterThan(20);
        }
    });

    it('are a copy: changing them changes nothing of the world', () => {
        const w = createAnalyticWorld(makeSpec('hall', {}, 0, 1));
        const boxes = w.cavities as CavityBox[];
        (boxes[0] as { cx: number }).cx = 99;
        expect(createAnalyticWorld(makeSpec('hall', {}, 0, 1)).cavities![0]!.cx).toBe(0);
        expect(w.solidAt(0, 1, 0)).toBe(false);
    });
});
