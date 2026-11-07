// A small zip writer and reader for the session package. The writer is STORE-ONLY on purpose: the
// files inside are already compressed (the flight log is gzip, the voice is Opus) or tiny, and a
// store-only archive can be put together from chunks without any compressor. The reader takes what
// other tools write too (a package re-zipped by hand): it follows the central directory, accepts
// STORE and DEFLATE entries, checks every CRC-32 and size, and refuses encryption, ZIP64, duplicate
// names and names that could escape a folder. No stage of reading trusts a length it has not
// checked against the buffer.
import { crc32 } from './crc32';
import { utf8Encode } from '../util/sha256';
import { utf8Decode } from '../util/utf8';
import { DEFAULT_INFLATE_LIMIT, inflateRaw, InflateError } from './inflate';

export class ZipError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ZipError';
    }
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const MAX_ENTRIES = 0xfffe;
const MAX_SIZE = 0xfffffffe;
const MAX_NAME_BYTES = 255;

/** A name that is safe to take as it stands: relative, forward slashes, no '.' or '..' parts, no control characters. */
export function isSafeEntryName(name: string): boolean {
    if (name.length === 0 || name.length > MAX_NAME_BYTES || utf8Encode(name).length > MAX_NAME_BYTES) return false;
    if (name.startsWith('/') || name.includes('\\') || name.includes(':')) return false;
    if (/[\u0000-\u001f\u007f]/.test(name)) return false;
    return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function dosStamp(date: Date): { readonly time: number; readonly day: number } {
    const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
    return {
        time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
        day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
    };
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
    let size = 0;
    for (const p of parts) size += p.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};

interface Pending {
    readonly name: Uint8Array;
    readonly crc: number;
    readonly size: number;
    readonly offset: number;
}

/** Builds a store-only zip archive in memory, as parts (so a Blob can be made without joining them). */
export class ZipWriter {
    private readonly parts: Uint8Array[] = [];
    private readonly entries: Pending[] = [];
    private readonly names = new Set<string>();
    private offset = 0;
    private readonly stamp: { readonly time: number; readonly day: number };

    /** `date`: the modification time stored for every entry (default 1980-01-01, so the same input gives the same bytes). */
    constructor(options: { readonly date?: Date | string } = {}) {
        const d = options.date === undefined ? new Date(Date.UTC(1980, 0, 1)) : new Date(options.date);
        this.stamp = Number.isNaN(d.getTime()) ? dosStamp(new Date(Date.UTC(1980, 0, 1))) : dosStamp(d);
    }

    add(name: string, data: Uint8Array | readonly Uint8Array[]): void {
        if (!isSafeEntryName(name)) throw new ZipError(`'${name}' is not a safe entry name`);
        if (this.names.has(name)) throw new ZipError(`'${name}' is added twice`);
        const chunks: readonly Uint8Array[] = data instanceof Uint8Array ? [data] : data;
        let size = 0;
        let crc = 0;
        for (const c of chunks) {
            size += c.length;
            crc = crc32(c, crc);
        }
        if (size > MAX_SIZE) throw new ZipError(`'${name}' is too large for a zip without ZIP64`);
        if (this.entries.length + 1 > MAX_ENTRIES) throw new ZipError('too many entries');
        const nameBytes = utf8Encode(name);
        const header = new Uint8Array(30 + nameBytes.length);
        const v = new DataView(header.buffer);
        v.setUint32(0, LOCAL_SIG, true);
        v.setUint16(4, 10, true);
        v.setUint16(6, UTF8_FLAG, true);
        v.setUint16(8, 0, true);
        v.setUint16(10, this.stamp.time, true);
        v.setUint16(12, this.stamp.day, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, size, true);
        v.setUint32(22, size, true);
        v.setUint16(26, nameBytes.length, true);
        v.setUint16(28, 0, true);
        header.set(nameBytes, 30);
        this.entries.push({ name: nameBytes, crc, size, offset: this.offset });
        this.names.add(name);
        this.parts.push(header, ...chunks);
        this.offset += header.length + size;
        if (this.offset > MAX_SIZE) throw new ZipError('the archive is too large for a zip without ZIP64');
    }

    /** The archive as parts: the entries, then the central directory. Call once, after the last add. */
    finish(): Uint8Array[] {
        const out = [...this.parts];
        let dirSize = 0;
        const dirOffset = this.offset;
        for (const e of this.entries) {
            const rec = new Uint8Array(46 + e.name.length);
            const v = new DataView(rec.buffer);
            v.setUint32(0, CENTRAL_SIG, true);
            v.setUint16(4, (3 << 8) | 20, true); // made by: Unix, 2.0
            v.setUint16(6, 10, true);
            v.setUint16(8, UTF8_FLAG, true);
            v.setUint16(10, 0, true);
            v.setUint16(12, this.stamp.time, true);
            v.setUint16(14, this.stamp.day, true);
            v.setUint32(16, e.crc, true);
            v.setUint32(20, e.size, true);
            v.setUint32(24, e.size, true);
            v.setUint16(28, e.name.length, true);
            v.setUint16(30, 0, true);
            v.setUint16(32, 0, true);
            v.setUint16(34, 0, true);
            v.setUint16(36, 0, true);
            v.setUint32(38, (0o100644 << 16) >>> 0, true);
            v.setUint32(42, e.offset, true);
            rec.set(e.name, 46);
            out.push(rec);
            dirSize += rec.length;
        }
        const end = new Uint8Array(22);
        const v = new DataView(end.buffer);
        v.setUint32(0, END_SIG, true);
        v.setUint16(8, this.entries.length, true);
        v.setUint16(10, this.entries.length, true);
        v.setUint32(12, dirSize, true);
        v.setUint32(16, dirOffset, true);
        out.push(end);
        return out;
    }

    /** The archive as one array of bytes. */
    bytes(): Uint8Array {
        return concat(this.finish());
    }
}

export interface ReadZipOptions {
    /** cap on the size of one decoded entry, bytes (default 512 MiB) */
    readonly maxEntryBytes?: number;
    /** cap on all entries together, bytes (default 1 GiB) */
    readonly maxTotalBytes?: number;
}

/**
 * Reads an archive into a map from entry name to its bytes (directories are skipped), after checking
 * the CRC-32 and sizes of every entry. Throws ZipError on any damage or anything unsupported.
 */
export function readZip(bytes: Uint8Array, options: ReadZipOptions = {}): Map<string, Uint8Array> {
    const maxEntry = options.maxEntryBytes ?? DEFAULT_INFLATE_LIMIT;
    const maxTotal = options.maxTotalBytes ?? 2 * DEFAULT_INFLATE_LIMIT;
    if (bytes.length < 22) throw new ZipError('too short to be a zip archive');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // the end-of-central-directory record: the last 22 bytes, or before a comment of up to 65535 bytes
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === END_SIG && at + 22 + view.getUint16(at + 20, true) === bytes.length) {
            end = at;
            break;
        }
    }
    if (end < 0) throw new ZipError('not a zip archive (no end-of-directory record)');
    const diskNo = view.getUint16(end + 4, true);
    const dirDisk = view.getUint16(end + 6, true);
    const onDisk = view.getUint16(end + 8, true);
    const total = view.getUint16(end + 10, true);
    const dirSize = view.getUint32(end + 12, true);
    const dirOffset = view.getUint32(end + 16, true);
    if (diskNo !== 0 || dirDisk !== 0 || onDisk !== total) throw new ZipError('archives in several parts are not supported');
    if (total === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported');
    if (dirOffset + dirSize > end) throw new ZipError('the central directory lies outside the archive');

    const out = new Map<string, Uint8Array>();
    let pos = dirOffset;
    let sum = 0;
    for (let i = 0; i < total; i++) {
        if (pos + 46 > dirOffset + dirSize || view.getUint32(pos, true) !== CENTRAL_SIG) throw new ZipError(`central directory entry ${i + 1} is damaged`);
        const flags = view.getUint16(pos + 8, true);
        const method = view.getUint16(pos + 10, true);
        const crc = view.getUint32(pos + 16, true);
        const csize = view.getUint32(pos + 20, true);
        const usize = view.getUint32(pos + 24, true);
        const nameLen = view.getUint16(pos + 28, true);
        const extraLen = view.getUint16(pos + 30, true);
        const commentLen = view.getUint16(pos + 32, true);
        const local = view.getUint32(pos + 42, true);
        if (pos + 46 + nameLen + extraLen + commentLen > dirOffset + dirSize) throw new ZipError(`central directory entry ${i + 1} is damaged`);
        const name = utf8Decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
        pos += 46 + nameLen + extraLen + commentLen;

        if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) throw new ZipError(`'${name}' needs ZIP64, which is not supported`);
        if ((flags & ENCRYPTED_FLAG) !== 0) throw new ZipError(`'${name}' is encrypted`);
        if (name.endsWith('/')) {
            if (usize !== 0) throw new ZipError(`directory '${name}' has data`);
            continue;
        }
        if (!isSafeEntryName(name)) throw new ZipError(`'${name}' is not a safe entry name`);
        if (out.has(name)) throw new ZipError(`'${name}' appears twice`);
        if (method !== 0 && method !== 8) throw new ZipError(`'${name}' uses compression method ${method}, which is not supported`);
        if (usize > maxEntry) throw new ZipError(`'${name}' is larger than the limit of ${maxEntry} bytes`);
        sum += usize;
        if (sum > maxTotal) throw new ZipError(`the entries together exceed the limit of ${maxTotal} bytes`);

        if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_SIG) throw new ZipError(`the local header of '${name}' is damaged`);
        const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (dataStart + csize > dirOffset) throw new ZipError(`the data of '${name}' lies outside the archive`);
        const raw = bytes.subarray(dataStart, dataStart + csize);
        let data: Uint8Array;
        if (method === 0) {
            if (csize !== usize) throw new ZipError(`'${name}' is stored with inconsistent sizes`);
            data = raw.slice();
        } else {
            try {
                const r = inflateRaw(raw, 0, usize);
                data = r.data;
            } catch (e) {
                if (e instanceof InflateError) throw new ZipError(`'${name}' cannot be decompressed: ${e.message}`);
                throw e;
            }
            if (data.length !== usize) throw new ZipError(`'${name}' decompresses to ${data.length} bytes, not ${usize}`);
        }
        if (crc32(data) !== crc) throw new ZipError(`'${name}' fails its CRC-32 check`);
        // a data descriptor after the data (flag bit 3) is not read: the central directory is the authority for sizes and CRC
        out.set(name, data);
    }
    return out;
}
