// The virtual listener's first measuring rig, the driver (docs/design/virtual-listener.md, sections 2 and 6;
// VL-0 and a cheap part of VL-2 and VL-6). One command runs it all:
//
//   pnpm listen            (node tools/run-tool.mjs listen [--force] [--keep-renders])
//
// 1. Speech clips: the lines the scripted flight speaks, made once with the Windows desktop voice (SAPI, the
//    local voice family of Chrome's speechSynthesis) by tools/listen/tts/sapi-clips.ps1, kept in the cache.
// 2. Renders: the scripted flights of test-audio/page/listen.ts through the real engine in headless Chrome
//    (OfflineAudioContext, 48 kHz), the mix and one stem per layer, plus the controls; float32 WAV and the truth
//    per frame, kept in the cache under the hash of every input. The browser runs only headless and only while
//    this process holds the machine's GPU lock (GPU_LOCK, default C:/dev/.gpu-lock: mkdir in a loop, rmdir after).
// 3. Measurements: tools/listen/measure.py in the Python environment of tools/listen/requirements.txt
//    (SHRAMKO_LISTEN_PY, default `python`).
// 4. Evidence: evidence/listen/<check>.json and index.json, keyed by the hash of the inputs. With nothing changed
//    since the last passing run, nothing runs again (--force runs it anyway).
//
// The cache is SHRAMKO_LISTEN_CACHE (default <repo>/.cache/listen, gitignored; point it at a data disk).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { DICTS } from '../src/i18n/dicts';
import { createTranslator } from '../src/i18n/translator';
import { CRAFT_IDS, DEFAULT_CRAFT, type RenderRequest, type RenderResult, type SpeechClip } from '../test-audio/page/listen-types';

/** Bump when the driver's jobs or file layout change. */
export const DRIVER_VERSION = 3;

const ROOT = process.cwd();
const HASHED = ['src', 'themes', 'lessons', 'locales', 'test-audio/page/listen.ts', 'tools/listen.ts', 'tools/listen', 'package.json', 'pnpm-lock.yaml'];

interface Job {
    readonly id: string;
    readonly req: Omit<RenderRequest, 'clips'>;
}

const STEMS = ['safety', 'height', 'target', 'shape', 'room', 'motor'] as const;

/**
 * Every render the checks need: the flights, their stems and the controls. The flights fly the simulator's default
 * craft's motor; the motor's stem is rendered once more for every other craft (review M3).
 */
export function jobs(): Job[] {
    const out: Job[] = [];
    const add = (id: string, req: Omit<RenderRequest, 'clips'>): void => {
        out.push({ id, req });
    };
    add('height-climb-soft', { scenario: 'height-climb', theme: 'soft', variant: null, solo: null });
    add('height-climb-soft-stepped', { scenario: 'height-climb', theme: 'soft', variant: 'stepped', solo: null });
    for (const v of [1, 3, 5] as const) add(`approach-${v}-soft`, { scenario: `approach-${v}`, theme: 'soft', variant: null, solo: null });
    add('approach-5-soft-distance-only', { scenario: 'approach-5', theme: 'soft', variant: 'distance-only', solo: null });
    for (const theme of ['soft', 'clear', 'race'] as const) add(`flight-${theme}`, { scenario: 'flight', theme, variant: null, solo: null });
    add('flight-soft-again', { scenario: 'flight', theme: 'soft', variant: null, solo: null });
    add('flight-soft-seed-2', { scenario: 'flight', theme: 'soft', variant: 'seed-2', solo: null });
    for (const s of STEMS) add(`flight-soft-solo-${s}`, { scenario: 'flight', theme: 'soft', variant: null, solo: [s] });
    add('flight-soft-motor-raw-60-solo-motor', { scenario: 'flight', theme: 'soft', variant: 'motor-raw-60', solo: ['motor'] });
    for (const craft of CRAFT_IDS) if (craft !== DEFAULT_CRAFT) add(`flight-soft-solo-motor-${craft}`, { scenario: 'flight', theme: 'soft', variant: null, solo: ['motor'], craft });
    add('hover-band-soft', { scenario: 'hover-band', theme: 'soft', variant: null, solo: null });
    add('hover-band-soft-target-steady', { scenario: 'hover-band', theme: 'soft', variant: 'target-steady', solo: null });
    // lane s13-elev: the open-way chime above and below, the up/down direction on and off, each with its dry twin
    for (const variant of [null, 'dry', 'direction-off', 'direction-off-dry'] as const) add(`free-chime-soft${variant === null ? '' : `-${variant}`}`, { scenario: 'free-chime', theme: 'soft', variant, solo: null });
    return out;
}

