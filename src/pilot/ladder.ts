// The speed ladder (sonic3 plan section 4): a lesson's course flown by the ear pilot at rising speed set points, as a
// host flies it (the lesson runner, the cue planner, one frame every 20 ms, every line spoken at once). The pilot gets
// only the planner's frame through perceive.ts; this file holds the world, the runner and the craft, the pilot does not.
// A flight passes when the runner says the attempt passed with no touch, within 3 x the course length / the speed.
import type { LessonDef, SessionEvent, SonicPrefs, ThemeDef, Vec3 } from '../contract';
import { CuePlanner, type FramePlan } from '../cues/planner';
import { BODY_RADIUS_M, createLessonRunner } from '../lesson';
import { defaultPrefs } from '../prefs';
import { getBuiltinTheme } from '../theme';
import { createAnalyticWorld } from '../world';
import { Craft, CRAFT_ACCEL_MPS2, CRAFT_CLIMB_MPS, CRAFT_YAW_DPS } from './craft';
import { EarPilot, type EarPilotOptions, type StickCommand } from './ear-pilot';
import { DEFAULT_HEARING, Ear, type Hearing, type Percepts } from './perceive';

/** the speed set points, m/s (plan section 4) */
export const LADDER_MPS: readonly number[] = [1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 22];
export const DT_MS = 20;
/** time allowed: this many times the course length at the set point */
export const TIME_FACTOR = 3;
const TOUCH_QUIET_MS = 500;

export interface FlyOptions {
    readonly theme?: ThemeDef;
    readonly prefs?: SonicPrefs;
    readonly hearing?: Partial<Hearing>;
    /** the pilot's gains (the speed set point is the rung's) */
    readonly pilot?: Omit<EarPilotOptions, 'speedMps'>;
    /** what reaches the ears: the tests' controls (left and right swapped, deaf, distances zeroed) */
    /** the stream budget on (true) or off (false) whatever the lesson says; absent: the lesson's own */
    readonly budget?: boolean;
    /** the racing line on (true) or off (false) whatever the lesson says; absent: the lesson's own */
    readonly line?: boolean;
    readonly mapPlan?: (p: FramePlan) => FramePlan;
    /** every frame: what the pilot heard and did (a tool's trace; the flight does not depend on it) */
    readonly trace?: (f: { readonly t: number; readonly pos: Vec3; readonly yaw: number; readonly heard: Percepts; readonly cmd: StickCommand; readonly plan: FramePlan }) => void;
}

export interface FlightResult {
    readonly speedMps: number;
    readonly seed: number;
    readonly passed: boolean;
    readonly why: 'pass' | 'touch' | 'timeout' | 'fail';
    readonly touches: number;
    /** from the first flying frame, s */
    readonly timeS: number;
    readonly courseM: number;
    /** FNV-1a of the craft's positions (mm) every 100 ms */
    readonly hash: string;
}

/** The course's length: start, then the world's checkpoints in order. */
export function courseLengthM(lesson: LessonDef): number {
    if (lesson.world.kind !== 'analytic') throw new Error(`${lesson.id}: the ladder flies analytic worlds`);
    const w = createAnalyticWorld(lesson.world.spec);
    let at: Vec3 = lesson.start.pos;
    let m = 0;
    for (const c of w.checkpoints ?? []) {
        m += Math.hypot(c.pos[0] - at[0], c.pos[1] - at[1], c.pos[2] - at[2]);
        at = c.pos;
    }
    return m;
}

