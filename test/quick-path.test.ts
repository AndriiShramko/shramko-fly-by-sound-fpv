// The quick first lesson (simulator lane sound6, owner 2026-11-19): in headphones that do not follow the head a sound in
// front and a sound behind sound the same, so no lesson asks the pilot to tell them apart, and no lesson teaches it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LessonDef, Locale, Vec3 } from '../src/contract';
import { DICTS } from '../src/i18n';
import { getLesson, SHIPPED_LESSON_IDS, TURN_OFFSETS, type DemoScene, type Question } from '../src/lesson';
import { lessonSchedule, measuredSpeech, type Schedule, type SpeechModel } from '../src/lesson/schedule';
import { createAnalyticWorld } from '../src/world/analytic-world';
import { lessonPaths } from '../src/lesson/library';
import { HEADPHONE_CUE } from '../src/lesson/runner';
import { validatePaths } from '../src/lesson/validate';
import { defaultPrefs } from '../src/prefs';

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

const LOCALES = ['en', 'es', 'pl', 'ru'] as const;
const fixture = (name: string): Record<string, number> => (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { seconds: Record<string, number> }).seconds;
/** the Windows voices measured line by line (test/fixtures/measure-tts.ps1): David, Helena, Paulina, Irina */
const VOICE: Readonly<Record<Locale, Record<string, number>>> = {
    en: fixture('tts-en-david.json'),
    es: fixture('tts-es-helena.json'),
    pl: fixture('tts-pl-paulina.json'),
    ru: fixture('tts-ru-irina.json')
};
/** the design's promise (simulator lane sound6): a wall knock within 12 s of the press */
const FIRST_WALL_MAX_S = 12;
/**
 * A guard against new talk on the quick path: its small room's flight begins 205.0 s after the press with David at this
 * build (headphone check 82.2 s, the walls 89.2 s, the room's intro 33.6 s; the design guessed 135 s), so 210 s.
 */
const ROOM_FLIGHT_MAX_S = 210;

/** one lesson's schedule as the path plays it: every question answered right when it has been read out */
function pathSchedule(id: string, locale: Locale, speech: SpeechModel): Schedule {
    const lesson = getLesson(id);
    return lessonSchedule(lesson, { locale, speech, answer: answerOf(lesson, []), runner: { seed: 1 } });
}

/**
 * Seconds from the press that opens the path's first lesson to the first play of `cue`, the lessons played one after
 * another; Infinity when the path reaches a flight (where the sound depends on the pilot) before it.
 */
function secondsToFirst(ids: readonly string[], cue: string, locale: Locale, speech: SpeechModel): number {
    let t = 0;
    for (const id of ids) {
        const s = pathSchedule(id, locale, speech);
        const p = s.plays.find((x) => x.cue === cue);
        if (p !== undefined) return (t + p.start) / 1000;
        if (s.phase === 'flying') return Infinity;
        t += s.endT;
    }
    return Infinity;
}

/** Seconds from the press to the start of the flight of lesson `flightId`, the lessons before it passed one by one. */
function secondsToFlight(ids: readonly string[], flightId: string, locale: Locale, speech: SpeechModel): number {
    let t = 0;
    for (const id of ids) {
        const s = pathSchedule(id, locale, speech);
        if (id === flightId) return s.phase === 'flying' ? (t + s.endT) / 1000 : Infinity;
        if (s.phase === 'flying') return Infinity;
        t += s.endT;
    }
    return Infinity;
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

describe('the quick path is the default (owner 2026-11-19: headphones, then at once a room, then fly)', () => {
    it('(c) the fast path: headphones, the walls, then the small room; it is valid and the default of new prefs', () => {
        const p = lessonPaths();
        expect(p.fast).toEqual(['ears-headphones', 'ears-walls', 'walls-hall', 'corridor', 'tunnel-gaps', 'rings-first', 'rings-course', 'free-garden']);
        expect(validatePaths(p).ok).toBe(true);
        expect(defaultPrefs().path).toBe('fast');
    });

    it('(c) the headphone check plays the wall knocks after one intro line; the advice comes only after a miss', () => {
        expect(HEADPHONE_CUE).toBe('safety.wall');
        const lesson = getLesson('ears-headphones');
        const s = lessonSchedule(lesson, { answer: (q) => (Number(q.id.split(':')[2]) % 2 === 1 ? 1 : 2), runner: { seed: 1 } });
        const first = s.plays[0];
        if (first === undefined) throw new Error('no sound');
        expect(first.cue).toBe('safety.wall');
        const before = s.speech.filter((l) => l.start < first.start).map((l) => l.key);
        expect(before).toEqual(['lesson.ears-headphones.title', 'lesson.ears-headphones.intro.1', 'headphones.trial']);
        expect(s.speech.map((l) => l.key)).not.toContain('headphones.wired');
    });

    it.each(LOCALES.map((l) => [l]))('(b) %s, measured voice: the first wall sound comes within 12 s of the press on both paths', (locale) => {
        const speech = measuredSpeech(VOICE[locale]);
        const paths = lessonPaths();
        // at this build: en 6.9 s, es 7.9 s, pl 7.1 s, ru 8.0 s on both paths (the headphone check's first knock).
        // Before lane sound6 (package bd79c96) the full path's first knock came after the headphone check, in
        // ears-glossary; the fast path had none before its first flight (Infinity)
        for (const path of ['fast', 'full'] as const) {
            const s = secondsToFirst(paths[path], 'safety.wall', locale, speech);
            expect(s, `${path}, ${locale}`).toBeLessThanOrEqual(FIRST_WALL_MAX_S);
        }
    });

    it('(b) en, measured voice (David): on the quick path the small room flies within 210 s of the press', () => {
        const s = secondsToFlight(lessonPaths().fast, 'walls-hall', 'en', measuredSpeech(VOICE.en));
        expect(s).toBeLessThanOrEqual(ROOM_FLIGHT_MAX_S);
    });

    it('(c) the room lesson names the height tone and the best-height note: the quick path has no hover-height', () => {
        const intro = getLesson('walls-hall').intro;
        expect(intro.map((l) => l.key)).toEqual(['lesson.walls-hall.intro.1', 'lesson.walls-hall.goal.1']);
        expect(intro[0]?.cues).toEqual(['height.tone', 'height.target']);
    });
});
