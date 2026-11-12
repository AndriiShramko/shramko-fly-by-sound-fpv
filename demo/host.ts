// The host loop of the stand-alone demo (see "The host loop" in src/lesson/runner.ts): a lesson runner,
// the point mass in the lesson's analytic world, and an engine. Each frame: fly, step the runner, carry
// out what it asks (say a line, play a cue, place the craft, ask a question, show a module-0 scene), and
// give the engine what it hears. DOM-free and engine-agnostic (EngineLike), so Node tests drive it with a
// fake engine; demo/main.ts supplies the real one and the page.
import type { CueEvent, LessonDef, LessonLayers, Locale, SessionEvent, SonicFrameInput, SonicWorld, SpeechLine, Vec3 } from '../src/contract';
import { createLessonRunner, getLesson, type LessonSession, type Question, type RunnerAction } from '../src/lesson';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../src/world';
import { PointMass, type Sticks } from './sim';

/** The part of the engine the host uses (FlyBySoundEngine fits; a test passes a fake). */
export interface EngineLike {
    update(input: SonicFrameInput): void;
    cue(e: CueEvent): void;
    say(line: SpeechLine, o?: { readonly interrupt?: boolean }): Promise<void>;
    setLayers(layers: LessonLayers): void;
}

export interface HostUi {
    /** a question is asked (digits answer it), or the question is over (null) */
    ask(question: Question | null): void;
    /** the pilot left the lesson for the next or the previous one (N past the last step, B before the first): the page opens it */
    go?(to: 'next' | 'previous', from: string): void;
}

export interface HostState {
    readonly lessonId: string | null;
    readonly phase: LessonSession['phase'] | 'none';
    readonly attempt: number;
    readonly touches: number;
    readonly passed: boolean;
    readonly asking: boolean;
    readonly question: Question | null;
    readonly scene: boolean;
    readonly paused: boolean;
    readonly pos: Vec3;
    readonly speed: number;
    readonly heightM: number;
    readonly yawDeg: number;
    readonly events: number;
}

export interface HostOptions {
    readonly engine: EngineLike;
    readonly locale: Locale;
    readonly ui?: HostUi;
}

/** The longest step the host takes in one frame, s (a stalled tab must not throw the craft across the hall). */
export const MAX_FRAME_S = 0.1;
/** The host keeps this many events for the page to show. */
const KEEP_EVENTS = 2000;

export class DemoHost {
    private readonly engine: EngineLike;
    private readonly locale: Locale;
    private readonly ui: HostUi | undefined;
    private lessonValue: LessonDef | null = null;
    private runner: LessonSession | null = null;
    private world: AnalyticWorldInfo | null = null;
    private craft: PointMass | null = null;
    private eventList: SessionEvent[] = [];
    private questionValue: Question | null = null;
    private sceneOn = false;
    private pausedValue = false;
    private speaking = 0;
    private t = 0;
    private sticks: Sticks = { roll: 0, pitch: 0, throttle: 0, yaw: 0 };

    constructor(options: HostOptions) {
        this.engine = options.engine;
        this.locale = options.locale;
        this.ui = options.ui;
    }

    get lesson(): LessonDef | null {
        return this.lessonValue;
    }

    /** What the runner has reported since the lesson opened (the last 2000). */
    get events(): readonly SessionEvent[] {
        return this.eventList;
    }

    get lessonWorld(): SonicWorld | null {
        return this.world;
    }

    /** Opens a lesson (any shipped one) and begins it at page time `tMs`. Throws for an unknown id. */
    open(id: string, tMs: number): void {
        this.leave();
        const lesson = getLesson(id);
        this.lessonValue = lesson;
        this.world = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
        this.craft = new PointMass({ start: lesson.start, world: this.world, assists: lesson.assists });
        const runner = createLessonRunner(lesson, { locale: this.locale, floorY: this.world?.floorY ?? 0 });
        this.runner = runner;
        this.eventList = [];
        this.questionValue = null;
        this.sceneOn = false;
        this.speaking = 0;
        this.pausedValue = false;
        this.t = tMs;
        this.engine.setLayers(lesson.layers);
        this.record(runner.begin(tMs));
        this.handle(runner, runner.takeActions());
    }

    /** Leaves the lesson: nothing is flown, and the engine keeps no layer (it would go on sounding the last frame it was given). */
    leave(): void {
        const wasOpen = this.lessonValue !== null;
        this.lessonValue = null;
        this.runner = null;
        this.world = null;
        this.craft = null;
        this.sceneOn = false;
        this.speaking = 0;
        if (wasOpen) this.engine.setLayers({ on: [], heightBandM: null, hazardVoices: 3 });
        if (this.questionValue !== null) {
            this.questionValue = null;
            this.ui?.ask(null);
        }
    }

    /**
     * P at page time `tMs`: the flight pauses or goes on, and the lesson with it (runner.pause, runner.resume: its
     * clocks leave the pause out); on going on, the end of speech is reported again when nothing is being said.
     */
    setPaused(on: boolean, tMs: number = this.t): void {
        if (this.pausedValue === on) return;
        this.pausedValue = on;
        this.t = Math.max(this.t, tMs);
        const runner = this.runner;
        if (runner === null) return;
        this.record(on ? runner.pause(this.t) : runner.resume(this.t));
        if (!on && this.speaking === 0) this.record(runner.spoken(this.t));
        this.handle(runner, runner.takeActions());
    }

