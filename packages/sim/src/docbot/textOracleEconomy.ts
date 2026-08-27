/**
 * DOC BOT — TEXT-AS-ORACLE tranche 3: ECONOMY (handoff §7.2).
 *
 * Reconciles the printed Gold numbers — "Gain 2 Gold", "gain 1 Gold next turn", "raise your maximum Gold by
 * 1", "Sells for 2 Gold" — against the REAL deltas the reducer produces, using the same probe patterns the
 * economy differentials (`economyScan.test.ts`) established: exact `embers` / `bonusEmbersNextTurn` /
 * `maxGoldBonus` movements through real actions, never a parallel ledger. Three derived worklists share the
 * parser:
 *
 *   1. CARDS  — factories whose bodies touch the economy fields (derived by ECON_CALL_RE over the two
 *               factory maps), intersected with drivable triggers (cast / onPlay / endOfTurn / onSell),
 *               plus EVERY card printing "Sells for N Gold" (sell value is a `sellValueOf` rule, not a
 *               factory — the family alone would miss it).
 *   2. RUNES  — every rune whose reward tree carries `gainGold` / `gainMaxGold`, driven through the REAL
 *               reward engine (`devGrant` kind 'rune' → `applyQuestReward`). The printed text's number AND
 *               its immediate-vs-next-turn wording are both reconciled against where the delta actually
 *               lands — a rune that says "next turn" but pays now (or vice versa) alarms.
 *   3. HEROES — hero powers whose text parses to an unconditional economy axis, fired through the real
 *               `heroPower` action (plus Robin's per-sell future Gold through a real `sell`).
 *
 * Doctrine as tranches 1/2: parse only wording with an approved parseable semantic (§7.5) — rate tails
 * ("per Gold spent", "for every turn since"), spend thresholds and scheduled payouts are OUT of the axis
 * grammar by construction; every skip is typed; verify-before-alarm; a verified real bug ships as
 * 'confirmed-bug-pending-fix' with a repro, never as a red suite.
 */
import { CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import type { CardDef, QuestReward } from '@game/core';
import { createRun } from './../state';
import { reduce } from './../reducer';
import { applyEndOfTurn, sellValueOf } from './../recruit';
import { HEROES } from './../heroes';
import type { RunState, BoardCard } from './../state';
import { stripMarkers, liveShopText } from './textOracle';

// ────────────────────────────────────────── parsing ──────────────────────────────────────────

/** The parseable economy axes of one printed text. Absent axis = the text makes no such flat promise. */
export interface PrintedEconomy {
  /** "Gain/get N Gold." — paid NOW. */
  immediate?: number;
  /** "Gain/get N (extra) Gold next turn/shop." — banked into `bonusEmbersNextTurn`. */
  future?: number;
  /** "+N max Gold" / "raise|increase your maximum Gold by N" / "Gain N maximum Gold". */
  maxGold?: number;
  /** "Sells for N Gold" — the `sellValueOf` contract. */
  sellsFor?: number;
  /** "Sell: get N Gold" — an on-sell payout ON TOP of the ordinary sell value. */
  sellGet?: number;
}

/** A flat-promise guard: a match whose clause continues into a rate/threshold tail is NOT a flat number. */
const RATE_TAIL = /^\s*(?:for e(?:very|ach)|per\b|spent|you have)/i;

/**
 * Parse the flat economy promises out of a printed text. Spend-thresholds ("When you spend 10 Gold"),
 * rates ("per Gold spent this turn", "+1/+1 for every 3 Gold") and schedules ("In 2 turns, gain 10 Gold")
 * never enter an axis — the verbs anchor on gain/get/sell and the tail guard drops per/for-each clauses.
 */
export function parsePrintedEconomy(text: string): PrintedEconomy | null {
  const t = stripMarkers(text);
  const out: PrintedEconomy = {};

  const future = /\b(?:[Gg]ain|[Gg]et)s?\s+(\d+)\s+(?:extra\s+)?Gold\s+next\s+(?:turn|shop)/.exec(t);
  if (future) out.future = Number(future[1]);

  // Immediate: a gain/get N Gold NOT followed by "next …" (the future regex owns those) and not a rate.
  const imm = /\b(?:[Gg]ain|[Gg]et)s?\s+(\d+)\s+Gold(?!\s+next)/.exec(t);
  if (imm && !RATE_TAIL.test(t.slice(imm.index + imm[0].length)) && !/\bIn \d+ turns?, *$/.test(t.slice(0, imm.index))) {
    // "Sell: get N Gold" is its own axis — claim it there, not as an immediate.
    if (/Sell:\s*$/i.test(t.slice(0, imm.index))) out.sellGet = Number(imm[1]);
    else out.immediate = Number(imm[1]);
  }

  const max = /(?:\+(\d+) max(?:imum)? Gold|(?:raise|increase) your max(?:imum)? Gold by (\d+)|[Gg]ain (\d+) max(?:imum)? Gold)/.exec(t);
  if (max) out.maxGold = Number(max[1] ?? max[2] ?? max[3]);

  const sells = /Sells? for (\d+) Gold/.exec(t);
  if (sells) out.sellsFor = Number(sells[1]);

  return Object.keys(out).length ? out : null;
}

// ─────────────────────────────── subjects ───────────────────────────────

/** A body that touches the shop-economy state — the Gold bank, the next-turn bank, the max-Gold bonus or
 *  the sell-value channels — or routes through the `gainEmbers` helper. Comment-stripped before matching. */
export const ECON_CALL_RE = /(?:\.embers\b|bonusEmbersNextTurn|maxGoldBonus|nextSellBonus|\bsellBonus\b|gainEmbers\s*\()/;

export type EconomyLane = 'spell' | 'shout' | 'eot' | 'sell';
export const ECONOMY_LANES: Readonly<Record<string, EconomyLane>> = {
  cast: 'spell',
  onPlay: 'shout',
  endOfTurn: 'eot',
  onSell: 'sell',
};

export interface EconomySubject {
  cardId: string;
  on: string | null; // null → enrolled by the sellsFor axis alone (no drivable factory needed)
  lane: EconomyLane | 'sellsFor';
  printed: PrintedEconomy;
  printedGolden: PrintedEconomy | null;
}

export function economySubjects(econFamily: ReadonlySet<string>): EconomySubject[] {
  const out: EconomySubject[] = [];
  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.ruby) continue;
    const printed = parsePrintedEconomy(liveShopText(def));
    if (!printed) continue;
    const printedGolden = def.goldenText ? parsePrintedEconomy(def.goldenText) : null;
    const eff = def.effects.find((e) => econFamily.has(e.do) && ECONOMY_LANES[e.on] !== undefined
      && (def.spell ? e.on === 'cast' : e.on !== 'cast'));
    if (eff) {
      out.push({ cardId: def.id, on: eff.on, lane: ECONOMY_LANES[eff.on]!, printed, printedGolden });
    } else if (printed.sellsFor !== undefined) {
      // No drivable factory, but the text prints a sell value — the sellValueOf contract is still checkable.
      out.push({ cardId: def.id, on: null, lane: 'sellsFor', printed, printedGolden });
    }
  }
  return out;
}

// ─────────────────────────────── execution ───────────────────────────────

function shopBase(): RunState {
  return {
    ...createRun(0x901d, 'aster'),
    wave: 8,
    tier: 6,
    embers: 50,
    board: [],
    hand: [],
    shop: [],
  } as RunState;
}

interface EconDeltas { embers: number; future: number; maxGold: number }
const snap = (s: RunState): EconDeltas =>
  ({ embers: s.embers, future: s.bonusEmbersNextTurn ?? 0, maxGold: s.maxGoldBonus ?? 0 });
