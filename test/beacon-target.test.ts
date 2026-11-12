// Lane sonic-beacon, stage S2 (the package): where the beacon points where the goal has no gate, the preview of the
// target after the next one after a gate, the target layer in the corridor and the tunnels as new lesson versions, and
// the preference in the recording and its replay. The owner's complaint of 2026-11-10: in the tunnels "we only hear the
// walls" and do not know where to fly. Held here:
//   - runner.beaconTarget(): the gate or zone of target() when the goal has one; else the next point of the track, the
//     next corner or a point at least BEACON_AHEAD_M ahead; in a tunnel flown by the truth bot the straight line from
//     the craft to that point never runs through a wall (the beacon never calls through a wall);
//   - the planner hums at SonicFrameInput.beacon with the beacon on, at `target` without the field or with it off;
//   - after a gate, one note of the hum from the folded direction of the target after the next one, 0.4 s, 10 dB under
//     the gate note; nothing with the beacon off;
//   - recordings: one made before this lane (old host, no `beacon` key, the tunnel's old lesson version) replays as
//     older-build, an untouched lesson's as pass (with the preview derived); beacon off and beacon on both pass, and the
//     replay reads the recorded setting (a control with the setting flipped fails).
import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, LessonDef, SonicObject, SonicPrefs, Vec3, WorldCheckpoint } from '../src/contract';
import { BEACON_AHEAD_M, CuePlanner, foldToFront, lineClear, PREVIEW_NEXT_DB, PREVIEW_NEXT_S, trackCorners } from '../src/cues';
import { createLessonRunner, getLesson } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { checkSession } from '../src/replay';
import type { SessionPackage } from '../src/session';
import { getBuiltinTheme } from '../src/theme';
import { quatRotate, yawQuat } from '../src/util/vec';
import type { AnalyticWorldInfo } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';
import { RecordingHost, type HostOptions } from './helpers/record';
import { playLesson } from './helpers/truth';

const theme = getBuiltinTheme('soft');
const prefsWith = (beacon: boolean | undefined): SonicPrefs => {
    const { beacon: _drop, ...rest } = defaultPrefs();
    return (beacon === undefined ? rest : { ...rest, beacon }) as SonicPrefs;
};
const sample = (pos: Vec3, yawDeg = 0, t = 1000): FlightSample => ({ t, tick: t, pos, vel: [0, 0, 0], quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });
const zone = (id: string, pos: Vec3): SonicObject => ({ id, shape: { kind: 'zone', size: [1, 1, 1] }, pos, quat: [1, 0, 0, 0], order: null, solid: false, material: 'obstacle' });
const TUNNELS = ['corridor', 'tunnel-wide', 'tunnel-narrow', 'tunnel-narrower', 'tunnel-bends', 'tunnel-gaps', 'tunnel-long'];

describe('runner.beaconTarget(): where the beacon points (decision 5)', () => {
    it('in every tunnel and the corridor the truth bot hears a beacon in every flying frame, never through a wall, at a corner or at least 6 m ahead', () => {
        const counts: Record<string, { flying: number; badPoint: number; throughWall: number }> = {};
        for (const id of TUNNELS) {
            const lesson = getLesson(id);
            const p = new ScriptedPilot(lesson);
            let flying = 0;
            let withBeacon = 0;
            let throughWall = 0;
            let badPoint = 0;
            let steppedBack = 0;
            const tick = p.tick.bind(p);
            p.tick = () => {
                tick();
                if (p.run.phase !== 'flying') return;
                flying++;
                expect(p.run.target(), id).toBeNull();
                const b = p.run.beaconTarget?.() ?? null;
                if (b === null) return;
                withBeacon++;
                const w = p.world as AnalyticWorldInfo;
                const list = w.checkpoints as WorldCheckpoint[];
                const k = list.findIndex((c) => b.id === `beacon:${(c as { id?: string }).id ?? ''}` || (c.pos[0] === b.pos[0] && c.pos[1] === b.pos[1] && c.pos[2] === b.pos[2]));
                const pos = p.sample(false).pos;
                const far = Math.hypot(b.pos[0] - pos[0], b.pos[1] - pos[1], b.pos[2] - pos[2]);
                // a nearer point only where the line to the one after it runs through a solid (the craft beside a pillar)
                const stepped = k >= 0 && k + 1 < list.length && !lineClear(w.sdf, pos, (list[k + 1] as WorldCheckpoint).pos);
                if (stepped) steppedBack++;
                if (k < 0 || !(trackCorners(list.map((c) => c.pos)).includes(k) || far >= BEACON_AHEAD_M || k === list.length - 1 || stepped)) badPoint++;
                // the straight line from the craft to the beacon point, every 0.1 m: free of every wall
                const n = Math.ceil(far / 0.1);
                for (let i = 1; i < n; i++) {
                    const u = i / n;
                    if (w.sdf(pos[0] + u * (b.pos[0] - pos[0]), pos[1] + u * (b.pos[1] - pos[1]), pos[2] + u * (b.pos[2] - pos[2])) <= 0) {
                        throughWall++;
                        break;
                    }
                }
            };
            playLesson(p, () => 'truth', lesson.pass.required);
            expect(p.run.phase, id).toBe('passed');
            expect(flying, id).toBeGreaterThan(100);
            expect(withBeacon, id).toBe(flying);
            counts[id] = { flying, badPoint, throughWall };
            if (id === 'corridor') expect(steppedBack, id).toBeGreaterThan(0); // the pillars: the step back is exercised
        }
        expect(counts).toEqual(Object.fromEntries(TUNNELS.map((id) => [id, { flying: counts[id]?.flying, badPoint: 0, throughWall: 0 }])));
    });

    it('a goal with a gate or a zone: the beacon is target() itself', () => {
        for (const id of ['rings-course', 'move-stop']) {
            const lesson = getLesson(id);
            const p = new ScriptedPilot(lesson);
            let frames = 0;
            const tick = p.tick.bind(p);
            p.tick = () => {
                tick();
                if (p.run.phase !== 'flying') return;
                frames++;
                expect(p.run.beaconTarget?.(), id).toBe(p.run.target());
            };
            playLesson(p, () => 'truth', 1);
            expect(frames, id).toBeGreaterThan(10);
        }
    });

    it('a lesson with no track and no target has no beacon (walls-hall: still silent about direction)', () => {
        const run = createLessonRunner(getLesson('walls-hall'));
        expect(run.beaconTarget?.()).toBeNull();
    });
});

