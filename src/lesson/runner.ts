// The lesson runner (contract LessonRunner; spec section 3). Pure: no DOM and no clock of its own,
// time comes with the samples, so Node tests drive it with scripted flights and a replay
// re-derives the same events. Beside the contract it tells the host what to do through actions
// (say a line, play a cue, place the craft, ask a question, show a module-0 scene), which the host
// drains with takeActions() and carries out.
//
// The host loop:
//   const run = createLessonRunner(lesson, { locale, objects, start, path });
//   run.begin(t)                                  // the task, then the first attempt
//   every frame: events = run.step(sample, world); actions = run.takeActions();
//                engine.update(run.demoFrame(t) ?? { sample, world, target: run.target(), floorY })
//   say actions: engine.say(line), then run.spoken(t) when the speech queue is empty
//   digits / voice: run.answer(value, via, t)    R: run.reset('checkpoint' | 'start', t)    N: run.next(t)
//   I: run.view() and run.statusLine()            (what the host draws and says: lesson k of n, step, attempt, count)
//
// Steps. A lesson is a short list of steps the pilot can tell apart and move between. A flying lesson
// has two: 1 the task (its title and intro lines) and 2 flying (the attempts). A lesson without a
// world (module 0, the ears) has its intro as step 1, then one step per sound of the glossary, per
// narrated scene, per trial of the headphone check or per round of the game.
//
// An attempt of a lesson without a world is a script: narrated scenes, the headphone check, the
// glossary, the game "what is it, where is it, is it moving". An attempt of a flying lesson tracks its
// goals in order (goals.ts). An attempt counts when every goal is met with at most `pass.maxTouches`
// touches; `pass.required` counted attempts in total pass the lesson, and failures in between do not
// reset the count (lesson format 2, v0.13: the v0.12 rule of blocks in a row let a pilot fail for
// ever, docs/wip/s13-lessons.md F1). After every attempt that does not pass the lesson the pilot hears
// "Attempt k. Counted m of r."; after `pass.attempts` failures in a row he hears why and, in a blocking
// lesson, that N goes on to the next lesson; a lesson that does not block (the game, the shapes, free
// flight) moves on by itself then, so it never holds anyone back.
import type { Checkpoint, CueEvent, CueId, FlightSample, Goal, LessonDef, LessonProgress, LessonRunner, Locale, MaterialClass, Pose, SessionEvent, SonicFrameInput, SonicObject, SonicWorld, SpeechLine, Vec3 } from '../contract';
import { DICTS } from '../i18n/dicts';
import { createTranslator, type Dicts, type Translator } from '../i18n/translator';
import { createRng } from '../util/rng';
import { distance as dist3, yawQuat } from '../util/vec';
import { createAnalyticWorld, makeSpec, type AnalyticWorldInfo } from '../world/analytic-world';
import { createTracker, type GoalTracker, type Outcome } from './goals';
import { lessonPaths } from './library';

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

/** What a step of a lesson is (see "Steps" above). */
export type StepKind = 'task' | 'fly' | 'intro' | 'sound' | 'scene' | 'trial' | 'round';

/**
 * Where the pilot is in the lesson, for the I key and the host's progress panel ("Lesson 6 of 21, step
 * 2 of 2, attempt 4, counted 2 of 3"). Plain data, so a host can draw it and say it (statusLine).
 */
export interface LessonView {
    readonly lessonId: string;
    readonly title: SpeechLine;
    /** the lesson's place on the pilot's path (1-based) and the path's length; the full ladder's when the lesson is not on it */
    readonly lessonIndex: number;
    readonly lessonCount: number;
    readonly path: 'full' | 'fast';
    /** the step running (1-based), how many steps the lesson has, and what the step is */
    readonly step: number;
    readonly steps: number;
    readonly stepKind: StepKind;
    /** the goal being flown (1-based) and how many the lesson has; 0 outside an attempt or in a lesson without a world */
    readonly goal: number;
    readonly goals: number;
    /** attempts started in this sitting (0 before the first) */
    readonly attempt: number;
    /** counted attempts toward the pass, and how many pass the lesson */
    readonly counted: number;
    readonly required: number;
    /** failed attempts in a row now */
    readonly failsInARow: number;
    /** the pilot has been told in this sitting that N goes on to the next lesson */
    readonly offered: boolean;
    readonly touches: number;
    /** touches a counted attempt allows; null: any */
    readonly maxTouches: number | null;
    readonly phase: LessonRunner['phase'];
    readonly passed: boolean;
}

