/**
 * BALANCE BOT — the shared contract (docs/balance-bot-roadmap.md, 2026-09-15).
 *
 * Four work packages build against these types in parallel — B0 (manifest + identity + fixtures), B1 (the
 * authoritative seat runner + eight-seat self-play lobby), B3 (the pilot), B5 (recorder + report) — so this file
 * is the ONE place a shape lives. Add fields freely (additive); never rename or repurpose one without touching
 * every consumer in the same PR.
 *
 * The doctrine, in one line each:
 *  - the policy CHOOSES, the engine VALIDATES and EXECUTES (`reduce` is the only thing that changes a run);
 *  - the recorder observes ACCEPTED transitions only — analysis never invents an outcome;
 *  - every job names its mode, pool, policy, rules identity and termination, on every record.
 */
import type { SetId } from '@game/content';
import type { Action, RunState } from '../state';
import type { BoardSnapshot } from '../snapshot';

// ───────────────────────────────────────────── manifest + identity ─────────────────────────────────────────────

/** Which game is being measured. The four modes of the roadmap; only `selfPlayLobby` and `scenario` are in the
 *  first slice — the others are declared so a report can refuse them by name rather than silently run something else. */
export type ExperimentMode = 'selfPlayLobby' | 'pinnedLobby' | 'scenario' | 'legacyCourse';

/** The offline search budget a pilot runs under — independent of the Practice difficulty profiles. */
export interface PilotBudget {
  /** Plan depth (actions looked ahead) — 1 = greedy. */
  depth: number;
  /** Beam width kept per depth. */
  beam: number;
  /** Hard cap on planning-state clones per decision. */
  maxNodes: number;
  /** Positioning candidates tried before combat. */
  positionCandidates: number;
}

export interface ExperimentManifest {
  schemaVersion: 1;
  /** Human label — appears on every report. */
  name: string;
  mode: ExperimentMode;
  setId: SetId;
  /** Hero ids to rotate through the seats; empty/absent = every enabled hero eligible in the set (production rules). */
  heroes?: readonly string[];
  /** Policy selection: the pilot id (registered in `pilots.ts`) and its budget. */
  policy: { id: string; budget: PilotBudget };
  /** Seed schedule: `count` lobbies (or scenarios) seeded `start … start+count-1`. Seat rotation is per seed. */
  seeds: { start: number; count: number };
  /** Lobby rounds cap (the lobby's own elimination ends earlier); defaults to the mode's rule. */
  maxRounds?: number;
  /** Per-seat guard against a stuck pilot: recruit actions per turn before the seat is FAILED (never silently ended). */
  maxActionsPerTurn?: number;
  /** The opponent PANEL the pilot's `fightScore` samples — a pool file built by `balance:pool` from an earlier job
   *  (its name + digest are part of the manifest digest, so two jobs on different panels never compare). Absent =
   *  no pool registered = the procedural threat curve, which the pilot flags. */
  opponentPool?: { name: string; digest: string };
  /** A candidate DATA patch applied in-process before the identity is computed (see `overlay.ts`): card id →
   *  stat / tier / cost / per-effect param changes. The baseline job omits it; `compare --allow-diff
   *  contentDigest,manifestDigest` is then exactly the declared difference. */
  overlay?: Record<string, { attack?: number; health?: number; tier?: number; cost?: number; params?: Record<string, Record<string, number | string | boolean>> }>;
  /** Which combat rules the self-play fights resolve under (B1, `seatRunner.ts` `FightRules`): `corrected` (default)
   *  prepares EVERY seat through the player's full combat builder; `shipped` reproduces the served-board path a seat
   *  takes against the live player today. Labelled on the record, never inferred. */
  fightRules?: 'corrected' | 'shipped';
  notes?: string;
}

/** Everything that, if it differs, makes two jobs incomparable. Digests are hex strings; `engineRevision` is the
 *  git HEAD, `dirtyDigest` a digest of the uncommitted diff ('' when clean). */
export interface ExperimentIdentity {
  schemaVersion: 1;
  engineRevision: string;
  dirtyDigest: string;
  /** Serialized gameplay definitions: cards (all fields, in POOL ORDER), heroes, runes, quests, equipment, sets. */
  contentDigest: string;
  /** The set's resolved drawable pool, in order (order affects seeded draws). */
  poolDigest: string;
  /** Digest of the effect-factory implementation surface (the factory-id list + the reducer/recruit source). */
  effectDigest: string;
  manifestDigest: string;
}

// ───────────────────────────────────────────── the pilot boundary ─────────────────────────────────────────────

/** What a seat's pilot is told beyond the run itself. Player-legal information only. */
export interface SeatContext {
  seatId: string;
  round: number;
  /** The paired opponent's LAST-KNOWN board as a player would scout it, or null when unrevealed. */
  scoutedOpponent: RunState['lastCombat'] | null;
}

