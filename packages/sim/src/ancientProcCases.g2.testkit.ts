/** Ancient trigger proc cases, group 2 (R-FX-ANCIENT-PROC-01): see `ancientProcs.test.ts`. */
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import { isAncientBuffLabel, prepareActionWithPresentation, reduce, type Action, type BoardCard, type RunState } from './index';
import { body, eotAncientBeats, fight, foes, pickedRun, shopProcs, shopProcsOver, sotProcsAfterFight, type ProcCase } from './ancientProcs.testkit';
import { destroyMinionInShop, makeContext } from './recruit';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number): string => NEUTRALS[i % NEUTRALS.length]!;
const gilded = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return body(uid, cardId, { golden: true, attack: d.attack * 2, health: d.health * 2, ...over });
};
const procsOf = (s: RunState): number => s.ancients?.procs ?? 0;
/** Kill board minion `uid` in the Shop (every Shop death path's shared body), mutating `s`. */
const shopKill = (s: RunState, uid: string): void => { destroyMinionInShop(makeContext(s), s.board.find((c) => c.uid === uid)!); };

// AYSE: inert rule bodies (Ayse's own suite), Clubs pinned so no prize opens a modal.
const AYSE_BODIES = ['drummer', 'sylus', 'yazzus', 'zyff', 'attachmentconductor', 'mauron'].filter((id) => plain(CARD_INDEX[id]!));
const AY = (i: number): string => AYSE_BODIES[i % AYSE_BODIES.length]!;
const CIA: Partial<RunState> = { embers: 99, ciaSuit: 'clubs', ciaEnchantedBought: 0 } as Partial<RunState>;
/** Buy each `[cardId, enchanted]` from a one-offer row (suit pinned to Clubs), summing the Shop procs. */
function ciaBuys(s: RunState, buys: readonly (readonly [string, boolean])[]): { s: RunState; procs: number } {
  let procs = 0;
  for (const [id, ench] of buys) {
    const r = shopProcs({ ...s, hand: [], shop: [{ uid: 'o', cardId: id, ...(ench ? { enchanted: true } : {}) } as RunState['shop'][number]], ciaSuit: 'clubs' } as RunState, { type: 'buy', uid: 'o' });
    if (r.next === s) throw new Error(`could not buy ${id}`);
    s = r.next; procs += r.procs;
  }
  return { s, procs };
}

/** `eotAncientBeats`, but a child TRIGGER counts as the beat's consequence too: Darah × Time's beat carries only the
 *  nested Lasso cast (a spell `sourceTrigger` whose `cardGranted` hangs under it), which the shared counter skips. */
function eotAncientBeatsNested(state: RunState): number {
  const prepared = prepareActionWithPresentation(state, { type: 'faceOmen' });
  const events = (prepared.batch?.events ?? []) as { type: string; id?: string; parentId?: string; source?: { kind: string; label?: string } }[];
  const parents = new Set(events.map((e) => e.parentId));
  return events.filter((e) => e.type === 'sourceTrigger' && e.source?.kind === 'hero' && isAncientBuffLabel(e.source.label) && parents.has(e.id)).length;
}

// BRACKUS: createRun opens the Summit Discover; clear it (Brackus' own suite does the same).
const BRACKUS: Partial<RunState> = { embers: 400, discover: undefined, discoverQueue: undefined, discoverLockGold: undefined } as Partial<RunState>;
/** Spend exactly `gold` through the real buy path (a set-price offer). */
function spendGold(s: RunState, gold: number, u: string): { next: RunState; procs: number } {
  const r = shopProcs({ ...s, shop: [{ uid: u, cardId: N(0), cost: gold } as RunState['shop'][number]] }, { type: 'buy', uid: u });
  if (r.next === s) throw new Error(`could not spend ${gold}`);
  return r;
}

// RAYSE: an Echo that summons a fixed body count (Rayse's own suite's fixture).
const RAYSE_ECHO = (): string => Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon'
  && !(c.effects[0]!.params as { fixed?: boolean }).fixed)!.id;
const summonsOf = (events: readonly CombatEvent[]): number => events.filter((e) => e.type === 'summon' && e.side === 'player').length;

const CASSEN: Partial<RunState> = { embers: 60, lastCommission: 'citadel' } as Partial<RunState>;
/** Flash's foe board: distinct bodies in a fixed order. */
const flashFoes = (wave: number, minions: { cardId: string; attack: number; health: number }[]): ReturnType<typeof foes> =>
  ({ ...foes(wave, 1, 1), minions: minions.map((m) => ({ ...m, keywords: [] })) } as ReturnType<typeof foes>);
/** Deterministic counts read off one fixed scenario each (each case also checks them against the fight's own tally). */
const DRAKKO_BONDS_FIRES = 2;
const MIDAS_BONDS_FIRES = 2;

