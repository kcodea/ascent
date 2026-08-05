import { CARD_INDEX, contentRevision, revisionOf } from '@game/content';
import { createRun, isPlayerAction, runRecord, type Action, type BoardCard, type RunState } from './state';
import { reduce, upgradeCostOf } from './reducer';
import type { Replay } from './snapshot';

/**
 * THE RUN DERIVATION — every balance event stream, derived from a replay.
 *
 * The design decision behind this file (owner call 2026-08-05, answering the Codex telemetry spec): a run is
 * already a pure function of `(seed, heroId, action log, content)`, so we do NOT instrument the game to emit
 * telemetry. We replay the log through the real reducer and OBSERVE. That means:
 *  - Zero cost in the hot path — nothing here runs while anyone is playing.
 *  - Nothing is lossy by omission. A metric we didn't think of is one function away, computed retroactively
 *    over runs already banked, rather than a schema migration + a client release + a fresh collection window.
 *  - It cannot drift from the game: the numbers come from the same reducer that produced them.
 *
 * The counterpart obligation is `contentRevision`. A replay is only faithful against the content it was
 * played on (the 2026-08-04 batch moved 16 cards), so every derived run carries the revision it was derived
 * under and consumers must refuse to pool across revisions. See `content/src/revisions.ts`.
 *
 * SEMANTICS NOTE (Codex was right to flag this): the old report's `runs_bought` conflated "bought in a shop"
 * with "acquired at all". Everything here says ACQUIRED when it means any source, and BOUGHT only for a
 * tavern purchase — the three conversion rates below are separately named for the same reason.
 */

// ── Event rows ─────────────────────────────────────────────────────────────────────────────────────────────

/** One row per individual card copy offered in the tavern — the denominator of a true conversion rate. */
export interface OfferEvent {
  wave: number;
  /** Tavern slot (0-based, left to right); the always-offered spell slot is `'spell'`. */
  slot: number | 'spell';
  cardId: string;
  rev: string;
  /** Shop tier at the moment of the offer, and the card's own tier — a T1 in a T5 shop is a different offer. */
  shopTier: number;
  cardTier: number;
  cost: number;
  gold: number;
  maxGold: number;
  upgradeCost: number;
  resolve: number;
  boardSize: number;
  boardAttack: number;
  boardHealth: number;
  /** Did the player buy THIS copy (this uid) while it was on offer? */
  bought: boolean;
  /** Gold left immediately after that purchase (absent when not bought). */
  goldAfter?: number;
  frozen: boolean;
  /** The board's most common tribe when the offer was seen (build context for cohort comparisons). */
  topTribe: string;
}

/** One row per card that ENTERED the player's possession, however it got there. */
export interface AcquisitionEvent {
  cardId: string;
  rev: string;
  wave: number;
  /** How it arrived. `shop` = a tavern purchase; everything else is a grant of some kind. */
  source: 'shop' | 'discover' | 'quest' | 'rune' | 'heroPower' | 'henchman' | 'generated';
  goldPaid: number;
  /** Was it ever played onto the board, and when. */
  played: boolean;
  playedWave?: number;
  soldWave?: number;
  sellValue?: number;
  /** Did it survive to the run's final board? */
  finalBoard: boolean;
  golden: boolean;
}

/** One row per Gold movement, categorised. Derived by diffing the run's Gold across each action, so it is
 *  complete by construction — no source can forget to report. */
export interface GoldEvent {
  wave: number;
  amount: number; // negative = spent
  category: 'minion' | 'spell' | 'ruby' | 'refresh' | 'upgrade' | 'heroPower' | 'rune' | 'henchman' | 'sell' | 'income' | 'other';
  /** The card/effect responsible, when a card drove it. */
  sourceCard?: string;
  goldAfter: number;
  maxGoldAfter: number;
}

/** One row per turn where an upgrade was AVAILABLE — taken or declined. The aggressive-upgrade meta is a
 *  question about the declines as much as the takes, so both are rows. */
export interface UpgradeEvent {
  wave: number;
  fromTier: number;
  toTier: number;
  cost: number;
  taken: boolean;
  goldBefore: number;
  goldAfter: number;
  resolve: number;
  /** The previous combat's result — "do players tier up after losing?" */
  prevResult?: 'win' | 'loss' | 'draw';
  boardSize: number;
  boardAttack: number;
  boardHealth: number;
  cardsBoughtThisTurn: number;
}

/** One row per combat. */
export interface CombatEventSummary {
  wave: number;
  result: 'win' | 'loss' | 'draw';
  damage: number;
  attacks: number;
  friendlyDeaths: number;
  enemyDeaths: number;
  summons: number;
  spellCasts: number;
  /** Event count — a cheap proxy for how long the fight ran. */
  beats: number;
  boardSize: number;
  boardAttack: number;
  boardHealth: number;
  shopTier: number;
  /** Per-keyword trigger counts, keyed by the combat event vocabulary (rally, avenge, shield, …). */
  triggers: Record<string, number>;
}

