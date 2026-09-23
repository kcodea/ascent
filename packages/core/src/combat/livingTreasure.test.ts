import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion, type CardDef } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Rune of Living Treasure — owner report 2026-07-31: a grown 7/3 Gem Shard died and came back a 1/1.
 *
 * The rune shipped granting RISE, on the theory that "Rise IS summon an exact copy" — but Rise resummons the
 * PRINTED body, discarding everything the shard had grown into. It then grafted Exgalloper's exact-copy Echo.
 * Owner rework 2026-09-23: the Golems gain REBIRTH — the keyword that returns the body ONCE with its full current
 * stats — the same promise as a keyword rather than a graft. The test still guards the original bug: the return
 * must carry the GROWN stats.
 */
describe('Rune of Living Treasure', () => {
  // A maker that dies immediately (summoning the shard), and a Kobold summon-buffer so the shard GROWS past
  // its printed 1/1 before it dies — the whole bug is invisible on an unbuffed shard.
  const maker: CardDef = { id: 'lt_maker', name: 'Maker', tribe: 'kobold', tier: 2, attack: 0, health: 1, keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'gemheart-shard', count: 1 } }], text: '' };
  // Bulky enough to OUTLIVE the maker — with 40 HP the enemy happened to kill the buffer first, so the
  // shard arrived with nobody to grow it and the fixture proved nothing.
  const buffer: CardDef = { id: 'lt_buffer', name: 'Buffer', tribe: 'kobold', tier: 4, attack: 1, health: 500, keywords: [],
    effects: [{ on: 'onSummon', do: 'onSummonTribeBuffThenDouble', params: { tribe: 'kobold', attack: 1, health: 1 } }], text: '' };
  const cards = { ...CARD_INDEX, lt_maker: maker, lt_buffer: buffer };

  it("a GROWN shard's death returns its CURRENT stats, not the printed 1/1", () => {
    const p: BoardMinion[] = [
      { cardId: 'lt_maker', attack: 0, health: 1 },
      { cardId: 'lt_buffer', attack: 1, health: 500 },
    ];
    const r = simulate(p, [{ cardId: 'drummer', attack: 6, health: 60 }], makeRng(5), cards,
      combatSide({ tier: 4, tribes: ['kobold'], questMods: { runeLivingTreasure: true } }), combatSide({ tier: 1 }));
    const shardSummons = r.events.filter(
      (e): e is Extract<typeof e, { type: 'summon' }> => e.type === 'summon' && e.minion.cardId === 'gemheart-shard',
    );
    expect(shardSummons.length, 'fixture: the maker must summon the shard').toBe(1);
    const first = shardSummons[0]!.minion;
    expect(first.keywords, 'the shard lands carrying Rebirth').toContain('RB');
    // A summon EVENT snapshots the printed body; the buffer's growth lands as later `buff` events. The shard's
    // real attack at death = printed + every buff that targeted it. The Rebirth return reports its body in the
    // `reborn` event.
    // Only the buffs BEFORE the return count: a Rebirth return is a summon in full, so the buffer's onSummon
    // fires on the returned body too and those later buffs are growth AFTER the return, not before the death.
    const returnAt = r.events.findIndex((e) => e.type === 'reborn' && e.target === first.uid);
    expect(returnAt, 'the shard must die and return').toBeGreaterThan(0);
    const grown = first.attack + r.events.slice(0, returnAt)
      .filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff' && e.target === first.uid)
      .reduce((n, e) => n + e.attack, 0);
    expect(grown, 'fixture: the shard must actually have GROWN before dying').toBeGreaterThan(1);
    const returns = r.events.filter((e): e is Extract<typeof e, { type: 'reborn' }> => e.type === 'reborn' && e.target === first.uid);
    expect(returns.length, 'one return').toBe(1);
    expect(returns[0]!.rebirth, 'a REBIRTH return, not a Rise').toBe(true);
    expect(returns[0]!.attack, 'the return lost the grown stats — the Rise bug').toBe(grown);
  });

  it('the chain terminates: the returned shard does not return again', () => {
    const p: BoardMinion[] = [{ cardId: 'lt_maker', attack: 0, health: 1 }];
    const r = simulate(p, [{ cardId: 'drummer', attack: 6, health: 30 }], makeRng(5), cards,
      combatSide({ tier: 4, tribes: ['kobold'], questMods: { runeLivingTreasure: true } }), combatSide({ tier: 1 }));
    const shard = r.events.find((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'gemheart-shard') as { minion: { uid: string } } | undefined;
    expect(shard).toBeDefined();
    const returns = r.events.filter((e) => e.type === 'reborn' && (e as { target: string }).target === shard!.minion.uid);
    // One return. A second would mean Rebirth re-armed on the returned body — a body holds one Rebirth.
    expect(returns.length).toBeLessThanOrEqual(1);
  });
});
