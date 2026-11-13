// The end-to-end check of the transcription (ShramkoGSFPV docs/wip/voice-feedback-plan.md 8, stage 1 item 4), opt-in:
// it needs the listener's Python (SHRAMKO_LISTEN_PY), the Whisper model in SHRAMKO_LISTEN_CACHE and the GPU, and takes
// minutes. Run: SHRAMKO_VOICE_E2E=1 SHRAMKO_LISTEN_PY=... SHRAMKO_LISTEN_CACHE=... pnpm vitest run test/transcribe-e2e.test.ts
// (tools/analyze.ts takes the GPU lock GPU_LOCK itself for each transcription; do not hold it around this run).
// Synthetic voices only (test/fixtures/make-voice-e2e.py): five sentences per language at known times and the app's
// lesson line at its speech time. Pass: every sentence found (word error rate within the words check's bound), its
// start within 300 ms of the truth on the session clock, the lesson line tagged echo. Controls that must fire: the
// manifest offset moved by 2 s fails the 300 ms check; the echo filter off leaves the line among the remarks. Measures
// the drift on a 10-minute track. Writes evidence/listen/VF-1-transcribe.json.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Locale } from '../src/contract';
import { readPackage } from '../src/session';
import { analyzePackage, main, type Analysis, type Remark } from '../tools/analyze';
import { BOUNDS, wordErrors, words } from '../tools/listen-words';
import { parseTranscript } from '../tools/report';

const ON = process.env['SHRAMKO_VOICE_E2E'] === '1';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LANGS: Locale[] = ['en', 'es', 'pl', 'ru'];
const BOUND_MS = 300;
const INPUTS = [
    'tools/listen/transcribe.py',
    'tools/analyze.ts',
    'tools/feedback/rules.ts',
    'tools/feedback/hallucinations.json',
    'test/fixtures/make-voice-e2e.py',
    'test/fixtures/voice-e2e-tts.ps1',
    'test/fixtures/voice-e2e-sentences.json',
    'test/transcribe-e2e.test.ts'
];

interface Truth {
    readonly offsetMs: number;
    readonly shiftMs: number;
    readonly languages: Record<string, { sentences: { text: string; tMs: number }[]; line: { text: string; tMs: number; eventMs: number } }>;
    readonly long: { sentences: { text: string; tMs: number }[] };
}

const nearest = (rs: readonly Remark[], t: number): Remark | undefined => [...rs].sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
const rate = (lang: string, ref: string, hyp: string): number => Math.round(wordErrors(words(ref, lang), words(hyp, lang)).rate * 1000) / 1000;
const scoreSentences = (a: Analysis, lang: string, truth: { text: string; tMs: number }[]) =>
    truth.map((s) => {
        const r = nearest(a.remarks.filter((x) => !x.echo), s.tMs);
        return { text: s.text, heard: r?.text ?? '', wer: r === undefined ? 1 : rate(lang, s.text, r.text), deltaMs: r === undefined ? Infinity : r.t - s.tMs };
    });
const maxAbs = (xs: readonly number[]): number => Math.max(...xs.map(Math.abs));

