import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    applyCalm,
    applyPreset,
    BUILTIN_THEME_IDS,
    CALM_PRESET,
    DEFAULT_THEME_ID,
    formatIssues,
    getBuiltinTheme,
    gateMelody,
    heightNoteIndex,
    isInScale,
    LAYER_IDS,
    LAYER_PARAMS,
    nearestNoteIndex,
    noteHz,
    noteSemitones,
    parseTheme,
    resolveTheme,
    scaleNotesHz,
    scaleSize,
    shiftNote,
    THEME_IDS,
    validateTheme,
    writeTheme,
    type LayerId,
    type ThemeDef
} from '../src';

const THEME_DIR = fileURLToPath(new URL('../themes/', import.meta.url));
const read = (id: string): string => readFileSync(`${THEME_DIR}${id}.json`, 'utf8');
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

const soft = (): unknown => JSON.parse(read('soft'));

describe('the shipped themes', () => {
    it.each(BUILTIN_THEME_IDS)('%s is valid, canonical and complete', (id) => {
        const text = read(id);
        const parsed = parseTheme(text);
        expect(parsed.ok, parsed.ok ? '' : formatIssues(parsed.issues)).toBe(true);
        if (!parsed.ok) return;
        expect(writeTheme(parsed.value)).toBe(text); // the file is in canonical form: stable diffs
        expect(parsed.value.id).toBe(id);
        expect(Object.keys(parsed.value.layers).sort()).toEqual([...LAYER_IDS].sort());
        for (const layer of LAYER_IDS) expect(Object.keys(parsed.value.layers[layer].params).sort()).toEqual(Object.keys(LAYER_PARAMS[layer]).sort());
        expect(getBuiltinTheme(id)).toEqual(parsed.value);
    });

    it('share one pentatonic scale, the limiter ceiling of -6 dBFS, a 1 s fade-in and a 12 dB duck', () => {
        const themes = BUILTIN_THEME_IDS.map(getBuiltinTheme);
        for (const t of themes) {
            expect(t.scale).toEqual(themes[0]!.scale);
            expect(t.master.ceilingDb).toBe(-6);
            expect(t.master.fadeInS).toBe(1);
            expect(t.duckDb).toBe(12);
        }
        expect(themes[0]!.scale.steps).toEqual([0, 2, 4, 7, 9]);
    });

    it('the three of the spec: soft is the default, with mallets and pads; clear has sines and clicks; race is short and hard', () => {
        expect(DEFAULT_THEME_ID).toBe('soft');
        const [s, c, r] = [getBuiltinTheme('soft'), getBuiltinTheme('clear'), getBuiltinTheme('race')];
        expect(s.layers.safety.timbre).toBe('mallet');
        expect(s.layers.height.timbre).toBe('pad');
        expect(s.materials).toEqual({ wall: 'wood', floor: 'thud', ceiling: 'air', obstacle: 'metal' }); // spec section 2
        expect(c.layers.height.timbre).toBe('sine');
        expect(c.layers.speed.timbre).toBe('click');
        // race: shorter pulses and quicker periods than soft
        expect(r.layers.safety.params['pulseMs']).toBeLessThan(s.layers.safety.params['pulseMs']!);
        expect(r.layers.safety.params['periodNearMs']).toBeLessThan(s.layers.safety.params['periodNearMs']!);
        expect(r.layers.speed.params['tempoMaxHz']).toBeGreaterThan(s.layers.speed.params['tempoMaxHz']!);
    });

    it('are the themes the locale files name', () => {
        expect([...BUILTIN_THEME_IDS]).toEqual([...THEME_IDS]);
    });

    it('resolveTheme: a shipped id, a custom theme, or the default for an unknown id', () => {
        expect(resolveTheme('race').id).toBe('race');
        expect(resolveTheme('nonsense').id).toBe('soft');
        const custom = { ...getBuiltinTheme('clear'), id: 'mine', name: 'Mine' };
        expect(resolveTheme('mine', { mine: custom })).toBe(custom);
    });
});

