import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { spellCasts } from './recruit';

/**
 * The 2026-09-01 owner batch: Standard Bearer's Rally buff, the Rune of Hoardflame grant bug, and the
 * multicast arithmetic the owner asked to have confirmed.
 */

const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

describe('Standard Bearer — the Rally buff lasts the FIGHT, not the run (owner 2026-09-01)', () => {
  it('prints +3/+3 with no permanence claim, and gilds to +6/+6', () => {
    const def = CARD_INDEX['n2_standardbearer']!;
    const p = def.effects[0]!.params as { attack: number; health: number; permanent?: boolean };
    expect([p.attack, p.health]).toEqual([3, 3]);
    expect(p.permanent, 'the whole point of the change — no longer permanent').toBe(false);
    // The printed text is the contract the player reads: it must not still promise permanence.
    expect(def.text).not.toMatch(/permanent/i);
    expect(def.goldenText).not.toMatch(/permanent/i);
    expect(def.text).toContain('+3/+3');
    expect(def.goldenText).toContain('+6/+6');
  });

  it('Paragon is untouched — still +4/+4 and still permanent', () => {
    // The two share ONE factory, so a param whose default leaked would silently strip Paragon's permanence.
    const p = CARD_INDEX['n2_paragon']!.effects[0]!.params as { attack: number; permanent?: boolean };
    expect(p.attack).toBe(4);
    expect(p.permanent, 'absent = permanent, which is what Paragon prints').toBeUndefined();
    expect(CARD_INDEX['n2_paragon']!.text).toMatch(/permanent/i);
  });

  /**
   * The BEHAVIOURAL half, and the only one that actually proves the change: `playerPermaBuffs` is the channel
   * a combat gift rides home on. Standard Bearer must still move stats inside the fight (it is a real buff)
   * and put NOTHING on that channel; Paragon must keep putting its gift there.
   */
  const rallyFight = (bearerId: string) => simulate(
    [bm(bearerId, 'S', 0, 400), bm('b2_packstrider', 'B', 5, 400, ['RL'])],
    [{ cardId: 'sandbag', attack: 0, health: 9999 } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
    combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it('still buffs inside the fight', () => {
    const r = rallyFight('n2_standardbearer');
    const grants = (r.events.filter((e) => e.type === 'buff') as unknown as { source?: string; attack: number }[])
      .filter((b) => b.source === 'm0' && b.attack === 3);
    expect(grants.length, 'Standard Bearer granted nothing at all').toBeGreaterThan(0);
  });

  it('but the gift does NOT ride home', () => {
    const r = rallyFight('n2_standardbearer');
    expect((r.playerPermaBuffs ?? []).filter((b) => b.sourceUid === 'S'), 'the buff carried back out of combat').toEqual([]);
  });

  it('while Paragon’s still does — the two must not converge', () => {
    const r = rallyFight('n2_paragon');
    expect((r.playerPermaBuffs ?? []).some((b) => b.sourceUid === 'S'), 'Paragon lost its permanence').toBe(true);
  });
});

describe('Rune of Hoardflame — the rune hands you a Hoardflame the moment you take it', () => {
  /**
   * OWNER BUG 2026-09-01: *"rune of hoardflame did not grant me a hoardflame"*.
   *
   * `recurringGrant` only ever registered the recurrence, and the recurrence pays at TURN SETUP. The Runeforge
   * opens partway THROUGH a shop turn — after that turn's setup has already run — so the rune you just paid
   * for handed you nothing until the following turn. Same shape (and same fix) as `runeTribeDrip`, 2026-08-20.
   */
  const take = (runeId: string): RunState =>
    reduce(run({ hand: [] }), { type: 'devGrant', kind: 'rune', id: runeId } as never) as RunState;

  it('taking the rune puts a Hoardflame in hand immediately', () => {
    expect(take('rune_hoardflame').hand.map((c) => c.cardId)).toContain('hoardflame');
  });

  it('and still arms the recurrence, so it keeps paying every turn', () => {
    expect(take('rune_hoardflame').questRecurringGrants ?? []).toContain('hoardflame');
  });

  it('the multicast half of the rune is still installed', () => {
    // Both halves of the `multi` must survive — the immediate grant is added INSIDE the `recurringGrant` case,
    // so a mistake there could have short-circuited the sibling reward.
    expect(take('rune_hoardflame').runeSpellDouble ?? []).toContain('hoardflame');
  });

  it('Rune of Dragon Breath — the Epic twin, same wording — pays immediately too', () => {
    expect(take('rune_dragon_breath').hand.map((c) => c.cardId)).toContain('sp_dragonflame');
  });

  it('a CADENCED rune (every 2 turns) still pays nothing up front', () => {
    // "Every 2 turns, get a Clockwork Assistant" promises no copy now, and its badge counts down from a full
    // cadence — an immediate copy would desync the countdown from the payout.
    const s = take('rune_clockwork_promotion');
    expect(s.hand.map((c) => c.cardId)).not.toContain('n2_clockwork');
    expect((s.runeCadenceGrants ?? []).map((g) => g.cardId)).toContain('n2_clockwork');
  });

  it('a QUEST recurring grant keeps its one-turn delay (unchanged by this fix)', () => {
    // Scope pin: the immediate copy is a RUNE rule. Four shipped quests use `recurringGrant` and none of them
    // promised a copy on completion — this asserts the fix did not quietly re-balance them.
    const s = reduce(run({ hand: [] }), { type: 'devGrant', kind: 'quest', id: 'q_the_red_trail' } as never) as RunState;
    expect(s.questRecurringGrants ?? []).toContain('bloodlust');
    expect(s.hand.map((c) => c.cardId)).not.toContain('bloodlust');
  });
});

/**
 * THE MULTICAST ARITHMETIC (owner logic check + ruling, 2026-09-01).
 *
 * The owner asked how many casts Rune of Hoardflame + Mirrorwing produces, and then RULED on the answer:
 *
 *   *"mirrorwing's interaction should be a full re-cast of the spell, not an additional trigger OF the spell.
 *   therefore it is a full multiplier. this is the same for reflector. if a spell casts 4x, then casting it on
 *   mirrorwing would cast it 8x because it fully casts it twice."*
 *
 * So the re-cast is scaled by `spellCasts` — the same total the play site used — and Mirrorwing DOUBLES the
 * count instead of adding one to it. `spellsCast` counts resolutions (one per `castSpell`), which is what makes
 * these assertions about behaviour rather than about the multiplier in isolation.
 */
describe('Rune of Hoardflame + Mirrorwing — how many casts', () => {
  /** Play Hoardflame from hand at `targetUid` and report how many times it actually resolved. */
  const castsOnPlay = (board: BoardCard[], targetUid: string, over: Partial<RunState> = {}): number => {
    const s = run({
      board,
      hand: [{ uid: 'h1', cardId: 'hoardflame', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      embers: 20,
      runeSpellDouble: ['hoardflame'],
      ...over,
    });
    const before = s.spellsCast;
    const after = reduce(s, { type: 'play', uid: 'h1', targetUid } as never) as RunState;
    return after.spellsCast - before;
  };

  const mirrorwing = () => minion('m1', 'd2_mirrorwing', 2, 4);
  const plain = (uid: string) => minion(uid, 'alleycat', 1, 1);

  it('the rune alone: the play site resolves Hoardflame twice', () => {
    const s = run({ board: [mirrorwing()], runeSpellDouble: ['hoardflame'] });
    expect(spellCasts(s, CARD_INDEX['hoardflame']!)).toBe(2);
  });

  it('Yazzus multiplies on top of the rune — four resolutions at the play site', () => {
    const s = run({ board: [mirrorwing(), minion('y1', 'yazzus', 5, 7)], runeSpellDouble: ['hoardflame'] });
    expect(spellCasts(s, CARD_INDEX['hoardflame']!)).toBe(4);
  });

  it('cast on an ORDINARY minion, the rune gives 2 casts', () => {
    expect(castsOnPlay([plain('p1')], 'p1')).toBe(2);
  });

  it('cast on MIRRORWING, the rune gives 4 — Mirrorwing doubles, it does not add one', () => {
    // The pre-ruling behaviour was 3 (a single bare extra resolution). 3 is the regression to watch for.
    expect(castsOnPlay([mirrorwing()], 'm1')).toBe(4);
  });

  it('with a Yazzus too: 4 on an ordinary minion, 8 on Mirrorwing — the owner’s worked example', () => {
    const yazzus = () => minion('y1', 'yazzus', 5, 7);
    expect(castsOnPlay([plain('p1'), yazzus()], 'p1'), 'the play site alone').toBe(4);
    expect(castsOnPlay([mirrorwing(), yazzus()], 'm1'), '"4x → 8x because it fully casts it twice"').toBe(8);
  });

  it('Yirin’s Reflector spreads FULL casts too, onto its random friend', () => {
    // Same ruling ("this is the same for reflector"): 2 on the Reflector + 2 spread = 4 resolutions.
    expect(castsOnPlay([minion('r1', 'n2_reflector', 1, 1), plain('p1')], 'r1')).toBe(4);
  });

  it('the re-cast still terminates — the per-turn counter closes the loop however big the multiplier', () => {
    // The guard is `spellsOnThisTurn === 1`, bumped on the way in, so a re-cast can never re-arm the watcher.
    // Two Mirrorwings side by side is the worst case: each can arm the other exactly once.
    expect(castsOnPlay([mirrorwing(), minion('m2', 'd2_mirrorwing', 2, 4)], 'm1')).toBeLessThan(20);
  });
});
