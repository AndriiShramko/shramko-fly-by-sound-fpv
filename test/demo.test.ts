import { describe, expect, it } from 'vitest';
import type { CueEvent, LayerId, LessonLayers, SonicFrameInput, SpeechLine, ThemeDef } from '../src/contract';
import { LAYER_IDS } from '../src/contract';
import { attitudeFromQuat } from '../src/replay';
import { getLesson, type Question } from '../src/lesson';
import { getBuiltinTheme, LAYER_PARAMS, parseTheme, PARAM_ORDER } from '../src/theme';
import { createRng } from '../src/util';
import { createAnalyticWorld, makeSpec } from '../src/world';
import { DemoHost, MAX_FRAME_S, type EngineLike } from '../demo/host';
import { applyEdits, clampParam, exportTheme, isEdited, LAB_RANGES, layerFields, NO_EDITS, type LabEdits } from '../demo/lab-model';
import { BRAKE_TAU_S, DEFAULT_CLIMB_MPS, DEFAULT_SPEED_MPS, DEFAULT_YAW_DPS, NO_STICKS, PointMass, TOUCH_DEBOUNCE_S, type Sticks } from '../demo/sim';

const stick = (s: Partial<Sticks>): Sticks => ({ ...NO_STICKS, ...s });
const fly = (m: PointMass, seconds: number, s: Sticks, dt = 1 / 60): void => {
    for (let i = 0; i < Math.round(seconds / dt); i++) m.step(dt, s);
};
const hall = (): ReturnType<typeof createAnalyticWorld> => {
    const w = getLesson('walls-hall').world;
    if (w.kind !== 'analytic') throw new Error('walls-hall has no analytic world');
    return createAnalyticWorld(w.spec);
};

