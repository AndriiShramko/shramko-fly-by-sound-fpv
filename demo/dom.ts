// Small DOM helpers for the demo page: find an element that must exist, make one with attributes and
// children. Plain HTML, no framework.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const e = document.getElementById(id);
    if (e === null) throw new Error(`the page has no element #${id}`);
    return e as T;
}

type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** `el('button', { type: 'button', id: 'x' }, 'Label')`: attributes, then text or elements. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (string | Node)[]): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) node.append(c);
    return node;
}

/** Replaces the children of `node`. */
export function fill(node: HTMLElement, ...children: (string | Node)[]): void {
    node.replaceChildren(...children);
}
