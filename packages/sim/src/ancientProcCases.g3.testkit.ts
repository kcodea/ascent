/** Ancient trigger proc cases, group 3 (R-FX-ANCIENT-PROC-01): see `ancientProcs.test.ts`. Keshi, Disco Dan, Kindness,
 *  Merrin, Emissary (vale), Emerald Warden, Rascal (baggerben), Gambler, Pete, Flint, Juggler, Underdweller, Membrance,
 *  Gorun, Mimic. */
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import type { BoardCard, RunState } from './index';
import { body, eotAncientBeats, fight, foes, pickedRun, shopProcs, shopProcsOver, sotProcsAfterFight, type ProcCase } from './ancientProcs.testkit';
import { destroyMinionInShop, makeContext } from './recruit';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number): string => NEUTRALS[i % NEUTRALS.length]!;
/** `n` plain 1/1 bodies (they die to anything). */
const frail = (n: number, prefix = 'f'): BoardCard[] => Array.from({ length: n }, (_, i) => body(`${prefix}${i}`, N(i), { attack: 1, health: 1 }));
const procsOf = (s: RunState): number => s.ancients?.procs ?? 0;
const withAncients = (s: RunState, over: Record<string, unknown>): RunState => ({ ...s, ancients: { ...s.ancients!, ...over } } as RunState);

/** Kill the first `n` board minions in the Shop (the shared Shop death body), on a clone; the Shop procs it made. */
function shopDeaths(s: RunState, n: number): number {
  const c = structuredClone(s);
  const before = procsOf(c);
  for (let i = 0; i < n; i++) destroyMinionInShop(makeContext(c), c.board[0]!);
  return procsOf(c) - before;
}
/** A board of `n` frail bodies dies to a 100-Attack wall: the combat procs. */
const combatDeaths = (s: RunState): number => fight(s, foes(s.wave, 100, 100000)).procs;
/** Buy offers (each a one-offer row) in turn, summing the Shop procs. */
function buys(s: RunState, offers: readonly Partial<RunState['shop'][number]>[]): { s: RunState; procs: number } {
  let procs = 0;
  offers.forEach((o, i) => {
    const uid = `buy${i}`;
    const r = shopProcs({ ...s, shop: [{ uid, cardId: N(0), ...o } as RunState['shop'][number]] }, { type: 'buy', uid });
    if (r.next === s) throw new Error(`could not buy ${o.cardId}`);
    s = r.next; procs += r.procs;
  });
  return { s, procs };
}
const reward = (uid: string, tier: number, crown = false): BoardCard => body(uid, 'discoverspell', { grantedTier: tier, ...(crown ? { crownReward: true } : {}) });
/** A Gift that changes no stats: one clean "spell cast" for the counters (Merrin's own suite). */
const gift = (uid: string): BoardCard => body(uid, 'gift_arcane_clearance');
/** A board that casts a spell mid-fight: three bodies die, then Riftwalker's Avenge (3) casts Waking Rift (Merrin's suite). */
const riftBoard = (): BoardCard[] => [...frail(3), body('rw', 'd3_riftwalker', { attack: 1, health: 5000 })];
const playerAttacks = (events: readonly CombatEvent[], mine: ReadonlySet<string>): number => events.filter((e) => e.type === 'attack' && mine.has(e.attacker)).length;
const DWARVES = Object.values(CARD_INDEX).filter((c) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && !c.universalTribe && c.tribe === 'dwarf' && !c.tribe2 && !c.henchman).map((c) => c.id);
const DWARF = DWARVES[0]!;
/** Mimic: createRun opens the Mimicry offer; clear it (Mimic's own suite does the same). */
const MIMIC = { powerOffer: undefined, pendingPowerOffer: undefined } as Partial<RunState>;

