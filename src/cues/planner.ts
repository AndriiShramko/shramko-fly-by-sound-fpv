// The cue planner: once per frame it turns what the craft senses (a FlightSample, the world, the
// next target) into what should sound (spec section 2): the hazard voices, the target hum, the
// shape trace, the height tone, the speed ticks and the room, each with its note, rhythm,
// roughness, direction and distance code. Pure and deterministic: the engine (src/audio) renders a
// plan, the replay re-derives the same cues from recorded frames, the Node tests check it.
//
// Frames: directions are in the listener frame (heading by default, contract header), unit vectors.
// The craft is the listener, at the origin of that frame.
//
// Up and down (lane s13-elev, owner's message 42): pitch carries them, and with SonicPrefs.heightDirection on (the
// default) the cues that mean up or down also come from above or below through the HRTF: the open-way chime from the
// way's middle past the obstacle (FreeWay.dir), the target height note from the target (a gate's centre, or a band's
// middle TARGET_AHEAD_M ahead), the floor and the ceiling from where the sampler saw them (as in v0.13). Each carries a
// breath of air up to about 16 kHz (`airDb`), because the HRTF tells height only in that band. Notes, intervals,
// rhythm and levels stay v0.13's; with the setting off every plan is v0.13's exactly.
//
// The beacon (lane sonic-beacon, owner's complaint of 2026-11-10): with SonicPrefs.beacon on (absent or true) the target
// hum's direction is folded into the front half circle (beyond 90 degrees from the nose it stays at the ear of its side,
// src/cues/beacon.ts) and on course (within ON_COURSE_DEG) the hum is an octave higher, on the scale. Tempo, level and
// elevation stay as they were; with the setting off every plan is that of b102ce6 exactly.
import type { ActiveCue, CueEvent, CueId, FlightSample, LayerId, LessonLayers, MaterialClass, ObjectShape, Quat, SonicFrameInput, SonicObject, SonicPrefs, SonicWorld, ThemeDef, Timbre, Vec3 } from '../contract';
import { LAYER_IDS } from '../contract';
import { defaultPrefs } from '../prefs/prefs';
import { findFreeWay, type FreeSide, type FreeWay } from '../sense/freeway';
import { createSceneSampler, type SamplerOptions, type SceneSampler } from '../sense/sampler';
import { headingBasis, listenerBasis, worldToListener, type Basis } from '../sense/frame';
import type { Hazard, SceneSample } from '../sense/types';
import { applyCalm } from '../theme/calm';
import { gateMelody, noteHz, noteHzAt } from '../theme/pitch';
import { beaconBearing, foldToFront } from './beacon';
import { alignOffset, heightTones, isGate, referenceHeightM, targetHeightM, type HeightToneRule, type TargetTone } from './height';
import { add, dot, length, normalize, quatConjugate, quatRotate, scale, sub, yawQuat } from '../util/vec';
import {
    aimMissM,
    clamp01,
    distanceCode,
    dopplerCents,
    hazardDistanceCode,
    elevationSteps,
    expLerp,
    isUrgent,
    note,
    openness,
    pulsePeriodMs,
    roomCode,
    speedTempoHz,
    targetBeat,
    targetRateHz,
    targetRoughness,
    URGENT_DUCK_DB,
    type DistanceRule
} from './rules';
import { shapePoint, traceKind, traceRadius, type ShapeRule } from './shape';
import { MAX_MOVING_VOICES, MAX_STATIC_VOICES, PRIORITY, VoiceAllocator } from './voices';

// ------------------------------------------------------------------ plans

/** Where a shape voice's point is, worked out by whoever keeps the clock (the engine: the audio clock). */
export interface TracePlan {
    readonly shape: ObjectShape;
    readonly rule: ShapeRule;
    readonly objectPos: Vec3;
    readonly objectQuat: Quat;
    /** the listener when the plan was made */
    readonly listenerPos: Vec3;
    readonly basis: Basis;
}

/** One moving spatial voice (a hazard, the target hum, the shape trace, a preview). */
export interface VoicePlan {
    /** stable while the same thing sounds: 'safety:front', 'target', 'shape', 'preview:3' */
    readonly key: string;
    readonly cue: CueId;
    readonly layer: LayerId;
    readonly priority: number;
    /** the voice slot the allocator gave it (0..MAX_MOVING_VOICES-1) */
    readonly slot: number;
    /** listener-frame unit direction */
    readonly dir: Vec3;
    readonly distance: number;
    readonly timbre: Timbre;
    readonly noteIndex: number;
    readonly hz: number;
    /** time between notes, s; null for a continuous tone */
    readonly periodS: number | null;
    /** length of one note (pulse mode) or of an accent tick (continuous mode), s */
    readonly noteS: number;
    /** level change of this voice, dB (distance, size); the layer gain is the engine's bus */
    readonly gainDb: number;
    readonly lowpassHz: number;
    readonly reverbSend: number;
    /** extra level difference between the ears, dB >= 0 */
    readonly ildDb: number;
    readonly dopplerCents: number;
    /** amplitude-modulation roughness, 0..1, at roughHz */
    readonly rough: number;
    readonly roughHz: number;
    /** beating: a second voice beatHz above the note at beatDepth (0..1) */
    readonly beatHz: number;
    readonly beatDepth: number;
    readonly trace: TracePlan | null;
    /** a second note played with every pulse (the open-way chime's upper note), Hz; null for none */
    readonly harmonyHz?: number | null;
    /**
     * Lane s13-elev: a breath of air from about 4 to 16 kHz with every note, this many dB against a unit fundamental, so
     * the HRTF can tell its height; absent: none (v0.13, and every cue that does not mean up or down)
     */
    readonly airDb?: number;
}

/**
 * The height layer (M41-12, src/cues/height.ts): a tone that glides with the height, and a short note
 * at the target height's pitch about once a second, the height tone giving way to it meanwhile (null
 * when the lesson has no target height or the pilot turned it off).
 */
export interface HeightPlan {
    /** the whole note nearest to the glide (the stepped tone of v0.12) */
    readonly noteIndex: number;
    /** position on the scale of the glide: a note index with a fraction */
    readonly position: number;
    /** the glide's frequency now */
    readonly hz: number;
    /** metres above the lesson floor (a preview: as if) */
    readonly heightM: number;
    readonly rough: number;
    readonly roughHz: number;
    readonly glideS: number;
    readonly timbre: Timbre;
    readonly target: TargetTone | null;
}

export interface SpeedPlan {
    /** ticks per second; 0 = silent */
    readonly tempoHz: number;
    readonly noteIndex: number;
    readonly hz: number;
    readonly noteS: number;
    readonly noiseMix: number;
    readonly timbre: Timbre;
}

export interface RoomPlan {
    /** 0 tight .. 1 open */
    readonly open: number;
    /** reverb return, 0..1 */
    readonly reverb: number;
    readonly bedLowpassHz: number;
    readonly noteIndex: number;
    readonly hz: number;
    readonly timbre: Timbre;
}

/** A one-off note (touch ping, gate note, chime, fanfare, ...). */
export interface NotePlan {
    readonly key: string;
    readonly cue: CueId;
    readonly layer: LayerId;
    readonly priority: number;
    /** after the cue's time, s */
    readonly atS: number;
    readonly timbre: Timbre;
    readonly noteIndex: number;
    readonly hz: number;
    readonly durS: number;
    readonly gainDb: number;
    /** listener-frame direction, or null for a centred note */
    readonly dir: Vec3 | null;
    /** static voice slot for a spatial note (0..MAX_STATIC_VOICES-1), null when centred */
    readonly slot: number | null;
}

