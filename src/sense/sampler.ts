// The scene sampler: once per frame it looks around the craft with ten sectors of three rays
// (30 rays), keeps the nearest hit of each sector, works out the time to collision from the
// craft's velocity, and decides which sectors sound as hazards: at most three, the most urgent
// first, with hysteresis so a voice does not flicker as a distance wavers around a threshold.
//
// Rules (spec section 2, research 01 and 02):
//   - a sector's distance is the minimum over its three rays; its time to collision is the soonest
//     over its three rays; its direction, material and object are those of the most threatening ray
//     (the highest risk, below), which is the nearest one when nothing is closing
//   - directions are given in the listener frame (heading by default: yaw only, tilt ignored)
//   - distance is measured from the craft's hull (bodyRadiusM inside the centre)
//   - time to collision is the time to reach the SURFACE that was hit: the hull's distance to it along
//     its normal over the speed toward it, so a craft flying along a wall has no time to collision
//     with it, whichever ray saw it (when the world gives no normal, the line of sight stands in)
//   - risk of a sector = max(enterDist / distance, enterTtc / ttc): 1 at the threshold, growing as
//     the craft gets closer or closes faster. A distance alone is enough (a hovering craft under a
//     ceiling), so is a closing speed alone (a far wall approached fast)
//   - a hazard turns on at risk >= 1 at once (danger first, no debounce) and turns off only when the
//     risk has fallen under releaseRatio AND holdMs have passed since it last reached 1
//   - ranking uses risk x a priority weight per sector (ahead outranks behind); a voice that is
//     already sounding counts `stickiness` times, so two near-equal hazards do not swap places
//   - never more than 3 voices (contract: LessonLayers.hazardVoices is 3 or fewer)
import type { FlightSample, RayHit, SectorId, SonicWorld, Vec3 } from '../contract';
import { SECTORS } from '../contract';
import { dot, length, scale, sub } from '../util/vec';
import { listenerBasis, listenerToWorld, sectorRays, SECTOR_AXES, worldToListener } from './frame';
import type { Hazard, ListenerFrame, SceneSample, SectorReading } from './types';

/** The most hazard voices at once, ever. */
export const MAX_HAZARD_VOICES = 3;

export interface SamplerConfig {
    /** how far the rays look, metres */
    readonly rangeM: number;
    /** angle between a sector's centre ray and each of its two side rays, degrees */
    readonly spreadDeg: number;
    /** the craft's radius, metres: distances are to its hull */
    readonly bodyRadiusM: number;
    /** hazard voices at once, 0 to 3 */
    readonly maxVoices: number;
    /** per sector: the hull distance at which a hit becomes a hazard even when the craft is not closing, metres */
    readonly enterDistM: Readonly<Record<SectorId, number>>;
    /** the time to collision at which a hit becomes a hazard, seconds */
    readonly enterTtcS: number;
    /** a hazard ends only when its risk is under this, in (0, 1]; 1 means no hysteresis in value */
    readonly releaseRatio: number;
    /** a hazard also stays this long after its risk last reached 1, ms */
    readonly holdMs: number;
    /** >= 1: how much better an already sounding hazard ranks */
    readonly stickiness: number;
    /** per sector: how important it is against the others (ahead over behind) */
    readonly weight: Readonly<Record<SectorId, number>>;
    /** closing slower than this counts as not closing, m/s */
    readonly minClosingMps: number;
}

export type SamplerOptions = Partial<Omit<SamplerConfig, 'enterDistM' | 'weight'>> & {
    readonly enterDistM?: Partial<Record<SectorId, number>>;
    readonly weight?: Partial<Record<SectorId, number>>;
};

/** Starting values, to be tuned with pilots. */
export const DEFAULT_SAMPLER_CONFIG: SamplerConfig = {
    rangeM: 40,
    spreadDeg: 20,
    bodyRadiusM: 0.12,
    maxVoices: MAX_HAZARD_VOICES,
    enterDistM: {
        front: 6,
        'front-left': 5,
        'front-right': 5,
        'front-up': 3,
        'front-down': 1.8,
        left: 4,
        right: 4,
        back: 3,
        up: 1.5,
        down: 1.5
    },
    enterTtcS: 3,
    releaseRatio: 0.8,
    holdMs: 300,
    stickiness: 1.25,
    weight: {
        front: 1,
        'front-left': 0.9,
        'front-right': 0.9,
        'front-up': 0.9,
        'front-down': 0.9,
        left: 0.8,
        right: 0.8,
        up: 0.7,
        down: 0.7,
        back: 0.6
    },
    minClosingMps: 0.2
};

