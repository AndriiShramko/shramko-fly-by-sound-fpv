// The line codecs of a session package (spec section 7): one JSON object per line.
//
//   flight.jsonl.gz   FlightFrame lines, 30 Hz. Written in a fixed key order, positions and
//                     velocities rounded to the millimetre, quaternions to 1e-4, sticks to 1e-3,
//                     times to whole milliseconds.
//   events.jsonl      SessionEvent lines in canonical JSON (sorted keys), `t` in whole milliseconds,
//                     positions to the millimetre.
//
// Decoding is strict about every field a line must have. Unknown extra keys on an event are refused
// in strict mode and ignored in lenient mode, so a newer app's package can still be read for a report.
import type { FlightFrame, MaterialClass, SessionEvent, SurveyAnswers, Vec3 } from '../contract';
import { FORMATS, MATERIAL_CLASSES } from '../contract';
import { canonicalJson, canonicalPretty } from '../util/canonical';
import { Collector, joinPath, type Validation } from '../util/check';

const r3 = (x: number): number => {
    const r = Math.round(x * 1000) / 1000;
    return r === 0 ? 0 : r;
};
const r4 = (x: number): number => {
    const r = Math.round(x * 10000) / 10000;
    return r === 0 ? 0 : r;
};
const ms = (x: number): number => Math.round(x);
const vec3 = (v: Vec3): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

// ------------------------------------------------------------------ flight frames

/** One frame as a line of text (no newline). Throws for a value JSON cannot hold. */
export function encodeFrame(f: FlightFrame): string {
    const all = [f.t, f.tick, ...f.p, ...f.v, ...f.q, ...f.s];
    if (!all.every((x) => Number.isFinite(x))) throw new RangeError('a flight frame holds a number that is not finite');
    const q = f.q;
    return `{"t":${ms(f.t)},"tick":${ms(f.tick)},"p":[${r3(f.p[0])},${r3(f.p[1])},${r3(f.p[2])}],"v":[${r3(f.v[0])},${r3(f.v[1])},${r3(f.v[2])}],"q":[${r4(q[0])},${r4(q[1])},${r4(q[2])},${r4(q[3])}],"s":[${r3(f.s[0])},${r3(f.s[1])},${r3(f.s[2])},${r3(f.s[3])}],"c":${JSON.stringify(f.c)}}`;
}

/** The frame as the file holds it: what a round trip through encodeFrame and decodeFrame gives. */
export function roundFrame(f: FlightFrame): FlightFrame {
    return { t: ms(f.t), tick: ms(f.tick), p: vec3(f.p), v: vec3(f.v), q: [r4(f.q[0]), r4(f.q[1]), r4(f.q[2]), r4(f.q[3])], s: [r3(f.s[0]), r3(f.s[1]), r3(f.s[2]), r3(f.s[3])], c: [...f.c] };
}

export const MAX_CUES_PER_FRAME = 64;
const CUE_ID_MAX = 80;

function numbers(c: Collector, v: unknown, path: string, n: number): number[] | undefined {
    if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        if (v !== undefined) c.add(path, `must be ${n} finite numbers`);
        return undefined;
    }
    return v as number[];
}

export function validateFrame(input: unknown): Validation<FlightFrame> {
    const c = new Collector();
    const r = c.record(input, '');
    if (r === null) return c.result(undefined as never);
    c.keys(r, '', ['t', 'tick', 'p', 'v', 'q', 's', 'c']);
    const t = c.number(r['t'], 't', { min: 0 });
    const tick = c.number(r['tick'], 'tick', { min: 0 });
    const p = numbers(c, r['p'], 'p', 3);
    const v = numbers(c, r['v'], 'v', 3);
    const q = numbers(c, r['q'], 'q', 4);
    const s = numbers(c, r['s'], 's', 4);
    if (q !== undefined && Math.abs(Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number) - 1) > 0.01) c.add('q', 'must be a unit quaternion');
    if (s !== undefined && !s.every((x) => Math.abs(x) <= 1.001)) c.add('s', 'sticks must lie in [-1, 1]');
    const cues = c.array(r['c'], 'c', { max: MAX_CUES_PER_FRAME });
    if (cues !== null && !cues.every((x) => typeof x === 'string' && x.length > 0 && x.length <= CUE_ID_MAX)) c.add('c', `must be cue id strings of 1 to ${CUE_ID_MAX} characters`);
    if (!c.ok || t === undefined || tick === undefined || p === undefined || v === undefined || q === undefined || s === undefined || cues === null) return c.result(undefined as never);
    return { ok: true, value: { t, tick, p: p as unknown as Vec3, v: v as unknown as Vec3, q: q as unknown as FlightFrame['q'], s: s as unknown as FlightFrame['s'], c: cues as string[] } };
}

