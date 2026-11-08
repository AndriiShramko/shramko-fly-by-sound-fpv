// What one attempt must achieve, goal by goal (contract Goal; spec section 3). A tracker watches
// consecutive flight samples and says 'met', 'missed' or nothing yet. Pure: the samples carry the
// time. The numbers below are starting values for tests with pilots, like the lessons' own.
// Each tracker also says why its goal is not met (a short spoken line the runner gives after failed
// attempts: "too high 40 percent of the time") and how good it was once met (for "better than last time").
import type { FlightSample, Goal, ObjectShape, SonicObject, SonicWorld, SpeechLine, Vec3 } from '../contract';
import { traceRadius } from '../cues/shape';
import { length, quatConjugate, quatRotate, sub } from '../util/vec';

export type Outcome = 'met' | 'missed' | null;

/** turn-to: the heading must stay within the tolerance this long, ms. */
export const TURN_HOLD_MS = 600;
/** Under this speed the craft counts as stopped, m/s (approach-stop). */
export const STOP_MPS = 0.3;
/** A stop must last this long, ms. */
export const STOP_HOLD_MS = 500;
/** A stop this long out of reach of the goal is a miss: shorter pauses to listen are allowed, ms. */
export const GIVE_UP_MS = 3000;
/** An approach or a stop needs this much flying first, so the hover at the start does not count, m. */
export const APPROACH_MIN_M = 2;
/** Flying this far past a zone after being in it is a miss, m. */
export const ZONE_OVERSHOOT_M = 2;
/** A gate's plane crossed this far outside its opening is a near miss (an attempt at the gate that failed), m. */
export const GATE_NEAR_MISS_M = 2;
/** The craft's radius, m (as the scene sampler's). */
export const BODY_RADIUS_M = 0.12;

export interface TrackContext {
    readonly floorY: number;
    objects(): readonly SonicObject[];
    world(): SonicWorld | null;
    /** the path flown in this attempt so far, m */
    attemptPathM(): number;
    /** a gate was passed: index in the course, how many there are, how far from its centre */
    passedGate(gate: SonicObject, index: number, of: number, missM: number, lapDone: boolean, t: number): void;
    /** a gate that counts next was crossed through its opening from its back side (M41-15): told, never counted */
    wrongSide?(gate: SonicObject, t: number): void;
}

/** How good a met goal was, for "better than last time": a number and which way is better. */
export interface GoalScore {
    readonly value: number;
    readonly better: 'lower' | 'higher';
}

export interface GoalTracker {
    readonly goal: Goal;
    step(s: FlightSample, prev: FlightSample): Outcome;
    /** the next gate or zone or object for the target layer */
    target(): SonicObject | null;
    /** why the goal is not met (so far), one short spoken line; null when there is nothing to say */
    reason(): SpeechLine | null;
    /** how good it was once met; null for a goal with no measure of its own (the runner uses the attempt's time) */
    score(): GoalScore | null;
}

const find = (ctx: TrackContext, id: string): SonicObject | null => ctx.objects().find((o) => o.id === id) ?? null;
const speedOf = (s: FlightSample): number => Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
/** a distance as it is spoken: whole metres from 3 m on, else halves */
const spokenMetres = (m: number): number => (m >= 3 ? Math.round(m) : Math.max(0.5, Math.round(m * 2) / 2));

/** A world point in the object's own frame. */
export function toLocal(o: Pick<SonicObject, 'pos' | 'quat'>, p: Vec3): Vec3 {
    return quatRotate(quatConjugate(o.quat), sub(p, o.pos));
}

/** How far the point lies outside the object's box (zone, box), m; 0 inside. */
export function outsideBox(o: SonicObject, p: Vec3): number {
    const size = o.shape.kind === 'zone' || o.shape.kind === 'box' ? o.shape.size : ([1, 1, 1] as Vec3);
    const l = toLocal(o, p);
    const dx = Math.max(0, Math.abs(l[0]) - size[0] / 2);
    const dy = Math.max(0, Math.abs(l[1]) - size[1] / 2);
    const dz = Math.max(0, Math.abs(l[2]) - size[2] / 2);
    return Math.hypot(dx, dy, dz);
}