export interface FramePlan {
    /** page clock of the sample, ms */
    readonly t: number;
    readonly scene: SceneSample | null;
    /** the moving voices that got a slot, most important first */
    readonly voices: readonly VoicePlan[];
    /** keys that asked for a moving voice and got none (stolen or over the budget) */
    readonly dropped: readonly string[];
    readonly height: HeightPlan | null;
    readonly speed: SpeedPlan | null;
    readonly room: RoomPlan | null;
    /** a hazard is urgent: the safety layer ducks the others */
    readonly urgent: boolean;
    readonly cues: readonly ActiveCue[];
    /** the free way beside an obstacle ahead, while the open-way chime sounds (M41-14), else null */
    readonly freeWay: FreeWay | null;
}

// ------------------------------------------------------------------ constants

/** The shape layer traces the next target, or else the nearest solid object within this range, m. */
export const SHAPE_RANGE_M = 12;
/** Above this speed the aim line is the velocity; below it the nose's heading, m/s. */
export const AIM_BY_VELOCITY_MPS = 1;
/** The note the gate melody starts on (index in the scale: 5 = the root an octave up, C4 in the shipped themes). */
export const GATE_MELODY_BASE = 5;
/** How long a preview plays, s. */
export const PREVIEW_S = 3;
/**
 * How long one play of a 'repeat-cue' lasts when the event gives no `durS`, s (M41-5). The runner gives every
 * play its length (lane s13-lessons, src/lesson/sounds.ts: 2.5 s for a continuous cue, 1.2 s for a one-off one)
 * and sends the next play about 1 s after it; the planner sounds a continuous cue for exactly that long and a
 * one-off cue as its own notes, cut at that length.
 */
export const REPEAT_PLAY_DEFAULT_S = 2.5;
/** The shortest and the longest play of a 'repeat-cue' the planner makes, s: a `durS` out of range is held to them. */
export const REPEAT_PLAY_RANGE_S: readonly [number, number] = [0.2, 6];
/** The praise figures, scale steps over the root an octave above the gate melody's start: one after the other, so praise does not tire. */
export const PRAISE_FIGURES: readonly (readonly number[])[] = [
    [0, 2, 4],
    [2, 4, 5],
    [0, 3, 5]
];
/** The open-way chime goes on this long after the obstacle ahead was last closer than its trigger time, ms. */
export const FREE_HOLD_MS = 400;
/** Where the open-way chime comes from, listener frame: 60 degrees left or right; up and down from ahead (pitch says which). */
export const FREE_DIRS: Readonly<Record<FreeSide, Vec3>> = {
    left: [-Math.sin(Math.PI / 3), 0, -Math.cos(Math.PI / 3)],
    right: [Math.sin(Math.PI / 3), 0, -Math.cos(Math.PI / 3)],
    up: [0, 0, -1],
    down: [0, 0, -1]
};
/** How many scale steps above the side chime's note a way above starts (and a way below ends below it). */
export const FREE_ELEVATION_STEPS = 3;
/**
 * Lane s13-elev: where a named or previewed way above or below comes from (no obstacle to measure it by): this many
 * degrees above or below straight ahead. In flight the chime comes from the way itself (FreeWay.dir).
 */
export const FREE_PREVIEW_ELEVATION_DEG = 30;
/** The directions of FREE_PREVIEW_ELEVATION_DEG, listener frame. */
export const FREE_PREVIEW_DIRS: Readonly<Record<'up' | 'down', Vec3>> = {
    up: [0, Math.sin((FREE_PREVIEW_ELEVATION_DEG * Math.PI) / 180), -Math.cos((FREE_PREVIEW_ELEVATION_DEG * Math.PI) / 180)],
    down: [0, -Math.sin((FREE_PREVIEW_ELEVATION_DEG * Math.PI) / 180), -Math.cos((FREE_PREVIEW_ELEVATION_DEG * Math.PI) / 180)]
};
/**
 * Lane s13-elev: a band's target height (a hover lesson's) has no point of its own; its note comes from the band's
 * middle this far ahead of the craft along its heading, m: 0.5 m off the middle is 14 degrees above or below.
 */
export const TARGET_AHEAD_M = 2;
/** Lane s13-elev: the breath of air a cue of up or down carries with the direction on, dB against a unit fundamental. */
export const ELEVATION_AIR_DB = -10;
/** Lane s13-elev: the open-way chime's low-pass when it comes from above or below (v0.13: 12 kHz), Hz. */
export const ELEVATION_LOWPASS_HZ = 18000;
/** Default direction of a preview, listener frame. */
const FRONT: Vec3 = [0, 0, -1];

/** The timbre of the bright one-off notes (gate notes, chimes, fanfare) for a layer timbre: melodic, never a noise. */
const NOTE_TIMBRE: Readonly<Record<Timbre, Timbre>> = {
    mallet: 'mallet',
    pad: 'mallet',
    sine: 'sine',
    click: 'sine',
    pluck: 'pluck',
    air: 'mallet',
    noise: 'pluck',
    wood: 'mallet',
    thud: 'mallet',
    metal: 'metal'
};

/** Default direction of a hazard preview per surface. */
const MATERIAL_DIR: Readonly<Record<MaterialClass, Vec3>> = {
    wall: FRONT,
    floor: [0, -1, 0],
    ceiling: [0, 1, 0],
    obstacle: [Math.SQRT1_2, 0, -Math.SQRT1_2]
};

const ALL_ON: LessonLayers = { on: LAYER_IDS, heightBandM: null, hazardVoices: 3 };

const PREVIEW_SHAPES: Readonly<Record<string, ObjectShape>> = {
    'shape.ring': { kind: 'ring', diameter: 2.4, tube: 0.1 },
    'shape.square': { kind: 'square', side: 2.4, bar: 0.12 },
    'shape.cube': { kind: 'cube-frame', side: 2.4, bar: 0.12 },
    'shape.pillar': { kind: 'pillar', radius: 0.4, height: 6 }
};

/** The cue id of a one-off event. */
export function eventCue(e: CueEvent): CueId {
    switch (e.kind) {
        case 'touch':
            return 'safety.touch';
        case 'reset':
            return 'safety.reset';
        case 'gate':
            return 'target.note';
        case 'lap':
            return 'target.lap';
        case 'checkpoint':
            return 'target.checkpoint';
        case 'fanfare':
            return 'target.fanfare';
        case 'preview':
            return e.cue;
        case 'wrong-way':
            return 'safety.wrong-way';
        case 'wrong-side':
            return 'safety.wrong-side';
        case 'praise':
            return 'target.praise';
        case 'stage':
            return 'target.stage';
        case 'repeat-cue':
            return e.cue;
        case 'answer':
            return 'target.answer';
    }
}

/** How far each layer ducks, dB (<= 0): speech ducks every other layer by duckDb; an urgent hazard is never ducked and ducks the rest. */
export function duckDb(speaking: boolean, urgent: boolean, theme: Pick<ThemeDef, 'duckDb'>): Record<LayerId, number> {
    const out = {} as Record<LayerId, number>;
    for (const id of LAYER_IDS) {
        let d = speaking ? -theme.duckDb : 0;
        if (urgent) d = id === 'safety' ? 0 : Math.min(d, -URGENT_DUCK_DB);
        out[id] = id === 'voice' ? 0 : d;
    }
    return out;
}

