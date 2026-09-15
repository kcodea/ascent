/**
 * BALANCE BOT B11 — ENGINE COMBOS: the two- and three-card engines a strong player ASSEMBLES, as data.
 *
 * Every lever on the strategist so far (line prior B4, growth probe B6, imitation B7, horizon B6r2, operators B9)
 * moved the pinned placement by < 0.2, and two independent readings reached the same diagnosis: the search's
 * CANDIDATE SET never proposes multi-turn engine assembly. A depth-1 candidate list is three ways of buying one
 * card, so no evaluator can select "buy Hank now so Blart eats a buffed shop every turn", and the horizon
 * re-ranking (B6 round 2) can only choose among plans that exist. This file names the plans.
 *
 * A COMBO is 2–3 pieces with roles — the PAYOFF (the body that grows: Blart, Brunni, Chorus Drake, Echohorn), its
 * FEEDER (what makes the payoff's trigger bigger: Hank / Horse buff the meal, Gangplank feeds on every Ale, an Echo
 * body is what Echohorn re-fires) and an ENABLER (a multiplier the engine wants once it runs: Edward, Transcendant,
 * Mirrorwing, Sylus). Pieces may name ALTERNATIVES (any Echo body satisfies "the left-most Echo"); a payoff may
 * want two COPIES (a pair is two-thirds of a golden — the players hold 0.48 goldens per board at wave 8 against
 * the pilot's 0.17–0.35). Every piece is checked against the package roster's own membership predicate
 * (`combos.test.ts`): a combo names only engine (2) / payoff (3) members of its package, so a content change that
 * retires a piece fails a test rather than leaving a stale plan behind.
 *
 * Sources: the operators' role tables (`operators/*.ts`, the `core` pieces) and the player study's co-occurring
 * pairs (`docs/balance-bot-player-study.md`: Bob Blart + Demon Horse, Brunni + Gangplank, Chorus Drake +
 * Standard Bearer / Transcendant / Vaultkeeper, Echohorn + Hawkus / Sylus, Drakko + Edward, Deepvein + Faultline).
 *
 * The macro that plays these lives in `generalistPilot.ts` (`assemble`); the pieces' find chance below is the
 * honest half of "credit a half-built engine for what it becomes": the completion probe (`growth.ts`) imagines
 * the missing piece on offer, and the chance of actually drawing it weights the answer.
 */
import type { Tribe } from '@game/core';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import { POOL_QUANTITIES } from '../../config';
import { tierSlots } from '../../shop';
import type { BotCardView, BotOfferView, BotVisibleState } from '../../productionBots/types';
import type { OperatorLine } from './operators/types';

export type ComboRole = 'payoff' | 'feeder' | 'enabler';

export interface ComboPiece {
  /** Card ids that satisfy the piece — the first is the canonical one (planted by the completion probe). */
  ids: readonly string[];
  role: ComboRole;
  /** Copies the combo wants held (default 1; 2 = hold a pair of the payoff toward its golden). */
  copies?: number;
  /** The wave from which this piece is looked for (a Tier-5 enabler is not a wave-4 purchase). */
  fromWave?: number;
}

export interface EngineCombo {
  id: string;
  /** The operator whose feed procedure runs the engine (`none` for a tribe-agnostic combo). */
  line: OperatorLine | 'none';
  /** The strategist packages this combo belongs to (a run whose line is one of these prefers it). */
  packages: readonly string[];
  /** The tribe the run must have rolled (absent = any run). */
  tribe?: Tribe;
  pieces: readonly ComboPiece[];
  /** The wave from which the combo is proposed at all. */
  fromWave: number;
  note: string;
}

const P = (ids: string | readonly string[], role: ComboRole, extra: Partial<ComboPiece> = {}): ComboPiece => ({ ids: typeof ids === 'string' ? [ids] : ids, role, ...extra });

/** Any Echo body worth seating LEFT-MOST for Echohorn / Hawkus / Spots (best first). */
const ECHO_BODIES = ['b2_mammoth', 'b2_bullseye', 'dm_felspikes', 'b2_armadiyo', 'b2_trex', 'b2_dawnclaw'] as const;
/** Bodies with a Rally — what Paragon cashes. */
const RALLY_BODIES = ['n2_standardbearer', 'd2_chorus', 'b2_echohorn', 'dm_hungerling', 'd2_cinderchef', 'd2_flamebeat', 'dw_thane'] as const;

