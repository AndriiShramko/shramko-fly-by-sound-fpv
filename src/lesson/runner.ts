// The lesson runner (contract LessonRunner; spec section 3). Pure: no DOM and no clock of its own,
// time comes with the samples, so Node tests drive it with scripted flights and a replay
// re-derives the same events. Beside the contract it tells the host what to do through actions
// (say a line, play a cue, place the craft, ask a question, show a module-0 scene), which the host
// drains with takeActions() and carries out.
//
// The host loop:
//   const run = createLessonRunner(lesson, { locale, objects, start });
//   run.begin(t)                                  // intro, then the first attempt
//   every frame: events = run.step(sample, world); actions = run.takeActions();
//                engine.update(run.demoFrame(t) ?? { sample, world, target: run.target(), floorY })
//   say actions: engine.say(line), then run.spoken(t) when the speech queue is empty
//   digits / voice: run.answer(value, via, t)    R: run.reset('checkpoint' | 'start', t)    N: run.next(t)
//
// An attempt of a lesson without a world (module 0, the ears) is a script: narrated scenes, the
// headphone check, the glossary, the game "what is it, where is it, is it moving". An attempt of a
// flying lesson tracks its goals in order (goals.ts). A block is `pass.attempts` attempts; it
// passes with `pass.required` successes (an attempt succeeds when every goal is met with at most
// `pass.maxTouches` touches) and ends early once that is reached or out of reach. A blocking lesson
// is passed after `pass.blocks` passed blocks in a row; a non-blocking one (the game, the shapes,
// free flight) is done after `pass.blocks` blocks whatever the score, so it never holds anyone back.
import type { Checkpoint, CueEvent, CueId, FlightSample, Goal, LessonDef, LessonProgress, LessonRunner, Locale, MaterialClass, Pose, SessionEvent, SonicFrameInput, SonicObject, SonicWorld, SpeechLine, Vec3 } from '../contract';
import { DICTS } from '../i18n/dicts';
import { createTranslator, type Dicts, type Translator } from '../i18n/translator';
import { createRng } from '../util/rng';
import { distance as dist3, yawQuat } from '../util/vec';
import { createAnalyticWorld, makeSpec, type AnalyticWorldInfo } from '../world/analytic-world';
import { createTracker, type GoalTracker, type Outcome } from './goals';

// ------------------------------------------------------------------ host interface

/** A question asked by digits (or the same number said aloud). */
export interface Question {
    /** the item id of the answer event */
    readonly id: string;
    readonly lines: readonly SpeechLine[];
    /** digits 1..options answer */
    readonly options: number;
    /** 0 skips the question */
    readonly skippable: boolean;
}

/** A module-0 scene: a sound shown by moving the virtual craft toward its source (or holding still). */
export interface DemoScene {
    readonly cue: CueId;
    /** where it comes from, listener frame */
    readonly dir: Vec3;
    readonly moving: boolean;
    readonly durS: number;
}

export type RunnerAction =
    | { readonly kind: 'say'; readonly line: SpeechLine; readonly interrupt: boolean }
    | { readonly kind: 'cue'; readonly event: CueEvent }
    /** move the craft (the respawn path): back to the start or to a checkpoint */
    | { readonly kind: 'place'; readonly pose: Pose; readonly to: 'start' | 'checkpoint' }
    /** digits are expected now (the host may show them; the question's lines come as 'say' actions) */
    | { readonly kind: 'ask'; readonly question: Question }
    /** module 0: while a scene is set, feed the engine with demoFrame(t) instead of the craft */
    | { readonly kind: 'scene'; readonly scene: DemoScene | null };

export interface LessonSession extends LessonRunner {
    /** starts the lesson: the intro, then the first attempt */
    begin(t: number): readonly SessionEvent[];
    /** what the host must do now; each action is handed out once */
    takeActions(): RunnerAction[];
    /** the host's speech queue ran empty at t (the runner otherwise estimates how long lines take) */
    spoken(t: number): readonly SessionEvent[];
    /** module 0: the frame the engine should hear at t while a scene runs, else null */
    demoFrame(t: number): SonicFrameInput | null;
    /** the N key: skip the intro, a question or the pause between attempts */
    next(t: number): readonly SessionEvent[];
    /** attempts started so far (1 during the first) */
    readonly attempt: number;
    /** touches in the current attempt */
    readonly touches: number;
}

export interface RunnerOptions {
    /** language of the names put into narrated lines ("Coming: wall.") */
    readonly locale?: Locale;
    readonly dicts?: Dicts;
    /** progress saved earlier: counts and the best time go on from there */
    readonly progress?: LessonProgress | null;
    /** epoch ms of the session clock's t = 0, for LessonProgress.lastAt */
    readonly sessionStartMs?: number;
    /** a scan lesson's gates in the flown world (trackToObjects); default: the world's objects */
    readonly objects?: readonly SonicObject[];
    /** a scan lesson's start (the track's start or the scene spawn); default lesson.start */
    readonly start?: Pose;
    /** world y of the floor: the height goals' zero */
    readonly floorY?: number;
    /** dice of the game's rounds */
    readonly seed?: number;
}

// ------------------------------------------------------------------ numbers

