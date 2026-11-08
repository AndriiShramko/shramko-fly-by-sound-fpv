// M41-20: respawn near the crash. "In the long tunnel it throws me back far, to the very start; do not
// throw the pilot back so far." A touch in a lesson that re-centres, or a short R, puts the craft 1 m before
// the furthest checkpoint passed in the attempt, facing along the track; the path flown goes back to what it
// was there; a long R still goes to the start. Tests on the corridor lesson.
import { describe, expect, it } from 'vitest';
import type { Pose, SonicWorld, Vec3 } from '../src/contract';
import { getLesson, RESPAWN_BEFORE_M, type RunnerAction } from '../src/lesson';
import { createAnalyticWorld } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';
import { corridorLine } from './helpers/truth';

const places = (p: ScriptedPilot): Extract<RunnerAction, { kind: 'place' }>[] => p.actions.filter((a): a is Extract<RunnerAction, { kind: 'place' }> => a.kind === 'place');

/** free distance straight ahead of a pose in the corridor's world, m */
function aheadM(world: SonicWorld, pose: Pose): number {
    const a = (pose.yawDeg * Math.PI) / 180;
    return world.castRay(pose.pos, [Math.sin(a), 0, -Math.cos(a)], 100)?.distance ?? 100;
}

function corridor(world?: SonicWorld): ScriptedPilot {
    const p = new ScriptedPilot(getLesson('corridor'), {}, world);
    p.begin();
    p.until(() => p.run.phase === 'flying', 60);
    return p;
}

/** the corridor's centre line up to the point `upTo` (inclusive) */
function line(p: ScriptedPilot): Vec3[] {
    if (p.analytic === null) throw new Error('the corridor has a world');
    return corridorLine(p.analytic.resolved);
}

describe('a touch or a short R: back to 1 m before the last checkpoint passed, facing along the corridor', () => {
    it('after the third checkpoint (the bends turn right there): placed before it, facing the bends, not the start', () => {
        const p = corridor();
        const pts = line(p);
        // through the obstacle section and 10 m into the first bend, then a touch
        for (const q of pts.slice(1, 5)) p.flyTo(q);
        p.flyTo([10, 2, -80]);
        expect(p.of('checkpoint').map((c) => c.id)).toEqual(['cp-1', 'cp-2', 'cp-3']);
        p.touchNext = true;
        p.tick();
        const back = places(p).at(-1);
        expect(back?.to).toBe('checkpoint');
        expect(back?.pose).toEqual({ pos: [0 - RESPAWN_BEFORE_M, 2, -80], yawDeg: 90 });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'cp-3' });
        // facing along the track: open corridor ahead (the first bend, 15 m and the corner), where the checkpoint's old pose faced a wall
        const world = p.world as SonicWorld;
        expect(aheadM(world, back?.pose as Pose)).toBeGreaterThan(15);
        expect(aheadM(world, { pos: [0, 2, -80], yawDeg: 0 })).toBeLessThan(3);
        // a short R does the same; a long R goes to the start, the same attempt again
        const r = p.run.reset('checkpoint', p.t);
        expect(r.pose).toEqual(back?.pose);
        const start = p.run.reset('start', p.t);
        expect(start.pose).toEqual(getLesson('corridor').start);
        expect(p.run.attempt).toBe(1);
    }, 60000);

    it('the path flown goes back to what it was at the checkpoint: a stretch flown twice is not counted twice', () => {
        // where the first goal (50 m flown) is met, with and without a touch at 45 m that sends the craft back to the start (cp-1)
        const at = (touch: boolean): Vec3 => {
            const p = corridor();
            p.flyTo([0, 2, -45]);
            if (touch) {
                p.touchNext = true;
                p.tick();
                expect(places(p).at(-1)?.pose.pos).toEqual([0, 2, 1]);
            }
            p.flyTo([0, 2, -60]);
            const met = p.log.findIndex((x) => 'event' in x && x.event.kind === 'goal');
            expect(met).toBeGreaterThan(0);
            return p.pos;
        };
        // the goal is met where it is met without the touch (at 50 m along the corridor); had the 45 m flown before the
        // touch still counted, it would be met about 5 m after the start instead
        const plain = at(false);
        expect(plain[2]).toBeLessThan(-49);
        p_close(at(true), plain);
    }, 60000);

    it('with the world\'s own checkpoint list, back to 1 m before the last point of it passed, facing its way', () => {
        const lesson = getLesson('corridor');
        if (lesson.world.kind !== 'analytic') throw new Error('the corridor has a world');
        const built = createAnalyticWorld(lesson.world.spec);
        const points = [0, -6, -12, -18, -24, -30, -36, -42, -48].map((z) => ({ pos: [0, 2, z] as Vec3, dir: [0, 0, -1] as Vec3 }));
        const dense = Object.assign(Object.create(built) as SonicWorld, { checkpoints: points });
        const p = corridor(dense);
        p.flyTo([0, 2, -27]);
        p.touchNext = true;
        p.tick();
        // the last point passed is the one at -24: 1 m before it, not the lesson's checkpoint at the start
        expect(places(p).at(-1)?.pose).toEqual({ pos: [0, 2, -23], yawDeg: 0 });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'w5' });
    }, 60000);

    it('with no checkpoint passed yet (a lesson without any) a short R goes to the start of the attempt', () => {
        const p = new ScriptedPilot(getLesson('rings-first'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        p.flyTo([0, 3, 66]);
        const r = p.run.reset('checkpoint', p.t);
        expect(r.pose).toEqual(getLesson('rings-first').start);
        expect(r.events[0]).toMatchObject({ kind: 'reset', to: 'checkpoint', checkpointId: null });
    }, 60000);
});