export interface LessonSession extends LessonRunner {
    /** starts the lesson: the task, then the first attempt */
    begin(t: number): readonly SessionEvent[];
    /** what the host must do now; each action is handed out once */
    takeActions(): RunnerAction[];
    /** the host's speech queue ran empty at t (the runner otherwise estimates how long lines take) */
    spoken(t: number): readonly SessionEvent[];
    /** module 0: the frame the engine should hear at t while a scene runs, else null */
    demoFrame(t: number): SonicFrameInput | null;
    /** the N key: skip the intro, a question or the pause between attempts */
    next(t: number): readonly SessionEvent[];
    /** where the pilot is: lesson, step, attempt, count */
    view(): LessonView;
    /** the view as one line to say (I) */
    statusLine(): SpeechLine;
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
    /** the pilot's path (SonicPrefs.path): where the lesson stands on it and what comes after; default 'full' */
    readonly path?: 'full' | 'fast';
    /** the names of the host's keys, as the lines say them ("Press N to go on"); default N, B, Z */
    readonly keys?: { readonly next?: string; readonly previous?: string; readonly repeat?: string };
    /** for the negative controls of the tests only: each one brings back a rule of v0.12 that a check must catch */
    readonly testHooks?: RunnerTestHooks;
}

/** For the tests' negative controls only. */
export interface RunnerTestHooks {
    /**
     * The block rule of v0.12 with the lesson's v0.12 numbers: `required` successes in a block of `attempts`, `blocks`
     * blocks in a row, a block that can no longer pass starts again from zero; no reason and no offer to go on.
     */
    readonly passRule?: V012PassRule;
}

/** A lesson's pass rule as v0.12 shipped it (format 1). */
export interface V012PassRule {
    readonly attempts: number;
    readonly required: number;
    readonly blocks: number;
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
/**
 * turn-to lessons start each attempt turned by these, degrees, so the sound comes from another side.
 * None of them may leave the craft facing the sound at the start, or that attempt is passed without a
 * touch: hover-turn has its ring 83 degrees to the left, so -90 faced it (6.8 degrees off) and -135 does not.
 */
export const TURN_OFFSETS = [0, 180, 90, -135] as const;

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

/** One step of the lesson as the pilot moves between them: what it is and what it plays. */
interface Block {
    readonly kind: StepKind;
    readonly steps: readonly Step[];
}

interface Running {
    readonly step: Step;
    readonly t0: number;
    /** say: the lines were handed out and the host has not yet reported the queue empty */
    answered: boolean;
    spoken: boolean;
}

type Phase = LessonRunner['phase'];

/** One answer of module 0, by question id: asked again (a step repeated), it replaces the earlier one. */
interface EarsAnswer {
    readonly kind: 'what' | 'where' | 'moving' | 'side' | 'front-back';
    readonly value: number | null;
    readonly right: boolean;
}

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
    // steps: the task or the intro first, then (module 0) one per sound, scene, trial or round
    private blocks: Block[] = [];
    private blockIndex = 0;
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
    /** set while the pilot's own key (N, an answer) is being handled: the first line said after it interrupts the speech in progress */
    private interruptNext = false;
    private earsAnswers = new Map<string, EarsAnswer>();
    // progress
    /** attempts and counted attempts of this lesson version, earlier sessions included */
    private attemptsDone: number;
    private successes: number;
    /** counted attempts toward the pass: this sitting's, plus an unfinished earlier sitting's of the same version */
    private counted: number;
    /** failed attempts in a row */
    private failRun = 0;
    /** the go-on offer was made in this sitting */
    private offered = false;
    /** the lesson was passed by its rule (not only ended, as a lesson that does not block may be) */
    private passedByRule = false;
    private passedValue: boolean;
    private bestTimeMs: number | null;
    private lastAtT = 0;
    // the v0.12 block rule (testHooks.passRule only)
    private blockOk = 0;
    private blockDone = 0;
    private consecutive = 0;
    private blocksPlayed = 0;
    // scenes
    private scene: { readonly scene: DemoScene; readonly t0: number } | null = null;
    private readonly sceneWorlds = new Map<string, AnalyticWorldInfo>();