/** A question waits this long for an answer, then counts as skipped (never blocks), s. */
export const ASK_TIMEOUT_S = 20;
/** Pause between attempts, s. */
export const BETWEEN_S = 1.5;
/** A scene of module 0 lasts this long, s. */
export const SCENE_S = 5;
/** A cue preview (glossary, headphone check) is given this long, s. */
export const PREVIEW_WAIT_S = 3.3;
/** Share of right answers that meets 'name-cues' (spec: names cues at 90 %). */
export const NAME_SHARE = 0.9;
/** Share of right answers that meets 'locate'. */
export const LOCATE_SHARE = 0.8;
/** turn-to lessons start each attempt turned by these, degrees, so the sound comes from another side. */
export const TURN_OFFSETS = [0, 180, 90, -90] as const;

const SIDES: readonly { readonly dir: Vec3; readonly sector: 'left' | 'right' | 'front' | 'back' }[] = [
    { dir: [-1, 0, 0], sector: 'left' },
    { dir: [1, 0, 0], sector: 'right' },
    { dir: [0, 0, -1], sector: 'front' },
    { dir: [0, 0, 1], sector: 'back' }
];

/** Where each wall-like cue comes from in the narrated scenes of ears-walls (spec: front, left, right, above, below). */
const APPROACHES: Readonly<Record<string, readonly { readonly dir: Vec3; readonly sector: string }[]>> = {
    'safety.wall': [
        { dir: [0, 0, -1], sector: 'front' },
        { dir: [-1, 0, 0], sector: 'left' },
        { dir: [1, 0, 0], sector: 'right' }
    ],
    'safety.ceiling': [{ dir: [0, 1, 0], sector: 'up' }],
    'safety.floor': [{ dir: [0, -1, 0], sector: 'down' }],
    'safety.obstacle': [{ dir: [Math.SQRT1_2, 0, -Math.SQRT1_2], sector: 'front-right' }]
};

const SHAPE_ORDER: readonly CueId[] = ['shape.ring', 'shape.square', 'shape.cube', 'shape.pillar'];

// ------------------------------------------------------------------ the script

type Step =
    | { readonly kind: 'say'; readonly lines: readonly SpeechLine[]; readonly interrupt?: boolean }
    | { readonly kind: 'cue'; readonly event: CueEvent; readonly waitS: number }
    | { readonly kind: 'scene'; readonly scene: DemoScene }
    | { readonly kind: 'ask'; readonly question: Question; readonly onAnswer: (value: number | null, t: number) => void }
    | { readonly kind: 'wait'; readonly s: number }
    | { readonly kind: 'do'; readonly run: (t: number) => void };

interface Running {
    readonly step: Step;
    readonly t0: number;
    /** say: the lines were handed out and the host has not yet reported the queue empty */
    answered: boolean;
    spoken: boolean;
}

type Phase = LessonRunner['phase'];

const speedOf = (s: FlightSample): number => Math.hypot(s.vel[0], s.vel[1], s.vel[2]);

class Runner implements LessonSession {
    readonly lesson: LessonDef;
    private phaseValue: Phase = 'intro';
    private readonly o: RunnerOptions;
    private readonly tr: Translator;
    private readonly script: Step[] = [];
    private current: Running | null = null;
    private actions: RunnerAction[] = [];
    private events: SessionEvent[] = [];
    private t = 0;
    private began = false;
    private prev: FlightSample | null = null;
    private worldRef: SonicWorld | null = null;
    // attempt
    private attemptNo = 0;
    private attemptT0 = 0;
    private touchCount = 0;
    private pathM = 0;
    private goalIndex = 0;
    private tracker: GoalTracker | null = null;
    private lastCheckpoint: Checkpoint | null = null;
    private reached = new Set<string>();
    private shapeOutcome: Outcome = null;
    private earsScore = { what: 0, whatAsked: 0, where: 0, whereAsked: 0, moving: 0, movingAsked: 0, answers: [] as (number | null)[] };
    // progress
    private attemptsDone: number;
    private successes: number;
    private blockOk = 0;
    private blockDone = 0;
    private consecutive: number;
    private blocksPlayed = 0;
    private passedValue: boolean;
    private bestTimeMs: number | null;
    private lastAtT = 0;
    // scenes
    private scene: { readonly scene: DemoScene; readonly t0: number } | null = null;
    private readonly sceneWorlds = new Map<string, AnalyticWorldInfo>();

    constructor(lesson: LessonDef, options: RunnerOptions) {
        this.lesson = lesson;
        this.o = options;
        this.tr = createTranslator(options.locale ?? 'en', options.dicts ?? DICTS);
        const p = options.progress ?? null;
        const same = p !== null && p.lessonId === lesson.id;
        this.attemptsDone = same ? p.attempts : 0;
        this.successes = same ? p.successes : 0;
        this.consecutive = same ? p.blocksPassed : 0;
        this.passedValue = same ? p.passed : false;
        this.bestTimeMs = same ? p.bestTimeMs : null;
    }

    get phase(): Phase {
        return this.phaseValue;
    }

    get attempt(): number {
        return this.attemptNo;
    }

    get touches(): number {
        return this.touchCount;
    }

    private get ears(): boolean {
        return this.lesson.world.kind === 'none';
    }

    // -------------------------------------------------------------- plumbing

    private emit(e: SessionEvent): void {
        this.events.push(e);
    }

    private drain(): SessionEvent[] {
        const out = this.events;
        this.events = [];
        return out;
    }

