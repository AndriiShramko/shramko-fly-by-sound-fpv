// The height layer of v0.13 (M41-12, owner's message 41): the height tone glides with the height, never
// in steps, and a short note on the scale marks the target height about once a second (the band centre in a
// hover lesson, the next gate's centre in a ring or gate lesson); the height tone gives way to it, so the two
// never beat (review M2: the engine's part is measured by the rig, evidence/listen/VL-3-height.json). Each
// claim has a control that must fail.
import { describe, expect, it } from 'vitest';
import type { FlightSample, LessonLayers, SonicObject, SonicPrefs, SonicWorld, ThemeDef, Vec3 } from '../src/contract';
import { alignOffset, centsBetween, CuePlanner, heightTones, referenceHeightM, targetHeightM, type HeightPlan } from '../src/cues';
import { getLesson } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { applyCalm, BUILTIN_THEME_IDS, getBuiltinTheme, heightNoteIndex, isInScale, noteHz, noteHzAt } from '../src/theme';
import { yawQuat } from '../src/util/vec';
import { createAnalyticWorld } from '../src/world';

const THEMES: readonly ThemeDef[] = BUILTIN_THEME_IDS.map((id) => getBuiltinTheme(id));
const POLARITIES = ['up-higher', 'up-lower'] as const;

