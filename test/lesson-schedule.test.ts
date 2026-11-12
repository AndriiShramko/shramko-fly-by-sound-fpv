// M41-5 and M41-9: "the voice says press 1, press 2, but there is no sound". Each lesson is played by a
// model host (src/lesson/schedule.ts) with a speech queue whose lines take as long as a voice says them:
// the runner's own estimate, faster and slower voices, and the measured lengths of real ones: the local
// Windows voice of each language at rate 1 (test/fixtures/tts-en-david.json, Microsoft David; since lane
// s13-elev E2-1 also tts-es-helena.json, tts-pl-paulina.json, tts-ru-irina.json). The schedule says when
// each line was said and each sound played; checkSchedule asks what a pilot would ask. The engine ducks
// every layer by 12 dB while a line is queued or spoken, so a sound under speech is a sound not heard.
// What this cannot show: how loud a sound is at the ear, or whether a person notices it (the render
// proofs of lane s13-sound measure the audio; how it feels is for people).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LessonDef, Locale } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { createLessonRunner, getLesson, REPEAT_PLAYS, SHIPPED_LESSON_IDS, validateLesson, type DemoScene, type Question } from '../src/lesson';
import { checkSchedule, estimateSpeech, lessonSchedule, measuredSpeech, NAMED_SOUND_PLAYS, speechOverlapMs, type Schedule, type ScheduleOptions } from '../src/lesson/schedule';
import { getBuiltinTheme } from '../src/theme';

const measuredFixture = (name: string): Record<string, number> => (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { seconds: Record<string, number> }).seconds;
const david = measuredFixture('tts-en-david.json');
/**
 * The other languages' local Windows voices (lane s13-elev E2-1), every line without parameters measured with
 * test/fixtures/measure-tts.ps1 the way the English one was: Microsoft Helena Desktop (es-ES), Paulina Desktop (pl-PL)
 * and Irina Desktop (ru-RU), SAPI rate 0.
 */
const OTHER_VOICES: Readonly<Record<Exclude<Locale, 'en'>, { readonly name: string; readonly seconds: Readonly<Record<string, number>> }>> = {
    es: { name: 'Microsoft Helena', seconds: measuredFixture('tts-es-helena.json') },
    pl: { name: 'Microsoft Paulina', seconds: measuredFixture('tts-pl-paulina.json') },
    ru: { name: 'Microsoft Irina', seconds: measuredFixture('tts-ru-irina.json') }
};
const OTHER_LOCALES = ['es', 'pl', 'ru'] as const;
/**
 * The English of lines measured above whose text changed since (lane s13-worlds, review M5 and m3: the first room is
 * small, module 4 holds the tunnels): a measured length belongs to the text that was measured.
 */
const MEASURED_TEXT: Readonly<Record<string, string>> = {
    'module.4.name': 'Corridor',
    'lesson.walls-hall.title': 'The big hall',
    'lesson.walls-hall.intro.1': 'You are in a big, empty hall. The walls, the floor and the ceiling make knocks, thuds and puffs when you come near.'
};
const EARS = ['ears-headphones', 'ears-glossary', 'ears-walls', 'ears-shapes', 'ears-game'] as const;

/** the right answers: the headphone check (left, right, left), the game (what the scene was, where, whether it moved) */
function truthAnswer(lesson: LessonDef): (q: Question, scene: DemoScene | null) => number {
    const names = lesson.goals.find((g) => g.kind === 'name-cues');
    const cues = names?.kind === 'name-cues' ? names.cues : [];
    const sides = [
        [-1, 0, 0],
        [1, 0, 0],
        [0, 0, -1],
        [0, 0, 1]
    ];
    return (q, s) => {
        if (q.id.endsWith(':side')) return Number(q.id.split(':')[2]) % 2 === 1 ? 1 : 2;
        if (s === null) return 1;
        if (q.id.endsWith(':what')) return cues.indexOf(s.cue) + 1;
        if (q.id.endsWith(':where')) return sides.findIndex((d) => d[0] === s.dir[0] && d[2] === s.dir[2]) + 1;
        return s.moving ? 1 : 2;
    };
}

const VOICES: Readonly<Record<string, ScheduleOptions['speech']>> = {
    'fast (0.6 x the estimate)': estimateSpeech(0.6),
    'the estimate': estimateSpeech(1),
    'measured (Microsoft David)': measuredSpeech(david),
    'slow (1.4 x, 0.3 s to start each line)': estimateSpeech(1.4, 0.3),
    'very slow (2 x, 0.6 s to start each line)': estimateSpeech(2, 0.6)
};

