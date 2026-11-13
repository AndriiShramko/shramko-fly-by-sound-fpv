// Stage 2 of tools/analyze.ts without a GPU: the echo filter (a segment that says a line of the app near its time is the
// app's voice heard by the microphone: tagged echo, left out of the pages and the spots), the drift read off the echoes,
// the transcriber step of the command line with a fake transcriber (called for voice.webm without a transcript, skipped by
// --no-transcribe, its failure an error of that package), and tools/listen/transcribe.py without a model: it refuses to run
// when the model is not in the cache (nothing downloaded) and its drop rules (no speech, silence hallucinations).
// The real transcription on synthetic voices is test/transcribe-e2e.test.ts (opt-in, GPU).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readPackage } from '../src/session';
import { analyzePackage, main, renderShareSafe, renderSummary, TranscribeError, type Analysis, type Transcriber } from '../tools/analyze';
import { parseTranscript, type TranscriptSegment } from '../tools/report';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = join(ROOT, 'test', 'fixtures');
const ZIP = join(FIX, 'session-voice-two-lessons.zip');
const pkg = readPackage(new Uint8Array(readFileSync(ZIP)));
const OFFSET = 1500; // VOICE_OFFSET_MS of make-session-fixture.py
const base = parseTranscript(readFileSync(join(FIX, 'voice-two-lessons.transcript.json'), 'utf8'));
// session times: the line "Fly through the ring." is said at 5100 and 25100, "Try again." at 10100, 46100, 90100
const at = (sessionMs: number, text: string): TranscriptSegment => ({ startMs: sessionMs - OFFSET, endMs: sessionMs - OFFSET + 1200, text });
const transcript = [...base, at(5300, 'Fly through the ring'), at(25500, 'fly through the ring.'), at(9000, 'Where is the ring now'), at(15000, 'Fly through the ring again')];
const tmp: string[] = [];
const tempDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'sonic-transcribe-'));
    tmp.push(d);
    return d;
};
afterAll(() => {
    for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
const remarkAt = (a: Analysis, t: number) => a.remarks.find((r) => r.t === t);

describe('the echo filter', () => {
    const on = analyzePackage(pkg, { transcript, replay: false });
    const off = analyzePackage(pkg, { transcript, replay: false, echo: false });

    it('tags a segment that says a line of the app within 3 s as echo, and only that', () => {
        expect([remarkAt(on, 5300)?.echo, remarkAt(on, 25500)?.echo]).toEqual([true, true]);
        // a different text near a line, the same text far from it, and the pilot's own remarks are no echo
        expect([remarkAt(on, 9000)?.echo, remarkAt(on, 15000)?.echo, remarkAt(on, 26000)?.echo]).toEqual([false, false, false]);
        expect(on.transcript.echo).toBe(2);
    });

    it('leaves the echo out of the summary and the share-safe page, and keeps it in analysis.json', () => {
        expect(renderSummary(on)).not.toContain('"Fly through the ring"');
        expect(renderSummary(on)).toContain('"Where is the ring now"');
        expect(renderShareSafe(off).split('\n').length - renderShareSafe(on).split('\n').length).toBe(2);
        expect(on.remarks.filter((r) => r.echo).map((r) => r.text)).toEqual(['Fly through the ring', 'fly through the ring.']);
    });

    it('control: with the filter off the line stays among the remarks', () => {
        expect(off.remarks.some((r) => r.echo)).toBe(false);
        expect(off.transcript.echo).toBe(0);
        expect(renderSummary(off)).toContain('"Fly through the ring"');
    });

    it('reads the drift off the echoes: the second lands 200 ms later after its line than the first', () => {
        expect(on.alignment.driftMs).toBe(200);
        expect(analyzePackage(pkg, { transcript: base, replay: false }).alignment.driftMs).toBeNull();
    });
});

describe('the transcriber step of the command line', () => {
    const fake = (calls: { lang: string; dir: string; bytes: number }[]): Transcriber => async (voice, lang, dir) => {
        calls.push({ lang, dir, bytes: voice.length });
        return { segments: transcript, language: 'en', modelRevision: 'fake-revision', dropped: 2 };
    };

    it('transcribes voice.webm when no transcript is given, in the package language, into the summary folder', async () => {
        const out = tempDir();
        const calls: { lang: string; dir: string; bytes: number }[] = [];
        const said: string[] = [];
        const code = await main([ZIP, '--out', out, '--no-replay'], { stdout: (t) => said.push(t), stderr: (t) => said.push(t), transcribe: fake(calls) });
        expect(code).toBe(0);
        expect(calls).toEqual([{ lang: 'en', dir: join(out, 'pyVoiceTwoLessons01'), bytes: 404 }]);
        const a = JSON.parse(readFileSync(join(out, 'pyVoiceTwoLessons01', 'analysis.json'), 'utf8')) as Analysis;
        expect(a.transcript).toEqual({ source: 'transcript.json', segments: transcript.length, dropped: 2, echo: 2, language: 'en', modelRevision: 'fake-revision' });
        expect(a.warnings.some((w) => w.includes('no transcript'))).toBe(false);
        expect(said.join('')).toContain(`${transcript.length - 2} remarks, 2 echo`);
    });

    it('--no-transcribe skips it and says so', async () => {
        const out = tempDir();
        const calls: { lang: string; dir: string; bytes: number }[] = [];
        const code = await main([ZIP, '--out', out, '--no-replay', '--no-transcribe'], { stdout: () => undefined, stderr: () => undefined, transcribe: fake(calls) });
        expect([code, calls.length]).toEqual([0, 0]);
        const a = JSON.parse(readFileSync(join(out, 'pyVoiceTwoLessons01', 'analysis.json'), 'utf8')) as Analysis;
        expect(a.warnings).toContain('voice.webm is in the package but no transcript was given');
    });

    it('a failed transcription is an error of that package (exit 1), with no summary written', async () => {
        const out = tempDir();
        const err: string[] = [];
        const failing: Transcriber = async () => {
            throw new TranscribeError('transcribe.py failed (exit 3): the model is not in the cache');
        };
        const code = await main([ZIP, '--out', out, '--no-replay'], { stdout: () => undefined, stderr: (t) => err.push(t), transcribe: failing });
        expect(code).toBe(1);
        expect(err.join('')).toContain('not in the cache');
        expect(existsSync(join(out, 'pyVoiceTwoLessons01', 'summary.md'))).toBe(false);
    });
});

const PY = process.env['SHRAMKO_LISTEN_PY'] ?? 'python';
const hasPython = spawnSync(PY, ['--version'], { encoding: 'utf8' }).status === 0;
const SCRIPT = join(ROOT, 'tools', 'listen', 'transcribe.py');

describe.skipIf(!hasPython)('tools/listen/transcribe.py without a model', () => {
    it('stops with exit 3 when the model is not in the cache, and downloads nothing', () => {
        const model = tempDir();
        const out = join(tempDir(), 'transcript.json');
        const r = spawnSync(PY, ['-X', 'utf8', SCRIPT, '--audio', ZIP, '--model', model, '--out', out, '--lang', 'en'], { encoding: 'utf8' });
        expect(r.status).toBe(3);
        expect(r.stderr).toContain('not in the cache');
        expect([readdirSync(model).length, existsSync(out)]).toEqual([0, false]);
    });

    it('drops no-speech segments and silence hallucinations of the language, and keeps the rest', () => {
        const dir = tempDir();
        const seg = (start: number, text: string, noSpeechProb = 0.1, avgLogprob = -0.3) => ({ start, end: start + 1, text, noSpeechProb, avgLogprob, words: [] });
        const raw = {
            segments: [
                seg(1, 'The ring is too quiet.'),
                seg(3, 'Thank you for watching!'),
                seg(5, 'Hmm', 0.9, -1.5),
                seg(7, 'Left, now left.', 0.9, -0.2),
                seg(9, 'Субтитры сделал DimaTorzok'),
                seg(11, 'Где кольцо?')
            ]
        };
        writeFileSync(join(dir, 'raw.json'), JSON.stringify(raw));
        const run = (lang: string) => {
            const out = join(dir, `${lang}.json`);
            const r = spawnSync(PY, ['-X', 'utf8', SCRIPT, '--filter', join(dir, 'raw.json'), '--lang', lang, '--hallucinations', join(ROOT, 'tools', 'feedback', 'hallucinations.json'), '--out', out], { encoding: 'utf8' });
            expect(r.status, r.stderr).toBe(0);
            return JSON.parse(readFileSync(out, 'utf8')) as { segments: { start: number }[]; dropped: { start: number; reason: string }[] };
        };
        const ru = run('ru');
        expect(ru.segments.map((s) => s.start)).toEqual([1, 7, 11]);
        expect(ru.dropped.map((d) => [d.start, d.reason])).toEqual([[3, 'hallucination'], [5, 'no speech'], [9, 'hallucination']]);
        // the Russian list is not applied to an English recording (English applies to every language)
        expect(run('en').segments.map((s) => s.start)).toEqual([1, 7, 9, 11]);
        // what parseTranscript reads
        expect(parseTranscript(readFileSync(join(dir, 'ru.json'), 'utf8')).map((s) => s.startMs)).toEqual([1000, 7000, 11000]);
    });
});
