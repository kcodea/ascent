/**
 * BALANCE BOT B9 — THE OPERATOR PILOT: a `SeatPilot` that runs a hand-authored LINE OPERATOR one reducer-validated
 * action at a time, and hands everything it does not script to the strategist.
 *
 * Routing. On a seat's first decision the run's line is chosen exactly as the strategist chooses it
 * (`pickLineForRun` on the same inputs, so `lineOf` agrees with the wrapped strategist's own record); the line's
 * primary package routes to an operator (`ale` → Dwarf, `demonConsume` → Demon, `dragon` / `spellEngine` → Dragon,
 * `beastSummon` / `echo` → Beast) or to none (Ruby, Rally, Tempo, Economy have no operator yet — the strategist plays
 * them unchanged). `operator:<line>` pins a line regardless of fit (the per-hero measurement).
 *
 * The turn, re-derived from the LIVE state on every call (no plan is queued; the state after each accepted action
 * is the plan):
 *   0. a blocked run is answered — a Discover by the line's want table, a targeted Shout by the line's `aim`, the
 *      rest (Choose One, Runeforge, quest, power offer, scout) by the strategist's evaluator;
 *   1. the PIVOT rule: an operator that has fielded no engine piece by `PIVOT_WAVE` hands the run to the strategist
 *      for good (the study: a line whose key cards never show is a line to leave);
 *   2. the hero power, when the line knows what it is for;
 *   3. economy and Shop-buff spells (Gold first, the Shop buffed before buying);
 *   4. the TIER-UP when the line's curve says so — before buying, unless a core piece is on offer and both are not
 *      affordable;
 *   5. hand bodies fielded, engines first; on a full board the weakest keep-value body is sold to make the seat;
 *   6. the line's own FEED actions (Ales in order, a Chipper's Demons, a Vaultkeeper's Dragons);
 *   7. the remaining spells, targeted ones through the line's `spellTarget`;
 *   8. BUYS by appeal (want × 10, the pair / triple bonus, the early-body bonus), respecting what the line refuses
 *      to buy (Blart's meal) and the full-board rule (only a body that beats the worst seat);
 *   9. a FREEZE when a wanted piece is unaffordable; ROLLS while Gold can still buy (and the line's own roll
 *      budget — a Dwarf line spends every coin);
 *  10. the line's ARRANGEMENT (one move per call until the board matches), then the existing positioning pass
 *      (`positionCandidates` + the evaluator) restricted to moves that keep the line's pinned seats;
 *  11. the line's end-of-turn condition (a Demon line never ends on an empty Shop); then `null`.
 *
 * Every action is validated on a private clone (`createPlanningRoot` / `applyCandidate`) before it is returned; a
 * refused one is remembered for the turn and the procedure moves on. The pilot never reads hidden state: it works
 * from `toBotVisibleState` and the player-visible fields of the run.
 */
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { mixSeed, type Action, type RunState } from '../../../state';
import { applyCandidate, createPlanningRoot, release, visibleOf } from '../../../productionBots/transition';
import { fingerprint, toBotVisibleState } from '../../../productionBots/visibleState';
import { positionCandidates, heroPowerCandidates, type Candidate } from '../../../productionBots/legalActions';
import { evaluate } from '../../../productionBots/evaluate';
import type { BotCardView, BotOfferView, BotVisibleState } from '../../../productionBots/types';
import type { LineRecord, PilotBudget, SeatContext, SeatPilot } from '../../types';
import { pickLineForRun, type LineChoice } from '../lines';
import { createStrategistPilot, type StrategistOptions, type StrategistPilot } from '../strategistPilot';
import { DEMON_OPERATOR } from './demon';
import { DWARF_OPERATOR } from './dwarf';
import { DRAGON_OPERATOR } from './dragon';
import { BEAST_OPERATOR } from './beast';
import { CAST_ORDER, castableNow, isSpellCard, spellNeedsTarget, spellPolicyOf, type SpellKind } from './spells';
import { keepValue, offerAppeal, countHeld, stats, wantOf, PIVOT_WAVE, SELL_FILLER_WAVE, type LineOperator, type OperatorLine, type TurnMemory } from './types';

export const OPERATORS: Readonly<Record<OperatorLine, LineOperator>> = {
  demon: DEMON_OPERATOR,
  dwarf: DWARF_OPERATOR,
  dragon: DRAGON_OPERATOR,
  beast: BEAST_OPERATOR,
};

