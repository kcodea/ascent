/**
 * R-SET3-RUNE-REVIEW-01 — the owner's Set 3 rune review board (2026-11-23).
 *
 *  - 68 Set 2 runes the owner voted Yes (or Neutral: Mountain Trade) join the Set 3 pool and keep their old sets.
 *  - The runes voted No stay out of Set 3 (they were not in it; nothing changes for them).
 *  - Edits that apply in every set: Spellstone is Basic, Pair is renamed Tempo, Wildfire has no Demon tag.
 *    (Summit's turns 9 and 11 live in runes.test.ts; Top Shelf's top-Tier guarantee in set2RunesEpicNeutral.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { EPIC_RUNES, RUNES, RUNE_INDEX } from '@game/content';
import { runeforgePool } from './reducer';
import { createRun, type RunState } from './index';
import { SET3_REVIEW_JOINED } from './set3ReviewJoined';

const JOINED = SET3_REVIEW_JOINED;
const VOTED_NO = [
  'rune_kobold_bebes', 'rune_lapidary', 'rune_glider', 'rune_dragons_pantry', 'rune_iggy_iggy', 'rune_foundry', 'rune_voicekeeper',
  'rune_elders_voice', 'rune_shared_spoils', 'rune_rowdy_crowd', 'rune_drunk_shopkeeper', 'rune_high_king', 'rune_runic_exchange',
  'rune_restocking', 'rune_trade_in', 'rune_slaying', 'rune_golden_handshake', 'rune_thrift', 'rune_infernal_ink', 'rune_counterpoint',
  'rune_shared_scripture',
];

const forge = (epic: boolean): string[] => runeforgePool({
  ...createRun(5, 'warden'), setId: 'set3', tribes: ['dwarf', 'kobold', 'undead', 'spirit', 'dragon'], runeforgeEpic: epic || undefined,
} as RunState);

describe('the Set 3 rune review board (owner 2026-11-23)', () => {
  it('all 68 approved runes are in Set 3 and kept Set 2', () => {
    expect(JOINED).toHaveLength(68);
    for (const id of JOINED) {
      const r = RUNE_INDEX[id];
      expect(r, id).toBeDefined();
      expect(r!.sets, id).toContain('set3');
      expect(r!.sets, id).toContain('set2');
    }
  });
  it('every approved rune can reach a Set 3 forge (Basic or Epic, by its array)', () => {
    const basic = new Set(forge(false)), epic = new Set(forge(true));
    for (const id of JOINED) {
      const r = RUNE_INDEX[id]!;
      expect((EPIC_RUNES.includes(r) ? epic : basic).has(id), id).toBe(true);
    }
  });
  it('the runes voted No are still out of Set 3', () => {
    const all = new Set([...forge(false), ...forge(true)]);
    for (const id of VOTED_NO) {
      expect(RUNE_INDEX[id]!.sets ?? [], id).not.toContain('set3');
      expect(all.has(id), id).toBe(false);
    }
  });
  it('Spellstone is a Basic rune now (owner note: "Basic rune")', () => {
    const r = RUNE_INDEX['rune_spellstone']!;
    expect(RUNES.includes(r)).toBe(true);
    expect(EPIC_RUNES.includes(r)).toBe(false);
    expect(r.epic).toBeFalsy();
  });
  it('Pair is renamed Tempo; the id stays for saves and replays', () => {
    expect(RUNE_INDEX['rune_pair']!.name).toBe('Tempo');
    expect([...RUNES, ...EPIC_RUNES].filter((r) => r.name === 'Tempo')).toHaveLength(1);
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.name === 'Pair')).toBe(false);
  });
  it('Wildfire has no Demon tag, so a warband with no Demons is offered it', () => {
    expect(RUNE_INDEX['rune_wildfire']!.tribes).toBeUndefined();
    expect(forge(true)).toContain('rune_wildfire');
  });
  it('Summit and Top Shelf print their new rules', () => {
    expect(RUNE_INDEX['rune_summit']!.text).toBe('**On turns 9 and 11:** **Discover** a **Tier 7** minion.');
    expect(RUNE_INDEX['rune_top_shelf']!.text).toContain('At your top Tier, your **2** right-most offers are always that Tier.');
  });
});
