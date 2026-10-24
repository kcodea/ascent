import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, eotTickCount, endOfTurnTicksOf, replayBattlecry, replayEndOfTurn, projectEndOfTurnSteps } from './recruit';
import { castSpellPerGoldText, musterTrooperText } from '../../ui/src/cardText';

/**
 * BALANCE 9/23, TRANCHE 2 — the minion MECHANIC rewrites (owner sheet 2026-09-23). One block per card: the trigger
 * fires, the numbers, the gilded form, and the live-text helper. The surface chains (`liveCardText` for shop /
 * hand / board / Discover, and the combat chain in Unit.tsx) are pinned in `packages/ui/src/balance923LiveText.test.ts`
 * — the sim package cannot import the UI's JSX-adjacent modules under `typecheck:pkgs`.
 *
 *   · Conductor       — superseded 2026-10-24 (run-wide improvement): see conductorCombat.test.ts
 *   · Traveling Skald — 1/3; "When another friendly Dragon attacks, give it +3/+2."
 *   · Rope Wrangler   — "End of Turn: cast Lasso. Repeat for every 10 Gold spent this turn." (one tick per repeat)
 *   · Soul Defiler    — "End of Turn: cast Staff of Guel."
 *   · Moira           — "End of Turn: trigger your Shout minions."  (every friendly Shout, one notify per fire)
 *   · Impossible Todd — "+1/+2 permanently and give your Imps +2/+1 this game" per friendly-Demon damage instance
 *   · Muster General  — a 3/3 Trooper; the improve step applies to the 3/3
 *   · Exgalloper      — Rebirth.
 */

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack, health, sourceUid: uid, keywords: [...d.keywords], ...extra } as BoardMinion;
};
const buffsOn = (events: readonly CombatEvent[], target: string) =>
  events.filter((e) => e.type === 'buff' && (e as { target: string }).target === target)
    .map((e) => e as unknown as { attack: number; health: number; source?: string });
const recruit = (over: Partial<RunState>): RunState => ({ ...createRun(1), phase: 'recruit', embers: 40, hand: [], shop: [], ...over } as RunState);

// ── 1. CONDUCTOR ── superseded: the 2026-10-24 run-wide rework is pinned in conductorCombat.test.ts.

// ── 2. TRAVELING SKALD ──────────────────────────────────────────────────────────────────────────────────────
describe('Traveling Skald — 1/3; when another friendly Dragon attacks, give it +3/+2', () => {
  it('is a 1/3 and buffs the attacking Dragon +3/+2 (gilded +6/+4), never a Beast, never itself', () => {
    const d = CARD_INDEX['d2_skald']!;
    expect([d.attack, d.health]).toEqual([1, 3]);
    const fight = (golden: boolean) => simulate(
      [bm('d2_skald', 'S', 1, 60, { golden }), bm('d2_embermouth', 'D', 3, 60), bm('alley', 'B', 3, 60)],
      [{ cardId: 'sandbag', attack: 0, health: 900 } as BoardMinion], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4, tribes: ['dragon', 'beast'] }), combatSide({ tier: 1 }));
    const plain = fight(false);
    expect(buffsOn(plain.events, 'm1')[0], 'the Dragon that attacked').toMatchObject({ attack: 3, health: 2 });
    expect(buffsOn(plain.events, 'm2'), 'the Beast that attacked').toEqual([]);
    expect(buffsOn(plain.events, 'm0'), 'never itself').toEqual([]);
    expect(buffsOn(fight(true).events, 'm1')[0], 'gilded doubles').toMatchObject({ attack: 6, health: 4 });
  });

  it('the printed text is the new grant', () => {
    expect(CARD_INDEX['d2_skald']!.text).toBe('When **another** friendly **Dragon** attacks, give it **+3/+2**.');
    expect(CARD_INDEX['d2_skald']!.goldenText).toContain('+6/+4');
  });
});

