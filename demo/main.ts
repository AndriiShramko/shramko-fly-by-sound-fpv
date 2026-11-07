// The stand-alone page of Fly by Sound: the first lessons (modules 0 to 2) flown with the keyboard in a
// kinematic point-mass world, and the Sound Lab. Plain HTML (demo/index.html) with landmarks, labelled
// controls and real buttons; this file wires it to the engine. Nothing is sent anywhere.
import type { Locale, SpeechLine } from '../src/contract';
import { LOCALES } from '../src/contract';
import { createSonicEngine, type FlyBySoundEngine } from '../src/audio';
import { createTranslator, DICTS, LESSONS } from '../src/i18n';
import type { Question } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { getBuiltinTheme } from '../src/theme';
import { byId, el, fill } from './dom';
import { DemoHost } from './host';
import { createLab, type LabHandle } from './lab';
import type { Sticks } from './sim';

const MODULE_TITLES: Readonly<Record<number, string>> = {
    0: 'Module 0: Ears, before flying',
    1: 'Module 1: Hover',
    2: 'Module 2: Move and stop'
};
/** The lessons this page offers: modules 0 to 2, which need no walls to hit. Any shipped lesson opens by its id. */
const DEMO_LESSONS = LESSONS.filter((l) => l.module <= 2);
const MAX_CAPTIONS = 60;

/** Keys that fly (by `code`, so a letter is the same key on any layout). */
const FLIGHT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function typing(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}

interface DemoApi {
    state(): ReturnType<DemoHost['state']> & { readonly engine: string; readonly audio: string; readonly locale: string; readonly captions: number };
    events(): ReturnType<DemoHost['events']['slice']>;
    cues(): readonly string[];
    lab(): { readonly theme: ReturnType<LabHandle['theme']>; readonly edits: ReturnType<LabHandle['edits']>; readonly exported: string | null } | null;
}

declare global {
    interface Window {
        /** a read-only view of the page for the headless check (docs: demo/README in the repository README) */
        sonicDemo?: DemoApi;
    }
}