const delta = (before: EconDeltas, after: RunState): EconDeltas => {
  const a = snap(after);
  return { embers: a.embers - before.embers, future: a.future - before.future, maxGold: a.maxGold - before.maxGold };
};

/**
 * Reconcile the parsed axes against measured deltas. `sellBase` is the ordinary sell value the reducer pays
 * alongside a Sell: trigger (its payout is ON TOP — measured 2026-08-27). `maxRefillsNow` is the QUEST/RUNE
 * reward engine's gainMaxGold contract (the raised max also refills this turn's bank — the economyScan
 * checker's rule), which the CARD factory `gainMaxMana` and hero powers do NOT share (measured: Gold Font
 * moves only `maxGoldBonus`; Nadja's power charges its own cost) — so only the rune lane passes it.
 */
export function reconcileEconomy(printed: PrintedEconomy, d: EconDeltas, sellBase = 0, maxRefillsNow = false): string[] {
  const problems: string[] = [];
  const refill = maxRefillsNow ? (printed.maxGold ?? 0) : 0;
  if (printed.immediate !== undefined && d.embers !== printed.immediate + refill) {
    problems.push(`immediate: printed ${printed.immediate} Gold${refill ? ` (+${refill} max-refill)` : ''}, measured embers ${d.embers >= 0 ? '+' : ''}${d.embers}`);
  }
  if (printed.future !== undefined && d.future !== printed.future) {
    problems.push(`future: printed ${printed.future} Gold next turn, measured bonusEmbersNextTurn +${d.future}`);
  }
  if (printed.maxGold !== undefined && d.maxGold !== printed.maxGold) {
    problems.push(`maxGold: printed +${printed.maxGold}, measured maxGoldBonus +${d.maxGold}`);
  }
  if (printed.sellGet !== undefined && d.embers !== printed.sellGet + sellBase) {
    problems.push(`sellGet: printed ${printed.sellGet} Gold on top of the ${sellBase} sell value, measured embers +${d.embers}`);
  }
  return problems;
}

export type EconomyOutcome =
  | { outcome: 'reconciled' }
  | { outcome: 'mismatch'; problems: string[] }
  | { outcome: 'silent' }
  | { outcome: 'refused' };

const inst = (uid: string, def: CardDef, golden: boolean): BoardCard => {
  const mult = golden ? 2 : 1;
  return { uid, cardId: def.id, tribe: def.tribe, attack: def.attack * mult, health: def.health * mult, keywords: [...def.keywords], golden } as BoardCard;
};

export function runEconomySubject(subject: EconomySubject, golden: boolean): EconomyOutcome {
  const def = CARD_INDEX[subject.cardId]!;
  const printed = golden ? subject.printedGolden! : subject.printed;

  // The sellValueOf contract binds on EVERY subject that prints it, whatever its lane.
  if (printed.sellsFor !== undefined) {
    const s = shopBase();
    s.board = [inst('m1', def, golden)];
    const shown = sellValueOf(s.board[0]!, s);
    if (shown !== printed.sellsFor) return { outcome: 'mismatch', problems: [`sellsFor: printed ${printed.sellsFor}, sellValueOf shows ${shown}`] };
    const sold = reduce(s, { type: 'sell', uid: 'm1' });
    if (sold.embers - s.embers !== printed.sellsFor) {
      return { outcome: 'mismatch', problems: [`sellsFor: printed ${printed.sellsFor}, the sale paid ${sold.embers - s.embers}`] };
    }
    if (subject.lane === 'sellsFor') return { outcome: 'reconciled' };
  }

  switch (subject.lane) {
    case 'spell': {
      const s0 = shopBase();
      const before = snap(s0);
      const inHand: BoardCard = { uid: 'econSpell', cardId: def.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard;
      const s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'econSpell' });
      if (s1.hand.some((c) => c.uid === 'econSpell')) return { outcome: 'refused' };
      const problems = reconcileEconomy(printed, delta(before, s1));
      return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
    }
    case 'shout': {
      const s0 = shopBase();
      const before = snap(s0);
      let s1 = reduce({ ...s0, hand: [inst('econPlay', def, golden)] }, { type: 'play', uid: 'econPlay' });
      if (s1.pendingTarget?.uid === 'econPlay') s1 = reduce(s1, { type: 'battlecryTarget', targetUid: 'econPlay' });
      if (s1.hand.some((c) => c.uid === 'econPlay')) return { outcome: 'refused' };
      const problems = reconcileEconomy(printed, delta(before, s1));
      return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
    }
    case 'eot': {
      const s = shopBase();
      s.board = [inst('econEot', def, golden)];
      const before = snap(s);
      applyEndOfTurn(s);
      const problems = reconcileEconomy(printed, delta(before, s));
      return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
    }
    case 'sell': {
      const s = shopBase();
      s.board = [inst('econSell', def, golden)];
      const sellBase = sellValueOf(s.board[0]!, s);
      const before = snap(s);
      const s1 = reduce(s, { type: 'sell', uid: 'econSell' });
      if (s1.board.some((c) => c.uid === 'econSell')) return { outcome: 'refused' };
      const problems = reconcileEconomy(printed, delta(before, s1), sellBase);
      return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
    }
    case 'sellsFor':
      return { outcome: 'silent' }; // unreachable — handled above
  }
}

