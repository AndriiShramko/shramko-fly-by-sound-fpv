// Runs the audio proofs (test-audio/page/proofs.ts) in headless Chromium and keeps the evidence.
// `pnpm proof:audio`. Audio only: nothing is drawn, so no GPU lock is needed. The page bundle is
// built with Vite in memory; the browser gets it as an inline script on an empty page, so nothing
// is served and nothing touches the network.
//
// LISTEN=1 also renders a short ring flight in each shipped theme to .cache/listen/<theme>.wav.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EVIDENCE = join(ROOT, 'evidence', 'audio-proofs.json');

interface Check {
    readonly ok: boolean;
    readonly measured: Record<string, unknown>;
}
interface ProofResult {
    readonly name: string;
    readonly claim: string;
    readonly shipped: Check;
    readonly control: Check & { readonly broken: string };
    readonly pass: boolean;
}
interface ProofReport {
    readonly userAgent: string;
    readonly sampleRate: number;
    readonly proofs: readonly ProofResult[];
}
interface PageApi {
    runProofs(names?: readonly string[]): Promise<ProofReport>;
    renderListen(theme: string, seconds?: number): Promise<{ left: number[]; right: number[]; sampleRate: number }>;
    PROOFS: string[];
}

async function bundle(): Promise<string> {
    const result = await build({
        configFile: false,
        logLevel: 'warn',
        root: ROOT,
        build: {
            write: false,
            minify: false,
            target: 'es2022',
            emptyOutDir: false,
            lib: { entry: join(ROOT, 'test-audio', 'page', 'proofs.ts'), formats: ['iife'], name: 'SonicProofsBundle', fileName: () => 'proofs.js' }
        }
    });
    const outputs = Array.isArray(result) ? result : [result];
    for (const o of outputs) {
        if (o !== null && typeof o === 'object' && 'output' in o) {
            const chunk = (o as { output: { type: string; code?: string }[] }).output.find((x) => x.type === 'chunk');
            if (chunk?.code !== undefined) return chunk.code;
        }
    }
    throw new Error('the proof page did not bundle');
}

/** System Chrome, headless (as the simulator's harness runs); Playwright's bundled Chromium where there is none. */
async function launchBrowser(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
        return chromium.launch({ headless: true });
    }
}

function wav(left: number[], right: number[], rate: number): Buffer {
    const n = left.length;
    const buf = Buffer.alloc(44 + n * 4);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + n * 4, 4);
    buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
        buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] as number)) * 32767), 44 + i * 4);
        buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] as number)) * 32767), 46 + i * 4);
    }
    return buf;
}

describe('audio proofs in headless Chromium', () => {
    let browser: Browser;
    let page: Page;
    let report: ProofReport;

    beforeAll(async () => {
        const code = await bundle();
        browser = await launchBrowser();
        page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sonic proofs</title></head><body></body></html>');
        await page.addScriptTag({ content: code });
        if (errors.length > 0) throw new Error(errors.join('\n'));
        const only = process.env['PROOFS'];
        report = await page.evaluate(async (names) => {
            const api = (globalThis as unknown as { SonicProofs: PageApi }).SonicProofs;
            return api.runProofs(names ?? undefined);
        }, only === undefined ? null : only.split(','));
        const evidence = {
            what: 'Fly by Sound audio proofs: the real engine rendered offline in headless Chromium, each check also run on an engine broken on purpose (control), which must fail',
            run: 'pnpm proof:audio',
            date: new Date().toISOString(),
            browser: browser.version(),
            userAgent: report.userAgent,
            sampleRate: report.sampleRate,
            proofs: report.proofs
        };
        mkdirSync(dirname(EVIDENCE), { recursive: true });
        writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
        if (process.env['LISTEN'] === '1') {
            const dir = join(ROOT, '.cache', 'listen');
            mkdirSync(dir, { recursive: true });
            for (const theme of ['soft', 'clear', 'race']) {
                const r = await page.evaluate(async (t) => (globalThis as unknown as { SonicProofs: PageApi }).SonicProofs.renderListen(t, 12), theme);
                writeFileSync(join(dir, `${theme}.wav`), wav(r.left, r.right, r.sampleRate));
            }
        }
    }, 600_000);

    afterAll(async () => {
        await browser?.close();
    });

    it('every proof passes on the shipped engine and fails on its broken control', () => {
        expect(report.proofs.length).toBeGreaterThan(0);
        for (const p of report.proofs) {
            expect(p.shipped.ok, `${p.name} shipped: ${JSON.stringify(p.shipped.measured)}`).toBe(true);
            expect(p.control.ok, `${p.name} control (${p.control.broken}) must fail: ${JSON.stringify(p.control.measured)}`).toBe(false);
        }
    });
});