describe('the point mass', () => {
    const start = { pos: [0, 1.5, 0] as const, yawDeg: 0 };

    it('stays where it is with the sticks centred', () => {
        const m = new PointMass({ start, world: null });
        fly(m, 2, NO_STICKS);
        expect(m.pos).toEqual([0, 1.5, 0]);
        expect(m.speed).toBe(0);
    });

    it('goes where the nose points, to the lesson\'s speed cap, and brakes when the stick is released', () => {
        const m = new PointMass({ start, world: null });
        fly(m, 3, stick({ pitch: 1 }));
        expect(m.pos[2]).toBeLessThan(-15);
        expect(Math.abs(m.pos[0])).toBeLessThan(1e-9);
        expect(m.speed).toBeCloseTo(DEFAULT_SPEED_MPS, 1);
        fly(m, 1.5, NO_STICKS);
        expect(m.speed).toBeLessThan(0.05);
        expect(BRAKE_TAU_S).toBeLessThan(0.3);
        const slow = new PointMass({ start, world: null, assists: { maxSpeedMps: 0.5, maxClimbMps: 1, maxYawDps: 60 } });
        fly(slow, 3, stick({ pitch: 1, roll: 1 }));
        expect(slow.speed).toBeLessThanOrEqual(0.5 + 1e-9);
        const none = new PointMass({ start, world: null, assists: { maxSpeedMps: 0, maxClimbMps: 0, maxYawDps: 0 } });
        fly(none, 2, stick({ pitch: 1, throttle: 1, yaw: 1 }));
        expect(none.pos).toEqual([0, 1.5, 0]);
        expect(none.yawDeg).toBe(0);
    });

    it('does not go faster on a diagonal, strafes, climbs, and turns at the cap', () => {
        const m = new PointMass({ start, world: null });
        fly(m, 3, stick({ pitch: 1, roll: 1 }));
        expect(Math.hypot(m.vel[0], m.vel[2])).toBeLessThanOrEqual(DEFAULT_SPEED_MPS + 1e-9);
        expect(m.pos[0]).toBeGreaterThan(5);
        const c = new PointMass({ start, world: null });
        fly(c, 2, stick({ throttle: 1 }));
        expect(c.pos[1] - 1.5).toBeLessThanOrEqual(DEFAULT_CLIMB_MPS * 2);
        expect(c.pos[1]).toBeGreaterThan(4);
        const h = c.pos[1];
        fly(c, 3, NO_STICKS);
        expect(Math.abs(c.pos[1] - h)).toBeLessThan(0.6); // coasts a little, then holds
        const t = new PointMass({ start, world: null });
        fly(t, 1, stick({ yaw: 1 }));
        expect(t.yawDeg).toBeCloseTo(DEFAULT_YAW_DPS, 0);
        // the sample agrees with itself: the quaternion has the same heading
        const sample = t.sample(1000, 1000);
        expect(attitudeFromQuat(sample.quat).yawDeg).toBeCloseTo(sample.yawDeg, 6);
        expect(sample.sticks).toEqual([0, 0, 0, 1]);
    });

    it('keeps its heading inside -180 to 180 and flies the way the heading says after turning', () => {
        const m = new PointMass({ start, world: null });
        fly(m, 3.2, stick({ yaw: 1 })); // 288 degrees right: heading about -72
        expect(m.yawDeg).toBeGreaterThanOrEqual(-180);
        expect(m.yawDeg).toBeLessThanOrEqual(180);
        const before = m.pos;
        fly(m, 1, stick({ pitch: 1 }));
        const d = [m.pos[0] - before[0], m.pos[2] - before[2]];
        const heading = (Math.atan2(d[0] as number, -(d[1] as number)) * 180) / Math.PI;
        expect(Math.abs(heading - m.yawDeg)).toBeLessThan(8);
    });

    it('is deterministic', () => {
        const run = (): PointMass => {
            const m = new PointMass({ start, world: hall() });
            const rng = createRng(3);
            for (let i = 0; i < 600; i++) m.step(1 / 60, stick({ pitch: rng.range(-1, 1), roll: rng.range(-1, 1), throttle: rng.range(-1, 1), yaw: rng.range(-1, 1) }));
            return m;
        };
        expect(run().pos).toEqual(run().pos);
    });

    it('slides along a wall and the floor and never gets inside them: one soft touch, not a stream of them', () => {
        const world = hall();
        const m = new PointMass({ start, world });
        let touches = 0;
        let worst = Infinity;
        for (let i = 0; i < 60 * 12; i++) {
            // forward into the wall for 6 s, back off for 2 s, then down onto the floor
            const sticks = i < 60 * 6 ? stick({ pitch: 1 }) : i < 60 * 8 ? stick({ pitch: -1 }) : stick({ throttle: -1 });
            m.step(1 / 60, sticks);
            if (m.sample(i * 16, i * 16).touched) touches++;
            worst = Math.min(worst, world.sdf(...m.pos));
        }
        expect(worst).toBeGreaterThan(0.12 - 1e-3);
        expect(m.pos[2]).toBeGreaterThan(-30); // the front wall is at z = -30
        expect(touches).toBe(2); // the wall, then the floor
        expect(m.pos[1]).toBeGreaterThan(0.1);
    });

    it('reports a touch again only after the craft was free of the surface for the debounce time', () => {
        const world = hall();
        const m = new PointMass({ start: { pos: [0, 1.5, -26], yawDeg: 0 }, world });
        const times: number[] = [];
        // push into the wall for 2.5 s, back off for a second, butt again, three times
        for (let i = 0; i < 60 * 12; i++) {
            const phase = i % 240;
            m.step(1 / 60, phase < 150 ? stick({ pitch: 1 }) : phase < 210 ? stick({ pitch: -1 }) : NO_STICKS);
            if (m.sample(i * 16.667, i).touched) times.push(i / 60);
        }
        expect(times.length).toBe(3);
        for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(TOUCH_DEBOUNCE_S);
        // control: a craft that stays in contact (a push that does not let go) is one touch, however long it lasts
        const pressing = new PointMass({ start: { pos: [0, 1.5, -26], yawDeg: 0 }, world });
        let n = 0;
        for (let i = 0; i < 60 * 10; i++) {
            pressing.step(1 / 60, stick({ pitch: 1 }));
            if (pressing.sample(i * 16.667, i).touched) n++;
        }
        expect(n).toBe(1);
    });

    it('stays inside the corridor under random sticks for a minute (and, control: with no world it flies out)', () => {
        const spec = makeSpec('corridor', { layout: 'full', straightM: 50 }, 0);
        const world = createAnalyticWorld(spec);
        const rng = createRng(11);
        const m = new PointMass({ start: world.start, world });
        let worst = Infinity;
        let s = NO_STICKS;
        for (let i = 0; i < 60 * 60; i++) {
            if (i % 30 === 0) s = stick({ pitch: rng.range(-0.2, 1), roll: rng.range(-1, 1), throttle: rng.range(-1, 1), yaw: rng.range(-1, 1) });
            m.step(1 / 60, s);
            worst = Math.min(worst, world.sdf(...m.pos));
        }
        expect(worst).toBeGreaterThan(0.12 - 1e-3);
        // control: the same wall pushed with no world goes through it, so the collision tests above can fail
        const through = new PointMass({ start, world: null });
        fly(through, 8, stick({ pitch: 1 }));
        expect(hall().sdf(...through.pos)).toBeLessThan(0);
    });

    it('places the craft with no speed', () => {
        const m = new PointMass({ start, world: null });
        fly(m, 1, stick({ pitch: 1, yaw: 1 }));
        m.place({ pos: [5, 2, 5], yawDeg: 30 });
        expect(m.pos).toEqual([5, 2, 5]);
        expect(m.yawDeg).toBe(30);
        expect(m.speed).toBe(0);
    });
});

