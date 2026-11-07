import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    canonicalJson,
    checkSuccession,
    createRng,
    FORMATS,
    MAX_GATES,
    flownToScan,
    parseTrack,
    scanLengthToFlown,
    scanToFlown,
    shapeToFlown,
    trackDigest,
    TrackLibrary,
    trackToObjects,
    validateTrack,
    writeTrack,
    type SceneTransform,
    type TrackFile,
    type Vec3
} from '../src';

const clone = <T,>(x: T): T => structuredClone(x);

/** `obj` with the value at `path` replaced (undefined deletes the key). */
function set(obj: unknown, path: (string | number)[], value: unknown): unknown {
    const copy = clone(obj) as Record<string, unknown>;
    let at: Record<string, unknown> = copy;
    for (const key of path.slice(0, -1)) at = at[key as string] as Record<string, unknown>;
    const last = path[path.length - 1] as string;
    if (value === undefined) delete at[last];
    else at[last] = value;
    return copy;
}

const V1: TrackFile = {
    format: FORMATS.track,
    id: 'winter-garden-rings',
    version: 1,
    parent: null,
    title: 'Winter Garden: six rings',
    scene: { kind: 'scan', id: '7a475d38', version: 1 },
    transform: [5, 0, 0, 0],
    gates: [
        { id: 'g1', shape: { kind: 'ring', diameter: 1, tube: 0.02 }, pos: [1, 0.5, -2], quat: [1, 0, 0, 0], direction: 'forward' },
        { id: 'g2', shape: { kind: 'square', side: 0.8, bar: 0.03 }, pos: [2.5, 0.6, -3], quat: [Math.SQRT1_2, 0, Math.SQRT1_2, 0], direction: 'any' },
        { id: 'g3', shape: { kind: 'cube-frame', side: 0.8, bar: 0.03 }, pos: [3, 0.5, -4.5], quat: [1, 0, 0, 0], direction: 'forward' }
    ],
    laps: 1,
    start: { pos: [0, 0.4, 0], yawDeg: 0 },
    author: { kind: 'person', name: 'Andrii' },
    generator: null,
    created: '2026-11-07T10:30:00Z'
};

const v2 = (over: Partial<TrackFile> = {}): TrackFile => ({
    ...clone(V1),
    version: 2,
    parent: { id: 'winter-garden-rings', version: 1 },
    created: '2026-11-08T09:00:00Z',
    gates: clone(V1).gates.slice(0, 2),
    ...over
});

