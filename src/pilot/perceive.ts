// The ear pilot's ears (sonic3 plan section 4, stage Z3): what a pilot with headphones could take from one frame of the
// cue planner, and nothing more. It reads the frame's voices (after the allocator) and the duck of an urgent hazard; it
// never reads a voice's distance, the world, the target or the track.
//
// What it hears, per voice (every threshold an estimate the plan names):
// - its level after the layer gain and the duck; only the `maxStreams` loudest continuous voices are followed;
// - left or right: the side of the direction when the voice is at least `jndDeg` off the median plane, or when its extra
//   level difference between the ears is at least `jndDb`; else centred;
// - front or back: from the direction, wrong in `frontBackError` of the voices (a generic HRTF in headphones: the
//   consultant's figure), drawn once when a voice starts, seeded;
// - up or down: only from the pitch code of the target hum (scale steps from its learned base note, the on-course octave);
// - urgency: the pulse rate, and the duck of everything else when a hazard is urgent.
import type { LayerId, LessonLayers, SonicPrefs, ThemeDef, Vec3 } from '../contract';
import { CuePlanner, duckDb, layerGainDb, type FramePlan } from '../cues/planner';

export interface Hearing {
    /** just-noticeable level difference between the ears, dB (estimate) */
    readonly jndDb: number;
    /** just-noticeable angle off the median plane, degrees (estimate) */
    readonly jndDeg: number;
    /** share of voices heard on the wrong side of the ear axis (front for back), 0..1 */
    readonly frontBackError: number;
    /** voices followed at once, the loudest after ducking (estimate) */
    readonly maxStreams: number;
    /** the target hum is always one of the followed streams, when it sounds (selective attention; plan: off) */
    readonly attendHum?: boolean;
    readonly seed: number;
}

export const DEFAULT_HEARING: Hearing = { jndDb: 2, jndDeg: 10, frontBackError: 0.29, maxStreams: 2, seed: 1 };

export interface StreamPercept {
    readonly key: string;
    readonly cue: string;
    readonly layer: LayerId;
    /** -1 left, 0 centred, 1 right */
    readonly side: -1 | 0 | 1;
    /** heard behind the ear axis (may be wrong: Hearing.frontBackError) */
    readonly behind: boolean;
    /** scale steps of the pitch code (target hum only; positive: up), else 0 */
    readonly elevSteps: number;
    /** the hum's on-course octave */
    readonly onCourse: boolean;
    /** pulses per second, null for a continuous tone */
    readonly rateHz: number | null;
    readonly levelDb: number;
}

export interface Percepts {
    readonly t: number;
    /** the duck of an urgent hazard is heard */
    readonly urgent: boolean;
    /** the voices followed, loudest first */
    readonly streams: readonly StreamPercept[];
}

const rng32 = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let x = a;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
};

const ALL_LAYERS: LessonLayers = { on: ['safety', 'height', 'speed', 'target', 'shape', 'room', 'voice'], hazardVoices: 3, heightBandM: null };

/**
 * The hum's base note as a pilot learns it in the glossary: the note it plays for a target level with the craft, off
 * course (45 degrees to the right, 10 m away, no world). A listening calibration, not a read of the planner's state.
 */
export function learnHumBase(theme: ThemeDef, prefs: SonicPrefs): number | null {
    const planner = new CuePlanner({ theme, prefs, layers: ALL_LAYERS });
    const q: readonly [number, number, number, number] = [1, 0, 0, 0];
    const plan = planner.plan({
        sample: { t: 0, tick: 0, pos: [0, 2, 0], vel: [0, 0, 0], quat: q, rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false },
        world: null,
        target: { id: 'calibrate', shape: { kind: 'zone', size: [1, 1, 1] }, pos: [7.07, 2, -7.07], quat: q, order: null, solid: false, material: 'obstacle' },
        floorY: 0
    });
    const v = plan.voices.find((x) => x.cue === 'target.hum');
    return v === undefined ? null : v.noteIndex;
}

export class Ear {
    private readonly rnd: () => number;
    /** front-back flip drawn for each voice key when it started */
    private flips = new Map<string, boolean>();
    private readonly humBase: number | null;
    private readonly scaleSteps: number;

    constructor(
        private readonly theme: ThemeDef,
        private readonly prefs: SonicPrefs,
        readonly hearing: Hearing = DEFAULT_HEARING
    ) {
        this.rnd = rng32(hearing.seed);
        this.humBase = learnHumBase(theme, prefs);
        this.scaleSteps = theme.scale.steps.length;
    }

    hear(plan: FramePlan): Percepts {
        const duck = duckDb(false, plan.urgent, this.theme);
        const all: StreamPercept[] = [];
        const keys = new Map<string, boolean>();
        for (const v of plan.voices) {
            let flip = this.flips.get(v.key);
            if (flip === undefined) flip = this.rnd() < this.hearing.frontBackError;
            keys.set(v.key, flip);
            const levelDb = v.gainDb + layerGainDb(this.theme, this.prefs, v.layer) + duck[v.layer];
            all.push({ key: v.key, cue: v.cue, layer: v.layer, side: this.side(v.dir, v.ildDb), behind: v.dir[2] > 0 !== flip, ...this.pitchCode(v.cue, v.noteIndex), rateHz: v.periodS === null || v.periodS <= 0 ? null : 1 / v.periodS, levelDb });
        }
        this.flips = keys;
        all.sort((a, b) => b.levelDb - a.levelDb || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        const hum = this.hearing.attendHum === true ? all.find((x) => x.cue === 'target.hum') : undefined;
        const streams = hum === undefined ? all.slice(0, this.hearing.maxStreams) : [hum, ...all.filter((x) => x !== hum)].slice(0, this.hearing.maxStreams);
        return { t: plan.t, urgent: plan.urgent && streams.some((s) => s.layer === 'safety'), streams };
    }

    private side(dir: Vec3, ildDb: number): -1 | 0 | 1 {
        const lateralDeg = (Math.asin(Math.max(-1, Math.min(1, dir[0]))) * 180) / Math.PI;
        if (Math.abs(lateralDeg) >= this.hearing.jndDeg || (ildDb >= this.hearing.jndDb && Math.abs(dir[0]) > 1e-6)) return dir[0] > 0 ? 1 : -1;
        return 0;
    }

    private pitchCode(cue: string, noteIndex: number): { readonly elevSteps: number; readonly onCourse: boolean } {
        if (cue !== 'target.hum' || this.humBase === null) return { elevSteps: 0, onCourse: false };
        const d = noteIndex - this.humBase;
        const sign = this.prefs.heightPolarity === 'up-higher' ? 1 : -1;
        if (Math.abs(d) <= 2) return { elevSteps: sign * d, onCourse: false };
        if (Math.abs(d - this.scaleSteps) <= 2) return { elevSteps: sign * (d - this.scaleSteps), onCourse: true };
        if (Math.abs(d + this.scaleSteps) <= 2) return { elevSteps: sign * (d + this.scaleSteps), onCourse: true };
        return { elevSteps: 0, onCourse: false };
    }
}
