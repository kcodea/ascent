import { combatSide, makeRng, simulate, type BoardMinion, type CombatSideState } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { buildEnemyBoard, THREAT_IDS } from '../threats';
import { OPPONENT_POOL, opponentBoard } from '../opponents';
import { sideFromSnapshot } from '../boardSide';
import type { BoardSnapshot } from '../snapshot';
import type { BotVisibleState } from './types';
import { scoutedPanel, type PanelEntry, type SeatScout } from './scout';

/**
 * SCORE A BOARD BY FIGHTING WITH IT.
 *
 * Every hand-written proxy in `evaluate.ts` — stat sums, a keyword value table, a board-width curve — is an
 * attempt to guess the answer to one question: *does this board win?* The engine can answer that question
 * directly, and the measurement says it is cheap enough to just ask:
 *
 *     one full combat   0.017 ms
 *     one reduce()      0.047 ms   ← a single search node already costs 2.7× a fight
 *
 * So a board is scored by playing it against a panel of wave-appropriate opponents and reading the result.
 *
 * B3 REPAIR (balance roadmap, 2026-09-15). Three discrepancies with the real fight were closed:
 *
 *  1. THE FRIENDLY SIDE IS PREPARED THE WAY `faceOmen` PREPARES IT. The bodies used to be reduced to
 *     `{cardId, attack, health, keywords, golden}` and the side to `combatSide({ tier })`. Now `v.friendly`
 *     (built by `combatContext.ts`, mirroring the reducer) carries per-instance state, the banked Start-of-Combat
 *     payouts, and every run-level scaler — spell power, Ruby casts, the Reveler value, spell history, auras,
 *     fodder, hand minions, quest mods — so a Grim, a Kennelmaster, a Guel or a Rope Wrangler is scored at the
 *     value it will actually fight at.
 *  2. THE ENEMY SIDE IS THE SNAPSHOT'S, NOT A BARE TIER. A pooled board fights with its OWNER's scalers via
 *     `sideFromSnapshot` — the same builder the reducer uses for a served board — and its bodies via
 *     `opponentBoard`, which restores the per-minion carries. The pool is filtered to the run's SET.
 *  3. MARGINS COME FROM THE AUTHORITATIVE RESULT. The old margin subtracted `death` events from the INITIAL
 *     bodies, which cannot see summons, Rise, stat growth or a body that died and came back. The signal is now
 *     `enemyDamage` / `playerDamage` (tier + surviving tiers, the engine's own settlement formula) and the
 *     engine's survivor counts.
 *
 * FAIRNESS. The bot never fights its ACTUAL pinned opponent (`servedBoards`, `scoutedNextOpponent` stay
 * withheld). The panel samples the general population of opponents at this wave — public knowledge in the same
 * way a player knows what boards look like at wave 10. When NO pool is registered for the run's set, the panel
 * is the procedural threat curve and the result says so (`panel: 'procedural'`) — never silently.
 *
 * SCOUTED (2026-09-15, `scout.ts`). When the caller supplies what the shipped lobby lets a player SEE — the
 * next opponent's identity and scout-card intel, the boards the pilot itself fought, the rest of the living
 * field — the panel is built from that instead (`panel: 'scouted'`): the next opponent's stand-ins weigh most,
 * the field's follow, the plain pool fills. The result then also carries `expectedDamageTaken`: the round-capped
 * hit the board expects from the next opponent, which the survival term reads. The scout arrives either as an
 * explicit argument or through `withScout` (a scope the pilot opens around its decision, because `evaluate`
 * sits between the pilot and this function and does not know about scouting).
 *
 * Selection is deterministic (a stride from a wave-derived offset), so the panel is stable across an evaluation
 * and every candidate board is compared against the SAME opponents. That property is load-bearing: seeding the
 * panel per-board once destroyed the entire comparison and made deeper search score worse.
 */

/** Threat archetypes to fight, in order. Fewer = faster and noisier. */
const PANEL = THREAT_IDS;

