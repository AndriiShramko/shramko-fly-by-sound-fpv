// The end of a tunnel and of the corridor (lane s13-worlds, review M1 and M2). A goal 'fly-distance' counts
// the path flown in the attempt, so a pilot whose path is longer than the track (a search for the free way
// past an obstacle, the corrections of a narrow tunnel) is counted before the end: "lesson passed" in the
// middle of the tunnel, its last obstacles never flown. Lane s13-lessons' goal 'track-end' (its review fix
// R5) is met when the last point of the world's track is passed; at the merge the corridor and the six
// tunnels take it (docs/wip/s13-worlds.md, "For the lead's merge"). Held here:
//   - the world side, always: every one of these tracks ends past its last obstacle and its last corner;
//   - the control, always: goals 'fly-distance' of the track's length less 4 m count a pilot whose path is
//     10 % longer than the track before the last obstacle or corner;
//   - once 'track-end' is a goal the validator knows (after the merge with lane s13-lessons), the shipped
//     goals count the truth bot and that longer pilot only at the end of the track, past everything.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LessonDef, SonicObject, Vec3, WorldCheckpoint } from '../src/contract';
import { getLesson, validateLesson } from '../src/lesson';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../src/world';
import { alongTrack, trackLength } from './helpers/along';
import { ScriptedPilot } from './helpers/pilot';
import { flyTruth } from './helpers/truth';

const LESSONS = ['corridor', 'tunnel-wide', 'tunnel-narrow', 'tunnel-narrower', 'tunnel-bends', 'tunnel-gaps', 'tunnel-long'];
const worldOf = (l: LessonDef): AnalyticWorldInfo => createAnalyticWorld((l.world as { spec: Parameters<typeof createAnalyticWorld>[0] }).spec);

/** True when the package's validator knows the goal 'track-end' (lane s13-lessons, review R5): after the merge. */
const TRACK_END = validateLesson({ ...(JSON.parse(readFileSync(new URL('../lessons/corridor.json', import.meta.url), 'utf8')) as object), goals: [{ kind: 'track-end' }] }).ok;

/** What a pilot must have flown before the attempt may count: the back of the last solid object and the last corner, along the track. */
function lastHardPart(w: AnalyticWorldInfo): { at: number; what: string } {
    const list = w.checkpoints as WorldCheckpoint[];
    let best = { at: 0, what: 'the start' };
    for (const o of w.objects().filter((x: SonicObject) => x.solid)) {
        const size = o.shape.kind === 'box' ? Math.max(o.shape.size[0], o.shape.size[2]) / 2 : o.shape.kind === 'pillar' ? o.shape.radius : 0;
        const back = alongTrack(list, o.pos) + size;
        if (back > best.at) best = { at: back, what: o.id };
    }
    // a corner: a checkpoint whose heading differs from the one before
    for (let i = 1; i < list.length; i++) {
        const turned = Math.abs(list[i]!.dir[0] - list[i - 1]!.dir[0]) > 1e-6 || Math.abs(list[i]!.dir[2] - list[i - 1]!.dir[2]) > 1e-6;
        const at = alongTrack(list, list[i]!.pos);
        if (turned && at > best.at) best = { at, what: `the corner at checkpoint ${i + 1}` };
    }
    return best;
}

/**
 * Flies the attempt now running along the world's track, every leg with a step back and forth at its end of 5 % of the
 * leg (a path 10 % longer than the track, on the track's own free lines), or as the truth bot; returns how far along the
 * track the craft was when the attempt was counted, or null when it was not.
 */