/** Clear opening of a gate (the half size a craft's centre may be off its centre), and how far its frame reaches. */
function opening(shape: ObjectShape): { readonly inside: (x: number, y: number) => boolean; readonly edge: number } {
    switch (shape.kind) {
        case 'ring':
            return { inside: (x, y) => Math.hypot(x, y) <= shape.diameter / 2, edge: shape.diameter / 2 + 2 * shape.tube };
        case 'square':
        case 'cube-frame':
            return { inside: (x, y) => Math.max(Math.abs(x), Math.abs(y)) <= shape.side / 2, edge: (Math.SQRT2 * shape.side) / 2 + shape.bar };
        case 'zone':
        case 'box':
            return { inside: (x, y) => Math.abs(x) <= shape.size[0] / 2 && Math.abs(y) <= shape.size[1] / 2, edge: Math.hypot(shape.size[0], shape.size[1]) / 2 };
        case 'pillar':
            return { inside: () => false, edge: shape.radius };
    }
}

/**
 * Where the step from `a` to `b` crosses the gate's plane forward (from its +Z side to its -Z side,
 * the way a 'forward' pass goes), in the gate's frame, or null.
 */
export function gateCrossing(gate: SonicObject, a: Vec3, b: Vec3): { readonly inside: boolean; readonly missM: number; readonly near: boolean } | null {
    const la = toLocal(gate, a);
    const lb = toLocal(gate, b);
    if (!(la[2] > 0 && lb[2] <= 0)) return null;
    const u = la[2] / (la[2] - lb[2]);
    const x = la[0] + u * (lb[0] - la[0]);
    const y = la[1] + u * (lb[1] - la[1]);
    const o = opening(gate.shape);
    const missM = Math.hypot(x, y);
    return { inside: o.inside(x, y), missM, near: missM <= o.edge + GATE_NEAR_MISS_M };
}

/** Whether the step from `a` to `b` crosses the gate's plane backward (from its -Z side to its +Z side) inside its opening. */
export function gateCrossingBack(gate: SonicObject, a: Vec3, b: Vec3): boolean {
    const la = toLocal(gate, a);
    const lb = toLocal(gate, b);
    if (!(la[2] < 0 && lb[2] >= 0)) return false;
    const u = la[2] / (la[2] - lb[2]);
    return opening(gate.shape).inside(la[0] + u * (lb[0] - la[0]), la[1] + u * (lb[1] - la[1]));
}

/** The gates of a course in order: objects with an order, filtered to `ids` (kept in course order). */
export function courseGates(objects: readonly SonicObject[], ids: readonly string[] | 'all'): SonicObject[] {
    const gates = objects.filter((o) => o.order !== null).sort((a, b) => (a.order as number) - (b.order as number));
    return ids === 'all' ? gates : gates.filter((g) => ids.includes(g.id));
}

/** Distance from the craft's hull to the nearest wall around it (eight horizontal rays), m; null when nothing is in reach. */
export function nearestWallM(world: SonicWorld | null, p: Vec3): number | null {
    if (world === null) return null;
    let best: number | null = null;
    for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const hit = world.castRay(p, [Math.sin(a), 0, -Math.cos(a)], 60);
        if (hit !== null) best = best === null ? hit.distance : Math.min(best, hit.distance);
    }
    return best === null ? null : Math.max(0, best - BODY_RADIUS_M);
}

/** Distance from the craft's hull to an object's surface, about, m. */
export function objectDistanceM(o: SonicObject, p: Vec3): number {
    if (o.shape.kind === 'pillar') {
        const l = toLocal(o, p);
        const radial = Math.hypot(l[0], l[2]) - o.shape.radius;
        const vertical = Math.max(0, Math.abs(l[1]) - o.shape.height / 2);
        return Math.max(0, Math.hypot(Math.max(radial, 0), vertical) - BODY_RADIUS_M);
    }
    if (o.shape.kind === 'zone' || o.shape.kind === 'box') return Math.max(0, outsideBox(o, p) - BODY_RADIUS_M);
    return Math.max(0, length(sub(p, o.pos)) - traceRadius(o.shape) - BODY_RADIUS_M);
}

const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const wrapRad = (d: number): number => Math.atan2(Math.sin(d), Math.cos(d));