    takeActions(): RunnerAction[] {
        const out = this.actions;
        this.actions = [];
        return out;
    }

    private lessonEvent(what: Extract<SessionEvent, { kind: 'lesson' }>['what'], t: number): void {
        this.emit({ t, kind: 'lesson', lessonId: this.lesson.id, version: this.lesson.version, what, attempt: this.attemptNo });
        this.lastAtT = t;
    }

    private objects(): readonly SonicObject[] {
        return this.o.objects ?? (this.worldRef === null ? [] : this.worldRef.objects());
    }

    private text(line: SpeechLine): string {
        return this.tr.text(line);
    }

    private sayS(lines: readonly SpeechLine[]): number {
        let s = 0;
        for (const l of lines) s += 0.7 + this.text(l).length * 0.065;
        return s;
    }

    // -------------------------------------------------------------- the script

    private push(...steps: Step[]): void {
        this.script.push(...steps);
    }

    /** Runs the script as far as time and answers allow. */
    private advance(t: number): void {
        for (let guard = 0; guard < 1000; guard++) {
            if (this.current === null) {
                const step = this.script.shift();
                if (step === undefined) return;
                this.current = { step, t0: t, answered: false, spoken: false };
                this.startStep(step, t);
            }
            const c = this.current;
            if (!this.stepDone(c, t)) return;
            this.current = null;
            if (c.step.kind === 'scene') {
                this.scene = null;
                this.actions.push({ kind: 'scene', scene: null });
            }
            if (c.step.kind === 'ask' && !c.answered) {
                // timed out: a skip, never a block
                this.emit({ t, kind: 'answer', item: c.step.question.id, value: null, via: 'skip' });
                c.step.onAnswer(null, t);
            }
        }
    }

    private startStep(step: Step, t: number): void {
        switch (step.kind) {
            case 'say':
                for (const line of step.lines) this.actions.push({ kind: 'say', line, interrupt: step.interrupt ?? false });
                break;
            case 'cue':
                this.actions.push({ kind: 'cue', event: step.event });
                break;
            case 'scene':
                this.scene = { scene: step.scene, t0: t };
                this.actions.push({ kind: 'scene', scene: step.scene });
                break;
            case 'ask':
                for (const line of step.question.lines) this.actions.push({ kind: 'say', line, interrupt: false });
                this.actions.push({ kind: 'ask', question: step.question });
                break;
            case 'wait':
                break;
            case 'do':
                step.run(t);
                break;
        }
    }

    private stepDone(c: Running, t: number): boolean {
        const age = (t - c.t0) / 1000;
        switch (c.step.kind) {
            case 'say':
                return c.spoken || age >= this.sayS(c.step.lines);
            case 'cue':
                return age >= c.step.waitS;
            case 'scene':
                return age >= c.step.scene.durS;
            case 'ask':
                return c.answered || age >= this.sayS(c.step.question.lines) + ASK_TIMEOUT_S;
            case 'wait':
                return age >= c.step.s;
            case 'do':
                return true;
        }
    }

    spoken(t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        if (this.current !== null && this.current.step.kind === 'say') this.current.spoken = true;
        this.advance(t);
        this.afterScript(t);
        return this.drain();
    }

    // -------------------------------------------------------------- life cycle

    begin(t: number): readonly SessionEvent[] {
        if (this.began) return [];
        this.began = true;
        this.t = t;
        this.lessonEvent('open', t);
        this.lessonEvent('intro', t);
        if (!this.ears) this.actions.push({ kind: 'place', pose: this.startPose(1), to: 'start' });
        this.push({ kind: 'say', lines: [this.lesson.title, ...this.lesson.intro] });
        this.phaseValue = 'intro';
        this.advance(t);
        this.afterScript(t);
        return this.drain();
    }

    private startPose(attempt: number): Pose {
        const base = this.o.start ?? this.lesson.start;
        if (!this.lesson.goals.some((g) => g.kind === 'turn-to')) return base;
        const off = TURN_OFFSETS[(attempt - 1) % TURN_OFFSETS.length] as number;
        return { pos: base.pos, yawDeg: ((((base.yawDeg + off) % 360) + 540) % 360) - 180 };
    }

    /** A lesson whose attempts begin where the previous one ended does not send the craft back. */
    private returnsToStart(): boolean {
        return this.lesson.goals.some((g) => g.kind !== 'hold-height' && g.kind !== 'approach-stop' && g.kind !== 'around');
    }

    private startAttempt(t: number, first: boolean): void {
        this.attemptNo++;
        this.attemptT0 = t;
        this.touchCount = 0;
        this.pathM = 0;
        this.goalIndex = 0;
        this.shapeOutcome = null;
        this.lastCheckpoint = null;
        this.reached.clear();
        this.earsScore = { what: 0, whatAsked: 0, where: 0, whereAsked: 0, moving: 0, movingAsked: 0, answers: [] };
        this.phaseValue = 'flying';
        if (!first && !this.ears && this.returnsToStart()) {
            const pose = this.startPose(this.attemptNo);
            this.actions.push({ kind: 'place', pose, to: 'start' });
            this.emit({ t, kind: 'reset', to: 'start', checkpointId: null });
        }
        this.lessonEvent('attempt-start', t);
        if (this.ears) {
            this.tracker = null;
            this.pushEarsAttempt();
        } else {
            this.push({ kind: 'say', lines: [first ? { key: 'fly.go' } : { key: 'fly.attempt', params: { n: this.attemptNo } }] });
            this.startGoal(t);
        }
    }

