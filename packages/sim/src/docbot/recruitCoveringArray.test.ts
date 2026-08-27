/**
 * DOC BOT — RECRUIT BOUNDARY COVERING ARRAY (handoff §8.1) + LOOP/EXPLOSION GUARD (§8.4).
 *
 * A deterministic PAIRWISE (strength-2) covering array over the recruit boundary dimensions — board size,
 * hand size, shop size, Gold, tier, source position, target position, plain/gilded, first/repeated use,
 * with/without a relevant multiplier — instead of the ~23k-row Cartesian product. Every row is instantiated
 * as a REAL RunState and dispatched through the REAL `reduce` for a representative set of recruit actions
 * (buy / untargeted Battlecry / targeted Battlecry / aimed spell / untargeted spell / sell / reroll /
 * tier-up), asserting INVARIANTS rather than exact outcomes:
 *
 *   - the reducer never throws;
 *   - a rejected action returns the IDENTICAL state object (the engine's own no-op contract);
 *   - an invalid-target dispatch is a clean rejection (the §8.1 "invalid" level's whole point);
 *   - embers never go negative; board within `CONFIG.boardMax`; hand within `handCap`;
 *   - uids stay unique across hand/board/shop/spell;
 *   - an ACCEPTED action's Gold delta matches the same cost helper the UI reads
 *     (`minionCostOf` / `refreshCostOf` / `upgradeCostOf` / `sellValueWithBonus`).
 *
 * LEVEL CONVENTIONS (dimensions read differently per action, by necessity):
 *   - For an action that must HOLD a card in a zone (play → hand, sell → board, buy → shop), that zone's
 *     size level is the TOTAL INCLUDING the acted card(s), floored at what the action needs ('0' = "as
 *     empty as the action allows"). Other zones read their level literally.
 *   - `srcPos` places the acted card within its zone; `tgtPos` maps to a concrete target uid per action
 *     ('self' = the acted card's own uid, 'adjacent'/'edge' = a board neighbour / the right-most body,
 *     'invalid' = a uid that exists nowhere). Dimensions an action cannot express (tgtPos on a reroll) are
 *     instantiated but inert — pairwise coverage is a property of the ARRAY, executed across all actions.
 *   - `mult` arms a genuinely relevant multiplier through the real engine where one exists: the Ancient
 *     Runes quest (spells cast twice) for spell rows, Hoardwake Ritual (Shouts trigger twice) for
 *     Battlecry rows, the Tradesman hero's price sheet for buy/reroll/tier-up rows, and a per-instance
 *     `sellBonus` for sell rows (the economyScan-verified Trail Forager channel).
 *
 * The §8.4 guard runs over every row's dispatch chain AND a deliberately trigger-heavy fixture: per-action
 * uid/FX/growth budgets (high-but-terminating → console warning) and a repeated normalized-state-signature
 * check (a repeat inside one action loop → failure with the chain trace). Both the all-pairs check and the
 * invariant/guard oracles are sabotage-tested below (§3.5).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import type { CardDef } from '@game/core';
import { createRun, handCap, type Action, type BoardCard, type RunState, type ShopCard } from '../state';
import { reduce, minionCostOf, refreshCostOf, upgradeCostOf } from '../reducer';
import { sellValueWithBonus } from '../recruit';
import { poolOf } from '../cardPool';
import { CONFIG } from '../config';
import { pairwiseCoveringArray, uncoveredPairs, type CoveringRow, type Dimension } from './coveringArray';
import { ExplosionGuard, normalizedSignature } from './explosionGuard';

// ── THE DIMENSIONS (handoff §8.1, verbatim) ─────────────────────────────────────────────────────────────────

const DIMS: Dimension[] = [
  { name: 'board', levels: ['0', '6', 'full'] },
  { name: 'hand', levels: ['0', 'nearCap', 'full'] },
  { name: 'shop', levels: ['empty', 'partial', 'full'] },
  { name: 'gold', levels: ['0', 'exact', 'high'] },
  { name: 'tier', levels: ['min', 'content', 'max'] },
  { name: 'srcPos', levels: ['left', 'middle', 'right'] },
  { name: 'tgtPos', levels: ['self', 'adjacent', 'edge', 'invalid'] },
  { name: 'gild', levels: ['plain', 'gilded'] },
  { name: 'use', levels: ['first', 'repeated'] },
  { name: 'mult', levels: ['without', 'with'] },
];

const ARRAY = pairwiseCoveringArray(DIMS);

// ── PROBE CONTENT (stable set1 picks; loud asserts so an archival shows up as "pick a new probe") ───────────

/** Triggers inert during a recruit ACTION for a body already resident in a zone: combat-only triggers plus
 *  `endOfTurn` (the sweep never ends a turn). Filler bodies drawn from this set cannot move Gold or state. */
