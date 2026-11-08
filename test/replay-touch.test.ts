// Review M1 of the v0.13 merge: a genuine recording with a touch in the corridor or a tunnel re-derives. Those
// lessons put the craft back 1 m before the last point of the world's track on a touch (onTouch 'bump-recentre'),
// and the points are 5 m apart or less, so the replay must see the touch where it was and the points crossed before
// it. Two ways it did not:
//   1. the recorder keeps one sample in two of 60 Hz; when the touch's own sample was not kept, the next frame is
//      already at the respawn and the replay derives the touch there (the host keeps every touched sample now, as the
//      simulator's sampler will: wave 2, W11);
//   2. live, the craft crossed point k one frame and touched the next; the 30 Hz replay sees both in one frame, and the
//      runner took the touch, and its respawn, before the points the frame crossed: back before point k-1, not k.
import { describe, expect, it } from 'vitest';
import type { SessionEvent, Vec3, WorldCheckpoint } from '../src/contract';
import { getLesson } from '../src/lesson';
import { checkSession, formatReplayCheck } from '../src/replay';
import type { SessionPackage } from '../src/session';
import { RecordingHost } from './helpers/record';

const SPEED = 2;
const TICK_MS = 1000 / 60;
/** the indexes of the world's points of the two touches: crossed just before the first, the last passed before the second */
const A = 5;
const B = 9;

type Touch = Extract<SessionEvent, { kind: 'touch' }>;
type Reset = Extract<SessionEvent, { kind: 'reset' }>;

const toward = (from: Vec3, to: Vec3, m: number): Vec3 => {
    const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    return [from[0] + (d[0] / l) * m, from[1] + (d[1] / l) * m, from[2] + (d[2] / l) * m];
};

interface Flight {
    readonly pkg: SessionPackage;
    readonly touches: readonly Touch[];
    readonly resets: readonly Reset[];
}

/**
 * Flies the lesson's track at 2 m/s and touches twice. First the frame after crossing point A, a frame the recording
 * keeps while it drops the crossing one, so the replay sees the crossing and the touch in one frame. Then halfway between
 * points B and B + 1 on a frame that is not due, which only a host that keeps every touched sample writes. After each
 * touch the craft is back 1 m before the last point passed and flies on from that point, to 3 points past B + 1.
 */
async function flyWithTouches(id: string, keepTouched = true): Promise<Flight> {
    const host = new RecordingHost(getLesson(id), { keepTouched });
    host.begin();
    host.until(() => host.runner.phase === 'flying', 180);
    const list = (host.world as unknown as { readonly checkpoints: readonly WorldCheckpoint[] }).checkpoints;
    const [a, b] = [A, B];
    const pending = new Set(['crossing', 'midway']);
    let i = 0;
    for (let guard = 0; guard < 100 && i <= b + 4 && host.runner.phase === 'flying'; guard++) {
        const p = (list[i] as WorldCheckpoint).pos;
        const placed = host.placed;
        if (i === a && pending.delete('crossing')) {
            // 1 cm short of the point; the crossing on a frame that is not due, the touch on the next, which is
            host.flyTo(toward(p, (list[i - 1] as WorldCheckpoint).pos, 0.01), SPEED);
            if (host.nextDue) host.hold(1 / 60);
            host.flyTo(p, SPEED);
            host.touch();
            host.flyTo((list[i + 1] as WorldCheckpoint).pos, SPEED);
        } else if (i === b + 1 && pending.delete('midway')) {
            const prev = (list[b] as WorldCheckpoint).pos;
            host.flyTo([(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2, (prev[2] + p[2]) / 2], SPEED);
            if (host.nextDue) host.hold(1 / 60);
            host.touch();
            host.flyTo(p, SPEED);
        } else host.flyTo(p, SPEED);
        if (host.placed !== placed) {
            // back 1 m before the last point passed: on from that point
            const reset = host.events.filter((e): e is Reset => e.kind === 'reset').at(-1);
            i = Number((reset?.checkpointId ?? 'w1').slice(1)) - 1;
            continue;
        }
        i++;
    }
    host.hold(1);
    const pkg = (await host.toPackage()).pkg;
    return { pkg, touches: pkg.events.filter((e): e is Touch => e.kind === 'touch'), resets: pkg.events.filter((e): e is Reset => e.kind === 'reset') };
}

describe('a recording with touches in the corridor and the tunnels re-derives (review M1 of the merge)', () => {
    for (const id of ['corridor', 'tunnel-gaps', 'tunnel-long']) {
        it(`${id}: two touches, each back 1 m before the last point passed, and the replay says PASS`, async () => {
            const f = await flyWithTouches(id);
            expect(f.touches).toHaveLength(2);
            // the first touch came the frame after the crossing of its point, which the recording does not hold: one replay
            // frame has both, and the respawn goes before that point, as it did live
            const [first, second] = f.touches as [Touch, Touch];
            expect(f.pkg.frames.some((fr) => Math.abs(fr.t - first.t) < 1)).toBe(true);
            expect(f.pkg.frames.some((fr) => Math.abs(fr.t - (first.t - TICK_MS)) < 1)).toBe(false);
            // the second touch's sample was not a due one: it is written because it has a touch
            expect(f.pkg.frames.some((fr) => Math.abs(fr.t - second.t) < 1)).toBe(true);
            expect(f.pkg.frames.some((fr) => Math.abs(fr.t - (second.t - TICK_MS)) < 1)).toBe(true);
            // world points are w1, w2, ...: back before A, then before B
            expect(f.resets.map((r) => [r.to, r.checkpointId])).toEqual([
                ['checkpoint', `w${A + 1}`],
                ['checkpoint', `w${B + 1}`]
            ]);
            const { check } = checkSession(f.pkg);
            expect(check.events.diffs).toEqual([]);
            expect(check.events.byKind.touch).toEqual({ recorded: 2, derived: 2, matched: 2 });
            expect(check.events.byKind.reset).toEqual({ recorded: 2, derived: 2, matched: 2 });
            expect(check.verdict).toBe('pass');
            expect(formatReplayCheck(check)).toMatch(/^replay check PASS/);
        }, 60000);
    }

    it('control: the same flight recorded by a host that writes only the due samples (the simulator before W11) reads FAIL', async () => {
        const f = await flyWithTouches('tunnel-gaps', false);
        const [first, second] = f.touches as [Touch, Touch];
        // the first touch's sample was due, the second's was not: it is lost, the next frame is at the respawn
        expect(f.pkg.frames.some((fr) => Math.abs(fr.t - first.t) < 1)).toBe(true);
        expect(f.pkg.frames.some((fr) => Math.abs(fr.t - second.t) < 1)).toBe(false);
        const { check } = checkSession(f.pkg);
        expect(check.verdict).toBe('fail');
        expect(check.events.diffs.some((d) => d.kind === 'touch')).toBe(true);
        expect(formatReplayCheck(check)).toMatch(/^replay check FAIL/);
    }, 60000);
});
