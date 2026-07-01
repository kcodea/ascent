/**
 * B3 — keyword / terminology pass. A player-facing rename applied to DISPLAYED text only: card rules text
 * and a few combat-log lines. Internal ids, keyword codes (T/DS/V/…), effect factory names, and the card
 * DATA are all unchanged — this just rewrites the words the player reads, so it's low-risk and reversible.
 *
 *   Battlecry → Shout · Deathrattle → Echo · Divine Shield → Ward · Windfury → Flurry · Venomous → Toxin
 *   Reborn → Rise · Magnetize → Attach · Magnetic → Attachment · Golden → Gilded
 *
 * Kept as-is (per the design): Taunt, Avenge, Choose One, Start of Combat, End of Turn, Rally, Cleave,
 * Consume, Discover.
 */
const TERMS: [RegExp, string][] = [
  // Plurals first (their own proper forms), then the singulars.
  [/\bBattlecries\b/g, 'Shouts'],
  [/\bDeathrattles\b/g, 'Echoes'],
  [/\bDivine Shields\b/g, 'Wards'],
  [/\bBattlecry\b/g, 'Shout'],
  [/\bDeathrattle\b/g, 'Echo'],
  [/\bDivine Shield\b/g, 'Ward'],
  [/\bWindfury\b/g, 'Flurry'],
  [/\bVenomous\b/g, 'Toxin'],
  [/\bReborn\b/g, 'Rise'],
  [/\bMagnetize\b/g, 'Attach'],
  [/\bMagnetic\b/g, 'Attachment'],
  [/\bGolden\b/g, 'Gilded'],
  [/\bgolden\b/g, 'gilded'],
];

/** Rewrite the player-facing keyword vocabulary in a displayed string. */
export function renameTerms(s: string): string {
  let out = s;
  for (const [re, to] of TERMS) out = out.replace(re, to);
  return out;
}
