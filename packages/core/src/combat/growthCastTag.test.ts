import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '../index';

/**
 * EVERY combat cast carries its spell's identity (owner 2026-09-24: *"i added a growth effect for whenever
 * growth is cast, by any means … any phase"*). A spell's own effect binds to the SPELL, so each combat cast must
 * (1) announce itself with an `sc` event stamped `spellId`, once per cast, and (2) stamp every buff it produces
 * with the same `spellId`. Before this, the arena's `castRepeat` verb (Fatecarver / Taragosa / Hoardbreaker
 * Drake's Growth) did neither, and only `castNamedSpellInCombat` marked its buffs — so the presentation could not
 * tell a combat Growth from any other buff. The choke points are `withCastingSpell` (in `resolveCombatSpellCast`
 * and `castRepeat`), so this covers both families: the arena verb and the shared resolver (Sporebat).
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 }];

function fight(player: BoardMinion[], enemy: BoardMinion[] = wall, over: Parameters<typeof combatSide>[0] = { tier: 6 }): CombatResult {
  return simulate(player, enemy, makeRng(3), CARD_INDEX, combatSide(over), combatSide({ tier: 1 }));
}

const growthAnnouncements = (r: CombatResult): Extract<CombatEvent, { type: 'sc' }>[] =>
  r.events.filter((e): e is Extract<CombatEvent, { type: 'sc' }> => e.type === 'sc' && e.spellId === 'growth');

/** The buff events a caster's Growth produced: everything it buffed with ITS uid as the source. */
const buffsFrom = (r: CombatResult, uid: string): Extract<CombatEvent, { type: 'buff' }>[] =>
  r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === uid);

describe('combat Growth — every cast path announces and tags the spell', () => {
  it.each([
    ['Fatecarver (branch B, castRepeat)', { cardId: 'n2_fatecarver', attack: 4, health: 900, sourceUid: 'FC', chosenOption: 1 } as BoardMinion],
    ['Hoardbreaker Drake (Rally, castRepeat)', { cardId: 'hoardbreaker', attack: 4, health: 900, sourceUid: 'HB' } as BoardMinion],
    ['Taragosa (token, castRepeat)', { cardId: 'taragosa', attack: 4, health: 900, sourceUid: 'TG' } as BoardMinion],
  ])('%s: one `sc` + spellId per cast, and its buffs carry spellId', (_name, caster) => {
    const r = fight([caster, { cardId: 'sandbag', attack: 1, health: 900 }]);
    const casterUid = r.initial.player.find((m) => m.cardId === caster.cardId)!.uid;
    const sc = growthAnnouncements(r);
    expect(sc.length, 'no Growth announcement was logged').toBeGreaterThan(0);
    // One announcement per GENUINE cast — the cast counter and the log agree.
    expect(sc.length).toBe(r.playerSpellsCast ?? 0);
    expect(sc.every((e) => e.source === casterUid), 'announced from the CASTER').toBe(true);
    const buffs = buffsFrom(r, casterUid);
    expect(buffs.length).toBeGreaterThan(0);
    expect(buffs.every((b) => b.spellId === 'growth'), 'every Growth buff names its spell').toBe(true);
  });

  // Growth and Waking Rift (id `sparkplug`): the two spells with an owner-authored cast effect (2026-09-24).
  it.each([['Growth', 'growth'], ['Waking Rift', 'sparkplug']])(
    'Sporebat (shared resolver `resolveCombatSpellCast`) re-casting %s: announced, and its buffs carry spellId', (_n, id) => {
      const r = fight(
        [{ cardId: 'sporebat', attack: 2, health: 1 }, { cardId: 'pack', attack: 3, health: 200 }],
        [{ cardId: 'omen', attack: 5, health: 200 }],
        { tier: 4, lastSpellCastId: id },
      );
      const sc = r.events.filter((e): e is Extract<CombatEvent, { type: 'sc' }> => e.type === 'sc' && e.spellId === id);
      expect(sc).toHaveLength(1);
      const buffs = buffsFrom(r, sc[0]!.source);
      expect(buffs.length).toBeGreaterThan(0);
      expect(buffs.every((b) => b.spellId === id)).toBe(true);
    });

  it('a non-cast buff keeps its exact old shape (no spellId key)', () => {
    const r = fight([{ cardId: 'n2_fatecarver', attack: 4, health: 900, sourceUid: 'FC', chosenOption: 1 }]);
    const other = r.events.filter((e) => e.type === 'buff' && !('spellId' in e));
    // The mark is scoped: it is restored after every cast, so it can never leak onto a later, unrelated buff.
    for (const e of r.events) if (e.type === 'buff' && e.spellId !== undefined) expect(e.spellId).toBe('growth');
    expect(other.length + r.events.filter((e) => e.type === 'buff' && e.spellId === 'growth').length)
      .toBe(r.events.filter((e) => e.type === 'buff').length);
  });
});
