// The language of what the demo page says (review of stage1-rc1, defect D7; run by `pnpm proof:audio`).
// A screen reader picks its voice by the `lang` of the text it reads. The page is lang="en", but the
// captions of every spoken line, the lesson buttons and the lesson title are in the language the pilot
// chose (Polish, Russian, Spanish): without a `lang` on them a screen reader reads them with the English
// voice, which is exactly what the "my screen reader speaks" switch exists to avoid. Headless Chrome, the
// real page; the check has a control that must fail (a translated caption with no language).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GPU_LOCK = process.env['GPU_LOCK'] ?? 'C:/dev/.gpu-lock';
const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ENGLISH_CAPTIONS: readonly string[] = ['The sound is on. Pick a lesson.'];

/** The machine's rule: a run that draws holds C:/dev/.gpu-lock (mkdir in a loop, rmdir afterwards). Elsewhere there is no lock. */
async function takeGpuLock(): Promise<() => void> {
    if (!existsSync(dirname(GPU_LOCK))) return () => undefined;
    const deadline = Date.now() + 10 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(GPU_LOCK);
            return () => {
                try {
                    rmdirSync(GPU_LOCK);
                } catch {
                    // already gone
                }
            };
        } catch {
            if (Date.now() > deadline) throw new Error(`could not take ${GPU_LOCK} within 10 minutes`);
            await new Promise((r) => setTimeout(r, 20000));
        }
    }
}

interface Item {
    readonly what: string;
    readonly text: string;
    /** the language the nearest `lang` attribute (the element's own or an ancestor's) gives it */
    readonly lang: string;
    /** the language the text is really in */
    readonly expected: string;
}

/** What is wrong with the marked languages of a list of texts. */
export function languageProblems(items: readonly Item[]): string[] {
    return items.filter((i) => i.lang !== i.expected).map((i) => `${i.what} "${i.text.slice(0, 40)}" is in ${i.expected} but read as ${i.lang}`);
}

// runs in the page: the effective language of an element
const EFFECTIVE_LANG = `(el) => { const a = el.closest('[lang]'); return a ? a.getAttribute('lang') : ''; }`;

let server: Server;
let port = 0;
let browser: Browser;
let release: () => void = () => undefined;

beforeAll(async () => {
    release = await takeGpuLock();
    execFileSync(process.execPath, [join(ROOT, 'demo', 'build.mjs')], { cwd: ROOT, stdio: 'ignore' });
    const base = resolve(ROOT, 'demo', 'dist');
    server = createServer((req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0] as string);
        const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
        if (file !== base && !file.startsWith(base + sep)) return void res.writeHead(403).end();
        try {
            if (!statSync(file).isFile()) throw new Error('not a file');
        } catch {
            return void res.writeHead(404).end();
        }
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const a = server.address();
    port = typeof a === 'object' && a !== null ? a.port : 0;
    const args = ['--disable-gpu'];
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome', args });
    } catch {
        browser = await chromium.launch({ headless: true, args });
    }
}, 120000);

afterAll(async () => {
    await browser?.close();
    server?.close();
    release();
});

describe('the demo marks the language of what it shows and says', () => {
    for (const locale of ['pl', 'ru', 'es'] as const) {
        it(`lesson buttons, the lesson title and the captions are marked ${locale} when the pilot chose it`, async () => {
            const page = await browser.newPage();
            try {
                await page.goto(`http://127.0.0.1:${port}/`);
                await page.selectOption('#lang', locale);
                await page.check('#screenreader'); // no speech in headless Chrome: every line is a caption
                await page.click('#start-btn');
                await page.waitForSelector('#demo:not([hidden])');
                await page.click('[data-lesson="ears-headphones"]');
                await page.waitForFunction('document.querySelectorAll("#captions p").length >= 3');
                const items = (await page.evaluate(`(() => { const lang = ${EFFECTIVE_LANG}; const out = [];
                    for (const b of document.querySelectorAll('#lessons button')) out.push({ what: 'lesson button', text: b.textContent, lang: lang(b), expected: '${locale}' });
                    const t = document.getElementById('lesson-title'); out.push({ what: 'lesson title', text: t.textContent, lang: lang(t), expected: '${locale}' });
                    for (const p of document.querySelectorAll('#captions p')) { const text = p.textContent; out.push({ what: 'caption', text, lang: lang(p), expected: ${JSON.stringify(ENGLISH_CAPTIONS)}.includes(text) ? 'en' : '${locale}' }); }
                    return out; })()`)) as Item[];
                expect(items.filter((i) => i.what === 'caption' && i.expected === locale).length, 'the lesson spoke in the chosen language').toBeGreaterThanOrEqual(2);
                expect(languageProblems(items)).toEqual([]);
            } finally {
                await page.close();
            }
        }, 60000);
    }

    it('the check fails a translated caption that carries no language (negative control)', () => {
        const unmarked: Item[] = [{ what: 'caption', text: 'Posluchajmy jeszcze raz.', lang: 'en', expected: 'pl' }];
        expect(languageProblems(unmarked)).toHaveLength(1);
        expect(languageProblems([{ ...(unmarked[0] as Item), lang: 'pl' }])).toEqual([]);
    });
});