// ── 3. ROPE WRANGLER ────────────────────────────────────────────────────────────────────────────────────────
describe('Rope Wrangler — End of Turn: cast Lasso. Repeat for every 10 Gold spent this turn', () => {
  const wrangler = (gold: number, golden = false): RunState =>
    recruit({ board: [card('rw', 'ropewrangler', { golden })], goldSpentThisTurn: gold, spellsCast: 0, spellsThisTurn: 0 });

  it('base + one repeat per 10 Gold, no cap: 0 → 1, 9 → 1, 10 → 2, 25 → 3, 600 → 61 casts', () => {
    for (const [gold, casts] of [[0, 1], [9, 1], [10, 2], [25, 3], [600, 61]] as const) {
      const s = wrangler(gold);
      applyEndOfTurn(s);
      expect(s.spellsCast, `${gold} Gold`).toBe(casts);
    }
  });

  it('every repeat is its OWN End-of-Turn tick: the shared tick count, the projection and the factory agree', () => {
    const s = wrangler(25);
    const eff = CARD_INDEX['ropewrangler']!.effects[0]!;
    expect(eotTickCount(s, eff)).toBe(3);
    expect(endOfTurnTicksOf(s, s.board[0]!)).toBe(3);
    expect(projectEndOfTurnSteps(s).steps.length, 'one projected beat per tick').toBe(3);
    // A single-shot caller (Dusk's replay) with no tick still runs the whole sequence in one call.
    const dusk = wrangler(25);
    replayEndOfTurn(dusk, dusk.board[0]!);
    expect(dusk.spellsCast).toBe(3);
  });

  it('gilded casts twice per tick, never more ticks (25 Gold → 3 ticks → 6 casts)', () => {
    const s = wrangler(25, true);
    expect(eotTickCount(s, CARD_INDEX['ropewrangler']!.effects[0]!)).toBe(3);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(6);
  });

  it('live text keeps the per-tick cast as printed and folds (×N) into the Repeat sentence', () => {
    expect(castSpellPerGoldText('ropewrangler', 0), 'no repeat owed → the printed text is exact').toBeNull();
    expect(castSpellPerGoldText('ropewrangler', 9)).toBeNull();
    expect(castSpellPerGoldText('ropewrangler', 25)).toBe('**End of Turn:** cast **Lasso**. Repeat for every **10 Gold** spent this turn {{(×3)}}.');
    expect(castSpellPerGoldText('ropewrangler', 10, true)).toContain('**Lasso twice**');
    expect(castSpellPerGoldText('ropewrangler', 10, true)).toContain('{{(×2)}}');
  });
});

// ── 4. SOUL DEFILER ─────────────────────────────────────────────────────────────────────────────────────────
describe('Soul Defiler — End of Turn: cast Staff of Guel', () => {
  it('raises the permanent buy-buff channel by the Staff\'s current value each End of Turn; gilded casts twice', () => {
    const staff = CARD_INDEX['staffofguel']!.effects[0]!.params as { attack: number; health: number };
    const s = recruit({ board: [card('sd', 'dm_curator')], shop: [{ uid: 's1', cardId: 'sandbag' } as RunState['shop'][number]] });
    applyEndOfTurn(s);
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([staff.attack, staff.health]);
    // Owner balance 2026-10-10: it casts Staff of Guel AND Picnic, so two real casts per End of Turn.
    expect(s.spellsCast, 'real casts — spell-cast payoffs see them').toBe(2);
    applyEndOfTurn(s);
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp], 'it stacks, no alternation, no escalation').toEqual([2 * staff.attack, 2 * staff.health]);
    const g = recruit({ board: [card('sd', 'dm_curator', { golden: true })] });
    applyEndOfTurn(g);
    expect([g.tavernBuyBonus.atk, g.tavernBuyBonus.hp], 'gilded: two casts').toEqual([2 * staff.attack, 2 * staff.health]);
  });

  it('names the spell it casts and lets the Staff carry its own live value (the sanctioned named-spell exception)', () => {
    const d = CARD_INDEX['dm_curator']!;
    // Owner balance 2026-10-10: "End of Turn: Cast Staff of Guel and Picnic."
    expect(d.text).toBe('**End of Turn:** cast **Staff of Guel** and **Picnic**.');
    expect(d.goldenText).toBe('**End of Turn:** cast **Staff of Guel** and **Picnic**, **twice**.');
    expect(d.effects).toEqual([
      { on: 'endOfTurn', do: 'castSpell', params: { spellId: 'staffofguel' } },
      { on: 'endOfTurn', do: 'castSpell', params: { spellId: 'sp_picnic' } },
    ]);
  });
});