const INERT_TRIGGERS = new Set(['onDeath', 'onAttack', 'onKill', 'onDamaged', 'avenge', 'startOfCombat', 'friendlyDemonDealtDamage', 'endOfTurn']);
const isInertFiller = (d: CardDef): boolean =>
  !d.spell && !d.ruby && !d.token && !d.noTriple && (d.effects ?? []).every((e) => INERT_TRIGGERS.has(e.on));

const PROBE = createRun(1, 'warden', 'ascent', CONFIG.defaultLine, 'set1');
const VANILLA_FILLERS = poolOf(PROBE).buyable.filter(isInertFiller);
const DRAGON_FILLERS = poolOf(PROBE).buyable.filter((d) => !d.spell && !d.ruby && !d.token && !d.noTriple && (d.tribe === 'dragon' || d.tribe2 === 'dragon'));

const BUY_DEF = VANILLA_FILLERS.find((d) => d.tier === 2) ?? VANILLA_FILLERS[0]!;
const UNTARGETED_BC = CARD_INDEX['cleric']!; // Hoard Cleric — Battlecry: your other Dragons +3/+3 (untargeted)
const TARGETED_BC = CARD_INDEX['emissary']!; // Twilight Emissary — Battlecry: give a friendly Dragon +2/+2 (targeted)
const AIMED_SPELL = CARD_INDEX['spiritfire']!; // Spirit Fire — aimed buff, target 'any'
const UNTARGETED_SPELL = CARD_INDEX['growth']!; // Growth — untargeted board buff (fizzles on an empty board)
const SPELL_MULT_QUEST = 'q_ancient_runes'; // spellRepeat scope 'always' — spells cast twice
const SHOUT_MULT_QUEST = 'q_hoardwake_ritual'; // shoutRepeat scope 'always' — Shouts trigger twice
const PRICE_MULT_HERO = 'hermithank'; // Tradesman — minions 2, rerolls 2, tier-ups +2 (the whole price sheet)

// ── FIXTURE BUILDING ────────────────────────────────────────────────────────────────────────────────────────

/** A zone instance of `def` at base stats (golden = the 2× the combine produces). */
function inst(uid: string, def: CardDef, golden = false, extra: Partial<BoardCard> = {}): BoardCard {
  const m = golden ? 2 : 1;
  return { uid, cardId: def.id, tribe: def.tribe, attack: def.attack * m, health: def.health * m, keywords: [...def.keywords], golden, ...extra };
}

/** Deterministic filler source: cycles distinct defs, at most TWO copies of any id per fixture (so fillers
 *  can never complete a triple with each other), excluding the acted card's id (so they can't complete one
 *  WITH it either). */
function makeFillers(pool: CardDef[], excludeId: string): (uid: string) => BoardCard {
  const defs = pool.filter((d) => d.id !== excludeId);
  let cursor = 0;
  return (uid) => {
    const def = defs[cursor % defs.length]!;
    cursor++;
    if (cursor >= defs.length * 2) cursor = 0; // hard cap: never a third copy
    return inst(uid, def);
  };
}

const posIndex = (level: string, len: number): number =>
  len <= 0 ? 0 : level === 'left' ? 0 : level === 'right' ? len - 1 : Math.floor(len / 2);

