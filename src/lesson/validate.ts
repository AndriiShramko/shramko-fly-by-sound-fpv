// The lesson loader (contract LessonDef; spec section 3): a parsed lessons/<id>.json in, a LessonDef
// or every reason it is wrong out, with the path to each. Lessons are data a teacher edits without
// code, so the loader is strict: unknown and missing keys are refused, every number has a range,
// every spoken line must be a key of the locale catalogue, a lesson without a world asks only
// questions, and a lesson with a world flies.
import type { Checkpoint, Goal, IntroLine, LessonAssists, LessonDef, LessonLayers, LessonWorldRef, PassRule, Pose, SpeechLine } from '../contract';
import { FORMATS, LAYER_IDS, MODULES, WORLD_GENERATORS } from '../contract';
import { CUE_IDS, requiredKeys } from '../i18n/catalog';
import { canonicalPretty } from '../util/canonical';
import { Collector, joinPath, type Validation } from '../util/check';
import { sceneCues, sceneSilentReason } from './sounds';

export const LESSON_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const QUESTION_GOALS = ['name-cues', 'locate'] as const;
const GOAL_KINDS = ['name-cues', 'locate', 'hold-height', 'turn-to', 'reach-zone', 'approach-stop', 'around', 'fly-distance', 'pass-gates', 'name-shape', 'timed-course'] as const;

let catalogue: Set<string> | null = null;
function keyKnown(key: string): boolean {
    if (catalogue === null) catalogue = new Set(requiredKeys());
    return catalogue.has(key);
}

function speechLine(c: Collector, v: unknown, path: string): SpeechLine | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    c.keys(r, path, ['key', 'params'], ['key']);
    const key = c.string(r.key, joinPath(path, 'key'), { min: 1, max: 120 });
    if (key !== undefined && !keyKnown(key)) c.add(joinPath(path, 'key'), `'${key}' is not a key of the locale catalogue (src/i18n/catalog.ts)`);
    let params: Record<string, string | number> | undefined;
    if (r.params !== undefined) {
        const p = c.record(r.params, joinPath(path, 'params'));
        if (p !== null) {
            params = {};
            for (const [k, value] of Object.entries(p)) {
                if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) params[k] = value;
                else c.add(joinPath(joinPath(path, 'params'), k), 'must be a string or a finite number');
            }
        }
    }
    if (key === undefined) return undefined;
    return params === undefined ? { key } : { key, params };
}

/** An intro line (format 2): a speech line, and the cues it names (each played three times after it). */
function introLine(c: Collector, v: unknown, path: string): IntroLine | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    if (r.cues === undefined) return speechLine(c, v, path);
    const { cues: raw, ...rest } = r;
    const line = speechLine(c, rest, path);
    const cues = c.array(raw, joinPath(path, 'cues'), { min: 1, max: 4 });
    if (cues === null) return undefined;
    if (!cues.every((x) => typeof x === 'string' && (CUE_IDS as readonly string[]).includes(x))) {
        c.add(joinPath(path, 'cues'), 'must list cue ids of src/i18n/catalog.ts CUE_IDS');
        return undefined;
    }
    if (new Set(cues).size !== cues.length) c.add(joinPath(path, 'cues'), 'must not repeat a cue');
    return line === undefined ? undefined : { ...line, cues: cues as string[] };
}

function lines(c: Collector, v: unknown, path: string, min: number, max: number): SpeechLine[] | undefined {
    const arr = c.array(v, path, { min, max });
    if (arr === null) return undefined;
    const out: SpeechLine[] = [];
    arr.forEach((x, i) => {
        const l = speechLine(c, x, joinPath(path, i));
        if (l !== undefined) out.push(l);
    });
    return out.length === arr.length ? out : undefined;
}

