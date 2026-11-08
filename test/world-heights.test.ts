// Rings at different heights (M41-22, lane s13-worlds step 7): the rings generator's version 2 places
// gates at given heights (levels floor, middle, ceiling or metres), and the lesson rings-heights, after
// rings-small and before rings-course, teaches finding a ring's height by ear with the target tone of
// M41-12 (lane s13-sound): the second, steady tone is the next ring's height. Held here: the gates at the
// asked heights, all three levels used and far apart; every ring inside the room with its margins; each
// height change can be flown within its leg at the lesson's caps; no one height passes rings of two levels
// (review M3); the truth bot passes; the intro says what to listen for. Controls: rings-line's rings are all
// at one height; a climb too steep for its leg; the lesson's first rings (2 m) shared one band of heights.
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, LessonDef, SonicObject } from '../src/contract';
import { createTranslator, DICTS } from '../src/i18n';
import { BODY_RADIUS_M, getLesson, lessonPaths } from '../src/lesson';
import { createAnalyticWorld, FLOOR_MARGIN_M, makeSpec, shapeHalfExtents, WALL_MARGIN_M, type AnalyticWorldInfo } from '../src/world';
import { NEW_LESSONS } from './helpers/new-lessons';
import { ScriptedPilot } from './helpers/pilot';
import { fullStickSeconds } from './helpers/reach';
import { playLesson } from './helpers/truth';

const worldOf = (l: LessonDef): AnalyticWorldInfo => createAnalyticWorld((l.world as { spec: AnalyticWorldSpec }).spec);
const gatesOf = (w: AnalyticWorldInfo): SonicObject[] => w.objects().filter((o) => o.order !== null).sort((a, b) => (a.order as number) - (b.order as number));
const span = (w: AnalyticWorldInfo): number => Math.max(...gatesOf(w).map((g) => g.pos[1])) - Math.min(...gatesOf(w).map((g) => g.pos[1]));

/**
 * The heights at which the craft (the package's radius) passes each ring's opening without a touch, its centre on the
 * ring's axis: the ring's centre height plus or minus half its clear opening less the craft's radius.
 */
const windows = (w: AnalyticWorldInfo): { id: string; lo: number; hi: number }[] =>
    gatesOf(w).map((g) => {
        const half = (g.shape as { diameter: number }).diameter / 2 - BODY_RADIUS_M;
        return { id: g.id, lo: g.pos[1] - half, hi: g.pos[1] + half };
    });

/** Pairs of rings of different levels that one height passes, each without a touch (their windows overlap). */
function sharedHeights(w: AnalyticWorldInfo): string[] {
    const levels = (w.resolved['heights'] as string).split(',');
    const win = windows(w);
    const out: string[] = [];
    for (let i = 0; i < win.length; i++) {
        for (let j = i + 1; j < win.length; j++) {
            const a = win[i]!, b = win[j]!;
            if (levels[Math.min(i, levels.length - 1)] === levels[Math.min(j, levels.length - 1)]) continue;
            const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
            if (lo <= hi) out.push(`${a.id} and ${b.id} at ${lo.toFixed(2)} to ${hi.toFixed(2)} m`);
        }
    }
    return out;
}

/** The legs whose height change cannot be flown before the gate at the lesson's caps (climb over the leg's time at the speed cap). */
function tooSteep(l: Pick<LessonDef, 'assists' | 'start'>, w: AnalyticWorldInfo): string[] {
    const v = l.assists.maxSpeedMps as number, climb = l.assists.maxClimbMps as number;
    const out: string[] = [];
    let from = l.start.pos;
    for (const g of gatesOf(w)) {
        const leg = Math.hypot(g.pos[0] - from[0], g.pos[2] - from[2]);
        const rise = Math.abs(g.pos[1] - from[1]);
        // the rise must be done 1.5 m before the gate (its approach checkpoint): at full stick from a hover
        if (fullStickSeconds(rise, climb, 'vertical') > fullStickSeconds(Math.max(0, leg - 1.5), v, 'horizontal')) out.push(`${g.id}: ${rise.toFixed(2)} m in ${leg.toFixed(2)} m`);
        from = g.pos;
    }
    return out;
}

