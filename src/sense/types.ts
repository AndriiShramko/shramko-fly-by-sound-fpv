// What the scene sampler reports (spec section 2: sectors, hysteresis, at most three hazard voices).
import type { MaterialClass, SectorId, SonicPrefs, Vec3 } from '../contract';

/** The frame directions are given in: 'heading' (yaw only, the default) or the craft's full 'body' attitude. */
export type ListenerFrame = SonicPrefs['listenerFrame'];

/**
 * What one sector sees. Its distance and its time are each the worst case over its three rays
 * (the nearest, the soonest); its direction, material and object are those of the most
 * threatening ray: the one with the highest risk, which is the nearest when nothing is closing.
 */
export interface SectorReading {
    readonly sector: SectorId;
    /** metres from the craft's hull to the nearest hit among the sector's rays; the sampler's range when nothing is hit */
    readonly distance: number;
    /** a ray hit something within range */
    readonly hit: boolean;
    /** unit vector in the listener frame from the craft to the hit point of the most threatening ray; the sector's axis when nothing is hit */
    readonly dir: Vec3;
    readonly material: MaterialClass | null;
    readonly objectId: string | null;
    /** the fastest speed toward any surface the sector's rays hit, m/s, never negative (along the surface normal; along the line of sight when the world gives none) */
    readonly closingMps: number;
    /** the soonest time to collision with a surface the sector's rays hit, seconds; null when the craft is closing on none of them (slower than minClosingMps) */
    readonly ttcS: number | null;
}

/** A sector that earns a hazard voice. */
export interface Hazard {
    readonly sector: SectorId;
    /** 0 is the most urgent */
    readonly rank: number;
    /** risk x priority weight: what the ranking used (before the stickiness of an already sounding voice) */
    readonly urgency: number;
    readonly distance: number;
    readonly ttcS: number | null;
    readonly dir: Vec3;
    readonly material: MaterialClass;
    readonly objectId: string | null;
}

export interface SceneSample {
    /** page clock of the flight sample, ms */
    readonly t: number;
    readonly frame: ListenerFrame;
    /** all ten sectors, in the order of the contract's SECTORS */
    readonly sectors: readonly SectorReading[];
    /** the voiced hazards, most urgent first, never more than `maxVoices` */
    readonly hazards: readonly Hazard[];
    /** mean of the ten sector distances, metres: the room layer's openness */
    readonly meanFreeDistanceM: number;
}
