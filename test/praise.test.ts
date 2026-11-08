// M41-11: praise and stages. A counted attempt is praised in a short line from a pool, never the same
// twice in a row; "Better than last time!" only when its score really improved; the pass is the fanfare,
// the lesson's own line and what comes next; a checkpoint that ends a stage says "Stage k passed".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CueEvent, Goal, SonicWorld, Vec3 } from '../src/contract';
import { createTranslator, DICTS } from '../src/i18n';
import { getLesson, lessonAfter, PRAISE_LINES, validateLesson, type RunnerAction } from '../src/lesson';
import { LOCALES } from '../src/contract';
import { createAnalyticWorld } from '../src/world';
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
            const ring = p.object('ring-1').pos;
            for (let k = 0; k < 2; k++) {
                p.until(() => p.run.phase === 'flying', 60);
                p.flyTo([ring[0], ring[1], ring[2] + 3]);
                p.flyTo([ring[0], ring[1], ring[2] - 3]);
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
        // the attempt is kept open (300 m, more than the corridor's 125 m track) so the whole corridor is flown whatever its goals
        const shipped = getLesson('corridor');
        const lesson = { ...shipped, goals: [shipped.goals[0] as Goal, { kind: 'fly-distance' as const, metres: 300 }] };
        const p = new ScriptedPilot(lesson);
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const built = p.analytic;
        if (built === null) throw new Error('the corridor has a world');
        for (const q of corridorLine(built.resolved)) p.flyTo(q);
        const stages = cues(p).filter((c): c is Extract<CueEvent, { kind: 'stage' }> => c.kind === 'stage').map((c) => c.stage);
        expect(stages).toEqual([1, 2, 3, 4]);
        expect(said(p).filter((l) => l.key === 'fly.stage').map((l) => l.params?.['n'])).toEqual([1, 2, 3, 4]);
        // every checkpoint, the end (cp-6, the world's end landmark since the s13-worlds merge) too
        expect(p.of('checkpoint').map((c) => c.id)).toEqual(['cp-1', 'cp-2', 'cp-3', 'cp-4', 'cp-5', 'cp-6']);
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

    it("a stage is said once: from the world's checkpoint list when it marks stages, else from the lesson's checkpoints (review R6)", () => {
        const lesson = getLesson('corridor');
        if (lesson.world.kind !== 'analytic') throw new Error('the corridor has a world');
        const built = createAnalyticWorld(lesson.world.spec);
        // the corridor's first straight and the free stretch after it, up to 1 m before its first pillar (z = -21)
        const cp2 = (lesson.checkpoints[1] as { at: Vec3; stage?: number }).at;
        const y = cp2[1];
        expect(lesson.checkpoints[1]?.stage).toBe(1);
        // a world list along it, every 2 m, that ends stage 1 at -8 m (the lesson's own stage 1 is cp-2 at -15 m)
        const list = (withStage: boolean): SonicWorld =>
            Object.assign(Object.create(built) as SonicWorld, {
                checkpoints: [0, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20].map((z) => ({ pos: [0, y, z] as Vec3, dir: [0, 0, -1] as Vec3, ...(withStage && z === -8 ? { stage: 1 } : {}) }))
            });
        const fly = (world: SonicWorld): { stages: (number | undefined)[]; at: number[]; touches: number } => {
            const p = new ScriptedPilot(lesson, {}, world);
            p.begin();
            p.until(() => p.run.phase === 'flying', 60);
            const at: number[] = [];
            let seen = 0;
            for (let z = -2; z >= -20; z -= 2) {
                p.flyTo([0, y, z]);
                const n = cues(p).filter((c) => c.kind === 'stage').length;
                if (n > seen) at.push(z);
                seen = n;
            }
            return { stages: cues(p).flatMap((c) => (c.kind === 'stage' ? [c.stage] : [])), at, touches: p.of('touch').length };
        };
        // the world marks stage 1 at -8 m: said there, and not again at cp-2
        expect(fly(list(true))).toEqual({ stages: [1], at: [-8], touches: 0 });
        // control: a world list with no stages leaves them to the lesson's checkpoints (cp-2 at -15 m, reached within its 2.5 m)
        expect(fly(list(false))).toEqual({ stages: [1], at: [-14], touches: 0 });
    }, 60000);
});

describe('the corridor ends at its end (review R5)', () => {
    /** the corridor flown along its line to the end: when it passed, which stages were said before, and the touches */
    function flown(goals: readonly Goal[]): { checkpoints: string[]; stages: (number | undefined)[]; touches: number; said: string[] } {
        const lesson = { ...getLesson('corridor'), goals };
        const p = new ScriptedPilot(lesson);
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const built = p.analytic;
        if (built === null) throw new Error('the corridor has a world');
        const line = corridorLine(built.resolved);
        const phase = (): string => p.run.phase;
        for (const q of line) if (phase() === 'flying') p.flyTo(q);
        return { checkpoints: p.of('checkpoint').map((c) => c.id), stages: cues(p).flatMap((c) => (c.kind === 'stage' ? [c.stage] : [])), touches: p.of('touch').length, said: said(p).map((l) => l.key) };
    }

    it("with the goal 'track-end' the corridor passes at its end, after all four stages and its last section; control: a distance goal of the track less 5 m passes before the end", () => {
        const shipped = getLesson('corridor');
        // the shipped goals end on it since the s13-worlds merge (item 8a)
        expect(shipped.goals.map((g) => g.kind)).toEqual(['fly-distance', 'track-end']);
        const end = flown([shipped.goals[0] as Goal, { kind: 'track-end' }]);
        expect(end.touches).toBe(0);
        expect(end.checkpoints).toEqual(['cp-1', 'cp-2', 'cp-3', 'cp-4', 'cp-5', 'cp-6']);
        expect(end.stages).toEqual([1, 2, 3, 4]);
        expect(end.said.slice(-2)).toEqual(['lesson.corridor.pass', 'fly.lesson-passed']); // "You flew the whole corridor." is true now
        // control: a distance goal (the review's finding; s13-worlds' 120 m of the 125 m track until the merge) passes in the
        // last section: its end (cp-6) is never flown
        const built = createAnalyticWorld((shipped.world as { spec: Parameters<typeof createAnalyticWorld>[0] }).spec);
        const track = built.checkpoints ?? [];
        let length = 0;
        for (let i = 1; i < track.length; i++) {
            const a = (track[i - 1] as { pos: Vec3 }).pos, b = (track[i] as { pos: Vec3 }).pos;
            length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        }
        const now = flown([shipped.goals[0] as Goal, { kind: 'fly-distance', metres: Math.round(length - 5) }]);
        expect(now.checkpoints).not.toContain('cp-6');
        expect(now.stages).toEqual([1, 2, 3, 4]);
        expect(now.said).toContain('lesson.corridor.pass');
    }, 120000);

    it("the goal needs the lesson's track: the loader refuses it in a lesson with fewer than two checkpoints", () => {
        const r = validateLesson({ ...JSON.parse(readFileSync(new URL('../lessons/rings-first.json', import.meta.url), 'utf8')), goals: [{ kind: 'track-end' }] });
        expect(r.ok ? [] : r.issues.map((i) => i.message).join(' ')).toMatch(/track-end/);
    });
});