export const CASES: ProcCase[] = [
  // ── KESHI ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'keshi', ancient: 'death', phase: 'shop', fires: 2, note: 'count at 3: the 1st death pays, 3 ticks, the 5th pays',
    run: () => shopDeaths(withAncients(pickedRun('keshi', 'death', { board: frail(6) }), { keshiDeaths: 3 }), 5),
  },
  {
    hero: 'keshi', ancient: 'death', phase: 'combat', fires: 1, note: 'five deaths in the fight: the 4th pays (per combat: the Shop count of 3 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('keshi', 'death', { board: frail(5) }), { keshiDeaths: 3 })),
  },
  {
    hero: 'keshi', ancient: 'fortune', phase: 'shop', fires: 2, note: 'two Triple Rewards opened (a plain one and a Crown one)',
    run: () => shopProcsOver(pickedRun('keshi', 'fortune', { tier: 3, hand: [reward('r1', 3), reward('r2', 3, true)] }),
      [{ type: 'play', uid: 'r1' }, { type: 'discover', index: 0 }, { type: 'play', uid: 'r2' }, { type: 'discover', index: 0 }]).procs,
  },
  {
    hero: 'keshi', ancient: 'war', phase: 'shop', fires: 2, note: 'two Crown picks gain their keyword; a plain Triple Reward pick does not',
    run: () => shopProcsOver(pickedRun('keshi', 'war', { tier: 3, hand: [reward('r1', 3, true), reward('r2', 3), reward('r3', 3, true)] }),
      [{ type: 'play', uid: 'r1' }, { type: 'discover', index: 0 }, { type: 'play', uid: 'r2' }, { type: 'discover', index: 0 }, { type: 'play', uid: 'r3' }, { type: 'discover', index: 0 }]).procs,
  },
  {
    hero: 'keshi', ancient: 'time', phase: 'sot', fires: 1, note: 'the Start of Turn Beyond the Summit',
    run: () => sotProcsAfterFight(pickedRun('keshi', 'time', { board: [body('a', N(0), { health: 50 })] })).procs,
  },
  // ── DISCO DAN ─────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'discodan', ancient: 'time', phase: 'eot', fires: 1, note: 'the End-of-Turn upgrade discount',
    run: () => eotAncientBeats({ ...pickedRun('discodan', 'time', { discover: undefined, discoverQueue: [] } as Partial<RunState>), upgradeCost: 7 }),
  },
  // ── KINDNESS ──────────────────────────────────────────────────────────────────────────────────────────────────
  // DEATH / WAR: the Gift rides Great Presence's own Start-of-Turn beat, which is labelled "Great Presence" (the hero
  // power's name), not the Ancient's, so no Ancient burst plays. These assert what it SHOULD be (reported, R-FX-ANCIENT-PROC-01).
  {
    hero: 'kindness', ancient: 'death', phase: 'sot', fires: 1, note: 'turn 4 Great Presence + Grave Invitation (beat labelled "Great Presence": no Ancient burst)',
    run: () => sotProcsAfterFight(pickedRun('kindness', 'death', { wave: 3 })).procs,
  },
  {
    hero: 'kindness', ancient: 'war', phase: 'sot', fires: 1, note: 'turn 4 Great Presence + Regalia (beat labelled "Great Presence": no Ancient burst)',
    run: () => sotProcsAfterFight(pickedRun('kindness', 'war', { wave: 3 })).procs,
  },
  {
    hero: 'kindness', ancient: 'time', phase: 'eot', fires: 1, note: 'End of Turn: two Shop spells',
    run: () => eotAncientBeats(pickedRun('kindness', 'time', { tier: 2 })),
  },
  {
    hero: 'kindness', ancient: 'bonds', phase: 'shop', fires: 2, note: 'two Gifts cast on an end minion also cast on its neighbour; alone on the board nothing extra',
    run: () => {
      const two = shopProcsOver(pickedRun('kindness', 'bonds', { board: [body('a', N(0)), body('b', N(1)), body('c', N(2))], hand: [body('g1', 'gift_regalia'), body('g2', 'gift_regalia')] }),
        [{ type: 'play', uid: 'g1', targetUid: 'a' }, { type: 'play', uid: 'g2', targetUid: 'c' }]).procs;
      const solo = shopProcs(pickedRun('kindness', 'bonds', { board: [body('a', N(0))], hand: [body('g', 'gift_regalia')] }), { type: 'play', uid: 'g', targetUid: 'a' }).procs;
      return two + solo;
    },
  },
  // ── MERRIN ────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'merrin', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (3): six Shop deaths',
    run: () => shopDeaths(pickedRun('merrin', 'death', { tier: 3, board: frail(7) }), 6),
  },
  {
    hero: 'merrin', ancient: 'death', phase: 'combat', fires: 2, note: 'Avenge (3): six combat deaths',
    run: () => combatDeaths(pickedRun('merrin', 'death', { tier: 3, board: frail(6) })),
  },
  {
    hero: 'merrin', ancient: 'time', phase: 'shop', fires: 2, note: 'six casts: the 3rd and 6th recharge',
    run: () => shopProcsOver(pickedRun('merrin', 'time', { tier: 3, hand: [gift('g1'), gift('g2'), gift('g3'), gift('g4'), gift('g5'), gift('g6')] }),
      ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((uid) => ({ type: 'play' as const, uid }))).procs,
  },
  {
    hero: 'merrin', ancient: 'time', phase: 'combat', fires: 1, note: 'count at 2: the fight\'s first cast is the 3rd',
    run: () => fight(withAncients(pickedRun('merrin', 'time', { tier: 3, board: riftBoard() }), { batchBSpells: 2 }), foes(1, 100, 100000)).procs,
  },
  {
    hero: 'merrin', ancient: 'bonds', phase: 'shop', fires: 2, note: 'two casts, each buffs one minion of each type',
    run: () => shopProcsOver(pickedRun('merrin', 'bonds', { tier: 3, board: [body('a', 'beatboxer')], hand: [gift('g1'), gift('g2')] }),
      [{ type: 'play', uid: 'g1' }, { type: 'play', uid: 'g2' }]).procs,
  },
  {
    hero: 'merrin', ancient: 'bonds', phase: 'combat', fires: 1, note: 'Waking Rift cast mid-fight buffs one of each type',
    run: () => fight(pickedRun('merrin', 'bonds', { tier: 3, board: riftBoard() }), foes(1, 100, 100000)).procs,
  },
  // ── EMISSARY (vale) ───────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'vale', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (4): eight Shop deaths',
    run: () => shopDeaths(pickedRun('vale', 'death', { spellsCast: 2, board: frail(9) } as Partial<RunState>), 8),
  },
  {
    hero: 'vale', ancient: 'death', phase: 'combat', fires: 1, note: 'Avenge (4): four deaths in the fight, the 4th pays (the Shop count of 3 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('vale', 'death', { spellsCast: 2, board: frail(4) } as Partial<RunState>), { batchBDeaths: 3 })),
  },
  {
    hero: 'vale', ancient: 'genesis', phase: 'shop', fires: 2, note: 'count at 4: six casts, the 1st and 6th pay',
    run: () => shopProcsOver(withAncients(pickedRun('vale', 'genesis', { tier: 3, hand: [gift('g1'), gift('g2'), gift('g3'), gift('g4'), gift('g5'), gift('g6')] }), { batchBSpells: 4 }),
      ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((uid) => ({ type: 'play' as const, uid }))).procs,
  },
  {
    hero: 'vale', ancient: 'genesis', phase: 'combat', fires: 1, note: 'count at 4: the fight\'s first cast is the 5th',
    run: () => fight(withAncients(pickedRun('vale', 'genesis', { tier: 3, board: riftBoard() }), { batchBSpells: 4 }), foes(1, 100, 100000)).procs,
  },
  {
    hero: 'vale', ancient: 'time', phase: 'eot', fires: 1, note: 'End of Turn United Front',
    run: () => eotAncientBeats(pickedRun('vale', 'time', { spellsCast: 3, board: [body('a', 'beatboxer')] } as Partial<RunState>)),
  },
  // ── EMERALD WARDEN ────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'emeraldwarden', ancient: 'death', phase: 'shop', fires: 1, note: 'count at 5: the 1st death pays; the next 6 reach another 6th, spent (once per turn)',
    run: () => shopDeaths(withAncients(pickedRun('emeraldwarden', 'death', { board: frail(8) }), { batchBDeaths: 5 }), 7),
  },
  {
    hero: 'emeraldwarden', ancient: 'death', phase: 'combat', fires: 1, note: 'seven deaths in the fight: the 6th pays, once per turn (the Shop count of 5 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('emeraldwarden', 'death', { board: frail(7) }), { batchBDeaths: 5 })),
  },
  {
    hero: 'emeraldwarden', ancient: 'time', phase: 'eot', fires: 1, note: 'End of Turn: a minion of your Tier',
    run: () => eotAncientBeats(pickedRun('emeraldwarden', 'time')),
  },
  // ── RASCAL (baggerben) ────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'baggerben', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (4): eight Shop deaths',
    run: () => shopDeaths(pickedRun('baggerben', 'death', { board: frail(9) }), 8),
  },
  {
    hero: 'baggerben', ancient: 'death', phase: 'combat', fires: 1, note: 'Avenge (4): seven combat deaths, the 4th pays (per combat: the Shop count of 1 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('baggerben', 'death', { board: frail(7) }), { rascalDeaths: 1 })),
  },
  {
    hero: 'baggerben', ancient: 'time', phase: 'sot', fires: 1, note: 'Start of Turn Gold',
    run: () => sotProcsAfterFight(pickedRun('baggerben', 'time', { board: [body('a', N(0), { health: 50 })] })).procs,
  },
  // ── GAMBLER ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'gambler', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (4): eight Shop deaths',
    run: () => shopDeaths(pickedRun('gambler', 'death', { board: frail(9) }), 8),
  },
  {
    hero: 'gambler', ancient: 'death', phase: 'combat', fires: 1, note: 'Avenge (4): seven combat deaths, the 4th pays (per combat: the Shop count of 1 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('gambler', 'death', { board: frail(7) }), { gamblerDeaths: 1 })),
  },
  // ── PETE ──────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'pete', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (3): six Shop deaths',
    run: () => shopDeaths(pickedRun('pete', 'death', { board: frail(7) }), 6),
  },
  {
    hero: 'pete', ancient: 'death', phase: 'combat', fires: 2, note: 'Avenge (3): six combat deaths',
    run: () => combatDeaths(pickedRun('pete', 'death', { board: frail(6) })),
  },
  {
    hero: 'pete', ancient: 'fortune', phase: 'shop', fires: 2, note: 'two Contrabanana buys; a plain buy does not',
    run: () => buys(pickedRun('pete', 'fortune'), [{ cardId: N(0), banana: true }, { cardId: N(1) }, { cardId: N(2), banana: true }]).procs,
  },
  {
    hero: 'pete', ancient: 'war', phase: 'shop', fires: 2, note: 'six Refreshes: the 3rd and 6th roll a Contrabanana with a keyword',
    run: () => shopProcsOver({ ...pickedRun('pete', 'war', { tier: 2 }), refreshCount: 0 } as RunState, Array.from({ length: 6 }, () => ({ type: 'roll' as const }))).procs,
  },
  // ── FOREMAN FLINT ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'flint', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (4): eight Shop deaths',
    run: () => shopDeaths(pickedRun('flint', 'death', { board: frail(9) }), 8),
  },
  {
    hero: 'flint', ancient: 'death', phase: 'combat', fires: 1, note: 'Avenge (4): seven combat deaths, the 4th pays (per combat: the Shop count of 1 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('flint', 'death', { board: frail(7) }), { flintDeaths: 1 })),
  },
  {
    hero: 'flint', ancient: 'war', phase: 'combat', fires: 1, note: 'Start of Combat Dwarf buff (2 Dwarves bought this game)',
    run: () => fight(withAncients(pickedRun('flint', 'war', { board: [body('d', DWARF, { health: 50 })] }), { flintDwarvesBought: 2 })).procs,
  },
  {
    hero: 'flint', ancient: 'time', phase: 'eot', fires: 1, note: 'a Dwarf bought this turn: the End-of-Turn buff',
    run: () => eotAncientBeats(buys(pickedRun('flint', 'time', { board: [body('a', N(0))] }), [{ cardId: DWARF }]).s),
  },
  {
    hero: 'flint', ancient: 'bonds', phase: 'shop', fires: 2, note: 'two Dwarf buys with a Dwarf on board; a non-Dwarf buy does not',
    run: () => buys(pickedRun('flint', 'bonds', { board: [body('d', DWARF)] }), [{ cardId: DWARF }, { cardId: N(0) }, { cardId: DWARVES[1]! }]).procs, // a different Dwarf: three of one would triple
  },
  // ── JUGGLER ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'juggler', ancient: 'death', phase: 'shop', fires: 2, note: 'Avenge (4): eight Shop deaths',
    run: () => shopDeaths(pickedRun('juggler', 'death', { board: frail(9) }), 8),
  },
  {
    hero: 'juggler', ancient: 'death', phase: 'combat', fires: 1, note: 'Avenge (4): seven combat deaths, the 4th pays (per combat: the Shop count of 1 never comes in)',
    run: () => combatDeaths(withAncients(pickedRun('juggler', 'death', { board: frail(7) }), { gildDeaths: 1 })),
  },
  {
    hero: 'juggler', ancient: 'war', phase: 'shop', fires: 2, note: 'two Carnival Coins cast',
    run: () => shopProcsOver(pickedRun('juggler', 'war', { board: [body('a', N(0))], hand: [body('c1', 'carnivalcoin'), body('c2', 'carnivalcoin')] }),
      [{ type: 'play', uid: 'c1' }, { type: 'play', uid: 'c2' }]).procs,
  },
  {
    hero: 'juggler', ancient: 'time', phase: 'eot', fires: 1, note: 'End of Turn: two Coins in hand improve',
    run: () => eotAncientBeats(pickedRun('juggler', 'time', { board: [body('a', N(0))], hand: [body('c1', 'carnivalcoin'), body('c2', 'carnivalcoin')] })),
  },
  // ── UNDERDWELLER ──────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'underdweller', ancient: 'time', phase: 'combat', fires: 1, note: 'after combat: a copy of the first enemy death (two enemies die)',
    run: () => fight(pickedRun('underdweller', 'time', { board: [body('a', N(0), { attack: 50, health: 500 })] }), foes(1, 1, 2, 2)).procs,
  },
  {
    hero: 'underdweller', ancient: 'bonds', phase: 'shop', fires: 2, note: 'two buys of a copy of a minion you control; another buy does not',
    run: () => {
      const s = pickedRun('underdweller', 'bonds', { board: [body('a', N(0)), body('b', N(1))] });
      // A bought copy lands in hand (the buy path) only when the board is full; buy them to hand via a full board.
      const full = { ...s, board: [...s.board, ...frail(5, 'x').map((c, i) => ({ ...c, cardId: N(i + 2) }))] } as RunState;
      return buys(full, [{ cardId: N(0) }, { cardId: N(9) }, { cardId: N(1) }]).procs;
    },
  },
  // ── MEMBRANCE ─────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'membrance', ancient: 'genesis', phase: 'shop', fires: 1, note: 'the first Memory buy of the turn comes with a copy; the second does not',
    run: () => buys(pickedRun('membrance', 'genesis'), [{ cardId: N(0), memory: true }, { cardId: N(1), memory: true }]).procs,
  },
  {
    hero: 'membrance', ancient: 'time', phase: 'sot', fires: 1, note: 'Start of Turn: a copy of a minion from the last opponent',
    run: () => sotProcsAfterFight(pickedRun('membrance', 'time', { board: [body('a', N(0), { health: 50 })] })).procs,
  },
  {
    hero: 'membrance', ancient: 'bonds', phase: 'shop', fires: 2, note: 'two Gilded minions played; a plain one does not',
    run: () => {
      const g = (uid: string, id: string): BoardCard => body(uid, id, { golden: true, attack: CARD_INDEX[id]!.attack * 2, health: CARD_INDEX[id]!.health * 2 });
      return shopProcsOver(pickedRun('membrance', 'bonds', { tier: 2, hand: [g('g1', N(0)), body('p', N(1)), g('g2', N(2))] }),
        [{ type: 'play', uid: 'g1' }, { type: 'play', uid: 'p' }, { type: 'play', uid: 'g2' }]).procs;
    },
  },
  // ── GORUN ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'gorun', ancient: 'death', phase: 'shop', fires: 2, note: 'twice per turn: three Shop deaths, the third gives nothing',
    run: () => shopDeaths(pickedRun('gorun', 'death', { board: [...frail(3), body('h', N(5), { health: 50 })] }), 3),
  },
  {
    hero: 'gorun', ancient: 'death', phase: 'combat', fires: 2, note: 'twice per turn: many combat deaths, two gifts',
    run: () => combatDeaths(pickedRun('gorun', 'death', { board: frail(5) })),
  },
  {
    hero: 'gorun', ancient: 'fortune', phase: 'combat', fires: 2, note: 'count at 3: seven attacks (one per harmless foe) pay at the 1st and 5th',
    run: () => {
      const s = withAncients(pickedRun('gorun', 'fortune', { board: [body('a', N(0), { attack: 5, health: 100 }), body('b', N(1), { attack: 5, health: 100 })] }), { gorunAttacks: 3 });
      const r = fight(s, foes(s.wave, 0, 1, 7));
      const mine = new Set(r.s.lastCombat!.initial.player.map((m) => m.uid));
      const n = playerAttacks(r.events, mine);
      if (n !== 7) throw new Error(`the scenario needs exactly 7 friendly attacks, saw ${n}`);
      return r.procs;
    },
  },
  {
    hero: 'gorun', ancient: 'genesis', phase: 'combat', fires: 1, note: 'Start of Combat Ward + Flurry',
    run: () => fight(pickedRun('gorun', 'genesis', { board: [body('a', N(0), { health: 50 }), body('b', N(1), { health: 50 })] })).procs,
  },
  {
    hero: 'gorun', ancient: 'time', phase: 'combat', fires: 1, note: 'Start of Combat Blade Mastery once',
    run: () => fight(pickedRun('gorun', 'time', { board: [body('a', N(0), { health: 50 })] })).procs,
  },
  // ── MIMIC ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    hero: 'mimic', ancient: 'death', phase: 'combat', fires: 1, note: 'Start of Combat: the left-most Echo is Reclaimed',
    run: () => {
      const echo = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon')!.id;
      return fight(pickedRun('mimic', 'death', { ...MIMIC, board: [body('e', echo, { health: 50 }), body('a', N(0), { health: 50 })] })).procs;
    },
  },
  {
    hero: 'mimic', ancient: 'fortune', phase: 'shop', fires: 2, note: 'two sales',
    run: () => shopProcsOver(pickedRun('mimic', 'fortune', { ...MIMIC, board: [body('a', N(0)), body('b', N(1))] }), [{ type: 'sell', uid: 'a' }, { type: 'sell', uid: 'b' }]).procs,
  },
  {
    hero: 'mimic', ancient: 'war', phase: 'eot', fires: 1, note: 'End of Turn United Front (4 Shop spells cast this game)',
    run: () => eotAncientBeats(withAncients(pickedRun('mimic', 'war', { ...MIMIC, board: [body('a', 'beatboxer')] }), { shopSpellsCast: 4 })),
  },
  {
    hero: 'mimic', ancient: 'time', phase: 'sot', fires: 1, note: 'Start of Turn: a copy of a minion that died last combat',
    run: () => sotProcsAfterFight(pickedRun('mimic', 'time', { ...MIMIC, board: [body('a', N(0), { attack: 50, health: 50 })] }), foes(1, 1, 1)).procs,
  },
  {
    hero: 'mimic', ancient: 'bonds', phase: 'shop', fires: 1, note: 'the 3rd minion bought this turn pays; the 4th does not',
    run: () => buys(pickedRun('mimic', 'bonds', MIMIC), [{ cardId: N(0) }, { cardId: N(1) }, { cardId: N(2) }, { cardId: N(3) }]).procs,
  },
];


