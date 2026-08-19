import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * SET 2 — the 2026-08-18 Dragon batch (owner add): behavioural coverage for the NEW mechanics. Combat cases drive
 * `simulate`; recruit cases drive the reducer. Where a value carries out of combat the assertion is the carry-back
 * channel; otherwise we read the event log / board state, which is stabler than exact event counts.
 */

// A combat body. `uid` becomes the minion's `sourceUid`.
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });
const buffsFrom = (events: CombatEvent[], uid: string) =>
  events.filter((e) => (e as { type: string; source?: string }).type === 'buff' && (e as { source?: string }).source === uid)
    .map((e) => e as { attack: number; health: number; source: string });
const buffEvents = (events: CombatEvent[]) =>
  events.filter((e) => e.type === 'buff') as { target: string; source: string; attack: number; health: number }[];

const minion = (uid: string, cardId: string, attack?: number, health?: number): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: attack ?? d.attack, health: health ?? d.health, keywords: [...d.keywords], golden: false };
};
const spellInHand = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

const enemyWall = { cardId: 'sandbag', attack: 0, health: 40000 };

// ── Fel Spikes demon-damage attribution (the 2026-08-18 `ctx.damage` source fix) ─────────────────────────────
describe('set 2 — Fel Spikes echo attributes damage to a friendly Demon (the source fix)', () => {
  it('every LANDED echo hit — including on your own non-Demon — procs friendlyDemonDealtDamage reactors', () => {
    // Board: Fel Spikes (Taunt, 1 HP — dies to the attacker and echoes 4 to everyone but friendly Demons), a
    // friendly Axeman reactor (`dm_chosenfiend`, 0 Attack so it never swings on its own), and TWO friendly
    // non-Demon walls (echo hits both). Since Fel Spikes is the Demon SOURCE of the echo, each landed hit —
    // enemy or your own non-Demon — should register as a friendly Demon dealing damage and proc the Axeman.
    const withWalls = (nWalls: number) => {
      const board: BoardMinion[] = [bm('dm_felspikes', 'FS', 4, 1, ['T']), bm('dm_chosenfiend', 'AX', 0, 400)];
      for (let i = 0; i < nWalls; i++) board.push(bm('sandbag', `W${i}`, 0, 400));
      const r = simulate(board, [bm('dm_clerk', 'ED', 10, 40)],
        makeRng(3), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
      return buffsFrom(r.events, 'm1'); // the Axeman
    };
    const oneWall = withWalls(1);
    const twoWalls = withWalls(2);
    // The reactor gains from the echo — more than zero, and MORE landed targets means MORE procs.
    expect(oneWall.length, 'the Axeman reacted to the echo').toBeGreaterThan(0);
    expect(oneWall.every((b) => b.attack === 3 && b.health === 3), 'each Axeman proc is +3/+3').toBe(true);
    expect(twoWalls.length, 'an extra friendly non-Demon target adds a proc').toBeGreaterThan(oneWall.length);
  });
});

// ── Dragonflame (sp_dragonflame): 1 + (#Dragons) buffs of +4/+4 ──────────────────────────────────────────────
describe('set 2 — Dragonflame buffs 1 + (#Dragons) random friendlies +4/+4', () => {
  it('shop cast: total stats added across the board == (1 + N Dragons) × +4/+4', () => {
    // Three Dragons on board → reps = 1 + 3 = 4 grants, each +4/+4 (random friendly, with replacement). The
    // TOTAL across the board is deterministic even though the split is random. (Distinct Dragon ids, so three
    // copies never triple into a golden.)
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('d1', 'd2_broodfire', 3, 3), minion('d2', 'd2_roarcollector', 3, 3), minion('d3', 'd2_flutterdrake', 3, 3)],
      hand: [spellInHand('sp', 'sp_dragonflame')],
    };
    const baseAtk = s.board.reduce((n, c) => n + c.attack, 0);
    const baseHp = s.board.reduce((n, c) => n + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'sp' });
    const gainAtk = s.board.reduce((n, c) => n + c.attack, 0) - baseAtk;
    const gainHp = s.board.reduce((n, c) => n + c.health, 0) - baseHp;
    expect(gainAtk, '(1 + 3) × +4 attack').toBe(16);
    expect(gainHp, '(1 + 3) × +4 health').toBe(16);
  });

  it('shop cast with NO Dragons still fires the base grant once (+4/+4)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('b', 'alley', 2, 2)], // a lone Beast — base grant only
      hand: [spellInHand('sp', 'sp_dragonflame')],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const b = s.board.find((c) => c.uid === 'b')!;
    expect([b.attack, b.health], 'the base grant landed on the only friendly').toEqual([6, 6]);
  });

  it('combat cast: Flamebeat Drake’s Rally casts Dragonflame mid-fight (+4/+4 buffs appear)', () => {
    const r = simulate(
      [bm('d2_flamebeat', 'FB', 6, 9999, ['RL']), bm('d2_broodfire', 'D', 2, 9999)],
      [enemyWall],
      makeRng(5), CARD_INDEX, combatSide({ tier: 5, tribes: ['dragon'] }), combatSide({ tier: 1 }));
    const four = buffEvents(r.events).filter((b) => b.attack === 4 && b.health === 4);
    expect(four.length, 'Flamebeat’s swing cast Dragonflame, landing +4/+4 grants').toBeGreaterThan(0);
  });
});

