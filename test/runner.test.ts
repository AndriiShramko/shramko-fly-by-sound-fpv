import { describe, expect, it } from 'vitest';
import type { FlightSample, LessonDef, SessionEvent, SonicObject, SonicWorld, Vec3 } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { createLessonRunner, getLesson, GIVE_UP_MS, type LessonSession, type Question, type RunnerAction, type DemoScene } from '../src/lesson';
import { getBuiltinTheme } from '../src/theme';
import { yawQuat } from '../src/util/vec';
import { createAnalyticWorld } from '../src/world';

const DT = 20; // ms: 50 Hz

/** A scripted pilot: flies the craft, speaks every line at once, obeys 'place', answers questions. */
class Pilot {
    t = 0;
    pos: Vec3;
    vel: Vec3 = [0, 0, 0];
    yaw: number;
    touched = false;
    readonly events: SessionEvent[] = [];
    readonly actions: RunnerAction[] = [];
    readonly run: LessonSession;
    readonly world: SonicWorld | null;
    lastScene: DemoScene | null = null;
    answerer: ((q: Question, scene: DemoScene | null) => number) | null = null;

    constructor(readonly lesson: LessonDef, options: Parameters<typeof createLessonRunner>[1] = {}, world?: SonicWorld | null) {
        this.run = createLessonRunner(lesson, options);
        this.world = world !== undefined ? world : lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
        const start = options.start ?? lesson.start;
        this.pos = start.pos;
        this.yaw = start.yawDeg;
    }

    /** how many times the runner placed the craft: a scripted flight stops when it is moved */
    placed = 0;

    private take(): void {
        for (let guard = 0; guard < 50; guard++) {
            const a = this.run.takeActions();
            if (a.length === 0) return;
            this.actions.push(...a);
            for (const x of a) {
                if (x.kind === 'place') {
                    this.pos = x.pose.pos;
                    this.yaw = x.pose.yawDeg;
                    this.vel = [0, 0, 0];
                    this.placed++;
                }
                if (x.kind === 'scene' && x.scene !== null) this.lastScene = x.scene;
            }
            const ask = a.filter((x): x is Extract<RunnerAction, { kind: 'ask' }> => x.kind === 'ask');
            if (a.some((x) => x.kind === 'say')) this.events.push(...this.run.spoken(this.t));
            for (const q of ask) if (this.answerer !== null) this.events.push(...this.run.answer(this.answerer(q.question, this.lastScene), 'key', this.t));
        }
    }

    /** Begins the lesson; a flying lesson's task (its lines, each named sound three times) goes by before the first attempt. */
    begin(): void {
        this.events.push(...this.run.begin(this.t));
        this.take();
        if (this.lesson.world.kind !== 'none') this.until(() => this.run.phase !== 'intro', 120);
    }

    sample(): FlightSample {
        return { t: this.t, tick: this.t, pos: this.pos, vel: this.vel, quat: yawQuat(this.yaw), rate: [0, 0, 0], yawDeg: this.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: this.touched, paused: false };
    }

    tick(): void {
        this.t += DT;
        this.events.push(...this.run.step(this.sample(), this.world));
        this.touched = false;
        this.take();
    }

    /** Flies straight to `to` at `speed` m/s (stops there with zero velocity, or when the runner moves the craft). */
    flyTo(to: Vec3, speed = 3): void {
        const placed = this.placed;
        for (let guard = 0; guard < 100000 && this.placed === placed; guard++) {
            const d: Vec3 = [to[0] - this.pos[0], to[1] - this.pos[1], to[2] - this.pos[2]];
            const len = Math.hypot(...d);
            const step = (speed * DT) / 1000;
            if (len <= step) {
                this.pos = to;
                this.vel = [0, 0, 0];
                this.tick();
                return;
            }
            this.vel = [(d[0] / len) * speed, (d[1] / len) * speed, (d[2] / len) * speed];
            this.pos = [this.pos[0] + (d[0] / len) * step, this.pos[1] + (d[1] / len) * step, this.pos[2] + (d[2] / len) * step];
            this.tick();
        }
    }

    hold(seconds: number): void {
        this.vel = [0, 0, 0];
        const n = Math.round((seconds * 1000) / DT);
        for (let i = 0; i < n; i++) this.tick();
    }

