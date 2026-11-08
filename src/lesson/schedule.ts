// Internal (review R15): the package's own checks import this file by path; it is not exported from src/lesson.
// What a lesson sounds like in time, worked out without a browser: a model host runs the lesson runner
// the way the simulator does (one speech queue that says lines one after the other, `spoken(t)` when it
// runs empty, cues and module-0 scenes played when the runner hands them out, questions answered by a
// scripted pilot) and writes down when each line was said and when each sound played. The check
// (checkSchedule) then asks what a pilot would ask: did every sound play with no speech over it, did
// every question come after its sound, was every named sound played three times.
//
// How long a line takes is a speech model: the runner's own estimate, a slower or faster voice, or the
// measured lengths of a real voice (test/fixtures/tts-en-david.json). The engine ducks every layer by
// the theme's duckDb (12 dB) while any line is queued or spoken (src/cues/planner.ts duckDb), so a sound
// that overlaps speech is a sound the pilot does not hear: that is what the check calls 'under-speech'.
// What the schedule cannot show: how loud the sound is in the room, whether a person notices it, how it
// feels. The render proofs of lane s13-sound measure the audio itself.
import type { CueEvent, CueId, FlightSample, LessonDef, Locale, SessionEvent, SpeechLine, Vec3 } from '../contract';
import { DICTS } from '../i18n/dicts';
import { createTranslator } from '../i18n/translator';
import { yawQuat } from '../util/vec';
import { createLessonRunner, type DemoScene, type LessonSession, type Question, type RunnerAction, type RunnerOptions } from './runner';
import { sceneSilentReason } from './sounds';

/** How long a line takes to say, s. */
export type SpeechModel = (text: string, line: SpeechLine) => number;

/** The runner's own estimate (0.7 s and 65 ms per character), times `factor`, plus `latencyS` before each line starts. */
export function estimateSpeech(factor = 1, latencyS = 0): SpeechModel {
    return (text) => latencyS + factor * (0.7 + 0.065 * text.length);
}

/** A voice measured line by line (seconds by locale key); lines not in the table fall back to `rest`. */
export function measuredSpeech(seconds: Readonly<Record<string, number>>, rest: SpeechModel = estimateSpeech(1.06)): SpeechModel {
    return (text, line) => (line.params === undefined && seconds[line.key] !== undefined ? (seconds[line.key] as number) : rest(text, line));
}

/** How long a one-off cue (a chime, a ping) sounds, s: what the schedule takes for it. */
export const ONE_OFF_S = 1;
/** How long a v0.12 'preview' cue sounds, s (src/cues/planner.ts PREVIEW_S). */
export const PREVIEW_PLAY_S = 3;

export interface ScheduleOptions {
    readonly locale?: Locale;
    /** default: the runner's own estimate */
    readonly speech?: SpeechModel;
    /** silence between two lines of the queue, s (speechSynthesis starts the next utterance about this late) */
    readonly gapS?: number;
    /** the pilot's answer to a question: 1..options, or 0 to skip; default: 1 */
    readonly answer?: (q: Question, scene: DemoScene | null) => number;
    /** 'after': the pilot answers `answerDelayS` after the question has been read out; 'early': that long after it began */
    readonly answerTiming?: 'after' | 'early';
    readonly answerDelayS?: number;
    /** never answer: every question times out */
    readonly silentPilot?: boolean;
    /** the model host stops after this long, s */
    readonly untilS?: number;
    /** frames per second of the model host */
    readonly hz?: number;
    /** a flying lesson: stop when its first attempt begins (its task is what the schedule is about) */
    readonly stopAtFlying?: boolean;
    readonly runner?: RunnerOptions;
}

export interface SpokenLine {
    readonly key: string;
    readonly text: string;
    /** ms on the session clock */
    readonly start: number;
    readonly end: number;
    /** cut by a line that interrupted it */
    readonly cut: boolean;
}

export interface Play {
    readonly kind: 'preview' | 'repeat-cue' | 'scene' | 'one-off';
    readonly cue: CueId;
    readonly start: number;
    readonly end: number;
    /** 1-based play of a repeated sound, and how many plays it has; null for a single play */
    readonly index: number | null;
    readonly of: number | null;
    /** the lesson's step (view().step) and attempt when it began */
    readonly step: number;
    readonly attempt: number;
}

