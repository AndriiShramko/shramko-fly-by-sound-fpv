// Train 4, lane tutor-moment, stage S4: the scripted pilot over the first set (decision 10 of the brief). A pilot model
// answers the headphone check, waits through every moment and does every task with a simple controller, lesson after
// lesson on the fast path up to the last lesson that teaches a sound, in en, es, pl and ru, with the measured Windows
// voices (test/fixtures/tts-*.json; a line not measured falls back to the package's estimate). It holds the feedback of a
// low-vision pilot (the tutorial gave too much at once; a sound should be brought in at the action it belongs to):
// moving within 60 s of the press, under 60 words before it, no prompt over two sentences, one new sound a moment,
// the first set within 420 s, and with guide 'new' nothing but the sounds' names in the flying lessons.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { CueId, GuideLevel, Locale, SessionEvent, SonicObject, Vec3 } from '../src/contract';
import { getLesson } from '../src/lesson';
import { lessonPaths } from '../src/lesson/library';
import { lessonSchedule, measuredSpeech, type SpeechModel } from '../src/lesson/schedule';
import { quatRotate } from '../src/util/vec';
import type { AnalyticWorldInfo } from '../src/world/analytic-world';
import { RecordingHost } from './helpers/record';

const LOCALES = ['en', 'es', 'pl', 'ru'] as const;
const fixture = (name: string): Record<string, number> => (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { seconds: Record<string, number> }).seconds;
/** the Windows voices measured line by line (test/fixtures/measure-tts.ps1): David, Helena, Paulina, Irina */
const VOICE: Readonly<Record<Locale, Record<string, number>>> = {
    en: fixture('tts-en-david.json'),
    es: fixture('tts-es-helena.json'),
    pl: fixture('tts-pl-paulina.json'),
    ru: fixture('tts-ru-irina.json')
};

/** decision 10 of the brief: the numbers the scripted pilot must hold */
const FIRST_MOVE_MAX_S = 60;
const WORDS_BEFORE_MOVE_MAX = 60;
const SENTENCES_MAX = 2;
const SET_MAX_S = 420;

const words = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** sentences of a line: ends of a sentence followed by a space or the end (a decimal point is not one) */
const sentences = (text: string): number => Math.max(1, (text.trim().match(/[.!?…]+(?=\s|$)/g) ?? []).length);

interface Said {
    readonly lesson: string;
    readonly t: number;
    readonly key: string;
    readonly text: string;
}

interface SetRun {
    /** seconds from the press to the first frame the pilot may move the craft */
    readonly firstMoveS: number;
    /** every line said before then */
    readonly before: readonly Said[];
    /** every line said in the set */
    readonly said: readonly Said[];
    /** seconds from the press to the last lesson that teaches a sound passed, its last line said */
    readonly setS: number;
    /** per moment taught: the audible list before it, the one during it, and the one after it */
    readonly steps: readonly { readonly id: string; readonly cue: CueId; readonly before: readonly CueId[]; readonly during: readonly CueId[]; readonly after: readonly CueId[] }[];
    /** per lesson: the moment events */
    readonly moments: Readonly<Record<string, readonly string[]>>;
    /** per lesson: seconds the lesson took */
    readonly lessonS: Readonly<Record<string, number>>;
}

/** The lessons of the fast path the pilot flies: after the headphone check, up to the last one that teaches a sound. */
function setLessons(): string[] {
    const fast = lessonPaths().fast.slice(1);
    const last = fast.reduce((n, id, i) => ((getLesson(id).moments ?? []).length > 0 ? i : n), -1);
    // on a build without moments (the negative control) the set is the lessons the moments were put into
    return fast.slice(0, (last < 0 ? fast.indexOf('rings-course') : last) + 1);
}

/** A ring's two sides along its axis, the near one first (from `from`). */
function throughRing(o: SonicObject, from: Vec3, m = 1.5): [Vec3, Vec3] {
    const ax = quatRotate(o.quat, [0, 0, 1]);
    const a: Vec3 = [o.pos[0] + ax[0] * m, o.pos[1] + ax[1] * m, o.pos[2] + ax[2] * m];
    const b: Vec3 = [o.pos[0] - ax[0] * m, o.pos[1] - ax[1] * m, o.pos[2] - ax[2] * m];
    const d = (p: Vec3): number => Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]);
    return d(a) <= d(b) ? [a, b] : [b, a];
}

/** Waits until the pilot may fly (flying, not frozen) or the lesson is over. */
function ready(host: RecordingHost): boolean {
    host.until(() => host.runner.phase === 'passed' || (host.runner.phase === 'flying' && !host.frozen), 120);
    return host.runner.phase === 'flying';
}