    until(cond: () => boolean, maxSeconds = 600): void {
        const n = Math.round((maxSeconds * 1000) / DT);
        for (let i = 0; i < n && !cond(); i++) this.tick();
    }

    of<K extends SessionEvent['kind']>(kind: K): Extract<SessionEvent, { kind: K }>[] {
        return this.events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
    }

    lessonWhat(): string[] {
        return this.of('lesson').map((e) => e.what);
    }

    said(): string[] {
        return this.actions.filter((a): a is Extract<RunnerAction, { kind: 'say' }> => a.kind === 'say').map((a) => a.line.key);
    }

    /** the first attempt's outcome */
    firstAttempt(): 'attempt-pass' | 'attempt-fail' | null {
        const e = this.of('lesson').find((x) => x.what === 'attempt-pass' || x.what === 'attempt-fail');
        return e === undefined ? null : (e.what as 'attempt-pass' | 'attempt-fail');
    }
}

const goalEvents = (p: Pilot): string[] => p.of('goal').map((g) => `${g.index}:${g.what}`);

describe('every goal kind: a scripted pass and a near miss', () => {
    it('hold-height: in the band 80 % of 20 s passes, 70 % misses', () => {
        const pass = new Pilot(getLesson('hover-height'));
        pass.begin();
        pass.flyTo([0, 2.5, 0], 1);
        pass.hold(21);
        expect(goalEvents(pass)).toEqual(['0:met']);
        expect(pass.firstAttempt()).toBe('attempt-pass');

        const near = new Pilot(getLesson('hover-height'));
        near.begin();
        near.flyTo([0, 2.5, 0], 1);
        near.hold(14);
        near.pos = [0, 3.5, 0];
        near.hold(7);
        expect(goalEvents(near)[0]).toBe('0:missed');
        expect(near.firstAttempt()).toBe('attempt-fail');
    });

    it('turn-to: facing the sound and holding passes; swinging through it does not', () => {
        const lesson = getLesson('hover-turn');
        const turn = (p: Pilot, to: number, seconds: number): void => {
            const from = p.yaw;
            const n = Math.round((seconds * 1000) / DT);
            for (let i = 1; i <= n; i++) {
                p.yaw = from + ((to - from) * i) / n;
                p.tick();
            }
        };
        const pass = new Pilot(lesson);
        pass.begin();
        turn(pass, -83, 2);
        pass.hold(1);
        expect(goalEvents(pass)).toEqual(['0:met']);

        const near = new Pilot(lesson);
        near.begin();
        turn(near, -150, 2.5); // passes the sound at about 60 degrees per second, never holds it
        near.hold(30);
        expect(goalEvents(near)[0]).toBe('0:missed');
        expect(near.firstAttempt()).toBe('attempt-fail');
        // the next attempt starts turned another way, so the sound comes from another side
        const places = near.actions.filter((a): a is Extract<RunnerAction, { kind: 'place' }> => a.kind === 'place');
        expect(places.length).toBeGreaterThanOrEqual(2);
        expect(places[1]!.pose.yawDeg).not.toBe(places[0]!.pose.yawDeg);
    });

    it('reach-zone: stopping inside the zone passes, stopping 2 m short misses', () => {
        const pass = new Pilot(getLesson('move-stop'));
        pass.begin();
        pass.flyTo([0, 1.5, -30], 4);
        pass.hold(1);
        expect(goalEvents(pass)).toEqual(['0:met']);

        const near = new Pilot(getLesson('move-stop'));
        near.begin();
        near.flyTo([0, 1.5, -25], 4);
        near.hold(GIVE_UP_MS / 1000 + 0.5);
        expect(goalEvents(near)).toEqual(['0:missed']);
    });

    it('reach-zone after fly-distance (move-speed): a flight forward then a stop', () => {
        const p = new Pilot(getLesson('move-speed'));
        p.begin();
        p.flyTo([0, 1.5, -9], 2);
        p.hold(1);
        expect(goalEvents(p)).toEqual(['0:met', '1:met']);
    });

    it('approach-stop: stopping 2.5 m from a wall passes, stopping 6 m away misses', () => {
        const pass = new Pilot(getLesson('walls-hall'));
        pass.begin();
        pass.flyTo([0, 1.5, -27.5], 3);
        pass.hold(1);
        expect(goalEvents(pass)).toEqual(['0:met']);

        const near = new Pilot(getLesson('walls-hall'));
        near.begin();
        near.flyTo([0, 1.5, -24], 3);
        near.hold(GIVE_UP_MS / 1000 + 0.5);
        expect(goalEvents(near)).toEqual(['0:missed']);
    });

    it('around: a full circle around the pillar passes, 300 degrees then waiting misses', () => {
        const lesson = getLesson('walls-pillar');
        const circle = (p: Pilot, degrees: number): void => {
            const c: Vec3 = [0, 1.5, 7];
            const r = 4;
            p.flyTo([c[0], 1.5, c[2] + r], 3);
            const n = Math.round(degrees / 1.5);
            for (let i = 1; i <= n; i++) {
                const a = Math.PI / 2 + (i * 1.5 * Math.PI) / 180;
                p.pos = [c[0] + r * Math.cos(a), 1.5, c[2] + r * Math.sin(a)];
                p.vel = [-r * Math.sin(a), 0, r * Math.cos(a)];
                p.tick();
            }
        };
        const pass = new Pilot(lesson);
        pass.begin();
        circle(pass, 370);
        expect(goalEvents(pass)).toEqual(['0:met']);

        const near = new Pilot(lesson);
        near.begin();
        circle(near, 300);
        near.hold(lesson.attemptLimitS as number);
        expect(goalEvents(near)).toEqual(['0:missed']);
    });

    it('fly-distance: 22 m between the pillars passes, 20 m and then waiting misses', () => {
        const lesson = getLesson('walls-row');
        const pass = new Pilot(lesson);
        pass.begin();
        pass.flyTo([3.5, 1.5, 22], 2);
        pass.flyTo([3.5, 1.5, 22 - 22], 3);
        expect(goalEvents(pass)).toEqual(['0:met']);

        const near = new Pilot(lesson);
        near.begin();
        near.flyTo([0, 1.5, 2], 3);
        near.hold(lesson.attemptLimitS as number);
        expect(goalEvents(near)).toEqual(['0:missed']);
    });

    it('pass-gates: through the ring passes with a gate note; through its edge is a near miss', () => {
        const lesson = getLesson('rings-first');
        const pass = new Pilot(lesson);
        pass.begin();
        pass.flyTo([0, 3, 55], 3);
        expect(goalEvents(pass)).toEqual(['0:met']);
        expect(pass.of('gate').map((g) => g.gateId)).toEqual(['ring-1']);
        expect(pass.actions.some((a) => a.kind === 'cue' && a.event.kind === 'gate')).toBe(true);
        expect(pass.actions.some((a) => a.kind === 'cue' && a.event.kind === 'lap')).toBe(true);

        const near = new Pilot(lesson);
        near.begin();
        near.flyTo([1.9, 3, 66], 3);
        near.flyTo([1.9, 3, 55], 3);
        expect(goalEvents(near)).toEqual(['0:missed']);
        expect(near.of('gate')).toEqual([]);
    });

    it('pass-gates in order: a line of rings, each note higher', () => {
        const p = new Pilot(getLesson('rings-line'));
        p.begin();
        p.flyTo([0, 3, 20], 4);
        expect(p.of('gate').map((g) => g.index)).toEqual([0, 1, 2]);
        expect(goalEvents(p)).toEqual(['0:met']);
        const notes = p.actions.filter((a) => a.kind === 'cue' && a.event.kind === 'gate').map((a) => (a as { event: { index: number; of: number } }).event);
        expect(notes).toEqual([
            { kind: 'gate', index: 0, of: 3 },
            { kind: 'gate', index: 1, of: 3 },
            { kind: 'gate', index: 2, of: 3 }
        ]);
    });

    it('name-shape: through the cube, then "cube" passes; "square" is a near miss; skipping still counts', () => {
        const lesson = getLesson('shapes-cube');
        const fly = (answer: number): Pilot => {
            const p = new Pilot(lesson);
            p.answerer = () => answer;
            p.begin();
            p.flyTo([0, 3, 55], 3);
            p.hold(0.5);
            return p;
        };
        expect(goalEvents(fly(3))).toEqual(['0:met', '1:met']);
        const wrong = fly(2);
        expect(goalEvents(wrong)).toEqual(['0:met', '1:missed']);
        expect(wrong.firstAttempt()).toBe('attempt-fail');
        const skip = fly(0);
        expect(goalEvents(skip)).toEqual(['0:met', '1:met']);
        expect(skip.of('answer')[0]).toMatchObject({ value: null, via: 'skip' });
    });

    it('timed-course: the whole chain keeps the best time; a missed last gate does not', () => {
        const lesson = getLesson('free-garden');
        const gates: SonicObject[] = [-10, -25, -40].map((z, i) => ({ id: `g${i + 1}`, shape: { kind: 'ring', diameter: 3, tube: 0.1 }, pos: [0, 3, z], quat: [1, 0, 0, 0], order: i, solid: false, material: 'obstacle' }));
        const options = { objects: gates, start: { pos: [0, 3, 0] as Vec3, yawDeg: 0 } };
        const pass = new Pilot(lesson, options, null);
        pass.begin();
        pass.flyTo([0, 3, -45], 5);
        expect(goalEvents(pass)).toEqual(['0:met']);
        const best = pass.run.progress().bestTimeMs;
        expect(best).not.toBeNull();
        expect(best!).toBeGreaterThanOrEqual(7900); // 40 m to the last gate at 5 m/s
        expect(best!).toBeLessThanOrEqual(8100);
        expect(pass.said()).toContain('fly.best-time');

        const near = new Pilot(lesson, options, null);
        near.begin();
        near.flyTo([0, 3, -30], 5);
        near.flyTo([2.2, 3, -35], 5);
        near.flyTo([2.2, 3, -45], 5);
        expect(goalEvents(near)).toEqual(['0:missed']);
        expect(near.run.progress().bestTimeMs).toBeNull();
    });

    it('locate (the headphone check): left, right, behind passes; swapped answers say so and repeat', () => {
        const right = (q: Question): number => (q.id.endsWith(':side') ? (q.id.split(':')[2] === '1' ? 1 : 2) : 2);
        const pass = new Pilot(getLesson('ears-headphones'));
        pass.answerer = right;
        pass.begin();
        pass.until(() => pass.run.phase === 'passed', 120);
        expect(goalEvents(pass)).toEqual(['0:met']);
        expect(pass.said()).toContain('headphones.good');
        expect(pass.run.progress().passed).toBe(true);

        const swapped = new Pilot(getLesson('ears-headphones'));
        swapped.answerer = (q) => (q.id.endsWith(':side') ? 3 - right(q) : 2);
        swapped.begin();
        swapped.until(() => swapped.of('lesson').some((e) => e.what === 'attempt-fail'), 120);
        expect(goalEvents(swapped)).toEqual(['0:missed']);
        expect(swapped.said()).toContain('headphones.swapped');
        expect(swapped.run.progress().passed).toBe(false);
        swapped.hold(3);
        expect(swapped.run.attempt).toBe(2); // the check runs again
    });

    it('name-cues and locate (the game): right answers pass it; a near miss is scored but never blocks', () => {
        const lesson = getLesson('ears-game');
        const first = lesson.goals[0];
        const cues: readonly string[] = first?.kind === 'name-cues' ? first.cues : [];
        const sides: Vec3[] = [
            [-1, 0, 0],
            [1, 0, 0],
            [0, 0, -1],
            [0, 0, 1]
        ];
        const truth = (q: Question, s: DemoScene | null): number => {
            if (s === null) return 1;
            if (q.id.endsWith(':what')) return cues.indexOf(s.cue) + 1;
            if (q.id.endsWith(':where')) return sides.findIndex((d) => d[0] === s.dir[0] && d[2] === s.dir[2]) + 1;
            return s.moving ? 1 : 2;
        };
        const pass = new Pilot(lesson, { seed: 3 });
        pass.answerer = truth;
        pass.begin();
        pass.until(() => pass.run.phase === 'passed', 900);
        expect(goalEvents(pass)).toEqual(['0:met', '1:met']);
        expect(pass.lessonWhat().filter((w) => w === 'block-pass').length).toBe(1);
        expect(pass.run.progress()).toMatchObject({ passed: true, blocksPassed: 1 });

        let whats = 0;
        const near = new Pilot(lesson, { seed: 3 });
        near.answerer = (q, s) => {
            if (q.id.endsWith(':what') && whats++ === 2) return (truth(q, s) % cues.length) + 1; // one wrong name of eight: 87.5 % < 90 %
            return truth(q, s);
        };
        near.begin();
        near.until(() => near.run.phase === 'passed', 900);
        expect(goalEvents(near)).toEqual(['0:missed', '1:met', '0:met', '1:met']);
        expect(near.run.progress()).toMatchObject({ passed: true, blocksPassed: 1 });
        expect(near.said()).toContain('quiz.score');
    });

    it('name-cues with no trials: the glossary and the narrated walls play to the end and pass', () => {
        for (const id of ['ears-glossary', 'ears-walls', 'ears-shapes']) {
            const p = new Pilot(getLesson(id));
            p.begin();
            p.until(() => p.run.phase === 'passed', 600);
            expect(goalEvents(p), id).toEqual(['0:met']);
            expect(p.actions.some((a) => a.kind === 'cue' && a.event.kind === 'fanfare'), id).toBe(true);
        }
    });
});

