// The pilot's own sound settings (contract SonicPrefs): defaults, a strict validator that refuses a
// bad value with its reason, a lenient reader for stored values (a missing field takes its default,
// a bad one is replaced and reported), and a canonical writer. The simulator keeps the value as one
// opaque document in its prefs collection 'sonic'; nothing here touches storage.
//
// Units: layerGainDb is dB on top of the theme's own layer gain (0 leaves it); layerPitchSteps is
// in SCALE STEPS, never semitones, so a shifted tone is still a note of the scale.
import type { LayerId, SonicPrefs } from '../contract';
import { FORMATS, LAYER_IDS } from '../contract';
import { canonicalPretty } from '../util/canonical';
import { Collector, isRecord, joinPath, type Issue, type Validation } from '../util/check';
import { THEME_ID } from '../theme/schema';

export const PREFS_LIMITS = {
    gainDb: { min: -24, max: 12 },
    /** the pilot's motor level over the calibrated one, dB (review m3): quieter at will, at most 6 dB louder */
    motorGainDb: { min: -24, max: 6 },
    pitchSteps: { min: -12, max: 12 },
    speechRate: { min: 0.5, max: 2 }
} as const;

export function defaultPrefs(): SonicPrefs {
    return {
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
    };
}

const KEYS = ['format', 'theme', 'calm', 'heightPolarity', 'layerGainDb', 'layerPitchSteps', 'selfVoice', 'speechRate', 'captions', 'motorSound', 'path', 'listenerFrame', 'heightTarget', 'motorGainDb', 'heightDirection', 'beacon', 'motorChoice'] as const;
type Key = (typeof KEYS)[number];
/** Keys added after the first documents were written (v0.13): a document without them is still valid (absent: the default). */
const ADDED_KEYS: readonly Key[] = ['heightTarget', 'motorGainDb', 'heightDirection', 'beacon', 'motorChoice'];
/** The keys every document must have. */
const REQUIRED_KEYS: readonly Key[] = KEYS.filter((k) => !ADDED_KEYS.includes(k));

type FieldCheck = (c: Collector, v: unknown, path: string) => unknown;

function layerMap(c: Collector, v: unknown, path: string, num: (c: Collector, v: unknown, path: string) => number | undefined): Partial<Record<LayerId, number>> | undefined {
    const rec = c.record(v, path);
    if (rec === null) return undefined;
    const out: Partial<Record<LayerId, number>> = {};
    for (const [key, value] of Object.entries(rec)) {
        const at = joinPath(path, key);
        if (!(LAYER_IDS as readonly string[]).includes(key)) {
            c.add(at, `is not a layer (${LAYER_IDS.join(', ')})`);
            continue;
        }
        const before = c.issues.length;
        const n = num(c, value, at);
        if (n !== undefined && c.issues.length === before) out[key as LayerId] = n; // only a good entry is kept
    }
    return out;
}

const FIELDS: Readonly<Record<Key, FieldCheck>> = {
    format: (c, v, path) => (v === FORMATS.prefs ? v : (c.add(path, `must be '${FORMATS.prefs}', got ${JSON.stringify(v)}`), undefined)),
    theme: (c, v, path) => c.string(v, path, { min: 1, max: 40, pattern: THEME_ID, patternHint: 'must be a theme id: lower-case letters and digits joined by single hyphens' }),
    calm: (c, v, path) => c.boolean(v, path),
    heightPolarity: (c, v, path) => c.oneOf(v, path, ['up-higher', 'up-lower'] as const),
    layerGainDb: (c, v, path) => layerMap(c, v, path, (cc, x, p) => cc.number(x, p, PREFS_LIMITS.gainDb)),
    layerPitchSteps: (c, v, path) => layerMap(c, v, path, (cc, x, p) => cc.number(x, p, { ...PREFS_LIMITS.pitchSteps, integer: true })),
    selfVoice: (c, v, path) => c.boolean(v, path),
    speechRate: (c, v, path) => c.number(v, path, PREFS_LIMITS.speechRate),
    captions: (c, v, path) => c.boolean(v, path),
    motorSound: (c, v, path) => c.boolean(v, path),
    path: (c, v, path) => c.oneOf(v, path, ['full', 'fast'] as const),
    listenerFrame: (c, v, path) => c.oneOf(v, path, ['heading', 'body'] as const),
    heightTarget: (c, v, path) => c.boolean(v, path),
    motorGainDb: (c, v, path) => c.number(v, path, PREFS_LIMITS.motorGainDb),
    heightDirection: (c, v, path) => c.boolean(v, path),
    beacon: (c, v, path) => c.boolean(v, path),
    motorChoice: (c, v, path) => c.boolean(v, path)
};