/** The gain of a layer's bus, dB: the theme's plus the pilot's own. */
export function layerGainDb(theme: ThemeDef, prefs: SonicPrefs, layer: LayerId): number {
    return theme.layers[layer].gainDb + (prefs.layerGainDb[layer] ?? 0);
}

interface Preview {
    readonly key: string;
    readonly cue: CueId;
    readonly dir: Vec3;
    readonly t0: number;
    readonly durS: number;
}

interface SoundingNote {
    readonly cue: CueId;
    readonly layer: LayerId;
    readonly dir: Vec3 | null;
    readonly hz: number;
    readonly endT: number;
    readonly slot: number | null;
    readonly priority: number;
}

export interface PlannerOptions {
    readonly theme: ThemeDef;
    readonly prefs?: SonicPrefs;
    readonly layers?: LessonLayers;
    readonly sampler?: SamplerOptions;
    /** voices the allocator may give out at once (MAX_MOVING_VOICES); a larger number exists only for the proofs' negative control */
    readonly maxMovingVoices?: number;
    /** the height tone rounded to whole notes as in v0.12: only the virtual listener's continuity control */
    readonly steppedHeight?: boolean;
}

const tri = (u: number): number => {
    const f = u - Math.floor(u);
    return f < 0.5 ? 2 * f : 2 - 2 * f;
};

/**
 * Plans the sound of each frame. One planner per craft (the scene sampler inside it keeps the
 * hysteresis); `reset()` on a new lesson or a seek.
 */
export class CuePlanner {
    private baseTheme: ThemeDef;
    private effectiveTheme: ThemeDef;
    private prefsValue: SonicPrefs;
    private layersValue: LessonLayers;
    private on: Set<LayerId>;
    private readonly sampler: SceneSampler;
    private readonly moving: VoiceAllocator;
    private readonly steppedHeight: boolean;
    private readonly staticSlots: (SoundingNote | null)[] = new Array<SoundingNote | null>(MAX_STATIC_VOICES).fill(null);
    private previews: Preview[] = [];
    private notes: SoundingNote[] = [];
    private previewCount = 0;
    private noteCount = 0;
    private lastT = 0;
    /** praise figures played so far (the next one is PRAISE_FIGURES[count % length]) */
    private praiseCount = 0;
    /** the open-way chime: the side sounding, and the page time it stops if not renewed */
    private freeSide: FreeSide | null = null;
    private freeUntil = 0;
    private freeLast: FreeWay | null = null;
    /** the height mapping's alignment for the current world and band (height.ts alignOffset) */
    private align: { readonly world: SonicWorld | null; readonly band: LessonLayers['heightBandM']; readonly floorY: number; readonly metresPerStep: number; readonly offset: number } | null = null;

    constructor(options: PlannerOptions) {
        this.baseTheme = options.theme;
        this.prefsValue = options.prefs ?? defaultPrefs();
        this.effectiveTheme = this.prefsValue.calm ? applyCalm(this.baseTheme) : this.baseTheme;
        this.layersValue = options.layers ?? ALL_ON;
        this.on = new Set(this.layersValue.on);
        this.sampler = createSceneSampler(options.sampler);
        this.sampler.setMaxVoices(Math.min(this.layersValue.hazardVoices, 3));
        this.moving = new VoiceAllocator(options.maxMovingVoices ?? MAX_MOVING_VOICES);
        this.steppedHeight = options.steppedHeight === true;
    }

    /** The theme as it sounds: the calm preset applied when the pilot asked for it. */
    get theme(): ThemeDef {
        return this.effectiveTheme;
    }

    get prefs(): SonicPrefs {
        return this.prefsValue;
    }

    get layers(): LessonLayers {
        return this.layersValue;
    }

    setTheme(theme: ThemeDef): void {
        this.baseTheme = theme;
        this.effectiveTheme = this.prefsValue.calm ? applyCalm(theme) : theme;
    }

    setPrefs(prefs: SonicPrefs): void {
        this.prefsValue = prefs;
        this.effectiveTheme = prefs.calm ? applyCalm(this.baseTheme) : this.baseTheme;
    }

    setLayers(layers: LessonLayers): void {
        this.layersValue = layers;
        this.on = new Set(layers.on);
        this.sampler.setMaxVoices(Math.max(0, Math.min(layers.hazardVoices, 3)));
    }

    /**
     * Forget the sounding hazards, previews and notes (a new lesson, a seek): the next frame is planned as a new planner
     * plans it, and a cue before that frame is stamped at 0 as a new planner stamps it (lane s13-int).
     */
    reset(): void {
        this.sampler.reset();
        this.moving.clear();
        this.previews = [];
        this.notes = [];
        this.staticSlots.fill(null);
        this.align = null;
        this.freeSide = null;
        this.freeUntil = 0;
        this.freeLast = null;
        this.praiseCount = 0;
        this.lastT = 0;
    }

    private pitch(layer: LayerId): number {
        return this.prefsValue.layerPitchSteps[layer] ?? 0;
    }

    // -------------------------------------------------------------- one frame

    plan(input: SonicFrameInput): FramePlan {
        const s = input.sample;
        const t = s.t;
        this.lastT = t;
        const theme = this.effectiveTheme;
        const frame = this.prefsValue.listenerFrame;
        const basis = listenerBasis(s, frame);
        const scene = this.sampler.sample(s, input.world, frame);
        const velL = worldToListener(basis, s.vel);

        const requests: Omit<VoicePlan, 'slot'>[] = [];
        let freeWay: FreeWay | null = null;
        if (this.on.has('safety')) {
            for (const h of scene.hazards) requests.push(this.hazardVoice(h, velL, `safety:${h.sector}`, PRIORITY.hazard - h.rank));
            freeWay = this.freeWayNow(input, frame);
            if (freeWay !== null) requests.push(this.freeVoice(freeWay.side, `free:${freeWay.side}`, PRIORITY.free, freeWay.dir));
        }
        if (this.on.has('target') && input.target !== null) requests.push(this.targetVoice(input.target, s, basis));
        if (this.on.has('shape')) {
            const obj = this.shapeObject(input, s);
            if (obj !== null) {
                const v = this.shapeVoice(obj, s.pos, basis, s.vel, t / 1000, 'shape', PRIORITY.shape);
                if (v !== null) requests.push(v);
            }
        }
        // previews (glossary, lesson narration) sound whatever layers the lesson has on
        this.previews = this.previews.filter((p) => t < p.t0 + p.durS * 1000 && t >= p.t0 - 1);
        let height: HeightPlan | null = this.on.has('height') ? this.heightPlan(input) : null;
        let speed: SpeedPlan | null = this.on.has('speed') ? this.speedPlan(length(s.vel)) : null;
        let room: RoomPlan | null = this.on.has('room') ? this.roomPlan(openness(scene.meanFreeDistanceM, { opennessFullM: theme.layers.room.params['opennessFullM'] as number })) : null;
        for (const p of this.previews) {
            const u = clamp01((t - p.t0) / (p.durS * 1000));
            const layer = p.cue.split('.')[0] as LayerId;
            if (layer === 'height') height = this.previewHeight(p.cue, u);
            else if (layer === 'speed') speed = this.speedPlan((theme.layers.speed.params['speedMaxMps'] as number) * tri(u));
            else if (layer === 'room') room = this.roomPlan(u);
            else {
                const v = this.previewVoice(p, u, (t - p.t0) / 1000);
                if (v !== null) requests.push(v);
            }
        }

        const alloc = this.moving.assign(requests.map((r) => ({ key: r.key, priority: r.priority })));
        const voices: VoicePlan[] = [];
        for (const r of requests) {
            const slot = alloc.slotOf.get(r.key);
            if (slot !== undefined) voices.push({ ...r, slot });
        }
        voices.sort((a, b) => b.priority - a.priority);

        const urgent = this.on.has('safety') && scene.hazards.some((h) => isUrgent(h.ttcS, h.distance));
        this.notes = this.notes.filter((n) => n.endT > t);
        for (let i = 0; i < this.staticSlots.length; i++) {
            const n = this.staticSlots[i];
            if (n !== null && n !== undefined && n.endT <= t) this.staticSlots[i] = null;
        }
        const cues = this.cues(voices, height, speed, room);
        return { t, scene, voices, dropped: alloc.dropped, height, speed, room, urgent, cues, freeWay };
    }

