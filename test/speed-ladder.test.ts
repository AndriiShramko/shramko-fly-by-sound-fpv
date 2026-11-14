// The speed lessons (sonic3 plan 4, stage Z7): the ring course again at rising caps, the racing line and the stream
// budget on. A cap ships only where the ear pilot (hum attended, line and budget on) has a median top speed of at least
// 1.25 x the cap on that lesson; the time of an attempt is the ear pilot's slowest time at the cap x 1.5 (evidence files
// evidence/ear-pilot/2026-11-15-speed-lessons-hum.json and -at-cap.json, written by tools/ear-pilot.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getLesson, lessonPaths } from '../src/lesson/library';
import { ladder } from '../src/pilot/ladder';

const SPEED = ['speed-1', 'speed-2', 'speed-3', 'speed-4'];
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../evidence/ear-pilot/${name}`, import.meta.url), 'utf8'));
const hum = read('2026-11-15-speed-lessons-hum.json') as { attendHum: boolean; line: string; budget: string; results: { lessonId: string; medianTopMps: number }[] };
const atCap = read('2026-11-15-speed-lessons-at-cap.json') as { lessons: Record<string, { capMps: number; timesS: number[] }> };

describe('speed lessons', () => {
    it('follow the ring course on the full path, slow to fast, with the line and the budget on', () => {
        const full = lessonPaths().full;
        const at = full.indexOf('rings-course');
        expect(full.slice(at + 1, at + 1 + SPEED.length)).toEqual(SPEED);
        const caps = SPEED.map((id) => getLesson(id).assists.maxSpeedMps);
        for (let i = 1; i < caps.length; i++) expect(caps[i] as number).toBeGreaterThan(caps[i - 1] as number);
        for (const id of SPEED) {
            const l = getLesson(id);
            expect(l.layers.racingLine, id).toBe(true);
            expect(l.layers.speedBudget, id).toBe(true);
            expect(l.pass.maxTouches, id).toBe(0);
        }
    });

    it('cap each lesson at most at the ear pilot median / 1.25 and give it 1.5 x its time at the cap', () => {
        expect([hum.attendHum, hum.line, hum.budget]).toEqual([true, 'on', 'on']);
        for (const id of SPEED) {
            const l = getLesson(id);
            const r = hum.results.find((x) => x.lessonId === id);
            expect(r, id).toBeDefined();
            expect(l.assists.maxSpeedMps * 1.25, id).toBeLessThanOrEqual(r?.medianTopMps as number);
            const c = atCap.lessons[id];
            expect(c?.capMps, id).toBe(l.assists.maxSpeedMps);
            expect(l.attemptLimitS, id).toBe(Math.ceil(Math.max(...(c?.timesS ?? [Infinity])) * 1.5));
        }
    });

    it('are flown to their end by the ear pilot at the cap within the lesson time', () => {
        for (const id of SPEED) {
            const l = getLesson(id);
            const r = ladder(l, [1], [l.assists.maxSpeedMps], { hearing: { attendHum: true }, budget: true, line: true });
            const f = r.flights[0];
            expect(f?.passed, `${id} ${f?.why}`).toBe(true);
            expect(f?.timeS as number, id).toBeLessThan(l.attemptLimitS as number);
        }
    });
});