    private startGoal(t: number): void {
        const goal = this.lesson.goals[this.goalIndex] as Goal;
        this.tracker = createTracker(goal, {
            floorY: this.o.floorY ?? 0,
            objects: () => this.objects(),
            world: () => this.worldRef,
            attemptPathM: () => this.pathM,
            passedGate: (gate, index, of, missM, lapDone, at) => {
                this.emit({ t: at, kind: 'gate', gateId: gate.id, index, missM: Math.round(missM * 1000) / 1000 });
                this.actions.push({ kind: 'cue', event: { kind: 'gate', index, of } });
                if (lapDone) this.actions.push({ kind: 'cue', event: { kind: 'lap' } });
            }
        });
        if (goal.kind === 'name-shape') this.pushShapeQuestion(goal.objectId, t);
    }

    /** The script has run dry: the intro is over, an attempt of module 0 has asked everything, or the pause between attempts ended. */
    private afterScript(t: number): void {
        if (this.current !== null || this.script.length > 0) return;
        if (this.phaseValue === 'intro' && this.began) this.startAttempt(t, true);
        else if (this.phaseValue === 'between') this.startAttempt(t, false);
        else if (this.phaseValue === 'flying' && this.ears) this.endEarsAttempt(t);
        else return;
        this.advance(t);
        if (this.current === null && this.script.length === 0 && this.phaseValue === 'flying' && this.ears) this.afterScript(t);
    }

    // -------------------------------------------------------------- frames

    step(sample: FlightSample, world: SonicWorld | null): readonly SessionEvent[] {
        const t = sample.t;
        this.t = t;
        this.worldRef = world;
        const prev = this.prev;
        this.prev = sample;
        if (!this.began || this.phaseValue === 'passed') return this.drain();
        if (prev !== null) {
            const d = dist3(prev.pos, sample.pos);
            if (d < 3) this.pathM += d; // a longer jump is a reset, not flight
        }
        this.advance(t);
        if (this.phaseValue === 'flying' && !this.ears) this.fly(sample, prev ?? sample, t);
        this.afterScript(t);
        return this.drain();
    }

    private fly(s: FlightSample, prev: FlightSample, t: number): void {
        if (s.touched) {
            this.touchCount++;
            this.emit({ t, kind: 'touch', material: this.touchMaterial(s.pos), speed: Math.round(speedOf(s) * 100) / 100, pos: s.pos });
            if (this.lesson.assists.onTouch === 'bump-recentre') {
                const cp = this.lastCheckpoint;
                const pose = cp === null ? this.startPose(this.attemptNo) : cp.pose;
                this.actions.push({ kind: 'place', pose, to: cp === null ? 'start' : 'checkpoint' });
                this.actions.push({ kind: 'cue', event: { kind: 'reset' } });
                this.emit({ t, kind: 'reset', to: cp === null ? 'start' : 'checkpoint', checkpointId: cp === null ? null : cp.id });
                this.prev = null; // the jump is not flight
            }
        }
        for (const cp of this.lesson.checkpoints) {
            if (this.reached.has(cp.id) || dist3(s.pos, cp.at) > cp.radiusM) continue;
            this.reached.add(cp.id);
            this.lastCheckpoint = cp;
            this.emit({ t, kind: 'checkpoint', id: cp.id });
            if (this.lesson.checkpoints.indexOf(cp) > 0) this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
        }
        this.evaluateGoals(s, prev, t);
    }

    /** The current goal, and the next ones as each is met, in order; then the attempt's time limit. */
    private evaluateGoals(s: FlightSample, prev: FlightSample, t: number): void {
        for (let guard = 0; guard < 16 && this.phaseValue === 'flying' && this.tracker !== null; guard++) {
            const goal = this.lesson.goals[this.goalIndex] as Goal;
            const outcome: Outcome = goal.kind === 'name-shape' ? this.shapeOutcome : this.tracker.step(s, prev);
            if (outcome === null) break;
            this.emit({ t, kind: 'goal', index: this.goalIndex, what: outcome });
            if (outcome === 'missed') {
                this.endAttempt(false, t);
                return;
            }
            this.goalIndex++;
            if (this.goalIndex >= this.lesson.goals.length) {
                this.endAttempt(true, t);
                return;
            }
            this.startGoal(t);
        }
        const limit = this.lesson.attemptLimitS;
        if (this.phaseValue === 'flying' && limit !== null && (t - this.attemptT0) / 1000 >= limit) {
            this.emit({ t, kind: 'goal', index: this.goalIndex, what: 'missed' });
            this.endAttempt(false, t);
        }
    }

    private touchMaterial(p: Vec3): MaterialClass {
        const w = this.worldRef;
        if (w === null) return 'wall';
        let best: { d: number; m: MaterialClass } | null = null;
        const dirs: Vec3[] = [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
            [0, 1, 0],
            [0, -1, 0]
        ];
        for (const d of dirs) {
            const hit = w.castRay(p, d, 5);
            if (hit !== null && (best === null || hit.distance < best.d)) best = { d: hit.distance, m: hit.material };
        }
        return best === null ? 'wall' : best.m;
    }

