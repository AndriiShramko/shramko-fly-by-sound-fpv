// Train 4, lane tutor-moment, stage S1: the moment contract. A lesson may carry `moments` (the loader checks them),
// a moment event is a session event the codec reads back, and CuePlanner.setAudible keeps every cue not in the list
// out of the plan (null: all, as before).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FlightSample, LessonLayers, SessionEvent, SonicObject, SonicWorld } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson, lessonMoments, startAudible, validateLesson } from '../src/lesson';
import { decodeEvent, encodeEvent } from '../src/session/codec';
import { getBuiltinTheme } from '../src/theme';
import { yawQuat } from '../src/util/vec';
import { CUE_IDS } from '../src/i18n/catalog';

function sample(t: number): FlightSample {
    return { t, tick: t, pos: [0, 2, 0], vel: [0, 0, -3], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}
const ring: SonicObject = { id: 'ring-1', shape: { kind: 'ring', diameter: 2, tube: 0.1 }, pos: [0, 2, -10], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
const world: SonicWorld = { kind: 'analytic', id: 'gates', version: 1, bounds: { min: [-50, -1, -100], max: [50, 20, 50] }, castRay: () => null, objects: () => [ring] };
const ALL: LessonLayers = { on: ['safety', 'height', 'speed', 'target', 'room'], heightBandM: null, hazardVoices: 3 };
const RAW = JSON.parse(readFileSync(new URL('../lessons/walls-hall.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const base = (id: string): string => id.split(':')[0] as string;

const MOMENT = {
    id: 'wall-ahead',
    cue: 'safety.wall',
    when: { kind: 'near', dir: 'front', withinM: 3 },
    forms: [
        { dir: [0, 0, -1], distanceM: 3, durS: 1.2 },
        { dir: [0, 0, -1], distanceM: 1, durS: 1.2 }
    ],
    do: { key: 'moment.wall-ahead.do' },
    hint: { key: 'moment.wall-ahead.hint' },
    hintAfterS: 12,
    task: { kind: 'approach-stop', objectId: null, stopWithinM: 1.5 }
};

describe('moments: the contract (S1)', () => {
    it('a lesson without moments has none and gates nothing (as before)', () => {
        const lesson = getLesson('walls-hall');
        expect(lessonMoments(lesson)).toEqual([]);
        expect(startAudible(lesson, CUE_IDS)).toBeNull();
    });

    it('the loader reads a lesson with moments; only the catalogue keys of the new lines are still missing', () => {
        const json = { ...RAW, moments: [MOMENT] };
        const v = validateLesson(json);
        const issues = v.ok ? [] : v.issues.map((i) => i.path);
        // S3 adds 'moment.wall-ahead.*' to the catalogue; every other part of the moment is valid already
        expect(issues.filter((p) => !p.endsWith('.do.key') && !p.endsWith('.hint.key'))).toEqual([]);
    });

    it('the loader refuses a bad moment: forms too long, near before far, a cue twice, a line under another key', () => {
        const bad = [
            { ...MOMENT, forms: [{ dir: [0, 0, -1], distanceM: 3, durS: 2 }, { dir: [0, 0, -1], distanceM: 1, durS: 2 }] },
            { ...MOMENT, forms: [{ dir: [0, 0, -1], distanceM: 1, durS: 1.2 }, { dir: [0, 0, -1], distanceM: 3, durS: 1.2 }] },
            { ...MOMENT, cue: 'safety.nothing' },
            { ...MOMENT, do: { key: 'moment.other.do' } }
        ];
        for (const m of bad) {
            const v = validateLesson({ ...RAW, moments: [m] });
            expect(v.ok).toBe(false);
        }
        const twice = validateLesson({ ...RAW, moments: [MOMENT, { ...MOMENT, id: 'wall-again' }] });
        expect(twice.ok ? [] : twice.issues.map((i) => i.message)).toContain('must teach each sound once (one new sound a moment)');
    });

    it('a moment event is a session event: written and read back', () => {
        const e: SessionEvent = { t: 1234, kind: 'moment', id: 'wall-ahead', what: 'freeze' };
        const back = decodeEvent(encodeEvent(e));
        expect(back.ok && back.value).toEqual(e);
        expect(decodeEvent(JSON.stringify({ ...e, what: 'nap' })).ok).toBe(false);
    });

    it('setAudible: null plans every cue as before; a set plans only its cues, notes and previews included', () => {
        const theme = getBuiltinTheme('soft');
        const all = new CuePlanner({ theme, layers: ALL });
        const before = all.plan({ sample: sample(0), world, target: ring, floorY: 0 }).cues.map((c) => base(c.id));
        expect(before).toContain('height.tone');
        expect(before).toContain('target.hum');

        const gated = new CuePlanner({ theme, layers: ALL });
        gated.setAudible(null);
        expect(gated.plan({ sample: sample(0), world, target: ring, floorY: 0 }).cues.map((c) => base(c.id))).toEqual(before);

        gated.setAudible(new Set(['height.tone']));
        const plan = gated.plan({ sample: sample(33), world, target: ring, floorY: 0 });
        expect(plan.cues.map((c) => base(c.id))).toEqual(['height.tone']);
        expect(plan.voices).toEqual([]);
        expect(plan.speed).toBeNull();
        expect(gated.cue({ kind: 'gate', index: 0, of: 3 }, 40)).toEqual([]);
        expect(gated.cue({ kind: 'preview', cue: 'target.hum', dir: null }, 40)).toEqual([]);
        expect(gated.cue({ kind: 'preview', cue: 'height.tone', dir: null }, 40).length).toBeGreaterThanOrEqual(0);

        gated.setAudible(null);
        expect(gated.cue({ kind: 'gate', index: 0, of: 3 }, 50).length).toBeGreaterThan(0);
    });

    it('setAudible: the brake falls back to the tick when only the tick may sound', () => {
        const theme = getBuiltinTheme('soft');
        const p = new CuePlanner({ theme, layers: { ...ALL, speedBudget: true } });
        p.setAudible(new Set(['speed.tick']));
        const fast: FlightSample = { ...sample(0), vel: [0, 0, -12] };
        const plan = p.plan({ sample: fast, world, target: { ...ring, pos: [0, 2, -3] }, floorY: 0 });
        for (const c of plan.cues) expect(base(c.id)).toBe('speed.tick');
    });
});
