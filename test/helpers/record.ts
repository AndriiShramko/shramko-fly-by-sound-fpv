// A test double of the simulator's host loop (see src/lesson/runner.ts, "The host loop"): it flies a
// scripted craft, runs the lesson runner and the cue planner at 60 Hz, speaks every line through a
// simulated speech queue, and records what the simulator's recorder would write: 30 Hz frames with the
// cue ids, and the events. The replay and report tests replay and report what this wrote.
import type { FlightFrame, LessonDef, Locale, SessionEvent, SonicPrefs, SonicWorld, ThemeDef, Vec3 } from '../../src/contract';
import { CuePlanner } from '../../src/cues';
import { createTranslator, DICTS, type Translator } from '../../src/i18n';
import { createLessonRunner, type LessonSession, type Question, type RunnerAction } from '../../src/lesson';
import { defaultPrefs } from '../../src/prefs';
import { REPLAY_KEY_ACTIONS, SPEECH_END_KEY } from '../../src/replay';
import { MemorySink, packSession, readPackage, SessionWriter, type SessionPackage } from '../../src/session';
import { getBuiltinTheme } from '../../src/theme';
import { yawQuat } from '../../src/util/vec';
import { createAnalyticWorld } from '../../src/world';
import { CONSENT, CONSENT_VOICE, DEVICE } from './session-input';

export interface HostOptions {
    readonly hz?: number;
    readonly recordHz?: number;
    readonly locale?: Locale;
    /**
     * 'markers': the host calls runner.spoken(t) when its speech queue empties and records a speech.end
     * event; 'estimate': it never does and the runner's own estimate of speech time rules.
     */
    readonly speechEnds?: 'markers' | 'estimate';
    /** simulated speech: a base time and a time per character, ms (the runner estimates 700 + 65 per character) */
    readonly ttsBaseMs?: number;
    readonly ttsMsPerChar?: number;
    readonly theme?: ThemeDef;
    readonly prefs?: SonicPrefs;
    /** the answer a pilot gives to a question, 1..n or 0 to skip */
    readonly answerer?: (q: Question, index: number) => number;
    readonly beginAtMs?: number;
}

const DEG = 180 / Math.PI;

export class RecordingHost {
    readonly lesson: LessonDef;
    readonly runner: LessonSession;
    readonly planner: CuePlanner;
    readonly world: SonicWorld | null;
    readonly translator: Translator;
    readonly frames: FlightFrame[] = [];
    readonly events: SessionEvent[] = [];
    readonly theme: ThemeDef;
    readonly prefs: SonicPrefs;
    readonly locale: Locale;
    t = 0;
    pos: Vec3;
    vel: Vec3 = [0, 0, 0];
    yaw: number;
    /** how many times the runner has placed the craft */
    placed = 0;
    private tickNo = 0;
    private touchFlag = false;
    private ttsEnd = -1;
    private speaking = false;
    private pending: { readonly at: number; readonly question: Question } | null = null;
    private asked = 0;
    private lastScene = false;
    private readonly o: Required<Pick<HostOptions, 'hz' | 'recordHz' | 'speechEnds' | 'ttsBaseMs' | 'ttsMsPerChar'>> & HostOptions;

    constructor(lesson: LessonDef, options: HostOptions = {}) {
        this.o = { hz: 60, recordHz: 30, speechEnds: 'markers', ttsBaseMs: 300, ttsMsPerChar: 45, ...options };
        this.lesson = lesson;
        this.locale = options.locale ?? 'en';
        this.theme = options.theme ?? getBuiltinTheme('soft');
        this.prefs = options.prefs ?? defaultPrefs();
        this.translator = createTranslator(this.locale, DICTS);
        this.world = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
        this.runner = createLessonRunner(lesson, { locale: this.locale, sessionStartMs: Date.parse('2026-11-07T10:00:00Z') });
        this.planner = new CuePlanner({ theme: this.theme, prefs: this.prefs, layers: lesson.layers });
        this.pos = lesson.start.pos;
        this.yaw = lesson.start.yawDeg;
        this.events.push({ t: 0, kind: 'session', what: 'start' });
    }

