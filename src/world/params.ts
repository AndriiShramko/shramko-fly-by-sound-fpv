// The parameters of a world generator: a schema per generator and version, checked and filled with
// its defaults (sorted by name) before anything is built, so the spec in a digest always holds every
// parameter. A parameter's range, default or meaning belongs to the version that has it.
import type { AnalyticWorldSpec, WorldGenerator } from '../contract';

export class WorldSpecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorldSpecError';
    }
}

export type ResolvedValue = number | string | readonly number[];
export type ResolvedParams = Readonly<Record<string, ResolvedValue>>;

export interface NumberParam {
    readonly kind: 'number';
    readonly def: number;
    readonly min: number;
    readonly max: number;
    readonly integer: boolean;
}
export interface EnumParam {
    readonly kind: 'enum';
    readonly def: string;
    readonly values: readonly string[];
}
export interface ListParam {
    readonly kind: 'list';
    readonly min: number;
    readonly max: number;
    readonly maxLength: number;
}
/**
 * Heights (version 2 of the gate generators): a list of metres like a ListParam, or level names joined
 * by commas ("floor,middle,ceiling"), each one of `levels`. Resolved as given (the names without
 * spaces); absent: an empty list.
 */
export interface HeightsParam {
    readonly kind: 'heights';
    readonly min: number;
    readonly max: number;
    readonly maxLength: number;
    readonly levels: readonly string[];
}
export type ParamDef = NumberParam | EnumParam | ListParam | HeightsParam;
export type Schema = Readonly<Record<string, ParamDef>>;

export const num = (def: number, min: number, max: number, integer = false): NumberParam => ({ kind: 'number', def, min, max, integer });
export const oneOf = (def: string, ...values: string[]): EnumParam => ({ kind: 'enum', def, values });
export const list = (min: number, max: number, maxLength: number): ListParam => ({ kind: 'list', min, max, maxLength });
export const heights = (min: number, max: number, maxLength: number, levels: readonly string[]): HeightsParam => ({ kind: 'heights', min, max, maxLength, levels });

/** Checks `given` against `schema` and fills every default; throws WorldSpecError. */
export function resolveWith(schema: Schema, generator: WorldGenerator, given: AnalyticWorldSpec['params']): ResolvedParams {
    for (const key of Object.keys(given)) {
        if (!(key in schema)) throw new WorldSpecError(`unknown parameter '${key}' for generator '${generator}'`);
    }
    const out: Record<string, ResolvedValue> = {};
    for (const name of Object.keys(schema).sort()) {
        const def = schema[name] as ParamDef;
        const v = given[name];
        const where = `parameter '${name}' of '${generator}'`;
        switch (def.kind) {
            case 'number': {
                if (v === undefined) out[name] = def.def;
                else if (typeof v !== 'number' || !Number.isFinite(v)) throw new WorldSpecError(`${where} must be a finite number`);
                else if (v < def.min || v > def.max) throw new WorldSpecError(`${where} must be between ${def.min} and ${def.max}, got ${v}`);
                else if (def.integer && !Number.isInteger(v)) throw new WorldSpecError(`${where} must be an integer, got ${v}`);
                else out[name] = v;
                break;
            }
            case 'enum': {
                if (v === undefined) out[name] = def.def;
                else if (typeof v !== 'string' || !def.values.includes(v)) throw new WorldSpecError(`${where} must be one of ${def.values.join(', ')}, got ${String(v)}`);
                else out[name] = v;
                break;
            }
            case 'list': {
                if (v === undefined) out[name] = [];
                else if (!Array.isArray(v) || v.length > def.maxLength) throw new WorldSpecError(`${where} must be a list of at most ${def.maxLength} numbers`);
                else if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= def.min && x <= def.max)) {
                    throw new WorldSpecError(`${where} must hold numbers between ${def.min} and ${def.max}`);
                } else out[name] = [...v];
                break;
            }
            case 'heights': {
                if (v === undefined) out[name] = [];
                else if (typeof v === 'string') {
                    const names = v.split(',').map((x) => x.trim());
                    if (names.length > def.maxLength || !names.every((x) => def.levels.includes(x))) {
                        throw new WorldSpecError(`${where} must be at most ${def.maxLength} of ${def.levels.join(', ')} joined by commas, or a list of metres`);
                    }
                    out[name] = names.join(',');
                } else if (!Array.isArray(v) || v.length > def.maxLength) throw new WorldSpecError(`${where} must be a list of at most ${def.maxLength} heights in metres, or level names joined by commas`);
                else if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= def.min && x <= def.max)) {
                    throw new WorldSpecError(`${where} must hold heights between ${def.min} and ${def.max} m`);
                } else out[name] = [...v];
                break;
            }
        }
    }
    return out;
}