describe('the validator', () => {
    it('accepts a good track and a generated one', () => {
        expect(validateTrack(V1).ok).toBe(true);
        const generated = { ...clone(V1), generator: { name: 'ring-weaver', version: '1.0.0', seed: 42, params: { count: 6, turns: [1, -1] } }, author: { kind: 'generator', name: 'ring-weaver' } };
        expect(validateTrack(generated).ok).toBe(true);
        const noSeed = { ...clone(V1), generator: { name: 'by-hand', version: '1', seed: null, params: {} } };
        expect(validateTrack(noSeed).ok).toBe(true);
        expect(validateTrack(v2()).ok).toBe(true);
        expect(validateTrack({ ...clone(V1), start: null }).ok).toBe(true);
    });

    const cases: [string, unknown, string, RegExp][] = [
        ['not an object', 42, '', /must be an object/],
        ['another format', set(V1, ['format'], 'shramko-sonic-track/2'), 'format', /must be 'shramko-sonic-track\/1'/],
        ['an unknown key', set(V1, ['rating'], 5), 'rating', /not a known key/],
        ['a missing key', set(V1, ['gates'], undefined), 'gates', /is missing/],
        ['a bad id', set(V1, ['id'], '../etc'), 'id', /track id/],
        ['version 0', set(V1, ['version'], 0), 'version', /at least 1/],
        ['a fractional version', set(V1, ['version'], 1.5), 'version', /integer/],
        ['version 1 with a parent in the same track', set(V1, ['parent'], { id: 'winter-garden-rings', version: 1 }), 'parent', /cannot have a parent in the same track/],
        ['version 2 without a parent', set(set(V1, ['version'], 2), ['parent'], null), 'parent', /must name its parent/],
        ['version 2 with the wrong parent version', set(v2(), ['parent'], { id: 'winter-garden-rings', version: 3 }), 'parent', /must have the parent winter-garden-rings version 1/],
        ['version 2 with a parent in another track', set(v2(), ['parent'], { id: 'other', version: 1 }), 'parent', /must have the parent/],
        ['an empty title', set(V1, ['title'], ''), 'title', /at least 1 character/],
        ['a title with a control character', set(V1, ['title'], 'a\u0007b'), 'title', /control characters/],
        ['a scene of another kind', set(V1, ['scene', 'kind'], 'dream'), 'scene.kind', /must be one of scan, lesson/],
        ['scene version 0', set(V1, ['scene', 'version'], 0), 'scene.version', /at least 1/],
        ['a transform of three numbers', set(V1, ['transform'], [5, 0, 0]), 'transform', /four finite numbers/],
        ['a transform with scale 0', set(V1, ['transform'], [0, 0, 0, 0]), 'transform[0]', /above 0/],
        ['a transform with scale 5000', set(V1, ['transform'], [5000, 0, 0, 0]), 'transform[0]', /at most 1000/],
        ['a transform with a NaN', set(V1, ['transform'], [5, Number.NaN, 0, 0]), 'transform', /four finite numbers/],
        ['no gates', set(V1, ['gates'], []), 'gates', /at least 1 item/],
        ['too many gates', set(V1, ['gates'], Array.from({ length: MAX_GATES + 1 }, (_, i) => ({ ...clone(V1.gates[0]), id: `g${i}` }))), 'gates', /at most 200 items/],
        ['a repeated gate id', set(V1, ['gates', 1, 'id'], 'g1'), 'gates[1].id', /used twice/],
        ['a pillar as a gate', set(V1, ['gates', 0, 'shape'], { kind: 'pillar', radius: 1, height: 3 }), 'gates[0].shape.kind', /must be one of ring, square, cube-frame/],
        ['a ring whose tube is wider than its hole', set(V1, ['gates', 0, 'shape'], { kind: 'ring', diameter: 0.5, tube: 0.6 }), 'gates[0].shape.tube', /must not exceed the diameter/],
        ['a ring of zero diameter', set(V1, ['gates', 0, 'shape'], { kind: 'ring', diameter: 0, tube: 0.1 }), 'gates[0].shape.diameter', /at least 0.05/],
        ['a square with an unknown size key', set(V1, ['gates', 1, 'shape', 'width'], 1), 'gates[1].shape.width', /not a known key/],
        ['a bar thicker than the side', set(V1, ['gates', 1, 'shape'], { kind: 'square', side: 0.1, bar: 0.5 }), 'gates[1].shape.bar', /must not exceed the side/],
        ['a position of two numbers', set(V1, ['gates', 0, 'pos'], [1, 2]), 'gates[0].pos', /three finite numbers/],
        ['a quaternion that is not a unit', set(V1, ['gates', 0, 'quat'], [2, 0, 0, 0]), 'gates[0].quat', /unit quaternion/],
        ['a quaternion of three numbers', set(V1, ['gates', 0, 'quat'], [1, 0, 0]), 'gates[0].quat', /four finite numbers/],
        ['a bad direction', set(V1, ['gates', 0, 'direction'], 'backward'), 'gates[0].direction', /must be one of forward, any/],
        ['zero laps', set(V1, ['laps'], 0), 'laps', /at least 1/],
        ['a hundred laps', set(V1, ['laps'], 100), 'laps', /at most 99/],
        ['a start with a yaw of 400', set(V1, ['start', 'yawDeg'], 400), 'start.yawDeg', /at most 360/],
        ['an author of another kind', set(V1, ['author', 'kind'], 'cat'), 'author.kind', /must be one of person, agent, generator/],
        ['a generator seed with a fraction', set(V1, ['generator'], { name: 'g', version: '1', seed: 1.5, params: {} }), 'generator.seed', /integer/],
        ['generator params that JSON cannot hold', set(V1, ['generator'], { name: 'g', version: '1', seed: 1, params: { x: Number.NaN } }), 'generator.params', /not a JSON number/],
        ['a date without a zone', set(V1, ['created'], '2026-11-07T10:30:00'), 'created', /ISO 8601/],
        ['a date in words', set(V1, ['created'], 'yesterday'), 'created', /ISO 8601/],
        ['a date that does not exist', set(V1, ['created'], '2026-13-45T25:61:00Z'), 'created', /ISO 8601/]
    ];

    it.each(cases)('refuses %s', (_name, data, path, message) => {
        const v = validateTrack(data);
        expect(v.ok).toBe(false);
        if (v.ok) return;
        expect(v.issues.find((i) => i.path === path && message.test(i.message)), JSON.stringify(v.issues)).toBeDefined();
    });

    it('reports every problem at once', () => {
        const bad = set(set(set(V1, ['laps'], 0), ['gates', 0, 'direction'], 'x'), ['title'], '');
        const v = validateTrack(bad);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.issues.map((i) => i.path).sort()).toEqual(['gates[0].direction', 'laps', 'title']);
    });

    it('text that is not JSON', () => {
        const v = parseTrack('[');
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.issues[0]!.message).toMatch(/not valid JSON/);
    });
});

