// The rules that turn what the craft senses into numbers of sound: pulse periods, repetition
// rates, tempo, notes, roughness and the redundant distance code (spec section 2; research 01
// sections 3, 4 and 9; research 02 section 2). Pure functions of their inputs, no clock, no DOM:
// the engine (src/audio) renders them, the Node tests hold them, the replay re-derives them.
//
// Every pitch is a note of the theme's pentatonic scale (src/theme/pitch.ts). Doppler and glides
// bend a note for a moment; the note itself never leaves the scale. The one exception is the height
// tone, which glides continuously with the height (v0.13, M41-12; src/cues/height.ts); its target tone
// is a note again.
import type { SonicPrefs, ThemeDef, Vec3 } from '../contract';
import { heightNoteIndex, noteHz, scaleSize, shiftNote } from '../theme/pitch';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));

/** From `a` at x = 0 to `b` at x = 1 on a logarithmic scale (both > 0): even steps to the ear. */
export function expLerp(a: number, b: number, x: number): number {
    return a * (b / a) ** clamp01(x);
}

export const lerp = (a: number, b: number, x: number): number => a + (b - a) * clamp01(x);

// ------------------------------------------------------------------ safety: the pulse period

export interface PulseRule {
    readonly periodNearMs: number;
    readonly periodFarMs: number;
    readonly ttcFarS: number;
    readonly distFarM: number;
}

/**
 * The pulse period of a hazard, ms (spec section 2: it follows the time to collision; the distance
 * when the craft is not closing). x = ttc / ttcFarS (or distance / distFarM), held in [0, 1]; the
 * period runs from periodNearMs at x = 0 to periodFarMs at x = 1 on a logarithmic scale, so every
 * halving of the time to collision quickens the pulse by the same musical step. When the craft is
 * closing, the urgency of the distance alone is a floor (min of the two x): a wall 30 cm away never
 * sounds calmer because the craft creeps toward it.
 */
export function pulsePeriodMs(ttcS: number | null, distanceM: number, rule: PulseRule): number {
    const byDistance = clamp01(distanceM / rule.distFarM);
    const x = ttcS === null ? byDistance : Math.min(clamp01(ttcS / rule.ttcFarS), byDistance);
    return expLerp(rule.periodNearMs, rule.periodFarMs, x);
}

/** A hazard counts as urgent below this time to collision, s: the safety layer then ducks the others. */
export const URGENT_TTC_S = 1.5;
/** ... or below this distance, m. */
export const URGENT_DISTANCE_M = 1;
/** How far the other layers duck while a hazard is urgent, dB. */
export const URGENT_DUCK_DB = 9;

export function isUrgent(ttcS: number | null, distanceM: number): boolean {
    return (ttcS !== null && ttcS < URGENT_TTC_S) || distanceM < URGENT_DISTANCE_M;
}

// ------------------------------------------------------------------ distance, redundantly

/** Level slope with distance, dB per doubling: gentler than the free field's 6 (research 01 section 3). */
export const LEVEL_SLOPE_DB = 4;
/** The quietest the distance makes a source, dB. */
export const LEVEL_FLOOR_DB = -18;
/** Inside this distance the far ear is turned down and the near ear up, m. */
export const ILD_RANGE_M = 2;

export interface DistanceRule {
    /** low-pass cutoff at 1 m and closer, Hz */
    readonly nearHz: number;
    /** low-pass cutoff at farM and beyond, Hz */
    readonly farHz: number;
    readonly farM: number;
    /** reverb send at 1 m and at farM, 0 to 1 */
    readonly sendNear: number;
    readonly sendFar: number;
    /** extra level difference between the ears at the closest, dB */
    readonly ildBoostDb: number;
}

export interface DistanceCode {
    /** level change, dB (0 at 1 m and closer) */
    readonly gainDb: number;
    readonly lowpassHz: number;
    readonly reverbSend: number;
    /** extra level difference between the ears, dB, >= 0 (the engine applies it by the source's side) */
    readonly ildDb: number;
}

