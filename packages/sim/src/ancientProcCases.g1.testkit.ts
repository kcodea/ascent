/** Ancient trigger proc cases, group 1 (R-FX-ANCIENT-PROC-01): see `ancientProcs.test.ts`. */
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import { body, eotAncientBeats, fight, foes, pickedRun, shopProcs, shopProcsOver, sotProcsAfterFight, type ProcCase } from './ancientProcs.testkit';
import { destroyMinionInShop, makeContext } from './recruit';
import { reduce, type BoardCard, type RunState, type ShopCard } from './index';

/** Friendly Ward breaks in a fight's log. */
const wardBreaks = (events: readonly CombatEvent[], uids: ReadonlySet<string>): number =>
  events.filter((e) => e.type === 'shield' && uids.has(e.target)).length;

/** Friendly deaths in a fight's log. */
const deaths = (events: readonly CombatEvent[], side: 'player' | 'enemy' = 'player'): number =>
  events.filter((e) => e.type === 'death' && e.side === side).length;

/** Shop procs a set of in-place destroys made (the shared shop-death chokepoint). */
const shopDestroyProcs = (s: RunState, uids: readonly string[]): number => {
  const before = s.ancients?.procs ?? 0;
  for (const uid of uids) {
    const victim = s.board.find((c) => c.uid === uid);
    if (!victim) throw new Error(`no ${uid} on board`);
    destroyMinionInShop(makeContext(s), victim);
  }
  return (s.ancients?.procs ?? 0) - before;
};

const need = (cond: boolean, msg: string): void => { if (!cond) throw new Error(msg); };

/** Player spell casts in a fight's log. */
const spellcasts = (events: readonly CombatEvent[]): number => events.filter((e) => e.type === 'spellcast' && e.side === 'player').length;

/** Buffs with a given source label in a fight's log. */
const sourcedBuffs = (events: readonly CombatEvent[], source: string): number =>
  events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === source).length;

/** Effect-less, keyword-less, single-type minions (no triples form between different ids). */
const plainCard = (c: (typeof CARD_INDEX)[string]): boolean => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plainCard(c) && c!.tribe === 'neutral' && !c!.tribe2 && !c!.henchman).map((c) => c!.id);
const N = (i: number): string => NEUTRALS[i % NEUTRALS.length]!;
const typedId = (t: string): string => Object.values(CARD_INDEX).find((c) => plainCard(c) && c!.tribe === t && !c!.tribe2)!.id;
const T1 = 'hm_test_squire';
const OTHER = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.ruby && !c.token && c.id !== T1 && c.effects.length === 0 && c.keywords.length === 0)!.id;
const SPIRITFIRE = 'spiritfire'; // "Give a minion +6/+6." (targeted)
const fire = (uid: string): BoardCard => body(uid, SPIRITFIRE, { tribe: 'neutral', attack: 0, health: 1 });
/** Buy `id` through a one-offer Shop. */
const buyVia = (s: RunState, id: string, u: string): RunState => reduce({ ...s, shop: [{ uid: u, cardId: id } as ShopCard] }, { type: 'buy', uid: u });
/** Shop procs over several one-offer buys. */
const buyProcs = (s: RunState, ids: readonly string[]): { s: RunState; procs: number } => {
  let procs = 0;
  ids.forEach((id, i) => {
    const before = s.ancients?.procs ?? 0;
    const next = buyVia(s, id, `o${i}`);
    need(next !== s, `bought ${id}`);
    procs += (next.ancients?.procs ?? 0) - before;
    s = next;
  });
  return { s, procs };
};
/** The run with its Ancients counters patched (a carried running count). */
const withA = (s: RunState, over: Partial<NonNullable<RunState['ancients']>>): RunState => ({ ...s, ancients: { ...s.ancients!, ...over } });
/** An Echo that summons a fixed count of bodies, not itself a token (Soren's fixture). */
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon'
  && !(c.effects[0]!.params as { fixed?: boolean }).fixed)!.id;
/** A minion whose Rally buffs itself (Xerox's Bonds fixture). */
const SELF_BUFF = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onAttack' && /Self|self/.test(e.do)))!.id;
// Measured fire counts of the fixed (deterministic) scenarios below; each case also asserts the underlying events.
const FRANK_WAR_STACKS = 4;
const XEROX_DEATH_COMBAT = 1;
const XEROX_BONDS_COMBAT = 4;
const TRADES_WAR_COMBAT = 15;
const minionOffers = (s: RunState): ShopCard[] => s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });

/** Gold Pouch: an untargeted Shop spell whose only effect is +1 Gold. */
const pouch = (uid: string): BoardCard => body(uid, 'emberpouch', { tribe: 'neutral', attack: 0, health: 1 });

