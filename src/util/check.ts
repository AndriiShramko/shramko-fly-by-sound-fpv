// A small toolkit for validators: they take `unknown` (a parsed file), collect every problem with
// the path to it and the reason, and return either the typed value or the list. A file is refused
// with ALL its problems at once, so whoever edits it fixes them in one go.

export interface Issue {
    /** where, as `a.b[2].c`; '' for the whole value */
    readonly path: string;
    /** why, in English, for a person */
    readonly message: string;
}

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly Issue[] };

export function formatIssues(issues: readonly Issue[]): string {
    return issues.map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`)).join('; ');
}

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "a string", "null", "an array", ...: for messages. */
export function describeType(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'an array';
    if (v === undefined) return 'missing';
    switch (typeof v) {
        case 'string':
            return 'a string';
        case 'number':
            return Number.isFinite(v) ? 'a number' : String(v);
        case 'boolean':
            return 'a boolean';
        case 'object':
            return 'an object';
        default:
            return `a ${typeof v}`;
    }
}

export const joinPath = (path: string, key: string | number): string => (typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`);

export interface StringRules {
    readonly min?: number;
    readonly max?: number;
    readonly pattern?: RegExp;
    /** said when the pattern fails */
    readonly patternHint?: string;
}

export interface NumberRules {
    readonly min?: number;
    readonly max?: number;
    readonly integer?: boolean;
}

/** Collects the issues of one validation. */
export class Collector {
    readonly issues: Issue[] = [];

    add(path: string, message: string): void {
        this.issues.push({ path, message });
    }

    get ok(): boolean {
        return this.issues.length === 0;
    }

    result<T>(value: T): Validation<T> {
        return this.ok ? { ok: true, value } : { ok: false, issues: this.issues };
    }

    /** `v` as an object, or null (with an issue). */
    record(v: unknown, path: string): Record<string, unknown> | null {
        if (isRecord(v)) return v;
        this.add(path, `must be an object, got ${describeType(v)}`);
        return null;
    }

    /** `v` as an array, or null (with an issue). */
    array(v: unknown, path: string, rules: { min?: number; max?: number } = {}): unknown[] | null {
        if (!Array.isArray(v)) {
            this.add(path, `must be an array, got ${describeType(v)}`);
            return null;
        }
        if (rules.min !== undefined && v.length < rules.min) this.add(path, `must hold at least ${rules.min} item${rules.min === 1 ? '' : 's'}, has ${v.length}`);
        if (rules.max !== undefined && v.length > rules.max) this.add(path, `must hold at most ${rules.max} items, has ${v.length}`);
        return v;
    }

    /** Every key of `obj` is in `allowed`, every key of `required` is present. */
    keys(obj: Record<string, unknown>, path: string, allowed: readonly string[], required: readonly string[] = allowed): void {
        for (const k of Object.keys(obj)) if (!allowed.includes(k)) this.add(joinPath(path, k), 'is not a known key');
        for (const k of required) if (!(k in obj) || obj[k] === undefined) this.add(joinPath(path, k), 'is missing');
    }

    string(v: unknown, path: string, rules: StringRules = {}): string | undefined {
        if (typeof v !== 'string') {
            if (v !== undefined) this.add(path, `must be a string, got ${describeType(v)}`);
            return undefined;
        }
        if (rules.min !== undefined && v.length < rules.min) this.add(path, `must have at least ${rules.min} character${rules.min === 1 ? '' : 's'}`);
        if (rules.max !== undefined && v.length > rules.max) this.add(path, `must have at most ${rules.max} characters`);
        if (rules.pattern !== undefined && !rules.pattern.test(v)) this.add(path, rules.patternHint ?? `must match ${String(rules.pattern)}`);
        return v;
    }

    number(v: unknown, path: string, rules: NumberRules = {}): number | undefined {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            if (v !== undefined) this.add(path, `must be a finite number, got ${describeType(v)}`);
            return undefined;
        }
        if (rules.integer === true && !Number.isInteger(v)) this.add(path, `must be an integer, got ${v}`);
        if (rules.min !== undefined && v < rules.min) this.add(path, `must be at least ${rules.min}, got ${v}`);
        if (rules.max !== undefined && v > rules.max) this.add(path, `must be at most ${rules.max}, got ${v}`);
        return v;
    }

    boolean(v: unknown, path: string): boolean | undefined {
        if (typeof v !== 'boolean') {
            if (v !== undefined) this.add(path, `must be true or false, got ${describeType(v)}`);
            return undefined;
        }
        return v;
    }

    oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T | undefined {
        if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
            if (v !== undefined) this.add(path, `must be one of ${values.join(', ')}, got ${typeof v === 'string' ? `'${v}'` : describeType(v)}`);
            return undefined;
        }
        return v as T;
    }

    /** `v` as a [x, y, z] of finite numbers, or undefined. */
    vec3(v: unknown, path: string): readonly [number, number, number] | undefined {
        if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
            if (v !== undefined) this.add(path, 'must be three finite numbers [x, y, z]');
            return undefined;
        }
        return v as unknown as [number, number, number];
    }
}

/** An ISO 8601 date and time with a zone: 2026-11-07T10:30:00Z, 2026-11-07T10:30:00.123+01:00. */
export const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoDate(text: string): boolean {
    return ISO_8601.test(text) && !Number.isNaN(Date.parse(text));
}
