// M41-15: which way is forward. "I flew, turned round and started flying, and it turned out I was flying
// the wrong way." A lesson with a track (the world's checkpoint list, the lesson's checkpoints, a course's
// gates) tells a pilot who flies against it for more than a second: the cue event 'wrong-way' and "You are
// flying back. Turn around.", at most once every 5 s; a gate crossed from its back side is told and not counted.
import { describe, expect, it } from 'vitest';
import type { CueEvent, SonicWorld, Vec3 } from '../src/contract';
import { getLesson, lessonTrack, worldCheckpoints, WRONG_WAY_EVERY_S, type RunnerAction } from '../src/lesson';
import { createAnalyticWorld } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';

type Say = Extract<RunnerAction, { kind: 'say' }>;
const lines = (p: ScriptedPilot, key: string): number => p.actions.filter((a): a is Say => a.kind === 'say' && a.line.key === key).length;
const cueOf = (p: ScriptedPilot, kind: CueEvent['kind']): CueEvent[] => p.actions.flatMap((a) => (a.kind === 'cue' && a.event.kind === kind ? [a.event] : []));

/** the corridor, flying: a pilot at its start */
function inCorridor(world?: SonicWorld): ScriptedPilot {
    const p = new ScriptedPilot(getLesson('corridor'), {}, world);
    p.begin();
    p.until(() => p.run.phase === 'flying', 60);
    return p;
}

describe('flying the wrong way along a corridor', () => {
    it('is told after a second of flying back, at most once every 5 s; flying forward never', () => {
        const p = inCorridor();
        p.flyTo([0, 2, -30]);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        // turned round, flying back at 2 m/s for 7 s
        p.turnTo(180);
        const t0 = p.t;
        p.flyTo([0, 2, -16], 2, false);
        expect(lines(p, 'fly.wrong-way')).toBe(2);
        const told = p.actions.filter((a) => a.kind === 'cue' && a.event.kind === 'wrong-way');
        expect(told).toHaveLength(2);
        // the cue says where the track goes: behind a pilot who faces back
        const dir = (cueOf(p, 'wrong-way')[0] as Extract<CueEvent, { kind: 'wrong-way' }>).dir as Vec3;
        expect(dir[2]).toBeGreaterThan(0.9);
        expect((p.t - t0) / 1000).toBeGreaterThan(WRONG_WAY_EVERY_S + 1);
    }, 60000);

    it('is not told for a slow drift back or a short move back (controls)', () => {
        const p = inCorridor();
        p.flyTo([0, 2, -30]);
        p.flyTo([0, 2, -28.5], 0.3, false); // 5 s at 0.3 m/s
        p.flyTo([0, 2, -27.3], 2, false); // 0.6 s at 2 m/s
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        // and a hall has no track: back and forth there is never the wrong way
        const hall = new ScriptedPilot(getLesson('walls-hall'));
        hall.begin();
        hall.until(() => hall.run.phase === 'flying', 60);
        hall.flyTo([0, 1.5, -10], 3, false);
        hall.flyTo([0, 1.5, 10], 3, false);
        expect(lines(hall, 'fly.wrong-way')).toBe(0);
    }, 60000);

    it('takes the way from the world\'s own checkpoint list when the world has one (lane s13-worlds adds it)', () => {
        const lesson = getLesson('corridor');
        if (lesson.world.kind !== 'analytic') throw new Error('the corridor has a world');
        const built = createAnalyticWorld(lesson.world.spec);
        // a list that says the corridor runs the other way: flying forward is now flying back
        const reversed = Object.assign(Object.create(built) as SonicWorld, { checkpoints: [0, -6, -12, -18, -24, -30, -36].map((z) => ({ pos: [0, 2, z] as Vec3, dir: [0, 0, 1] as Vec3 })) });
        expect(worldCheckpoints(reversed)).toHaveLength(7);
        expect(lessonTrack(lesson, reversed, built.objects(), lesson.start)?.source).toBe('world');
        const p = inCorridor(reversed);
        p.flyTo([0, 2, -20], 3);
        expect(lines(p, 'fly.wrong-way')).toBeGreaterThan(0);
        // a list that is not one is ignored, and the lesson's checkpoints rule
        expect(worldCheckpoints(Object.assign(Object.create(built) as SonicWorld, { checkpoints: [{ pos: [0, 0] }] }))).toBeNull();
        expect(lessonTrack(lesson, built, built.objects(), lesson.start)?.source).toBe('checkpoints');
    }, 60000);
});

describe('a gate crossed from its back side', () => {
    it('is told and not counted; crossed from the front it counts', () => {
        const p = new ScriptedPilot(getLesson('rings-line'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        p.flyTo([0, 3, 64]);
        p.flyTo([0, 3, 56]); // ring 1, forward
        p.flyTo([8, 3, 52]);
        p.flyTo([8, 3, 40]); // beside ring 2, past it
        p.flyTo([0, 3, 42]);
        expect(lines(p, 'fly.wrong-side')).toBe(0);
        p.flyTo([0, 3, 50], 3, false); // back through ring 2, from its back side
        expect(lines(p, 'fly.wrong-side')).toBe(1);
        expect(cueOf(p, 'wrong-side')).toHaveLength(1);
        expect(p.of('gate').map((g) => g.gateId)).toEqual(['ring-1']);
        p.turnTo(0);
        p.flyTo([0, 3, 42]); // and through it from the front
        expect(p.of('gate').map((g) => g.gateId)).toEqual(['ring-1', 'ring-2']);
        expect(lines(p, 'fly.wrong-side')).toBe(1);
    }, 60000);

    it('control: a course flown forward is never told either thing', () => {
        const p = new ScriptedPilot(getLesson('rings-course'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        for (const g of p.objects().filter((o) => o.order !== null)) {
            const f = [2 * (g.quat[0] * g.quat[2]), 0, 1 - 2 * g.quat[2] * g.quat[2]] as Vec3; // the gate's +Z axis
            p.flyTo([g.pos[0] + f[0] * 4, g.pos[1], g.pos[2] + f[2] * 4]);
            p.flyTo([g.pos[0] - f[0] * 4, g.pos[1], g.pos[2] - f[2] * 4]);
        }
        expect(p.run.phase).toBe('passed');
        expect(lines(p, 'fly.wrong-way') + lines(p, 'fly.wrong-side')).toBe(0);
    }, 60000);
});
