// The analysis tool (lane voice of ShramkoGSFPV train 1; design: ShramkoGSFPV docs/wip/voice-feedback-plan.md 5).
// One Fly by Sound recording package and a transcript of the pilot's voice in, a one-page summary out: what the pilot
// said and when, what happened at that moment (lesson, step, touches, retries, skips, refused answers) and the hardest
// places of each lesson.
//
//   analyze <package.zip | folder of packages> --out <dir> [--transcript <file>] [--share-safe] [--window-s 5]
//           [--no-replay]
//
// Writes <out>/<session id>/summary.md (one page, quotes verbatim), analysis.json (format shramko-voice-feedback/1, no
// nickname) and with --share-safe summary.share-safe.md (no quote, no nickname, no free text: tags, times, keys,
// counts). --out is required and refused inside a git working tree: a summary of a real recording holds a person's
// words and, for a Fly by Sound pilot, health data; it must never be committed. A folder is processed package by
// package; a package's transcript is then <name>.transcript.json next to it. No network: transcription is a separate
// step (tools/listen/transcribe.py, stage 2); this tool reads the transcript it is given.
//
// Steps: read the package strict, then lenient; put the transcript's segments on the session clock
// (start + manifest.clock.voiceOffsetMs); cut the package by lesson (lessonSegments); buildReport per lesson; anchor every
// moment to a step (the last lesson line heard before it plus the goal count; key lessonId@version#speechKey); detect the
// difficult spots by the rules of tools/feedback/rules.ts; merge spots closer than RULES.mergeMs; score; top five.
// Run it with `pnpm analyze -- <package.zip> --out <dir>` (tools/run-tool.mjs).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { SessionEvent } from '../src/contract';
import { lessonSegments, SPEECH_END_KEY, type LessonSegment } from '../src/replay';
import { PackageError, readPackage, ZipError, type SessionPackage } from '../src/session';
import { utf8Decode } from '../src/util';
import PHRASES from './feedback/phrases.json';
import { RULES, type FeedbackRules, type SignalKind } from './feedback/rules';
import { buildReport, formatClock, parseTranscript, ReportInputError, type TranscriptSegment } from './report';

export const FEEDBACK_FORMAT = 'shramko-voice-feedback/1';

export interface Anchor {
    readonly lessonIndex: number;
    readonly lessonId: string | null;
    readonly version: number;
    /** the last lesson line heard before the moment (null: none yet in this lesson) */
    readonly speechKey: string | null;
    /** what that line said (the app's own text, not the pilot's) */
    readonly line: string | null;
    /** goals met since the attempt started */
    readonly goal: number;
    /** lessonId@version#speechKey: the same place in every recording of this lesson version */
    readonly key: string;
}

export interface Signal {
    readonly kind: SignalKind;
    readonly t: number;
    readonly weight: number;
}

export interface Spot {
    readonly key: string;
    readonly t: number;
    readonly toT: number;
    readonly anchor: Anchor;
    readonly signals: readonly Signal[];
    /** a pilot remark within the window of the spot */
    readonly remark: boolean;
    readonly score: number;
}

export type RemarkTag = 'confusion' | 'sound' | 'praise' | 'remark' | 'survey';

export interface Remark {
    readonly t: number;
    /** the step's key; null in the survey tail */
    readonly key: string | null;
    readonly anchor: Anchor | null;
    readonly tag: RemarkTag;
    /** the open survey item it answers (survey tail only) */
    readonly item: string | null;
    readonly text: string;
    /** the app's own voice heard by the microphone (stage 2: the echo filter); always false here */
    readonly echo: false;
    readonly nearby: readonly string[];
}

export interface LessonRow {
    readonly index: number;
    readonly lessonId: string | null;
    readonly version: number;
    readonly title: string | null;
    readonly lead: boolean;
    readonly fromMs: number;
    readonly toMs: number;
    readonly status: 'passed' | 'not passed' | 'skipped';
    readonly attempts: number;
    readonly touches: number;
    readonly resets: number;
    readonly repeats: number;
    readonly refused: number;
    readonly answersSkipped: number;
    readonly replay: string;
}

