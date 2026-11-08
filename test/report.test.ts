import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FlightFrame, SonicObject } from '../src/contract';
import { getLesson } from '../src/lesson';
import { SPEECH_END_KEY } from '../src/replay';
import { packFiles, readPackage, readZip, type SessionPackage } from '../src/session';
import { utf8Decode, utf8Encode } from '../src/util';
import { quatRotate } from '../src/util/vec';
import { buildReport, formatClock, main, parseTranscript, renderMarkdown, REPORT_FORMAT, TranscriptError, type CliIo, type Report } from '../tools/report';
import { RecordingHost } from './helpers/record';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(ROOT, 'test', 'fixtures', name)));

const gatesOf = (host: RecordingHost): SonicObject[] => (host.world?.objects() ?? []).filter((o) => o.order !== null);

function flyCourse(host: RecordingHost, speed = 6, touchAtGate = -1): void {
    gatesOf(host).forEach((g, k) => {
        const f = quatRotate(g.quat, [0, 0, -1]);
        host.flyTo([g.pos[0] - f[0] * 5, g.pos[1] - f[1] * 5, g.pos[2] - f[2] * 5], speed);
        if (k === touchAtGate) host.touch();
        host.flyTo([g.pos[0] + f[0] * 5, g.pos[1] + f[1] * 5, g.pos[2] + f[2] * 5], speed);
    });
}

const VOICE = [Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3), new Uint8Array(200).fill(7)];

describe('transcripts', () => {
    it('reads Whisper-style JSON (seconds), our own milliseconds, SRT and WebVTT', () => {
        const whisper = JSON.stringify({ text: 'x', segments: [{ id: 0, start: 1.5, end: 3.25, text: ' Ring one. ' }, { id: 1, start: 0.2, end: 1, text: 'Hello' }] });
        expect(parseTranscript(whisper)).toEqual([
            { startMs: 200, endMs: 1000, text: 'Hello' },
            { startMs: 1500, endMs: 3250, text: 'Ring one.' }
        ]);
        expect(parseTranscript(JSON.stringify([{ startMs: 10, endMs: 20, text: 'a' }, { startMs: 5, text: 'b' }]))).toEqual([
            { startMs: 5, endMs: 5, text: 'b' },
            { startMs: 10, endMs: 20, text: 'a' }
        ]);
        const srt = '1\r\n00:00:01,500 --> 00:00:03,250\r\nRing one.\r\nGo on\r\n\r\n2\r\n00:01:02,005 --> 00:01:03,000\r\nTwo\r\n';
        expect(parseTranscript(srt)).toEqual([
            { startMs: 1500, endMs: 3250, text: 'Ring one. Go on' },
            { startMs: 62005, endMs: 63000, text: 'Two' }
        ]);
        const vtt = '﻿WEBVTT\n\nNOTE a comment\n\ncue-1\n00:01.500 --> 00:03.250 align:start position:0%\nRing one.\n\n01:00:00.100 --> 01:00:01.000\nLate\n';
        expect(parseTranscript(vtt)).toEqual([
            { startMs: 1500, endMs: 3250, text: 'Ring one.' },
            { startMs: 3600100, endMs: 3601000, text: 'Late' }
        ]);
        expect(parseTranscript('  \n')).toEqual([]);
        expect(parseTranscript('[]')).toEqual([]);
    });

    it('refuses what it cannot read, saying why (negative controls)', () => {
        expect(() => parseTranscript('{"a":')).toThrow(TranscriptError);
        expect(() => parseTranscript('{"a":1}')).toThrow(/list of segments/);
        expect(() => parseTranscript('[{"start":1}]')).toThrow(/segment 1 needs a text/);
        expect(() => parseTranscript('[{"text":"a"}]')).toThrow(/start time/);
        expect(() => parseTranscript('1\n00:00:01,500 --> soon\nText\n')).toThrow(/time range/);
    });
});

describe('the clock text', () => {
    it('writes minutes, seconds and tenths', () => {
        expect(formatClock(0)).toBe('0:00.0');
        expect(formatClock(83400)).toBe('1:23.4');
        expect(formatClock(3600000)).toBe('60:00.0');
        expect(formatClock(-500)).toBe('-0:00.5');
    });
});