/** One line of flight.jsonl in, a frame or every reason it is wrong out. */
export function decodeFrame(line: string): Validation<FlightFrame> {
    let data: unknown;
    try {
        data = JSON.parse(line);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return validateFrame(data);
}

// ------------------------------------------------------------------ events

/** An event as the file holds it: `t` in whole milliseconds, positions to the millimetre. */
export function roundEvent(e: SessionEvent): SessionEvent {
    switch (e.kind) {
        case 'touch':
            return { ...e, t: ms(e.t), pos: vec3(e.pos) };
        default:
            return { ...e, t: ms(e.t) };
    }
}

/** One event as a line of text (canonical JSON, no newline). Throws for a value JSON cannot hold. */
export function encodeEvent(e: SessionEvent): string {
    return canonicalJson(roundEvent(e));
}

const EVENT_KINDS = ['session', 'lesson', 'goal', 'touch', 'gate', 'checkpoint', 'reset', 'speech', 'key', 'answer', 'recording', 'send'] as const;
const SESSION_WHAT = ['start', 'pause', 'resume', 'end', 'recovered'] as const;
const LESSON_WHAT = ['open', 'intro', 'attempt-start', 'attempt-pass', 'attempt-fail', 'block-pass', 'passed', 'leave'] as const;
const GOAL_WHAT = ['met', 'missed'] as const;
const RESET_TO = ['checkpoint', 'start'] as const;
const ANSWER_VIA = ['key', 'voice', 'skip'] as const;
const RECORDING_WHAT = ['start', 'stop', 'mic-denied'] as const;
const SEND_WHAT = ['asked', 'stored', 'delivered', 'failed'] as const;
const SEND_CHANNEL = ['server', 'telegram', 'email'] as const;
const LESSON_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ID_MAX = 80;
const TEXT_MAX = 2000;

/** The keys each kind of event may carry, `t` and `kind` included. */
const EVENT_KEYS: Readonly<Record<SessionEvent['kind'], readonly string[]>> = {
    session: ['t', 'kind', 'what'],
    lesson: ['t', 'kind', 'lessonId', 'version', 'what', 'attempt'],
    goal: ['t', 'kind', 'index', 'what'],
    touch: ['t', 'kind', 'material', 'speed', 'pos'],
    gate: ['t', 'kind', 'gateId', 'index', 'missM'],
    checkpoint: ['t', 'kind', 'id'],
    reset: ['t', 'kind', 'to', 'checkpointId'],
    speech: ['t', 'kind', 'key', 'text'],
    key: ['t', 'kind', 'code', 'action'],
    answer: ['t', 'kind', 'item', 'value', 'via'],
    recording: ['t', 'kind', 'what'],
    send: ['t', 'kind', 'what', 'channel']
};

export interface EventValidationOptions {
    /** false (default): a key the kind does not have is an issue. true: it is ignored. */
    readonly lenient?: boolean;
}

export function validateEvent(input: unknown, options: EventValidationOptions = {}): Validation<SessionEvent> {
    const c = new Collector();
    const r = c.record(input, '');
    if (r === null) return c.result(undefined as never);
    const kind = c.oneOf(r['kind'], 'kind', EVENT_KINDS);
    const t = c.number(r['t'], 't', { min: 0 });
    if (kind === undefined) {
        if (r['kind'] === undefined) c.add('kind', 'is missing');
        return c.result(undefined as never);
    }
    if (options.lenient !== true) c.keys(r, '', EVENT_KEYS[kind], EVENT_KEYS[kind]);
    const need = (key: string): void => {
        if (options.lenient === true && r[key] === undefined) c.add(key, 'is missing');
    };
    for (const k of EVENT_KEYS[kind]) need(k);
    const str = (key: string, max = ID_MAX, min = 1): string | undefined => c.string(r[key], key, { min, max });
    const nullableStr = (key: string, max = ID_MAX): string | null | undefined => (r[key] === null ? null : str(key, max));
    let e: SessionEvent | undefined;
    switch (kind) {
        case 'session': {
            const what = c.oneOf(r['what'], 'what', SESSION_WHAT);
            if (what !== undefined && t !== undefined) e = { t, kind, what };
            break;
        }
        case 'lesson': {
            const lessonId = c.string(r['lessonId'], 'lessonId', { min: 1, max: ID_MAX, pattern: LESSON_ID_RE });
            const version = c.number(r['version'], 'version', { integer: true, min: 1 });
            const what = c.oneOf(r['what'], 'what', LESSON_WHAT);
            const attempt = c.number(r['attempt'], 'attempt', { integer: true, min: 0 });
            if (lessonId !== undefined && version !== undefined && what !== undefined && attempt !== undefined && t !== undefined) e = { t, kind, lessonId, version, what, attempt };
            break;
        }
        case 'goal': {
            const index = c.number(r['index'], 'index', { integer: true, min: 0 });
            const what = c.oneOf(r['what'], 'what', GOAL_WHAT);
            if (index !== undefined && what !== undefined && t !== undefined) e = { t, kind, index, what };
            break;
        }
        case 'touch': {
            const material = c.oneOf(r['material'], 'material', MATERIAL_CLASSES) as MaterialClass | undefined;
            const speed = c.number(r['speed'], 'speed', { min: 0 });
            const pos = c.vec3(r['pos'], 'pos');
            if (material !== undefined && speed !== undefined && pos !== undefined && t !== undefined) e = { t, kind, material, speed, pos };
            break;
        }
        case 'gate': {
            const gateId = str('gateId');
            const index = c.number(r['index'], 'index', { integer: true, min: 0 });
            const missM = c.number(r['missM'], 'missM', { min: 0 });
            if (gateId !== undefined && index !== undefined && missM !== undefined && t !== undefined) e = { t, kind, gateId, index, missM };
            break;
        }
        case 'checkpoint': {
            const id = str('id');
            if (id !== undefined && t !== undefined) e = { t, kind, id };
            break;
        }
        case 'reset': {
            const to = c.oneOf(r['to'], 'to', RESET_TO);
            const checkpointId = nullableStr('checkpointId');
            if (to !== undefined && checkpointId !== undefined && t !== undefined) e = { t, kind, to, checkpointId };
            break;
        }
        case 'speech': {
            const key = str('key');
            const text = c.string(r['text'], 'text', { max: TEXT_MAX });
            if (key !== undefined && text !== undefined && t !== undefined) e = { t, kind, key, text };
            break;
        }
        case 'key': {
            const code = str('code', 64);
            const action = nullableStr('action', 64);
            if (code !== undefined && action !== undefined && t !== undefined) e = { t, kind, code, action };
            break;
        }
        case 'answer': {
            const item = str('item');
            const value = r['value'] === null ? null : c.number(r['value'], 'value', { integer: true, min: 0, max: 1000 });
            const via = c.oneOf(r['via'], 'via', ANSWER_VIA);
            if (item !== undefined && value !== undefined && via !== undefined && t !== undefined) e = { t, kind, item, value, via };
            break;
        }
        case 'recording': {
            const what = c.oneOf(r['what'], 'what', RECORDING_WHAT);
            if (what !== undefined && t !== undefined) e = { t, kind, what };
            break;
        }
        case 'send': {
            const what = c.oneOf(r['what'], 'what', SEND_WHAT);
            const channel = r['channel'] === null ? null : c.oneOf(r['channel'], 'channel', SEND_CHANNEL);
            if (what !== undefined && channel !== undefined && t !== undefined) e = { t, kind, what, channel };
            break;
        }
    }
    if (!c.ok || e === undefined) return c.result(undefined as never);
    return { ok: true, value: e };
}

/** One line of events.jsonl in, an event or every reason it is wrong out. */
export function decodeEvent(line: string, options: EventValidationOptions = {}): Validation<SessionEvent> {
    let data: unknown;
    try {
        data = JSON.parse(line);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return validateEvent(data, options);
}

// ------------------------------------------------------------------ survey answers

export function validateSurveyAnswers(input: unknown): Validation<SurveyAnswers> {
    const c = new Collector();
    const r = c.record(input, '');
    if (r === null) return c.result(undefined as never);
    c.keys(r, '', ['format', 'surveyId', 'version', 'skipped', 'answers']);
    if (r['format'] !== FORMATS.answers && r['format'] !== undefined) c.add('format', `must be '${FORMATS.answers}', got ${JSON.stringify(r['format'])}`);
    const surveyId = c.string(r['surveyId'], 'surveyId', { min: 1, max: ID_MAX });
    const version = c.number(r['version'], 'version', { integer: true, min: 1 });
    const skipped = c.boolean(r['skipped'], 'skipped');
    const list = c.array(r['answers'], 'answers', { max: 200 });
    const answers: SurveyAnswers['answers'][number][] = [];
    (list ?? []).forEach((raw, i) => {
        const path = joinPath('answers', i);
        const a = c.record(raw, path);
        if (a === null) return;
        c.keys(a, path, ['item', 'value', 'via', 't']);
        const item = c.string(a['item'], joinPath(path, 'item'), { min: 1, max: ID_MAX });
        const value = a['value'] === null ? null : c.number(a['value'], joinPath(path, 'value'));
        const via = c.oneOf(a['via'], joinPath(path, 'via'), ANSWER_VIA);
        const t = c.number(a['t'], joinPath(path, 't'), { min: 0 });
        if (item !== undefined && value !== undefined && via !== undefined && t !== undefined) answers.push({ item, value, via, t });
    });
    if (!c.ok || surveyId === undefined || version === undefined || skipped === undefined) return c.result(undefined as never);
    return { ok: true, value: { format: FORMATS.answers, surveyId, version, skipped, answers } };
}

/** The canonical text of survey.json, with a final newline. */
export function writeSurveyAnswers(answers: SurveyAnswers): string {
    return `${canonicalPretty(answers)}\n`;
}
