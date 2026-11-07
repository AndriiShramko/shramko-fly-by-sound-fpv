// Track files (contract TrackFile): validator, parser and canonical writer. A track is the seed of
// stage 2 (generated courses, ratings, editing), so the format is general and strict: a scene, an
// ordered list of gates with a type, a pose and a size, an author, and how it was made. Every
// position and size is in the scan frame (or the lesson world's frame); flown = s * p + t.
//
// Versions: a track is never edited in place. A change is a new file with version + 1 and `parent`
// naming the version it changes (checkSuccession, TrackLibrary). Version 1 has no parent, or a
// parent in another track (a fork).
import type { ObjectShape, TrackFile, TrackGate, TrackRef } from '../contract';
import { FORMATS } from '../contract';
import { canonicalJson, canonicalPretty } from '../util/canonical';
import { Collector, isIsoDate, isRecord, joinPath, type Validation } from '../util/check';
import { sha256Hex } from '../util/sha256';

const TOP_KEYS = ['format', 'id', 'version', 'parent', 'title', 'scene', 'transform', 'gates', 'laps', 'start', 'author', 'generator', 'created'] as const;

export const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
export const MAX_GATES = 200;
/** The shapes a track gate can have: a thing to fly through. */
export const GATE_KINDS = ['ring', 'square', 'cube-frame'] as const;

const CONTROL = /[\u0000-\u001f]/;

function checkShape(c: Collector, v: unknown, path: string): ObjectShape | undefined {
    const rec = v === undefined ? null : c.record(v, path);
    if (rec === null) return undefined;
    const kind = c.oneOf(rec.kind, joinPath(path, 'kind'), GATE_KINDS);
    if (kind === undefined) return undefined;
    if (kind === 'ring') {
        c.keys(rec, path, ['kind', 'diameter', 'tube']);
        const diameter = c.number(rec.diameter, joinPath(path, 'diameter'), { min: 0.05, max: 100 });
        const tube = c.number(rec.tube, joinPath(path, 'tube'), { min: 0.005, max: 10 });
        if (diameter !== undefined && tube !== undefined) {
            if (tube > diameter) c.add(joinPath(path, 'tube'), `must not exceed the diameter (${tube} > ${diameter})`);
            return { kind, diameter, tube };
        }
        return undefined;
    }
    c.keys(rec, path, ['kind', 'side', 'bar']);
    const side = c.number(rec.side, joinPath(path, 'side'), { min: 0.05, max: 100 });
    const bar = c.number(rec.bar, joinPath(path, 'bar'), { min: 0.005, max: 10 });
    if (side !== undefined && bar !== undefined) {
        if (bar > side) c.add(joinPath(path, 'bar'), `must not exceed the side (${bar} > ${side})`);
        return { kind, side, bar };
    }
    return undefined;
}

function checkRef(c: Collector, v: unknown, path: string): TrackRef | undefined {
    const rec = c.record(v, path);
    if (rec === null) return undefined;
    c.keys(rec, path, ['id', 'version']);
    const id = c.string(rec.id, joinPath(path, 'id'), { pattern: TRACK_ID, patternHint: 'must be a track id: letters, digits, dot, underscore, hyphen' });
    const version = c.number(rec.version, joinPath(path, 'version'), { integer: true, min: 1, max: 9999 });
    return id !== undefined && version !== undefined ? { id, version } : undefined;
}