const schedule = (id: string, o: ScheduleOptions = {}): Schedule => {
    const lesson = getLesson(id);
    return lessonSchedule(lesson, { answer: truthAnswer(lesson), ...o, runner: { seed: 3, ...o.runner } });
};
const rules = (s: Schedule, id: string): string[] => checkSchedule(s, getLesson(id)).map((i) => i.rule);

describe('every named sound plays three times with no speech over it, and every question comes after its sound', () => {
    it('in every shipped lesson (the ears lessons whole, the task of every flying lesson), with fast, measured and slow voices, answers early or late', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            for (const [voice, speech] of Object.entries(VOICES)) {
                for (const answerTiming of ['after', 'early'] as const) {
                    const s = schedule(id, { speech, answerTiming });
                    const issues = checkSchedule(s, getLesson(id));
                    expect(issues.map((i) => i.detail), `${id}, ${voice}, answers ${answerTiming}`).toEqual([]);
                    if (getLesson(id).world.kind === 'none') expect(s.phase, `${id} ends`).toBe('passed');
                }
            }
        }
    }, 600000);

    it('in Spanish, Polish and Russian too, each lesson in its language with that language\'s measured voice, answers early or late (lane s13-elev E2-1)', () => {
        for (const locale of OTHER_LOCALES) {
            const speech = measuredSpeech(OTHER_VOICES[locale].seconds);
            for (const id of SHIPPED_LESSON_IDS) {
                for (const answerTiming of ['after', 'early'] as const) {
                    const s = schedule(id, { locale, speech, answerTiming });
                    expect(checkSchedule(s, getLesson(id)).map((i) => i.detail), `${id}, ${locale} (${OTHER_VOICES[locale].name}), answers ${answerTiming}`).toEqual([]);
                    if (getLesson(id).world.kind === 'none') expect(s.phase, `${id} ends in ${locale}`).toBe('passed');
                }
            }
        }
    }, 600000);

    it('plays each sound of a step three times, a second apart, and the step goes on a second after the last', () => {
        const s = schedule('ears-glossary', { speech: measuredSpeech(david) });
        const plays = s.plays.filter((p) => p.kind === 'repeat-cue' && p.step === 2);
        expect(plays.map((p) => [p.cue, p.index, p.of])).toEqual([
            ['safety.wall', 1, 3],
            ['safety.wall', 2, 3],
            ['safety.wall', 3, 3]
        ]);
        expect(((plays[1]?.start ?? 0) - (plays[0]?.end ?? 0)) / 1000).toBeCloseTo(1, 1);
        const next = s.speech.find((l) => l.start > (plays[2]?.end ?? 0));
        expect(((next?.start ?? 0) - (plays[2]?.end ?? 0)) / 1000).toBeGreaterThanOrEqual(0.95);
        // the hum of the headphone check comes from its side all three times, the question after the third
        const h = schedule('ears-headphones', { speech: measuredSpeech(david) });
        const first = h.plays.filter((p) => p.step === 2);
        expect(first).toHaveLength(3);
        expect(h.asks[0]?.linesStart).toBeGreaterThan(first[2]?.end ?? Infinity);
        // a flying lesson's task: each sound its line names, three times after the line (the target note since the merge's review M2)
        const task = schedule('hover-height', { speech: measuredSpeech(david) });
        expect(task.plays.map((p) => p.cue)).toEqual(['height.tone', 'height.tone', 'height.tone', 'height.rough', 'height.rough', 'height.rough', 'height.target', 'height.target', 'height.target']);
        const line = task.speech.find((l) => l.key === 'lesson.hover-height.intro.2');
        expect(task.plays[0]?.start).toBeGreaterThanOrEqual(line?.end ?? Infinity);
        const target = task.speech.find((l) => l.key === 'lesson.hover-height.intro.3');
        expect(target?.start).toBeGreaterThanOrEqual(task.plays[5]?.end ?? Infinity);
        expect(task.plays[6]?.start).toBeGreaterThanOrEqual(target?.end ?? Infinity);
    }, 60000);
});

