/**
 * DOC BOT 2.0 WP F — PAIRWISE + TARGETED-TRIPLE interaction coverage (blueprint §10.3/§10.4/§10.5;
 * work-package-plan.md WP F).
 *
 * For each §10.3 priority pair family (and each §10.4 high-risk triple), this module:
 *  1. selects candidate content DERIVED from the contract registry (the applicability engine's channel
 *     logic — never a hand-pinned card list; fixture construction may read CARD_INDEX for staging data
 *     like a watcher's tribe param, but the ORACLE side only ever compares engine measurements);
 *  2. executes the scenario through the REAL engine (`simulate()` for combat, `reduce`/
 *     `reduceWithPresentation` for shop — §4.1, the WP D driver pattern + variantDiff relations);
 *  3. records a verdict in the §15.5 coverage table: 'covered' | 'failed' | 'inapplicable' | 'blocked'
 *     (with WHY — §4.3: a pair no driver can run yet is visible, never silent);
 *  4. stamps the §10.5 COMBINATION coverage keys (`combo:<part>+<part>[+<part>]`, sorted parts) the run
 *     exercised — semantic tuples, not single-dimension contact (single keys stay in coverageKeys.ts).
 *
 * The PR gate (interactionSweep.test.ts) runs a deterministic CANDIDATE-CAPPED sample; the full sweep runs
 * behind `npm run docbot:interactions` and the nightly. Everything is seeded and deterministic (§17.4).
 *
 * The two hand-pinned matrices (interactionMatrix.test.ts, interactionFamilyMatrix.test.ts) REMAIN the
 * floor — nothing here retires them; this sweep must subsume them before any retirement (current-state-map
 * §5), and until then several blocked/covered rows cite them as the standing evidence.
 */
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { ContentContract } from '@game/rules/contracts/schema';
import { createRun } from '../state';
import type { BoardCard, RunState } from '../state';
import { reduce, reduceWithPresentation } from '../reducer';
import { combinationKey } from './coverageKeys';
import { avengeTrigger, battlecrySummonEffect, deathSummonEffect } from './isolatedCases';

export const INTERACTION_LANE = 'interaction-sweep';

// ── the family rosters ────────────────────────────────────────────────────────────────────────────────────

/** §10.3's priority list, verbatim order. */
export const PAIR_FAMILIES = [
  'trigger-x-multiplier',
  'summon-x-watcher',
  'death-x-avenge',
  'death-x-echo',
  'echo-x-rise',
  'copy-x-counter',
  'gilding-x-progress',
  'rune-x-minion',
  'hero-power-x-rune',
  'spell-x-improvement',
  'shop-spell-x-copier',
  'consume-x-buffs',
  'overflow-x-summon',
  'granted-effect-x-snapshot',
  'type-aura-x-plain-copy',
] as const;
export type PairFamilyId = (typeof PAIR_FAMILIES)[number];

/** §10.4's high-risk triple list, verbatim order. Nightly-only (the gate never pays for triples). */
export const TRIPLE_FAMILIES = [
  'echo+exact-copy+used-trigger-state',
  'avenge+simultaneous-deaths+source-death',
  'consume+eot-multiplier+shop-replacement',
  'shout+return-to-hand+shout-multiplier',
  'ruby+shop-spell-conversion+spell-copying',
  'rise+copied-source+combat-only-grant',
  'summon+overflow+summon-payoff',
  'gilding+progress-counters+duplicate-effect',
] as const;
export type TripleFamilyId = (typeof TRIPLE_FAMILIES)[number];

export type InteractionVerdict = 'covered' | 'failed' | 'inapplicable' | 'blocked';

/** Typed blocked reasons — the §4.3 vocabulary (a blocked pair always says why). */
export type BlockedReason =
  | 'no-driver-for-shape' // no generic executable driver yet — the WP F/H burn-down list
  | 'covered-by-cited-lane' // a hand-pinned npm-test lane already executes this pair; cited, not re-driven
  | 'covered-by-slice-oracle' // the vertical slice's hand probe gates this subject in npm test
  | 'hero-power-behaviour-unextracted' // hero-power magnitudes live in reducer branches (WP B gap)
  | 'no-observable-emission' // the fixture ran but nothing measurable surfaced (recorded, never passed)
  | 'no-compatible-candidates'; // candidates exist for each half but none are mutually compatible

export interface InteractionRun {
  family: PairFamilyId | TripleFamilyId;
  tier: 'pair' | 'triple';
  /** Content ids staged in the scenario (producer first). */
  members: string[];
  verdict: InteractionVerdict;
  blockedReason?: BlockedReason;
  /** One human-verifiable line: the fixture and what was counted / why blocked. */
  evidence: string;
  /** §10.5 combination coverage keys this run exercised. */
  comboKeys: string[];
  /** Measurement pair when the driver diffed base vs variant (expectedFactor 1 = must-equal). */
  measurement?: { base: number; variant: number; expectedFactor: number };
  /** Trace summaries the anomaly oracle consumes (never an oracle themselves). */
  trace?: {
    /** srcCard → factory `do` kinds observed in the combat log. */
    factoryStamps?: Record<string, string[]>;
    /** tokenId → player-side summon count. */
    summonCounts?: Record<string, number>;
    /** base measurement minus the inert-bystander-reorder measurement (0 = insensitive). */
    reorderDelta?: number;
    /** copy probe: instance state observed riding the copy. */
    copyState?: { golden?: boolean; counters?: Record<string, number> };
  };
}

