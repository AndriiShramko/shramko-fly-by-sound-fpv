// CRC-32 (IEEE 802.3, the polynomial of zip and gzip) in plain TypeScript: the same answer in a
// browser and in Node, incremental for data that arrives in parts.

const TABLE = ((): Uint32Array => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

/**
 * The CRC-32 of `data`, as an unsigned 32-bit number. To go on from earlier parts pass their CRC:
 * `crc32(b, crc32(a))` equals `crc32(a ++ b)`.
 */
export function crc32(data: Uint8Array, previous = 0): number {
    let c = ~previous >>> 0;
    for (let i = 0; i < data.length; i++) c = (TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
    return ~c >>> 0;
}