export function validateTrack(input: unknown): Validation<TrackFile> {
    const c = new Collector();
    const root = c.record(input, '');
    if (root === null) return { ok: false, issues: c.issues };
    c.keys(root, '', TOP_KEYS);

    if (root.format !== undefined && root.format !== FORMATS.track) c.add('format', `must be '${FORMATS.track}', got ${JSON.stringify(root.format)}`);
    const id = c.string(root.id, 'id', { pattern: TRACK_ID, patternHint: 'must be a track id: letters, digits, dot, underscore, hyphen, at most 80 characters' });
    const version = c.number(root.version, 'version', { integer: true, min: 1, max: 9999 });

    let parent: TrackRef | null | undefined;
    if (root.parent === null) parent = null;
    else if (root.parent !== undefined) parent = checkRef(c, root.parent, 'parent');
    if (id !== undefined && version !== undefined && parent !== undefined) {
        if (version === 1) {
            if (parent !== null && parent.id === id) c.add('parent', 'version 1 cannot have a parent in the same track');
        } else if (parent === null) c.add('parent', `version ${version} must name its parent, version ${version - 1}`);
        else if (parent.id !== id || parent.version !== version - 1) c.add('parent', `version ${version} must have the parent ${id} version ${version - 1}, got ${parent.id} version ${parent.version}`);
    }

    const title = c.string(root.title, 'title', { min: 1, max: 120 });
    if (title !== undefined && CONTROL.test(title)) c.add('title', 'must not contain control characters');

    let scene: TrackFile['scene'] | undefined;
    const rawScene = root.scene === undefined ? null : c.record(root.scene, 'scene');
    if (rawScene !== null) {
        c.keys(rawScene, 'scene', ['kind', 'id', 'version']);
        const kind = c.oneOf(rawScene.kind, 'scene.kind', ['scan', 'lesson'] as const);
        const sceneId = c.string(rawScene.id, 'scene.id', { min: 1, max: 80 });
        const sceneVersion = c.number(rawScene.version, 'scene.version', { integer: true, min: 1 });
        if (kind !== undefined && sceneId !== undefined && sceneVersion !== undefined) scene = { kind, id: sceneId, version: sceneVersion };
    }

    let transform: TrackFile['transform'] | undefined;
    if (root.transform !== undefined) {
        const t = c.array(root.transform, 'transform');
        if (t !== null) {
            if (t.length !== 4 || !t.every((x) => typeof x === 'number' && Number.isFinite(x))) c.add('transform', 'must be four finite numbers [s, tx, ty, tz]');
            else if ((t[0] as number) <= 0 || (t[0] as number) > 1000) c.add('transform[0]', `the scale must be above 0 and at most 1000, got ${String(t[0])}`);
            else transform = t as unknown as TrackFile['transform'];
        }
    }

    const gates: TrackGate[] = [];
    const rawGates = root.gates === undefined ? null : c.array(root.gates, 'gates', { min: 1, max: MAX_GATES });
    if (rawGates !== null) {
        const seen = new Set<string>();
        rawGates.forEach((g, i) => {
            const path = joinPath('gates', i);
            const rec = c.record(g, path);
            if (rec === null) return;
            c.keys(rec, path, ['id', 'shape', 'pos', 'quat', 'direction']);
            const gid = c.string(rec.id, joinPath(path, 'id'), { pattern: GATE_ID, patternHint: 'must be a gate id: letters, digits, dot, underscore, hyphen, at most 40 characters' });
            if (gid !== undefined) {
                if (seen.has(gid)) c.add(joinPath(path, 'id'), `'${gid}' is used twice`);
                seen.add(gid);
            }
            const shape = checkShape(c, rec.shape, joinPath(path, 'shape'));
            const pos = c.vec3(rec.pos, joinPath(path, 'pos'));
            let quat: TrackGate['quat'] | undefined;
            if (rec.quat !== undefined) {
                const q = rec.quat;
                if (!Array.isArray(q) || q.length !== 4 || !q.every((x) => typeof x === 'number' && Number.isFinite(x))) c.add(joinPath(path, 'quat'), 'must be four finite numbers [w, x, y, z]');
                else if (Math.abs(Math.hypot(...(q as number[])) - 1) > 1e-3) c.add(joinPath(path, 'quat'), `must be a unit quaternion, its length is ${Math.hypot(...(q as number[])).toFixed(4)}`);
                else quat = q as unknown as TrackGate['quat'];
            }
            const direction = c.oneOf(rec.direction, joinPath(path, 'direction'), ['forward', 'any'] as const);
            if (gid !== undefined && shape !== undefined && pos !== undefined && quat !== undefined && direction !== undefined) gates.push({ id: gid, shape, pos, quat, direction });
        });
    }

    const laps = c.number(root.laps, 'laps', { integer: true, min: 1, max: 99 });

    let start: TrackFile['start'] | undefined;
    if (root.start === null) start = null;
    else if (root.start !== undefined) {
        const rec = c.record(root.start, 'start');
        if (rec !== null) {
            c.keys(rec, 'start', ['pos', 'yawDeg']);
            const pos = c.vec3(rec.pos, 'start.pos');
            const yawDeg = c.number(rec.yawDeg, 'start.yawDeg', { min: -360, max: 360 });
            if (pos !== undefined && yawDeg !== undefined) start = { pos, yawDeg };
        }
    }

    let author: TrackFile['author'] | undefined;
    const rawAuthor = root.author === undefined ? null : c.record(root.author, 'author');
    if (rawAuthor !== null) {
        c.keys(rawAuthor, 'author', ['kind', 'name']);
        const kind = c.oneOf(rawAuthor.kind, 'author.kind', ['person', 'agent', 'generator'] as const);
        const name = c.string(rawAuthor.name, 'author.name', { min: 1, max: 80 });
        if (name !== undefined && CONTROL.test(name)) c.add('author.name', 'must not contain control characters');
        if (kind !== undefined && name !== undefined) author = { kind, name };
    }

    let generator: TrackFile['generator'] | undefined;
    if (root.generator === null) generator = null;
    else if (root.generator !== undefined) {
        const rec = c.record(root.generator, 'generator');
        if (rec !== null) {
            c.keys(rec, 'generator', ['name', 'version', 'seed', 'params']);
            const name = c.string(rec.name, 'generator.name', { min: 1, max: 80 });
            const gv = c.string(rec.version, 'generator.version', { min: 1, max: 40 });
            let seed: number | null | undefined;
            if (rec.seed === null) seed = null;
            else seed = c.number(rec.seed, 'generator.seed', { integer: true });
            let params: Record<string, unknown> | undefined;
            if (isRecord(rec.params)) {
                try {
                    canonicalJson(rec.params);
                    params = rec.params;
                } catch (e) {
                    c.add('generator.params', e instanceof Error ? e.message : 'cannot be written as JSON');
                }
            } else if (rec.params !== undefined) c.add('generator.params', 'must be an object');
            if (name !== undefined && gv !== undefined && seed !== undefined && params !== undefined) generator = { name, version: gv, seed, params };
        }
    }

    const created = c.string(root.created, 'created');
    if (created !== undefined && !isIsoDate(created)) c.add('created', `must be an ISO 8601 date and time with a zone, like 2026-11-07T10:30:00Z, got '${created}'`);

    if (!c.ok || id === undefined || version === undefined || parent === undefined || title === undefined || scene === undefined || transform === undefined || laps === undefined || start === undefined || author === undefined || generator === undefined || created === undefined) {
        return { ok: false, issues: c.issues };
    }
    return { ok: true, value: { format: FORMATS.track, id, version, parent, title, scene, transform, gates, laps, start, author, generator, created } };
}

export function parseTrack(text: string): Validation<TrackFile> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return validateTrack(data);
}

/** The canonical text of a track file: keys sorted, two spaces of indent, a final newline. */
export function writeTrack(track: TrackFile): string {
    return `${canonicalPretty(track)}\n`;
}

/** SHA-256 of the track's canonical JSON: what "this exact version" means. */
export function trackDigest(track: TrackFile): string {
    return sha256Hex(canonicalJson(track));
}