function countedAt(lesson: LessonDef, how: 'longer' | 'truth'): number | null {
    const p = new ScriptedPilot(lesson);
    const list = p.analytic?.checkpoints as WorldCheckpoint[];
    const seen: { at: number | null } = { at: null };
    const tick = p.tick.bind(p);
    p.tick = () => {
        const pos = p.pos; // the sample this tick gives the runner
        tick();
        if (seen.at === null && p.of('lesson').some((e) => e.what === 'attempt-pass')) seen.at = alongTrack(list, pos);
    };
    p.begin();
    p.until(() => p.run.phase === 'flying', 600);
    const attempt = p.run.attempt;
    const flying = (): boolean => p.run.phase === 'flying' && p.run.attempt === attempt;
    if (how === 'truth') flyTruth(p);
    else {
        for (let i = 1; i < list.length && flying(); i++) {
            const a = list[i - 1]!.pos, b = list[i]!.pos;
            const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            p.flyTo(b);
            if (l > 0.02 && flying()) {
                // 5 % of the leg back toward its start, and forward again: the leg flown 1.1 times
                const back: Vec3 = [b[0] + (a[0] - b[0]) * 0.05, b[1] + (a[1] - b[1]) * 0.05, b[2] + (a[2] - b[2]) * 0.05];
                p.flyTo(back);
                p.flyTo(b);
            }
        }
        p.until(() => !flying(), 5);
    }
    return seen.at;
}

describe('the end of the corridor and of every tunnel (review M1, M2)', () => {
    it.each(LESSONS)('%s: the track ends past its last obstacle and its last corner, on its last straight', (id) => {
        const w = worldOf(getLesson(id));
        const list = w.checkpoints as WorldCheckpoint[];
        const length = trackLength(list);
        const hard = lastHardPart(w);
        expect(length - hard.at, `${hard.what} at ${hard.at.toFixed(2)} of ${length.toFixed(2)} m`).toBeGreaterThan(1);
    });

    // the longer the track, the earlier: 10 % of the corridor (126 m) is 13 m, of the long tunnel (152 m) 15 m. Measured
    // with the runner of lane s13-lessons' step 4 (this lane's base): the corridor is counted at 111 m (its last pillar
    // ends at 124), tunnel-bends at 34.7 (its last corner at 35.1), tunnel-long at 134 (its last obstacle ends at 144);
    // tunnel-gaps just past its last obstacle (28.8 against 28.7) and the short tunnels after their last corner
    it.each(['corridor', 'tunnel-bends', 'tunnel-long'])('control: a goal fly-distance of the track less 4 m counts a pilot whose path is 10 percent longer before the last obstacle or corner of %s', (id) => {
        const shipped = getLesson(id);
        const w = worldOf(shipped);
        const length = trackLength(w.checkpoints as WorldCheckpoint[]);
        const lesson: LessonDef = { ...shipped, goals: [{ kind: 'fly-distance', metres: Math.round(length - 4) }] };
        const at = countedAt(lesson, 'longer');
        expect(at).not.toBeNull();
        const hard = lastHardPart(w);
        expect(at as number, `${id}: counted at ${(at as number).toFixed(1)} m, ${hard.what} ends at ${hard.at.toFixed(1)} m`).toBeLessThan(hard.at);
    }, 120000);

    describe.runIf(TRACK_END)('with the goal track-end (lane s13-lessons R5, after the merge)', () => {
        it.each(LESSONS)('%s: the shipped goal counts the truth bot and a pilot whose path is 10 percent longer only at the end of the track', (id) => {
            const lesson = getLesson(id);
            expect(lesson.goals.map((g) => g.kind), `${id}: set its goals to [{ kind: 'track-end' }] at the merge`).toEqual(['track-end']);
            const w = worldOf(lesson);
            const length = trackLength(w.checkpoints as WorldCheckpoint[]);
            const hard = lastHardPart(w);
            for (const how of ['truth', 'longer'] as const) {
                const at = countedAt(lesson, how);
                expect(at, `${id} ${how}`).not.toBeNull();
                expect(at as number, `${id} ${how}: past ${hard.what}`).toBeGreaterThan(hard.at);
                expect(at as number, `${id} ${how}: at the end`).toBeGreaterThan(length - 0.5);
            }
        }, 180000);
    });
});
