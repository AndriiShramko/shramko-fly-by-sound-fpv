// A preset is a set of changes applied to a theme's numbers. The calm preset (spec principle 6: a
// calm mode exists) makes every sound softer and slower: lower layer gains, longer and sparser
// pulses, less roughness, duller far sounds. It is data, so the Sound Lab can show what it does.
import type { LayerId, ThemeDef } from '../contract';
import { LAYER_IDS } from '../contract';
import { LAYER_PARAMS } from './schema';

export interface PresetRule {
    readonly layer: LayerId;
    readonly param: string;
    /** 'mul': multiply the value by `by`; 'add': add `by` to it */
    readonly op: 'mul' | 'add';
    readonly by: number;
}

export interface ThemePreset {
    readonly id: string;
    /** added to each layer's gainDb */
    readonly gainOffsetDb: Readonly<Partial<Record<LayerId, number>>>;
    readonly rules: readonly PresetRule[];
}

export const CALM_PRESET: ThemePreset = {
    id: 'calm',
    gainOffsetDb: { safety: -3, height: -4, speed: -6, target: -4, shape: -4, room: -4, voice: 0 },
    rules: [
        { layer: 'safety', param: 'pulseMs', op: 'mul', by: 1.3 },
        { layer: 'safety', param: 'periodNearMs', op: 'mul', by: 1.4 },
        { layer: 'safety', param: 'periodFarMs', op: 'mul', by: 1.3 },
        { layer: 'safety', param: 'ildBoostDb', op: 'mul', by: 0.6 },
        { layer: 'safety', param: 'lowpassNearHz', op: 'mul', by: 0.6 },
        { layer: 'safety', param: 'lowpassFarHz', op: 'mul', by: 0.7 },
        { layer: 'height', param: 'roughDepth', op: 'mul', by: 0.5 },
        { layer: 'speed', param: 'tempoMaxHz', op: 'mul', by: 0.7 },
        { layer: 'target', param: 'rateNearHz', op: 'mul', by: 0.7 },
        { layer: 'target', param: 'roughMax', op: 'mul', by: 0.5 },
        { layer: 'shape', param: 'orbitHz', op: 'mul', by: 0.7 },
        { layer: 'shape', param: 'sweepHz', op: 'mul', by: 0.7 },
        { layer: 'shape', param: 'faceHz', op: 'mul', by: 0.7 },
        { layer: 'shape', param: 'sizeBoostDb', op: 'mul', by: 0.5 },
        { layer: 'room', param: 'reverbMax', op: 'mul', by: 0.8 }
    ]
};

/** The theme with the preset applied, every number held inside its range. The master section and the ceiling are never touched. */
export function applyPreset(theme: ThemeDef, preset: ThemePreset): ThemeDef {
    const layers = {} as Record<LayerId, ThemeDef['layers'][LayerId]>;
    for (const id of LAYER_IDS) {
        const layer = theme.layers[id];
        const params: Record<string, number> = { ...layer.params };
        for (const rule of preset.rules) {
            if (rule.layer !== id) continue;
            const spec = LAYER_PARAMS[id][rule.param];
            const current = params[rule.param];
            if (spec === undefined || current === undefined) continue;
            const raw = rule.op === 'mul' ? current * rule.by : current + rule.by;
            const clamped = Math.min(Math.max(raw, spec.min), spec.max);
            params[rule.param] = spec.integer ? Math.round(clamped) : Math.round(clamped * 1e6) / 1e6;
        }
        const gainDb = Math.min(Math.max(layer.gainDb + (preset.gainOffsetDb[id] ?? 0), -40), 12);
        layers[id] = { gainDb, timbre: layer.timbre, params };
    }
    return { ...theme, layers };
}

/** The calm version of a theme. The engine applies it when SonicPrefs.calm is on. */
export function applyCalm(theme: ThemeDef): ThemeDef {
    return applyPreset(theme, CALM_PRESET);
}
