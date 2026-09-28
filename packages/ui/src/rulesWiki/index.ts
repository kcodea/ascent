import type { WikiEntry } from './types';
import { ENTRIES as basics } from './basics';
import { ENTRIES as shop } from './shop';
import { ENTRIES as combat } from './combat';
import { ENTRIES as keywords } from './keywords';
import { ENTRIES as lobby } from './lobby';
import { ENTRIES as questsRunes } from './questsRunes';
import { ENTRIES as controls } from './controls';
import { ENTRIES as glossary } from './glossary';

export * from './types';
export { searchWiki } from './search';

/** Every wiki entry, grouped by topic in chip order. Add an entry to its topic's file, never here. */
export const WIKI_ENTRIES: readonly WikiEntry[] = [...basics, ...shop, ...combat, ...keywords, ...lobby, ...questsRunes, ...controls, ...glossary];
export const WIKI_BY_ID: Readonly<Record<string, WikiEntry>> = Object.fromEntries(WIKI_ENTRIES.map((e) => [e.id, e]));