describe.skipIf(!ON)('transcription end to end on synthetic voices (GPU)', () => {
    let work = '';
    let out = '';
    let truth: Truth;
    const analyses: Record<string, Analysis> = {};
    const shifted: Record<string, Analysis> = {};
    const evidence: Record<string, unknown> = {};

    beforeAll(async () => {
        work = mkdtempSync(join(tmpdir(), 'sonic-voice-e2e-'));
        out = mkdtempSync(join(tmpdir(), 'sonic-voice-e2e-out-'));
        const py = process.env['SHRAMKO_LISTEN_PY'] ?? 'python';
        const b = spawnSync(py, ['-X', 'utf8', join(ROOT, 'test', 'fixtures', 'make-voice-e2e.py'), '--work', work], { encoding: 'utf8' });
        if (b.status !== 0) throw new Error(`make-voice-e2e.py failed: ${b.stderr}`);
        truth = JSON.parse(readFileSync(join(work, 'truth.json'), 'utf8')) as Truth;
        const io = { stdout: (t: string) => process.stdout.write(t), stderr: (t: string) => process.stderr.write(t) };
        for (const name of [...LANGS, 'long-en']) {
            const code = await main([join(work, `e2e-${name}.zip`), '--out', out, '--no-replay'], io);
            if (code !== 0) throw new Error(`analyze failed on e2e-${name}.zip (exit ${code})`);
        }
        for (const lang of LANGS) {
            const id = `e2eVoice${lang.toUpperCase()}01`;
            analyses[lang] = JSON.parse(readFileSync(join(out, id, 'analysis.json'), 'utf8')) as Analysis;
            // the control: the same voice with the manifest offset moved by 2 s, read with the transcript made above
            const code = await main([join(work, `e2e-${lang}-shift.zip`), '--out', out, '--no-replay', '--transcript', join(out, id, 'transcript.json')], io);
            if (code !== 0) throw new Error(`analyze failed on e2e-${lang}-shift.zip`);
            shifted[lang] = JSON.parse(readFileSync(join(out, `e2eVoice${lang.toUpperCase()}Shift`, 'analysis.json'), 'utf8')) as Analysis;
        }
        analyses['long'] = JSON.parse(readFileSync(join(out, 'e2eVoiceLongEN01', 'analysis.json'), 'utf8')) as Analysis;
    }, 40 * 60 * 1000);

    afterAll(() => {
        if (work === '') return;
        const hash = createHash('sha256');
        for (const f of INPUTS) hash.update(`${f}\n`).update(readFileSync(join(ROOT, f)));
        const t = JSON.parse(readFileSync(join(out, 'e2eVoiceEN01', 'transcript.json'), 'utf8')) as { decode: unknown; tools: unknown };
        const doc = { format: 'shramko-voice-e2e/1', key: hash.digest('hex'), date: new Date().toISOString(), inputs: INPUTS, decode: t.decode, tools: t.tools, boundMs: BOUND_MS, werBounds: BOUNDS, ...evidence };
        writeFileSync(join(ROOT, 'evidence', 'listen', 'VF-1-transcribe.json'), `${JSON.stringify(doc, null, 1)}\n`);
        rmSync(work, { recursive: true, force: true });
        rmSync(out, { recursive: true, force: true });
    });

    it('finds every sentence within the bound, starting within 300 ms of the truth, and tags the lesson line echo', () => {
        const rows: Record<string, unknown> = {};
        for (const lang of LANGS) {
            const a = analyses[lang] as Analysis;
            const t = truth.languages[lang]!;
            const s = scoreSentences(a, lang, t.sentences);
            const line = nearest(a.remarks, t.line.tMs);
            rows[lang] = {
                language: a.transcript.language,
                dropped: a.transcript.dropped,
                sentences: s,
                maxWer: Math.max(...s.map((x) => x.wer)),
                maxAbsDeltaMs: maxAbs(s.map((x) => x.deltaMs)),
                line: { heard: line?.text ?? '', wer: line === undefined ? 1 : rate(lang, t.line.text, line.text), deltaToEventMs: line === undefined ? null : line.t - t.line.eventMs, echo: line?.echo ?? false }
            };
        }
        evidence['languages'] = rows;
        process.stdout.write(`e2e: ${JSON.stringify(Object.fromEntries(Object.entries(rows).map(([l, r]) => [l, { maxWer: (r as { maxWer: number }).maxWer, maxAbsDeltaMs: (r as { maxAbsDeltaMs: number }).maxAbsDeltaMs, line: (r as { line: unknown }).line }])))}\n`);
        for (const lang of LANGS) {
            const r = rows[lang] as { maxWer: number; maxAbsDeltaMs: number; line: { echo: boolean } };
            expect(r.maxWer, lang).toBeLessThanOrEqual(BOUNDS[lang]);
            expect(r.maxAbsDeltaMs, lang).toBeLessThanOrEqual(BOUND_MS);
            expect(r.line.echo, lang).toBe(true);
        }
    });

    it('control: the manifest offset moved by 2 s fails the 300 ms check', () => {
        const rows: Record<string, number> = {};
        for (const lang of LANGS) rows[lang] = maxAbs(scoreSentences(shifted[lang] as Analysis, lang, truth.languages[lang]!.sentences).map((x) => x.deltaMs));
        evidence['controlShift'] = rows;
        process.stdout.write(`e2e control shift: ${JSON.stringify(rows)}\n`);
        for (const lang of LANGS) expect(rows[lang], lang).toBeGreaterThan(BOUND_MS);
    });

    it('control: with the echo filter off the lesson line stays among the remarks', () => {
        const rows: Record<string, boolean> = {};
        for (const lang of LANGS) {
            const id = `e2eVoice${lang.toUpperCase()}01`;
            const pkg = readPackage(new Uint8Array(readFileSync(join(work, `e2e-${lang}.zip`))));
            const a = analyzePackage(pkg, { transcript: parseTranscript(readFileSync(join(out, id, 'transcript.json'), 'utf8')), replay: false, echo: false });
            const line = nearest(a.remarks, truth.languages[lang]!.line.tMs);
            rows[lang] = line !== undefined && !line.echo && rate(lang, truth.languages[lang]!.line.text, line.text) < 0.4;
        }
        evidence['controlEchoOff'] = rows;
        for (const lang of LANGS) expect(rows[lang], lang).toBe(true);
    });

    it('measures the drift on a 10-minute track', () => {
        const a = analyses['long'] as Analysis;
        const s = scoreSentences(a, 'en', truth.long.sentences);
        const xs = truth.long.sentences.map((x) => x.tMs / 60000);
        const ys = s.map((x) => x.deltaMs);
        const mx = xs.reduce((p, x) => p + x, 0) / xs.length;
        const my = ys.reduce((p, y) => p + y, 0) / ys.length;
        const slope = xs.reduce((p, x, i) => p + (x - mx) * ((ys[i] as number) - my), 0) / xs.reduce((p, x) => p + (x - mx) ** 2, 0);
        const long = {
            sentences: s.length,
            found: s.filter((x) => x.wer <= BOUNDS.en).length,
            meanDeltaMs: Math.round(my),
            maxAbsDeltaMs: maxAbs(ys),
            slopeMsPerMin: Math.round(slope * 100) / 100,
            driftMsOver10Min: Math.round(slope * 10),
            firstDeltaMs: ys[0],
            lastDeltaMs: ys[ys.length - 1]
        };
        evidence['long'] = long;
        process.stdout.write(`e2e long: ${JSON.stringify(long)}\n`);
        expect(long.found).toBe(s.length);
        expect(long.maxAbsDeltaMs).toBeLessThanOrEqual(BOUND_MS);
    });
});
