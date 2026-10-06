import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { liveCardText, type LiveTextParams } from './instView';

// R-TEXT-TARGETTRIBE-01 (owner report 2026-10-06, Baby Gastrid): a card that can only target one tribe (`targetTribe`)
// names that tribe in its printed text, and its LIVE text must keep naming it however the live numbers move. Gastrid's
// live helper rewrote "a friendly **Dwarf**" to "a friendly minion" the moment any Gold was spent.

const base: LiveTextParams = {
  tier: 4, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

/** Busy states that switch on the common live-text helpers (Gold spent, spells cast, cards played, spell power). */
const busy: Partial<LiveTextParams>[] = [
  {},
  { goldSpent: 9 },
  { spellsThisTurn: 3, spellsCast: 5, anySpellsThisTurn: 3 },
  { playedThisTurn: ['dw_dorrin', 'dw_foreman', 'dw_dorrin'] },
  { spellBonus: 2, spellBonusH: 2 },
];

/** "Dwarf" also has to match "Dwarves": compare on the tribe's first four letters. */
const stemOf = (tribe: string): RegExp => new RegExp(tribe.slice(0, 4), 'i');

const tribeTargeted = Object.values(CARD_INDEX).filter((d) => {
  const t = (d as { targetTribe?: string }).targetTribe;
  return !!t && stemOf(t).test(d.text ?? '');
});

describe('a tribe-targeted card keeps naming its tribe in its live text', () => {
  it('covers the known tribe-targeted cards (Baby Gastrid among them)', () => {
    expect(tribeTargeted.map((d) => d.id)).toContain('dw_dorrin');
  });

  for (const def of tribeTargeted) {
    const tribe = (def as { targetTribe?: string }).targetTribe!;
    it(`${def.name} (${def.id}) names ${tribe} in every live state`, () => {
      for (const extra of busy) {
        for (const golden of [false, true]) {
          const r = liveCardText(def.id, { ...base, ...extra, golden });
          const shown = golden ? (r.goldenText ?? r.text) : r.text;
          expect(shown, JSON.stringify({ extra, golden })).toMatch(stemOf(tribe));
        }
      }
    });
  }

  it('Baby Gastrid prints the live total for a friendly Dwarf', () => {
    expect(liveCardText('dw_dorrin', { ...base, goldSpent: 9 }).text)
      .toBe('**Shout:** give a friendly **Dwarf** **{{+18 Health}}** (+2 per Gold spent this turn).');
  });
});
