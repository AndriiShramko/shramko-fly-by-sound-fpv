// The theme loader: a parsed file in, a ThemeDef or the list of everything wrong with it out. Themes
// are plain data a sound engineer edits without code, so the loader is strict (unknown and missing
// keys are refused, every number has a range) and says where and why.
import type { LayerId, LayerTheme, MaterialClass, ThemeDef } from '../contract';
import { FORMATS, LAYER_IDS, MATERIAL_CLASSES } from '../contract';
import { canonicalPretty } from '../util/canonical';
import { Collector, joinPath, type Validation } from '../util/check';
import { scaleSize } from './pitch';
import { LAYER_PARAMS, PARAM_ORDER, PENTATONIC_DEGREES, THEME_ID, TIMBRES } from './schema';

const TOP_KEYS = ['format', 'id', 'version', 'name', 'scale', 'master', 'duckDb', 'layers', 'materials'] as const;

/** The top note of the scale must stay under this, Hz: higher is shrill and the HRTF has nothing there. */
export const MAX_SCALE_HZ = 8000;

export function validateTheme(input: unknown): Validation<ThemeDef> {
    const c = new Collector();
    const root = c.record(input, '');
    if (root === null) return c.result(undefined as never);
    c.keys(root, '', TOP_KEYS);

    if (root.format !== FORMATS.theme && root.format !== undefined) c.add('format', `must be '${FORMATS.theme}', got ${JSON.stringify(root.format)}`);
    const id = c.string(root.id, 'id', { min: 1, max: 40, pattern: THEME_ID, patternHint: 'must be lower-case letters and digits in groups joined by single hyphens' });
    const version = c.number(root.version, 'version', { integer: true, min: 1 });
    const name = c.string(root.name, 'name', { min: 1, max: 60 });
    if (name !== undefined && /[\u0000-\u001f]/.test(name)) c.add('name', 'must not contain control characters');

    // the scale
    let scale: ThemeDef['scale'] | undefined;
    const rawScale = root.scale === undefined ? null : c.record(root.scale, 'scale');
    if (rawScale !== null) {
        c.keys(rawScale, 'scale', ['rootHz', 'steps', 'octaves']);
        const rootHz = c.number(rawScale.rootHz, 'scale.rootHz', { min: 40, max: 1000 });
        const octaves = c.number(rawScale.octaves, 'scale.octaves', { integer: true, min: 1, max: 6 });
        const stepsRaw = rawScale.steps === undefined ? null : c.array(rawScale.steps, 'scale.steps');
        let steps: number[] | undefined;
        if (stepsRaw !== null) {
            if (stepsRaw.length !== PENTATONIC_DEGREES) c.add('scale.steps', `must list ${PENTATONIC_DEGREES} degrees (a pentatonic scale), has ${stepsRaw.length}`);
            else if (!stepsRaw.every((s) => typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= 11)) c.add('scale.steps', 'must be whole semitones from 0 to 11');
            else if (!stepsRaw.every((s, i) => i === 0 || (s as number) > (stepsRaw[i - 1] as number))) c.add('scale.steps', 'must be strictly increasing');
            else if (stepsRaw[0] !== 0) c.add('scale.steps', 'must start with 0, the root');
            else {
                const list = stepsRaw as number[];
                const gaps = list.map((s, i) => (i === list.length - 1 ? 12 - s : (list[i + 1] as number) - s));
                if (gaps.some((g) => g < 2 || g > 3)) c.add('scale.steps', `neighbouring degrees must be 2 or 3 semitones apart, the octave included (gaps ${gaps.join(', ')}): a semitone clashes, a larger gap is no pentatonic scale`);
                else steps = list;
            }
        }
        if (rootHz !== undefined && octaves !== undefined && rootHz * 2 ** octaves > MAX_SCALE_HZ) c.add('scale', `the top note, ${(rootHz * 2 ** octaves).toFixed(0)} Hz, is above ${MAX_SCALE_HZ} Hz`);
        if (rootHz !== undefined && octaves !== undefined && steps !== undefined) scale = { rootHz, steps, octaves };
    } else if (root.scale === undefined) {
        // reported by keys()
    }

    // master
    let master: ThemeDef['master'] | undefined;
    const rawMaster = root.master === undefined ? null : c.record(root.master, 'master');
    if (rawMaster !== null) {
        c.keys(rawMaster, 'master', ['gainDb', 'ceilingDb', 'fadeInS']);
        const gainDb = c.number(rawMaster.gainDb, 'master.gainDb', { min: -40, max: 0 });
        const ceilingDb = c.number(rawMaster.ceilingDb, 'master.ceilingDb', { min: -24, max: -6 });
        const fadeInS = c.number(rawMaster.fadeInS, 'master.fadeInS', { min: 0.25, max: 5 });
        if (gainDb !== undefined && ceilingDb !== undefined && fadeInS !== undefined) master = { gainDb, ceilingDb, fadeInS };
    }
    const duckDb = c.number(root.duckDb, 'duckDb', { min: 0, max: 30 });

    // the layers
    const layers: Partial<Record<LayerId, LayerTheme>> = {};
    const rawLayers = root.layers === undefined ? null : c.record(root.layers, 'layers');
    if (rawLayers !== null) {
        c.keys(rawLayers, 'layers', LAYER_IDS);
        for (const layer of LAYER_IDS) {
            const path = joinPath('layers', layer);
            const raw = rawLayers[layer] === undefined ? null : c.record(rawLayers[layer], path);
            if (raw === null) continue;
            c.keys(raw, path, ['gainDb', 'timbre', 'params']);
            const gainDb = c.number(raw.gainDb, joinPath(path, 'gainDb'), { min: -40, max: 12 });
            const timbre = c.oneOf(raw.timbre, joinPath(path, 'timbre'), TIMBRES);
            const params = validateParams(c, layer, raw.params, joinPath(path, 'params'), scale);
            if (gainDb !== undefined && timbre !== undefined && params !== undefined) layers[layer] = { gainDb, timbre, params };
        }
    }

    // the safety layer's timbre per surface class
    const materials: Partial<Record<MaterialClass, ThemeDef['materials'][MaterialClass]>> = {};
    const rawMaterials = root.materials === undefined ? null : c.record(root.materials, 'materials');
    if (rawMaterials !== null) {
        c.keys(rawMaterials, 'materials', MATERIAL_CLASSES);
        for (const m of MATERIAL_CLASSES) {
            const t = c.oneOf(rawMaterials[m], joinPath('materials', m), TIMBRES);
            if (t !== undefined) materials[m] = t;
        }
    }

    if (!c.ok || id === undefined || version === undefined || name === undefined || scale === undefined || master === undefined || duckDb === undefined) return c.result(undefined as never);
    const value: ThemeDef = {
        format: FORMATS.theme,
        id,
        version,
        name,
        scale,
        master,
        duckDb,
        layers: layers as ThemeDef['layers'],
        materials: materials as ThemeDef['materials']
    };
    return { ok: true, value };
}

