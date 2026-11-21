// Train 4, lane tutor-moment, stage S2: the moment machine. At the action a sound belongs to the flight freezes, the
// other sounds go quiet, the sound's `what` line is said, the sound plays alone (far, then near), the `do` line is
// said, the flight goes on, the pilot does the task, a short success sound and at most three words. The hint once.
// Keys: again, on, know. Guide levels. The moment events are recorded and the recording replays.
import { describe, expect, it } from 'vitest';
import type { CueId, LessonDef, MomentDef } from '../src/contract';
import { getLesson } from '../src/lesson';
import { checkSession, REPLAY_KEY_ACTIONS } from '../src/replay';
import type { AnalyticWorldInfo } from '../src/world/analytic-world';
import { RecordingHost, type HostOptions } from './helpers/record';

const HEIGHT: MomentDef = {
    id: 'height',
    cue: 'height.tone',
    when: { kind: 'start' },
    forms: [
        { dir: [0, -1, 0], distanceM: null, durS: 1.2 },
        { dir: [0, 1, 0], distanceM: null, durS: 1.2 }
    ],
    do: { key: 'moment.height.do' },
    hint: { key: 'moment.height.hint' },
    hintAfterS: 10,
    task: null
};
const WALL: MomentDef = {
    id: 'wall-ahead',
    cue: 'safety.wall',
    when: { kind: 'near', dir: 'front', withinM: 3 },
    forms: [
        { dir: [0, 0, -1], distanceM: 3, durS: 1.2 },
        { dir: [0, 0, -1], distanceM: 1, durS: 1.2 }
    ],
    do: { key: 'moment.wall-ahead.do' },
    hint: { key: 'moment.wall-ahead.hint' },
    hintAfterS: 4,
    task: { kind: 'approach-stop', objectId: null, stopWithinM: 1.5 }
};

/** walls-hall with two moments and no intro cue lines (the first set's shape; S3 writes the shipped one). */
function hall(): LessonDef {
    const base = getLesson('walls-hall');
    return { ...base, intro: [{ key: 'lesson.walls-hall.goal.1' }], moments: [HEIGHT, WALL] };
}

function frontStop(host: RecordingHost): number {
    const front = (host.world as AnalyticWorldInfo).landmarks.find((l) => l.id === 'wall-front')!.pos[2];
    return front + 1.2;
}

/** Flies on toward the front wall at 2 m/s until the wall's moment freezes the flight (the frozen frame is the craft held). */
function toWall(host: RecordingHost): void {
    for (let i = 0; i < 600 && !host.frozen; i++) {
        host.vel = [0, 0, -2];
        host.pos = [host.pos[0], host.pos[1], host.pos[2] - 2 / 60];
        host.tick();
    }
    host.vel = [0, 0, 0];
}

/** Begins the lesson and flies to the front wall; `during` runs once the wall's moment has frozen the flight. */
function flyHall(options: HostOptions = {}, during?: (host: RecordingHost) => void): RecordingHost {
    const host = new RecordingHost(hall(), options);
    host.begin();
    host.until(() => host.runner.phase === 'flying', 60);
    host.until(() => !host.frozen && host.runner.view().moment == null, 30);
    const stop = frontStop(host);
    // to 3.5 m short of the stop, then on: the wall's moment comes on the way
    toWall(host);
    if (during !== undefined && host.frozen) during(host);
    host.flyTo([0, 1.5, stop], 2);
    host.hold(3);
    return host;
}

const momentEvents = (host: RecordingHost, id: string): string[] => host.events.filter((e) => e.kind === 'moment' && e.id === id).map((e) => (e.kind === 'moment' ? e.what : ''));
const spokenKeys = (host: RecordingHost): string[] => host.events.filter((e) => e.kind === 'speech' && e.key !== 'speech.end').map((e) => (e.kind === 'speech' ? e.key : ''));

/** The actions of the moments, in order, as short strings. */
function trace(host: RecordingHost): string[] {
    const out: string[] = [];
    for (const { a } of host.actionLog) {
        if (a.kind === 'moment') out.push(a.moment === null ? 'moment:null' : `moment:${a.moment.id}/${a.moment.phase}${a.moment.phase === 'sound' ? `/${a.moment.form}` : ''}`);
        else if (a.kind === 'audible') out.push(a.cues === null ? 'audible:all' : a.cues.length === 1 ? `audible:${a.cues[0]}` : `audible:${a.cues.length}`);
        else if (a.kind === 'say' && (a.line.key.startsWith('cue.') || a.line.key.startsWith('moment.'))) out.push(`say:${a.line.key}`);
        else if (a.kind === 'cue' && (a.event.kind === 'repeat-cue' || a.event.kind === 'praise')) out.push(`cue:${a.event.kind}`);
    }
    return out;
}