// ─────────────────────────────── excuses ───────────────────────────────

export interface EconomyExcuse {
  /**
   * Why this card's printed Gold number cannot be reconciled headlessly — every skip typed (§7.6):
   *  'conditional'   — the payout demands state the clean fixture cannot supply (a lost combat, a Consume,
   *                    a Ruby cast, a threshold already crossed).
   *  'trigger-unarmed' — the fixture cannot fire the paying trigger.
   *  'needs-triage'  — found, not yet ruled. Tolerated, reported, pinned.
   *  'confirmed-bug-pending-fix' — a VERIFIED real mismatch with a repro; the fix PR deletes it.
   */
  kind: 'conditional' | 'trigger-unarmed' | 'needs-triage' | 'confirmed-bug-pending-fix';
  why: string;
}

/** Seeded from the scan's first full run (2026-08-27) — every entry INVESTIGATED before excusal. */
export const ECONOMY_EXCUSED: Readonly<Record<string, EconomyExcuse>> = {
  c3_herald: {
    kind: 'confirmed-bug-pending-fix',
    why: 'VERIFIED param-name divergence: Herald of the Divide (ARCHIVED — reachable only through old saves/replays) authors `params: { gold: 2 }` but `battlecryGainGoldNextTurn` reads `params.amount` (default 1) — the Dawn Shout banks 1 Gold next turn while the text prints 2 (golden: measured 2, printed 4). The CONTENT PARAMS diverge (the factory + text agree with Paymaster Pimm, who authors `amount: 1` through the same factory). Repro: play c3_herald from hand onto an empty board via the reducer and read bonusEmbersNextTurn. Fix PR: rename the param to `amount: 2` in cards/archive.ts.',
  },
};

// ─────────────────────────────── runes ───────────────────────────────

type Leaf = Exclude<QuestReward, { kind: 'multi' }>;
const leavesOf = (r: QuestReward): Leaf[] => (r.kind === 'multi' ? r.rewards.flatMap(leavesOf) : [r as Leaf]);

export interface RuneEconomySubject {
  runeId: string;
  printed: PrintedEconomy;
  /** The reward tree's own numbers, named so a text-vs-params divergence can be attributed (§7.6). */
  params: { immediate?: number; future?: number; maxGold?: number };
}

/** Every rune whose reward tree pays flat Gold — the worklist derives from the defs, the EXPECTATION from
 *  the printed text. A rune with gold leaves whose text parses NO axis lands in the test's typed-skip pin
 *  (schedules and rates are out of grammar by design, §7.5). */