export const ENGINE_COMBOS: readonly EngineCombo[] = [
  // ── Demon consume: Blart eats the right-most Shop minion every End of Turn; Hank's Echo and Horse's Rally grow it ──
  {
    id: 'demon-blart-hank', line: 'demon', packages: ['demonConsume'], tribe: 'demon', fromWave: 3,
    pieces: [P('dm_gourmand', 'payoff', { copies: 2 }), P('dm_hank', 'feeder'), P('dm_hungerling', 'feeder', { fromWave: 4 })],
    note: 'Blart eats a meal Hank (+3/+2 per death) and Horse (+1/+2 per attack) have buffed — the recorded darah runs\' engine',
  },
  {
    id: 'demon-blart-tormentor', line: 'demon', packages: ['demonConsume'], tribe: 'demon', fromWave: 6,
    pieces: [P('dm_gourmand', 'payoff', { copies: 2 }), P('dm_tormentor', 'feeder', { fromWave: 6 })],
    note: 'Tormentor\'s Shout stacks +4/+5 on the right-most slot Blart eats from',
  },
  // ── Dwarf ale / spend: Brunni brews an Ale every turn; Gangplank and Coinfire convert what the turn does ──
  {
    id: 'dwarf-brunni-gangplank', line: 'dwarf', packages: ['ale'], tribe: 'dwarf', fromWave: 4,
    pieces: [P('dw_brunni', 'payoff'), P('dw_gangplank', 'feeder')],
    note: 'every Ale Brunni brews is a card added to hand — Gangplank pays +1/+2 for each (the study: 9 boards, 67% survivors)',
  },
  {
    id: 'dwarf-coinfire-brunni', line: 'dwarf', packages: ['ale'], tribe: 'dwarf', fromWave: 4,
    pieces: [P('dw_coinfire', 'payoff', { copies: 2 }), P('dw_brunni', 'feeder')],
    note: 'Coinfire pays +2 Attack to every Dwarf per 5 Gold spent; two Coinfires double it (LEMON | robin: a golden Coinfire 76/16 at w8)',
  },
  {
    id: 'dwarf-brunni-edward', line: 'dwarf', packages: ['ale'], tribe: 'dwarf', fromWave: 7,
    pieces: [P('dw_brunni', 'payoff'), P('dw_edward', 'enabler', { fromWave: 7 })],
    note: 'Edward makes every Ale trigger twice',
  },
  // ── Dragon spell: Chorus Drake grows the spell power every fight; a spell body cashes every cast ──
  {
    id: 'dragon-chorus-mirrorwing', line: 'dragon', packages: ['dragon', 'spellEngine'], tribe: 'dragon', fromWave: 3,
    pieces: [P('d2_chorus', 'payoff', { copies: 2 }), P('d2_mirrorwing', 'enabler')],
    note: 'the first spell on Mirrorwing casts again, at the Health the Chorus Drakes built',
  },
  {
    id: 'dragon-chorus-earthbreaker', line: 'dragon', packages: ['dragon', 'spellEngine'], tribe: 'dragon', fromWave: 5,
    pieces: [P('d2_chorus', 'payoff'), P('d2_scalechanter', 'payoff', { fromWave: 5 })],
    note: 'Earthbreaker: +2/+3 to every Dragon per Shop spell cast',
  },
  {
    id: 'dragon-chorus-transcendant', line: 'dragon', packages: ['dragon'], tribe: 'dragon', fromWave: 6,
    pieces: [P('d2_chorus', 'payoff', { copies: 2 }), P('d2_transcendence', 'enabler', { fromWave: 6 })],
    note: 'Transcendant Engraves the adjacent Chorus Drakes — their combat gains stay (the study: 9 boards, 67% vs 42% predicted)',
  },
  {
    id: 'dragon-bearer-transcendant', line: 'dragon', packages: ['dragon', 'rally'], tribe: 'dragon', fromWave: 5,
    pieces: [P('n2_standardbearer', 'feeder'), P('d2_transcendence', 'enabler', { fromWave: 6 }), P(['d2_chorus', 'd2_flamebeat'], 'payoff')],
    note: 'Standard Bearer\'s Rally +3/+3 lands on an Engraved Dragon every fight and stays (Chorus Drake + Standard Bearer: 18 boards)',
  },
  {
    id: 'dragon-chorus-vaultkeeper', line: 'dragon', packages: ['dragon', 'spellEngine'], tribe: 'dragon', fromWave: 9,
    pieces: [P('d2_chorus', 'feeder'), P('d2_herzog', 'payoff', { copies: 2, fromWave: 9 })],
    note: 'the strongest late pair in the corpus (18 boards, 100% survivors); a golden Vaultkeeper doubles both scalers',
  },
  // ── Beast echo: Echohorn re-fires the left-most Echo; Hawkus / Sylus multiply it ──
  {
    id: 'beast-echohorn-echo', line: 'beast', packages: ['beastSummon', 'echo'], tribe: 'beast', fromWave: 5,
    pieces: [P('b2_echohorn', 'payoff', { copies: 2 }), P(ECHO_BODIES, 'feeder')],
    note: 'Echohorn\'s Rally triggers the left-most Echo — a Mammoth / Bullseye / Fel Spikes seated left',
  },
  {
    id: 'beast-echohorn-hawkus', line: 'beast', packages: ['beastSummon', 'echo'], tribe: 'beast', fromWave: 8,
    pieces: [P('b2_echohorn', 'payoff'), P('b2_hawkus', 'enabler', { fromWave: 8 }), P(ECHO_BODIES, 'feeder')],
    note: 'Hawkus fires the left-most Echo on EVERY Rally (the study: 18 boards, 78%)',
  },
  {
    id: 'beast-echohorn-sylus', line: 'beast', packages: ['beastSummon', 'echo'], tribe: 'beast', fromWave: 8,
    pieces: [P('b2_echohorn', 'payoff'), P('sylus', 'enabler', { fromWave: 8 }), P(ECHO_BODIES, 'feeder')],
    note: 'Sylus: every Echo once more (the study: 21 boards, 90%)',
  },
  // ── Kobold Rubies: improve the Rubies, then a payoff that casts them ──
  {
    id: 'kobold-kobe-improvers', line: 'none', packages: ['ruby'], tribe: 'kobold', fromWave: 5,
    pieces: [P('k_kobe', 'payoff', { fromWave: 5 }), P('k_deepvein', 'feeder'), P('k_faultline', 'feeder')],
    note: 'Deepvein (+1 Health) and Faultline (+1 Attack) improve every Ruby Kobe casts permanently at Start of Combat (Deepvein + Faultline: 9 boards, 67%)',
  },
  // ── Neutral Rally payoff ──
  {
    id: 'rally-paragon', line: 'none', packages: ['rally'], fromWave: 8,
    pieces: [P('n2_paragon', 'payoff', { fromWave: 8 }), P(RALLY_BODIES, 'feeder')],
    note: 'Paragon: +4/+4 permanently to a minion of every type whenever a Rally fires',
  },
];

