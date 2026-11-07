// The report tool (spec section 7, plan step 11): a session package in, a timeline and metrics out, as
// JSON and as Markdown, that a person or an agent can read. Optionally joined with a transcript of
// what the pilot said (`--transcript`), which is made elsewhere (this tool never touches the
// network): the segments are put on the session's clock by the manifest's voice offset and woven
// into the timeline between the events.
//
// What it reports: whether the lesson was passed, the time, the attempts, the touches, the time of
// every gate and of every leg, how far the flown path strayed from the polyline through the gates,
// the pilot's answers, and the replay check (the replay core re-derives the events from the frames
// and says whether the recording holds together).
//
// Run it with `pnpm report -- <package.zip> [options]` (tools/run-tool.mjs loads this file through
// Vite, because plain Node cannot read the extensionless imports of src/). `main` is the whole
// command line and takes its file system as an argument, so tests run it in-process.
//
//   report <package.zip> [--transcript <file>] [--track <file>] [--json <file>] [--md <file>]
//                        [--format md|json] [--no-replay] [--lenient]
import { readFile, writeFile } from 'node:fs/promises';
import type { FlightFrame, SessionEvent, SonicObject, SonicWorld, Vec3 } from '../src/contract';
import { DICTS, createTranslator } from '../src/i18n';
import { courseGates } from '../src/lesson';
import { checkSession, formatReplayCheck, rebuildSession, ReplayError, SPEECH_END_KEY, type ReplaySetup, type Tolerances } from '../src/replay';
import { PackageError, readPackage, ZipError, type SessionPackage } from '../src/session';
import { parseTrack, trackToObjects } from '../src/track';
import { formatIssues, utf8Decode } from '../src/util';

export const REPORT_FORMAT = 'shramko-sonic-report/1';

/** A transcribed stretch of speech; times are on the voice recording's clock (0 = the start of voice.webm), ms. */
export interface TranscriptSegment {
    readonly startMs: number;
    readonly endMs: number;
    readonly text: string;
}

/** A file the command line was given that cannot be used (a transcript, a track). */
export class ReportInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReportInputError';
    }
}

export class TranscriptError extends ReportInputError {
    constructor(message: string) {
        super(message);
        this.name = 'TranscriptError';
    }
}

// ------------------------------------------------------------------ transcripts

const stamp = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;

function parseStamp(text: string): number | null {
    const m = stamp.exec(text.trim());
    if (m === null) return null;
    const ms = Number((m[4] as string).padEnd(3, '0'));
    return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + ms;
}

function fromJson(data: unknown): TranscriptSegment[] {
    const list = Array.isArray(data) ? data : data !== null && typeof data === 'object' && Array.isArray((data as { segments?: unknown }).segments) ? (data as { segments: unknown[] }).segments : null;
    if (list === null) throw new TranscriptError('a JSON transcript must be a list of segments, or an object with a "segments" list');
    return list.map((raw, i) => {
        if (raw === null || typeof raw !== 'object') throw new TranscriptError(`segment ${i + 1} is not an object`);
        const r = raw as Record<string, unknown>;
        const text = r['text'];
        // Whisper and most tools: start and end in seconds. Ours: startMs and endMs.
        const startMs = typeof r['startMs'] === 'number' ? r['startMs'] : typeof r['start'] === 'number' ? r['start'] * 1000 : null;
        const endMs = typeof r['endMs'] === 'number' ? r['endMs'] : typeof r['end'] === 'number' ? r['end'] * 1000 : startMs;
        if (typeof text !== 'string' || startMs === null || endMs === null || !Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new TranscriptError(`segment ${i + 1} needs a text and a start time (start and end in seconds, or startMs and endMs)`);
        return { startMs: Math.round(startMs), endMs: Math.round(endMs), text: text.trim() };
    });
}

function fromSubtitles(text: string): TranscriptSegment[] {
    const out: TranscriptSegment[] = [];
    const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        const at = lines.findIndex((l) => l.includes('-->'));
        if (at < 0) continue;
        const [from, to] = (lines[at] as string).split('-->');
        const startMs = parseStamp((from as string).trim());
        const endMs = parseStamp((to as string).trim().split(/\s+/)[0] as string);
        if (startMs === null || endMs === null) throw new TranscriptError(`cannot read the time range '${lines[at] as string}'`);
        out.push({ startMs, endMs, text: lines.slice(at + 1).join(' ').trim() });
    }
    return out;
}