export interface Asked {
    readonly id: string;
    readonly options: number;
    /** when the question was put (its lines handed to the speech queue) */
    readonly at: number;
    /** when its first line began and its last line ended, or null when they were never said */
    readonly linesStart: number | null;
    readonly linesEnd: number | null;
    readonly answeredAt: number | null;
    readonly step: number;
    readonly attempt: number;
}

export interface Schedule {
    readonly lessonId: string;
    readonly speech: readonly SpokenLine[];
    readonly plays: readonly Play[];
    readonly asks: readonly Asked[];
    readonly events: readonly SessionEvent[];
    /** ms on the session clock when the model host stopped */
    readonly endT: number;
    /** the runner's phase at the end */
    readonly phase: string;
}

interface Queued {
    readonly key: string;
    readonly text: string;
    readonly durMs: number;
    readonly ask: number | null;
}

interface Current extends Queued {
    readonly start: number;
    readonly end: number;
}

interface OpenAsk {
    id: string;
    options: number;
    at: number;
    linesStart: number | null;
    linesEnd: number | null;
    answeredAt: number | null;
    step: number;
    attempt: number;
    question: Question;
    lines: number;
    said: number;
}

function cueOf(e: CueEvent): CueId {
    switch (e.kind) {
        case 'preview':
            return e.cue;
        case 'touch':
            return 'safety.touch';
        case 'reset':
            return 'safety.reset';
        case 'gate':
            return 'target.note';
        case 'lap':
            return 'target.lap';
        case 'checkpoint':
            return 'target.checkpoint';
        case 'fanfare':
            return 'target.fanfare';
        default: {
            const x = e as { readonly kind: string; readonly cue?: CueId };
            return x.cue ?? x.kind;
        }
    }
}

