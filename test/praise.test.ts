// M41-11: praise and stages. A counted attempt is praised in a short line from a pool, never the same
// twice in a row; "Better than last time!" only when its score really improved; the pass is the fanfare,
// the lesson's own line and what comes next; a checkpoint that ends a stage says "Stage k passed".
import { describe, expect, it } from 'vitest';
import type { CueEvent, Goal } from '../src/contract';
import { createTranslator, DICTS } from '../src/i18n';
import { getLesson, lessonAfter, PRAISE_LINES, type RunnerAction } from '../src/lesson';
import { LOCALES } from '../src/contract';
import { ScriptedPilot } from './helpers/pilot';
import { corridorLine } from './helpers/truth';

type Say = Extract<RunnerAction, { kind: 'say' }>;
const said = (p: ScriptedPilot): Say['line'][] => p.actions.filter((a): a is Say => a.kind === 'say').map((a) => a.line);
const cues = (p: ScriptedPilot): CueEvent[] => p.actions.flatMap((a) => (a.kind === 'cue' ? [a.event] : []));
const praises = (p: ScriptedPilot): string[] => said(p).map((l) => l.key).filter((k) => k.startsWith('praise.'));

/** hover-height, each attempt in the band for the given share of its 20 s window (the rest above it) */
function hoverWith(shares: readonly number[]): ScriptedPilot {
    const lesson = getLesson('hover-height');
    const goal = lesson.goals[0] as Extract<Goal, { kind: 'hold-height' }>;
    const p = new ScriptedPilot(lesson);
    p.begin();
    p.until(() => p.run.phase === 'flying', 60);
    for (const share of shares) {
        const startedAt = p.run.attempt;
        p.flyTo([0, 2.5, 0]);
        p.hold(share * goal.seconds);
        if (share < 1) {
            p.flyTo([0, 3.3, 0]);
            p.hold((1 - share) * goal.seconds + 1);
            p.flyTo([0, 2.5, 0]);
        } else p.hold(1);
        p.until(() => p.run.attempt > startedAt || p.run.phase === 'passed', 60);
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 60);
    }
    return p;
}

describe('praise of a counted attempt (M41-11)', () => {
    it('comes from a pool of short lines, never the same twice in a row, with the praise cue', () => {
        for (const locale of LOCALES) {
            const tr = createTranslator(locale, DICTS);
            const lines = Array.from({ length: PRAISE_LINES }, (_, i) => tr.text({ key: `praise.${i + 1}` }));
            expect(new Set(lines).size, locale).toBe(PRAISE_LINES);
            for (const l of lines) expect(l.length, `${locale} ${l}`).toBeLessThanOrEqual(16);
        }
        // rings-first, five counted attempts in a row in three sittings of the pool: each praised, two in a row never the same
        const seen: string[] = [];
        for (let seed = 0; seed < 3; seed++) {
            const p = new ScriptedPilot(getLesson('rings-first'), { seed });
            p.begin();
            for (let k = 0; k < 2; k++) {
                p.until(() => p.run.phase === 'flying', 60);
                p.flyTo([0, 3, 64]);
                p.flyTo([0, 3, 56]);
                p.until(() => p.run.phase !== 'flying', 10);
            }
            const keys = praises(p);
            expect(keys).toHaveLength(2);
            expect(keys[0]).not.toBe(keys[1]);
            expect(cues(p).filter((c) => c.kind === 'praise')).toHaveLength(2);
            seen.push(...keys);
        }
        expect(new Set(seen).size).toBeGreaterThan(2);
    }, 60000);

    it('says "better than last time" only when the score really improved (control: the same or a worse one does not)', () => {
        // in the band 85 % then all the time: better
        expect(praises(hoverWith([0.85, 1]))[1]).toBe('praise.better');
        // control: the other way round, and twice the same
        expect(praises(hoverWith([1, 0.85]))[1]).not.toBe('praise.better');
        expect(praises(hoverWith([1, 1]))[1]).not.toBe('praise.better');
        // the time of a goal with no measure of its own: hover-turn turned to faster, then slower
        const turn = (delays: readonly number[]): ScriptedPilot => {
            const p = new ScriptedPilot(getLesson('hover-turn'));
            p.begin();
            for (const d of delays) {
                p.until(() => p.run.phase === 'flying', 60);
                p.hold(d);
                p.face(p.object('ring-1').pos);
                p.until(() => p.run.phase !== 'flying', 10);
            }
            p.hold(0.5);
            return p;
        };
        expect(praises(turn([6, 1]))[1]).toBe('praise.better');
        expect(praises(turn([1, 6]))[1]).not.toBe('praise.better');
    }, 120000);
});