/** The adaptive pilot's commit order when several cores are on the board at once. */
const COMMIT_ORDER: readonly OperatorLine[] = ['dragon', 'demon', 'dwarf', 'beast'];

/** The operator a strategist package routes to, or null (no operator for that line yet). */
export function operatorForPackage(packageId: string): LineOperator | null {
  for (const op of Object.values(OPERATORS)) if (op.packages.includes(packageId)) return op;
  return null;
}

export interface OperatorOptions {
  /** Pin a line regardless of the run's fit ranking (`operator:<line>`). Absent = route by the strategist's line. */
  line?: OperatorLine;
  /** ADAPTIVE (`operator:adaptive`): commit to no line until a CORE engine piece of one of the four lines is
   *  fielded — until then play the UNION procedure (every line's core on sight, the shared tier curve, the best
   *  bodies) and commit to whichever engine the Shop delivers first. The measured reason: a fixed line assembles its
   *  engine by wave 5 in 15–43% of runs, and the runs that do are the ones that place. */
  adaptive?: boolean;
  /** Record label; defaults to `operator` / `operator:<line>`. */
  id?: string;
  /** Options for the wrapped strategist (its exploration is always 0 — the natural line). */
  strategist?: Omit<StrategistOptions, 'exploration' | 'id'>;
}

export interface OperatorTrace {
  round: number;
  decision: number;
  /** Which step of the procedure produced the action (`strategist` = delegated). */
  route: string;
  chosen: Action | null;
}

export interface OperatorLineRecord extends LineRecord {
  /** The operator that played the run: a line id, `none` (no operator for the line), or `pivoted` (handed to the
   *  strategist at `PIVOT_WAVE`). Additive on `LineRecord`. */
  operator: OperatorLine | 'none' | 'pivoted' | 'uncommitted';
}

export interface OperatorPilot extends SeatPilot {
  budget: PilotBudget;
  lineOf(seatId?: string): OperatorLineRecord | undefined;
  lastTrace(seatId?: string): OperatorTrace | undefined;
  /** The wrapped strategist (tests). */
  strategist: StrategistPilot;
}

interface SeatRoute {
  line: LineChoice;
  op: LineOperator | null;
  engineSeen: boolean;
  pivoted: boolean;
  /** Adaptive: still uncommitted (playing the union procedure). */
  uncommitted: boolean;
}

/** The action budget the skeleton allows itself per turn before it ends the turn (the runner's own guard is
 *  `maxActionsPerTurn`; this keeps the pilot below it and traces the reason). */
const SELF_ACTION_CAP = 48;

const newMemory = (wave: number): TurnMemory => ({ wave, rolls: 0, froze: false, usedPower: false, bought: new Set(), sold: new Set(), refused: new Set(), arranged: new Set(), orderedByLine: false, castOn: new Set() });

const isBody = (c: BotCardView): boolean => { const d = CARD_INDEX[c.cardId]; return !!d && !d.spell && !d.ruby; };
const fieldableHand = (v: BotVisibleState): BotCardView[] => v.hand.filter(isBody);

/** Would the engine accept this from `run`? Checked on a private clone — the live run is never touched. */
export function accepted(run: RunState, action: Action): boolean {
  const root = createPlanningRoot(run);
  try {
    const t = applyCandidate(root, action);
    release(t.child);
    return t.changed;
  } finally {
    release(root);
  }
}

export function operatorId(line?: OperatorLine, adaptive = false): string {
  return adaptive ? 'operator:adaptive' : line ? `operator:${line}` : 'operator';
}

/**
 * THE UNION operator the adaptive pilot plays before it commits: every line's role table merged at the MAX want
 * (so every core engine of every line is bought on sight), the shared tier curve, the union of engine ids, a
 * generic arrangement (Taunts and the smallest bodies forward, the biggest body last) and the biggest body as the
 * spell target. It fields no line-specific feed — there is no line yet.
 */