function sample(y: number, t = 0): FlightSample {
    return { t, tick: t, pos: [0, y, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

function gate(id: string, y: number, order: number): SonicObject {
    return { id, shape: { kind: 'ring', diameter: 2, tube: 0.1 }, pos: [0, y, -10 - order * 10], quat: [1, 0, 0, 0], order, solid: false, material: 'obstacle' };
}

/** A world with gates and nothing to hit: what the height layer needs of a ring lesson. */
function gateWorld(heights: readonly number[]): SonicWorld {
    const objects = heights.map((y, i) => gate(`ring-${i + 1}`, y, i));
    return { kind: 'analytic', id: 'gates', version: 1, bounds: { min: [-50, -1, -100], max: [50, 20, 50] }, castRay: () => null, objects: () => objects };
}

const HEIGHT_ONLY = (band: LessonLayers['heightBandM']): LessonLayers => ({ on: ['height'], heightBandM: band, hazardVoices: 0 });

function planAt(planner: CuePlanner, y: number, world: SonicWorld | null, target: SonicObject | null, t = 0): HeightPlan {
    const plan = planner.plan({ sample: sample(y, t), world, target, floorY: 0 });
    return plan.height as HeightPlan;
}

/** The largest pitch change between two heights 1 cm apart over 0 to 8 m, cents. */
function maxJumpCents(hzAt: (h: number) => number): number {
    let worst = 0;
    let prev = hzAt(0);
    for (let k = 1; k <= 800; k++) {
        const hz = hzAt(k / 100);
        worst = Math.max(worst, Math.abs(centsBetween(hz, prev)));
        prev = hz;
    }
    return worst;
}

describe('the height tone glides with the height, never in steps', () => {
    it('changes by under 15 cents between heights 1 cm apart, in every theme, polarity, pitch shift, calm and lesson', () => {
        let worst = 0;
        for (const theme of THEMES) {
            for (const polarity of POLARITIES) {
                for (const calm of [false, true]) {
                    for (const shift of [0, -2, 3]) {
                        const prefs: SonicPrefs = { ...defaultPrefs(), heightPolarity: polarity, calm, layerPitchSteps: { height: shift } };
                        for (const [band, world] of [
                            [[2, 3], null],
                            [null, gateWorld([3.2, 4.43])],
                            [null, null]
                        ] as const) {
                            const planner = new CuePlanner({ theme, prefs, layers: HEIGHT_ONLY(band) });
                            const jump = maxJumpCents((h) => planAt(planner, h, world, null).hz);
                            worst = Math.max(worst, jump);
                            expect(jump, `${theme.id} ${polarity} calm ${calm} shift ${shift}`).toBeLessThan(15);
                        }
                    }
                }
            }
        }
        expect(worst).toBeGreaterThan(0); // it does move
    });

    it('control: the stepped tone of v0.12 (heightNoteIndex, rounded to a note) fails the same check', () => {
        for (const theme of THEMES) {
            const p = theme.layers.height.params as Record<string, number>;
            const stepped = (h: number): number => noteHz(theme.scale, heightNoteIndex(h, { baseStep: p['baseStep'] as number, maxStep: p['maxStep'] as number, metresPerStep: p['metresPerStep'] as number, polarity: 'up-higher' }));
            const jump = maxJumpCents(stepped);
            expect(jump, theme.id).toBeGreaterThanOrEqual(15);
            expect(jump).toBeGreaterThanOrEqual(190); // a whole step: two or three semitones
        }
    });

    it('rises with the height (up-higher) and falls with it (up-lower), over the whole range', () => {
        for (const theme of THEMES) {
            for (const polarity of POLARITIES) {
                const planner = new CuePlanner({ theme, prefs: { ...defaultPrefs(), heightPolarity: polarity }, layers: HEIGHT_ONLY(null) });
                const a = planAt(planner, 0.5, null, null).hz;
                const b = planAt(planner, 3, null, null).hz;
                expect(polarity === 'up-higher' ? b > a : b < a, `${theme.id} ${polarity}`).toBe(true);
            }
        }
    });

    it('between two notes it is between them, not on either (the owner: where am I between the steps)', () => {
        const theme = getBuiltinTheme('soft');
        const planner = new CuePlanner({ theme, layers: HEIGHT_ONLY(null) });
        const lo = planAt(planner, 1.0, null, null);
        const mid = planAt(planner, 1.25, null, null);
        const hi = planAt(planner, 1.5, null, null);
        expect(mid.hz).toBeGreaterThan(lo.hz * 1.01);
        expect(mid.hz).toBeLessThan(hi.hz / 1.01);
        expect(mid.position - lo.position).toBeCloseTo(0.5, 9);
    });
});

describe('the target tone', () => {
    it('is in unison with the height tone exactly at the target height: band centres and gates, on the grid and off it', () => {
        for (const theme of THEMES) {
            for (const polarity of POLARITIES) {
                for (const calm of [false, true]) {
                    const prefs: SonicPrefs = { ...defaultPrefs(), heightPolarity: polarity, calm };
                    for (const [band, heights] of [
                        [[2, 3], []],
                        [[0.8, 1.6], []],
                        [null, [3]],
                        [null, [3, 4.43, 4.15, 2.7]],
                        [null, [1.2, 1.7]]
                    ] as const) {
                        const world = heights.length === 0 ? null : gateWorld(heights);
                        const planner = new CuePlanner({ theme, prefs, layers: HEIGHT_ONLY(band) });
                        const targets: (SonicObject | null)[] = world === null ? [null] : [...world.objects()];
                        for (const target of targets) {
                            const h = target === null ? ((band as readonly [number, number])[0] + (band as readonly [number, number])[1]) / 2 : target.pos[1];
                            const plan = planAt(planner, h, world, target);
                            expect(plan.target, `${theme.id} ${polarity}`).not.toBeNull();
                            const cents = centsBetween(plan.hz, plan.target!.hz);
                            expect(Math.abs(cents), `${theme.id} ${polarity} calm ${calm} target ${h}`).toBeLessThan(1e-6);
                        }
                    }
                }
            }
        }
    });

    it('is a note of the scale for the lesson reference and every target on its 0.5 m grid, and says when a target is off it', () => {
        for (const theme of THEMES) {
            for (const polarity of POLARITIES) {
                const world = gateWorld([3.2, 4.2, 2.7, 4.43]);
                const planner = new CuePlanner({ theme, prefs: { ...defaultPrefs(), heightPolarity: polarity }, layers: HEIGHT_ONLY(null) });
                const [g1, g2, g3, g4] = world.objects() as SonicObject[];
                for (const g of [g1, g2, g3]) {
                    const t = planAt(planner, 1, world, g as SonicObject).target!;
                    expect(t.onScale, `${theme.id} ${(g as SonicObject).pos[1]}`).toBe(true);
                    expect(isInScale(theme.scale, t.hz)).toBe(true);
                }
                const off = planAt(planner, 1, world, g4 as SonicObject).target!;
                expect(off.onScale).toBe(false);
                expect(off.noteIndex).toBeNull();
                // control for the scale check: an off-grid target really is off the scale
                expect(isInScale(theme.scale, off.hz)).toBe(false);
            }
        }
    });

    it('under the height tone means climb (up-higher); over it means climb when the pilot turned the polarity over', () => {
        for (const theme of THEMES) {
            for (const polarity of POLARITIES) {
                const planner = new CuePlanner({ theme, prefs: { ...defaultPrefs(), heightPolarity: polarity }, layers: HEIGHT_ONLY([2, 3]) });
                for (const below of [0.4, 1.5, 2.3, 2.49]) {
                    const p = planAt(planner, below, null, null);
                    const craftUnder = p.hz < p.target!.hz;
                    expect(craftUnder, `${theme.id} ${polarity} at ${below} m (target 2.5 m)`).toBe(polarity === 'up-higher');
                }
                for (const above of [2.51, 2.7, 3.5, 5]) {
                    const p = planAt(planner, above, null, null);
                    expect(p.hz > p.target!.hz, `${theme.id} ${polarity} at ${above} m`).toBe(polarity === 'up-higher');
                }
            }
        }
    });

    it('is nearer and nearer the height tone in pitch as the craft reaches the target, from below and from above, down to the same pitch', () => {
        const theme = getBuiltinTheme('soft');
        const planner = new CuePlanner({ theme, layers: HEIGHT_ONLY([2, 3]) });
        for (const side of [-1, 1]) {
            let prev = Infinity;
            for (const gap of [1, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.002, 0]) {
                const p = planAt(planner, 2.5 + side * gap, null, null);
                const beat = Math.abs(p.hz - p.target!.hz);
                expect(beat, `gap ${gap}`).toBeLessThan(prev + 1e-12);
                prev = beat;
            }
            expect(prev).toBe(0);
        }
        // at 5 cm the two are a few Hz apart (under a quarter of a semitone), at 0.5 m two or three semitones
        const near = planAt(planner, 2.55, null, null);
        expect(Math.abs(centsBetween(near.hz, near.target!.hz))).toBeGreaterThan(5);
        expect(Math.abs(centsBetween(near.hz, near.target!.hz))).toBeLessThan(40);
        const far = planAt(planner, 2, null, null);
        expect(Math.abs(centsBetween(far.hz, far.target!.hz))).toBeGreaterThan(190);
    });

    it('follows the next gate: a new target, a new note; no gate, the band centre; none, no tone', () => {
        const theme = getBuiltinTheme('soft');
        const world = gateWorld([3, 4, 2.5]);
        const [a, b, c] = world.objects() as SonicObject[];
        const planner = new CuePlanner({ theme, layers: HEIGHT_ONLY(null) });
        const ta = planAt(planner, 2, world, a as SonicObject, 0).target!;
        const tb = planAt(planner, 2, world, b as SonicObject, 16).target!;
        const tc = planAt(planner, 2, world, c as SonicObject, 33).target!;
        expect(ta.heightM).toBe(3);
        expect(tb.heightM).toBe(4);
        expect(tc.heightM).toBe(2.5);
        expect(tb.hz).toBeGreaterThan(ta.hz);
        expect(tc.hz).toBeLessThan(ta.hz);
        // the height tone is the same in all three frames: only the target moved
        expect(planAt(planner, 2, world, a as SonicObject, 50).hz).toBe(planAt(planner, 2, world, b as SonicObject, 66).hz);
        expect(planAt(planner, 2, world, null, 83).target).toBeNull();
        const band = new CuePlanner({ theme, layers: HEIGHT_ONLY([1, 2]) });
        expect(planAt(band, 1, null, null).target!.heightM).toBe(1.5);
        // a zone is not a height to fly through: the band (or nothing) stands
        const zone: SonicObject = { id: 'z', shape: { kind: 'zone', size: [4, 4, 4] }, pos: [0, 7, -20], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'floor' };
        expect(planAt(band, 1, null, zone).target!.heightM).toBe(1.5);
        expect(targetHeightM(zone, null, 0)).toBeNull();
    });

    it('is named in the active cues, and the pilot can turn it off', () => {
        const theme = getBuiltinTheme('soft');
        const on = new CuePlanner({ theme, layers: HEIGHT_ONLY([2, 3]) }).plan({ sample: sample(2.5), world: null, target: null, floorY: 0 });
        expect(on.cues.map((c) => c.id)).toEqual(['height.tone', 'height.target']);
        const off = new CuePlanner({ theme, prefs: { ...defaultPrefs(), heightTarget: false }, layers: HEIGHT_ONLY([2, 3]) }).plan({ sample: sample(2.5), world: null, target: null, floorY: 0 });
        expect(off.cues.map((c) => c.id)).toEqual(['height.tone']);
        expect(off.height!.target).toBeNull();
    });

    it('comes less often in the calm preset, and the band roughness is halved there', () => {
        for (const theme of THEMES) {
            const calm = applyCalm(theme);
            expect(calm.layers.height.params['targetPeriodMs']).toBeCloseTo((theme.layers.height.params['targetPeriodMs'] as number) * 1.3, 6);
            const a = new CuePlanner({ theme, layers: HEIGHT_ONLY([2, 3]) });
            const b = new CuePlanner({ theme, prefs: { ...defaultPrefs(), calm: true }, layers: HEIGHT_ONLY([2, 3]) });
            expect(planAt(b, 2.5, null, null).target!.periodS).toBeGreaterThan(planAt(a, 2.5, null, null).target!.periodS);
            expect(planAt(b, 4, null, null).rough).toBeCloseTo(planAt(a, 4, null, null).rough / 2, 6);
        }
    });

    it('is a short note about once a second, as loud as the height tone it stands in for (review M2)', () => {
        for (const theme of THEMES) {
            const t = planAt(new CuePlanner({ theme, layers: HEIGHT_ONLY([2, 3]) }), 2.5, null, null).target!;
            expect(t.periodS, theme.id).toBeGreaterThanOrEqual(0.8);
            expect(t.periodS, theme.id).toBeLessThanOrEqual(1.6);
            expect(t.noteS, theme.id).toBeLessThanOrEqual(t.periodS / 3);
            expect(Math.abs(t.gainDb), theme.id).toBeLessThanOrEqual(3);
        }
        // a theme with the longest note and the shortest period the schema allows: the note is held to a third of it
        const soft = getBuiltinTheme('soft');
        const tight: ThemeDef = { ...soft, layers: { ...soft.layers, height: { ...soft.layers.height, params: { ...soft.layers.height.params, targetNoteMs: 600, targetPeriodMs: 600 } } } };
        const t = planAt(new CuePlanner({ theme: tight, layers: HEIGHT_ONLY([2, 3]) }), 2.5, null, null).target!;
        expect(t.noteS).toBeCloseTo(0.2, 9);
    });
});

describe('the lessons hear it', () => {
    it('hover-height: the band centre, 2.5 m, is a note and the target', () => {
        const lesson = getLesson('hover-height');
        const theme = getBuiltinTheme('soft');
        const planner = new CuePlanner({ theme, layers: lesson.layers });
        const p = planAt(planner, 1, null, null);
        expect(p.target!.heightM).toBe(2.5);
        expect(p.target!.onScale).toBe(true);
    });

    it('every ring and gate lesson has the height layer on, and its gates give target tones on the scale', () => {
        const theme = getBuiltinTheme('soft');
        for (const id of ['rings-first', 'rings-line', 'rings-small', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube']) {
            const lesson = getLesson(id);
            expect(lesson.layers.on, id).toContain('height');
            if (lesson.world.kind !== 'analytic') continue;
            const world = createAnalyticWorld(lesson.world.spec);
            const planner = new CuePlanner({ theme, layers: lesson.layers });
            const gates = world.objects().filter((o) => o.order !== null);
            const first = gates[0] as SonicObject;
            const p = planAt(planner, 1, world, first);
            expect(p.target!.heightM, id).toBeCloseTo(first.pos[1], 9);
            expect(p.target!.onScale, id).toBe(true);
        }
    });

    it('the reference is the first gate, else the band centre; the alignment moves the mapping by at most half a step', () => {
        expect(referenceHeightM(gateWorld([4, 3]), [1, 2], 0)).toBe(4);
        expect(referenceHeightM(null, [1, 2], 0)).toBe(1.5);
        expect(referenceHeightM(null, null, 0)).toBeNull();
        for (const h of [0, 0.1, 0.24, 0.26, 2.5, 3.2, 4.43, 7.77]) {
            const off = alignOffset(h, 0.5);
            expect(Math.abs(off)).toBeLessThanOrEqual(0.5 + 1e-12);
            expect(Number.isInteger(Math.round((h / 0.5 + off) * 1e9) / 1e9)).toBe(true);
        }
    });

    it('heightTones agrees with noteHzAt and the pilot shift moves both tones by whole steps', () => {
        const theme = getBuiltinTheme('soft');
        const p = theme.layers.height.params as Record<string, number>;
        const rule = { baseStep: p['baseStep'] as number, maxStep: p['maxStep'] as number, metresPerStep: p['metresPerStep'] as number, roughDepth: 0.6, bandSoftM: 0.3, targetDb: 0, targetPeriodS: 1.25, targetNoteS: 0.28 };
        const t0 = heightTones(1.37, 2.5, [2, 3], rule, theme.scale, 'up-higher', 0, 0);
        const t2 = heightTones(1.37, 2.5, [2, 3], rule, theme.scale, 'up-higher', 0, 2);
        expect(t0.hz).toBeCloseTo(noteHzAt(theme.scale, t0.position), 9);
        expect(t2.position - t0.position).toBeCloseTo(2, 9);
        expect(t2.target!.position - t0.target!.position).toBe(2);
        const v: Vec3 = [0, 0, 0];
        expect(v).toHaveLength(3);
    });
});