/** two points within 1.5 m of each other */
function p_close(a: Vec3, b: Vec3): void {
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1.5);
}

describe('a failed attempt of a course that re-centres: the next one begins where it got to (review R9)', () => {
    /** the corridor with a short time limit: the only way an attempt of it fails now */
    const timed = (onTouch: 'bump' | 'bump-recentre') => {
        const shipped = getLesson('corridor');
        return { ...shipped, attemptLimitS: 40, assists: { ...shipped.assists, onTouch } };
    };

    it('the attempt that ran out of time after cp-2: the next one 1 m before cp-2, the line says so, the path flown counts on', () => {
        const p = new ScriptedPilot(timed('bump-recentre'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        p.flyTo([0, 2, -60]); // past cp-2 (-50 m)
        p.until(() => p.run.phase === 'between', 60); // the time runs out
        expect(p.lessonWhat()).toContain('attempt-fail');
        expect(p.said()).toContain('lesson.corridor.retry'); // "Let's try again from the last checkpoint."
        p.until(() => p.run.attempt === 2, 30);
        expect(places(p).at(-1)).toEqual({ kind: 'place', pose: { pos: [0, 2, -50 + RESPAWN_BEFORE_M], yawDeg: 0 }, to: 'checkpoint' });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'cp-2' });
        // the path flown to cp-2 counts on, as after a touch: 7 m more meet its first goal (50 m flown) again
        p.flyTo([0, 2, -56]);
        expect(p.of('goal').filter((g) => g.index === 0 && g.what === 'met')).toHaveLength(2);
        // and a stage passed before is not said again
        expect(p.said().filter((k) => k === 'fly.stage')).toHaveLength(1);
    }, 60000);

    it('control: a course that does not re-centre, and B back to the task, still begin the next attempt at the start', () => {
        const p = new ScriptedPilot(timed('bump'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        p.flyTo([0, 2, -60]);
        p.until(() => p.run.attempt === 2, 90);
        expect(places(p).at(-1)).toMatchObject({ pose: getLesson('corridor').start, to: 'start' });
        const q = new ScriptedPilot(timed('bump-recentre'));
        q.begin();
        q.until(() => q.run.phase === 'flying', 60);
        q.flyTo([0, 2, -60]);
        q.until(() => q.run.phase === 'between', 60);
        q.press((run, t) => run.previous(t)); // B: the task again, then the next attempt
        q.until(() => q.run.attempt === 2, 60);
        expect(places(q).at(-1)).toMatchObject({ pose: getLesson('corridor').start, to: 'start' });
    }, 60000);
});

describe("a course's first attempt begins at its start (found with the simulator's corridor pilot)", () => {
    it('a pilot who flew on while the task was said goes back to the start at "Go."; the corridor is then passed in that attempt', () => {
        const p = new ScriptedPilot(getLesson('corridor'));
        p.begin();
        // the task is said (lines, then each named sound three times): the pilot flies on meanwhile, slowly
        p.flyTo([0, 2, -40], 1);
        expect(p.run.attempt).toBe(1);
        const atGo = places(p).at(-1);
        expect(atGo).toEqual({ kind: 'place', pose: getLesson('corridor').start, to: 'start' });
        expect(p.of('reset')).toHaveLength(1);
        // what the attempt counts is the corridor from its start: flown along its line, it is passed in this attempt
        for (const q of line(p)) if (p.run.phase === 'flying') p.flyTo(q);
        expect(p.lessonWhat()).toContain('passed');
        expect(p.run.attempt).toBe(1);
    }, 60000);

    it('control: a pilot who waits at the start during the task is not moved', () => {
        const p = corridor();
        expect(p.run.attempt).toBe(1);
        expect(places(p)).toHaveLength(1); // only begin()'s
        expect(p.of('reset')).toHaveLength(0);
    }, 60000);
});
