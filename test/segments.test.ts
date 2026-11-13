// lessonSegments (src/replay/segments.ts): the cut of a package at its `lesson open` events. Moved with the function from
// the simulator's tools/bench/test/sonic-int-replay.test.ts (lane voice, train 1); the same three cases.
import { describe, expect, it } from 'vitest';
import type { FlightFrame, SessionEvent, SessionManifest } from '../src/contract';
import { getLesson } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { lessonSegments } from '../src/replay';
import { buildManifest } from '../src/session';
import { getBuiltinTheme } from '../src/theme';
import { createAnalyticWorld } from '../src/world';

const BASE = buildManifest({
    id: 'segmentsSession000001',
    created: '2026-11-07T10:00:00Z',
    app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
    scene: { kind: 'analytic', id: 'x', version: 1, transform: [1, 0, 0, 0] },
    lesson: { id: 'shapes-square', version: 1, path: 'full' },
    theme: { id: 'soft', version: getBuiltinTheme('soft').version },
    settings: defaultPrefs(),
    assists: getLesson('shapes-square').assists,
    device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
    consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-07T10:00:00Z' },
    pilot: { id: 'testPilot01', nickname: null },
    clock: { startIso: '2026-11-07T10:00:00Z', frameHz: 30 }
}) as SessionManifest;
const frameAt = (t: number): FlightFrame => ({ t, tick: t, p: [0, 1, 0], v: [0, 0, 0], q: [1, 0, 0, 0], s: [0, 0, 0, 0], c: [] });
const open = (t: number, lessonId: string): SessionEvent => ({ t, kind: 'lesson', lessonId, version: 1, what: 'open', attempt: 0 });

describe('the cut of a package at its `lesson open` events', () => {
    it('a package of one lesson stays the package itself (no open, or the open of its own lesson with no frame before it)', () => {
        const frames = [0, 33, 66].map(frameAt);
        const none = lessonSegments({ manifest: BASE, frames, events: [] });
        expect(none).toHaveLength(1);
        expect(none[0]!.manifest).toBe(BASE);
        expect(none[0]!.frames).toBe(frames);
        const own = lessonSegments({ manifest: BASE, frames, events: [{ t: 0, kind: 'session', what: 'start' }, open(0, 'shapes-square')] });
        expect(own).toHaveLength(1);
        expect(own[0]!.manifest).toBe(BASE);
    });

    it('a lead, then a piece per open: frames by time, events by their place, each manifest naming its lesson and world', () => {
        const frames = [0, 33, 66, 100, 133, 166, 200, 233].map(frameAt);
        const events: SessionEvent[] = [
            { t: 0, kind: 'session', what: 'start' },
            { t: 10, kind: 'speech', key: 'fly.go', text: 'Go.' },
            open(100, 'shapes-series'),
            { t: 120, kind: 'speech', key: 'fly.go', text: 'Go.' },
            open(200, 'rings-first'),
            { t: 233, kind: 'recording', what: 'stop' }
        ];
        const s = lessonSegments({ manifest: BASE, frames, events });
        expect(s.map((x) => [x.lessonId, x.lead, x.firstFrame, x.frames.map((f) => f.t), x.events.length])).toEqual([
            ['shapes-square', true, 0, [0, 33, 66], 2],
            ['shapes-series', false, 3, [100, 133, 166], 2],
            ['rings-first', false, 6, [200, 233], 2]
        ]);
        expect(s[0]!.manifest).toBe(BASE);
        expect(s[1]!.manifest.lesson).toEqual({ id: 'shapes-series', version: 1, path: 'full' });
        expect(s[1]!.manifest.scene).toMatchObject({ kind: 'analytic', id: createAnalyticWorld((getLesson('shapes-series').world as unknown as { spec: never }).spec).id });
        expect(s[2]!.manifest.assists).toEqual(getLesson('rings-first').assists);
    });

    it('a recording begun with no lead frames: the events before the first open go with the first piece', () => {
        const s = lessonSegments({ manifest: BASE, frames: [50, 80, 150].map(frameAt), events: [{ t: 0, kind: 'recording', what: 'start' }, open(40, 'shapes-series'), open(140, 'rings-first')] });
        expect(s.map((x) => [x.lessonId, x.events.map((e) => e.kind)])).toEqual([
            ['shapes-series', ['recording', 'lesson']],
            ['rings-first', ['lesson']]
        ]);
    });
});
