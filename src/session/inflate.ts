// Raw DEFLATE decoding (RFC 1951) in plain TypeScript, after Mark Adler's puff: small, strict and
// the same in a browser and in Node. It exists because a session's flight log is written as one gzip
// member per chunk (so a closed tab loses little), and the browser's DecompressionStream cannot read
// several members in a row ("junk after the end of the data"). Here the end of each member is known
// exactly, so a file of members is read piece by piece, in every environment, with a size limit
// against compression bombs. Speed is of no concern: a flight is about a megabyte of text.

export class InflateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InflateError';
    }
}

export interface InflateResult {
    readonly data: Uint8Array;
    /** index of the first byte after the deflate stream (a gzip trailer starts there) */
    readonly end: number;
}

/** Default cap on the decoded size of one stream, bytes. */
export const DEFAULT_INFLATE_LIMIT = 512 * 1024 * 1024;

const MAX_BITS = 15;
const MAX_LCODES = 286;
const MAX_DCODES = 30;
const FIXED_LCODES = 288;

const LENGTH_BASE = Uint16Array.of(3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258);
const LENGTH_EXTRA = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0);
const DIST_BASE = Uint16Array.of(1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577);
const DIST_EXTRA = Uint8Array.of(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13);
const CODE_LENGTH_ORDER = Uint8Array.of(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15);

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
interface Huffman {
    readonly count: Uint16Array;
    readonly symbol: Uint16Array;
}

/**
 * Builds the decoding tables for `n` code lengths. Returns the table and `left`: 0 for a complete
 * code, above 0 for an incomplete one, below 0 when over-subscribed (a broken stream).
 */
function construct(lengths: Uint8Array, offset: number, n: number): { readonly h: Huffman; readonly left: number } {
    const count = new Uint16Array(MAX_BITS + 1);
    const symbol = new Uint16Array(n);
    for (let s = 0; s < n; s++) count[lengths[offset + s] as number] = (count[lengths[offset + s] as number] as number) + 1;
    if (count[0] === n) return { h: { count, symbol }, left: 0 };
    let left = 1;
    for (let len = 1; len <= MAX_BITS; len++) {
        left <<= 1;
        left -= count[len] as number;
        if (left < 0) return { h: { count, symbol }, left };
    }
    const offs = new Uint16Array(MAX_BITS + 2);
    for (let len = 1; len < MAX_BITS; len++) offs[len + 1] = (offs[len] as number) + (count[len] as number);
    for (let s = 0; s < n; s++) {
        const len = lengths[offset + s] as number;
        if (len !== 0) {
            symbol[offs[len] as number] = s;
            offs[len] = (offs[len] as number) + 1;
        }
    }
    return { h: { count, symbol }, left };
}

let fixedTables: { readonly lit: Huffman; readonly dist: Huffman } | null = null;

function fixed(): { readonly lit: Huffman; readonly dist: Huffman } {
    if (fixedTables === null) {
        const lengths = new Uint8Array(FIXED_LCODES);
        let s = 0;
        for (; s < 144; s++) lengths[s] = 8;
        for (; s < 256; s++) lengths[s] = 9;
        for (; s < 280; s++) lengths[s] = 7;
        for (; s < FIXED_LCODES; s++) lengths[s] = 8;
        const dist = new Uint8Array(MAX_DCODES).fill(5);
        fixedTables = { lit: construct(lengths, 0, FIXED_LCODES).h, dist: construct(dist, 0, MAX_DCODES).h };
    }
    return fixedTables;
}

/**
 * Decodes the raw deflate stream that starts at `start` in `input`. Throws InflateError for anything
 * that is not a well-formed stream, for running out of input, and for output beyond `limit` bytes.
 */
