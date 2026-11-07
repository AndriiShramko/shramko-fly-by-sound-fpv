// The keyboard-only headless check of the stand-alone demo and the Sound Lab (plan step 12), run by
// `pnpm proof:audio` with the audio proofs. The demo is built with demo/build.mjs, served on the loopback
// address, and driven in headless Chrome through Playwright with `page.keyboard` ONLY: the mouse and the
// touch screen are made to throw, so a control that cannot be reached or used with the keyboard fails the
// run. It checks landmarks, the order of Tab, that every control can be reached and has a name, that a
// lesson can be started, skipped, flown and answered with keys, that the Sound Lab's sliders change the
// theme, that a preview plays and that the exported theme is a valid theme file. Controls: a page with a
// button taken out of the tab order, one with a button that has no name, and one with a positive tabindex
// must each fail the audit, and the mouse guard must throw. Evidence goes to evidence/demo-check.json.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUE_IDS } from '../src/i18n';
import { getBuiltinTheme, validateTheme } from '../src/theme';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.cache', 'demo-check');
const EVIDENCE = join(ROOT, 'evidence', 'demo-check.json');
const GPU_LOCK = process.env['GPU_LOCK'] ?? 'C:/dev/.gpu-lock';

const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serve(dir: string): Promise<{ readonly server: Server; readonly port: number; readonly requested: string[] }> {
    const base = resolve(dir);
    const requested: string[] = [];
    const server = createServer((req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0] as string);
        requested.push(path);
        const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
        if (file !== base && !file.startsWith(base + sep)) {
            res.writeHead(403).end();
            return;
        }
        try {
            if (!statSync(file).isFile()) throw new Error('not a file');
        } catch {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
    });
    return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            done({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0, requested });
        });
    });
}

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

/** System Chrome, headless (as the simulator's harness runs); Playwright's bundled Chromium where there is none. */
async function launchBrowser(): Promise<Browser> {
    const args = ['--disable-gpu'];
    try {
        return await chromium.launch({ headless: true, channel: 'chrome', args });
    } catch {
        return chromium.launch({ headless: true, args });
    }
}

// Scripts run in the page. They are strings: this file is compiled without the DOM library.
const ACCESSIBLE_NAME = `
function accName(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\\s+/).map((id) => (document.getElementById(id) || { textContent: '' }).textContent).join(' ').trim();
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.textContent).join(' ').trim();
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return (el.textContent || '').trim();
    const title = el.getAttribute('title');
    return title ? title.trim() : '';
}
function visible(el) {
    if (el.closest('[hidden]')) return false;
    // what a closed <details> holds is not on the page until its summary is opened (the summary itself is)
    const d = el.closest('details');
    if (d && !d.open && !(el.tagName === 'SUMMARY' && el.parentElement === d)) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && el.getClientRects().length > 0;
}
`;

const FOCUSABLES = `(() => { ${ACCESSIBLE_NAME}
    const sel = 'a[href], button, input, select, textarea, summary, [tabindex]';
    const all = Array.from(document.querySelectorAll(sel)).filter((el) => visible(el) && !el.disabled);
    const reachable = all.filter((el) => el.tabIndex >= 0);
    reachable.forEach((el, i) => el.setAttribute('data-probe', String(i)));
    return {
        count: reachable.length,
        positive: all.filter((el) => el.tabIndex > 0).map((el) => el.id || el.tagName),
        unreachable: all.filter((el) => el.tabIndex < 0 && !el.hasAttribute('data-focus-target') && el.tagName !== 'H2' && el.tagName !== 'H3' && el.tagName !== 'MAIN' && el.id !== 'main').map((el) => el.id || el.tagName),
        names: reachable.map((el) => ({ probe: el.getAttribute('data-probe'), id: el.id || el.tagName, name: accName(el) }))
    };
})()`;

const ACTIVE = `(() => { ${ACCESSIBLE_NAME}
    const el = document.activeElement;
    if (!el || el === document.body) return { probe: null, id: '', name: '', tag: 'BODY', lesson: '', cue: '' };
    return { probe: el.getAttribute('data-probe'), id: el.id || '', name: accName(el), tag: el.tagName, lesson: el.getAttribute('data-lesson') || '', cue: el.getAttribute('data-cue') || '', layer: (el.closest('fieldset') || { id: '' }).id };
})()`;