/** An engine that records what it is told. `say` waits for `finishLines()` when `manual` is set. */
function fakeEngine(manual: boolean): { engine: EngineLike; said: string[]; cues: CueEvent[]; layers: LessonLayers[]; updates: SonicFrameInput[]; finishLines: () => void } {
    const said: string[] = [];
    const cues: CueEvent[] = [];
    const layers: LessonLayers[] = [];
    const updates: SonicFrameInput[] = [];
    let waiting: (() => void)[] = [];
    const engine: EngineLike = {
        update: (i) => void updates.push(i),
        cue: (e) => void cues.push(e),
        say: (line: SpeechLine) => {
            said.push(line.key);
            return manual ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve();
        },
        setLayers: (l) => void layers.push(l)
    };
    return {
        engine,
        said,
        cues,
        layers,
        updates,
        finishLines: () => {
            const w = waiting;
            waiting = [];
            for (const f of w) f();
        }
    };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Runs `seconds` of frames at 60 Hz from page time `t`; returns the new time. */
async function run(host: DemoHost, t: number, seconds: number, sticks: Sticks = NO_STICKS): Promise<number> {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
        t += 1000 / 60;
        host.frame(t, 1 / 60, sticks);
        if (i % 30 === 0) await settle();
    }
    await settle();
    return t;
}

