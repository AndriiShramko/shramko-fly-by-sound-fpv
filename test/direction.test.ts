// M41-15: which way is forward. "I flew, turned round and started flying, and it turned out I was flying
// the wrong way." A lesson with a track (the world's checkpoint list, the lesson's checkpoints, a course's
// gates) tells a pilot who flies against it for more than a second: the cue event 'wrong-way' and "You are
// flying back. Turn around.", at most once every 5 s; a gate crossed from its back side is told and not counted.
import { describe, expect, it } from 'vitest';
import type { CueEvent, SonicObject, SonicWorld, Vec3 } from '../src/contract';
import { getLesson, lessonTrack, toLocal, worldCheckpoints, WRONG_WAY_EVERY_S, type RunnerAction } from '../src/lesson';
import { quatRotate } from '../src/util/vec';
import { createAnalyticWorld } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';
import { flyTruth, truthAnswerer } from './helpers/truth';

type Say = Extract<RunnerAction, { kind: 'say' }>;
const lines = (p: ScriptedPilot, key: string): number => p.actions.filter((a): a is Say => a.kind === 'say' && a.line.key === key).length;
const cueOf = (p: ScriptedPilot, kind: CueEvent['kind']): CueEvent[] => p.actions.flatMap((a) => (a.kind === 'cue' && a.event.kind === kind ? [a.event] : []));

/** A landmark of a lesson's world (lane s13-worlds: the corridor's start, section-* and end; a room's walls): flights are laid out from it. */
function landmark(lessonId: string, id: string): Vec3 {
    const w = getLesson(lessonId).world;
    if (w.kind !== 'analytic') throw new Error(`${lessonId} has no analytic world`);
    const m = createAnalyticWorld(w.spec).landmarks.find((l) => l.id === id);
    if (m === undefined) throw new Error(`${lessonId} has no landmark ${id}`);
    return m.pos;
}
/** `metres` back along +Z from a point (the corridor's first straight runs along -Z) */
const back = (p: Vec3, metres: number): Vec3 => [p[0], p[1], p[2] + metres];

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
        // the corridor's first straight to its end (15 m), where the obstacle section begins
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        // turned round, flying back at 2 m/s for 7 s
        p.turnTo(180);
        const t0 = p.t;
        p.flyTo(back(straightEnd, 14), 2, false);
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
        const placed = p.placed;
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        p.flyTo(back(straightEnd, 1.5), 0.3, false); // 5 s at 0.3 m/s
        p.flyTo(back(straightEnd, 2.7), 2, false); // 0.6 s at 2 m/s
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        expect(p.placed, 'no touch moved the craft').toBe(placed);
        // and a room has no track: back and forth there is never the wrong way (from 0.5 m before its front wall to
        // 0.5 m before its back wall)
        const hall = new ScriptedPilot(getLesson('walls-hall'));
        hall.begin();
        hall.until(() => hall.run.phase === 'flying', 60);
        hall.flyTo([0, 1.5, landmark('walls-hall', 'wall-front')[2] + 0.5], 3, false);
        hall.flyTo([0, 1.5, landmark('walls-hall', 'wall-back')[2] - 0.5], 3, false);
        expect(lines(hall, 'fly.wrong-way')).toBe(0);
    }, 60000);

    it('takes the way from the world\'s own checkpoint list when the world has one (lane s13-worlds adds it)', () => {
        const lesson = getLesson('corridor');
        if (lesson.world.kind !== 'analytic') throw new Error('the corridor has a world');
        const built = createAnalyticWorld(lesson.world.spec);
        // the corridor's own world has its list (lane s13-worlds), and it rules
        expect(worldCheckpoints(built)?.length).toBeGreaterThan(lesson.checkpoints.length);
        expect(lessonTrack(lesson, built, built.objects(), lesson.start)?.source).toBe('world');
        // a list that says the first straight runs the other way: flying forward is now flying back
        const straightEnd = landmark('corridor', 'section-obstacle');
        const reversed = Object.assign(Object.create(built) as SonicWorld, { checkpoints: [15, 12.5, 10, 7.5, 5, 2.5, 0].map((m) => ({ pos: back(straightEnd, m), dir: [0, 0, 1] as Vec3 })) });
        expect(worldCheckpoints(reversed)).toHaveLength(7);
        expect(lessonTrack(lesson, reversed, built.objects(), lesson.start)?.source).toBe('world');
        const p = inCorridor(reversed);
        p.flyTo(straightEnd, 3);
        expect(lines(p, 'fly.wrong-way')).toBeGreaterThan(0);
        // control: the same flight with the world's own list is forward
        const q = inCorridor();
        q.flyTo(straightEnd, 3);
        expect(lines(q, 'fly.wrong-way')).toBe(0);
        // a list that is not one is ignored, and the lesson's checkpoints rule
        const broken = Object.assign(Object.create(built) as SonicWorld, { checkpoints: [{ pos: [0, 0] }] });
        expect(worldCheckpoints(broken)).toBeNull();
        expect(lessonTrack(lesson, broken, built.objects(), lesson.start)?.source).toBe('checkpoints');
    }, 60000);
});

