// The Sound Lab page: sliders for every layer's gain and pitch, the numbers of each layer from the theme
// schema, a preview button for every cue, and the theme file out. All of it is plain HTML controls
// (labelled inputs, real buttons, fieldsets), reachable and changeable with the keyboard alone. The
// model (demo/lab-model.ts) decides what the sound is; this file builds the controls around it.
import type { CueEvent, LayerId, Locale, MaterialClass, ThemeDef, Vec3 } from '../src/contract';
import { LAYER_IDS, MATERIAL_CLASSES } from '../src/contract';
import type { FlyBySoundEngine } from '../src/audio';
import { CUE_IDS, DICTS, type KnownCueId } from '../src/i18n';
import { BUILTIN_THEME_IDS, getBuiltinTheme, parseTheme, validateTheme } from '../src/theme';
import { formatIssues } from '../src/util';
import { el, fill } from './dom';
import { ALL_TIMBRES, applyEdits, exportTheme, isEdited, LAB_RANGES, layerFields, NO_EDITS, type LabEdits } from './lab-model';

export interface LabDeps {
    engine(): FlyBySoundEngine | null;
    locale(): Locale;
    /** page clock, ms */
    now(): number;
    /** the Lab opens: the demo lesson is left */
    enter(): void;
}

export interface LabHandle {
    /** the Lab became visible */
    show(): void;
    /** the theme the engine plays now */
    theme(): ThemeDef;
    edits(): LabEdits;
    /** the last exported theme file, or null */
    exported(): string | null;
}

const LAYER_TITLES: Readonly<Record<LayerId, string>> = {
    safety: 'Safety: walls, floor, ceiling, obstacles',
    height: 'Height: the tone of your own altitude',
    speed: 'Speed: ticks that follow your speed',
    target: 'Target: the hum toward the next gate and its melody',
    shape: 'Shape: the point that traces an object',
    room: 'Room: the bed and the reverb of the space',
    voice: 'Voice: speech'
};

const DIRECTIONS: readonly { readonly id: string; readonly label: string; readonly dir: Vec3 | null }[] = [
    { id: 'front', label: 'In front', dir: [0, 0, -1] },
    { id: 'left', label: 'On the left', dir: [-1, 0, 0] },
    { id: 'right', label: 'On the right', dir: [1, 0, 0] },
    { id: 'behind', label: 'Behind', dir: [0, 0, 1] },
    { id: 'up', label: 'Above', dir: [0, 1, 0] },
    { id: 'down', label: 'Below', dir: [0, -1, 0] },
    { id: 'centre', label: 'In the centre (no direction)', dir: null }
];

const IDLE = (t: number): Parameters<FlyBySoundEngine['update']>[0] => ({
    sample: { t, tick: 0, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false },
    world: null,
    target: null,
    floorY: 0
});

let uid = 0;

/** A labelled slider with its value shown beside it; returns the wrapper and the input. */
function slider(label: string, range: { readonly min: number; readonly max: number; readonly step: number }, value: number, unit: string, onInput: (v: number) => void, hint = ''): { readonly row: HTMLElement; readonly input: HTMLInputElement } {
    const id = `lab-s${++uid}`;
    const input = el('input', { type: 'range', id, min: range.min, max: range.max, step: range.step, value });
    const out = el('output', { for: id, 'aria-live': 'off' }, `${value} ${unit}`.trim());
    input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = `${v} ${unit}`.trim();
        onInput(v);
    });
    const row = el('div', { class: 'row' }, el('label', { for: id }, label), input, out);
    if (hint !== '') row.append(el('small', {}, hint));
    return { row, input };
}