describe('the demo host', () => {
    it('opens a lesson: layers set, the intro said line by line, the attempt starts when the speech queue runs empty', async () => {
        const f = fakeEngine(true);
        const host = new DemoHost({ engine: f.engine, locale: 'en' });
        host.open('hover-height', 0);
        expect(f.layers).toEqual([getLesson('hover-height').layers]);
        expect(f.said).toEqual(['lesson.hover-height.title', 'lesson.hover-height.intro.1', 'lesson.hover-height.intro.2', 'lesson.hover-height.goal.1']);
        expect(host.state().phase).toBe('intro');
        let t = await run(host, 0, 1);
        expect(host.state().phase).toBe('intro'); // the lines are still being spoken
        f.finishLines();
        t = await run(host, t, 0.1);
        expect(host.state().phase).toBe('flying');
        expect(host.state().attempt).toBe(1);
        expect(host.events.map((e) => (e.kind === 'lesson' ? e.what : e.kind))).toEqual(['open', 'intro', 'attempt-start']);
        expect(f.updates.length).toBeGreaterThan(30);
    });

    it('N skips the speech at once, and R and Shift+R send the craft back', async () => {
        const f = fakeEngine(true);
        const host = new DemoHost({ engine: f.engine, locale: 'en' });
        host.open('hover-height', 0);
        host.next();
        expect(host.state().phase).toBe('flying');
        let t = await run(host, 0, 1, stick({ throttle: 1 }));
        expect(host.state().heightM).toBeGreaterThan(0.5);
        host.reset('start');
        expect(host.state().pos).toEqual(getLesson('hover-height').start.pos);
        t = await run(host, t, 0.5);
        host.reset('checkpoint');
        expect(host.state().pos).toEqual(getLesson('hover-height').start.pos);
        expect(host.events.filter((e) => e.kind === 'reset')).toHaveLength(2);
    });

    it('passes hover-height by flying into the band and holding it for 20 s', async () => {
        const f = fakeEngine(false);
        const host = new DemoHost({ engine: f.engine, locale: 'en' });
        host.open('hover-height', 0);
        let t = await run(host, 0, 1);
        expect(host.state().phase).toBe('flying');
        const band = getLesson('hover-height').layers.heightBandM as readonly [number, number];
        for (let i = 0; i < 60 * 10 && host.state().heightM < (band[0] + band[1]) / 2; i++) t = await run(host, t, 1 / 60, stick({ throttle: 1 }));
        expect(host.state().heightM).toBeGreaterThanOrEqual(band[0]);
        t = await run(host, t, 22);
        const kinds = host.events.map((e) => (e.kind === 'lesson' ? e.what : e.kind === 'goal' ? `goal ${e.what}` : e.kind));
        expect(kinds).toContain('goal met');
        expect(kinds).toContain('attempt-pass');
        expect(f.cues.some((c) => c.kind === 'checkpoint')).toBe(true);
    }, 60000);

    it('asks module 0 questions through the page and takes the digit as the answer', async () => {
        const f = fakeEngine(false);
        const asked: (Question | null)[] = [];
        const host = new DemoHost({ engine: f.engine, locale: 'en', ui: { ask: (q) => void asked.push(q) } });
        host.open('ears-headphones', 0);
        let t = await run(host, 0, 1);
        host.next(); // skip the intro
        for (let i = 0; i < 60 * 20 && !host.state().asking; i++) t = await run(host, t, 0.25);
        expect(host.state().asking).toBe(true);
        expect(asked.at(-1)?.options).toBe(3);
        host.answer(1);
        expect(host.state().asking).toBe(false);
        expect(asked.at(-1)).toBeNull();
        expect(host.events.some((e) => e.kind === 'answer' && e.value === 1 && e.via === 'key')).toBe(true);
        // the engine heard a preview of the sound the question is about
        expect(f.cues.some((c) => c.kind === 'preview')).toBe(true);
        // the craft stays where it is in module 0
        expect(host.state().pos).toEqual(getLesson('ears-headphones').start.pos);
        host.answer(2); // no question is open now: ignored
    });

    it('ignores a line that finishes after its lesson was left', async () => {
        const f = fakeEngine(true);
        const host = new DemoHost({ engine: f.engine, locale: 'en' });
        host.open('hover-height', 0);
        host.open('hover-turn', 10);
        const events = host.events.length;
        f.finishLines(); // the first lesson's lines and the second one's: only the second counts
        await settle();
        await settle();
        expect(host.lesson?.id).toBe('hover-turn');
        expect(host.state().phase).toBe('flying');
        expect(host.events.length).toBeGreaterThan(events);
        host.leave();
        expect(host.state().phase).toBe('none');
        expect(host.state().lessonId).toBeNull();
        expect(() => host.open('no-such-lesson', 0)).toThrow(/no lesson/);
    });

    it('takes a long stalled frame as at most one step, and does nothing while paused', async () => {
        const f = fakeEngine(false);
        const host = new DemoHost({ engine: f.engine, locale: 'en' });
        host.open('move-stop', 0);
        host.next();
        host.frame(100, 5, stick({ pitch: 1 }));
        const z = host.state().pos[2];
        expect(Math.abs(z - getLesson('move-stop').start.pos[2])).toBeLessThan(DEFAULT_SPEED_MPS * MAX_FRAME_S + 1e-9);
        host.setPaused(true);
        const updates = f.updates.length;
        host.frame(200, 1 / 60, stick({ pitch: 1 }));
        expect(host.state().pos[2]).toBe(z);
        expect(f.updates.length).toBe(updates);
        expect(host.state().paused).toBe(true);
    });

    it('a lesson with a world hands the engine that world and the floor', async () => {
        const f = fakeEngine(false);
        const host = new DemoHost({ engine: f.engine, locale: 'en' });
        host.open('walls-hall', 0);
        host.next();
        host.frame(20, 1 / 60, NO_STICKS);
        const last = f.updates.at(-1) as SonicFrameInput;
        expect(last.world?.kind).toBe('analytic');
        expect(last.floorY).toBe(0);
        expect(host.lessonWorld).not.toBeNull();
    });
});

