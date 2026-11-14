// The ear pilot (sonic3 plan section 4, stage Z3): it flies only from what the cues say. These cases hold that it is a
// check of the sound and not of the geometry: with left and right swapped in the ears it cannot fly the lowest rung, a
// deaf pilot cannot fly at all, the flight does not change when every distance in the frame is zeroed, and the pilot's
// files import nothing that knows the world. The swapped and deaf cases are this file's negative controls: the same
// course passes with the true sound.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FramePlan } from '../src/cues/planner';
import { getLesson } from '../src/lesson';
import { flyLesson, LADDER_MPS } from '../src/pilot/ladder';

const lesson = getLesson('rings-course');
const lowest = LADDER_MPS[0] as number;

const swapped = (p: FramePlan): FramePlan => ({
    ...p,
    voices: p.voices.map((v) => ({ ...v, dir: [-v.dir[0], v.dir[1], v.dir[2]] as const }))
});
const deaf = (p: FramePlan): FramePlan => ({ ...p, voices: [], cues: [] });
const noDistance = (p: FramePlan): FramePlan => ({
    ...p,
    voices: p.voices.map((v) => ({ ...v, distance: 0 })),
    cues: p.cues.map((c) => ({ ...c, distance: null }))
});

describe('ear pilot', () => {
    it('flies the rings course at the lowest rung with the true sound', () => {
        for (const seed of [1, 2, 3]) expect(flyLesson(lesson, lowest, seed).why, `seed ${seed}`).toBe('pass');
    });

    it('fails the lowest rung when left and right are swapped in the ears', () => {
        for (const seed of [1, 2, 3]) expect(flyLesson(lesson, lowest, seed, { mapPlan: swapped }).passed, `seed ${seed}`).toBe(false);
    });

    it('fails when it hears nothing', () => {
        expect(flyLesson(lesson, lowest, 1, { mapPlan: deaf }).passed).toBe(false);
    });

    it('does not read distances: zeroed distances give the same flight hash', () => {
        for (const v of [lowest, 3]) {
            const a = flyLesson(lesson, v, 2);
            const b = flyLesson(lesson, v, 2, { mapPlan: noDistance });
            expect(b.hash).toBe(a.hash);
            expect(b.why).toBe(a.why);
        }
    });

    it('its ears and its hands import nothing that knows the world', () => {
        for (const f of ['ear-pilot.ts', 'perceive.ts']) {
            const text = readFileSync(join(__dirname, '..', 'src', 'pilot', f), 'utf8');
            const imports = text.split('\n').filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+'/.test(l));
            expect(imports.length, f).toBeGreaterThan(0);
            for (const l of imports) {
                expect(l, f).not.toMatch(/\/world\b|\/sense\b|SonicWorld/);
            }
            expect(text, f).not.toMatch(/\bSonicWorld\b/);
        }
    });
});
