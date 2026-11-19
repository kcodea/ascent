/**
 * Ancient trigger proc cases, the Duos heroes (R-FX-ANCIENT-PROC-01): Priestess, Magician and Cindy. Ancients reach Duos
 * since #2758 (`createVersusRun` duos releases them), so their event-fired pairings proc like every other hero's. Runs are
 * built the way the per-hero Ancient tests build them (`createVersusRun` duos + `pickAncient`). See `ancientProcs.test.ts`.
 *
 * Not a row: Cindy × Bonds (the Link mirror is a stat link riding both teammates' runs, one of which has no Ancient; the
 * mirrored gain itself is what shows), and the pairings that only reshape a power's own use (Passaria's price / copy,
 * the Magic Hat's cadence, cap and copy keywords, Golden Gratitude's Gilded copy).
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type CombatEvent } from '@game/core';
import { ANCIENT_IDS, ancientStartOfTurn, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard } from './index';
import { createVersusRun, buildVersusCandidate } from './versus/run';
import { resolveVersusDuosRound } from './versus/duos';
import type { VersusRoomOptions } from './versus/options';
import { duosWireOf } from './duosPass';
import { fireOnFriendDeath } from './recruit';
import { combatProcCount, sotAncientBeats, type ProcCase } from './ancientProcs.testkit';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const minions = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby).map((c) => c!);
const ECHO = minions.find((c) => c.effects.some((e) => e.on === 'onDeath') && c.effects.length === 1 && !c.keywords.includes('R') && !c.keywords.includes('T') && c.tier <= 3)!.id;
const PLAIN = minions.filter((c) => c.effects.length === 0 && c.keywords.length === 0 && c.tier <= 4).map((c) => c.id);
const SPELL = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.token && !c.ruby && !c.duos && c.tier <= 2)!.id;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const offer = (i: number, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${i}`, cardId: PLAIN[i % PLAIN.length]!, ...over });

/** A Duos run of `hero` (teammate Warden) with Ancients on and `id` picked through the real `pickAncient`. */
function duosPicked(hero: string, id: AncientId, over: Partial<RunState> = {}, seed = 11): RunState {
  let s = { ...createVersusRun(seed, hero, 'set2', DUOS, 'warden', { ancients: true }), phase: 'recruit', embers: 400, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState;
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  if (s.ancients?.picked !== id) throw new Error(`${hero} × ${id}: the pick did not land`);
  return s;
}
const mateOf = (hero: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createVersusRun(12, 'warden', 'set2', DUOS, hero), phase: 'recruit', embers: 100, hand: [], board: [], shop: [offer(0), offer(1), offer(2)], spell: null, ...over } as RunState);
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const procs = (prev: RunState, next: RunState): number => (next.ancients?.procs ?? 0) - (prev.ancients?.procs ?? 0);
/** Shop procs across `steps`, each one action. */
function over(s: RunState, steps: ((s: RunState) => RunState)[]): number {
  let n = 0;
  for (const step of steps) { const next = step(s); n += procs(s, next); s = next; }
  return n;
}
const drag = (uid: string) => (s: RunState): RunState => reduce(s, { type: 'passCard', uid });

/** The run's locked side fought against one big foe (the side's own Ancient mods ride in its state). */
function lockedFight(s: RunState, seed = 3): CombatEvent[] {
  const side = buildVersusCandidate(s, makeRng(seed))!;
  const foe = [{ cardId: PLAIN[0]!, attack: 1, health: 500, keywords: [] }];
  return simulate(structuredClone(side.board), foe, makeRng(5), CARD_INDEX, structuredClone(side.state), combatSide()).events;
}

let buyN = 0;
const buyOne = (s: RunState): RunState => {
  const uid = `q${buyN++}`;
  return { ...reduce({ ...s, shop: [{ ...offer(buyN), uid }] }, { type: 'buy', uid }), hand: [] };
};

