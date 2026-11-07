// The themes that ship with the engine: plain JSON files in themes/, loaded through the same
// validator as any theme a sound engineer exports, so a broken shipped file fails loudly.
import type { ThemeDef } from '../contract';
import clear from '../../themes/clear.json';
import race from '../../themes/race.json';
import soft from '../../themes/soft.json';
import { formatIssues } from '../util/check';
import { validateTheme } from './validate';

export const BUILTIN_THEME_IDS = ['soft', 'clear', 'race'] as const;
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

/** The theme a pilot starts with. */
export const DEFAULT_THEME_ID: BuiltinThemeId = 'soft';

const SOURCES: Readonly<Record<BuiltinThemeId, unknown>> = { soft, clear, race };
const cache = new Map<BuiltinThemeId, ThemeDef>();

export function isBuiltinThemeId(id: string): id is BuiltinThemeId {
    return (BUILTIN_THEME_IDS as readonly string[]).includes(id);
}

/** A shipped theme, validated on first use. */
export function getBuiltinTheme(id: BuiltinThemeId): ThemeDef {
    let theme = cache.get(id);
    if (theme === undefined) {
        const result = validateTheme(SOURCES[id]);
        if (!result.ok) throw new Error(`shipped theme '${id}' is invalid: ${formatIssues(result.issues)}`);
        theme = result.value;
        cache.set(id, theme);
    }
    return theme;
}

/** The theme a pilot asked for: a shipped one, one of `custom`, or the default when the id is unknown. */
export function resolveTheme(id: string, custom: Readonly<Record<string, ThemeDef>> = {}): ThemeDef {
    const own = custom[id];
    if (own !== undefined) return own;
    return getBuiltinTheme(isBuiltinThemeId(id) ? id : DEFAULT_THEME_ID);
}
