// The replay core (spec section 7, plan step 10): frames in, the session's events and cues out.
//
// A recorded frame (30 Hz) is turned back into the FlightSample the engine and the lesson runner were
// fed, and the same pure code runs again: the LessonRunner re-derives the lesson's events (goals,
// gates, checkpoints, resets, attempts, the lines it speaks) and the CuePlanner re-derives the ids of
// the cues that sounded. Nothing is simulated: the flight itself is the recorded track.
//
// What the replay takes from the recording as INPUTS, because the replay cannot know them:
//   touches        `touch` events: the contact flag of the sample at their time (contacts come from
//                  the flight model); the runner works out material, speed and position again
//   answers        `answer` events: digits or voice given to a question; `key` events with the action
//                  REFUSED_DIGIT_ACTION: digits the runner refused (written by the runner, review I2 of sonic-keys)
//   keys           `key` events whose action is REPLAY_KEY_ACTIONS.*: reset to a checkpoint, reset
//                  to the start, next step, previous step, repeat the step (v0.13: N, B, Z), next
//                  lesson and previous lesson (the lesson menu)
//   speech ends    `speech` events with the key SPEECH_END_KEY: the moment the host's speech queue
//                  ran empty and it called runner.spoken(t). Without them the runner's own estimate
//                  of how long a line takes is used, which is exact only if the host did the same.
//   pauses         `session` events pause and resume (v0.13): the host calls runner.pause(t) and
//                  runner.resume(t) where it writes them, so the lesson's clocks leave the pause out
//   the start      the first `lesson open` event: when the host called runner.begin(t)
// The host (the simulator's recorder) must therefore write those events; the comparer
// (compare.ts) then checks everything else against the recording. It must also keep every sample
// with a touch as a frame, between two due frames too: a touch is applied on the first frame at or
// after its time, and in a lesson that re-centres the frame after it is already at the respawn.
//
// A package is ONE lesson: the manifest names it and the replay runs it from `open` to the end. A
// host that moves a pilot on to the next lesson starts a new package.
//
// `Replayer` steps frame by frame (for a viewer that plays, pauses and seeks, and feeds the engine
// from `ReplayStep.input` and `.actions`); `replayFlight` runs it to the end.
import type { FlightFrame, FlightSample, LessonProgress, SessionEvent, SonicFrameInput } from '../contract';
import { CuePlanner } from '../cues/planner';
import { DICTS } from '../i18n/dicts';
import { createTranslator, type Translator } from '../i18n/translator';
import { createLessonRunner, REFUSED_DIGIT_ACTION, type LessonSession, type RunnerAction } from '../lesson/runner';
import { frameToSample } from './frames';
import type { ReplayNote, ReplaySetup } from './rebuild';

/** The key of the `speech` event a host writes when its speech queue runs empty (the moment it calls runner.spoken(t)). */
export const SPEECH_END_KEY = 'speech.end';

/** The `action` of a `key` event the replay acts on. */
export const REPLAY_KEY_ACTIONS = { resetCheckpoint: 'reset.checkpoint', resetStart: 'reset.start', next: 'next', previous: 'previous', repeat: 'repeat', nextLesson: 'next-lesson', previousLesson: 'previous-lesson' } as const;

export interface ReplayInput {
    readonly setup: ReplaySetup;
    readonly frames: readonly FlightFrame[];
    /** the recorded events: the replay takes its inputs from them (see the header) */
    readonly events?: readonly SessionEvent[];
    /** the lesson's saved progress when the session began (the manifest does not carry it); default none */
    readonly progress?: LessonProgress | null;
    /** the dice of the ears game (default: the runner's own) */
    readonly seed?: number;
}

/** What one replayed frame produced. */
export interface ReplayStep {
    readonly index: number;
    readonly frame: FlightFrame;
    readonly sample: FlightSample;
    /** what the engine would be fed for this frame (a module-0 scene, or the craft in its world) */
    readonly input: SonicFrameInput;
    /** the events derived at this step, inputs included, in order */
    readonly events: readonly SessionEvent[];
    /** what the host would do now: say, cue, place the craft, ask, show a scene */
    readonly actions: readonly RunnerAction[];
    /** ids of the cues sounding in this frame, as the planner derives them */
    readonly cues: readonly string[];
}