export interface Analysis {
    readonly format: typeof FEEDBACK_FORMAT;
    readonly session: {
        readonly id: string;
        readonly created: string;
        readonly pilotId: string;
        readonly locale: string;
        readonly input: string;
        readonly headphones: string;
        readonly lengthMs: number;
        readonly voice: boolean;
        readonly consent: { readonly recording: boolean; readonly voice: boolean; readonly send: boolean; readonly speechRecognition: boolean; readonly minor: boolean; readonly guardianConfirmed: boolean | null };
    };
    readonly build: { readonly release: string; readonly sonic: string };
    readonly lessons: readonly LessonRow[];
    readonly spots: readonly Spot[];
    readonly remarks: readonly Remark[];
    readonly survey: { readonly skipped: boolean; readonly answers: readonly { readonly item: string; readonly value: number | null; readonly via: string; readonly tMs: number }[] } | null;
    readonly transcript: { readonly source: string | null; readonly segments: number; readonly dropped: number; readonly echo: number; readonly language: string | null; readonly modelRevision: string | null };
    readonly alignment: { readonly voiceOffsetMs: number | null; readonly driftMs: number | null };
    readonly warnings: readonly string[];
}

export interface AnalyzeOptions {
    readonly transcript?: readonly TranscriptSegment[];
    readonly transcriptName?: string;
    readonly windowMs?: number;
    readonly replay?: boolean;
    readonly rules?: FeedbackRules;
}

// ------------------------------------------------------------------ steps and anchors

const HOST_LINE = /^(rec|send|survey)\./;
const isLessonLine = (e: SessionEvent): e is Extract<SessionEvent, { kind: 'speech' }> => e.kind === 'speech' && e.key !== SPEECH_END_KEY && !HOST_LINE.test(e.key);

function segmentAt(segments: readonly LessonSegment[], t: number): LessonSegment {
    let at = segments[0] as LessonSegment;
    for (const s of segments) if (s.fromT <= t) at = s;
    return at;
}

/** The step a moment belongs to: the last lesson line heard at or before t in its lesson, and the goals met since the attempt began. */
export function anchorAt(segments: readonly LessonSegment[], t: number): Anchor {
    const seg = segmentAt(segments, t);
    let line: Extract<SessionEvent, { kind: 'speech' }> | null = null;
    let goal = 0;
    for (const e of seg.events) {
        if (e.t > t) break;
        if (isLessonLine(e)) line = e;
        else if (e.kind === 'lesson' && e.what === 'attempt-start') goal = 0;
        else if (e.kind === 'goal' && e.what === 'met') goal++;
    }
    const version = seg.manifest.lesson?.version ?? 0;
    const speechKey = line === null ? null : line.key;
    return { lessonIndex: seg.index, lessonId: seg.lessonId, version, speechKey, line: line === null ? null : line.text, goal, key: `${seg.lessonId ?? 'none'}@${version}#${speechKey ?? 'start'}` };
}

// ------------------------------------------------------------------ signals