describe('moments: the machine (S2)', () => {
    it('a moment runs in order: freeze, the name and what, the forms alone, do, on, the task, praise', () => {
        const host = flyHall();
        const t = trace(host);
        const from = t.indexOf('audible:safety.wall');
        expect(from).toBeGreaterThan(0);
        expect(t.slice(from, from + 13)).toEqual([
            'audible:safety.wall',
            'say:cue.safety.wall.what',
            'moment:wall-ahead/what',
            'moment:wall-ahead/sound/0',
            'cue:repeat-cue',
            'moment:wall-ahead/sound/1',
            'cue:repeat-cue',
            'say:moment.wall-ahead.do',
            'moment:wall-ahead/do',
            'moment:null',
            expect.stringMatching(/^audible:\d+$/),
            'cue:praise',
            'say:moment.done'
        ]);
        expect(momentEvents(host, 'height')).toEqual(['freeze', 'resume', 'learned', 'done']);
        expect(momentEvents(host, 'wall-ahead')).toEqual(['freeze', 'resume', 'learned', 'done']);
        // the start: before any moment, the sounds still to teach are out of the list
        const first = host.actionLog.find((x) => x.a.kind === 'audible')!.a as { cues: readonly CueId[] | null };
        expect(first.cues).not.toBeNull();
        expect(first.cues).not.toContain('safety.wall');
        expect(first.cues).not.toContain('height.tone');
        expect(first.cues).toContain('room.bed');
    });

    it('nothing is said while the new sound plays; every line handed before it has been said', () => {
        const host = flyHall();
        const plays = host.actionLog.filter((x) => x.a.kind === 'cue' && x.a.event.kind === 'repeat-cue' && x.a.event.cue === 'safety.wall');
        expect(plays.length).toBe(2);
        const t0 = plays[0]!.t;
        const t1 = plays[1]!.t + 1200;
        expect(host.actionLog.filter((x) => x.a.kind === 'say' && x.t >= t0 && x.t <= t1)).toEqual([]);
        const lastSaid = host.events.filter((e) => e.kind === 'speech' && e.key !== 'speech.end' && e.t <= t0).at(-1)!;
        expect(host.events.some((e) => e.kind === 'speech' && e.key === 'speech.end' && e.t >= lastSaid.t && e.t <= t0)).toBe(true);
    });

    it('while frozen only the new sound may sound: the audible list is that cue alone, and the craft does not move', () => {
        const host = flyHall();
        const freeze = host.events.find((e) => e.kind === 'moment' && e.id === 'wall-ahead' && e.what === 'freeze')!.t;
        const resume = host.events.find((e) => e.kind === 'moment' && e.id === 'wall-ahead' && e.what === 'resume')!.t;
        const inside = host.actionLog.filter((x) => x.a.kind === 'audible' && x.t >= freeze && x.t < resume).map((x) => (x.a as { cues: readonly CueId[] | null }).cues);
        expect(inside).toEqual([['safety.wall']]);
        const frames = host.frames.filter((f) => f.t > freeze && f.t < resume);
        expect(frames.length).toBeGreaterThan(30);
        for (const f of frames) for (const id of f.c) expect(id.startsWith('safety.wall') || id.startsWith('safety:') || id.startsWith('preview')).toBe(true);
        expect(new Set(frames.map((f) => f.p.join(','))).size).toBe(1);
        // after it the cue is audible with the rest
        const after = host.actionLog.find((x) => x.a.kind === 'audible' && x.t >= resume)!.a as { cues: readonly CueId[] | null };
        expect(after.cues).toContain('safety.wall');
        expect(after.cues).toContain('height.tone');
    });

    it('no success in hintAfterS: the hint once, never the whole text again', () => {
        const host = new RecordingHost(hall());
        host.begin();
        host.until(() => host.runner.phase === 'flying', 60);
        host.until(() => !host.frozen && host.runner.view().moment == null, 30);
        toWall(host);
        host.until(() => host.runner.view().moment?.phase === 'task', 30);
        host.hold(15);
        const keys = spokenKeys(host);
        expect(keys.filter((k) => k === 'moment.wall-ahead.hint').length).toBe(1);
        expect(keys.filter((k) => k === 'moment.wall-ahead.do').length).toBe(1);
        expect(keys.filter((k) => k === 'cue.safety.wall.what').length).toBe(1);
        expect(momentEvents(host, 'wall-ahead')).toEqual(['freeze', 'resume', 'hint']);
    });

    it('"I know this": the cue is known, no task, no praise; a runner that knows it skips the moment', () => {
        const host = flyHall({}, (h) => h.press(REPLAY_KEY_ACTIONS.momentKnow));
        expect(momentEvents(host, 'wall-ahead')).toEqual(['freeze', 'known', 'resume', 'done']);
        expect(spokenKeys(host)).not.toContain('moment.wall-ahead.do');
        expect(spokenKeys(host)).not.toContain('moment.done');
        const last = host.actionLog.filter((x) => x.a.kind === 'audible').at(-1)!.a as { cues: readonly CueId[] | null };
        expect(last.cues).toContain('safety.wall');

        const knows = flyHall({ known: ['safety.wall'] });
        expect(momentEvents(knows, 'wall-ahead')).toEqual([]);
        const start = knows.actionLog.find((x) => x.a.kind === 'audible')!.a as { cues: readonly CueId[] | null };
        expect(start.cues).toContain('safety.wall');
        expect(start.cues).not.toContain('height.tone');
    });

    it('"again" in the task: the flight freezes for the forms alone and goes on, no do line again; "on" ends it', () => {
        const host = new RecordingHost(hall());
        host.begin();
        host.until(() => host.runner.phase === 'flying', 60);
        host.until(() => !host.frozen && host.runner.view().moment == null, 30);
        toWall(host);
        host.until(() => host.runner.view().moment?.phase === 'task', 30);
        host.press(REPLAY_KEY_ACTIONS.momentAgain);
        expect(host.frozen).toBe(true);
        host.until(() => !host.frozen, 10);
        const plays = host.actionLog.filter((x) => x.a.kind === 'cue' && x.a.event.kind === 'repeat-cue' && x.a.event.cue === 'safety.wall');
        expect(plays.length).toBe(4);
        expect(spokenKeys(host).filter((k) => k === 'moment.wall-ahead.do').length).toBe(1);
        host.press(REPLAY_KEY_ACTIONS.momentOn);
        expect(momentEvents(host, 'wall-ahead')).toEqual(['freeze', 'resume', 'freeze', 'resume', 'done']);
        expect(host.runner.view().moment).toBeNull();
        // no moment running: a key changes nothing
        expect(host.runner.momentKey('on', host.t)).toEqual([]);
    });

    it("guide 'new': the sound's name and the sound only; no what, no do, no hint, no praise words", () => {
        const host = new RecordingHost(hall(), { guide: 'new' });
        host.begin();
        host.until(() => host.runner.phase === 'flying', 60);
        host.until(() => !host.frozen && host.runner.view().moment == null, 30);
        toWall(host);
        host.until(() => host.runner.view().moment?.phase === 'task', 30);
        // longer than hintAfterS without a success (back to the middle and on again): no hint with guide 'new'
        host.flyTo([0, 1.5, 0], 1);
        host.flyTo([0, 1.5, frontStop(host)], 2);
        host.hold(3);
        const said = spokenKeys(host).filter((k) => k.startsWith('cue.') || k.startsWith('moment.'));
        expect(said).toEqual(['cue.height.tone.name', 'cue.safety.wall.name']);
        expect(momentEvents(host, 'wall-ahead')).toEqual(['freeze', 'resume', 'learned', 'done']);
    });

    it('the moment events are recorded, and the recording replays with them', async () => {
        const host = flyHall({}, (h) => {
            h.hold(1);
            h.press(REPLAY_KEY_ACTIONS.momentAgain);
        });
        const { pkg } = await host.toPackage();
        expect(pkg.events.filter((e) => e.kind === 'moment').length).toBeGreaterThanOrEqual(8);
        const { check, result } = checkSession(pkg, { lessons: { [host.lesson.id]: host.lesson } });
        expect(result.derivedEvents.filter((e) => e.kind === 'moment').map((e) => (e.kind === 'moment' ? `${e.id}:${e.what}` : ''))).toEqual(
            pkg.events.filter((e) => e.kind === 'moment').map((e) => (e.kind === 'moment' ? `${e.id}:${e.what}` : ''))
        );
        expect(check.events.diffs).toEqual([]);
    });
});
