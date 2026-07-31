import type { RuneDef, Tribe } from '@game/core';

/**
 * Rune ↔ board synergy tags (owner ask 2026-07-31: forge offers should follow what the player is building).
 *
 * Tags are DERIVED from a rune's printed text rather than hand-authored on the 119 defs — the text is the
 * rune's contract with the player, so whatever it names is what it synergizes with, and a rework that changes
 * the text re-tags the rune automatically instead of leaving a stale annotation behind. A def can still
 * override with an explicit `synergy` list if a rune's text ever under-describes it.
 *
 * The vocabulary is tribes + the game's named mechanics. Deliberately coarse: a tag exists so the forge can
 * answer "does this rune follow anything on the player's board?" — not to rank runes against each other.
 */
export type SynergyTag =
  | Tribe
  | 'rally' | 'echo' | 'shout' | 'avenge' | 'consume' | 'ruby' | 'ale' | 'spells' | 'gold' | 'summon';

/** Text-pattern → tag. Word-bounded and case-insensitive; Imps count as the Demon tribe's mechanic home. */
const TEXT_TAGS: ReadonlyArray<readonly [RegExp, SynergyTag]> = [
  [/\bbeasts?\b/i, 'beast'],
  [/\bdragons?\b/i, 'dragon'],
  [/\bdemons?\b/i, 'demon'],
  [/\bimps?\b/i, 'demon'],
  [/\bkobolds?\b/i, 'kobold'],
  [/\bdwar(?:f|ves|ven)\b/i, 'dwarf'],
  [/\bundead\b/i, 'undead'],
  [/\bmechs?\b/i, 'mech'],
  [/\brall(?:y|ies)\b/i, 'rally'],
  [/\bechoe?s?\b/i, 'echo'],
  [/\bshouts?\b/i, 'shout'],
  [/\bavenge\b/i, 'avenge'],
  [/\bconsumes?\b/i, 'consume'],
  [/\brub(?:y|ies)\b/i, 'ruby'],
  [/\bales?\b/i, 'ale'],
  [/\bspells?\b/i, 'spells'],
  [/\bgold\b/i, 'gold'],
  [/\bsummon(?:s|ed)?\b/i, 'summon'],
];

const cache = new Map<string, readonly SynergyTag[]>();

/** The tags a rune synergizes with — derived from its text (memoized), or the def's explicit override. */
export function runeSynergies(rune: RuneDef & { synergy?: readonly SynergyTag[] }): readonly SynergyTag[] {
  if (rune.synergy) return rune.synergy;
  const hit = cache.get(rune.id);
  if (hit) return hit;
  const tags: SynergyTag[] = [];
  for (const [re, tag] of TEXT_TAGS) if (re.test(rune.text) && !tags.includes(tag)) tags.push(tag);
  cache.set(rune.id, tags);
  return tags;
}
