import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Goal, LessonDef, SpeechLine } from '../src/contract';
import { LOCALES } from '../src/contract';
import { createTranslator, DICTS, LESSONS, lessonKeys } from '../src/i18n';
import { getLesson, lessonPaths, lessonsOnPath, nextLesson, parseLesson, SHIPPED_LESSON_IDS, validateLesson, validatePaths, writeLesson } from '../src/lesson';
import { createAnalyticWorld } from '../src/world';
import { NEW_LESSONS } from './helpers/new-lessons';

const DIR = fileURLToPath(new URL('../lessons/', import.meta.url));
const read = (name: string): string => readFileSync(`${DIR}${name}`, 'utf8');

function allLines(l: LessonDef): SpeechLine[] {
    return [l.title, ...l.intro, l.speech.pass, l.speech.retry, ...l.speech.hints];
}

function objectIds(g: Goal): string[] {
    switch (g.kind) {
        case 'turn-to':
        case 'around':
        case 'name-shape':
            return [g.objectId];
        case 'approach-stop':
            return g.objectId === null ? [] : [g.objectId];
        case 'reach-zone':
            return [g.zoneId];
        case 'pass-gates':
            return g.gateIds === 'all' ? [] : [...g.gateIds];
        default:
            return [];
    }
}

describe('the shipped lessons', () => {
    it('are the lessons of the catalogue, one file each, valid and in canonical form', () => {
        expect([...SHIPPED_LESSON_IDS].sort()).toEqual(LESSONS.map((l) => l.id).sort());
        for (const spec of LESSONS) {
            const text = read(`${spec.id}.json`);
            const parsed = parseLesson(text);
            if (!parsed.ok) throw new Error(`${spec.id}: ${JSON.stringify(parsed.issues)}`);
            expect(parsed.value.id).toBe(spec.id);
            expect(writeLesson(parsed.value), spec.id).toBe(text);
            expect(parsed.value.module, spec.id).toBe(spec.module);
            expect(getLesson(spec.id)).toEqual(parsed.value);
        }
    });

    it('speak the catalogue lines of their own lesson: title, intro, goals, pass, retry, hints', () => {
        for (const spec of LESSONS) {
            const l = getLesson(spec.id);
            const keys = lessonKeys(spec);
            expect([l.title, ...l.intro].map((x) => x.key), spec.id).toEqual(keys.filter((k) => /\.(title|intro\.\d+|goal\.\d+)$/.test(k)));
            expect(l.speech.pass.key).toBe(`lesson.${spec.id}.pass`);
            expect(l.speech.retry.key).toBe(`lesson.${spec.id}.retry`);
            expect(l.speech.hints.map((h) => h.key)).toEqual(keys.filter((k) => k.includes('.hint.')));
        }
    });

    it('fill every parameter their texts take, with the numbers the lesson really uses, in all four languages', () => {
        const hover = getLesson('hover-height');
        const hold = hover.goals[0] as Extract<Goal, { kind: 'hold-height' }>;
        expect(hover.intro.find((x) => x.key.endsWith('goal.1'))?.params).toEqual({ seconds: hold.seconds });
        const stop = getLesson('move-stop');
        expect(stop.world.kind).toBe('analytic');
        const zone = stop.world.kind === 'analytic' ? (stop.world.spec.params['zoneDistanceM'] as number) : NaN;
        expect(stop.intro.find((x) => x.key.endsWith('intro.1'))?.params).toEqual({ metres: zone });
        for (const locale of LOCALES) {
            const problems: string[] = [];
            const tr = createTranslator(locale, DICTS, (p) => problems.push(`${p.key}: ${p.message}`));
            for (const l of SHIPPED_LESSON_IDS.map(getLesson)) for (const line of allLines(l)) expect(tr.text(line).length).toBeGreaterThan(3);
            expect(problems, locale).toEqual([]);
        }
    });

    it('build their worlds, start in free space and name only objects their world has', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            const l = getLesson(id);
            if (l.world.kind !== 'analytic') continue;
            const w = createAnalyticWorld(l.world.spec);
            expect(w.sdf(...l.start.pos), `${id} start`).toBeGreaterThan(0.3);
            const ids = new Set(w.objects().map((o) => o.id));
            for (const g of l.goals) for (const o of objectIds(g)) expect(ids.has(o), `${id} names ${o}`).toBe(true);
            for (const g of l.goals) {
                if (g.kind === 'pass-gates' || g.kind === 'timed-course') expect(w.objects().filter((o) => o.order !== null).length, id).toBeGreaterThan(0);
            }
            for (const cp of l.checkpoints) expect(w.sdf(...cp.pose.pos), `${id} ${cp.id}`).toBeGreaterThan(0.3);
        }
    });

    it('keep the promises their texts make', () => {
        expect(getLesson('corridor').assists.onTouch).toBe('bump-recentre');
        expect(getLesson('corridor').checkpoints.length).toBeGreaterThanOrEqual(4);
        expect(getLesson('walls-hall').assists.onTouch).toBe('bump');
        for (const id of SHIPPED_LESSON_IDS) {
            const l = getLesson(id);
            expect(l.world.kind === 'none', id).toBe(l.module === 0);
        }
        // the corridor's checkpoints sit at the starts of its sections
        const c = getLesson('corridor');
        const w = c.world.kind === 'analytic' ? createAnalyticWorld(c.world.spec) : null;
        const sections = (w?.landmarks ?? []).filter((m) => m.id.startsWith('section-')).map((m) => m.pos);
        expect(c.checkpoints.map((cp) => cp.at)).toEqual(sections);
        // Winter Garden x5 with its ring track (spec section 3, module 7; plan v12-flight step 10)
        const g = getLesson('free-garden');
        expect(g.world).toEqual({ kind: 'scan', sceneId: '7a475d38', sceneVersion: null, transform: [5, 0, 0, 0], track: { id: '7a475d38-rings', version: 1 } });
    });

    it('have a full path of every lesson in ladder order and a fast path of about six, flagged in the files', () => {
        const p = lessonPaths();
        expect(validatePaths(JSON.parse(read('paths.json'))).ok).toBe(true);
        expect(p.full).toEqual(LESSONS.map((l) => l.id));
        expect(p.fast.length).toBeGreaterThanOrEqual(5);
        expect(p.fast.length).toBeLessThanOrEqual(8);
        for (const id of SHIPPED_LESSON_IDS) expect(getLesson(id).fastPath, id).toBe(p.fast.includes(id));
        expect(lessonsOnPath('fast').map((l) => l.module)).toEqual([...lessonsOnPath('fast').map((l) => l.module)].sort((a, b) => a - b));
        expect(nextLesson('hover-height', 'fast')?.id).toBe('walls-hall');
        expect(nextLesson('free-garden', 'full')).toBeNull();
        // every lesson can be opened directly: each has its own start
        for (const id of p.full) expect(getLesson(id).start.pos.length).toBe(3);
    });
});