describe('the pass and the stages', () => {
    it('the pass: fanfare, the lesson\'s line, and "Lesson passed. Next, a bit harder:" with the next lesson on the pilot\'s path', () => {
        for (const path of ['full', 'fast'] as const) {
            const p = new ScriptedPilot(getLesson('hover-height'), { path });
            p.begin();
            p.until(() => p.run.phase === 'flying', 60);
            p.flyTo([0, 2.5, 0]);
            p.until(() => p.run.phase === 'passed', 200);
            expect(cues(p).at(-1)?.kind, path).toBe('fanfare');
            const last = said(p).slice(-2);
            const next = lessonAfter('hover-height', path);
            expect(last, path).toEqual([{ key: 'lesson.hover-height.pass' }, { key: 'fly.lesson-passed', params: { title: createTranslator('en', DICTS).text(next?.title ?? { key: '' }) } }]);
        }
        // the last lesson of the ladder says so
        const garden = getLesson('free-garden');
        const gates = [-10, -25, -40].map((z, i) => ({ id: `g${i + 1}`, shape: { kind: 'ring' as const, diameter: 3, tube: 0.1 }, pos: [0, 3, z] as const, quat: [1, 0, 0, 0] as const, order: i, solid: false, material: 'obstacle' as const }));
        const g = new ScriptedPilot(garden, { objects: gates, start: { pos: [0, 3, 0], yawDeg: 0 } }, null);
        g.begin();
        g.until(() => g.run.phase === 'flying', 60);
        g.flyTo([0, 3, -45]);
        g.until(() => g.run.phase === 'passed', 10);
        expect(said(g).at(-1)).toEqual({ key: 'fly.last-lesson' });
    }, 120000);

    it('the corridor says each stage it passes, with the stage cue; a checkpoint that ends no stage only chimes (control)', () => {
        // the shipped corridor is passed at 240 m flown, in its fourth section: flown to its end here (300 m) to meet every stage
        const shipped = getLesson('corridor');
        const lesson = { ...shipped, goals: [shipped.goals[0] as Goal, { kind: 'fly-distance' as const, metres: 300 }] };
        const p = new ScriptedPilot(lesson);
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const built = p.analytic;
        if (built === null) throw new Error('the corridor has a world');
        for (const q of corridorLine(built.resolved)) p.flyTo(q);
        const stages = cues(p).filter((c): c is Extract<CueEvent, { kind: 'stage' }> => c.kind === 'stage').map((c) => c.index);
        expect(stages).toEqual([1, 2, 3, 4]);
        expect(said(p).filter((l) => l.key === 'fly.stage').map((l) => l.params?.['n'])).toEqual([1, 2, 3, 4]);
        expect(p.of('checkpoint').map((c) => c.id)).toEqual(['cp-1', 'cp-2', 'cp-3', 'cp-4', 'cp-5']);
        // control: the same corridor with its stages taken off says none and chimes at each checkpoint instead
        const plain = { ...lesson, checkpoints: lesson.checkpoints.map(({ stage: _s, ...cp }) => cp) };
        const q = new ScriptedPilot(plain);
        q.begin();
        q.until(() => q.run.phase === 'flying', 60);
        for (const pt of corridorLine(built.resolved)) q.flyTo(pt);
        expect(cues(q).filter((c) => c.kind === 'stage')).toEqual([]);
        expect(said(q).filter((l) => l.key === 'fly.stage')).toEqual([]);
        expect(cues(q).filter((c) => c.kind === 'checkpoint').length).toBeGreaterThanOrEqual(4);
    }, 120000);
});
