// M41-10, the runner's part: never silence in a flying lesson, so that silence always means something is
// wrong. Between attempts the runner keeps giving the planner the next attempt's first target, so the
// target layer goes on sounding while the attempt's lines are said and the pause runs. What else must keep
// sounding (a quiet bed, the motor) is the planner's and the host's: docs/dev/status-v0.13-lessons.md, needs from
// other lanes. Since lane s13-sound (M41-10, the planner's part) every flying lesson has the height tone and
// the room bed on, so with the lessons' own layers the pause sounds whatever the runner does: the runner's
// part is measured with v0.12's layers too (the lesson's layers without 'height' and 'room'), and the control
// uses only those. Measured with the cue planner; how it feels is for people.
import { describe, expect, it } from 'vitest';
import type { LessonDef, LessonLayers, SonicObject } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { getBuiltinTheme } from '../src/theme';
import { ScriptedPilot } from './helpers/pilot';
import { flyTruth, truthAnswerer } from './helpers/truth';

/** v0.12's layers of a lesson: its layers without the height tone and the bed, which lane s13-sound added to every flying lesson. */
function v012Layers(lesson: LessonDef): LessonLayers {
    return { ...lesson.layers, on: lesson.layers.on.filter((id) => id !== 'height' && id !== 'room') };
}

/** Flies a lesson with the truth bot and counts, frame by frame between attempts, what the planner sounds with the given layers (default: the lesson's own). */
function betweenAttempts(id: string, targetOf: (p: ScriptedPilot) => SonicObject | null, layersOf: (lesson: LessonDef) => LessonLayers = (l) => l.layers): { frames: number; silent: number; withTarget: number } {
    const lesson = getLesson(id);
    const p = new ScriptedPilot(lesson);
    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: layersOf(lesson) });
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
    it('in every flying lesson whose attempts begin with a target: a target in every frame of the pause, and never a silent frame, with the lesson\'s own layers and with v0.12\'s', () => {
        expect(WITH_TARGET.length).toBeGreaterThanOrEqual(8);
        for (const id of WITH_TARGET) {
            for (const [layers, layersOf] of [['own', undefined], ['v0.12', v012Layers]] as const) {
                const r = betweenAttempts(id, (p) => p.run.target(), layersOf);
                expect(r.frames, `${id}, ${layers} layers`).toBeGreaterThan(0);
                expect(r.withTarget, `${id}, ${layers} layers`).toBe(r.frames);
                expect(r.silent, `${id}, ${layers} layers`).toBe(0);
            }
        }
    }, 300000);

    it('control: with v0.12\'s layers and without the target between attempts (as v0.12 had it) the pause of hover-turn and of move-stop is silent but for the praise chime', () => {
        for (const id of ['hover-turn', 'move-stop']) {
            const r = betweenAttempts(id, (p) => (p.run.phase === 'flying' ? p.run.target() : null), v012Layers);
            expect(r.frames, id).toBeGreaterThan(0);
            expect(r.silent / r.frames, id).toBeGreaterThan(0.6);
        }
    }, 120000);
});