describe('the lesson loader refuses a bad lesson with its reason (negative controls)', () => {
    const good = (): Record<string, unknown> => JSON.parse(read('rings-first.json')) as Record<string, unknown>;
    const paths = (lesson: unknown): string[] => {
        const r = validateLesson(lesson);
        return r.ok ? [] : r.issues.map((i) => i.path);
    };

    it('accepts the shipped file', () => {
        expect(paths(good())).toEqual([]);
    });

    it('finds unknown and missing keys, bad numbers, unknown texts and impossible rules', () => {
        expect(paths({ ...good(), colour: 'red' })).toContain('colour');
        const noPass = good();
        delete noPass['pass'];
        expect(paths(noPass)).toContain('pass');
        expect(paths({ ...good(), title: { key: 'lesson.nope.title' } })).toContain('title.key');
        expect(paths({ ...good(), pass: { attempts: 3, required: 5, blocks: 1, maxTouches: null, blocking: true } })).toContain('pass.required');
        expect(paths({ ...good(), layers: { on: ['safety', 'safety'], heightBandM: null, hazardVoices: 3 } })).toContain('layers.on');
        expect(paths({ ...good(), layers: { on: ['safety'], heightBandM: [3, 2], hazardVoices: 4 } })).toEqual(expect.arrayContaining(['layers.heightBandM', 'layers.hazardVoices']));
        expect(paths({ ...good(), goals: [{ kind: 'fly-through', gate: 'x' }] })).toContain('goals[0].kind');
        expect(paths({ ...good(), goals: [{ kind: 'pass-gates', gateIds: [], inOrder: true }] })).toContain('goals[0].gateIds');
        expect(paths({ ...good(), id: 'Rings First' })).toContain('id');
    });

    it('keeps questions to the ears and flight to the worlds', () => {
        expect(paths({ ...good(), goals: [{ kind: 'locate', trials: 3 }] })).toContain('goals');
        const ears = JSON.parse(read('ears-headphones.json')) as Record<string, unknown>;
        expect(paths({ ...ears, goals: [{ kind: 'fly-distance', metres: 10 }] })).toContain('goals');
        expect(paths({ ...ears, module: 1 })).toContain('world');
    });

    it('refuses a fast path out of the full path order', () => {
        const p = JSON.parse(read('paths.json')) as { full: string[]; fast: string[] };
        expect(validatePaths({ ...p, fast: [...p.fast].reverse() }).ok).toBe(false);
        expect(validatePaths({ ...p, fast: [...p.fast, 'no-such'] }).ok).toBe(false);
    });
});

