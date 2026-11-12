// Lane sonic-beacon, stage S4: the listener checks of the beacon that need no render (the rendered ones are VL-B1 to
// VL-B5 of `pnpm listen`, tools/listen/measure.py).
//
// 4.6 Scale: every note of the target hum (off course, the on-course octave) and of the preview after a gate is a note
//     of the theme's scale, in every built-in theme, over every direction, distance and height the test sweeps.
//     Control: the same notes a semitone up are off the scale (the check can fail).
// 4.7 Determinism: a flight recorded with the beacon on (a tunnel: the beacon at a track point; rings-course: the
//     preview after each gate) replays bit for bit: two replays give the same result to the byte, and the replay
//     passes. The runner seed turned out to be no input of these flights (seed 2 replays to the same bytes), so the
//     controls are another flight: the same frames 0.5 m to the right, and the recording with the beacon off; both differ.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, LessonDef, SonicObject, SonicPrefs, Vec3, WorldCheckpoint } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { checkSession } from '../src/replay';
import type { SessionPackage } from '../src/session';
import { BUILTIN_THEME_IDS, getBuiltinTheme } from '../src/theme';
import { isInScale } from '../src/theme/pitch';
import { quatRotate, yawQuat } from '../src/util/vec';
import type { AnalyticWorldInfo } from '../src/world';
import { RecordingHost } from './helpers/record';

const prefsWith = (beacon: boolean): SonicPrefs => ({ ...defaultPrefs(), beacon });
const sample = (pos: Vec3, yawDeg = 0, t = 1000): FlightSample => ({ t, tick: t, pos, vel: [0, 0, 0], quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });
const zone = (id: string, pos: Vec3): SonicObject => ({ id, shape: { kind: 'zone', size: [1, 1, 1] }, pos, quat: [1, 0, 0, 0], order: null, solid: false, material: 'obstacle' });

/** Every hum note the planner gives over a sweep of directions (every 5 degrees round, up and down), distances and heights. */
function humNotes(themeId: (typeof BUILTIN_THEME_IDS)[number], beacon: boolean): { hz: number; onCourse: boolean }[] {
    const theme = getBuiltinTheme(themeId);
    const layers = getLesson('tunnel-wide').layers;
    const out: { hz: number; onCourse: boolean }[] = [];
    for (const dist of [1.5, 5, 12, 40]) {
        for (const dy of [-3, 0, 3]) {
            for (let az = -180; az < 180; az += 5) {
                const planner = new CuePlanner({ theme, prefs: prefsWith(beacon), layers });
                const a = (az * Math.PI) / 180;
                const plan = planner.plan({ sample: sample([0, 2, 0]), world: null, floorY: 0, target: null, beacon: zone('beacon:x', [Math.sin(a) * dist, 2 + dy, -Math.cos(a) * dist]) });
                const v = plan.voices.find((x) => x.cue === 'target.hum');
                if (v !== undefined) out.push({ hz: v.hz, onCourse: Math.abs(az) <= 5 && dy === 0 });
            }
        }
    }
    return out;
}

/** The preview note after a gate, the target after the next one in each of 24 directions round the craft. */
function previewNotes(themeId: (typeof BUILTIN_THEME_IDS)[number]): number[] {
    const theme = getBuiltinTheme(themeId);
    const out: number[] = [];
    for (let az = 0; az < 360; az += 15) {
        const a = (az * Math.PI) / 180;
        const ev: CueEvent = { kind: 'gate', index: 0, of: 3, nextDir: [Math.sin(a), 0, -Math.cos(a)] };
        const notes = new CuePlanner({ theme, prefs: prefsWith(true), layers: getLesson('rings-course').layers }).cue(ev, 0);
        for (const n of notes) if (n.cue === 'target.hum') out.push(n.hz);
    }
    return out;
}

