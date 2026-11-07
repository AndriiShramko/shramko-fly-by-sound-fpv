// Canonical JSON: one byte-exact text for one value, so that a hash of it means something.
//
//   - object keys sorted by UTF-16 code units, at every depth
//   - no whitespace
//   - numbers as JSON.stringify prints them (shortest text that reads back the same); -0 is 0;
//     NaN and the infinities are refused
//   - keys whose value is undefined are left out, as JSON.stringify does; an undefined array
//     item, a function, a symbol, a bigint or a Date is refused
//   - strings as JSON.stringify writes them (control characters and lone surrogates escaped)
//
// Used for the digest of an analytic world, the track and theme writers and the session manifest.

export class CanonicalJsonError extends Error {
    readonly path: string;
    constructor(message: string, path: string) {
        super(`${message} at ${path === '' ? 'the root' : path}`);
        this.name = 'CanonicalJsonError';
        this.path = path;
    }
}

function write(value: unknown, path: string, out: string[], seen: Set<object>): void {
    if (value === null) {
        out.push('null');
        return;
    }
    switch (typeof value) {
        case 'boolean':
            out.push(value ? 'true' : 'false');
            return;
        case 'number':
            if (!Number.isFinite(value)) throw new CanonicalJsonError(`${String(value)} is not a JSON number`, path);
            out.push(Object.is(value, -0) ? '0' : JSON.stringify(value));
            return;
        case 'string':
            out.push(JSON.stringify(value));
            return;
        case 'object': {
            if (seen.has(value)) throw new CanonicalJsonError('a cycle', path);
            seen.add(value);
            if (Array.isArray(value)) {
                out.push('[');
                value.forEach((item, i) => {
                    if (i > 0) out.push(',');
                    if (item === undefined) throw new CanonicalJsonError('an undefined array item', `${path}[${i}]`);
                    write(item, `${path}[${i}]`, out, seen);
                });
                out.push(']');
            } else {
                if (value instanceof Date) throw new CanonicalJsonError('a Date (write an ISO string)', path);
                const record = value as Record<string, unknown>;
                const keys = Object.keys(record)
                    .filter((k) => record[k] !== undefined)
                    .sort();
                out.push('{');
                keys.forEach((k, i) => {
                    if (i > 0) out.push(',');
                    out.push(JSON.stringify(k), ':');
                    write(record[k], path === '' ? k : `${path}.${k}`, out, seen);
                });
                out.push('}');
            }
            seen.delete(value);
            return;
        }
        default:
            throw new CanonicalJsonError(`a ${typeof value} is not JSON`, path);
    }
}

/** The canonical JSON text of `value`; throws CanonicalJsonError for values JSON cannot hold. */
export function canonicalJson(value: unknown): string {
    const out: string[] = [];
    write(value, '', out, new Set());
    return out.join('');
}