/**
 * The distance code of spec section 2: a gentle level slope, an early low-pass, a reverb send that
 * grows with distance and an ILD boost under 2 m. The repetition rate and the Doppler shift are the
 * other two codes; they belong to the cue (pulse, hum) and to the motion.
 */
export function distanceCode(distanceM: number, rule: DistanceRule): DistanceCode {
    const d = Math.max(distanceM, 0);
    const gainDb = d <= 1 ? 0 : Math.max(-LEVEL_SLOPE_DB * Math.log2(d), LEVEL_FLOOR_DB);
    const x = rule.farM <= 1 ? 1 : clamp01(Math.log(Math.max(d, 1)) / Math.log(rule.farM));
    return {
        gainDb,
        lowpassHz: expLerp(rule.nearHz, Math.min(rule.farHz, rule.nearHz), x),
        reverbSend: lerp(rule.sendNear, rule.sendFar, x),
        ildDb: d >= ILD_RANGE_M ? 0 : rule.ildBoostDb * clamp01((ILD_RANGE_M - d) / (ILD_RANGE_M - 0.3))
    };
}

export const SPEED_OF_SOUND_MPS = 343;
/** Doppler is held to this many cents either way: a cue bends, it never turns into another note. */
export const DOPPLER_MAX_CENTS = 60;

/** The Doppler shift of a source the listener closes on at `closingMps` (negative: moving away), cents. */
export function dopplerCents(closingMps: number): number {
    const v = clamp(closingMps, -0.5 * SPEED_OF_SOUND_MPS, 0.5 * SPEED_OF_SOUND_MPS);
    return clamp(1200 * Math.log2(SPEED_OF_SOUND_MPS / (SPEED_OF_SOUND_MPS - v)), -DOPPLER_MAX_CENTS, DOPPLER_MAX_CENTS);
}

// ------------------------------------------------------------------ direction for the HRTF panner

/** Added to every elevation before the panner (research 01 section 9): Chrome's HRTF takes the 15-degree slice at or below, so this centres the rounding. */
export const ELEVATION_FIX_DEG = 7.5;

const DEG = Math.PI / 180;

/**
 * The position a PannerNode gets for a heading-frame direction: unit length, the elevation raised by
 * ELEVATION_FIX_DEG (at most straight up). The azimuth is kept exactly. Distance is coded by the
 * engine itself, so the panner only ever sees directions.
 */
export function pannerDirection(dir: Vec3): Vec3 {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (!(len > 1e-9)) return [0, 0, -1];
    const x = dir[0] / len, y = dir[1] / len, z = dir[2] / len;
    const horizontal = Math.hypot(x, z);
    const azimuth = horizontal < 1e-9 ? 0 : Math.atan2(x, -z);
    const elevation = Math.min(Math.asin(clamp(y, -1, 1)) + ELEVATION_FIX_DEG * DEG, Math.PI / 2);
    const c = Math.cos(elevation);
    return [c * Math.sin(azimuth), Math.sin(elevation), -c * Math.cos(azimuth)];
}

/**
 * Pitch also codes height (research 01 section 4): a beacon above the listener sounds higher, one
 * below lower, in coarse bands of whole scale steps (about 12 and 30 degrees). Flipped with the
 * pilot's polarity.
 */
export function elevationSteps(dirY: number, polarity: SonicPrefs['heightPolarity']): number {
    const s = dirY >= 0.5 ? 2 : dirY >= 0.2 ? 1 : dirY <= -0.5 ? -2 : dirY <= -0.2 ? -1 : 0;
    return polarity === 'up-higher' ? s : -s;
}

// ------------------------------------------------------------------ notes

type Scale = ThemeDef['scale'];

/** A note index moved by the pilot's per-layer pitch and any other step offsets, held inside the scale; and its frequency. */
export function note(scale: Scale, index: number, ...offsets: number[]): { readonly index: number; readonly hz: number } {
    let i = Math.round(index);
    for (const o of offsets) i = shiftNote(scale, i, o);
    i = shiftNote(scale, i, 0);
    return { index: i, hz: noteHz(scale, i) };
}