    // -------------------------------------------------------------- attempts and blocks

    private endAttempt(goalsMet: boolean, t: number): void {
        const touchesOk = this.lesson.pass.maxTouches === null || this.touchCount <= this.lesson.pass.maxTouches;
        const ok = goalsMet && touchesOk;
        this.attemptsDone++;
        this.blockDone++;
        const timed = this.lesson.goals.some((g) => g.kind === 'timed-course');
        if (ok) {
            this.successes++;
            this.blockOk++;
            if (timed) {
                const ms = Math.round(t - this.attemptT0);
                const better = this.bestTimeMs === null || ms < this.bestTimeMs;
                if (better) this.bestTimeMs = ms;
                this.actions.push({ kind: 'say', line: { key: better ? 'fly.best-time' : 'fly.time', params: { time: this.tr.duration(ms) } }, interrupt: false });
            }
        }
        this.lessonEvent(ok ? 'attempt-pass' : 'attempt-fail', t);
        this.tracker = null;
        const rule = this.lesson.pass;
        const left = rule.attempts - this.blockDone;
        let blockOver = false;
        let blockPassed = false;
        if (this.blockOk >= rule.required) {
            blockOver = true;
            blockPassed = true;
        } else if (this.blockOk + left < rule.required) blockOver = true;
        let done = false;
        if (blockOver) {
            this.blocksPlayed++;
            this.blockOk = 0;
            this.blockDone = 0;
            if (blockPassed) {
                this.consecutive++;
                this.lessonEvent('block-pass', t);
            } else this.consecutive = 0;
            done = rule.blocking ? this.consecutive >= rule.blocks : this.blocksPlayed >= rule.blocks;
        }
        if (done) {
            this.passedValue = true;
            this.phaseValue = 'passed';
            this.lessonEvent('passed', t);
            this.script.length = 0;
            this.current = null;
            this.actions.push({ kind: 'cue', event: { kind: 'fanfare' } });
            this.actions.push({ kind: 'say', line: this.lesson.speech.pass, interrupt: false });
            return;
        }
        this.phaseValue = 'between';
        if (ok) {
            if (!this.ears) this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
            if (blockPassed) this.push({ kind: 'say', lines: [{ key: 'fly.step-passed' }] });
        } else {
            const hints = this.lesson.speech.hints;
            const hint = hints.length === 0 ? [] : [hints[(this.attemptsDone - 1) % hints.length] as SpeechLine];
            this.push({ kind: 'say', lines: [this.lesson.speech.retry, ...hint] });
        }
        this.push({ kind: 'wait', s: BETWEEN_S });
    }

    // -------------------------------------------------------------- module 0

    private goalOf<K extends Goal['kind']>(kind: K): Extract<Goal, { kind: K }> | null {
        return (this.lesson.goals.find((g) => g.kind === kind) as Extract<Goal, { kind: K }> | undefined) ?? null;
    }

    private pushEarsAttempt(): void {
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        if (names !== null && names.trials > 0) this.pushGame(names, locate);
        else if (names !== null) this.pushPresentation(names.cues);
        else if (locate !== null) this.pushHeadphoneCheck(locate.trials);
    }

    private cueName(cue: CueId): string {
        return this.text({ key: `cue.${cue}.name` });
    }

    /** The glossary, or narrated scenes when every cue is a wall or a shape (ears-walls, ears-shapes). */
    private pushPresentation(cues: readonly CueId[]): void {
        const glossary = !cues.every((c) => c in APPROACHES || SHAPE_ORDER.includes(c));
        if (glossary) {
            this.push({ kind: 'say', lines: [{ key: 'glossary.intro' }] });
            cues.forEach((cue, i) => {
                this.push({ kind: 'say', lines: [{ key: `cue.${cue}.name` }, { key: `cue.${cue}.glossary` }] });
                this.push({ kind: 'cue', event: { kind: 'preview', cue, dir: null }, waitS: PREVIEW_WAIT_S });
                if (i < cues.length - 1) this.push({ kind: 'say', lines: [{ key: 'glossary.next' }] });
            });
            this.push({ kind: 'say', lines: [{ key: 'glossary.done' }] });
            return;
        }
        for (const cue of cues) {
            const ways = APPROACHES[cue] ?? [{ dir: [0, 0, -1] as Vec3, sector: 'front' }];
            for (const w of ways) {
                this.push({ kind: 'say', lines: [{ key: 'narrate.coming', params: { name: this.cueName(cue) } }, { key: `dir.${w.sector}` }] });
                this.push({ kind: 'scene', scene: { cue, dir: w.dir, moving: true, durS: SCENE_S } });
            }
        }
    }

