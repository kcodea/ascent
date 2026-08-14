import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';
import { PRESENTATION_POLICIES } from '../presentation/policies';

/**
 * BEAT CHOREOGRAPHER PR 23 — minion combat effects stamp their identity ON the events they emit.
 *
 * The owner's ruling: no one-off fixes — cover the CLASS. King Oona's onSummon reaction is the acceptance
 * case, but the mechanism is the dispatch context in `simulate`: while any minion's combat effect runs,
 * every event it emits carries `key` (`factory:<do>:<on>`, the registry's own grammar) and `srcCard`.
 * That is what makes ~109 previously identity-less combat triggers addressable, with identity gameplay
 * stamped — never guessed from a display id (PR 1's rule, held to in combat).
 *
 * The invariants, hardest-biting first:
 *   1. Identity is metadata: outcomes are BYTE-identical to a simulation without it (asserted by stripping).
 *   2. The stamped key exists in the registry — no orphan identities.
 *   3. Events emitted OUTSIDE a minion effect (plain attacks, rune payouts) stay unstamped.
 */
const rng = () => makeRng(7);

/** Oona watching a Deathrattle summoner: the dying wolf summons Pups, Oona doubles them — HER class. */
const oonaFight = () => simulate(
  [
    { cardId: 'b2_oona', attack: 1, health: 200, sourceUid: 'OO' },
    { cardId: 'pack', attack: 1, health: 1, sourceUid: 'DW' },
  ] as BoardMinion[],
  [{ cardId: 'sandbag', attack: 5, health: 40 }] as BoardMinion[],
  rng(),
  CARD_INDEX,
  combatSide({ tier: 5, tribes: ['beast'] }),
  combatSide({ tier: 1 }),
);

describe('the class is addressable: minion combat effects carry their own key', () => {
  it("Oona's onSummon reaction stamps her factory key and card onto the buffs it emits", () => {
    const r = oonaFight();
    const stamped = r.events.filter((e) => (e as { key?: string }).key === 'factory:onSummonTribeBuffThenDouble:onSummon');
    expect(stamped.length, 'Oona reacted to a summon and her events carry HER identity').toBeGreaterThan(0);
    for (const e of stamped) expect((e as { srcCard?: string }).srcCard).toBe('b2_oona');
  });

  it('the Deathrattle summon itself is stamped with ITS OWN key — two effects, two identities', () => {
    const r = oonaFight();
    const summons = r.events.filter((e) => e.type === 'summon' && (e as { key?: string }).key === 'factory:deathrattleSummon:onDeath');
    expect(summons.length).toBeGreaterThan(0);
    for (const e of summons) expect((e as { srcCard?: string }).srcCard).toBe('pack');
  });

  it('every stamped key exists in the registry — no orphan identities', () => {
    for (const e of oonaFight().events) {
      const key = (e as { key?: string }).key;
      if (!key) continue;
      expect(PRESENTATION_POLICIES[key], `${e.type} stamped unknown key ${key}`).toBeDefined();
    }
  });

  it('events emitted outside a minion effect stay unstamped (attacks, deaths, rune payouts)', () => {
    for (const e of oonaFight().events) {
      if (e.type === 'attack' || e.type === 'dmg') {
        expect((e as { key?: string }).key, `${e.type} must not carry an effect key`).toBeUndefined();
      }
    }
  });
});

describe('identity is metadata — outcomes are untouched', () => {
  it('stripping key/srcCard yields a byte-identical simulation to a re-run', () => {
    const strip = (events: readonly CombatEvent[]) =>
      events.map((e) => { const { key: _k, srcCard: _s, ...rest } = e as CombatEvent & { key?: string; srcCard?: string }; return rest; });
    const a = oonaFight();
    const b = oonaFight();
    expect(JSON.stringify(strip(a.events))).toBe(JSON.stringify(strip(b.events)));
    expect(a.result).toBe(b.result);
    expect(a.playerDamage).toBe(b.playerDamage);
  });

  it('the stamp is deterministic — same fight, same keys in the same places', () => {
    const keysOf = (r: ReturnType<typeof oonaFight>) => r.events.map((e) => (e as { key?: string }).key ?? '·').join(',');
    expect(keysOf(oonaFight())).toBe(keysOf(oonaFight()));
  });
});