describe('control: the v0.12 timing fails the same check (a line ends at the earlier of the report and the estimate, a sound starts at once, once)', () => {
    const v012 = { seed: 3, testHooks: { speechWait: 'v012' as const } };

    it('with the measured voice the sounds play under speech in the headphone check, the glossary and the game', () => {
        for (const id of ['ears-headphones', 'ears-glossary', 'ears-game']) {
            const s = schedule(id, { speech: measuredSpeech(david), runner: v012 });
            expect(rules(s, id), id).toContain('under-speech');
        }
        // "press 1, press 2": with a slower voice the first question of the check comes with no sound heard before it
        const slow = schedule('ears-headphones', { speech: estimateSpeech(1.4, 0.3), runner: v012 });
        const issues = checkSchedule(slow, getLesson('ears-headphones'));
        expect(issues.filter((i) => i.rule === 'question-without-sound').length).toBeGreaterThan(0);
    }, 120000);

    it('and with the measured voice of each other language, in its language (lane s13-elev E2-1)', () => {
        for (const locale of OTHER_LOCALES) {
            for (const id of ['ears-headphones', 'ears-glossary', 'ears-game']) {
                const s = schedule(id, { locale, speech: measuredSpeech(OTHER_VOICES[locale].seconds), runner: v012 });
                expect(rules(s, id), `${id}, ${locale}`).toContain('under-speech');
            }
        }
    }, 120000);

    it('the defect needs speech slower than the estimate: with a fast voice v0.12 overlaps nothing, but plays each sound once', () => {
        for (const id of EARS) {
            const s = schedule(id, { speech: estimateSpeech(0.6), runner: v012 });
            const r = rules(s, id);
            expect(r.filter((x) => x === 'under-speech'), id).toEqual([]);
            expect(r, id).toContain('not-repeated');
        }
    }, 120000);

    it("two plays of each named sound instead of three fail the repeat rule in every ears lesson (it does not follow the runner's own number, review R10)", () => {
        expect(REPEAT_PLAYS).toBe(NAMED_SOUND_PLAYS);
        for (const id of EARS) {
            const s = schedule(id, { speech: measuredSpeech(david) });
            const two = { ...s, plays: s.plays.filter((p) => p.index === null || p.index < 3) };
            expect(rules(s, id), id).not.toContain('not-repeated');
            expect(rules(two, id), id).toContain('not-repeated');
        }
    }, 120000);

    it('the fact as measured: 276 of the 393 English lines take the Windows voice longer than the estimate', () => {
        const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
        const keys = Object.keys(david);
        const longer = keys.filter((k) => (david[k] as number) > 0.7 + 0.065 * (MEASURED_TEXT[k] ?? (en[k] as string)).length);
        expect(keys.length).toBe(393);
        // 262 until merge s13-merge reworded walls-hall's intro.2 and hint.1 and the corridor's intro.2 (review m4 of
        // lane s13-sound); those three were measured again with the same voice and method (walls-hall's intro.1, not
        // changed then, measured 8.64 s again, as in the fixture). walls-hall's goal.1, reworded at the s13-worlds merge
        // for its 1.5 m stop, was measured again the same way (3.975 s; it is not longer than the estimate, nor was its
        // old text). 263 until the checkpoint chime's glossary line was reworded at that merge (item 8e: "One chime from
        // low to high, only once, ..."), measured again too: 5.175 s, longer than its estimate (5.055 s), where the old
        // line (3.295 s) was shorter. The lines lane s13-worlds reworded after they were measured are taken with the
        // text that was measured (MEASURED_TEXT). 376 lines and 264 longer until the merge's review M2 added three lines
        // that name the target note, measured the same way: hover-height's intro.3 7.715 s (longer than its estimate,
        // 7.395 s), rings-heights' intro.2 7.34 s and hint.1 5.62 s (shorter than theirs). Then review M3 and m1 made the
        // corridor's intro.3 the open-way chime's line (11.455 s, shorter than its estimate of 11.685 s; the checkpoint line
        // it replaced, 6.755 s, was 0.01 s longer than its own) and its intro.4 the stages and the reset (9.64 s, longer
        // than 9.02 s): 380 lines, 265 longer. Lane s13-elev added the setting of up and down by direction, measured the
        // same way: its name 2.33 s (its estimate 2.39 s) and its description 13.275 s (14.09 s): 382 lines, 265 longer.
        // Then its words for the chime above and below (from above or below, not from ahead): the glossary's line 18.07 s
        // (longer than its estimate, 16.17 s), the corridor's intro.3 again 16.035 s (longer than 15.195 s; its text before
        // was not), tunnel-gaps' intro.3 10.23 s (11.035 s) and walls-pillar's new intro.3 6.41 s (7.655 s): 385, 267 longer.
        // Its review E2 made the lines hold with the setting off (the way by its pitch, from above or below only with the
        // setting's name), measured again the same way: the glossary's line 18.425 s (its estimate 16.04 s), the
        // corridor's intro.3 15.375 s (14.09 s), tunnel-gaps' intro.3 11.705 s (11.23 s) and the setting's description
        // 16.215 s (15.845 s), the last two not longer than their estimates before: 385, 269 longer.
        // The fix of sonic-keys' review I3 added "Press 1, 2 or 3." (answer.need-123), 2.635 s (its estimate 1.74 s): 391, 275.
        // Lane sonic-beacon added the setting 'Target hum shows the way', measured the same way (2026-11-12): its name 2.21 s and
        // its description 14.995 s, one of them longer than its estimate: 393, 276.
        expect(longer.length).toBe(276);
        // and under v0.12 the first sound of the check plays partly under the line before it
        const s = schedule('ears-headphones', { speech: measuredSpeech(david), runner: v012 });
        const first = s.plays.find((p) => p.kind !== 'one-off');
        expect(speechOverlapMs(s, first?.start ?? 0, first?.end ?? 0)).toBeGreaterThan(500);
    });

    it('the fact as measured in the other languages: 261 of the 479 Spanish lines, 351 of the 479 Polish and all 479 Russian take their voice longer than the estimate (lane s13-elev E2-1)', () => {
        // Each fixture holds every line of its language that has no parameters, measured on 2026-11-08 with the
        // voice's text as it is in locales/ (no line reworded since, so no MEASURED_TEXT here). None is longer than
        // the runner's fallback (twice the estimate and a second): the longest against its estimate is 1.59 times it
        // in Spanish, 1.50 in Polish and 1.84 in Russian, whose voice is the slowest (a median 1.30 times the estimate).
        // The four lines review E2 of the lane reworded (the glossary's chime, the corridor's and tunnel-gaps' intro.3,
        // the setting's description) were measured again the same way; tunnel-gaps' intro.3 is now longer than its
        // estimate in Spanish (12.005 s, 11.815 s) and Polish (12.96 s, 12.075 s): 253 and 342 before.
        // sonic-keys added five lines without parameters (answer.skipped, answer.not-now, answer.timeout, the answer sound's name
        // and glossary) and reworded the headphone check's intro.2, all measured with the same voices and method. The fix of its
        // review I3 added answer.need-123 ("1, 2 or 3"), longer than its estimate in all three: es 3.205 s, pl 3.42 s, ru 3.51 s.
        // Lane sonic-beacon added the setting's name and description (2026-11-12, same voices and method): es 2.51 s and 15.62 s
        // (neither longer than its estimate), pl 2.58 s and 15.6 s (both longer), ru 2.79 s and 17.945 s (both longer).
        const longerThanEstimate: Readonly<Record<Exclude<Locale, 'en'>, number>> = { es: 261, pl: 351, ru: 479 };
        for (const locale of OTHER_LOCALES) {
            const dict = JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
            const seconds = OTHER_VOICES[locale].seconds;
            const plain = Object.keys(dict).filter((k) => !(dict[k] as string).includes('{'));
            expect(Object.keys(seconds).sort(), `${locale}: every line without parameters is measured, and nothing else`).toEqual(plain.sort());
            expect(plain.length, locale).toBe(479);
            const estimate = (k: string): number => 0.7 + 0.065 * (dict[k] as string).length;
            const longer = plain.filter((k) => (seconds[k] as number) > estimate(k));
            expect(longer.length, `${locale}: lines longer than the estimate`).toBe(longerThanEstimate[locale]);
            expect(plain.filter((k) => (seconds[k] as number) > 2 * estimate(k) + 1), `${locale}: lines longer than the runner waits`).toEqual([]);
        }
    });
});

