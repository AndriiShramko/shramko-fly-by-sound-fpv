// M41-9: "the voice says press 1, press 2, but there is no sound". The ears lessons are played by a
// model host (src/lesson/schedule.ts) with a speech queue whose lines take as long as a real voice
// says them (test/fixtures/tts-en-david.json, the Windows voice Microsoft David at rate 1), and the
// schedule shows when each sound played against the speech. The engine ducks every layer by 12 dB
// while a line is queued or spoken, so a sound under speech is a sound the pilot does not hear.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateSpeech, getLesson, lessonSchedule, measuredSpeech, speechOverlapMs, type Schedule } from '../src/lesson';

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

/** the right answer to the headphone check: 1 (left) for the first trial, 2 for the second and the third */
const rightAnswer = (q: { readonly id: string }): number => (q.id.split(':')[2] === '1' ? 1 : 2);

const sounds = (s: Schedule): Schedule['plays'] => s.plays.filter((p) => p.kind !== 'one-off');
const underSpeech = (s: Schedule, share: number): number => sounds(s).filter((p) => speechOverlapMs(s, p.start, p.end) > share * (p.end - p.start)).length;

describe('v0.12: when the sounds of the ears lessons play against the speech (facts of M41-9)', () => {
    it('the measured voice is slower than the runner\'s estimate for most lines', () => {
        const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
        const keys = Object.keys(david);
        const longer = keys.filter((k) => (david[k] as number) > 0.7 + 0.065 * (MEASURED_TEXT[k] ?? (en[k] as string)).length);
        expect(keys.length).toBe(376);
        expect(longer.length).toBe(262);
    });

    it('ears-headphones: the first sound plays under the last line before it, then the question asks where it was', () => {
        const s = lessonSchedule(getLesson('ears-headphones'), { speech: measuredSpeech(david), answer: rightAnswer });
        const first = sounds(s)[0];
        expect(first).toMatchObject({ kind: 'preview', cue: 'target.hum' });
        const line = [...s.speech].reverse().find((l) => l.start < (first?.start ?? 0));
        expect(line).toBeDefined();
        // the sound starts before the line ends: part of its 3 s is under the voice (v0.12 as shipped: 2.5 s; with the trial line: 1 s)
        expect((line?.end ?? 0) - (first?.start ?? 0)).toBeGreaterThan(500);
        expect(speechOverlapMs(s, first?.start ?? 0, first?.end ?? 0)).toBeGreaterThan(500);
        const ask = s.asks[0];
        expect(ask?.id).toMatch(/:side$/);
        expect(ask?.linesStart).toBeGreaterThanOrEqual(first?.end ?? Infinity);
    });

    it('every ears lesson has sounds that overlap speech with the measured voice, and none with a voice faster than the estimate', () => {
        for (const id of EARS) {
            const lesson = getLesson(id);
            const measured = lessonSchedule(lesson, { speech: measuredSpeech(david), answer: rightAnswer, runner: { seed: 3 } });
            expect(sounds(measured).filter((p) => speechOverlapMs(measured, p.start, p.end) > 50).length, id).toBeGreaterThan(0);
            const fast = lessonSchedule(lesson, { speech: estimateSpeech(0.7), answer: rightAnswer, runner: { seed: 3 } });
            expect(underSpeech(fast, 0), `${id} with a fast voice`).toBe(0);
        }
    });

    it('with a voice 30 % slower than the estimate (a speech rate of 0.77), every glossary sound is mostly under speech', () => {
        const s = lessonSchedule(getLesson('ears-glossary'), { speech: estimateSpeech(1.3) });
        expect(sounds(s)).toHaveLength(20);
        expect(underSpeech(s, 0.5)).toBe(20);
    });
});
