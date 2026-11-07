// A small message formatter for the strings in locales/*.json. It speaks one subset of ICU:
//
//   plain text                        Fly forward.
//   {name}                            a parameter, inserted as it is (numbers without grouping)
//   {n, plural, one {# second} other {# seconds}}
//                                     branches by the language's plural category; '#' is the number;
//                                     '=0 {none}' matches exactly; 'other' is required
//
// There is no escaping: braces are always syntax, so a text never contains a literal brace. '#'
// outside a plural branch is plain text. Pure and DOM-free: only Intl, which every browser and
// Node ship. The same parser serves the parity test (same arguments in every language).
import type { Locale } from '../contract';

export type MessagePart =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'arg'; readonly name: string }
    /** the number of the enclosing plural, as '#' */
    | { readonly kind: 'number' }
    | { readonly kind: 'plural'; readonly name: string; readonly branches: Readonly<Record<string, readonly MessagePart[]>> };

export class MessageSyntaxError extends Error {
    readonly position: number;
    constructor(message: string, position: number) {
        super(`${message} (at ${position})`);
        this.name = 'MessageSyntaxError';
        this.position = position;
    }
}

export class MessageParamError extends Error {
    readonly param: string;
    constructor(message: string, param: string) {
        super(message);
        this.name = 'MessageParamError';
        this.param = param;
    }
}

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

class Parser {
    private i = 0;
    constructor(private readonly s: string) {}

    parse(): MessagePart[] {
        const parts = this.parts(false);
        if (this.i < this.s.length) throw new MessageSyntaxError("unexpected '}'", this.i);
        return parts;
    }

    private parts(inBranch: boolean): MessagePart[] {
        const out: MessagePart[] = [];
        let text = '';
        const flush = (): void => {
            if (text !== '') {
                out.push({ kind: 'text', text });
                text = '';
            }
        };
        while (this.i < this.s.length) {
            const c = this.s[this.i] as string;
            if (c === '}') break;
            if (c === '{') {
                flush();
                out.push(this.placeholder());
            } else if (c === '#' && inBranch) {
                flush();
                out.push({ kind: 'number' });
                this.i++;
            } else {
                text += c;
                this.i++;
            }
        }
        flush();
        return out;
    }

    private skip(): void {
        while (this.i < this.s.length && /\s/.test(this.s[this.i] as string)) this.i++;
    }

    private name(what: string): string {
        NAME.lastIndex = this.i;
        const m = NAME.exec(this.s);
        if (m === null) throw new MessageSyntaxError(`expected ${what}`, this.i);
        this.i += m[0].length;
        return m[0];
    }

    private expect(ch: string): void {
        if (this.s[this.i] !== ch) throw new MessageSyntaxError(`expected '${ch}'`, this.i);
        this.i++;
    }

    private placeholder(): MessagePart {
        const open = this.i;
        this.expect('{');
        this.skip();
        const name = this.name('a parameter name');
        this.skip();
        if (this.s[this.i] === '}') {
            this.i++;
            return { kind: 'arg', name };
        }
        this.expect(',');
        this.skip();
        const type = this.name("'plural'");
        if (type !== 'plural') throw new MessageSyntaxError(`unknown argument type '${type}'`, this.i);
        this.skip();
        this.expect(',');
        const branches: Record<string, readonly MessagePart[]> = {};
        for (;;) {
            this.skip();
            if (this.i >= this.s.length) throw new MessageSyntaxError(`'{' at ${open} is never closed`, this.i);
            if (this.s[this.i] === '}') {
                this.i++;
                break;
            }
            let selector: string;
            if (this.s[this.i] === '=') {
                const m = /=\d+/y;
                m.lastIndex = this.i;
                const hit = m.exec(this.s);
                if (hit === null) throw new MessageSyntaxError("expected digits after '='", this.i);
                selector = hit[0];
                this.i += selector.length;
            } else {
                selector = this.name('a plural category');
                if (!(PLURAL_CATEGORIES as readonly string[]).includes(selector)) {
                    throw new MessageSyntaxError(`unknown plural category '${selector}'`, this.i);
                }
            }
            if (selector in branches) throw new MessageSyntaxError(`plural branch '${selector}' appears twice`, this.i);
            this.skip();
            this.expect('{');
            branches[selector] = this.parts(true);
            this.expect('}');
        }
        if (!('other' in branches)) throw new MessageSyntaxError(`plural '${name}' has no 'other' branch`, this.i);
        return { kind: 'plural', name, branches };
    }
}

