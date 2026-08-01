import { describe, it, expect } from 'vitest';
import { RUNE_INDEX } from './runes';
import { CARD_INDEX } from './index';
import type { QuestReward, RuneDef } from '@game/core';

/**
 * OWNER RULE 2026-08-01: any rune whose text references a card shows that card on hover in the Runeforge.
 *
 * The hover set = the reward's own grants (incl. `grantGolden`, shown gilded) + the def's `previewCards`
 * (text-referenced cards the reward doesn't grant — Rune of Banking names Money Bot, Living Echoes names
 * Sunmane Herald). This test cross-checks EVERY rune's text against the card index, so a future rune that
 * names a card without wiring its preview fails here instead of shipping a hover-less reference.
 */

/** Mirrors RuneCard's preview-id derivation (reward grants + previewCards). */
function previewIds(rune: RuneDef): string[] {
  const fromReward = (r: QuestReward): string[] => {
    switch (r.kind) {
      case 'grant': return [...(r.cards ?? []), ...(('grantGolden' in r ? r.grantGolden : undefined) ?? [])];
      case 'recurringGrant': return r.cards;
      case 'multi': return r.rewards.flatMap(fromReward);
      default: return [];
    }
  };
  return [...fromReward(rune.reward), ...(rune.previewCards ?? [])];
}

/** Card names that double as MECHANIC words in rune text — a text hit on these is the keyword, not the card. */
const KEYWORD_NAMED_CARDS = new Set(['consume', 'growth', 'mend', 'quicksale']);

/** Whole-word, plural-tolerant name match ("Imps", "Gold Pouches") that does NOT hit substrings ("Improves"). */
const nameHits = (text: string, name: string): boolean =>
  new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`).test(text);

describe('every card a rune names is in its hover preview', () => {
  const names = Object.values(CARD_INDEX)
    .filter((c) => !KEYWORD_NAMED_CARDS.has(c.id) && c.name.length >= 3)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => b.name.length - a.name.length);

  it('audits the full rune roster against the card index', () => {
    const failures: string[] = [];
    for (const rune of Object.values(RUNE_INDEX)) {
      const text = rune.text.replace(/\*\*/g, '');
      const shown = previewIds(rune);
      const shownNames = shown.map((id) => CARD_INDEX[id]?.name ?? '');
      for (const n of names) {
        if (!nameHits(text, n.name)) continue;
        // A longer already-matched name that CONTAINS this one covers it (Ruby Broker covers Ruby).
        const covered = shown.includes(n.id) ||
          shownNames.some((sn) => sn.includes(n.name)) ||
          names.some((other) => other.name.length > n.name.length && other.name.includes(n.name) && nameHits(text, other.name) && shown.includes(other.id));
        if (!covered) failures.push(`${rune.id}: text names "${n.name}" (${n.id}) but the hover doesn't show it — add it to previewCards`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every previewCards id resolves to a real card', () => {
    for (const rune of Object.values(RUNE_INDEX)) {
      for (const id of rune.previewCards ?? []) {
        expect(CARD_INDEX[id], `${rune.id}: previewCards id "${id}" is not in the card index`).toBeDefined();
      }
    }
  });
});
