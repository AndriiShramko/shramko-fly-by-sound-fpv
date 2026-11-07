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
        listenerFrame: 'heading'
    };
}

const KEYS = ['format', 'theme', 'calm', 'heightPolarity', 'layerGainDb', 'layerPitchSteps', 'selfVoice', 'speechRate', 'captions', 'motorSound', 'path', 'listenerFrame'] as const;
type Key = (typeof KEYS)[number];

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
    listenerFrame: (c, v, path) => c.oneOf(v, path, ['heading', 'body'] as const)
};

/** Strict: every field present and valid, nothing else. */
export function validatePrefs(input: unknown): Validation<SonicPrefs> {
    const c = new Collector();
    const root = c.record(input, '');
    if (root === null) return { ok: false, issues: c.issues };
    c.keys(root, '', KEYS);
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
 * gives the defaults. Never throws.
 */
export function readPrefs(input: unknown): { prefs: SonicPrefs; issues: Issue[] } {
    const defaults = defaultPrefs();
    const issues: Issue[] = [];
    if (!isRecord(input)) {
        if (input !== undefined && input !== null) issues.push({ path: '', message: 'is not a preferences object; defaults are used' });
        return { prefs: defaults, issues };
    }
    if (input.format !== undefined && input.format !== FORMATS.prefs) {
        issues.push({ path: 'format', message: `is ${JSON.stringify(input.format)}, this engine reads '${FORMATS.prefs}'; defaults are used` });
        return { prefs: defaults, issues };
    }
    const out: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(input)) if (!(KEYS as readonly string[]).includes(key)) issues.push({ path: key, message: 'is not a known key; dropped' });
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