interface Step {
  label: string;
  make: (s: RunState) => Action;
  /** Expected embers delta IF the action is accepted (the cost-helper contract). */
  expectGold?: (before: RunState) => number;
  /** The invalid-target contract: when true for the before-state, the dispatch MUST be a clean rejection. */
  mustReject?: (before: RunState) => boolean;
}
interface Fixture { state: RunState; steps: Step[] }

interface ShapeOpts {
  seed: number;
  hero?: string;
  /** devGrant this quest through the real reward engine BEFORE shaping (armed at tier 6, per economyScan). */
  multQuest?: string;
  tier: number;
  hand: BoardCard[];
  board: BoardCard[];
  shop: ShopCard[];
  goldLevel: string;
  exactCost: (s: RunState) => number;
}

function shape(o: ShapeOpts): RunState {
  let s = createRun(o.seed, o.hero ?? 'warden', 'ascent', CONFIG.defaultLine, 'set1');
  s.phase = 'recruit';
  if (o.multQuest) {
    s.tier = 6;
    s = reduce(s, { type: 'devGrant', kind: 'quest', id: o.multQuest });
  }
  s.tier = o.tier;
  s.hand = o.hand;
  s.board = o.board;
  s.shop = o.shop;
  s.spell = null;
  s.frozen = false;
  s.freeRolls = 0;
  s.embers = o.goldLevel === '0' ? 0 : o.goldLevel === 'high' ? 50 : Math.max(0, o.exactCost(s));
  return s;
}

const tierOf = (row: CoveringRow, contentTier: number): number =>
  row.tier === 'min' ? 1 : row.tier === 'max' ? CONFIG.maxTier : contentTier;
const actedCount = (row: CoveringRow): number => (row.use === 'repeated' ? 2 : 1);
const gilded = (row: CoveringRow): boolean => row.gild === 'gilded';

const HAND_TOTALS: Record<string, number> = { '0': 0, nearCap: CONFIG.handMax - 1, full: CONFIG.handMax };
const BOARD_TOTALS: Record<string, number> = { '0': 0, '6': 6, full: CONFIG.boardMax };
const SHOP_TOTALS: Record<string, number> = { empty: 0, partial: 2, full: 5 };

/** Fill a zone to `total` with fillers, splicing the acted cards in at `srcPos` (adjacent to each other). */
function zoneWith(total: number, acted: BoardCard[], srcPos: string, filler: (uid: string) => BoardCard, uidPrefix: string): BoardCard[] {
  const fillerCount = Math.max(0, total - acted.length);
  const cards: BoardCard[] = [];
  for (let i = 0; i < fillerCount; i++) cards.push(filler(`${uidPrefix}${i}`));
  const at = posIndex(srcPos, fillerCount + 1);
  cards.splice(at, 0, ...acted);
  return cards;
}

/** Map tgtPos to a concrete target uid against the LIVE state at dispatch time. */
function targetUidFor(row: CoveringRow, s: RunState, selfUid: string): string {
  switch (row.tgtPos) {
    case 'self': return selfUid;
    case 'invalid': return 'zz_no_such_uid';
    case 'adjacent': return s.board.find((c) => c.uid !== selfUid)?.uid ?? 'zz_missing_neighbour';
    default: { // 'edge' — the right-most body, preferring one that isn't the source itself
      const last = s.board[s.board.length - 1];
      return (last && last.uid !== selfUid ? last : s.board.find((c) => c.uid !== selfUid))?.uid ?? 'zz_missing_edge';
    }
  }
}

interface ActionSpec { name: string; build: (row: CoveringRow, idx: number) => Fixture }