function signalsOf(seg: LessonSegment, rules: FeedbackRules): Signal[] {
    const out: Signal[] = [];
    const add = (kind: SignalKind, t: number): void => {
        out.push({ kind, t, weight: rules.signals[kind].weight });
    };
    let fails = 0;
    let passed = false;
    let refusedOnQuestion = 0;
    const resets: number[] = [];
    const touches: number[] = [];
    let pauseAt: number | null = null;
    const hasResetEvents = seg.events.some((e) => e.kind === 'reset');
    for (const e of seg.events) {
        if (e.kind === 'lesson') {
            if (e.what === 'attempt-fail') {
                add('attempt-fail', e.t);
                if (++fails === rules.manyAttempts) add('many-attempts', e.t);
            } else if (e.what === 'passed') passed = true;
        } else if (e.kind === 'reset' || (e.kind === 'key' && !hasResetEvents && (e.action === 'reset.start' || e.action === 'reset.checkpoint'))) {
            add('reset', e.t);
            resets.push(e.t);
            if (resets.filter((r) => e.t - r <= rules.resetBurstMs).length === rules.resetBurst) add('reset-burst', e.t);
        } else if (e.kind === 'key') {
            if (e.action === 'repeat') add('repeat', e.t);
            else if (e.action === 'next-lesson' && !passed) add('skip-lesson', e.t);
            else if (e.action === 'answer.refused') {
                add('answer-refused', e.t);
                if (++refusedOnQuestion === rules.refusedBurst) add('refused-burst', e.t);
            }
        } else if (e.kind === 'answer') {
            refusedOnQuestion = 0;
            if (e.via === 'skip') add('answer-skip', e.t);
        } else if (e.kind === 'touch') {
            add('touch', e.t);
            if (e.speed > rules.touchFastMps) add('touch-fast', e.t);
            touches.push(e.t);
            if (touches.filter((x) => e.t - x <= rules.touchClusterMs).length === rules.touchCluster) add('touch-cluster', e.t);
        } else if (e.kind === 'session') {
            if (e.what === 'pause') pauseAt = e.t;
            else if (e.what === 'resume' && pauseAt !== null) {
                if (e.t - pauseAt > rules.pauseMs) add('pause', pauseAt);
                pauseAt = null;
            }
        }
    }
    // idle: inside an attempt, no speed and the sticks at the centre for rules.idleMs
    const attempts: [number, number][] = [];
    let open: number | null = null;
    for (const e of seg.events) {
        if (e.kind !== 'lesson') continue;
        if (e.what === 'attempt-start') open = e.t;
        else if ((e.what === 'attempt-pass' || e.what === 'attempt-fail' || e.what === 'leave') && open !== null) {
            attempts.push([open, e.t]);
            open = null;
        }
    }
    if (open !== null) attempts.push([open, Infinity]);
    const inAttempt = (t: number): boolean => attempts.some(([a, b]) => t >= a && t < b);
    let still: number | null = null;
    let flagged = false;
    for (const f of seg.frames) {
        const speed = Math.hypot(f.v[0], f.v[1], f.v[2]);
        const centred = f.s.every((x) => Math.abs(x) <= rules.idleStick);
        if (inAttempt(f.t) && speed < rules.idleSpeedMps && centred) {
            if (still === null) {
                still = f.t;
                flagged = false;
            } else if (!flagged && f.t - still >= rules.idleMs) {
                add('idle', still);
                flagged = true;
            }
        } else still = null;
    }
    return out.sort((a, b) => a.t - b.t);
}

function spotsOf(segments: readonly LessonSegment[], sessionTimes: readonly number[], rules: FeedbackRules, windowMs: number): Spot[] {
    const spots: Spot[] = [];
    for (const seg of segments) {
        let cur: Signal[] = [];
        const flush = (): void => {
            if (cur.length === 0) return;
            const t = (cur[0] as Signal).t;
            const toT = (cur[cur.length - 1] as Signal).t;
            const remark = sessionTimes.some((x) => x >= t - windowMs && x <= toT + windowMs);
            const sum = cur.reduce((s, x) => s + x.weight, 0);
            const anchor = anchorAt(segments, t);
            spots.push({ key: anchor.key, t, toT, anchor, signals: cur, remark, score: Math.round(sum * (remark ? rules.remarkFactor : 1) * 100) / 100 });
            cur = [];
        };
        for (const s of signalsOf(seg, rules)) {
            if (cur.length > 0 && s.t - (cur[cur.length - 1] as Signal).t >= rules.mergeMs) flush();
            cur.push(s);
        }
        flush();
    }
    return spots;
}

// ------------------------------------------------------------------ remarks

type PhraseTable = Record<string, Partial<Record<'confusion' | 'sound' | 'praise', readonly string[]>>>;

function tagOf(text: string, locale: string): RemarkTag {
    const table = PHRASES as unknown as PhraseTable;
    const lists = [table[locale.slice(0, 2)], locale.startsWith('en') ? undefined : table['en']].filter((x) => x !== undefined);
    const low = text.toLowerCase();
    for (const tag of ['confusion', 'sound', 'praise'] as const) {
        for (const list of lists) {
            for (const stem of list[tag] ?? []) {
                const at = low.indexOf(stem);
                if (at >= 0 && (at === 0 || !/\p{L}/u.test(low[at - 1] as string))) return tag;
            }
        }
    }
    return 'remark';
}