// ── Flutter (sp_flutter): +10 Health, plus Flurry for a Dragon ───────────────────────────────────────────────
describe('set 2 — Flutter gives +10 Health, and Flurry only to a Dragon', () => {
  it('cast on a Dragon → +10 Health AND the Flurry keyword', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('d', 'd2_broodfire', 3, 4)],
      hand: [spellInHand('f', 'sp_flutter')],
    };
    s = reduce(s, { type: 'play', uid: 'f', targetUid: 'd' });
    const d = s.board.find((c) => c.uid === 'd')!;
    expect([d.attack, d.health], 'Health only, +10').toEqual([3, 14]);
    expect(d.keywords.includes('W'), 'a Dragon also gains Flurry').toBe(true);
  });

  it('cast on a non-Dragon → +10 Health only, no Flurry', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('b', 'alley', 2, 2)],
      hand: [spellInHand('f', 'sp_flutter')],
    };
    s = reduce(s, { type: 'play', uid: 'f', targetUid: 'b' });
    const b = s.board.find((c) => c.uid === 'b')!;
    expect([b.attack, b.health], 'Health only, +10').toEqual([2, 12]);
    expect(b.keywords.includes('W'), 'a non-Dragon does NOT gain Flurry').toBe(false);
  });
});

// ── A few of the new minions ─────────────────────────────────────────────────────────────────────────────────
describe('set 2 — new Dragon minions', () => {
  it('Cinderchef (Rally) grows itself +1/+1 on each swing', () => {
    const r = simulate(
      [bm('d2_cinderchef', 'CC', 3, 9999, ['RL'])],
      [enemyWall],
      makeRng(5), CARD_INDEX, combatSide({ tier: 1, tribes: ['dragon'] }), combatSide({ tier: 1 }));
    const cc = buffsFrom(r.events, 'm0');
    expect(cc.length, 'it swung repeatedly and self-buffed each time').toBeGreaterThan(1);
    expect(cc.every((b) => b.attack === 1 && b.health === 1), 'each Rally grant is +1/+1').toBe(true);
  });

  it('Broodfire (Shout) buffs your Dragons +2/+2 — itself included, a non-Dragon excluded', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('d', 'd2_cinderchef', 1, 3), minion('b', 'alley', 2, 2)],
      hand: [minion('bf', 'd2_broodfire', 2, 4)],
    };
    s = reduce(s, { type: 'play', uid: 'bf' });
    const dragon = s.board.find((c) => c.uid === 'd')!;
    const beast = s.board.find((c) => c.uid === 'b')!;
    const brood = s.board.find((c) => c.uid === 'bf')!;
    expect([dragon.attack, dragon.health], 'the other Dragon gains +2/+2').toEqual([3, 5]);
    expect([brood.attack, brood.health], 'Broodfire buffs itself too').toEqual([4, 6]);
    expect([beast.attack, beast.health], 'a non-Dragon gains nothing').toEqual([2, 2]);
  });

  it('River Drake: selling it puts a Spell in your hand', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 10,
      board: [minion('rd', 'd2_riverdrake', 4, 3)], hand: [],
    };
    const before = s.hand.length;
    s = reduce(s, { type: 'sell', uid: 'rd' });
    const gainedSpell = s.hand.find((c) => CARD_INDEX[c.cardId]?.spell);
    expect(s.hand.length, 'a card entered hand on sell').toBeGreaterThan(before);
    expect(gainedSpell, 'and it is a Spell').toBeTruthy();
  });

  it('Embercrest (Rally) re-triggers an adjacent Dragon’s Shout in combat', () => {
    // Board: Embercrest (RL) beside Broodfire (a Dragon Shout). Broodfire's Shout does NOT fire in combat on its
    // own (it was played back in recruit), so any +2/+2 buff event in the fight is Embercrest re-firing it.
    const r = simulate(
      [bm('d2_embercrest', 'EC', 8, 9999, ['RL']), bm('d2_broodfire', 'BF', 2, 9999)],
      [enemyWall],
      makeRng(6), CARD_INDEX, combatSide({ tier: 6, tribes: ['dragon'] }), combatSide({ tier: 1 }));
    const twoBuffs = buffEvents(r.events).filter((b) => b.attack === 2 && b.health === 2);
    expect(twoBuffs.length, 'Embercrest’s swing re-fired Broodfire’s +2/+2 Shout').toBeGreaterThan(0);
  });
});