// ------------------------------------------------------------------ hashing

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

function filesUnder(path: string): string[] {
    const abs = join(ROOT, path);
    if (!existsSync(abs)) return [];
    if (statSync(abs).isFile()) return [path];
    const out: string[] = [];
    for (const name of readdirSync(abs).sort()) {
        if (name === '__pycache__' || name === 'node_modules') continue;
        out.push(...filesUnder(`${path}/${name}`));
    }
    return out;
}

/** The hash of every input of the rig: the engine, its data, the rig's own code. */
export function inputsHash(): { readonly hash: string; readonly files: number } {
    const files = [...new Set(HASHED.flatMap(filesUnder))].sort();
    const lines = files.map((f) => `${f} ${sha256(readFileSync(join(ROOT, f)))}`);
    return { hash: sha256(`listen-driver/${DRIVER_VERSION}\n${lines.join('\n')}`), files: files.length };
}

// ------------------------------------------------------------------ files

function wavFloat32(channels: readonly Float32Array[], rate: number): Buffer {
    const n = (channels[0] as Float32Array).length;
    const ch = channels.length;
    const data = Buffer.alloc(n * ch * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) data.writeFloatLE((channels[c] as Float32Array)[i] as number, (i * ch + c) * 4);
    const head = Buffer.alloc(44);
    head.write('RIFF', 0);
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVEfmt ', 8);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(3, 20); // IEEE float
    head.writeUInt16LE(ch, 22);
    head.writeUInt32LE(rate, 24);
    head.writeUInt32LE(rate * ch * 4, 28);
    head.writeUInt16LE(ch * 4, 32);
    head.writeUInt16LE(32, 34);
    head.write('data', 36);
    head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
}

/** Length of a PCM WAV file, s (the clip maker's 16-bit mono). */
function wavSeconds(path: string): number {
    const b = readFileSync(path);
    let i = 12;
    let rate = 0;
    let blockAlign = 0;
    while (i + 8 <= b.length) {
        const id = b.toString('ascii', i, i + 4);
        const size = b.readUInt32LE(i + 4);
        if (id === 'fmt ') {
            rate = b.readUInt32LE(i + 12);
            blockAlign = b.readUInt16LE(i + 20);
        } else if (id === 'data') return size / blockAlign / rate;
        i += 8 + size + (size % 2);
    }
    throw new Error(`no data chunk in ${path}`);
}

// ------------------------------------------------------------------ speech clips

/** The lines the flight speaks (test-audio/page/listen.ts LINES), in English, and their clips. */
function speechClips(cache: string): { readonly dir: string; readonly clips: (SpeechClip & { readonly file: string })[] } {
    const tr = createTranslator('en', DICTS);
    const lines = [
        { key: 'fly.go', text: tr.text({ key: 'fly.go' }) },
        { key: 'lesson.rings-first.hint.1', text: tr.text({ key: 'lesson.rings-first.hint.1' }) },
        { key: 'fly.attempt', text: tr.text({ key: 'fly.attempt', params: { n: 2 } }) }
    ];
    const voice = 'Microsoft David Desktop';
    const dir = join(cache, 'speech', 'sapi-david');
    mkdirSync(dir, { recursive: true });
    const withFile = lines.map((l) => ({ ...l, file: `${sha256(`${voice}\n${l.text}`).slice(0, 24)}.wav` }));
    const missing = withFile.filter((l) => !existsSync(join(dir, l.file)));
    if (missing.length > 0) {
        const list = join(dir, 'lines.json');
        writeFileSync(list, JSON.stringify(missing.map((l) => ({ id: l.file.slice(0, -4), text: l.text }))));
        const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'tools', 'listen', 'tts', 'sapi-clips.ps1'), '-Lines', list, '-Out', dir, '-Voice', voice], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`the clip maker failed: ${r.stderr || r.stdout}`);
    }
    return { dir, clips: withFile.map((l) => ({ ...l, durS: wavSeconds(join(dir, l.file)) })) };
}

