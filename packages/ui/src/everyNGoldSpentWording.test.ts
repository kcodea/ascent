import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { liveCardText, type LiveTextParams } from './instView';
import { stepProgress } from './cardText';
import { KEYWORD_GLOSSARY } from './keywordGlossary';

/**
 * OWNER RULING 2026-11-17: "yes unify the text as every N gold spent." Every repeating Gold-spend trigger reads
 * "Every **N Gold** spent, <effect>." (was "When you spend **N Gold**, <effect>."). Text only, no behaviour change.
 * This pins the wording on every Spend minion and rune, that N is the meter's real threshold, that the live chain
 * (`liveCardText`) keeps it, that the on-card N/total meter still counts, and that the Spend pill still fires.
 */
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

const MINIONS: Array<[string, number]> = [
  ['dw_coinfire', 6], ['dw_tapkeeper', 10], ['dw_mountainbond', 8], ['dw_billings', 10], ['dw_brill', 10], ['dm_vhal', 10],
];
const RUNES = ['rune_overtime', 'rune_showcase', 'rune_minted_gems', 'rune_dragon_hoard', 'rune_gold_for_grub', 'rune_gemspam'];

const everyOf = (id: string): number | undefined => {
  const eff = CARD_INDEX[id]?.effects.find((e) => e.on === 'goldSpent');
  return (eff?.params as { every?: number } | undefined)?.every;
};

describe('Every N Gold spent: one wording for every repeating spend trigger', () => {
  it('no shipped minion or rune text still says "When you spend N Gold"', () => {
    const old = /When you spend \*\*\d+ Gold\*\*/;
    for (const def of Object.values(CARD_INDEX)) {
      expect(def.text, def.id).not.toMatch(old);
      if (def.goldenText) expect(def.goldenText, def.id).not.toMatch(old);
    }
    for (const r of Object.values(RUNE_INDEX)) expect(r.text, r.id).not.toMatch(old);
  });

  it.each(MINIONS)('%s prints "Every **N Gold** spent," with its real threshold, and keeps it on the live chain', (id, n) => {
    const def = CARD_INDEX[id]!;
    expect(everyOf(id), 'the meter threshold').toBe(n);
    expect(def.text).toContain(`Every **${n} Gold** spent,`);
    expect(def.goldenText).toContain(`Every **${n} Gold** spent,`);
    const live = liveCardText(id, base);
    expect(live.text).toContain(`Every **${n} Gold** spent,`);
    // The current progress is the on-card meter: 3 Gold into the meter reads 3/N, 0 reads 0/N.
    expect(stepProgress(id, { goldTick: 3 })).toEqual({ current: 3, total: n });
    expect(stepProgress(id, { goldTick: 0 })).toEqual({ current: 0, total: n });
  });

  it('Stardust Peddler reads "Every **5 Gold** spent," and its meter counts toward 5', () => {
    const id = Object.values(CARD_INDEX).find((d) => d.name === 'Stardust Peddler')!.id;
    expect(CARD_INDEX[id]!.text).toBe('Every **5 Gold** spent, create a **Starform**, or give it **+3/+3**.');
    expect(liveCardText(id, base).text).toContain('Every **5 Gold** spent,');
    expect(stepProgress(id, { goldTick: 4 })).toEqual({ current: 4, total: 5 });
  });

  it.each(RUNES)('%s reads "Every **N Gold** spent,"', (id) => {
    expect(RUNE_INDEX[id]!.text).toMatch(/^Every \*\*\d+ Gold\*\* spent, /);
  });

  it('the Spend pill still fires on the new wording, and still skips "spent this turn" scalers', () => {
    const re = KEYWORD_GLOSSARY.find((k) => k.id === 'spend')!.detectRe!;
    expect(re.test(CARD_INDEX['dw_coinfire']!.text)).toBe(true);
    expect(re.test('Whenever you **spend Gold**, give a friendly **Dwarf +2/+3**.')).toBe(true);
    expect(re.test('Give a minion **+1/+1**, plus **+2/+2** for every **6 Gold** spent this turn.')).toBe(false);
  });
});