describe('every scene of module 0 is heard: the planner sounds its cue with the lesson\'s layers', () => {
    /** the share of a scene's frames in which the planner sounds the scene's cue, for each scene play of the lesson */
    function sceneShares(id: string, layers = getLesson(id).layers): number[] {
        const lesson = getLesson(id);
        const run = createLessonRunner(lesson, { seed: 3 });
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers });
        const shares: number[] = [];
        let frames = 0;
        let heard = 0;
        let cue: string | null = null;
        const answer = truthAnswer(lesson);
        let scene: DemoScene | null = null;
        run.begin(0);
        for (let t = 0; t < 1_200_000 && run.phase !== 'passed'; t += 33) {
            run.step({ t, tick: t, pos: lesson.start.pos, vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false }, null);
            for (const a of run.takeActions()) {
                if (a.kind === 'say') run.spoken(t);
                if (a.kind === 'scene') {
                    if (a.scene === null && cue !== null) {
                        shares.push(heard / Math.max(frames, 1));
                        cue = null;
                    } else if (a.scene !== null) {
                        scene = a.scene;
                        cue = a.scene.cue;
                        frames = 0;
                        heard = 0;
                    }
                }
                if (a.kind === 'ask') run.answer(answer(a.question, scene), 'key', t);
            }
            const input = run.demoFrame(t);
            if (input !== null && cue !== null) {
                frames++;
                const ids = planner.plan(input).cues.map((c) => c.id.split(':')[0]);
                if (ids.includes(cue)) heard++;
            }
        }
        return shares;
    }

    it('in every frame of every scene of ears-walls, ears-shapes and ears-game', () => {
        for (const id of ['ears-walls', 'ears-shapes', 'ears-game']) {
            const shares = sceneShares(id);
            expect(shares.length, id).toBeGreaterThanOrEqual(9);
            expect(Math.min(...shares), id).toBeGreaterThanOrEqual(0.9);
        }
    }, 120000);

    it('control: with the layer that plays it off, a scene sounds nothing, and the lesson loader refuses such a lesson', () => {
        const shapes = getLesson('ears-shapes');
        const off = { ...shapes.layers, on: shapes.layers.on.filter((l) => l !== 'shape') };
        expect(Math.max(...sceneShares('ears-shapes', off))).toBe(0);
        const file = JSON.parse(readFileSync(new URL('../lessons/ears-shapes.json', import.meta.url), 'utf8')) as Record<string, unknown>;
        const r = validateLesson({ ...file, layers: { ...(file['layers'] as object), on: ['voice'] } });
        expect(r.ok).toBe(false);
        expect(r.ok ? [] : r.issues.map((i) => i.path)).toContain('layers');
        const walls = JSON.parse(readFileSync(new URL('../lessons/ears-walls.json', import.meta.url), 'utf8')) as Record<string, unknown>;
        const silent = validateLesson({ ...walls, layers: { ...(walls['layers'] as object), hazardVoices: 0 } });
        expect(silent.ok ? [] : silent.issues.map((i) => i.message).join(' ')).toMatch(/hazard voice/);
        for (const id of EARS) expect(validateLesson(JSON.parse(readFileSync(new URL(`../lessons/${id}.json`, import.meta.url), 'utf8'))).ok, id).toBe(true);
    }, 120000);
});