// ------------------------------------------------------------------ the browser

async function bundle(): Promise<string> {
    const result = await build({
        configFile: false,
        logLevel: 'warn',
        root: ROOT,
        build: { write: false, minify: false, target: 'es2022', emptyOutDir: false, lib: { entry: join(ROOT, 'test-audio', 'page', 'listen.ts'), formats: ['iife'], name: 'SonicListenBundle', fileName: () => 'listen.js' } }
    });
    const outputs = Array.isArray(result) ? result : [result];
    for (const o of outputs) {
        if (o !== null && typeof o === 'object' && 'output' in o) {
            const chunk = (o as { output: { type: string; code?: string }[] }).output.find((x) => x.type === 'chunk');
            if (chunk?.code !== undefined) return chunk.code;
        }
    }
    throw new Error('the rig page did not bundle');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The machine's rule: a browser runs while this process holds the GPU lock (mkdir, 20 s between tries, 9 minutes at most). */
async function takeLock(path: string): Promise<() => void> {
    const deadline = Date.now() + 9 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(path);
            return () => {
                try {
                    rmdirSync(path);
                } catch {
                    // already gone
                }
            };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            if (Date.now() > deadline) throw new Error(`could not take ${path} within 9 minutes`);
            await sleep(20_000);
        }
    }
}

async function launch(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
        return chromium.launch({ headless: true });
    }
}