/** One attempt of the lesson's flight, with the controller that fits its world. */
function fly(host: RecordingHost, id: string, n: number): void {
    const w = host.world as AnalyticWorldInfo;
    if (id === 'walls-hall') {
        // the height tone's task (its moment opens the second attempt): climb into the band and hold
        if (host.runner.view().moment?.cue === 'height.tone') {
            host.flyTo([host.pos[0], 2.3, host.pos[2]], 1);
            host.hold(2);
        }
        // on to the front wall, stop short of it
        const front = w.landmarks.find((l) => l.id === 'wall-front')!.pos[2] + 1.2;
        // a stop is counted after a run up to it: from where the last one stopped, back to the middle first
        if (Math.abs(host.pos[2] - front) < 3) host.flyTo([host.pos[0], host.pos[1], host.lesson.start.pos[2]], 2.5);
        host.flyTo([host.pos[0], host.pos[1], front], 2.5);
        host.hold(2);
        return;
    }
    if (id === 'corridor' || id === 'tunnel-gaps') {
        for (const c of w.checkpoints ?? []) if (host.runner.phase === 'flying') host.flyTo(c.pos, 2.2);
        host.hold(2);
        return;
    }
    // the rings: each ring in order, through it along its axis; the course slow to its first ring, then faster
    const rings = w.objects().filter((o) => o.shape.kind === 'ring').sort((a, b) => a.order - b.order);
    const goal = host.lesson.goals.find((g) => g.kind === 'pass-gates');
    const ids = goal?.kind === 'pass-gates' && goal.gateIds !== 'all' ? goal.gateIds : rings.map((r) => r.id);
    ids.forEach((gid, i) => {
        const ring = rings.find((r) => r.id === gid)!;
        const [a, b] = throughRing(ring, host.pos);
        const speed = id === 'rings-course' ? (i === 0 ? 2.5 : 3.5) : 2.5;
        if (host.runner.phase === 'flying') host.flyTo(a, speed);
        if (host.runner.phase === 'flying') host.flyTo(b, speed);
    });
    host.hold(2);
}

/** The press, the headphone check, then the set's lessons one after another; `known` grows with what was taught. */
function flySet(locale: Locale, guide: GuideLevel = 'full'): SetRun {
    const speech: SpeechModel = measuredSpeech(VOICE[locale]);
    const said: Said[] = [];
    // the headphone check: every question answered right once it has been read out
    const ears = lessonSchedule(getLesson('ears-headphones'), { locale, speech, answer: (q) => (Number(q.id.split(':')[2]) % 2 === 1 ? 1 : 2), runner: { seed: 1, known: [], guide, path: 'fast' } });
    for (const l of ears.speech) said.push({ lesson: 'ears-headphones', t: l.start / 1000, key: l.key, text: l.text });
    let offset = ears.endT / 1000;
    const lessonS: Record<string, number> = { 'ears-headphones': offset };
    let firstMoveS = Infinity;
    const known = new Set<CueId>();
    const steps: SetRun['steps'][number][] = [];
    const moments: Record<string, string[]> = {};
    for (const id of setLessons()) {
        const lesson = getLesson(id);
        const host = new RecordingHost(lesson, { locale, speech, hz: 30, recordHz: 30, beginAtMs: 0, known: [...known], guide });
        host.begin();
        if (ready(host) && firstMoveS === Infinity) firstMoveS = offset + host.t / 1000;
        for (let n = 0; n < 12 && host.runner.phase !== 'passed'; n++) {
            fly(host, id, n);
            if (!ready(host)) break;
        }
        expect(host.runner.phase, `${locale} ${id}: passed`).toBe('passed');
        // the lesson's last line said before the next opens
        host.until(() => host.events.filter((e) => e.kind === 'speech').at(-1)?.key === 'speech.end', 30);
        for (const e of host.events) if (e.kind === 'speech' && e.key !== 'speech.end') said.push({ lesson: id, t: offset + e.t / 1000, key: e.key, text: e.text });
        // the audible lists in order; each moment taught is the single-cue list between the one before and the one after
        const lists = host.actionLog.flatMap((x) => (x.a.kind === 'audible' && x.a.cues !== null ? [x.a.cues] : []));
        const mine = (e: SessionEvent): e is Extract<SessionEvent, { kind: 'moment' }> => e.kind === 'moment';
        moments[id] = host.events.filter(mine).map((e) => `${e.id}:${e.what}`);
        for (const def of lesson.moments ?? []) {
            const taught = host.events.filter(mine).some((e) => e.id === def.id && (e.what === 'learned' || e.what === 'known'));
            if (!taught) continue;
            known.add(def.cue);
            const j = lists.findIndex((l) => l.length === 1 && l[0] === def.cue);
            steps.push({ id: def.id, cue: def.cue, before: lists[j - 1] ?? [], during: lists[j] ?? [], after: lists[j + 1] ?? [] });
        }
        offset += host.t / 1000;
        lessonS[id] = host.t / 1000;
    }
    return { firstMoveS, before: said.filter((s) => s.t < firstMoveS), said, setS: offset, steps, moments, lessonS };
}