const ACTIONS: ActionSpec[] = [
  {
    name: 'buy',
    build(row, idx) {
      const n = actedCount(row);
      const filler = makeFillers(VANILLA_FILLERS, BUY_DEF.id);
      let uidSeq = 0;
      const offers: ShopCard[] = [];
      const actedUids: string[] = [];
      const fillerCount = Math.max(0, Math.max(SHOP_TOTALS[row.shop]! , n) - n);
      for (let i = 0; i < fillerCount; i++) offers.push({ uid: `of${i}`, cardId: filler(`x${uidSeq++}`).cardId });
      const at = posIndex(row.srcPos, fillerCount + 1);
      for (let k = 0; k < n; k++) {
        const uid = `oact${k}`;
        actedUids.push(uid);
        offers.splice(at + k, 0, { uid, cardId: BUY_DEF.id, golden: gilded(row) || undefined });
      }
      const handFiller = makeFillers(VANILLA_FILLERS, BUY_DEF.id);
      const state = shape({
        seed: 1000 + idx, hero: row.mult === 'with' ? PRICE_MULT_HERO : undefined,
        tier: tierOf(row, BUY_DEF.tier),
        hand: zoneWith(HAND_TOTALS[row.hand]!, [], 'left', handFiller, 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(VANILLA_FILLERS, BUY_DEF.id), 'bf'),
        shop: offers,
        goldLevel: row.gold, exactCost: (s) => minionCostOf(s),
      });
      return {
        state,
        steps: actedUids.map((uid, k) => ({
          label: `buy#${k + 1}`,
          make: () => ({ type: 'buy', uid }),
          expectGold: (b) => -minionCostOf(b),
        })),
      };
    },
  },
  {
    name: 'sell',
    build(row, idx) {
      const n = actedCount(row);
      const acted: BoardCard[] = [];
      for (let k = 0; k < n; k++) acted.push(inst(`act${k}`, BUY_DEF, gilded(row), row.mult === 'with' ? { sellBonus: 4 } : {}));
      const state = shape({
        seed: 2000 + idx,
        tier: tierOf(row, BUY_DEF.tier),
        hand: zoneWith(HAND_TOTALS[row.hand]!, [], 'left', makeFillers(VANILLA_FILLERS, BUY_DEF.id), 'hf'),
        board: zoneWith(Math.max(BOARD_TOTALS[row.board]!, n), acted, row.srcPos, makeFillers(VANILLA_FILLERS, BUY_DEF.id), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, BUY_DEF.id), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: () => 0,
      });
      return {
        state,
        steps: acted.map((a, k) => ({
          label: `sell#${k + 1}`,
          make: () => ({ type: 'sell', uid: a.uid }),
          expectGold: (b) => {
            const sold = b.board.find((c) => c.uid === a.uid) ?? b.hand.find((c) => c.uid === a.uid);
            return sold ? sellValueWithBonus(sold, b) : 0;
          },
        })),
      };
    },
  },
  {
    name: 'reroll',
    build(row, idx) {
      const state = shape({
        seed: 3000 + idx, hero: row.mult === 'with' ? PRICE_MULT_HERO : undefined,
        tier: tierOf(row, 3),
        hand: zoneWith(HAND_TOTALS[row.hand]!, [], 'left', makeFillers(VANILLA_FILLERS, '~none'), 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(VANILLA_FILLERS, '~none'), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, '~none'), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: (s) => refreshCostOf(s),
      });
      const steps: Step[] = [];
      for (let k = 0; k < actedCount(row); k++) {
        steps.push({ label: `roll#${k + 1}`, make: () => ({ type: 'roll' }), expectGold: (b) => (b.freeRolls > 0 ? 0 : -refreshCostOf(b)) });
      }
      return { state, steps };
    },
  },
  {
    name: 'tierUp',
    build(row, idx) {
      const state = shape({
        seed: 4000 + idx, hero: row.mult === 'with' ? PRICE_MULT_HERO : undefined,
        tier: tierOf(row, 3),
        hand: zoneWith(HAND_TOTALS[row.hand]!, [], 'left', makeFillers(VANILLA_FILLERS, '~none'), 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(VANILLA_FILLERS, '~none'), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, '~none'), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: (s) => upgradeCostOf(s),
      });
      const steps: Step[] = [];
      for (let k = 0; k < actedCount(row); k++) {
        steps.push({ label: `upgrade#${k + 1}`, make: () => ({ type: 'upgrade' }), expectGold: (b) => -upgradeCostOf(b) });
      }
      return { state, steps };
    },
  },
  {
    name: 'playUntargetedBattlecry',
    build(row, idx) {
      const n = actedCount(row);
      const acted: BoardCard[] = [];
      for (let k = 0; k < n; k++) acted.push(inst(`act${k}`, UNTARGETED_BC, gilded(row)));
      const state = shape({
        seed: 5000 + idx, multQuest: row.mult === 'with' ? SHOUT_MULT_QUEST : undefined,
        tier: tierOf(row, UNTARGETED_BC.tier),
        hand: zoneWith(Math.max(HAND_TOTALS[row.hand]!, n), acted, row.srcPos, makeFillers(VANILLA_FILLERS, UNTARGETED_BC.id), 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(DRAGON_FILLERS, UNTARGETED_BC.id), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, UNTARGETED_BC.id), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: () => 0,
      });
      return {
        state,
        steps: acted.map((a, k) => ({
          label: `play#${k + 1}`,
          make: () => ({ type: 'play', uid: a.uid }),
          expectGold: () => 0,
        })),
      };
    },
  },
  {
    name: 'playTargetedBattlecry',
    build(row, idx) {
      const n = actedCount(row);
      const acted: BoardCard[] = [];
      for (let k = 0; k < n; k++) acted.push(inst(`act${k}`, TARGETED_BC, gilded(row)));
      const state = shape({
        seed: 6000 + idx, multQuest: row.mult === 'with' ? SHOUT_MULT_QUEST : undefined,
        tier: tierOf(row, TARGETED_BC.tier),
        hand: zoneWith(Math.max(HAND_TOTALS[row.hand]!, n), acted, row.srcPos, makeFillers(VANILLA_FILLERS, TARGETED_BC.id), 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(DRAGON_FILLERS, TARGETED_BC.id), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, TARGETED_BC.id), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: () => 0,
      });
      const steps: Step[] = [];
      for (const a of acted) {
        steps.push({ label: `play(${a.uid})`, make: () => ({ type: 'play', uid: a.uid, toIndex: 0 }), expectGold: () => 0 });
        steps.push({
          label: `battlecryTarget(${row.tgtPos})`,
          make: (s) => ({ type: 'battlecryTarget', targetUid: targetUidFor(row, s, a.uid) }),
          expectGold: () => 0,
          // Self is barred by the tribe-restricted-target rule (Graverobber guard); invalid uids exist
          // nowhere. Both MUST be clean rejections whenever the pick is actually open for this source.
          mustReject: (b) => b.pendingTarget?.uid === a.uid && (row.tgtPos === 'self' || row.tgtPos === 'invalid'),
        });
      }
      return { state, steps };
    },
  },
  {
    name: 'castAimedSpell',
    build(row, idx) {
      const n = actedCount(row);
      const acted: BoardCard[] = [];
      for (let k = 0; k < n; k++) acted.push(inst(`act${k}`, AIMED_SPELL, gilded(row)));
      const state = shape({
        seed: 7000 + idx, multQuest: row.mult === 'with' ? SPELL_MULT_QUEST : undefined,
        tier: tierOf(row, AIMED_SPELL.tier),
        hand: zoneWith(Math.max(HAND_TOTALS[row.hand]!, n), acted, row.srcPos, makeFillers(VANILLA_FILLERS, AIMED_SPELL.id), 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(VANILLA_FILLERS, AIMED_SPELL.id), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, AIMED_SPELL.id), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: () => 0,
      });
      return {
        state,
        steps: acted.map((a) => ({
          label: `cast(${row.tgtPos})`,
          make: (s: RunState): Action => ({ type: 'play', uid: a.uid, targetUid: targetUidFor(row, s, a.uid) }),
          expectGold: () => 0,
          // 'self' aims at the spell's own HAND uid — never a board minion or shop offer — and 'invalid'
          // exists nowhere: both must fizzle cleanly with the spell kept in hand.
          mustReject: (b) => b.hand.some((c) => c.uid === a.uid) && (row.tgtPos === 'self' || row.tgtPos === 'invalid'),
        })),
      };
    },
  },
  {
    name: 'castUntargetedSpell',
    build(row, idx) {
      const n = actedCount(row);
      const acted: BoardCard[] = [];
      for (let k = 0; k < n; k++) acted.push(inst(`act${k}`, UNTARGETED_SPELL, gilded(row)));
      const state = shape({
        seed: 8000 + idx, multQuest: row.mult === 'with' ? SPELL_MULT_QUEST : undefined,
        tier: tierOf(row, UNTARGETED_SPELL.tier),
        hand: zoneWith(Math.max(HAND_TOTALS[row.hand]!, n), acted, row.srcPos, makeFillers(VANILLA_FILLERS, UNTARGETED_SPELL.id), 'hf'),
        board: zoneWith(BOARD_TOTALS[row.board]!, [], 'left', makeFillers(VANILLA_FILLERS, UNTARGETED_SPELL.id), 'bf'),
        shop: zoneWith(SHOP_TOTALS[row.shop]!, [], 'left', makeFillers(VANILLA_FILLERS, UNTARGETED_SPELL.id), 'sf').map((c, i) => ({ uid: `of${i}`, cardId: c.cardId })),
        goldLevel: row.gold, exactCost: () => 0,
      });
      return {
        state,
        steps: acted.map((a, k) => ({
          label: `cast#${k + 1}`,
          make: (): Action => ({ type: 'play', uid: a.uid }),
          expectGold: () => 0,
        })),
      };
    },
  },
];