export const COMBO_INDEX: Readonly<Record<string, EngineCombo>> = Object.fromEntries(ENGINE_COMBOS.map((c) => [c.id, c]));

// ── availability ───────────────────────────────────────────────────────────────────────────────────────────

/** The combos a run can field: its tribe rolled (or none required) and every piece drawable in the set. */
export function combosFor(setId: SetId, tribes: readonly string[]): EngineCombo[] {
  const drawable = new Set(poolFor(setId).buyable.map((c) => c.id));
  return ENGINE_COMBOS.filter((c) => (!c.tribe || tribes.includes(c.tribe)) && c.pieces.every((p) => p.ids.some((id) => drawable.has(id))));
}

// ── progress ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PieceProgress {
  piece: ComboPiece;
  /** Copies held on the board + in hand (a golden counts as 2). */
  held: number;
  /** Copies on the board. */
  fielded: number;
  /** Affordable offers of this piece in the shop, cheapest first (only while the piece still wants copies). */
  offers: BotOfferView[];
  /** The piece is looked for at this wave (`fromWave`). */
  due: boolean;
}

export interface ComboProgress {
  combo: EngineCombo;
  pieces: PieceProgress[];
  /** Pieces with at least one copy held. */
  heldPieces: number;
  totalPieces: number;
  /** Every piece held at least once (extra copies are pairs, never a blocker). */
  complete: boolean;
  /** Canonical ids of the pieces not held at all (what the completion probe plants), due ones only. */
  missing: string[];
  /** The payoff is on the board. */
  payoffFielded: boolean;
}