export interface InteractionSweepReport {
  runs: InteractionRun[];
  familyTotals: Record<string, Record<InteractionVerdict, number>>;
  /** Union of §10.5 combination keys, sorted. */
  comboKeys: string[];
  candidateCap: number;
  includedTriples: boolean;
}

// ── fixture helpers (the contractOracle harness pattern, shared vocabulary) ───────────────────────────────

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const BOARD_CAP = 7;

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });

type Sim = ReturnType<typeof simulate>;

function fight(player: BoardMinion[], enemy: BoardMinion[], mods: Record<string, unknown> = {}, seed = 1): Sim {
  return simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods } as never),
    combatSide({ tier: 1 }));
}

const summonsOf = (r: Sim, cardId: string): number =>
  r.events.filter((e) => e.type === 'summon'
    && (e as { side?: string }).side !== 'enemy'
    && (e as { minion?: { cardId?: string } }).minion?.cardId === cardId).length;

/** srcCard → sorted distinct factory `do` kinds stamped on the log (anomaly-oracle food). */
function factoryStamps(events: readonly CombatEvent[]): Record<string, string[]> {
  const by = new Map<string, Set<string>>();
  for (const e of events) {
    const key = (e as { key?: string }).key;
    const src = (e as { srcCard?: string }).srcCard;
    if (!key || !src || !key.startsWith('factory:')) continue;
    const doKind = key.slice('factory:'.length, key.lastIndexOf(':'));
    if (!doKind) continue;
    (by.get(src) ?? by.set(src, new Set()).get(src)!).add(doKind);
  }
  return Object.fromEntries([...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => [k, [...v].sort()]));
}

function firstAvengeFireOrdinal(r: Sim, srcCard: string): number | null {
  let deaths = 0;
  for (const e of r.events) {
    if (e.type === 'death' && (e as { side?: string }).side === 'player') deaths += 1;
    if ((e as { avenge?: boolean }).avenge && (e as { srcCard?: string }).srcCard === srcCard) return deaths;
  }
  return null;
}

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

const shopState = (board: BoardCard[], seed = 0x17f1): RunState =>
  ({ ...createRun(seed, 'aster'), embers: 60, board, hand: [], shop: [] } as RunState);

// ── candidate selection (derived from the contract registry, deterministic, capped) ───────────────────────

interface Candidates {
  deathSummon: ContentContract[]; // combat echo summons that fit the cap
  avenge: ContentContract[]; // avenge triggers with a stated threshold
  battlecrySummon: ContentContract[]; // shop battlecry summons
  deathrattleMultipliers: ContentContract[]; // multiplier.families ∋ deathrattle
  summonWatchers: ContentContract[]; // shop 'onSummon' trigger holders
  copyPolicies: ContentContract[]; // stated copyPolicy (the copy probes)
}

const isCard = (c: ContentContract): boolean =>
  c.contentType === 'minion' || c.contentType === 'token' || c.contentType === 'henchman';

function selectCandidates(contracts: readonly ContentContract[], cap: number): Candidates {
  const sorted = [...contracts].sort((a, b) => (a.contentId < b.contentId ? -1 : 1));
  const take = <T,>(xs: T[]): T[] => xs.slice(0, cap);
  const deathSummon = take(sorted.filter((c) => {
    const d = deathSummonEffect(c);
    return isCard(c) && d !== null && d.plain >= 1 && d.plain * 2 + 1 <= BOARD_CAP && CARD_INDEX[c.contentId] !== undefined;
  }));
  const avenge = take(sorted.filter((c) => isCard(c) && avengeTrigger(c) !== null && CARD_INDEX[c.contentId] !== undefined));
  const battlecrySummon = take(sorted.filter((c) => isCard(c) && battlecrySummonEffect(c) !== null
    && (battlecrySummonEffect(c)!.plain + 1) <= BOARD_CAP && CARD_INDEX[c.contentId] !== undefined));
  const deathrattleMultipliers = sorted.filter((c) => (c.multiplier?.families ?? []).includes('deathrattle'));
  const summonWatchers = take(sorted.filter((c) => isCard(c)
    && (c.triggers ?? []).some((t) => t.event === 'onSummon' && t.phase !== 'combat') && CARD_INDEX[c.contentId] !== undefined));
  const copyPolicies = sorted.filter((c) => c.copyPolicy !== undefined);
  return { deathSummon, avenge, battlecrySummon, deathrattleMultipliers, summonWatchers, copyPolicies };
}

// ── the sweep ─────────────────────────────────────────────────────────────────────────────────────────────

export interface InteractionSweepOptions {
  contracts: readonly ContentContract[];
  /** Candidates per family. The PR gate uses a small deterministic cap; the full sweep passes Infinity. */
  candidateCap?: number;
  /** §10.4 triples are NIGHTLY-ONLY — the gate never pays for them. */
  triples?: boolean;
}