describe('the Sound Lab model', () => {
    const themes = (['soft', 'clear', 'race'] as const).map((id) => getBuiltinTheme(id));
    const layerGain = (t: ThemeDef, l: LayerId): number => t.layers[l].gainDb;

    it('with no edits is the theme itself, and exports a file the engine would load', () => {
        for (const base of themes) {
            expect(applyEdits(base, NO_EDITS)).toEqual(base);
            expect(isEdited(NO_EDITS)).toBe(false);
            const r = exportTheme(base, NO_EDITS, { id: `my-${base.id}`, name: `My ${base.id}` });
            expect(r.ok).toBe(true);
            if (r.ok) {
                const back = parseTheme(r.text);
                expect(back.ok).toBe(true);
                if (back.ok) expect(back.value).toEqual({ ...base, id: `my-${base.id}`, name: `My ${base.id}`, version: 1 });
                expect(r.text.endsWith('\n')).toBe(true);
            }
        }
    });

    it('a layer gain edit changes that layer only, within the range', () => {
        const base = getBuiltinTheme('soft');
        const t = applyEdits(base, { ...NO_EDITS, gainDb: { target: -3 } });
        expect(layerGain(t, 'target')).toBe(-3);
        for (const l of LAYER_IDS) if (l !== 'target') expect(t.layers[l]).toEqual(base.layers[l]);
        expect(layerGain(applyEdits(base, { ...NO_EDITS, gainDb: { target: 99 } }), 'target')).toBe(LAB_RANGES.layerGainDb.max);
        expect(layerGain(applyEdits(base, { ...NO_EDITS, gainDb: { target: -99 } }), 'target')).toBe(LAB_RANGES.layerGainDb.min);
        expect(isEdited({ ...NO_EDITS, gainDb: { target: -3 } })).toBe(true);
    });

    it('a pitch shift moves every note parameter of the layer along the scale and nothing else, and stops at the ends', () => {
        const base = getBuiltinTheme('soft');
        const top = base.scale.steps.length * base.scale.octaves; // the scale has this many notes above the root
        const up = applyEdits(base, { ...NO_EDITS, pitch: { safety: 2 } });
        for (const [name, spec] of Object.entries(LAYER_PARAMS.safety)) {
            const was = base.layers.safety.params[name] as number;
            const now = up.layers.safety.params[name] as number;
            if (spec.scaleIndex) expect(now).toBe(Math.min(was + 2, top)); // held inside the scale
            else expect(now).toBe(was);
        }
        for (const l of LAYER_IDS) if (l !== 'safety') expect(up.layers[l]).toEqual(base.layers[l]);
        const down = applyEdits(base, { ...NO_EDITS, pitch: { safety: -50 } });
        for (const [name, spec] of Object.entries(LAYER_PARAMS.safety)) if (spec.scaleIndex) expect(down.layers.safety.params[name]).toBe(0);
        // a shift of 0 is no edit
        expect(isEdited({ ...NO_EDITS, pitch: { safety: 0 } })).toBe(false);
    });

    it('a number set by hand is held to its range, whole when it must be, and sits under the pitch shift', () => {
        const base = getBuiltinTheme('soft');
        const spec = LAYER_PARAMS.safety['pulseMs'] as (typeof LAYER_PARAMS.safety)[string];
        expect(clampParam(spec, 9999, base.scale)).toBe(spec.max);
        expect(clampParam(spec, -5, base.scale)).toBe(spec.min);
        expect(clampParam(spec, Number.NaN, base.scale)).toBe(spec.default);
        const note = LAYER_PARAMS.safety['pitchWallStep'] as (typeof LAYER_PARAMS.safety)[string];
        expect(clampParam(note, 3.6, base.scale)).toBe(4);
        expect(clampParam(note, 1000, base.scale)).toBe(base.scale.steps.length * base.scale.octaves);
        const t = applyEdits(base, { ...NO_EDITS, params: { safety: { pitchWallStep: 4, pulseMs: 120 } }, pitch: { safety: 3 } });
        expect(t.layers.safety.params['pitchWallStep']).toBe(7);
        expect(t.layers.safety.params['pulseMs']).toBe(120);
    });

    it('timbres, surfaces, master and ducking are edited too', () => {
        const base = getBuiltinTheme('clear');
        const edits: LabEdits = { ...NO_EDITS, timbre: { height: 'pad' }, materials: { wall: 'metal' }, master: { gainDb: -20, ceilingDb: -12, fadeInS: 2 }, duckDb: 18 };
        const t = applyEdits(base, edits);
        expect(t.layers.height.timbre).toBe('pad');
        expect(t.materials.wall).toBe('metal');
        expect(t.materials.floor).toBe(base.materials.floor);
        expect(t.master).toEqual({ gainDb: -20, ceilingDb: -12, fadeInS: 2 });
        expect(t.duckDb).toBe(18);
        expect(applyEdits(base, { ...NO_EDITS, master: { ceilingDb: 0 } }).master.ceilingDb).toBe(LAB_RANGES.ceilingDb.max);
        const r = exportTheme(base, edits, { id: 'my-clear', name: 'My clear' });
        expect(r.ok).toBe(true);
    });

    it('lists every parameter of every layer as a control (the schema is the source)', () => {
        for (const l of LAYER_IDS) expect(layerFields(l).map((f) => f.name)).toEqual(Object.keys(LAYER_PARAMS[l]));
        expect(LAYER_IDS.reduce((n, l) => n + layerFields(l).length, 0)).toBeGreaterThan(40);
    });

    it('refuses to export what the engine would refuse, and says where (negative controls)', () => {
        const base = getBuiltinTheme('soft');
        const near = applyEdits(base, { ...NO_EDITS, params: { safety: { periodNearMs: 450, periodFarMs: 300 } } });
        const order = exportTheme(base, { ...NO_EDITS, params: { safety: { periodNearMs: 450, periodFarMs: 300 } } }, { id: 'my-soft', name: 'x' });
        expect(near.layers.safety.params['periodNearMs']).toBe(450);
        expect(order.ok).toBe(false);
        if (!order.ok) expect(order.issues.some((i) => i.path === 'layers.safety.params.periodNearMs')).toBe(true);
        for (const id of ['', 'My Theme', 'a--b', '-a', 'x'.repeat(41)]) {
            const r = exportTheme(base, NO_EDITS, { id, name: 'ok' });
            expect(r.ok, `id '${id}'`).toBe(false);
            if (!r.ok) expect(r.issues.some((i) => i.path === 'id')).toBe(true);
        }
        const noName = exportTheme(base, NO_EDITS, { id: 'my-soft', name: '   ' });
        expect(noName.ok).toBe(false);
        if (!noName.ok) expect(noName.issues.some((i) => i.path === 'name')).toBe(true);
    });

    it('whatever the sliders are set to, an exported file is a valid theme (seeded random edits on every theme)', () => {
        const rng = createRng(21);
        let exported = 0;
        let refused = 0;
        for (let round = 0; round < 150; round++) {
            const base = themes[round % themes.length] as ThemeDef;
            const gainDb: Partial<Record<LayerId, number>> = {};
            const pitch: Partial<Record<LayerId, number>> = {};
            const params: Partial<Record<LayerId, Record<string, number>>> = {};
            for (const l of LAYER_IDS) {
                if (rng.next() < 0.5) gainDb[l] = rng.range(-50, 20);
                if (rng.next() < 0.5) pitch[l] = rng.int(-14, 14);
                if (rng.next() < 0.3) {
                    const fields = layerFields(l);
                    const f = fields[rng.int(0, fields.length - 1)] as (typeof fields)[number];
                    params[l] = { [f.name]: rng.range(f.spec.min - 1, f.spec.max + 1) };
                }
            }
            const r = exportTheme(base, { ...NO_EDITS, gainDb, pitch, params }, { id: 'random-theme', name: 'Random' });
            if (r.ok) {
                exported++;
                const back = parseTheme(r.text);
                expect(back.ok).toBe(true);
            } else refused++;
        }
        // most random edits are fine; those that break an ordering rule are refused, never written
        expect(exported).toBeGreaterThan(50);
        expect(exported + refused).toBe(150);
        expect(PARAM_ORDER.length).toBeGreaterThan(0);
    });
});