describe('the planner hums at SonicFrameInput.beacon (contract)', () => {
    const layers = getLesson('tunnel-wide').layers;
    const humDir = (prefs: SonicPrefs, input: { target: SonicObject | null; beacon?: SonicObject | null }): Vec3 | null => {
        const planner = new CuePlanner({ theme, prefs, layers });
        const plan = planner.plan({ sample: sample([0, 1.5, 0]), world: null, floorY: 0, ...input });
        return plan.voices.find((v) => v.cue === 'target.hum')?.dir ?? null;
    };
    const left = zone('beacon:left', [-10, 1.5, 0]);
    const ahead = zone('gate-ahead', [0, 1.5, -10]);

    it('with the beacon on it points where the field says, and the field absent leaves it at the target', () => {
        expect(humDir(prefsWith(true), { target: null, beacon: left })?.[0]).toBeCloseTo(-1, 6);
        expect(humDir(prefsWith(undefined), { target: ahead, beacon: left })?.[0]).toBeCloseTo(-1, 6);
        expect(humDir(prefsWith(true), { target: ahead })?.[2]).toBeCloseTo(-1, 6);
        expect(humDir(prefsWith(true), { target: null })).toBeNull();
        expect(humDir(prefsWith(true), { target: ahead, beacon: null })).toBeNull();
    });

    it('with the beacon off the field is ignored: the plan is the one without it', () => {
        const off = prefsWith(false);
        const a = new CuePlanner({ theme, prefs: off, layers }).plan({ sample: sample([0, 1.5, 0]), world: null, floorY: 0, target: ahead, beacon: left });
        const b = new CuePlanner({ theme, prefs: off, layers }).plan({ sample: sample([0, 1.5, 0]), world: null, floorY: 0, target: ahead });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(humDir(off, { target: null, beacon: left })).toBeNull();
    });
});

describe('the preview of the target after the next one, after a gate (decision 7)', () => {
    const layers = getLesson('rings-course').layers;
    const behindLeft: Vec3 = [-Math.SQRT1_2, 0, Math.SQRT1_2];
    const gate = (nextDir?: Vec3): CueEvent => (nextDir === undefined ? { kind: 'gate', index: 0, of: 3 } : { kind: 'gate', index: 0, of: 3, nextDir });

    it('one note of the hum, 0.4 s, 10 dB under the gate note, after it, from the folded direction', () => {
        const planner = new CuePlanner({ theme, prefs: prefsWith(true), layers });
        const notes = planner.cue(gate(behindLeft), 0);
        const gateNote = notes.find((n) => n.cue === 'target.note' && n.gainDb === -3);
        const preview = notes.filter((n) => n.cue === 'target.hum');
        expect(gateNote).toBeDefined();
        expect(preview).toHaveLength(1);
        const p = preview[0]!;
        expect(p.durS).toBe(PREVIEW_NEXT_S);
        expect(p.gainDb).toBe(gateNote!.gainDb + PREVIEW_NEXT_DB);
        expect(p.atS).toBeCloseTo(gateNote!.durS, 9);
        foldToFront(behindLeft).forEach((x, i) => expect(p.dir?.[i]).toBeCloseTo(x, 9));
        expect(p.dir?.[0]).toBeCloseTo(-1, 9);
        expect(p.timbre).toBe(theme.layers.target.timbre);
    });

    it('with the beacon off, or no target after the next one, the gate sounds as before', () => {
        const off = new CuePlanner({ theme, prefs: prefsWith(false), layers }).cue(gate(behindLeft), 0);
        const before = new CuePlanner({ theme, prefs: prefsWith(false), layers }).cue(gate(), 0);
        expect(JSON.stringify(off)).toBe(JSON.stringify(before));
        expect(new CuePlanner({ theme, prefs: prefsWith(true), layers }).cue(gate(), 0).some((n) => n.cue === 'target.hum')).toBe(false);
    });
});

