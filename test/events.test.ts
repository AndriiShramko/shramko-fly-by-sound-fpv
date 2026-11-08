// The sounds of the shared cue events of v0.13 (plan v13 "Lanes": the runner emits them, the planner owns
// how they sound): 'wrong-way', 'wrong-side' (M41-15), 'praise', 'stage' (M41-11) and 'repeat-cue' (M41-5,
// the named cue's own sound as in the glossary, for as long as the runner gives the play). Each is a short
// earcon of its own in every built-in theme, on the scale, never louder than the safety sound. The events'
// fields are lane s13-lessons' (review B2): wrong-way and wrong-side carry `dir`, stage `stage`, repeat-cue
// `durS` (and `index` of `of`).
import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, LayerId, Locale, ThemeDef } from '../src/contract';
import { LOCALES } from '../src/contract';
import { CuePlanner, eventCue, layerGainDb, PRAISE_FIGURES, REPEAT_PLAY_DEFAULT_S, type FramePlan, type NotePlan } from '../src/cues';
import { CUE_IDS, DICTS } from '../src/i18n';
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

    it('the glossary tells the open-way chime from the checkpoint chime in every language: one repeats while the way is blocked, the other sounds once (s13-worlds review M8)', () => {
        // how they sound: the open way is a voice that repeats its pair of notes (each note shorter than its period), from
        // the free side; the checkpoint is two notes, low to high, once
        const p = planner(getBuiltinTheme('soft'));
        p.plan({ sample: still(0), world: null, target: null, floorY: 0 });
        expect(p.cue({ kind: 'repeat-cue', cue: 'safety.free', dir: [1, 0, 0], durS: 2.5 }, 0)).toEqual([]);
        const free = p.plan({ sample: still(100), world: null, target: null, floorY: 0 }).voices.find((v) => v.cue === 'safety.free');
        expect(free?.periodS).toBeGreaterThan(free?.noteS ?? Infinity);
        const chime = planner(getBuiltinTheme('soft')).cue({ kind: 'checkpoint' }, 0);
        expect(chime).toHaveLength(2);
        expect((chime[1] as NotePlan).noteIndex).toBeGreaterThan((chime[0] as NotePlan).noteIndex);
        // what the glossary says: "again and again" for the one, "only once" for the other, never the other's words
        const WORDS: Readonly<Record<Locale, { readonly again: RegExp; readonly once: RegExp }>> = {
            en: { again: /again and again/, once: /only once/ },
            es: { again: /una y otra vez/, once: /una sola vez/ },
            pl: { again: /raz za razem/, once: /tylko raz/ },
            ru: { again: /снова и снова/, once: /только раз/ }
        };
        for (const locale of LOCALES) {
            const openWay = DICTS[locale]['cue.safety.free.glossary'] as string;
            const checkpoint = DICTS[locale]['cue.target.checkpoint.glossary'] as string;
            expect(openWay, locale).toMatch(WORDS[locale].again);
            expect(checkpoint, locale).toMatch(WORDS[locale].once);
            expect(openWay, locale).not.toMatch(WORDS[locale].once);
            expect(checkpoint, locale).not.toMatch(WORDS[locale].again);
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
        expect(top(1)).toBe(Math.max(...p.cue({ kind: 'stage' }, 0).map((n) => n.noteIndex)));
        expect(top(2)).toBe(top(1) + 1);
        expect(top(5)).toBe(top(1) + 4);
        expect(top(9)).toBe(top(5));
    });

    it('wrong-way sounds from the way forward and wrong-side from the gate (`dir`); centred without one', () => {
        const p = planner(getBuiltinTheme('soft'));
        for (const kind of ['wrong-way', 'wrong-side'] as const) {
            const behind = p.cue({ kind, dir: [0, 0, 2] }, 0);
            expect(behind.length, kind).toBeGreaterThan(0);
            for (const n of behind) {
                expect(n.dir, kind).toEqual([0, 0, 1]);
                expect(n.slot, kind).not.toBeNull();
            }
            for (const n of p.cue({ kind, dir: null }, 0)) expect(n.dir, kind).toBeNull();
            for (const n of p.cue({ kind }, 0)) expect(n.dir, kind).toBeNull();
        }
    });

    it('wrong-way and wrong-side are on the safety layer, praise and stage on the target layer', () => {
        const p = planner(getBuiltinTheme('soft'));
        expect(new Set(p.cue({ kind: 'wrong-way' }, 0).map((n) => n.layer))).toEqual(new Set(['safety']));
        expect(new Set(p.cue({ kind: 'wrong-side' }, 0).map((n) => n.layer))).toEqual(new Set(['safety']));
        expect(new Set(p.cue({ kind: 'praise' }, 0).map((n) => n.layer))).toEqual(new Set(['target']));
        expect(new Set(p.cue({ kind: 'stage' }, 0).map((n) => n.layer))).toEqual(new Set(['target']));
    });
});

