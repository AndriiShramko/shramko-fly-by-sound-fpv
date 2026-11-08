// The virtual listener rig's messages between the driver (tools/listen.ts, Node) and the render page
// (test-audio/page/listen.ts, the browser). DOM-free, so both sides compile against it.
import type { Vec3 } from '../../src/contract';

export const RIG_VERSION = 1;
export const RATE = 48000;

export const SCENARIOS = ['height-climb', 'approach-1', 'approach-3', 'approach-5', 'flight'] as const;
export type ScenarioId = (typeof SCENARIOS)[number];
/** Controls (the engine or the host broken on purpose), each failing one check. */
export const VARIANTS = ['stepped', 'distance-only', 'motor-raw-60', 'seed-2'] as const;
export type Variant = (typeof VARIANTS)[number];
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
    readonly userAgent: string;
}