export class SamplerConfigError extends Error {
    constructor(message: string) {
        super(`scene sampler: ${message}`);
        this.name = 'SamplerConfigError';
    }
}

function between(name: string, v: number, lo: number, hi: number): void {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new SamplerConfigError(`${name} must be between ${lo} and ${hi}, got ${String(v)}`);
}

function checkVoices(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > MAX_HAZARD_VOICES) throw new SamplerConfigError(`maxVoices must be an integer from 0 to ${MAX_HAZARD_VOICES}, got ${String(n)}`);
}

/** Merges options over the defaults and checks every value; throws SamplerConfigError. */
export function resolveSamplerConfig(options: SamplerOptions = {}): SamplerConfig {
    const base = DEFAULT_SAMPLER_CONFIG;
    const cfg: SamplerConfig = {
        rangeM: options.rangeM ?? base.rangeM,
        spreadDeg: options.spreadDeg ?? base.spreadDeg,
        bodyRadiusM: options.bodyRadiusM ?? base.bodyRadiusM,
        maxVoices: options.maxVoices ?? base.maxVoices,
        enterDistM: { ...base.enterDistM, ...options.enterDistM },
        enterTtcS: options.enterTtcS ?? base.enterTtcS,
        releaseRatio: options.releaseRatio ?? base.releaseRatio,
        holdMs: options.holdMs ?? base.holdMs,
        stickiness: options.stickiness ?? base.stickiness,
        weight: { ...base.weight, ...options.weight },
        minClosingMps: options.minClosingMps ?? base.minClosingMps
    };
    between('rangeM', cfg.rangeM, 1, 500);
    between('spreadDeg', cfg.spreadDeg, 0, 60);
    between('bodyRadiusM', cfg.bodyRadiusM, 0, 2);
    checkVoices(cfg.maxVoices);
    between('enterTtcS', cfg.enterTtcS, 0.1, 60);
    between('releaseRatio', cfg.releaseRatio, 0.05, 1);
    between('holdMs', cfg.holdMs, 0, 10000);
    between('stickiness', cfg.stickiness, 1, 10);
    between('minClosingMps', cfg.minClosingMps, 0, 50);
    for (const id of SECTORS) {
        between(`enterDistM.${id}`, cfg.enterDistM[id], 0.05, 200);
        between(`weight.${id}`, cfg.weight[id], 0.01, 100);
    }
    return cfg;
}

export interface SceneSampler {
    readonly config: SamplerConfig;
    /** hazard voices allowed now (a lesson sets it through setMaxVoices) */
    readonly maxVoices: number;
    /**
     * One sample. `world` null (a lesson with no world) gives ten clear sectors and no hazards.
     * Call it with consecutive frames: hysteresis and stickiness remember the previous call.
     */
    sample(flight: FlightSample, world: SonicWorld | null, frame?: ListenerFrame): SceneSample;
    setMaxVoices(n: number): void;
    /** forget which hazards were sounding (a new lesson, a replay seek) */
    reset(): void;
}

/** Below this the distance or the time is treated as this, so the risk stays finite. */
const FLOOR = 0.05;

export function riskOf(distance: number, ttcS: number | null, enterDistM: number, enterTtcS: number): number {
    const byDistance = enterDistM / Math.max(distance, FLOOR);
    const byTime = ttcS === null ? 0 : enterTtcS / Math.max(ttcS, FLOOR);
    return Math.max(byDistance, byTime);
}

