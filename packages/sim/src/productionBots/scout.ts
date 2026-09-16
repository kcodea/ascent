import { combatSide, makeRng, simulate, type BoardMinion, type CombatSideState } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import type { SeatIntel } from '../lobby/runLobby';
import { OPPONENT_POOL, opponentBoard } from '../opponents';
import { sideFromSnapshot } from '../boardSide';
import type { BoardSnapshot } from '../snapshot';
import type { BotVisibleState } from './types';
import type { SeatContext } from '../balance/types';

/**
 * PLAYER-LEGAL SCOUTING for the balance pilot (balance roadmap, "Fair information and useful planning":
 * "Legally revealed scout information should be available under the same conditions as for a player").
 *
 * THE RULE, read off the shipped lobby (2026-09-15):
 *
 *  - The NEXT OPPONENT is known while shopping. `LobbyPanel.tsx:87` calls `playerOpponent(lobby)` during the
 *    recruit phase and marks that seat with a NEXT chip; the pairing is a pure function of the table
 *    (`runLobby.ts:311` `pairRunLobby`), so a player can always tell who they will meet. A bye shows the ghost
 *    (`runLobby.ts:433-447`).
 *  - What a player sees of ANY seat is the hover scout card (`LobbyPanel.tsx:205` `ScoutCard`): hero, live
 *    Resolve/Armor, alive/placement, and the seat's `SeatIntel` — tavern TIER, TRIPLES, the DOMINANT TRIBE and
 *    how many bodies share it, completed QUESTS and owned RUNES — plus its last three fight results
 *    (`runLobby.ts:514` `seatResults`). Intel is RECORDED AT SETTLE from the board each seat actually fielded
 *    (`runLobby.ts:584-586`), i.e. the LAST board it fought with; for the next foe alone the rail reads the
 *    intel of the board it brings THIS round (`LobbyPanel.tsx:89-91`, `boardIntel(next.board, lobby.round)`),
 *    which is only possible because a recorded seat's boards pre-exist.
 *  - A player NEVER sees another seat's minion list — the card shows a tribe count, not bodies. The only bodies
 *    a player has seen are the boards THEY THEMSELVES FOUGHT (the combat replay). So `lastFought` is the pilot's
 *    own combat memory: the board that seat fielded the last time the pilot met it, never anything else.
 *  - The loss cap for the round is printed on the rail (`LobbyPanel.tsx:114`, `lossDamageCap(lobby.round)`), and
 *    the damage rule is the engine's own: foe tier + the tiers of its surviving bodies (`simulate`'s
 *    `playerDamage` / `damageBreakdown`), capped by that round's cap (`runLobby.ts:546` `playerLossDamage`).
 *
 * What the pilot therefore gets (`SeatScout`) and what it must never get: a recording's board for a wave it has
 * not fielded yet against the pilot. The runner supplies the seated recordings' identities as a FAIRNESS GUARD
 * only — used to keep the pool panel from sampling a seated recording's boards (its future ones would be the
 * exact boards to come), never as information the pilot reasons from.
 */

/** A board the pilot has actually SEEN: fought it, watched the replay. */
export interface ScoutedBoard {
  minions: BoardMinion[];
  /** The side it fought with, when the fight exposed it (the pinned lobby serves it through the same builder). */
  side?: CombatSideState;
  snapshot?: BoardSnapshot;
  tier: number;
  /** The lobby round the pilot fought it — strictly before the round being decided. */
  round: number;
}

/** One seat as the rail's scout card shows it. */
export interface ScoutedSeat {
  seatId: string;
  heroId: string;
  alive: boolean;
  health: number;
  armor: number;
  /** The hover card's read (tier / triples / dominant tribe + count / quests / runes), or null before any settle. */
  intel: SeatIntel | null;
  /** The board this seat fielded the last time the PILOT fought it (own combat memory), or null. */
  lastFought: ScoutedBoard | null;
  /** The bye's ghost: a fallen seat's board from the round it died. */
  ghost?: boolean;
}

