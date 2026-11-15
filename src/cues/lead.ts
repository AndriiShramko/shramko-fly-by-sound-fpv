// Leads in seconds (simulator train 3, lane sonic4, design 1; the owner's message 51: "think of distances scaled by
// time"). A cue that warns or guides at a fixed distance in metres gives a fast craft no time: at 8 m/s the 2 m of the
// gate aim are 0.25 s, the reaction alone (lane sonic4 V1-b). Here every such distance becomes the larger of the metres
// of today and seconds x speed, and only at or above SPEED_LEAD_FROM_MPS (the first tier edge of the stream budget), so
// every flight under 4.5 m/s sounds exactly as before. The craft's and the pilot's limits below are the package's
// estimates (src/pilot/craft.ts, src/pilot/ear-pilot.ts), not measured on the simulator's physics.

/** the speed from which leads are in seconds, m/s (= TIER_EDGES_MPS[0] of budget.ts) */
export const SPEED_LEAD_FROM_MPS = 4.5;
/** the braking a pilot can count on, m/s2 (estimate: the ear pilot's craft model gives 8) */
export const LEAD_BRAKE_MPS2 = 8;
/** the turn rate a pilot can count on, degrees per second (estimate: the ear pilot turns at 120) */
export const LEAD_TURN_DPS = 120;
/** a pilot's reaction, s (estimate: the ear pilot's 250 ms) */
export const LEAD_REACTION_S = 0.25;
/** the gate aim's through distance in seconds (design 1: 0.6 s x v; estimate) */
export const LEAD_THROUGH_S = 0.6;
/** the gate approach point beyond the turn radius, in seconds (design 1: turn radius + 1.0 s x v; estimate) */
export const LEAD_APPROACH_S = 1.0;

/** The speed that counts for leads: 0 under SPEED_LEAD_FROM_MPS (the metres of today), else the speed. */
export function leadSpeed(speedMps: number): number {
    return Number.isFinite(speedMps) && speedMps >= SPEED_LEAD_FROM_MPS ? speedMps : 0;
}

/** A distance that keeps `seconds` of lead at speed, never below the metres of today. */
export function leadM(metres: number, seconds: number, speedMps: number): number {
    return Math.max(metres, seconds * leadSpeed(speedMps));
}

/** The radius of a full-rate turn at a speed, m. */
export function turnRadiusM(speedMps: number, turnDps: number = LEAD_TURN_DPS): number {
    return Math.max(speedMps, 0) / ((turnDps * Math.PI) / 180);
}

/** The gate approach point's distance out on the entry axis: the turn radius plus LEAD_APPROACH_S of flight, at least `metres`. */
export function approachM(metres: number, speedMps: number): number {
    const v = leadSpeed(speedMps);
    return Math.max(metres, turnRadiusM(v) + LEAD_APPROACH_S * v);
}

/** The distance a hazard is urgent within: the stop distance plus the reaction's flight, at least `metres`. */
export function urgentM(metres: number, speedMps: number): number {
    const v = leadSpeed(speedMps);
    return Math.max(metres, (v * v) / (2 * LEAD_BRAKE_MPS2) + LEAD_REACTION_S * v);
}