export function runInteractionSweep(opts: InteractionSweepOptions): InteractionSweepReport {
  const cap = opts.candidateCap ?? Number.POSITIVE_INFINITY;
  const cand = selectCandidates(opts.contracts, Number.isFinite(cap) ? cap : Number.MAX_SAFE_INTEGER);
  const runs: InteractionRun[] = [];
  const push = (r: InteractionRun): void => { runs.push(r); };
  const blocked = (family: InteractionRun['family'], tier: InteractionRun['tier'], reason: BlockedReason, evidence: string, comboKeys: string[] = []): void =>
    push({ family, tier, members: [], verdict: 'blocked', blockedReason: reason, evidence, comboKeys });

  // ── PF1 trigger × trigger-multiplier: every candidate echo summon must exactly fold every
  //    deathrattle-family multiplier (the #897 Echohorn-dropped-Sylus class, generalized). ─────────────────
  for (const producer of cand.deathSummon) {
    const d = deathSummonEffect(producer)!;
    for (const mult of cand.deathrattleMultipliers) {
      // The card's declared total factor, whichever shape it uses — `declared` (additive) or `factor`
      // (a "triggers twice" multiplier). See `declaredFireFactor`.
      const declared = mult.multiplier!.factor ?? 1 + (mult.multiplier!.extra ?? 0);
      if (d.plain * declared + 1 > BOARD_CAP) {
        push({
          family: 'trigger-x-multiplier', tier: 'pair', members: [producer.contentId, mult.contentId],
          verdict: 'inapplicable', evidence: `${d.plain} × ${declared} multiplied tokens + the multiplier body exceed the ${BOARD_CAP}-slot cap`, comboKeys: [],
        });
        continue;
      }
      const body = bm(producer.contentId, 1, 1, { keywords: ['T'] });
      const base = fight([body], [bm('sandbag', 5, 4000)]);
      const variant = fight([bm(producer.contentId, 1, 1, { keywords: ['T'] }), bm(mult.contentId, 1, 30)], [bm('sandbag', 5, 4000)]);
      const b = summonsOf(base, d.cardId);
      const v = summonsOf(variant, d.cardId);
      const ok = b === d.plain && v === b * declared;
      push({
        family: 'trigger-x-multiplier', tier: 'pair', members: [producer.contentId, mult.contentId],
        verdict: ok ? 'covered' : 'failed',
        evidence: `combat: ${producer.contentId} died; ${b} '${d.cardId}' base, ${v} with ${mult.contentId} (declared ×${declared})`,
        comboKeys: [combinationKey(['trigger:onDeath', 'multiplier:deathrattle'])],
        measurement: { base: b, variant: v, expectedFactor: declared },
        trace: { factoryStamps: factoryStamps(variant.events), summonCounts: { [d.cardId]: v } },
      });
    }
  }
  if (cand.deathSummon.length === 0 || cand.deathrattleMultipliers.length === 0) {
    blocked('trigger-x-multiplier', 'pair', 'no-compatible-candidates', 'no echo-summon producers or deathrattle multipliers in the registry slice');
  }

  // ── PF2 summon × summon-watcher (shop): playing a Shout summoner past a fielded onSummon watcher must
  //    move the board — measured as the DIFFERENTIAL of non-watcher stats with vs without the watcher
  //    (the envelope's sourceTrigger is corroborating evidence where it exists; many watcher factories act
  //    without an attributable emission today — canonical-schemas §4.1's 8/26-stamped reality). ────────────
  {
    let staged = 0;
    for (const watcher of cand.summonWatchers) {
      const wDef = CARD_INDEX[watcher.contentId]!;
      const wTribe = (wDef.effects.find((e) => e.on === 'onSummon')?.params as { tribe?: string } | undefined)?.tribe;
      const producer = cand.battlecrySummon.find((p) => {
        const tokenId = battlecrySummonEffect(p)!.cardId;
        const tokDef = CARD_INDEX[tokenId];
        return !!tokDef && (!wTribe || tokDef.tribe === wTribe || tokDef.tribe2 === wTribe || !!tokDef.universalTribe);
      });
      if (!producer) {
        push({
          family: 'summon-x-watcher', tier: 'pair', members: [watcher.contentId],
          verdict: 'inapplicable', evidence: `no battlecry-summon producer whose token matches the watcher's tribe scope${wTribe ? ` ('${wTribe}')` : ''}`, comboKeys: [],
        });
        continue;
      }
      staged++;
      const tokenId = battlecrySummonEffect(producer)!.cardId;
      const playPast = (withWatcher: boolean): { state: RunState; fired: boolean; nonWatcherStats: number } => {
        const s = shopState(withWatcher ? [card('w', watcher.contentId)] : []);
        s.hand = [card('p', producer.contentId)];
        const { state: after, batch } = reduceWithPresentation(s, { type: 'play', uid: 'p' }, true);
        const fired = (batch?.events ?? []).some((e) => e.type === 'sourceTrigger'
          && ((e as { trigger?: string }).trigger === 'onSummon' || /:onSummon$/.test((e as { policyKey?: string }).policyKey ?? '')));
        const nonWatcherStats = after.board.filter((x) => x.uid !== 'w').reduce((n, x) => n + x.attack + x.health, 0);
        return { state: after, fired, nonWatcherStats };
      };
      const withW = playPast(true);
      const without = playPast(false);
      const tokensLanded = withW.state.board.filter((x) => x.cardId === tokenId).length;
      if (tokensLanded === 0) {
        push({
          family: 'summon-x-watcher', tier: 'pair', members: [producer.contentId, watcher.contentId],
          verdict: 'blocked', blockedReason: 'no-observable-emission',
          evidence: `playing ${producer.contentId} landed no '${tokenId}' token — the channel never emitted (recorded, not passed)`, comboKeys: [],
        });
        continue;
      }
      const reacted = withW.fired || withW.nonWatcherStats !== without.nonWatcherStats;
      if (!reacted) {
        // Indistinguishable from a scope gate the contract cannot state (imp-only inheritance etc.) —
        // recorded as blocked, never guessed as failed (§4.3); detector G weighs it below the floor.
        push({
          family: 'summon-x-watcher', tier: 'pair', members: [producer.contentId, watcher.contentId],
          verdict: 'blocked', blockedReason: 'no-observable-emission',
          evidence: `shop: played ${producer.contentId} (${tokensLanded} × '${tokenId}') with ${watcher.contentId} fielded — no sourceTrigger and no stat differential vs the watcherless control (a scope gate or a swallow; the contract cannot say which)`,
          comboKeys: [],
        });
        continue;
      }
      push({
        family: 'summon-x-watcher', tier: 'pair', members: [producer.contentId, watcher.contentId],
        verdict: 'covered',
        evidence: `shop: played ${producer.contentId} (${tokensLanded} × '${tokenId}' summoned) with ${watcher.contentId} fielded — watcher reacted (${withW.fired ? 'onSummon sourceTrigger fired' : `non-watcher stats ${without.nonWatcherStats} → ${withW.nonWatcherStats}`})`,
        comboKeys: [combinationKey(['effect:battlecry-summon', 'trigger:onSummon'])],
      });
    }
    if (staged === 0 && cand.summonWatchers.length === 0) {
      blocked('summon-x-watcher', 'pair', 'no-compatible-candidates', 'no shop onSummon watchers in the registry slice');
    }
  }

  // ── PF3 death × Avenge: feeder deaths must arm the watcher exactly at its declared threshold. ───────────
  for (const watcher of cand.avenge) {
    const av = avengeTrigger(watcher)!;
    const feeders = Math.min(5, av.threshold + 1);
    const board = [bm(watcher.contentId, 1, 400), ...Array.from({ length: feeders }, () => bm('b2_packstrider', 1, 1))];
    const r = fight(board, [bm('sandbag', 2, 4000)]);
    const ordinal = firstAvengeFireOrdinal(r, watcher.contentId);
    if (ordinal === null) {
      push({
        family: 'death-x-avenge', tier: 'pair', members: [watcher.contentId],
        verdict: 'blocked', blockedReason: 'no-observable-emission',
        evidence: `${feeders} feeder deaths staged; no avenge-stamped emission attributed to ${watcher.contentId} (the effect may act without emitting)`, comboKeys: [],
      });
      continue;
    }
    push({
      family: 'death-x-avenge', tier: 'pair', members: [watcher.contentId, 'b2_packstrider'],
      verdict: ordinal === av.threshold ? 'covered' : 'failed',
      evidence: `combat: first avenge fire at side-death ${ordinal}; contract threshold ${av.threshold}`,
      comboKeys: [combinationKey(['channel:death', 'trigger:avenge'])],
      measurement: { base: av.threshold, variant: ordinal, expectedFactor: 1 },
      trace: { factoryStamps: factoryStamps(r.events) },
    });
  }
  if (cand.avenge.length === 0) blocked('death-x-avenge', 'pair', 'no-compatible-candidates', 'no avenge-threshold contracts in the registry slice');

  // ── PF4 death × Echo (+ the §9.7 irrelevant-change probe): one death, exactly the claimed tokens; two
  //    inert bystanders reordered must change NOTHING (anomaly food when it does). ─────────────────────────
  for (const producer of cand.deathSummon) {
    const d = deathSummonEffect(producer)!;
    const body = (): BoardMinion => bm(producer.contentId, 1, 1, { keywords: ['T'] });
    const filler = (): BoardMinion => bm('sandbag', 0, 50);
    const n = summonsOf(fight([body()], [bm('sandbag', 5, 4000)]), d.cardId);
    const left = summonsOf(fight([body(), filler(), filler()], [bm('sandbag', 5, 4000)]), d.cardId);
    const right = summonsOf(fight([filler(), filler(), body()], [bm('sandbag', 5, 4000)]), d.cardId);
    push({
      family: 'death-x-echo', tier: 'pair', members: [producer.contentId],
      verdict: n === d.plain && left === right ? 'covered' : 'failed',
      evidence: `combat: ${producer.contentId} died once → ${n} × '${d.cardId}' (claimed ${d.plain}); reorder probe ${left} vs ${right}`,
      comboKeys: [combinationKey(['channel:death', 'trigger:onDeath'])],
      measurement: { base: d.plain, variant: n, expectedFactor: 1 },
      trace: { reorderDelta: right - left, summonCounts: { [d.cardId]: n } },
    });
  }
  if (cand.deathSummon.length === 0) blocked('death-x-echo', 'pair', 'no-compatible-candidates', 'no combat echo-summon contracts in the registry slice');

  // ── PF5 Echo × Rise: a granted Rise means the body dies TWICE — the echo must fire per death. ───────────
  for (const producer of cand.deathSummon) {
    const d = deathSummonEffect(producer)!;
    if (d.plain * 2 > BOARD_CAP) {
      push({
        family: 'echo-x-rise', tier: 'pair', members: [producer.contentId],
        verdict: 'inapplicable', evidence: `two echo fires (${d.plain * 2} tokens) exceed the ${BOARD_CAP}-slot cap`, comboKeys: [],
      });
      continue;
    }
    const r = fight([bm(producer.contentId, 1, 1, { keywords: ['T', 'R'] })], [bm('sandbag', 5, 4000)]);
    const n = summonsOf(r, d.cardId);
    push({
      family: 'echo-x-rise', tier: 'pair', members: [producer.contentId],
      verdict: n === d.plain * 2 ? 'covered' : 'failed',
      evidence: `combat: ${producer.contentId} granted Rise died, rose with 1 Health, died again → ${n} × '${d.cardId}' (expected ${d.plain} × 2 deaths)`,
      comboKeys: [combinationKey(['echo', 'rise'])],
      measurement: { base: d.plain, variant: n, expectedFactor: 2 },
      trace: { summonCounts: { [d.cardId]: n }, factoryStamps: factoryStamps(r.events) },
    });
  }

  // ── PF6 copy mode × stateful counter: an EXACT copy carries gilding + accrued counters (the approved
  //    hero:xerox probe, the WP D copy driver generalized into the pair table). ────────────────────────────
  {
    const xerox = cand.copyPolicies.find((c) => c.contentId === 'hero:xerox');
    if (xerox) {
      const s = createRun(13, 'xerox', 'ascent', 9, 'set1');
      s.embers = 10;
      s.board = [{ uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 2, health: 6, keywords: ['SC'], golden: true, summonBonus: 2 } as BoardCard];
      const after = reduce(s, { type: 'heroPower', uid: 'k1' });
      const copy = after.board.find((x) => x.uid !== 'k1');
      const exact = copy?.golden === true && (copy as { summonBonus?: number })?.summonBonus === 2;
      push({
        family: 'copy-x-counter', tier: 'pair', members: ['hero:xerox', 'kennel'],
        verdict: (xerox.copyPolicy!.mode === 'exact') === exact ? 'covered' : 'failed',
        evidence: `reducer: heroPower on a gilded Kennelmaster (summonBonus 2) — copy ${copy ? `golden=${copy.golden} summonBonus=${(copy as { summonBonus?: number }).summonBonus}` : 'absent'}; contract states '${xerox.copyPolicy!.mode}'`,
        comboKeys: [combinationKey(['copy:exact', 'counter:per-instance', 'gild'])],
        trace: { copyState: copy ? { golden: copy.golden, counters: { summonBonus: (copy as { summonBonus?: number }).summonBonus ?? 0 } } : {} },
      });
    } else {
      blocked('copy-x-counter', 'pair', 'no-compatible-candidates', 'no copyPolicy-stating contract with a reducer copy probe in the slice');
    }
  }

  // ── PF7 Gilding × accumulated progress: gilding the watcher must NOT move its progress threshold
  //    (resolution may double; the arming ordinal may not — the R-AVWIN-07 shape at the gild boundary). ────
  for (const watcher of cand.avenge) {
    const av = avengeTrigger(watcher)!;
    const feeders = Math.min(5, av.threshold + 1);
    const run = (golden: boolean): number | null => firstAvengeFireOrdinal(
      fight([bm(watcher.contentId, golden ? 2 : 1, 400, golden ? { golden: true } as Partial<BoardMinion> : {}),
        ...Array.from({ length: feeders }, () => bm('b2_packstrider', 1, 1))], [bm('sandbag', 2, 4000)]),
      watcher.contentId);
    const plain = run(false);
    const gilded = run(true);
    if (plain === null || gilded === null) {
      push({
        family: 'gilding-x-progress', tier: 'pair', members: [watcher.contentId],
        verdict: 'blocked', blockedReason: 'no-observable-emission',
        evidence: `no avenge-stamped emission on the ${plain === null ? 'plain' : 'gilded'} leg — progress not observable for this payoff shape`, comboKeys: [],
      });
      continue;
    }
    push({
      family: 'gilding-x-progress', tier: 'pair', members: [watcher.contentId],
      verdict: plain === gilded ? 'covered' : 'failed',
      evidence: `combat: first avenge fire at side-death ${plain} plain vs ${gilded} gilded — gilding must double resolution, never advance progress`,
      comboKeys: [combinationKey(['gild', 'counter:avenge-progress'])],
      measurement: { base: plain, variant: gilded, expectedFactor: 1 },
    });
  }

  // ── PF8 rune × minion factory: Rune of Fury (avenge-resolution ×2) must not move the arming ordinal
  //    (R-AVWIN-07 generalized over every avenge candidate). ───────────────────────────────────────────────
  for (const watcher of cand.avenge) {
    const av = avengeTrigger(watcher)!;
    const feeders = Math.min(5, av.threshold + 1);
    const run = (mods: Record<string, unknown>): number | null => firstAvengeFireOrdinal(
      fight([bm(watcher.contentId, 1, 400), ...Array.from({ length: feeders }, () => bm('b2_packstrider', 1, 1))],
        [bm('sandbag', 2, 4000)], mods),
      watcher.contentId);
    const base = run({});
    const armed = run({ runeFury: true });
    if (base === null || armed === null) {
      push({
        family: 'rune-x-minion', tier: 'pair', members: [watcher.contentId, 'rune_fury'],
        verdict: 'blocked', blockedReason: 'no-observable-emission',
        evidence: 'no avenge-stamped emission on one leg — ordinal not observable for this payoff shape', comboKeys: [],
      });
      continue;
    }
    push({
      family: 'rune-x-minion', tier: 'pair', members: [watcher.contentId, 'rune_fury'],
      verdict: base === armed ? 'covered' : 'failed',
      evidence: `combat: first avenge fire at side-death ${base} without vs ${armed} with Rune of Fury (R-AVWIN-07: resolution doubles, progress never moves)`,
      comboKeys: [combinationKey(['rune:multiplier', 'trigger:avenge'])],
      measurement: { base, variant: armed, expectedFactor: 1 },
    });
  }
  if (cand.avenge.length === 0) {
    blocked('gilding-x-progress', 'pair', 'no-compatible-candidates', 'no avenge-threshold contracts in the registry slice');
    blocked('rune-x-minion', 'pair', 'no-compatible-candidates', 'no avenge-threshold contracts in the registry slice');
  }

  // ── PF9 hero power × rune: BLOCKED — hero-power magnitudes are reducer branches the extractor cannot
  //    state yet (WP B's visible low-confidence gap); heroPowerLane drives activations meanwhile. ──────────
  blocked('hero-power-x-rune', 'pair', 'hero-power-behaviour-unextracted',
    'hero-power magnitude claims need WP E/H curation first; activation is driven by heroPowerLane/heroPowerStagers (cited)');

  // ── PF10 spell × spell improvement: a stat spell must fold the run's spell bonus exactly. ───────────────
  {
    const spellDef = Object.values(CARD_INDEX).find((c) => c?.spell && !c.singleCast
      && c.effects.length === 1 && c.effects[0]!.on === 'cast' && c.effects[0]!.do === 'spellBuffTarget');
    if (!spellDef) {
      blocked('spell-x-improvement', 'pair', 'no-compatible-candidates', 'no single-effect spellBuffTarget spell in CARD_INDEX');
    } else {
      const p = spellDef.effects[0]!.params as { attack?: number; health?: number };
      const cast = (bonus: number): [number, number] => {
        const s = shopState([card('tgt', 'pup')]);
        if (bonus > 0) (s as { spellBonus?: { attack: number; health: number } }).spellBonus = { attack: bonus, health: bonus };
        const after = reduce({ ...s, hand: [{ ...card('sp', spellDef.id), attack: 0, health: 0 }] }, { type: 'play', uid: 'sp', targetUid: 'tgt' });
        const t = after.board.find((x) => x.uid === 'tgt')!;
        return [t.attack - 1, t.health - 1];
      };
      const [a0, h0] = cast(0);
      const [a2, h2] = cast(2);
      const ok = a0 === (p.attack ?? 0) && h0 === (p.health ?? 0) && a2 === a0 + 2 && h2 === h0 + 2;
      push({
        family: 'spell-x-improvement', tier: 'pair', members: [spellDef.id],
        verdict: ok ? 'covered' : 'failed',
        evidence: `reducer: ${spellDef.id} granted +${a0}/+${h0} plain and +${a2}/+${h2} with spellBonus +2/+2 (the #8f98da40 spell-power-fold class)`,
        comboKeys: [combinationKey(['spell', 'spell-improvement'])],
        measurement: { base: a0, variant: a2 - 2, expectedFactor: 1 },
      });
    }
  }

  // ── PF11/PF12/PF14/PF15 — visibly blocked, each citing the lane or fixture that owns the surface. ───────
  blocked('shop-spell-x-copier', 'pair', 'covered-by-slice-oracle',
    'the d2_recaller shop-spell-copier probe gates in verticalSlice.test.ts (npm test); no generic driver yet');
  blocked('consume-x-buffs', 'pair', 'covered-by-slice-oracle',
    'the dm_agent (offer-buy-stats Consume) + dm_butcher slice probes gate in verticalSlice.test.ts; no generic driver yet');
  blocked('granted-effect-x-snapshot', 'pair', 'covered-by-cited-lane',
    'snapshotFidelity.test.ts enumerates every per-instance field across the capture boundary (the #832 soulbind class); a generated cross-boundary driver is WP C trace work');
  blocked('type-aura-x-plain-copy', 'pair', 'covered-by-cited-lane',
    'the plain-copy leg is pinned by the avenge-window-plain-copy fixture (contract oracle) and tribe-scoped eligibility by interactionMatrix.test.ts; the aura×copy join has no generic driver yet');

  // ── PF13 overflow × summon: with one free slot, a multi-summon must clip at the cap — and the board
  //    invariant must hold. ─────────────────────────────────────────────────────────────────────────────────
  for (const producer of cand.deathSummon) {
    const d = deathSummonEffect(producer)!;
    if (d.plain < 2) {
      push({
        family: 'overflow-x-summon', tier: 'pair', members: [producer.contentId],
        verdict: 'inapplicable', evidence: `claimed count ${d.plain} cannot overflow one free slot`, comboKeys: [],
      });
      continue;
    }
    const fillers = Array.from({ length: BOARD_CAP - 2 }, () => bm('sandbag', 0, 4000));
    const r = fight([bm(producer.contentId, 1, 1, { keywords: ['T'] }), ...fillers], [bm('sandbag', 5, 4000)]);
    const n = summonsOf(r, d.cardId);
    const free = 2; // the dead source's slot + the one deliberately left open
    push({
      family: 'overflow-x-summon', tier: 'pair', members: [producer.contentId],
      verdict: n <= free ? 'covered' : 'failed',
      evidence: `combat: ${BOARD_CAP - 1} bodies fielded, source died → ${n} × '${d.cardId}' summoned into ${free} free slot(s) (claimed ${d.plain}; overflow must clip, never exceed the cap)`,
      comboKeys: [combinationKey(['summon', 'overflow'])],
      measurement: { base: Math.min(d.plain, free), variant: n, expectedFactor: 1 },
      trace: { summonCounts: { [d.cardId]: n } },
    });
  }

  // ── §10.4 targeted triples (nightly-only) ────────────────────────────────────────────────────────────────
  if (opts.triples) {
    // T-echo+rise+multiplier is our executable proxy for 'echo+exact-copy+used-trigger-state''s neighbour
    // class — but the LISTED triple itself (exact copy of a body whose trigger state is spent) has no
    // combat-side copy driver yet, so the listed id stays visibly blocked and the executable composition
    // ships as summon+overflow / rise rows below. Honesty first (§4.3).
    blocked('echo+exact-copy+used-trigger-state', 'triple', 'covered-by-cited-lane',
      'temporalWindow.test.ts pins copy/Rise/gild progress semantics incl. spent-window copies (R-AVWIN-03/04 family); a generated combat copy driver is WP C/H work');
    blocked('avenge+simultaneous-deaths+source-death', 'triple', 'covered-by-cited-lane',
      'temporalWindow.test.ts drives the ten Avenge temporal scenarios incl. simultaneous deaths and source death (R-AVWIN family; R-AVWIN-02/10 pinned release blockers)');
    blocked('consume+eot-multiplier+shop-replacement', 'triple', 'no-driver-for-shape',
      'no generic driver stages Consume + an End-of-Turn multiplier + a shop replacement in one scenario yet — WP F burn-down');
    blocked('shout+return-to-hand+shout-multiplier', 'triple', 'covered-by-cited-lane',
      'interactionFamilyMatrix.test.ts P9/P10 pin every combat Shout re-fire folding drakkoRepeats (owner ruling q-interact-combat-shout-multipliers); the return-to-hand leg has no generic driver yet');
    blocked('ruby+shop-spell-conversion+spell-copying', 'triple', 'no-driver-for-shape',
      'the Ruby engine + shop-spell conversion + copier join has no generic driver yet — WP F burn-down (the ruby bounce pair is pinned by interactionFamilyMatrix P8)');
    blocked('rise+copied-source+combat-only-grant', 'triple', 'covered-by-cited-lane',
      'temporalWindow.test.ts pins Rise/copy progress; combat-only grants are gated by factoryPhase — the three-way join has no generic driver yet');

    // T7 summon + overflow + summon-payoff (executable): a doubled multi-summon into one free slot must
    // still clip at the cap — multiplier pressure never breaches the board invariant.
    const overflowable = cand.deathSummon.filter((p) => deathSummonEffect(p)!.plain >= 2);
    if (overflowable.length === 0 || cand.deathrattleMultipliers.length === 0) {
      blocked('summon+overflow+summon-payoff', 'triple', 'no-compatible-candidates',
        'no multi-summon echo producer (count >= 2) or deathrattle multiplier in the registry slice');
    }
    for (const producer of overflowable.slice(0, 2)) {
      const d = deathSummonEffect(producer)!;
      const mult = cand.deathrattleMultipliers[0];
      if (!mult) continue;
      const fillers = Array.from({ length: BOARD_CAP - 3 }, () => bm('sandbag', 0, 4000));
      const r = fight([bm(producer.contentId, 1, 1, { keywords: ['T'] }), bm(mult.contentId, 0, 4000), ...fillers], [bm('sandbag', 5, 4000)]);
      const n = summonsOf(r, d.cardId);
      const free = 2; // dead source's slot + the one open slot
      push({
        family: 'summon+overflow+summon-payoff', tier: 'triple', members: [producer.contentId, mult.contentId],
        verdict: n <= free ? 'covered' : 'failed',
        evidence: `combat: ${mult.contentId} doubles ${producer.contentId}'s echo into ${free} free slot(s) → ${n} summons (must clip at the cap)`,
        comboKeys: [combinationKey(['summon', 'overflow', 'multiplier:deathrattle'])],
        measurement: { base: free, variant: Math.min(n, free), expectedFactor: 1 },
        trace: { summonCounts: { [d.cardId]: n } },
      });
    }

    // T8 gilding + progress counters + duplicate effect (executable): a GILDED watcher under Rune of Fury —
    // two multipliers of resolution pressure — must still arm at the unmoved threshold.
    let t8Staged = 0;
    for (const watcher of cand.avenge.slice(0, 3)) {
      const av = avengeTrigger(watcher)!;
      const feeders = Math.min(5, av.threshold + 1);
      const run = (golden: boolean, mods: Record<string, unknown>): number | null => firstAvengeFireOrdinal(
        fight([bm(watcher.contentId, golden ? 2 : 1, 400, golden ? { golden: true } as Partial<BoardMinion> : {}),
          ...Array.from({ length: feeders }, () => bm('b2_packstrider', 1, 1))], [bm('sandbag', 2, 4000)], mods),
        watcher.contentId);
      const base = run(false, {});
      const stacked = run(true, { runeFury: true });
      if (base === null || stacked === null) continue; // the pair rows already recorded the unobserved shape
      t8Staged++;
      push({
        family: 'gilding+progress-counters+duplicate-effect', tier: 'triple', members: [watcher.contentId, 'rune_fury'],
        verdict: base === stacked ? 'covered' : 'failed',
        evidence: `combat: first avenge fire at side-death ${base} plain vs ${stacked} gilded+Rune of Fury — stacked resolution multipliers must never advance progress`,
        comboKeys: [combinationKey(['gild', 'counter:avenge-progress', 'rune:multiplier'])],
        measurement: { base, variant: stacked, expectedFactor: 1 },
      });
    }
    if (t8Staged === 0) {
      blocked('gilding+progress-counters+duplicate-effect', 'triple', 'no-observable-emission',
        'no avenge candidate in the slice produced an observable ordinal on both legs');
    }
  }

  // ── totals ───────────────────────────────────────────────────────────────────────────────────────────────
  const familyTotals: InteractionSweepReport['familyTotals'] = {};
  const allFamilies: string[] = [...PAIR_FAMILIES, ...(opts.triples ? TRIPLE_FAMILIES : [])];
  for (const f of allFamilies) familyTotals[f] = { covered: 0, failed: 0, inapplicable: 0, blocked: 0 };
  for (const r of runs) {
    const row = familyTotals[r.family] ?? (familyTotals[r.family] = { covered: 0, failed: 0, inapplicable: 0, blocked: 0 });
    row[r.verdict] += 1;
  }
  const comboKeys = [...new Set(runs.flatMap((r) => r.comboKeys))].sort();
  return { runs, familyTotals, comboKeys, candidateCap: Number.isFinite(cap) ? cap : 0, includedTriples: !!opts.triples };
}

