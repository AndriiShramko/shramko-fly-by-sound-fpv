// Voice budget (research 01 section 5.2 and 9): at most 8 moving and 24 static spatialised voices,
// stolen by priority. A VoiceAllocator hands a fixed number of slots to the requests of one frame:
// a request that already holds a slot keeps it (no flicker), a new request takes a free slot, and
// when none is free it takes the slot of the lowest-priority holder, but only from a strictly lower
// one. Pure: the engine owns one allocator per pool; the proofs count what it lets through.

export const MAX_MOVING_VOICES = 8;
export const MAX_STATIC_VOICES = 24;

/** Priorities: the safety layer outranks everything (spec principle 4: safety, next target, own height and speed, ambience). */
export const PRIORITY = {
    /** hazard of rank r has HAZARD - r */
    hazard: 100,
    touch: 95,
    target: 80,
    gateNote: 75,
    shape: 60,
    preview: 50,
    chime: 40
} as const;

export interface VoiceRequest {
    /** stable for as long as the same thing sounds (e.g. 'safety:front-left', 'target', 'shape') */
    readonly key: string;
    readonly priority: number;
}

export interface Allocation {
    /** slot index of every request that got one */
    readonly slotOf: ReadonlyMap<string, number>;
    /** keys that got a slot this frame and had none before */
    readonly started: readonly string[];
    /** keys that held a slot and lost it (no longer requested, or stolen) */
    readonly stopped: readonly string[];
    /** keys requested that got no slot */
    readonly dropped: readonly string[];
}

export class VoiceAllocator {
    readonly size: number;
    private readonly holders: (VoiceRequest | null)[];

    constructor(size: number) {
        if (!Number.isInteger(size) || size < 0) throw new Error(`voice pool size must be a whole number, got ${size}`);
        this.size = size;
        this.holders = new Array<VoiceRequest | null>(size).fill(null);
    }

    /** The key in each slot, null when free. */
    slots(): (string | null)[] {
        return this.holders.map((h) => (h === null ? null : h.key));
    }

    /** Hands out the slots for this frame's requests. */
    assign(requests: readonly VoiceRequest[]): Allocation {
        const wanted = new Map<string, VoiceRequest>();
        for (const r of requests) {
            const prev = wanted.get(r.key);
            if (prev === undefined || r.priority > prev.priority) wanted.set(r.key, r);
        }
        const stopped: string[] = [];
        // holders no longer wanted leave; holders still wanted take their new priority
        for (let i = 0; i < this.size; i++) {
            const h = this.holders[i];
            if (h === null || h === undefined) continue;
            const w = wanted.get(h.key);
            if (w === undefined) {
                stopped.push(h.key);
                this.holders[i] = null;
            } else this.holders[i] = w;
        }
        const held = new Set(this.holders.filter((h): h is VoiceRequest => h !== null).map((h) => h.key));
        // newcomers, the most important first (ties: request order)
        const order = new Map(requests.map((r, i) => [r.key, i] as const));
        const newcomers = [...wanted.values()].filter((r) => !held.has(r.key)).sort((a, b) => b.priority - a.priority || (order.get(a.key) as number) - (order.get(b.key) as number));
        const started: string[] = [];
        for (const r of newcomers) {
            let slot = this.holders.indexOf(null);
            if (slot < 0) {
                // steal from the lowest-priority holder, only if strictly lower; among equals, the one
                // asked for last (requests come most important first)
                let lowest = -1;
                const rank = (i: number): number => order.get((this.holders[i] as VoiceRequest).key) ?? -1;
                for (let i = 0; i < this.size; i++) {
                    const h = this.holders[i] as VoiceRequest;
                    const l = lowest < 0 ? null : (this.holders[lowest] as VoiceRequest);
                    if (l === null || h.priority < l.priority || (h.priority === l.priority && rank(i) > rank(lowest))) lowest = i;
                }
                if (lowest >= 0 && (this.holders[lowest] as VoiceRequest).priority < r.priority) {
                    stopped.push((this.holders[lowest] as VoiceRequest).key);
                    slot = lowest;
                }
            }
            if (slot < 0) continue;
            this.holders[slot] = r;
            started.push(r.key);
        }
        const slotOf = new Map<string, number>();
        this.holders.forEach((h, i) => {
            if (h !== null) slotOf.set(h.key, i);
        });
        const dropped = [...wanted.keys()].filter((k) => !slotOf.has(k));
        return { slotOf, started, stopped, dropped };
    }

    clear(): string[] {
        const keys = this.holders.filter((h): h is VoiceRequest => h !== null).map((h) => h.key);
        this.holders.fill(null);
        return keys;
    }
}