/** The top note index of the scale. */
export function topNote(scale: Scale): number {
    return scaleSize(scale) - 1;
}

// ------------------------------------------------------------------ height

export interface HeightRule {
    readonly baseStep: number;
    readonly maxStep: number;
    readonly metresPerStep: number;
    readonly roughDepth: number;
    readonly bandSoftM: number;
}

/**
 * Roughness of the height tone (spec section 2: roughness when outside the lesson's band): 0 inside
 * the band, growing linearly to `depth` over `softM` outside it. No band, no roughness.
 */
export function bandRoughness(heightM: number, band: readonly [number, number] | null, depth: number, softM: number): number {
    if (band === null) return 0;
    const out = heightM < band[0] ? band[0] - heightM : heightM > band[1] ? heightM - band[1] : 0;
    if (out <= 0) return 0;
    return depth * (softM <= 0 ? 1 : clamp01(out / softM));
}

/**
 * The STEPPED height tone of v0.12: the nearest note for the height above the lesson floor (pitch.ts
 * heightNoteIndex) and its roughness. The planner no longer uses it (the tone glides: height.ts
 * heightTones); it stays as the negative control of the glide's tests.
 */
export function heightTone(heightM: number, band: readonly [number, number] | null, rule: HeightRule, polarity: SonicPrefs['heightPolarity']): { readonly noteIndex: number; readonly rough: number } {
    return {
        noteIndex: heightNoteIndex(heightM, { baseStep: rule.baseStep, maxStep: rule.maxStep, metresPerStep: rule.metresPerStep, polarity }),
        rough: bandRoughness(heightM, band, rule.roughDepth, rule.bandSoftM)
    };
}

// ------------------------------------------------------------------ speed

/** Under this speed the ticks stop: a hover is silent, m/s. */
export const SPEED_SILENT_MPS = 0.3;

export interface SpeedRule {
    readonly tempoMinHz: number;
    readonly tempoMaxHz: number;
    readonly speedMaxMps: number;
}

/** Tick rate for a speed (faster ticks = faster flight, research 02 section 2): linear from tempoMinHz to tempoMaxHz at speedMaxMps; 0 under SPEED_SILENT_MPS. */
export function speedTempoHz(speedMps: number, rule: SpeedRule): number {
    if (!(speedMps >= SPEED_SILENT_MPS)) return 0;
    return lerp(rule.tempoMinHz, rule.tempoMaxHz, speedMps / rule.speedMaxMps);
}

// ------------------------------------------------------------------ target

export interface TargetRule {
    readonly rateNearHz: number;
    readonly rateFarHz: number;
    readonly nearM: number;
    readonly farM: number;
    readonly roughMax: number;
    readonly missFullM: number;
}

/** How often the hum repeats at a distance: rateFarHz at farM and beyond, rateNearHz at nearM and closer, logarithmic between. */
export function targetRateHz(distanceM: number, rule: TargetRule): number {
    const x = clamp01(Math.log(Math.max(distanceM, rule.nearM) / rule.nearM) / Math.log(rule.farM / rule.nearM));
    return expLerp(rule.rateNearHz, rule.rateFarHz, x);
}

/**
 * Where the craft would miss the target if it flew straight on along `travel` (a unit vector):
 * the distance between the target and the craft's line of travel, m. A target behind the line's
 * start counts its full distance.
 */
export function aimMissM(toTarget: Vec3, travel: Vec3): number {
    const along = toTarget[0] * travel[0] + toTarget[1] * travel[1] + toTarget[2] * travel[2];
    const full = Math.hypot(toTarget[0], toTarget[1], toTarget[2]);
    if (along <= 0) return full;
    return Math.hypot(toTarget[0] - along * travel[0], toTarget[1] - along * travel[1], toTarget[2] - along * travel[2]);
}