function pose(c: Collector, v: unknown, path: string): Pose | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    c.keys(r, path, ['pos', 'yawDeg']);
    const pos = c.vec3(r.pos, joinPath(path, 'pos'));
    const yawDeg = c.number(r.yawDeg, joinPath(path, 'yawDeg'), { min: -360, max: 360 });
    return pos !== undefined && yawDeg !== undefined ? { pos, yawDeg } : undefined;
}

function band(c: Collector, v: unknown, path: string): readonly [number, number] | undefined {
    if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        c.add(path, 'must be two numbers [low, high], metres');
        return undefined;
    }
    const [lo, hi] = v as [number, number];
    if (lo < 0 || hi <= lo) {
        c.add(path, `must have 0 <= low < high, got [${lo}, ${hi}]`);
        return undefined;
    }
    return [lo, hi];
}

const orNull = <T>(v: unknown, f: () => T | undefined): T | null | undefined => (v === null ? null : f());

function world(c: Collector, v: unknown, path: string): LessonWorldRef | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    const kind = c.oneOf(r.kind, joinPath(path, 'kind'), ['none', 'analytic', 'scan'] as const);
    if (kind === 'none') {
        c.keys(r, path, ['kind']);
        return { kind };
    }
    if (kind === 'analytic') {
        c.keys(r, path, ['kind', 'spec']);
        const s = c.record(r.spec, joinPath(path, 'spec'));
        if (s === null) return undefined;
        const sp = joinPath(path, 'spec');
        c.keys(s, sp, ['generator', 'version', 'seed', 'params']);
        const generator = c.oneOf(s.generator, joinPath(sp, 'generator'), WORLD_GENERATORS);
        const version = c.number(s.version, joinPath(sp, 'version'), { integer: true, min: 1 });
        const seed = c.number(s.seed, joinPath(sp, 'seed'), { integer: true, min: 0, max: 2 ** 31 - 1 });
        const params = c.record(s.params, joinPath(sp, 'params'));
        if (params !== null) {
            for (const [k, value] of Object.entries(params)) {
                const ok = typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || (Array.isArray(value) && value.every((x) => typeof x === 'number'));
                if (!ok) c.add(joinPath(joinPath(sp, 'params'), k), 'must be a number, a string, true or false, or a list of numbers');
            }
        }
        if (generator === undefined || version === undefined || seed === undefined || params === null) return undefined;
        return { kind, spec: { generator, version, seed, params: params as never } };
    }
    if (kind === 'scan') {
        c.keys(r, path, ['kind', 'sceneId', 'sceneVersion', 'transform', 'track']);
        const sceneId = c.string(r.sceneId, joinPath(path, 'sceneId'), { min: 1, max: 80 });
        const sceneVersion = orNull(r.sceneVersion, () => c.number(r.sceneVersion, joinPath(path, 'sceneVersion'), { integer: true, min: 1 }));
        let transform: readonly [number, number, number, number] | undefined;
        if (!Array.isArray(r.transform) || r.transform.length !== 4 || !r.transform.every((x) => typeof x === 'number' && Number.isFinite(x)) || !((r.transform[0] as number) > 0)) {
            c.add(joinPath(path, 'transform'), 'must be [s, tx, ty, tz] with s > 0');
        } else transform = r.transform as unknown as [number, number, number, number];
        let track: { id: string; version: number } | null | undefined = null;
        if (r.track !== null) {
            const t = c.record(r.track, joinPath(path, 'track'));
            if (t !== null) {
                c.keys(t, joinPath(path, 'track'), ['id', 'version']);
                const id = c.string(t.id, joinPath(path, 'track.id'), { min: 1, max: 80 });
                const ver = c.number(t.version, joinPath(path, 'track.version'), { integer: true, min: 1 });
                track = id !== undefined && ver !== undefined ? { id, version: ver } : undefined;
            } else track = undefined;
        }
        if (sceneId === undefined || sceneVersion === undefined || transform === undefined || track === undefined) return undefined;
        return { kind, sceneId, sceneVersion, transform, track };
    }
    return undefined;
}