export function unionOperator(): LineOperator {
  const ops = Object.values(OPERATORS);
  const roles: Record<string, import('./types').CardRole> = {};
  for (const op of ops) for (const [id, r] of Object.entries(op.roles)) {
    const cur = roles[id];
    if (!cur || r.want > cur.want || (r.want === cur.want && r.core && !cur.core)) roles[id] = { ...r, ...(r.filler && cur && !cur.filler ? { filler: false } : {}) };
  }
  return {
    id: 'demon', // a placeholder id: the union never records itself (the route reports `uncommitted`)
    packages: [],
    tribe: 'demon',
    tierByWave: [undefined, undefined, 2, 4, 6, 8, 10],
    roles,
    engineIds: ops.flatMap((o) => o.engineIds),
    defaultWant: (cardId, v) => {
      const d = CARD_INDEX[cardId];
      if (!d || d.spell) return 0;
      return v.wave <= 4 ? 1 : 0;
    },
    feed: () => [],
    spellTarget: (v) => [...v.board].sort((a, b) => stats(b) - stats(a))[0] ?? null,
    aim: (v, _src, legal) => v.board.filter((c) => legal.includes(c.uid)).sort((a, b) => stats(b) - stats(a))[0]?.uid ?? legal[0] ?? null,
    slot: (c) => (c.keywords.includes('T') ? 1 : 5) - Math.min(4, stats(c) / 20),
    pinned: () => false,
  };
}