export interface SeatScout {
  round: number;
  me: { health: number; armor: number; lossCap: number };
  /** Who the pilot meets this round, or null for a bye with no ghost to raise. */
  nextOpponent: ScoutedSeat | null;
  /** The other LIVING seats (the next opponent included), as the rail lists them. */
  field: ScoutedSeat[];
  /** Fairness guard, runner-supplied: `author|hero|seed` keys of the recordings seated at this table. */
  seatedRecordings?: readonly string[];
}

/** The scout a `SeatContext` carries, or null when the runner supplied none (the pilot then plays unscouted). */
export function scoutFromContext(ctx: SeatContext): SeatScout | null {
  if (ctx.nextOpponent === undefined && ctx.field === undefined) return null;
  return {
    round: ctx.round,
    // No printed cap (a runner that did not supply one) reads as UNCAPPED — the conservative side of the rule.
    me: { health: ctx.myHealth ?? 0, armor: ctx.myArmor ?? 0, lossCap: ctx.lossCap ?? Infinity },
    nextOpponent: ctx.nextOpponent ?? null,
    field: ctx.field ?? [],
    ...(ctx.seatedRecordings ? { seatedRecordings: ctx.seatedRecordings } : {}),
  };
}

/** One opponent in a scouted fight panel. */
export interface PanelEntry {
  minions: BoardMinion[];
  side: CombatSideState;
  weight: number;
  source: 'nextFought' | 'nextShape' | 'fieldFought' | 'fieldShape' | 'pool';
  /** True for the entries that stand in for the NEXT opponent — the ones `expectedDamageTaken` averages. */
  next: boolean;
}

const recordingKey = (s: BoardSnapshot): string => `${s.author ?? 'anon'}|${s.heroId}|${s.seed}`;