function assists(c: Collector, v: unknown, path: string): LessonAssists | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    c.keys(r, path, ['control', 'altitude', 'maxSpeedMps', 'maxClimbMps', 'maxYawDps', 'autoArm', 'onTouch']);
    const control = c.oneOf(r.control, joinPath(path, 'control'), ['velocity', 'angle', 'horizon', 'acro'] as const);
    const altitude = c.oneOf(r.altitude, joinPath(path, 'altitude'), ['hold', 'own'] as const);
    const cap = (k: string, max: number): number | null | undefined => orNull(r[k], () => c.number(r[k], joinPath(path, k), { min: 0, max }));
    const maxSpeedMps = cap('maxSpeedMps', 60);
    const maxClimbMps = cap('maxClimbMps', 30);
    const maxYawDps = cap('maxYawDps', 1000);
    const autoArm = c.boolean(r.autoArm, joinPath(path, 'autoArm'));
    const onTouch = c.oneOf(r.onTouch, joinPath(path, 'onTouch'), ['bump', 'bump-recentre'] as const);
    if (control === undefined || altitude === undefined || maxSpeedMps === undefined || maxClimbMps === undefined || maxYawDps === undefined || autoArm === undefined || onTouch === undefined) return undefined;
    return { control, altitude, maxSpeedMps, maxClimbMps, maxYawDps, autoArm, onTouch };
}

/** A lesson's assists as data (also stored in a session manifest): the value or every reason it is wrong, paths relative to the object. */
export function validateAssists(input: unknown): Validation<LessonAssists> {
    const c = new Collector();
    const value = assists(c, input, '');
    return value !== undefined && c.ok ? { ok: true, value } : { ok: false, issues: c.issues };
}

function layers(c: Collector, v: unknown, path: string): LessonLayers | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    c.keys(r, path, ['on', 'heightBandM', 'hazardVoices']);
    const on = c.array(r.on, joinPath(path, 'on'), { min: 1, max: LAYER_IDS.length });
    let ids: (typeof LAYER_IDS)[number][] | undefined;
    if (on !== null) {
        if (!on.every((x) => typeof x === 'string' && (LAYER_IDS as readonly string[]).includes(x))) c.add(joinPath(path, 'on'), `must list layers of ${LAYER_IDS.join(', ')}`);
        else if (new Set(on).size !== on.length) c.add(joinPath(path, 'on'), 'must not repeat a layer');
        else ids = on as (typeof LAYER_IDS)[number][];
    }
    const heightBandM = r.heightBandM === null ? null : band(c, r.heightBandM, joinPath(path, 'heightBandM'));
    const hazardVoices = c.number(r.hazardVoices, joinPath(path, 'hazardVoices'), { integer: true, min: 0, max: 3 });
    if (ids === undefined || heightBandM === undefined || hazardVoices === undefined) return undefined;
    return { on: ids, heightBandM, hazardVoices };
}