/** Lord of the Risen's Undying on `uid` (the power's own click: never a proc). */
const undying = (s: RunState, uid: string): RunState => {
  const t = reduce(s, { type: 'heroPower', uid });
  need(!!t.board.find((c) => c.uid === uid)?.keywords.includes('R'), 'Undying landed');
  return t;
};

export const CASES: ProcCase[] = [
  // ── INDY ──────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'indy', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'two gilded sales fire; a plain sale does not',
    run: () => {
      const s = pickedRun('indy', 'fortune', { board: [body('g1', 'gnash', { golden: true }), body('p', 'gnash'), body('g2', 'gnash', { golden: true })] });
      return shopProcsOver(s, [{ type: 'sell', uid: 'g1' }, { type: 'sell', uid: 'p' }, { type: 'sell', uid: 'g2' }]).procs;
    },
  },
  {
    hero: 'indy', ancient: 'war', phase: 'shop', fires: 2,
    note: 'two shop deaths with a gilded minion alive',
    run: () => {
      const s = pickedRun('indy', 'war', { board: [body('g', 'gnash', { golden: true }), body('v1', 'sandbag'), body('v2', 'sandbag')] });
      return shopDestroyProcs(s, ['v1', 'v2']);
    },
  },
  {
    hero: 'indy', ancient: 'war', phase: 'combat', fires: 2,
    note: 'two friendly deaths while a gilded minion lives',
    run: () => {
      const s = pickedRun('indy', 'war', { board: [body('g', 'alley', { golden: true, attack: 0, health: 400, keywords: [] }), body('f1', 'alley', { attack: 1, health: 1 }), body('f2', 'alley', { attack: 1, health: 1 })] });
      const r = fight(s, foes(s.wave, 3, 200, 3));
      need(deaths(r.events) === 2, `expected 2 friendly deaths, saw ${deaths(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'indy', ancient: 'time', phase: 'combat', fires: 1,
    note: 'Start of Combat gilds the right-most once per fight',
    run: () => {
      const s = pickedRun('indy', 'time', { board: [body('a', 'sandbag', { health: 50 }), body('r', 'gnash')] });
      return fight(s, foes(s.wave, 0, 5)).procs;
    },
  },
  // ── WARDEN ────────────────────────────────────────────────────────────────────────────────────────────────────
  // WARDEN × FORTUNE: "When one of your Wards breaks in combat, gain 2 Gold next turn." The proc plays at each break.
  {
    hero: 'warden', ancient: 'fortune', phase: 'combat', fires: 3,
    note: 'three Warded bodies, each Ward breaks once against a 3-Attack foe',
    run: () => {
      const s = pickedRun('warden', 'fortune', { board: [body('a', 'hm_test_squire', { attack: 0, health: 30, keywords: ['DS'] }), body('b', 'shaper', { attack: 0, health: 30, keywords: ['DS'] }), body('c', 'beetle', { attack: 0, health: 30, keywords: ['DS'] })] });
      const r = fight(s, foes(s.wave, 3, 400));
      const mine = new Set(r.s.lastCombat!.initial.player.map((m) => m.uid));
      if (wardBreaks(r.events, mine) !== 3) throw new Error(`expected 3 Ward breaks, saw ${wardBreaks(r.events, mine)}`);
      return r.procs;
    },
  },
  // WARDEN × GENESIS: every 3 friendly Ward breaks, a copy of one of them to hand, live. 3 breaks = one fire.
  {
    hero: 'warden', ancient: 'genesis', phase: 'combat', fires: 1,
    note: 'three Ward breaks = one payout',
    run: () => {
      const s = pickedRun('warden', 'genesis', { board: [body('a', 'hm_test_squire', { attack: 0, health: 30, keywords: ['DS'] }), body('b', 'shaper', { attack: 0, health: 30, keywords: ['DS'] }), body('c', 'beetle', { attack: 0, health: 30, keywords: ['DS'] })] });
      return fight(s, foes(s.wave, 3, 400)).procs;
    },
  },
  {
    hero: 'warden', ancient: 'time', phase: 'shop', fires: 2,
    note: 'two spell casts with a Ward minion on board; a third cast with no Ward does nothing',
    run: () => {
      const s = pickedRun('warden', 'time', { board: [body('a', 'hm_test_squire', { attack: 1, health: 10, keywords: ['DS'] }), body('b', 'shaper', { attack: 1, health: 10 })], hand: [pouch('p1'), pouch('p2')] });
      const r = shopProcsOver(s, [{ type: 'play', uid: 'p1' }, { type: 'play', uid: 'p2' }]);
      const bare = pickedRun('warden', 'time', { board: [body('b', 'shaper', { attack: 1, health: 10 })], hand: [pouch('p3')] });
      return r.procs + shopProcs(bare, { type: 'play', uid: 'p3' }).procs;
    },
  },
  {
    hero: 'warden', ancient: 'time', phase: 'combat', fires: 2,
    note: 'Taragosa casts twice in the fight while a Ward is up',
    run: () => {
      const s = pickedRun('warden', 'time', { board: [body('a', 'sandbag', { attack: 1, health: 900, keywords: ['DS'] }), body('t', 'taragosa', { attack: 4, health: 900 }), body('b', 'hm_test_squire', { attack: 1, health: 900, keywords: ['DS'] })] });
      const r = fight(s, foes(s.wave, 0, 30));
      need(spellcasts(r.events) === 2, `expected 2 casts, saw ${spellcasts(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'warden', ancient: 'bonds', phase: 'shop', fires: 3,
    note: "Aegis's +5 wave makes three Warded gainers, each fires once (the +5s never re-trigger it)",
    run: () => {
      const s = pickedRun('warden', 'bonds', { board: [body('a', 'hm_test_squire', { attack: 1, health: 5, keywords: ['DS'] }), body('b', 'shaper', { attack: 1, health: 5, keywords: ['DS'] }), body('c', 'beetle', { attack: 1, health: 5 })] });
      return shopProcs(s, { type: 'heroPower', uid: 'c' }).procs;
    },
  },
  {
    hero: 'warden', ancient: 'bonds', phase: 'combat', fires: 2,
    note: "Taragosa's two Growth casts each grow a Warded body, each gives the other Warded body +5",
    run: () => {
      const s = pickedRun('warden', 'bonds', { board: [body('a', 'sandbag', { attack: 1, health: 900, keywords: ['DS'] }), body('t', 'taragosa', { attack: 4, health: 900 }), body('b', 'hm_test_squire', { attack: 1, health: 900, keywords: ['DS'] })] });
      const r = fight(s, foes(s.wave, 0, 30));
      need(sourcedBuffs(r.events, 'Aegis') === 2, `expected 2 Bonds grants, saw ${sourcedBuffs(r.events, 'Aegis')}`);
      return r.procs;
    },
  },
  // ── AUCTIONEER (myra) ─────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'myra', ancient: 'fortune', phase: 'shop', fires: 1,
    note: 'two Shout minions played from hand: the 2nd Shout banks 1 Gold (every 2 Shouts, owner 2026-11-17), one fire',
    run: () => {
      const s = pickedRun('myra', 'fortune', { board: [], hand: [body('h1', 'cleric', { attack: 1, health: 50 }), body('h2', 'cleric', { attack: 1, health: 50 })] });
      return shopProcsOver(s, [{ type: 'play', uid: 'h1', toIndex: 0 }, { type: 'play', uid: 'h2', toIndex: 1 }]).procs;
    },
  },
  {
    hero: 'myra', ancient: 'time', phase: 'combat', fires: 1,
    note: 'one Start-of-Combat fire, triggering both edge Shouts',
    run: () => {
      const s = pickedRun('myra', 'time', { board: [body('c', 'cleric', { attack: 1, health: 50 }), body('w', 'whelpling', { attack: 0, health: 400 }), body('p', 'dw_pimm', { attack: 0, health: 50 }), body('a', 'hm_test_squire', { attack: 0, health: 50, keywords: [] })] });
      const r = fight(s, foes(s.wave, 0, 400));
      need(r.events.filter((e) => e.type === 'shout').length >= 2, 'both edges fire');
      return r.procs;
    },
  },
  {
    hero: 'myra', ancient: 'bonds', phase: 'eot', fires: 1,
    note: 'one End-of-Turn beat triggers the two left-most Shouts',
    run: () => eotAncientBeats(pickedRun('myra', 'bonds', { board: [body('w', 'whelpling', { attack: 1, health: 50 }), body('c', 'cleric', { attack: 1, health: 50 }), body('a', 'hm_test_squire', { attack: 1, health: 1, keywords: [] }), body('d', 'cleric', { attack: 1, health: 50 })] })),
  },
  // ── LORD OF THE RISEN (risen) ─────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'risen', ancient: 'death', phase: 'combat', fires: 1,
    note: 'the Undying body regains Rise once per combat (its second Rise does not regain again)',
    run: () => {
      const r = fight(undying(pickedRun('risen', 'death', { board: [body('a', 'hm_test_squire', { attack: 2, health: 2, keywords: [] })] }), 'a'), foes(7, 50, 400));
      need(r.events.filter((e) => e.type === 'reborn').length === 2, 'two Rises');
      return r.procs;
    },
  },
  {
    hero: 'risen', ancient: 'fortune', phase: 'combat', fires: 2,
    note: 'the Undying Rise + a printed Rise',
    run: () => {
      const r = fight(undying(pickedRun('risen', 'fortune', { board: [body('a', 'hm_test_squire', { attack: 2, health: 2, keywords: [] }), body('b', 'shaper', { attack: 2, health: 2, keywords: ['R'] })] }), 'a'), foes(7, 50, 400));
      need(r.s.lastCombat!.playerRises === 2, 'two Rises');
      return r.procs;
    },
  },
  {
    hero: 'risen', ancient: 'war', phase: 'combat', fires: 1,
    note: 'the Undying body returns doubled; a printed Rise on another minion is not a fire',
    run: () => {
      const r = fight(undying(pickedRun('risen', 'war', { board: [body('a', 'hm_test_squire', { attack: 2, health: 2, keywords: [] }), body('b', 'shaper', { attack: 2, health: 2, keywords: ['R'] })] }), 'a'), foes(7, 50, 400, 3));
      need(r.events.filter((e) => e.type === 'reborn').length === 2, 'two Rises');
      return r.procs;
    },
  },
  {
    hero: 'risen', ancient: 'genesis', phase: 'combat', fires: 3,
    note: 'four Echo summons, capped at 3 extras: 3 fires, the 4th summon is not one',
    run: () => fight(pickedRun('risen', 'genesis', { board: ['i1', 'i2', 'i3', 'i4'].map((u) => body(u, 'burialimp')) }), foes(7, 50, 400)).procs,
  },
  {
    hero: 'risen', ancient: 'time', phase: 'sot', fires: 1,
    note: 'one Start of Turn beat pays the summons counted last combat',
    run: () => sotProcsAfterFight(undying(pickedRun('risen', 'time', { board: [body('p', 'pack'), body('b', 'shaper', { attack: 0, health: 500, keywords: [] }), body('a', 'hm_test_squire', { attack: 2, health: 2, keywords: [] })] }), 'a'), foes(7, 3, 400)).procs,
  },
  {
    hero: 'risen', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'two shop Rises, each next to an Echo',
    run: () => {
      const s = pickedRun('risen', 'bonds', { board: [body('i1', 'burialimp'), body('a', 'hm_test_squire', { attack: 2, health: 2, keywords: ['R'] }), body('b', 'shaper', { attack: 2, health: 2, keywords: ['R'] }), body('i2', 'pack')] });
      return shopDestroyProcs(s, ['a', 'b']);
    },
  },
  {
    hero: 'risen', ancient: 'bonds', phase: 'combat', fires: 1,
    note: 'the Undying Rise next to an Echo fires it',
    run: () => fight(undying(pickedRun('risen', 'bonds', { board: [body('i', 'burialimp', { attack: 0, health: 500 }), body('a', 'hm_test_squire', { attack: 2, health: 2, keywords: [] }), body('b', 'shaper', { attack: 0, health: 500, keywords: [] })] }), 'a'), foes(7, 50, 400)).procs,
  },
  // ── ALBUS ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'albus', ancient: 'war', phase: 'combat', fires: 1,
    note: 'Pummel (80) pays once per combat though 400 damage crosses it five times',
    run: () => fight(pickedRun('albus', 'war', { board: [body('a', T1, { attack: 100, health: 50 })] }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'albus', ancient: 'time', phase: 'sot', fires: 1,
    note: 'the Start-of-Turn Discover is its own beat',
    run: () => sotProcsAfterFight(pickedRun('albus', 'time', { board: [body('a', T1, { attack: 50, health: 50 })] }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'albus', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'an odd-tier play then an even-tier play, each with a same-parity mate on board',
    run: () => {
      const s = pickedRun('albus', 'bonds', { board: [body('a', T1), body('b', 'n2_spellsword'), body('c', 'tara'), body('d', 'dw_brakka')], hand: [body('h', 'c3_binary'), body('k', 'babycub')] });
      return shopProcsOver(s, [{ type: 'play', uid: 'h' }, { type: 'play', uid: 'k' }]).procs;
    },
  },
  // ── HUNCH ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'hunch', ancient: 'death', phase: 'shop', fires: 2,
    note: 'carried 3/4: the 1st Shop death pays, 3 more tick, the 5th pays',
    run: () => {
      const s = structuredClone(withA(pickedRun('hunch', 'death', { board: ['d1', 'd2', 'd3', 'd4', 'd5'].map((u) => body(u, T1)) }), { hunchDeaths: 3 }));
      return shopDestroyProcs(s, ['d1', 'd2', 'd3', 'd4', 'd5']);
    },
  },
  {
    hero: 'hunch', ancient: 'death', phase: 'combat', fires: 2,
    note: 'carried 3/4: the 1st and 5th combat deaths pay',
    run: () => {
      const r = fight(withA(pickedRun('hunch', 'death', { board: ['m0', 'm1', 'm2', 'm3', 'm4'].map((u) => body(u, T1, { attack: 1, health: 1 })) }), { hunchDeaths: 3 }), foes(7, 50, 1000));
      need(deaths(r.events) === 5, `expected 5 deaths, saw ${deaths(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'hunch', ancient: 'genesis', phase: 'shop', fires: 2,
    note: 'carried 4/5: the 1st and 6th casts recharge the Spellbook',
    run: () => {
      const s = withA(pickedRun('hunch', 'genesis', { hand: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(pouch) }), { genesisSpells: 4 });
      return shopProcsOver(s, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((uid) => ({ type: 'play', uid }) as const)).procs;
    },
  },
  {
    hero: 'hunch', ancient: 'genesis', phase: 'combat', fires: 1,
    note: 'carried 4/5: the first combat cast is the 5th (a later cast short of the 10th is not a fire)',
    run: () => {
      const r = fight(withA(pickedRun('hunch', 'genesis', { board: [body('fc', 'taragosa', { attack: 4, health: 900 })] }), { genesisSpells: 4 }), foes(7, 0, 20));
      need(spellcasts(r.events) >= 1 && spellcasts(r.events) < 6, `casts ${spellcasts(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'hunch', ancient: 'bonds', phase: 'shop', fires: 3,
    note: 'the first 3 targeted casts double; the 4th does not',
    run: () => {
      const s = pickedRun('hunch', 'bonds', { board: [body('a', T1)], hand: ['f1', 'f2', 'f3', 'f4'].map(fire) });
      return shopProcsOver(s, ['f1', 'f2', 'f3', 'f4'].map((uid) => ({ type: 'play', uid, targetUid: 'a' }) as const)).procs;
    },
  },
  // ── FRANTIC FRANK ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'frank', ancient: 'death', phase: 'shop', fires: 1,
    note: 'the free Clearance buy fires; the second (2 Gold) buy does not; the Clearance click itself never does',
    run: () => {
      const s = reduce(pickedRun('frank', 'death', { board: [body('a', T1)] }), { type: 'heroPower' });
      const [first, second] = minionOffers(s);
      return shopProcsOver(s, [{ type: 'buy', uid: first!.uid }, { type: 'buy', uid: second!.uid }]).procs;
    },
  },
  {
    hero: 'frank', ancient: 'war', phase: 'combat', fires: FRANK_WAR_STACKS,
    note: 'carried 250/300: each 300 crossed is a stack (the Clearance-stack flag, aliased)',
    run: () => {
      const r = fight(withA(pickedRun('frank', 'war', { board: [body('a', T1, { attack: 100, health: 9000 })] }), { pummelDealt: 250 }), foes(7, 1, 1000));
      const dealt = r.s.lastCombat!.playerAncientPummelDealt!;
      need(Math.floor(dealt / 300) === FRANK_WAR_STACKS, `dealt ${dealt}`);
      return r.procs;
    },
  },
  {
    hero: 'frank', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'two Clearance minions sold fire; an ordinary sale does not',
    run: () => {
      let s = reduce(pickedRun('frank', 'bonds', { board: [body('x', T1, { attack: 1, health: 1 }), body('y', OTHER)] }), { type: 'heroPower' });
      const bought: string[] = [];
      for (let i = 0; i < 2; i++) {
        s = reduce(s, { type: 'buy', uid: minionOffers(s)[0]!.uid });
        const b = s.hand[s.hand.length - 1]!;
        s = reduce(s, { type: 'play', uid: b.uid });
        bought.push(b.uid);
      }
      return shopProcsOver(s, [{ type: 'sell', uid: bought[0]! }, { type: 'sell', uid: 'y' }, { type: 'sell', uid: bought[1]! }]).procs;
    },
  },
  // ── XEROX ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'xerox', ancient: 'death', phase: 'shop', fires: 2,
    note: 'carried 4/5: the 1st Shop death pays, 4 tick, the 6th pays',
    run: () => {
      const s = structuredClone(withA(pickedRun('xerox', 'death', { board: [body('a', T1, { attack: 2 }), body('b', T1, { attack: 7, health: 5 }), ...['d1', 'd2', 'd3', 'd4', 'd5'].map((u) => body(u, OTHER))] }), { xeroxDeaths: 4 }));
      return shopDestroyProcs(s, ['d1', 'd2', 'd3', 'd4', 'd5', 'a']);
    },
  },
  {
    hero: 'xerox', ancient: 'death', phase: 'combat', fires: XEROX_DEATH_COMBAT,
    note: 'carried 4/5: the first combat death pays (copies dying keep counting)',
    run: () => fight(withA(pickedRun('xerox', 'death', { board: [body('big', T1, { attack: 9, health: 1 }), ...['a', 'b'].map((u) => body(u, T1, { attack: 1, health: 1 }))] }), { xeroxDeaths: 4 }), foes(7, 100, 1000)).procs,
  },
  {
    hero: 'xerox', ancient: 'fortune', phase: 'eot', fires: 1,
    note: 'one End-of-Turn beat banks Gold for the two pairs',
    run: () => eotAncientBeats(pickedRun('xerox', 'fortune', { board: [body('a', T1, { health: 99 }), body('b', T1, { health: 99 }), body('c', OTHER, { health: 99 }), body('d', OTHER, { health: 99 })] })),
  },
  {
    hero: 'xerox', ancient: 'war', phase: 'combat', fires: 1,
    note: 'one Start-of-Combat copy',
    run: () => fight(pickedRun('xerox', 'war', { board: [body('a', T1, { attack: 2, health: 11 }), body('c', T1, { attack: 9, health: 3 })] }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'xerox', ancient: 'time', phase: 'sot', fires: 1,
    note: 'the Start-of-Turn copy is its own beat',
    run: () => sotProcsAfterFight(pickedRun('xerox', 'time', { board: [body('a', T1, { attack: 8, health: 40 }), body('b', OTHER, { attack: 2, health: 40 })] }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'xerox', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'two Spiritfires on the original: each gain is mirrored onto the copy once',
    run: () => {
      const s = reduce(pickedRun('xerox', 'bonds', { board: [body('a', T1, { attack: 3, health: 40 })], hand: [fire('f1'), fire('f2')] }), { type: 'heroPower', uid: 'a' });
      need(!!s.ancients?.xeroxBond, 'bound');
      return shopProcsOver(s, [{ type: 'play', uid: 'f1', targetUid: 'a' }, { type: 'play', uid: 'f2', targetUid: 'a' }]).procs;
    },
  },
  {
    hero: 'xerox', ancient: 'bonds', phase: 'combat', fires: XEROX_BONDS_COMBAT,
    note: 'a self-buffing Rally body bound to its copy: each combat gain mirrors once',
    run: () => {
      const s = reduce(pickedRun('xerox', 'bonds', { board: [body('a', SELF_BUFF, { attack: 3, health: 50 })] }), { type: 'heroPower', uid: 'a' });
      const r = fight(s, foes(7, 0, 60));
      need(sourcedBuffs(r.events, 'Ancient of Bonds') === XEROX_BONDS_COMBAT, `mirrors ${sourcedBuffs(r.events, 'Ancient of Bonds')}`);
      return r.procs;
    },
  },
  // ── TRADESMAN (hermithank) ────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'hermithank', ancient: 'death', phase: 'shop', fires: 2,
    note: 'carried 2/3: the 1st and 4th Shop deaths bank a free Refresh',
    run: () => {
      const s = structuredClone(withA(pickedRun('hermithank', 'death', { board: ['d1', 'd2', 'd3', 'd4'].map((u) => body(u, T1)) }), { tradesDeaths: 2 }));
      return shopDestroyProcs(s, ['d1', 'd2', 'd3', 'd4']);
    },
  },
  {
    hero: 'hermithank', ancient: 'death', phase: 'combat', fires: 2,
    note: 'carried 2/3: the 1st and 4th combat deaths (the Refresh-Avenge flag, aliased)',
    run: () => {
      const r = fight(withA(pickedRun('hermithank', 'death', { board: ['a', 'b', 'c', 'd'].map((u) => body(u, T1, { attack: 1, health: 1 })) }), { tradesDeaths: 2 }), foes(7, 100, 1000));
      need(deaths(r.events) === 4, `deaths ${deaths(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'hermithank', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'a buy arms the free Refresh; a second buy while armed does not; the Refresh spends it; the next buy re-arms',
    run: () => shopProcsOver(pickedRun('hermithank', 'fortune'), [
      (t) => ({ type: 'buy', uid: minionOffers(t)[0]!.uid }), (t) => ({ type: 'buy', uid: minionOffers(t)[0]!.uid }),
      { type: 'roll' }, (t) => ({ type: 'buy', uid: minionOffers(t)[0]!.uid }),
    ]).procs,
  },
  {
    hero: 'hermithank', ancient: 'war', phase: 'combat', fires: TRADES_WAR_COMBAT,
    note: 'each grafted Rally banks Gold (the Rally-Gold flag, aliased)',
    run: () => {
      const s = reduce(pickedRun('hermithank', 'war', { board: [body('a', T1, { attack: 1, health: 400 }), body('b', OTHER, { attack: 1, health: 400 })] }), { type: 'freeze' });
      const r = fight(s, foes(7, 0, 30));
      const mine = new Set(r.s.lastCombat!.initial.player.map((m) => m.uid));
      const attacks = r.events.filter((e) => e.type === 'attack' && mine.has((e as { attacker?: string }).attacker ?? '')).length;
      need(attacks === TRADES_WAR_COMBAT, `one Rally per attack: ${attacks} attacks`);
      return r.procs;
    },
  },
  {
    hero: 'hermithank', ancient: 'genesis', phase: 'shop', fires: 2,
    note: 'four Refreshes: the 2nd and 4th cast Lasso',
    run: () => shopProcsOver(pickedRun('hermithank', 'genesis'), [{ type: 'roll' }, { type: 'roll' }, { type: 'roll' }, { type: 'roll' }]).procs,
  },
  {
    hero: 'hermithank', ancient: 'time', phase: 'eot', fires: 1,
    note: 'one End-of-Turn beat cuts the upgrade price',
    run: () => eotAncientBeats(pickedRun('hermithank', 'time', { board: [body('a', T1, { health: 400 })], upgradeCost: 7 })),
  },
  {
    hero: 'hermithank', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'two Refreshes each cut the upgrade price',
    run: () => shopProcsOver(pickedRun('hermithank', 'bonds', { upgradeCost: 5 }), [{ type: 'roll' }, { type: 'roll' }]).procs,
  },
  // ── SOREN ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'soren', ancient: 'death', phase: 'combat', fires: 1,
    note: "the Reclaimed body's Echo fires its extra time",
    run: () => fight(reduce(pickedRun('soren', 'death', { board: [body('e', ECHO, { health: 50 }), body('x', T1, { health: 50 })] }), { type: 'heroPower', uid: 'e' }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'soren', ancient: 'war', phase: 'combat', fires: 1,
    note: 'the Reclaimed copy returns with +10/+10',
    run: () => fight(reduce(pickedRun('soren', 'war', { board: [body('a', T1, { health: 40 })] }), { type: 'heroPower', uid: 'a' }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'soren', ancient: 'time', phase: 'combat', fires: 1,
    note: 'one Reclaim resummons two copies: one fire',
    run: () => fight(reduce(pickedRun('soren', 'time', { board: [body('a', T1, { health: 40 })] }), { type: 'heroPower', uid: 'a' }), foes(7, 0, 400)).procs,
  },
  {
    hero: 'soren', ancient: 'bonds', phase: 'combat', fires: 1,
    note: 'the returned copy gives both neighbours its Attack',
    run: () => fight(reduce(pickedRun('soren', 'bonds', { board: [body('l', OTHER, { attack: 1, health: 40 }), body('a', T1, { attack: 7, health: 40 }), body('r', OTHER, { attack: 1, health: 40 })] }), { type: 'heroPower', uid: 'a' }), foes(7, 0, 400)).procs,
  },
  // ── ROBIN ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'robin', ancient: 'death', phase: 'shop', fires: 2,
    note: 'carried 2/3: the 1st and 4th Shop deaths get a Buddy Buddy',
    run: () => {
      const s = structuredClone(withA(pickedRun('robin', 'death', { board: ['d1', 'd2', 'd3', 'd4'].map((u, i) => body(u, N(i))) }), { gildDeaths: 2 }));
      return shopDestroyProcs(s, ['d1', 'd2', 'd3', 'd4']);
    },
  },
  {
    hero: 'robin', ancient: 'death', phase: 'combat', fires: 2,
    note: 'carried 2/3: the 1st and 4th combat deaths',
    run: () => {
      const r = fight(withA(pickedRun('robin', 'death', { board: ['a', 'b', 'c', 'd'].map((u, i) => body(u, N(i), { attack: 1, health: 1 })) }), { gildDeaths: 2 }), foes(7, 100, 1000));
      need(deaths(r.events) === 4, `deaths ${deaths(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'robin', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'five sales: the 2nd and 4th bank a free Refresh',
    run: () => {
      const hand = ['h0', 'h1', 'h2', 'h3', 'h4'].map((u, i) => body(u, N(i)));
      return shopProcsOver(pickedRun('robin', 'fortune', { hand }), hand.map((c) => ({ type: 'sell', uid: c.uid }) as const)).procs;
    },
  },
  {
    hero: 'robin', ancient: 'war', phase: 'shop', fires: 2,
    note: 'two sales from hand buff the left-most board minion',
    run: () => shopProcsOver(pickedRun('robin', 'war', { board: [body('a', N(0), { health: 99 })], hand: [body('h0', N(1)), body('h1', N(2))] }), [{ type: 'sell', uid: 'h0' }, { type: 'sell', uid: 'h1' }]).procs,
  },
  {
    hero: 'robin', ancient: 'genesis', phase: 'shop', fires: 1,
    note: 'the 7th sale pays a copy; the first six do not',
    run: () => {
      const hand = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((u, i) => body(u, N(i)));
      return shopProcsOver(pickedRun('robin', 'genesis', { hand }), hand.map((c) => ({ type: 'sell', uid: c.uid }) as const)).procs;
    },
  },
  {
    hero: 'robin', ancient: 'time', phase: 'eot', fires: 1,
    note: 'one End-of-Turn beat adds max Gold',
    run: () => eotAncientBeats(pickedRun('robin', 'time', { board: [body('a', N(0), { health: 99 })] })),
  },
  {
    hero: 'robin', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'a Beast and a Demon sale each mark a type; a second Beast sale and a neutral sale add nothing',
    run: () => shopProcsOver(pickedRun('robin', 'bonds', { board: [body('b1', typedId('beast')), body('b2', typedId('beast')), body('d', typedId('demon')), body('n', N(0))] }),
      [{ type: 'sell', uid: 'b1' }, { type: 'sell', uid: 'b2' }, { type: 'sell', uid: 'n' }, { type: 'sell', uid: 'd' }]).procs,
  },
  // ── RE-PETE ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'repete', ancient: 'death', phase: 'combat', fires: 1,
    note: 'after combat: one copy of the last friendly death',
    run: () => {
      const r = fight(pickedRun('repete', 'death', { wave: 1, board: [body('a', N(0), { attack: 1, health: 5 }), body('b', N(1), { attack: 1, health: 5 })] }), foes(1, 50, 1000));
      need(deaths(r.events) === 2, 'two deaths');
      return r.procs;
    },
  },
  {
    hero: 'repete', ancient: 'fortune', phase: 'shop', fires: 1,
    note: 'six buys: only the 6th opens the Discover',
    run: () => buyProcs(pickedRun('repete', 'fortune', { wave: 4 }), [N(0), N(1), N(2), N(3), N(4), N(5)]).procs,
  },
  {
    hero: 'repete', ancient: 'war', phase: 'shop', fires: 2,
    note: 'two duplicate plays fire; a play with no copy on board does not',
    run: () => shopProcsOver(pickedRun('repete', 'war', { board: [body('a', N(0)), body('b', N(1))], hand: [body('h', N(0)), body('k', N(2)), body('j', N(1))] }),
      [{ type: 'play', uid: 'h' }, { type: 'play', uid: 'k' }, { type: 'play', uid: 'j' }]).procs,
  },
  {
    hero: 'repete', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'two Discover picks',
    run: () => {
      const s: RunState = { ...pickedRun('repete', 'bonds'), discover: [N(0), N(1), N(2)] };
      return shopProcsOver(s, [{ type: 'discover', index: 0 }, (t) => { t.discover = [N(3), N(4)]; return { type: 'discover', index: 1 }; }]).procs;
    },
  },
  // ── GORR ──────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'gorr', ancient: 'death', phase: 'shop', fires: 2,
    note: 'carried 5/6 with a last-turn buy logged: the 1st and 7th Shop deaths pay',
    run: () => {
      const s0 = pickedRun('gorr', 'death', { wave: 5, board: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((u) => body(u, N(3))) });
      const s = structuredClone(withA(s0, { gorrDeaths: 5, gorrBuys: [{ wave: 4, ids: [N(0)] }] }));
      return shopDestroyProcs(s, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']);
    },
  },
  {
    hero: 'gorr', ancient: 'death', phase: 'combat', fires: 2,
    note: 'carried 5/6 with a last-turn buy: the 1st and 7th combat deaths pay',
    run: () => {
      const s0 = pickedRun('gorr', 'death', { wave: 5, board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => body(u, N(2), { attack: 1, health: 1 })) });
      const r = fight(withA(s0, { gorrDeaths: 5, gorrBuys: [{ wave: 4, ids: [N(0)] }] }), foes(5, 100, 1000));
      need(deaths(r.events) === 7, `deaths ${deaths(r.events)}`);
      return r.procs;
    },
  },
  {
    hero: 'gorr', ancient: 'war', phase: 'combat', fires: 1,
    note: 'Pummel (200) pays once per fight however many 200s it crosses',
    run: () => fight(pickedRun('gorr', 'war', { wave: 3, board: [body('a', N(0), { attack: 90, health: 500 }), body('b', N(1), { attack: 90, health: 500 })] }), foes(3, 1, 2000)).procs,
  },
  {
    hero: 'gorr', ancient: 'genesis', phase: 'shop', fires: 1,
    note: 'the first minion bought gets a copy; the second does not',
    run: () => buyProcs(pickedRun('gorr', 'genesis', { wave: 3 }), [N(0), N(1)]).procs,
  },
  {
    hero: 'gorr', ancient: 'time', phase: 'eot', fires: 1,
    note: 'one End-of-Turn beat refreshes into the top type and freezes',
    run: () => {
      const s0 = pickedRun('gorr', 'time', { wave: 3 });
      const tribe = s0.tribes.find((t) => t !== 'neutral')!;
      return eotAncientBeats({ ...s0, frozen: false, board: [body('a', typedId(tribe)), body('b', typedId(tribe)), body('c', N(0))] });
    },
  },
  {
    hero: 'gorr', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'six buys: the 3rd and 6th pay',
    run: () => buyProcs(pickedRun('gorr', 'bonds', { wave: 3 }), [N(0), N(1), N(2), N(3), N(4), N(5)]).procs,
  },
];