    /** The headphone check: a sound on the left, on the right, behind; answered by digits. */
    private pushHeadphoneCheck(trials: number): void {
        this.push({ kind: 'say', lines: [{ key: 'headphones.intro' }, { key: 'headphones.wired' }, { key: 'headphones.os-spatial' }] });
        const order = [SIDES[0], SIDES[1], SIDES[3], SIDES[2]] as (typeof SIDES)[number][];
        for (let i = 0; i < trials; i++) {
            const side = order[i % order.length] as (typeof SIDES)[number];
            const lateral = side.sector === 'left' || side.sector === 'right';
            const correct = lateral ? (side.sector === 'left' ? 1 : 2) : side.sector === 'front' ? 1 : 2;
            this.push({ kind: 'cue', event: { kind: 'preview', cue: 'target.hum', dir: side.dir }, waitS: PREVIEW_WAIT_S });
            this.push({
                kind: 'ask',
                question: { id: `${this.lesson.id}:${this.attemptNo}:${i + 1}:${lateral ? 'side' : 'front-back'}`, lines: [{ key: lateral ? 'headphones.q-side' : 'headphones.q-front-back' }], options: 3, skippable: true },
                onAnswer: (value) => {
                    this.earsScore.answers.push(value);
                    this.earsScore.whereAsked++;
                    if (value === correct) this.earsScore.where++;
                }
            });
        }
    }

    /** The game "what is it, where is it, is it moving" (rounds of three questions). */
    private pushGame(names: Extract<Goal, { kind: 'name-cues' }>, locate: Extract<Goal, { kind: 'locate' }> | null): void {
        const rng = createRng((this.o.seed ?? 1) * 7919 + this.attemptNo);
        const options = names.cues.slice(0, 9);
        const rounds = Math.max(names.trials, locate?.trials ?? 0);
        this.push({ kind: 'say', lines: [{ key: 'quiz.howto' }] });
        for (let r = 0; r < rounds; r++) {
            const cueIndex = rng.int(0, options.length - 1);
            const cue = options[cueIndex] as CueId;
            const side = SIDES[rng.int(0, SIDES.length - 1)] as (typeof SIDES)[number];
            const moving = rng.next() < 0.5;
            const scene: DemoScene = { cue, dir: side.dir, moving, durS: SCENE_S - 1 };
            const id = `${this.lesson.id}:${this.attemptNo}:${r + 1}`;
            const feedback = (value: number | null, right: boolean, replay: boolean): Step[] =>
                value === null ? [] : right ? [{ kind: 'say', lines: [{ key: 'quiz.right' }] }] : [{ kind: 'say', lines: [{ key: 'quiz.wrong' }] }, ...(replay ? [{ kind: 'scene', scene } as Step] : [])];
            this.push({ kind: 'say', lines: [{ key: 'quiz.intro' }] });
            this.push({ kind: 'scene', scene });
            if (r < names.trials) {
                this.push({
                    kind: 'ask',
                    question: { id: `${id}:what`, lines: [{ key: 'quiz.q-what' }, ...options.map((c, i) => ({ key: 'quiz.option', params: { n: i + 1, label: this.cueName(c) } }))], options: options.length, skippable: true },
                    onAnswer: (value) => {
                        this.earsScore.whatAsked++;
                        const right = value === cueIndex + 1;
                        if (right) this.earsScore.what++;
                        this.script.unshift(...feedback(value, right, true));
                    }
                });
            }
            if (locate !== null && r < locate.trials) {
                const where = SIDES.indexOf(side) + 1;
                this.push({
                    kind: 'ask',
                    question: { id: `${id}:where`, lines: [{ key: 'quiz.q-where' }, { key: 'quiz.where-options' }], options: 4, skippable: true },
                    onAnswer: (value) => {
                        this.earsScore.whereAsked++;
                        const right = value === where;
                        if (right) this.earsScore.where++;
                        this.script.unshift(...feedback(value, right, false));
                    }
                });
                this.push({
                    kind: 'ask',
                    question: { id: `${id}:moving`, lines: [{ key: 'quiz.q-moving' }], options: 2, skippable: true },
                    onAnswer: (value) => {
                        this.earsScore.movingAsked++;
                        const right = value === (moving ? 1 : 2);
                        if (right) this.earsScore.moving++;
                        if (value !== null) this.script.unshift({ kind: 'say', lines: [{ key: right ? 'quiz.right' : 'quiz.wrong' }, { key: moving ? 'quiz.moving' : 'quiz.still' }] });
                    }
                });
            }
        }
    }

    private endEarsAttempt(t: number): void {
        if (this.phaseValue !== 'flying') return;
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        const sc = this.earsScore;
        const results: { index: number; met: boolean }[] = [];
        this.lesson.goals.forEach((g, index) => {
            if (g.kind === 'name-cues') results.push({ index, met: g.trials === 0 ? true : sc.whatAsked > 0 && sc.what / g.trials >= NAME_SHARE });
            else if (g.kind === 'locate') {
                const asked = names !== null && names.trials > 0 ? 2 * g.trials : g.trials;
                const right = names !== null && names.trials > 0 ? sc.where + sc.moving : sc.where;
                results.push({ index, met: right / asked >= LOCATE_SHARE });
            }
        });
        for (const r of results) this.emit({ t, kind: 'goal', index: r.index, what: r.met ? 'met' : 'missed' });
        // what the pilot hears about the attempt
        if (names !== null && names.trials > 0) {
            const total = sc.whatAsked + sc.whereAsked + sc.movingAsked;
            this.actions.push({ kind: 'say', line: { key: 'quiz.score', params: { right: sc.what + sc.where + sc.moving, total } }, interrupt: false });
        } else if (locate !== null && names === null) {
            const a = sc.answers;
            const swapped = a[0] === 2 && a[1] === 1;
            const good = results.every((r) => r.met);
            this.actions.push({ kind: 'say', line: { key: good ? 'headphones.good' : swapped ? 'headphones.swapped' : 'headphones.unclear' }, interrupt: false });
        }
        this.endAttempt(results.every((r) => r.met), t);
    }

