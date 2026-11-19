// The quick first lesson (simulator lane sound6, owner 2026-11-19): in headphones that do not follow the head a sound in
// front and a sound behind sound the same, so no lesson asks the pilot to tell them apart, and no lesson teaches it.
import { describe, expect, it } from 'vitest';
import type { LessonDef, Vec3 } from '../src/contract';
import { DICTS } from '../src/i18n';
import { getLesson, SHIPPED_LESSON_IDS, TURN_OFFSETS, type DemoScene, type Question } from '../src/lesson';
import { lessonSchedule } from '../src/lesson/schedule';
import { createAnalyticWorld } from '../src/world/analytic-world';

/** keys that name or ask a place in front or behind */
const FRONT_BACK_KEYS = /^(dir\.front|dir\.back|headphones\.q-front-back)/;

/** answers every question right where it can (left 1, right 2), else 1 */
function answerOf(lesson: LessonDef, dirs: Vec3[]): (q: Question, scene: DemoScene | null) => number {
    const names = lesson.goals.find((g) => g.kind === 'name-cues');
    const cues = names?.kind === 'name-cues' ? names.cues : [];
    return (q, s) => {
        if (s !== null) dirs.push(s.dir);
        if (q.id.endsWith(':side')) return Number(q.id.split(':')[2]) % 2 === 1 ? 1 : 2;
        if (s === null) return 1;
        if (q.id.endsWith(':what')) return cues.indexOf(s.cue) + 1;
        if (q.id.endsWith(':where')) return s.dir[0] < 0 ? 1 : 2;
        return s.moving ? 1 : 2;
    };
}

describe('no lesson asks or tells front against behind', () => {
    it.each(SHIPPED_LESSON_IDS.map((id) => [id]))('%s: its script before the flight says no front/behind line, asks where with 2 options', (id) => {
        const lesson = getLesson(id);
        for (const attempt of [1, 2]) {
            const dirs: Vec3[] = [];
            const s = lessonSchedule(lesson, { answer: answerOf(lesson, dirs), runner: { seed: attempt } });
            expect(s.speech.map((l) => l.key).filter((k) => FRONT_BACK_KEYS.test(k))).toEqual([]);
            for (const a of s.asks.filter((q) => q.id.endsWith(':where'))) expect(a.options).toBe(2);
            // every scene of a question comes from the left or the right, never from ahead or behind
            for (const d of dirs) expect(Math.abs(d[0])).toBeGreaterThan(Math.abs(d[2]));
        }
    });

    it('the where question says only left and right, in every language', () => {
        for (const loc of ['en', 'es', 'pl', 'ru'] as const) {
            const t = String(DICTS[loc]['quiz.where-options']);
            expect(t).toMatch(/1/);
            expect(t).toMatch(/2/);
            expect(t).not.toMatch(/3/);
        }
    });

    it('turn-listen and shapes-cube teach no front against behind (en texts)', () => {
        const t = (k: string): string => String(DICTS.en[k]);
        const keys = [
            'lesson.turn-listen.intro.1',
            'lesson.turn-listen.intro.2',
            'lesson.turn-listen.pass',
            'lesson.turn-listen.hint.1',
            'reason.turn-behind',
            'lesson.shapes-cube.intro.1',
            'lesson.shapes-cube.intro.2',
            'lesson.shapes-cube.hint.1',
            'cue.shape.cube.glossary'
        ];
        for (const k of keys) expect(t(k), k).not.toMatch(/front|behind|back/i);
    });

    it('turn-listen: the hum of its intro comes from the side where the ring really is on the first attempts', () => {
        const lesson = getLesson('turn-listen');
        const cue = lesson.intro.flatMap((l) => l.cues ?? []).find((c) => typeof c !== 'string');
        expect(typeof cue === 'string' ? null : cue?.from).toBe('right');
        if (lesson.world.kind !== 'analytic') throw new Error('turn-listen is an analytic world');
        const w = createAnalyticWorld(lesson.world.spec);
        const ring = w.objects().find((o) => o.id === 'ring-1');
        if (ring === undefined) throw new Error('no ring-1');
        const p = lesson.start.pos;
        const bearing = (Math.atan2(ring.pos[0] - p[0], -(ring.pos[2] - p[2])) * 180) / Math.PI;
        const off = (yaw: number): number => ((((bearing - yaw) % 360) + 540) % 360) - 180;
        // attempt 1 on the right, attempt 2 on the left: never behind
        expect(off(lesson.start.yawDeg + (TURN_OFFSETS[0] as number))).toBeGreaterThan(60);
        expect(off(lesson.start.yawDeg + (TURN_OFFSETS[0] as number))).toBeLessThan(120);
        expect(off(lesson.start.yawDeg + (TURN_OFFSETS[1] as number))).toBeLessThan(-60);
        expect(off(lesson.start.yawDeg + (TURN_OFFSETS[1] as number))).toBeGreaterThan(-120);
    });
});
