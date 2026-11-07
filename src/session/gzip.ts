// gzip (RFC 1952) for the session package. flight.jsonl.gz is written as ONE MEMBER PER CHUNK: each
// chunk of a few seconds is a complete gzip stream appended to the file, so a tab closed mid-session
// leaves every earlier chunk readable. Members are concatenated, which gzip allows.
//
// Writing: the browser's CompressionStream (also a global of Node 18 and later), or any function the
// host passes in (zlib in Node, a test double); `gzipStored` is a pure fallback that makes a valid
// member without compressing. Reading: `gunzipMembers` walks the members with this package's own
// inflate, checks each CRC-32 and length, and in tolerant mode keeps everything before a damaged tail.
import { crc32 } from './crc32';
import { DEFAULT_INFLATE_LIMIT, inflateRaw, InflateError } from './inflate';

export class GzipError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GzipError';
    }
}

/** Compresses bytes into one complete gzip member. */
export type GzipFn = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface GzipMember {
    /** the decoded bytes of this member */
    readonly data: Uint8Array;
    /** byte range of the member in the file */
    readonly start: number;
    readonly end: number;
}

export interface GunzipOptions {
    /** cap on the decoded size of the whole file, bytes (default 512 MiB) */
    readonly limit?: number;
    /**
     * false (default): any damage throws GzipError. true: stop at the first damaged or incomplete
     * member and return what came before it, with `error` saying what stopped the reading.
     */
    readonly tolerateTail?: boolean;
}

export interface GunzipResult {
    readonly members: readonly GzipMember[];
    /** all members' bytes joined */
    readonly data: Uint8Array;
    /** end of the last good member: the file may be cut here to drop a damaged tail */
    readonly validEnd: number;
    /** null when the whole file was read */
    readonly error: string | null;
}

const FHCRC = 2;
const FEXTRA = 4;
const FNAME = 8;
const FCOMMENT = 16;

const u32 = (b: Uint8Array, at: number): number => ((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16) | ((b[at + 3] as number) << 24)) >>> 0;

/** Reads one member at `start`; throws GzipError. */
function readMember(bytes: Uint8Array, start: number, limit: number): GzipMember {
    if (start + 18 > bytes.length) throw new GzipError('a gzip member is cut short');
    if (bytes[start] !== 0x1f || bytes[start + 1] !== 0x8b) throw new GzipError('not a gzip member (bad magic bytes)');
    if (bytes[start + 2] !== 8) throw new GzipError('unknown gzip compression method');
    const flags = bytes[start + 3] as number;
    if ((flags & 0xe0) !== 0) throw new GzipError('reserved gzip flags are set');
    let pos = start + 10;
    if ((flags & FEXTRA) !== 0) {
        if (pos + 2 > bytes.length) throw new GzipError('a gzip member is cut short');
        pos += 2 + ((bytes[pos] as number) | ((bytes[pos + 1] as number) << 8));
    }
    for (const flag of [FNAME, FCOMMENT]) {
        if ((flags & flag) === 0) continue;
        while (pos < bytes.length && bytes[pos] !== 0) pos++;
        pos++;
    }
    if ((flags & FHCRC) !== 0) pos += 2;
    if (pos >= bytes.length) throw new GzipError('a gzip member is cut short');
    let inflated;
    try {
        inflated = inflateRaw(bytes, pos, limit);
    } catch (e) {
        if (e instanceof InflateError) throw new GzipError(e.message);
        throw e;
    }
    const trailer = inflated.end;
    if (trailer + 8 > bytes.length) throw new GzipError('a gzip member is cut short');
    if (u32(bytes, trailer) !== crc32(inflated.data)) throw new GzipError('a gzip member fails its CRC-32 check');
    if (u32(bytes, trailer + 4) !== inflated.data.length % 4294967296) throw new GzipError('a gzip member fails its length check');
    return { data: inflated.data, start, end: trailer + 8 };
}

/** Reads a file of gzip members, one after the other (a single gzip file is one member). */
export function gunzipMembers(bytes: Uint8Array, options: GunzipOptions = {}): GunzipResult {
    const limit = options.limit ?? DEFAULT_INFLATE_LIMIT;
    const members: GzipMember[] = [];
    let pos = 0;
    let total = 0;
    let error: string | null = null;
    while (pos < bytes.length) {
        try {
            const m = readMember(bytes, pos, limit - total);
            total += m.data.length;
            members.push(m);
            pos = m.end;
        } catch (e) {
            if (!(e instanceof GzipError) || options.tolerateTail !== true) {
                if (e instanceof GzipError) throw new GzipError(`${e.message} (member ${members.length + 1}, at byte ${pos})`);
                throw e;
            }
            error = `${e.message} (member ${members.length + 1}, at byte ${pos})`;
            break;
        }
    }
    const data = new Uint8Array(total);
    let at = 0;
    for (const m of members) {
        data.set(m.data, at);
        at += m.data.length;
    }
    return { members, data, validEnd: members.length === 0 ? 0 : (members[members.length - 1] as GzipMember).end, error };
}

/** One gzip member that holds `data` in stored (uncompressed) deflate blocks: valid, never smaller. */
export function gzipStored(data: Uint8Array): Uint8Array {
    const blocks = Math.max(1, Math.ceil(data.length / 65535));
    const out = new Uint8Array(10 + data.length + blocks * 5 + 8);
    out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255], 0);
    let at = 10;
    for (let b = 0; b < blocks; b++) {
        const from = b * 65535;
        const len = Math.min(65535, data.length - from);
        out[at++] = b === blocks - 1 ? 1 : 0;
        out[at++] = len & 255;
        out[at++] = len >>> 8;
        out[at++] = ~len & 255;
        out[at++] = (~len >>> 8) & 255;
        out.set(data.subarray(from, from + len), at);
        at += len;
    }
    const crc = crc32(data);
    const size = data.length % 4294967296;
    for (let i = 0; i < 4; i++) out[at++] = (crc >>> (8 * i)) & 255;
    for (let i = 0; i < 4; i++) out[at++] = (size >>> (8 * i)) & 255;
    return out;
}

// The structural slice of the Compression Streams API this file needs (the core has no DOM types).
interface ByteReaderLike {
    read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
}
interface ByteWriterLike {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
}
interface CompressionStreamLike {
    readonly readable: { getReader(): ByteReaderLike };
    readonly writable: { getWriter(): ByteWriterLike };
}
type CompressionStreamCtor = new (format: 'gzip') => CompressionStreamLike;

/** The platform's gzip compressor (CompressionStream), or null where there is none. */
export function webGzip(): GzipFn | null {
    const Ctor = (globalThis as { CompressionStream?: CompressionStreamCtor }).CompressionStream;
    if (Ctor === undefined) return null;
    return async (bytes: Uint8Array): Promise<Uint8Array> => {
        const stream = new Ctor('gzip');
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        // write and read at once: a stream that is only written to would stall on backpressure
        const writing = writer.write(bytes).then(() => writer.close());
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const r = await reader.read();
            if (r.done) break;
            if (r.value !== undefined) {
                parts.push(r.value);
                size += r.value.length;
            }
        }
        await writing;
        const out = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
            out.set(p, at);
            at += p.length;
        }
        return out;
    };
}

/** CompressionStream where the platform has it, else the stored fallback (a valid file, only larger). */
export function defaultGzip(): GzipFn {
    return webGzip() ?? ((bytes: Uint8Array): Promise<Uint8Array> => Promise.resolve(gzipStored(bytes)));
}
