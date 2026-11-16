// Lane sonic5 design 3 (speech at speed): an attempt that fails while the craft flies at 4.5 m/s or faster says only the
// count at once; the retry and hint lines wait until the craft is slower than SPEECH_SLOW_MPS. Slower failures say them at
// once, as before.
import { describe, expect, it } from 'vitest';
import type { FlightSample, Vec3 } from '../src/contract';
import { createLessonRunner, getLesson, type RunnerAction } from '../src/lesson';
import { SPEECH_SLOW_MPS } from '../src/lesson/runner';
import { yawQuat } from '../src/util/vec';
import { createAnalyticWorld } from '../src/world';

const DT = 20;

function flyHoverMiss(speedAtMiss: number): { keys: string[]; retryAtSpeed: number | null } {
    const lesson = getLesson('hover-height');
    if (lesson.world.kind !== 'analytic') throw new Error('analytic world expected');
    const world = createAnalyticWorld(lesson.world.spec);
    const run = createLessonRunner(lesson, {});
    let t = 0;
    let pos: Vec3 = lesson.start.pos;
    let vel: Vec3 = [0, 0, 0];
    const said: { key: string; v: number }[] = [];
    const take = (): void => {
        for (let g = 0; g < 50; g++) {
            const a: readonly RunnerAction[] = run.takeActions();
            if (a.length === 0) return;
            for (const x of a) {
                if (x.kind === 'say') said.push({ key: x.line.key, v: Math.hypot(...vel) });
                if (x.kind === 'place') {
                    pos = x.pose.pos;
                    vel = [0, 0, 0];
                }
            }
            if (a.some((x) => x.kind === 'say')) run.spoken(t);
        }
    };
    const tick = (): void => {
        t += DT;
        const s: FlightSample = { t, tick: t, pos, vel, quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
        run.step(s, world);
        take();
    };
    run.begin(t);
    take();
    for (let i = 0; i < 6000 && run.phase === 'intro'; i++) tick();
    // the band is missed: the craft holds out of it while its velocity says it flies fast
    pos = [0, 2.5, 0];
    for (let i = 0; i < 700; i++) tick();
    const from = said.length;
    for (let i = 0; i < 2000 && run.phase === 'flying'; i++) {
        pos = [0, 3.5, 0];
        vel = [speedAtMiss, 0, 0];
        tick();
    }
    // then the craft slows down
    vel = [0, 0, 0];
    for (let i = 0; i < 50; i++) tick();
    const after = said.slice(from);
    const retry = after.find((x) => x.key.endsWith('.retry'));
    return { keys: after.map((x) => x.key), retryAtSpeed: retry === undefined ? null : retry.v };
}

describe('speech at speed (design 3)', () => {
    it('a miss at 8 m/s says the count at once and the retry line only once the craft is slow', () => {
        const r = flyHoverMiss(8);
        expect(r.keys[0]).toBe('fly.progress');
        expect(r.keys.some((k) => k.endsWith('.retry'))).toBe(true);
        expect(r.retryAtSpeed).not.toBeNull();
        expect(r.retryAtSpeed as number).toBeLessThan(SPEECH_SLOW_MPS);
    });
    it('a miss at 3 m/s says the count and the retry line at once, as before', () => {
        const r = flyHoverMiss(3);
        expect(r.keys.slice(0, 2)).toEqual(['fly.progress', 'lesson.hover-height.retry']);
        expect(r.retryAtSpeed).toBe(3);
    });
});
