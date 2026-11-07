// Pitch in Fly by Sound lives on one pentatonic scale (spec principle 3): every pitched note is a
// note of the theme's scale, so any mix of cues stays consonant. A note is named by its INDEX in
// the scale: 0 is the root, 1 the next degree up, and `steps.length` the root an octave higher.
// Everything that moves a pitch, the height layer, the melody, the pilot's per-layer pitch offset,
// moves it by whole scale steps, so it never leaves the scale.
import type { ThemeDef } from '../contract';

export type Scale = ThemeDef['scale'];

/** How many notes the scale has: its degrees in every octave, and the root at the very top. */
export function scaleSize(scale: Scale): number {
    return scale.steps.length * scale.octaves + 1;
}

/** Semitones above the root of note `index` (0 to scaleSize - 1). */
export function noteSemitones(scale: Scale, index: number): number {
    const n = scale.steps.length;
    const i = Math.min(Math.max(Math.round(index), 0), scaleSize(scale) - 1);
    return Math.floor(i / n) * 12 + (scale.steps[i % n] as number);
}

/** Frequency of note `index`; an index beyond the scale is held at its first or last note. */
export function noteHz(scale: Scale, index: number): number {
    return scale.rootHz * 2 ** (noteSemitones(scale, index) / 12);
}

/** Every note of the scale, lowest first. */
export function scaleNotesHz(scale: Scale): number[] {
    return Array.from({ length: scaleSize(scale) }, (_, i) => noteHz(scale, i));
}

/** The index of the note nearest to `hz` on a logarithmic scale. */
export function nearestNoteIndex(scale: Scale, hz: number): number {
    let best = 0;
    let bestCents = Infinity;
    for (let i = 0; i < scaleSize(scale); i++) {
        const cents = Math.abs(1200 * Math.log2(hz / noteHz(scale, i)));
        if (cents < bestCents) {
            bestCents = cents;
            best = i;
        }
    }
    return best;
}

/**
 * `hz` is a note of the scale in some octave (within `toleranceCents`, 1 by default). Used by tests
 * and by the Sound Lab to refuse a pitch that would break the harmony.
 */
export function isInScale(scale: Scale, hz: number, toleranceCents = 1): boolean {
    if (!(hz > 0) || !Number.isFinite(hz)) return false;
    const semitones = 12 * Math.log2(hz / scale.rootHz);
    const pitchClass = ((semitones % 12) + 12) % 12;
    return scale.steps.some((s) => {
        const d = Math.abs(pitchClass - s);
        return Math.min(d, 12 - d) * 100 <= toleranceCents;
    });
}

export interface HeightMapping {
    /** the note at height 0 (ascending) */
    readonly baseStep: number;
    /** the highest note the height layer uses */
    readonly maxStep: number;
    /** metres of height per scale step */
    readonly metresPerStep: number;
    /** the pilot's choice (spec principle 6) */
    readonly polarity: 'up-higher' | 'up-lower';
}

/**
 * The note of the height tone at `heightM` above the floor. Up-higher: the base note at the floor,
 * one scale step up per `metresPerStep`, held at `maxStep`. Up-lower: the same range turned over,
 * the top note at the floor and one step down per `metresPerStep`.
 */
export function heightNoteIndex(heightM: number, m: HeightMapping): number {
    const range = Math.max(0, m.maxStep - m.baseStep);
    const raw = Number.isFinite(heightM) ? Math.round(heightM / m.metresPerStep) : 0;
    const step = Math.min(Math.max(raw, 0), range);
    return m.polarity === 'up-higher' ? m.baseStep + step : m.maxStep - step;
}

/**
 * The notes sounded as a craft passes gate 0, 1, 2, ... of a course of `gates`: a rising run
 * through the scale from `baseIndex` over at most one octave, so the last gate lands on the root
 * an octave above (or the highest available note) and completes the melody. A one-gate course is
 * only that last note.
 */
export function gateMelody(scale: Scale, gates: number, baseIndex = 0): number[] {
    const top = scaleSize(scale) - 1;
    const base = Math.min(Math.max(Math.round(baseIndex), 0), top);
    const span = Math.min(scale.steps.length, top - base);
    const out: number[] = [];
    for (let k = 0; k < gates; k++) out.push(base + (gates <= 1 ? span : Math.round((k * span) / (gates - 1))));
    return out;
}

/** A note index moved by `offset` scale steps (the pilot's per-layer pitch), held inside the scale. */
export function shiftNote(scale: Scale, index: number, offset: number): number {
    return Math.min(Math.max(Math.round(index) + Math.round(offset), 0), scaleSize(scale) - 1);
}
