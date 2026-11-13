import { describe, expect, it } from 'vitest';
import {
    createRng,
    defaultPrefs,
    FORMATS,
    getBuiltinTheme,
    isInScale,
    noteHz,
    parsePrefs,
    PREFS_LIMITS,
    readPrefs,
    shiftNote,
    updatePrefs,
    validatePrefs,
    writePrefs,
    type SonicPrefs
} from '../src';

const clone = <T,>(x: T): T => structuredClone(x);
function set(obj: unknown, key: string, value: unknown): unknown {
    const copy = clone(obj) as Record<string, unknown>;
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
}

describe('the defaults', () => {
    const d = defaultPrefs();

    it('are what the spec says: soft theme, not calm, up is higher, the app speaks, captions on, the motor off (train 2, the owner) at its calibrated level and not chosen, the full path, the heading frame, the target tone on, up and down by direction too (lane s13-elev), the target hum as a beacon (lane sonic-beacon)', () => {
        expect(d).toEqual({
            format: FORMATS.prefs,
            theme: 'soft',
            calm: false,
            heightPolarity: 'up-higher',
            layerGainDb: {},
            layerPitchSteps: {},
            selfVoice: true,
            speechRate: 1,
            captions: true,
            motorSound: false,
            path: 'full',
            listenerFrame: 'heading',
            heightTarget: true,
            motorGainDb: 0,
            heightDirection: true,
            beacon: true,
            motorChoice: false
        });
    });

    it("up and down by direction (lane s13-elev, owner's message 42): on by default, optional (a document without it is valid and reads as on), a bad one refused", () => {
        expect(validatePrefs({ ...d, heightDirection: false }).ok).toBe(true);
        const { heightDirection: _gone, ...without } = d;
        expect(validatePrefs(without).ok).toBe(true);
        // a document saved by v0.13 (it has heightTarget and no heightDirection): on, with no issue
        const v013 = readPrefs(without);
        expect(v013.prefs.heightDirection).toBe(true);
        expect(v013.issues).toEqual([]);
        // the pilot's off is kept
        expect(readPrefs({ ...d, heightDirection: false }).prefs.heightDirection).toBe(false);
        expect(validatePrefs({ ...d, heightDirection: 'on' }).ok).toBe(false);
        const bad = readPrefs({ ...d, heightDirection: 1 });
        expect(bad.prefs.heightDirection).toBe(true);
        expect(bad.issues.map((i) => i.path)).toEqual(['heightDirection']);
        expect(updatePrefs(d, { heightDirection: false }).ok).toBe(true);
    });

    it("the pilot's motor level (review m3): -24 to 6 dB, optional (a document without it is valid), a bad one refused", () => {
        expect(validatePrefs({ ...d, motorGainDb: -12 }).ok).toBe(true);
        const { motorGainDb: _gone, ...without } = d;
        expect(validatePrefs(without).ok).toBe(true);
        expect(validatePrefs({ ...d, motorGainDb: 9 }).ok).toBe(false);
        expect(validatePrefs({ ...d, motorGainDb: 'loud' }).ok).toBe(false);
        const read = readPrefs({ ...d, motorGainDb: 40 });
        expect(read.prefs.motorGainDb).toBe(0);
        expect(read.issues.map((i) => i.path)).toEqual(['motorGainDb']);
    });

    it('are valid, and fresh every time', () => {
        expect(validatePrefs(d).ok).toBe(true);
        const a = defaultPrefs() as { layerGainDb: Record<string, number> };
        a.layerGainDb['voice'] = 3;
        expect(defaultPrefs().layerGainDb).toEqual({});
    });
});

describe('the canonical writer', () => {
    it('round-trips, ends with a newline and sorts the keys', () => {
        const p: SonicPrefs = { ...defaultPrefs(), calm: true, layerGainDb: { voice: 3, height: -6 }, layerPitchSteps: { target: 2 } };
        const text = writePrefs(p);
        expect(text.endsWith('}\n')).toBe(true);
        const back = parsePrefs(text);
        expect(back.ok).toBe(true);
        if (back.ok) expect(back.value).toEqual(p);
        const keys = Object.keys(JSON.parse(text) as object);
        expect(keys).toEqual([...keys].sort());
        expect(text.indexOf('"height"')).toBeLessThan(text.indexOf('"voice"'));
    });

    it('writes the same text however the object was built', () => {
        const a = defaultPrefs();
        const b = Object.fromEntries(Object.entries(a).reverse()) as unknown as SonicPrefs;
        expect(writePrefs(b)).toBe(writePrefs(a));
    });
});

