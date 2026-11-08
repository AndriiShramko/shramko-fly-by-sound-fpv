// The sounds of the shared cue events of v0.13 (plan v13 "Lanes": the runner emits them, the planner owns
// how they sound): 'wrong-way', 'wrong-side' (M41-15), 'praise', 'stage' (M41-11) and 'repeat-cue' (M41-5,
// the named cue's own sound as in the glossary). Each is a short earcon of its own in every built-in theme,
// on the scale, never louder than the safety sound.
import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, LayerId, ThemeDef } from '../src/contract';
import { CuePlanner, eventCue, layerGainDb, PRAISE_FIGURES, REPEAT_CUE_S, type FramePlan, type NotePlan } from '../src/cues';
import { CUE_IDS } from '../src/i18n';
import { defaultPrefs } from '../src/prefs';
import { applyCalm, BUILTIN_THEME_IDS, getBuiltinTheme, isInScale } from '../src/theme';
import { yawQuat } from '../src/util/vec';

const NEW_EVENTS: readonly CueEvent[] = [{ kind: 'wrong-way' }, { kind: 'wrong-side' }, { kind: 'praise' }, { kind: 'stage', stage: 2 }];
const OLD_EVENTS: readonly CueEvent[] = [{ kind: 'reset' }, { kind: 'gate', index: 0, of: 3 }, { kind: 'lap' }, { kind: 'checkpoint' }, { kind: 'fanfare' }, { kind: 'touch', material: 'wall', dir: null, speed: 3 }];