const DOMINANT = new WeakMap<BoardSnapshot, { tribe: string; count: number } | null>();
function dominantOf(s: BoardSnapshot): { tribe: string; count: number } | null {
  let d = DOMINANT.get(s);
  if (d === undefined) {
    // Same reading as `boardIntel`: neutral is the absence of a tribe, never the lead.
    const counts = new Map<string, number>();
    for (const m of s.minions) {
      const def = CARD_INDEX[m.cardId];
      if (!def) continue;
      for (const t of [def.tribe, def.tribe2]) if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    d = null;
    for (const [tribe, count] of counts) if (!d || count > d.count) d = { tribe, count };
    DOMINANT.set(s, d);
  }
  return d;
}

/** Memoized shape matches — the same question is asked for every node of a decision. Bounded. */
const SHAPE_CACHE = new Map<string, BoardSnapshot[]>();

/**
 * Pool boards that LOOK LIKE a scouted seat: same set, a wave near the round, the scouted tier (widened by one
 * when nothing matches exactly) and the scouted dominant tribe (dropped when the seat reads as none). Seated
 * recordings are excluded outright (fairness guard). Deterministic order, stride-sampled like `poolPanel`.
 */
export function shapeMatches(setId: string, round: number, intel: SeatIntel | null, exclude: ReadonlySet<string>, limit: number): BoardSnapshot[] {
  if (!intel || limit <= 0 || OPPONENT_POOL.length === 0) return [];
  const key = `${setId}|${round}|${intel.tier}|${intel.topTribe ?? '-'}|${[...exclude].sort().join(',')}|${limit}`;
  const hit = SHAPE_CACHE.get(key);
  if (hit) return hit;
  const inSet = OPPONENT_POOL.filter((b) => (b.setId ?? 'set1') === setId && b.minions.length > 0 && !exclude.has(recordingKey(b)));
  let eligible: BoardSnapshot[] = [];
  outer: for (const tierBand of [0, 1]) {
    for (const waveBand of [1, 2, 3]) {
      eligible = inSet.filter((b) =>
        Math.abs(b.wave - round) <= waveBand &&
        Math.abs(b.tier - intel.tier) <= tierBand &&
        (!intel.topTribe || dominantOf(b)?.tribe === intel.topTribe));
      if (eligible.length >= limit) break outer;
    }
  }
  if (eligible.length === 0) {
    // No board of that shape at all: the tier alone, any tribe.
    eligible = inSet.filter((b) => Math.abs(b.wave - round) <= 3 && Math.abs(b.tier - intel.tier) <= 1);
  }
  const stride = Math.max(1, Math.floor(eligible.length / Math.max(1, limit)));
  const start = eligible.length ? (round * 7919) % eligible.length : 0;
  const out: BoardSnapshot[] = [];
  for (let i = 0; i < limit && i < eligible.length; i++) out.push(eligible[(start + i * stride) % eligible.length]!);
  if (SHAPE_CACHE.size > 256) SHAPE_CACHE.clear();
  SHAPE_CACHE.set(key, out);
  return out;
}

function sideOf(b: ScoutedBoard, tier: number, poolIds: string[]): CombatSideState {
  if (b.side) return b.side;
  if (b.snapshot) return sideFromSnapshot(b.snapshot, tier, poolIds);
  return combatSide({ tier: b.tier, poolIds });
}

/** A fought board is still a useful stand-in for this many rounds; beyond that its owner has outgrown it. */
export const FOUGHT_MEMORY_ROUNDS = 3;

/**
 * THE SCOUTED PANEL: `n` opponents, weighted. The next opponent takes the lion's share — the board the pilot
 * last fought from that seat (when recent) and pool boards of its scouted shape; the rest of the living field
 * follows the same recipe at half weight (the pilot's board persists into later rounds); anything left is the
 * plain pool, seated recordings excluded. Empty when nothing is scouted at all — the caller falls back.
 */
export function scoutedPanel(v: BotVisibleState, scout: SeatScout, n: number): PanelEntry[] {
  if (!scout.nextOpponent && scout.field.length === 0) return [];
  const poolIds = poolFor(v.setId).all.map((c) => c.id);
  const exclude = new Set(scout.seatedRecordings ?? []);
  const out: PanelEntry[] = [];
  const nextShare = Math.max(1, Math.ceil(n * 0.6));
  const next = scout.nextOpponent;
  if (next) {
    let taken = 0;
    if (next.lastFought && scout.round - next.lastFought.round <= FOUGHT_MEMORY_ROUNDS) {
      const b = next.lastFought;
      out.push({ minions: b.minions.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] })), side: sideOf(b, v.economy.tier, poolIds), weight: 1.5, source: 'nextFought', next: true });
      taken++;
    }
    for (const snap of shapeMatches(v.setId, scout.round, next.intel, exclude, nextShare - taken)) {
      out.push({ minions: opponentBoard(snap), side: sideFromSnapshot(snap, v.economy.tier, poolIds), weight: 1, source: 'nextShape', next: true });
    }
  }
  // The rest of the field, strongest first (they are who the pilot meets next), one stand-in each.
  const others = scout.field.filter((s) => s.alive && s.seatId !== next?.seatId).sort((a, b) => (b.health + b.armor) - (a.health + a.armor));
  for (const seat of others) {
    if (out.length >= n) break;
    if (seat.lastFought && scout.round - seat.lastFought.round <= FOUGHT_MEMORY_ROUNDS) {
      const b = seat.lastFought;
      out.push({ minions: b.minions.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] })), side: sideOf(b, v.economy.tier, poolIds), weight: 0.5, source: 'fieldFought', next: false });
      continue;
    }
    const [snap] = shapeMatches(v.setId, scout.round, seat.intel, exclude, 1);
    if (snap) out.push({ minions: opponentBoard(snap), side: sideFromSnapshot(snap, v.economy.tier, poolIds), weight: 0.5, source: 'fieldShape', next: false });
  }
  // Plain pool fill, seated recordings excluded.
  if (out.length < n && OPPONENT_POOL.length > 0) {
    const inSet = OPPONENT_POOL.filter((b) => (b.setId ?? 'set1') === v.setId && b.minions.length > 0 && !exclude.has(recordingKey(b)));
    let eligible: BoardSnapshot[] = [];
    for (const band of [1, 2, 3]) { eligible = inSet.filter((b) => Math.abs(b.wave - v.wave) <= band); if (eligible.length >= n) break; }
    const stride = Math.max(1, Math.floor(eligible.length / n));
    const start = eligible.length ? (v.wave * 7919) % eligible.length : 0;
    for (let i = 0; out.length < n && i < eligible.length; i++) {
      const snap = eligible[(start + i * stride) % eligible.length]!;
      out.push({ minions: opponentBoard(snap), side: sideFromSnapshot(snap, v.economy.tier, poolIds), weight: 0.5, source: 'pool', next: false });
    }
  }
  return out.slice(0, n);
}