describe('the strict validator refuses bad values with their reason', () => {
    const cases: [string, unknown, string, RegExp][] = [
        ['not an object', 'prefs', '', /must be an object/],
        ['an array', [], '', /must be an object/],
        ['an unknown key', set(defaultPrefs(), 'volume', 1), 'volume', /not a known key/],
        ['a missing key', set(defaultPrefs(), 'captions', undefined), 'captions', /is missing/],
        ['another format', set(defaultPrefs(), 'format', 'shramko-sonic-prefs/2'), 'format', /must be 'shramko-sonic-prefs\/1'/],
        ['an empty theme id', set(defaultPrefs(), 'theme', ''), 'theme', /at least 1 character/],
        ['a theme id with capitals', set(defaultPrefs(), 'theme', 'Soft'), 'theme', /theme id/],
        ['calm as a word', set(defaultPrefs(), 'calm', 'yes'), 'calm', /true or false/],
        ['a polarity that is neither', set(defaultPrefs(), 'heightPolarity', 'sideways'), 'heightPolarity', /up-higher, up-lower/],
        ['a layer gain too loud', set(defaultPrefs(), 'layerGainDb', { voice: 30 }), 'layerGainDb.voice', /at most 12/],
        ['a layer gain too quiet', set(defaultPrefs(), 'layerGainDb', { voice: -60 }), 'layerGainDb.voice', /at least -24/],
        ['an unknown layer', set(defaultPrefs(), 'layerGainDb', { bass: 1 }), 'layerGainDb.bass', /not a layer/],
        ['a pitch offset with a fraction', set(defaultPrefs(), 'layerPitchSteps', { height: 1.5 }), 'layerPitchSteps.height', /integer/],
        ['a pitch offset of 13 steps', set(defaultPrefs(), 'layerPitchSteps', { height: 13 }), 'layerPitchSteps.height', /at most 12/],
        ['a speech rate of 0.1', set(defaultPrefs(), 'speechRate', 0.1), 'speechRate', /at least 0.5/],
        ['a speech rate of 3', set(defaultPrefs(), 'speechRate', 3), 'speechRate', /at most 2/],
        ['a path that is neither', set(defaultPrefs(), 'path', 'both'), 'path', /full, fast/],
        ['an unknown listener frame', set(defaultPrefs(), 'listenerFrame', 'world'), 'listenerFrame', /heading, body/],
        ['a layer map that is a list', set(defaultPrefs(), 'layerGainDb', [1]), 'layerGainDb', /must be an object/],
        ['a gain that is not a number', set(defaultPrefs(), 'layerGainDb', { height: 'loud' }), 'layerGainDb.height', /finite number/]
    ];

    it.each(cases)('%s', (_name, data, path, message) => {
        const v = validatePrefs(data);
        expect(v.ok).toBe(false);
        if (v.ok) return;
        expect(v.issues.find((i) => i.path === path && message.test(i.message)), JSON.stringify(v.issues)).toBeDefined();
    });

    it('reports every problem at once', () => {
        const bad = set(set(set(defaultPrefs(), 'speechRate', 9), 'path', 'x'), 'captions', 1);
        const v = validatePrefs(bad);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.issues.map((i) => i.path).sort()).toEqual(['captions', 'path', 'speechRate']);
    });

    it('accepts the limits themselves', () => {
        const edge = { ...defaultPrefs(), speechRate: PREFS_LIMITS.speechRate.max, layerGainDb: { voice: PREFS_LIMITS.gainDb.min, height: PREFS_LIMITS.gainDb.max }, layerPitchSteps: { target: -12, shape: 12 } };
        expect(validatePrefs(edge).ok).toBe(true);
    });

    it('text that is not JSON', () => {
        const v = parsePrefs('{');
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.issues[0]!.message).toMatch(/not valid JSON/);
    });
});

