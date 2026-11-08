// What a theme file may say (contract ThemeDef): which numbers each layer takes, in what range, and
// what they mean. The theme loader (validate.ts) refuses a file with a missing or unknown number or
// one out of range, the engine (step 6) reads exactly these names, and the Sound Lab builds its
// sliders from this table. A parameter named *Step is a note of the scale: an index from 0 (the
// root) to the scale's last note, never a frequency, so a theme cannot leave the scale.
import type { LayerId, MaterialClass, Timbre } from '../contract';

export interface ParamSpec {
    readonly min: number;
    readonly max: number;
    /** the value of the built-in 'soft' theme: a sensible start for a new theme */
    readonly default: number;
    readonly integer: boolean;
    /** a note index of the theme's scale: 0 to its last note */
    readonly scaleIndex: boolean;
    /** what it does, with its unit */
    readonly doc: string;
    /**
     * Added after the first theme files were exported (v0.13): a file without it still loads and the
     * loader fills in `default`. Every other parameter must be in the file.
     */
    readonly optional: boolean;
}

const p = (min: number, max: number, def: number, doc: string): ParamSpec => ({ min, max, default: def, integer: false, scaleIndex: false, doc, optional: false });
const count = (min: number, max: number, def: number, doc: string): ParamSpec => ({ min, max, default: def, integer: true, scaleIndex: false, doc, optional: false });
const note = (def: number, doc: string): ParamSpec => ({ min: 0, max: 100, default: def, integer: true, scaleIndex: true, doc, optional: false });
/** A parameter added in v0.13: optional in a file (older exports lack it), always in the loaded theme. */
const added = (spec: ParamSpec): ParamSpec => ({ ...spec, optional: true });