describe('lesson format 2 and the files of format 1 (v0.12)', () => {
    const current = (id: string): Record<string, unknown> => JSON.parse(read(`${id}.json`)) as Record<string, unknown>;
    /** the file as v0.12 wrote it: format 1, its block rule */
    const asV1 = (id: string, pass: Record<string, unknown>): Record<string, unknown> => ({ ...current(id), format: 'shramko-sonic-lesson/1', version: 1, pass });

    it('reads a format 1 file and migrates its block rule: r = min(3, required x blocks), the offer after 3 failures in a row', () => {
        const turn = validateLesson(asV1('hover-turn', { attempts: 5, required: 4, blocks: 1, maxTouches: null, blocking: true }));
        expect(turn.ok).toBe(true);
        if (!turn.ok) return;
        expect(turn.value.format).toBe('shramko-sonic-lesson/2');
        expect(turn.value.pass).toEqual({ attempts: 3, required: 3, blocks: 1, maxTouches: null, blocking: true });
        // a lesson that does not block: its attempts, at most 3, are the failures in a row after which it moves on
        const game = validateLesson(asV1('ears-game', { attempts: 1, required: 1, blocks: 2, maxTouches: null, blocking: false }));
        expect(game.ok && game.value.pass).toEqual({ attempts: 2, required: 2, blocks: 1, maxTouches: null, blocking: false });
        const course = validateLesson(asV1('rings-course', { attempts: 3, required: 1, blocks: 1, maxTouches: 0, blocking: true }));
        expect(course.ok && course.value.pass).toEqual({ attempts: 3, required: 1, blocks: 1, maxTouches: 0, blocking: true });
        const old = validateLesson(asV1('hover-height', { attempts: 10, required: 8, blocks: 1, maxTouches: null, blocking: true }));
        expect(old.ok && old.value.pass.required).toBe(3);
        // and a migrated lesson is written back in format 2, which reads as the same lesson
        if (old.ok) {
            const again = parseLesson(writeLesson(old.value));
            expect(again.ok && again.value).toEqual(old.value);
            expect(writeLesson(old.value)).toContain('"format": "shramko-sonic-lesson/2"');
            expect(writeLesson(old.value)).not.toContain('"blocks"');
        }
    });

    it('refuses a format 2 rule that would trap a pilot: more than 3 to pass, more than 3 failures before the offer, blocks', () => {
        const paths = (pass: Record<string, unknown>): string[] => {
            const r = validateLesson({ ...current('hover-turn'), pass });
            return r.ok ? [] : r.issues.map((i) => i.path);
        };
        expect(paths({ attempts: 3, required: 3, maxTouches: null, blocking: true })).toEqual([]);
        expect(paths({ attempts: 3, required: 4, maxTouches: null, blocking: true })).toContain('pass.required');
        expect(paths({ attempts: 4, required: 3, maxTouches: null, blocking: true })).toContain('pass.attempts');
        expect(paths({ attempts: 3, required: 3, blocks: 1, maxTouches: null, blocking: true })).toContain('pass.blocks');
        expect(validateLesson({ ...current('hover-turn'), format: 'shramko-sonic-lesson/9' }).ok).toBe(false);
    });

    it('every shipped lesson is format 2, version 2 (v0.12 recordings of version 1 are told apart by the replay)', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            const l = getLesson(id);
            expect(current(id)['format'], id).toBe('shramko-sonic-lesson/2');
            // a lesson new in v0.13 has no v0.12 recording to be told apart from: it starts at 1
            expect(l.version, id).toBe(NEW_LESSONS.includes(id) ? 1 : 2);
            expect(l.pass.required, id).toBeLessThanOrEqual(3);
            expect(l.pass.attempts, id).toBeLessThanOrEqual(3);
        }
    });
});