function goal(c: Collector, v: unknown, path: string): Goal | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    const kind = c.oneOf(r.kind, joinPath(path, 'kind'), GOAL_KINDS);
    const at = (k: string): string => joinPath(path, k);
    const id = (k: string): string | undefined => c.string(r[k], at(k), { min: 1, max: 40, pattern: OBJECT_ID, patternHint: 'must be an object id (letters, digits, . _ -)' });
    switch (kind) {
        case 'name-cues': {
            c.keys(r, path, ['kind', 'cues', 'trials']);
            const cues = c.array(r.cues, at('cues'), { min: 1, max: CUE_IDS.length });
            if (cues !== null && !cues.every((x) => typeof x === 'string' && (CUE_IDS as readonly string[]).includes(x))) c.add(at('cues'), 'must list cue ids of src/i18n/catalog.ts CUE_IDS');
            const trials = c.number(r.trials, at('trials'), { integer: true, min: 0, max: 40 });
            return cues !== null && trials !== undefined && c.ok ? { kind, cues: cues as string[], trials } : undefined;
        }
        case 'locate': {
            c.keys(r, path, ['kind', 'trials']);
            const trials = c.number(r.trials, at('trials'), { integer: true, min: 1, max: 40 });
            return trials === undefined ? undefined : { kind, trials };
        }
        case 'hold-height': {
            c.keys(r, path, ['kind', 'bandM', 'seconds', 'shareMin']);
            const bandM = band(c, r.bandM, at('bandM'));
            const seconds = c.number(r.seconds, at('seconds'), { min: 1, max: 600 });
            const shareMin = c.number(r.shareMin, at('shareMin'), { min: 0.05, max: 1 });
            return bandM === undefined || seconds === undefined || shareMin === undefined ? undefined : { kind, bandM, seconds, shareMin };
        }
        case 'turn-to': {
            c.keys(r, path, ['kind', 'objectId', 'toleranceDeg']);
            const objectId = id('objectId');
            const toleranceDeg = c.number(r.toleranceDeg, at('toleranceDeg'), { min: 1, max: 90 });
            return objectId === undefined || toleranceDeg === undefined ? undefined : { kind, objectId, toleranceDeg };
        }
        case 'reach-zone': {
            c.keys(r, path, ['kind', 'zoneId', 'stop', 'stopBelowMps']);
            const zoneId = id('zoneId');
            const stop = c.boolean(r.stop, at('stop'));
            const stopBelowMps = c.number(r.stopBelowMps, at('stopBelowMps'), { min: 0.05, max: 10 });
            return zoneId === undefined || stop === undefined || stopBelowMps === undefined ? undefined : { kind, zoneId, stop, stopBelowMps };
        }
        case 'approach-stop': {
            c.keys(r, path, ['kind', 'objectId', 'stopWithinM']);
            const objectId = r.objectId === null ? null : id('objectId');
            const stopWithinM = c.number(r.stopWithinM, at('stopWithinM'), { min: 0.2, max: 50 });
            return objectId === undefined || stopWithinM === undefined ? undefined : { kind, objectId, stopWithinM };
        }
        case 'around': {
            c.keys(r, path, ['kind', 'objectId']);
            const objectId = id('objectId');
            return objectId === undefined ? undefined : { kind, objectId };
        }
        case 'fly-distance': {
            c.keys(r, path, ['kind', 'metres']);
            const metres = c.number(r.metres, at('metres'), { min: 1, max: 5000 });
            return metres === undefined ? undefined : { kind, metres };
        }
        case 'pass-gates': {
            c.keys(r, path, ['kind', 'gateIds', 'inOrder']);
            let gateIds: readonly string[] | 'all' | undefined;
            if (r.gateIds === 'all') gateIds = 'all';
            else {
                const arr = c.array(r.gateIds, at('gateIds'), { min: 1, max: 200 });
                if (arr !== null) {
                    if (!arr.every((x) => typeof x === 'string' && OBJECT_ID.test(x))) c.add(at('gateIds'), "must be 'all' or a list of object ids");
                    else gateIds = arr as string[];
                }
            }
            const inOrder = c.boolean(r.inOrder, at('inOrder'));
            return gateIds === undefined || inOrder === undefined ? undefined : { kind, gateIds, inOrder };
        }
        case 'name-shape': {
            c.keys(r, path, ['kind', 'objectId']);
            const objectId = id('objectId');
            return objectId === undefined ? undefined : { kind, objectId };
        }
        case 'timed-course': {
            c.keys(r, path, ['kind', 'laps']);
            const laps = c.number(r.laps, at('laps'), { integer: true, min: 1, max: 50 });
            return laps === undefined ? undefined : { kind, laps };
        }
        default:
            return undefined;
    }
}

/** The lesson format files were written in before v0.13: its pass rule counted blocks of attempts in a row. */
export const LESSON_FORMAT_V1 = 'shramko-sonic-lesson/1';
/** At most this many counted attempts pass a lesson, and at most this many failures in a row come before the go-on offer. */
export const MAX_REQUIRED = 3;
export const MAX_FAILS_IN_A_ROW = 3;