/** Strict: every field present and valid (a field added in v0.13 may be absent), nothing else. */
export function validatePrefs(input: unknown): Validation<SonicPrefs> {
    const c = new Collector();
    const root = c.record(input, '');
    if (root === null) return { ok: false, issues: c.issues };
    c.keys(root, '', KEYS, REQUIRED_KEYS);
    const out: Record<string, unknown> = {};
    for (const key of KEYS) {
        if (root[key] === undefined) continue;
        const v = FIELDS[key](c, root[key], key);
        if (v !== undefined) out[key] = v;
    }
    return c.ok ? { ok: true, value: out as unknown as SonicPrefs } : { ok: false, issues: c.issues };
}

/**
 * Lenient, for a value read back from storage: a missing field takes its default (an older version
 * did not have it), a field with a bad value takes its default and is reported, an unknown key is
 * dropped and reported. A value that is not preferences at all, or of another format version,
 * gives the defaults. Never throws. One rule (train 2, the owner: the motor sound off by default): the
 * simulator saves the whole document at any change, so a stored `motorSound` is the pilot's choice only
 * when `motorChoice` is true (the host sets it when he switches the motor); without it the motor is off.
 * (v0.13's migration of a pre-v0.13 false to true is gone.)
 */
export function readPrefs(stored: unknown): { prefs: SonicPrefs; issues: Issue[] } {
    const defaults = defaultPrefs();
    const issues: Issue[] = [];
    if (!isRecord(stored)) {
        if (stored !== undefined && stored !== null) issues.push({ path: '', message: 'is not a preferences object; defaults are used' });
        return { prefs: defaults, issues };
    }
    const input: Record<string, unknown> = stored;
    if (input.format !== undefined && input.format !== FORMATS.prefs) {
        issues.push({ path: 'format', message: `is ${JSON.stringify(input.format)}, this engine reads '${FORMATS.prefs}'; defaults are used` });
        return { prefs: defaults, issues };
    }
    const out: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(input)) if (!(KEYS as readonly string[]).includes(key)) issues.push({ path: key, message: 'is not a known key; dropped' });
    // motorSound without the pilot's own choice is a default the simulator saved with the rest: off (train 2)
    const chosen = input['motorChoice'] === true;
    if (!chosen && input['motorSound'] === true) issues.push({ path: 'motorSound', message: 'true was the default before train 2, not a choice (no motorChoice); the motor sound is off' });
    for (const key of KEYS) {
        if (key === 'format' || input[key] === undefined) continue;
        const c = new Collector();
        const v = FIELDS[key](c, input[key], key);
        // a layer map keeps its good entries and drops the bad ones; any other field takes its default
        const partial = v !== undefined && (key === 'layerGainDb' || key === 'layerPitchSteps');
        const usable = v !== undefined && (c.ok || partial);
        if (usable) out[key] = v;
        issues.push(...c.issues.map((i) => ({ path: i.path, message: `${i.message}; ${partial ? 'dropped' : 'the default is used'}` })));
    }
    if (!chosen) out['motorSound'] = false;
    return { prefs: out as unknown as SonicPrefs, issues };
}

/** Parses the text of a preferences document (strict). */
export function parsePrefs(text: string): Validation<SonicPrefs> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return validatePrefs(data);
}

/** The canonical text of a preferences document: keys sorted, two spaces of indent, a final newline. */
export function writePrefs(prefs: SonicPrefs): string {
    return `${canonicalPretty(prefs)}\n`;
}

/** `prefs` with `patch` applied, or the reasons the result would be refused. */
export function updatePrefs(prefs: SonicPrefs, patch: Partial<SonicPrefs>): Validation<SonicPrefs> {
    const merged = { ...prefs, ...patch };
    return validatePrefs(merged);
}
