// Lane sonic-beacon, fixes after the independent review. Held here:
//   - R1: the track beacon is for a goal flown along the track only ('track-end', 'fly-distance'); a goal without a
//     target in a lesson whose version did not change (shapes-cube's shape question after its cube) stays silent as
//     before the lane, and a recording of such a lesson made before the lane replays as pass;
//   - R2: the headphone check's "behind" and the ears-game scene from behind are planned from behind (no fold, no side
//     boost, no octave): a preview or a module-0 scene tells the true direction it names.
import { describe, expect, it } from 'vitest';
import type { LessonDef, Question, RunnerAction, SonicPrefs, Vec3 } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { demoFrame } from '../src/lesson/runner';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { checkSession } from '../src/replay';
import { getBuiltinTheme } from '../src/theme';
import { quatRotate } from '../src/util/vec';
import type { AnalyticWorldInfo } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';
import { RecordingHost } from './helpers/record';
import { playLesson, truthAnswerer } from './helpers/truth';

const theme = getBuiltinTheme('soft');
const prefsWith = (beacon: boolean | undefined): SonicPrefs => {
    const { beacon: _drop, ...rest } = defaultPrefs();
    return (beacon === undefined ? rest : { ...rest, beacon }) as SonicPrefs;
};
/** the lessons whose version the lane raised (the target layer switched on): every other one must sound as before */
const CHANGED = new Set(['corridor', 'tunnel-wide', 'tunnel-narrow', 'tunnel-narrower', 'tunnel-bends', 'tunnel-gaps', 'tunnel-long']);

/** shapes-cube: fly through the cube, stop `pastM` past it, answer the shape question `answerAfterMs` after it is asked */
function cubeHost(options: { oldHost: boolean; pastM: number; answerAfterMs: number }): RecordingHost {
    const host = new RecordingHost(getLesson('shapes-cube'), { prefs: prefsWith(undefined), oldHost: options.oldHost, answerAfterMs: options.answerAfterMs });
    host.begin();
    host.until(() => host.runner.phase === 'flying', 120);
    const cube = (host.world as AnalyticWorldInfo).objects().find((o) => o.order !== null);
    if (cube === undefined) throw new Error('shapes-cube has no gate');
    const f = quatRotate(cube.quat, [0, 0, -1]);
    const at = (k: number): Vec3 => [cube.pos[0] + f[0] * k, cube.pos[1] + f[1] * k, cube.pos[2] + f[2] * k];
    host.flyTo(at(-4), 3);
    host.flyTo(at(options.pastM), 3);
    return host;
}

describe('R1: the track beacon only for a goal flown along the track', () => {
    it('shapes-cube: a pilot who stops 0.4 m past the cube hears no beacon during the shape question', () => {
        const host = cubeHost({ oldHost: false, pastM: 0.4, answerAfterMs: 12000 });
        let frames = 0;
        let differ = 0;
        for (let i = 0; i < 100 && host.runner.phase === 'flying'; i++) {
            host.hold(0.1);
            frames++;
            if ((host.runner.beaconTarget?.() ?? null) !== host.runner.target()) differ++;
        }
        expect(frames).toBeGreaterThan(20);
        expect(differ).toBe(0);
    });

    it('shapes-cube recorded by a host from before the lane, answered 1.2, 6 and 12 s late, replays as pass', async () => {
        for (const answerAfterMs of [1200, 6000, 12000]) {
            const host = cubeHost({ oldHost: true, pastM: 0.4, answerAfterMs });
            host.until(() => host.runner.phase !== 'flying', 60);
            host.hold(1);
            const pkg = (await host.toPackage()).pkg;
            expect('beacon' in pkg.manifest.settings).toBe(false);
            expect(checkSession(pkg).check.verdict, `answer after ${answerAfterMs} ms`).toBe('pass');
        }
    });

    it('every shipped lesson whose version did not change: beaconTarget() is target() in every frame, the pilot answering 6 s late', () => {
        const swept: string[] = [];
        for (const lesson of SHIPPED_LESSON_IDS.map((id): LessonDef => getLesson(id))) {
            if (CHANGED.has(lesson.id) || lesson.world.kind !== 'analytic') continue;
            const p = new ScriptedPilot(lesson);
            const truth = truthAnswerer(p);
            // the pilot answers 6 s after a question, not in the tick it is asked (the truth bot's habit)
            Object.defineProperty(p, 'answerer', { get: () => null, set: () => undefined });
            let seen = 0;
            const pending: { q: Question; at: number }[] = [];
            let frames = 0;
            let differ = 0;
            const tick = p.tick.bind(p);
            p.tick = () => {
                tick();
                for (; seen < p.log.length; seen++) {
                    const e = p.log[seen] as { action?: RunnerAction };
                    if (e.action?.kind === 'ask') pending.push({ q: e.action.question, at: p.t });
                }
                while (pending.length > 0 && p.t - (pending[0] as { at: number }).at >= 6000) {
                    const x = pending.shift() as { q: Question };
                    p.record(p.run.answer(truth(x.q, null), 'key', p.t));
                }
                frames++;
                if ((p.run.beaconTarget?.() ?? null) !== p.run.target()) differ++;
            };
            playLesson(p, () => 'truth', 2);
            expect(differ, lesson.id).toBe(0);
            expect(frames, lesson.id).toBeGreaterThan(10);
            swept.push(lesson.id);
        }
        expect(swept).toContain('shapes-cube');
        expect(swept.length).toBeGreaterThanOrEqual(15);
    });
});