describe('rings at different heights (M41-22)', () => {
    const lesson = getLesson('rings-heights');
    const w = worldOf(lesson);
    const h = w.resolved['heightM'] as number;

    it('comes after rings-small and before rings-course, in module 5, new in v0.13', () => {
        const full = lessonPaths().full;
        expect(full.slice(full.indexOf('rings-small'), full.indexOf('rings-small') + 3)).toEqual(['rings-small', 'rings-heights', 'rings-course']);
        expect(lesson.module).toBe(5);
        expect(lesson.format).toBe('shramko-sonic-lesson/2');
        expect(lesson.version).toBe(1);
        expect(NEW_LESSONS).toContain('rings-heights');
        expect(lesson.world.kind === 'analytic' && lesson.world.spec.generator === 'rings' && lesson.world.spec.version === 2).toBe(true);
        // the layers of a gate lesson: the target tone it teaches, and the height tone and the room bed every flying lesson has (review M7)
        expect(lesson.layers.on).toEqual(['safety', 'height', 'target', 'room', 'voice']);
    });

    it('puts every ring at its asked level: floor, middle and ceiling, each used, far apart', () => {
        const levels = (w.resolved['heights'] as string).split(',');
        const gates = gatesOf(w);
        expect(gates).toHaveLength(levels.length);
        gates.forEach((g, i) => {
            const reach = shapeHalfExtents(g.shape)[1];
            const want = levels[i] === 'floor' ? FLOOR_MARGIN_M + reach : levels[i] === 'ceiling' ? h - FLOOR_MARGIN_M - reach : h / 2;
            expect(g.pos[1], g.id).toBeCloseTo(want, 9);
        });
        expect(new Set(levels)).toEqual(new Set(['floor', 'middle', 'ceiling']));
        expect(span(w)).toBeGreaterThanOrEqual(1.5);
        // every leg changes the height, but for the first ring, at the height of the start
        expect(gates[0]!.pos[1]).toBe(lesson.start.pos[1]);
        for (let i = 1; i < gates.length; i++) expect(Math.abs(gates[i]!.pos[1] - gates[i - 1]!.pos[1]), gates[i]!.id).toBeGreaterThanOrEqual(1);
        // control: the rings of rings-line are all at one height
        expect(span(worldOf(getLesson('rings-line')))).toBeLessThan(1e-9);
    });

    it('no one height passes rings of two levels: each level is its own band of heights (review M3); control: the 2 m rings it had', () => {
        expect(sharedHeights(w)).toEqual([]);
        // the bands of the three levels, in order, with room between them
        const win = windows(w);
        const band = (level: string): { lo: number; hi: number } => win[(w.resolved['heights'] as string).split(',').indexOf(level)]!;
        expect(band('floor').hi).toBeLessThan(band('middle').lo);
        expect(band('middle').hi).toBeLessThan(band('ceiling').lo);
        // control: the same lesson with its first rings of 2 m (fef8869; in the room and order of merge item 8h of s13-merge,
        // 5.4 m high, middle, floor, middle, ceiling, middle): 2 m passes four of the five, as 1.62 to 2.38 m did then
        const spec = (lesson.world as { spec: AnalyticWorldSpec }).spec;
        const first = createAnalyticWorld({ ...spec, params: { ...spec.params, sizeM: 2 } });
        expect(sharedHeights(first).length).toBeGreaterThan(0);
        const common = windows(first).filter((x) => x.lo <= 2 && x.hi >= 2).map((x) => x.id);
        expect(common).toEqual(['ring-1', 'ring-2', 'ring-3', 'ring-5']);
    });

    it('keeps every ring inside the room: 1 m from the walls, 0.3 m from the floor and the ceiling', () => {
        const room = w.cavities![0]!;
        for (const g of gatesOf(w)) {
            const [ex, ey, ez] = shapeHalfExtents(g.shape);
            const side = Math.hypot(ex, ez);
            expect(Math.abs(g.pos[0] - room.cx) + side + WALL_MARGIN_M, g.id).toBeLessThanOrEqual(room.hx + 1e-9);
            expect(Math.abs(g.pos[2] - room.cz) + side + WALL_MARGIN_M, g.id).toBeLessThanOrEqual(room.hz + 1e-9);
            expect(g.pos[1] - ey, g.id).toBeGreaterThanOrEqual(room.cy - room.hy + FLOOR_MARGIN_M - 1e-9);
            expect(g.pos[1] + ey, g.id).toBeLessThanOrEqual(room.cy + room.hy - FLOOR_MARGIN_M + 1e-9);
        }
    });

    it('can be flown: each height change fits its leg at the caps, and the truth bot passes in at most 2 x r', () => {
        expect(tooSteep(lesson, w)).toEqual([]);
        const p = new ScriptedPilot(lesson);
        playLesson(p, () => 'truth', 2 * lesson.pass.required);
        expect(p.run.phase, p.results()).toBe('passed');
        expect(p.of('touch')).toEqual([]);
        expect(p.of('gate').map((g) => g.gateId).slice(0, 5)).toEqual(gatesOf(w).map((g) => g.id));
        // control: the same rings 2 m apart: the climb from the floor to the ceiling does not fit the leg
        const spec = (lesson.world as { spec: AnalyticWorldSpec }).spec;
        const tight = createAnalyticWorld({ ...spec, params: { ...spec.params, spacingM: 2 } });
        expect(tooSteep(lesson, tight).length).toBeGreaterThan(0);
    }, 120000);

    it('the intro says that the second, steady tone is the next ring\'s height, and the same tone the right height', () => {
        const en = createTranslator('en', DICTS);
        const text = lesson.intro.map((x) => en.text(x)).join(' ');
        expect(text).toMatch(/second, steady tone is the height of the next ring/);
        expect(text).toMatch(/two tones sound the same, you are at the right height/);
        // every language says it (the keys exist and differ from English)
        for (const locale of ['es', 'pl', 'ru'] as const) {
            const tr = createTranslator(locale, DICTS);
            expect(lesson.intro.map((x) => tr.text(x)).join(' ')).not.toBe(text);
        }
    });

    it('version 2 of the other gate generators takes the same heights', () => {
        for (const g of ['squares', 'cube-frames'] as const) {
            const world = createAnalyticWorld(makeSpec(g, { layout: 'line', count: 3, sizeM: 1.5, heightM: 5, depthM: 31, heights: 'floor,middle,ceiling' }, 0, 2));
            const ys = gatesOf(world).map((x) => x.pos[1]);
            expect(ys[0]!).toBeLessThan(ys[1]!);
            expect(ys[1]!).toBeLessThan(ys[2]!);
            expect(ys[1]).toBe(2.5);
        }
    });
});