    private record(list: readonly SessionEvent[]): void {
        for (const e of list) {
            this.eventList.push(e);
            if (e.kind === 'answer' && this.questionValue !== null) {
                this.questionValue = null;
                this.ui?.ask(null);
            }
        }
        if (this.eventList.length > KEEP_EVENTS) this.eventList.splice(0, this.eventList.length - KEEP_EVENTS);
    }

    /** Carries out what the runner asked for. `runner` is the one that asked: a stale answer to a closed lesson is ignored. */
    private handle(runner: LessonSession, actions: readonly RunnerAction[]): void {
        for (const a of actions) {
            if (a.kind === 'go') {
                // the page opens the other lesson once this one has finished handing out its actions
                const from = runner.lesson.id;
                queueMicrotask(() => {
                    if (this.runner === runner) this.ui?.go?.(a.to, from);
                });
                return;
            }
            if (a.kind === 'say') {
                this.speaking++;
                this.engine
                    .say(a.line, { interrupt: a.interrupt })
                    .catch(() => undefined)
                    .then(() => {
                        if (this.runner !== runner) return;
                        this.speaking = Math.max(0, this.speaking - 1);
                        if (this.speaking === 0) {
                            // the speech queue ran empty: the runner goes on from here
                            this.record(runner.spoken(this.t));
                            this.handle(runner, runner.takeActions());
                        }
                    });
            } else if (a.kind === 'cue') this.engine.cue(a.event);
            else if (a.kind === 'place') this.craft?.place(a.pose);
            else if (a.kind === 'ask') {
                this.questionValue = a.question;
                this.ui?.ask(a.question);
            } else if (a.kind === 'scene') this.sceneOn = a.scene !== null;
        }
    }

    /** One frame at page time `tMs`, `dtS` seconds after the last, with the sticks held. */
    frame(tMs: number, dtS: number, sticks: Sticks): void {
        this.t = tMs;
        this.sticks = sticks;
        const runner = this.runner;
        const craft = this.craft;
        if (runner === null || craft === null || this.pausedValue) return;
        craft.step(Math.min(Math.max(dtS, 0), MAX_FRAME_S), sticks);
        const sample = craft.sample(tMs, Math.round(craft.elapsedS * 1000));
        this.record(runner.step(sample, this.world));
        this.handle(runner, runner.takeActions());
        // lane sonic-beacon (review R7): the runner's beacon beside the target, omitted for a runner without the method
        this.engine.update(runner.demoFrame(tMs) ?? { sample, world: this.world, target: runner.target(), ...(runner.beaconTarget ? { beacon: runner.beaconTarget() } : {}), floorY: this.world?.floorY ?? 0 });
    }

    /** A digit (or the same number said aloud): the answer to the question being asked. 0 skips. */
    answer(value: number): void {
        const runner = this.runner;
        if (runner === null) return;
        this.record(runner.answer(value, 'key', this.t));
        this.handle(runner, runner.takeActions());
    }

    /** N: the next step; from the last step, the next lesson. */
    next(): void {
        this.key((r, t) => r.next(t));
    }

    /** B: the previous step; from the first, the previous lesson. */
    previous(): void {
        this.key((r, t) => r.previous(t));
    }

    /** Z: the step again from its first line (while flying, the task again; the attempt waits). */
    repeat(): void {
        this.key((r, t) => r.repeat(t));
    }

    private key(call: (runner: LessonSession, t: number) => readonly SessionEvent[]): void {
        const runner = this.runner;
        if (runner === null) return;
        this.record(call(runner, this.t));
        this.handle(runner, runner.takeActions());
    }

    /** R: back to the last checkpoint (or the start), Shift+R: back to the lesson's start. */
    reset(to: 'checkpoint' | 'start'): void {
        const runner = this.runner;
        const craft = this.craft;
        if (runner === null || craft === null) return;
        const r = runner.reset(to, this.t);
        craft.place(r.pose);
        this.record(r.events);
        this.handle(runner, runner.takeActions());
    }

    state(): HostState {
        const runner = this.runner;
        const craft = this.craft;
        const floor = this.world?.floorY ?? 0;
        return {
            lessonId: this.lessonValue?.id ?? null,
            phase: runner === null ? 'none' : runner.phase,
            attempt: runner === null ? 0 : runner.attempt,
            touches: runner === null ? 0 : runner.touches,
            passed: runner === null ? false : runner.phase === 'passed',
            asking: this.questionValue !== null,
            question: this.questionValue,
            scene: this.sceneOn,
            paused: this.pausedValue,
            pos: craft === null ? [0, 0, 0] : craft.pos,
            speed: craft === null ? 0 : craft.speed,
            heightM: craft === null ? 0 : craft.pos[1] - floor,
            yawDeg: craft === null ? 0 : craft.yawDeg,
            events: this.eventList.length
        };
    }

    /** The sticks of the last frame (for the page's readout). */
    get lastSticks(): Sticks {
        return this.sticks;
    }
}