describe('module 0 scenes are heard as in flight', () => {
    it('a wall narrated from the left sounds as a hazard on the left, coming closer', () => {
        const p = new Pilot(getLesson('ears-walls'));
        p.begin();
        p.until(() => p.lastScene !== null && p.lastScene.dir[0] < 0, 60);
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: getLesson('ears-walls').layers });
        const periods: number[] = [];
        for (let i = 0; i < 150; i++) {
            p.tick();
            const frame = p.run.demoFrame(p.t);
            if (frame === null) break;
            const v = planner.plan(frame).voices.find((x) => x.layer === 'safety');
            if (v !== undefined) {
                expect(v.dir[0]).toBeLessThan(-0.9);
                expect(v.cue).toBe('safety.wall');
                periods.push(v.periodS as number);
            }
        }
        expect(periods.length).toBeGreaterThan(50);
        expect(periods.at(-1)!).toBeLessThan(periods[0]!); // the pulses quicken as it nears
        expect(p.said()).toContain('narrate.coming');
        expect(p.said()).toContain('dir.left');
    });
});

describe('pass rules, touches, resets and progress', () => {
    it('3 counted attempts in total pass the lesson; failures in between do not reset the count', () => {
        const lesson = getLesson('rings-first');
        const p = new Pilot(lesson);
        p.begin();
        const through = (): void => p.flyTo([0, 3, 55], 6);
        const miss = (): void => {
            p.flyTo([1.9, 3, 66], 6);
            p.flyTo([1.9, 3, 55], 6);
        };
        for (const fly of [miss, through, miss, through, miss]) {
            fly();
            p.hold(3);
        }
        expect(p.run.phase).not.toBe('passed');
        expect(p.run.progress()).toMatchObject({ attempts: 5, successes: 2, blocksPassed: 0, passed: false });
        through();
        p.hold(3);
        expect(p.run.phase).toBe('passed');
        expect(p.lessonWhat().filter((w) => w.startsWith('attempt-') && w !== 'attempt-start')).toEqual(['attempt-fail', 'attempt-pass', 'attempt-fail', 'attempt-pass', 'attempt-fail', 'attempt-pass']);
        expect(p.lessonWhat().slice(-2)).toEqual(['block-pass', 'passed']);
        expect(p.run.progress()).toMatchObject({ attempts: 6, successes: 3, blocksPassed: 1, passed: true });
        expect(p.actions.some((a) => a.kind === 'cue' && a.event.kind === 'fanfare')).toBe(true);
        expect(p.said()).toContain('lesson.rings-first.pass');
    });

    it('a goal met with more touches than the rule allows is a failed attempt', () => {
        const p = new Pilot(getLesson('walls-hall'));
        p.begin();
        p.flyTo([0, 1.5, -20], 3);
        p.touched = true;
        p.tick();
        p.touched = true;
        p.tick();
        p.flyTo([0, 1.5, -27.5], 3);
        p.hold(1);
        expect(goalEvents(p)).toEqual(['0:met']);
        expect(p.of('touch').length).toBe(2);
        expect(p.firstAttempt()).toBe('attempt-fail');
        expect(p.said()).toContain('lesson.walls-hall.retry');
    });

    it('the corridor: checkpoints are reached in turn and a touch puts the craft back at the last one', () => {
        const lesson = getLesson('corridor');
        const p = new Pilot(lesson);
        p.begin();
        p.flyTo([0, 2, -55], 4);
        expect(p.of('checkpoint').map((c) => c.id)).toEqual(['cp-1', 'cp-2']);
        expect(goalEvents(p)).toEqual(['0:met']);
        p.touched = true;
        p.tick();
        const place = p.actions.filter((a): a is Extract<RunnerAction, { kind: 'place' }> => a.kind === 'place').at(-1)!;
        expect(place.to).toBe('checkpoint');
        // 1 m before the checkpoint, facing along the corridor (M41-20)
        expect(place.pose).toEqual({ pos: [0, 2, -49], yawDeg: 0 });
        expect(p.of('reset').at(-1)).toMatchObject({ to: 'checkpoint', checkpointId: 'cp-2' });
        expect(p.pos).toEqual([0, 2, -49]);
    });

    it('reset to the last checkpoint and to the start; a reset to the start begins the same attempt again', () => {
        const lesson = getLesson('corridor');
        const p = new Pilot(lesson);
        p.begin();
        p.flyTo([0, 2, -55], 4);
        const cp = p.run.reset('checkpoint', p.t);
        expect(cp.pose).toEqual({ pos: [0, 2, -49], yawDeg: 0 });
        expect(cp.events[0]).toMatchObject({ kind: 'reset', to: 'checkpoint', checkpointId: 'cp-2' });
        const start = p.run.reset('start', p.t);
        expect(start.pose).toEqual(lesson.start);
        expect(p.run.attempt).toBe(1);
        expect(p.run.touches).toBe(0);
    });

    it('an attempt that runs out of time is missed', () => {
        const lesson = getLesson('rings-first');
        const p = new Pilot(lesson);
        p.begin();
        p.hold((lesson.attemptLimitS as number) + 0.5);
        expect(goalEvents(p)).toEqual(['0:missed']);
    });

    it('progress carries on from earlier progress and dates itself on the session clock', () => {
        const lesson = getLesson('rings-first');
        const p = new Pilot(lesson, { progress: { lessonId: 'rings-first', version: 2, attempts: 4, successes: 1, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-01T10:00:00.000Z' }, sessionStartMs: Date.UTC(2026, 10, 7, 12) });
        p.begin();
        p.flyTo([0, 3, 55], 3);
        const pr = p.run.progress();
        expect(pr).toMatchObject({ lessonId: 'rings-first', attempts: 5, successes: 2, passed: false });
        expect(pr.lastAt.startsWith('2026-11-07T12:00:')).toBe(true);
        // progress of another version of the lesson (v0.12's rule) is not counted on: only a pass is kept
        const old = new Pilot(lesson, { progress: { lessonId: 'rings-first', version: 1, attempts: 9, successes: 7, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-01T10:00:00.000Z' } });
        old.begin();
        old.flyTo([0, 3, 55], 3);
        expect(old.run.progress()).toMatchObject({ version: 2, attempts: 1, successes: 1, passed: false });
    });

    it('the same flight gives the same events (a replay re-derives them)', () => {
        const flight = (): SessionEvent[] => {
            const p = new Pilot(getLesson('rings-line'));
            p.begin();
            p.flyTo([0.3, 3.2, 20], 4);
            p.hold(2);
            return p.events;
        };
        expect(flight()).toEqual(flight());
    });

    it('N skips the intro, and the target is the next gate while flying', () => {
        const run = createLessonRunner(getLesson('rings-line'));
        run.begin(0);
        expect(run.phase).toBe('intro');
        run.next(10);
        expect(run.phase).toBe('flying');
        const ref = getLesson('rings-line').world;
        if (ref.kind !== 'analytic') throw new Error('rings-line flies in an analytic world');
        const world = createAnalyticWorld(ref.spec);
        run.step({ t: 30, tick: 30, pos: [0, 3, 72], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world);
        expect(run.target()?.id).toBe('ring-1');
    });
});