function start(): void {
    const startBtn = byId<HTMLButtonElement>('start-btn');
    const startStatus = byId('start-status');
    const langSelect = byId<HTMLSelectElement>('lang');
    const readerBox = byId<HTMLInputElement>('screenreader');
    const startSection = byId('start');
    const nav = byId('nav');
    const demoSection = byId('demo');
    const labSection = byId('lab');
    const lessonList = byId('lessons');
    const flight = byId('flight');
    const captions = byId('captions');
    const question = byId('question');

    let locale: Locale = 'en';
    let engine: FlyBySoundEngine | null = null;
    let audio: AudioContext | null = null;
    let host: DemoHost | null = null;
    let lab: LabHandle | null = null;
    let t0 = 0;
    let paused = false;
    const held = new Set<string>();
    let captionCount = 0;

    const now = (): number => performance.now() - t0;

    function caption(text: string): void {
        const p = el('p', {}, text);
        captions.append(p);
        captionCount++;
        while (captions.childElementCount > MAX_CAPTIONS) captions.firstElementChild?.remove();
    }

    // ---------------------------------------------------------------- lessons and the flight panel

    function buildLessons(): void {
        const tr = createTranslator(locale, DICTS);
        const parts: Node[] = [];
        for (const module of [0, 1, 2]) {
            const ul = el('ul', { class: 'lessons' });
            for (const spec of DEMO_LESSONS.filter((l) => l.module === module)) {
                const b = el('button', { type: 'button', 'data-lesson': spec.id }, tr.text({ key: `lesson.${spec.id}.title` }));
                b.addEventListener('click', () => openLesson(spec.id));
                ul.append(el('li', {}, b));
            }
            parts.push(el('h3', {}, MODULE_TITLES[module] ?? `Module ${module}`), ul);
        }
        fill(lessonList, ...parts);
    }

    function makeHost(): DemoHost {
        return new DemoHost({
            engine: engine as FlyBySoundEngine,
            locale,
            ui: {
                ask(q: Question | null): void {
                    question.textContent = q === null ? '' : `Answer with the number keys 1 to ${q.options}${q.skippable ? ', or 0 to skip' : ''}.`;
                }
            }
        });
    }

    function openLesson(id: string): void {
        if (engine === null) return;
        host?.leave();
        host = makeHost();
        host.open(id, now());
        paused = false;
        byId<HTMLButtonElement>('pause').setAttribute('aria-pressed', 'false');
        flight.hidden = false;
        const tr = createTranslator(locale, DICTS);
        byId('lesson-title').textContent = tr.text({ key: `lesson.${id}.title` });
        byId('flight-h').focus();
    }

    function sticks(): Sticks {
        const k = (c: string): number => (held.has(c) ? 1 : 0);
        return { roll: k('KeyD') - k('KeyA'), pitch: k('KeyW') - k('KeyS'), throttle: k('ArrowUp') - k('ArrowDown'), yaw: k('ArrowRight') - k('ArrowLeft') };
    }

    function flightActive(): boolean {
        return engine !== null && host !== null && host.lesson !== null && !demoSection.hidden;
    }

    function setPaused(on: boolean): void {
        if (engine === null || host === null) return;
        paused = on;
        host.setPaused(on);
        byId<HTMLButtonElement>('pause').setAttribute('aria-pressed', String(on));
        if (on) void engine.suspend();
        else void engine.resume();
        caption(createTranslator(locale, DICTS).text({ key: on ? 'fly.paused' : 'fly.resumed' } as SpeechLine));
    }

    // ---------------------------------------------------------------- keys

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !flightActive()) return;
        const h = host as DemoHost;
        if (FLIGHT_CODES.has(e.code)) {
            held.add(e.code);
            e.preventDefault();
        } else if (e.code === 'KeyN') {
            h.next();
            e.preventDefault();
        } else if (e.code === 'KeyR') {
            h.reset(e.shiftKey ? 'start' : 'checkpoint');
            e.preventDefault();
        } else if (e.code === 'KeyP') {
            setPaused(!paused);
            e.preventDefault();
        } else if (/^[0-9]$/.test(e.key)) {
            h.answer(Number(e.key));
            e.preventDefault();
        }
    });
    document.addEventListener('keyup', (e) => {
        held.delete(e.code);
    });
    window.addEventListener('blur', () => held.clear());

    byId('btn-next').addEventListener('click', () => host?.next());
    byId('btn-checkpoint').addEventListener('click', () => host?.reset('checkpoint'));
    byId('btn-restart').addEventListener('click', () => host?.reset('start'));
    byId('pause').addEventListener('click', () => setPaused(!paused));
    byId('btn-leave').addEventListener('click', () => {
        host?.leave();
        flight.hidden = true;
        question.textContent = '';
        const first = lessonList.querySelector('button');
        first?.focus();
    });

    // ---------------------------------------------------------------- the frame loop and the readout

    const readout = new Map<string, string>();
    function show(id: string, text: string): void {
        if (readout.get(id) === text) return;
        readout.set(id, text);
        byId(id).textContent = text;
    }

    let last = performance.now();
    function loop(at: number): void {
        requestAnimationFrame(loop);
        const dt = Math.min((at - last) / 1000, 0.1);
        last = at;
        if (host === null || !flightActive()) return;
        if (!paused) host.frame(at - t0, dt, sticks());
        const s = host.state();
        show('t-phase', s.phase === 'flying' ? (s.scene ? 'listening' : 'flying') : s.phase);
        show('t-attempt', String(s.attempt));
        show('t-touches', String(s.touches));
        show('t-height', `${s.heightM.toFixed(1)} m`);
        show('t-speed', `${s.speed.toFixed(1)} m/s`);
        show('t-heading', `${Math.round(s.yawDeg)} degrees`);
    }

    // ---------------------------------------------------------------- navigation

    function showSection(which: 'demo' | 'lab'): void {
        demoSection.hidden = which !== 'demo';
        labSection.hidden = which !== 'lab';
        byId('nav-demo').setAttribute('aria-current', String(which === 'demo'));
        byId('nav-lab').setAttribute('aria-current', String(which === 'lab'));
        held.clear();
        if (which === 'lab') lab?.show();
        else {
            engine?.setLayers(host?.lesson?.layers ?? { on: [], heightBandM: null, hazardVoices: 3 });
            byId('demo-h').focus();
        }
    }
    byId('nav-demo').addEventListener('click', () => showSection('demo'));
    byId('nav-lab').addEventListener('click', () => showSection('lab'));

    langSelect.addEventListener('change', () => {
        const v = langSelect.value;
        if (!(LOCALES as readonly string[]).includes(v)) return;
        locale = v as Locale;
        engine?.setLocale(locale);
        if (engine !== null) {
            host?.leave();
            host = null;
            flight.hidden = true;
            buildLessons();
        }
    });

    // ---------------------------------------------------------------- the start (a user gesture)

    startBtn.addEventListener('click', () => {
        if (engine !== null) return;
        startBtn.disabled = true;
        startStatus.textContent = 'Starting the sound...';
        const reader = readerBox.checked;
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC === undefined) {
            startStatus.textContent = 'This browser has no Web Audio. Try a current Chrome, Edge, Firefox or Safari.';
            startBtn.disabled = false;
            return;
        }
        const context = new AC({ latencyHint: 'interactive' });
        const e = createSonicEngine({
            theme: getBuiltinTheme('soft'),
            prefs: { ...defaultPrefs(), selfVoice: !reader },
            locale,
            caption,
            ...(reader ? { speech: null } : {})
        });
        e.start(context).then(
            () => {
                engine = e;
                audio = context;
                t0 = performance.now();
                host = makeHost();
                lab = createLab(byId('lab-content'), { engine: () => engine, locale: () => locale, now, enter: () => host?.leave() });
                buildLessons();
                startSection.hidden = true;
                nav.hidden = false;
                demoSection.hidden = false;
                byId('nav-demo').setAttribute('aria-current', 'true');
                byId('demo-h').focus();
                caption('The sound is on. Pick a lesson.');
            },
            (err: unknown) => {
                startStatus.textContent = `The sound could not start: ${err instanceof Error ? err.message : String(err)}`;
                startBtn.disabled = false;
            }
        );
    });

    requestAnimationFrame(loop);

    window.sonicDemo = {
        state: () => ({ ...(host ?? makeIdleHost()).state(), engine: engine?.state ?? 'idle', audio: audio?.state ?? 'none', locale, captions: captionCount }),
        events: () => (host === null ? [] : host.events.slice()),
        cues: () => (engine === null ? [] : engine.activeCues().map((c) => c.id)),
        lab: () => (lab === null ? null : { theme: lab.theme(), edits: lab.edits(), exported: lab.exported() })
    };

    function makeIdleHost(): DemoHost {
        return new DemoHost({ engine: { update: () => undefined, cue: () => undefined, say: () => Promise.resolve(), setLayers: () => undefined }, locale });
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