describe('the report of a recorded flight: rings-course, a failed attempt then a clean one', () => {
    let pkg: SessionPackage;
    let report: Report;
    let host: RecordingHost;

    beforeAll(async () => {
        host = new RecordingHost(getLesson('rings-course'));
        host.begin();
        host.until(() => host.runner.phase === 'flying', 120);
        flyCourse(host, 6, 2);
        host.until(() => host.runner.attempt === 2 && host.runner.phase === 'flying', 120);
        flyCourse(host);
        host.until(() => host.runner.phase === 'passed', 60);
        host.hold(2);
        pkg = (await host.toPackage({ voice: { offsetMs: 250, slices: VOICE } })).pkg;
        report = buildReport(pkg);
    }, 120000);

    it('says what happened: passed on the second attempt, one touch, twelve gates', () => {
        expect(report.format).toBe(REPORT_FORMAT);
        expect(report.lesson).toEqual({ id: 'rings-course', version: 2, title: expect.any(String) });
        expect(report.outcome).toEqual({ status: 'passed', success: true, attempts: 2, passedAtMs: expect.any(Number) });
        expect(report.attempts.map((a) => [a.attempt, a.result, a.touches, a.gates])).toEqual([
            [1, 'fail', 1, 6],
            [2, 'pass', 0, 6]
        ]);
        expect(report.metrics.touches).toBe(1);
        expect(report.metrics.gatesPassed).toBe(12);
        expect(report.metrics.answers).toEqual({ given: 0, skipped: 0 });
        expect(report.consent.voice).toBe(true);
        expect(report.session.complete).toBe(true);
    });

    it('times every gate and every leg, in order, within each attempt', () => {
        for (const attempt of [1, 2]) {
            const gates = report.gates.filter((g) => g.attempt === attempt);
            expect(gates.map((g) => g.index)).toEqual([0, 1, 2, 3, 4, 5]);
            for (let i = 0; i < gates.length; i++) {
                const g = gates[i] as (typeof gates)[number];
                expect(g.legMs).toBeGreaterThan(500);
                expect(g.missM).toBeLessThan(1);
                if (i > 0) {
                    expect(g.tMs).toBeGreaterThan((gates[i - 1] as (typeof gates)[number]).tMs);
                    expect(g.sinceAttemptMs - (gates[i - 1] as (typeof gates)[number]).sinceAttemptMs).toBe(g.legMs);
                } else expect(g.legMs).toBe(g.sinceAttemptMs);
            }
        }
        const a = report.attempts[1] as Report['attempts'][number];
        const last = report.gates.filter((g) => g.attempt === 2).at(-1) as Report['gates'][number];
        expect(last.sinceAttemptMs).toBeLessThanOrEqual(a.durationMs);
    });

    it('measures the path against the frames: its length and its distance from the polyline through the gates', () => {
        let length = 0;
        for (let i = 1; i < pkg.frames.length; i++) {
            const a = pkg.frames[i - 1] as FlightFrame;
            const b = pkg.frames[i] as FlightFrame;
            const d = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
            if (d < 3) length += d;
        }
        expect(report.metrics.pathLengthM).toBeCloseTo(length, 0);
        expect(report.metrics.flightMs).toBe(Math.round((pkg.frames.at(-1) as FlightFrame).t - (pkg.frames[0] as FlightFrame).t));
        const dev = report.metrics.deviationM;
        expect(dev).not.toBeNull();
        expect(dev?.mean).toBeLessThan(1.5);
        expect(report.attempts.every((a) => a.deviationM !== null)).toBe(true);
    });

    it('a path that wanders away has a larger deviation (negative control)', () => {
        const wandering = pkg.frames.map((f) => ({ ...f, p: [f.p[0] + 4, f.p[1], f.p[2]] as const }));
        const other = buildReport({ ...pkg, frames: wandering }, { replay: false });
        expect((other.metrics.deviationM?.mean ?? 0) - (report.metrics.deviationM?.mean ?? 0)).toBeGreaterThan(2);
        expect(other.metrics.deviationM?.max).toBeGreaterThan((report.metrics.deviationM?.max ?? 0) + 2);
    });

    it('holds the replay check of the recording', () => {
        expect('ok' in report.replayCheck && report.replayCheck.ok).toBe(true);
        expect('line' in report.replayCheck && report.replayCheck.line).toMatch(/^replay check PASS/);
        expect(buildReport(pkg, { replay: false }).replayCheck).toEqual({ skipped: 'turned off' });
    });

    it('has a timeline of events and spoken lines, in time order, without the speech-end markers', () => {
        const t = report.timeline.map((e) => e.tMs);
        expect([...t].sort((a, b) => a - b)).toEqual(t);
        expect(report.timeline.some((e) => e.kind === 'gate')).toBe(true);
        expect(report.timeline.some((e) => e.kind === 'speech' && e.text.startsWith('says: '))).toBe(true);
        expect(report.timeline.some((e) => e.text.includes(SPEECH_END_KEY))).toBe(false);
        expect(report.metrics.speechLines).toBe(pkg.events.filter((e) => e.kind === 'speech' && e.key !== SPEECH_END_KEY).length);
    });

    it('warns that the voice has no transcript', () => {
        expect(report.warnings.some((w) => /no transcript/.test(w))).toBe(true);
        expect(report.transcript).toBeNull();
    });

    it('joins a transcript on the session clock through the voice offset', () => {
        const segments = parseTranscript(JSON.stringify([{ start: 8, end: 10, text: 'Now the second ring.' }, { start: 20.5, end: 22, text: 'I hit it.' }]));
        const joined = buildReport(pkg, { transcript: segments, transcriptName: 'talk.json', replay: false });
        const said = joined.timeline.filter((e) => e.kind === 'voice');
        expect(said.map((e) => [e.tMs, e.text])).toEqual([
            [8250, 'pilot said: Now the second ring.'],
            [20750, 'pilot said: I hit it.']
        ]);
        expect(joined.transcript).toEqual({ source: 'talk.json', segments: 2, offsetMs: 250 });
        expect(joined.warnings.some((w) => /no transcript/.test(w))).toBe(false);
        const t = joined.timeline.map((e) => e.tMs);
        expect([...t].sort((a, b) => a - b)).toEqual(t);
        // at the same instant the event comes first, then what was said
        const tie = buildReport(pkg, { transcript: [{ startMs: (pkg.events[1] as { t: number }).t - 250, endMs: 0, text: 'same time' }], replay: false });
        const at = tie.timeline.findIndex((e) => e.kind === 'voice');
        expect((tie.timeline[at - 1] as { tMs: number }).tMs).toBe((tie.timeline[at] as { tMs: number }).tMs);
    });

    it('writes Markdown a person can read: the facts, the tables, the timeline with what was said', () => {
        const md = renderMarkdown(buildReport(pkg, { transcript: [{ startMs: 8000, endMs: 10000, text: 'Now the second ring.' }], transcriptName: 'talk.json' }));
        expect(md).toMatch(/^# Fly by Sound session recordedSession00001/);
        for (const heading of ['## Replay check', '## Attempts', '## Gates', '## Timeline']) expect(md).toContain(heading);
        expect(md).toMatch(/\| Outcome \| passed at \d+:\d\d\.\d \|/);
        expect(md).toMatch(/\| 1 \| \d+:\d\d\.\d \| \d+:\d\d\.\d \| fail \| 1 \| 6 \| 0 \|/);
        expect(md).toContain('> pilot said: Now the second ring.');
        expect(md).toContain('Transcript: 1 segment from talk.json, voice offset 250 ms.');
        expect(md.endsWith('\n')).toBe(true);
    });
});

describe('the report of a package written by another tool (Python)', () => {
    it('reports the fixture without a lesson world to replay: facts, a failing replay check, survey', () => {
        const pkg = readPackage(fixture('session-python-store.zip'));
        const report = buildReport(pkg);
        expect(report.outcome).toEqual({ status: 'not-passed', success: false, attempts: 1, passedAtMs: null });
        expect(report.metrics.touches).toBe(1);
        expect(report.metrics.gatesPassed).toBe(1);
        expect(report.metrics.answers).toEqual({ given: 0, skipped: 1 });
        expect(report.survey?.answers).toHaveLength(2);
        expect(report.lesson?.title).toBe('Utrzymaj wysokość');
        // the fixture's events were not made by this lesson runner: the check must say so
        expect('ok' in report.replayCheck && report.replayCheck.ok).toBe(false);
        expect(report.timeline.find((e) => e.kind === 'speech')?.text).toBe('says: Zawiśnij na wysokości. Висите на высоте.');
    });

    it('does not break on a scan session with no world, or on a lesson this build does not have', () => {
        const pkg = readPackage(fixture('session-python-store.zip'));
        const garden = { ...pkg.manifest, lesson: { id: 'free-garden', version: 1, path: 'full' as const }, scene: { kind: 'scan' as const, id: '7a475d38', version: 1, transform: [5, 0, 0, 0] as const } };
        const scan = buildReport({ ...pkg, manifest: garden });
        expect(scan.metrics.deviationM).toBeNull();
        expect(scan.warnings.some((w) => /without a world/.test(w))).toBe(true);
        const unknown = buildReport({ ...pkg, manifest: { ...pkg.manifest, lesson: { id: 'warp-lesson', version: 1, path: 'full' } } });
        expect('skipped' in unknown.replayCheck).toBe(true);
        expect(unknown.warnings.some((w) => /cannot be rebuilt/.test(w))).toBe(true);
        expect(unknown.lesson?.title).toBeNull();
    });
});

/** A file system in memory for the command line. */
function memoryIo(files: Record<string, Uint8Array>): { io: CliIo; out: string[]; err: string[]; written: Map<string, string> } {
    const out: string[] = [];
    const err: string[] = [];
    const written = new Map<string, string>();
    const io: CliIo = {
        readFile: (path) => {
            const f = files[path];
            if (f === undefined) return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT', path }));
            return Promise.resolve(f);
        },
        writeFile: (path, text) => {
            written.set(path, text);
            return Promise.resolve();
        },
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t)
    };
    return { io, out, err, written };
}