const matches = (piece: ComboPiece, cardId: string): boolean => piece.ids.includes(cardId);

export function comboProgress(combo: EngineCombo, v: BotVisibleState): ComboProgress {
  const cards: readonly BotCardView[] = [...v.board, ...v.hand];
  const pieces: PieceProgress[] = combo.pieces.map((piece) => {
    const held = cards.filter((c) => matches(piece, c.cardId)).reduce((n, c) => n + (c.golden ? 2 : 1), 0);
    const fielded = v.board.filter((c) => matches(piece, c.cardId)).reduce((n, c) => n + (c.golden ? 2 : 1), 0);
    const due = piece.fromWave === undefined || v.wave >= piece.fromWave;
    const want = piece.copies ?? 1;
    const offers = held < want && due
      ? v.shop.filter((o) => !o.spell && !o.ruby && !o.golden && matches(piece, o.cardId) && o.cost <= v.economy.gold).sort((a, b) => a.cost - b.cost)
      : [];
    return { piece, held, fielded, offers, due };
  });
  const heldPieces = pieces.filter((p) => p.held > 0).length;
  const missing = pieces.filter((p) => p.held === 0 && p.due).map((p) => p.piece.ids[0]!);
  return {
    combo, pieces, heldPieces, totalPieces: pieces.length,
    complete: heldPieces === pieces.length,
    missing,
    payoffFielded: pieces.some((p) => p.piece.role === 'payoff' && p.fielded > 0),
  };
}

/** Does any piece of `combo` match this card? */
export const isComboPiece = (combo: EngineCombo, cardId: string): boolean => combo.pieces.some((p) => matches(p, cardId));

// ── find chance ────────────────────────────────────────────────────────────────────────────────────────────

/** Total copies in a fresh pool at Shop tier `tier` for a run of `tribes` (the draw is weighted by copies). */
function poolWeight(setId: SetId, tribes: readonly string[], tier: number): number {
  let w = 0;
  for (const c of poolFor(setId).buyable) {
    if (c.tier > tier) continue;
    if (c.tribe !== 'neutral' && !tribes.includes(c.tribe)) continue;
    w += POOL_QUANTITIES[c.tier] ?? 6;
  }
  return w;
}

/** Chance that ONE fresh shop at `tier` shows at least one copy of `cardId` (a fresh pool; the real pool drains
 *  slowly). 0 when the card sits above the tier. */
export function offerChance(setId: SetId, tribes: readonly string[], cardId: string, tier: number): number {
  const def = CARD_INDEX[cardId];
  if (!def || def.tier > tier) return 0;
  const w = poolWeight(setId, tribes, tier);
  if (w <= 0) return 0;
  const q = POOL_QUANTITIES[def.tier] ?? 6;
  return 1 - Math.pow(1 - q / w, tierSlots(tier));
}

export interface FindWindow {
  /** Shops seen per turn while rolling for the piece (the natural shop + the reserve's refreshes). */
  rollsPerTurn: number;
  /** Turns the pilot keeps looking. */
  turns: number;
}

/**
 * Chance of drawing `cardId` at least once over `window` from a shop at `tier`. A piece one tier above the shop
 * is looked for from the SECOND turn on (the tier-up first); one further up is out of reach.
 */
export function findChance(setId: SetId, tribes: readonly string[], cardId: string, tier: number, window: FindWindow): number {
  const def = CARD_INDEX[cardId];
  if (!def) return 0;
  if (def.tier > tier + 1) return 0;
  let miss = 1;
  for (let t = 0; t < window.turns; t++) {
    const shopTier = def.tier > tier ? (t === 0 ? tier : tier + 1) : tier;
    const p = offerChance(setId, tribes, cardId, shopTier);
    miss *= Math.pow(1 - p, Math.max(1, window.rollsPerTurn));
  }
  return 1 - miss;
}

/** Chance of finding EVERY id in `missing` over the window (independent draws — an approximation). */
export function completionChance(setId: SetId, tribes: readonly string[], missing: readonly string[], tier: number, window: FindWindow): number {
  let p = 1;
  for (const id of missing) p *= findChance(setId, tribes, id, tier, window);
  return p;
}