interface Active {
    readonly probe: string | null;
    readonly id: string;
    readonly name: string;
    readonly tag: string;
    readonly lesson: string;
    readonly cue: string;
    readonly layer?: string;
}
interface Focusables {
    readonly count: number;
    readonly positive: string[];
    readonly unreachable: string[];
    readonly names: { readonly probe: string; readonly id: string; readonly name: string }[];
}

interface DemoState {
    readonly lessonId: string | null;
    readonly phase: string;
    readonly attempt: number;
    readonly asking: boolean;
    readonly paused: boolean;
    readonly pos: [number, number, number];
    readonly speed: number;
    readonly heightM: number;
    readonly yawDeg: number;
    readonly engine: string;
    readonly audio: string;
    readonly captions: number;
}

const state = (page: Page): Promise<DemoState> => page.evaluate('window.sonicDemo.state()') as Promise<DemoState>;
const active = (page: Page): Promise<Active> => page.evaluate(ACTIVE) as Promise<Active>;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Tab until `want` says the focused element is the one, at most `limit` presses. Returns it. */
async function tabTo(page: Page, want: (a: Active) => boolean, limit = 400): Promise<Active> {
    await page.evaluate(FOCUSABLES); // numbers every reachable control (data-probe), nothing else
    for (let i = 0; i < limit; i++) {
        await page.keyboard.press('Tab');
        const a = await active(page);
        if (want(a)) return a;
    }
    throw new Error('Tab never reached the control: it cannot be reached with the keyboard');
}

/**
 * The audit of the page as it is now: press Tab through the whole page once and list what was wrong.
 * Every reachable control must be visited and have an accessible name, none may have a positive
 * tabindex, and no visible control may be taken out of the order.
 */
async function audit(page: Page): Promise<{ readonly problems: string[]; readonly stops: number }> {
    const found = (await page.evaluate(FOCUSABLES)) as Focusables;
    const visited = new Set<string>();
    await page.keyboard.press('Shift+Tab'); // from the start of the document to its last stop, and round again
    for (let i = 0; i < found.count + 8; i++) {
        await page.keyboard.press('Tab');
        const a = await active(page);
        if (a.probe !== null) visited.add(a.probe);
    }
    const problems: string[] = [];
    for (const n of found.names) {
        if (!visited.has(n.probe)) problems.push(`not reached by Tab: ${n.id}`);
        if (n.name === '') problems.push(`no accessible name: ${n.id}`);
    }
    for (const p of found.positive) problems.push(`positive tabindex: ${p}`);
    for (const u of found.unreachable) problems.push(`taken out of the tab order: ${u}`);
    return { problems, stops: found.count };
}

/** Makes the mouse and the touch screen throw: this check uses the keyboard alone. */
function forbidPointer(page: Page): void {
    const guard = (): never => {
        throw new Error('the keyboard-only check must not use the mouse or the touch screen');
    };
    const mouse = page.mouse as unknown as Record<string, unknown>;
    for (const m of ['move', 'down', 'up', 'click', 'dblclick', 'wheel']) mouse[m] = guard;
    (page.touchscreen as unknown as Record<string, unknown>)['tap'] = guard;
}