/**
 * A pilot decides ONE recruit action at a time against the live (authoritative) run. Returning `null` means
 * "end the turn". The runner validates by calling `reduce` and treats a rejected action (state identity
 * unchanged) as a pilot FAILURE after `maxActionsPerTurn` — never as a forced end turn (roadmap: measurement
 * defect #2). Pilots must not mutate `run`; planning happens on private clones (`productionBots/transition`).
 */
export interface SeatPilot {
  id: string;
  decide(run: RunState, ctx: SeatContext): Action | null;
}

// ───────────────────────────────────────────── records ─────────────────────────────────────────────

export type RunTermination = 'placed' | 'capped' | 'failed';

export interface AcceptedActionEvent {
  lobbyId: string;
  seatId: string;
  round: number;
  /** 0-based index within the seat's recruit turn. */
  index: number;
  action: Action;
  /** Live Gold before the action (so "actual price" is derivable with `goldAfter`). */
  goldBefore: number;
  goldAfter: number;
  /** Visible shop offers (card ids) at decision time, for offer → buy funnels. */
  offers: readonly string[];
  preHash: string;
  postHash: string;
}

/** An attributed gameplay event the engine produced during an accepted transition. Direct effects only — no
 *  estimated value. `route` says how the thing came to be (bought / generated / rune / equipment / …). */
export interface EffectEvent {
  lobbyId: string;
  seatId: string;
  round: number;
  kind: 'buff' | 'spellCast' | 'cardGained' | 'cardSold' | 'cardPlayed' | 'runePicked' | 'equipmentUsed' | 'heroPower' | 'consume' | 'summon' | 'starform';
  sourceId?: string;
  sourceUid?: string;
  targetId?: string;
  targetUid?: string;
  attack?: number;
  health?: number;
  gold?: number;
  route?: 'shop' | 'generated' | 'discover' | 'rune' | 'quest' | 'equipment' | 'hero' | 'triple' | 'other';
  /** B5 (additive): a free-form qualifier the aggregate can split on — a Starform pull's kind
   *  (`consumeShop` / `consumed` / `collapse` / `created`), `repeat` on an extra spell cast, a hero power's
   *  commission, a summon's origin (`battlecry` / `hand`). Never load-bearing for a table's headline count. */
  detail?: string;
}

export interface RoundRecord {
  lobbyId: string;
  seatId: string;
  round: number;
  heroId: string;
  tier: number;
  goldSpent: number;
  goldUnspent: number;
  board: readonly string[];
  hand: readonly string[];
  health: number;
  armor: number;
  opponentSeatId: string | null;
  result: 'win' | 'loss' | 'tie' | 'bye';
  damageDealt: number;
  damageTaken: number;
  eliminated: boolean;
  /** The seat's served-board snapshot at the END of its recruit turn (the same converter the game serves
   *  opponents with) — so a job's rounds can be turned into a VERSIONED opponent panel (`balance:pool`). Optional:
   *  synthetic fixtures omit it. */
  snapshot?: BoardSnapshot;
}

export interface RunRecord {
  lobbyId: string;
  seatId: string;
  heroId: string;
  setId: SetId;
  tribes: readonly string[];
  policyId: string;
  /** 1 = winner … 8; undefined until placed. */
  placement?: number;
  eliminatedRound?: number;
  termination: RunTermination;
  /** Set when `termination === 'failed'`: the runner's reason (rejected action limit, exception, …). */
  failure?: string;
  runesOwned: readonly string[];
  finalBoard: readonly string[];
}

export interface LobbyRecord {
  lobbyId: string;
  seed: number;
  manifest: ExperimentManifest;
  identity: ExperimentIdentity;
  seats: RunRecord[];
  rounds: RoundRecord[];
  actions: AcceptedActionEvent[];
  effects: EffectEvent[];
  /** Rounds actually played before the lobby resolved (or hit `maxRounds`). */
  roundsPlayed: number;
  /** A lobby-level failure (a seat that could not be advanced) — the whole lobby is CENSORED from outcome tables. */
  failure?: string;
}

/** The recorder the runner drives. B5 supplies the implementation; B1 calls it. A no-op recorder is legal. */
export interface BalanceRecorder {
  onAction(ev: AcceptedActionEvent): void;
  onEffect(ev: EffectEvent): void;
  onRound(rec: RoundRecord): void;
  onRun(rec: RunRecord): void;
}

export const NOOP_RECORDER: BalanceRecorder = { onAction() {}, onEffect() {}, onRound() {}, onRun() {} };

/** A stable content hash of the parts of a run that matter for reconciliation (board/hand/shop uids + stats,
 *  Gold, tier, health, armor, rune ids). Implemented in `hash.ts`; declared here so records can name it. */
export type StateHash = string;