const RUNS = new Map<string, SetRun>();
const run = (locale: Locale, guide: GuideLevel = 'full'): SetRun => {
    const k = `${locale}:${guide}`;
    if (!RUNS.has(k)) RUNS.set(k, flySet(locale, guide));
    return RUNS.get(k)!;
};

describe('the first set, flown by a scripted pilot (train 4, decision 10)', () => {
    // FIRST_SET_OUT=<file>: the numbers of every run as JSON (the lane's evidence)
    afterAll(() => {
        const out = process.env.FIRST_SET_OUT;
        if (out === undefined) return;
        const round = (n: number): number => Math.round(n * 10) / 10;
        const rows = [...RUNS.entries()].map(([k, r]) => ({
            run: k,
            firstMoveS: round(r.firstMoveS),
            wordsBeforeMove: r.before.reduce((s, l) => s + words(l.text), 0),
            longestPromptSentences: Math.max(...r.said.map((l) => sentences(l.text))),
            moments: r.steps.map((s) => `${s.id}:${s.cue}`),
            setS: round(r.setS),
            lessonS: Object.fromEntries(Object.entries(r.lessonS).map(([id, s]) => [id, round(s)]))
        }));
        writeFileSync(out, `${JSON.stringify({ bounds: { FIRST_MOVE_MAX_S, WORDS_BEFORE_MOVE_MAX, SENTENCES_MAX, SET_MAX_S }, rows }, null, 2)}\n`);
    });

    it.each(LOCALES.map((l) => [l]))('%s: the pilot moves within 60 s of the press, under 60 words said before it', (locale) => {
        const r = run(locale);
        // at this build the room's height moment resumes the flight (see the lane's status for the numbers)
        expect(r.firstMoveS, locale).toBeLessThanOrEqual(FIRST_MOVE_MAX_S);
        const n = r.before.reduce((s, l) => s + words(l.text), 0);
        expect(n, `${locale}: ${r.before.map((l) => l.key).join(' ')}`).toBeLessThan(WORDS_BEFORE_MOVE_MAX);
    }, 120_000);

    it.each(LOCALES.map((l) => [l]))('%s: no prompt is longer than two sentences', (locale) => {
        const long = run(locale).said.filter((l) => sentences(l.text) > SENTENCES_MAX).map((l) => `${l.key}: ${l.text}`);
        expect(long).toEqual([]);
    }, 120_000);

    it.each(LOCALES.map((l) => [l]))('%s: every moment brings exactly one new sound, never audible before it', (locale) => {
        const r = run(locale);
        const sets = setLessons().flatMap((id) => (getLesson(id).moments ?? []).map((m) => m.id));
        // every moment of the set was taught, in the order of the lessons
        expect(r.steps.map((s) => s.id)).toEqual(sets);
        expect(r.steps.length).toBeGreaterThan(0);
        expect(r.steps.length).toBeLessThanOrEqual(8);
        for (const s of r.steps) {
            expect(s.during, s.id).toEqual([s.cue]);
            expect(s.before, s.id).not.toContain(s.cue);
            expect(s.after.filter((c) => !s.before.includes(c)), s.id).toEqual([s.cue]);
            expect(s.before.filter((c) => !s.after.includes(c)), s.id).toEqual([]);
        }
        // one name a sound: each moment's cue is a different sound
        expect(new Set(r.steps.map((s) => s.cue)).size).toBe(r.steps.length);
    }, 120_000);

    it.each(LOCALES.map((l) => [l]))('%s: the whole first set within 420 s', (locale) => {
        const r = run(locale);
        expect(r.setS, JSON.stringify(r.lessonS)).toBeLessThanOrEqual(SET_MAX_S);
    }, 120_000);

    it.each(LOCALES.map((l) => [l]))("%s: with guide 'new' the flying lessons say only the sounds' names", (locale) => {
        const r = run(locale, 'new');
        const flying = r.said.filter((l) => l.lesson !== 'ears-headphones');
        expect(flying.length).toBeGreaterThan(0);
        expect(flying.map((l) => l.key).filter((k) => !/^cue\..+\.name$/.test(k))).toEqual([]);
        // each sound of the set is named once, at its moment
        expect(flying.map((l) => l.key)).toEqual(r.steps.map((s) => `cue.${s.cue}.name`));
    }, 120_000);
});