/**
 * LETHAL RISK: how close an expected hit comes to killing you. 0 while the hit is under 40% of what you have,
 * rising linearly to 1 when it would take everything. Smooth on purpose — a step at "dead" would give the
 * search no gradient until it was too late.
 */
export function lethalRisk(health: number, armor: number, expectedDamage: number): number {
  const hp = Math.max(1, health + armor);
  return Math.max(0, Math.min(1, (expectedDamage - 0.4 * hp) / (0.6 * hp)));
}

/**
 * THE SURVIVAL TERM, in [-1, 0]: the round-capped damage the board is expected to take from the scouted next
 * opponent (as a fraction of the cap), scaled by how lethal that hit is right now. A comfortable seat reads 0
 * whatever the fight; a seat one loss from elimination reads the full expected hit. `expectedDamage` is the
 * cap-clamped mean `playerDamage` over the panel's next-opponent stand-ins (the engine's own settlement formula:
 * foe tier + surviving tiers) — see `fightScore`, which computes it alongside the panel.
 */
export function survivalTerm(scout: SeatScout, expectedDamage: number): number {
  const cap = Number.isFinite(scout.me.lossCap) ? scout.me.lossCap : 20; // uncapped: the finale's scale
  const capped = Math.min(scout.me.lossCap, Math.max(0, expectedDamage));
  const risk = lethalRisk(scout.me.health, scout.me.armor, capped);
  const term = Math.min(1, capped / Math.max(1, cap)) * risk;
  return term === 0 ? 0 : -term; // never -0: a comfortable seat reads a plain 0
}

/**
 * Expected round-capped damage from the scouted next opponent, for a board — the same fights `fightScore` runs
 * for its next-opponent entries, exposed for callers that hold no fight result (tests, traces).
 */
export function expectedDamageTaken(v: BotVisibleState, scout: SeatScout, n = 5, seed = 0x51ab): number {
  const entries = scoutedPanel(v, scout, n).filter((e) => e.next);
  if (entries.length === 0 || v.friendly.bodies.length === 0) return 0;
  const poolIds = poolFor(v.setId).all.map((c) => c.id);
  const mySide: CombatSideState = { ...v.friendly.side, poolIds };
  const cap = scout.me.lossCap;
  let sum = 0; let w = 0;
  entries.forEach((e, i) => {
    const mine = v.friendly.bodies.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
    const r = simulate(mine, e.minions, makeRng(seed + i * 104_729), CARD_INDEX, mySide, e.side);
    sum += Math.min(cap, r.playerDamage) * e.weight; w += e.weight;
  });
  return w > 0 ? sum / w : 0;
}

/** For tests: forget the shape cache (the pool changed under it). */
export function resetScoutCache(): void { SHAPE_CACHE.clear(); }
