// tools/analyze.ts on the synthetic two-lesson package of test/fixtures/make-session-fixture.py (no real recording, no
// real voice): the lessons table, every scripted difficulty at its time and step key, remarks on the right step, the
// survey tail, and the controls (the same flight without its failures has no spot; a transcript shifted by 10 s lands
// on other steps; the share-safe page holds no word of the transcript; --out inside a git tree is refused).
import { existsSync, mkdtempSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readPackage } from '../src/session';
import { analyzePackage, FEEDBACK_FORMAT, main, renderShareSafe, renderSummary, type Analysis } from '../tools/analyze';
import { parseTranscript } from '../tools/report';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = join(ROOT, 'test', 'fixtures');
const pkgOf = (name: string) => readPackage(new Uint8Array(readFileSync(join(FIX, name))));
const TRANSCRIPT_FILE = join(FIX, 'voice-two-lessons.transcript.json');
const transcript = parseTranscript(readFileSync(TRANSCRIPT_FILE, 'utf8'));
const A = 'rings-first@1#lesson.rings-first.';
const B = 'rings-line@1#lesson.rings-line.';

const hard = analyzePackage(pkgOf('session-voice-two-lessons.zip'), { transcript, replay: false });
const signals = (a: Analysis) => a.spots.flatMap((s) => s.signals.map((x) => ({ kind: x.kind, t: x.t, key: s.key })));
const tmp: string[] = [];
const tempDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'sonic-analyze-'));
    tmp.push(d);
    return d;
};
afterAll(() => {
    for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

describe('the analysis of a scripted two-lesson recording', () => {
    it('the lessons table: A passed on the fourth attempt with its touches, resets, repeat and refused digit; B left by next-lesson', () => {
        expect(hard.format).toBe(FEEDBACK_FORMAT);
        expect(hard.lessons.map((l) => [l.lessonId, l.lead, l.status, l.attempts, l.touches, l.resets, l.repeats, l.refused, l.answersSkipped, l.fromMs, l.toMs])).toEqual([
            ['rings-first', false, 'passed', 4, 3, 2, 1, 1, 1, 500, 130000],
            ['rings-line', false, 'skipped', 1, 0, 0, 0, 0, 0, 130000, 176000]
        ]);
    });

    it('every scripted difficulty is found at its time, on the step the pilot last heard', () => {
        const s = signals(hard);
        const at = (kind: string) => s.filter((x) => x.kind === kind).map((x) => x.t);
        expect(at('attempt-fail')).toEqual([10000, 46000, 90000]);
        expect(at('many-attempts')).toEqual([90000]);
        expect(at('repeat')).toEqual([25000]);
        expect(at('touch')).toEqual([40000, 42000, 44000]);
        expect(at('touch-cluster')).toEqual([44000]);
        expect(at('touch-fast')).toEqual([44000]);
        expect(at('reset')).toEqual([60010, 75010]);
        expect(at('reset-burst')).toEqual([75010]);
        expect(at('answer-refused')).toEqual([102000]);
        expect(at('answer-skip')).toEqual([115000]);
        expect(at('idle')).toEqual([133500]);
        expect(at('skip-lesson')).toEqual([143000]);
        expect(at('pause')).toEqual([]);
        // spot keys: the last lesson line at the spot's first signal
        const keyOf = (t: number) => hard.spots.find((x) => x.t <= t && x.toT >= t)?.key;
        expect(keyOf(10000)).toBe(`${A}goal.1`);
        expect(keyOf(25000)).toBe(`${A}retry`); // attempt 2 began after the retry line; goal.1 is said again only after the repeat key
        expect(keyOf(40000)).toBe(`${A}hint.1`);
        expect(keyOf(60010)).toBe(`${A}retry`);
        expect(keyOf(75010)).toBe(`${A}intro.2`);
        expect(keyOf(102000)).toBe(`${A}intro.3`);
        expect(keyOf(133500)).toBe(`${B}goal.1`);
        // spots closer than 10 s merge: the touch cluster and the second failure; the idle stretch and the skip
        expect(hard.spots.find((x) => x.t === 40000)?.toT).toBe(46000);
        expect(hard.spots.find((x) => x.t === 133500)?.toT).toBe(143000);
        // a remark near a spot doubles it
        expect(hard.spots.find((x) => x.t === 25000)).toMatchObject({ remark: true, score: 2 });
    });

    it('remarks: on the session clock (start + voiceOffsetMs), on the right step, tagged; the survey tail answers its open item', () => {
        expect(hard.remarks.map((r) => [r.t, r.key, r.tag, r.item])).toEqual([
            [26000, `${A}goal.1`, 'confusion', null],
            [61000, `${A}retry`, 'confusion', null],
            [135000, `${B}goal.1`, 'sound', null],
            [153000, null, 'survey', 'helped']
        ]);
        expect(hard.remarks[0]?.nearby).toEqual(['key repeat']);
        expect(hard.alignment.voiceOffsetMs).toBe(1500);
        const md = renderSummary(hard);
        expect(md).toContain('- helped (2:33.0): "Beeping pitch felt wonderful."');
        expect(md).toContain('"Honestly confusing, which direction now?"');
    });

    it('control: the same flight without its failures gives no spot', () => {
        const clean = analyzePackage(pkgOf('session-voice-clean.zip'), { transcript, replay: false });
        expect(clean.lessons.map((l) => [l.lessonId, l.status, l.attempts])).toEqual([
            ['rings-first', 'passed', 1],
            ['rings-line', 'passed', 1]
        ]);
        expect(clean.spots).toEqual([]);
        expect(renderSummary(clean)).toContain('No difficult spot found.');
    });

    it('control: a transcript shifted by 10 s attaches the remarks to other steps', () => {
        const shifted = transcript.map((s) => ({ ...s, startMs: s.startMs + 10000, endMs: s.endMs + 10000 }));
        const moved = analyzePackage(pkgOf('session-voice-two-lessons.zip'), { transcript: shifted, replay: false });
        const keys = (a: Analysis) => a.remarks.map((r) => r.key ?? `survey ${r.item}`);
        expect(keys(moved)).toEqual([`${A}hint.1`, `${A}intro.2`, 'survey null', 'survey helped']);
        const before = keys(hard);
        expect(keys(moved).slice(0, 3).every((k, i) => k !== before[i])).toBe(true);
    });
});

describe('the command line', () => {
    it('writes summary.md (one page), analysis.json without the nickname and a share-safe page with no word of the transcript', async () => {
        const out = tempDir();
        const said: string[] = [];
        const code = await main([join(FIX, 'session-voice-two-lessons.zip'), '--out', out, '--transcript', TRANSCRIPT_FILE, '--share-safe'], { stdout: (t) => said.push(t), stderr: (t) => said.push(t) });
        expect(code, said.join('')).toBe(0);
        const dir = join(out, 'pyVoiceTwoLessons01');
        const md = readFileSync(join(dir, 'summary.md'), 'utf8');
        const json = readFileSync(join(dir, 'analysis.json'), 'utf8');
        const safe = readFileSync(join(dir, 'summary.share-safe.md'), 'utf8');
        expect(md.split('\n').length).toBeLessThanOrEqual(60);
        expect(md).toContain('## Hardest places');
        expect(JSON.parse(json)).toMatchObject({ format: FEEDBACK_FORMAT, session: { pilotId: 'pilotFixture02' } });
        for (const text of [md, json, safe]) expect(text).not.toContain('FixtureNick');
        const words = new Set(transcript.flatMap((s) => s.text.toLowerCase().match(/\p{L}{4,}/gu) ?? []));
        expect(words.size).toBeGreaterThan(10);
        const found = [...words].filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'iu').test(safe));
        expect(found).toEqual([]);
        expect(safe).not.toContain('"');
        // the owner's page does hold them: the check above is not empty by construction
        expect([...words].filter((w) => md.toLowerCase().includes(w)).length).toBe(words.size);
        // the replay check ran on each lesson (synthetic frames: a verdict, not a pass)
        expect((JSON.parse(json) as Analysis).lessons.every((l) => !l.replay.startsWith('not checked'))).toBe(true);
        expect(renderShareSafe(hard)).not.toContain('Honestly');
    });

    it('refuses --out inside a git working tree and writes nothing', async () => {
        const out = join(ROOT, 'tmp-analyze-out-refused');
        const err: string[] = [];
        const code = await main([join(FIX, 'session-voice-two-lessons.zip'), '--out', out], { stdout: () => undefined, stderr: (t) => err.push(t) });
        expect(code).toBe(2);
        expect(err.join('')).toContain('git working tree');
        expect(existsSync(out)).toBe(false);
    });

    it('processes a folder of packages one by one, each with the transcript next to it', async () => {
        const inDir = tempDir();
        const out = tempDir();
        copyFileSync(join(FIX, 'session-voice-two-lessons.zip'), join(inDir, 'a.zip'));
        copyFileSync(TRANSCRIPT_FILE, join(inDir, 'a.transcript.json'));
        copyFileSync(join(FIX, 'session-voice-clean.zip'), join(inDir, 'b.zip'));
        const code = await main([inDir, '--out', out, '--no-replay', '--no-transcribe'], { stdout: () => undefined, stderr: () => undefined });
        expect(code).toBe(0);
        const a = JSON.parse(readFileSync(join(out, 'pyVoiceTwoLessons01', 'analysis.json'), 'utf8')) as Analysis;
        const b = JSON.parse(readFileSync(join(out, 'pyVoiceCleanFlight01', 'analysis.json'), 'utf8')) as Analysis;
        expect([a.remarks.length, a.transcript.source, b.remarks.length, b.spots.length]).toEqual([4, 'a.transcript.json', 0, 0]);
    });
});