    private pushShapeQuestion(objectId: string, t: number): void {
        const object = this.objects().find((o) => o.id === objectId) ?? null;
        const kind = object === null ? null : object.shape.kind === 'cube-frame' ? 'shape.cube' : `shape.${object.shape.kind}`;
        const correct = kind === null ? -1 : SHAPE_ORDER.indexOf(kind) + 1;
        this.push({
            kind: 'ask',
            question: { id: `${this.lesson.id}:${this.attemptNo}:shape`, lines: [{ key: 'quiz.q-what' }, ...SHAPE_ORDER.map((c, i) => ({ key: 'quiz.option', params: { n: i + 1, label: this.cueName(c) } })), { key: 'quiz.skip' }], options: SHAPE_ORDER.length, skippable: true },
            onAnswer: (value) => {
                // optional: a skip counts as done, a wrong name as a miss
                this.shapeOutcome = value === null || value === correct ? 'met' : 'missed';
                if (value !== null) this.script.unshift({ kind: 'say', lines: [{ key: value === correct ? 'quiz.right' : 'quiz.wrong' }] });
            }
        });
        this.advance(t);
    }

    // -------------------------------------------------------------- the pilot's keys

    answer(value: number, via: 'key' | 'voice', t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        const c = this.current;
        if (c === null || c.step.kind !== 'ask' || c.answered) return this.drain();
        const q = c.step.question;
        const skip = value === 0 && q.skippable;
        if (!skip && !(Number.isInteger(value) && value >= 1 && value <= q.options)) return this.drain();
        c.answered = true;
        this.emit({ t, kind: 'answer', item: q.id, value: skip ? null : value, via: skip ? 'skip' : via });
        this.current = null;
        c.step.onAnswer(skip ? null : value, t);
        this.advance(t);
        if (!this.ears && this.prev !== null && this.phaseValue === 'flying') this.evaluateGoals(this.prev, this.prev, t);
        this.afterScript(t);
        return this.drain();
    }

    next(t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        const c = this.current;
        if (c !== null && c.step.kind === 'ask') return this.answer(0, 'key', t);
        if (this.ears && this.phaseValue === 'flying' && c !== null) {
            // skip the scene or the line that is going on
            this.current = null;
            if (c.step.kind === 'scene') {
                this.scene = null;
                this.actions.push({ kind: 'scene', scene: null });
            }
            this.advance(t);
            this.afterScript(t);
            return this.drain();
        }
        if (this.phaseValue === 'intro' || this.phaseValue === 'between') {
            this.script.length = 0;
            this.current = null;
            if (this.scene !== null) {
                this.scene = null;
                this.actions.push({ kind: 'scene', scene: null });
            }
            this.afterScript(t);
        }
        return this.drain();
    }

    reset(to: 'checkpoint' | 'start', t: number): { readonly pose: Pose; readonly events: readonly SessionEvent[] } {
        this.t = Math.max(this.t, t);
        const cp = to === 'checkpoint' ? this.lastCheckpoint : null;
        const pose = cp === null ? this.startPose(Math.max(this.attemptNo, 1)) : cp.pose;
        this.emit({ t, kind: 'reset', to, checkpointId: cp === null ? null : cp.id });
        this.prev = null;
        if (to === 'start' && this.phaseValue === 'flying') {
            // the same attempt again from the start (a manual reset is not a failure)
            this.attemptT0 = t;
            this.touchCount = 0;
            this.pathM = 0;
            this.goalIndex = 0;
            this.shapeOutcome = null;
            this.lastCheckpoint = null;
            this.reached.clear();
            this.script.length = 0;
            this.current = null;
            if (this.ears) {
                this.earsScore = { what: 0, whatAsked: 0, where: 0, whereAsked: 0, moving: 0, movingAsked: 0, answers: [] };
                this.pushEarsAttempt();
            } else this.startGoal(t);
            this.push({ kind: 'say', lines: [{ key: 'fly.reset-start' }] });
            this.advance(t);
        } else if (to === 'checkpoint') this.push({ kind: 'say', lines: [{ key: 'fly.reset-checkpoint' }] });
        return { pose, events: this.drain() };
    }

    // -------------------------------------------------------------- what the engine hears

    target(): SonicObject | null {
        if (this.ears || this.phaseValue !== 'flying' || this.tracker === null) return null;
        return this.tracker.target();
    }

    progress(): LessonProgress {
        const lastAt = new Date((this.o.sessionStartMs ?? 0) + Math.max(this.lastAtT, 0)).toISOString();
        return { lessonId: this.lesson.id, version: this.lesson.version, attempts: this.attemptsDone, successes: this.successes, blocksPassed: this.consecutive, passed: this.passedValue, bestTimeMs: this.bestTimeMs, lastAt };
    }

    demoFrame(t: number): SonicFrameInput | null {
        if (this.scene === null) return null;
        return demoFrame(this.scene.scene, (t - this.scene.t0) / 1000, t, this.sceneWorlds);
    }
}

// ------------------------------------------------------------------ module-0 scenes

