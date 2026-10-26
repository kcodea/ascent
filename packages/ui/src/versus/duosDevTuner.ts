/**
 * THE VERSUS BOTS + DUOS DEV TUNER: the pure half (owner 2026-10-25: "a dev tuner that says like... pass a card etc
 * etc so i can just force the various mechanics"). DEV ONLY: the panel that calls these lives in the dev menu, which
 * a production build strips.
 *
 * Everything that can go through the REAL code paths does: passes are the run's own `passCard` / `receivePass` and the
 * server's pass RPCs, fights are the real resolver, concedes the real forfeit. What a test needs to SET UP (a board for
 * the next fight, a full hand, no Gold) is a direct edit of a run here, labelled dev, before the real path runs on it.
 */
import { CARD_INDEX } from '@game/content';
import { duosMateOf, duosTeamOf, poolOf, type BoardCard, type RunState, type VersusGroupSeat } from '@game/sim';
import { create } from 'zustand';

/** A plain minion for forced boards: the first minion of the run's pool with no effects and no keywords. */
export function vanillaMinionId(run: Pick<RunState, 'setId' | 'mode'>): string {
  const pool = poolOf(run);
  const hit = pool.buyable.find((d) => d.effects.length === 0 && d.keywords.length === 0);
  return hit?.id ?? 'sandbag';
}

/** A fresh card instance of `cardId` (its printed stats unless given) with the run's next uid. */
export function devCard(run: RunState, cardId: string, stats?: [number, number]): { card: BoardCard; run: RunState } {
  const def = CARD_INDEX[cardId];
  const card: BoardCard = {
    uid: `b${run.uidSeq}`, cardId, tribe: def?.tribe ?? 'neutral',
    attack: stats ? stats[0] : def?.attack ?? 1, health: stats ? stats[1] : def?.health ?? 1,
    keywords: stats ? [] : [...(def?.keywords ?? [])], golden: false,
  };
  return { card, run: { ...run, uidSeq: run.uidSeq + 1 } };
}

/** The run's board replaced by plain minions of these stats (a forced board for the next fight). */
export function withForcedBoard(run: RunState, stats: readonly (readonly [number, number])[]): RunState {
  const id = vanillaMinionId(run);
  let r: RunState = { ...run, board: [] };
  const board: BoardCard[] = [];
  for (const [a, h] of stats) {
    const made = devCard(r, id, [a, h]);
    board.push(made.card);
    r = made.run;
  }
  return { ...r, board };
}

/** One card of `cardId` added to the hand or the board (the board caps at 7, the hand is not capped here). */
export function withAddedCard(run: RunState, cardId: string, to: 'hand' | 'board'): RunState {
  if (to === 'board' && run.board.length >= 7) return run;
  const made = devCard(run, cardId);
  return to === 'hand' ? { ...made.run, hand: [...run.hand, made.card] } : { ...made.run, board: [...run.board, made.card] };
}

export const withGold = (run: RunState, gold: number): RunState => ({ ...run, embers: Math.max(0, gold) });
export const withEmptyBoard = (run: RunState): RunState => ({ ...run, board: [] });
export const withEmptyHand = (run: RunState): RunState => ({ ...run, hand: [] });

/**
 * THE NEXT FIGHT, FORCED. Each kind sets every board of the table so the tag-team rule shows exactly one thing:
 *  - `ourHandoff`: my team's first board falls and my teammate's board steps in (and wins).
 *  - `theirHandoff`: the foe's first board falls and their reserve flies in.
 *  - `doubleWipe`: all four boards trade 1 for 1: both first boards fall together, both reserves step in, both fall:
 *    a draw, no damage.
 *  - `allEmpty`: every board empty: a draw round.
 * Plain minions only (no keywords, no effects); a hero power can still nudge a fight.
 */
export type DuosScenario = 'ourHandoff' | 'theirHandoff' | 'doubleWipe' | 'allEmpty';

export const DUOS_SCENARIO_LABEL: Record<DuosScenario, string> = {
  ourHandoff: 'Our hand-off',
  theirHandoff: 'Their hand-off',
  doubleWipe: 'Both teams wiped (draw)',
  allEmpty: 'All boards empty (draw)',
};

export function scenarioBoard(kind: DuosScenario, seat: VersusGroupSeat, viewer: VersusGroupSeat, first: { a: VersusGroupSeat; b: VersusGroupSeat }): [number, number][] {
  const team = duosTeamOf(seat);
  const ours = team === duosTeamOf(viewer);
  const lead = first[team] === seat;
  switch (kind) {
    case 'ourHandoff':
      return ours ? (lead ? [[1, 1]] : [[4, 4], [4, 4]]) : (lead ? [[3, 3]] : [[2, 2]]);
    case 'theirHandoff':
      return ours ? (lead ? [[4, 4]] : [[2, 2]]) : (lead ? [[1, 1]] : [[3, 3], [3, 3]]);
    case 'doubleWipe':
      return [[1, 1]];
    case 'allEmpty':
      return [];
  }
}

/** The seat whose board fights first for `seat`'s team (from the round's order). */
export const leadOf = (seat: VersusGroupSeat, first: { a: VersusGroupSeat; b: VersusGroupSeat }): VersusGroupSeat => first[duosTeamOf(seat)];

/** My teammate's seat. */
export const mateOf = (seat: VersusGroupSeat): VersusGroupSeat => duosMateOf(seat);

/** The tuner's own state (dev only; never persisted). */
export interface DuosTunerState {
  /** "Bots end turn after me": every bot waits to lock until I have (or its clock is nearly out). */
  botsAfterMe: boolean;
  /** The armed next-fight scenario: applied to each bot's board as it locks this round. */
  armed: { kind: DuosScenario; round: number; viewer: VersusGroupSeat; first: { a: VersusGroupSeat; b: VersusGroupSeat } } | null;
  /** The last thing the tuner did (or why it could not). */
  note: string | null;
}

export const useDuosTuner = create<DuosTunerState>(() => ({ botsAfterMe: true, armed: null, note: null }));
export const tunerNote = (note: string): void => useDuosTuner.setState({ note });