function describe(e: SessionEvent): string | null {
    switch (e.kind) {
        case 'lesson':
            return e.what === 'open' || e.what === 'intro' ? null : `lesson ${e.what}${e.attempt > 0 ? ` ${e.attempt}` : ''}`;
        case 'key':
            return e.action === null ? null : `key ${e.action}`;
        case 'reset':
            return `reset to ${e.to}`;
        case 'touch':
            return `touch ${e.material} ${e.speed.toFixed(1)} m/s`;
        case 'answer':
            return `answer ${e.item} ${e.via}`;
        case 'goal':
            return `goal ${e.index} ${e.what}`;
        case 'gate':
            return `gate ${e.index}`;
        case 'session':
            return e.what === 'pause' || e.what === 'resume' ? `session ${e.what}` : null;
        default:
            return null;
    }
}

// ------------------------------------------------------------------ the analysis

export function analyzePackage(pkg: SessionPackage, options: AnalyzeOptions = {}): Analysis {
    const rules = options.rules ?? RULES;
    const windowMs = options.windowMs ?? rules.remarkWindowMs;
    const m = pkg.manifest;
    const warnings: string[] = pkg.problems.map((p) => `package: ${p.message}`);
    const segments = lessonSegments(pkg);
    const offsetMs = pkg.voice === null ? 0 : (m.clock.voiceOffsetMs ?? 0);
    if (options.transcript !== undefined && pkg.voice === null) warnings.push('a transcript was given but the package holds no voice: its times are taken as session times');
    if (options.transcript === undefined && pkg.voice !== null) warnings.push('voice.webm is in the package but no transcript was given');
    const lastFrameT = pkg.frames.length === 0 ? 0 : (pkg.frames[pkg.frames.length - 1] as { t: number }).t;
    const lengthMs = Math.max(lastFrameT, ...pkg.events.map((e) => e.t), 0);

    // lessons
    const lessons: LessonRow[] = segments.map((seg, k) => {
        const report = buildReport({ ...pkg, manifest: seg.manifest, frames: seg.frames, events: seg.events }, { replay: options.replay !== false });
        let passed = false;
        let skipped = false;
        for (const e of seg.events) {
            if (e.kind === 'lesson' && e.what === 'passed') passed = true;
            if (e.kind === 'key' && e.action === 'next-lesson' && !passed) skipped = true;
        }
        const count = (f: (e: SessionEvent) => boolean): number => seg.events.filter(f).length;
        const next = segments[k + 1];
        const rc = report.replayCheck;
        return {
            index: seg.index,
            lessonId: seg.lessonId,
            version: seg.manifest.lesson?.version ?? 0,
            title: report.lesson?.title ?? null,
            lead: seg.lead,
            fromMs: Math.round(seg.fromT),
            toMs: Math.round(next === undefined ? lengthMs : next.fromT),
            status: passed ? 'passed' : skipped ? 'skipped' : 'not passed',
            attempts: count((e) => e.kind === 'lesson' && e.what === 'attempt-start'),
            touches: count((e) => e.kind === 'touch'),
            resets: count((e) => e.kind === 'reset'),
            repeats: count((e) => e.kind === 'key' && e.action === 'repeat'),
            refused: count((e) => e.kind === 'key' && e.action === 'answer.refused'),
            answersSkipped: count((e) => e.kind === 'answer' && e.via === 'skip'),
            replay: 'skipped' in rc ? `not checked (${rc.skipped})` : rc.verdict
        };
    });

    // remarks on the session clock; the survey tail starts with the first survey line
    const surveyStart = pkg.events.find((e) => e.kind === 'speech' && e.key.startsWith('survey.'))?.t ?? Infinity;
    const said = (options.transcript ?? []).map((s) => ({ t: Math.round(s.startMs + offsetMs), text: s.text }));
    const remarks: Remark[] = said.map(({ t, text }) => {
        const nearby = pkg.events.filter((e) => Math.abs(e.t - t) <= windowMs).map(describe).filter((x): x is string => x !== null);
        if (t >= surveyStart) {
            let item: string | null = null;
            for (const e of pkg.events) if (e.t <= t && e.kind === 'speech' && e.key.startsWith('survey.item.')) item = e.key.slice('survey.item.'.length);
            return { t, key: null, anchor: null, tag: 'survey', item, text, echo: false, nearby };
        }
        const anchor = anchorAt(segments, t);
        return { t, key: anchor.key, anchor, tag: tagOf(text, m.device.locale), item: null, text, echo: false, nearby };
    });

    const spots = spotsOf(segments, remarks.filter((r) => r.tag !== 'survey').map((r) => r.t), rules, windowMs);
    return {
        format: FEEDBACK_FORMAT,
        session: {
            id: m.id,
            created: m.created,
            pilotId: m.pilot.id,
            locale: m.device.locale,
            input: m.device.input,
            headphones: m.device.headphones,
            lengthMs: Math.round(lengthMs),
            voice: pkg.voice !== null,
            consent: { recording: m.consent.recording, voice: m.consent.voice, send: m.consent.send, speechRecognition: m.consent.speechRecognition, minor: m.consent.minor, guardianConfirmed: m.consent.guardianConfirmed }
        },
        build: { release: m.app.release, sonic: m.app.sonic },
        lessons,
        spots,
        remarks,
        survey: pkg.survey === null ? null : { skipped: pkg.survey.skipped, answers: pkg.survey.answers.map((a) => ({ item: a.item, value: a.value, via: a.via, tMs: a.t })) },
        transcript: { source: options.transcriptName ?? null, segments: said.length, dropped: 0, echo: 0, language: null, modelRevision: null },
        alignment: { voiceOffsetMs: m.clock.voiceOffsetMs ?? null, driftMs: null },
        warnings
    };
}

