/**
 * COMBAT PROWESS x AN ANCIENT'S START OF COMBAT (owner bug report 2026-11-27: "combat prowess didnt trigger", Gorun with the Ancient
 * of Genesis: "Start of Combat: your two left-most minions gain Ward and Flurry"). Combat Prowess replays every Start of Combat
 * effect at End of Turn with Shop semantics, so the two left-most board minions keep Ward and Flurry. The owner then ruled "All of
 * them": every Ancient Start of Combat replays the same way (the second block). R-PROWESS-ANCIENT-SOC-01.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type AncientId, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, socRuneReplaysOf } from './recruit';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';

const card = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const PLAIN = 'n2_spellsword';
const gorun = (id: AncientId, prowess: boolean): RunState => {
  let s = enableAncients({ ...createRun(7, 'gorun'), phase: 'recruit', embers: 60, hand: [] } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  if (prowess) {
    s = reduce({ ...s, embers: 60, runeforgeOffer: ['rune_combat_prowess'], runeforgeEpic: !!RUNE_INDEX.rune_combat_prowess!.epic }, { type: 'buyRune', index: 0 });
    expect(s.runeCombatProwess, 'Combat Prowess owned').toBeTruthy();
  }
  return { ...s, board: [card('a', PLAIN), card('b', PLAIN), card('c', PLAIN)] };
};

describe('Combat Prowess replays an Ancient Start of Combat (Gorun x Genesis)', () => {
  it('is on the End of Turn replay list', () => {
    expect(socRuneReplaysOf(gorun('genesis', true)).some((r) => r.label === 'Blade Mastery')).toBe(true);
    expect(socRuneReplaysOf(gorun('death', true)).some((r) => r.label === 'Blade Mastery')).toBe(false);
  });

  it('the two left-most minions gain Ward and Flurry, permanently; the third does not', () => {
    const s = gorun('genesis', true);
    socRuneReplaysOf(s).find((r) => r.label === 'Blade Mastery')!.fire(s);
    expect(s.board.map((m) => [m.keywords.includes('DS'), m.keywords.includes('W')])).toEqual([[true, true], [true, true], [false, false]]);
  });

  it('the real End of Turn grants it (and without Combat Prowess it does not)', () => {
    const s = gorun('genesis', true);
    applyEndOfTurn(s);
    expect(s.board.slice(0, 2).every((m) => m.keywords.includes('DS') && m.keywords.includes('W'))).toBe(true);
    const none = gorun('genesis', false);
    applyEndOfTurn(none);
    expect(none.board.some((m) => m.keywords.includes('W'))).toBe(false);
  });
});

// ── EVERY OTHER ANCIENT START OF COMBAT (owner ruling 2026-11-27: "All of them") ─────────────────────────────────────
// Each is applied by the real End of Turn under Combat Prowess (a permanent Shop effect) and not without it.
const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const DUOS_HEROES = new Set(['priestess', 'magician', 'cindy']);
const run = (hero: string, id: AncientId, prowess: boolean, board: BoardCard[], over: Partial<RunState> = {}): RunState => {
  let s = DUOS_HEROES.has(hero)
    ? ({ ...createVersusRun(11, hero, 'set2', DUOS, 'warden', { ancients: true }), phase: 'recruit', embers: 60, hand: [], shop: [], spell: null } as RunState)
    : enableAncients({ ...createRun(7, hero), phase: 'recruit', embers: 60, hand: [], discover: undefined, discoverQueue: undefined } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  if (prowess) {
    s = reduce({ ...s, embers: 60, runeforgeOffer: ['rune_combat_prowess'], runeforgeEpic: !!RUNE_INDEX.rune_combat_prowess!.epic }, { type: 'buyRune', index: 0 });
    expect(s.runeCombatProwess, 'Combat Prowess owned').toBeTruthy();
  }
  return { ...s, board, ...over };
};
/** End of Turn with Combat Prowess and without; returns [on, off]. */
const eot = (hero: string, id: AncientId, board: () => BoardCard[], over: Partial<RunState> = {}, ancients: Partial<NonNullable<RunState['ancients']>> = {}): [RunState, RunState] => {
  const out = [true, false].map((p) => {
    const s = run(hero, id, p, board(), over);
    s.ancients = { ...s.ancients!, ...ancients };
    applyEndOfTurn(s);
    return s;
  });
  return [out[0]!, out[1]!];
};
const plains = (n: number, cardId = PLAIN): BoardCard[] => Array.from({ length: n }, (_, i) => card(`p${i}`, cardId));
const stats = (s: RunState): string[] => s.board.map((m) => `${m.attack}/${m.health}`);
const BEAST = 'beetle';
const DWARF = 'dw_brakka';
const TIER7 = 'attachmentconductor';
const SHOUT = 'alley'; // Battlecry: summon a 1/1 Stray next to it