    private get stepMs(): number {
        return 1000 / this.o.hz;
    }

    private record(list: readonly SessionEvent[]): void {
        this.events.push(...list);
    }

    private handle(actions: readonly RunnerAction[]): void {
        for (const a of actions) {
            if (a.kind === 'say') {
                const text = this.translator.text(a.line);
                this.events.push({ t: this.t, kind: 'speech', key: a.line.key, text });
                const start = Math.max(this.t, this.ttsEnd);
                this.ttsEnd = start + this.o.ttsBaseMs + this.o.ttsMsPerChar * text.length;
                this.speaking = true;
            } else if (a.kind === 'cue') this.planner.cue(a.event);
            else if (a.kind === 'place') {
                this.pos = a.pose.pos;
                this.yaw = a.pose.yawDeg;
                this.vel = [0, 0, 0];
                this.placed++;
            } else if (a.kind === 'ask') this.pending = { at: Math.max(this.t, this.ttsEnd) + 1200, question: a.question };
            else if (a.kind === 'scene') this.lastScene = a.scene !== null;
        }
    }

    private drain(): void {
        for (let guard = 0; guard < 50; guard++) {
            const a = this.runner.takeActions();
            if (a.length === 0) return;
            this.handle(a);
        }
    }

    begin(): void {
        this.t = this.o.beginAtMs ?? 500;
        this.record(this.runner.begin(this.t));
        this.drain();
    }