// ── 5. MOIRA ────────────────────────────────────────────────────────────────────────────────────────────────
describe('Moira — End of Turn: trigger your Shout minions', () => {
  // Hoard Chronicler is "Shout: get a random Shop spell", so the hand size IS the fire count.
  it('fires EVERY friendly Shout minion, wherever it stands, and skips non-Shouts', () => {
    const s = recruit({
      board: [card('far', 'd2_chronicler'), card('x', 'sandbag'), card('m', 'b2_moira'), card('r', 'd2_chronicler'), card('end', 'd2_chronicler')],
    });
    const after = reduce(s, { type: 'faceOmen' });
    expect(after.hand.length, 'all three Shouts fired, the sandbag did not').toBe(3);
  });

  it('every re-fire is a real Shout trigger: `battlecryTriggered` watchers (Embermouth Whelp) count each one', () => {
    const s = recruit({
      board: [card('w', 'd2_embermouth'), card('a', 'd2_chronicler'), card('m', 'b2_moira'), card('b', 'd2_chronicler')],
    });
    const after = reduce(s, { type: 'faceOmen' });
    const whelp = after.board.find((c) => c.uid === 'w')!;
    const base = CARD_INDEX['d2_embermouth']!;
    expect([whelp.attack - base.attack, whelp.health - base.health], 'two Shouts → +1/+2 twice (Embermouth is +1/+2 since the Balance 9/23 minion pass, #1662)').toEqual([2, 4]);
  });

  it('gilded fires the whole thing twice', () => {
    const s = recruit({ board: [card('a', 'd2_chronicler'), card('m', 'b2_moira', { golden: true, attack: 12, health: 16 }), card('b', 'd2_chronicler'), card('c', 'd2_chronicler')] });
    expect(reduce(s, { type: 'faceOmen' }).hand.length).toBe(6);
  });

  it('the roster is read before firing: a Shout minion summoned DURING the sequence does not fire this turn', () => {
    // Pennycat's Shout summons a Stray (no Shout) — but if a summoned body had a Shout it must not be picked up
    // mid-sequence. Pin the boundary with the count: two Chroniclers + one Pennycat = exactly 2 spells + 1 Stray.
    const s = recruit({ board: [card('a', 'd2_chronicler'), card('m', 'b2_moira'), card('p', 'alley'), card('b', 'd2_chronicler')] });
    const after = reduce(s, { type: 'faceOmen' });
    expect(after.hand.length).toBe(2);
    expect(after.board.filter((c) => c.cardId === 'stray').length).toBe(1);
  });

  it('the printed text is the whole-board form', () => {
    expect(CARD_INDEX['b2_moira']!.text).toBe('**End of Turn:** trigger your **Shout** minions.');
    expect(CARD_INDEX['b2_moira']!.effects[0]!.do).toBe('endOfTurnTriggerShouts');
  });
});

