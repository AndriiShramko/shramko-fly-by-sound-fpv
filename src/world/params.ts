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
export type ParamDef = NumberParam | EnumParam | ListParam;
export type Schema = Readonly<Record<string, ParamDef>>;

export const num = (def: number, min: number, max: number, integer = false): NumberParam => ({ kind: 'number', def, min, max, integer });
export const oneOf = (def: string, ...values: string[]): EnumParam => ({ kind: 'enum', def, values });
export const list = (min: number, max: number, maxLength: number): ListParam => ({ kind: 'list', min, max, maxLength });

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
        }
    }
    return out;
}
