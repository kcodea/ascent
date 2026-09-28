/**
 * Glossary keywords (`KEYWORD_GLOSSARY` ids) that no wiki answer covers YET. This list may only SHRINK:
 * `rulesWiki.test.ts` fails when a keyword is neither covered nor listed (a new keyword shipped undocumented),
 * and when a listed keyword is now covered (delete it from here). Target: empty.
 */
export const UNCOVERED_KEYWORDS: readonly string[] = [
  'shout', 'echo', 'startofcombat', 'startofturn', 'endofturn', 'avenge', 'pummel', 'rally', 'slaughter', 'overflow',
  'sell', 'bleed', 'chooseone', 'watcher', 'taunt', 'ward', 'resilientward', 'execute', 'flurry', 'crit', 'rise',
  'rebirth', 'cleave', 'immune', 'stealth', 'engraved', 'permanent', 'attachment', 'consume', 'fodder', 'discover',
  'spend', 'improve', 'aura', 'summonfromhand', 'equip', 'equipment', 'amplified', 'gilded', 'shopspell', 'ruby',
  'ale', 'gift', 'clue', 'starform', 'collapse',
];