    /** One step of the 60 Hz loop. */
    tick(): void {
        this.t += this.stepMs;
        this.tickNo++;
        // the speech queue ran empty
        if (this.speaking && this.t >= this.ttsEnd) {
            this.speaking = false;
            if (this.o.speechEnds === 'markers') {
                this.events.push({ t: this.t, kind: 'speech', key: SPEECH_END_KEY, text: '' });
                this.record(this.runner.spoken(this.t));
                this.drain();
            }
        }
        // the pilot answers a question
        if (this.pending !== null && this.t >= this.pending.at) {
            const q = this.pending.question;
            this.pending = null;
            const value = this.o.answerer === undefined ? 0 : this.o.answerer(q, this.asked++);
            this.record(this.runner.answer(value, 'key', this.t));
            this.drain();
        }
        const sample = { t: this.t, tick: Math.round(this.t), pos: this.pos, vel: this.vel, quat: yawQuat(this.yaw), rate: [0, 0, 0] as const, yawDeg: this.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0] as const, armed: true, touched: this.touchFlag, paused: false };
        this.touchFlag = false;
        this.record(this.runner.step(sample, this.world));
        this.drain();
        const input = this.runner.demoFrame(this.t) ?? { sample, world: this.world, target: this.runner.target(), floorY: 0 };
        const plan = this.planner.plan(input);
        if (this.tickNo % Math.round(this.o.hz / this.o.recordHz) === 0) {
            this.frames.push({ t: this.t, tick: Math.round(this.t), p: this.pos, v: this.vel, q: yawQuat(this.yaw), s: [0, 0, 0, 0], c: plan.cues.map((c) => c.id) });
        }
    }

    /** A contact is seen in the next sample. */
    touch(): void {
        this.touchFlag = true;
    }

    /** A key of the pilot: the host calls the runner and records the key event. */
    press(action: (typeof REPLAY_KEY_ACTIONS)[keyof typeof REPLAY_KEY_ACTIONS]): void {
        const codes: Record<string, string> = { next: 'KeyN', previous: 'KeyB', repeat: 'KeyZ', 'next-lesson': 'Escape', 'previous-lesson': 'Escape' };
        this.events.push({ t: this.t, kind: 'key', code: codes[action] ?? 'KeyR', action });
        if (action === REPLAY_KEY_ACTIONS.next) this.record(this.runner.next(this.t));
        else if (action === REPLAY_KEY_ACTIONS.previous) this.record(this.runner.previous(this.t));
        else if (action === REPLAY_KEY_ACTIONS.repeat) this.record(this.runner.repeat(this.t));
        else if (action === REPLAY_KEY_ACTIONS.nextLesson) this.record(this.runner.nextLesson(this.t));
        else if (action === REPLAY_KEY_ACTIONS.previousLesson) this.record(this.runner.previousLesson(this.t));
        else {
            const r = this.runner.reset(action === REPLAY_KEY_ACTIONS.resetStart ? 'start' : 'checkpoint', this.t);
            this.pos = r.pose.pos;
            this.yaw = r.pose.yawDeg;
            this.vel = [0, 0, 0];
            this.record(r.events);
        }
        this.drain();
    }

    hold(seconds: number): void {
        this.vel = [0, 0, 0];
        const n = Math.round((seconds * this.o.hz));
        for (let i = 0; i < n; i++) this.tick();
    }

    until(cond: () => boolean, maxSeconds = 600): void {
        const n = Math.round(maxSeconds * this.o.hz);
        for (let i = 0; i < n && !cond(); i++) this.tick();
    }

    /** Flies straight to `to` at `speed` m/s, nose toward it; stops when the runner moves the craft. */
    flyTo(to: Vec3, speed = 4): void {
        const placed = this.placed;
        const step = (speed * this.stepMs) / 1000;
        for (let guard = 0; guard < 1_000_000 && this.placed === placed; guard++) {
            const d: Vec3 = [to[0] - this.pos[0], to[1] - this.pos[1], to[2] - this.pos[2]];
            const len = Math.hypot(...d);
            if (Math.hypot(d[0], d[2]) > 0.5) this.yaw = Math.atan2(d[0], -d[2]) * DEG;
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

    get scene(): boolean {
        return this.lastScene;
    }

    /** The recorded session as a package: written through a SessionWriter into memory and zipped. */
    async toPackage(options: { readonly chunkFrames?: number; readonly voice?: { readonly offsetMs: number; readonly slices: readonly Uint8Array[] } } = {}): Promise<{ readonly bytes: Uint8Array; readonly pkg: SessionPackage }> {
        const sink = new MemorySink();
        const world = this.world;
        const last = this.frames.at(-1)?.t ?? this.t;
        const writer = await SessionWriter.start({
            sink,
            manifest: {
                id: 'recordedSession00001',
                created: '2026-11-07T10:00:00Z',
                app: { name: 'vitest-host', release: 'test', sonic: 'test' },
                scene: world === null ? { kind: 'none', id: 'none', version: 1, transform: [1, 0, 0, 0] } : { kind: 'analytic', id: world.id, version: world.version, transform: [1, 0, 0, 0] },
                lesson: { id: this.lesson.id, version: this.lesson.version, path: 'full' },
                theme: { id: this.theme.id, version: this.theme.version },
                settings: this.prefs,
                assists: this.lesson.assists,
                device: { ...DEVICE, locale: this.locale },
                consent: options.voice === undefined ? CONSENT : CONSENT_VOICE,
                pilot: { id: 'testPilot01', nickname: null },
                clock: { startIso: '2026-11-07T10:00:00Z', frameHz: this.o.recordHz }
            },
            ...(options.chunkFrames === undefined ? {} : { chunkFrames: options.chunkFrames })
        });
        const events = [...this.events, { t: last, kind: 'session', what: 'end' } as SessionEvent];
        if (options.voice !== undefined) {
            writer.setVoiceOffset(options.voice.offsetMs);
            for (const slice of options.voice.slices) writer.voice(slice);
        }
        for (const f of this.frames) writer.frame(f);
        for (const e of events) writer.event(e);
        await writer.finish({ ended: new Date(Date.parse('2026-11-07T10:00:00Z') + last + 1000).toISOString() });
        const parts = await packSession(sink);
        const bytes = new Uint8Array(Buffer.concat(parts));
        return { bytes, pkg: readPackage(bytes) };
    }
}
