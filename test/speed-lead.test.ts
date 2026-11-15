// Lane sonic4 (simulator train 3, the owner's message 51): leads in seconds at FPV speed (cues/lead.ts), the urgent
// distance at speed (rules.ts isUrgent), the gate aim's approach and through distances at speed (lesson/gate-aim.ts) and
// the racing line yielding to the gate aim in front of a gate (runner.ts beaconTarget, design 5). Under 4.5 m/s every
// distance is the metres of before.
import { describe, expect, it } from 'vitest';
import type { SonicObject, Vec3 } from '../src/contract';
import { isUrgent, URGENT_DISTANCE_M } from '../src/cues/rules';
import { gateAimLocal, GATE_AIM_APPROACH_M, GATE_AIM_PAST_M, GATE_AIM_THROUGH_M } from '../src/lesson/gate-aim';
import { toLocal } from '../src/lesson/goals';
import { getLesson } from '../src/lesson/library';
import { LINE_NEAR_AIM_M } from '../src/lesson/runner';
import { flyLesson } from '../src/pilot/ladder';

/** a ring of 2 m at the origin, entry side +Z (no yaw: local = world) */
const ring: SonicObject = { id: 'g1', shape: { kind: 'ring', diameter: 2, tube: 0.1 }, pos: [0, 0, 0], quat: [0, 0, 0, 1], order: 1, solid: true, material: 'gate' as unknown as SonicObject['material'] };

describe('urgent distance at speed', () => {
    it('under 4.5 m/s a hazard is urgent only within URGENT_DISTANCE_M (as before)', () => {
        for (const v of [0, 2, 4.4]) {
            expect(isUrgent(null, URGENT_DISTANCE_M - 0.01, v), `${v} m/s`).toBe(true);
            expect(isUrgent(null, URGENT_DISTANCE_M + 0.01, v), `${v} m/s`).toBe(false);
        }
    });

    it('at 8 m/s a wall 3 m away is urgent (stop 4 m + reaction 2 m), at 12 m/s one 10 m away', () => {
        expect(isUrgent(null, 3, 8)).toBe(true);
        expect(isUrgent(null, 6.1, 8)).toBe(false);
        expect(isUrgent(null, 10, 12)).toBe(true);
    });
});

describe('gate aim at speed', () => {
    it('under 4.5 m/s the approach and through distances are those of S1', () => {
        expect(gateAimLocal(ring, [6, 0, 8], 3)).toEqual([0, 0, GATE_AIM_APPROACH_M]);
        expect(gateAimLocal(ring, [0.3, 0.2, GATE_AIM_THROUGH_M], 3)).toEqual([0, 0, -GATE_AIM_PAST_M]);
        expect(gateAimLocal(ring, [0.3, 0.2, GATE_AIM_THROUGH_M + 0.5], 3)).toEqual([0, 0, 0]);
    });

    it('at 8 m/s the approach point lies a turn radius plus 1 s out on the axis (about 11.8 m), never behind the craft', () => {
        const a = gateAimLocal(ring, [25, 0, 30], 8) as Vec3;
        expect(a[0]).toBe(0);
        expect(a[2]).toBeGreaterThan(11);
        expect(a[2]).toBeLessThan(12.5);
        expect((gateAimLocal(ring, [12, 0, 10], 8) as Vec3)[2]).toBeCloseTo(5, 6);
        // behind the plane: around the frame out to the approach distance
        expect((gateAimLocal(ring, [0.5, 0, -4], 8) as Vec3)[2]).toBeGreaterThan(11);
    });

    it('at 8 m/s the hum points beyond the gate from 4.8 m in front of the opening (0.6 s), not only from 2 m', () => {
        expect(gateAimLocal(ring, [0.2, 0, 4.5], 8)).toEqual([0, 0, -GATE_AIM_PAST_M]);
        expect(gateAimLocal(ring, [0.2, 0, 4.5], 2)).toEqual([0, 0, 0]);
    });
});

describe('the racing line yields to the gate aim in front of a gate (design 5)', () => {
    it('with the line on, the hum is the gate aim within LINE_NEAR_AIM_M in front of the plane, the line further out', () => {
        const base = getLesson('rings-course');
        let near = 0;
        let far = 0;
        flyLesson({ ...base, layers: { ...base.layers, gateAim: true, racingLine: true } }, 2, 1, {
            trace: (f) => {
                const t = f.target;
                const b = f.beacon;
                if (t === null || t.order === null || b === null || b === undefined) return;
                const z = toLocal(t, f.pos)[2];
                if (z > 0.3 && z < LINE_NEAR_AIM_M - 0.3) {
                    near += 1;
                    expect(b.id, `z ${z.toFixed(2)}`).toBe(t.id);
                } else if (z > LINE_NEAR_AIM_M + 1) {
                    if (b.id !== t.id) far += 1;
                }
            }
        });
        expect(near).toBeGreaterThan(10);
        expect(far).toBeGreaterThan(10);
    });
});