/** One row per Avenge-style threshold engine that entered a combat — the "why did it fail" table. */
export interface TriggerDetail {
  wave: number;
  cardId: string;
  rev: string;
  keyword: 'avenge';
  threshold: number;
  /** Friendly deaths available to it this combat (its progress ceiling). */
  deathsAvailable: number;
  triggers: number;
  /** Did the engine itself die before it ever paid out? */
  diedBeforeTrigger: boolean;
  /** Why it produced nothing: not enough deaths, or it died first. Absent when it did trigger. */
  failure?: 'insufficientDeaths' | 'diedEarly';
}

/** A compact end-of-shop board snapshot — enough for build detection and pair analysis without a re-replay. */
export interface BoardSnapshotLite {
  wave: number;
  tier: number;
  cards: { id: string; rev: string; pos: number; attack: number; health: number; golden: boolean }[];
  totalAttack: number;
  totalHealth: number;
  goldSpentThisTurn: number;
}

/** Everything one run yields. Uploaded per run AND recomputable from the stored replay at any time. */
export interface DerivedRun {
  contentRevision: string;
  heroId: string;
  mode: string;
  seed: number;
  finalWave: number;
  wins: number;
  won: boolean;
  /** True when the replay could not be reproduced against this build's content (see `contentRevision`) —
   *  the run's rows are then partial and must not be pooled. */
  diverged: boolean;
  offers: OfferEvent[];
  acquisitions: AcquisitionEvent[];
  gold: GoldEvent[];
  upgrades: UpgradeEvent[];
  combats: CombatEventSummary[];
  triggers: TriggerDetail[];
  boards: BoardSnapshotLite[];
  /** Player decisions taken, for APM/engagement context. */
  playerActions: number;
}

// ── Derivation ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The observer's accumulating state. Deliberately PLAIN JSON (arrays + index records, no Maps or closures):
 * a lobby run is observed LIVE across a session the player can quit and resume, so this must survive a
 * round-trip through the save file — the same reason `TelemetryLog.seenShopUids` is an array.
 */
export interface DeriveState {
  offers: OfferEvent[];
  acquisitions: AcquisitionEvent[];
  gold: GoldEvent[];
  upgrades: UpgradeEvent[];
  combats: CombatEventSummary[];
  triggers: TriggerDetail[];
  boards: BoardSnapshotLite[];
  playerActions: number;
  /** shop-offer uid → index into `offers`, so a later BUY completes the row it belongs to. */
  offerIdx: Record<string, number>;
  /** card uid → index into `acquisitions`, so play/sell/final-board fill their fields in later. */
  acqIdx: Record<string, number>;
  boughtThisTurn: number;
  goldSpentThisTurn: number;
  lastResult?: 'win' | 'loss' | 'draw';
  diverged: boolean;
}

export const emptyDeriveState = (): DeriveState => ({
  offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [],
  playerActions: 0, offerIdx: {}, acqIdx: {}, boughtThisTurn: 0, goldSpentThisTurn: 0, diverged: false,
});

/**
 * The observer's accumulating state. Deliberately PLAIN JSON (arrays + index records, no Maps or closures):
 * a lobby run is observed LIVE across a session the player can quit and resume, so this must survive a
 * round-trip through the save file — the same reason `TelemetryLog.seenShopUids` is an array.
 */
export interface DeriveState {
  offers: OfferEvent[];
  acquisitions: AcquisitionEvent[];
  gold: GoldEvent[];
  upgrades: UpgradeEvent[];
  combats: CombatEventSummary[];
  triggers: TriggerDetail[];
  boards: BoardSnapshotLite[];
  playerActions: number;
  /** shop-offer uid → index into `offers`, so a later BUY completes the row it belongs to. */
  offerIdx: Record<string, number>;
  /** card uid → index into `acquisitions`, so play/sell/final-board fill their fields in later. */
  acqIdx: Record<string, number>;
  boughtThisTurn: number;
  goldSpentThisTurn: number;
  lastResult?: 'win' | 'loss' | 'draw';
  diverged: boolean;
}

export const emptyDeriveState = (): DeriveState => ({
  offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [],
  playerActions: 0, offerIdx: {}, acqIdx: {}, boughtThisTurn: 0, goldSpentThisTurn: 0, diverged: false,
});

const boardAttack = (b: readonly BoardCard[]): number => b.reduce((n, c) => n + c.attack, 0);
const boardHealth = (b: readonly BoardCard[]): number => b.reduce((n, c) => n + c.health, 0);

