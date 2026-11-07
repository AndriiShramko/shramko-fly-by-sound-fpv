// The four dictionaries, imported once. Each file is flat: a key of SpeechLine to a template
// (see format.ts). Kept apart from the rest of the i18n code so that a host that loads its
// language another way can use the translator without these imports.
import en from '../../locales/en.json';
import es from '../../locales/es.json';
import pl from '../../locales/pl.json';
import ru from '../../locales/ru.json';
import type { Dicts } from './translator';

export const DICTS: Dicts = { en, es, pl, ru };