/** Segments of a transcript file: JSON (Whisper-like), SRT or WebVTT. */
export function parseTranscript(text: string): TranscriptSegment[] {
    const body = text.replace(/^﻿/, '').trim();
    if (body === '') return [];
    let segments: TranscriptSegment[];
    if (body.startsWith('[') || body.startsWith('{')) {
        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch (e) {
            throw new TranscriptError(`not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        }
        segments = fromJson(data);
    } else segments = fromSubtitles(body);
    return segments.filter((s) => s.text !== '').sort((a, b) => a.startMs - b.startMs);
}

// ------------------------------------------------------------------ the report

export interface AttemptReport {
    readonly attempt: number;
    /** session clock, ms */
    readonly startMs: number;
    readonly endMs: number;
    readonly durationMs: number;
    readonly result: 'pass' | 'fail' | 'open';
    readonly touches: number;
    readonly gates: number;
    readonly resets: number;
    /** distance of the flown path from the gate polyline, m, or null without gates */
    readonly deviationM: { readonly mean: number; readonly p95: number; readonly max: number } | null;
}

export interface GateReport {
    readonly attempt: number;
    readonly gateId: string;
    readonly index: number;
    readonly tMs: number;
    /** since the attempt began (or was restarted by a reset to the start), ms */
    readonly sinceAttemptMs: number;
    /** since the previous gate of the attempt, ms */
    readonly legMs: number;
    readonly missM: number;
}

export interface TimelineEntry {
    readonly tMs: number;
    readonly kind: string;
    readonly text: string;
}

export interface Report {
    readonly format: typeof REPORT_FORMAT;
    readonly session: { readonly id: string; readonly created: string; readonly ended: string | null; readonly complete: boolean; readonly clockMs: number; readonly frames: number; readonly events: number; readonly path: 'full' | 'fast' | null };
    readonly lesson: { readonly id: string; readonly version: number; readonly title: string | null } | null;
    readonly scene: { readonly kind: string; readonly id: string };
    readonly theme: { readonly id: string; readonly version: number };
    readonly device: { readonly locale: string; readonly input: string; readonly headphones: string; readonly sampleRate: number; readonly outputLatencyMs: number | null };
    readonly consent: { readonly recording: boolean; readonly voice: boolean; readonly send: boolean; readonly minor: boolean; readonly guardianConfirmed: boolean | null };
    readonly outcome: { readonly status: 'passed' | 'not-passed' | 'incomplete' | 'no-lesson'; readonly success: boolean | null; readonly attempts: number; readonly passedAtMs: number | null };
    readonly metrics: {
        readonly flightMs: number;
        readonly pathLengthM: number;
        readonly meanSpeedMps: number;
        readonly maxSpeedMps: number;
        readonly touches: number;
        readonly resets: number;
        readonly gatesPassed: number;
        readonly gateMissMeanM: number | null;
        readonly deviationM: { readonly mean: number; readonly p95: number; readonly max: number } | null;
        readonly speechLines: number;
        readonly answers: { readonly given: number; readonly skipped: number };
    };
    readonly attempts: readonly AttemptReport[];
    readonly gates: readonly GateReport[];
    readonly survey: { readonly skipped: boolean; readonly answers: readonly { readonly item: string; readonly value: number | null; readonly via: string; readonly tMs: number }[] } | null;
    readonly replayCheck: { readonly skipped: string } | { readonly ok: boolean; readonly line: string; readonly exact: boolean; readonly differences: readonly string[] };
    readonly transcript: { readonly source: string; readonly segments: number; readonly offsetMs: number } | null;
    readonly warnings: readonly string[];
    readonly timeline: readonly TimelineEntry[];
}

export interface ReportOptions {
    readonly transcript?: readonly TranscriptSegment[];
    /** where the transcript came from (a file name), for the report */
    readonly transcriptName?: string;
    /** a scan lesson's gates in the flown world (trackToObjects of the track the course was laid on) */
    readonly objects?: readonly SonicObject[];
    /** a scan session's world; default none (the replay then runs without hazard cues) */
    readonly world?: SonicWorld | null;
    /** run the replay check (default true) */
    readonly replay?: boolean;
    readonly tolerances?: Partial<Tolerances>;
}

/** A jump between two frames longer than this is a reset, not flight (as in the lesson runner), m. */
const JUMP_M = 3;

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (x: number, digits: number): number => {
    const k = 10 ** digits;
    return Math.round(x * k) / k;
};

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
    const ab = sub3(b, a);
    const len2 = dot3(ab, ab);
    const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot3(sub3(p, a), ab) / len2));
    const q: Vec3 = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function distanceToPolyline(p: Vec3, line: readonly Vec3[]): number {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i] as Vec3, line[i + 1] as Vec3));
    return best;
}

function stats(values: readonly number[]): { mean: number; p95: number; max: number } | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return { mean: round(mean, 3), p95: round(sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] as number, 3), max: round(sorted[sorted.length - 1] as number, 3) };
}

function describeEvent(e: SessionEvent): string | null {
    switch (e.kind) {
        case 'session':
            return `session ${e.what}`;
        case 'lesson':
            return `lesson ${e.lessonId}: ${e.what}${e.attempt > 0 ? ` (attempt ${e.attempt})` : ''}`;
        case 'goal':
            return `goal ${e.index + 1} ${e.what}`;
        case 'touch':
            return `touch: ${e.material} at ${e.speed} m/s, (${e.pos.map((x) => round(x, 1)).join(', ')})`;
        case 'gate':
            return `gate ${e.gateId} (number ${e.index + 1}), missed the centre by ${round(e.missM, 2)} m`;
        case 'checkpoint':
            return `checkpoint ${e.id}`;
        case 'reset':
            return `reset to ${e.to}${e.checkpointId === null ? '' : ` ${e.checkpointId}`}`;
        case 'speech':
            return e.key === SPEECH_END_KEY ? null : `says: ${e.text}`;
        case 'key':
            return `key ${e.code}${e.action === null ? '' : ` (${e.action})`}`;
        case 'answer':
            return e.via === 'skip' || e.value === null ? `answer ${e.item}: skipped` : `answer ${e.item}: ${e.value} by ${e.via}`;
        case 'recording':
            return `recording ${e.what}`;
        case 'send':
            return `sending ${e.what}${e.channel === null ? '' : ` by ${e.channel}`}`;
    }
}

function course(setup: ReplaySetup | null, objects: readonly SonicObject[]): { readonly gates: SonicObject[]; readonly laps: number } | null {
    if (setup === null || setup.lesson === null) return null;
    for (const g of setup.lesson.goals) {
        if (g.kind === 'pass-gates') return { gates: courseGates(objects, g.gateIds), laps: 1 };
        if (g.kind === 'timed-course') return { gates: courseGates(objects, 'all'), laps: g.laps };
    }
    return null;
}

export function buildReport(pkg: SessionPackage, options: ReportOptions = {}): Report {
    const m = pkg.manifest;
    const warnings: string[] = [];
    for (const p of pkg.problems) warnings.push(`package: ${p.message}`);
    if (!m.complete) warnings.push('the session is unfinished (recovered after the app closed): the end of it is missing');

    // the lesson, its world and gates, best effort
    let setup: ReplaySetup | null = null;
    let setupError: string | null = null;
    const rebuild = (world: SonicWorld | null | undefined): ReplaySetup =>
        rebuildSession(m, { ...(world === undefined ? {} : { world }), ...(options.objects === undefined ? {} : { objects: options.objects }) });
    try {
        setup = rebuild(options.world);
    } catch (e) {
        if (!(e instanceof ReplayError)) throw e;
        if (e.code === 'scan-world-needed') {
            try {
                setup = rebuild(null);
            } catch (e2) {
                if (!(e2 instanceof ReplayError)) throw e2;
                setupError = e2.message;
            }
        } else setupError = e.message;
    }
    if (setupError !== null) warnings.push(`the session cannot be rebuilt here (${setupError}): no replay check and no path deviation`);
    const tr = createTranslator(m.device.locale, DICTS);
    const lessonTitle = setup?.lesson == null ? null : tr.text(setup.lesson.title);

    const events = pkg.events;
    const frames = pkg.frames;
    const lastFrameT = frames.length === 0 ? 0 : (frames[frames.length - 1] as FlightFrame).t;
    const lastEventT = events.reduce((mx, e) => Math.max(mx, e.t), 0);
    const clockMs = Math.max(lastFrameT, lastEventT);

    // attempts, gates, touches, resets
    const gateObjects = options.objects ?? setup?.world?.objects() ?? [];
    const plan = course(setup, gateObjects);
    interface Open {
        attempt: number;
        startMs: number;
        clockStart: number;
        endMs: number | null;
        result: 'pass' | 'fail' | 'open';
        touches: number;
        resets: number;
        gates: GateReport[];
        lastGateT: number | null;
    }
    const attemptsOpen: Open[] = [];
    let cur: Open | null = null;
    for (const e of events) {
        if (e.kind === 'lesson' && e.what === 'attempt-start') {
            cur = { attempt: e.attempt, startMs: e.t, clockStart: e.t, endMs: null, result: 'open', touches: 0, resets: 0, gates: [], lastGateT: null };
            attemptsOpen.push(cur);
        } else if (e.kind === 'lesson' && (e.what === 'attempt-pass' || e.what === 'attempt-fail') && cur !== null) {
            cur.endMs = e.t;
            cur.result = e.what === 'attempt-pass' ? 'pass' : 'fail';
            cur = null;
        } else if (cur !== null && e.kind === 'touch') cur.touches++;
        else if (cur !== null && e.kind === 'reset') {
            cur.resets++;
            if (e.to === 'start') {
                cur.clockStart = e.t;
                cur.lastGateT = null;
            }
        } else if (cur !== null && e.kind === 'gate') {
            cur.gates.push({ attempt: cur.attempt, gateId: e.gateId, index: e.index, tMs: e.t, sinceAttemptMs: e.t - cur.clockStart, legMs: e.t - (cur.lastGateT ?? cur.clockStart), missM: round(e.missM, 3) });
            cur.lastGateT = e.t;
        }
    }

    // the flown path
    let pathLengthM = 0;
    let maxSpeedMps = 0;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i] as FlightFrame;
        maxSpeedMps = Math.max(maxSpeedMps, Math.hypot(f.v[0], f.v[1], f.v[2]));
        if (i > 0) {
            const d = Math.hypot(...sub3(f.p, (frames[i - 1] as FlightFrame).p));
            if (d < JUMP_M) pathLengthM += d;
        }
    }
    const flightMs = frames.length === 0 ? 0 : lastFrameT - (frames[0] as FlightFrame).t;

    // deviation from the polyline through the gates, per attempt and overall
    const allDeviations: number[] = [];
    const attempts: AttemptReport[] = attemptsOpen.map((a) => {
        const endMs = a.endMs ?? clockMs;
        let deviation: AttemptReport['deviationM'] = null;
        if (plan !== null && plan.gates.length > 0) {
            const until = a.result === 'pass' && a.lastGateT !== null ? a.lastGateT : endMs;
            const inside = frames.filter((f) => f.t >= a.clockStart && f.t <= until);
            if (inside.length > 0) {
                const line: Vec3[] = [(inside[0] as FlightFrame).p];
                for (let lap = 0; lap < plan.laps; lap++) for (const g of plan.gates) line.push(g.pos);
                const d = inside.map((f) => distanceToPolyline(f.p, line));
                allDeviations.push(...d);
                deviation = stats(d);
            }
        }
        return { attempt: a.attempt, startMs: a.startMs, endMs, durationMs: endMs - a.startMs, result: a.result, touches: a.touches, gates: a.gates.length, resets: a.resets, deviationM: deviation };
    });
    const gates = attemptsOpen.flatMap((a) => a.gates);

    // outcome: a lesson that is not blocking is ended by the runner after its blocks whatever the score, so a
    // `passed` event only counts as a pass when the block just before it was passed (a `block-pass` event)
    let passed: SessionEvent | undefined;
    let previousLessonEvent = '';
    for (const e of events) {
        if (e.kind !== 'lesson') continue;
        if (e.what === 'passed' && previousLessonEvent === 'block-pass' && passed === undefined) passed = e;
        previousLessonEvent = e.what;
    }
    const noLesson = m.lesson === null;
    const status: Report['outcome']['status'] = noLesson ? 'no-lesson' : passed !== undefined ? 'passed' : !m.complete ? 'incomplete' : 'not-passed';
    const answerEvents = events.filter((e): e is Extract<SessionEvent, { kind: 'answer' }> => e.kind === 'answer');

    // the replay check
    let replayCheck: Report['replayCheck'] = { skipped: 'turned off' };
    if (options.replay !== false) {
        if (setup === null) replayCheck = { skipped: setupError ?? 'the session cannot be rebuilt' };
        else {
            try {
                const done = checkSession(pkg, { ...(options.world === undefined ? {} : { world: options.world }), ...(options.objects === undefined ? {} : { objects: options.objects }), ...(options.tolerances === undefined ? {} : { tolerances: options.tolerances }) });
                replayCheck = { ok: done.check.ok, line: formatReplayCheck(done.check), exact: done.check.exact, differences: done.check.events.diffs.slice(0, 10).map((d) => d.detail) };
                for (const n of done.check.notes) warnings.push(`replay: ${n.message}`);
            } catch (e) {
                if (!(e instanceof ReplayError)) throw e;
                // a scan session: the replay runs without the simulator's world
                try {
                    const done = checkSession(pkg, { world: null, ...(options.objects === undefined ? {} : { objects: options.objects }), ...(options.tolerances === undefined ? {} : { tolerances: options.tolerances }) });
                    replayCheck = { ok: done.check.ok, line: formatReplayCheck(done.check), exact: done.check.exact, differences: done.check.events.diffs.slice(0, 10).map((d) => d.detail) };
                    for (const n of done.check.notes) warnings.push(`replay: ${n.message}`);
                } catch (e2) {
                    if (!(e2 instanceof ReplayError)) throw e2;
                    replayCheck = { skipped: e2.message };
                }
            }
        }
    }

    // the transcript
    const offsetMs = m.clock.voiceOffsetMs ?? 0;
    const segments = options.transcript ?? [];
    if (pkg.voice !== null && options.transcript === undefined) warnings.push('voice.webm is in the package but no transcript was given: pass --transcript to join what the pilot said');
    if (options.transcript !== undefined && pkg.voice === null) warnings.push('a transcript was given but the package holds no voice recording: its times are taken as session times with no offset');
    if (frames.length > 1) {
        let gap = 0;
        let gaps = 0;
        for (let i = 1; i < frames.length; i++) {
            const d = (frames[i] as FlightFrame).t - (frames[i - 1] as FlightFrame).t;
            if (d > 1000) {
                gaps++;
                gap = Math.max(gap, d);
            }
        }
        if (gaps > 0) warnings.push(`the flight log has ${gaps} gap${gaps === 1 ? '' : 's'} of more than a second (the longest ${Math.round(gap)} ms)`);
    }

    // the timeline: events and, between them, what was said
    const timeline: TimelineEntry[] = [];
    for (const e of events) {
        const text = describeEvent(e);
        if (text !== null) timeline.push({ tMs: e.t, kind: e.kind, text });
    }
    for (const s of segments) timeline.push({ tMs: s.startMs + offsetMs, kind: 'voice', text: `pilot said: ${s.text}` });
    const order = (k: string): number => (k === 'voice' ? 1 : 0);
    timeline.sort((a, b) => a.tMs - b.tMs || order(a.kind) - order(b.kind));

    const gateMiss = gates.length === 0 ? null : round(gates.reduce((s, g) => s + g.missM, 0) / gates.length, 3);
    return {
        format: REPORT_FORMAT,
        session: { id: m.id, created: m.created, ended: m.ended, complete: m.complete, clockMs: Math.round(clockMs), frames: frames.length, events: events.length, path: m.lesson === null ? null : m.lesson.path },
        lesson: m.lesson === null ? null : { id: m.lesson.id, version: m.lesson.version, title: lessonTitle },
        scene: { kind: m.scene.kind, id: m.scene.id },
        theme: m.theme,
        device: { locale: m.device.locale, input: m.device.input, headphones: m.device.headphones, sampleRate: m.device.audio.sampleRate, outputLatencyMs: m.device.audio.outputLatencyMs },
        consent: { recording: m.consent.recording, voice: m.consent.voice, send: m.consent.send, minor: m.consent.minor, guardianConfirmed: m.consent.guardianConfirmed },
        outcome: { status, success: noLesson ? null : passed !== undefined, attempts: attempts.length, passedAtMs: passed === undefined ? null : passed.t },
        metrics: {
            flightMs: Math.round(flightMs),
            pathLengthM: round(pathLengthM, 1),
            meanSpeedMps: flightMs > 0 ? round(pathLengthM / (flightMs / 1000), 2) : 0,
            maxSpeedMps: round(maxSpeedMps, 2),
            touches: events.filter((e) => e.kind === 'touch').length,
            resets: events.filter((e) => e.kind === 'reset').length,
            gatesPassed: gates.length,
            gateMissMeanM: gateMiss,
            deviationM: stats(allDeviations),
            speechLines: events.filter((e) => e.kind === 'speech' && e.key !== SPEECH_END_KEY).length,
            answers: { given: answerEvents.filter((a) => a.via !== 'skip').length, skipped: answerEvents.filter((a) => a.via === 'skip').length }
        },
        attempts,
        gates,
        survey: pkg.survey === null ? null : { skipped: pkg.survey.skipped, answers: pkg.survey.answers.map((a) => ({ item: a.item, value: a.value, via: a.via, tMs: a.t })) },
        replayCheck,
        transcript: options.transcript === undefined ? null : { source: options.transcriptName ?? 'transcript', segments: segments.length, offsetMs },
        warnings,
        timeline
    };
}

// ------------------------------------------------------------------ Markdown

/** 83400 -> "1:23.4" */
export function formatClock(ms: number): string {
    const sign = ms < 0 ? '-' : '';
    const t = Math.abs(ms);
    const minutes = Math.floor(t / 60000);
    const seconds = (t % 60000) / 1000;
    return `${sign}${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\n/g, ' ');

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
    return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];
}

export function renderMarkdown(r: Report): string {
    const out: string[] = [];
    const dev = (d: { mean: number; p95: number; max: number } | null): string => (d === null ? 'not available' : `mean ${d.mean} m, 95th percentile ${d.p95} m, largest ${d.max} m`);
    out.push(`# Fly by Sound session ${r.session.id}`);
    out.push('');
    const outcome = r.outcome.status === 'passed' ? 'passed' : r.outcome.status === 'not-passed' ? 'not passed' : r.outcome.status === 'incomplete' ? 'not passed (the session is unfinished)' : 'no lesson (free flight)';
    out.push(
        ...table(
            ['What', 'Value'],
            [
                ['Lesson', r.lesson === null ? 'none' : `${r.lesson.id} (version ${r.lesson.version})${r.lesson.title === null ? '' : `: ${r.lesson.title}`}${r.session.path === null ? '' : `, ${r.session.path} path`}`],
                ['Outcome', outcome + (r.outcome.passedAtMs === null ? '' : ` at ${formatClock(r.outcome.passedAtMs)}`)],
                ['Session', `${r.session.created}${r.session.ended === null ? '' : ` to ${r.session.ended}`}, ${formatClock(r.session.clockMs)} on the session clock, ${r.session.complete ? 'complete' : 'unfinished'}`],
                ['Flight', `${formatClock(r.metrics.flightMs)} flown, ${r.metrics.pathLengthM} m of path, ${r.metrics.meanSpeedMps} m/s on average, ${r.metrics.maxSpeedMps} m/s at most`],
                ['Attempts', String(r.outcome.attempts)],
                ['Touches', String(r.metrics.touches)],
                ['Resets', String(r.metrics.resets)],
                ['Gates passed', `${r.metrics.gatesPassed}${r.metrics.gateMissMeanM === null ? '' : `, mean miss of the centre ${r.metrics.gateMissMeanM} m`}`],
                ['Path deviation from the gate line', dev(r.metrics.deviationM)],
                ['Pilot', `${r.device.input}, ${r.device.headphones} headphones, language ${r.device.locale}, theme ${r.theme.id}`],
                ['Consent', `recording ${r.consent.recording ? 'yes' : 'no'}, voice ${r.consent.voice ? 'yes' : 'no'}, sending ${r.consent.send ? 'yes' : 'no'}${r.consent.minor ? `, minor (guardian ${r.consent.guardianConfirmed === true ? 'confirmed' : 'not confirmed'})` : ''}`]
            ]
        )
    );
    out.push('');
    out.push('## Replay check');
    out.push('');
    out.push('skipped' in r.replayCheck ? `Skipped: ${r.replayCheck.skipped}.` : r.replayCheck.line);
    if (!('skipped' in r.replayCheck) && r.replayCheck.differences.length > 0) {
        out.push('');
        for (const d of r.replayCheck.differences) out.push(`- ${d}`);
    }
    if (r.attempts.length > 0) {
        out.push('');
        out.push('## Attempts');
        out.push('');
        out.push(
            ...table(
                ['Attempt', 'Start', 'Time', 'Result', 'Touches', 'Gates', 'Resets', 'Deviation (mean / largest)'],
                r.attempts.map((a) => [String(a.attempt), formatClock(a.startMs), formatClock(a.durationMs), a.result, String(a.touches), String(a.gates), String(a.resets), a.deviationM === null ? '-' : `${a.deviationM.mean} / ${a.deviationM.max} m`])
            )
        );
    }
    if (r.gates.length > 0) {
        out.push('');
        out.push('## Gates');
        out.push('');
        out.push(
            ...table(
                ['Attempt', 'Gate', 'Number', 'Time', 'Since the attempt began', 'Leg', 'Miss of the centre'],
                r.gates.map((g) => [String(g.attempt), g.gateId, String(g.index + 1), formatClock(g.tMs), formatClock(g.sinceAttemptMs), formatClock(g.legMs), `${g.missM} m`])
            )
        );
    }
    if (r.survey !== null) {
        out.push('');
        out.push('## Survey');
        out.push('');
        if (r.survey.skipped) out.push('The pilot skipped the survey.');
        out.push(...table(['Item', 'Answer', 'By', 'Time'], r.survey.answers.map((a) => [a.item, a.value === null ? 'none' : String(a.value), a.via, formatClock(a.tMs)])));
    }
    if (r.warnings.length > 0) {
        out.push('');
        out.push('## Warnings');
        out.push('');
        for (const w of r.warnings) out.push(`- ${w}`);
    }
    out.push('');
    out.push('## Timeline');
    out.push('');
    if (r.transcript !== null) out.push(`Transcript: ${r.transcript.segments} segment${r.transcript.segments === 1 ? '' : 's'} from ${r.transcript.source}, voice offset ${r.transcript.offsetMs} ms.`, '');
    for (const e of r.timeline) out.push(`- ${formatClock(e.tMs)} ${e.kind === 'voice' ? '>' : '-'} ${e.text}`);
    out.push('');
    return out.join('\n');
}

// ------------------------------------------------------------------ command line

export interface CliIo {
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, text: string): Promise<void>;
    stdout(text: string): void;
    stderr(text: string): void;
}

export const nodeIo: CliIo = {
    readFile: async (path) => new Uint8Array(await readFile(path)),
    writeFile: (path, text) => writeFile(path, text, 'utf8'),
    stdout: (text) => {
        process.stdout.write(text);
    },
    stderr: (text) => {
        process.stderr.write(text);
    }
};

const USAGE = `Usage: report <package.zip> [options]

  --transcript <file>   join a transcript of the voice (JSON with start and end in seconds, SRT or VTT)
  --track <file>        the track file (JSON) of a scan lesson, for the gates
  --json <file>         write the report as JSON
  --md <file>           write the report as Markdown
  --format md|json      what to print when no file is asked for (default md)
  --no-replay           skip the replay check
  --lenient             read a damaged package as far as it goes
  --help                this text
`;

interface Args {
    readonly packagePath: string | null;
    readonly transcript: string | null;
    readonly track: string | null;
    readonly json: string | null;
    readonly md: string | null;
    readonly format: 'md' | 'json';
    readonly replay: boolean;
    readonly lenient: boolean;
    readonly help: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
    let packagePath: string | null = null;
    const values: Record<string, string | null> = { transcript: null, track: null, json: null, md: null, format: 'md' };
    let replay = true;
    let lenient = false;
    let help = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] as string;
        if (a === '--help' || a === '-h') help = true;
        else if (a === '--no-replay') replay = false;
        else if (a === '--lenient') lenient = true;
        else if (a === '--transcript' || a === '--track' || a === '--json' || a === '--md' || a === '--format') {
            const v = argv[++i];
            if (v === undefined || v.startsWith('--')) return `${a} needs a value`;
            values[a.slice(2)] = v;
        } else if (a.startsWith('--')) return `unknown option ${a}`;
        else if (packagePath === null) packagePath = a;
        else return `unexpected argument ${a}`;
    }
    if (values['format'] !== 'md' && values['format'] !== 'json') return `--format must be md or json, not ${String(values['format'])}`;
    return { packagePath, transcript: values['transcript'] ?? null, track: values['track'] ?? null, json: values['json'] ?? null, md: values['md'] ?? null, format: values['format'], replay, lenient, help };
}