describe('the demo and the Sound Lab, with the keyboard alone, in headless Chrome', () => {
    let browser: Browser;
    let origin = '';
    let closeServer: () => Promise<void>;
    let requested: string[] = [];
    let release: () => void = () => undefined;
    const evidence: Record<string, unknown> = {};

    beforeAll(async () => {
        execFileSync(process.execPath, [join(ROOT, 'demo', 'build.mjs'), '--out', OUT], { stdio: 'pipe' });
        const s = await serve(OUT);
        origin = `http://127.0.0.1:${s.port}`;
        requested = s.requested;
        closeServer = () => new Promise((r) => s.server.close(() => r()));
        release = await takeGpuLock();
        browser = await launchBrowser();
    }, 600000);

    afterAll(async () => {
        if (browser !== undefined) await browser.close();
        if (closeServer !== undefined) await closeServer();
        release();
        mkdirSync(dirname(EVIDENCE), { recursive: true });
        writeFileSync(EVIDENCE, `${JSON.stringify({ what: 'Keyboard-only headless check of the stand-alone demo and the Sound Lab (page.keyboard only; the mouse and the touch screen throw)', run: 'pnpm proof:audio', date: new Date().toISOString(), browser: browser === undefined ? null : browser.version(), ...evidence }, null, 2)}\n`);
    });

    /** A fresh page of the demo; `mutate` changes the HTML on its way, for the controls. */
    async function open(mutate?: (html: string) => string): Promise<{ page: Page; errors: string[]; external: string[] }> {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        forbidPointer(page);
        const errors: string[] = [];
        const external: string[] = [];
        page.on('request', (r) => {
            if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) external.push(r.url());
        });
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text());
        });
        if (mutate !== undefined) {
            await page.route('**/index.html', async (route) => {
                const response = await route.fetch();
                await route.fulfill({ response, body: mutate(await response.text()) });
            });
        }
        await page.goto(`${origin}/index.html`);
        await page.waitForFunction('typeof window.sonicDemo === "object"');
        return { page, errors, external };
    }

    it('flies a lesson and tunes a theme with Tab, Enter, arrows, digits and letters', async () => {
        const { page, errors, external } = await open();
        try {
            // landmarks and the document
            const roles = {
                banner: await page.getByRole('banner').count(),
                main: await page.getByRole('main').count(),
                complementary: await page.getByRole('complementary').count(),
                contentinfo: await page.getByRole('contentinfo').count(),
                h1: await page.getByRole('heading', { level: 1 }).count()
            };
            expect(roles).toEqual({ banner: 1, main: 1, complementary: 1, contentinfo: 1, h1: 1 });
            expect(await page.evaluate('document.documentElement.lang')).toBe('en');
            expect(await page.title()).toMatch(/Fly by Sound/);
            expect(await page.evaluate('document.getElementById("captions").getAttribute("aria-live")')).toBe('polite');
            expect(await page.evaluate('document.getElementById("captions").getAttribute("role")')).toBe('log');
            evidence['landmarks'] = roles;

            // the first stop of Tab is the skip link, and it works
            await page.keyboard.press('Tab');
            expect((await active(page)).name).toBe('Skip to the main content');
            await page.keyboard.press('Enter');
            expect((await active(page)).id).toBe('main');
            const first = await audit(page);
            expect(first.problems).toEqual([]);
            evidence['tabStopsBeforeStart'] = first.stops;

            // start the sound with the keyboard: the key press is the user gesture
            await tabTo(page, (a) => a.id === 'start-btn');
            await page.keyboard.press('Enter');
            await page.waitForFunction('window.sonicDemo.state().engine === "running"', undefined, { timeout: 15000 });
            let s = await state(page);
            expect(s.engine).toBe('running');
            evidence['audioContext'] = s.audio;
            expect((await active(page)).id).toBe('demo-h');
            expect(await page.evaluate('document.getElementById("captions").textContent')).toMatch(/The sound is on/);
            const second = await audit(page);
            expect(second.problems).toEqual([]);
            evidence['tabStopsAfterStart'] = second.stops;

            // open a lesson with Enter on its button, skip the speech with N, fly with the arrow keys and letters
            await tabTo(page, (a) => a.lesson === 'hover-height');
            await page.keyboard.press('Enter');
            s = await state(page);
            expect(s.lessonId).toBe('hover-height');
            expect(s.phase).toBe('intro');
            expect((await active(page)).id).toBe('flight-h');
            expect(await page.evaluate('document.getElementById("lesson-title").textContent')).toBe('Hold your height');
            await page.keyboard.press('n');
            await page.waitForFunction('window.sonicDemo.state().phase === "flying"', undefined, { timeout: 5000 });
            const third = await audit(page);
            expect(third.problems).toEqual([]);
            evidence['tabStopsInFlight'] = third.stops;

            // keys fly: climb, forward, turn
            const before = await state(page);
            await page.keyboard.down('ArrowUp');
            await sleep(1500);
            await page.keyboard.up('ArrowUp');
            const climbed = await state(page);
            expect(climbed.heightM - before.heightM).toBeGreaterThan(0.6);
            await page.keyboard.down('w');
            await sleep(1500);
            await page.keyboard.up('w');
            const forward = await state(page);
            expect(forward.pos[2]).toBeLessThan(climbed.pos[2] - 0.15); // nose along -Z
            await page.keyboard.down('ArrowRight');
            await sleep(1000);
            await page.keyboard.up('ArrowRight');
            const turned = await state(page);
            expect(turned.yawDeg - forward.yawDeg).toBeGreaterThan(25);
            const readout = (await page.evaluate('document.getElementById("t-height").textContent')) as string;
            expect(Number.parseFloat(readout)).toBeCloseTo(turned.heightM, 0);
            evidence['flight'] = { climbedM: Number((climbed.heightM - before.heightM).toFixed(2)), forwardM: Number((climbed.pos[2] - forward.pos[2]).toFixed(2)), turnedDeg: Number((turned.yawDeg - forward.yawDeg).toFixed(1)) };

            // pause with P and go on
            await page.keyboard.press('p');
            expect((await state(page)).paused).toBe(true);
            expect(await page.evaluate('document.getElementById("pause").getAttribute("aria-pressed")')).toBe('true');
            await page.keyboard.press('p');
            expect((await state(page)).paused).toBe(false);

            // a module-0 lesson: the question is answered with a digit
            await tabTo(page, (a) => a.lesson === 'ears-headphones');
            await page.keyboard.press('Enter');
            expect((await state(page)).lessonId).toBe('ears-headphones');
            await page.keyboard.press('n'); // the lesson's intro
            await sleep(300);
            await page.keyboard.press('n'); // the first lines of the headphone check
            await page.waitForFunction('window.sonicDemo.state().asking === true', undefined, { timeout: 20000 });
            expect(await page.evaluate('document.getElementById("question").textContent')).toMatch(/number keys 1 to 3/);
            await page.keyboard.press('1');
            await page.waitForFunction('window.sonicDemo.state().asking === false', undefined, { timeout: 5000 });
            const events = (await page.evaluate('window.sonicDemo.events()')) as { kind: string; value?: number | null; via?: string }[];
            expect(events.some((e) => e.kind === 'answer' && e.value === 1 && e.via === 'key')).toBe(true);
            expect((await state(page)).captions).toBeGreaterThan(3);

            // the Sound Lab
            await tabTo(page, (a) => a.id === 'nav-lab');
            await page.keyboard.press('Enter');
            expect((await active(page)).id).toBe('lab-h');
            expect(await page.getByRole('heading', { name: 'Sound Lab' }).isVisible()).toBe(true);
            const lab = await audit(page);
            expect(lab.problems).toEqual([]);
            expect(lab.stops).toBeGreaterThan(60);
            evidence['tabStopsInTheLab'] = lab.stops;

            // the numbers of a layer are behind a summary: Enter opens it, and then they can all be reached and typed into
            await tabTo(page, (a) => a.layer === 'lab-layer-safety' && a.name === 'Numbers of the safety layer');
            await page.keyboard.press('Enter');
            expect(await page.evaluate('document.querySelector("#lab-layer-safety details").open')).toBe(true);
            const opened = await audit(page);
            expect(opened.problems).toEqual([]);
            expect(opened.stops).toBeGreaterThan(lab.stops + 10);
            evidence['tabStopsWithNumbersOpen'] = opened.stops;
            await tabTo(page, (a) => a.layer === 'lab-layer-safety' && a.name === 'pulseMs');
            await page.keyboard.press('Control+A');
            await page.keyboard.type('120');
            const typed = (await page.evaluate('window.sonicDemo.lab().theme')) as ReturnType<typeof getBuiltinTheme>;
            expect(typed.layers.safety.params['pulseMs']).toBe(120);

            const base = getBuiltinTheme('soft');
            // a slider changes the layer's gain: six presses of the left arrow at 0.5 dB each
            await tabTo(page, (a) => a.layer === 'lab-layer-safety' && a.name === 'Gain of the layer');
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
            let theme = (await page.evaluate('window.sonicDemo.lab().theme')) as ReturnType<typeof getBuiltinTheme>;
            expect(theme.layers.safety.gainDb).toBeCloseTo(base.layers.safety.gainDb - 3, 6);
            expect(await page.evaluate('document.querySelector("#lab-layer-safety output").textContent')).toContain(String(base.layers.safety.gainDb - 3));
            // the pitch of the target layer: two steps up along the scale
            await tabTo(page, (a) => a.layer === 'lab-layer-target' && a.name === 'Pitch shift');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            theme = (await page.evaluate('window.sonicDemo.lab().theme')) as ReturnType<typeof getBuiltinTheme>;
            expect(theme.layers.target.params['humStep']).toBe((base.layers.target.params['humStep'] as number) + 2);
            // a preview plays: the button is pressed with Enter and the engine sounds that cue
            await tabTo(page, (a) => a.cue === 'safety.wall');
            await page.keyboard.press('Enter');
            await page.waitForFunction('window.sonicDemo.cues().some((c) => c.startsWith("safety.wall"))', undefined, { timeout: 5000 });
            expect(await page.evaluate('document.getElementById("lab-status").textContent')).toMatch(/Playing: Wall/);
            // every cue of the glossary has a preview button, and each one sounds when it is pressed (Tab goes on from here, layer by layer)
            expect(await page.evaluate('document.querySelectorAll("[data-cue]").length')).toBe(CUE_IDS.length);
            const heard: string[] = ['safety.wall'];
            for (const cue of CUE_IDS.slice(1)) {
                await tabTo(page, (a) => a.cue === cue);
                await page.keyboard.press('Enter');
                await page.waitForFunction(`window.sonicDemo.cues().some((c) => c.startsWith(${JSON.stringify(cue)}))`, undefined, { timeout: 5000 });
                heard.push(cue);
            }
            expect(heard).toEqual([...CUE_IDS]);
            evidence['previewsHeard'] = heard.length;
            // the export: a valid theme file with the edits in it
            await tabTo(page, (a) => a.id === 'lab-export-button');
            await page.keyboard.press('Enter');
            const text = await page.inputValue('#lab-export');
            const parsed = JSON.parse(text) as { format: string; id: string; layers: { safety: { gainDb: number }; target: { params: Record<string, number> } } };
            expect(parsed.format).toBe('shramko-sonic-theme/1');
            expect(parsed.id).toBe('my-soft');
            expect(parsed.layers.safety.gainDb).toBeCloseTo(base.layers.safety.gainDb - 3, 6);
            expect(parsed.layers.target.params['humStep']).toBe((base.layers.target.params['humStep'] as number) + 2);
            const checked = validateTheme(parsed);
            expect(checked.ok).toBe(true);
            evidence['exportedTheme'] = { id: parsed.id, characters: text.length, valid: checked.ok };

            // and back to the demo with the keyboard
            await tabTo(page, (a) => a.id === 'nav-demo');
            await page.keyboard.press('Enter');
            expect((await active(page)).id).toBe('demo-h');
            expect(await page.getByRole('heading', { name: 'Sound Lab' }).isVisible()).toBe(false);

            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
        // nothing left the machine: every request went to the page's own origin
        expect(external).toEqual([]);
        evidence['requests'] = [...new Set(requested)];
    }, 180000);

    it('the audit fails a button that is taken out of the tab order (negative control)', async () => {
        const { page } = await open((html) => html.replace('id="start-btn"', 'id="start-btn" tabindex="-1"'));
        try {
            const r = await audit(page);
            expect(r.problems.some((p) => p.includes('start-btn'))).toBe(true);
            let unreachable = false;
            try {
                await tabTo(page, (a) => a.id === 'start-btn', 20);
            } catch {
                unreachable = true;
            }
            expect(unreachable).toBe(true);
            evidence['controlNotReachable'] = r.problems;
        } finally {
            await page.close();
        }
    }, 60000);

    it('the audit fails a button with no accessible name, and a positive tabindex (negative controls)', async () => {
        const { page } = await open((html) => html.replace('>Start the sound</button>', '></button>').replace('id="lang"', 'id="lang" tabindex="3"'));
        try {
            const r = await audit(page);
            expect(r.problems.some((p) => p.startsWith('no accessible name') && p.includes('start-btn'))).toBe(true);
            expect(r.problems.some((p) => p.startsWith('positive tabindex'))).toBe(true);
            evidence['controlNoName'] = r.problems;
        } finally {
            await page.close();
        }
    }, 60000);

    it('the mouse guard throws, so a click would fail the check (negative control)', async () => {
        const { page } = await open();
        try {
            expect(() => page.mouse.click(10, 10)).toThrow(/keyboard-only/);
            expect(() => page.touchscreen.tap(10, 10)).toThrow(/keyboard-only/);
        } finally {
            await page.close();
        }
    }, 60000);
});