describe('how long the ears lessons take now (measured voice, answers a second after each question)', () => {
    it('stays within a few minutes per lesson', () => {
        const minutes: Record<string, number> = {};
        for (const id of EARS) minutes[id] = Math.round(schedule(id, { speech: measuredSpeech(david) }).endT / 6000) / 10;
        // the glossary names every sound, 26 since the s13-worlds merge (item 8f), three plays each: 8.4 minutes with the
        // measured voice (2026-11-08)
        expect(minutes['ears-glossary']).toBeLessThan(9);
        expect(minutes['ears-game']).toBeLessThan(10);
        expect(minutes['ears-headphones']).toBeLessThan(3);
        expect(minutes['ears-walls']).toBeLessThan(3);
        expect(minutes['ears-shapes']).toBeLessThan(2);
    }, 120000);

    it('and in the other languages, with their measured voices (lane s13-elev E2-1)', () => {
        // measured 2026-11-08: the glossary 8.6 minutes in Spanish, 8.8 in Polish and 9.9 in Russian (Irina says the
        // lines 1.3 times as slowly as the runner estimates); the game 6.9, 7.5 and 8.0; the other three as in English
        // but for the Russian headphone check (2.2) and walls (2.1)
        const glossaryUnder: Readonly<Record<Exclude<Locale, 'en'>, number>> = { es: 9.5, pl: 9.5, ru: 10.5 };
        for (const locale of OTHER_LOCALES) {
            const minutes: Record<string, number> = {};
            for (const id of EARS) minutes[id] = Math.round(schedule(id, { locale, speech: measuredSpeech(OTHER_VOICES[locale].seconds) }).endT / 6000) / 10;
            expect(minutes['ears-glossary'], locale).toBeLessThan(glossaryUnder[locale]);
            expect(minutes['ears-game'], locale).toBeLessThan(10);
            expect(minutes['ears-headphones'], locale).toBeLessThan(3);
            expect(minutes['ears-walls'], locale).toBeLessThan(3);
            expect(minutes['ears-shapes'], locale).toBeLessThan(2);
        }
    }, 120000);
});