export function createOperatorPilot(budget: PilotBudget, seed: number, opts: OperatorOptions = {}): OperatorPilot {
  const id = opts.id ?? operatorId(opts.line, opts.adaptive);
  const union = opts.adaptive ? unionOperator() : null;
  const strategist = createStrategistPilot(budget, seed, { ...(opts.strategist ?? {}), exploration: 0, id });
  const routes = new Map<string, SeatRoute>();
  const mems = new Map<string, TurnMemory>();
  const traces = new Map<string, OperatorTrace>();
  const counters = new Map<string, number>();

  const routeFor = (run: RunState, seatId: string): SeatRoute => {
    const hit = routes.get(seatId);
    if (hit) return hit;
    const setId = run.setId ?? 'set2';
    const line = pickLineForRun(run.heroId, run.tribes, run.seed ^ seed, 0, setId);
    let op: LineOperator | null = union ?? (opts.line ? OPERATORS[opts.line] : operatorForPackage(line.primary));
    if (op && !union && !run.tribes.includes(op.tribe)) op = null; // a line the run cannot field is not operated
    const route: SeatRoute = { line, op, engineSeen: false, pivoted: false, uncommitted: !!union };
    routes.set(seatId, route);
    return route;
  };

  const memFor = (seatId: string, wave: number): TurnMemory => {
    const hit = mems.get(seatId);
    if (hit && hit.wave === wave) return hit;
    const m = newMemory(wave);
    mems.set(seatId, m);
    return m;
  };

  const decide = (run: RunState, ctx: SeatContext): Action | null => {
    if (run.phase !== 'recruit') return null;
    const seatId = ctx.seatId;
    const route = routeFor(run, seatId);
    const decision = (counters.get(seatId) ?? 0) + 1;
    counters.set(seatId, decision);
    const trace = (routeName: string, chosen: Action | null): Action | null => {
      traces.set(seatId, { round: run.wave, decision, route: routeName, chosen });
      return chosen;
    };
    const delegate = (why: string): Action | null => trace(`strategist:${why}`, strategist.decide(run, ctx));

    if (!route.op || route.pivoted) return delegate(route.op ? 'pivoted' : 'no-operator');
    const op = route.op;
    const mem = memFor(seatId, run.wave);
    const v = toBotVisibleState(run);
    const want = (cardId: string): number => wantOf(op, cardId, v);
    /** Validate on a clone; a refused action is remembered under `key` so the step is not retried this turn. */
    const tryAction = (routeName: string, action: Action, key?: string): Action | null => {
      if (key && mem.refused.has(key)) return null;
      if (!accepted(run, action)) { if (key) mem.refused.add(key); return null; }
      return trace(routeName, action);
    };
    // ── 0. a blocked run ─────────────────────────────────────────────────────────────────────────────────
    const m = v.mandatoryDecision;
    if (m) {
      if (m.kind === 'discover') {
        const ranked = m.options.map((cardId, index) => ({ index, cardId, score: discoverScore(op, cardId, v) })).sort((a, b) => b.score - a.score || a.index - b.index);
        for (const r of ranked) { const a = tryAction('discover', { type: 'discover', index: r.index }); if (a) return a; }
        return delegate('discover');
      }
      if (m.kind === 'battlecryTarget') {
        const src = [...v.board, ...v.hand].find((c) => c.uid === m.sourceUid);
        const spell = src && isSpellCard(src.cardId) ? op.spellTarget(v, src.cardId, mem) : null;
        const uid = spell && m.legalTargets.includes(spell.uid) ? spell.uid : op.aim(v, src?.cardId ?? '', m.legalTargets);
        if (uid) { const a = tryAction('aim', { type: 'battlecryTarget', targetUid: uid }); if (a) { if (spell) mem.castOn.add(uid); return a; } }
        return delegate('aim');
      }
      return delegate(m.kind);
    }

    // ── 1a. adaptive: commit to the first line whose CORE engine is on the board ───────────────────────
    if (route.uncommitted) {
      // Commit priority when two cores are fielded at once: the lines whose engines compound hardest first
      // (measured 2026-09-15: Dragon 6.1 / Demon 6.8 / Dwarf 7.2 / Beast 5.9 placement, but Beast's growth curve is
      // the flattest — its survivors grew through Rally payoffs the line does not own).
      const committed = COMMIT_ORDER.map((id) => OPERATORS[id]).find((o) => run.tribes.includes(o.tribe) && v.board.some((c) => o.roles[c.cardId]?.core));
      if (committed) { route.op = committed; route.uncommitted = false; route.line = { ...route.line, primary: committed.packages[0]! }; return decide(run, ctx); }
    }

    // ── 1. the pivot rule ────────────────────────────────────────────────────────────────────────────────
    if (v.board.some((c) => op.engineIds.includes(c.cardId))) route.engineSeen = true;
    if (!route.engineSeen && v.wave >= PIVOT_WAVE) { route.pivoted = true; return delegate('pivot'); }

    const turnActions = mem.bought.size + mem.sold.size + mem.rolls + mem.castOn.size + mem.arranged.size;
    if (turnActions > SELF_ACTION_CAP) return trace('cap', null);

    // ── 2. the hero power the line understands ─────────────────────────────────────────────────────────
    if (!mem.usedPower && op.heroPower) {
      const p = op.heroPower(v, run, mem);
      if (p) { const a = tryAction('heroPower', p, 'power'); if (a) { mem.usedPower = true; return a; } }
    }

    // ── 3. economy + Shop-buff spells first ─────────────────────────────────────────────────────────────
    const eco = castSpells(op, v, mem, run, ['economy', 'shopBuff'], tryAction);
    if (eco) return eco;

    // ── 4. the tier-up on the line's curve ─────────────────────────────────────────────────────────────
    const tier = v.economy.tier;
    const due = tier < 6 && v.wave >= (op.tierByWave[tier + 1] ?? Infinity);
    const gold = v.economy.gold;
    if (due && v.economy.upgradeCost <= gold) {
      // A core piece on offer that the tier-up would price out is bought first; the tier gets cheaper next wave.
      const core = v.shop.find((o) => !o.spell && !o.ruby && op.roles[o.cardId]?.core && o.cost <= gold && !(op.avoidBuying?.(o, v)));
      const priceOut = core && gold - v.economy.upgradeCost < core.cost && v.hand.length < 10;
      if (!priceOut) { const a = tryAction('upgrade', { type: 'upgrade' }, 'upgrade'); if (a) return a; }
    }

    // ── 5. field hand bodies (engines first); on a full board make the seat ────────────────────────────
    const bodies = fieldableHand(v).filter((c) => !mem.refused.has(`play:${c.uid}`)).sort((a, b) => want(b.cardId) - want(a.cardId) || stats(b) - stats(a));
    for (const c of bodies) {
      if (v.board.length < 7) {
        // An off-line filler is fielded only while the board is thin (it still fights) — never past the filler wave.
        if (want(c.cardId) === 0 && (v.wave >= SELL_FILLER_WAVE || v.board.length >= 5)) continue;
        const a = tryAction('field', { type: 'play', uid: c.uid, toIndex: v.board.length }, `play:${c.uid}`);
        if (a) return a;
        continue;
      }
      const sell = seatFor(op, v, mem, c);
      if (sell) { const a = tryAction('seat', sell, `sell:${(sell as { uid: string }).uid}`); if (a) { mem.sold.add(v.board.find((b) => b.uid === (sell as { uid: string }).uid)?.cardId ?? ''); return a; } }
    }

    // ── 6. the line's own feed ─────────────────────────────────────────────────────────────────────────
    for (const f of op.feed(v, run, mem)) {
      const key = f.type === 'play' ? `play:${f.uid}` : f.type === 'reposition' ? `seat:${f.uid}` : f.type === 'sell' ? `sell:${f.uid}` : JSON.stringify(f);
      const a = tryAction('feed', f, key);
      if (a) { if (f.type === 'sell') mem.sold.add(v.board.find((b) => b.uid === f.uid)?.cardId ?? ''); if (f.type === 'play' && f.targetUid) mem.castOn.add(f.targetUid); return a; }
    }

    // ── 7. the remaining spells ────────────────────────────────────────────────────────────────────────
    const rest = castSpells(op, v, mem, run, CAST_ORDER.filter((k) => k !== 'economy' && k !== 'shopBuff'), tryAction);
    if (rest) return rest;

    // ── 7b. Rubies (set-2 tokens) go on the line's spell body — never held ─────────────────────────────
    const ruby = v.hand.find((c) => CARD_INDEX[c.cardId]?.ruby && !mem.refused.has(`play:${c.uid}`));
    if (ruby) {
      const t = op.spellTarget(v, ruby.cardId, mem) ?? [...v.board].sort((a, b) => stats(b) - stats(a))[0];
      if (t) { const a = tryAction('cast:ruby', { type: 'play', uid: ruby.uid, targetUid: t.uid }, `play:${ruby.uid}`); if (a) return a; }
    }

    // ── 8. buys by appeal ──────────────────────────────────────────────────────────────────────────────
    const buy = bestBuy(op, v, mem);
    if (buy) { const a = tryAction('buy', { type: 'buy', uid: buy.uid }, `buy:${buy.uid}`); if (a) { mem.bought.add(buy.cardId); return a; } }

    // ── 9. freeze a wanted piece; roll while Gold can still buy ────────────────────────────────────────
    if (!mem.froze && !v.frozen && v.wave >= 3) {
      const wanted = v.shop.find((o) => !o.spell && !o.ruby && o.cost > gold && (want(o.cardId) >= 2 || countHeld(v, o.cardId) === 2) && !mem.sold.has(o.cardId));
      if (wanted) { const a = tryAction('freeze', { type: 'freeze' }, 'freeze'); if (a) { mem.froze = true; return a; } }
    }
    const roll = rollDecision(op, v, mem);
    if (roll) { const a = tryAction('roll', { type: 'roll' }, `roll:${mem.rolls}`); if (a) { mem.rolls += 1; return a; } }
    // Nothing wanted and no roll left: Gold does not carry, so a thin board takes the best BODY on offer (tempo),
    // and a full board trades a pure filler for a much bigger one.
    const tempo = tempoBuy(op, v, mem);
    if (tempo) { const a = tryAction('buy:tempo', { type: 'buy', uid: tempo.uid }, `buy:${tempo.uid}`); if (a) { mem.bought.add(tempo.cardId); return a; } }

    // ── 10. the line's arrangement, then the existing positioning pass within its pins ────────────────
    if (!mem.orderedByLine) {
      const move = lineArrangement(op, v);
      if (move) { const a = tryAction('arrange', move, `arrange:${move.uid}:${move.toIndex}`); if (a) return a; }
      mem.orderedByLine = true;
    }
    const generic = genericPosition(op, run, v, mem, budget, seed, decision);
    if (generic) return trace('position', generic);

    // A hero power the line does not script: the existing evaluator decides (once per turn).
    if (!mem.usedPower && !op.heroPower) {
      const p = evaluatedPower(run, v, mem, seed, decision);
      if (p) { mem.usedPower = true; return trace('power:evaluated', p); }
    }

    // ── 11. the line's end-of-turn condition; then end ────────────────────────────────────────────────
    const end = op.beforeEnd?.(v, run, mem);
    if (end) { const a = tryAction('beforeEnd', end, `end:${JSON.stringify(end)}`); if (a) { if (end.type === 'roll') mem.rolls += 1; return a; } }
    return trace('endTurn', null);
  };

  return {
    id,
    budget,
    decide,
    strategist,
    lineOf: (seatId = 'seat') => {
      const r = routes.get(seatId);
      if (!r) return undefined;
      return { primary: r.line.primary, ...(r.line.secondary ? { secondary: r.line.secondary } : {}), fitRank: r.line.fitRank, operator: r.pivoted ? 'pivoted' : r.uncommitted ? 'uncommitted' : (r.op?.id ?? 'none') };
    },
    lastTrace: (seatId = 'seat') => traces.get(seatId),
  };
}

