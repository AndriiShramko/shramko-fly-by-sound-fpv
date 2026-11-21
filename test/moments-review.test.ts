// Train 4, the independent check of lane tutor-moment: what the pilot actually hears around the moments, flown by a
// host that teaches (RunnerOptions.known given), frame by frame through the planner the host feeds.
import { describe, expect, it } from 'vitest';
import type { CueId, Vec3 } from '../src/contract';
import { getLesson } from '../src/lesson';
import { lessonPaths } from '../src/lesson/library';
import { REPLAY_KEY_ACTIONS } from '../src/replay';
import type { AnalyticWorldInfo } from '../src/world/analytic-world';
import { RecordingHost } from './helpers/record';

/** The cues the moments of the fast path teach, lesson by lesson in path order. */
function taughtOnPath(): { readonly lesson: string; readonly cue: CueId }[] {
    return lessonPaths().fast.flatMap((id) => (getLesson(id).moments ?? []).map((m) => ({ lesson: id, cue: m.cue })));
}

/** RecordingHost.flyTo frame by frame; a pilot who knows every sound presses "I know this" on the frame a moment freezes. */
function go(host: RecordingHost, to: Vec3, speed: number, know: boolean): void {
    const placed = host.placed;
    const step = speed / 30;
    for (let guard = 0; guard < 100_000 && host.placed === placed; guard++) {
        if (host.frozen) {
            if (know) host.press(REPLAY_KEY_ACTIONS.momentKnow);
            host.vel = [0, 0, 0];
            host.tick();
            continue;
        }
        const d: Vec3 = [to[0] - host.pos[0], to[1] - host.pos[1], to[2] - host.pos[2]];
        const len = Math.hypot(...d);
        if (Math.hypot(d[0], d[2]) > 0.5) host.yaw = (Math.atan2(d[0], -d[2]) * 180) / Math.PI;
        if (len <= step) {
            host.pos = to;
            host.vel = [0, 0, 0];
            host.tick();
            return;
        }
        host.vel = [(d[0] / len) * speed, (d[1] / len) * speed, (d[2] / len) * speed];
        host.pos = [host.pos[0] + (d[0] / len) * step, host.pos[1] + (d[1] / len) * step, host.pos[2] + (d[2] / len) * step];
        host.tick();
    }
}

/** The hall flown as the first-set pilot flies it: to the front wall and stop, attempt after attempt. */
function flyHall(host: RecordingHost, know: boolean): void {
    const w = host.world as AnalyticWorldInfo;
    const front = w.landmarks.find((l) => l.id === 'wall-front')!.pos[2] + 1.2;
    for (let n = 0; n < 12 && host.runner.phase !== 'passed'; n++) {
        host.until(() => host.runner.phase === 'passed' || (host.runner.phase === 'flying' && !host.frozen) || (know && host.frozen), 120);
        if (know && host.frozen) {
            host.press(REPLAY_KEY_ACTIONS.momentKnow);
            continue;
        }
        if (host.runner.phase !== 'flying') break;
        if (host.runner.view().moment?.cue === 'height.tone') {
            go(host, [host.pos[0], 2.3, host.pos[2]], 1, know);
            wait(host, 2, know);
        }
        if (Math.abs(host.pos[2] - front) < 3) go(host, [host.pos[0], host.pos[1], host.lesson.start.pos[2]], 2.5, know);
        go(host, [host.pos[0], host.pos[1], front], 2.5, know);
        wait(host, 2, know);
    }
}

/** Holds still for `seconds`; a pilot who knows every sound presses "I know this" as soon as a moment freezes. */
function wait(host: RecordingHost, seconds: number, know: boolean): void {
    for (let i = 0; i < seconds * 10; i++) {
        if (know && host.frozen) host.press(REPLAY_KEY_ACTIONS.momentKnow);
        host.hold(0.1);
    }
}

describe('tutor-moment review: what a new pilot hears', () => {
    it('leaving the lesson inside a moment lets the flight go on and every sound back (the next lesson may have no moments)', () => {
        const host = new RecordingHost(getLesson('walls-hall'), { locale: 'en', hz: 30, recordHz: 30, beginAtMs: 0, known: [] });
        host.begin();
        host.until(() => host.runner.phase === 'flying', 60);
        const front = (host.world as AnalyticWorldInfo).landmarks.find((l) => l.id === 'wall-front')!.pos[2] + 1.2;
        host.until(() => {
            if (!host.frozen) {
                host.pos = [host.pos[0], host.pos[1], host.pos[2] - 2.5 / 30];
                host.vel = [0, 0, -2.5];
            }
            return host.frozen || host.pos[2] <= front;
        }, 30);
        expect(host.frozen).toBe(true);
        const from = host.actionLog.length;
        host.press(REPLAY_KEY_ACTIONS.nextLesson);
        const after = host.actionLog.slice(from).map((x) => x.a);
        // a host that follows the actions releases the craft and lets the engine sound every cue before it opens the next
        // lesson; a lesson without moments (tunnel-gaps on the fast path) sends no 'audible' of its own
        expect(after.some((a) => a.kind === 'moment' && a.moment === null)).toBe(true);
        expect(after.some((a) => a.kind === 'audible' && a.cues === null)).toBe(true);
        expect(after.at(-1)?.kind).toBe('go');
        expect(host.frozen).toBe(false);
        expect(host.runner.view().moment ?? null).toBeNull();
        expect(getLesson('tunnel-gaps').moments ?? []).toEqual([]);
    }, 60_000);

    it('the first lesson sounds no cue a later moment of the fast path still has to teach', () => {
        const host = new RecordingHost(getLesson('walls-hall'), { locale: 'en', hz: 30, recordHz: 30, beginAtMs: 0, known: [] });
        host.begin();
        flyHall(host, false);
        expect(host.runner.phase).toBe('passed');
        const later = new Set(taughtOnPath().filter((x) => x.lesson !== 'walls-hall').map((x) => x.cue));
        const heard = new Set(host.frames.flatMap((f) => f.c ?? []));
        expect([...heard].filter((c) => later.has(c as CueId))).toEqual([]);
        // and the lesson's own two sounds were taught
        const done = host.events.filter((e) => e.kind === 'moment' && e.what === 'learned').length;
        expect(done).toBe(2);
    }, 60_000);

    it("a pilot who presses 'I know this' at every moment still passes the lesson, with no hint and no moment task", () => {
        const host = new RecordingHost(getLesson('walls-hall'), { locale: 'en', hz: 30, recordHz: 30, beginAtMs: 0, known: [], guide: 'full' });
        host.begin();
        flyHall(host, true);
        expect(host.runner.phase).toBe('passed');
        const ev = host.events.flatMap((e) => (e.kind === 'moment' ? [`${e.id}:${e.what}`] : []));
        expect(ev.filter((e) => e.endsWith(':known')).sort()).toEqual(['height:known', 'wall-ahead:known']);
        expect(ev.filter((e) => e.endsWith(':hint') || e.endsWith(':learned'))).toEqual([]);
        expect(host.frozen).toBe(false);
    }, 60_000);
});