/** A wave-band sample of the registered pool for this set. Empty when nothing usable is registered. */
function poolPanel(setId: string, wave: number, size: number): BoardSnapshot[] {
  if (OPPONENT_POOL.length === 0) return [];
  const inSet = OPPONENT_POOL.filter((b) => (b.setId ?? 'set1') === setId && b.minions.length > 0);
  if (inSet.length === 0) return [];
  let eligible: BoardSnapshot[] = [];
  for (const band of [1, 2, 3]) {
    eligible = inSet.filter((b) => Math.abs(b.wave - wave) <= band);
    if (eligible.length >= size) break;
  }
  if (eligible.length === 0) return [];
  const stride = Math.max(1, Math.floor(eligible.length / size));
  const start = (wave * 7919) % eligible.length;
  const out: BoardSnapshot[] = [];
  for (let i = 0; i < size; i++) out.push(eligible[(start + i * stride) % eligible.length]!);
  return out;
}

/**
 * The panel seed depends ONLY on the wave — never on the board being scored.
 *
 * This was the reverse at first, hashed from the board "for determinism", and it quietly destroyed the entire
 * comparison: board A fought enemies drawn with seed(A) and board B fought enemies drawn with seed(B), so the
 * two scores were measured against DIFFERENT opponents and comparing them meant nothing.
 */
function panelSeed(wave: number): number {
  let h = 2166136261 >>> 0;
  h ^= wave >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  return h;
}

export type FightPanel = 'scouted' | 'pool' | 'procedural';

// ── the scout scope ──────────────────────────────────────────────────────────────────────────────────────────
let ACTIVE_SCOUT: SeatScout | null = null;
/** Run `fn` with `scout` as the panel's source for every `fightScore` call that passes none. Re-entrant. */
export function withScout<T>(scout: SeatScout | null, fn: () => T): T {
  const prev = ACTIVE_SCOUT;
  ACTIVE_SCOUT = scout;
  try { return fn(); } finally { ACTIVE_SCOUT = prev; }
}
export const activeScout = (): SeatScout | null => ACTIVE_SCOUT;

/** The last result per visible state, so a caller holding the same `v` (the pilot's survival term, after
 *  `evaluate`) reads `expectedDamageTaken` without refighting the panel. */
const LAST = new WeakMap<BotVisibleState, FightResult>();
export const lastFightResult = (v: BotVisibleState): FightResult | undefined => LAST.get(v);

export interface FightResult {
  /** Wins ÷ fights, with draws at half. [0, 1]. */
  winRate: number;
  /**
   * The GRADIENT. Average per-fight margin from the engine's own settlement: damage you would deal on a win
   * minus damage you would take on a loss, normalized to [-1, 1], with the survivor balance as a tiebreak.
   *
   * Win rate alone is unusable as a search signal because it saturates: at wave 7 a full board and a crippled
   * 2-card board both scored 0.00 because every archetype beat both. Margin still separates a narrow loss from
   * a rout, which is exactly the information needed to improve a losing board into a winning one.
   */
  margin: number;
  /** Average damage taken per fight, normalized against the round's rough cap — what losing actually costs. */
  averageDamage: number;
  fights: number;
  /** Where the opponents came from. `procedural` = no pool registered for this set — visible, never silent. */
  panel: FightPanel;
  /** `scouted` only: the round-capped damage expected from the NEXT opponent's stand-ins (weighted mean of the
   *  engine's `playerDamage`), in Health. Absent otherwise. */
  expectedDamageTaken?: number;
}

/** The friendly bodies, shallow-copied per fight so nothing downstream can alias the projection. */
function friendlyBodies(v: BotVisibleState): BoardMinion[] {
  return v.friendly.bodies.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
}

/**
 * Fight this board against `panelSize` wave-appropriate opponents.
 *
 * An empty board is an automatic loss and skips the simulation entirely — the common case early in a turn, and
 * worth short-circuiting because it is also the cheapest thing to get right.
 */
