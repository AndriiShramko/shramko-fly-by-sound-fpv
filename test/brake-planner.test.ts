// Design 4 (simulator lane sonic5 W1.4) in the planner: on a course flown by the ear pilot at 8 m/s with the speed
// budget the brake cue sounds ('speed.brake', the speed plan's brake flag) in some frames; without the budget never.
import { describe, expect, it } from 'vitest';
import type { FramePlan } from '../src/cues/planner';
import { getLesson } from '../src/lesson/library';
import { flyLesson } from '../src/pilot/ladder';

function plans(id: string, speed: number, budget: boolean): FramePlan[] {
    const out: FramePlan[] = [];
    flyLesson(getLesson(id), speed, 1, { budget, trace: (f) => out.push(f.plan) });
    return out;
}

describe('the brake cue in the planner', () => {
    it('at 8 m/s on the rings course with the speed budget the brake cue sounds in some frames', () => {
        const braking = plans('rings-course', 8, true).filter((p) => p.speed !== null && p.speed.brake === true);
        expect(braking.length).toBeGreaterThan(0);
        for (const p of braking) expect(p.speed?.tempoHz ?? 0).toBeGreaterThan(0);
    });

    it('control: without the speed budget the brake cue never sounds', () => {
        expect(plans('rings-course', 8, false).some((p) => p.speed !== null && p.speed.brake === true)).toBe(false);
    });
});