    /** The free way now, with a short hold so the chime does not stutter as the probes pass the obstacle's edge. */
    private freeWayNow(input: SonicFrameInput, frame: SonicPrefs['listenerFrame']): FreeWay | null {
        const t = input.sample.t;
        if (this.freeUntil > t + FREE_HOLD_MS) this.freeUntil = t; // the clock went back (a seek)
        const found = findFreeWay(input.sample, input.world, frame, { bodyRadiusM: this.sampler.config.bodyRadiusM, prefer: this.freeSide });
        if (found !== null) {
            this.freeSide = found.side;
            this.freeUntil = t + FREE_HOLD_MS;
            this.freeLast = found;
            return found;
        }
        if (this.freeSide !== null && t < this.freeUntil) return this.freeLast;
        this.freeSide = null;
        this.freeLast = null;
        return null;
    }

    /** Lane sonic-beacon: the target hum folded to the front half circle, an octave up on course (SonicPrefs.beacon: absent or true). */
    private get beacon(): boolean {
        return this.prefsValue.beacon !== false;
    }

    /** Lane s13-elev: the cues of up and down also come from above or below (SonicPrefs.heightDirection: absent or true). */
    private get elevation(): boolean {
        return this.prefsValue.heightDirection !== false;
    }

    /**
     * The open-way chime from a side (review m2): two quick notes on the scale whose contour tells the way with no
     * note to compare against: two equal notes from the left or the right; a rising pair for a way above (starting
     * three steps over the side's note) and a falling pair for one below (ending three steps under it), turned over
     * with the polarity as the height tone is. Above and below come from ahead in v0.13; with the direction on (lane
     * s13-elev) from the way itself (`wayDir`, else FREE_PREVIEW_DIRS) with a breath of air, the notes unchanged.
     */
    private freeVoice(side: FreeSide, key: string, priority: number, wayDir?: Vec3): Omit<VoicePlan, 'slot'> {
        const theme = this.effectiveTheme;
        const p = theme.layers.safety.params as Record<string, number>;
        const toward = side === 'up' ? 1 : side === 'down' ? -1 : 0;
        const move = this.prefsValue.heightPolarity === 'up-higher' ? toward : -toward;
        const base = (p['freeStep'] as number | undefined) ?? 13;
        const start = move > 0 ? FREE_ELEVATION_STEPS : move < 0 ? 2 - FREE_ELEVATION_STEPS : 0;
        const lo = note(theme.scale, base, this.pitch('safety'), start);
        const hi = note(theme.scale, lo.index, 2 * move);
        const period = ((p['freePeriodMs'] as number | undefined) ?? 600) / 1000;
        const placed = (side === 'up' || side === 'down') && this.elevation;
        return {
            key,
            cue: 'safety.free',
            layer: 'safety',
            priority,
            dir: placed ? (wayDir ?? FREE_PREVIEW_DIRS[side as 'up' | 'down']) : FREE_DIRS[side],
            distance: 1,
            timbre: NOTE_TIMBRE[theme.layers.target.timbre],
            noteIndex: lo.index,
            hz: lo.hz,
            periodS: period,
            noteS: 0.16,
            gainDb: -4,
            lowpassHz: placed ? ELEVATION_LOWPASS_HZ : 12000,
            reverbSend: 0.12,
            ildDb: 0,
            dopplerCents: 0,
            rough: 0,
            roughHz: 0,
            beatHz: 0,
            beatDepth: 0,
            trace: null,
            harmonyHz: hi.hz,
            ...(placed ? { airDb: ELEVATION_AIR_DB } : {})
        };
    }

    private cues(voices: readonly VoicePlan[], height: HeightPlan | null, speed: SpeedPlan | null, room: RoomPlan | null): ActiveCue[] {
        const out: ActiveCue[] = [];
        for (const v of voices) {
            out.push({
                id: v.key.startsWith('safety:') ? `${v.cue}:${v.key.slice(7)}` : v.key.startsWith('free:') ? `${v.cue}:${v.key.slice(5)}` : v.key.startsWith('preview:') ? `${v.cue}:preview` : v.cue,
                layer: v.layer,
                dir: v.dir,
                distance: v.distance,
                rateHz: v.periodS === null ? null : 1 / v.periodS,
                pitchHz: v.hz,
                rough: Math.max(v.rough, v.beatDepth)
            });
        }
        if (height !== null) out.push({ id: height.rough > 0 ? 'height.rough' : 'height.tone', layer: 'height', dir: null, distance: null, rateHz: null, pitchHz: height.hz, rough: height.rough });
        if (height !== null && height.target !== null) out.push({ id: 'height.target', layer: 'height', dir: height.target.dir ?? null, distance: null, rateHz: null, pitchHz: height.target.hz, rough: 0 });
        if (speed !== null && speed.tempoHz > 0) out.push({ id: 'speed.tick', layer: 'speed', dir: null, distance: null, rateHz: speed.tempoHz, pitchHz: speed.hz, rough: 0 });
        if (room !== null) out.push({ id: 'room.bed', layer: 'room', dir: null, distance: null, rateHz: null, pitchHz: room.hz, rough: 0 });
        for (const n of this.notes) out.push({ id: n.cue, layer: n.layer, dir: n.dir, distance: null, rateHz: null, pitchHz: n.hz, rough: 0 });
        return out;
    }