describe('repeat-cue: the named cue as in the glossary, for as long as the runner gives the play (review B2)', () => {
    const theme = getBuiltinTheme('soft');
    /** The runner's lengths (lane s13-lessons, src/lesson/sounds.ts): a continuous cue 2.5 s, a one-off cue 1.2 s, 1 s between plays. */
    const CONTINUOUS_S = 2.5;
    const ONE_OFF_S = 1.2;
    const GAP_S = 1;

    /** Every cue id sounding in the frames of `seconds` after a cue event at 0, 50 ms apart, the notes it gave, and the previews per frame. */
    function sounds(e: CueEvent, seconds: number): { ids: Map<number, string[]>; notes: NotePlan[]; previews: Map<number, number> } {
        const p = planner(theme);
        p.plan({ sample: still(0), world: null, target: null, floorY: 0 });
        const notes = p.cue(e, 0);
        const ids = new Map<number, string[]>();
        const previews = new Map<number, number>();
        for (let t = 0; t <= seconds * 1000; t += 50) {
            const plan: FramePlan = p.plan({ sample: still(t), world: null, target: null, floorY: 0 });
            ids.set(t, plan.cues.map((c) => c.id));
            previews.set(t, p.previewsAt(t));
        }
        return { ids, notes, previews };
    }
    const own = (cue: string) => (x: string): boolean => x === cue || x.startsWith(`${cue}:`);

    it('every glossary cue: a continuous one sounds through its whole play and stops with it, a one-off one at once and within it', () => {
        for (const cue of CUE_IDS) {
            const { ids, notes, previews } = sounds({ kind: 'repeat-cue', cue, dir: null, index: 0, of: 3, durS: CONTINUOUS_S }, CONTINUOUS_S + 1);
            if (notes.length > 0) {
                // one-off: its own notes from the start, all over by the play's end
                expect(Math.min(...notes.map((n) => n.atS)), cue).toBe(0);
                expect(Math.max(...notes.map((n) => n.atS + n.durS)), cue).toBeLessThanOrEqual(ONE_OFF_S);
                expect(notes.every((n) => n.cue === cue), cue).toBe(true);
                continue;
            }
            // (the speed ticks of the preview ramp up from a standstill: the first and last frames may be between ticks)
            let heard = 0;
            let frames = 0;
            for (const [t, list] of ids) {
                if (t < CONTINUOUS_S * 1000) {
                    expect(previews.get(t), `${cue} at ${t} ms`).toBe(1);
                    frames++;
                    if (list.some(own(cue))) heard++;
                } else expect(list.some(own(cue)), `${cue} still sounds at ${t} ms`).toBe(false);
            }
            expect(heard / frames, cue).toBeGreaterThanOrEqual(0.95);
        }
    });

    it('a one-off cue is cut at a play shorter than its figure; a continuous play is as long as durS (control: the old fixed 0.9 s)', () => {
        const fanfare = sounds({ kind: 'repeat-cue', cue: 'target.fanfare', durS: 0.5 }, 1).notes;
        expect(Math.max(...fanfare.map((n) => n.atS + n.durS))).toBeLessThanOrEqual(0.5 + 1e-9);
        const heardMs = (durS: number): number => [...sounds({ kind: 'repeat-cue', cue: 'safety.wall', durS }, 3).ids.entries()].filter(([, list]) => list.some(own('safety.wall'))).length * 50;
        expect(heardMs(CONTINUOUS_S)).toBeGreaterThanOrEqual(CONTINUOUS_S * 1000 - 50);
        expect(heardMs(0.9)).toBeLessThan(1000);
        // no length given: the runner's continuous play
        expect(heardMs(Number.NaN)).toBeGreaterThanOrEqual(REPEAT_PLAY_DEFAULT_S * 1000 - 50);
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

    it('three plays as the runner sends them (2.5 s, then 1 s of silence) are three separate sounds, the cue silent between them; an unknown cue sounds nothing', () => {
        const p = planner(theme);
        const keys = new Set<string>();
        for (let k = 0; k < 3; k++) {
            const at = k * (CONTINUOUS_S + GAP_S) * 1000;
            p.cue({ kind: 'repeat-cue', cue: 'safety.wall', dir: null, index: k, of: 3, durS: CONTINUOUS_S }, at);
            for (let t = at; t < at + (CONTINUOUS_S + GAP_S) * 1000; t += 50) {
                const plan = p.plan({ sample: still(t), world: null, target: null, floorY: 0 });
                for (const v of plan.voices) keys.add(v.key);
                const inPlay = t < at + CONTINUOUS_S * 1000;
                expect(plan.cues.some((c) => c.id.startsWith('safety.wall')), `play ${k} at ${t} ms`).toBe(inPlay);
            }
        }
        expect(keys.size).toBe(3);
        expect(planner(theme).cue({ kind: 'repeat-cue', cue: 'no.such-cue' }, 0)).toEqual([]);
    });

    it('a wall play from `dir` comes from there; a short play still has several pulses (it starts at 3 m, not 8 m)', () => {
        const p = planner(theme);
        p.cue({ kind: 'repeat-cue', cue: 'safety.wall', dir: [-2, 0, 0], durS: 1 }, 0);
        let pulses = 0;
        let last = -Infinity;
        for (let t = 0; t < 1000; t += 10) {
            const v = p.plan({ sample: still(t), world: null, target: null, floorY: 0 }).voices.find((x) => x.cue === 'safety.wall');
            if (v === undefined) continue;
            expect(v.dir).toEqual([-1, 0, 0]);
            if (t - last >= (v.periodS as number) * 1000) {
                pulses++;
                last = t;
            }
        }
        expect(pulses).toBeGreaterThanOrEqual(4);
    });
});