describe('Combat Prowess replays every Ancient Start of Combat at End of Turn (permanent Shop effects)', () => {
  it('Indy x Time: the right-most minion becomes Gilded', () => {
    const [on, off] = eot('indy', 'time', () => plains(3));
    expect(on.board.map((m) => !!m.golden)).toEqual([false, false, true]);
    expect(off.board.some((m) => m.golden)).toBe(false);
  });

  it('Cindy x War (Duos): the left-most minion becomes Gilded', () => {
    const [on, off] = eot('cindy', 'war', () => plains(3));
    expect(on.board.map((m) => !!m.golden)).toEqual([true, false, false]);
    expect(off.board.some((m) => m.golden)).toBe(false);
  });

  it('Xerox x War: an exact copy of the highest-Health minion beside it; a full board sends it to hand', () => {
    const big = (): BoardCard[] => [card('a', PLAIN), { ...card('b', PLAIN), health: 40 }, card('c', PLAIN)];
    const [on, off] = eot('xerox', 'war', big);
    const h = CARD_INDEX[PLAIN]!.health;
    expect(on.board.map((m) => m.health)).toEqual([h, 40, 40, h]);
    expect(off.board).toHaveLength(3);
    const [full] = eot('xerox', 'war', () => [...plains(6), { ...card('b', PLAIN), health: 40 }]);
    expect(full.board).toHaveLength(7);
    expect(full.hand.map((c) => c.health)).toEqual([40]);
  });

  it('Braum x War: every minion +8/+8 per Gilded minion played this game', () => {
    const [on, off] = eot('bram', 'war', () => plains(2), {}, { bramGildedPlays: 2 });
    const p = CARD_INDEX[PLAIN]!;
    expect(stats(on)).toEqual([`${p.attack + 16}/${p.health + 16}`, `${p.attack + 16}/${p.health + 16}`]);
    expect(stats(off)).toEqual([`${p.attack}/${p.health}`, `${p.attack}/${p.health}`]);
  });

  it('Braum x Bonds: Neutral minions triple their stats; a typed minion does not', () => {
    const [on, off] = eot('bram', 'bonds', () => [card('n', PLAIN), card('b', BEAST)]);
    const p = CARD_INDEX[PLAIN]!, b = CARD_INDEX[BEAST]!;
    expect(stats(on)).toEqual([`${p.attack * 3}/${p.health * 3}`, `${b.attack}/${b.health}`]);
    expect(stats(off)).toEqual([`${p.attack}/${p.health}`, `${b.attack}/${b.health}`]);
  });

  it('Flint x War: Dwarves +1/+1 per Dwarf bought this game; other minions nothing', () => {
    const [on, off] = eot('flint', 'war', () => [card('d', DWARF), card('n', PLAIN)], {}, { flintDwarvesBought: 3 });
    const d = CARD_INDEX[DWARF]!, p = CARD_INDEX[PLAIN]!;
    expect(stats(on)).toEqual([`${d.attack + 3}/${d.health + 3}`, `${p.attack}/${p.health}`]);
    expect(stats(off)).toEqual([`${d.attack}/${d.health}`, `${p.attack}/${p.health}`]);
  });

  it('Priestess x War (Duos): every minion +2/+2 per card passed this game', () => {
    const passed = (wave: number, seq: number) => ({ seq, wave, card: card(`x${seq}`, PLAIN), from: 'hand' as const, index: 0 });
    const [on, off] = [true, false].map((p) => {
      const s = run('priestess', 'war', p, plains(1));
      s.duos = { ...s.duos!, outbox: [passed(1, 0), passed(2, 1)] };
      applyEndOfTurn(s);
      return s;
    });
    const pl = CARD_INDEX[PLAIN]!;
    expect(stats(on!)).toEqual([`${pl.attack + 4}/${pl.health + 4}`]);
    expect(stats(off!)).toEqual([`${pl.attack}/${pl.health}`]);
  });

  it('Midas x War: one Ward per Gilded minion, each to a distinct minion without Ward', () => {
    const board = (): BoardCard[] => [{ ...card('g', PLAIN), golden: true }, card('a', PLAIN), card('b', PLAIN), card('c', PLAIN)];
    const [on, off] = eot('midas', 'war', board);
    expect(on.board.filter((m) => m.keywords.includes('DS'))).toHaveLength(1);
    expect(off.board.some((m) => m.keywords.includes('DS'))).toBe(false);
  });

  it('Gorun x Time: every minion gains the current Blade Mastery grant once (+3 Attack), for good', () => {
    const [on, off] = eot('gorun', 'time', () => plains(2));
    const p = CARD_INDEX[PLAIN]!;
    expect(on.board.map((m) => m.attack)).toEqual([p.attack + 3, p.attack + 3]);
    expect(off.board.map((m) => m.attack)).toEqual([p.attack, p.attack]);
  });

  it('Drakko x War: +1/+1 to a random minion, once plus once per Shout triggered this turn', () => {
    const [on, off] = eot('drakko', 'war', () => plains(3), { shoutFiresThisTurn: 2 });
    const p = CARD_INDEX[PLAIN]!;
    const gained = (s: RunState): number => s.board.reduce((n, m) => n + (m.attack - p.attack) + (m.health - p.health), 0);
    expect(gained(on)).toBe(6);
    expect(gained(off)).toBe(0);
  });

  it('Nadja x War: the left-most minion gains Rally (+2 Attack per Gold spent), kept and grown, never stacked', () => {
    const [on, off] = eot('nadja', 'war', () => plains(2), { goldSpentThisTurn: 5 });
    const rally = (s: RunState) => s.board[0]!.grantedEffects?.filter((e) => e.do === 'rallyBuff') ?? [];
    expect(on.board[0]!.keywords).toContain('RL');
    expect(rally(on).map((e) => e.params?.attack)).toEqual([10]);
    expect(rally(off)).toHaveLength(0);
    on.goldSpentThisTurn = 3; // a second End of Turn grows the one graft
    applyEndOfTurn(on);
    expect(rally(on).map((e) => e.params?.attack)).toEqual([16]);
  });

  it('Brackus x War: an exact copy of the left-most Tier 7 minion, and a plain copy to hand', () => {
    const [on, off] = eot('brackus', 'war', () => [card('n', PLAIN), { ...card('t', TIER7), attack: 30 }]);
    expect(on.board.map((m) => m.cardId)).toEqual([PLAIN, TIER7, TIER7]);
    expect(on.board[2]!.attack).toBe(30);
    expect(on.hand.map((c) => c.cardId)).toEqual([TIER7]);
    expect(off.board).toHaveLength(2);
    expect(off.hand).toHaveLength(0);
  });

  it('Auctioneer x Time: the left-most and right-most Shouts trigger', () => {
    const [on, off] = eot('myra', 'time', () => [card('a', SHOUT), card('n', PLAIN), card('b', SHOUT)]);
    expect(on.board.filter((m) => m.cardId === 'stray')).toHaveLength(2);
    expect(off.board.filter((m) => m.cardId === 'stray')).toHaveLength(0);
  });

  it('Drakko x Time: the left-most Shout triggers again (on top of its own End of Turn trigger)', () => {
    const [on, off] = eot('drakko', 'time', () => [card('a', SHOUT), card('n', PLAIN), card('b', SHOUT)]);
    expect(off.board.filter((m) => m.cardId === 'stray')).toHaveLength(1);
    expect(on.board.filter((m) => m.cardId === 'stray')).toHaveLength(2);
  });

  it('Magician x War (Duos) needs the teammate board, which the Shop never holds: not replayed', () => {
    expect(socRuneReplaysOf(run('magician', 'war', true, plains(2)))).toHaveLength(0);
  });
});