export const CASES: ProcCase[] = [
  // ── BRAUM (bram) ──────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: every 16th friendly death pays. 14 → 15 is a tick (no proc), 15 → 0 pays; again from 15 pays.
  {
    hero: 'bram', ancient: 'death', phase: 'shop', fires: 2,
    note: 'a tick (14 to 15) does not proc; two 16th deaths do',
    run: () => {
      let s = pickedRun('bram', 'death', { tier: 3 });
      s = structuredClone({ ...s, ancients: { ...s.ancients!, bramDeaths: 14 }, board: [body('x', N(0)), body('y', N(1)), body('z', N(2))] });
      const p0 = procsOf(s);
      shopKill(s, 'x');
      if (procsOf(s) !== p0) throw new Error('a tick procced');
      shopKill(s, 'y');
      s.ancients!.bramDeaths = 15;
      shopKill(s, 'z');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: the carried 15 pays at the first friendly death; the next two deaths only tick.
  {
    hero: 'bram', ancient: 'death', phase: 'combat', fires: 1,
    note: 'three friendly deaths from a carried 15: one payout',
    run: () => {
      let s = pickedRun('bram', 'death', { wave: 4, tier: 3, board: ['a', 'b', 'c'].map((u, i) => body(u, N(i), { attack: 1, health: 1 })) });
      s = { ...s, ancients: { ...s.ancients!, bramDeaths: 15 } };
      return fight(s, foes(s.wave, 100, 1000)).procs;
    },
  },
  // FORTUNE: two Gilded plays = two Triple Rewards = two 3-Gold payouts.
  {
    hero: 'bram', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'two Gilded plays, each Triple Reward pays',
    run: () => {
      let s = pickedRun('bram', 'fortune', { hand: [gilded('g1', N(0)), gilded('g2', N(1))] });
      let procs = 0;
      for (const uid of ['g1', 'g2']) { const r = shopProcs(s, { type: 'play', uid }); s = r.next; procs += r.procs; }
      return procs;
    },
  },
  // WAR: Start of Combat, one grant per fight.
  {
    hero: 'bram', ancient: 'war', phase: 'combat', fires: 1,
    note: 'two Gilded plays banked: one Start of Combat grant',
    run: () => {
      let s = pickedRun('bram', 'war', { board: [body('a', N(0), { health: 40 })] });
      s = { ...s, ancients: { ...s.ancients!, bramGildedPlays: 2 } };
      return fight(s, foes(s.wave, 0, 400)).procs;
    },
  },
  // TIME: the Discovered Tier 5's copy, one beat per Start of Turn.
  {
    hero: 'bram', ancient: 'time', phase: 'sot', fires: 2,
    note: 'two Start of Turns, a copy each',
    run: () => {
      let s = pickedRun('bram', 'time', { tier: 2, wave: 3 });
      s = { ...s, ancients: { ...s.ancients!, bramTimeCardId: 'n2_spellsword' } };
      const a = sotProcsAfterFight(s, foes(s.wave, 0, 1));
      const b = sotProcsAfterFight({ ...a.s, hand: [] }, foes(a.s.wave, 0, 1));
      return a.procs + b.procs;
    },
  },
  // BONDS: Start of Combat, one tripling per fight (a typed minion beside it changes nothing).
  {
    hero: 'bram', ancient: 'bonds', phase: 'combat', fires: 1,
    note: 'one Neutral + one typed minion: one Start of Combat fire',
    run: () => {
      const s = pickedRun('bram', 'bonds', { board: [body('n', 'n2_spellsword', { attack: 3, health: 40 }), body('w', 'whelpling', { attack: 2, health: 40 })] });
      return fight(s, foes(s.wave, 0, 400)).procs;
    },
  },

  // ── AYSE (cia) ────────────────────────────────────────────────────────────────────────────────────────────────
  // WAR: each Enchanted MINION buy fires; a plain buy does not.
  {
    hero: 'cia', ancient: 'war', phase: 'shop', fires: 2,
    note: 'two Enchanted minion buys fire, a plain buy between them does not',
    run: () => ciaBuys(pickedRun('cia', 'war', CIA), [[AY(0), true], [AY(1), false], [AY(2), true]]).procs,
  },
  // GENESIS: completing Lucky Seat (the 3rd Enchanted buy) pays a copy; buys 1 and 2 are ticks. Two cycles = two fires.
  {
    hero: 'cia', ancient: 'genesis', phase: 'shop', fires: 2,
    note: 'six Enchanted buys = two Lucky Seat completions',
    run: () => ciaBuys(pickedRun('cia', 'genesis', CIA), Array.from({ length: 6 }, (_, i) => [AY(i), true] as [string, boolean])).procs,
  },
  // TIME: the End-of-Turn grant's own beat (Enchanted buys this turn > 0).
  {
    hero: 'cia', ancient: 'time', phase: 'eot', fires: 1,
    note: 'two Enchanted buys this turn: the End-of-Turn grant beat',
    run: () => {
      const s = ciaBuys(pickedRun('cia', 'time', { ...CIA, board: [body('a', AY(3)), body('b', AY(4))] }), [[AY(0), true], [AY(1), true]]).s;
      return eotAncientBeats({ ...s, hand: [] });
    },
  },
  // ── DARAH ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // WAR: Pummel (200), twice per combat: three+ crossings pay two charges (the third is spent). Aliased flag.
  {
    hero: 'darah', ancient: 'war', phase: 'combat', fires: 2,
    note: '600+ damage dealt: two charges (the cap), a third crossing pays nothing',
    run: () => {
      const s = pickedRun('darah', 'war', { wave: 3, board: [body('a', N(0), { attack: 100, health: 900 }), body('b', N(1), { attack: 100, health: 900 })] });
      return fight(s, foes(s.wave, 1, 3000)).procs;
    },
  },
  // TIME: End of Turn casts Lasso, its own beat.
  {
    hero: 'darah', ancient: 'time', phase: 'eot', fires: 1,
    note: 'one Shop minion to steal: the Lasso beat',
    run: () => eotAncientBeatsNested(pickedRun('darah', 'time', { embers: 99, board: [body('a', N(0))], shop: [{ uid: 'o', cardId: N(1) } as RunState['shop'][number]] })),
  },
  // ── NADJA ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: every 6th friendly Shop death; 4 → 5 is a tick.
  {
    hero: 'nadja', ancient: 'death', phase: 'shop', fires: 2,
    note: 'a tick (4 to 5) does not proc; two 6th deaths do',
    run: () => {
      let s = pickedRun('nadja', 'death', { embers: 99 });
      s = structuredClone({ ...s, ancients: { ...s.ancients!, nadjaDeaths: 4 }, board: [body('x', N(0)), body('y', N(1)), body('z', N(2))] });
      const p0 = procsOf(s);
      shopKill(s, 'x');
      if (procsOf(s) !== p0) throw new Error('a tick procced');
      shopKill(s, 'y');
      s.ancients!.nadjaDeaths = 5;
      shopKill(s, 'z');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: a carried 5 pays at the first death (aliased flag); two more deaths only tick.
  {
    hero: 'nadja', ancient: 'death', phase: 'combat', fires: 1,
    note: 'six friendly deaths in the fight: one Avenge (6) (the Shop count of 5 never comes in)',
    run: () => {
      let s = pickedRun('nadja', 'death', { embers: 99, board: ['a', 'b', 'c', 'd', 'e', 'f'].map((u) => body(u, N(1), { attack: 1, health: 1 })) });
      s = { ...s, ancients: { ...s.ancients!, nadjaDeaths: 5 } };
      return fight(s, foes(s.wave, 100, 1000)).procs;
    },
  },
  // WAR: Start of Combat grants the Rally (Gold spent this turn > 0), one fire per fight.
  {
    hero: 'nadja', ancient: 'war', phase: 'combat', fires: 1,
    note: 'a 3-Gold buy, then the fight: the Start of Combat Rally grant',
    run: () => {
      let s = pickedRun('nadja', 'war', { embers: 99, board: [body('a', N(0), { attack: 2, health: 50 }), body('b', N(1), { attack: 1, health: 50 })] });
      s = reduce({ ...s, shop: [{ uid: 'o', cardId: N(2) } as RunState['shop'][number]] }, { type: 'buy', uid: 'o' });
      return fight({ ...s, hand: [] }, foes(s.wave, 0, 400)).procs;
    },
  },
  // TIME: End of Turn +1 max Gold, its own beat.
  {
    hero: 'nadja', ancient: 'time', phase: 'eot', fires: 1,
    note: 'the End-of-Turn max Gold beat',
    run: () => eotAncientBeats(pickedRun('nadja', 'time', { embers: 99, board: [body('a', N(0), { health: 99 })] })),
  },
  // BONDS: every spend of 1+ Gold; a free Refresh is not a spend.
  {
    hero: 'nadja', ancient: 'bonds', phase: 'shop', fires: 3,
    note: 'two paid Refreshes and a buy fire; a free Refresh does not',
    run: () => {
      let s = pickedRun('nadja', 'bonds', { embers: 99, board: [body('a', N(0)), body('b', N(1)), body('c', N(2))] });
      let procs = 0;
      const step = (st: RunState, action: Action): void => { const r = shopProcs(st, action); s = r.next; procs += r.procs; };
      step(s, { type: 'roll' });
      const free = shopProcs({ ...s, freeRolls: 1 }, { type: 'roll' });
      if (free.procs !== 0) throw new Error('a free Refresh procced');
      step(free.next, { type: 'roll' }); // the free Refresh is spent: this one pays
      step({ ...s, shop: [{ uid: 'o', cardId: N(3) } as RunState['shop'][number]] }, { type: 'buy', uid: 'o' });
      return procs;
    },
  },
  // ── BRACKUS ───────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: every 3rd friendly death; 1 → 2 is a tick.
  {
    hero: 'brackus', ancient: 'death', phase: 'shop', fires: 2,
    note: 'a tick (1 to 2) does not proc; two 3rd deaths do',
    run: () => {
      let s = pickedRun('brackus', 'death', BRACKUS);
      s = structuredClone({ ...s, ancients: { ...s.ancients!, brackusDeaths: 1 }, board: [body('x', N(0)), body('y', N(1)), body('z', N(2)), body('t', 'drummer')] });
      const p0 = procsOf(s);
      shopKill(s, 'x');
      if (procsOf(s) !== p0) throw new Error('a tick procced');
      shopKill(s, 'y');
      s.ancients!.brackusDeaths = 2;
      shopKill(s, 'z');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: a carried 2 pays at the first death (aliased flag); the next death only ticks.
  {
    hero: 'brackus', ancient: 'death', phase: 'combat', fires: 1,
    note: 'three 1/1 deaths in the fight: one Avenge (3) (the Shop count of 2 never comes in)',
    run: () => {
      let s = pickedRun('brackus', 'death', { ...BRACKUS, wave: 3, board: [body('a', 'drummer', { attack: 1, health: 500 }), body('f1', N(2), { attack: 1, health: 1 }), body('f2', N(2), { attack: 1, health: 1 }), body('f3', N(2), { attack: 1, health: 1 })] });
      s = { ...s, ancients: { ...s.ancients!, brackusDeaths: 2 } };
      const r = fight(s, foes(s.wave, 2, 60));
      const deaths = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
      if (deaths !== 3) throw new Error(`expected 3 friendly deaths, saw ${deaths}`);
      return r.procs;
    },
  },
  // FORTUNE: every 50 Gold spent opens a Tier 7 Discover; 30 is a tick, 25 crosses once, 100 crosses twice.
  {
    hero: 'brackus', ancient: 'fortune', phase: 'shop', fires: 3,
    note: '30 (no fire), 25 (one), then 100 (two Discovers, two procs)',
    run: () => {
      let s = pickedRun('brackus', 'fortune', { ...BRACKUS, wave: 3 });
      let procs = 0;
      for (const [g, u] of [[30, 'x1'], [25, 'x2'], [100, 'x3']] as const) {
        const r = spendGold(s, g, u);
        if (g === 30 && r.procs !== 0) throw new Error('a tick procced');
        s = { ...r.next, discover: undefined, discoverQueue: undefined }; procs += r.procs;
      }
      return procs;
    },
  },
  // WAR: Start of Combat, a copy of the left-most Tier 7.
  {
    hero: 'brackus', ancient: 'war', phase: 'combat', fires: 1,
    note: 'one Tier 7 on board: one Start of Combat copy',
    run: () => {
      const s = pickedRun('brackus', 'war', { ...BRACKUS, wave: 3, board: [body('p', N(1)), body('a', 'uron', { attack: 20, health: 30 }), body('b', 'zyff')] });
      return fight(s, foes(s.wave, 1, 1000)).procs;
    },
  },
  // GENESIS: the Gild lands once, 30 Gold after the pick (29 is a tick).
  {
    hero: 'brackus', ancient: 'genesis', phase: 'shop', fires: 1,
    note: '29 Gold (no fire), then 1 more: the Tier 7 is Gilded',
    run: () => {
      let s = pickedRun('brackus', 'genesis', { ...BRACKUS, wave: 6, goldSpent: 80, board: [body('s', 'uron', { lockedUntilGoldSpent: 70 })] });
      const a = spendGold(s, 29, 'x1');
      if (a.procs !== 0) throw new Error('a tick procced');
      s = a.next;
      return spendGold(s, 1, 'x2').procs + spendGold(spendGold(s, 1, 'x2').next, 40, 'x3').procs;
    },
  },
  // TIME: two turns after the pick, the Tier 7 Discover's own Start-of-Turn beat (once).
  {
    hero: 'brackus', ancient: 'time', phase: 'sot', fires: 1,
    note: 'three Start of Turns after the pick: only the second opens the Discover',
    run: () => {
      let s = pickedRun('brackus', 'time', { ...BRACKUS, wave: 3 });
      let procs = 0;
      for (let i = 0; i < 3; i++) {
        const r = sotProcsAfterFight({ ...s, discover: undefined, discoverQueue: undefined }, foes(s.wave, 0, 1));
        s = r.s; procs += r.procs;
      }
      return procs;
    },
  },  // ── RAYSE ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: every 4th friendly Shop death summons a Sprout; 2 → 3 is a tick.
  {
    hero: 'rayse', ancient: 'death', phase: 'shop', fires: 2,
    note: 'a tick (2 to 3) does not proc; two 4th deaths do',
    run: () => {
      let s = pickedRun('rayse', 'death');
      s = structuredClone({ ...s, ancients: { ...s.ancients!, rayseDeaths: 2 }, board: [body('x', N(0)), body('y', N(1)), body('z', N(2))] });
      const p0 = procsOf(s);
      shopKill(s, 'x');
      if (procsOf(s) !== p0) throw new Error('a tick procced');
      shopKill(s, 'y');
      s.ancients!.rayseDeaths = 3;
      shopKill(s, 'z');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: a carried 3 pays at the first death (aliased Sprout flag); two more deaths only tick.
  {
    hero: 'rayse', ancient: 'death', phase: 'combat', fires: 1,
    note: 'four friendly deaths in the fight: one Sprout (the Shop count of 3 never comes in)',
    run: () => {
      let s = pickedRun('rayse', 'death', { board: ['a', 'b', 'c', 'd'].map((u, i) => body(u, N(i), { attack: 1, health: 1 })) });
      s = { ...s, ancients: { ...s.ancients!, rayseDeaths: 3 } };
      return fight(s, foes(s.wave, 100, 1000)).procs;
    },
  },
  // FORTUNE, Shop: each minion played (a Shop summon) after Gold was spent; a play before any spend does not fire.
  {
    hero: 'rayse', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'a play at 0 spent (no fire), a buy, then two plays (two fires)',
    run: () => {
      let s = pickedRun('rayse', 'fortune', { hand: [body('p0', N(0)), body('p1', N(1)), body('p2', N(2))], shop: [{ uid: 'o', cardId: N(3) } as RunState['shop'][number]] });
      const first = shopProcs(s, { type: 'play', uid: 'p0' });
      if (first.procs !== 0) throw new Error('a play with nothing spent procced');
      s = first.next;
      return shopProcsOver(s, [{ type: 'buy', uid: 'o' }, { type: 'play', uid: 'p1' }, { type: 'play', uid: 'p2' }]).procs;
    },
  },
  // FORTUNE, combat: every friendly summon gains the turn's Attack: an Echo that summons two bodies = two fires.
  {
    hero: 'rayse', ancient: 'fortune', phase: 'combat', fires: 2,
    note: 'Gold spent, one Echo summoning two bodies: two grants',
    run: () => {
      let s = pickedRun('rayse', 'fortune', { board: [body('e', RAYSE_ECHO(), { attack: 1, health: 1 })], shop: [{ uid: 'o', cardId: N(1) } as RunState['shop'][number]] });
      s = reduce(s, { type: 'buy', uid: 'o' });
      const r = fight({ ...s, hand: [] }, foes(s.wave, 100, 1000));
      if (summonsOf(r.events) !== 2) throw new Error(`expected 2 summons, saw ${summonsOf(r.events)}`);
      return r.procs;
    },
  },
  // WAR: the first 3 combat summons attack immediately; summons 4..8 do not fire.
  {
    hero: 'rayse', ancient: 'war', phase: 'combat', fires: 3,
    note: 'eight summons: only the first three fire',
    run: () => {
      const r = fight(pickedRun('rayse', 'war', { board: ['a', 'b', 'c', 'd'].map((u) => body(u, RAYSE_ECHO(), { attack: 1, health: 1 })) }), foes(1, 100, 5000));
      if (summonsOf(r.events) <= 3) throw new Error('needs more than 3 summons');
      return r.procs;
    },
  },
  // GENESIS: the first 2 combat summons summon twice (with room); later summons do not fire.
  {
    hero: 'rayse', ancient: 'genesis', phase: 'combat', fires: 2,
    note: 'many summons: the budget of two fires twice',
    run: () => {
      const r = fight(pickedRun('rayse', 'genesis', { board: ['a', 'b', 'c'].map((u) => body(u, RAYSE_ECHO(), { attack: 1, health: 1 })) }), foes(1, 100, 5000));
      if (summonsOf(r.events) <= 4) throw new Error('needs more than 4 summons');
      return r.procs;
    },
  },
  // TIME: End of Turn, Vines improves: its own beat.
  {
    hero: 'rayse', ancient: 'time', phase: 'eot', fires: 1,
    // KNOWN GAP (reported): the Vines improvement only moves `ancients.rayseVinesBonus`, so the virtual End-of-Turn
    // entry records no consequence and the batch drops the beat: no burst plays. Left asserting the intended 1.
    note: 'the End-of-Turn Vines beat',
    run: () => eotAncientBeats(pickedRun('rayse', 'time', { board: [body('a', RAYSE_ECHO(), { attack: 1, health: 1 })] })),
  },
  // BONDS: each friendly combat summon gives two others +3/+3: two summons, two fires.
  {
    hero: 'rayse', ancient: 'bonds', phase: 'combat', fires: 2,
    note: 'one Echo summoning two bodies beside two others: two fires',
    run: () => {
      const r = fight(pickedRun('rayse', 'bonds', { board: [body('e', RAYSE_ECHO(), { attack: 1, health: 1 }), body('x', 'n2_spellsword', { attack: 1, health: 90 }), body('y', 'n2_spellsword', { attack: 1, health: 90 })] }), foes(1, 100, 5000));
      if (summonsOf(r.events) !== 2) throw new Error(`expected 2 summons, saw ${summonsOf(r.events)}`);
      return r.procs;
    },
  },
  // ── CASSEN ────────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: every 7th friendly Shop death advances the commission; 5 → 6 is a tick.
  {
    hero: 'cassen', ancient: 'death', phase: 'shop', fires: 2,
    note: 'a tick (5 to 6) does not proc; two 7th deaths do',
    run: () => {
      let s = pickedRun('cassen', 'death', CASSEN);
      s = structuredClone({ ...s, ancients: { ...s.ancients!, cassenDeaths: 5 }, board: [body('x', N(0)), body('y', N(1)), body('z', N(2))] });
      const p0 = procsOf(s);
      shopKill(s, 'x');
      if (procsOf(s) !== p0) throw new Error('a tick procced');
      shopKill(s, 'y');
      s.ancients!.cassenDeaths = 6;
      shopKill(s, 'z');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: a carried 6 pays at the first death (aliased flag); two more deaths only tick.
  {
    hero: 'cassen', ancient: 'death', phase: 'combat', fires: 1,
    note: 'seven friendly deaths in the fight: one advance (the Shop count of 6 never comes in)',
    run: () => {
      let s = pickedRun('cassen', 'death', { ...CASSEN, board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u, i) => body(u, N(i), { attack: 1, health: 1 })) });
      s = { ...s, ancients: { ...s.ancients!, cassenDeaths: 6 } };
      return fight(s, foes(s.wave, 100, 1000)).procs;
    },
  },
  // FORTUNE / WAR / GENESIS / BONDS: the commission pays out at Start of Turn, inside the "Commission" beat (overridden to
  // 'sot'). KNOWN GAP (reported): that beat is labelled with the POWER's name, not an Ancient's, so no burst plays.
  ...(['fortune', 'war', 'genesis', 'bonds'] as const).map((ancient): ProcCase => ({
    hero: 'cassen', ancient, phase: 'sot', fires: 1,
    note: 'a Shed commission pays out at the next Start of Turn',
    run: () => {
      let s = pickedRun('cassen', ancient, { ...CASSEN, board: [body('a', N(0)), body('b', N(1))] });
      s = reduce(s, { type: 'heroPower', commission: 'spell' } as Action);
      if (!s.commission) throw new Error('no commission started');
      const r = sotProcsAfterFight(s, foes(s.wave, 0, 400));
      if (r.s.commission) throw new Error('the commission did not pay');
      return r.procs;
    },
  })),
  // ── DRAKKO ────────────────────────────────────────────────────────────────────────────────────────────────────
  // WAR: one Start of Combat fire (its 1 + Shouts repeats are the magnitude).
  {
    hero: 'drakko', ancient: 'war', phase: 'combat', fires: 1,
    note: '3 Shouts this turn: four buffs, one Start of Combat fire',
    run: () => {
      const s = pickedRun('drakko', 'war', { embers: 99, board: [body('a', N(0), { health: 50 }), body('b', N(1), { health: 50 })], shoutFiresThisTurn: 3 } as Partial<RunState>);
      return fight(s, foes(s.wave, 0, 400)).procs;
    },
  },
  // TIME, End of Turn: the left-most Shout's re-fire, its own beat.
  {
    hero: 'drakko', ancient: 'time', phase: 'eot', fires: 1,
    note: 'a Hoarder on board: the End-of-Turn Shout beat',
    run: () => eotAncientBeatsNested(pickedRun('drakko', 'time', { embers: 99, board: [body('x', N(0)), body('h', 'hoarder'), body('c', 'ce3_wishingstar')] })),
  },
  // TIME, combat (`alsoSoc`, override): Start of Combat re-fires the left-most Shout, one fire.
  {
    hero: 'drakko', ancient: 'time', phase: 'combat', fires: 1,
    note: 'two Shout minions: only the left-most fires, once',
    run: () => fight(pickedRun('drakko', 'time', { embers: 99, board: [body('x', N(0)), body('a', 'alley', { health: 90 }), body('h', 'hoarder', { health: 90 })] }), foes(1, 0, 400)).procs,
  },
  // BONDS, Shop: every Shout FIRE: a plain play does not fire, a Hoarder play beside Drakko fires twice.
  {
    hero: 'drakko', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'a plain play (no fire), then a Drakko-doubled Hoarder (two fires)',
    run: () => {
      const s = pickedRun('drakko', 'bonds', { embers: 99, board: [body('d', 'drummer')], hand: [body('h', 'hoarder'), body('p', N(0))] });
      const first = shopProcs(s, { type: 'play', uid: 'p' });
      if (first.procs !== 0) throw new Error('a plain play procced');
      return shopProcs(first.next, { type: 'play', uid: 'h' }).procs;
    },
  },
  // BONDS, combat: each Shout fire (aliased flag), counted against the fight's own Shout fires.
  {
    hero: 'drakko', ancient: 'bonds', phase: 'combat', fires: DRAKKO_BONDS_FIRES,
    note: 'combat Shout fires: one proc each',
    run: () => {
      const s = pickedRun('drakko', 'bonds', { embers: 99, board: [body('d', 'drummer', { health: 90 }), body('a', 'alley', { health: 90 }), body('r', 'ryme', { attack: 1, health: 1, keywords: ['T'] })] });
      const r = fight(s, foes(s.wave, 3, 200));
      const fires = r.s.lastCombat!.playerShoutFires ?? 0;
      if (fires !== r.procs) throw new Error(`${fires} Shout fires, ${r.procs} procs`);
      return r.procs;
    },
  },
  // ── FLASH ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH: armed, the 2nd enemy kill is copied (the 1st and 3rd are not this pairing's fires).
  {
    hero: 'flash', ancient: 'death', phase: 'combat', fires: 1,
    note: 'three weak foes killed: only the 2nd kill fires',
    run: () => {
      const s = reduce(pickedRun('flash', 'death', { board: [body('a', N(0), { attack: 50, health: 500 })] }), { type: 'heroPower', flashPick: 'first' } as Action);
      return fight(s, flashFoes(s.wave, [0, 1, 2].map((i) => ({ cardId: N(i + 3), attack: 1, health: 1 })))).procs;
    },
  },
  // WAR: Pummel (400), twice per combat: three+ crossings pay two copies.
  {
    hero: 'flash', ancient: 'war', phase: 'combat', fires: 2,
    note: 'three or more 400s crossed: two copies (the cap)',
    run: () => {
      let s = pickedRun('flash', 'war', { board: [body('a', N(0), { attack: 300, health: 9000 })] });
      s = { ...s, ancients: { ...s.ancients!, pummelDealt: 350 } };
      return fight(s, flashFoes(s.wave, [0, 1, 2, 3].map((i) => ({ cardId: N(i + 3), attack: 1, health: 400 })))).procs;
    },
  },
  // ── GILDMASTER ────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: every 17th friendly Shop death; 15 → 16 is a tick.
  {
    hero: 'gildmaster', ancient: 'death', phase: 'shop', fires: 2,
    note: 'a tick (15 to 16) does not proc; two 17th deaths do',
    run: () => {
      let s = pickedRun('gildmaster', 'death', { embers: 20 });
      s = structuredClone({ ...s, ancients: { ...s.ancients!, gildDeaths: 15 }, board: [body('x', N(0)), body('y', N(1)), body('z', N(2))] });
      const p0 = procsOf(s);
      shopKill(s, 'x');
      if (procsOf(s) !== p0) throw new Error('a tick procced');
      shopKill(s, 'y');
      s.ancients!.gildDeaths = 16;
      shopKill(s, 'z');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: a carried 16 pays at the first death; the second only ticks.
  {
    hero: 'gildmaster', ancient: 'death', phase: 'combat', fires: 1,
    note: 'seven Mama Pups and their Pups: the 17th death IN the fight pays one Goldcrafter (the Shop count of 16 never comes in)',
    run: () => {
      let s = pickedRun('gildmaster', 'death', { embers: 20, board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => body(u, 'pack', { attack: 1, health: 1 })) });
      s = { ...s, ancients: { ...s.ancients!, gildDeaths: 16 } };
      const r = fight(s, foes(s.wave, 100, 1000));
      const died = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
      if (died < 17 || died >= 34) throw new Error(`expected 17 to 33 friendly deaths, saw ${died}`);
      return r.procs;
    },
  },
  // FORTUNE: two Gilded plays = two Triple Rewards = two 5-Gold payouts.
  {
    hero: 'gildmaster', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'two Gilded plays, each Triple Reward pays',
    run: () => shopProcsOver(pickedRun('gildmaster', 'fortune', { embers: 20, hand: [gilded('g1', N(0)), gilded('g2', N(1))] }), [{ type: 'play', uid: 'g1' }, { type: 'play', uid: 'g2' }]).procs,
  },
  // WAR: Pummel (1000), once per combat (aliased flag): 2000+ dealt from 900 pays once.
  {
    hero: 'gildmaster', ancient: 'war', phase: 'combat', fires: 1,
    note: 'two 1000s crossed: one use (once per combat)',
    run: () => {
      let s = pickedRun('gildmaster', 'war', { embers: 20, board: [body('a', N(0), { attack: 400, health: 9000 })] });
      s = { ...s, ancients: { ...s.ancients!, pummelDealt: 900 } };
      return fight(s, foes(s.wave, 1, 5000)).procs;
    },
  },
  // GENESIS: each Triple Reward repeats once: two Gilded plays = two repeats.
  {
    hero: 'gildmaster', ancient: 'genesis', phase: 'shop', fires: 2,
    note: 'two Gilded plays: each Triple Reward triggers twice (one fire each)',
    run: () => shopProcsOver(pickedRun('gildmaster', 'genesis', { embers: 20, hand: [gilded('g', N(0)), gilded('h', N(1))] }), [{ type: 'play', uid: 'g' }, { type: 'play', uid: 'h' }]).procs,
  },
  // TIME: Start of Turn gilds a random minion, its own beat, every turn.
  {
    hero: 'gildmaster', ancient: 'time', phase: 'sot', fires: 2,
    note: 'two Start of Turns, two plain minions: a Gild each',
    run: () => {
      const s = pickedRun('gildmaster', 'time', { embers: 20, board: [body('a', N(0), { health: 50 }), body('b', N(1), { health: 50 })] });
      const a = sotProcsAfterFight(s, foes(s.wave, 0, 400));
      return a.procs + sotProcsAfterFight(a.s, foes(a.s.wave, 0, 400)).procs;
    },
  },
  // BONDS: one fire per Gilded play (its repeats are the magnitude); a plain play does not fire.
  {
    hero: 'gildmaster', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'a plain play (no fire), then two Gilded plays',
    run: () => {
      let s = pickedRun('gildmaster', 'bonds', { embers: 20, board: [gilded('b', N(1))], hand: [body('p', N(2)), gilded('g', N(0)), gilded('h', N(3))] });
      s = { ...s, ancients: { ...s.ancients!, gilds: 2 } };
      const first = shopProcs(s, { type: 'play', uid: 'p' });
      if (first.procs !== 0) throw new Error('a plain play procced');
      return shopProcsOver(first.next, [{ type: 'play', uid: 'g' }, { type: 'play', uid: 'h' }]).procs;
    },
  },
  // ── MIDAS ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH, Shop: each Gilded minion's grafted Echo; a plain death does not fire.
  {
    hero: 'midas', ancient: 'death', phase: 'shop', fires: 2,
    note: 'two Gilded deaths fire, a plain one does not',
    run: () => {
      const s = structuredClone(pickedRun('midas', 'death', { embers: 20, board: [gilded('g', N(0)), body('p', N(1)), gilded('h', N(2))] }));
      const p0 = procsOf(s);
      shopKill(s, 'p');
      if (procsOf(s) !== p0) throw new Error('a plain death procced');
      shopKill(s, 'g');
      shopKill(s, 'h');
      return procsOf(s) - p0;
    },
  },
  // DEATH, combat: two Gilded bodies die, one Echo each.
  {
    hero: 'midas', ancient: 'death', phase: 'combat', fires: 2,
    note: 'two Gilded 1/1s die: two Echoes, one Gold Pouch each',
    run: () => {
      const r = fight(pickedRun('midas', 'death', { embers: 20, board: [gilded('g', N(0), { attack: 1, health: 1 }), gilded('h', N(2), { attack: 1, health: 1 })] }), foes(1, 100, 1000));
      const pouches = r.events.filter((e) => e.type === 'toHand' && e.cardId === 'emberpouch').length;
      if (pouches !== r.procs) throw new Error(`${pouches} Pouches, ${r.procs} procs`);
      return r.procs;
    },
  },
  // WAR: Start of Combat Ward, one fire (2 Gilded minions on Midas's own board: 2 Wards).
  {
    hero: 'midas', ancient: 'war', phase: 'combat', fires: 1,
    note: 'two Gilded minions on your board: two Wards, one Start of Combat fire',
    run: () => {
      const s = pickedRun('midas', 'war', { embers: 20, board: ['a', 'b', 'c', 'd', 'e'].map((u, i) => (i < 2 ? gilded(u, N(i), { attack: 1, health: 50 }) : body(u, N(i), { attack: 1, health: 50 }))) });
      return fight(s, foes(s.wave, 0, 300, 3)).procs;
    },
  },
  // GENESIS: each Gild (a Gilded play) also grants a Triple Reward.
  {
    hero: 'midas', ancient: 'genesis', phase: 'shop', fires: 2,
    note: 'two Gilded plays: two extra Triple Rewards',
    run: () => shopProcsOver(pickedRun('midas', 'genesis', { embers: 20, hand: [gilded('g', N(0)), gilded('h', N(1))] }), [{ type: 'play', uid: 'g' }, { type: 'play', uid: 'h' }]).procs,
  },
  // TIME: Start of Turn gilds a random minion, its own beat.
  {
    hero: 'midas', ancient: 'time', phase: 'sot', fires: 2,
    note: 'two Start of Turns, two plain minions: a Gild each',
    run: () => {
      const s = pickedRun('midas', 'time', { embers: 20, board: [body('a', N(0), { health: 50 }), body('b', N(1), { health: 50 })] });
      const a = sotProcsAfterFight(s, foes(s.wave, 0, 400));
      return a.procs + sotProcsAfterFight(a.s, foes(a.s.wave, 0, 400)).procs;
    },
  },
  // BONDS, Shop: a buff on a Gilded minion (two others gain); a buff on a plain one does not fire.
  {
    hero: 'midas', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'Spiritfire on a plain minion (no fire), then on two Gilded ones',
    run: () => {
      const s = pickedRun('midas', 'bonds', { embers: 20, board: [gilded('a', N(0)), gilded('b', N(1)), gilded('c', N(2)), body('p', N(3))], hand: [body('s0', 'spiritfire'), body('s1', 'spiritfire'), body('s2', 'spiritfire')] });
      const first = shopProcs(s, { type: 'play', uid: 's0', targetUid: 'p' } as Action);
      if (first.procs !== 0) throw new Error('a plain gain procced');
      return shopProcsOver(first.next, [{ type: 'play', uid: 's1', targetUid: 'a' } as Action, { type: 'play', uid: 's2', targetUid: 'b' } as Action]).procs;
    },
  },
  // BONDS, combat: each positive gain on a Gilded body with a Gilded friend (Cinderchef's Rally self-gains).
  {
    hero: 'midas', ancient: 'bonds', phase: 'combat', fires: MIDAS_BONDS_FIRES,
    note: 'Cinderchef Rally self-gains: one fire per gain, the grants never re-fire it',
    run: () => {
      const s = pickedRun('midas', 'bonds', { embers: 20, shopSpellsThisTurn: 1, board: [gilded('r', 'd2_cinderchef', { health: 900 }), gilded('o', N(0), { health: 900 })] } as Partial<RunState>);
      const r = fight(s, foes(s.wave, 0, 30));
      const grants = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'Ancient of Bonds').length;
      if (grants !== r.procs) throw new Error(`${grants} grants (one other each), ${r.procs} procs`);
      return r.procs;
    },
  },
];