/** The spots of the page: highest score first, then the earlier. */
export function topSpots(a: Analysis, n = RULES.topSpots): Spot[] {
    return [...a.spots].sort((x, y) => y.score - x.score || x.t - y.t).slice(0, n);
}

// ------------------------------------------------------------------ the pages

const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const short = (s: string, n = 60): string => (s.length <= n ? s : `${s.slice(0, n - 3)}...`);
const yes = (b: boolean | null): string => (b === null ? '-' : b ? 'yes' : 'no');
const table = (head: readonly string[], rows: readonly (readonly string[])[]): string[] => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];
const lessonName = (l: LessonRow, withTitle: boolean): string => `${withTitle && l.title !== null ? `${l.title} ` : ''}${l.lessonId ?? 'none'}@${l.version}${l.lead ? ' (lead)' : ''}`;
const signalsText = (s: Spot): string => {
    const kinds = new Map<string, number>();
    for (const x of s.signals) kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
    return [...kinds].map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(', ');
};

function header(a: Analysis): string[] {
    const s = a.session;
    const c = s.consent;
    return [
        `- Session ${s.id}, ${s.created}, build ${a.build.release} / sound ${a.build.sonic}`,
        `- Locale ${s.locale}, input ${s.input}, headphones ${s.headphones}, length ${formatClock(s.lengthMs)}, voice ${yes(s.voice)}`,
        `- Consent: recording ${yes(c.recording)}, voice ${yes(c.voice)}, send ${yes(c.send)}, speech recognition ${yes(c.speechRecognition)}; minor ${yes(c.minor)}`,
        `- Replay: ${a.lessons.map((l) => `${l.lessonId ?? 'none'} ${l.replay}`).join('; ')}`,
        `- Data warnings: ${a.warnings.length === 0 ? 'none' : `${a.warnings.length} (${short(a.warnings[0] as string, 100)})`}`
    ];
}

function lessonsTable(a: Analysis, withTitle: boolean): string[] {
    return table(
        ['Lesson', 'Time', 'Attempts', 'Result', 'Touches', 'Resets', 'Repeats asked', 'Refused answers'],
        a.lessons.map((l) => [lessonName(l, withTitle), `${formatClock(l.fromMs)} (${formatClock(l.toMs - l.fromMs)})`, String(l.attempts), l.status, String(l.touches), String(l.resets), String(l.repeats), String(l.refused)])
    );
}