export interface ReplayResult {
    readonly derivedEvents: readonly SessionEvent[];
    /** per frame, the ids of the cues that sound in it */
    readonly cues: readonly (readonly string[])[];
    readonly notes: readonly ReplayNote[];
    /** the lesson's progress at the end, or null without a lesson */
    readonly progress: LessonProgress | null;
}

type Input =
    | { readonly t: number; readonly kind: 'begin' }
    | { readonly t: number; readonly kind: 'spoken' }
    | { readonly t: number; readonly kind: 'answer'; readonly value: number; readonly via: 'key' | 'voice' }
    | { readonly t: number; readonly kind: 'reset'; readonly to: 'checkpoint' | 'start' }
    | { readonly t: number; readonly kind: 'next' | 'previous' | 'repeat' | 'next-lesson' | 'previous-lesson' }
    | { readonly t: number; readonly kind: 'pause' | 'resume' };

/** The inputs a recording holds, in time order (events with the same time keep their order). */
function inputsOf(events: readonly SessionEvent[], firstT: number): { readonly inputs: Input[]; readonly touches: number[]; readonly markers: number; readonly hasOpen: boolean } {
    const inputs: Input[] = [];
    const touches: number[] = [];
    let markers = 0;
    let hasOpen = false;
    for (const e of events) {
        if (e.kind === 'lesson' && e.what === 'open' && !hasOpen) {
            hasOpen = true;
            inputs.push({ t: e.t, kind: 'begin' });
        } else if (e.kind === 'speech' && e.key === SPEECH_END_KEY) {
            markers++;
            inputs.push({ t: e.t, kind: 'spoken' });
        } else if (e.kind === 'answer') {
            inputs.push({ t: e.t, kind: 'answer', value: e.value ?? 0, via: e.via === 'voice' ? 'voice' : 'key' });
        } else if (e.kind === 'key' && e.action === REFUSED_DIGIT_ACTION) {
            // a digit the runner refused: refused again, its sound and word derived (the runner wrote this event)
            const n = /(\d+)$/.exec(e.code);
            if (n !== null) inputs.push({ t: e.t, kind: 'answer', value: Number(n[1]), via: e.code.startsWith('Voice') ? 'voice' : 'key' });
        } else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.resetCheckpoint) inputs.push({ t: e.t, kind: 'reset', to: 'checkpoint' });
        else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.resetStart) inputs.push({ t: e.t, kind: 'reset', to: 'start' });
        else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.next) inputs.push({ t: e.t, kind: 'next' });
        else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.previous) inputs.push({ t: e.t, kind: 'previous' });
        else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.repeat) inputs.push({ t: e.t, kind: 'repeat' });
        else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.nextLesson) inputs.push({ t: e.t, kind: 'next-lesson' });
        else if (e.kind === 'key' && e.action === REPLAY_KEY_ACTIONS.previousLesson) inputs.push({ t: e.t, kind: 'previous-lesson' });
        else if (e.kind === 'session' && (e.what === 'pause' || e.what === 'resume')) inputs.push({ t: e.t, kind: e.what });
        else if (e.kind === 'touch') touches.push(e.t);
    }
    if (!hasOpen) inputs.push({ t: firstT, kind: 'begin' });
    // a stable sort by time; 'begin' goes before anything else at its own time
    const order = (i: Input): number => (i.kind === 'begin' ? 0 : 1);
    const indexed = inputs.map((x, i) => ({ x, i }));
    indexed.sort((a, b) => a.x.t - b.x.t || order(a.x) - order(b.x) || a.i - b.i);
    touches.sort((a, b) => a - b);
    return { inputs: indexed.map((p) => p.x), touches, markers, hasOpen };
}