describe('the lenient reader never fails and never returns an invalid value', () => {
    it('nothing stored gives the defaults without a complaint', () => {
        expect(readPrefs(undefined)).toEqual({ prefs: defaultPrefs(), issues: [] });
        expect(readPrefs(null)).toEqual({ prefs: defaultPrefs(), issues: [] });
        expect(readPrefs({}).prefs).toEqual(defaultPrefs());
        expect(readPrefs({}).issues).toEqual([]);
    });

    it('keeps what is good, replaces what is bad and says which', () => {
        const stored = { theme: 'race', calm: true, speechRate: 9, captions: 'no', layerGainDb: { voice: 3, height: 99, bass: 1 }, volume: 11 };
        const { prefs, issues } = readPrefs(stored);
        expect(prefs.theme).toBe('race');
        expect(prefs.calm).toBe(true);
        expect(prefs.speechRate).toBe(1); // replaced
        expect(prefs.captions).toBe(true); // replaced
        expect(prefs.layerGainDb).toEqual({ voice: 3 });
        expect(prefs).not.toHaveProperty('volume');
        expect(validatePrefs(prefs).ok).toBe(true);
        expect(issues.map((i) => i.path).sort()).toEqual(['captions', 'layerGainDb.bass', 'layerGainDb.height', 'speechRate', 'volume']);
    });

    it("the motor sound is the pilot's only when he chose it (train 2, the owner): a stored true without motorChoice reads as off, with it it stays; the old false-to-true migration is gone", () => {
        // what the simulator saved from v0.13 on after any change: the whole document, motorSound true (the default then)
        const v013 = { ...defaultPrefs(), theme: 'clear', motorSound: true } as Record<string, unknown>;
        delete v013['motorChoice'];
        const old = readPrefs(v013);
        expect(old.prefs.motorSound).toBe(false);
        expect(old.prefs.theme).toBe('clear');
        expect(old.issues.map((i) => i.path)).toEqual(['motorSound']);
        expect(validatePrefs(old.prefs).ok).toBe(true);
        expect(readPrefs({ ...v013, motorChoice: false }).prefs.motorSound).toBe(false);
        // the pilot switched it on himself: kept
        const on = readPrefs({ ...v013, motorChoice: true });
        expect(on.prefs.motorSound).toBe(true);
        expect(on.prefs.motorChoice).toBe(true);
        expect(on.issues).toEqual([]);
        // a document saved before v0.13 (no heightTarget) with false stays off: v0.13's migration to true is gone
        const v012 = { ...v013, motorSound: false } as Record<string, unknown>;
        delete v012['heightTarget'];
        const older = readPrefs(v012);
        expect(older.prefs.motorSound).toBe(false);
        expect(older.issues).toEqual([]);
        // a chosen off stays off
        expect(readPrefs({ ...defaultPrefs(), motorSound: false, motorChoice: true }).prefs.motorSound).toBe(false);
        // the marker is optional and boolean
        expect(validatePrefs(v013).ok).toBe(true);
        expect(validatePrefs({ ...defaultPrefs(), motorChoice: 'yes' }).ok).toBe(false);
        // the strict validator (a session's manifest) never changes a recorded value
        const strict = validatePrefs(v013);
        if (strict.ok) expect(strict.value.motorSound).toBe(true);
    });

    it('another format version gives the defaults, and says so', () => {
        const r = readPrefs({ format: 'shramko-sonic-prefs/9', theme: 'race' });
        expect(r.prefs).toEqual(defaultPrefs());
        expect(r.issues[0]!.path).toBe('format');
    });

    it('survives anything that was stored (fuzz)', () => {
        const rng = createRng(12);
        const junk = (depth: number): unknown => {
            const k = rng.int(0, depth > 2 ? 4 : 7);
            switch (k) {
                case 0:
                    return null;
                case 1:
                    return rng.next() < 0.5;
                case 2:
                    return rng.range(-1e6, 1e6);
                case 3:
                    return ['a', 'up-higher', 'full', 'soft', ''][rng.int(0, 4)];
                case 4:
                    return undefined;
                case 5:
                    return Array.from({ length: rng.int(0, 3) }, () => junk(depth + 1));
                default:
                    return Object.fromEntries(['theme', 'calm', 'layerGainDb', 'speechRate', 'path', 'listenerFrame', 'x', 'format'].filter(() => rng.next() < 0.6).map((key) => [key, junk(depth + 1)]));
            }
        };
        for (let i = 0; i < 500; i++) {
            const { prefs } = readPrefs(junk(0));
            expect(validatePrefs(prefs).ok, JSON.stringify(prefs)).toBe(true);
        }
    });
});

describe('updatePrefs', () => {
    it('applies a good patch and leaves the original alone', () => {
        const p = defaultPrefs();
        const r = updatePrefs(p, { calm: true, theme: 'clear' });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toMatchObject({ calm: true, theme: 'clear', speechRate: 1 });
        expect(p.calm).toBe(false);
    });

    it('refuses a bad patch with the reason', () => {
        const r = updatePrefs(defaultPrefs(), { speechRate: 5 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues[0]).toMatchObject({ path: 'speechRate' });
    });
});

describe('the pilot cannot leave the scale with the pitch offsets', () => {
    it('every offset from -12 to 12 steps lands on a note of the scale, for every starting note', () => {
        const scale = getBuiltinTheme('soft').scale;
        for (let i = 0; i <= 20; i++) {
            for (let offset = PREFS_LIMITS.pitchSteps.min; offset <= PREFS_LIMITS.pitchSteps.max; offset++) {
                expect(isInScale(scale, noteHz(scale, shiftNote(scale, i, offset)))).toBe(true);
            }
        }
    });
});
