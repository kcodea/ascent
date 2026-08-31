import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '@game/content';
import type { CardDef } from '@game/core';

/**
 * DOC BOT LANE `rubyReactorsSaySo` — a card that reacts to RUBIES must say "Ruby" on its face.
 *
 * ── The miss this encodes (player report 224af0ee, 2026-08-30) ────────────────────────────────────────────
 *
 * *"crest of the climb applied to reflector did not reflect to another friendly unit."*
 *
 * Reflector carries TWO effects — `spellCastOnThis` and `onRubyPlayed` — and they share ONE once-per-turn
 * allowance (both factories guard on `spells + rubies !== 1`). The captured state showed the reported
 * Reflector holding `spellsOnThisTurn: 1` and `rubiesOnThisTurn: 2`: two Rubies had already spent the
 * allowance, so the spell cast afterwards correctly did nothing.
 *
 * The ENGINE was right. The CARD was not: it read *"Spells cast on this also cast…"* and never mentioned
 * Rubies, so the player did exactly what it promised and watched nothing happen. Nothing on screen could
 * explain it.
 *
 * ── Why this is a rule and not a one-off ──────────────────────────────────────────────────────────────────
 *
 * **A Ruby is not a Shop Spell.** The engine states that outright (`playRubyOn`: "A Ruby is not a Shop Spell,
 * so a 'your Shop Spells cast again' grant must not multiply it"), and the two systems are deliberately
 * separate — separate counters, separate trigger events, separate factories. So the word "Spells" on a card
 * does NOT cover Rubies, and a card that quietly reacts to both is unreadable.
 *
 * The sweep that found it is the check: of the three cards reacting to `onRubyPlayed`, Ruby Broker and
 * Resonance Idol both name Rubies; Reflector was the only one that did not. One outlier is a bug, and this
 * lane is what stops the next one being written.
 */

/**
 * The BASE text, plus any Choose One branch text — the promise a player reads on the card face.
 *
 * `goldenText` is deliberately NOT accepted as satisfying the rule: it is the variant, shown only once a card
 * is Gilded, so a card whose only mention of Rubies lives there still reads as spell-only to everyone who has
 * not gilded it. (Found while sabotage-checking this lane: reverting only the base text left the golden one
 * mentioning Rubies, and a laxer rule passed the reverted card.)
 */
function textsOf(def: CardDef): string[] {
  const out: string[] = [];
  if (def.text) out.push(def.text);
  for (const b of def.chooseOne ?? []) if (b.text) out.push(b.text);
  return out;
}

const reactsToRubies = (def: CardDef): boolean =>
  def.effects.some((e) => e.on === 'onRubyPlayed')
  || (def.chooseOne ?? []).some((b) => (b.effects ?? []).some((e) => e.on === 'onRubyPlayed'));

describe('Doc Bot — a card that reacts to Rubies says so', () => {
  const reactors = ALL_CARDS.filter(reactsToRubies);

  it('finds the reactors (a floor, so the sweep cannot pass by matching nothing)', () => {
    expect(reactors.length, 'cards carrying an onRubyPlayed effect').toBeGreaterThan(0);
  });

  it('every one of them names Rubies in its printed text', () => {
    const silent = reactors
      .filter((d) => !textsOf(d).some((t) => /rub(y|ies)/i.test(t)))
      .map((d) => `${d.id} (${d.name}): ${d.text ?? '<no text>'}`);
    expect(
      silent,
      'these cards react to Rubies but never mention them. A Ruby is NOT a Shop Spell — "Spells" does not '
      + 'cover it — so a player cannot tell why the card did or did not fire. Name Rubies in the text, or '
      + 'remove the Ruby reaction',
    ).toEqual([]);
  });
});