/**
 * Roughness of the hum for an aim miss (spec section 2: roughness grows with the off-axis miss). Full
 * at missFullM, or at 15 % of the distance when that is more, so a far gate does not turn rough for a
 * heading error the ear cannot hear (lateral error 11-18 degrees, research 01 section 2).
 */
export function targetRoughness(missM: number, distanceM: number, rule: TargetRule): number {
    const full = Math.max(rule.missFullM, 0.15 * distanceM);
    return rule.roughMax * clamp01(missM / full);
}

/** Off course is beating on the hum: a second voice this far above the note at full roughness, Hz. */
export const TARGET_BEAT_MAX_HZ = 7;

/** The beating of an off-course hum: rate and depth (0..1) for a roughness. */
export function targetBeat(rough: number): { readonly hz: number; readonly depth: number } {
    const r = clamp01(rough);
    return { hz: r <= 0 ? 0 : 2 + (TARGET_BEAT_MAX_HZ - 2) * r, depth: r };
}

// ------------------------------------------------------------------ room

export interface RoomRule {
    readonly opennessFullM: number;
    readonly reverbMin: number;
    readonly reverbMax: number;
    readonly bedLowpassHz: number;
}

/** How open the space is, 0 (tight) to 1 (open), from the scene's mean free distance. */
export function openness(meanFreeDistanceM: number, rule: Pick<RoomRule, 'opennessFullM'>): number {
    return clamp01(meanFreeDistanceM / rule.opennessFullM);
}

/** The room layer for an openness: the reverb return (open rooms ring longer) and the bed's low-pass (open rooms are brighter). */
export function roomCode(open: number, rule: RoomRule): { readonly reverb: number; readonly bedLowpassHz: number } {
    return { reverb: lerp(rule.reverbMin, rule.reverbMax, open), bedLowpassHz: rule.bedLowpassHz * (0.6 + 0.8 * clamp01(open)) };
}

// ------------------------------------------------------------------ the output

/**
 * The soft clipper at the end of the chain as a WaveShaper curve over inputs -1..1: the identity up
 * to 85 % of the ceiling, then a tanh knee that never reaches the ceiling. Every value of the curve,
 * and so every output sample (the curve is interpolated linearly, inputs beyond +-1 take its end
 * values), stays at or under the ceiling.
 */
export function softClipCurve(ceilingDb: number, points = 4097): Float32Array {
    const c = dbToGain(ceilingDb);
    const knee = 0.85 * c;
    const out = new Float32Array(points);
    for (let i = 0; i < points; i++) {
        const x = (2 * i) / (points - 1) - 1;
        const a = Math.abs(x);
        const y = a <= knee ? a : knee + (c - knee) * Math.tanh((a - knee) / (c - knee));
        // a float32 rounding up could pass the ceiling by one ulp: take the float just below it
        let f = Math.fround(Math.min(y, c));
        if (f > c) f = Math.fround(f - f * 2 ** -23);
        out[i] = x < 0 ? -f : f;
    }
    return out;
}

/**
 * The static make-up gain Chrome's DynamicsCompressorNode applies (Web Audio spec, "makeup gain":
 * (1 / full range gain) ^ 0.6), estimated with a hard knee at threshold + knee, dB. The engine
 * takes it back out after the compressor, so the compressor only shapes peaks and never lifts the
 * mix; the soft clipper after it holds the ceiling either way.
 */
export function compressorMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
    const kneeEnd = Math.min(thresholdDb + kneeDb, 0);
    const fullRangeDb = kneeEnd + (0 - kneeEnd) / ratio;
    return -fullRangeDb * 0.6;
}

/** The fade-in, 0 to 1 over u in [0, 1]: a raised cosine, so it starts and ends without a corner. */
export function fadeCurve(points = 256): Float32Array {
    const out = new Float32Array(points);
    for (let i = 0; i < points; i++) out[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / (points - 1));
    return out;
}