export const CASES: ProcCase[] = [
  // ── PRIESTESS ──
  {
    hero: 'priestess', ancient: 'death', phase: 'shop', fires: 2,
    note: 'two Echo minions passed from hand (each gains Rise); a plain one does not fire',
    run: () => over(duosPicked('priestess', 'death', { hand: [card('e1', ECHO), card('p', PLAIN[0]!), card('e2', ECHO)] }), [drag('e1'), drag('p'), drag('e2')]),
  },
  {
    hero: 'priestess', ancient: 'time', phase: 'shop', fires: 1,
    note: 'a Shop spell passed while Passaria is spent resets it; one passed while it is ready resets nothing',
    run: () => over(duosPicked('priestess', 'time', { hand: [card('sp1', SPELL), card('sp2', SPELL)] }), [
      drag('sp1'), // ready: nothing to reset
      (s) => ({ ...s, heroReady: false }),
      drag('sp2'),
    ]),
  },
  {
    hero: 'priestess', ancient: 'bonds', phase: 'shop', fires: 2,
    note: 'every pass buffs the left-most minion: two passes',
    run: () => over(duosPicked('priestess', 'bonds', { board: [card('b', PLAIN[1]!)], hand: [card('h1', PLAIN[0]!), card('h2', PLAIN[2]!)] }), [drag('h1'), drag('h2')]),
  },
  {
    hero: 'priestess', ancient: 'war', phase: 'combat', fires: 1,
    note: 'two cards passed: one Start of Combat grant to every minion is one fire',
    run: () => {
      let s = duosPicked('priestess', 'war', { board: [card('a', PLAIN[0]!, { attack: 1, health: 30 }), card('b', PLAIN[1]!, { attack: 1, health: 30 })], hand: [card('h', PLAIN[2]!), card('g', PLAIN[2]!)] });
      s = reduce(reduce(s, { type: 'passCard', uid: 'h' }), { type: 'passCard', uid: 'g' });
      return combatProcCount(lockedFight(s));
    },
  },
  // ── MAGICIAN ──
  {
    hero: 'magician', ancient: 'fortune', phase: 'shop', fires: 2,
    note: 'two Magic Hat triggers (3 buys each): filling the hat is not a fire',
    run: () => { const s = duosPicked('magician', 'fortune', { tier: 2, upgradeCost: 9 }); return over(s, [buyOne, buyOne, buyOne, buyOne, buyOne, buyOne]); },
  },
  {
    hero: 'magician', ancient: 'war', phase: 'combat', fires: 1,
    note: 'a real Duos round: the shared card swaps stats once at the opening Start of Combat',
    run: () => {
      const side = (heroId: string, seed: number, board: BoardCard[], pick?: AncientId) => {
        let run: RunState = { ...createVersusRun(seed, heroId, 'set2', DUOS, 'warden', pick ? { ancients: true } : undefined), hand: [], shop: [], spell: null, board };
        if (pick) {
          run = { ...run, ancients: { ...run.ancients!, points: run.ancients!.cost, offer: [pick, ...ANCIENT_IDS.filter((a) => a !== pick).slice(0, 2)] } };
          run = reduce(run, { type: 'pickAncient', id: pick });
        }
        return buildVersusCandidate(run, makeRng(seed))!;
      };
      const shared = PLAIN[0]!;
      const res = resolveVersusDuosRound({
        matchSeed: 77, round: 1,
        sides: {
          p1: side('magician', 21, [card('m0', PLAIN[1]!, { attack: 1, health: 40 }), card('m1', shared, { attack: 3, health: 50 })], 'war'),
          p2: side('warden', 22, [card('w0', shared, { attack: 7, health: 9 }), card('w1', PLAIN[2]!, { attack: 2, health: 2 })]),
          p3: side('indy', 23, [card('f0', PLAIN[2]!, { attack: 60, health: 3000 })]),
          p4: side('gorr', 24, [card('f0', PLAIN[2]!, { attack: 60, health: 3000 })]),
        },
      });
      return combatProcCount(res.aResult.events);
    },
  },
  {
    hero: 'magician', ancient: 'time', phase: 'sot', fires: 1,
    note: 'the next turn opens with a copy of a passed card, on the Ancient\'s own beat',
    run: () => {
      const s0 = duosPicked('magician', 'time');
      const s = { ...s0, duos: { ...s0.duos!, outbox: [PLAIN[0]!, PLAIN[1]!].map((id, i) => ({ seq: i, wave: 1, card: card(`o${i}`, id), from: 'hand' as const, index: 0, paid: 0 })) } };
      const foe: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: PLAIN[3]!, attack: 1, health: 1, keywords: [] }], seed: 1, origin: 'self' };
      return sotAncientBeats(reduce(reduce({ ...s, servedBoards: { [s.wave]: foe } }, { type: 'faceOmen' }), { type: 'resolveCombat' }));
    },
  },
  // ── CINDY ──
  {
    hero: 'cindy', ancient: 'death', phase: 'shop', fires: 2,
    note: 'Avenge (15) on Shop deaths: the 15th and the 30th pay, the 14 between do not',
    run: () => {
      const s = duosPicked('cindy', 'death', { board: [card('d1', PLAIN[0]!)] });
      s.ancients = { ...s.ancients!, cindyDeaths: 14 };
      const before = s.ancients.procs ?? 0;
      for (let i = 0; i < 16; i++) fireOnFriendDeath(s, s.board[0]!);
      return (s.ancients.procs ?? 0) - before;
    },
  },
  {
    hero: 'cindy', ancient: 'death', phase: 'combat', fires: 1,
    note: 'five Mama Pups and their Pups: the 15th death IN the fight pays (the Shop count of 14 never comes in)',
    run: () => {
      const s = duosPicked('cindy', 'death', { board: ['a', 'b', 'c', 'd', 'e'].map((u) => card(u, 'pack', { attack: 1, health: 1 })) });
      s.ancients = { ...s.ancients!, cindyDeaths: 14 };
      const side = buildVersusCandidate(s, makeRng(3))!;
      const foe = [{ cardId: PLAIN[2]!, attack: 50, health: 500, keywords: [] }];
      return combatProcCount(simulate(structuredClone(side.board), foe, makeRng(5), CARD_INDEX, structuredClone(side.state), combatSide()).events);
    },
  },
  {
    hero: 'cindy', ancient: 'fortune', phase: 'shop', fires: 1,
    note: 'after Golden Gratitude paid, the 40th Gold refreshes it',
    run: () => {
      let ann = reduce(duosPicked('cindy', 'fortune', { embers: 50, shop: [offer(5), offer(6)] }), { type: 'heroPower' });
      const bob = reduce(ship(ann, mateOf('cindy')), { type: 'buy', uid: 's0' });
      ann = ship(bob, ann);
      ann = { ...ann, ancients: { ...ann.ancients!, cindyGold: 39 } } as RunState;
      const next = reduce(ann, { type: 'roll' }); // 1 Gold: the 40th
      return procs(ann, next);
    },
  },
  {
    hero: 'cindy', ancient: 'war', phase: 'combat', fires: 1,
    note: 'Start of Combat: the left-most minion is Gilded',
    run: () => combatProcCount(lockedFight(duosPicked('cindy', 'war', { board: [card('w1', PLAIN[0]!, { attack: 1, health: 30 }), card('w2', PLAIN[1]!, { attack: 1, health: 30 })] }))),
  },
  {
    hero: 'cindy', ancient: 'time', phase: 'sot', fires: 1,
    note: 'once, at the Start of the turn after the pick (a later turn does nothing)',
    run: () => {
      const s = duosPicked('cindy', 'time');
      ancientStartOfTurn(s); // the pick's own turn: not yet
      s.wave += 1;
      ancientStartOfTurn(s);
      s.wave += 1;
      ancientStartOfTurn(s);
      return sotAncientBeats(s);
    },
  },
];