// ───────────────────────────────────────────── the steps ─────────────────────────────────────────────

function discoverScore(op: LineOperator, cardId: string, v: BotVisibleState): number {
  const d = CARD_INDEX[cardId];
  if (!d) return -1;
  if (d.spell) { const p = spellPolicyOf(cardId); return p.kind === 'never' ? -1 : p.buy * 10 + 2; }
  const held = countHeld(v, cardId);
  return wantOf(op, cardId, v) * 10 + (held === 2 ? 25 : held === 1 ? 8 : 0) + (d.attack + d.health) / 10 + d.tier * 0.3;
}

/** What a card arriving from the hand / Shop is worth against a fielded one (the same scale as `keepValue`). */
function incomingValue(op: LineOperator, v: BotVisibleState, cardId: string, body: { attack: number; health: number; golden?: boolean }): number {
  return wantOf(op, cardId, v) * 10 + (op.roles[cardId]?.core ? 20 : 0) + (body.golden ? 30 : 0) + stats(body) / 4;
}

/** The weakest sellable board card and the margin an incoming card must beat it by — ONE rule, read by the field
 *  step (hand → board) and the buy step (Shop → hand → board) alike, so nothing is bought that will not be seated. */
function worstSeat(op: LineOperator, v: BotVisibleState, mem: TurnMemory): { uid: string; bar: number } | null {
  const candidates = v.board
    .filter((c) => !c.golden && !mem.bought.has(c.cardId) && !mem.refused.has(`sell:${c.uid}`))
    .map((c) => ({ c, keep: keepValue(op, c, v) }))
    .sort((a, b) => a.keep - b.keep);
  const worst = candidates[0];
  if (!worst) return null;
  // A pair partner is only sold for a strictly better piece; a filler past the filler wave goes for anything better.
  const margin = op.roles[worst.c.cardId]?.filler && v.wave >= SELL_FILLER_WAVE ? 0 : 4;
  return { uid: worst.c.uid, bar: worst.keep + margin };
}