/** A format 1 rule ("required of attempts in blocks blocks in a row") as format 2 ("required in total, the offer after attempts failures in a row"). */
export function migratePassRule(v1: { readonly attempts: number; readonly required: number; readonly blocks: number; readonly maxTouches: number | null; readonly blocking: boolean }): PassRule {
    const required = Math.max(1, Math.min(MAX_REQUIRED, v1.required * v1.blocks));
    const attempts = v1.blocking ? MAX_FAILS_IN_A_ROW : Math.max(1, Math.min(MAX_FAILS_IN_A_ROW, v1.attempts * v1.blocks));
    return { attempts, required, blocks: 1, maxTouches: v1.maxTouches, blocking: v1.blocking };
}

function passRule(c: Collector, v: unknown, path: string, format: 1 | 2): PassRule | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    if (format === 1) {
        c.keys(r, path, ['attempts', 'required', 'blocks', 'maxTouches', 'blocking']);
        const attempts = c.number(r.attempts, joinPath(path, 'attempts'), { integer: true, min: 1, max: 100 });
        const required = c.number(r.required, joinPath(path, 'required'), { integer: true, min: 1, max: 100 });
        const blocks = c.number(r.blocks, joinPath(path, 'blocks'), { integer: true, min: 1, max: 20 });
        const maxTouches = orNull(r.maxTouches, () => c.number(r.maxTouches, joinPath(path, 'maxTouches'), { integer: true, min: 0, max: 100 }));
        const blocking = c.boolean(r.blocking, joinPath(path, 'blocking'));
        if (attempts !== undefined && required !== undefined && required > attempts) c.add(joinPath(path, 'required'), `must not exceed attempts (${attempts})`);
        if (attempts === undefined || required === undefined || blocks === undefined || maxTouches === undefined || blocking === undefined) return undefined;
        return migratePassRule({ attempts, required, blocks, maxTouches, blocking });
    }
    c.keys(r, path, ['attempts', 'required', 'maxTouches', 'blocking']);
    const attempts = c.number(r.attempts, joinPath(path, 'attempts'), { integer: true, min: 1, max: MAX_FAILS_IN_A_ROW });
    const required = c.number(r.required, joinPath(path, 'required'), { integer: true, min: 1, max: MAX_REQUIRED });
    const maxTouches = orNull(r.maxTouches, () => c.number(r.maxTouches, joinPath(path, 'maxTouches'), { integer: true, min: 0, max: 100 }));
    const blocking = c.boolean(r.blocking, joinPath(path, 'blocking'));
    if (attempts === undefined || required === undefined || maxTouches === undefined || blocking === undefined) return undefined;
    return { attempts, required, blocks: 1, maxTouches, blocking };
}

function checkpoint(c: Collector, v: unknown, path: string): Checkpoint | undefined {
    const r = c.record(v, path);
    if (r === null) return undefined;
    c.keys(r, path, ['id', 'pose', 'at', 'radiusM']);
    const id = c.string(r.id, joinPath(path, 'id'), { min: 1, max: 40, pattern: OBJECT_ID });
    const p = pose(c, r.pose, joinPath(path, 'pose'));
    const at = c.vec3(r.at, joinPath(path, 'at'));
    const radiusM = c.number(r.radiusM, joinPath(path, 'radiusM'), { min: 0.2, max: 50 });
    return id === undefined || p === undefined || at === undefined || radiusM === undefined ? undefined : { id, pose: p, at, radiusM };
}

const TOP = ['format', 'id', 'version', 'module', 'order', 'fastPath', 'title', 'intro', 'world', 'start', 'assists', 'layers', 'goals', 'pass', 'checkpoints', 'attemptLimitS', 'speech'] as const;