// ── INVARIANTS ──────────────────────────────────────────────────────────────────────────────────────────────

/** Assert the step's invariants; returns human-readable violations (empty = clean). Exposed as a plain
 *  function so the sabotage test can prove it alarms on doctored states. */
function stepInvariants(before: RunState, after: RunState, step: Pick<Step, 'expectGold' | 'mustReject'>, label: string): string[] {
  const out: string[] = [];
  if (after === before) return out; // clean rejection — the identical-object contract holds by construction
  if (step.mustReject?.(before)) out.push(`${label}: expected a clean rejection but the state changed`);
  if (after.embers < 0) out.push(`${label}: embers went negative (${after.embers})`);
  if (after.board.length > CONFIG.boardMax) out.push(`${label}: board ${after.board.length} exceeds the cap ${CONFIG.boardMax}`);
  if (after.hand.length > handCap(after)) out.push(`${label}: hand ${after.hand.length} exceeds the cap ${handCap(after)}`);
  const uids = [...after.hand, ...after.board, ...after.shop, ...(after.spell ? [after.spell] : [])].map((c) => c.uid);
  if (new Set(uids).size !== uids.length) out.push(`${label}: duplicate uid across hand/board/shop/spell`);
  if (step.expectGold) {
    const want = step.expectGold(before);
    const got = after.embers - before.embers;
    if (got !== want) out.push(`${label}: embers delta ${got}, cost helper says ${want}`);
  }
  return out;
}

