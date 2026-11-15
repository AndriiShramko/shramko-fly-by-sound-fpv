// Gate aim (sonic3 S1, layers.gateAim): the hum of a gate leads through the opening from the entry side (+Z): around the
// frame from behind, at the approach point off the axis, at the centre in the approach cone, beyond the gate close to the
// plane. The browser miss records of S1 (Tunis g1: entered from behind; g24: hovering at the centre with a steep hum).
import { describe, expect, it } from 'vitest';
import type { LessonDef, SonicObject, Vec3 } from '../src/contract';
import { gateAimLocal, GATE_AIM_APPROACH_M, GATE_AIM_PAST_M } from '../src/lesson/gate-aim';
import { toLocal } from '../src/lesson/goals';
import { getLesson } from '../src/lesson/library';
import { flyLesson } from '../src/pilot/ladder';
import { yawQuat } from '../src/util/vec';

/** a ring of 2 m at [0, 2, -10], turned 90 degrees (its +Z faces world +X) */
const gate: SonicObject = { id: 'g1', shape: { kind: 'ring', diameter: 2, tube: 0.1 }, pos: [0, 2, -10], quat: yawQuat(Math.PI / 2), order: 1, solid: true, material: 'gate' };
/** a world point from the gate's frame */
const world = (l: Vec3): Vec3 => {
    // the inverse of toLocal for this yaw: find it by toLocal of the axes (no new helper in the package)
    const ex = toLocal({ pos: [0, 0, 0], quat: gate.quat }, [1, 0, 0]);
    const ez = toLocal({ pos: [0, 0, 0], quat: gate.quat }, [0, 0, 1]);
    // local = R^T w, so w = R l with R's rows ex, ey, ez of the local images of the world axes
    return [gate.pos[0] + ex[0] * l[0] + ex[1] * l[1] + ex[2] * l[2], gate.pos[1] + l[1], gate.pos[2] + ez[0] * l[0] + ez[1] * l[1] + ez[2] * l[2]];
};

describe('gate aim, pure', () => {
    it('behind the plane: beside the frame on the entry side, on the side the craft is on', () => {
        const a = gateAimLocal(gate, world([0.5, 0, -4])) as Vec3;
        expect(a[2]).toBeCloseTo(GATE_AIM_APPROACH_M, 6);
        expect(a[0]).toBeGreaterThan(1.1);
        const b = gateAimLocal(gate, world([-0.5, 0, -4])) as Vec3;
        expect(b[0]).toBeLessThan(-1.1);
    });

    it('in front, off the axis: the approach point on the axis', () => {
        expect(gateAimLocal(gate, world([6, 0, 4]))).toEqual([0, 0, GATE_AIM_APPROACH_M]);
    });

    it('in the approach cone: the centre; close to the plane in front of the opening: beyond the gate', () => {
        expect(gateAimLocal(gate, world([0.5, 0, 8]))).toEqual([0, 0, 0]);
        expect(gateAimLocal(gate, world([0.3, 0.2, 1]))).toEqual([0, 0, -GATE_AIM_PAST_M]);
        expect(gateAimLocal(gate, world([0, 0, 0.05]))).toEqual([0, 0, -GATE_AIM_PAST_M]);
    });

    it('a zone is not aimed (it is passed by entering it)', () => {
        expect(gateAimLocal({ ...gate, shape: { kind: 'zone', size: [2, 2, 2] } }, [0, 0, 0])).toBeNull();
    });
});

describe('gate aim in a lesson (layers.gateAim)', () => {
    /** the hum's aim of the first gate at the start of the lesson, as the runner gives it (beaconTarget) */
    const firstAim = (lesson: LessonDef): { target: SonicObject; aim: SonicObject } => {
        let out: { target: SonicObject; aim: SonicObject } | null = null;
        flyLesson(lesson, 2, 1, {
            trace: (f) => {
                if (out === null && f.target !== null && f.target.order !== null && f.beacon !== null && f.beacon !== undefined) out = { target: f.target, aim: f.beacon };
            }
        });
        if (out === null) throw new Error('no gate target in the trace');
        return out;
    };

    it('the runner moves a gate hum off the gate centre toward the entry side when the lesson has gateAim', () => {
        const base = getLesson('rings-course');
        const on = firstAim({ ...base, layers: { ...base.layers, gateAim: true } });
        const local = toLocal(on.target, on.aim.pos);
        // the craft starts in front of gate 1 and more than 2 m out: centre or approach point, never behind the plane
        expect(local[2]).toBeGreaterThanOrEqual(0);
        expect(on.aim.id).toBe(on.target.id);
    });

    it('a gate hum is never at the gate centre while the craft is within 2 m in front of the opening', () => {
        const base = getLesson('rings-course');
        let near = 0;
        flyLesson({ ...base, layers: { ...base.layers, gateAim: true } }, 2, 1, {
            trace: (f) => {
                const t = f.target;
                const b = f.beacon;
                if (t === null || t.order === null || b === null || b === undefined) return;
                const l = toLocal(t, f.pos);
                if (l[2] > 0 && l[2] < 2 && Math.hypot(l[0], l[1]) < 0.5) {
                    near += 1;
                    expect(toLocal(t, b.pos)[2]).toBeLessThan(-1);
                }
            }
        });
        expect(near).toBeGreaterThan(0);
    });

    it('the ear pilot flies rings-course with the gate aim at 2 m/s', () => {
        expect(flyLesson(getLesson('rings-course'), 2, 1, { gateAim: true }).why).toBe('pass');
    });
});
