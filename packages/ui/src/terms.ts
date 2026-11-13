/**
 * B3 — keyword / terminology pass. A player-facing rename applied to DISPLAYED text only: card rules text
 * and a few combat-log lines. Internal ids, keyword codes (T/DS/V/…), effect factory names, and the card
 * DATA are all unchanged — this just rewrites the words the player reads, so it's low-risk and reversible.
 *
 *   Battlecry → Shout · Deathrattle → Echo · Divine Shield → Ward · Windfury → Flurry · Venomous → Execute
 *   Reborn → Rise · Magnetize → Attach · Magnetic → Attachment · Golden → Gilded
 *
 * Kept as-is (per the design): Taunt, Avenge, Choose One, Start of Combat, End of Turn, Rally, Cleave,
 * Consume, Discover.
 *
 * PROPER NAMES ARE NEVER RENAMED. The rename is for the mechanic WORD, not for a card / rune / quest /
 * Equipment whose NAME happens to contain it: "replace a minion in your Shop with a **Golden Monkey**" names
 * the `n3_goldenmonkey` token, which is called Golden Monkey everywhere else — rewriting it to "Gilded Monkey"
 * named a card that does not exist (owner report 2026-11-13). Every content name the TERMS below would alter
 * is masked first, so the mechanic word still renames everywhere else in the same sentence. The list is
 * DERIVED from the content indices, so a new "Golden X" (or "Reborn X") card is protected with no edit here.
 */
import { ARCHIVED_CARDS, ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, EQUIPMENT, QUEST_DEFS, RUNES } from '@game/content';

const TERMS: [RegExp, string][] = [
  // Plurals first (their own proper forms), then the singulars.
  [/\bBattlecries\b/g, 'Shouts'],
  [/\bDeathrattles\b/g, 'Echoes'],
  [/\bDivine Shields\b/g, 'Wards'],
  [/\bBattlecry\b/g, 'Shout'],
  [/\bDeathrattle\b/g, 'Echo'],
  [/\bDivine Shield\b/g, 'Ward'],
  [/\bWindfury\b/g, 'Flurry'],
  [/\bVenomous\b/g, 'Execute'],
  [/\bReborn\b/g, 'Rise'],
  // Magnetic/Magnetize needs its PLURAL, LOWERCASE and PAST-TENSE forms too. Only the two capitalised
  // singulars were handled, so "your Magnetics magnetize twice" rendered untranslated on Attachment
  // Conductor, and "magnetized" / "magnetize" leaked on Cling Drone, Combinator and Banksly. Longer forms
  // first so `Magnetize` can't shadow `Magnetized`.
  [/\bMagnetized\b/g, 'Attached'],
  [/\bmagnetized\b/g, 'attached'],
  [/\bMagnetizes\b/g, 'Attaches'],
  [/\bmagnetizes\b/g, 'attaches'],
  [/\bMagnetize\b/g, 'Attach'],
  [/\bmagnetize\b/g, 'attach'],
  [/\bMagnetics\b/g, 'Attachments'],
  [/\bmagnetics\b/g, 'attachments'],
  [/\bMagnetic\b/g, 'Attachment'],
  [/\bmagnetic\b/g, 'attachment'],
  [/\bGolden\b/g, 'Gilded'],
  [/\bgolden\b/g, 'gilded'],
];

function applyTerms(s: string): string {
  let out = s;
  for (const [re, to] of TERMS) out = out.replace(re, to);
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every content name the vocabulary pass would otherwise rewrite (Golden Monkey, Golden Ruby, Golden Touch,
 *  The Golden Ledger, …), longest first so "The Golden Ledger" wins over a shorter overlapping name. */
export const PROTECTED_NAMES: readonly string[] = [...new Set(
  [...Object.values(CARD_INDEX), ...ARCHIVED_CARDS, ...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES, ...QUEST_DEFS, ...EQUIPMENT]
    .map((d) => d.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0 && applyTerms(n) !== n),
)].sort((a, b) => b.length - a.length);

// A name followed by a plural "s" ("2 Golden Monkeys") is still that name. Private-use sentinels hold the slot.
const PROTECTED_RE: RegExp | null = PROTECTED_NAMES.length
  ? new RegExp(`\\b(?:${PROTECTED_NAMES.map(escapeRe).join('|')})(?=s?\\b)`, 'g')
  : null;
const SLOT_RE = /\uE000(\d+)\uE001/g;

/** Rewrite the player-facing keyword vocabulary in a displayed string. Proper content names are left as named. */
export function renameTerms(s: string): string {
  if (!PROTECTED_RE) return applyTerms(s);
  const held: string[] = [];
  const masked = s.replace(PROTECTED_RE, (m) => `\uE000${held.push(m) - 1}\uE001`);
  const out = applyTerms(masked);
  return held.length ? out.replace(SLOT_RE, (_, i: string) => held[Number(i)]) : out;
}