const zipEntry = (zip: Uint8Array, name: string): Uint8Array => readZip(zip).get(name) as Uint8Array;

/** The Python fixture's own files, repacked with `manifest` and `events` in place of its own. */
function repack(zip: Uint8Array, over: { manifest?: unknown; events?: Uint8Array }): Uint8Array {
    const manifest = over.manifest === undefined ? zipEntry(zip, 'manifest.json') : utf8Encode(JSON.stringify(over.manifest));
    const parts = packFiles(manifest, { flight: zipEntry(zip, 'flight.jsonl.gz'), events: over.events ?? zipEntry(zip, 'events.jsonl'), survey: zipEntry(zip, 'survey.json') }, '2026-11-07T10:00:00Z');
    return new Uint8Array(Buffer.concat(parts));
}

describe('the command line', () => {
    const zip = fixture('session-python-store.zip');

    it('prints Markdown by default and JSON on request', async () => {
        const a = memoryIo({ 'p.zip': zip });
        expect(await main(['p.zip'], a.io)).toBe(0);
        expect(a.out.join('')).toMatch(/^# Fly by Sound session pyFixtureSession01/);
        const b = memoryIo({ 'p.zip': zip });
        expect(await main(['p.zip', '--format', 'json', '--no-replay'], b.io)).toBe(0);
        const parsed = JSON.parse(b.out.join('')) as Report;
        expect(parsed.format).toBe(REPORT_FORMAT);
        expect(parsed.replayCheck).toEqual({ skipped: 'turned off' });
    });

    it('writes the files it is asked for, and joins a transcript from a file', async () => {
        const transcript = JSON.stringify({ segments: [{ start: 0.5, end: 1.2, text: 'Ready.' }] });
        const m = memoryIo({ 'p.zip': zip, 't.json': utf8Encode(transcript) });
        expect(await main(['p.zip', '--transcript', 't.json', '--json', 'r.json', '--md', 'r.md'], m.io)).toBe(0);
        expect(m.out.join('')).toBe('report written: r.json, r.md\n');
        const json = JSON.parse(m.written.get('r.json') as string) as Report;
        expect(json.transcript).toEqual({ source: 't.json', segments: 1, offsetMs: 0 });
        expect(json.timeline.find((e) => e.kind === 'voice')?.tMs).toBe(500);
        expect(m.written.get('r.md')).toContain('> pilot said: Ready.');
    });

    it('takes the gates of a scan lesson from a track file (and has none without it)', async () => {
        const track = {
            format: 'shramko-sonic-track/1',
            id: 'garden-test',
            version: 1,
            parent: null,
            title: 'Test course',
            scene: { kind: 'scan', id: '7a475d38', version: 1 },
            transform: [5, 0, 0, 0],
            gates: [
                { id: 'ring-1', shape: { kind: 'ring', diameter: 1.2, tube: 0.04 }, pos: [0, 1, -2], quat: [1, 0, 0, 0], direction: 'forward' },
                { id: 'ring-2', shape: { kind: 'ring', diameter: 1.2, tube: 0.04 }, pos: [1, 1, -4], quat: [1, 0, 0, 0], direction: 'forward' }
            ],
            laps: 1,
            start: null,
            author: { kind: 'person', name: 'test' },
            generator: null,
            created: '2026-11-07T10:00:00Z'
        };
        // the fixture's flight, repacked under a manifest that says it was the scan lesson at x5
        const base = JSON.parse(utf8Decode(zipEntry(zip, 'manifest.json'))) as Record<string, unknown>;
        const garden = repack(zip, { manifest: { ...base, lesson: { id: 'free-garden', version: 1, path: 'full' }, scene: { kind: 'scan', id: '7a475d38', version: 1, transform: [5, 0, 0, 0] } } });
        const files = { 'g.zip': garden, 'track.json': utf8Encode(JSON.stringify(track)) };
        const without = memoryIo(files);
        expect(await main(['g.zip', '--no-replay', '--format', 'json'], without.io)).toBe(0);
        expect((JSON.parse(without.out.join('')) as Report).metrics.deviationM).toBeNull();
        const withTrack = memoryIo(files);
        expect(await main(['g.zip', '--track', 'track.json', '--no-replay', '--format', 'json'], withTrack.io)).toBe(0);
        const dev = (JSON.parse(withTrack.out.join('')) as Report).metrics.deviationM;
        expect(dev).not.toBeNull();
        expect(dev?.mean).toBeLessThan(0.5);
        const bad = memoryIo({ ...files, 'track.json': utf8Encode('{"format":"nope"}') });
        expect(await main(['g.zip', '--track', 'track.json'], bad.io)).toBe(1);
        expect(bad.err.join('')).toMatch(/track file track\.json is not valid/);
    });

    it('answers a wrong use with the usage and code 2, and a bad file with a message and code 1', async () => {
        for (const args of [[], ['--wat'], ['p.zip', 'q.zip'], ['p.zip', '--transcript'], ['p.zip', '--format', 'xml']]) {
            const m = memoryIo({ 'p.zip': zip });
            expect(await main(args, m.io), args.join(' ')).toBe(2);
            expect(m.err.join('')).toMatch(/Usage: report/);
        }
        const help = memoryIo({});
        expect(await main(['--help'], help.io)).toBe(0);
        expect(help.out.join('')).toMatch(/Usage: report/);
        const missing = memoryIo({});
        expect(await main(['nope.zip'], missing.io)).toBe(1);
        expect(missing.err.join('')).toMatch(/cannot read nope\.zip/);
        const junk = memoryIo({ 'j.zip': utf8Encode('this is not a zip archive at all, only text of some length') });
        expect(await main(['j.zip'], junk.io)).toBe(1);
        expect(junk.err.join('')).toMatch(/not a zip archive/);
        const badTranscript = memoryIo({ 'p.zip': zip, 't.txt': utf8Encode('{"a":1}') });
        expect(await main(['p.zip', '--transcript', 't.txt'], badTranscript.io)).toBe(1);
        expect(badTranscript.err.join('')).toMatch(/list of segments/);
    });

    it('refuses a damaged package, unless asked to read what it can', async () => {
        // the events file gains a line that is no event, and the manifest still holds the old hash
        const events = utf8Encode(`${utf8Decode(zipEntry(zip, 'events.jsonl')).trimEnd()}\n{"t":5,"kind":"warp"}\n`);
        const damaged = repack(zip, { events });
        const strict = memoryIo({ 'd.zip': damaged });
        expect(await main(['d.zip', '--no-replay'], strict.io)).toBe(1);
        expect(strict.err.join('')).toMatch(/problem/);
        const lenient = memoryIo({ 'd.zip': damaged });
        expect(await main(['d.zip', '--no-replay', '--lenient', '--format', 'json'], lenient.io)).toBe(0);
        const report = JSON.parse(lenient.out.join('')) as Report;
        expect(report.warnings.some((w) => /^package: event line/.test(w))).toBe(true);
        expect(report.warnings.some((w) => /events\.jsonl has \d+ bytes, the manifest says/.test(w))).toBe(true);
    });
});

describe('the command line as a program', () => {
    it('runs under plain Node through tools/run-tool.mjs (pnpm report)', () => {
        const r = spawnSync(process.execPath, ['tools/run-tool.mjs', 'report', 'test/fixtures/session-python-store.zip', '--no-replay'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^# Fly by Sound session pyFixtureSession01/);
        const bad = spawnSync(process.execPath, ['tools/run-tool.mjs', 'report', 'no-such-file.zip'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
        expect(bad.status).toBe(1);
        expect(bad.stderr).toMatch(/cannot read/);
        const unknown = spawnSync(process.execPath, ['tools/run-tool.mjs', 'nothing'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
        expect(unknown.status).toBe(1);
    }, 120000);
});