export const LAYER_PARAMS: Readonly<Record<LayerId, Readonly<Record<string, ParamSpec>>>> = {
    safety: {
        pulseMs: p(10, 250, 60, 'length of one hazard pulse, ms'),
        periodNearMs: p(60, 500, 110, 'pulse period when a collision is imminent, ms'),
        periodFarMs: p(300, 3000, 1400, 'pulse period at the far end of the range, ms'),
        ttcFarS: p(1, 10, 4, 'time to collision at which the period is periodFarMs, s'),
        distFarM: p(2, 40, 12, 'distance at which the low-pass and the reverb send of a hazard reach their far values, m'),
        pulseDistM: added(p(0.3, 10, 2, 'distance at which the period is periodFarMs when the craft is not closing; closer than this, nearness quickens the pulse whatever the time to collision, m')),
        ildBoostDb: p(0, 12, 6, 'extra level difference between the ears for hazards under 2 m, dB'),
        lowpassNearHz: p(2000, 20000, 16000, 'low-pass cutoff of a near hazard, Hz'),
        lowpassFarHz: p(500, 16000, 2500, 'low-pass cutoff of a far hazard, Hz'),
        reverbSendFar: p(0, 1, 0.35, 'reverb send of a far hazard, 0 to 1'),
        pingMs: p(20, 400, 120, 'length of the ping on contact, ms'),
        pingStep: note(10, 'note of the contact ping'),
        pitchWallStep: note(7, 'note of a wall pulse'),
        pitchFloorStep: note(0, 'note of a floor pulse'),
        pitchCeilingStep: note(12, 'note of a ceiling pulse'),
        pitchObstacleStep: note(9, 'note of an obstacle pulse')
    },
    height: {
        baseStep: note(3, 'note of the height tone at the floor'),
        maxStep: note(17, 'highest note of the height tone'),
        metresPerStep: p(0.1, 5, 0.5, 'metres of height per scale step: the height tone glides one step up per this much climb'),
        glideMs: p(0, 400, 80, 'smoothing of the height glide and of a change of the target tone, ms'),
        roughDepth: p(0, 1, 0.6, 'roughness (amplitude modulation depth) outside the lesson band, 0 to 1'),
        roughHz: p(10, 90, 38, 'rate of the roughness, Hz'),
        bandSoftM: p(0, 2, 0.3, 'distance outside the band over which the roughness grows to full, m'),
        targetDb: added(p(-30, 0, -6, 'level of the steady target-height tone against the height tone, dB'))
    },
    speed: {
        tempoMinHz: p(0.3, 6, 1, 'tick rate at the slowest speed, Hz'),
        tempoMaxHz: p(2, 20, 9, 'tick rate at speedMaxMps, Hz'),
        speedMaxMps: p(3, 60, 15, 'speed at which the tick rate is tempoMaxHz, m/s'),
        tickMs: p(3, 80, 18, 'length of one tick, ms'),
        tickStep: note(5, 'note of a tick'),
        noiseMix: p(0, 1, 0.3, 'share of filtered air in a tick against its tone, 0 to 1')
    },
    target: {
        humStep: note(2, 'note of the hum from the next gate'),
        rateNearHz: p(2, 16, 8, 'hum repetition rate when the gate is near, Hz'),
        rateFarHz: p(0.3, 4, 1.2, 'hum repetition rate when the gate is far, Hz'),
        nearM: p(0.5, 10, 2, 'distance at which the rate is rateNearHz, m'),
        farM: p(5, 100, 40, 'distance at which the rate is rateFarHz, m'),
        roughMax: p(0, 1, 0.8, 'roughness when far off the gate axis, 0 to 1'),
        missFullM: p(0.2, 10, 3, 'off-axis miss at which the roughness is full, m'),
        noteMs: p(60, 800, 320, 'length of the note sounded on passing a gate, ms'),
        lapChimeMs: p(200, 2000, 900, 'length of the chime that completes a lap, ms')
    },
    shape: {
        shapeStep: note(9, 'note of the point source that traces a shape'),
        orbitHz: p(0.2, 3, 0.9, 'turns per second of a ring orbit'),
        sweepHz: p(0.1, 2, 0.5, 'sweeps per second along a pillar'),
        cornerMs: p(20, 300, 70, 'length of the tick at a square corner, ms'),
        faceHz: p(0.5, 6, 2.5, 'alternations per second between the front and back of a cube'),
        sizeBoostDb: p(0, 12, 4, 'how much louder a shape gets as it grows around the head, dB')
    },
    room: {
        bedStep: note(0, 'note of the room bed'),
        opennessFullM: p(5, 80, 25, 'mean free distance at which the room counts as fully open, m'),
        reverbMin: p(0, 1, 0.1, 'reverb send in a tight room, 0 to 1'),
        reverbMax: p(0, 1, 0.45, 'reverb send in an open room, 0 to 1'),
        bedOrder: count(0, 4, 0, 'Ambisonic order of the bed: 0 is a plain stereo bed, 3 or 4 an Ambisonic one (research 01 section 9); the first engine renders order 0'),
        bedLowpassHz: p(200, 8000, 900, 'low-pass cutoff of the bed, Hz')
    },
    voice: {
        pitch: p(0.5, 1.5, 1, 'speechSynthesis pitch'),
        volume: p(0.2, 1, 1, 'speechSynthesis volume')
    }
};

/** Pairs that must keep their order: `a` below `b`. */
export const PARAM_ORDER: readonly { readonly layer: LayerId; readonly low: string; readonly high: string }[] = [
    { layer: 'safety', low: 'periodNearMs', high: 'periodFarMs' },
    { layer: 'safety', low: 'lowpassFarHz', high: 'lowpassNearHz' },
    { layer: 'height', low: 'baseStep', high: 'maxStep' },
    { layer: 'speed', low: 'tempoMinHz', high: 'tempoMaxHz' },
    { layer: 'target', low: 'rateFarHz', high: 'rateNearHz' },
    { layer: 'target', low: 'nearM', high: 'farM' },
    { layer: 'room', low: 'reverbMin', high: 'reverbMax' }
];

const ALL_TIMBRES: Readonly<Record<Timbre, true>> = { mallet: true, pad: true, sine: true, click: true, pluck: true, air: true, noise: true, wood: true, thud: true, metal: true };
/** Every timbre the engine can make (a missing one is a compile error). */
export const TIMBRES = Object.keys(ALL_TIMBRES) as Timbre[];

/** The pentatonic scales a theme may use have five degrees, no two a semitone apart (all gaps 2 or 3 semitones). */
export const PENTATONIC_DEGREES = 5;

export function defaultLayerParams(layer: LayerId): Record<string, number> {
    return Object.fromEntries(Object.entries(LAYER_PARAMS[layer]).map(([k, spec]) => [k, spec.default]));
}

export const THEME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type { MaterialClass };