// ── 6. IMPOSSIBLE TODD ──────────────────────────────────────────────────────────────────────────────────────
// RE-PINNED 2026-10-10 (owner balance batch): the self-buff and Ward are gone; the Imp grant stays (+2/+1).
describe('Impossible Todd — when a friendly Demon deals damage: Imps +2/+1 (no self-buff since 2026-10-10)', () => {
  const fight = (golden: boolean) => simulate(
    [bm('dm_todd', 'TD', 0, 400, { golden }), bm('dm_clerk', 'AT', 5, 400)],
    [bm('dm_clerk', 'BAG', 0, 99999)],
    makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it('each instance showers the Imps +2/+1 (the run channel) and Todd itself never grows', () => {
    const r = fight(false);
    expect(buffsOn(r.events, 'm0').length, 'no self-buff').toBe(0);
    const n = r.playerImpBuffGain!.attack / 2;
    expect(n, 'several instances').toBeGreaterThan(1);
    expect(r.playerImpBuffGain).toEqual({ attack: 2 * n, health: 1 * n });
  });

  it('gilded doubles the Imp grant (+4/+2) and the card has no Ward', () => {
    const plain = fight(false).playerImpBuffGain!;
    const r = fight(true);
    expect(buffsOn(r.events, 'm0').length, 'no self-buff').toBe(0);
    expect(r.playerImpBuffGain).toEqual({ attack: 2 * plain.attack, health: 2 * plain.health });
    expect(CARD_INDEX['dm_todd']!.keywords).not.toContain('DS');
    expect(CARD_INDEX['dm_todd']!.text).toBe('When a friendly **Demon** deals damage, give your **Imps +2/+1**. **Pummel (20):** Summon an **Imp**. (Once per combat.)');
  });
});

// ── 7. MUSTER GENERAL ───────────────────────────────────────────────────────────────────────────────────────
describe('Muster General — Avenge (3): a 3/3 Trooper that attacks immediately, and improve your Troopers', () => {
  it('the Trooper token is a 3/3 and the first one lands at 3/3, the next at 4/4 (the +1/+1 step is unchanged)', () => {
    const t = CARD_INDEX['n2_trooper']!;
    expect([t.attack, t.health]).toEqual([3, 3]);
    const fodder = [0, 1, 2, 3, 4, 5].map((i) => bm('dm_clerk', `f${i}`, 0, 1));
    const r = simulate([bm('n2_muster', 'MG', 0, 400), ...fodder], [bm('dm_clerk', 'BIG', 60, 4000)],
      makeRng(11), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const troopers = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'n2_trooper')
      .map((e) => (e as unknown as { minion: { uid: string; attack: number; health: number } }).minion);
    expect(troopers.length).toBeGreaterThanOrEqual(2);
    expect([troopers[0]!.attack, troopers[0]!.health], 'the first Trooper is the printed 3/3').toEqual([3, 3]);
    const second = buffsOn(r.events, troopers[1]!.uid).find((b) => b.source === 'm0');
    expect(second, 'the second arrives improved by +1/+1').toMatchObject({ attack: 1, health: 1 });
  });

  it('live text prints the Trooper\'s current line off the token base (3/3 + accrual), plain and gilded', () => {
    expect(musterTrooperText('n2_muster', 0)).toBeNull();
    expect(musterTrooperText('n2_muster', 3)).toContain('{{6/6}} Trooper');
    expect(musterTrooperText('n2_muster', 2, true)).toContain('Gilded {{5/5}} Trooper');
    expect(CARD_INDEX['n2_muster']!.text).toBe('**Avenge (3):** summon a **3/3 Trooper** that attacks immediately, and improve your Troopers.');
  });
});

// ── 8. EXGALLOPER ───────────────────────────────────────────────────────────────────────────────────────────
describe('Exgalloper — Rebirth', () => {
  it('carries the Rebirth keyword, no effect, and the keyword text', () => {
    const d = CARD_INDEX['dw_exgalloper']!;
    expect(d.keywords).toEqual(['RB']);
    expect(d.effects).toEqual([]);
    expect(d.text).toBe('**Rebirth.**');
  });

  it('in combat it returns ONCE with its full current body, then dies for good; a gilded one returns gilded', () => {
    const r = simulate([bm('dw_exgalloper', 'X', 9, 9)], [bm('sandbag', 'B', 4, 500)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 6 }));
    const rb = r.events.filter((e) => e.type === 'reborn') as { target: string; attack: number; hp: number; rebirth?: true; keywords: string[] }[];
    expect(rb).toHaveLength(1);
    expect(rb[0]).toMatchObject({ target: 'm0', rebirth: true, attack: 9, hp: 9 });
    expect(rb[0]!.keywords).not.toContain('RB');
    expect(r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'dw_exgalloper'), 'no exact-copy Echo any more').toHaveLength(0);
    const g = simulate([bm('dw_exgalloper', 'X', 12, 12, { golden: true })], [bm('sandbag', 'B', 4, 500)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 6 }));
    expect((g.events.filter((e) => e.type === 'reborn') as { attack: number }[])[0]!.attack, 'the gilded body comes back at its 12').toBe(12);
  });
});