/** The board card to sell so `incoming` can be fielded, or null when nothing on the board is worth less. */
function seatFor(op: LineOperator, v: BotVisibleState, mem: TurnMemory, incoming: BotCardView): Action | null {
  if (wantOf(op, incoming.cardId, v) === 0 && v.wave >= 4) return null;
  const seat = worstSeat(op, v, mem);
  if (!seat) return null;
  if (incomingValue(op, v, incoming.cardId, incoming) > seat.bar) return { type: 'sell', uid: seat.uid };
  return null;
}

type Try = (routeName: string, action: Action, key?: string) => Action | null;

/** Cast the hand's spells of the given kinds, in `CAST_ORDER`, targeted ones through the line. */
function castSpells(op: LineOperator, v: BotVisibleState, mem: TurnMemory, run: RunState, kinds: readonly SpellKind[], tryAction: Try): Action | null {
  void run;
  const spells = v.hand.filter((c) => isSpellCard(c.cardId) && !mem.refused.has(`play:${c.uid}`));
  for (const kind of kinds) {
    for (const c of spells) {
      const p = spellPolicyOf(c.cardId);
      if (p.kind !== kind || !castableNow(c.cardId, v)) continue;
      const def = CARD_INDEX[c.cardId]!;
      if (def.chooseOne?.length) {
        // The pick and the aim are mandatory follow-ups (Choose One → target → resolve).
        const a = tryAction(`cast:${kind}`, { type: 'play', uid: c.uid }, `play:${c.uid}`);
        if (a) return a;
        continue;
      }
      if (spellNeedsTarget(c.cardId)) {
        const t = op.spellTarget(v, c.cardId, mem) ?? (p.kind === 'trigger' ? v.board.find((b) => CARD_INDEX[b.cardId]?.effects.some((e) => e.on === 'onPlay')) ?? null : null);
        if (!t) continue;
        if (p.targetBelow !== undefined && stats(t) >= p.targetBelow) continue;
        const a = tryAction(`cast:${kind}`, { type: 'play', uid: c.uid, targetUid: t.uid }, `play:${c.uid}`);
        if (a) { mem.castOn.add(t.uid); return a; }
        continue;
      }
      const a = tryAction(`cast:${kind}`, { type: 'play', uid: c.uid }, `play:${c.uid}`);
      if (a) return a;
    }
  }
  return null;
}