/** A point in a gate's own frame (x to its side, z out of its front), in the world. */
const atGate = (g: Pick<SonicObject, 'pos' | 'quat'>, l: Vec3): Vec3 => {
    const r = quatRotate(g.quat, l);
    return [g.pos[0] + r[0], g.pos[1] + r[1], g.pos[2] + r[2]];
};

describe('flying back to a gate that was missed (review R1)', () => {
    // a pilot passes ring 2 beside it (further than a near miss: its frame and 2.5 m, inside the room), so the attempt
    // goes on and ring 2 stays the target, flies 3 m past it (short of ring 3), hears its hum behind him, turns round and
    // flies back at 3 m/s to its front (7 to 8 m, over 2 s), then through it
    it.each(['rings-line', 'rings-small', 'rings-course'])('%s: is never told the wrong way, and ring 2 counts from the front', (id) => {
        const p = new ScriptedPilot(getLesson(id));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1, r2] = p.objects().filter((o) => o.order !== null) as [SonicObject, SonicObject];
        const beside = (r2.shape as { diameter: number }).diameter / 2 + 2 * (r2.shape as { tube: number }).tube + 2.5;
        // the side of ring 2 with more room, and its front short of ring 1 (the rings are 5 to 7 m apart)
        const room = (sign: number): number => (p.analytic as NonNullable<typeof p.analytic>).sdf(...atGate(r2, [sign * beside, 0, 0]));
        const side = room(1) >= room(-1) ? 1 : -1;
        const front = Math.min(5, toLocal(r2, r1.pos)[2] - 1.5);
        p.flyTo(atGate(r1, [0, 0, 3]));
        p.flyTo(atGate(r1, [0, 0, -2])); // ring 1, forward
        p.flyTo(atGate(r2, [side * beside, 0, 3]));
        p.flyTo(atGate(r2, [side * beside, 0, -3])); // beside ring 2, past it
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id]);
        expect(p.run.phase).toBe('flying');
        p.flyTo(atGate(r2, [0, 0, front]), 3); // back to its front
        p.face(r2.pos);
        p.flyTo(atGate(r2, [0, 0, -2])); // and through it
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id, r2.id]);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        expect(cueOf(p, 'wrong-way')).toHaveLength(0);
        expect(lines(p, 'fly.wrong-side')).toBe(0);
    }, 60000);

    it('control: the same way back along the corridor is told', () => {
        const p = inCorridor();
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        p.turnTo(180);
        p.flyTo(back(straightEnd, 11), 3, false);
        expect(lines(p, 'fly.wrong-way')).toBe(1);
    }, 60000);

    it('control: in a course, flying back from the gate that counts next toward the start is still told', () => {
        const p = new ScriptedPilot(getLesson('rings-line'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1] = p.objects().filter((o) => o.order !== null) as [SonicObject];
        p.flyTo(atGate(r1, [0, 0, 4]));
        p.flyTo(atGate(r1, [0, 0, -2])); // ring 1, forward; ring 2 counts next, 4 m ahead
        p.turnTo(180);
        // back to 0.6 m before the room's back wall (7 m in front of ring 1), away from ring 2: further than LINE_UP_M
        // from it for the last 4.4 m, about 1.5 s at 3 m/s
        const wall = (p.world as SonicWorld).castRay(r1.pos, [0, 0, 1], 50)!.distance;
        p.flyTo(atGate(r1, [0, 0, wall - 0.6]), 3, false);
        expect(lines(p, 'fly.wrong-way')).toBe(1);
        // the cue says where ring 2 is: behind a pilot who faces back
        const dir = (cueOf(p, 'wrong-way')[0] as Extract<CueEvent, { kind: 'wrong-way' }>).dir as Vec3;
        expect(dir[2]).toBeGreaterThan(0.9);
    }, 60000);
});