/** Parses a template; throws MessageSyntaxError with the position of the problem. */
export function parseMessage(template: string): MessagePart[] {
    return new Parser(template).parse();
}

export interface ArgumentInfo {
    readonly name: string;
    /** the argument is used as a plural selector somewhere */
    readonly plural: boolean;
}

/** The arguments a template needs, sorted by name (nested uses included). */
export function messageArguments(template: string): ArgumentInfo[] {
    const found = new Map<string, boolean>();
    const walk = (parts: readonly MessagePart[]): void => {
        for (const p of parts) {
            if (p.kind === 'arg') found.set(p.name, found.get(p.name) ?? false);
            else if (p.kind === 'plural') {
                found.set(p.name, true);
                for (const b of Object.values(p.branches)) walk(b);
            }
        }
    };
    walk(parseMessage(template));
    return [...found.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name, plural]) => ({ name, plural }));
}

/** The text of a template with its syntax removed: every text part of every branch, for lints. */
export function messageTexts(template: string): string[] {
    const out: string[] = [];
    const walk = (parts: readonly MessagePart[]): void => {
        for (const p of parts) {
            if (p.kind === 'text') out.push(p.text);
            else if (p.kind === 'plural') for (const b of Object.values(p.branches)) walk(b);
        }
    };
    walk(parseMessage(template));
    return out;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function numberFormat(locale: Locale): Intl.NumberFormat {
    let f = numberFormats.get(locale);
    if (f === undefined) {
        f = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 1 });
        numberFormats.set(locale, f);
    }
    return f;
}

function rules(locale: Locale): Intl.PluralRules {
    let r = pluralRules.get(locale);
    if (r === undefined) {
        r = new Intl.PluralRules(locale);
        pluralRules.set(locale, r);
    }
    return r;
}

/** The plural category CLDR gives `n` in `locale`: zero, one, two, few, many or other. */
export function pluralCategory(locale: Locale, n: number): string {
    return rules(locale).select(n);
}

/** The categories `locale` distinguishes, from CLDR (for tests). */
export function pluralCategoriesOf(locale: Locale): string[] {
    return rules(locale).resolvedOptions().pluralCategories.slice().sort();
}

export type MessageParams = Readonly<Record<string, string | number>>;

function render(locale: Locale, parts: readonly MessagePart[], params: MessageParams, current: number | null): string {
    let out = '';
    for (const p of parts) {
        if (p.kind === 'text') out += p.text;
        else if (p.kind === 'number') out += numberFormat(locale).format(current ?? 0);
        else if (p.kind === 'arg') {
            const v = params[p.name];
            if (v === undefined) throw new MessageParamError(`missing parameter '${p.name}'`, p.name);
            out += typeof v === 'number' ? numberFormat(locale).format(v) : v;
        } else {
            const v = params[p.name];
            if (typeof v !== 'number' || !Number.isFinite(v)) throw new MessageParamError(`parameter '${p.name}' must be a finite number`, p.name);
            const branch = p.branches[`=${v}`] ?? p.branches[pluralCategory(locale, v)] ?? p.branches['other'];
            out += render(locale, branch as readonly MessagePart[], params, v);
        }
    }
    return out;
}

/** Formats a template for a language. Throws MessageSyntaxError or MessageParamError; the Translator catches them. */
export function formatMessage(locale: Locale, template: string, params: MessageParams = {}): string {
    return render(locale, parseMessage(template), params, null);
}
