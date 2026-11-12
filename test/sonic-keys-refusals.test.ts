// Review I1, I2, I3 of sonic-keys (gsfpv-v03 docs/wip/sonic-keys-review.md) and the caveat to its claim 2: a digit that
// answers nothing gets the "no" sound at once and one word, which
//  - never piles up: a newer refusal replaces the word not yet said, and a run of the lesson's own speech is held back by
//    one such word at most, however often the pilot presses (I1);
//  - never makes a recording disagree with its replay: the word is outside the lesson's own speech, so the runner's
//    clocks (the reminders, when a sound starts) do not move with it (I2);
//  - says the keys during the headphone check's trial sound, where 1 to 3 are taken (I3);
//  - comes right after its sound when the lesson says nothing of its own, cutting a reminder or an earlier refusal (claim 2).
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../src/contract';
import { createTranslator, DICTS } from '../src/i18n';
import { getLesson } from '../src/lesson';
import { checkSession, formatReplayCheck } from '../src/replay';
import { RecordingHost } from './helpers/record';

const tr = createTranslator('en', DICTS);
/** how long the test host says a line, ms (its defaults: 300 and 45 per character) */
const sayMs = (key: string, params?: Record<string, string | number>): number => 300 + 45 * tr.text(params === undefined ? { key } : { key, params }).length;
const NOT_NOW_MS = sayMs('answer.not-now');

const attemptAt = (events: readonly SessionEvent[]): number => events.find((e) => e.kind === 'lesson' && e.what === 'attempt-start')?.t ?? Infinity;
const spoken = (h: RecordingHost, key: string): SessionEvent[] => h.events.filter((e) => e.kind === 'speech' && e.key === key);

/** The headphone check up to the start of its attempt, digits pressed at `presses` (ms after the lesson began). */
function intro(presses: readonly number[], value = 5, limitS = 120): RecordingHost {
    const h = new RecordingHost(getLesson('ears-headphones'), { answerer: () => 1, cutOnInterrupt: true });
    h.begin();
    const t0 = h.t;
    const queue = [...presses].sort((a, b) => a - b);
    h.until(() => {
        while (queue.length > 0 && h.t - t0 >= (queue[0] as number)) {
            queue.shift();
            h.digit(value);
        }
        return attemptAt(h.events) < Infinity && queue.length === 0;
    }, limitS);
    return h;
}

describe('I1: refusals do not pile up and do not hold the intro', () => {
    const base = attemptAt(intro([]).events);

    it('the intro of the headphone check ends (control)', () => {
        expect(base).toBeLessThan(Infinity);
    });

    it('three digits in 0.6 s during the intro: one word, the intro longer by one word at most', () => {
        const h = intro([2000, 2200, 2400]);
        expect(h.events.filter((e) => e.kind === 'speech' && e.key === 'answer.not-now' && e.t < attemptAt(h.events) + 1).length).toBe(1);
        expect(attemptAt(h.events)).toBeLessThanOrEqual(base + NOT_NOW_MS + 50);
    });

    it('a digit every 1.3 s for 400 s: the intro still ends, longer by one word at most', () => {
        const presses = Array.from({ length: Math.floor(400_000 / 1300) }, (_, i) => 1000 + i * 1300);
        const h = intro(presses, 5, 420);
        expect(attemptAt(h.events)).toBeLessThanOrEqual(base + NOT_NOW_MS + 50);
        // and the lesson goes on: the trials are asked, their sounds play
        expect(h.events.some((e) => e.kind === 'speech' && e.key === 'headphones.trial')).toBe(true);
    });
});

/** A recording of `lessonId` with digits `value(i)` pressed every `everyMs`. */
function pressed(lessonId: string, everyMs: number, value: (i: number) => number, seconds: number, answerAfterMs = 1200): RecordingHost {
    const h = new RecordingHost(getLesson(lessonId), { answerer: (q, i) => (i % q.options) + 1, answerAfterMs, cutOnInterrupt: true });
    h.begin();
    let next = h.t + everyMs;
    let i = 0;
    h.until(() => {
        if (h.t >= next) {
            h.digit(value(i++));
            next += everyMs;
        }
        return false;
    }, seconds);
    return h;
}