export function createSceneSampler(options: SamplerOptions = {}): SceneSampler {
    const config = resolveSamplerConfig(options);
    const rays = sectorRays(config.spreadDeg);
    const castRange = config.rangeM + config.bodyRadiusM;
    let maxVoices = config.maxVoices;
    const n = SECTORS.length;
    const active: boolean[] = new Array(n).fill(false);
    const holdUntil: number[] = new Array(n).fill(0);
    const voiced: boolean[] = new Array(n).fill(false);

    const reset = (): void => {
        active.fill(false);
        holdUntil.fill(0);
        voiced.fill(false);
    };

    const sample = (flight: FlightSample, world: SonicWorld | null, frame: ListenerFrame = 'heading'): SceneSample => {
        const basis = listenerBasis(flight, frame);
        const readings: SectorReading[] = [];

        for (let i = 0; i < n; i++) {
            const id = SECTORS[i] as SectorId;
            let minDistance = Infinity;
            let minTtc: number | null = null;
            let maxClosing = 0;
            let primary: { hit: RayHit; dir: Vec3; risk: number; distance: number } | null = null;
            if (world !== null) {
                for (const ray of rays[id]) {
                    const worldRay = listenerToWorld(basis, ray);
                    const hit = world.castRay(flight.pos, worldRay, castRange);
                    if (hit === null) continue;
                    const distance = Math.max(0, hit.distance - config.bodyRadiusM);
                    const toHit = sub(hit.point, flight.pos);
                    const len = length(toHit);
                    const worldDir: Vec3 = len > 1e-6 ? scale(toHit, 1 / len) : worldRay;
                    // speed toward the surface, and the hull's distance to it in that direction
                    let closing: number;
                    let reach: number;
                    if (hit.normal !== null) {
                        closing = Math.max(0, -dot(flight.vel, hit.normal));
                        reach = Math.max(0, -dot(toHit, hit.normal) - config.bodyRadiusM);
                    } else {
                        closing = Math.max(0, dot(flight.vel, worldDir));
                        reach = distance;
                    }
                    const ttc = closing >= config.minClosingMps ? reach / closing : null;
                    const risk = riskOf(distance, ttc, config.enterDistM[id], config.enterTtcS);
                    if (distance < minDistance) minDistance = distance;
                    if (ttc !== null && (minTtc === null || ttc < minTtc)) minTtc = ttc;
                    if (closing > maxClosing) maxClosing = closing;
                    if (primary === null || risk > primary.risk || (risk === primary.risk && distance < primary.distance)) primary = { hit, dir: worldDir, risk, distance };
                }
            }
            if (primary === null) {
                readings.push({ sector: id, distance: config.rangeM, hit: false, dir: SECTOR_AXES[id], material: null, objectId: null, closingMps: 0, ttcS: null });
                continue;
            }
            readings.push({
                sector: id,
                distance: minDistance,
                hit: true,
                dir: worldToListener(basis, primary.dir),
                material: primary.hit.material,
                objectId: primary.hit.objectId,
                closingMps: maxClosing,
                ttcS: minTtc
            });
        }

        // risk, then hysteresis: on at risk >= 1 at once; off after the risk is low AND the hold has passed
        const t = flight.t;
        const risk: number[] = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            const r = readings[i] as SectorReading;
            risk[i] = r.hit ? riskOf(r.distance, r.ttcS, config.enterDistM[r.sector], config.enterTtcS) : 0;
            if (holdUntil[i] as number > t + config.holdMs) holdUntil[i] = t + config.holdMs; // the clock went back (a seek)
            if ((risk[i] as number) >= 1) {
                active[i] = true;
                holdUntil[i] = t + config.holdMs;
            } else if (active[i] && (risk[i] as number) < config.releaseRatio && t >= (holdUntil[i] as number)) {
                active[i] = false;
            }
        }

        // the voices: the active sectors with something to point at, most urgent first
        const candidates: { i: number; urgency: number; rank: number }[] = [];
        for (let i = 0; i < n; i++) {
            const r = readings[i] as SectorReading;
            if (!active[i] || !r.hit) continue;
            const urgency = (risk[i] as number) * config.weight[r.sector];
            candidates.push({ i, urgency, rank: urgency * (voiced[i] ? config.stickiness : 1) });
        }
        candidates.sort((a, b) => b.rank - a.rank || a.i - b.i);
        const chosen = candidates.slice(0, maxVoices);
        voiced.fill(false);
        const hazards: Hazard[] = chosen.map((c, rank) => {
            voiced[c.i] = true;
            const r = readings[c.i] as SectorReading;
            return {
                sector: r.sector,
                rank,
                urgency: c.urgency,
                distance: r.distance,
                ttcS: r.ttcS,
                dir: r.dir,
                material: r.material ?? 'wall',
                objectId: r.objectId
            };
        });

        let sum = 0;
        for (const r of readings) sum += r.distance;
        return { t, frame, sectors: readings, hazards, meanFreeDistanceM: sum / n };
    };

    return {
        config,
        get maxVoices() {
            return maxVoices;
        },
        sample,
        setMaxVoices(v: number) {
            checkVoices(v);
            maxVoices = v;
            if (v === 0) voiced.fill(false);
        },
        reset
    };
}
