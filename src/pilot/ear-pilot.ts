// The ear pilot (sonic3 plan section 4, stage Z3): sticks from percepts alone. Its only inputs are what perceive.ts
// heard (sides, front or back, pitch steps, pulse rate, the urgent duck) and its own last command; it is the check that a
// cue set can be flown by ear at a speed. Every gain below is an estimate.
import type { Percepts, StreamPercept } from './perceive';

/** What the pilot asks the craft for, in the heading frame. */
export interface StickCommand {
    /** forward speed wanted, m/s */
    readonly forwardMps: number;
    /** sideways speed wanted, m/s (positive: right) */
    readonly lateralMps: number;
    /** climb wanted, m/s (positive: up) */
    readonly climbMps: number;
    /** turn rate wanted, degrees per second (positive: right) */
    readonly yawDps: number;
}

export interface EarPilotOptions {
    /** the speed set point, m/s */
    readonly speedMps: number;
    /** reaction delay, ms (estimate) */
    readonly reactionMs?: number;
    /** turn rate toward the hum's side, deg/s (estimate) */
    readonly turnDps?: number;
    /** climb rate for a pitch step, m/s (estimate) */
    readonly climbMps?: number;
    /** share of the set point kept while a hazard is urgent (estimate) */
    readonly brakeShare?: number;
    /** sideways step away from a hazard heard on a side, m/s (estimate) */
    readonly dodgeMps?: number;
}

export const REACTION_MS = 250;
export const TURN_DPS = 120;
export const CLIMB_MPS = 1.5;
export const BRAKE_SHARE = 0.3;
export const DODGE_MPS = 1;
/** how long the pilot keeps turning toward a hum it no longer hears, ms (estimate) */
export const HUM_MEMORY_MS = 1500;

const NONE: Percepts = { t: -Infinity, urgent: false, streams: [] };

export class EarPilot {
    private readonly queue: Percepts[] = [];
    private yawDps = 0;
    private climbMps = 0;
    readonly reactionMs: number;

    constructor(private readonly o: EarPilotOptions) {
        this.reactionMs = o.reactionMs ?? REACTION_MS;
    }

    /** One frame: the pilot hears `p` now and acts on what it heard `reactionMs` ago. */
    step(p: Percepts): StickCommand {
        this.queue.push(p);
        let now = NONE;
        while (this.queue.length > 0 && (this.queue[0] as Percepts).t <= p.t - this.reactionMs) now = this.queue.shift() as Percepts;
        if (now === NONE) return { forwardMps: 0, lateralMps: 0, climbMps: 0, yawDps: 0 };
        return this.decide(now);
    }

    /** the side the hum was last heard on, and when (it is masked while hazards are louder) */
    private humSide: -1 | 0 | 1 = 0;
    private humT = -Infinity;

    private decide(p: Percepts): StickCommand {
        const turn = this.o.turnDps ?? TURN_DPS;
        const climb = this.o.climbMps ?? CLIMB_MPS;
        const dodge = this.o.dodgeMps ?? DODGE_MPS;
        // the hum is folded to the front with the beacon on (the lesson teaches it): its front or back is not used
        const hum = p.streams.find((s) => s.cue === 'target.hum');
        if (hum !== undefined) {
            this.humSide = hum.onCourse ? 0 : hum.side;
            this.humT = p.t;
            this.yawDps = this.humSide * turn;
            this.climbMps = Math.sign(hum.elevSteps) * climb;
        } else if (p.t - this.humT > HUM_MEMORY_MS) {
            this.yawDps = 0;
            this.climbMps = 0;
        } else this.yawDps = (this.humSide * turn) / 2;
        let forward = this.o.speedMps;
        let lateral = 0;
        let yaw = this.yawDps;
        let up = this.climbMps;
        const free = p.streams.find((s) => s.cue === 'safety.free');
        const hazards = p.streams.filter((s): s is StreamPercept => s.layer === 'safety' && s.cue !== 'safety.free');
        for (const h of hazards) if (!h.behind && h.side !== 0) lateral -= h.side * dodge;
        // the brake cue (Design 4): the matching rule, a slower approach while it sounds
        if (p.brake === true) forward = this.o.speedMps * (this.o.brakeShare ?? BRAKE_SHARE);
        if (p.urgent) {
            forward = this.o.speedMps * (this.o.brakeShare ?? BRAKE_SHARE);
            // the material is a timbre: a ceiling or a floor is told apart by ear
            if (hazards.some((h) => h.cue === 'safety.ceiling')) up = -climb;
            else if (hazards.some((h) => h.cue === 'safety.floor')) up = climb;
            if (free !== undefined && free.side !== 0) {
                yaw = free.side * turn;
                lateral = free.side * 2 * dodge;
            } else {
                const ahead = hazards.find((h) => !h.behind && h.cue !== 'safety.ceiling' && h.cue !== 'safety.floor');
                if (ahead !== undefined && ahead.side !== 0) {
                    yaw = -ahead.side * turn;
                    lateral = -ahead.side * 2 * dodge;
                } else if (ahead !== undefined) yaw = (this.humSide === 0 ? 1 : this.humSide) * turn;
            }
        }
        return { forwardMps: forward, lateralMps: lateral, climbMps: up, yawDps: yaw };
    }
}
