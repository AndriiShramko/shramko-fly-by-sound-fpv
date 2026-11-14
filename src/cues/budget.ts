// The stream budget at speed (sonic3 plan Part 2 section 2.2, stage Z4; the owner's message 51: "at the speed of a
// normal FPV flight it becomes a mess of sounds"). The faster the craft, the fewer continuous streams sound at once,
// chosen by a fixed priority: an urgent hazard, the guide (the target hum), the open-way chime, the other hazards, the
// shape trace. A cut stream stops (the owner asked for fewer sounds, not quieter ones); short events (gate notes,
// touch, lap, praise) and narration previews are not streams and are never cut. Pure: the planner owns the tier gate
// and hands the frame's requests in. Every number here is an estimate the ear pilot (src/pilot) measures.

/** 0 under 3 m/s (every cue as before), 1 to 8 m/s, 2 to 15 m/s, 3 above */
export type SpeedTier = 0 | 1 | 2 | 3;

/** the speed where each tier begins, m/s (estimates) */
export const TIER_EDGES_MPS: readonly [number, number, number] = [3, 8, 15];
/** a tier is left downwards below this share of its edge (hysteresis, estimate) */
export const TIER_DOWN_SHARE = 0.85;
/** a tier is held at least this long before it changes again, ms (estimate) */
export const TIER_HOLD_MS = 500;
/** continuous streams at once, by tier */
export const TIER_STREAMS: readonly [number, number, number, number] = [Number.POSITIVE_INFINITY, 3, 2, 2];

/** The tier with hysteresis: up at an edge, down at TIER_DOWN_SHARE of it, never two changes within TIER_HOLD_MS. */
export class TierGate {
    private tierValue: SpeedTier = 0;
    private since = Number.NEGATIVE_INFINITY;

    get tier(): SpeedTier {
        return this.tierValue;
    }

    update(speedMps: number, tMs: number): SpeedTier {
        if (tMs - this.since < TIER_HOLD_MS) return this.tierValue;
        let next = this.tierValue;
        const edges: readonly number[] = TIER_EDGES_MPS;
        while (next < 3 && speedMps >= (edges[next] as number)) next = (next + 1) as SpeedTier;
        if (next === this.tierValue) while (next > 0 && speedMps < (edges[next - 1] as number) * TIER_DOWN_SHARE) next = (next - 1) as SpeedTier;
        if (next !== this.tierValue) {
            this.tierValue = next;
            this.since = tMs;
        }
        return this.tierValue;
    }

    reset(): void {
        this.tierValue = 0;
        this.since = Number.NEGATIVE_INFINITY;
    }
}

/** What the budget needs to know of a requested voice. */
export interface StreamRequest {
    readonly key: string;
    readonly cue: string;
    readonly priority: number;
}

/** The rank of a stream (1 first), or null for what is never cut (previews and anything that is not a stream). */
export function streamRank(r: StreamRequest, urgentKeys: ReadonlySet<string>): number | null {
    if (r.key.startsWith('preview:')) return null;
    if (r.cue === 'safety.free') return 3;
    if (r.cue.startsWith('safety.')) return urgentKeys.has(r.key) ? 1 : 4;
    if (r.cue.startsWith('target.')) return 2;
    if (r.cue.startsWith('shape.')) return 6;
    return null;
}

export interface BudgetResult<T> {
    readonly kept: T[];
    /** keys of the streams cut this frame */
    readonly cut: string[];
}

/**
 * The streams that sound at a tier. Tier 0 keeps everything. Tier 1 and up: no shape trace, then the `TIER_STREAMS`
 * first by rank (ties: higher priority first, then key). Tier 2 and up: when an open-way chime sounds it replaces the
 * hazards (it says where to go, they say where not to).
 */
export function applyBudget<T extends StreamRequest>(requests: readonly T[], tier: SpeedTier, urgentKeys: ReadonlySet<string>): BudgetResult<T> {
    if (tier === 0) return { kept: [...requests], cut: [] };
    const free = requests.some((r) => r.cue === 'safety.free');
    const streams: { readonly r: T; readonly rank: number }[] = [];
    const kept: T[] = [];
    const cut: string[] = [];
    for (const r of requests) {
        const rank = streamRank(r, urgentKeys);
        if (rank === null) kept.push(r);
        else if (rank === 6 || (tier >= 2 && free && (rank === 1 || rank === 4))) cut.push(r.key);
        else streams.push({ r, rank });
    }
    streams.sort((a, b) => a.rank - b.rank || b.r.priority - a.r.priority || (a.r.key < b.r.key ? -1 : a.r.key > b.r.key ? 1 : 0));
    const n = TIER_STREAMS[tier];
    streams.forEach((s, i) => (i < n ? kept.push(s.r) : cut.push(s.r.key)));
    return { kept: requests.filter((r) => kept.includes(r)), cut };
}

/** Speed ticks and the height tone stop at tier 2 and up (the guide's pitch says up and down there). */
export function layerPlanOn(tier: SpeedTier): boolean {
    return tier < 2;
}