/** The best affordable offer worth buying now, or null. */
function bestBuy(op: LineOperator, v: BotVisibleState, mem: TurnMemory): BotOfferView | null {
  const gold = v.economy.gold;
  if (v.hand.length >= 10) return null;
  const boardFull = v.board.length + fieldableHand(v).filter((c) => wantOf(op, c.cardId, v) >= 1).length >= 7;
  const seat = boardFull ? worstSeat(op, v, mem) : null;
  let best: { o: BotOfferView; score: number } | null = null;
  const consider = (o: BotOfferView, score: number): void => { if (o.cost <= gold && (!best || score > best.score)) best = { o, score }; };
  for (const o of v.shop) {
    if (o.spell || o.ruby) continue;
    if (mem.sold.has(o.cardId) || mem.refused.has(`buy:${o.uid}`)) continue;
    if (op.avoidBuying?.(o, v)) continue;
    const want = wantOf(op, o.cardId, v);
    const held = countHeld(v, o.cardId);
    const appeal = offerAppeal(op, o, v);
    if (held === 2) { consider(o, appeal + 100); continue; } // the triple, always
    if (boardFull) {
      // Only a piece the field step will actually SEAT (the same bar it reads), never a want-0.
      if (want < 2 || !seat) continue;
      if (incomingValue(op, v, o.cardId, o) <= seat.bar) continue;
      consider(o, appeal);
      continue;
    }
    // A thin board takes any on-line body early; from the filler wave it wants engines and pairs.
    const threshold = v.wave <= 3 ? 9 : v.wave < SELL_FILLER_WAVE ? 10 : 15;
    if (appeal >= threshold) consider(o, appeal);
  }
  // The Shop spell slot: by policy; the Dragon line buys any castable spell once its engine is fielded.
  const s = v.spellOffer;
  if (s && s.cost <= gold && !mem.refused.has(`buy:${s.uid}`)) {
    const p = spellPolicyOf(s.cardId);
    const dragonEngine = op.id === 'dragon' && v.board.some((c) => op.engineIds.includes(c.cardId));
    const spendable = gold - s.cost;
    // Leftover Gold (under a body's price) buys a castable spell rather than burning — a Growth on a 4-body board
    // is +4/+4 for 2 Gold.
    const leftover = gold < 3 && spendable >= 0;
    if (p.kind !== 'never' && (p.buy >= 2 || (dragonEngine && p.buy >= 1) || (p.buy >= 1 && leftover) || (p.kind === 'boardBuff' && leftover && v.board.length >= 3))) {
      const score = p.buy * 10 + (dragonEngine ? 12 : 0) + 1;
      if (!best || score > (best as { score: number }).score) best = { o: s, score };
    }
  }
  return best ? (best as { o: BotOfferView }).o : null;
}

/** The tempo fallback: with Gold that would otherwise burn, the best body on offer for a thin board (through the
 *  mid-game), or — on a full board — one that beats a pure filler by a wide margin. Never a want-0 past wave 8. */
function tempoBuy(op: LineOperator, v: BotVisibleState, mem: TurnMemory): BotOfferView | null {
  const gold = v.economy.gold;
  if (v.hand.length >= 10) return null;
  const offers = v.shop.filter((o) => !o.spell && !o.ruby && o.cost <= gold && !mem.sold.has(o.cardId) && !mem.refused.has(`buy:${o.uid}`) && !(op.avoidBuying?.(o, v)));
  if (offers.length === 0) return null;
  const rank = (o: BotOfferView): number => stats(o) + wantOf(op, o.cardId, v) * 4 + (o.tribe === op.tribe || o.tribe2 === op.tribe ? 2 : 0);
  const best = [...offers].sort((a, b) => rank(b) - rank(a))[0]!;
  const bodies = v.board.length + fieldableHand(v).length;
  if (bodies < 7) return v.wave <= 8 || wantOf(op, best.cardId, v) >= 1 ? best : null;
  // Full: only a seat the field step will actually clear, only for an on-line body, only from the filler wave.
  if (v.wave < SELL_FILLER_WAVE || wantOf(op, best.cardId, v) < 1) return null;
  const seat = worstSeat(op, v, mem);
  return seat && incomingValue(op, v, best.cardId, best) > seat.bar + 2 ? best : null;
}

function rollDecision(op: LineOperator, v: BotVisibleState, mem: TurnMemory): boolean {
  if (v.frozen) return false;
  const gold = v.economy.gold;
  const cost = v.economy.freeRolls > 0 ? 0 : v.economy.refreshCost;
  if (gold < cost) return false;
  // The line's own roll budget (a Dwarf line dumps its leftover Gold into its Gold-spent triggers).
  const lineBudget = op.rollBudget?.(v, mem) ?? 0;
  if (lineBudget >= cost && lineBudget > 0) return true;
  // Real players roll hard for the engine: the cap climbs with the wave and with an engine still missing.
  const engineMissing = !v.board.some((c) => op.engineIds.includes(c.cardId));
  const cap = v.wave <= 3 ? 1 : v.wave <= 6 ? (engineMissing ? 6 : 2) : engineMissing ? 7 : 5;
  if (mem.rolls >= cap) return false;
  // Somewhere to put a body — or, from the mid-game, the spell slot alone is worth the roll (a spell is cast, never
  // held; a Dragon line's whole growth is the spell count).
  const room = v.board.length < 7 || v.hand.length < 8 || v.wave >= 8;
  const spellHungry = op.id === 'dragon' && v.board.some((c) => op.engineIds.includes(c.cardId));
  return room && gold - cost >= (spellHungry ? 2 : 3);
}