describe('the pentatonic scale', () => {
    const scale = getBuiltinTheme('soft').scale; // C3 = 130.8128 Hz, C major pentatonic, 4 octaves

    it('has 21 notes from C3 to C7 on equal temperament', () => {
        expect(scaleSize(scale)).toBe(21);
        expect(noteHz(scale, 0)).toBeCloseTo(130.8128, 4);
        expect(noteHz(scale, 5)).toBeCloseTo(261.6256, 3); // an octave up
        expect(noteHz(scale, 20)).toBeCloseTo(2093.0048, 2);
        expect(noteSemitones(scale, 1)).toBe(2);
        expect(noteSemitones(scale, 4)).toBe(9);
        expect(noteSemitones(scale, 7)).toBe(16); // octave 1, degree 2 (E)
        expect(noteHz(scale, 9)).toBeCloseTo(440, 2); // A4 is in the scale
        expect(nearestNoteIndex(scale, 440)).toBe(9);
        expect(scaleNotesHz(scale)).toHaveLength(21);
        // out-of-range indices are held at the ends
        expect(noteHz(scale, -3)).toBe(noteHz(scale, 0));
        expect(noteHz(scale, 99)).toBe(noteHz(scale, 20));
    });

    it('every note is in the scale, and the notes that are not are refused (negative control)', () => {
        for (const hz of scaleNotesHz(scale)) expect(isInScale(scale, hz)).toBe(true);
        // every note in any other octave too
        expect(isInScale(scale, 55)).toBe(true); // A1
        expect(isInScale(scale, 3520)).toBe(true); // A7
        // the five semitones that are not in C major pentatonic (C# D# F F# G# A# are, with B, out)
        for (const semitones of [1, 3, 5, 6, 8, 10, 11]) {
            expect(isInScale(scale, scale.rootHz * 2 ** (semitones / 12)), `${semitones} semitones above the root`).toBe(false);
        }
        expect(isInScale(scale, 0)).toBe(false);
        expect(isInScale(scale, Number.NaN)).toBe(false);
        // a quarter tone off is refused with the default tolerance
        expect(isInScale(scale, noteHz(scale, 3) * 2 ** (0.5 / 12))).toBe(false);
    });

    it('a pitch shifted by semitones leaves the scale, shifted by scale steps it does not', () => {
        for (let i = 0; i < scaleSize(scale); i++) {
            expect(isInScale(scale, noteHz(scale, i) * 2 ** (1 / 12))).toBe(false);
            for (const offset of [-7, -3, -1, 1, 2, 5, 12]) expect(isInScale(scale, noteHz(scale, shiftNote(scale, i, offset)))).toBe(true);
        }
        expect(shiftNote(scale, 3, 100)).toBe(20);
        expect(shiftNote(scale, 3, -100)).toBe(0);
    });
});