const SCENE_SHAPES: Readonly<Record<string, { readonly generator: 'rings' | 'squares' | 'cube-frames' | 'pillars'; readonly params: Readonly<Record<string, number | string>> }>> = {
    'shape.ring': { generator: 'rings', params: { layout: 'single', sizeM: 2.4, aheadM: 10 } },
    'shape.square': { generator: 'squares', params: { layout: 'single', sizeM: 2.4, aheadM: 10 } },
    'shape.cube': { generator: 'cube-frames', params: { layout: 'single', sizeM: 2.4, aheadM: 10 } },
    'shape.pillar': { generator: 'pillars', params: { layout: 'single', aheadM: 10, startHeightM: 3 } },
    'safety.obstacle': { generator: 'pillars', params: { layout: 'single', aheadM: 10, startHeightM: 3 } }
};

function sceneWorld(key: string, make: () => AnalyticWorldInfo, cache: Map<string, AnalyticWorldInfo>): AnalyticWorldInfo {
    let w = cache.get(key);
    if (w === undefined) {
        w = make();
        cache.set(key, w);
    }
    return w;
}

function demoSample(t: number, pos: Vec3, vel: Vec3, yawDeg: number): FlightSample {
    return { t, tick: 0, pos, vel, quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };
}

/** How far the source is at scene time u (0..1): an approach that slows as it nears, or a still distance. */
function sceneDistance(moving: boolean, far: number, near: number, still: number, u: number): number {
    if (!moving) return still;
    const x = Math.min(Math.max(u, 0), 1);
    return far * (near / far) ** x;
}

/**
 * The frame of a module-0 scene at `age` seconds: a virtual craft (the listener) that moves toward
 * a wall, a shape or a hum from the scene's direction, in a small analytic world, so the engine
 * sounds it exactly as in flight.
 */
export function demoFrame(scene: DemoScene, age: number, t: number, cache: Map<string, AnalyticWorldInfo> = new Map()): SonicFrameInput {
    const u = age / scene.durS;
    const du = 0.01;
    const az = (Math.atan2(scene.dir[0], -scene.dir[2]) * 180) / Math.PI;
    if (scene.cue in APPROACHES && scene.cue !== 'safety.obstacle') {
        const hall = sceneWorld('hall', () => createAnalyticWorld(makeSpec('hall', {}, 1)), cache);
        const [w, , d] = [40, 12, 60];
        const h = 12;
        const gap = (x: number): number => sceneDistance(scene.moving, 9, 1.2, 3, x);
        const at = (x: number): Vec3 => {
            const g = gap(x);
            const [dx, dy, dz] = scene.dir;
            if (dy > 0.5) return [0, h - g, 0];
            if (dy < -0.5) return [0, g, 0];
            if (Math.abs(dx) > Math.abs(dz)) return [dx < 0 ? -w / 2 + g : w / 2 - g, 3, 0];
            return [0, 3, dz < 0 ? -d / 2 + g : d / 2 - g];
        };
        const p = at(u);
        const q = at(u + du);
        const vel: Vec3 = [(q[0] - p[0]) / (du * scene.durS), (q[1] - p[1]) / (du * scene.durS), (q[2] - p[2]) / (du * scene.durS)];
        return { sample: demoSample(t, p, scene.moving && u < 1 ? vel : [0, 0, 0], 0), world: hall, target: null, floorY: 0 };
    }
    const shape = SCENE_SHAPES[scene.cue];
    if (shape !== undefined) {
        const world = sceneWorld(scene.cue, () => createAnalyticWorld(makeSpec(shape.generator, shape.params, 1)), cache);
        const object = world.objects()[0] as SonicObject;
        const gap = (x: number): number => sceneDistance(scene.moving, 10, 2.2, 5, x);
        // the craft strafes along -Z toward the object while facing -az, so the object sits at the scene's direction
        const at = (x: number): Vec3 => [object.pos[0], object.pos[1], object.pos[2] + gap(x)];
        const p = at(u);
        const q = at(u + du);
        const vel: Vec3 = [0, 0, (q[2] - p[2]) / (du * scene.durS)];
        return { sample: demoSample(t, p, scene.moving && u < 1 ? vel : [0, 0, 0], -az), world, target: object.order === null ? null : object, floorY: 0 };
    }
    // a hum (target.hum and anything else): a goal zone in an empty space
    const gap = (x: number): number => sceneDistance(scene.moving, 14, 3, 6, x);
    const target: SonicObject = { id: 'demo', shape: { kind: 'zone', size: [1, 1, 1] }, pos: [scene.dir[0] * 14, 1.5 + scene.dir[1] * 14, scene.dir[2] * 14], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
    const at = (x: number): Vec3 => {
        const travelled = 14 - gap(x);
        return [scene.dir[0] * travelled, 1.5 + scene.dir[1] * travelled, scene.dir[2] * travelled];
    };
    const p = at(u);
    const q = at(u + du);
    const vel: Vec3 = [(q[0] - p[0]) / (du * scene.durS), (q[1] - p[1]) / (du * scene.durS), (q[2] - p[2]) / (du * scene.durS)];
    return { sample: demoSample(t, p, scene.moving && u < 1 ? vel : [0, 0, 0], 0), world: null, target, floorY: 0 };
}

/** A runner for one lesson (contract LessonRunner, plus the host interface of LessonSession). */
export function createLessonRunner(lesson: LessonDef, options: RunnerOptions = {}): LessonSession {
    return new Runner(lesson, options);
}