describe('the canonical writer', () => {
    it('sorts keys, keeps positions on one line, and is stable', () => {
        const text = writeTrack(V1);
        expect(text.endsWith('}\n')).toBe(true);
        expect(text).toContain('"pos": [1, 0.5, -2]');
        expect(text).toContain('"transform": [5, 0, 0, 0]');
        const parsed = parseTrack(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value).toEqual(V1);
        expect(writeTrack(parsed.value)).toBe(text);
        // the keys of every object come out in sorted order
        const topKeys = Object.keys(JSON.parse(text) as object);
        expect(topKeys).toEqual([...topKeys].sort());
    });

    it('writes the same text for the same track however it was built', () => {
        const shuffled = Object.fromEntries(Object.entries(V1).reverse()) as unknown as TrackFile;
        expect(writeTrack(shuffled)).toBe(writeTrack(V1));
        expect(trackDigest(shuffled)).toBe(trackDigest(V1));
    });

    it('the digest is the SHA-256 of the canonical JSON, and any change moves it', () => {
        expect(trackDigest(V1)).toBe(createHash('sha256').update(canonicalJson(V1)).digest('hex'));
        const moved = clone(V1) as unknown as { gates: { pos: Vec3 }[] };
        moved.gates[0]!.pos = [1, 0.5, -2.0001];
        expect(trackDigest(moved as unknown as TrackFile)).not.toBe(trackDigest(V1));
    });
});

describe('a change is a new version, never an edit in place', () => {
    it('accepts the next version that names its parent and changes something', () => {
        expect(checkSuccession(V1, v2()).ok).toBe(true);
    });

    const bad: [string, TrackFile, string, RegExp][] = [
        ['another id', v2({ id: 'other-track', parent: { id: 'winter-garden-rings', version: 1 } }), 'id', /keeps the id 'winter-garden-rings'/],
        ['a skipped number', v2({ version: 3, parent: { id: 'winter-garden-rings', version: 2 } }), 'version', /must be 2/],
        ['the wrong parent', v2({ parent: { id: 'winter-garden-rings', version: 7 } }), 'parent', /must name winter-garden-rings version 1/],
        ['a date before the version it changes', v2({ created: '2026-11-01T00:00:00Z' }), 'created', /not be earlier/],
        ['another scene', v2({ scene: { kind: 'scan', id: 'deadbeef', version: 1 } }), 'scene', /another track/],
        ['no change at all', { ...clone(V1), version: 2, parent: { id: 'winter-garden-rings', version: 1 }, created: '2026-11-08T09:00:00Z' }, '', /nothing changed/]
    ];
    it.each(bad)('refuses %s', (_name, next, path, message) => {
        const r = checkSuccession(V1, next);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.find((i) => i.path === path && message.test(i.message)), JSON.stringify(r.issues)).toBeDefined();
    });

    it('a new scene version is a change, so a re-scan can republish the course', () => {
        const r = checkSuccession(V1, v2({ gates: clone(V1).gates, scene: { kind: 'scan', id: '7a475d38', version: 2 } }));
        expect(r.ok).toBe(true);
    });
});

describe('TrackLibrary', () => {
    it('stores versions in order and answers latest, get and history', () => {
        const lib = new TrackLibrary();
        expect(lib.add(V1)).toEqual({ ok: true, added: true });
        expect(lib.add(v2())).toEqual({ ok: true, added: true });
        expect(lib.latest('winter-garden-rings')!.version).toBe(2);
        expect(lib.get('winter-garden-rings', 1)).toEqual(V1);
        expect(lib.history('winter-garden-rings').map((t) => t.version)).toEqual([1, 2]);
        expect(lib.history('nothing')).toEqual([]);
        expect(lib.latest('nothing')).toBeUndefined();
        expect(lib.ids()).toEqual(['winter-garden-rings']);
    });

    it('takes the same version again as a no-op', () => {
        const lib = new TrackLibrary();
        lib.add(V1);
        expect(lib.add(clone(V1))).toEqual({ ok: true, added: false });
        expect(lib.history('winter-garden-rings')).toHaveLength(1);
    });

    it('refuses a published version with other content: it is never edited in place', () => {
        const lib = new TrackLibrary();
        lib.add(V1);
        const edited = { ...clone(V1), title: 'Winter Garden: six rings, moved a bit' };
        const r = lib.add(edited);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues[0]!.message).toMatch(/never edited.*publish version 2/);
        expect(lib.get('winter-garden-rings', 1)!.title).toBe(V1.title);
    });

    it('refuses a version whose parent is missing, or that does not succeed it', () => {
        const lib = new TrackLibrary();
        expect(lib.add(v2()).ok).toBe(false); // no version 1 yet
        lib.add(V1);
        const r = lib.add(v2({ created: '2026-01-01T00:00:00Z' }));
        expect(r.ok).toBe(false);
        expect(lib.history('winter-garden-rings')).toHaveLength(1);
    });

    it('accepts a fork: version 1 of a new track whose parent is another track', () => {
        const lib = new TrackLibrary();
        lib.add(V1);
        const fork = { ...clone(V1), id: 'winter-garden-rings-hard', parent: { id: 'winter-garden-rings', version: 1 }, title: 'Harder' };
        expect(lib.add(fork)).toEqual({ ok: true, added: true });
        expect(lib.ids()).toEqual(['winter-garden-rings', 'winter-garden-rings-hard']);
    });

    it('refuses what is not a track, with the reasons', () => {
        const r = new TrackLibrary().add({ nonsense: true });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.length).toBeGreaterThan(5);
    });
});

