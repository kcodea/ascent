/**
 * BALANCE BOT B5 — the recorder (docs/balance-bot-roadmap.md, "Telemetry and analytics").
 *
 * The runner (B1) drives ONE recorder per lobby: every accepted action, every attributed effect, every round
 * snapshot and every finished run land here, and `finalize()` hands back the `LobbyRecord` the aggregate
 * consumes. Pure and browser-safe — no Node, no I/O, no clock; the store in `packages/tools` does the writing.
 *
 * Doctrine (types.ts): the recorder observes ACCEPTED transitions only. It never invents an outcome, never
 * derives a placement, never fills a blank. What it DOES do beyond buffering:
 *  - `observeTransition(before, after, action, seat, round, …)` — the one-call path a runner wants: it records the
 *    `AcceptedActionEvent` AND derives the transition's `EffectEvent`s (`effectsFromTransition.ts`), keeping a
 *    per-seat card LINEAGE (uid → acquisition route) so a later `play` / spell cast can say whether the card was
 *    bought, generated, discovered or granted by a rune. A runner that already has its own effect stream can
 *    call `onAction` / `onEffect` directly instead.
 *  - `finalize()` orders everything canonically (round, seat, index) so two recorders fed the same events in a
 *    different interleaving produce byte-identical records — the determinism the report regeneration gate needs.
 */
import type { Action, RunState } from '../state';
import { stateHash } from './hash';
import { effectEventsOf, type CardLineage } from './effectsFromTransition';
import { visibleOffersFor } from './seatRunner';
import type {
  AcceptedActionEvent, BalanceRecorder, EffectEvent, ExperimentIdentity, ExperimentManifest, LobbyRecord,
  RoundRecord, RunRecord,
} from './types';

export interface LobbyRecorder extends BalanceRecorder {
  readonly lobbyId: string;
  readonly seed: number;
  /**
   * Record one ACCEPTED transition end-to-end: the action event (with pre/post hashes, Gold, visible offers) and
   * every effect the engine produced during it. `index` is the action's 0-based position in the seat's recruit
   * turn. The caller has already confirmed acceptance (`after !== before`); a rejected transition must NOT be
   * passed here — the runner counts those toward the seat's failure budget instead.
   */
  observeTransition(before: RunState, after: RunState, action: Action, seatId: string, round: number, index: number): EffectEvent[];
  /** Rounds actually played (the lobby resolved, or hit `maxRounds`). Defaults to the highest recorded round. */
  setRoundsPlayed(n: number): void;
  /** Mark the WHOLE lobby censored (a seat could not be advanced). Outcome tables drop it; coverage counts it. */
  fail(reason: string): void;
  finalize(): LobbyRecord;
}

const byRoundSeatIndex = (a: { round: number; seatId: string; index?: number }, b: { round: number; seatId: string; index?: number }): number =>
  a.round - b.round || (a.seatId < b.seatId ? -1 : a.seatId > b.seatId ? 1 : 0) || ((a.index ?? 0) - (b.index ?? 0));

export function createRecorder(lobbyId: string, seed: number, manifest: ExperimentManifest, identity: ExperimentIdentity): LobbyRecorder {
  const seats: RunRecord[] = [];
  const rounds: RoundRecord[] = [];
  const actions: AcceptedActionEvent[] = [];
  const effects: EffectEvent[] = [];
  const lineage = new Map<string, CardLineage>(); // per seat: uid → route (seat-scoped keys, see below)
  let roundsPlayed: number | undefined;
  let failure: string | undefined;
  // Effects keep their ARRIVAL order within (round, seat) — `Array.prototype.sort` is stable, and the order the
  // engine produced them in is the order the transition happened in. Actions carry their own `index`.
  let effectSeq = 0;
  const effectOrder = new Map<EffectEvent, number>();

  const lineageOf = (seatId: string): CardLineage => {
    let m = lineage.get(seatId);
    if (!m) { m = new Map(); lineage.set(seatId, m); }
    return m;
  };

  const rec: LobbyRecorder = {
    lobbyId,
    seed,
    onAction(ev) { actions.push(ev); },
    onEffect(ev) { effectOrder.set(ev, effectSeq++); effects.push(ev); },
    onRound(r) { rounds.push(r); },
    onRun(r) { seats.push(r); },
    observeTransition(before, after, action, seatId, round, index) {
      // Visible offers at decision time — the SURFACE the action chooses from: the Runeforge's rune ids for a
      // runeforge action, the quest shop for `buyQuest`, the open Discover's options for `discover`, otherwise
      // the tavern row + the spell slot. The aggregate's offer → pick funnels read these per surface.
      const offers = visibleOffersFor(before, action); // the ONE surface helper (seatRunner.ts)
      rec.onAction({
        lobbyId, seatId, round, index, action,
        goldBefore: before.embers, goldAfter: after.embers,
        offers,
        preHash: stateHash(before), postHash: stateHash(after),
      });
      const evs = effectEventsOf(before, after, action, { lobbyId, seatId, round }, lineageOf(seatId));
      for (const ev of evs) rec.onEffect(ev);
      return evs;
    },
    setRoundsPlayed(n) { roundsPlayed = n; },
    fail(reason) { failure = failure ? `${failure}; ${reason}` : reason; },
    finalize() {
      const seatsOut = [...seats].sort((a, b) => (a.seatId < b.seatId ? -1 : a.seatId > b.seatId ? 1 : 0));
      const roundsOut = [...rounds].sort(byRoundSeatIndex);
      const actionsOut = [...actions].sort(byRoundSeatIndex);
      const effectsOut = [...effects].sort((a, b) => byRoundSeatIndex(a, b) || (effectOrder.get(a) ?? 0) - (effectOrder.get(b) ?? 0));
      const played = roundsPlayed ?? roundsOut.reduce((m, r) => Math.max(m, r.round), 0);
      const out: LobbyRecord = {
        lobbyId, seed, manifest, identity,
        seats: seatsOut, rounds: roundsOut, actions: actionsOut, effects: effectsOut,
        roundsPlayed: played,
      };
      if (failure !== undefined) out.failure = failure;
      return out;
    },
  };
  return rec;
}
