// UTF-8 decoding in plain TypeScript (the core has no DOM library, so no TextDecoder): bytes in,
// a string out, every malformed sequence replaced by U+FFFD as TextDecoder does without `fatal`.
// Encoding is `utf8Encode` in ./sha256.

/** The string a UTF-8 byte sequence spells; malformed bytes become U+FFFD. A leading byte order mark is kept. */
export function utf8Decode(bytes: Uint8Array): string {
    const parts: string[] = [];
    let run: number[] = [];
    const flush = (): void => {
        if (run.length > 0) {
            parts.push(String.fromCharCode(...run));
            run = [];
        }
    };
    const push = (unit: number): void => {
        run.push(unit);
        if (run.length >= 8192) flush();
    };
    const cont = (i: number): boolean => i < bytes.length && ((bytes[i] as number) & 0xc0) === 0x80;
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i] as number;
        if (b < 0x80) {
            push(b);
            i += 1;
        } else if (b >= 0xc2 && b <= 0xdf && cont(i + 1)) {
            push(((b & 0x1f) << 6) | ((bytes[i + 1] as number) & 0x3f));
            i += 2;
        } else if (b >= 0xe0 && b <= 0xef && cont(i + 1) && cont(i + 2)) {
            const cp = ((b & 0x0f) << 12) | (((bytes[i + 1] as number) & 0x3f) << 6) | ((bytes[i + 2] as number) & 0x3f);
            if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) {
                push(0xfffd);
                i += 1;
            } else {
                push(cp);
                i += 3;
            }
        } else if (b >= 0xf0 && b <= 0xf4 && cont(i + 1) && cont(i + 2) && cont(i + 3)) {
            const cp = ((b & 0x07) << 18) | (((bytes[i + 1] as number) & 0x3f) << 12) | (((bytes[i + 2] as number) & 0x3f) << 6) | ((bytes[i + 3] as number) & 0x3f);
            if (cp < 0x10000 || cp > 0x10ffff) {
                push(0xfffd);
                i += 1;
            } else {
                const v = cp - 0x10000;
                push(0xd800 + (v >> 10));
                push(0xdc00 + (v & 0x3ff));
                i += 4;
            }
        } else {
            push(0xfffd);
            i += 1;
        }
    }
    flush();
    return parts.join('');
}