describe('4.6 every note of the hum, its on-course octave and the preview is on the theme\'s scale', () => {
    for (const id of BUILTIN_THEME_IDS) {
        it(`theme ${id}`, () => {
            const scale = getBuiltinTheme(id).scale;
            const hum = humNotes(id, true);
            const preview = previewNotes(id);
            expect(hum.filter((n) => n.onCourse).length).toBeGreaterThan(0);
            expect(hum.filter((n) => !n.onCourse).length).toBeGreaterThan(100);
            expect(preview).toHaveLength(24);
            const all = [...hum.map((n) => n.hz), ...preview];
            const off = all.filter((hz) => !isInScale(scale, hz));
            expect(off, `off-scale notes in ${id}`).toEqual([]);
            // the octave is there: an on-course note is twice an off-course note of the same height and distance
            const onHz = new Set(hum.filter((n) => n.onCourse).map((n) => Math.round(n.hz * 100)));
            expect([...onHz].some((h) => hum.some((n) => !n.onCourse && Math.abs(n.hz * 200 - h) < 2))).toBe(true);
            // control: the same notes a semitone up are off the scale, every one (the check can fail)
            expect(all.filter((hz) => isInScale(scale, hz * 2 ** (1 / 12))).length).toBe(0);
        });
    }
});

// ------------------------------------------------------------------ 4.7 determinism of a recorded flight

async function flyTunnel(lesson: LessonDef): Promise<SessionPackage> {
    const host = new RecordingHost(lesson, { prefs: prefsWith(true) });
    host.begin();
    host.until(() => host.runner.phase === 'flying', 300);
    for (const c of (host.world as AnalyticWorldInfo).checkpoints as WorldCheckpoint[]) host.flyTo([c.pos[0], c.pos[1], c.pos[2]], 3);
    host.hold(1.5);
    return (await host.toPackage()).pkg;
}

async function flyRings(): Promise<SessionPackage> {
    const host = new RecordingHost(getLesson('rings-course'), { prefs: prefsWith(true) });
    host.begin();
    host.until(() => host.runner.phase === 'flying', 120);
    const gates = (host.world as AnalyticWorldInfo).objects().filter((o) => o.order !== null).sort((a, b) => (a.order as number) - (b.order as number));
    for (const g of gates) {
        const f = quatRotate(g.quat, [0, 0, -1]);
        host.flyTo([g.pos[0] - f[0] * 5, g.pos[1] - f[1] * 5, g.pos[2] - f[2] * 5], 4);
        host.flyTo([g.pos[0] + f[0] * 5, g.pos[1] + f[1] * 5, g.pos[2] + f[2] * 5], 4);
    }
    host.hold(1);
    return (await host.toPackage()).pkg;
}

const hashOf = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');

describe('4.7 a flight with the beacon replays bit for bit', () => {
    it.each([['tunnel-wide'], ['rings-course']])('%s', async (id) => {
        const pkg = id === 'rings-course' ? await flyRings() : await flyTunnel(getLesson(id));
        expect(pkg.manifest.settings.beacon).toBe(true);
        expect(pkg.frames.some((f) => f.c.includes('target.hum'))).toBe(true);
        const a = checkSession(pkg);
        const b = checkSession(pkg);
        expect(a.check.verdict).toBe('pass');
        expect(hashOf(a.result)).toBe(hashOf(b.result));
        expect(a.result.cues.length).toBe(pkg.frames.length);
        // the runner seed is no input of these flights: another seed gives the same replay to the byte (measured)
        expect(hashOf(checkSession(pkg, { seed: 2 }).result)).toBe(hashOf(a.result));
        // controls, so the comparison can fail: the same flight 0.5 m to the right, and the recording with the beacon off
        const moved: SessionPackage = { ...pkg, frames: pkg.frames.map((f) => ({ ...f, p: [f.p[0] + 0.5, f.p[1], f.p[2]] as Vec3 })) };
        expect(hashOf(checkSession(moved).result)).not.toBe(hashOf(a.result));
        const off: SessionPackage = { ...pkg, manifest: { ...pkg.manifest, settings: { ...pkg.manifest.settings, beacon: false } } };
        expect(hashOf(checkSession(off).result)).not.toBe(hashOf(a.result));
    });
});