/** summary.md: one page for the owner's own reading (quotes verbatim). */
export function renderSummary(a: Analysis): string {
    const out: string[] = [`# Fly by Sound recording ${a.session.id}`, '', ...header(a), '', '## Lessons', '', ...lessonsTable(a, true), '', '## Hardest places', ''];
    const top = topSpots(a);
    if (top.length === 0) out.push('No difficult spot found.');
    else
        out.push(
            ...table(
                ['Time', 'Lesson and step', 'What happened', 'Score', 'The pilot said'],
                top.map((s) => {
                    const said = a.remarks.filter((r) => r.tag !== 'survey' && r.t >= s.t - RULES.remarkWindowMs && r.t <= s.toT + RULES.remarkWindowMs).map((r) => `"${r.text}"`);
                    return [formatClock(s.t), `${s.key}${s.anchor.line === null ? '' : `: ${short(s.anchor.line, 50)}`}`, signalsText(s), String(s.score), said.join(' ') || '-'];
                })
            )
        );
    out.push('', '## Pilot remarks', '');
    const remarks = a.remarks.filter((r) => r.tag !== 'survey');
    if (remarks.length === 0) out.push('No remark (no transcript, or nothing said during the lessons).');
    else
        out.push(...table(['Time', 'Lesson and step', 'Tag', 'Quote', 'Events within the window'], remarks.slice(0, RULES.pageRemarks).map((r) => [formatClock(r.t), r.key ?? '-', r.tag, `"${r.text}"`, r.nearby.join(', ') || '-'])));
    if (remarks.length > RULES.pageRemarks) out.push('', `${remarks.length - RULES.pageRemarks} more in analysis.json.`);
    out.push('', '## Survey', '');
    if (a.survey === null) out.push('No survey in the package.');
    else {
        const open = a.remarks.filter((r) => r.tag === 'survey');
        out.push(...table(['Item', 'Answer', 'Via'], a.survey.answers.map((x) => [x.item, x.value === null ? '-' : String(x.value), x.via])));
        if (open.length > 0) out.push('', ...open.map((r) => `- ${r.item ?? 'survey'} (${formatClock(r.t)}): "${r.text}"`));
    }
    return `${out.join('\n')}\n`;
}

