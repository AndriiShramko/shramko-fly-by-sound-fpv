// The Sound Lab's model: a shipped theme plus the edits a sound engineer makes with sliders, and the
// theme file that results. Pure and DOM-free (Node tests cover it); demo/lab.ts builds the controls.
//
// What you hear is what you export: `applyEdits` makes the theme the engine plays and `exportTheme`
// the file, from the same edits, and the file is checked by the same validator the engine loads themes
// with. The per-layer PITCH control is baked into the file: it moves every note parameter of the layer
// (the parameters named *Step, which are indices of the theme's pentatonic scale) by that many scale
// steps, held inside the scale, so a shifted tone is still a note of the scale.
import type { LayerId, MaterialClass, ThemeDef, Timbre } from '../src/contract';
import { LAYER_IDS, MATERIAL_CLASSES } from '../src/contract';
import { LAYER_PARAMS, scaleSize, shiftNote, TIMBRES, validateTheme, writeTheme, type ParamSpec } from '../src/theme';
import type { Issue } from '../src/util';

export interface LabEdits {
    readonly master: Partial<ThemeDef['master']>;
    readonly duckDb: number | null;
    /** the layer's own gain, dB */
    readonly gainDb: Partial<Record<LayerId, number>>;
    /** scale steps added to every note parameter of the layer */
    readonly pitch: Partial<Record<LayerId, number>>;
    readonly timbre: Partial<Record<LayerId, Timbre>>;
    /** a parameter of a layer set to a value (before the pitch shift is added) */
    readonly params: Partial<Record<LayerId, Readonly<Record<string, number>>>>;
    readonly materials: Partial<Record<MaterialClass, Timbre>>;
}

export const NO_EDITS: LabEdits = { master: {}, duckDb: null, gainDb: {}, pitch: {}, timbre: {}, params: {}, materials: {} };

/** The ranges the controls offer; the validator holds the file to the same ones. */
export const LAB_RANGES = {
    layerGainDb: { min: -40, max: 12, step: 0.5 },
    pitchSteps: { min: -12, max: 12, step: 1 },
    masterGainDb: { min: -40, max: 0, step: 0.5 },
    ceilingDb: { min: -24, max: -6, step: 0.5 },
    fadeInS: { min: 0.25, max: 5, step: 0.05 },
    duckDb: { min: 0, max: 30, step: 0.5 }
} as const;

export function isEdited(e: LabEdits): boolean {
    return (
        Object.keys(e.master).length > 0 ||
        e.duckDb !== null ||
        Object.keys(e.gainDb).length > 0 ||
        Object.values(e.pitch).some((v) => v !== undefined && v !== 0) ||
        Object.keys(e.timbre).length > 0 ||
        Object.values(e.params).some((p) => p !== undefined && Object.keys(p).length > 0) ||
        Object.keys(e.materials).length > 0
    );
}

/** A value held to a parameter's range (and, for a note, to the scale), rounded when it must be whole. */
export function clampParam(spec: ParamSpec, value: number, scale: ThemeDef['scale']): number {
    const top = spec.scaleIndex ? scaleSize(scale) - 1 : spec.max;
    const x = Math.min(Math.max(Number.isFinite(value) ? value : spec.default, spec.min), top);
    return spec.integer ? Math.round(x) : x;
}

const clampTo = (v: number, range: { readonly min: number; readonly max: number }): number => Math.min(Math.max(v, range.min), range.max);

/** The base theme with the edits applied; ranges are held, the result is not yet validated as a whole. */
export function applyEdits(base: ThemeDef, edits: LabEdits): ThemeDef {
    const layers = {} as Record<LayerId, ThemeDef['layers'][LayerId]>;
    for (const id of LAYER_IDS) {
        const from = base.layers[id];
        const shift = Math.round(edits.pitch[id] ?? 0);
        const set = edits.params[id] ?? {};
        const params: Record<string, number> = {};
        for (const [name, spec] of Object.entries(LAYER_PARAMS[id])) {
            let v = set[name] ?? from.params[name] ?? spec.default;
            v = clampParam(spec, v, base.scale);
            if (spec.scaleIndex && shift !== 0) v = shiftNote(base.scale, v, shift);
            params[name] = v;
        }
        layers[id] = {
            gainDb: clampTo(edits.gainDb[id] ?? from.gainDb, LAB_RANGES.layerGainDb),
            timbre: edits.timbre[id] ?? from.timbre,
            params
        };
    }
    const materials = {} as Record<MaterialClass, Timbre>;
    for (const m of MATERIAL_CLASSES) materials[m] = edits.materials[m] ?? base.materials[m];
    return {
        ...base,
        master: {
            gainDb: clampTo(edits.master.gainDb ?? base.master.gainDb, LAB_RANGES.masterGainDb),
            ceilingDb: clampTo(edits.master.ceilingDb ?? base.master.ceilingDb, LAB_RANGES.ceilingDb),
            fadeInS: clampTo(edits.master.fadeInS ?? base.master.fadeInS, LAB_RANGES.fadeInS)
        },
        duckDb: clampTo(edits.duckDb ?? base.duckDb, LAB_RANGES.duckDb),
        layers,
        materials
    };
}

export interface ExportMeta {
    /** lower-case letters and digits joined by single hyphens */
    readonly id: string;
    readonly name: string;
}

export type ExportResult = { readonly ok: true; readonly theme: ThemeDef; readonly text: string } | { readonly ok: false; readonly issues: readonly Issue[] };

/** The theme file for the edits: the same theme the engine plays, under a new id and name, validated. */
export function exportTheme(base: ThemeDef, edits: LabEdits, meta: ExportMeta): ExportResult {
    const theme: ThemeDef = { ...applyEdits(base, edits), id: meta.id, name: meta.name.trim(), version: 1 };
    const checked = validateTheme(theme);
    return checked.ok ? { ok: true, theme: checked.value, text: writeTheme(checked.value) } : { ok: false, issues: checked.issues };
}

/** The controls of one layer: its parameters in schema order. */
export function layerFields(layer: LayerId): { readonly name: string; readonly spec: ParamSpec }[] {
    return Object.entries(LAYER_PARAMS[layer]).map(([name, spec]) => ({ name, spec }));
}

export const ALL_TIMBRES: readonly Timbre[] = TIMBRES;
