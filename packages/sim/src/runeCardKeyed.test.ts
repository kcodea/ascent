import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES } from '@game/content';
import { createRun, effectiveTargetTribe, reduce, type BoardCard, type RunState } from './index';
import { advanceRuneThresholds } from './recruit';

/**
 * The 2026-08-07 owner CARD-KEYED rune batch — each rune names one specific Set-2 card and changes what that
 * card does. Five of the twelve are built here; the rest are queued (see docs/roadmap.md).
 */

const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the five defs ship as specced', () => {
  it('costs, rarity, and every one scoped to Set 2 (each names a Set-2 card)', () => {
    const spec: Record<string, [number, boolean]> = {
      rune_full_measure: [4, false], rune_mountain_trade: [5, false], rune_open_appetite: [5, false],
      // rune_broodmaster archived 2026-08-18 (ARCHIVED_RUNES) — no longer in the active RUNES/EPIC_RUNES pool.
    };
    for (const [id, [cost, epic]] of Object.entries(spec)) {
      expect(rune(id).cost, `${id} cost`).toBe(cost);
      expect(!!rune(id).epic, `${id} rarity`).toBe(epic);
      expect(rune(id).sets, `${id} must be Set-2 scoped — its subject is a Set-2 card`).toEqual(['set2']);
    }
  });
});

describe('Rune of Full Measure', () => {
  /** Play Baby Gastrid onto a Dwarf and report what the target gained. */
  const grant = (armed: boolean) => {
    const target = bm('t', 'dw_orin', 2, 2);
    const base: Partial<RunState> = {
      board: [target], hand: [bm('g', 'dw_dorrin', 3, 3)], embers: 40, goldSpentThisTurn: 4,
    };
    const built = armed ? withRune('rune_full_measure', base) : ({ ...createRun(3), phase: 'recruit', wave: 7, ...base } as RunState);
    // Gastrid scales off Gold spent THIS TURN, and buying the rune spends Gold — so the armed run would
    // otherwise start from a bigger number and the comparison would measure the purchase, not the rune.
    const s: RunState = { ...built, goldSpentThisTurn: 4 };
    const before = s.board.find((c) => c.uid === 't')!;
    const [a0, h0] = [before.attack, before.health];
    // Playing an aimed Shout only raises `pendingTarget`; the aim itself is the second action.
    const played = reduce(s, { type: 'play', uid: 'g' }) as RunState;
    const next = reduce(played, { type: 'battlecryTarget', targetUid: 't' }) as RunState;
    const after = next.board.find((c) => c.uid === 't')!;
    return { attack: after.attack - a0, health: after.health - h0 };
  };

  it('adds Attack equal to the Health, leaving the Health grant untouched', () => {
    const plain = grant(false);
    expect(plain.health, 'the baseline Health grant should be 4 Gold worth').toBeGreaterThan(0);
    expect(plain.attack, 'baseline grants no Attack').toBe(0);
    const armed = grant(true);
    expect(armed.health, 'the Health half must not change').toBe(plain.health);
    expect(armed.attack, 'Attack should match the Health 1:1').toBe(plain.health);
  });
});

describe('Rune of Open Appetite', () => {
  it('lifts the Appetite Agent’s Demon-only aim, and nothing else’s', () => {
    const agent = CARD_INDEX['dm_agent']!;
    expect(agent.targetTribe, 'the card itself still prints its restriction').toBe('demon');
    const plain = { ...createRun(3), phase: 'recruit' } as RunState;
    expect(effectiveTargetTribe(plain, agent), 'unarmed, the Demon rule stands').toBe('demon');
    const armed = withRune('rune_open_appetite');
    expect(effectiveTargetTribe(armed, agent), 'armed, any type is a legal pick').toBeUndefined();
    // Scoped to the Agent — another tribe-restricted aim keeps its rule.
    const other = [...Object.values(CARD_INDEX)].find((c) => c.targetTribe && c.id !== 'dm_agent');
    if (other) expect(effectiveTargetTribe(armed, other), `${other.id} should be unaffected`).toBe(other.targetTribe);
  });
});