    private hazardVoice(h: Pick<Hazard, 'sector' | 'distance' | 'ttcS' | 'dir' | 'material'>, velL: Vec3, key: string, priority: number): Omit<VoicePlan, 'slot'> {
        const theme = this.effectiveTheme;
        const p = theme.layers.safety.params as Record<string, number>;
        const step = h.material === 'wall' ? p['pitchWallStep'] : h.material === 'floor' ? p['pitchFloorStep'] : h.material === 'ceiling' ? p['pitchCeilingStep'] : p['pitchObstacleStep'];
        const n = note(theme.scale, step as number, this.pitch('safety'));
        const rule: DistanceRule = { nearHz: p['lowpassNearHz'] as number, farHz: p['lowpassFarHz'] as number, farM: p['distFarM'] as number, sendNear: 0.04, sendFar: p['reverbSendFar'] as number, ildBoostDb: p['ildBoostDb'] as number };
        const dc = hazardDistanceCode(h.distance, h.ttcS, rule);
        const periodMs = pulsePeriodMs(h.ttcS, h.distance, { periodNearMs: p['periodNearMs'] as number, periodFarMs: p['periodFarMs'] as number, ttcFarS: p['ttcFarS'] as number, distM: (p['pulseDistM'] as number | undefined) ?? 2 });
        return {
            key,
            cue: `safety.${h.material}`,
            layer: 'safety',
            priority,
            dir: h.dir,
            distance: h.distance,
            timbre: theme.materials[h.material],
            noteIndex: n.index,
            hz: n.hz,
            periodS: periodMs / 1000,
            noteS: (p['pulseMs'] as number) / 1000,
            gainDb: dc.gainDb,
            lowpassHz: dc.lowpassHz,
            reverbSend: dc.reverbSend,
            ildDb: dc.ildDb,
            dopplerCents: dopplerCents(dot(velL, h.dir)),
            rough: 0,
            roughHz: 0,
            beatHz: 0,
            beatDepth: 0,
            trace: null,
            // lane s13-elev: the floor and the ceiling come from below and above (as in v0.13); with the direction on they
            // carry the breath the HRTF needs to tell it
            ...(this.elevation && (h.material === 'floor' || h.material === 'ceiling') ? { airDb: ELEVATION_AIR_DB } : {})
        };
    }

    private targetVoice(target: SonicObject, s: FlightSample, basis: Basis): Omit<VoicePlan, 'slot'> {
        const theme = this.effectiveTheme;
        const p = theme.layers.target.params as Record<string, number>;
        const rule = { rateNearHz: p['rateNearHz'] as number, rateFarHz: p['rateFarHz'] as number, nearM: p['nearM'] as number, farM: p['farM'] as number, roughMax: p['roughMax'] as number, missFullM: p['missFullM'] as number };
        const toWorld = sub(target.pos, s.pos);
        const distance = length(toWorld);
        const dirL = distance > 1e-6 ? normalize(worldToListener(basis, toWorld)) : FRONT;
        const speed = length(s.vel);
        const nose: Vec3 = [-basis.back[0], -basis.back[1], -basis.back[2]];
        const travel = speed > AIM_BY_VELOCITY_MPS ? scale(s.vel, 1 / speed) : normalize([nose[0], 0, nose[2]]);
        const rough = targetRoughness(aimMissM(toWorld, travel), distance, rule);
        const beat = targetBeat(rough);
        const rate = targetRateHz(distance, rule);
        const bearing = this.beacon ? beaconBearing(dirL) : null;
        // on course: one octave up, as many scale steps as the scale has degrees (note() keeps it on the scale)
        const octave = bearing !== null && bearing.onCourse ? [theme.scale.steps.length] : [];
        const n = note(theme.scale, p['humStep'] as number, this.pitch('target'), elevationSteps(dirL[1], this.prefsValue.heightPolarity), ...octave);
        const safety = theme.layers.safety.params as Record<string, number>;
        const dc = distanceCode(distance, { nearHz: 9000, farHz: 1400, farM: rule.farM, sendNear: 0.05, sendFar: 0.4, ildBoostDb: safety['ildBoostDb'] as number });
        const period = 1 / rate;
        return {
            key: 'target',
            cue: 'target.hum',
            layer: 'target',
            priority: PRIORITY.target,
            dir: bearing === null ? dirL : foldToFront(dirL),
            distance,
            timbre: theme.layers.target.timbre,
            noteIndex: n.index,
            hz: n.hz,
            periodS: period,
            noteS: Math.min(0.7 * period, 1.2),
            gainDb: dc.gainDb,
            lowpassHz: dc.lowpassHz,
            reverbSend: dc.reverbSend,
            ildDb: dc.ildDb,
            dopplerCents: distance > 1e-6 ? dopplerCents(dot(s.vel, scale(toWorld, 1 / distance))) : 0,
            rough: 0,
            roughHz: 0,
            beatHz: beat.hz,
            beatDepth: beat.depth,
            trace: null
        };
    }

    private shapeObject(input: SonicFrameInput, s: FlightSample): SonicObject | null {
        if (input.target !== null && traceKind(input.target.shape) !== null) return input.target;
        if (input.world === null) return null;
        let best: SonicObject | null = null;
        let bestD = SHAPE_RANGE_M;
        for (const o of input.world.objects()) {
            if (!o.solid || traceKind(o.shape) === null) continue;
            const d = length(sub(o.pos, s.pos)) - traceRadius(o.shape);
            if (d < bestD) {
                bestD = d;
                best = o;
            }
        }
        return best;
    }

    private shapeVoice(obj: Pick<SonicObject, 'shape' | 'pos' | 'quat'>, listener: Vec3, basis: Basis, vel: Vec3, tS: number, key: string, priority: number): Omit<VoicePlan, 'slot'> | null {
        const theme = this.effectiveTheme;
        const p = theme.layers.shape.params as Record<string, number>;
        const rule: ShapeRule = { orbitHz: p['orbitHz'] as number, sweepHz: p['sweepHz'] as number, faceHz: p['faceHz'] as number };
        const trace: TracePlan = { shape: obj.shape, rule, objectPos: obj.pos, objectQuat: obj.quat, listenerPos: listener, basis };
        const at = tracePosition(trace, tS);
        if (at === null) return null;
        const centre = length(sub(obj.pos, listener));
        const angular = Math.atan2(traceRadius(obj.shape), Math.max(centre, 0.1));
        const n = note(theme.scale, p['shapeStep'] as number, this.pitch('shape'), elevationSteps(at.dir[1], this.prefsValue.heightPolarity));
        const safety = theme.layers.safety.params as Record<string, number>;
        const dc = distanceCode(at.distance, { nearHz: 9000, farHz: 2000, farM: 20, sendNear: 0.05, sendFar: 0.3, ildBoostDb: safety['ildBoostDb'] as number });
        const toPoint = at.distance > 1e-6 ? scale(sub(at.world, listener), 1 / at.distance) : FRONT;
        return {
            key,
            cue: shapeCue(obj.shape),
            layer: 'shape',
            priority,
            dir: at.dir,
            distance: at.distance,
            timbre: theme.layers.shape.timbre,
            noteIndex: n.index,
            hz: n.hz,
            periodS: null,
            noteS: (p['cornerMs'] as number) / 1000,
            gainDb: dc.gainDb + (p['sizeBoostDb'] as number) * clamp01(angular / (Math.PI / 4)),
            lowpassHz: dc.lowpassHz,
            reverbSend: dc.reverbSend,
            ildDb: dc.ildDb,
            dopplerCents: dopplerCents(dot(vel, toPoint)),
            rough: 0,
            roughHz: 0,
            beatHz: 0,
            beatDepth: 0,
            trace
        };
    }

    private heightRule(): HeightToneRule {
        const p = this.effectiveTheme.layers.height.params as Record<string, number>;
        return {
            baseStep: p['baseStep'] as number,
            maxStep: p['maxStep'] as number,
            metresPerStep: p['metresPerStep'] as number,
            roughDepth: p['roughDepth'] as number,
            bandSoftM: p['bandSoftM'] as number,
            targetDb: (p['targetDb'] as number | undefined) ?? 0,
            targetPeriodS: ((p['targetPeriodMs'] as number | undefined) ?? 1250) / 1000,
            // a note never takes more than a third of its period, so the height tone is heard between two notes and the
            // engine's swaps around them never run into each other (a theme of the Sound Lab may set any pair in range)
            targetNoteS: Math.min((p['targetNoteMs'] as number | undefined) ?? 280, ((p['targetPeriodMs'] as number | undefined) ?? 1250) / 3) / 1000
        };
    }