/** The whole command line. Returns the exit code: 0 done, 1 the package or a file could not be read, 2 wrong use. */
export async function main(argv: readonly string[], io: CliIo = nodeIo): Promise<number> {
    const args = parseArgs(argv);
    if (typeof args === 'string') {
        io.stderr(`report: ${args}\n\n${USAGE}`);
        return 2;
    }
    if (args.help) {
        io.stdout(USAGE);
        return 0;
    }
    if (args.packagePath === null) {
        io.stderr(`report: no package given\n\n${USAGE}`);
        return 2;
    }
    try {
        const pkg = readPackage(await io.readFile(args.packagePath), { lenient: args.lenient });
        let objects: SonicObject[] | undefined;
        if (args.track !== null) {
            const track = parseTrack(utf8Decode(await io.readFile(args.track)));
            if (!track.ok) throw new ReportInputError(`the track file ${args.track} is not valid: ${formatIssues(track.issues)}`);
            objects = trackToObjects(track.value, { transform: pkg.manifest.scene.transform });
        }
        let transcript: TranscriptSegment[] | undefined;
        if (args.transcript !== null) transcript = parseTranscript(utf8Decode(await io.readFile(args.transcript)));
        const report = buildReport(pkg, { replay: args.replay, ...(objects === undefined ? {} : { objects }), ...(transcript === undefined ? {} : { transcript, transcriptName: args.transcript as string }) });
        const json = `${JSON.stringify(report, null, 2)}\n`;
        const md = renderMarkdown(report);
        if (args.json === null && args.md === null) io.stdout(args.format === 'json' ? json : md);
        else {
            if (args.json !== null) await io.writeFile(args.json, json);
            if (args.md !== null) await io.writeFile(args.md, md);
            io.stdout(`report written: ${[args.json, args.md].filter((x) => x !== null).join(', ')}\n`);
        }
        return 0;
    } catch (e) {
        if (e instanceof PackageError || e instanceof ZipError || e instanceof ReportInputError) {
            io.stderr(`report: ${e.message}\n`);
            return 1;
        }
        if (e instanceof Error && 'code' in e && (e as { code?: unknown }).code === 'ENOENT') {
            io.stderr(`report: cannot read ${(e as { path?: string }).path ?? 'a file'}: no such file\n`);
            return 1;
        }
        throw e;
    }
}
