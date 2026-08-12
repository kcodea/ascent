import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { ARCHIVED_CARDS, ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const shop = (...ids: string[]) => ids.map((cardId, i) => ({ uid: `s${i}`, cardId }));
const rightmostOffer = (s: RunState) => {
  const i = [...s.shop].reverse().findIndex((o) => !CARD_INDEX[o.cardId]?.spell);
  return s.shop[s.shop.length - 1 - i]!;
};

// ── Right Hand Hank (T2 Demon 4/1) — Echo: buff the right-most Shop minion, via a combat→run carry-back ────
describe('Right Hand Hank — Echo banks a right-most Shop-slot buff', () => {
  const dieInCombat = (golden = false) =>
    simulate([bm('dm_hank', 'H', 4, 1, golden ? { golden: true } : {})],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 2 }), combatSide({ tier: 1 }));

  it('the CombatResult carries +6/+3 (gilded +12/+6)', () => {
    expect(dieInCombat(false).playerRightmostSlotBuff).toEqual({ attack: 6, health: 3 });
    expect(dieInCombat(true).playerRightmostSlotBuff).toEqual({ attack: 12, health: 6 });
  });

  it('settle grows the run accumulator, so the NEXT shop right-most carries it', () => {
    const r = dieInCombat(false);
    let s: RunState = {
      ...createRun(3), phase: 'combat', combatSettled: false, embers: 99, freeRolls: 99,
      board: [], hand: [], shop: [], lastCombat: r,
    } as unknown as RunState;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.rightmostSlotBuff, 'the accumulator rose').toEqual({ attack: 6, health: 3 });
    const offer = rightmostOffer(s);
    expect([offer.atk ?? 0, offer.hp ?? 0], 'the fresh shop right-most shows it').toEqual([6, 3]);
  });
});

// ── Bullseye (T3 Beast 3/2) — Echo: summon a random Beast set to 7/7 (gilded 14/14) ────────────────────────
describe('Bullseye — Echo summons a random Beast at fixed stats', () => {
  const summonEvents = (r: ReturnType<typeof simulate>, uid: string) =>
    r.events.filter((e) => e.type === 'summon' && (e as { source?: string }).source === uid) as
      { minion: { cardId: string; attack: number; health: number } }[];
  const bullseyeUid = (r: ReturnType<typeof simulate>) =>
    r.initial.player.find((m) => m.cardId === 'b2_bullseye')!.uid;

  it('summons one Beast and stamps it 7/7 (a gilded Bullseye stamps 14/14)', () => {
    const r = simulate([bm('b2_bullseye', 'B', 3, 1)],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const s = summonEvents(r, bullseyeUid(r));
    expect(s.length, 'one body').toBe(1);
    expect([s[0]!.minion.attack, s[0]!.minion.health], 'stamped 7/7').toEqual([7, 7]);
    expect(CARD_INDEX[s[0]!.minion.cardId]?.tribe === 'beast' || CARD_INDEX[s[0]!.minion.cardId]?.tribe2 === 'beast').toBe(true);

    const g = simulate([bm('b2_bullseye', 'B', 3, 1, { golden: true })],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const gs = summonEvents(g, bullseyeUid(g));
    expect(gs.length, 'still one body — gild doubles the STATLINE, not the count').toBe(1);
    expect([gs[0]!.minion.attack, gs[0]!.minion.health], 'stamped 14/14').toEqual([14, 14]);
  });
});

// ── Beardsley (T4 Beast 5/5) — when you summon a Beast IN COMBAT, give it +6/+6 (gilded +12/+12) ────────────
describe('Beardsley — combat-only summon buff', () => {
  it('a Beast summoned in combat is buffed +6/+6 (gilded +12/+12)', () => {
    // A Pack Leader dies and its Echo summons a Pup; Beardsley buffs that summoned Beast. Asserted on the buff
    // EVENT (the summon snapshot is captured before the buff lands), the same shape the Groveweaver test uses.
    const run = (golden: boolean) => simulate(
      [bm('b2_beardsley', 'BD', 5, 400, golden ? { golden: true } : {}), bm('pack', 'P', 2, 1)],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const buffedSummon = (r: ReturnType<typeof simulate>, amount: number) => {
      const pup = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
        .find((e) => e.minion.cardId === 'pup');
      if (!pup) return false;
      return (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number; health: number }[])
        .some((b) => b.target === pup.minion.uid && b.attack === amount && b.health === amount);
    };
    expect(buffedSummon(run(false), 6), 'summoned Beast got Beardsley +6/+6').toBe(true);
    expect(buffedSummon(run(true), 12), 'gilded Beardsley +12/+12').toBe(true);
  });

  it('does NOT fire in the shop — it is combat-only (no recruit factory)', () => {
    // Play a Beast token beside Beardsley in the recruit phase; it must arrive unbuffed.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 99,
      board: [minion('BD', 'b2_beardsley', 5, 5)],
      hand: [minion('p', 'pack', 3, 2)],
    };
    s = reduce(s, { type: 'play', uid: 'p' });
    const pack = s.board.find((c) => c.uid === 'p')!;
    expect([pack.attack, pack.health], 'unbuffed in the shop').toEqual([3, 2]);
  });
});

// ── Archive bookkeeping ────────────────────────────────────────────────────────────────────────────────────
describe('2026-08-12 archive batch', () => {
  it('the 5 minions are archived (in CARD_INDEX, in ARCHIVED_CARDS, out of every set)', () => {
    for (const id of ['dm_tallymonger', 'sporebat', 'b2_groveweaver', 'b2_runebloom', 'badgington']) {
      expect(CARD_INDEX[id], `${id} still resolves for saved runs`).toBeDefined();
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} recorded as archived`).toBe(true);
    }
  });

  it('the 4 runes are archived (out of RUNES/EPIC_RUNES, into ARCHIVED_RUNES)', () => {
    const live = new Set([...RUNES, ...EPIC_RUNES].map((r) => r.id));
    for (const id of ['rune_groveweaver', 'rune_matriarch', 'rune_badger', 'rune_spellhide']) {
      expect(live.has(id), `${id} must not stock the forge`).toBe(false);
      expect(ARCHIVED_RUNES.some((r) => r.id === id), `${id} recorded as archived`).toBe(true);
    }
  });
});