// ── coverage-table integrity (the sabotage surface: a doctored verdict must fail HERE) ───────────────────

/** A 'covered' run whose own measurement contradicts it — or a 'blocked' run with no reason — is a
 *  doctored/corrupt table. Empty = consistent. */
export function verifyInteractionTable(runs: readonly InteractionRun[]): string[] {
  const errors: string[] = [];
  for (const r of runs) {
    if (r.verdict === 'blocked' && !r.blockedReason) errors.push(`${r.family}: blocked with no reason (§4.3)`);
    if (r.verdict !== 'blocked' && r.blockedReason) errors.push(`${r.family}: verdict '${r.verdict}' carries a blocked reason`);
    if (!r.evidence.trim()) errors.push(`${r.family}: no evidence line`);
    if (r.measurement) {
      const consistent = r.measurement.variant === r.measurement.base * r.measurement.expectedFactor;
      if (r.verdict === 'covered' && !consistent) {
        errors.push(`${r.family} [${r.members.join('+')}]: verdict 'covered' but measurement ${r.measurement.base}→${r.measurement.variant} breaks the declared ×${r.measurement.expectedFactor}`);
      }
      if (r.verdict === 'failed' && consistent && r.family !== 'death-x-echo') {
        // death-x-echo may fail on the reorder probe with a consistent count measurement — allowed.
        errors.push(`${r.family} [${r.members.join('+')}]: verdict 'failed' but the measurement satisfies the declared relation`);
      }
    }
    if (r.verdict === 'covered' && r.comboKeys.length === 0) {
      errors.push(`${r.family}: covered run recorded no §10.5 combination key`);
    }
  }
  return errors;
}