const fmtRow = (row: CoveringRow): string => DIMS.map((d) => `${d.name}=${row[d.name]}`).join(' ');

// ── TESTS ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('Doc Bot — recruit boundary covering array (generation)', () => {
  it('covers every dimension pair with a tiny deterministic array (not the Cartesian product)', () => {
    expect(uncoveredPairs(DIMS, ARRAY.rows)).toEqual([]);
    // Deterministic: a second generation is byte-identical.
    expect(pairwiseCoveringArray(DIMS)).toEqual(ARRAY);
    // A covering array, not a Cartesian sweep: two orders of magnitude smaller.
    expect(ARRAY.rows.length).toBeLessThan(60);
    expect(ARRAY.rows.length * 100).toBeLessThan(ARRAY.cartesianSize);
    // The coverage report: every row earns its place (covers pairs no earlier row covered), and the
    // per-row report accounts for every pair exactly once.
    for (const covered of ARRAY.rowsCovered) expect(covered.length).toBeGreaterThan(0);
    expect(ARRAY.rowsCovered.reduce((n, c) => n + c.length, 0)).toBe(ARRAY.totalPairs);
    console.log(`[covering-array] ${ARRAY.rows.length} rows cover all ${ARRAY.totalPairs} dimension-level pairs (full Cartesian product: ${ARRAY.cartesianSize.toLocaleString()} rows)`);
  });

  it('sabotage (§3.5): removing one row breaks the all-pairs check', () => {
    // The LAST row's seed pair is by construction covered by no other row — dropping it must alarm.
    const sabotaged = ARRAY.rows.slice(0, -1);
    expect(uncoveredPairs(DIMS, sabotaged).length).toBeGreaterThan(0);
  });
});

