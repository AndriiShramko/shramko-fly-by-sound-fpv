// M41-20: respawn near the crash. "In the long tunnel it throws me back far, to the very start; do not
// throw the pilot back so far." A touch in a lesson that re-centres, or a short R, puts the craft 1 m before
// the furthest checkpoint passed in the attempt, facing along the track; the path flown goes back to what it
// was there; a long R still goes to the start. Tests on the corridor lesson.
import { describe, expect, it } from 'vitest';
import type { Pose, SonicWorld, Vec3, WorldCheckpoint } from '../src/contract';
import { BODY_RADIUS_M, getLesson, lessonTrack, RESPAWN_BEFORE_M, type RunnerAction } from '../src/lesson';
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

/** the corridor's world as built (lane s13-worlds: with its own checkpoint list) */
function corridorWorld(): ReturnType<typeof createAnalyticWorld> {
    const lesson = getLesson('corridor');
    if (lesson.world.kind !== 'analytic') throw new Error('the corridor has a world');
    return createAnalyticWorld(lesson.world.spec);
}
/** the corridor's world without a checkpoint list of its own (as v0.12 built it): the lesson's checkpoints are the track */
function withoutList(): SonicWorld {
    return Object.assign(Object.create(corridorWorld()) as SonicWorld, { checkpoints: undefined });
}
/** a point of the corridor's track: `index` of its world list */
const trackPoint = (index: number): WorldCheckpoint => (corridorWorld().checkpoints as readonly WorldCheckpoint[])[index] as WorldCheckpoint;