export function createLab(root: HTMLElement, deps: LabDeps): LabHandle {
    let baseId: string = 'soft';
    let base: ThemeDef = getBuiltinTheme('soft');
    let edits: LabEdits = NO_EDITS;
    let current: ThemeDef = base;
    let exportedText: string | null = null;
    let dirId = 'front';
    let downloadUrl: string | null = null;

    const status = el('p', { id: 'lab-status', role: 'status' });
    const issues = el('div', { id: 'lab-issues', role: 'alert' });

    const say = (text: string): void => {
        status.textContent = text;
    };

    /** Plays the edited theme if it is a valid one; otherwise says why not and keeps the last good sound. */
    function refresh(): void {
        const t = applyEdits(base, edits);
        const check = validateTheme(t);
        if (!check.ok) {
            fill(issues, el('p', {}, 'The sound is not changed, because the theme is not valid yet:'), el('ul', {}, ...check.issues.slice(0, 8).map((i) => el('li', {}, `${i.path}: ${i.message}`))));
            return;
        }
        fill(issues);
        current = check.value;
        deps.engine()?.setTheme(current);
    }

    function update(f: (e: LabEdits) => LabEdits): void {
        edits = f(edits);
        refresh();
    }

    function preview(cue: KnownCueId): void {
        const engine = deps.engine();
        if (engine === null) {
            say('Start the sound first (the section "Start the sound").');
            return;
        }
        const dir = (DIRECTIONS.find((d) => d.id === dirId) ?? (DIRECTIONS[0] as (typeof DIRECTIONS)[number])).dir;
        const event: CueEvent = { kind: 'preview', cue, dir };
        engine.update(IDLE(deps.now()));
        engine.cue(event);
        const name = DICTS[deps.locale()][`cue.${cue}.name`] ?? cue;
        say(`Playing: ${name}${dir === null ? '' : `, ${(DIRECTIONS.find((d) => d.id === dirId) as (typeof DIRECTIONS)[number]).label.toLowerCase()}`}.`);
    }

    function select<T extends string>(label: string, options: readonly T[], value: T, onChange: (v: T) => void, names?: Readonly<Record<string, string>>): { readonly row: HTMLElement; readonly input: HTMLSelectElement } {
        const id = `lab-s${++uid}`;
        const input = el('select', { id }, ...options.map((o) => el('option', { value: o, selected: o === value }, names?.[o] ?? o)));
        input.value = value;
        input.addEventListener('change', () => onChange(input.value as T));
        return { row: el('div', { class: 'row' }, el('label', { for: id }, label), input), input };
    }

    function layerBox(layer: LayerId): HTMLElement {
        const set = edits.params[layer] ?? {};
        const box = el('fieldset', { id: `lab-layer-${layer}` }, el('legend', {}, LAYER_TITLES[layer]));
        box.append(slider('Gain of the layer', LAB_RANGES.layerGainDb, edits.gainDb[layer] ?? base.layers[layer].gainDb, 'dB', (v) => update((e) => ({ ...e, gainDb: { ...e.gainDb, [layer]: v } }))).row);
        if (layer !== 'voice') box.append(slider('Pitch shift', LAB_RANGES.pitchSteps, edits.pitch[layer] ?? 0, 'scale steps', (v) => update((e) => ({ ...e, pitch: { ...e.pitch, [layer]: v } })), 'Moves every note of the layer along the pentatonic scale, so it stays in key.').row);
        box.append(select('Timbre', ALL_TIMBRES, edits.timbre[layer] ?? base.layers[layer].timbre, (v) => update((e) => ({ ...e, timbre: { ...e.timbre, [layer]: v } }))).row);
        const numbers = el('details', {}, el('summary', {}, `Numbers of the ${layer} layer`));
        for (const { name, spec } of layerFields(layer)) {
            const id = `lab-s${++uid}`;
            const value = set[name] ?? base.layers[layer].params[name] ?? spec.default;
            const input = el('input', { type: 'number', id, min: spec.min, max: spec.scaleIndex ? 100 : spec.max, step: spec.integer ? 1 : 'any', value });
            input.addEventListener('input', () => {
                const v = Number(input.value);
                if (input.value === '' || !Number.isFinite(v)) return;
                update((e) => ({ ...e, params: { ...e.params, [layer]: { ...(e.params[layer] ?? {}), [name]: v } } }));
            });
            numbers.append(el('div', { class: 'row' }, el('label', { for: id }, name), input, el('small', {}, spec.doc)));
        }
        box.append(numbers);
        const cues = CUE_IDS.filter((c) => c.startsWith(`${layer}.`));
        if (cues.length > 0) {
            const group = el('div', { role: 'group', 'aria-label': `Previews of the ${layer} layer`, class: 'buttons' });
            for (const cue of cues) {
                const name = DICTS[deps.locale()][`cue.${cue}.name`] ?? cue;
                const b = el('button', { type: 'button', 'data-cue': cue }, `Preview: ${name}`);
                b.addEventListener('click', () => preview(cue));
                group.append(b);
            }
            box.append(group);
        }
        return box;
    }

    function build(): void {
        uid = 0;
        const parts: Node[] = [];
        parts.push(el('h2', { id: 'lab-h', tabindex: -1 }, 'Sound Lab'));
        parts.push(el('p', {}, 'Tune the sound without code. Every slider changes what you hear at once; the previews play each cue. When it sounds right, export the theme file and send it to the author, or put it in the themes folder. Everything here works with the keyboard alone: Tab to move, arrow keys on a slider, Enter on a button.'));

        const themeBox = el('fieldset', { id: 'lab-theme' }, el('legend', {}, 'Theme'));
        const names: Record<string, string> = { soft: 'Soft: mallets and pads', clear: 'Clear: sines and clicks', race: 'Race: short and hard' };
        const options = [...BUILTIN_THEME_IDS, ...(baseId === 'imported' ? ['imported' as const] : [])];
        for (const o of options) names[o] ??= o === 'imported' ? 'The theme you loaded' : o;
        themeBox.append(
            select('Start from', options as readonly string[], baseId, (v) => {
                if (v === 'imported') return;
                baseId = v;
                base = getBuiltinTheme(v as (typeof BUILTIN_THEME_IDS)[number]);
                edits = NO_EDITS;
                build();
                refresh();
                say(`Starting from the ${v} theme: edits cleared.`);
            }, names).row
        );
        const reset = el('button', { type: 'button', id: 'lab-reset' }, 'Clear all edits');
        reset.addEventListener('click', () => {
            edits = NO_EDITS;
            build();
            refresh();
            say('Edits cleared.');
            byIdSafe('lab-reset')?.focus();
        });
        themeBox.append(el('div', { class: 'buttons' }, reset));
        parts.push(themeBox);

        const where = select('Direction of the previews', DIRECTIONS.map((d) => d.id), dirId, (v) => {
            dirId = v;
        }, Object.fromEntries(DIRECTIONS.map((d) => [d.id, d.label])));
        parts.push(el('fieldset', { id: 'lab-direction' }, el('legend', {}, 'Previews'), where.row));

        const master = el('fieldset', { id: 'lab-master' }, el('legend', {}, 'Master'));
        master.append(
            slider('Master gain', LAB_RANGES.masterGainDb, edits.master.gainDb ?? base.master.gainDb, 'dB', (v) => update((e) => ({ ...e, master: { ...e.master, gainDb: v } }))).row,
            slider('Limiter ceiling', LAB_RANGES.ceilingDb, edits.master.ceilingDb ?? base.master.ceilingDb, 'dB', (v) => update((e) => ({ ...e, master: { ...e.master, ceilingDb: v } })), 'No sound ever goes above this. The shipped themes use -6 dB below full scale.').row,
            slider('Fade-in on start', LAB_RANGES.fadeInS, edits.master.fadeInS ?? base.master.fadeInS, 's', (v) => update((e) => ({ ...e, master: { ...e.master, fadeInS: v } }))).row,
            slider('Duck under speech', LAB_RANGES.duckDb, edits.duckDb ?? base.duckDb, 'dB', (v) => update((e) => ({ ...e, duckDb: v })), 'How far the other layers go down while a line is spoken.').row
        );
        parts.push(master);

        for (const layer of LAYER_IDS) parts.push(layerBox(layer));

        const surfaces = el('fieldset', { id: 'lab-materials' }, el('legend', {}, 'Timbre of each surface (safety layer)'));
        for (const m of MATERIAL_CLASSES) {
            surfaces.append(select(`${m[0]?.toUpperCase() ?? ''}${m.slice(1)}`, ALL_TIMBRES, edits.materials[m] ?? base.materials[m], (v) => update((e) => ({ ...e, materials: { ...e.materials, [m as MaterialClass]: v } }))).row);
        }
        parts.push(surfaces);

        // export
        const idInput = el('input', { type: 'text', id: 'lab-id', value: baseId === 'imported' ? 'my-theme' : `my-${baseId}`, autocomplete: 'off', spellcheck: 'false' });
        const nameInput = el('input', { type: 'text', id: 'lab-name', value: 'My theme', autocomplete: 'off' });
        const exportButton = el('button', { type: 'button', id: 'lab-export-button' }, 'Export theme JSON');
        const copyButton = el('button', { type: 'button', id: 'lab-copy' }, 'Copy to the clipboard');
        const download = el('a', { id: 'lab-download', download: 'theme.json', hidden: true }, 'Download theme.json');
        const text = el('textarea', { id: 'lab-export', readonly: true, rows: 16, spellcheck: 'false' });
        exportButton.addEventListener('click', () => {
            const result = exportTheme(base, edits, { id: idInput.value, name: nameInput.value });
            if (!result.ok) {
                exportedText = null;
                text.value = '';
                download.hidden = true;
                fill(issues, el('p', {}, 'The theme cannot be exported yet:'), el('ul', {}, ...result.issues.slice(0, 10).map((i) => el('li', {}, `${i.path === '' ? 'theme' : i.path}: ${i.message}`))));
                say(`Not exported: ${formatIssues(result.issues.slice(0, 1))}`);
                return;
            }
            fill(issues);
            exportedText = result.text;
            text.value = result.text;
            if (downloadUrl !== null) URL.revokeObjectURL(downloadUrl);
            downloadUrl = URL.createObjectURL(new Blob([result.text], { type: 'application/json' }));
            download.href = downloadUrl;
            download.download = `${result.theme.id}.json`;
            download.textContent = `Download ${result.theme.id}.json`;
            download.hidden = false;
            say(`Theme exported: ${result.text.length} characters, ${isEdited(edits) ? 'with your edits' : 'unchanged from the base theme'}. Press Tab to reach the text.`);
        });
        copyButton.addEventListener('click', () => {
            if (exportedText === null) {
                say('Export the theme first.');
                return;
            }
            const clip = navigator.clipboard as Clipboard | undefined;
            if (clip === undefined) {
                say('The browser does not allow copying here: select the text and copy it.');
                return;
            }
            clip.writeText(exportedText).then(
                () => say('Copied to the clipboard.'),
                () => say('The browser refused to copy: select the text and copy it.')
            );
        });
        parts.push(
            el(
                'fieldset',
                { id: 'lab-export-box' },
                el('legend', {}, 'Export'),
                el('div', { class: 'row' }, el('label', { for: 'lab-id' }, 'Theme id (lower case, hyphens)'), idInput),
                el('div', { class: 'row' }, el('label', { for: 'lab-name' }, 'Theme name'), nameInput),
                el('div', { class: 'buttons' }, exportButton, copyButton, download),
                el('div', { class: 'row' }, el('label', { for: 'lab-export' }, 'Theme JSON'), text)
            )
        );

        // import
        const importText = el('textarea', { id: 'lab-import', rows: 6, spellcheck: 'false' });
        const importButton = el('button', { type: 'button', id: 'lab-import-button' }, 'Load theme JSON');
        importButton.addEventListener('click', () => {
            const parsed = parseTheme(importText.value);
            if (!parsed.ok) {
                fill(issues, el('p', {}, 'That theme cannot be loaded:'), el('ul', {}, ...parsed.issues.slice(0, 10).map((i) => el('li', {}, `${i.path === '' ? 'theme' : i.path}: ${i.message}`))));
                say(`Not loaded: ${formatIssues(parsed.issues.slice(0, 1))}`);
                return;
            }
            base = parsed.value;
            baseId = 'imported';
            edits = NO_EDITS;
            build();
            refresh();
            say(`Loaded the theme ${parsed.value.name}. Its numbers are the starting point now.`);
        });
        parts.push(el('fieldset', { id: 'lab-import-box' }, el('legend', {}, 'Import'), el('div', { class: 'row' }, el('label', { for: 'lab-import' }, 'A theme file to start from'), importText), el('div', { class: 'buttons' }, importButton)));

        parts.push(status, issues);
        fill(root, ...parts);
    }

    const byIdSafe = (id: string): HTMLElement | null => document.getElementById(id);

    build();
    return {
        show(): void {
            deps.enter();
            const engine = deps.engine();
            if (engine !== null) {
                // only previews sound here: no layer of a lesson is on
                engine.setLayers({ on: [], heightBandM: null, hazardVoices: 3 });
                engine.setTheme(current);
                engine.update(IDLE(deps.now()));
            }
            document.getElementById('lab-h')?.focus();
        },
        theme: () => current,
        edits: () => edits,
        exported: () => exportedText
    };
}