// ------------------------------------------------------------------ recordings and their replay (decision 8)

/** The tunnel as it was before this lane: version 1 (tunnel-wide), the target layer off. */
function oldTunnel(): LessonDef {
    const l = getLesson('tunnel-wide');
    return { ...l, version: l.version - 1, layers: { ...l.layers, on: l.layers.on.filter((x) => x !== 'target') } };
}

async function flyTunnel(lesson: LessonDef, options: HostOptions): Promise<SessionPackage> {
    const host = new RecordingHost(lesson, options);
    host.begin();
    host.until(() => host.runner.phase === 'flying', 300);
    for (const c of (host.world as AnalyticWorldInfo).checkpoints as WorldCheckpoint[]) host.flyTo([c.pos[0], c.pos[1], c.pos[2]], 3);
    host.hold(1.5);
    return (await host.toPackage()).pkg;
}

async function flyRings(options: HostOptions): Promise<SessionPackage> {
    const host = new RecordingHost(getLesson('rings-course'), options);
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

const humShare = (frames: readonly (readonly string[])[]): number => frames.filter((c) => c.some((id) => id.startsWith('target.hum'))).length / Math.max(1, frames.length);

describe('the setting in the recording, and the replay of recordings made before and after this lane', () => {
    it('a tunnel recorded before this lane (old host, no beacon key, lesson version 1) replays as older-build, never fail', async () => {
        const pkg = await flyTunnel(oldTunnel(), { prefs: prefsWith(undefined), oldHost: true });
        expect(pkg.manifest.lesson?.version).toBe(getLesson('tunnel-wide').version - 1);
        expect('beacon' in pkg.manifest.settings).toBe(false);
        expect(humShare(pkg.frames.map((f) => f.c))).toBe(0);
        const { check, result } = checkSession(pkg);
        // the shipped version hums the beacon where the old one was silent: this build cannot verify the old flight
        expect(humShare(result.cues)).toBeGreaterThan(0.3);
        expect(check.notes.map((n) => n.code)).toContain('lesson-version');
        expect(check.verdict).toBe('older-build');
    });

    it('an untouched lesson recorded before this lane replays as pass, with the preview after each gate derived', async () => {
        const pkg = await flyRings({ prefs: prefsWith(undefined), oldHost: true });
        const { check } = checkSession(pkg);
        expect(check.verdict).toBe('pass');
        // the replay's planner did sound the preview (the beacon is on for a recording without the key)
        const planner = new CuePlanner({ theme, prefs: pkg.manifest.settings, layers: getLesson('rings-course').layers });
        expect(planner.cue({ kind: 'gate', index: 0, of: 5, nextDir: [0, 0, -1] }, 0).some((n) => n.cue === 'target.hum')).toBe(true);
        const gates = pkg.events.filter((e) => e.kind === 'gate').length;
        expect(gates).toBeGreaterThanOrEqual(3);
    });

    it('beacon off and beacon on are both written into the recording and both replay as pass; the replay reads the setting', async () => {
        const off = await flyTunnel(getLesson('tunnel-wide'), { prefs: prefsWith(false) });
        const on = await flyTunnel(getLesson('tunnel-wide'), { prefs: prefsWith(true) });
        expect(off.manifest.settings.beacon).toBe(false);
        expect(on.manifest.settings.beacon).toBe(true);
        // beacon off: the tunnel's goal has no gate, so the hum stays silent as today; on: it sounds while flying
        expect(humShare(off.frames.map((f) => f.c))).toBe(0);
        expect(humShare(on.frames.map((f) => f.c))).toBeGreaterThan(0.3);
        expect(checkSession(off).check.verdict).toBe('pass');
        expect(checkSession(on).check.verdict).toBe('pass');
        // control: the same flights with the setting flipped in the manifest do not re-derive
        const flip = (pkg: SessionPackage, beacon: boolean): SessionPackage => ({ ...pkg, manifest: { ...pkg.manifest, settings: { ...pkg.manifest.settings, beacon } } });
        expect(checkSession(flip(on, false)).check.verdict).toBe('fail');
        expect(checkSession(flip(off, true)).check.verdict).toBe('fail');
    });
});