/** One move toward the line's desired order (stable by `slot`, ties keep the current seat), or null when done. */
function lineArrangement(op: LineOperator, v: BotVisibleState): { type: 'reposition'; uid: string; toIndex: number } | null {
  const desired = v.board.map((c, i) => ({ c, i, slot: op.slot(c, v) })).sort((a, b) => a.slot - b.slot || a.i - b.i);
  for (let i = 0; i < desired.length; i++) {
    if (desired[i]!.c.uid !== v.board[i]!.uid) return { type: 'reposition', uid: desired[i]!.c.uid, toIndex: i };
  }
  return null;
}

/** The existing positioning pass — curated edge moves scored by the evaluator — restricted to moves that leave
 *  every pinned card in its seat. One improving move per call; arrangements seen this turn are never revisited. */
function genericPosition(op: LineOperator, run: RunState, v: BotVisibleState, mem: TurnMemory, budget: PilotBudget, seed: number, decision: number): Action | null {
  if (v.board.length < 2 || budget.positionCandidates <= 0) return null;
  const pinnedIdx = new Map<string, number>();
  v.board.forEach((c, i) => { if (op.pinned(c, v)) pinnedIdx.set(c.uid, i); });
  const keepsPins = (c: Candidate): boolean => {
    if (c.action.type !== 'reposition') return false;
    const order = v.board.map((x) => x.uid);
    const from = order.indexOf(c.action.uid);
    if (from < 0) return false;
    order.splice(from, 1);
    order.splice(c.action.toIndex, 0, c.action.uid);
    for (const [uid, i] of pinnedIdx) if (order[i] !== uid) return false;
    return true;
  };
  const cands = positionCandidates(v).filter(keepsPins).slice(0, budget.positionCandidates);
  if (cands.length === 0) return null;
  const rng = makeRng(mixSeed(seed ^ run.wave, decision, 0x0b9) >>> 0);
  const root = createPlanningRoot(run);
  try {
    const live = fingerprint(visibleOf(root));
    mem.arranged.add(live);
    const current = evaluate(visibleOf(root)).total;
    let best: { action: Action; utility: number; key: number } | null = null;
    for (const c of cands) {
      const t = applyCandidate(root, c.action);
      const ok = t.changed && !mem.arranged.has(t.fingerprint);
      const utility = ok ? evaluate(t.visible).total : -Infinity;
      release(t.child);
      if (!ok) continue;
      const key = rng.next();
      if (!best || utility > best.utility || (utility === best.utility && key < best.key)) best = { action: c.action, utility, key };
    }
    if (!best || best.utility <= current + 1e-9) return null;
    return best.action;
  } finally {
    release(root);
  }
}

/** A hero power the line does not script: every activation the generator enumerates, scored by the evaluator
 *  against doing nothing. */
function evaluatedPower(run: RunState, v: BotVisibleState, mem: TurnMemory, seed: number, decision: number): Action | null {
  const cands = heroPowerCandidates(v);
  if (cands.length === 0) return null;
  const rng = makeRng(mixSeed(seed ^ run.wave, decision, 0x0b8) >>> 0);
  const root = createPlanningRoot(run);
  try {
    const current = evaluate(visibleOf(root)).total;
    let best: { action: Action; utility: number; key: number } | null = null;
    for (const c of cands.slice(0, 12)) {
      const t = applyCandidate(root, c.action);
      // A power that reveals (a Discover) is taken on its static merit: the evaluator cannot read the future.
      const utility = t.changed ? (t.reveal ? current + 0.5 : evaluate(t.visible).total) : -Infinity;
      release(t.child);
      if (!t.changed) continue;
      const key = rng.next();
      if (!best || utility > best.utility || (utility === best.utility && key < best.key)) best = { action: c.action, utility, key };
    }
    void mem;
    if (!best || best.utility <= current + 1e-9) return null;
    return accepted(run, best.action) ? best.action : null;
  } finally {
    release(root);
  }
}