describe('Rune of the Second Life (ARCHIVED 2026-08-08 with Scavvers itself)', () => {
  it('is out of the forge but still resolvable for a saved run', () => {
    // Scavvers was archived, so the rune had nothing left to modify — both went out together. The archive
    // contract is the same pair as always: unstocked, yet still resolvable so a save holding it loads.
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_second_life'), 'still stocked').toBe(false);
    expect(ARCHIVED_RUNES.some((r) => r.id === 'rune_second_life'), 'not recorded as archived').toBe(true);
    expect(RUNE_INDEX['rune_second_life'], 'a saved run holding it would fail to resolve').toBeDefined();
  });

  it('still stamps Taunt and Rise if a saved run holds both it and a Scavver', () => {
    const s = withRune('rune_second_life', { board: [bm('s', 'b2_scavenger', 3, 3)], hand: [bm('h', 'b2_scavenger', 3, 3)] });
    for (const c of [s.board[0]!, s.hand[0]!]) {
      expect(c.keywords, 'Taunt missing').toContain('T');
      expect(c.keywords, 'Rise missing').toContain('R');
    }
  });

  it('leaves other Beasts alone', () => {
    const s = withRune('rune_second_life', { board: [bm('b', 'stray', 1, 1)] });
    expect(s.board[0]!.keywords).toEqual([]);
  });

  it('is idempotent — buying it over an already-stamped board adds no duplicate pills', () => {
    const s = withRune('rune_second_life', { board: [bm('s', 'b2_scavenger', 3, 3)] });
    const again = reduce({ ...s, runeforgeOffer: ['rune_second_life'], embers: 40 }, { type: 'buyRune', index: 0 }) as RunState;
    const kw = again.board[0]!.keywords;
    expect(kw.filter((k) => k === 'T').length, 'duplicate Taunt pill').toBe(1);
    expect(kw.filter((k) => k === 'R').length, 'duplicate Rise pill').toBe(1);
  });
});

describe('Rune of the Broodmaster', () => {
  it('the Broodwright also gains what it grants an Imp, in combat', () => {
    // Imp King's death summons two Imps; each arrival fires the Broodwright's +2/+2, which the rune mirrors
    // back onto the Broodwright itself.
    const board: BoardMinion[] = [
      { cardId: 'impking', attack: 1, health: 1 },
      { cardId: 'dm_broodwright', attack: 3, health: 60 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const selfGain = (mods: object) => {
      const r = simulate(board, killer, makeRng(5), CARD_INDEX,
        combatSide({ tier: 6, tribes: ['demon'], questMods: mods as never }), combatSide());
      const bw = r.initial.player.find((m) => m.cardId === 'dm_broodwright')!;
      return r.events.filter((e) => e.type === 'buff' && (e as { target: string }).target === bw.uid)
        .reduce((n, e) => n + ((e as { attack: number }).attack + (e as { health: number }).health), 0);
    };
    expect(selfGain({}), 'baseline: a Broodwright buffs only the Imps').toBe(0);
    expect(selfGain({ runeBroodmaster: true }), 'the self-buff never landed').toBeGreaterThan(0);
  });
});

describe('Rune of Mountain Trade', () => {
  it('is a cards-played threshold that Rubies the whole board every 6 (owner rework 2026-08-11)', () => {
    // The old Mountainbond/Ale behaviour is GONE — it now rides the runeThreshold engine's `cardsPlayed` meter.
    const r = rune('rune_mountain_trade');
    expect(r.reward).toMatchObject({ kind: 'runeThreshold', meter: 'cardsPlayed', per: 6, rubyAll: true });
    expect(r.previewCards).toEqual(['ruby']);

    // Arm it through the real buyRune path, then drive the meter: playing 6 cards showers every board minion
    // with a Ruby (base 1/1 + rubyBonus), just like Gemspam does on Gold.
    const s = withRune('rune_mountain_trade', { board: [bm('a', 'sandbag', 2, 2), bm('b', 'sandbag', 3, 3)] });
    const t = (s.runeThresholds ?? []).find((x) => x.rubyAll && x.meter === 'cardsPlayed');
    expect(t, 'the cardsPlayed threshold was never armed').toBeDefined();
    advanceRuneThresholds(s, 'cardsPlayed', 6);
    expect([s.board[0]!.attack, s.board[0]!.health], 'left minion took a Ruby').toEqual([3, 3]); // 2/2 + 1/1
    expect([s.board[1]!.attack, s.board[1]!.health], 'right minion took a Ruby').toEqual([4, 4]); // 3/3 + 1/1
  });
});