export function runeEconomySubjects(): RuneEconomySubject[] {
  const out: RuneEconomySubject[] = [];
  for (const rune of [...RUNES, ...EPIC_RUNES]) {
    const leaves = leavesOf(rune.reward);
    const gold = leaves.filter((l): l is Extract<QuestReward, { kind: 'gainGold' }> => l.kind === 'gainGold');
    const max = leaves.filter((l): l is Extract<QuestReward, { kind: 'gainMaxGold' }> => l.kind === 'gainMaxGold');
    if (!gold.length && !max.length) continue;
    const printed = parsePrintedEconomy(rune.text);
    if (!printed) continue;
    const params: RuneEconomySubject['params'] = {};
    for (const g of gold) {
      if (g.immediate) params.immediate = (params.immediate ?? 0) + g.amount;
      else params.future = (params.future ?? 0) + g.amount;
    }
    for (const m of max) params.maxGold = (params.maxGold ?? 0) + m.amount;
    out.push({ runeId: rune.id, printed, params });
  }
  return out;
}

/** Drive the rune through the REAL reward engine and reconcile the PRINTED numbers — including which bank
 *  they land in — against the measured deltas. */
export function runRuneEconomySubject(subject: RuneEconomySubject): EconomyOutcome {
  const s0 = shopBase();
  const before = snap(s0);
  const s1 = reduce(s0, { type: 'devGrant', kind: 'rune', id: subject.runeId });
  const problems = reconcileEconomy(subject.printed, delta(before, s1), 0, true);
  return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
}

// ─────────────────────────────── hero powers ───────────────────────────────

export interface HeroEconomySubject {
  heroId: string;
  kind: string;
  axis: 'maxGold' | 'perSellFuture';
  amount: number;
}

/** Hero powers whose text parses to an unconditional economy promise this lane can drive. Everything else
 *  that MENTIONS Gold (scaling payouts, dice, cost lines) is out of grammar — counted and pinned in the
 *  test, never silently green. */
export function heroEconomySubjects(): HeroEconomySubject[] {
  const out: HeroEconomySubject[] = [];
  for (const hero of HEROES) {
    const t = stripMarkers(hero.power.text);
    const max = /^Gain (\d+) max(?:imum)? Gold\.?$/.exec(t.trim());
    if (max) { out.push({ heroId: hero.id, kind: hero.power.kind, axis: 'maxGold', amount: Number(max[1]) }); continue; }
    const perSell = /For each minion you sell, gain (\d+) Gold next turn/.exec(t);
    if (perSell) out.push({ heroId: hero.id, kind: hero.power.kind, axis: 'perSellFuture', amount: Number(perSell[1]) });
  }
  return out;
}

export function runHeroEconomySubject(subject: HeroEconomySubject): EconomyOutcome {
  const s0: RunState = { ...createRun(0x601d, subject.heroId), wave: 6, tier: 3, embers: 40, board: [], hand: [], shop: [] } as RunState;
  const before = snap(s0);
  if (subject.axis === 'maxGold') {
    const s1 = reduce(s0, { type: 'heroPower' });
    const d = delta(before, s1);
    if (d.maxGold === 0 && d.embers === 0 && d.future === 0) return { outcome: 'silent' };
    const problems = reconcileEconomy({ maxGold: subject.amount }, d);
    return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
  }
  // perSellFuture: one real sell must bank `amount` next-turn Gold on top of nothing else future-bound.
  const pup = CARD_INDEX['pup']!;
  s0.board = [inst('hsell', pup, false)];
  const b2 = snap(s0);
  const s1 = reduce(s0, { type: 'sell', uid: 'hsell' });
  const d = delta(b2, s1);
  if (d.future !== subject.amount) {
    return { outcome: 'mismatch', problems: [`perSellFuture: printed ${subject.amount} Gold next turn per sale, measured bonusEmbersNextTurn +${d.future}`] };
  }
  return { outcome: 'reconciled' };
}
