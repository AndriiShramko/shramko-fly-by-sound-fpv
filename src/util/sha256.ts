// SHA-256 in plain TypeScript (FIPS 180-4): no dependency, the same answer in a browser and in
// Node. Incremental (`Sha256`) for large files, with one-call helpers for text and bytes. Not for
// secrets: it is used for digests of data (worlds, session files), where an agreed hash matters.

const K = Uint32Array.of(
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
);

const INITIAL = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);

const ror = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** UTF-8 bytes of a string (lone surrogates become U+FFFD, as TextEncoder does). */
export function utf8Encode(text: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
        let c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
            const d = text.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) {
                c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
                i++;
            }
        }
        if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
}

export function bytesToHex(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += (b < 16 ? '0' : '') + b.toString(16);
    return s;
}

export class Sha256 {
    private readonly h = Uint32Array.from(INITIAL);
    private readonly w = new Uint32Array(64);
    private readonly buf = new Uint8Array(64);
    private used = 0;
    private total = 0;
    private done = false;

    update(data: Uint8Array): this {
        if (this.done) throw new Error('Sha256: update after digest');
        this.total += data.length;
        let i = 0;
        if (this.used > 0) {
            const take = Math.min(64 - this.used, data.length);
            this.buf.set(data.subarray(0, take), this.used);
            this.used += take;
            i = take;
            if (this.used === 64) {
                this.block(this.buf, 0);
                this.used = 0;
            }
        }
        for (; i + 64 <= data.length; i += 64) this.block(data, i);
        if (i < data.length) {
            this.buf.set(data.subarray(i), 0);
            this.used = data.length - i;
        }
        return this;
    }

    /** The 32-byte digest. The hasher cannot be used again. */
    digest(): Uint8Array {
        if (this.done) throw new Error('Sha256: digest twice');
        this.done = true;
        const bitsHigh = Math.floor(this.total / 0x20000000);
        const bitsLow = ((this.total % 0x20000000) * 8) >>> 0;
        this.buf[this.used++] = 0x80;
        if (this.used > 56) {
            this.buf.fill(0, this.used, 64);
            this.block(this.buf, 0);
            this.used = 0;
        }
        this.buf.fill(0, this.used, 56);
        const view = this.buf;
        view[56] = bitsHigh >>> 24;
        view[57] = (bitsHigh >>> 16) & 255;
        view[58] = (bitsHigh >>> 8) & 255;
        view[59] = bitsHigh & 255;
        view[60] = bitsLow >>> 24;
        view[61] = (bitsLow >>> 16) & 255;
        view[62] = (bitsLow >>> 8) & 255;
        view[63] = bitsLow & 255;
        this.block(this.buf, 0);
        const out = new Uint8Array(32);
        for (let i = 0; i < 8; i++) {
            const v = this.h[i] as number;
            out[i * 4] = v >>> 24;
            out[i * 4 + 1] = (v >>> 16) & 255;
            out[i * 4 + 2] = (v >>> 8) & 255;
            out[i * 4 + 3] = v & 255;
        }
        return out;
    }

    private block(p: Uint8Array, off: number): void {
        const w = this.w;
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4;
            w[i] = ((p[j] as number) << 24) | ((p[j + 1] as number) << 16) | ((p[j + 2] as number) << 8) | (p[j + 3] as number);
        }
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15] as number;
            const b = w[i - 2] as number;
            const s0 = ror(a, 7) ^ ror(a, 18) ^ (a >>> 3);
            const s1 = ror(b, 17) ^ ror(b, 19) ^ (b >>> 10);
            w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
        }
        const h = this.h;
        let a = h[0] as number;
        let b = h[1] as number;
        let c = h[2] as number;
        let d = h[3] as number;
        let e = h[4] as number;
        let f = h[5] as number;
        let g = h[6] as number;
        let hh = h[7] as number;
        for (let i = 0; i < 64; i++) {
            const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
            const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        h[0] = ((h[0] as number) + a) | 0;
        h[1] = ((h[1] as number) + b) | 0;
        h[2] = ((h[2] as number) + c) | 0;
        h[3] = ((h[3] as number) + d) | 0;
        h[4] = ((h[4] as number) + e) | 0;
        h[5] = ((h[5] as number) + f) | 0;
        h[6] = ((h[6] as number) + g) | 0;
        h[7] = ((h[7] as number) + hh) | 0;
    }
}

/** SHA-256 of bytes or of a string's UTF-8 bytes, as 32 bytes. */
export function sha256(data: Uint8Array | string): Uint8Array {
    return new Sha256().update(typeof data === 'string' ? utf8Encode(data) : data).digest();
}

/** SHA-256 as 64 lower-case hex characters. */
export function sha256Hex(data: Uint8Array | string): string {
    return bytesToHex(sha256(data));
}
