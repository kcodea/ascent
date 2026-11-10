/**
 * VERSUS — THE SAME BOARD IS UPLOADED ONCE (R-VERSUS-CANDIDATE-DEDUPE-01, runtime audit D8). While I shop, my board goes
 * to the room as a "candidate" after every change, so the room always holds something recent to fight with if I drop
 * (R-VERSUS-AUTO-NEWEST-BOARD-01). Measured late in a game: the whole 8 to 9 KB side went up 10 to 11 times a round, and
 * many of those were byte for byte what the room already held (a Shop refresh, an action that never touched the board).
 *
 * This remembers the last candidate the room was SENT for a round and says whether a new one differs. It must never
 * leave the room on an older board than the client believes, so the mark is forgotten whenever that could be untrue:
 * the send failed (`failed`), or anything else replaced or may have lost the room's copy (`reset`: my lock, my un-ready,
 * a reconnect, a new session). Pure; one string compare per candidate.
 */
export interface CandidateMark { key: string; body: string }

export interface CandidateDedupe {
  /** The mark to send under, or null when the room already holds exactly this board for this round. */
  next(matchId: string, round: number, payload: unknown): CandidateMark | null;
  /** That send did not land: the next candidate goes out whatever it is. */
  failed(mark: CandidateMark): void;
  /** The room's copy may no longer be the last candidate: forget it. */
  reset(): void;
}

export function createCandidateDedupe(): CandidateDedupe {
  let last: CandidateMark | null = null;
  return {
    next(matchId, round, payload) {
      const mark = { key: `${matchId}|${round}`, body: JSON.stringify(payload) };
      if (last && last.key === mark.key && last.body === mark.body) return null;
      last = mark;
      return mark;
    },
    failed(mark) { if (last === mark) last = null; },
    reset() { last = null; },
  };
}