    constructor(lesson: LessonDef, options: RunnerOptions) {
        this.lesson = lesson;
        this.o = options;
        this.tr = createTranslator(options.locale ?? 'en', options.dicts ?? DICTS);
        const p = options.progress ?? null;
        const same = p !== null && p.lessonId === lesson.id;
        // counts carry on within one version of the lesson only: another version has another rule
        const sameVersion = same && p.version === lesson.version;
        this.attemptsDone = sameVersion ? p.attempts : 0;
        this.successes = sameVersion ? p.successes : 0;
        this.passedValue = same ? p.passed : false;
        this.passedByRule = sameVersion && p.passed && p.blocksPassed > 0;
        // a lesson passed before is practised afresh; an unfinished one goes on from its count
        this.counted = sameVersion && !p.passed ? Math.min(p.successes, lesson.pass.required - 1) : 0;
        this.consecutive = sameVersion ? p.blocksPassed : 0;
        this.bestTimeMs = same ? p.bestTimeMs : null;
    }

    private get hooks(): RunnerTestHooks {
        return this.o.testHooks ?? {};
    }

    private key(which: 'next' | 'previous' | 'repeat'): string {
        return this.o.keys?.[which] ?? { next: 'N', previous: 'B', repeat: 'Z' }[which];
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

    /** Runs step `index` of the lesson's steps from its beginning (what was going on stops). */
    private startBlock(index: number, t: number): void {
        this.blockIndex = index;
        this.script.length = 0;
        this.stopCurrent();
        const block = this.blocks[index];
        if (block !== undefined) this.push(...block.steps);
        this.advance(t);
    }

    /** The step going on is dropped: a scene stops; a question is left (no answer is recorded). */
    private stopCurrent(): void {
        this.current = null;
        if (this.scene !== null) {
            this.scene = null;
            this.actions.push({ kind: 'scene', scene: null });
        }
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
                // a key the pilot just pressed cuts the speech still going with the first line of what follows
                step.lines.forEach((line, i) => this.actions.push({ kind: 'say', line, interrupt: i === 0 && (step.interrupt ?? this.interruptNext) }));
                this.interruptNext = false;
                break;
            case 'cue':
                this.actions.push({ kind: 'cue', event: step.event });
                break;
            case 'scene':
                this.scene = { scene: step.scene, t0: t };
                this.actions.push({ kind: 'scene', scene: step.scene });
                break;
            case 'ask':
                step.question.lines.forEach((line, i) => this.actions.push({ kind: 'say', line, interrupt: i === 0 && this.interruptNext }));
                this.interruptNext = false;
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
        this.blocks = [this.introBlock()];
        this.phaseValue = 'intro';
        this.startBlock(0, t);
        this.afterScript(t);
        return this.drain();
    }

    /** Step 1: the task of a flying lesson, or the intro of a lesson without a world. */
    private introBlock(): Block {
        return { kind: this.ears ? 'intro' : 'task', steps: [{ kind: 'say', lines: [this.lesson.title, ...this.lesson.intro] }] };
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
        this.earsAnswers = new Map();
        this.phaseValue = 'flying';
        if (!first && !this.ears && this.returnsToStart()) {
            const pose = this.startPose(this.attemptNo);
            this.actions.push({ kind: 'place', pose, to: 'start' });
            this.emit({ t, kind: 'reset', to: 'start', checkpointId: null });
        }
        this.lessonEvent('attempt-start', t);
        if (this.ears) {
            this.tracker = null;
            this.blocks = [this.introBlock(), ...this.earsBlocks()];
            this.startBlock(1, t);
        } else {
            this.script.length = 0;
            this.push({ kind: 'say', lines: [{ key: 'fly.go' }] });
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

    /**
     * The script has run dry: the task or the intro is over, a step of module 0 has played (the next one
     * begins, or the attempt is scored after the last), or the pause between attempts ended.
     */
    private afterScript(t: number): void {
        for (let guard = 0; guard < 64; guard++) {
            if (this.current !== null || this.script.length > 0 || !this.began) return;
            if (this.phaseValue === 'intro') this.startAttempt(t, true);
            else if (this.phaseValue === 'between') this.startAttempt(t, false);
            else if (this.phaseValue === 'flying' && this.ears) {
                if (this.blockIndex + 1 < this.blocks.length) this.startBlock(this.blockIndex + 1, t);
                else this.endEarsAttempt(t);
            } else return;
            this.advance(t);
        }
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
                this.endAttempt(false, t, this.whyMissed(false));
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
            this.endAttempt(false, t, this.whyMissed(true));
        }
    }

    /** What went wrong in the attempt now ending: the time ran out, and what the current goal says (at most two short lines). */
    private whyMissed(outOfTime: boolean): SpeechLine[] {
        const goal = this.tracker === null ? null : this.tracker.reason();
        const out: SpeechLine[] = [];
        if (outOfTime) out.push({ key: 'reason.time' });
        if (goal !== null) out.push(goal);
        return out;
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

    // -------------------------------------------------------------- attempts and the pass rule

    /**
     * An attempt ends. Format 2: it counts when every goal was met with at most `maxTouches` touches;
     * `required` counted attempts in total pass the lesson (failures in between do not reset the count).
     * The pilot hears "Attempt k. Counted m of r." (no line when the lesson is passed: the pass line instead).
     * After `attempts` failures in a row he hears why (`why`: the goal's reason) and, in a blocking
     * lesson, that N goes on to the next lesson; a lesson that does not block moves on by itself then.
     */
    private endAttempt(goalsMet: boolean, t: number, why: readonly SpeechLine[] = []): void {
        if (this.hooks.passRule !== undefined) {
            this.endAttemptV012(goalsMet, t, this.hooks.passRule);
            return;
        }
        const rule = this.lesson.pass;
        const touchesOk = rule.maxTouches === null || this.touchCount <= rule.maxTouches;
        const ok = goalsMet && touchesOk;
        this.attemptsDone++;
        if (ok) {
            this.successes++;
            this.counted++;
            this.failRun = 0;
            this.timedLine(t);
        } else this.failRun++;
        this.lessonEvent(ok ? 'attempt-pass' : 'attempt-fail', t);
        this.tracker = null;
        if (ok && this.counted >= rule.required) {
            this.pass(t);
            return;
        }
        const touches: SpeechLine = rule.maxTouches === 0 ? { key: 'reason.touches-none' } : { key: 'reason.touches', params: { n: this.touchCount, limit: rule.maxTouches ?? 0 } };
        const reasons: SpeechLine[] = ok ? [] : goalsMet ? [touches] : [...why];
        const progress: SpeechLine = { key: 'fly.progress', params: { n: this.attemptNo, counted: this.counted, required: rule.required } };
        const offerNow = !ok && this.failRun % rule.attempts === 0;
        if (offerNow && !rule.blocking) {
            this.moveOn(t, [progress, ...reasons]);
            return;
        }
        this.phaseValue = 'between';
        this.script.length = 0;
        if (ok) {
            if (!this.ears) this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
            this.push({ kind: 'say', lines: [progress] });
        } else if (offerNow) {
            this.offered = true;
            this.push({ kind: 'say', lines: [progress, ...reasons, { key: 'fly.offer-next', params: { key: this.key('next') } }] });
        } else {
            const hints = this.lesson.speech.hints;
            const hint = hints.length === 0 ? [] : [hints[(this.attemptsDone - 1) % hints.length] as SpeechLine];
            this.push({ kind: 'say', lines: [progress, this.lesson.speech.retry, ...hint] });
        }
        this.push({ kind: 'wait', s: BETWEEN_S });
    }

    /** A timed course: the time of a counted attempt, and whether it is the best one. */
    private timedLine(t: number): void {
        if (!this.lesson.goals.some((g) => g.kind === 'timed-course')) return;
        const ms = Math.round(t - this.attemptT0);
        const better = this.bestTimeMs === null || ms < this.bestTimeMs;
        if (better) this.bestTimeMs = ms;
        this.actions.push({ kind: 'say', line: { key: better ? 'fly.best-time' : 'fly.time', params: { time: this.tr.duration(ms) } }, interrupt: false });
    }

    /** The lesson is passed by its rule: the fanfare and the pass line. */
    private pass(t: number): void {
        this.passedValue = true;
        this.passedByRule = true;
        this.phaseValue = 'passed';
        // the report counts a `passed` as a pass when the lesson event just before it says the rule was met
        this.lessonEvent('block-pass', t);
        this.lessonEvent('passed', t);
        this.script.length = 0;
        this.current = null;
        this.actions.push({ kind: 'cue', event: { kind: 'fanfare' } });
        this.actions.push({ kind: 'say', line: this.lesson.speech.pass, interrupt: false });
    }

    /** A lesson that does not block ends after `attempts` failures in a row: it never holds anyone back. */
    private moveOn(t: number, lines: readonly SpeechLine[]): void {
        this.passedValue = true;
        this.phaseValue = 'passed';
        this.lessonEvent('passed', t);
        this.script.length = 0;
        this.current = null;
        this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
        for (const line of [...lines, { key: 'fly.moving-on' }]) this.actions.push({ kind: 'say', line, interrupt: false });
    }

    /** The block rule of v0.12, kept only for the negative controls (testHooks.passRule). */
    private endAttemptV012(goalsMet: boolean, t: number, rule: V012PassRule): void {
        const touchesOk = this.lesson.pass.maxTouches === null || this.touchCount <= this.lesson.pass.maxTouches;
        const ok = goalsMet && touchesOk;
        this.attemptsDone++;
        this.blockDone++;
        if (ok) {
            this.successes++;
            this.blockOk++;
            this.timedLine(t);
        }
        this.lessonEvent(ok ? 'attempt-pass' : 'attempt-fail', t);
        this.tracker = null;
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
            done = this.lesson.pass.blocking ? this.consecutive >= rule.blocks : this.blocksPlayed >= rule.blocks;
        }
        if (done) {
            this.passedValue = true;
            this.passedByRule = blockPassed;
            this.phaseValue = 'passed';
            this.lessonEvent('passed', t);
            this.script.length = 0;
            this.current = null;
            this.actions.push({ kind: 'cue', event: { kind: 'fanfare' } });
            this.actions.push({ kind: 'say', line: this.lesson.speech.pass, interrupt: false });
            return;
        }
        this.phaseValue = 'between';
        this.script.length = 0;
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

    /** The steps of an attempt of module 0 (after the intro): one per sound, scene, trial or round. */
    private earsBlocks(): Block[] {
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        if (names !== null && names.trials > 0) return this.gameBlocks(names, locate);
        if (names !== null) return this.presentationBlocks(names.cues);
        if (locate !== null) return this.headphoneBlocks(locate.trials);
        return [];
    }

    /** How many steps an attempt of module 0 has (known before the attempt is built). */
    private earsStepCount(): number {
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        if (names !== null && names.trials > 0) return Math.max(names.trials, locate?.trials ?? 0);
        if (names !== null) return isGlossary(names.cues) ? names.cues.length : names.cues.reduce((n, c) => n + (APPROACHES[c] ?? [null]).length, 0);
        return locate === null ? 0 : locate.trials;
    }

    private cueName(cue: CueId): string {
        return this.text({ key: `cue.${cue}.name` });
    }

    /** The glossary, or narrated scenes when every cue is a wall or a shape (ears-walls, ears-shapes). */
    private presentationBlocks(cues: readonly CueId[]): Block[] {
        if (isGlossary(cues)) {
            return cues.map((cue, i) => ({
                kind: 'sound' as const,
                steps: [
                    { kind: 'say', lines: [{ key: i === 0 ? 'glossary.intro' : 'glossary.next' }, { key: `cue.${cue}.name` }, { key: `cue.${cue}.glossary` }] },
                    { kind: 'cue', event: { kind: 'preview', cue, dir: null }, waitS: PREVIEW_WAIT_S },
                    ...(i === cues.length - 1 ? [{ kind: 'say', lines: [{ key: 'glossary.done' }] } as Step] : [])
                ]
            }));
        }
        const out: Block[] = [];
        for (const cue of cues) {
            const ways = APPROACHES[cue] ?? [{ dir: [0, 0, -1] as Vec3, sector: 'front' }];
            for (const w of ways) {
                out.push({
                    kind: 'scene',
                    steps: [
                        { kind: 'say', lines: [{ key: 'narrate.coming', params: { name: this.cueName(cue) } }, { key: `dir.${w.sector}` }] },
                        { kind: 'scene', scene: { cue, dir: w.dir, moving: true, durS: SCENE_S } }
                    ]
                });
            }
        }
        return out;
    }

    /** The headphone check: a sound on the left, on the right, behind; answered by digits. */
    private headphoneBlocks(trials: number): Block[] {
        const order = [SIDES[0], SIDES[1], SIDES[3], SIDES[2]] as (typeof SIDES)[number][];
        const out: Block[] = [];
        for (let i = 0; i < trials; i++) {
            const side = order[i % order.length] as (typeof SIDES)[number];
            const lateral = side.sector === 'left' || side.sector === 'right';
            const correct = lateral ? (side.sector === 'left' ? 1 : 2) : side.sector === 'front' ? 1 : 2;
            const id = `${this.lesson.id}:${this.attemptNo}:${i + 1}:${lateral ? 'side' : 'front-back'}`;
            const steps: Step[] = [];
            if (i === 0) steps.push({ kind: 'say', lines: [{ key: 'headphones.intro' }, { key: 'headphones.wired' }, { key: 'headphones.os-spatial' }] });
            steps.push({ kind: 'cue', event: { kind: 'preview', cue: 'target.hum', dir: side.dir }, waitS: PREVIEW_WAIT_S });
            steps.push({
                kind: 'ask',
                question: { id, lines: [{ key: lateral ? 'headphones.q-side' : 'headphones.q-front-back' }], options: 3, skippable: true },
                onAnswer: (value) => {
                    // only left and right are graded: the check is that the headphones are the right way round, and telling
                    // front from behind with a generic HRTF is unreliable (research 01: 10 to 50 % reversals), so that answer is
                    // asked and recorded for the report but never fails the check
                    this.earsAnswers.set(id, { kind: lateral ? 'side' : 'front-back', value, right: value === correct });
                }
            });
            out.push({ kind: 'trial', steps });
        }
        return out;
    }

    /** The game "what is it, where is it, is it moving" (rounds of three questions). */
    private gameBlocks(names: Extract<Goal, { kind: 'name-cues' }>, locate: Extract<Goal, { kind: 'locate' }> | null): Block[] {
        const rng = createRng((this.o.seed ?? 1) * 7919 + this.attemptNo);
        const options = names.cues.slice(0, 9);
        const rounds = Math.max(names.trials, locate?.trials ?? 0);
        const out: Block[] = [];
        for (let r = 0; r < rounds; r++) {
            const cueIndex = rng.int(0, options.length - 1);
            const cue = options[cueIndex] as CueId;
            const side = SIDES[rng.int(0, SIDES.length - 1)] as (typeof SIDES)[number];
            const moving = rng.next() < 0.5;
            const scene: DemoScene = { cue, dir: side.dir, moving, durS: SCENE_S - 1 };
            const id = `${this.lesson.id}:${this.attemptNo}:${r + 1}`;
            const feedback = (value: number | null, right: boolean, replay: boolean): Step[] =>
                value === null ? [] : right ? [{ kind: 'say', lines: [{ key: 'quiz.right' }] }] : [{ kind: 'say', lines: [{ key: 'quiz.wrong' }] }, ...(replay ? [{ kind: 'scene', scene } as Step] : [])];
            const steps: Step[] = [{ kind: 'say', lines: r === 0 ? [{ key: 'quiz.howto' }, { key: 'quiz.intro' }] : [{ key: 'quiz.intro' }] }, { kind: 'scene', scene }];
            if (r < names.trials) {
                steps.push({
                    kind: 'ask',
                    question: { id: `${id}:what`, lines: [{ key: 'quiz.q-what' }, ...options.map((c, i) => ({ key: 'quiz.option', params: { n: i + 1, label: this.cueName(c) } }))], options: options.length, skippable: true },
                    onAnswer: (value) => {
                        const right = value === cueIndex + 1;
                        this.earsAnswers.set(`${id}:what`, { kind: 'what', value, right });
                        this.script.unshift(...feedback(value, right, true));
                    }
                });
            }
            if (locate !== null && r < locate.trials) {
                const where = SIDES.indexOf(side) + 1;
                steps.push({
                    kind: 'ask',
                    question: { id: `${id}:where`, lines: [{ key: 'quiz.q-where' }, { key: 'quiz.where-options' }], options: 4, skippable: true },
                    onAnswer: (value) => {
                        const right = value === where;
                        this.earsAnswers.set(`${id}:where`, { kind: 'where', value, right });
                        this.script.unshift(...feedback(value, right, false));
                    }
                });
                steps.push({
                    kind: 'ask',
                    question: { id: `${id}:moving`, lines: [{ key: 'quiz.q-moving' }], options: 2, skippable: true },
                    onAnswer: (value) => {
                        const right = value === (moving ? 1 : 2);
                        this.earsAnswers.set(`${id}:moving`, { kind: 'moving', value, right });
                        if (value !== null) this.script.unshift({ kind: 'say', lines: [{ key: right ? 'quiz.right' : 'quiz.wrong' }, { key: moving ? 'quiz.moving' : 'quiz.still' }] });
                    }
                });
            }
            out.push({ kind: 'round', steps });
        }
        return out;
    }

    private endEarsAttempt(t: number): void {
        if (this.phaseValue !== 'flying') return;
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        const all = [...this.earsAnswers.values()];
        const count = (kind: EarsAnswer['kind'], right: boolean | null): number => all.filter((a) => a.kind === kind && (right === null || a.right === right)).length;
        const results: { index: number; met: boolean }[] = [];
        this.lesson.goals.forEach((g, index) => {
            if (g.kind === 'name-cues') results.push({ index, met: g.trials === 0 ? true : count('what', null) > 0 && count('what', true) / g.trials >= NAME_SHARE });
            else if (g.kind === 'locate') {
                // the game grades where and moving of every round; the headphone check the left and right trials it asked
                const game = names !== null && names.trials > 0;
                const asked = game ? 2 * g.trials : Math.max(1, count('side', null));
                const right = game ? count('where', true) + count('moving', true) : count('side', true);
                results.push({ index, met: right / asked >= LOCATE_SHARE });
            }
        });
        for (const r of results) this.emit({ t, kind: 'goal', index: r.index, what: r.met ? 'met' : 'missed' });
        // what the pilot hears about the attempt
        if (names !== null && names.trials > 0) {
            const total = count('what', null) + count('where', null) + count('moving', null);
            this.actions.push({ kind: 'say', line: { key: 'quiz.score', params: { right: count('what', true) + count('where', true) + count('moving', true), total } }, interrupt: false });
        } else if (locate !== null && names === null) {
            const side = all.filter((a) => a.kind === 'side');
            const swapped = side[0]?.value === 2 && side[1]?.value === 1;
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
        this.interruptNext = true;
        try {
            c.step.onAnswer(skip ? null : value, t);
            this.advance(t);
            if (!this.ears && this.prev !== null && this.phaseValue === 'flying') this.evaluateGoals(this.prev, this.prev, t);
            this.afterScript(t);
        } finally {
            this.interruptNext = false;
        }
        return this.drain();
    }

    next(t: number): readonly SessionEvent[] {
        this.interruptNext = true;
        try {
            return this.skipAhead(t);
        } finally {
            this.interruptNext = false;
        }
    }

    private skipAhead(t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        const c = this.current;
        if (c !== null && c.step.kind === 'ask') return this.answer(0, 'key', t);
        if (this.ears && this.phaseValue === 'flying' && c !== null) {
            // skip the scene or the line that is going on
            this.stopCurrent();
            this.advance(t);
            this.afterScript(t);
            return this.drain();
        }
        if (this.phaseValue === 'intro' || this.phaseValue === 'between') {
            this.script.length = 0;
            this.stopCurrent();
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
                this.earsAnswers = new Map();
                this.blocks = [this.introBlock(), ...this.earsBlocks()];
                this.blockIndex = 1;
                const block = this.blocks[1];
                if (block !== undefined) this.push(...block.steps);
            } else this.startGoal(t);
            this.push({ kind: 'say', lines: [{ key: 'fly.reset-start' }], interrupt: !this.ears });
            this.advance(t);
        } else if (to === 'checkpoint') this.push({ kind: 'say', lines: [{ key: 'fly.reset-checkpoint' }], interrupt: !this.ears });
        return { pose, events: this.drain() };
    }

    // -------------------------------------------------------------- what the host shows and says

    view(): LessonView {
        const paths = lessonPaths();
        const path = this.o.path ?? 'full';
        const onPath = paths[path].includes(this.lesson.id) ? path : 'full';
        const list = paths[onPath];
        const index = list.indexOf(this.lesson.id);
        const steps = this.ears ? 1 + this.earsStepCount() : 2;
        const step = this.ears ? Math.min(this.blockIndex + 1, steps) : this.phaseValue === 'intro' ? 1 : 2;
        const stepKind: StepKind = this.ears ? (this.blocks[this.blockIndex]?.kind ?? 'intro') : step === 1 ? 'task' : 'fly';
        const flying = !this.ears && this.phaseValue === 'flying';
        return {
            lessonId: this.lesson.id,
            title: this.lesson.title,
            lessonIndex: index < 0 ? 1 : index + 1,
            lessonCount: index < 0 ? 1 : list.length,
            path: onPath,
            step,
            steps,
            stepKind,
            goal: flying ? this.goalIndex + 1 : 0,
            goals: this.ears ? 0 : this.lesson.goals.length,
            attempt: this.attemptNo,
            counted: this.counted,
            required: this.lesson.pass.required,
            failsInARow: this.failRun,
            offered: this.offered,
            touches: this.touchCount,
            maxTouches: this.lesson.pass.maxTouches,
            phase: this.phaseValue,
            passed: this.passedValue
        };
    }

    statusLine(): SpeechLine {
        return statusLine(this.view(), this.text(this.lesson.title));
    }

    // -------------------------------------------------------------- what the engine hears

    target(): SonicObject | null {
        if (this.ears || this.phaseValue !== 'flying' || this.tracker === null) return null;
        return this.tracker.target();
    }

    progress(): LessonProgress {
        const lastAt = new Date((this.o.sessionStartMs ?? 0) + Math.max(this.lastAtT, 0)).toISOString();
        // blocksPassed: 1 once the lesson was passed by its rule (format 2 has no blocks), the blocks in a row under the v0.12 control
        const blocksPassed = this.hooks.passRule !== undefined ? this.consecutive : this.passedByRule ? 1 : 0;
        return { lessonId: this.lesson.id, version: this.lesson.version, attempts: this.attemptsDone, successes: this.successes, blocksPassed, passed: this.passedValue, bestTimeMs: this.bestTimeMs, lastAt };
    }

    demoFrame(t: number): SonicFrameInput | null {
        if (this.scene === null) return null;
        return demoFrame(this.scene.scene, (t - this.scene.t0) / 1000, t, this.sceneWorlds);
    }
}

/** The glossary names sounds of every kind; the narrated lessons only walls and shapes. */
function isGlossary(cues: readonly CueId[]): boolean {
    return !cues.every((c) => c in APPROACHES || SHAPE_ORDER.includes(c));
}

/**
 * The progress view as one line to say (I): "Lesson 6 of 21: Hold your height. Step 2 of 2. Attempt 4.
 * Counted 2 of 3." A lesson without a world says its lesson and step only. `title` is the lesson's title
 * in the pilot's language.
 */
export function statusLine(v: LessonView, title: string): SpeechLine {
    const base = { title, lesson: v.lessonIndex, lessons: v.lessonCount, step: v.step, steps: v.steps };
    if (v.goals === 0 || v.attempt === 0) return { key: 'status.progress-step', params: base };
    return { key: 'status.progress', params: { ...base, n: v.attempt, counted: v.counted, required: v.required } };
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

