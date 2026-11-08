// A scripted pilot for Node tests: it drives a lesson runner the way a host does (one sample per
// frame, every line spoken at once, `place` obeyed, questions answered by a function) and flies the
// craft within the lesson's assists (speed, climb and turn caps), so what it does a real pilot could do.
// Touches are real: a sample is touched when the craft comes within its radius of a solid surface of
// the lesson's analytic world (after 0.5 s of not touching), as the simulator's bridge reports them.
import type { FlightSample, LessonDef, SessionEvent, SonicObject, SonicWorld, Vec3 } from '../../src/contract';
import { BODY_RADIUS_M, createLessonRunner, type DemoScene, type LessonSession, type Question, type RunnerAction, type RunnerOptions } from '../../src/lesson';
import { yawQuat } from '../../src/util/vec';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../../src/world';

export const DT_MS = 20; // 50 Hz
const TOUCH_QUIET_MS = 500;

const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export class ScriptedPilot {
    t = 0;
    pos: Vec3;
    vel: Vec3 = [0, 0, 0];
    yaw: number;
    readonly events: SessionEvent[] = [];
    readonly actions: RunnerAction[] = [];
    /** events and actions in the order they came */
    readonly log: ({ readonly event: SessionEvent } | { readonly action: RunnerAction })[] = [];
    readonly run: LessonSession;
    readonly world: SonicWorld | null;
    readonly analytic: AnalyticWorldInfo | null;
    readonly lesson: LessonDef;
    /** the objects the runner flies with (a scan lesson's gates, else the world's) */
    private readonly given: readonly SonicObject[] | undefined;
    /** how many times the runner placed the craft */
    placed = 0;
    lastScene: DemoScene | null = null;
    answerer: ((q: Question, scene: DemoScene | null) => number) | null = null;
    /** a contact for the next sample, set by hand (a test of a touch) */
    touchNext = false;
    private touching = false;
    private lastContactT = -Infinity;

    constructor(lesson: LessonDef, options: RunnerOptions = {}, world?: SonicWorld | null) {
        this.lesson = lesson;
        this.run = createLessonRunner(lesson, options);
        this.analytic = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
        this.world = world !== undefined ? world : this.analytic;
        this.given = options.objects;
        const start = options.start ?? lesson.start;
        this.pos = start.pos;
        this.yaw = start.yawDeg;
    }

    private take(): void {
        for (let guard = 0; guard < 64; guard++) {
            const a = this.run.takeActions();
            if (a.length === 0) return;
            this.actions.push(...a);
            for (const action of a) this.log.push({ action });
            for (const x of a) {
                if (x.kind === 'place') {
                    this.pos = x.pose.pos;
                    this.yaw = x.pose.yawDeg;
                    this.vel = [0, 0, 0];
                    this.placed++;
                    this.lastContactT = -Infinity;
                    this.touching = false;
                }
                if (x.kind === 'scene' && x.scene !== null) this.lastScene = x.scene;
            }
            if (a.some((x) => x.kind === 'say')) this.record(this.run.spoken(this.t));
            for (const x of a) if (x.kind === 'ask' && this.answerer !== null) this.record(this.run.answer(this.answerer(x.question, this.lastScene), 'key', this.t));
        }
    }

    /** events the runner gave: kept in order with the actions */
    record(list: readonly SessionEvent[]): void {
        for (const event of list) {
            this.events.push(event);
            this.log.push({ event });
        }
    }

    begin(): void {
        this.record(this.run.begin(this.t));
        this.take();
    }

    /** a key of the pilot: the runner's call, then what it asks for */
    press(call: (run: LessonSession, t: number) => readonly SessionEvent[]): void {
        this.record(call(this.run, this.t));
        this.take();
    }

    /** A contact begins when the craft comes within its radius of a solid surface, after 0.5 s free of it. */
    private contact(): boolean {
        if (this.touchNext) {
            this.touchNext = false;
            this.lastContactT = this.t;
            return true;
        }
        const w = this.analytic;
        if (w === null) return false;
        const inside = w.sdf(...this.pos) <= BODY_RADIUS_M;
        if (!inside) {
            this.touching = false;
            return false;
        }
        const fresh = !this.touching && this.t - this.lastContactT >= TOUCH_QUIET_MS;
        this.touching = true;
        this.lastContactT = this.t;
        return fresh;
    }

    sample(touched: boolean): FlightSample {
        return { t: this.t, tick: this.t, pos: this.pos, vel: this.vel, quat: yawQuat(this.yaw), rate: [0, 0, 0], yawDeg: this.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched, paused: false };
    }

    tick(): void {
        this.t += DT_MS;
        this.record(this.run.step(this.sample(this.contact()), this.world));
        this.take();
    }

    private get caps(): { readonly speed: number; readonly climb: number; readonly yaw: number } {
        const a = this.lesson.assists;
        return { speed: a.maxSpeedMps ?? 6, climb: a.maxClimbMps ?? 3, yaw: a.maxYawDps ?? 180 };
    }

    /** Turns at the lesson's turn cap to `yawDeg` (stops when the runner moves the craft). */
    turnTo(yawDeg: number): void {
        const placed = this.placed;
        const step = (this.caps.yaw * DT_MS) / 1000;
        for (let guard = 0; guard < 100000 && this.placed === placed; guard++) {
            const d = wrap(yawDeg - this.yaw);
            if (Math.abs(d) <= step) {
                this.yaw = wrap(yawDeg);
                this.tick();
                return;
            }
            this.yaw = wrap(this.yaw + Math.sign(d) * step);
            this.tick();
        }
    }

    /** Faces a point (turning at the cap). */
    face(p: Vec3): void {
        this.turnTo((Math.atan2(p[0] - this.pos[0], -(p[2] - this.pos[2])) * 180) / Math.PI);
    }

    /**
     * Flies straight to `to` within the speed and climb caps (at most `speed`), nose along the way when
     * it moves sideways enough; stops there with no speed, or when the runner moves the craft. True when it got there.
     */
    flyTo(to: Vec3, speed = Infinity, faceAlong = true): boolean {
        const placed = this.placed;
        const caps = this.caps;
        const v = Math.min(speed, caps.speed);
        for (let guard = 0; guard < 1_000_000 && this.placed === placed; guard++) {
            const d: Vec3 = [to[0] - this.pos[0], to[1] - this.pos[1], to[2] - this.pos[2]];
            const horiz = Math.hypot(d[0], d[2]);
            const dtS = DT_MS / 1000;
            if (faceAlong && horiz > 0.3) {
                const want = (Math.atan2(d[0], -d[2]) * 180) / Math.PI;
                const turn = wrap(want - this.yaw);
                const maxTurn = caps.yaw * dtS;
                this.yaw = wrap(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, turn)));
            }
            const hStep = Math.min(horiz, v * dtS);
            const yStep = Math.sign(d[1]) * Math.min(Math.abs(d[1]), caps.climb * dtS);
            if (horiz <= 1e-6 && Math.abs(d[1]) <= 1e-6) {
                this.vel = [0, 0, 0];
                this.tick();
                return true;
            }
            const hx = horiz > 1e-9 ? (d[0] / horiz) * hStep : 0;
            const hz = horiz > 1e-9 ? (d[2] / horiz) * hStep : 0;
            this.vel = [hx / dtS, yStep / dtS, hz / dtS];
            this.pos = [this.pos[0] + hx, this.pos[1] + yStep, this.pos[2] + hz];
            this.tick();
        }
        return this.placed === placed;
    }

    /** Flies a polyline. */
    flyPath(points: readonly Vec3[], speed = Infinity): boolean {
        for (const p of points) if (!this.flyTo(p, speed)) return false;
        return true;
    }

    hold(seconds: number): void {
        this.vel = [0, 0, 0];
        const n = Math.round((seconds * 1000) / DT_MS);
        for (let i = 0; i < n; i++) this.tick();
    }

    until(cond: () => boolean, maxSeconds = 600): boolean {
        const n = Math.round((maxSeconds * 1000) / DT_MS);
        for (let i = 0; i < n && !cond(); i++) this.tick();
        return cond();
    }

    of<K extends SessionEvent['kind']>(kind: K): Extract<SessionEvent, { kind: K }>[] {
        return this.events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
    }

    lessonWhat(): string[] {
        return this.of('lesson').map((e) => e.what);
    }

    /** attempt results in order: 'P' passed, 'F' failed */
    results(): string {
        return this.of('lesson')
            .filter((e) => e.what === 'attempt-pass' || e.what === 'attempt-fail')
            .map((e) => (e.what === 'attempt-pass' ? 'P' : 'F'))
            .join('');
    }

    said(): string[] {
        return this.actions.filter((a): a is Extract<RunnerAction, { kind: 'say' }> => a.kind === 'say').map((a) => a.line.key);
    }

    /** the gates, zones and pillars the runner knows */
    objects(): readonly SonicObject[] {
        return this.given ?? this.world?.objects() ?? [];
    }

    /** the object of a goal or a gate by id */
    object(id: string): SonicObject {
        const o = this.objects().find((x) => x.id === id);
        if (o === undefined) throw new Error(`no object ${id}`);
        return o;
    }

    /** where the sound of `o` is, relative to the nose, degrees (negative: left) */
    bearingOf(o: Pick<SonicObject, 'pos'>): number {
        return wrap((Math.atan2(o.pos[0] - this.pos[0], -(o.pos[2] - this.pos[2])) * 180) / Math.PI - this.yaw);
    }
}