/** Runs `lesson` with a model host and returns when each line was said and each sound played. */
export function lessonSchedule(lesson: LessonDef, options: ScheduleOptions = {}): Schedule {
    const locale = options.locale ?? 'en';
    const tr = createTranslator(locale, DICTS);
    const speech = options.speech ?? estimateSpeech();
    const gapMs = (options.gapS ?? 0.1) * 1000;
    const stepMs = 1000 / (options.hz ?? 50);
    const untilMs = (options.untilS ?? 1800) * 1000;
    const stopAtFlying = options.stopAtFlying ?? true;
    const run: LessonSession = createLessonRunner(lesson, { locale, ...options.runner });
    const spoken: SpokenLine[] = [];
    const plays: Play[] = [];
    const asks: OpenAsk[] = [];
    const events: SessionEvent[] = [];
    const queue: Queued[] = [];
    let current: Current | null = null;
    let lastEnd = -Infinity;
    let t = 0;
    let pos: Vec3 = lesson.start.pos;
    let yaw = lesson.start.yawDeg;
    let scene: { readonly scene: DemoScene; readonly start: number; readonly index: number | null; readonly of: number | null; readonly step: number; readonly attempt: number } | null = null;
    let lastScene: DemoScene | null = null;
    // the question waiting for the pilot (set by handle(), a closure, so kept in a box for the type checker)
    const box: { ask: OpenAsk | null } = { ask: null };

    const closeScene = (at: number): void => {
        if (scene === null) return;
        plays.push({ kind: 'scene', cue: scene.scene.cue, start: scene.start, end: at, index: scene.index, of: scene.of, step: scene.step, attempt: scene.attempt });
        scene = null;
    };

    const answered = new Set<string>();
    const record = (list: readonly SessionEvent[]): void => {
        for (const e of list) {
            events.push(e);
            if (e.kind === 'answer') answered.add(e.item);
        }
    };

    const handle = (actions: readonly RunnerAction[]): void => {
        let lastAsk: OpenAsk | null = null;
        for (const a of actions) {
            switch (a.kind) {
                case 'say': {
                    if (a.interrupt) {
                        if (current !== null) {
                            spoken.push({ key: current.key, text: current.text, start: current.start, end: t, cut: true });
                            lastEnd = t;
                            current = null;
                        }
                        queue.length = 0;
                    }
                    const text = tr.text(a.line);
                    queue.push({ key: a.line.key, text, durMs: speech(text, a.line) * 1000, ask: null });
                    break;
                }
                case 'ask': {
                    // the question's lines are the say actions handed just before it in this batch
                    const n = a.question.lines.length;
                    for (let k = Math.max(0, queue.length - n); k < queue.length; k++) queue[k] = { ...(queue[k] as Queued), ask: asks.length };
                    const open: OpenAsk = { id: a.question.id, options: a.question.options, at: t, linesStart: null, linesEnd: null, answeredAt: null, step: run.view().step, attempt: run.attempt, question: a.question, lines: n, said: 0 };
                    asks.push(open);
                    lastAsk = open;
                    break;
                }
                case 'cue': {
                    const e = a.event;
                    const kind: Play['kind'] = e.kind === 'preview' ? 'preview' : (e.kind as string) === 'repeat-cue' ? 'repeat-cue' : 'one-off';
                    const x = e as { readonly durS?: number; readonly index?: number; readonly of?: number };
                    const durMs = kind === 'preview' ? PREVIEW_PLAY_S * 1000 : kind === 'repeat-cue' ? (x.durS ?? PREVIEW_PLAY_S) * 1000 : ONE_OFF_S * 1000;
                    plays.push({ kind, cue: cueOf(e), start: t, end: t + durMs, index: x.index ?? null, of: x.of ?? null, step: run.view().step, attempt: run.attempt });
                    break;
                }
                case 'scene': {
                    closeScene(t);
                    if (a.scene !== null) {
                        const p = (a as { readonly play?: { readonly index: number; readonly of: number } }).play;
                        scene = { scene: a.scene, start: t, index: p?.index ?? null, of: p?.of ?? null, step: run.view().step, attempt: run.attempt };
                        lastScene = a.scene;
                    }
                    break;
                }
                case 'place':
                    pos = a.pose.pos;
                    yaw = a.pose.yawDeg;
                    break;
                default:
                    break;
            }
        }
        if (lastAsk !== null) box.ask = lastAsk;
    };

    const drain = (): void => {
        for (let guard = 0; guard < 64; guard++) {
            const a = run.takeActions();
            if (a.length === 0) return;
            handle(a);
        }
    };

    record(run.begin(0));
    drain();
    for (t = 0; t <= untilMs; t += stepMs) {
        // the speech queue: the line being said ends, the next one starts after the gap
        if (current !== null && t >= current.end) {
            spoken.push({ key: current.key, text: current.text, start: current.start, end: current.end, cut: false });
            const done: Current = current;
            lastEnd = current.end;
            current = null;
            if (done.ask !== null) {
                const q = asks[done.ask] as OpenAsk;
                q.said++;
                if (q.said >= q.lines) q.linesEnd = done.end;
            }
            if (queue.length === 0) {
                record(run.spoken(t));
                drain();
            }
        }
        if (current === null && queue.length > 0) {
            const next = queue.shift() as Queued;
            const start = Math.max(t, lastEnd + gapMs);
            current = { ...next, start, end: start + next.durMs };
            if (next.ask !== null) {
                const q = asks[next.ask] as OpenAsk;
                q.linesStart ??= start;
            }
        }
        // the pilot answers
        const q = box.ask;
        // a question the runner closed itself (a timeout, N) is not answered any more
        if (q !== null && answered.has(q.id)) box.ask = null;
        else if (q !== null && !options.silentPilot) {
            const delay = (options.answerDelayS ?? 1) * 1000;
            const due = options.answerTiming === 'early' ? (q.linesStart === null ? null : q.linesStart + delay) : q.linesEnd === null ? null : q.linesEnd + delay;
            if (due !== null && t >= due) {
                box.ask = null;
                q.answeredAt = t;
                const value = options.answer === undefined ? 1 : options.answer(q.question, lastScene);
                record(run.answer(value, 'key', t));
                drain();
            }
        }
        const sample: FlightSample = { t, tick: Math.round(t), pos, vel: [0, 0, 0], quat: yawQuat(yaw), rate: [0, 0, 0], yawDeg: yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };
        record(run.step(sample, null));
        drain();
        if (run.phase === 'passed' && current === null && queue.length === 0) break;
        if (stopAtFlying && lesson.world.kind !== 'none' && run.phase === 'flying') break;
    }
    closeScene(t);
    if (current !== null) {
        const c: Current = current;
        spoken.push({ key: c.key, text: c.text, start: c.start, end: Math.min(c.end, t), cut: c.end > t });
    }
    return {
        lessonId: lesson.id,
        speech: spoken,
        plays,
        asks: asks.map((a) => ({ id: a.id, options: a.options, at: a.at, linesStart: a.linesStart, linesEnd: a.linesEnd, answeredAt: a.answeredAt, step: a.step, attempt: a.attempt })),
        events,
        endT: t,
        phase: run.phase
    };
}