describe('Doc Bot — recruit boundary covering array (execution through the real engine)', () => {
  it('probe content is still live (pick new probes if this fails)', () => {
    expect(VANILLA_FILLERS.length, 'not enough inert filler minions in the set1 pool').toBeGreaterThanOrEqual(9);
    expect(DRAGON_FILLERS.length, 'not enough Dragon fillers in the set1 pool').toBeGreaterThanOrEqual(4);
    expect(BUY_DEF, 'no vanilla buy probe').toBeDefined();
    expect(UNTARGETED_BC?.effects?.some((e) => e.on === 'onPlay'), 'cleric is no longer an untargeted Battlecry').toBe(true);
    expect(TARGETED_BC?.target, 'emissary is no longer a targeted Battlecry').toBe('friendly');
    expect(TARGETED_BC?.targetTribe).toBe('dragon');
    expect(AIMED_SPELL?.spell && AIMED_SPELL.target, 'spiritfire is no longer an aimed spell').toBe('any');
    expect(UNTARGETED_SPELL?.spell === true && !UNTARGETED_SPELL.target, 'growth is no longer an untargeted spell').toBe(true);
    for (const id of [SPELL_MULT_QUEST, SHOUT_MULT_QUEST]) {
      expect(QUEST_DEFS.some((q) => q.id === id), `${id} is gone — pick a new multiplier probe`).toBe(true);
    }
  });

  it('every row × every representative action holds the invariants (and the explosion guard stays quiet)', () => {
    const problems: string[] = [];
    const warnings: string[] = [];
    let accepted = 0;
    let rejected = 0;
    for (const spec of ACTIONS) {
      for (const [ri, row] of ARRAY.rows.entries()) {
        const { state, steps } = spec.build(row, ri);
        const guard = new ExplosionGuard();
        let cur = state;
        for (const step of steps) {
          const label = `${spec.name} row#${ri} (${fmtRow(row)}) ${step.label}`;
          let next: RunState;
          try {
            next = reduce(cur, step.make(cur));
          } catch (e) {
            problems.push(`${label}: reducer threw — ${String(e)}`);
            break;
          }
          if (next === cur) rejected++; else accepted++;
          problems.push(...stepInvariants(cur, next, step, label));
          guard.step(cur, next, label);
          cur = next;
        }
        const rep = guard.report();
        warnings.push(...rep.warnings);
        problems.push(...rep.failures);
      }
    }
    if (warnings.length) console.warn(`[explosion-guard] ${warnings.length} high-but-terminating warnings:\n  ${warnings.join('\n  ')}`);
    console.log(`[covering-array sweep] ${accepted} accepted / ${rejected} cleanly rejected dispatches across ${ACTIONS.length} actions × ${ARRAY.rows.length} rows`);
    // The sweep must be exercising the engine, not vacuously bouncing off guards: boundary rows (Gold 0,
    // full board/hand, invalid targets) SHOULD reject, but a healthy share must actually resolve.
    expect(accepted).toBeGreaterThan(ACTIONS.length * ARRAY.rows.length * 0.3);
    expect(problems, `Invariant/guard violation(s):\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  it('sabotage (§3.5): doctored states alarm the invariant checker and the explosion guard', () => {
    const { state } = ACTIONS[0]!.build(ARRAY.rows[0]!, 0);
    // Negative embers.
    expect(stepInvariants(state, { ...state, embers: -1 }, {}, 's')).not.toEqual([]);
    // Board past the cap.
    const fat = { ...state, board: Array.from({ length: CONFIG.boardMax + 1 }, (_, i) => inst(`x${i}`, BUY_DEF)) };
    expect(stepInvariants(state, fat, {}, 's')).not.toEqual([]);
    // Duplicate uids.
    const dup = { ...state, hand: [inst('same', BUY_DEF), inst('same', VANILLA_FILLERS[1]!)] };
    expect(stepInvariants(state, dup, {}, 's')).not.toEqual([]);
    // Gold delta off the cost helper.
    expect(stepInvariants(state, { ...state, embers: state.embers - 1 }, { expectGold: () => -3 }, 's')).not.toEqual([]);
    // Violated must-reject contract.
    expect(stepInvariants(state, { ...state }, { mustReject: () => true }, 's')).not.toEqual([]);
    // Guard: two accepted steps landing on materially identical states = a cycle.
    const guard = new ExplosionGuard();
    guard.step(state, { ...state }, 'a');
    guard.step(state, { ...state }, 'b');
    expect(guard.report().failures.length).toBeGreaterThan(0);
    // Guard: uid-generation budget exhaustion fails outright.
    const burst = new ExplosionGuard();
    burst.step(state, { ...state, embers: state.embers + 1, uidSeq: state.uidSeq + 1000 }, 'c');
    expect(burst.report().failures.length).toBeGreaterThan(0);
  });

  it('loop guard (§8.4): a deliberately trigger-heavy action loop terminates with no repeated signatures', () => {
    // Both always-on multipliers armed through the real reward engine, a full Dragon bench, Battlecries,
    // an aimed + an untargeted spell, sells, rolls and buys — the loudest legal recruit loop we can stage.
    let s = createRun(99, 'warden', 'ascent', CONFIG.defaultLine, 'set1');
    s.phase = 'recruit';
    s.tier = 6;
    s = reduce(s, { type: 'devGrant', kind: 'quest', id: SHOUT_MULT_QUEST });
    s = reduce(s, { type: 'devGrant', kind: 'quest', id: SPELL_MULT_QUEST });
    const dragons = makeFillers(DRAGON_FILLERS, UNTARGETED_BC.id);
    s.board = Array.from({ length: 5 }, (_, i) => dragons(`bf${i}`)); // 5, so BOTH clerics fit under the 7 cap
    s.hand = [
      inst('bc0', UNTARGETED_BC), inst('bc1', UNTARGETED_BC, true),
      inst('sp0', AIMED_SPELL), inst('gr0', UNTARGETED_SPELL),
    ];
    s.shop = [{ uid: 'of0', cardId: BUY_DEF.id }, { uid: 'of1', cardId: BUY_DEF.id, golden: true }];
    s.spell = null;
    s.embers = 50;

    const guard = new ExplosionGuard();
    const dispatch = (label: string, make: (cur: RunState) => Action): void => {
      const next = reduce(s, make(s));
      guard.step(s, next, label);
      s = next;
    };
    dispatch('play cleric (doubled Shout, full bench)', () => ({ type: 'play', uid: 'bc0' }));
    dispatch('play GOLDEN cleric', () => ({ type: 'play', uid: 'bc1' }));
    dispatch('cast Spirit Fire ×2 at the lead', (cur) => ({ type: 'play', uid: 'sp0', targetUid: cur.board[0]!.uid }));
    dispatch('cast Growth ×2', () => ({ type: 'play', uid: 'gr0' }));
    dispatch('sell the lead', (cur) => ({ type: 'sell', uid: cur.board[0]!.uid }));
    dispatch('buy plain', () => ({ type: 'buy', uid: 'of0' }));
    dispatch('buy gilded offer', () => ({ type: 'buy', uid: 'of1' }));
    dispatch('roll', () => ({ type: 'roll' }));
    dispatch('roll again', () => ({ type: 'roll' }));

    const rep = guard.report();
    if (rep.warnings.length) console.warn(`[explosion-guard/heavy] ${rep.warnings.join('\n  ')}`);
    expect(rep.failures, rep.failures.join('\n')).toEqual([]);
    // And the loop ended in a legal place.
    expect(stepInvariants(createRun(99, 'warden', 'ascent', CONFIG.defaultLine, 'set1'), s, {}, 'final')).toEqual([]);
    // Signatures were actually computed (the guard was not vacuously quiet).
    expect(normalizedSignature(s)).toMatch(/^[0-9a-f]+$/);
  });
});