    /** The mapping's alignment: once per world, band, floor and step size (the lesson's reference height on a note). */
    private alignment(world: SonicWorld | null, floorY: number, metresPerStep: number): number {
        const band = this.layersValue.heightBandM;
        const a = this.align;
        if (a !== null && a.world === world && a.band === band && a.floorY === floorY && a.metresPerStep === metresPerStep) return a.offset;
        const offset = alignOffset(referenceHeightM(world, band, floorY), metresPerStep);
        this.align = { world, band, floorY, metresPerStep, offset };
        return offset;
    }

    private heightPlan(input: SonicFrameInput): HeightPlan {
        const theme = this.effectiveTheme;
        const p = theme.layers.height.params as Record<string, number>;
        const rule = this.heightRule();
        const band = this.layersValue.heightBandM;
        const heightM = input.sample.pos[1] - input.floorY;
        const targetM = this.prefsValue.heightTarget === false ? null : targetHeightM(input.target, band, input.floorY);
        const offset = this.alignment(input.world, input.floorY, rule.metresPerStep);
        const tones = heightTones(heightM, targetM, band, rule, theme.scale, this.prefsValue.heightPolarity, offset, this.pitch('height'));
        const position = this.steppedHeight ? Math.round(tones.position) : tones.position;
        const hz = this.steppedHeight ? noteHz(theme.scale, position) : tones.hz;
        const target = tones.target === null || !this.elevation ? tones.target : { ...tones.target, dir: this.targetDir(input, tones.target.heightM), airDb: ELEVATION_AIR_DB };
        return { noteIndex: Math.round(tones.position), position, hz, heightM, rough: tones.rough, roughHz: p['roughHz'] as number, glideS: (p['glideMs'] as number) / 1000, timbre: theme.layers.height.timbre, target };
    }

    /**
     * Lane s13-elev: where the target note comes from, listener frame: the gate's centre when the target is a gate, else
     * the target height TARGET_AHEAD_M ahead of the craft along its heading (a band has no point of its own).
     */
    private targetDir(input: SonicFrameInput, targetM: number): Vec3 {
        const s = input.sample;
        const basis = listenerBasis(s, this.prefsValue.listenerFrame);
        let to: Vec3;
        if (input.target !== null && isGate(input.target)) to = sub(input.target.pos, s.pos);
        else {
            const yaw = (s.yawDeg * Math.PI) / 180;
            to = [TARGET_AHEAD_M * Math.sin(yaw), input.floorY + targetM - s.pos[1], -TARGET_AHEAD_M * Math.cos(yaw)];
        }
        return length(to) > 1e-6 ? normalize(worldToListener(basis, to)) : FRONT;
    }

    /**
     * The height cues of the glossary: 'height.tone' glides up four steps and back, 'height.rough' holds a
     * rough tone, 'height.target' sounds the target note four steps up (at once, then about once a second)
     * while the height tone glides up to its pitch and stays there for the last fifth.
     */
    private previewHeight(cue: CueId, u: number): HeightPlan {
        const theme = this.effectiveTheme;
        const p = theme.layers.height.params as Record<string, number>;
        const rule = this.heightRule();
        const base = p['baseStep'] as number;
        const shift = this.pitch('height');
        const top = theme.scale.steps.length * theme.scale.octaves;
        const place = (x: number): number => Math.min(Math.max(x + shift, 0), top);
        const common = { roughHz: p['roughHz'] as number, glideS: (p['glideMs'] as number) / 1000, timbre: theme.layers.height.timbre };
        if (cue === 'height.rough') {
            const x = place(Math.round(base + 3));
            return { ...common, noteIndex: x, position: x, hz: noteHz(theme.scale, x), heightM: 3 * rule.metresPerStep, rough: p['roughDepth'] as number, target: null };
        }
        if (cue === 'height.target') {
            const t = place(Math.round(base + 4));
            const x = place(Math.round(base + 4) - 2.5 * Math.max(0, 1 - u / 0.8) ** 2);
            const plain: TargetTone = { heightM: 4 * rule.metresPerStep, position: t, hz: noteHz(theme.scale, t), noteIndex: t, onScale: true, gainDb: rule.targetDb, periodS: rule.targetPeriodS, noteS: rule.targetNoteS };
            // lane s13-elev: the note comes from where the target would be, TARGET_AHEAD_M ahead: above while the tone
            // climbs to it (below with the polarity turned over), ahead once it is there
            const up = this.prefsValue.heightPolarity === 'up-higher' ? 1 : -1;
            const target: TargetTone = this.elevation ? { ...plain, dir: normalize([0, up * (t - x) * rule.metresPerStep, -TARGET_AHEAD_M]), airDb: ELEVATION_AIR_DB } : plain;
            return { ...common, noteIndex: Math.round(x), position: x, hz: x === t ? target.hz : noteHzAt(theme.scale, x), heightM: (x - base) * rule.metresPerStep, rough: 0, target };
        }
        const x = place(base + 4 * tri(u));
        return { ...common, noteIndex: Math.round(x), position: x, hz: noteHzAt(theme.scale, x), heightM: (x - base) * rule.metresPerStep, rough: 0, target: null };
    }

    private speedPlan(speedMps: number): SpeedPlan {
        const theme = this.effectiveTheme;
        const p = theme.layers.speed.params as Record<string, number>;
        const n = note(theme.scale, p['tickStep'] as number, this.pitch('speed'));
        return {
            tempoHz: speedTempoHz(speedMps, { tempoMinHz: p['tempoMinHz'] as number, tempoMaxHz: p['tempoMaxHz'] as number, speedMaxMps: p['speedMaxMps'] as number }),
            noteIndex: n.index,
            hz: n.hz,
            noteS: (p['tickMs'] as number) / 1000,
            noiseMix: p['noiseMix'] as number,
            timbre: theme.layers.speed.timbre
        };
    }

    private roomPlan(open: number): RoomPlan {
        const theme = this.effectiveTheme;
        const p = theme.layers.room.params as Record<string, number>;
        const rc = roomCode(open, { opennessFullM: p['opennessFullM'] as number, reverbMin: p['reverbMin'] as number, reverbMax: p['reverbMax'] as number, bedLowpassHz: p['bedLowpassHz'] as number });
        const n = note(theme.scale, p['bedStep'] as number, this.pitch('room'));
        return { open: clamp01(open), reverb: rc.reverb, bedLowpassHz: rc.bedLowpassHz, noteIndex: n.index, hz: n.hz, timbre: theme.layers.room.timbre };
    }

    // -------------------------------------------------------------- previews