describe('from the scan frame to the flown world', () => {
    const T: SceneTransform = [5, 1, 2, 3];

    it('scales and shifts a point, and inverts it', () => {
        expect(scanToFlown(T, [1, 1, 1])).toEqual([6, 7, 8]);
        expect(scanToFlown([1, 0, 0, 0], [3, 4, 5])).toEqual([3, 4, 5]);
        expect(scanLengthToFlown(T, 0.4)).toBe(2);
        const rng = createRng(2);
        for (let i = 0; i < 100; i++) {
            const p: Vec3 = [rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50)];
            const back = flownToScan(T, scanToFlown(T, p));
            for (let k = 0; k < 3; k++) expect(Math.abs((back[k] as number) - (p[k] as number))).toBeLessThan(1e-12);
        }
    });

    it('scales every size of every shape and nothing else', () => {
        expect(shapeToFlown({ kind: 'ring', diameter: 1, tube: 0.02 }, T)).toEqual({ kind: 'ring', diameter: 5, tube: 0.1 });
        expect(shapeToFlown({ kind: 'square', side: 0.8, bar: 0.03 }, T)).toEqual({ kind: 'square', side: 4, bar: 0.15 });
        expect(shapeToFlown({ kind: 'cube-frame', side: 1, bar: 0.1 }, T)).toEqual({ kind: 'cube-frame', side: 5, bar: 0.5 });
        expect(shapeToFlown({ kind: 'pillar', radius: 0.1, height: 0.6 }, T)).toEqual({ kind: 'pillar', radius: 0.5, height: 3 });
        expect(shapeToFlown({ kind: 'box', size: [1, 2, 3] }, T)).toEqual({ kind: 'box', size: [5, 10, 15] });
        expect(shapeToFlown({ kind: 'zone', size: [1, 1, 1] }, T)).toEqual({ kind: 'zone', size: [5, 5, 5] });
    });

    it('turns the gates of a track into objects of the flown world, in course order', () => {
        const objects = trackToObjects(V1);
        expect(objects.map((o) => [o.id, o.order])).toEqual([['g1', 0], ['g2', 1], ['g3', 2]]);
        expect(objects[0]!.pos).toEqual([5, 2.5, -10]); // the track's own transform [5, 0, 0, 0]
        expect(objects[0]!.shape).toEqual({ kind: 'ring', diameter: 5, tube: 0.1 });
        expect(objects[1]!.quat).toEqual(V1.gates[1]!.quat); // the transform has no rotation
        for (const o of objects) {
            expect(o.solid).toBe(false); // a scan's collider is its own walls
            expect(o.material).toBe('obstacle');
        }
        expect(trackToObjects(V1, { solid: true }).every((o) => o.solid)).toBe(true);
    });

    it('stays on the walls when the scene is rescaled: the scan-frame point is the same, the flown one follows the transform', () => {
        const at5 = trackToObjects(V1, { transform: [5, 0, 0, 0] });
        const at10 = trackToObjects(V1, { transform: [10, 0, 0, 0] });
        for (let i = 0; i < at5.length; i++) {
            for (let k = 0; k < 3; k++) expect(at10[i]!.pos[k]).toBeCloseTo(2 * (at5[i]!.pos[k] as number), 12);
            const a = at5[i]!.shape, b = at10[i]!.shape;
            expect(a.kind).toBe(b.kind);
        }
        expect((at10[0]!.shape as { diameter: number }).diameter).toBe(10);
        // and back to the scan frame it is the file's own coordinates
        const back = flownToScan([10, 0, 0, 0], at10[2]!.pos);
        for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(V1.gates[2]!.pos[k] as number, 12);
    });
});