export class Replayer {
    private readonly input: ReplayInput;
    private readonly translator: Translator;
    private readonly frames: readonly FlightFrame[];
    private readonly notesList: ReplayNote[] = [];
    private runner: LessonSession | null = null;
    private planner!: CuePlanner;
    private inputs: Input[] = [];
    private touches: number[] = [];
    private inputPos = 0;
    private touchPos = 0;
    private indexValue = 0;
    private prev: FlightFrame | null = null;
    private derived: SessionEvent[] = [];
    private cueLog: string[][] = [];

    constructor(input: ReplayInput) {
        this.input = input;
        this.frames = input.frames;
        this.translator = createTranslator(input.setup.locale, DICTS);
        const recorded = input.events ?? [];
        const parsed = inputsOf(recorded, input.frames[0]?.t ?? 0);
        this.notesList.push(...input.setup.notes);
        if (input.setup.lesson !== null && recorded.length > 0) {
            const spoke = recorded.some((e) => e.kind === 'speech' && e.key !== SPEECH_END_KEY);
            if (parsed.markers === 0 && spoke) this.notesList.push({ code: 'no-speech-end-markers', message: `the recording has no '${SPEECH_END_KEY}' events: the replay estimates how long speech took, so times after spoken lines may differ` });
            const lessonId = input.setup.lesson.id;
            const other = recorded.find((e) => e.kind === 'lesson' && e.lessonId !== lessonId);
            if (other !== undefined) this.notesList.push({ code: 'other-lesson-events', message: `the recording holds events of another lesson (${(other as { lessonId: string }).lessonId}): a package is one lesson, only ${lessonId} is replayed` });
            if (!parsed.hasOpen) this.notesList.push({ code: 'no-lesson-events', message: 'the recording has no lesson-open event: the lesson is begun at the first frame' });
        }
        if (input.setup.lesson !== null && input.progress === undefined) {
            // the manifest does not carry earlier progress: say so only when it could matter
            if (input.setup.lesson.pass.blocks > 1) this.notesList.push({ code: 'progress', message: 'the lesson passes after several blocks and the replay does not know earlier progress: pass it in if the pilot had some' });
        }
        this.reset(parsed);
    }

    /** Starts over from the first frame (a seek backwards, or a second run). */
    reset(parsed = inputsOf(this.input.events ?? [], this.frames[0]?.t ?? 0)): void {
        const s = this.input.setup;
        this.inputs = parsed.inputs;
        this.touches = parsed.touches;
        this.inputPos = 0;
        this.touchPos = 0;
        this.indexValue = 0;
        this.prev = null;
        this.derived = [];
        this.cueLog = [];
        this.runner =
            s.lesson === null
                ? null
                : createLessonRunner(s.lesson, {
                      locale: s.locale,
                      floorY: s.floorY,
                      sessionStartMs: Date.parse(s.manifest.clock.startIso),
                      // as the host made it: the pilot's path (the next lesson a pass names) and speech rate (how long a line may take)
                      ...(s.manifest.lesson === null ? {} : { path: s.manifest.lesson.path }),
                      speechRate: s.prefs.speechRate,
                      ...(s.objects === undefined ? {} : { objects: s.objects }),
                      ...(s.start === undefined ? {} : { start: s.start }),
                      ...(this.input.progress === undefined ? {} : { progress: this.input.progress }),
                      ...(this.input.seed === undefined ? {} : { seed: this.input.seed })
                  });
        this.planner = new CuePlanner({ theme: s.theme, prefs: s.prefs, ...(s.lesson === null ? {} : { layers: s.lesson.layers }) });
    }

    get frameCount(): number {
        return this.frames.length;
    }

    /** Frames replayed so far. */
    get position(): number {
        return this.indexValue;
    }

    get done(): boolean {
        return this.indexValue >= this.frames.length;
    }

    get notes(): readonly ReplayNote[] {
        return this.notesList;
    }

    /** The lesson runner (null without a lesson): its phase and progress are live state for a viewer. */
    get lessonRunner(): LessonSession | null {
        return this.runner;
    }