export function flyLesson(lesson: LessonDef, speedMps: number, seed: number, o: FlyOptions = {}): FlightResult {
    if (lesson.world.kind !== 'analytic') throw new Error(`${lesson.id}: the ladder flies analytic worlds`);
    const world = createAnalyticWorld(lesson.world.spec);
    const prefs = o.prefs ?? { ...defaultPrefs(), beacon: true };
    const theme = o.theme ?? getBuiltinTheme('soft');
    const layers = { ...lesson.layers, ...(o.budget === undefined ? {} : { speedBudget: o.budget }), ...(o.line === undefined ? {} : { racingLine: o.line }) };
    const capped: LessonDef = { ...lesson, layers, assists: { ...lesson.assists, maxSpeedMps: speedMps } };
    const run = createLessonRunner(capped, { seed });
    const planner = new CuePlanner({ theme, prefs, layers });
    const ear = new Ear(theme, prefs, { ...DEFAULT_HEARING, ...o.hearing, seed: (o.hearing?.seed ?? DEFAULT_HEARING.seed) * 7919 + seed });
    const pilot = new EarPilot({ ...o.pilot, speedMps });
    const craft = new Craft(lesson.start, { speedMps, climbMps: Math.max(CRAFT_CLIMB_MPS, lesson.assists.maxClimbMps ?? 0), yawDps: CRAFT_YAW_DPS, accelMps2: CRAFT_ACCEL_MPS2 });
    const courseM = courseLengthM(lesson);
    const limitMs = (TIME_FACTOR * courseM * 1000) / speedMps;
    let t = 0;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const mix = (n: number): void => {
        h1 = Math.imul(h1 ^ (n & 0xffff), 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ ((n >>> 16) & 0xffff), 0x811c9dc5) >>> 0;
    };
    let result: FlightResult['why'] | null = null;
    const read = (evs: readonly SessionEvent[]): void => {
        for (const e of evs) {
            if (e.kind !== 'lesson') continue;
            if (e.what === 'attempt-pass' || e.what === 'passed') result ??= 'pass';
            else if (e.what === 'attempt-fail') result ??= 'fail';
        }
    };
    const take = (): void => {
        for (let guard = 0; guard < 64; guard++) {
            const a = run.takeActions();
            if (a.length === 0) return;
            let said = false;
            for (const x of a) {
                if (x.kind === 'place') craft.place(x.pose);
                else if (x.kind === 'cue') planner.cue(x.event, t);
                else if (x.kind === 'say') said = true;
                else if (x.kind === 'ask') read(run.answer(1, 'key', t));
            }
            if (said) read(run.spoken(t));
        }
    };
    read(run.begin(t));
    take();
    let touches = 0;
    let touching = false;
    let lastContact = -Infinity;
    let t0: number | null = null;
    let frame = 0;
    while (result === null) {
        t += DT_MS;
        frame++;
        const inside = world.sdf(...craft.pos) <= BODY_RADIUS_M;
        const fresh = inside && !touching && t - lastContact >= TOUCH_QUIET_MS;
        touching = inside;
        if (inside) lastContact = t;
        if (fresh) touches++;
        const sample = craft.sample(t, fresh);
        read(run.step(sample, world));
        take();
        if (touches > 0) result ??= 'touch';
        if (run.phase === 'flying' && t0 === null) t0 = t;
        if (t0 !== null && t - t0 > limitMs) result ??= 'timeout';
        if (t > limitMs + 120_000) result ??= 'timeout';
        if (result !== null) break;
        const plan = planner.plan({ sample, world, target: run.target(), ...(run.beaconTarget ? { beacon: run.beaconTarget() } : {}), floorY: world.floorY });
        const heard = ear.hear(o.mapPlan ? o.mapPlan(plan) : plan);
        const cmd = pilot.step(heard);
        o.trace?.({ t, pos: craft.pos, yaw: craft.yaw, heard, cmd, plan });
        craft.step(run.phase === 'flying' ? cmd : { forwardMps: 0, lateralMps: 0, climbMps: 0, yawDps: 0 }, DT_MS / 1000);
        if (frame % 5 === 0) for (const v of craft.pos) mix(Math.round(v * 1000));
    }
    const hex = (n: number): string => n.toString(16).padStart(8, '0');
    const why = result as FlightResult['why'];
    return { speedMps, seed, passed: why === 'pass' && touches === 0, why, touches, timeS: t0 === null ? 0 : (t - t0) / 1000, courseM, hash: hex(h1) + hex(h2) };
}

export interface LadderResult {
    readonly lessonId: string;
    readonly seeds: readonly number[];
    /** highest passing set point per seed, 0 when none passed */
    readonly topBySeed: readonly number[];
    readonly medianTopMps: number;
    readonly flights: readonly FlightResult[];
}

/** Every rung for every seed; the top is the highest rung that passed (plan section 4). */
export function ladder(lesson: LessonDef, seeds: readonly number[] = [1, 2, 3], rungs: readonly number[] = LADDER_MPS, o: FlyOptions = {}): LadderResult {
    const flights: FlightResult[] = [];
    const topBySeed: number[] = [];
    for (const seed of seeds) {
        let top = 0;
        for (const v of rungs) {
            const r = flyLesson(lesson, v, seed, o);
            flights.push(r);
            if (r.passed) top = Math.max(top, v);
        }
        topBySeed.push(top);
    }
    const sorted = [...topBySeed].sort((a, b) => a - b);
    const medianTopMps = sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] as number);
    return { lessonId: lesson.id, seeds, topBySeed, medianTopMps, flights };
}