describe('a touch or a short R: back to 1 m before the last checkpoint passed, facing along the corridor', () => {
    it('after the third checkpoint (the bends turn right there): placed at it (1 m before it is too near a wall), facing the bends, not the start', () => {
        // the lesson's checkpoints are the track of a world without a list of its own
        const lesson = getLesson('corridor');
        const bare = withoutList();
        expect(lessonTrack(lesson, bare, bare.objects(), lesson.start)?.source).toBe('checkpoints');
        const p = corridor(bare);
        const pts = line(p);
        const cp3 = lesson.checkpoints[2] as (typeof lesson.checkpoints)[number];
        expect(cp3.pose.yawDeg).toBe(90);
        // through the obstacle section to cp-3 and 4 m into the first bend (its leg is 6 m), then a touch
        for (const q of pts.slice(1, 5)) p.flyTo(q);
        p.flyTo([cp3.at[0] + 4, cp3.at[1], cp3.at[2]]);
        expect(p.of('checkpoint').map((c) => c.id)).toEqual(['cp-1', 'cp-2', 'cp-3']);
        p.touchNext = true;
        p.tick();
        const back = places(p).at(-1);
        expect(back?.to).toBe('checkpoint');
        // 1 m before it, facing the bends, lies 0.25 m from the straight's side wall in the 2.5 m corridor: closer than the
        // hull and 0.2 m, so the runner places the craft on the checkpoint itself, with its pose
        const world = p.world as SonicWorld;
        expect(corridorWorld().sdf(cp3.at[0] - RESPAWN_BEFORE_M, cp3.at[1], cp3.at[2])).toBeLessThan(BODY_RADIUS_M + 0.2);
        expect(back?.pose).toEqual({ pos: cp3.pose.pos, yawDeg: 90 });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'cp-3' });
        // facing along the track: open corridor ahead (the first bend's leg and the corner, 7 m), where the checkpoint
        // facing on along the straight would face a wall
        expect(aheadM(world, back?.pose as Pose)).toBeGreaterThan(6.5);
        expect(aheadM(world, { pos: cp3.at, yawDeg: 0 })).toBeLessThan(3);
        // a short R does the same; a long R goes to the start, the same attempt again
        const r = p.run.reset('checkpoint', p.t);
        expect(r.pose).toEqual(back?.pose);
        const start = p.run.reset('start', p.t);
        expect(start.pose).toEqual(getLesson('corridor').start);
        expect(p.run.attempt).toBe(1);
    }, 60000);

    it('the path flown goes back to what it was at the checkpoint: a stretch flown twice is not counted twice', () => {
        // where the first goal (15 m flown) is met, with and without a touch at 13 m that sends the craft back to 1 m before
        // the last point of the track passed (the world's point 10 m along the straight)
        const first = getLesson('corridor').goals[0] as { kind: string; metres: number };
        expect(first).toEqual({ kind: 'fly-distance', metres: 15 });
        const passed = trackPoint(2).pos;
        expect(passed).toEqual([0, 1.25, -10]);
        const at = (touch: boolean): Vec3 => {
            const p = corridor();
            let metAt: Vec3 | null = null;
            const tick = p.tick.bind(p);
            p.tick = () => {
                const pos = p.pos; // the sample this tick gives the runner
                tick();
                if (metAt === null && p.of('goal').some((g) => g.index === 0 && g.what === 'met')) metAt = pos;
            };
            p.flyTo([0, 1.25, -13]);
            if (touch) {
                p.touchNext = true;
                p.tick();
                expect(places(p).at(-1)?.pose.pos).toEqual([passed[0], passed[1], passed[2] + RESPAWN_BEFORE_M]);
            }
            p.flyTo([0, 1.25, -18]);
            expect(metAt).not.toBeNull();
            return metAt as unknown as Vec3;
        };
        // the goal is met where it is met without the touch (15 m along the corridor, 14 m with the metre before the point
        // flown again); had the 13 m flown before the touch still counted, it would be met 2 m after the respawn instead
        const plain = at(false);
        expect(plain[2]).toBeLessThan(-14.9);
        p_close(at(true), plain);
    }, 60000);

    it('with the world\'s own checkpoint list, back to 1 m before the last point of it passed, facing its way', () => {
        // the shipped corridor's world has its list (lane s13-worlds): the same flight as above, 4 m into the first bend
        const lesson = getLesson('corridor');
        const built = corridorWorld();
        expect(lessonTrack(lesson, built, built.objects(), lesson.start)?.source).toBe('world');
        const p = corridor();
        const cp3 = (lesson.checkpoints[2] as (typeof lesson.checkpoints)[number]).at;
        for (const q of line(p).slice(1, 5)) p.flyTo(q);
        p.flyTo([cp3[0] + 4, cp3[1], cp3[2]]);
        p.touchNext = true;
        p.tick();
        // the last point passed is the bend's first (1.25 m into it, facing +X): 1 m before it, facing its way, not the
        // lesson's checkpoint cp-3 (which would be 1 m before the corner)
        const w10 = trackPoint(9);
        expect(w10.dir).toEqual([1, 0, 0]);
        expect(places(p).at(-1)?.pose).toEqual({ pos: [w10.pos[0] - RESPAWN_BEFORE_M, w10.pos[1], w10.pos[2]], yawDeg: 90 });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'w10' });
    }, 60000);

    it('with no checkpoint passed yet (a lesson without any) a short R goes to the start of the attempt', () => {
        const p = new ScriptedPilot(getLesson('rings-first'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const ring = p.object('ring-1').pos;
        p.flyTo([ring[0], ring[1], ring[2] + 3]); // 2.5 m on, before the first point of its track (1.5 m before the ring)
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
        // cp-2 (-15 m, stage 1) is also a point of the world's track: past it, short of the next point (-16.875 m)
        const cp2 = (getLesson('corridor').checkpoints[1] as { at: Vec3 }).at;
        expect(trackPoint(3).pos).toEqual(cp2);
        p.flyTo([cp2[0], cp2[1], cp2[2] - 1]);
        p.until(() => p.run.phase === 'between', 60); // the time runs out
        expect(p.lessonWhat()).toContain('attempt-fail');
        expect(p.said()).toContain('lesson.corridor.retry'); // "Let's try again from the last checkpoint."
        p.until(() => p.run.attempt === 2, 30);
        expect(places(p).at(-1)).toEqual({ kind: 'place', pose: { pos: [cp2[0], cp2[1], cp2[2] + RESPAWN_BEFORE_M], yawDeg: 0 }, to: 'checkpoint' });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'w4' });
        // the path flown to cp-2 counts on, as after a touch: 2 m more meet its first goal (15 m flown) again, where 15 m
        // from nothing would end in the bend's wall
        p.flyTo([cp2[0], cp2[1], cp2[2] - 1]);
        expect(p.of('goal').filter((g) => g.index === 0 && g.what === 'met')).toHaveLength(2);
        // and a stage passed before is not said again
        expect(p.said().filter((k) => k === 'fly.stage')).toHaveLength(1);
    }, 60000);

    it('control: a course that does not re-centre, and B back to the task, still begin the next attempt at the start', () => {
        const cp2 = (getLesson('corridor').checkpoints[1] as { at: Vec3 }).at;
        const p = new ScriptedPilot(timed('bump'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        p.flyTo([cp2[0], cp2[1], cp2[2] - 1]);
        p.until(() => p.run.attempt === 2, 90);
        expect(places(p).at(-1)).toMatchObject({ pose: getLesson('corridor').start, to: 'start' });
        const q = new ScriptedPilot(timed('bump-recentre'));
        q.begin();
        q.until(() => q.run.phase === 'flying', 60);
        q.flyTo([cp2[0], cp2[1], cp2[2] - 1]);
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
        // the task is said (lines, then each named sound three times): the pilot flies on meanwhile, slowly, along the
        // corridor's track (125 m), until the runner moves the craft
        const placed = p.placed;
        for (const c of (p.analytic?.checkpoints ?? []).slice(1)) {
            if (p.placed !== placed) break;
            p.flyTo(c.pos, 1);
        }
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