/** How much of [start, end) is covered by speech, ms. */
export function speechOverlapMs(s: Pick<Schedule, 'speech'>, start: number, end: number): number {
    let ms = 0;
    for (const l of s.speech) ms += Math.max(0, Math.min(end, l.end) - Math.max(start, l.start));
    return ms;
}

/** What a pilot would notice in a schedule (M41-5, M41-9). */
export interface ScheduleIssue {
    readonly rule: 'under-speech' | 'question-without-sound' | 'not-repeated' | 'layer-off';
    readonly at: number;
    readonly detail: string;
}

/** How much speech may overlap a sound before it counts as under it, ms (one frame of a host and the gap of a voice). */
export const OVERLAP_SLACK_MS = 50;
/**
 * How many times a named sound must play in its step: the owner's "once, a second time, a third time" (M41-5). Pinned
 * here, not taken from the runner's REPEAT_PLAYS, so a runner that plays fewer fails the check (review R10).
 */
export const NAMED_SOUND_PLAYS = 3;

/**
 * The checks of a lesson's schedule: no sound plays under speech; every question has an audible sound of its
 * step before its lines begin; every named sound of a step plays NAMED_SOUND_PLAYS times; every scene can be heard
 * with the lesson's layers. One-off notes (a chime, the fanfare of a pass) are not checked: they come with
 * the lesson's own events, not with a step.
 */
export function checkSchedule(s: Schedule, lesson: LessonDef): ScheduleIssue[] {
    const issues: ScheduleIssue[] = [];
    const sounds = s.plays.filter((p) => p.kind !== 'one-off');
    const audible = (p: Play): boolean => speechOverlapMs(s, p.start, p.end) <= OVERLAP_SLACK_MS;
    for (const p of sounds) {
        const ms = speechOverlapMs(s, p.start, p.end);
        if (ms > OVERLAP_SLACK_MS) issues.push({ rule: 'under-speech', at: p.start, detail: `${p.kind} ${p.cue} at ${(p.start / 1000).toFixed(2)} s: ${(ms / 1000).toFixed(2)} s of its ${((p.end - p.start) / 1000).toFixed(2)} s under speech` });
        if (p.kind === 'scene') {
            const why = sceneSilentReason(p.cue, lesson.layers);
            if (why !== null) issues.push({ rule: 'layer-off', at: p.start, detail: why });
        }
    }
    for (const q of s.asks) {
        const before = sounds.filter((p) => p.step === q.step && p.attempt === q.attempt && p.end <= (q.linesStart ?? q.at) + OVERLAP_SLACK_MS && audible(p));
        if (before.length === 0) issues.push({ rule: 'question-without-sound', at: q.at, detail: `question ${q.id} at ${(q.at / 1000).toFixed(2)} s has no sound of its step heard before it` });
    }
    // a named sound plays NAMED_SOUND_PLAYS times in its step (a scene the game replays after a wrong answer is an extra play)
    const groups = new Map<string, Play[]>();
    for (const p of sounds) {
        const k = `${p.attempt}:${p.step}:${p.cue}`;
        groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    for (const [k, list] of groups) {
        if (list.length < NAMED_SOUND_PLAYS) issues.push({ rule: 'not-repeated', at: (list[0] as Play).start, detail: `${k.split(':')[2]} in step ${k.split(':')[1]} plays ${list.length} time${list.length === 1 ? '' : 's'}, not ${NAMED_SOUND_PLAYS}` });
    }
    return issues.sort((a, b) => a.at - b.at);
}