export function inflateRaw(input: Uint8Array, start = 0, limit = DEFAULT_INFLATE_LIMIT): InflateResult {
    let pos = start;
    let bitBuf = 0;
    let bitCnt = 0;
    let out = new Uint8Array(Math.min(Math.max(input.length * 4, 1024), 1 << 24));
    let outPos = 0;

    const bits = (need: number): number => {
        let val = bitBuf;
        while (bitCnt < need) {
            if (pos >= input.length) throw new InflateError('unexpected end of the compressed data');
            val |= (input[pos++] as number) << bitCnt;
            bitCnt += 8;
        }
        bitBuf = val >>> need;
        bitCnt -= need;
        return val & ((1 << need) - 1);
    };

    const ensure = (extra: number): void => {
        const need = outPos + extra;
        if (need > limit) throw new InflateError(`the decoded data exceeds the limit of ${limit} bytes`);
        if (need <= out.length) return;
        let size = out.length * 2;
        while (size < need) size *= 2;
        const bigger = new Uint8Array(Math.min(size, Math.max(limit, need)));
        bigger.set(out.subarray(0, outPos));
        out = bigger;
    };

    const decode = (h: Huffman): number => {
        let code = 0;
        let first = 0;
        let index = 0;
        for (let len = 1; len <= MAX_BITS; len++) {
            code |= bits(1);
            const count = h.count[len] as number;
            if (code - count < first) return h.symbol[index + (code - first)] as number;
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        throw new InflateError('invalid Huffman code');
    };

    const codes = (lit: Huffman, dist: Huffman): void => {
        for (;;) {
            let symbol = decode(lit);
            if (symbol < 256) {
                ensure(1);
                out[outPos++] = symbol;
            } else if (symbol === 256) {
                return;
            } else {
                symbol -= 257;
                if (symbol >= 29) throw new InflateError('invalid length symbol');
                const len = (LENGTH_BASE[symbol] as number) + bits(LENGTH_EXTRA[symbol] as number);
                const dsym = decode(dist);
                if (dsym >= MAX_DCODES) throw new InflateError('invalid distance symbol');
                const d = (DIST_BASE[dsym] as number) + bits(DIST_EXTRA[dsym] as number);
                if (d > outPos) throw new InflateError('distance reaches before the start of the data');
                ensure(len);
                for (let i = 0; i < len; i++) out[outPos + i] = out[outPos + i - d] as number;
                outPos += len;
            }
        }
    };

    const stored = (): void => {
        bitBuf = 0;
        bitCnt = 0;
        if (pos + 4 > input.length) throw new InflateError('unexpected end of the compressed data');
        const len = (input[pos] as number) | ((input[pos + 1] as number) << 8);
        const nlen = (input[pos + 2] as number) | ((input[pos + 3] as number) << 8);
        pos += 4;
        if (len !== (~nlen & 0xffff)) throw new InflateError('a stored block has inconsistent lengths');
        if (pos + len > input.length) throw new InflateError('unexpected end of the compressed data');
        ensure(len);
        out.set(input.subarray(pos, pos + len), outPos);
        outPos += len;
        pos += len;
    };

    const dynamic = (): void => {
        const nlen = bits(5) + 257;
        const ndist = bits(5) + 1;
        const ncode = bits(4) + 4;
        if (nlen > MAX_LCODES || ndist > MAX_DCODES) throw new InflateError('too many length or distance codes');
        const lengths = new Uint8Array(MAX_LCODES + MAX_DCODES);
        for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i] as number] = bits(3);
        const header = construct(lengths, 0, 19);
        if (header.left !== 0) throw new InflateError('the code length code is not complete');
        lengths.fill(0);
        let index = 0;
        while (index < nlen + ndist) {
            let symbol = decode(header.h);
            if (symbol < 16) {
                lengths[index++] = symbol;
            } else {
                let len = 0;
                if (symbol === 16) {
                    if (index === 0) throw new InflateError('a repeat has no previous length');
                    len = lengths[index - 1] as number;
                    symbol = 3 + bits(2);
                } else if (symbol === 17) symbol = 3 + bits(3);
                else symbol = 11 + bits(7);
                if (index + symbol > nlen + ndist) throw new InflateError('too many code lengths');
                while (symbol-- > 0) lengths[index++] = len;
            }
        }
        if (lengths[256] === 0) throw new InflateError('the block has no end code');
        const lit = construct(lengths, 0, nlen);
        if (lit.left < 0 || (lit.left > 0 && nlen !== (lit.h.count[0] as number) + (lit.h.count[1] as number))) throw new InflateError('the literal and length code is not valid');
        const dist = construct(lengths, nlen, ndist);
        if (dist.left < 0 || (dist.left > 0 && ndist !== (dist.h.count[0] as number) + (dist.h.count[1] as number))) throw new InflateError('the distance code is not valid');
        codes(lit.h, dist.h);
    };

    let last = 0;
    do {
        last = bits(1);
        const type = bits(2);
        if (type === 0) stored();
        else if (type === 1) {
            const f = fixed();
            codes(f.lit, f.dist);
        } else if (type === 2) dynamic();
        else throw new InflateError('invalid block type');
    } while (last === 0);
    return { data: out.slice(0, outPos), end: pos };
}
