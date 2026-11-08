// The virtual listener rig's messages between the driver (tools/listen.ts, Node) and the render page
// (test-audio/page/listen.ts, the browser). DOM-free, so both sides compile against it.
import type { Vec3 } from '../../src/contract';

export const RIG_VERSION = 4;
export const RATE = 48000;

export const SCENARIOS = ['height-climb', 'approach-1', 'approach-3', 'approach-5', 'flight', 'hover-band', 'free-chime', 'gaps-flight'] as const;
export type ScenarioId = (typeof SCENARIOS)[number];
/**
 * Controls (the engine or the host broken on purpose), each failing one check; and, for the free chime (lane s13-elev),
 * 'direction-off' (SonicPrefs.heightDirection false: v0.13's placement, the check's control) and 'dry' (no HRTF panner:
 * what goes into it, so a render over its dry twin is the HRTF's own response).
 */
export const VARIANTS = ['stepped', 'distance-only', 'motor-raw-60', 'seed-2', 'target-steady', 'direction-off', 'dry', 'direction-off-dry'] as const;
export type Variant = (typeof VARIANTS)[number];

/**
 * The crafts whose motor the stand-in plays (review M3): the simulator's presets (ShramkoGSFPV packages/sim-core/
 * presets, read 2026-11-08), each with its rotor's turning frequency at full output at the pack's voltage in a
 * hover (KV x rpm_loaded_fraction x volts / 60), its motor output in a hover (the simulator's solveHover, fresh
 * pack) and its blades (motor-sound.ts bladesOf: 3 unless the prop says otherwise). 'pavo20pro-3s' is the
 * simulator's default craft (apps/fly/src/presets.ts DEFAULT_PRESET); 'five-inch' is the first stand-in (KV 1950 on
 * 6S, loaded 0.8, 22 V) with the flight's own motor outputs.
 */
export const CRAFTS = {
    'pavo20pro-3s': { rotorFullHz: 1123, hoverOut: 0.394, blades: 3 },
    'meteor65pro-1s': { rotorFullHz: 1019, hoverOut: 0.486, blades: 3 },
    'air65-1s': { rotorFullHz: 1188, hoverOut: 0.48, blades: 3 },
    'pavopico-2s': { rotorFullHz: 1455, hoverOut: 0.461, blades: 3 },
    'five-inch': { rotorFullHz: (1950 * 0.8 * 22) / 60, hoverOut: 0.42, blades: 3 }
} as const;
export type CraftId = keyof typeof CRAFTS;
/** The craft of every render that names none: the simulator's default. */
export const DEFAULT_CRAFT: CraftId = 'pavo20pro-3s';
export const CRAFT_IDS = Object.keys(CRAFTS) as CraftId[];
/** What a solo render keeps (src/audio/engine.ts SoloPart). */
export type SoloName = 'safety' | 'height' | 'speed' | 'target' | 'shape' | 'room' | 'motor' | 'aux';

export interface SpeechClip {
    readonly key: string;
    readonly text: string;
    readonly durS: number;
}

export interface RenderRequest {
    readonly scenario: ScenarioId;
    readonly theme: 'soft' | 'clear' | 'race';
    readonly variant: Variant | null;
    readonly solo: readonly SoloName[] | null;
    /** the lines the flight speaks, with the lengths of their clips */
    readonly clips: readonly SpeechClip[];
    /** whose motor the stand-in plays (DEFAULT_CRAFT when absent) */
    readonly craft?: CraftId;
}

export interface TruthRow {
    /** audio time, s */
    readonly t: number;
    readonly pos: Vec3;
    readonly speedMps: number;
    readonly heightM: number;
    readonly targetM: number | null;
    readonly heightHz: number | null;
    readonly targetHz: number | null;
    readonly hazards: readonly { readonly sector: string; readonly distance: number; readonly ttcS: number | null }[];
    /** hull distance to the wall ahead (the approaches), m */
    readonly frontHullM: number | null;
    readonly freeSide: string | null;
    readonly urgent: boolean;
    readonly speaking: boolean;
    /** the motor stand-in's mean output, 0..1 */
    readonly motor: number;
    /** lane s13-elev: the open-way chime's voice this frame (a flight's or a named play's): its key, direction, notes */
    readonly chime?: { readonly key: string; readonly dir: Vec3; readonly hz: number; readonly harmonyHz: number | null } | null;
    /** lane s13-elev, review E5: every voice of the plan this frame, its cue and whether it carries the breath of air */
    readonly voices?: readonly { readonly cue: string; readonly breath: boolean }[];
}

export interface SpeechSpan {
    readonly key: string;
    readonly text: string;
    /** audio time the line starts and ends, s */
    readonly t0: number;
    readonly t1: number;
    /** the utterance volume the engine asked for, 0..1 */
    readonly volume: number;
}

export interface RenderResult {
    readonly rate: number;
    readonly frames: number;
    /** base64 of little-endian float32 samples: ears L, ears R, pre-chain L, pre-chain R */
    readonly channels: readonly string[];
    readonly truth: readonly TruthRow[];
    readonly speech: readonly SpeechSpan[];
    /** every target-height note the engine placed: audio time, pitch, length */
    readonly targetNotes: readonly { readonly t0: number; readonly hz: number; readonly noteS: number }[];
    readonly userAgent: string;
}