/** The board's most common tribe — build context, not a build CLASSIFICATION (that reads mechanics, later). */
function topTribe(board: readonly BoardCard[]): string {
  const counts = new Map<string, number>();
  for (const c of board) {
    const def = CARD_INDEX[c.cardId];
    for (const t of [def?.tribe, def?.tribe2]) {
      if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let best = 'none';
  let n = 0;
  for (const [t, c] of counts) if (c > n) { best = t; n = c; }
  return best;
}

/** Which spend category an action's Gold went to, and the card that drove it. */
function categorise(action: Action, before: RunState): { category: GoldEvent['category']; sourceCard?: string } {
  switch (action.type) {
    case 'buy': {
      const offer = before.shop?.find((o) => o.uid === action.uid) ?? (before.spell?.uid === action.uid ? before.spell : undefined);
      const def = offer ? CARD_INDEX[offer.cardId] : undefined;
      return { category: def?.ruby ? 'ruby' : def?.spell ? 'spell' : 'minion', sourceCard: offer?.cardId };
    }
    case 'roll': return { category: 'refresh' };
    case 'upgrade': return { category: 'upgrade' };
    case 'heroPower': return { category: 'heroPower', sourceCard: before.heroId };
    case 'buyRune':
    case 'rerollRuneforge': return { category: 'rune' };
    case 'buyHenchman': return { category: 'henchman' };
    case 'sell': {
      const card = before.board.find((c) => c.uid === action.uid) ?? before.hand.find((c) => c.uid === action.uid);
      return { category: 'sell', sourceCard: card?.cardId };
    }
    default: return { category: 'other' };
  }
}

/** Count combat-log events by type, plus the keyword triggers worth their own column. */
function summariseCombat(state: RunState, wave: number): CombatEventSummary | null {
  const lc = state.lastCombat;
  if (!lc) return null;
  const triggers: Record<string, number> = {};
  let attacks = 0;
  let friendlyDeaths = 0;
  let enemyDeaths = 0;
  let summons = 0;
  let spellCasts = 0;
  const playerUids = new Set((lc.initial?.player ?? []).map((m) => m.uid));
  for (const e of lc.events) {
    triggers[e.type] = (triggers[e.type] ?? 0) + 1;
    if (e.type === 'attack') attacks++;
    else if (e.type === 'summon') summons++;
    else if (e.type === 'sc') spellCasts++;
    else if (e.type === 'death') {
      // `initial.player` carries the uids the PLAYER took in; anything else died on the other side.
      if (playerUids.has((e as { target?: string }).target ?? '')) friendlyDeaths++;
      else enemyDeaths++;
    }
  }
  return {
    wave,
    result: lc.result === 'win' ? 'win' : lc.result === 'lose' ? 'loss' : 'draw',
    damage: lc.playerDamage,
    attacks, friendlyDeaths, enemyDeaths, summons, spellCasts,
    beats: lc.events.length,
    boardSize: (lc.initial?.player ?? []).length,
    boardAttack: (lc.initial?.player ?? []).reduce((n, m) => n + m.attack, 0),
    boardHealth: (lc.initial?.player ?? []).reduce((n, m) => n + m.health, 0),
    shopTier: state.tier,
    triggers,
  };
}

/** Avenge engines that entered this combat, and whether they paid — the "is Avenge too slow" table. */
function avengeDetails(state: RunState, wave: number, combat: CombatEventSummary | null): TriggerDetail[] {
  const lc = state.lastCombat;
  if (!lc || !combat) return [];
  const out: TriggerDetail[] = [];
  for (const m of lc.initial?.player ?? []) {
    const def = CARD_INDEX[m.cardId];
    const eff = def?.effects.find((e) => e.on === 'avenge');
    if (!eff) continue;
    const threshold = Math.max(1, Number((eff.params as { count?: number } | undefined)?.count ?? 4));
    // The engine's own death, and the deaths that happened BEFORE it — the two competing failure stories.
    const deathIdx = lc.events.findIndex((e) => e.type === 'death' && (e as { target?: string }).target === m.uid);
    const died = deathIdx >= 0;
    const playerUids = new Set((lc.initial?.player ?? []).map((x) => x.uid));
    let deathsAvailable = 0;
    lc.events.forEach((e, i) => {
      if (e.type !== 'death') return;
      if (died && i > deathIdx) return; // after it died, further deaths could never have fed it
      if (playerUids.has((e as { target?: string }).target ?? '')) deathsAvailable++;
    });
    const triggers = Math.floor(deathsAvailable / threshold);
    out.push({
      wave, cardId: m.cardId, rev: revisionOf(m.cardId), keyword: 'avenge', threshold,
      deathsAvailable, triggers, diedBeforeTrigger: died && triggers === 0,
      failure: triggers > 0 ? undefined : died ? 'diedEarly' : 'insufficientDeaths',
    });
  }
  return out;
}

/**
 * Replay a finished run and derive every event stream from it.
 *
 * Never throws: telemetry must not be able to break a run-end. A replay that no longer reproduces (content
 * moved under it) stops early and is returned with `diverged: true` rather than half-silently pretending.
 */
/** Record the tavern as it stands right now; each offer uid is recorded once, on first sighting. */
function recordOffers(st: DeriveState, s: RunState): void {
  const ctx = {
    wave: s.wave, shopTier: s.tier, gold: s.embers, maxGold: s.maxEmbers,
    upgradeCost: upgradeCostOf(s), resolve: s.resolve,
    boardSize: s.board.length, boardAttack: boardAttack(s.board), boardHealth: boardHealth(s.board),
    topTribe: topTribe(s.board),
  };
  const seen: [string, string, number | 'spell'][] = [];
  (s.shop ?? []).forEach((o, i) => { if (o.uid && o.cardId) seen.push([o.uid, o.cardId, i]); });
  if (s.spell?.uid && s.spell.cardId) seen.push([s.spell.uid, s.spell.cardId, 'spell']);
  for (const [uid, cardId, slot] of seen) {
    if (st.offerIdx[uid] !== undefined) continue;
    const def = CARD_INDEX[cardId];
    st.offerIdx[uid] = st.offers.length;
    st.offers.push({
      ...ctx, slot, cardId, rev: revisionOf(cardId), cardTier: def?.tier ?? 0,
      cost: def?.cost ?? 3, bought: false, frozen: !!s.frozen,
    });
  }
}

/** A card entered the player's possession. */
function recordAcquisition(st: DeriveState, card: BoardCard, wave: number, source: AcquisitionEvent['source'], goldPaid: number): void {
  if (st.acqIdx[card.uid] !== undefined) return;
  st.acqIdx[card.uid] = st.acquisitions.length;
  st.acquisitions.push({
    cardId: card.cardId, rev: revisionOf(card.cardId), wave, source, goldPaid,
    played: false, finalBoard: false, golden: card.golden,
  });
}

/** Anything new in hand/board we have not already attributed is a GENERATED card (a token, a conjure, a
 *  quest/rune reward, a copy) — the class the old report had no name for at all. */
function sweepGenerated(st: DeriveState, s: RunState): void {
  for (const c of [...s.hand, ...s.board]) {
    if (st.acqIdx[c.uid] === undefined) recordAcquisition(st, c, s.wave, 'generated', 0);
  }
}

/** Prime the observer against a run's STARTING state (the offers visible before the first action). */
export function beginDerive(s: RunState): DeriveState {
  const st = emptyDeriveState();
  recordOffers(st, s);
  sweepGenerated(st, s);
  return st;
}

/**
 * Fold ONE dispatched action into the derivation — the single observation point, shared by both feeds.
 *
 * Shaped as `(before, action, after)` rather than as a replay loop because a LOBBY replay is not guaranteed
 * faithful (the same reason `saveRunBoards` refuses to replay one, and the reason `recordTelemetryAction`
 * had to exist at all). So a lobby run is observed LIVE from the real dispatch while a course run can be
 * derived from its replay afterwards — ONE implementation either way, which is the point: the existing
 * reconstruct/live pair has to be kept "in step" by hand, and a third copy of that hazard is not worth
 * having.
 */
export function observeAction(st: DeriveState, before: RunState, action: Action, after: RunState): DeriveState {
  if (after === before) { recordOffers(st, before); return st; } // rejected — but the player still saw the shop
  if (isPlayerAction(action)) st.playerActions++;

  // ── Gold ledger: diff, then attribute by what the player did.
  const delta = after.embers - before.embers;
  if (delta !== 0) {
    const { category, sourceCard } = categorise(action, before);
    st.gold.push({
      wave: before.wave, amount: delta,
      // A Gold GAIN on a spend action is income the action happened to trigger (a sell, a payout), so the
      // sign decides between the two rather than the action name alone.
      category: delta > 0 && category !== 'sell' ? 'income' : category,
      sourceCard, goldAfter: after.embers, maxGoldAfter: after.maxEmbers,
    });
    if (delta < 0) st.goldSpentThisTurn += -delta;
  }

  // ── Upgrade taken.
  if (action.type === 'upgrade') {
    st.upgrades.push({
      wave: before.wave, fromTier: before.tier, toTier: after.tier, cost: upgradeCostOf(before), taken: true,
      goldBefore: before.embers, goldAfter: after.embers, resolve: before.resolve, prevResult: st.lastResult,
      boardSize: before.board.length, boardAttack: boardAttack(before.board), boardHealth: boardHealth(before.board),
      cardsBoughtThisTurn: st.boughtThisTurn,
    });
  }

  // ── Acquisitions by explicit source.
  if (action.type === 'buy') {
    const offer = before.shop?.find((o) => o.uid === action.uid) ?? (before.spell?.uid === action.uid ? before.spell : undefined);
    const idx = st.offerIdx[action.uid];
    const row = idx === undefined ? undefined : st.offers[idx];
    if (row) { row.bought = true; row.goldAfter = after.embers; }
    const had = new Set([...before.hand, ...before.board].map((c) => c.uid));
    const got = [...after.hand, ...after.board].find((c) => !had.has(c.uid) && c.cardId === offer?.cardId);
    if (got) recordAcquisition(st, got, before.wave, 'shop', before.embers - after.embers);
    st.boughtThisTurn++;
  } else if (action.type === 'discover' || action.type === 'buyQuest' || action.type === 'buyRune' || action.type === 'buyHenchman' || action.type === 'heroPower') {
    const src: AcquisitionEvent['source'] =
      action.type === 'discover' ? 'discover' : action.type === 'buyQuest' ? 'quest'
      : action.type === 'buyRune' ? 'rune' : action.type === 'buyHenchman' ? 'henchman' : 'heroPower';
    const had = new Set([...before.hand, ...before.board].map((c) => c.uid));
    for (const c of [...after.hand, ...after.board]) {
      if (!had.has(c.uid)) recordAcquisition(st, c, before.wave, src, Math.max(0, before.embers - after.embers));
    }
  } else if (action.type === 'play') {
    const row = st.acquisitions[st.acqIdx[action.uid] ?? -1];
    if (row && !row.played) { row.played = true; row.playedWave = before.wave; }
  } else if (action.type === 'sell') {
    const row = st.acquisitions[st.acqIdx[action.uid] ?? -1];
    if (row) { row.soldWave = before.wave; row.sellValue = Math.max(0, after.embers - before.embers); }
  }

  // ── Combat.
  if (action.type === 'resolveCombat' || action.type === 'settleCombat') {
    const summary = summariseCombat(after, before.wave);
    if (summary && !st.combats.some((c) => c.wave === summary.wave)) {
      st.combats.push(summary);
      st.triggers.push(...avengeDetails(after, before.wave, summary));
      st.lastResult = summary.result;
    }
  }

  // ── Turn boundary: snapshot the board, log a DECLINED upgrade, reset the per-turn counters.
  if (after.wave !== before.wave) {
    const cost = upgradeCostOf(before);
    if (before.tier < 7 && cost > 0 && before.embers >= cost && !st.upgrades.some((u) => u.wave === before.wave && u.taken)) {
      st.upgrades.push({
        wave: before.wave, fromTier: before.tier, toTier: before.tier + 1, cost, taken: false,
        goldBefore: before.embers, goldAfter: before.embers, resolve: before.resolve, prevResult: st.lastResult,
        boardSize: before.board.length, boardAttack: boardAttack(before.board), boardHealth: boardHealth(before.board),
        cardsBoughtThisTurn: st.boughtThisTurn,
      });
    }
    st.boards.push({
      wave: before.wave, tier: before.tier,
      cards: before.board.map((c, i) => ({ id: c.cardId, rev: revisionOf(c.cardId), pos: i, attack: c.attack, health: c.health, golden: c.golden })),
      totalAttack: boardAttack(before.board), totalHealth: boardHealth(before.board),
      goldSpentThisTurn: st.goldSpentThisTurn,
    });
    st.boughtThisTurn = 0;
    st.goldSpentThisTurn = 0;
  }

  recordOffers(st, after);
  sweepGenerated(st, after);
  return st;
}

/** Close the derivation against the run's final state. `won` is an override for LOBBY runs, which never
 *  reach phase 'victory' — a lobby win is placement 1, which only the caller knows. */
export function finishDerive(st: DeriveState, final: RunState, meta: { heroId: string; mode?: string; seed: number; won?: boolean }): DerivedRun {
  for (const c of final.board) {
    const row = st.acquisitions[st.acqIdx[c.uid] ?? -1];
    if (row) row.finalBoard = true;
  }
  return {
    contentRevision: contentRevision(),
    heroId: meta.heroId,
    mode: meta.mode ?? 'ascent',
    seed: meta.seed,
    finalWave: final.wave,
    wins: runRecord(final).wins, // SCORED wins — runRecord excludes the calibration rounds, as the report must
    won: meta.won ?? final.phase === 'victory',
    diverged: st.diverged,
    offers: st.offers, acquisitions: st.acquisitions, gold: st.gold, upgrades: st.upgrades,
    combats: st.combats, triggers: st.triggers, boards: st.boards, playerActions: st.playerActions,
  };
}

/**
 * Derive a finished run from its REPLAY — for course runs and any log we trust to reproduce. A lobby run
 * should be observed live instead (see `observeAction`). Never throws: telemetry must not be able to break a
 * run-end, so a log that no longer applies stops early and returns `diverged: true`.
 */
/** Record the tavern as it stands right now; each offer uid is recorded once, on first sighting. */
function recordOffers(st: DeriveState, s: RunState): void {
  const ctx = {
    wave: s.wave, shopTier: s.tier, gold: s.embers, maxGold: s.maxEmbers,
    upgradeCost: upgradeCostOf(s), resolve: s.resolve,
    boardSize: s.board.length, boardAttack: boardAttack(s.board), boardHealth: boardHealth(s.board),
    topTribe: topTribe(s.board),
  };
  const seen: [string, string, number | 'spell'][] = [];
  (s.shop ?? []).forEach((o, i) => { if (o.uid && o.cardId) seen.push([o.uid, o.cardId, i]); });
  if (s.spell?.uid && s.spell.cardId) seen.push([s.spell.uid, s.spell.cardId, 'spell']);
  for (const [uid, cardId, slot] of seen) {
    if (st.offerIdx[uid] !== undefined) continue;
    const def = CARD_INDEX[cardId];
    st.offerIdx[uid] = st.offers.length;
    st.offers.push({
      ...ctx, slot, cardId, rev: revisionOf(cardId), cardTier: def?.tier ?? 0,
      cost: def?.cost ?? 3, bought: false, frozen: !!s.frozen,
    });
  }
}

/** A card entered the player's possession. */
function recordAcquisition(st: DeriveState, card: BoardCard, wave: number, source: AcquisitionEvent['source'], goldPaid: number): void {
  if (st.acqIdx[card.uid] !== undefined) return;
  st.acqIdx[card.uid] = st.acquisitions.length;
  st.acquisitions.push({
    cardId: card.cardId, rev: revisionOf(card.cardId), wave, source, goldPaid,
    played: false, finalBoard: false, golden: card.golden,
  });
}

/** Anything new in hand/board we have not already attributed is a GENERATED card (a token, a conjure, a
 *  quest/rune reward, a copy) — the class the old report had no name for at all. */
function sweepGenerated(st: DeriveState, s: RunState): void {
  for (const c of [...s.hand, ...s.board]) {
    if (st.acqIdx[c.uid] === undefined) recordAcquisition(st, c, s.wave, 'generated', 0);
  }
}

/** Prime the observer against a run's STARTING state (the offers visible before the first action). */
export function beginDerive(s: RunState): DeriveState {
  const st = emptyDeriveState();
  recordOffers(st, s);
  sweepGenerated(st, s);
  return st;
}

/**
 * Fold ONE dispatched action into the derivation — the single observation point, shared by both feeds.
 *
 * Shaped as `(before, action, after)` rather than as a replay loop because a LOBBY replay is not guaranteed
 * faithful (the same reason `saveRunBoards` refuses to replay one, and the reason `recordTelemetryAction`
 * had to exist at all). So a lobby run is observed LIVE from the real dispatch while a course run can be
 * derived from its replay afterwards — ONE implementation either way, which is the point: the existing
 * reconstruct/live pair has to be kept "in step" by hand, and a third copy of that hazard is not worth
 * having.
 */
export function observeAction(st: DeriveState, before: RunState, action: Action, after: RunState): DeriveState {
  if (after === before) { recordOffers(st, before); return st; } // rejected — but the player still saw the shop
  if (isPlayerAction(action)) st.playerActions++;

  // ── Gold ledger: diff, then attribute by what the player did.
  const delta = after.embers - before.embers;
  if (delta !== 0) {
    const { category, sourceCard } = categorise(action, before);
    st.gold.push({
      wave: before.wave, amount: delta,
      // A Gold GAIN on a spend action is income the action happened to trigger (a sell, a payout), so the
      // sign decides between the two rather than the action name alone.
      category: delta > 0 && category !== 'sell' ? 'income' : category,
      sourceCard, goldAfter: after.embers, maxGoldAfter: after.maxEmbers,
    });
    if (delta < 0) st.goldSpentThisTurn += -delta;
  }

  // ── Upgrade taken.
  if (action.type === 'upgrade') {
    st.upgrades.push({
      wave: before.wave, fromTier: before.tier, toTier: after.tier, cost: upgradeCostOf(before), taken: true,
      goldBefore: before.embers, goldAfter: after.embers, resolve: before.resolve, prevResult: st.lastResult,
      boardSize: before.board.length, boardAttack: boardAttack(before.board), boardHealth: boardHealth(before.board),
      cardsBoughtThisTurn: st.boughtThisTurn,
    });
  }

  // ── Acquisitions by explicit source.
  if (action.type === 'buy') {
    const offer = before.shop?.find((o) => o.uid === action.uid) ?? (before.spell?.uid === action.uid ? before.spell : undefined);
    const idx = st.offerIdx[action.uid];
    const row = idx === undefined ? undefined : st.offers[idx];
    if (row) { row.bought = true; row.goldAfter = after.embers; }
    const had = new Set([...before.hand, ...before.board].map((c) => c.uid));
    const got = [...after.hand, ...after.board].find((c) => !had.has(c.uid) && c.cardId === offer?.cardId);
    if (got) recordAcquisition(st, got, before.wave, 'shop', before.embers - after.embers);
    st.boughtThisTurn++;
  } else if (action.type === 'discover' || action.type === 'buyQuest' || action.type === 'buyRune' || action.type === 'buyHenchman' || action.type === 'heroPower') {
    const src: AcquisitionEvent['source'] =
      action.type === 'discover' ? 'discover' : action.type === 'buyQuest' ? 'quest'
      : action.type === 'buyRune' ? 'rune' : action.type === 'buyHenchman' ? 'henchman' : 'heroPower';
    const had = new Set([...before.hand, ...before.board].map((c) => c.uid));
    for (const c of [...after.hand, ...after.board]) {
      if (!had.has(c.uid)) recordAcquisition(st, c, before.wave, src, Math.max(0, before.embers - after.embers));
    }
  } else if (action.type === 'play') {
    const row = st.acquisitions[st.acqIdx[action.uid] ?? -1];
    if (row && !row.played) { row.played = true; row.playedWave = before.wave; }
  } else if (action.type === 'sell') {
    const row = st.acquisitions[st.acqIdx[action.uid] ?? -1];
    if (row) { row.soldWave = before.wave; row.sellValue = Math.max(0, after.embers - before.embers); }
  }

  // ── Combat.
  if (action.type === 'resolveCombat' || action.type === 'settleCombat') {
    const summary = summariseCombat(after, before.wave);
    if (summary && !st.combats.some((c) => c.wave === summary.wave)) {
      st.combats.push(summary);
      st.triggers.push(...avengeDetails(after, before.wave, summary));
      st.lastResult = summary.result;
    }
  }

  // ── Turn boundary: snapshot the board, log a DECLINED upgrade, reset the per-turn counters.
  if (after.wave !== before.wave) {
    const cost = upgradeCostOf(before);
    if (before.tier < 7 && cost > 0 && before.embers >= cost && !st.upgrades.some((u) => u.wave === before.wave && u.taken)) {
      st.upgrades.push({
        wave: before.wave, fromTier: before.tier, toTier: before.tier + 1, cost, taken: false,
        goldBefore: before.embers, goldAfter: before.embers, resolve: before.resolve, prevResult: st.lastResult,
        boardSize: before.board.length, boardAttack: boardAttack(before.board), boardHealth: boardHealth(before.board),
        cardsBoughtThisTurn: st.boughtThisTurn,
      });
    }
    st.boards.push({
      wave: before.wave, tier: before.tier,
      cards: before.board.map((c, i) => ({ id: c.cardId, rev: revisionOf(c.cardId), pos: i, attack: c.attack, health: c.health, golden: c.golden })),
      totalAttack: boardAttack(before.board), totalHealth: boardHealth(before.board),
      goldSpentThisTurn: st.goldSpentThisTurn,
    });
    st.boughtThisTurn = 0;
    st.goldSpentThisTurn = 0;
  }

  recordOffers(st, after);
  sweepGenerated(st, after);
  return st;
}

/** Close the derivation against the run's final state. `won` is an override for LOBBY runs, which never
 *  reach phase 'victory' — a lobby win is placement 1, which only the caller knows. */
export function finishDerive(st: DeriveState, final: RunState, meta: { heroId: string; mode?: string; seed: number; won?: boolean }): DerivedRun {
  for (const c of final.board) {
    const row = st.acquisitions[st.acqIdx[c.uid] ?? -1];
    if (row) row.finalBoard = true;
  }
  return {
    contentRevision: contentRevision(),
    heroId: meta.heroId,
    mode: meta.mode ?? 'ascent',
    seed: meta.seed,
    finalWave: final.wave,
    wins: runRecord(final).wins, // SCORED wins — runRecord excludes the calibration rounds, as the report must
    won: meta.won ?? final.phase === 'victory',
    diverged: st.diverged,
    offers: st.offers, acquisitions: st.acquisitions, gold: st.gold, upgrades: st.upgrades,
    combats: st.combats, triggers: st.triggers, boards: st.boards, playerActions: st.playerActions,
  };
}

/**
 * Derive a finished run from its REPLAY — for course runs and any log we trust to reproduce. A lobby run
 * should be observed live instead (see `observeAction`). Never throws: telemetry must not be able to break a
 * run-end, so a log that no longer applies stops early and returns `diverged: true`.
 */
export function deriveRun(replay: Replay, initial?: RunState): DerivedRun {
  let s = initial ?? createRun(replay.seed, replay.heroId, replay.mode);
  const st = beginDerive(s);
  for (const action of replay.actions) {
    let after: RunState;
    try {
      after = reduce(s, action);
    } catch {
      st.diverged = true; // the log no longer applies to this build's content
      break;
    }
    observeAction(st, s, action, after);
    s = after;
  }
  return finishDerive(st, s, { heroId: replay.heroId, mode: replay.mode, seed: replay.seed });
}

// ── Aggregation: the three conversion rates, separately named ──────────────────────────────────────────────

/** Per-card demand, with the three DIFFERENT rates Codex asked to stop conflating. */
export interface CardDemand {
  cardId: string;
  rev: string;
  /** Individual copies offered in a tavern, and how many of those individual copies were bought. */
  copiesOffered: number;
  copiesBought: number;
  /** copiesBought / copiesOffered — the TRUE conversion rate. */
  copyConversion: number | null;
  /** Shops that contained ≥1 copy, and how many of those shops produced ≥1 purchase of it. */
  shopsWithCard: number;
  shopsConverted: number;
  shopConversion: number | null;
  /** Runs that were offered it at all, and how many of those runs ACQUIRED it (any source — hence the name:
   *  the old `runs_bought` said "bought" while counting this). */
  runsOffered: number;
  runsAcquired: number;
  runAcquisitionRate: number | null;
  /** Mean copies bought per shop appearance. */
  copiesPerShopAppearance: number | null;
  /** Acquisitions split by where they came from. */
  bySource: Record<AcquisitionEvent['source'], number>;
  /** Total acquisitions — the sample size every performance claim must be shown beside. */
  acquisitions: number;
  playRate: number | null;
  finalBoardRate: number | null;
  avgAcquiredWave: number | null;
}

/** Aggregate per-card demand across derived runs. Rows are keyed by cardId+revision — never pooled across
 *  revisions, which is the whole point of stamping them. */
export function cardDemand(runs: DerivedRun[]): CardDemand[] {
  interface Acc extends Omit<CardDemand, 'copyConversion' | 'shopConversion' | 'runAcquisitionRate' | 'copiesPerShopAppearance' | 'playRate' | 'finalBoardRate' | 'avgAcquiredWave'> {
    played: number; finalBoard: number; waveSum: number;
  }
  const acc = new Map<string, Acc>();
  const key = (id: string, rev: string): string => `${id}@${rev}`;
  const get = (id: string, rev: string): Acc => {
    const k = key(id, rev);
    let a = acc.get(k);
    if (!a) {
      a = {
        cardId: id, rev, copiesOffered: 0, copiesBought: 0, shopsWithCard: 0, shopsConverted: 0,
        runsOffered: 0, runsAcquired: 0, acquisitions: 0,
        bySource: { shop: 0, discover: 0, quest: 0, rune: 0, heroPower: 0, henchman: 0, generated: 0 },
        played: 0, finalBoard: 0, waveSum: 0,
      };
      acc.set(k, a);
    }
    return a;
  };

  for (const run of runs) {
    if (run.diverged) continue; // a partial run would bias every rate it touches
    // "Shop" here = one wave's tavern; a card seen twice in one wave's shop is one shop appearance.
    const shopsWith = new Map<string, Set<number>>();
    const shopsConv = new Map<string, Set<number>>();
    for (const o of run.offers) {
      const a = get(o.cardId, o.rev);
      a.copiesOffered++;
      if (o.bought) a.copiesBought++;
      const k = key(o.cardId, o.rev);
      (shopsWith.get(k) ?? shopsWith.set(k, new Set()).get(k)!).add(o.wave);
      if (o.bought) (shopsConv.get(k) ?? shopsConv.set(k, new Set()).get(k)!).add(o.wave);
    }
    for (const [k, waves] of shopsWith) {
      const a = acc.get(k)!;
      a.shopsWithCard += waves.size;
      a.runsOffered++;
      a.shopsConverted += shopsConv.get(k)?.size ?? 0;
    }
    const acquiredKeys = new Set<string>();
    for (const q of run.acquisitions) {
      const a = get(q.cardId, q.rev);
      a.acquisitions++;
      a.bySource[q.source]++;
      a.waveSum += q.wave;
      if (q.played) a.played++;
      if (q.finalBoard) a.finalBoard++;
      acquiredKeys.add(key(q.cardId, q.rev));
    }
    for (const k of acquiredKeys) acc.get(k)!.runsAcquired++;
  }

  const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
  return [...acc.values()].map((a) => ({
    cardId: a.cardId, rev: a.rev,
    copiesOffered: a.copiesOffered, copiesBought: a.copiesBought,
    copyConversion: rate(a.copiesBought, a.copiesOffered),
    shopsWithCard: a.shopsWithCard, shopsConverted: a.shopsConverted,
    shopConversion: rate(a.shopsConverted, a.shopsWithCard),
    runsOffered: a.runsOffered, runsAcquired: a.runsAcquired,
    runAcquisitionRate: rate(a.runsAcquired, a.runsOffered),
    copiesPerShopAppearance: rate(a.copiesBought, a.shopsWithCard),
    bySource: a.bySource, acquisitions: a.acquisitions,
    playRate: rate(a.played, a.acquisitions),
    finalBoardRate: rate(a.finalBoard, a.acquisitions),
    avgAcquiredWave: rate(a.waveSum, a.acquisitions),
  }));
}

/** A Wilson score interval — the honest error bar for a rate at small N (a plain ± sqrt(p(1-p)/n) is
 *  nonsense at the sample sizes a friend-scale player base produces). `z` defaults to 95%. */
export function wilson(successes: number, total: number, z = 1.96): { lo: number; hi: number } | null {
  if (total <= 0) return null;
  const p = successes / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return { lo: Math.max(0, (centre - spread) / d), hi: Math.min(1, (centre + spread) / d) };
}

/** The sample-size gates a claim must clear before it may be shown as a finding (Codex's thresholds). */
export const SAMPLE_GATES = { conversion: 50, preliminary: 20, actionable: 50, confident: 100 } as const;