/** summary.share-safe.md: no quote, no nickname, no free text: tags, times, keys and counts only. */
export function renderShareSafe(a: Analysis): string {
    const out: string[] = [`# Fly by Sound recording ${a.session.id} (share-safe)`, '', ...header(a), '', '## Lessons', '', ...lessonsTable(a, false), '', '## Hardest places', ''];
    const top = topSpots(a);
    if (top.length === 0) out.push('No difficult spot found.');
    else out.push(...table(['Time', 'Step key', 'What happened', 'Score', 'Remark nearby'], top.map((s) => [formatClock(s.t), s.key, signalsText(s), String(s.score), yes(s.remark)])));
    out.push('', '## Pilot remarks (tags only)', '');
    out.push(...table(['Time', 'Step key', 'Tag'], a.remarks.slice(0, RULES.pageRemarks).map((r) => [formatClock(r.t), r.key ?? `survey ${r.item ?? ''}`, r.tag])));
    out.push('', '## Survey', '');
    if (a.survey === null) out.push('No survey in the package.');
    else out.push(...table(['Item', 'Answer', 'Via'], a.survey.answers.map((x) => [x.item, x.value === null ? '-' : String(x.value), x.via])));
    return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------------ the command line

export interface AnalyzeIo {
    stdout(text: string): void;
    stderr(text: string): void;
}

const nodeIo: AnalyzeIo = {
    stdout: (t) => {
        process.stdout.write(t);
    },
    stderr: (t) => {
        process.stderr.write(t);
    }
};

const USAGE = `Usage: analyze <package.zip | folder of packages> --out <dir> [options]

  --out <dir>           where <session id>/summary.md and analysis.json go (required; refused inside a git tree)
  --transcript <file>   the transcript of voice.webm (JSON with start and end in seconds, SRT or VTT); for a folder,
                        <name>.transcript.json next to each package is used
  --share-safe          also write summary.share-safe.md (no quote, no nickname, no free text)
  --window-s <seconds>  window around an event for a remark (default ${RULES.remarkWindowMs / 1000})
  --no-replay           skip the replay check of each lesson
  --help                this text
`;

/** The folder (or one above it) that holds a .git: a git working tree, or null. */
export function gitTreeAbove(dir: string): string | null {
    for (let d = resolve(dir); ; d = dirname(d)) {
        if (existsSync(join(d, '.git'))) return d;
        if (dirname(d) === d) return null;
    }
}

async function readOne(path: string): Promise<SessionPackage> {
    const bytes = new Uint8Array(await readFile(path));
    try {
        return readPackage(bytes);
    } catch (e) {
        if (!(e instanceof PackageError || e instanceof ZipError)) throw e;
        return readPackage(bytes, { lenient: true });
    }
}

/** The whole command line. Returns the exit code: 0 done, 1 a package or a file could not be read, 2 wrong use. */
export async function main(argv: readonly string[], io: AnalyzeIo = nodeIo): Promise<number> {
    let input: string | null = null;
    let out: string | null = null;
    let transcriptPath: string | null = null;
    let shareSafe = false;
    let replay = true;
    let windowMs = RULES.remarkWindowMs;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] as string;
        const value = (): string | null => {
            const v = argv[++i];
            return v === undefined || v.startsWith('--') ? null : v;
        };
        // pnpm 11 passes the `--` of `pnpm analyze -- <package>` on to the tool (measured 2026-11-13): skip it
        if (a === '--') continue;
        if (a === '--help' || a === '-h') {
            io.stdout(USAGE);
            return 0;
        } else if (a === '--share-safe') shareSafe = true;
        else if (a === '--no-replay') replay = false;
        else if (a === '--out' || a === '--transcript' || a === '--window-s') {
            const v = value();
            if (v === null) {
                io.stderr(`analyze: ${a} needs a value\n\n${USAGE}`);
                return 2;
            }
            if (a === '--out') out = v;
            else if (a === '--transcript') transcriptPath = v;
            else {
                windowMs = Number(v) * 1000;
                if (!(windowMs > 0 && windowMs <= 60000)) {
                    io.stderr('analyze: --window-s must be a number of seconds from 0 to 60\n');
                    return 2;
                }
            }
        } else if (a.startsWith('--')) {
            io.stderr(`analyze: unknown option ${a}\n\n${USAGE}`);
            return 2;
        } else if (input === null) input = a;
        else {
            io.stderr(`analyze: unexpected argument ${a}\n\n${USAGE}`);
            return 2;
        }
    }
    if (input === null || out === null) {
        io.stderr(`analyze: ${input === null ? 'no package given' : '--out is required'}\n\n${USAGE}`);
        return 2;
    }
    const tree = gitTreeAbove(out);
    if (tree !== null) {
        io.stderr(`analyze: --out ${out} is inside the git working tree ${tree}; a summary of a recording must never be committed: choose a folder outside every git tree\n`);
        return 2;
    }
    let jobs: { pkg: string; transcript: string | null }[];
    try {
        if ((await stat(input)).isDirectory()) {
            if (transcriptPath !== null) {
                io.stderr('analyze: --transcript is for one package; in a folder put <name>.transcript.json next to each package\n');
                return 2;
            }
            const names = (await readdir(input)).filter((n) => n.toLowerCase().endsWith('.zip')).sort();
            const all = new Set(await readdir(input));
            jobs = names.map((n) => {
                const t = `${n.slice(0, -4)}.transcript.json`;
                return { pkg: join(input as string, n), transcript: all.has(t) ? join(input as string, t) : null };
            });
            if (jobs.length === 0) {
                io.stderr(`analyze: no .zip package in ${input}\n`);
                return 1;
            }
        } else jobs = [{ pkg: input, transcript: transcriptPath }];
    } catch {
        io.stderr(`analyze: cannot read ${input}\n`);
        return 1;
    }
    let failed = 0;
    for (const job of jobs) {
        try {
            const pkg = await readOne(job.pkg);
            const transcript = job.transcript === null ? undefined : parseTranscript(utf8Decode(new Uint8Array(await readFile(job.transcript))));
            const analysis = analyzePackage(pkg, { replay, windowMs, ...(transcript === undefined ? {} : { transcript, transcriptName: basename(job.transcript as string) }) });
            const dir = join(out, analysis.session.id);
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
            await writeFile(join(dir, 'summary.md'), renderSummary(analysis), 'utf8');
            if (shareSafe) await writeFile(join(dir, 'summary.share-safe.md'), renderShareSafe(analysis), 'utf8');
            io.stdout(`${basename(job.pkg)}: ${dir} (${analysis.lessons.length} lessons, ${analysis.spots.length} spots, ${analysis.remarks.length} remarks)\n`);
        } catch (e) {
            if (e instanceof PackageError || e instanceof ZipError || e instanceof ReportInputError || (e instanceof Error && 'code' in e)) {
                io.stderr(`analyze: ${basename(job.pkg)}: ${e.message}\n`);
                failed++;
            } else throw e;
        }
    }
    return failed === 0 ? 0 : 1;
}
