// The imperfect pilot of the gate courses (the v0.13 merge review's probe, made a helper by lane s13-elev): the truth
// bot's line through a course (4 m before and 4 m past each gate, test/helpers/truth.ts), but at
// IMPERFECT_SPEED_SHARE of the lesson's speed cap, wobbling sideways by half the room each gate's opening leaves the
// hull, and hesitating IMPERFECT_HOLD_S after every IMPERFECT_HOLD_EVERY_M of its path. What a real beginner does
// that the truth bot does not: slow, unsteady, stopping to listen.
import type { Goal, SonicObject, Vec3 } from '../../src/contract';
import { BODY_RADIUS_M, courseGates } from '../../src/lesson';
import { quatRotate } from '../../src/util/vec';
import { DT_MS, type ScriptedPilot } from './pilot';
import { truthAnswerer } from './truth';

export const IMPERFECT_SPEED_SHARE = 0.65;
export const IMPERFECT_HOLD_S = 1.2;
export const IMPERFECT_HOLD_EVERY_M = 3;
/** the wobble's rate, Hz */
const WOBBLE_HZ = 0.4;

/** The room a gate's opening leaves the hull on each side of its centre, m. */
export function gateClearanceM(g: SonicObject): number {
    const s = g.shape;
    const open = s.kind === 'ring' ? s.diameter / 2 - s.tube : s.kind === 'square' || s.kind === 'cube-frame' ? s.side / 2 - s.bar : 0.5;
    return Math.max(0, open - BODY_RADIUS_M);
}

const still = (p: ScriptedPilot, attempt: number): boolean => p.run.attempt === attempt && p.run.phase === 'flying';

class Imperfect {
    private walked = 0;
    private clock = 0;
    constructor(private readonly p: ScriptedPilot, private readonly attempt: number) {}

    /** Flies the leg to `to` along the gate's own sideways axis wobbling by `amp`; false when the attempt ended or the runner moved the craft. */
    leg(to: Vec3, gate: SonicObject, amp: number): boolean {
        const p = this.p;
        const placed = p.placed;
        const a = p.lesson.assists;
        const v = IMPERFECT_SPEED_SHARE * (a.maxSpeedMps ?? 6);
        const climb = a.maxClimbMps ?? 3;
        const turn = a.maxYawDps ?? 180;
        const side = quatRotate(gate.quat, [1, 0, 0]);
        const dt = DT_MS / 1000;
        // the nominal point runs the straight leg; the craft is that point plus the wobble
        let nominal: Vec3 = [p.pos[0] - side[0] * this.offset(amp), p.pos[1], p.pos[2] - side[2] * this.offset(amp)];
        for (let guard = 0; guard < 200000; guard++) {
            if (!still(p, this.attempt) || p.placed !== placed) return false;
            const d: Vec3 = [to[0] - nominal[0], to[1] - nominal[1], to[2] - nominal[2]];
            const horiz = Math.hypot(d[0], d[2]);
            if (horiz <= 1e-6 && Math.abs(d[1]) <= 1e-6) return true;
            if (this.walked >= IMPERFECT_HOLD_EVERY_M) {
                this.walked = 0;
                p.vel = [0, 0, 0];
                for (let k = 0; k < Math.round((IMPERFECT_HOLD_S * 1000) / DT_MS) && still(p, this.attempt) && p.placed === placed; k++) p.tick();
                continue;
            }
            const h = Math.min(horiz, v * dt);
            const y = Math.sign(d[1]) * Math.min(Math.abs(d[1]), climb * dt);
            nominal = [nominal[0] + (horiz > 1e-9 ? (d[0] / horiz) * h : 0), nominal[1] + y, nominal[2] + (horiz > 1e-9 ? (d[2] / horiz) * h : 0)];
            this.walked += Math.hypot(h, y);
            this.clock += dt;
            const w = this.offset(amp);
            const next: Vec3 = [nominal[0] + side[0] * w, nominal[1], nominal[2] + side[2] * w];
            p.vel = [(next[0] - p.pos[0]) / dt, (next[1] - p.pos[1]) / dt, (next[2] - p.pos[2]) / dt];
            p.pos = next;
            if (horiz > 0.3) {
                const want = (Math.atan2(d[0], -d[2]) * 180) / Math.PI;
                const diff = ((((want - p.yaw + 180) % 360) + 360) % 360) - 180;
                p.yaw += Math.max(-turn * dt, Math.min(turn * dt, diff));
            }
            p.tick();
        }
        return false;
    }

    private offset(amp: number): number {
        return amp * Math.sin(2 * Math.PI * WOBBLE_HZ * this.clock);
    }
}

/** Flies the attempt now running through its course of gates as the imperfect pilot, then waits for it to end. */
export function flyImperfect(p: ScriptedPilot): void {
    const attempt = p.run.attempt;
    const pilot = new Imperfect(p, attempt);
    for (const goal of p.lesson.goals) {
        if (!still(p, attempt)) return;
        if (goal.kind !== 'pass-gates' && goal.kind !== 'timed-course') {
            // a question (name-shape) is answered by the answerer; nothing else is flown here
            p.until(() => !still(p, attempt), 3);
            continue;
        }
        const g = goal as Extract<Goal, { kind: 'pass-gates' | 'timed-course' }>;
        const gates = courseGates(p.objects(), g.kind === 'pass-gates' ? g.gateIds : 'all');
        for (let lap = 0; lap < (g.kind === 'timed-course' ? g.laps : 1); lap++) {
            for (const gate of gates) {
                const f = quatRotate(gate.quat, [0, 0, 1]);
                const amp = gateClearanceM(gate) / 2;
                if (!pilot.leg([gate.pos[0] + f[0] * 4, gate.pos[1] + f[1] * 4, gate.pos[2] + f[2] * 4], gate, amp)) return;
                if (!pilot.leg([gate.pos[0] - f[0] * 4, gate.pos[1] - f[1] * 4, gate.pos[2] - f[2] * 4], gate, amp)) return;
            }
        }
    }
    p.until(() => !still(p, attempt), 10);
}

/** Runs a gate lesson with the imperfect pilot until it passes, at most `maxAttempts` attempts. */
export function playImperfect(p: ScriptedPilot, maxAttempts = 8): void {
    p.answerer = truthAnswerer(p);
    p.begin();
    for (let k = 0; k < maxAttempts && p.run.phase !== 'passed'; k++) {
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 600);
        if ((p.run.phase as string) === 'passed') return;
        const attempt = p.run.attempt;
        flyImperfect(p);
        p.until(() => p.run.attempt > attempt || p.run.phase === 'passed', (p.lesson.attemptLimitS ?? 600) + 30);
    }
}