function still(t: number): FlightSample {
    return { t, tick: t, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

const planner = (theme: ThemeDef, calm = false): CuePlanner => new CuePlanner({ theme, prefs: { ...defaultPrefs(), calm }, layers: { on: [], heightBandM: null, hazardVoices: 0 } });

/** What a figure is: when each note starts (10 ms) and which note it is. Two earcons are told apart by it. */
const signature = (notes: readonly NotePlan[]): string => notes.map((n) => `${Math.round(n.atS * 100)}:${n.noteIndex}`).join(' ');

/**
 * The loudest moment of a figure as planned, dB: the layer's bus gain plus each note's own gain, notes that
 * start within 20 ms of each other summed in amplitude. The engine plays a one-off note and a hazard pulse at
 * the same base gain (0.55): the rendered check is the virtual listener's (test-audio/listen).
 */
function plannedPeakDb(theme: ThemeDef, notes: readonly NotePlan[]): number {
    let worst = -Infinity;
    for (const a of notes) {
        let amp = 0;
        for (const b of notes) if (Math.abs(b.atS - a.atS) <= 0.02) amp += 10 ** ((layerGainDb(theme, defaultPrefs(), b.layer as LayerId) + b.gainDb) / 20);
        worst = Math.max(worst, 20 * Math.log10(amp));
    }
    return worst;
}

describe('the event sounds', () => {
    it('every new event has its cue id, with a name and a glossary line', () => {
        expect(NEW_EVENTS.map(eventCue)).toEqual(['safety.wrong-way', 'safety.wrong-side', 'target.praise', 'target.stage']);
        for (const id of ['safety.wrong-way', 'safety.wrong-side', 'target.praise', 'target.stage']) expect(CUE_IDS as readonly string[]).toContain(id);
        expect(eventCue({ kind: 'repeat-cue', cue: 'safety.wall' })).toBe('safety.wall');
    });

    it.each(BUILTIN_THEME_IDS)('%s (and calm): each event is a short figure of its own notes, every one on the scale', (id) => {
        for (const calm of [false, true]) {
            const theme = getBuiltinTheme(id);
            const signatures = new Map<string, string>();
            for (const e of [...NEW_EVENTS, ...OLD_EVENTS]) {
                const notes = planner(theme, calm).cue(e, 0);
                expect(notes.length, e.kind).toBeGreaterThan(0);
                for (const n of notes) {
                    expect(isInScale(theme.scale, n.hz), `${id} ${e.kind} ${n.hz}`).toBe(true);
                    expect(n.cue).toBe(eventCue(e));
                }
                const end = Math.max(...notes.map((n) => n.atS + n.durS));
                expect(end, e.kind).toBeLessThanOrEqual(1.2);
                const sig = signature(notes);
                for (const [kind, other] of signatures) expect(sig, `${e.kind} sounds like ${kind}`).not.toBe(other);
                signatures.set(e.kind, sig);
            }
        }
    });

    it.each(BUILTIN_THEME_IDS)('%s: never louder than the safety sound (a pulse at 1 m), with 3 dB to spare', (id) => {
        for (const theme of [getBuiltinTheme(id), applyCalm(getBuiltinTheme(id))]) {
            const safety = layerGainDb(theme, defaultPrefs(), 'safety');
            for (const e of NEW_EVENTS) {
                const peak = plannedPeakDb(theme, planner(theme).cue(e, 0));
                expect(peak, `${theme.id} ${e.kind}: ${peak.toFixed(1)} dB against ${safety} dB`).toBeLessThanOrEqual(safety - 3);
            }
        }
    });

    it('praise varies: three figures in turn, then again', () => {
        const p = planner(getBuiltinTheme('soft'));
        const figures = [0, 1, 2, 3].map((i) => signature(p.cue({ kind: 'praise' }, i * 1000)));
        expect(new Set(figures.slice(0, 3)).size).toBe(PRAISE_FIGURES.length);
        expect(figures[3]).toBe(figures[0]);
    });

    it('a stage ends a step higher than the one before, four steps up at most', () => {
        const p = planner(getBuiltinTheme('soft'));
        const top = (k: number): number => Math.max(...p.cue({ kind: 'stage', stage: k }, 0).map((n) => n.noteIndex));
        expect(top(2)).toBe(top(1) + 1);
        expect(top(5)).toBe(top(1) + 4);
        expect(top(9)).toBe(top(5));
    });

    it('wrong-way and wrong-side are on the safety layer, praise and stage on the target layer', () => {
        const p = planner(getBuiltinTheme('soft'));
        expect(new Set(p.cue({ kind: 'wrong-way' }, 0).map((n) => n.layer))).toEqual(new Set(['safety']));
        expect(new Set(p.cue({ kind: 'wrong-side' }, 0).map((n) => n.layer))).toEqual(new Set(['safety']));
        expect(new Set(p.cue({ kind: 'praise' }, 0).map((n) => n.layer))).toEqual(new Set(['target']));
        expect(new Set(p.cue({ kind: 'stage' }, 0).map((n) => n.layer))).toEqual(new Set(['target']));
    });
});

describe('repeat-cue: the named cue as in the glossary, short enough for three plays about 1 s apart', () => {
    const theme = getBuiltinTheme('soft');

    /** Every cue id sounding in the frames of `seconds` after a cue event at 0, 50 ms apart, and the notes it gave. */
    function sounds(e: CueEvent, seconds: number): { ids: Map<number, string[]>; notes: NotePlan[] } {
        const p = planner(theme);
        p.plan({ sample: still(0), world: null, target: null, floorY: 0 });
        const notes = p.cue(e, 0);
        const ids = new Map<number, string[]>();
        for (let t = 0; t <= seconds * 1000; t += 50) {
            const plan: FramePlan = p.plan({ sample: still(t), world: null, target: null, floorY: 0 });
            ids.set(t, plan.cues.map((c) => c.id));
        }
        return { ids, notes };
    }

    it('every glossary cue sounds its own cue, and has stopped by 0.9 s', () => {
        for (const cue of CUE_IDS) {
            const { ids, notes } = sounds({ kind: 'repeat-cue', cue }, 1.5);
            const heard = notes.some((n) => n.cue === cue) || [...ids.values()].some((list) => list.some((x) => x === cue || x.startsWith(`${cue}:`)));
            expect(heard, cue).toBe(true);
            const late = [...ids.entries()].filter(([t]) => t >= REPEAT_CUE_S * 1000 + 60).flatMap(([, list]) => list).filter((x) => x === cue || x.startsWith(`${cue}:`));
            expect(late, `${cue} still sounds after ${REPEAT_CUE_S} s`).toEqual([]);
            const end = notes.length === 0 ? 0 : Math.max(...notes.map((n) => n.atS + n.durS));
            expect(end, cue).toBeLessThanOrEqual(1.2);
        }
    });

    it('the same as the glossary preview of that cue (control: a preview of another cue is not)', () => {
        for (const cue of ['safety.wall', 'height.target', 'target.hum', 'shape.ring', 'target.fanfare', 'safety.wrong-way']) {
            const a = sounds({ kind: 'repeat-cue', cue }, 0.5);
            const b = sounds({ kind: 'preview', cue, dir: null }, 0.5);
            const idsOf = (x: ReturnType<typeof sounds>): string => [...new Set([...x.notes.map((n) => n.cue), ...[...x.ids.values()].flat()])].sort().join('|');
            expect(idsOf(a), cue).toBe(idsOf(b));
            const other = sounds({ kind: 'preview', cue: cue === 'safety.wall' ? 'safety.floor' : 'safety.wall', dir: null }, 0.5);
            expect(idsOf(other)).not.toBe(idsOf(a));
        }
    });

    it('three plays 1 s apart are three separate sounds; an unknown cue sounds nothing', () => {
        const p = planner(theme);
        const keys = new Set<string>();
        for (const at of [0, 1000, 2000]) {
            p.cue({ kind: 'repeat-cue', cue: 'safety.wall' }, at);
            for (let t = at; t < at + 800; t += 50) for (const v of p.plan({ sample: still(t), world: null, target: null, floorY: 0 }).voices) keys.add(v.key);
        }
        expect(keys.size).toBe(3);
        expect(planner(theme).cue({ kind: 'repeat-cue', cue: 'no.such-cue' }, 0)).toEqual([]);
    });

    it('a short wall play still has several pulses (it starts at 3 m, not 8 m)', () => {
        const p = planner(theme);
        p.cue({ kind: 'repeat-cue', cue: 'safety.wall' }, 0);
        let pulses = 0;
        let last = -Infinity;
        for (let t = 0; t < REPEAT_CUE_S * 1000; t += 10) {
            const v = p.plan({ sample: still(t), world: null, target: null, floorY: 0 }).voices.find((x) => x.cue === 'safety.wall');
            if (v === undefined) continue;
            if (t - last >= (v.periodS as number) * 1000) {
                pulses++;
                last = t;
            }
        }
        expect(pulses).toBeGreaterThanOrEqual(4);
    });
});