/** The tracker of one flight goal ('name-cues', 'locate' and 'name-shape' are asked by the runner, not flown). */
export function createTracker(goal: Goal, ctx: TrackContext): GoalTracker {
    switch (goal.kind) {
        case 'hold-height': {
            let windowStart: number | null = null;
            let inBand = 0;
            let above = 0;
            let below = 0;
            let total = 0;
            let lastH: number | null = null;
            return {
                goal,
                step(s, prev) {
                    const h = s.pos[1] - ctx.floorY;
                    lastH = h;
                    const inside = h >= goal.bandM[0] && h <= goal.bandM[1];
                    if (windowStart === null) {
                        if (!inside) return null;
                        windowStart = s.t;
                        return null;
                    }
                    const dt = Math.max(0, s.t - prev.t) / 1000;
                    total += dt;
                    if (inside) inBand += dt;
                    else if (h > goal.bandM[1]) above += dt;
                    else below += dt;
                    if ((s.t - windowStart) / 1000 >= goal.seconds) return inBand / Math.max(total, 1e-9) >= goal.shareMin ? 'met' : 'missed';
                    return null;
                },
                target: () => null,
                reason() {
                    if (windowStart === null) return { key: lastH !== null && lastH > goal.bandM[1] ? 'reason.height-never-high' : 'reason.height-never-low' };
                    if (total <= 0 || above + below <= 0) return null;
                    const high = above >= below;
                    return { key: high ? 'reason.height-high' : 'reason.height-low', params: { percent: Math.round((100 * (high ? above : below)) / total) } };
                },
                score: () => (total > 0 ? { value: inBand / total, better: 'higher' } : null)
            };
        }
        case 'turn-to': {
            let since: number | null = null;
            let lastOff: number | null = null;
            let faced = false;
            return {
                goal,
                step(s) {
                    const o = find(ctx, goal.objectId);
                    if (o === null) return null;
                    const bearing = (Math.atan2(o.pos[0] - s.pos[0], -(o.pos[2] - s.pos[2])) * 180) / Math.PI;
                    const off = wrapDeg(bearing - s.yawDeg);
                    lastOff = off;
                    if (Math.abs(off) <= goal.toleranceDeg) {
                        faced = true;
                        if (since === null) since = s.t;
                        if (s.t - since >= TURN_HOLD_MS) return 'met';
                    } else since = null;
                    return null;
                },
                target: () => find(ctx, goal.objectId),
                reason() {
                    if (lastOff === null) return null;
                    const a = Math.abs(lastOff);
                    // it was faced and passed: the turn went on through it
                    if (a <= goal.toleranceDeg || (faced && a <= 3 * goal.toleranceDeg)) return { key: 'reason.turn-hold' };
                    if (a > 90) return { key: 'reason.turn-behind' };
                    return { key: lastOff < 0 ? 'reason.turn-left' : 'reason.turn-right', params: { degrees: Math.max(5, Math.round(a / 5) * 5) } };
                },
                score: () => null
            };
        }
        case 'reach-zone': {
            let wasInside = false;
            let slowIn: number | null = null;
            let slowOut: number | null = null;
            let past = 0;
            let lastOut: number | null = null;
            return {
                goal,
                step(s) {
                    const zone = find(ctx, goal.zoneId);
                    if (zone === null) return null;
                    const out = outsideBox(zone, s.pos);
                    lastOut = out;
                    const slow = speedOf(s) < goal.stopBelowMps;
                    if (out <= 0) {
                        wasInside = true;
                        slowOut = null;
                        if (!goal.stop) return 'met';
                        if (slow) {
                            if (slowIn === null) slowIn = s.t;
                            if (s.t - slowIn >= STOP_HOLD_MS) return 'met';
                        } else slowIn = null;
                        return null;
                    }
                    slowIn = null;
                    if (wasInside && out > ZONE_OVERSHOOT_M) {
                        past = out;
                        return 'missed';
                    }
                    if (slow && ctx.attemptPathM() >= APPROACH_MIN_M) {
                        if (slowOut === null) slowOut = s.t;
                        if (s.t - slowOut >= GIVE_UP_MS) return 'missed';
                    } else slowOut = null;
                    return null;
                },
                target: () => find(ctx, goal.zoneId),
                reason() {
                    if (past > 0) return { key: 'reason.zone-past', params: { metres: spokenMetres(past) } };
                    if (lastOut === null) return null;
                    if (lastOut <= 0) return goal.stop ? { key: 'reason.zone-no-stop' } : null;
                    return { key: wasInside ? 'reason.zone-past' : 'reason.zone-short', params: { metres: spokenMetres(lastOut) } };
                },
                score: () => null
            };
        }
        case 'approach-stop': {
            let slow: number | null = null;
            let stoppedAt: number | null = null;
            return {
                goal,
                step(s) {
                    if (speedOf(s) >= STOP_MPS || ctx.attemptPathM() < APPROACH_MIN_M) {
                        slow = null;
                        return null;
                    }
                    if (slow === null) slow = s.t;
                    const o = goal.objectId === null ? null : find(ctx, goal.objectId);
                    const d = o === null ? nearestWallM(ctx.world(), s.pos) : objectDistanceM(o, s.pos);
                    const near = d !== null && d <= goal.stopWithinM;
                    if (d !== null && s.t - slow >= STOP_HOLD_MS) stoppedAt = d;
                    if (near && s.t - slow >= STOP_HOLD_MS) return 'met';
                    if (!near && s.t - slow >= GIVE_UP_MS) return 'missed';
                    return null;
                },
                target: () => (goal.objectId === null ? null : find(ctx, goal.objectId)),
                reason: () => (stoppedAt === null ? { key: 'reason.stop-none' } : { key: 'reason.stop-far', params: { metres: spokenMetres(stoppedAt), limit: spokenMetres(goal.stopWithinM) } }),
                score: () => (stoppedAt === null ? null : { value: stoppedAt, better: 'lower' })
            };
        }
        case 'around': {
            let total = 0;
            let last: number | null = null;
            return {
                goal,
                step(s) {
                    const o = find(ctx, goal.objectId);
                    if (o === null) return null;
                    const a = Math.atan2(s.pos[2] - o.pos[2], s.pos[0] - o.pos[0]);
                    if (last !== null) total += wrapRad(a - last);
                    last = a;
                    return Math.abs(total) >= 2 * Math.PI ? 'met' : null;
                },
                target: () => find(ctx, goal.objectId),
                reason: () => ({ key: 'reason.around', params: { degrees: Math.min(350, Math.round((Math.abs(total) * 18) / Math.PI) * 10) } }),
                score: () => null
            };
        }
        case 'fly-distance':
            return {
                goal,
                step: () => (ctx.attemptPathM() >= goal.metres ? 'met' : null),
                target: () => null,
                reason: () => ({ key: 'reason.distance', params: { metres: Math.min(Math.floor(ctx.attemptPathM()), Math.max(0, goal.metres - 1)), total: goal.metres } }),
                score: () => null
            };
        case 'pass-gates':
        case 'timed-course': {
            const ids = goal.kind === 'pass-gates' ? goal.gateIds : 'all';
            const inOrder = goal.kind === 'pass-gates' ? goal.inOrder : true;
            const laps = goal.kind === 'timed-course' ? goal.laps : 1;
            let next = 0;
            let lap = 0;
            let missedGate: number | null = null;
            let missSum = 0;
            let missCount = 0;
            const passed = new Set<string>();
            return {
                goal,
                step(s, prev) {
                    const gates = courseGates(ctx.objects(), ids);
                    if (gates.length === 0) return null;
                    const candidates = inOrder ? [gates[next] as SonicObject] : gates.filter((g) => !passed.has(g.id));
                    for (const g of candidates) {
                        if (gateCrossingBack(g, prev.pos, s.pos)) ctx.wrongSide?.(g, s.t);
                        const x = gateCrossing(g, prev.pos, s.pos);
                        if (x === null) continue;
                        if (x.inside) {
                            const index = gates.indexOf(g);
                            if (inOrder) next++;
                            passed.add(g.id);
                            missSum += x.missM;
                            missCount++;
                            const lapDone = inOrder ? next >= gates.length : passed.size >= gates.length;
                            ctx.passedGate(g, index, gates.length, x.missM, lapDone, s.t);
                            if (lapDone) {
                                lap++;
                                next = 0;
                                passed.clear();
                                if (lap >= laps) return 'met';
                            }
                            return null;
                        }
                        if (x.near) {
                            missedGate = gates.indexOf(g);
                            return 'missed';
                        }
                    }
                    return null;
                },
                target() {
                    const gates = courseGates(ctx.objects(), ids);
                    if (gates.length === 0) return null;
                    return inOrder ? (gates[Math.min(next, gates.length - 1)] ?? null) : (gates.find((g) => !passed.has(g.id)) ?? null);
                },
                reason(): SpeechLine | null {
                    if (missedGate !== null) return { key: 'reason.gate-missed', params: { n: missedGate + 1 } };
                    const total = courseGates(ctx.objects(), ids).length;
                    return total === 0 ? null : { key: 'reason.gates', params: { passed: inOrder ? next : passed.size, total } };
                },
                score: () => (missCount > 0 ? { value: missSum / missCount, better: 'lower' } : null)
            };
        }
        default:
            // name-cues, locate, name-shape: answered, not flown
            return { goal, step: () => null, target: () => null, reason: () => null, score: () => null };
    }
}