describe('every pitch the engine asks a theme for is in the scale', () => {
    it.each(BUILTIN_THEME_IDS)('%s: every *Step parameter is a note of the scale', (id) => {
        const t = getBuiltinTheme(id);
        let checked = 0;
        for (const layer of LAYER_IDS) {
            for (const [name, spec] of Object.entries(LAYER_PARAMS[layer])) {
                if (!spec.scaleIndex) continue;
                const step = t.layers[layer].params[name]!;
                expect(Number.isInteger(step), `${layer}.${name}`).toBe(true);
                expect(step).toBeGreaterThanOrEqual(0);
                expect(step).toBeLessThan(scaleSize(t.scale));
                expect(isInScale(t.scale, noteHz(t.scale, step))).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThanOrEqual(9);
    });

    it.each(BUILTIN_THEME_IDS)('%s: the height tone, both polarities, every height, stays on the scale and in its range', (id) => {
        const t = getBuiltinTheme(id);
        const p = t.layers.height.params;
        const base = p['baseStep']!, max = p['maxStep']!, per = p['metresPerStep']!;
        let lastUp = -1, lastDown = Infinity;
        for (let h = -5; h <= 80; h += 0.37) {
            const up = heightNoteIndex(h, { baseStep: base, maxStep: max, metresPerStep: per, polarity: 'up-higher' });
            const down = heightNoteIndex(h, { baseStep: base, maxStep: max, metresPerStep: per, polarity: 'up-lower' });
            for (const i of [up, down]) {
                expect(i).toBeGreaterThanOrEqual(base);
                expect(i).toBeLessThanOrEqual(max);
                expect(isInScale(t.scale, noteHz(t.scale, i))).toBe(true);
            }
            expect(up).toBeGreaterThanOrEqual(lastUp); // up is higher
            expect(down).toBeLessThanOrEqual(lastDown); // flipped: up is lower
            expect(up + down).toBe(base + max); // the flip turns the range over
            lastUp = up;
            lastDown = down;
        }
        expect(heightNoteIndex(0, { baseStep: base, maxStep: max, metresPerStep: per, polarity: 'up-higher' })).toBe(base);
        expect(heightNoteIndex(0, { baseStep: base, maxStep: max, metresPerStep: per, polarity: 'up-lower' })).toBe(max);
        expect(heightNoteIndex(Number.NaN, { baseStep: base, maxStep: max, metresPerStep: per, polarity: 'up-higher' })).toBe(base);
    });

    it('the gate melody rises through the scale and the last gate completes it', () => {
        const scale = getBuiltinTheme('soft').scale;
        for (let base = 0; base < scaleSize(scale); base += 3) {
            for (let gates = 1; gates <= 30; gates++) {
                const m = gateMelody(scale, gates, base);
                expect(m).toHaveLength(gates);
                const top = Math.min(base + 5, scaleSize(scale) - 1);
                expect(m[m.length - 1]).toBe(top); // an octave above the start, or the highest note there is
                for (let k = 0; k < m.length; k++) {
                    expect(m[k]).toBeGreaterThanOrEqual(base);
                    expect(m[k]).toBeLessThanOrEqual(top);
                    expect(isInScale(scale, noteHz(scale, m[k]!))).toBe(true);
                    if (k > 0) expect(m[k]).toBeGreaterThanOrEqual(m[k - 1]!);
                }
            }
        }
        expect(gateMelody(scale, 5, 0)).toEqual([0, 1, 3, 4, 5]);
        expect(gateMelody(scale, 1, 0)).toEqual([5]);
    });
});

describe('bad theme files are refused with their reason', () => {
    const cases: [string, unknown, string, RegExp][] = [
        ['not an object', null, '', /must be an object/],
        ['an array', [], '', /must be an object, got an array/],
        ['another format', set(soft(), ['format'], 'shramko-sonic-theme/2'), 'format', /must be 'shramko-sonic-theme\/1'/],
        ['an unknown key', set(soft(), ['volume'], 11), 'volume', /not a known key/],
        ['a missing key', set(soft(), ['master'], undefined), 'master', /is missing/],
        ['a bad id', set(soft(), ['id'], 'Soft Theme'), 'id', /lower-case/],
        ['an empty name', set(soft(), ['name'], ''), 'name', /at least 1 character/],
        ['a root below 40 Hz', set(soft(), ['scale', 'rootHz'], 20), 'scale.rootHz', /at least 40/],
        ['a semitone in the scale', set(soft(), ['scale', 'steps'], [0, 1, 4, 7, 9]), 'scale.steps', /2 or 3 semitones apart/],
        ['four degrees', set(soft(), ['scale', 'steps'], [0, 2, 4, 7]), 'scale.steps', /must list 5 degrees/],
        ['a scale not starting at the root', set(soft(), ['scale', 'steps'], [2, 4, 7, 9, 11]), 'scale.steps', /start with 0/],
        ['a scale out of order', set(soft(), ['scale', 'steps'], [0, 4, 2, 7, 9]), 'scale.steps', /increasing/],
        ['a fractional degree', set(soft(), ['scale', 'steps'], [0, 2, 4, 7, 9.5]), 'scale.steps', /whole semitones/],
        ['a gap of four semitones', set(soft(), ['scale', 'steps'], [0, 4, 7, 9, 11]), 'scale.steps', /2 or 3 semitones apart/],
        ['seven octaves', set(soft(), ['scale', 'octaves'], 7), 'scale.octaves', /at most 6/],
        ['a top note that is too high', set(set(soft(), ['scale', 'rootHz'], 1000), ['scale', 'octaves'], 4), 'scale', /above 8000 Hz/],
        ['a ceiling above -6 dBFS', set(soft(), ['master', 'ceilingDb'], -3), 'master.ceilingDb', /at most -6/],
        ['no fade-in', set(soft(), ['master', 'fadeInS'], 0), 'master.fadeInS', /at least 0.25/],
        ['a missing layer', set(soft(), ['layers', 'room'], undefined), 'layers.room', /is missing/],
        ['an unknown layer', set(soft(), ['layers', 'bass'], {}), 'layers.bass', /not a known key/],
        ['an unknown timbre', set(soft(), ['layers', 'height', 'timbre'], 'flute'), 'layers.height.timbre', /must be one of/],
        ['a layer gain of +20 dB', set(soft(), ['layers', 'height', 'gainDb'], 20), 'layers.height.gainDb', /at most 12/],
        ['an unknown parameter', set(soft(), ['layers', 'safety', 'params', 'wobble'], 1), 'layers.safety.params.wobble', /not a known key/],
        ['a missing parameter', set(soft(), ['layers', 'safety', 'params', 'pulseMs'], undefined), 'layers.safety.params.pulseMs', /is missing/],
        ['a parameter out of range', set(soft(), ['layers', 'safety', 'params', 'pulseMs'], 5), 'layers.safety.params.pulseMs', /at least 10/],
        ['a parameter that is not a number', set(soft(), ['layers', 'safety', 'params', 'pulseMs'], '60'), 'layers.safety.params.pulseMs', /finite number/],
        ['a fractional count', set(soft(), ['layers', 'room', 'params', 'bedOrder'], 2.5), 'layers.room.params.bedOrder', /integer/],
        ['a note beyond the scale', set(soft(), ['layers', 'height', 'params', 'maxStep'], 25), 'layers.height.params.maxStep', /at most 20/],
        ['a note that is a frequency', set(soft(), ['layers', 'target', 'params', 'humStep'], 164.8), 'layers.target.params.humStep', /integer/],
        ['periods out of order', set(soft(), ['layers', 'safety', 'params', 'periodNearMs'], 2000), 'layers.safety.params.periodNearMs', /must be below periodFarMs/],
        ['an unknown surface class', set(soft(), ['materials', 'glass'], 'metal'), 'materials.glass', /not a known key/],
        ['a bad surface timbre', set(soft(), ['materials', 'wall'], 'flute'), 'materials.wall', /must be one of/]
    ];

    it.each(cases)('%s', (_name, data, path, message) => {
        const v = validateTheme(data);
        expect(v.ok).toBe(false);
        if (v.ok) return;
        const hit = v.issues.find((i) => i.path === path && message.test(i.message));
        expect(hit, JSON.stringify(v.issues)).toBeDefined();
    });

    it('reports every problem at once, not only the first', () => {
        const bad = set(set(set(soft(), ['master', 'ceilingDb'], 0), ['layers', 'height', 'timbre'], 'flute'), ['id'], 'No Good') as unknown;
        const v = validateTheme(bad);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.issues.map((i) => i.path).sort()).toEqual(['id', 'layers.height.timbre', 'master.ceilingDb']);
    });

    it('text that is not JSON', () => {
        const v = parseTheme('{ "id": ');
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.issues[0]!.message).toMatch(/not valid JSON/);
    });

    it('a good file passes (the controls above fail for their reason alone)', () => {
        expect(validateTheme(soft()).ok).toBe(true);
    });
});