async function check(h: RecordingHost): Promise<{ readonly verdict: string; readonly line: string }> {
    const { pkg } = await h.toPackage();
    const { check: c } = checkSession(pkg);
    return { verdict: String(c.verdict), line: formatReplayCheck(c) };
}

describe('I2: a recording re-derives whatever digits are pressed', () => {
    it('a question waits 9 s for its answer and 9 is pressed in its 6th second: the replay passes (review I2)', async () => {
        const h = new RecordingHost(getLesson('ears-headphones'), { answerer: () => 1, answerAfterMs: 9000, cutOnInterrupt: true });
        h.begin();
        h.until(() => h.answerDue !== null, 120);
        const asked = (h.answerDue as number) - 9000;
        h.until(() => h.t >= asked + 6000, 20);
        h.digit(9);
        h.until(() => h.events.filter((e) => e.kind === 'answer').length >= 3 && h.answerDue === null, 200);
        h.hold(5);
        expect(spoken(h, 'answer.waiting').length).toBeGreaterThan(0);
        expect(spoken(h, 'answer.range').length).toBe(1);
        const { verdict, line } = await check(h);
        expect(verdict, line).toBe('pass');
    });

    it.each([
        ['ears-headphones', 1300],
        ['ears-headphones', 700],
        ['ears-game', 1300],
        ['ears-game', 2900]
    ])('%s with a digit every %i ms (4 to 9 and some answers among them): the replay passes', async (id, every) => {
        const h = pressed(id, every, (i) => [5, 9, 4, 2, 7, 0, 8, 6, 1, 3][i % 10] as number, 200, 4000);
        expect(h.events.some((e) => e.kind === 'answer')).toBe(true);
        expect(h.events.some((e) => e.kind === 'speech' && (e.key === 'answer.range' || e.key === 'answer.not-now' || e.key === 'answer.need-123'))).toBe(true);
        const { verdict, line } = await check(h);
        expect(verdict, line).toBe('pass');
    });
});

describe('I3 and claim 2: the word that fits, right after the sound', () => {
    /** The headphone check up to the first play of trial 1's sound. */
    function atTrialSound(): RecordingHost {
        const h = new RecordingHost(getLesson('ears-headphones'), { answerer: () => 1, cutOnInterrupt: true });
        h.begin();
        h.until(() => h.planner !== null && h.frames.some((f) => f.c.some((c) => c.startsWith('target'))), 120);
        return h;
    }

    it('7 during the trial\'s sound: "Press 1, 2 or 3", not "nothing to answer now", and said at once', () => {
        const h = atTrialSound();
        const t = h.t;
        h.digit(7);
        expect(h.events.filter((e) => e.kind === 'answer')).toEqual([]);
        const words = h.events.filter((e) => e.kind === 'speech' && e.t >= t && e.key !== 'speech.end').map((e) => e.kind === 'speech' && e.key);
        expect(words).toEqual(['answer.need-123']);
        // a 2 right after is still taken as trial 1's answer
        h.hold(0.1);
        h.digit(2);
        expect(h.events.filter((e) => e.kind === 'answer').map((e) => e.kind === 'answer' && e.value)).toEqual([2]);
    });

    it('a refusal while a reminder is said cuts the reminder; a second refusal cuts the first', () => {
        const h = new RecordingHost(getLesson('ears-headphones'), { answerer: () => 1, answerAfterMs: 15_000, cutOnInterrupt: true });
        h.begin();
        h.until(() => spoken(h, 'answer.waiting').length > 0, 160);
        const before = h.events.length;
        h.hold(0.5);
        h.digit(8);
        h.hold(0.3);
        h.digit(9);
        const t2 = h.t;
        h.until(() => h.events.slice(before).some((e) => e.kind === 'speech' && e.key === 'speech.end'), 30);
        const words = h.events.slice(before).filter((e) => e.kind === 'speech' && e.key.startsWith('answer.'));
        expect(words.map((e) => e.kind === 'speech' && e.key)).toEqual(['answer.range', 'answer.range']);
        // the queue runs empty one word after the second digit: the reminder and the first word were cut, not waited for
        const end = h.events.slice(before).find((e) => e.kind === 'speech' && e.key === 'speech.end') as SessionEvent;
        expect(end.t - t2).toBeLessThanOrEqual(sayMs('answer.range', { max: 3 }) + 40);
    });
});