describe('R2: a preview and a module-0 scene keep the true direction', () => {
    const humOf = (prefs: SonicPrefs, frame: (p: CuePlanner) => ReturnType<CuePlanner['plan']>, layers = getLesson('ears-game').layers) => {
        const p = new CuePlanner({ theme, prefs, layers });
        return frame(p).voices.find((v) => v.cue === 'target.hum');
    };
    const NEUTRAL = { t: 0, tick: 0, pos: [0, 1.5, 0] as Vec3, vel: [0, 0, 0] as Vec3, quat: [1, 0, 0, 0] as const, rate: [0, 0, 0] as Vec3, yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0] as const, armed: false, touched: false, paused: false };
    /** the start screen's headphone check: one still frame of the target layer, then the cue preview target.hum from `dir` */
    const headphone = (prefs: SonicPrefs, dir: Vec3) =>
        humOf(
            prefs,
            (p) => {
                p.plan({ sample: NEUTRAL as never, world: null, target: null, floorY: 0 });
                p.cue({ kind: 'preview', cue: 'target.hum', dir }, 0);
                return p.plan({ sample: { ...NEUTRAL, t: 500, tick: 500 } as never, world: null, target: null, floorY: 0 });
            },
            { on: ['target'], heightBandM: null, hazardVoices: 0 }
        );
    const scene = (prefs: SonicPrefs, dir: Vec3) => humOf(prefs, (p) => p.plan(demoFrame({ cue: 'target.hum', dir, moving: false, durS: 4 } as never, 1, 1000)));

    it('the headphone check "behind" is planned from behind, as with the beacon off', () => {
        for (const beacon of [true, false, undefined]) {
            const v = headphone(prefsWith(beacon), [0, 0, 1]);
            expect(v, `beacon ${beacon}`).toBeDefined();
            expect(v?.dir[2]).toBeGreaterThan(0.9);
            expect(Math.abs(v?.dir[0] ?? 1)).toBeLessThan(1e-9);
            expect(v?.ildDb).toBe(headphone(prefsWith(false), [0, 0, 1])?.ildDb);
        }
    });

    it('ears-game: the hum from behind, the sides and the front is planned as with the beacon off (one pitch, true side)', () => {
        for (const dir of [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 0, -1]] as Vec3[]) {
            const on = scene(prefsWith(true), dir);
            const off = scene(prefsWith(false), dir);
            expect(on, `${dir}`).toBeDefined();
            expect(on?.dir, `${dir}`).toEqual(off?.dir);
            expect(on?.hz, `${dir}`).toBe(off?.hz);
            expect(on?.ildDb, `${dir}`).toBe(off?.ildDb);
        }
    });
});
