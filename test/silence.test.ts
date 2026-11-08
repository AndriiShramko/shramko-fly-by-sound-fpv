// M41-10, the runner's part: never silence in a flying lesson, so that silence always means something is
// wrong. Between attempts the runner keeps giving the planner the next attempt's first target, so the
// target layer goes on sounding while the attempt's lines are said and the pause runs. What else must keep
// sounding (a quiet bed, the motor) is the planner's and the host's: docs/wip/s13-lessons.md, needs from
// other lanes. Measured with the cue planner and the lesson's own layers; how it feels is for people.
import { describe, expect, it } from 'vitest';
import type { SonicObject } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { getBuiltinTheme } from '../src/theme';
import { ScriptedPilot } from './helpers/pilot';
import { flyTruth, truthAnswerer } from './helpers/truth';

/** Flies a lesson with the truth bot and counts, frame by frame between attempts, what the planner sounds. */
function betweenAttempts(id: string, targetOf: (p: ScriptedPilot) => SonicObject | null): { frames: number; silent: number; withTarget: number } {
    const lesson = getLesson(id);
    const p = new ScriptedPilot(lesson);
    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: lesson.layers });
    const out = { frames: 0, silent: 0, withTarget: 0 };
    let seen = 0;
    const tick = p.tick.bind(p);
    p.tick = (): void => {
        tick();
        for (; seen < p.actions.length; seen++) {
            const a = p.actions[seen];
            if (a?.kind === 'cue') planner.cue(a.event, p.t);
        }
        const target = targetOf(p);
        const plan = planner.plan({ sample: p.sample(false), world: p.world, target, floorY: p.analytic?.floorY ?? 0 });
        if (p.run.phase !== 'between') return;
        out.frames++;
        if (target !== null) out.withTarget++;
        if (plan.cues.length === 0) out.silent++;
    };
    p.answerer = truthAnswerer(p);
    p.begin();
    const phase = (): string => p.run.phase;
    for (let k = 0; k < 3 && phase() !== 'passed'; k++) {
        p.until(() => phase() === 'flying' || phase() === 'passed', 120);
        if (phase() === 'passed') break;
        const a = p.run.attempt;
        flyTruth(p);
        p.until(() => p.run.attempt > a || phase() === 'passed', 60);
    }
    return out;
}

/** the flying lessons whose attempts begin with a goal that has a target (a sound to turn to, a zone, a gate, a pillar) */
const WITH_TARGET = SHIPPED_LESSON_IDS.filter((id) => {
    const l = getLesson(id);
    const g = l.goals[0];
    return l.world.kind === 'analytic' && g !== undefined && ['turn-to', 'reach-zone', 'pass-gates', 'around', 'timed-course'].includes(g.kind) && l.pass.required > 1;
});

describe('between attempts the next attempt\'s target keeps sounding (M41-10, the runner\'s part)', () => {
    it('in every flying lesson whose attempts begin with a target: a target in every frame of the pause, and never a silent frame', () => {
        expect(WITH_TARGET.length).toBeGreaterThanOrEqual(8);
        for (const id of WITH_TARGET) {
            const r = betweenAttempts(id, (p) => p.run.target());
            expect(r.frames, id).toBeGreaterThan(0);
            expect(r.withTarget, id).toBe(r.frames);
            expect(r.silent, id).toBe(0);
        }
    }, 300000);

    it('control: without the target between attempts (as v0.12 had it) the pause of hover-turn and of move-stop is silent but for the praise chime', () => {
        for (const id of ['hover-turn', 'move-stop']) {
            const r = betweenAttempts(id, (p) => (p.run.phase === 'flying' ? p.run.target() : null));
            expect(r.frames, id).toBeGreaterThan(0);
            expect(r.silent / r.frames, id).toBeGreaterThan(0.6);
        }
    }, 120000);
});
