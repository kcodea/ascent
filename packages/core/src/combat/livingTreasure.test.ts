import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion, type CardDef } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Rune of Living Treasure — owner report 2026-07-31: a grown 7/3 Gem Shard died and came back a 1/1.
 *
 * The rune shipped granting RISE, on the theory that "Rise IS summon an exact copy" — but Rise resummons the
 * PRINTED body, discarding everything the shard had grown into. The rune's rule is Exgalloper's exact-copy
 * Echo, so it now grafts that (`echoSummonCopyNoEcho`), which copies CURRENT stats — and, being a real
 * `onDeath` effect, is seen by every Echo-amplifier.
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

  it('a GROWN shard\'s death resummons its CURRENT stats, not the printed 1/1', () => {
    const p: BoardMinion[] = [
      { cardId: 'lt_maker', attack: 0, health: 1 },
      { cardId: 'lt_buffer', attack: 1, health: 500 },
    ];
    const r = simulate(p, [{ cardId: 'drummer', attack: 6, health: 60 }], makeRng(5), cards,
      combatSide({ tier: 4, tribes: ['kobold'], questMods: { runeLivingTreasure: true } }), combatSide({ tier: 1 }));
    const shardSummons = r.events.filter(
      (e): e is Extract<typeof e, { type: 'summon' }> => e.type === 'summon' && e.minion.cardId === 'gemheart-shard',
    );
    // The maker's shard, grown by the buffer (+1/+1 then doubled → 4/4), dies to the 6-attack enemy — and the
    // grafted Echo resummons the BODY IT WAS. Under Rise this second summon arrived at the printed 1/1.
    expect(shardSummons.length, 'fixture: the shard must die and re-summon').toBeGreaterThanOrEqual(2);
    const first = shardSummons[0]!.minion;
    const second = shardSummons[1]!.minion;
    // A summon EVENT snapshots the printed body; the buffer's growth lands as later `buff` events. The first
    // shard's real attack at death = printed + every buff that targeted it. The COPY's summon, by contrast,
    // carries the inherited stats in the event itself (`copyStats` rides into the emit).
    const grown = first.attack + r.events
      .filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff' && e.target === first.uid)
      .reduce((n, e) => n + e.attack, 0);
    expect(grown, 'fixture: the shard must actually have GROWN before dying').toBeGreaterThan(1);
    expect(second.attack, 'the copy lost the grown stats — the Rise bug').toBe(grown);
  });

  it('the chain terminates: the copy does not itself resummon', () => {
    const p: BoardMinion[] = [{ cardId: 'lt_maker', attack: 0, health: 1 }];
    const r = simulate(p, [{ cardId: 'drummer', attack: 6, health: 30 }], makeRng(5), cards,
      combatSide({ tier: 4, tribes: ['kobold'], questMods: { runeLivingTreasure: true } }), combatSide({ tier: 1 }));
    const shardSummons = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'gemheart-shard');
    // One original + one copy. A third would mean the graft re-armed on the copy — the board-cap chain the
    // strip-then-self-disable mechanism exists to prevent.
    expect(shardSummons.length).toBeLessThanOrEqual(2);
  });
});