export function validateLesson(input: unknown): Validation<LessonDef> {
    const c = new Collector();
    const r = c.record(input, '');
    if (r === null) return c.result(undefined as never);
    c.keys(r, '', TOP);
    // format 1 (v0.12 and before) is read and migrated to format 2 (its pass rule counted blocks of attempts in a row)
    const format: 1 | 2 = r.format === LESSON_FORMAT_V1 ? 1 : 2;
    if (r.format !== FORMATS.lesson && r.format !== LESSON_FORMAT_V1 && r.format !== undefined) c.add('format', `must be '${FORMATS.lesson}' (or '${LESSON_FORMAT_V1}', migrated on load), got ${JSON.stringify(r.format)}`);
    const id = c.string(r.id, 'id', { min: 1, max: 40, pattern: LESSON_ID, patternHint: 'must be lower-case letters and digits in groups joined by single hyphens' });
    const version = c.number(r.version, 'version', { integer: true, min: 1 });
    const module = c.number(r.module, 'module', { integer: true, min: 0, max: MODULES.length - 1 });
    const order = c.number(r.order, 'order', { integer: true, min: 0, max: 999 });
    const fastPath = c.boolean(r.fastPath, 'fastPath');
    const title = r.title === undefined ? undefined : speechLine(c, r.title, 'title');
    let intro: IntroLine[] | undefined;
    if (r.intro !== undefined) {
        const arr = c.array(r.intro, 'intro', { min: 1, max: 12 });
        if (arr !== null) {
            const out: IntroLine[] = [];
            arr.forEach((x, i) => {
                const l = introLine(c, x, joinPath('intro', i));
                if (l !== undefined) out.push(l);
            });
            if (out.length === arr.length) intro = out;
        }
    }
    const w = r.world === undefined ? undefined : world(c, r.world, 'world');
    const start = r.start === undefined ? undefined : pose(c, r.start, 'start');
    const a = r.assists === undefined ? undefined : assists(c, r.assists, 'assists');
    const l = r.layers === undefined ? undefined : layers(c, r.layers, 'layers');
    let goals: Goal[] | undefined;
    if (r.goals !== undefined) {
        const arr = c.array(r.goals, 'goals', { min: 1, max: 8 });
        if (arr !== null) {
            const out: Goal[] = [];
            arr.forEach((g, i) => {
                const x = goal(c, g, joinPath('goals', i));
                if (x !== undefined) out.push(x);
            });
            if (out.length === arr.length) goals = out;
        }
    }
    const pass = r.pass === undefined ? undefined : passRule(c, r.pass, 'pass', format);
    let checkpoints: Checkpoint[] | undefined;
    if (r.checkpoints !== undefined) {
        const arr = c.array(r.checkpoints, 'checkpoints', { max: 50 });
        if (arr !== null) {
            const out: Checkpoint[] = [];
            arr.forEach((x, i) => {
                const cp = checkpoint(c, x, joinPath('checkpoints', i));
                if (cp !== undefined) out.push(cp);
            });
            if (new Set(out.map((x) => x.id)).size !== out.length) c.add('checkpoints', 'must not repeat a checkpoint id');
            if (out.length === arr.length) checkpoints = out;
        }
    }
    const attemptLimitS = orNull(r.attemptLimitS, () => c.number(r.attemptLimitS, 'attemptLimitS', { min: 5, max: 3600 }));
    let speech: LessonDef['speech'] | undefined;
    const sp = r.speech === undefined ? null : c.record(r.speech, 'speech');
    if (sp !== null) {
        c.keys(sp, 'speech', ['pass', 'retry', 'hints']);
        const p = speechLine(c, sp.pass, 'speech.pass');
        const rt = speechLine(c, sp.retry, 'speech.retry');
        const hints = lines(c, sp.hints, 'speech.hints', 0, 12);
        if (p !== undefined && rt !== undefined && hints !== undefined) speech = { pass: p, retry: rt, hints };
    }

    // the kind of lesson and its goals agree
    if (w !== undefined && goals !== undefined) {
        const asks = goals.filter((g) => (QUESTION_GOALS as readonly string[]).includes(g.kind)).length;
        if (w.kind === 'none' && asks !== goals.length) c.add('goals', "a lesson without a world (module 0, the ears) can only have 'name-cues' and 'locate' goals");
        if (w.kind !== 'none' && asks > 0) c.add('goals', "'name-cues' and 'locate' goals belong to a lesson without a world");
        if (module !== undefined && (module === 0) !== (w.kind === 'none')) c.add('world', 'module 0 (the ears) and only module 0 runs without a world');
        // M41-9: a scene of module 0 is heard through the lesson's own layers (a preview sounds whatever is on), so every scene must have its layer on
        if (w.kind === 'none' && l !== undefined && c.ok) {
            for (const cue of sceneCues({ world: w, goals })) {
                const why = sceneSilentReason(cue, l);
                if (why !== null) c.add('layers', `${why}: it would play without a sound`);
            }
        }
    }

    if (!c.ok) return c.result(undefined as never);
    return c.result({
        format: FORMATS.lesson,
        id: id as string,
        version: version as number,
        module: module as LessonDef['module'],
        order: order as number,
        fastPath: fastPath as boolean,
        title: title as SpeechLine,
        intro: intro as SpeechLine[],
        world: w as LessonWorldRef,
        start: start as Pose,
        assists: a as LessonAssists,
        layers: l as LessonLayers,
        goals: goals as Goal[],
        pass: pass as PassRule,
        checkpoints: checkpoints as Checkpoint[],
        attemptLimitS: attemptLimitS as number | null,
        speech: speech as LessonDef['speech']
    });
}

