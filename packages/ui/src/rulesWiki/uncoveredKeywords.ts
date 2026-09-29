/**
 * Glossary keywords (`KEYWORD_GLOSSARY` ids) that no wiki answer covers YET. This list may only SHRINK:
 * `rulesWiki.test.ts` fails when a keyword is neither covered nor listed (a new keyword shipped undocumented),
 * and when a listed keyword is now covered (delete it from here). Target: empty.
 */
export const UNCOVERED_KEYWORDS: readonly string[] = [];
