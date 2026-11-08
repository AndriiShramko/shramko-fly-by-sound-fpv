// M41-5 and M41-9: "the voice says press 1, press 2, but there is no sound". Each lesson is played by a
// model host (src/lesson/schedule.ts) with a speech queue whose lines take as long as a voice says them:
// the runner's own estimate, faster and slower voices, and the measured lengths of a real one
// (test/fixtures/tts-en-david.json, the Windows voice Microsoft David at rate 1). The schedule says when
// each line was said and each sound played; checkSchedule asks what a pilot would ask. The engine ducks
// every layer by 12 dB while a line is queued or spoken, so a sound under speech is a sound not heard.
// What this cannot show: how loud a sound is at the ear, or whether a person notices it (the render
// proofs of lane s13-sound measure the audio; how it feels is for people).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LessonDef } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { createLessonRunner, getLesson, REPEAT_PLAYS, SHIPPED_LESSON_IDS, validateLesson, type DemoScene, type Question } from '../src/lesson';
import { checkSchedule, estimateSpeech, lessonSchedule, measuredSpeech, NAMED_SOUND_PLAYS, speechOverlapMs, type Schedule, type ScheduleOptions } from '../src/lesson/schedule';
import { getBuiltinTheme } from '../src/theme';

const david = (JSON.parse(readFileSync(new URL('./fixtures/tts-en-david.json', import.meta.url), 'utf8')) as { seconds: Record<string, number> }).seconds;
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

/** the right answers: the headphone check (left, right, then behind), the game (what the scene was, where, whether it moved) */
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
        if (q.id.endsWith(':side')) return q.id.split(':')[2] === '1' ? 1 : 2;
        if (q.id.endsWith(':front-back')) return 2;
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
        // a flying lesson's task: each sound its line names, three times after the line
        const task = schedule('hover-height', { speech: measuredSpeech(david) });
        expect(task.plays.map((p) => p.cue)).toEqual(['height.tone', 'height.tone', 'height.tone', 'height.rough', 'height.rough', 'height.rough']);
        const line = task.speech.find((l) => l.key === 'lesson.hover-height.intro.2');
        expect(task.plays[0]?.start).toBeGreaterThanOrEqual(line?.end ?? Infinity);
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

    it('the fact as measured: 263 of the 376 English lines take the Windows voice longer than the estimate', () => {
        const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
        const keys = Object.keys(david);
        const longer = keys.filter((k) => (david[k] as number) > 0.7 + 0.065 * (MEASURED_TEXT[k] ?? (en[k] as string)).length);
        expect(keys.length).toBe(376);
        // 262 until merge s13-merge reworded walls-hall's intro.2 and hint.1 and the corridor's intro.2 (review m4 of
        // lane s13-sound); those three were measured again with the same voice and method (walls-hall's intro.1, not
        // changed then, measured 8.64 s again, as in the fixture). walls-hall's goal.1, reworded at the s13-worlds merge
        // for its 1.5 m stop, was measured again the same way (3.975 s; it is not longer than the estimate, nor was its
        // old text). The lines lane s13-worlds reworded after they were measured are taken with the text that was
        // measured (MEASURED_TEXT).
        expect(longer.length).toBe(263);
        // and under v0.12 the first sound of the check plays partly under the line before it
        const s = schedule('ears-headphones', { speech: measuredSpeech(david), runner: v012 });
        const first = s.plays.find((p) => p.kind !== 'one-off');
        expect(speechOverlapMs(s, first?.start ?? 0, first?.end ?? 0)).toBeGreaterThan(500);
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
        // the glossary has 20 sounds, three plays each; measured 2026-11-08
        expect(minutes['ears-glossary']).toBeLessThan(9);
        expect(minutes['ears-game']).toBeLessThan(10);
        expect(minutes['ears-headphones']).toBeLessThan(3);
        expect(minutes['ears-walls']).toBeLessThan(3);
        expect(minutes['ears-shapes']).toBeLessThan(2);
    }, 120000);
});