export function parseLesson(text: string): Validation<LessonDef> {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not JSON: ${(e as Error).message}` }] };
    }
    return validateLesson(value);
}

/** The canonical text of a lesson file in format 2 (sorted keys, two spaces, one final newline; the pass rule has no `blocks`). */
export function writeLesson(lesson: LessonDef): string {
    const { blocks: _blocks, ...pass } = lesson.pass;
    return `${canonicalPretty({ ...lesson, format: FORMATS.lesson, pass })}\n`;
}

// ------------------------------------------------------------------ paths

export const PATHS_FORMAT = 'shramko-sonic-paths/1';

/** lessons/paths.json: the full ladder and the fast path (spec section 3), lesson ids in order. */
export interface LessonPaths {
    readonly format: typeof PATHS_FORMAT;
    readonly full: readonly string[];
    readonly fast: readonly string[];
}

export function validatePaths(input: unknown): Validation<LessonPaths> {
    const c = new Collector();
    const r = c.record(input, '');
    if (r === null) return c.result(undefined as never);
    c.keys(r, '', ['format', 'full', 'fast']);
    if (r.format !== PATHS_FORMAT) c.add('format', `must be '${PATHS_FORMAT}'`);
    const list = (k: 'full' | 'fast'): string[] | undefined => {
        const arr = c.array(r[k], k, { min: 1, max: 200 });
        if (arr === null) return undefined;
        if (!arr.every((x) => typeof x === 'string' && LESSON_ID.test(x))) {
            c.add(k, 'must list lesson ids');
            return undefined;
        }
        if (new Set(arr).size !== arr.length) c.add(k, 'must not repeat a lesson');
        return arr as string[];
    };
    const full = list('full');
    const fast = list('fast');
    if (full !== undefined && fast !== undefined) {
        const missing = fast.filter((x) => !full.includes(x));
        if (missing.length > 0) c.add('fast', `lists lessons the full path does not have: ${missing.join(', ')}`);
        const positions = fast.map((x) => full.indexOf(x));
        if (!positions.every((p, i) => i === 0 || p > (positions[i - 1] as number))) c.add('fast', 'must keep the order of the full path');
    }
    if (!c.ok || full === undefined || fast === undefined) return c.result(undefined as never);
    return c.result({ format: PATHS_FORMAT, full, fast });
}

