/**
 * DOC BOT LANE `textNumbers` — every magnitude an effect's params carry appears in the card's printed text.
 *
 * The blueprint's §20A `QUANTITY`/`STALE_TEXT` classes, in deterministic form: no LLM, no prose model — just
 * "the number the engine will use must be visible on the card". History: the Kringle text survived two
 * rebalances wrong; #802 "Kennelmaster prints its real +2"; #7a31 "gilded Bellringer says adjacent again";
 * the owner's standing hard rule that card text always shows current values (CLAUDE.md, 2026-07-02).
 *
 * Two sanctioned escapes, both discovered by running the scan and reading its 8 misses (292 params checked):
 *   · WORD NUMERALS — "summon two 1/1 Pups" is a printed 2. The parser reads one–twelve.
 *   · NAMED-SPELL CASTS — a minion that casts a named spell may name the spell and let its hover-preview
 *     carry the value (owner ruling 2026-07-15). Factory ids containing 'Cast'/'cast' are that family.
 *
 * Zero misses as of 2026-08-26. A new card whose param says 4 while its text says 3 fails here at authoring
 * time, with both numbers in the message.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';

const PARAM_KEYS = ['attack', 'health', 'count', 'amount', 'per', 'every', 'step', 'threshold', 'times'] as const;

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Every number the text prints — digits plus spelled-out numerals. */
function printedNumbers(text: string): Set<number> {
  const plain = text.replace(/\*\*/g, ' ').toLowerCase();
  const nums = new Set((plain.match(/\d+/g) ?? []).map(Number));
  for (const [w, n] of Object.entries(WORDS)) if (new RegExp(`\\b${w}\\b`).test(plain)) nums.add(n);
  return nums;
}

/** The named-spell-cast family: the spell's hover-preview carries the value (owner ruling 2026-07-15). */
const isNamedCast = (factory: string): boolean => /Cast|^cast/.test(factory);

describe('Doc Bot — printed numbers match effect params', () => {
  it('every effect magnitude >1 appears in the card text (word numerals count; named casts exempt)', () => {
    const misses: string[] = [];
    let checked = 0;
    for (const c of Object.values(CARD_INDEX)) {
      if (!c?.text) continue;
      const nums = printedNumbers(c.text);
      for (const e of c.effects) {
        if (isNamedCast(e.do)) continue;
        for (const k of PARAM_KEYS) {
          const v = e.params?.[k];
          if (typeof v !== 'number' || v <= 1) continue; // 1 is written "a"/"an" more often than "1"
          checked++;
          if (!nums.has(v)) misses.push(`${c.id}: ${e.do}.${k}=${v} but the text never prints ${v} — "${c.text}"`);
        }
      }
    }
    expect(checked, 'the scan surface collapsed — the instrument must fail loudly, not pass over nothing').toBeGreaterThanOrEqual(250);
    expect(misses, `Text/param disagreement(s) — the engine will use a number the card never shows (the Kringle/QUANTITY class):\n  ${misses.join('\n  ')}`).toEqual([]);
  });

  it('GOLDEN text prints the doubled halves where plain prints the base (spot rule: attack/health params)', () => {
    // Narrow, high-precision golden lane: when a card has goldenText AND a single onPlay/onDeath effect with
    // attack+health params, the golden text must contain 2× those values (the gild doubles magnitudes).
    const misses: string[] = [];
    let checked = 0;
    for (const c of Object.values(CARD_INDEX)) {
      if (!c?.text || !c.goldenText) continue;
      const eff = c.effects.filter((e) => (e.on === 'onPlay' || e.on === 'onDeath') && !isNamedCast(e.do)
        && typeof e.params?.attack === 'number' && (e.params.attack as number) > 0
        && typeof e.params?.health === 'number' && (e.params.health as number) > 0);
      if (eff.length !== 1) continue; // multi-effect texts compose too freely for this narrow rule
      const a = eff[0]!.params!.attack as number;
      const h = eff[0]!.params!.health as number;
      const plain = printedNumbers(c.text);
      if (!plain.has(a) || !plain.has(h)) continue; // plain text doesn't print them either — the check above owns that
      checked++;
      const golden = printedNumbers(c.goldenText);
      if (!golden.has(a * 2) || !golden.has(h * 2)) {
        misses.push(`${c.id}: plain prints +${a}/+${h}, golden text lacks +${a * 2}/+${h * 2} — "${c.goldenText}"`);
      }
    }
    expect(checked, 'golden-lane surface collapsed').toBeGreaterThanOrEqual(15); // 18 single-effect dual-stat cards as of 2026-08-26
    expect(misses, `Golden text/param disagreement(s) (the GILDED class):\n  ${misses.join('\n  ')}`).toEqual([]);
  });
});