export function fightScore(v: BotVisibleState, panelSize = PANEL.length, scout: SeatScout | null = ACTIVE_SCOUT): FightResult {
  const n = Math.max(1, Math.min(panelSize, PANEL.length));
  const scouted: PanelEntry[] = scout ? scoutedPanel(v, scout, n) : [];
  const real = scouted.length === 0 ? poolPanel(v.setId, v.wave, n) : [];
  const panel: FightPanel = scouted.length > 0 ? 'scouted' : real.length === n ? 'pool' : 'procedural';
  const fights = panel === 'scouted' ? scouted.length : n;
  const remember = (r: FightResult): FightResult => { LAST.set(v, r); return r; };
  if (v.friendly.bodies.length === 0) {
    // An automatic loss: the whole enemy board survives, so the hit is its tier plus every body's tier — read
    // off the stand-ins rather than guessed, so an empty board at low health still reads as lethal.
    const hit = panel === 'scouted' ? scoutedEmptyHit(scouted, scout!) : undefined;
    return remember({ winRate: 0, margin: -1, averageDamage: 1, fights: 0, panel, ...(hit !== undefined ? { expectedDamageTaken: hit } : {}) });
  }

  const poolIds = poolFor(v.setId).all.map((c) => c.id);
  const mySide: CombatSideState = { ...v.friendly.side, poolIds };
  const seed = panelSeed(v.wave);
  // Damage is normalized against a rough per-round cap so it stays on the same scale as the win rate; the exact
  // cap matters less than that a heavy loss reads worse than a narrow one.
  const capish = 6 + v.wave * 1.5;
  const cap = scout && Number.isFinite(scout.me.lossCap) ? scout.me.lossCap : Infinity;
  let wins = 0;
  let draws = 0;
  let damage = 0;
  let marginSum = 0;
  let weightSum = 0;
  let nextDamage = 0;
  let nextWeight = 0;
  for (let i = 0; i < fights; i++) {
    let enemy: BoardMinion[];
    let enemySide: CombatSideState;
    let weight = 1;
    let next = false;
    if (panel === 'scouted') {
      const e = scouted[i]!;
      enemy = e.minions.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
      enemySide = e.side;
      weight = e.weight;
      next = e.next;
    } else if (panel === 'pool') {
      const snap = real[i]!;
      enemy = opponentBoard(snap);
      enemySide = sideFromSnapshot(snap, v.economy.tier, poolIds);
    } else {
      enemy = buildEnemyBoard(PANEL[i % PANEL.length]!, v.wave, makeRng(seed + i * 7919));
      enemySide = combatSide({ tier: v.economy.tier, poolIds });
    }
    const r = simulate(friendlyBodies(v), enemy, makeRng(seed + i * 104_729), CARD_INDEX, mySide, enemySide);
    if (r.result === 'win') wins += weight;
    else if (r.result === 'draw') draws += weight;
    damage += r.playerDamage * weight;
    if (next) { nextDamage += Math.min(cap, r.playerDamage) * weight; nextWeight += weight; }
    // AUTHORITATIVE margin: the engine's settlement numbers, not initial-bodies-minus-deaths.
    const dealt = r.enemyDamage ?? 0;
    const taken = r.playerDamage;
    const mineLeft = r.playerSurvivorCardIds?.length ?? 0;
    const theirsLeft = r.damageBreakdown?.survivorTiers.length ?? 0;
    const damageMargin = Math.max(-1, Math.min(1, (dealt - taken) / capish));
    // A draw (both sides standing at the iteration guard, or mutual wipe) is a genuine 0 — the engine reports
    // survivors for the player only, so the raw balance would read as a lead.
    const survivorMargin = r.result === 'draw' ? 0 : (mineLeft - theirsLeft) / Math.max(1, mineLeft + theirsLeft);
    marginSum += (damageMargin * 0.7 + survivorMargin * 0.3) * weight;
    weightSum += weight;
  }
  const W = Math.max(1e-9, weightSum);
  return remember({
    winRate: (wins + draws * 0.5) / W,
    margin: Math.max(-1, Math.min(1, marginSum / W)),
    averageDamage: Math.min(1, damage / W / capish),
    fights,
    panel,
    ...(panel === 'scouted' && nextWeight > 0 ? { expectedDamageTaken: nextDamage / nextWeight } : {}),
  });
}

/** The hit an EMPTY board takes from the next opponent's stand-ins: tier + every body's tier, round-capped. */
function scoutedEmptyHit(panel: PanelEntry[], scout: SeatScout): number | undefined {
  const cap = Number.isFinite(scout.me.lossCap) ? scout.me.lossCap : Infinity;
  let sum = 0; let w = 0;
  for (const e of panel) {
    if (!e.next) continue;
    const tiers = e.minions.reduce((n, m) => n + (CARD_INDEX[m.cardId]?.tier ?? 1), 0);
    sum += Math.min(cap, e.side.tier + tiers) * e.weight; w += e.weight;
  }
  return w > 0 ? sum / w : undefined;
}
