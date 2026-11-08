// M41-7: progress always known. After every attempt that does not pass the lesson the pilot hears
// "Attempt k. Counted m of r."; on I (and on the host's large panel) the progress view: lesson k of n
// on the pilot's path, step k of N, attempt, counted m of r, phase.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunnerAction } from '../src/lesson';
import { createLessonRunner, getLesson, lessonPaths, statusLine, type V012PassRule } from '../src/lesson';
import { createTranslator, DICTS } from '../src/i18n';
import { ScriptedPilot } from './helpers/pilot';

type Say = Extract<RunnerAction, { kind: 'say' }>;
const progressLines = (p: ScriptedPilot): Say['line'][] => p.actions.filter((a): a is Say => a.kind === 'say' && a.line.key === 'fly.progress').map((a) => a.line);

/** rings-first: beside the ring, then through it three times */
function ringsFirst(options = {}): ScriptedPilot {
    const p = new ScriptedPilot(getLesson('rings-first'), options);
    p.begin();
    const miss = (): void => {
        p.flyTo([1.9, 3, 66]);
        p.flyTo([1.9, 3, 55]);
    };
    const through = (): void => {
        p.flyTo([0, 3, 64]);
        p.flyTo([0, 3, 56]);
    };
    for (const fly of [miss, through, through, through]) {
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 60);
        if (p.run.phase === 'passed') break;
        fly();
        p.until(() => p.run.phase !== 'flying', 10);
    }
    return p;
}

describe('the progress line after every attempt (M41-7)', () => {
    it('says the attempt and the count after each attempt, and the pass line instead after the one that passes', () => {
        const p = ringsFirst();
        expect(p.results()).toBe('FPPP');
        expect(progressLines(p).map((l) => l.params)).toEqual([
            { n: 1, counted: 0, required: 3 },
            { n: 2, counted: 1, required: 3 },
            { n: 3, counted: 2, required: 3 }
        ]);
        const keys = p.said();
        // after the last attempt: the pass line and what comes next, no count
        expect(keys.slice(-2)).toEqual(['lesson.rings-first.pass', 'fly.lesson-passed']);
        expect(keys.lastIndexOf('fly.progress')).toBeLessThan(keys.lastIndexOf('lesson.rings-first.pass'));
        // the line itself, in every language
        for (const locale of ['en', 'es', 'pl', 'ru'] as const) expect(createTranslator(locale, DICTS).text({ key: 'fly.progress', params: { n: 2, counted: 1, required: 3 } })).toMatch(/2.*1.*3/);
    }, 60000);

    it('control: the v0.12 rule says no count after an attempt', () => {
        const v012 = (JSON.parse(readFileSync(new URL('./fixtures/v012-pass-rules.json', import.meta.url), 'utf8')) as { rules: Record<string, V012PassRule> }).rules['rings-first'] as V012PassRule;
        const p = ringsFirst({ testHooks: { passRule: v012 } });
        expect(p.results()).toBe('FPPP');
        expect(progressLines(p)).toEqual([]);
    }, 60000);
});

describe('the progress view (I and the host panel)', () => {
    it('places a flying lesson on the pilot\'s path, and follows its step, attempt, goal and count', () => {
        const full = lessonPaths().full;
        const run = createLessonRunner(getLesson('hover-height'), { path: 'fast' });
        run.begin(0);
        let v = run.view();
        expect(v).toMatchObject({ lessonId: 'hover-height', lessonIndex: 2, lessonCount: lessonPaths().fast.length, path: 'fast', step: 1, steps: 2, stepKind: 'task', attempt: 0, counted: 0, required: 3, phase: 'intro' });
        // a lesson that is not on the pilot's path is placed on the full ladder
        expect(createLessonRunner(getLesson('hover-turn'), { path: 'fast' }).view()).toMatchObject({ lessonIndex: full.indexOf('hover-turn') + 1, lessonCount: full.length, path: 'full' });
        const p = new ScriptedPilot(getLesson('corridor'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        v = p.run.view();
        expect(v).toMatchObject({ step: 2, steps: 2, stepKind: 'fly', goal: 1, goals: 2, attempt: 1, counted: 0, required: 1, failsInARow: 0, offered: false });
        p.flyTo([0, 2, -52]);
        expect(p.run.view().goal).toBe(2);
    });

    it('counts the failures in a row and says when the offer to go on was made', () => {
        const p = new ScriptedPilot(getLesson('hover-height'));
        p.begin();
        p.until(() => p.run.view().failsInARow === 2, 400);
        expect(p.run.view()).toMatchObject({ failsInARow: 2, offered: false, attempt: 2 });
        p.until(() => p.run.view().failsInARow === 3, 200);
        expect(p.run.view()).toMatchObject({ failsInARow: 3, offered: true });
    }, 60000);

    it('gives every lesson without a world its steps: the intro, then each sound, scene, trial or round', () => {
        const counts: Record<string, number> = { 'ears-headphones': 1 + 3, 'ears-glossary': 1 + 20, 'ears-walls': 1 + 5, 'ears-shapes': 1 + 3, 'ears-game': 1 + 8 };
        for (const [id, steps] of Object.entries(counts)) {
            const p = new ScriptedPilot(getLesson(id));
            p.answerer = () => 1;
            // the pilot speaks every line at once: the intro is over as soon as it began, so it is seen before
            const seen: number[] = [p.run.view().step];
            const kinds = new Set<string>([p.run.view().stepKind]);
            p.begin();
            p.until(() => {
                const v = p.run.view();
                if (seen.at(-1) !== v.step) seen.push(v.step);
                kinds.add(v.stepKind);
                return p.run.phase !== 'intro' && p.run.phase !== 'flying';
            }, 1800);
            expect(p.run.view().steps, id).toBe(steps);
            expect(seen, id).toEqual(Array.from({ length: steps }, (_, i) => i + 1));
            expect(kinds.has('intro'), id).toBe(true);
        }
    }, 120000);

    it('says the view in one line, in the pilot\'s language', () => {
        const ru = createTranslator('ru', DICTS);
        const title = ru.text(getLesson('hover-height').title);
        const run = createLessonRunner(getLesson('hover-height'), { locale: 'ru' });
        run.begin(0);
        expect(run.statusLine()).toEqual({ key: 'status.progress-step', params: { title, lesson: 6, lessons: 21, step: 1, steps: 2 } });
        const p = new ScriptedPilot(getLesson('hover-height'), { locale: 'ru' });
        p.begin();
        p.until(() => p.run.attempt === 2 && p.run.phase === 'flying', 400);
        const line = p.run.statusLine();
        expect(line.key).toBe('status.progress');
        // the Russian line, as the locale file has it: the title in Russian and the numbers in their places
        expect(ru.text(line)).toBe((DICTS.ru['status.progress'] as string).replace('{lesson}', '6').replace('{lessons}', '21').replace('{title}', title).replace('{step}', '2').replace('{steps}', '2').replace('{n}', '2').replace('{counted}', '0').replace('{required}', '3'));
        expect(ru.text(line)).toContain(title);
        expect(createTranslator('en', DICTS).text(statusLine(p.run.view(), 'Hold your height'))).toBe('Lesson 6 of 21: Hold your height. Step 2 of 2. Attempt 2. Counted 0 of 3.');
    }, 60000);
});