describe('the calm preset', () => {
    it.each(BUILTIN_THEME_IDS)('%s: softer and slower, still a valid theme on the same scale', (id) => {
        const t = getBuiltinTheme(id);
        const before = clone(t);
        const calm = applyCalm(t);
        expect(t).toEqual(before); // the original is not touched
        const v = validateTheme(calm);
        expect(v.ok, v.ok ? '' : formatIssues(v.issues)).toBe(true);
        expect(calm.scale).toEqual(t.scale);
        expect(calm.master).toEqual(t.master);
        expect(calm.duckDb).toBe(t.duckDb);
        for (const layer of LAYER_IDS) {
            expect(calm.layers[layer].gainDb, layer).toBeLessThanOrEqual(t.layers[layer].gainDb);
            expect(calm.layers[layer].timbre).toBe(t.layers[layer].timbre);
            // no pitch moves: every note stays where it was
            for (const [name, spec] of Object.entries(LAYER_PARAMS[layer])) if (spec.scaleIndex) expect(calm.layers[layer].params[name], `${layer}.${name}`).toBe(t.layers[layer].params[name]);
        }
        for (const layer of ['safety', 'height', 'speed', 'target', 'shape', 'room'] as LayerId[]) expect(calm.layers[layer].gainDb, layer).toBeLessThan(t.layers[layer].gainDb);
        // less rough, slower, duller
        expect(calm.layers.height.params['roughDepth']).toBeLessThan(t.layers.height.params['roughDepth']!);
        expect(calm.layers.target.params['roughMax']).toBeLessThan(t.layers.target.params['roughMax']!);
        expect(calm.layers.safety.params['periodNearMs']).toBeGreaterThan(t.layers.safety.params['periodNearMs']!);
        expect(calm.layers.safety.params['pulseMs']).toBeGreaterThan(t.layers.safety.params['pulseMs']!);
        expect(calm.layers.safety.params['lowpassNearHz']).toBeLessThan(t.layers.safety.params['lowpassNearHz']!);
        expect(calm.layers.speed.params['tempoMaxHz']).toBeLessThan(t.layers.speed.params['tempoMaxHz']!);
        expect(calm.layers.target.params['rateNearHz']).toBeLessThan(t.layers.target.params['rateNearHz']!);
    });

    it('holds every number inside its range, however strong the rule', () => {
        const t = getBuiltinTheme('soft');
        const strong = applyPreset(t, {
            id: 'strong',
            gainOffsetDb: { safety: 100, height: -100 },
            rules: [
                { layer: 'safety', param: 'pulseMs', op: 'mul', by: 100 },
                { layer: 'safety', param: 'periodNearMs', op: 'add', by: -1000 },
                { layer: 'room', param: 'bedOrder', op: 'mul', by: 3.4 },
                { layer: 'safety', param: 'noSuchParam', op: 'mul', by: 2 }
            ]
        });
        expect(strong.layers.safety.params['pulseMs']).toBe(LAYER_PARAMS.safety['pulseMs']!.max);
        expect(strong.layers.safety.params['periodNearMs']).toBe(LAYER_PARAMS.safety['periodNearMs']!.min);
        expect(strong.layers.room.params['bedOrder']).toBe(0); // 0 x 3.4, an integer
        expect(strong.layers.safety.gainDb).toBe(12);
        expect(strong.layers.height.gainDb).toBe(-40);
        expect(strong.layers.safety.params['noSuchParam']).toBeUndefined();
    });

    it('the preset is plain data with a rule for each thing it says it changes', () => {
        expect(CALM_PRESET.id).toBe('calm');
        for (const rule of CALM_PRESET.rules) expect(LAYER_PARAMS[rule.layer][rule.param], `${rule.layer}.${rule.param}`).toBeDefined();
        expect(JSON.parse(JSON.stringify(CALM_PRESET))).toEqual(CALM_PRESET);
    });
});