    get cuePlanner(): CuePlanner {
        return this.planner;
    }

    private take(t: number, events: SessionEvent[], actions: RunnerAction[]): void {
        const runner = this.runner;
        if (runner === null) return;
        for (const a of runner.takeActions()) {
            actions.push(a);
            if (a.kind === 'say') {
                const e: SessionEvent = { t, kind: 'speech', key: a.line.key, text: this.translator.text(a.line) };
                this.derived.push(e);
                events.push(e);
            } else if (a.kind === 'cue') this.planner.cue(a.event);
        }
    }

    private add(list: readonly SessionEvent[], events: SessionEvent[]): void {
        for (const e of list) {
            this.derived.push(e);
            events.push(e);
        }
    }

    private apply(i: Input, events: SessionEvent[], actions: RunnerAction[]): void {
        const runner = this.runner;
        if (runner === null) return;
        switch (i.kind) {
            case 'begin':
                this.add(runner.begin(i.t), events);
                break;
            case 'spoken':
                this.add(runner.spoken(i.t), events);
                break;
            case 'answer':
                this.add(runner.answer(i.value, i.via, i.t), events);
                break;
            case 'reset':
                this.add(runner.reset(i.to, i.t).events, events);
                break;
            case 'next':
                this.add(runner.next(i.t), events);
                break;
            case 'previous':
                this.add(runner.previous(i.t), events);
                break;
            case 'repeat':
                this.add(runner.repeat(i.t), events);
                break;
            case 'next-lesson':
                this.add(runner.nextLesson(i.t), events);
                break;
            case 'previous-lesson':
                this.add(runner.previousLesson(i.t), events);
                break;
            case 'pause':
                this.add(runner.pause(i.t), events);
                break;
            case 'resume':
                this.add(runner.resume(i.t), events);
                break;
        }
        this.take(i.t, events, actions);
    }

    /** Replays the next frame; null at the end. */
    step(): ReplayStep | null {
        if (this.done) return null;
        const index = this.indexValue;
        const frame = this.frames[index] as FlightFrame;
        const t = frame.t;
        const events: SessionEvent[] = [];
        const actions: RunnerAction[] = [];
        while (this.inputPos < this.inputs.length && (this.inputs[this.inputPos] as Input).t <= t) this.apply(this.inputs[this.inputPos++] as Input, events, actions);
        let touched = false;
        while (this.touchPos < this.touches.length && (this.touches[this.touchPos] as number) <= t) {
            touched = true;
            this.touchPos++;
        }
        const sample = frameToSample(frame, this.prev, { touched });
        const s = this.input.setup;
        const runner = this.runner;
        if (runner !== null) {
            this.add(runner.step(sample, s.world), events);
            this.take(t, events, actions);
        }
        const input: SonicFrameInput = (runner === null ? null : runner.demoFrame(t)) ?? { sample, world: s.world, target: runner === null ? null : runner.target(), floorY: s.floorY };
        const plan = this.planner.plan(input);
        const cues = plan.cues.map((c) => c.id);
        this.cueLog.push(cues);
        this.prev = frame;
        this.indexValue = index + 1;
        return { index, frame, sample, input, events, actions, cues };
    }

    /** Replays up to and including frame `index` (from the start when `index` lies behind the position). */
    seek(index: number): ReplayStep | null {
        const target = Math.min(Math.max(Math.trunc(index), 0), this.frames.length - 1);
        if (target < this.indexValue - 1) this.reset();
        let last: ReplayStep | null = null;
        while (this.indexValue <= target) last = this.step();
        return last;
    }

    runToEnd(): void {
        while (this.step() !== null) {
            // each step is kept in the logs
        }
    }

    result(): ReplayResult {
        return { derivedEvents: this.derived, cues: this.cueLog, notes: this.notesList, progress: this.runner === null ? null : this.runner.progress() };
    }
}

/** Replays every frame and returns what was derived. */
export function replayFlight(input: ReplayInput): ReplayResult {
    const r = new Replayer(input);
    r.runToEnd();
    return r.result();
}