describe('a gate crossed from its back side', () => {
    it('is told and not counted; crossed from the front it counts', () => {
        const p = new ScriptedPilot(getLesson('rings-line'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1, r2] = p.objects().filter((o) => o.order !== null) as [SonicObject, SonicObject];
        // beside ring 2: further than a near miss (its frame and 2 m) and inside the room (its walls 5 m from the line)
        const beside = (r2.shape as { diameter: number }).diameter / 2 + 2 * (r2.shape as { tube: number }).tube + 2.5;
        p.flyTo(atGate(r1, [0, 0, 3]));
        p.flyTo(atGate(r1, [0, 0, -2])); // ring 1, forward
        p.flyTo(atGate(r2, [beside, 0, 3]));
        p.flyTo(atGate(r2, [beside, 0, -3])); // beside ring 2, past it
        p.flyTo(atGate(r2, [0, 0, -2]));
        expect(lines(p, 'fly.wrong-side')).toBe(0);
        p.flyTo(atGate(r2, [0, 0, 2]), 3, false); // back through ring 2, from its back side
        expect(lines(p, 'fly.wrong-side')).toBe(1);
        expect(cueOf(p, 'wrong-side')).toHaveLength(1);
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id]);
        p.turnTo(0);
        p.flyTo(atGate(r2, [0, 0, -2])); // and through it from the front
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id, r2.id]);
        expect(lines(p, 'fly.wrong-side')).toBe(1);
    }, 60000);

    // the truth bot flies 4 m before and 4 m past each gate, so with gates 5 to 7 m apart it flies back 1 to 3 m between
    // two of them, within LINE_UP_M of the gate that counts next: a correct flight (s13-worlds' note to the merge); and
    // every attempt after the first begins with a place at the start, from past a gate (merge item 8g of s13-merge: the
    // runner took that jump for a crossing from the back side and told "wrong side" at the start of attempts 2 and 3)
    it.each(['rings-first', 'rings-line', 'rings-small', 'rings-heights', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube'])('%s flown by the truth bot to its pass: never told the wrong way or the wrong side', (id) => {
        const p = new ScriptedPilot(getLesson(id));
        p.answerer = truthAnswerer(p);
        p.begin();
        for (let k = 0; k < 6 && p.run.phase !== 'passed'; k++) {
            p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 600);
            if (p.run.phase !== 'passed') flyTruth(p);
        }
        expect(p.run.phase).toBe('passed');
        expect(p.of('touch')).toEqual([]);
        expect(cueOf(p, 'wrong-way')).toEqual([]);
        expect(cueOf(p, 'wrong-side')).toEqual([]);
        expect(lines(p, 'fly.wrong-way') + lines(p, 'fly.wrong-side')).toBe(0);
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