async function renderAll(todo: readonly Job[], clips: readonly SpeechClip[], dir: string, files: ReadonlyMap<string, string>, lockPath: string, log: (s: string) => void): Promise<string> {
    const code = await bundle();
    const release = await takeLock(lockPath);
    let browser: Browser | null = null;
    try {
        browser = await launch();
        const page: Page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sonic listen</title></head><body></body></html>');
        await page.addScriptTag({ content: code });
        if (errors.length > 0) throw new Error(errors.join('\n'));
        for (const job of todo) {
            const t0 = Date.now();
            const r = (await page.evaluate(async (req) => (globalThis as unknown as { SonicListen: { render(q: unknown): Promise<unknown> } }).SonicListen.render(req), { ...job.req, clips } as RenderRequest)) as RenderResult;
            const channels = r.channels.map((b64) => {
                const buf = Buffer.from(b64, 'base64');
                return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
            });
            writeFileSync(join(dir, `${job.id}.wav`), wavFloat32(channels, r.rate));
            const speech = r.speech.map((s) => ({ ...s, clipFile: files.get(s.key) ?? null }));
            writeFileSync(join(dir, `${job.id}.json`), JSON.stringify({ job: job.id, request: job.req, frames: r.frames, rate: r.rate, truth: r.truth, speech, targetNotes: r.targetNotes, userAgent: r.userAgent }));
            log(`  rendered ${job.id}: ${(r.frames / r.rate).toFixed(1)} s of audio in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        }
        return browser.version();
    } finally {
        await browser?.close();
        release();
    }
}

// ------------------------------------------------------------------ the command

interface Check {
    readonly id: string;
    readonly claim: string;
    readonly valid: boolean;
    readonly pass: boolean;
    readonly [k: string]: unknown;
}

export async function main(argv: readonly string[]): Promise<number> {
    const force = argv.includes('--force');
    const out = (s: string): void => {
        process.stdout.write(`${s}\n`);
    };
    if (!existsSync(join(ROOT, 'tools', 'listen', 'measure.py'))) {
        process.stderr.write('listen: run it from the repository root (pnpm listen)\n');
        return 2;
    }
    const cache = process.env['SHRAMKO_LISTEN_CACHE'] ?? join(ROOT, '.cache', 'listen');
    const py = process.env['SHRAMKO_LISTEN_PY'] ?? 'python';
    const lockPath = process.env['GPU_LOCK'] ?? 'C:/dev/.gpu-lock';
    const inputs = inputsHash();
    const evidenceDir = join(ROOT, 'evidence', 'listen');
    const indexPath = join(evidenceDir, 'index.json');
    if (!force && existsSync(indexPath)) {
        const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as { key?: string; pass?: boolean };
        if (idx.key === inputs.hash && idx.pass === true) {
            out(`listen: the evidence is fresh for these inputs (${inputs.hash.slice(0, 12)}): nothing to run (--force runs it again)`);
            return 0;
        }
    }
    const check = spawnSync(py, ['-X', 'utf8', '-c', 'import numpy, scipy, soundfile, pyloudnorm'], { encoding: 'utf8' });
    if (check.status !== 0) {
        process.stderr.write(`listen: the Python environment (${py}) lacks the packages of tools/listen/requirements.txt; set SHRAMKO_LISTEN_PY to its python\n`);
        return 2;
    }
    const speech = speechClips(cache);
    const files = new Map(speech.clips.map((c) => [c.key, c.file] as const));
    const clips: SpeechClip[] = speech.clips.map((c) => ({ key: c.key, text: c.text, durS: c.durS }));
    const renderDir = join(cache, 'renders', inputs.hash.slice(0, 16));
    mkdirSync(renderDir, { recursive: true });
    const all = jobs();
    const todo = all.filter((j) => force || !existsSync(join(renderDir, `${j.id}.wav`)) || !existsSync(join(renderDir, `${j.id}.json`)));
    let chrome = 'cached';
    if (todo.length > 0) {
        out(`listen: rendering ${todo.length} of ${all.length} flights in headless Chrome (cache ${relative(ROOT, renderDir) || renderDir})`);
        chrome = await renderAll(todo, clips, renderDir, files, lockPath, out);
    }
    const resultsPath = join(renderDir, 'results.json');
    const m = spawnSync(py, ['-X', 'utf8', join(ROOT, 'tools', 'listen', 'measure.py'), '--renders', renderDir, '--clips', speech.dir, '--out', resultsPath], { encoding: 'utf8' });
    out(m.stdout.trim());
    if (m.status !== 0 && !existsSync(resultsPath)) {
        process.stderr.write(`listen: the measurements failed: ${m.stderr}\n`);
        return 1;
    }
    const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as { measure: number; tools: Record<string, string>; checks: Check[] };
    mkdirSync(evidenceDir, { recursive: true });
    const meta = { inputs: { hash: inputs.hash, files: inputs.files, driver: DRIVER_VERSION, measure: results.measure, chrome, tools: results.tools }, date: new Date().toISOString() };
    for (const c of results.checks) {
        writeFileSync(join(evidenceDir, `${c.id}.json`), `${JSON.stringify({ format: 'shramko-listen-evidence/1', key: inputs.hash, ...meta, ...c }, null, 1)}\n`);
    }
    const pass = results.checks.every((c) => c.pass);
    const index = { format: 'shramko-listen-index/1', key: inputs.hash, pass, ...meta, run: 'pnpm listen', checks: results.checks.map((c) => ({ id: c.id, valid: c.valid, pass: c.pass, file: `${c.id}.json` })) };
    writeFileSync(indexPath, `${JSON.stringify(index, null, 1)}\n`);
    out(`listen: ${pass ? 'PASS' : 'FAIL'} (${results.checks.filter((c) => c.pass).length} of ${results.checks.length} checks); evidence in evidence/listen/`);
    return pass ? 0 : 1;
}