function validateParams(c: Collector, layer: LayerId, raw: unknown, path: string, scale: ThemeDef['scale'] | undefined): Record<string, number> | undefined {
    const rec = raw === undefined ? null : c.record(raw, path);
    if (rec === null) return undefined;
    const spec = LAYER_PARAMS[layer];
    c.keys(rec, path, Object.keys(spec));
    const out: Record<string, number> = {};
    for (const [name, s] of Object.entries(spec)) {
        const v = rec[name];
        if (v === undefined) continue; // reported by keys()
        const at = joinPath(path, name);
        if (s.scaleIndex) {
            const top = scale === undefined ? undefined : scaleSize(scale) - 1;
            const n = c.number(v, at, { integer: true, min: 0, max: top });
            if (n !== undefined) out[name] = n;
        } else {
            const n = c.number(v, at, { min: s.min, max: s.max, integer: s.integer });
            if (n !== undefined) out[name] = n;
        }
    }
    for (const rule of PARAM_ORDER) {
        if (rule.layer !== layer) continue;
        const low = out[rule.low];
        const high = out[rule.high];
        if (low !== undefined && high !== undefined && !(low < high)) c.add(joinPath(path, rule.low), `must be below ${rule.high} (${low} is not below ${high})`);
    }
    return Object.keys(out).length === Object.keys(spec).length ? out : undefined;
}

/** Parses the text of a theme file. */
export function parseTheme(text: string): Validation<ThemeDef> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return validateTheme(data);
}

/** The canonical text of a theme file: keys sorted, two spaces of indent, a final newline. */
export function writeTheme(theme: ThemeDef): string {
    return `${canonicalPretty(theme)}\n`;
}