    private previewVoice(p: Preview, u: number, tS: number): Omit<VoicePlan, 'slot'> | null {
        const key = p.key;
        const priority = PRIORITY.preview;
        const [layer] = p.cue.split('.') as [string];
        if (layer === 'safety') {
            if (p.cue === 'safety.free') {
                // from the side the preview names (up and down by its height); with no direction, all four in turn
                const still = Math.hypot(p.dir[0], p.dir[1], p.dir[2]) < 1e-9;
                const side: FreeSide = still ? (['left', 'right', 'up', 'down'] as const)[Math.min(3, Math.floor(u * 4))] : p.dir[1] > 0.5 ? 'up' : p.dir[1] < -0.5 ? 'down' : p.dir[0] < 0 ? 'left' : 'right';
                return this.freeVoice(side, `${key}:${side}`, priority);
            }
            const material = p.cue.slice(7) as MaterialClass;
            if (!(material in MATERIAL_DIR)) return null;
            // an approach from 8 m to 0.8 m at an even 3 m/s of closing: the pulses quicken as in flight (a short
            // play of a repeat-cue runs from 3 m to 0.6 m, so its second also has several pulses)
            const distance = p.durS < 1.5 ? expLerp(3, 0.6, u) : expLerp(8, 0.8, u);
            const closing = 3;
            return this.hazardVoice({ sector: 'front', distance, ttcS: distance / closing, dir: p.dir, material }, scale(p.dir, closing), key, priority);
        }
        if (layer === 'target') {
            if (p.cue !== 'target.hum' && p.cue !== 'target.off') return null;
            const distance = expLerp(20, 2.5, u);
            const sample = previewSample(p.dir, 0);
            const target: SonicObject = { id: 'preview', shape: { kind: 'zone', size: [1, 1, 1] }, pos: scale(p.dir, distance), quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
            const v = this.targetVoice(target, sample, headingBasis(0));
            if (p.cue === 'target.off') {
                const beat = targetBeat(0.9 * (this.effectiveTheme.layers.target.params['roughMax'] as number));
                return { ...v, key, priority, cue: p.cue, beatHz: beat.hz, beatDepth: beat.depth };
            }
            return { ...v, key, priority, cue: p.cue };
        }
        if (layer === 'shape') {
            const shape = PREVIEW_SHAPES[p.cue];
            if (shape === undefined) return null;
            const distance = expLerp(6, 2.5, u);
            const yaw = (Math.atan2(p.dir[0], -p.dir[2]) * 180) / Math.PI;
            const obj = { shape, pos: scale(p.dir, distance), quat: yawQuat(yaw) };
            const v = this.shapeVoice(obj, [0, 0, 0], headingBasis(0), [0, 0, 0], tS, key, priority);
            return v === null ? null : { ...v, cue: p.cue };
        }
        return null;
    }

    // -------------------------------------------------------------- one-off cues

    /**
     * A one-off cue at page time `t`: the notes to play (and, for a continuous cue's preview, a
     * preview that the next frames sound). The planner keeps every note until it ends, for activeCues.
     * `capS`: every note ends by then, s after `t` (a short play of a repeat-cue).
     */
    cue(e: CueEvent, t: number = this.lastT, capS = Infinity): NotePlan[] {
        const theme = this.effectiveTheme;
        const scaleDef = theme.scale;
        const notes: Omit<NotePlan, 'key' | 'slot'>[] = [];
        const target = theme.layers.target.params as Record<string, number>;
        const safety = theme.layers.safety.params as Record<string, number>;
        const bright = NOTE_TIMBRE[theme.layers.target.timbre];
        const base = GATE_MELODY_BASE;
        const tp = this.pitch('target');
        const push = (cue: CueId, layer: LayerId, priority: number, atS: number, timbre: Timbre, index: number, durS: number, gainDb: number, dir: Vec3 | null, offset = 0): void => {
            const n = note(scaleDef, index, layer === 'safety' ? this.pitch('safety') : tp, offset);
            notes.push({ cue, layer, priority, atS, timbre, noteIndex: n.index, hz: n.hz, durS, gainDb, dir });
        };
        switch (e.kind) {
            case 'touch': {
                const dir = e.dir === null ? null : normalize(e.dir);
                const hard = clamp01(e.speed / 6);
                const ping = (safety['pingMs'] as number) / 1000;
                push('safety.touch', 'safety', PRIORITY.touch, 0, theme.layers.safety.timbre, safety['pingStep'] as number, ping, -6 + 6 * hard, dir);
                const step = e.material === 'wall' ? safety['pitchWallStep'] : e.material === 'floor' ? safety['pitchFloorStep'] : e.material === 'ceiling' ? safety['pitchCeilingStep'] : safety['pitchObstacleStep'];
                push('safety.touch', 'safety', PRIORITY.touch, 0, theme.materials[e.material], step as number, ping, -9 + 6 * hard, dir);
                break;
            }
            case 'reset': {
                // a quick sweep down the scale: back to a checkpoint
                for (let k = 0; k < 5; k++) push('safety.reset', 'safety', PRIORITY.chime, 0.055 * k, bright, base + 7 - k, 0.12, -10 - k, null);
                break;
            }
            case 'gate': {
                const melody = gateMelody(scaleDef, Math.max(1, e.of), base);
                const i = Math.min(Math.max(e.index, 0), melody.length - 1);
                push('target.note', 'target', PRIORITY.gateNote, 0, bright, melody[i] as number, (target['noteMs'] as number) / 1000, -3, null);
                // a soft octave below gives the note body, never a new pitch class
                push('target.note', 'target', PRIORITY.gateNote, 0, bright, (melody[i] as number) - 5, (target['noteMs'] as number) / 1000, -15, null);
                break;
            }
            case 'lap': {
                // the phrase closes on the root an octave above the melody's start, with its pentatonic chord
                const chime = (target['lapChimeMs'] as number) / 1000;
                push('target.lap', 'target', PRIORITY.gateNote, 0, bright, base + 2, 0.4, -9, null);
                push('target.lap', 'target', PRIORITY.gateNote, 0.09, bright, base + 3, 0.4, -9, null);
                push('target.lap', 'target', PRIORITY.gateNote, 0.18, bright, base + 5, chime, -5, null);
                push('target.lap', 'target', PRIORITY.gateNote, 0.18, bright, base, chime, -13, null);
                break;
            }
            case 'checkpoint': {
                push('target.checkpoint', 'target', PRIORITY.chime, 0, bright, base + 3, 0.25, -8, null);
                push('target.checkpoint', 'target', PRIORITY.chime, 0.13, bright, base + 5, 0.35, -8, null);
                break;
            }
            case 'fanfare': {
                const steps = [0, 2, 3, 5];
                steps.forEach((k, i) => push('target.fanfare', 'target', PRIORITY.chime, 0.13 * i, bright, base + k, i === steps.length - 1 ? 0.8 : 0.22, i === steps.length - 1 ? -5 : -8, null));
                push('target.fanfare', 'target', PRIORITY.chime, 0.39, bright, base, 0.8, -14, null);
                break;
            }
            case 'wrong-way': {
                // "you are flying back": two falling pairs, low in the melody's register, in the safety layer's own timbre,
                // from `dir` (the way forward: where to turn to), centred without one
                const w = theme.layers.safety.timbre;
                const dir = e.dir === null || e.dir === undefined ? null : normalize(e.dir);
                for (const at of [0, 0.34]) {
                    push('safety.wrong-way', 'safety', PRIORITY.chime, at, w, base + 2, 0.12, -9, dir);
                    push('safety.wrong-way', 'safety', PRIORITY.chime, at + 0.13, w, base, 0.16, -9, dir);
                }
                break;
            }
            case 'wrong-side': {
                // "that ring was passed from the wrong side": from the gate notes' register down by two big steps to the root
                // below, from `dir` (where the gate is), centred without one
                const w = theme.layers.safety.timbre;
                const dir = e.dir === null || e.dir === undefined ? null : normalize(e.dir);
                push('safety.wrong-side', 'safety', PRIORITY.chime, 0, w, base + 5, 0.11, -9, dir);
                push('safety.wrong-side', 'safety', PRIORITY.chime, 0.11, w, base + 3, 0.11, -9, dir);
                push('safety.wrong-side', 'safety', PRIORITY.chime, 0.22, w, base, 0.32, -8, dir);
                break;
            }
            case 'praise': {
                // a short bright rise, shorter and lighter than the fanfare; one of three figures in turn
                const figure = PRAISE_FIGURES[this.praiseCount++ % PRAISE_FIGURES.length] as readonly number[];
                figure.forEach((k, i) => push('target.praise', 'target', PRIORITY.chime, 0.08 * i, bright, base + 5 + k, i === figure.length - 1 ? 0.3 : 0.1, i === figure.length - 1 ? -7 : -9, null));
                break;
            }
            case 'stage': {
                // a stage of a long course: a run of five notes, one step higher with each stage (four at most), a soft root under its end
                const lift = Math.min(Math.max(Math.round(e.stage ?? 1), 1), 5) - 1;
                const run = [0, 2, 4, 5, 7];
                run.forEach((k, i) => push('target.stage', 'target', PRIORITY.chime, 0.09 * i, bright, base + k + lift, i === run.length - 1 ? 0.6 : 0.14, i === run.length - 1 ? -6 : -9, null));
                push('target.stage', 'target', PRIORITY.chime, 0.36, bright, base + lift, 0.6, -16, null);
                break;
            }
            case 'answer': {
                // a digit (sonic-keys): taken, two notes up; not taken, two notes down; waiting, one soft note twice. Ahead, about 0.3 s
                const figure = e.what === 'yes' ? [0, 4] : e.what === 'no' ? [2, -2] : [0, 0];
                const gain = e.what === 'wait' ? -14 : -9;
                figure.forEach((k, i) => push('target.answer', 'target', PRIORITY.chime, 0.12 * i, bright, base + k, i === 1 ? 0.16 : 0.1, gain, null));
                break;
            }
            case 'repeat-cue': {
                const [lo, hi] = REPEAT_PLAY_RANGE_S;
                const durS = e.durS !== undefined && Number.isFinite(e.durS) ? Math.min(Math.max(e.durS, lo), hi) : REPEAT_PLAY_DEFAULT_S;
                return this.previewCue(e.cue, e.dir ?? null, t, durS, true);
            }
            case 'preview':
                return this.previewCue(e.cue, e.dir, t, PREVIEW_S);
        }
        // static slots for spatial notes: the first free one, else steal the least important or the oldest
        const out: NotePlan[] = [];
        for (const raw of notes) {
            if (raw.atS >= capS) continue;
            const n = raw.atS + raw.durS > capS ? { ...raw, durS: Math.max(0.03, capS - raw.atS) } : raw;
            const key = `note:${++this.noteCount}`;
            const endT = t + (n.atS + n.durS) * 1000;
            let slot: number | null = null;
            if (n.dir !== null) {
                slot = this.staticSlots.findIndex((x) => x === null);
                if (slot < 0) {
                    let worst = 0;
                    for (let i = 1; i < this.staticSlots.length; i++) {
                        const a = this.staticSlots[i] as SoundingNote;
                        const b = this.staticSlots[worst] as SoundingNote;
                        if (a.priority < b.priority || (a.priority === b.priority && a.endT < b.endT)) worst = i;
                    }
                    slot = worst;
                }
            }
            const sounding: SoundingNote = { cue: n.cue, layer: n.layer, dir: n.dir, hz: n.hz, endT, slot, priority: n.priority };
            if (slot !== null) this.staticSlots[slot] = sounding;
            this.notes.push(sounding);
            out.push({ ...n, key, slot });
        }
        return out;
    }

    /**
     * A cue's own sound as the glossary plays it, for `durS`: the notes of a one-off cue at once (cut at `durS` for
     * a play of a 'repeat-cue'), or a preview of a continuous one that the next frames sound. An unknown cue
     * sounds nothing.
     */
    private previewCue(cue: CueId, rawDir: Vec3 | null, t: number, durS: number, cut = false): NotePlan[] {
        const dir = rawDir === null ? null : normalize(rawDir);
        const oneOff: Readonly<Record<string, CueEvent>> = {
            'safety.touch': { kind: 'touch', material: 'wall', dir, speed: 2 },
            'safety.reset': { kind: 'reset' },
            'safety.wrong-way': { kind: 'wrong-way', dir },
            'safety.wrong-side': { kind: 'wrong-side', dir },
            'target.note': { kind: 'gate', index: 0, of: 3 },
            'target.lap': { kind: 'lap' },
            'target.checkpoint': { kind: 'checkpoint' },
            'target.fanfare': { kind: 'fanfare' },
            'target.praise': { kind: 'praise' },
            'target.stage': { kind: 'stage', stage: 1 },
            'target.answer': { kind: 'answer', what: 'yes' }
        };
        const event = oneOff[cue];
        if (event !== undefined) return this.cue(event, t, cut ? durS : Infinity).map((n) => ({ ...n, cue }));
        const material = cue.startsWith('safety.') ? (cue.slice(7) as MaterialClass) : null;
        // the open-way chime with no direction plays all four sides in turn: a zero vector says so
        const fallback: Vec3 = cue === 'safety.free' ? [0, 0, 0] : material !== null && material in MATERIAL_DIR ? MATERIAL_DIR[material] : FRONT;
        this.previews.push({ key: `preview:${++this.previewCount}`, cue, dir: dir ?? fallback, t0: t, durS });
        return [];
    }

    /** How many previews are sounding at page time `t`. */
    previewsAt(t: number): number {
        return this.previews.filter((p) => t >= p.t0 && t < p.t0 + p.durS * 1000).length;
    }
}

/** A still, level craft at the origin facing yaw: the listener of a preview. */
function previewSample(_dir: Vec3, yawDeg: number): FlightSample {
    return { t: 0, tick: 0, pos: [0, 0, 0], vel: [0, 0, 0], quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };
}

export function shapeCue(shape: ObjectShape): CueId {
    switch (shape.kind) {
        case 'ring':
            return 'shape.ring';
        case 'square':
            return 'shape.square';
        case 'cube-frame':
            return 'shape.cube';
        default:
            return 'shape.pillar';
    }
}

/**
 * Where a traced point is at `tS` (any clock), relative to the listener of the plan: world point,
 * listener-frame unit direction and distance. Null for a shape that is not traced.
 */
export function tracePosition(trace: TracePlan, tS: number): { readonly world: Vec3; readonly dir: Vec3; readonly distance: number } | null {
    const inv = quatConjugate(trace.objectQuat);
    const towardWorld = sub(trace.listenerPos, trace.objectPos);
    const toward = quatRotate(inv, towardWorld);
    const local = shapePoint(trace.shape, trace.rule, tS, toward);
    if (local === null) return null;
    const world = add(trace.objectPos, quatRotate(trace.objectQuat, local));
    const rel = sub(world, trace.listenerPos);
    const distance = length(rel);
    const dir = distance > 1e-6 ? normalize(worldToListener(trace.basis, rel)) : FRONT;
    return { world, dir, distance };
}
