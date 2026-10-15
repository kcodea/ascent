/**
 * VERSUS — the record behind the room's "Previous match stats" (owner 2026-10-14). Built once, when the player leaves
 * a finished match for the room, from what the match already holds: the match row and the committed rounds (each
 * seat's own perspective of the one fight). Session memory only: Versus writes no history (R-VERSUS-RANK-01).
 */
import type { BoardMinion, CombatResult, MinionSnapshot } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import { VERSUS_HEARTS, type VersusSeat } from '@game/sim';
import type { VersusMatch, VersusRoundRow } from './versusRemote';

export interface VersusRecordRound {
  round: number;
  /** From my side. */
  result: 'win' | 'lose' | 'draw';
  /** Hearts after this round. */
  myHearts: number;
  foeHearts: number;
  /** The two boards as they entered the fight. */
  mine: BoardMinion[];
  foe: BoardMinion[];
  /** Each player's runes as of that round's lock (the recorded scouts; empty on a round recorded before scouts). */
  myRunes: string[];
  foeRunes: string[];
  /** The fight's starting snapshots (`CombatResult.initial`, stored whole on the round row): what the right-click
   *  inspect reads (live text inputs, keywords, gilded, the buff breakdown). Optional: a record built before this. */
  mineSnap?: MinionSnapshot[];
  foeSnap?: MinionSnapshot[];
  /** Each player's shop tier at that round's lock (the scouts), for the inspect's tier-reading text. */
  myTier?: number;
  foeTier?: number;
}

export interface VersusMatchRecord {
  matchId: string;
  myName: string;
  foeName: string;
  myHero: string | null;
  foeHero: string | null;
  myCosmetics: RunCosmeticSnapshot | null;
  /** The opponent's cosmetic snapshot (their room profile), for their portrait's skin and frame. */
  foeCosmetics: RunCosmeticSnapshot | null;
  /** 'win' | 'lose' | 'none' (no contest). */
  outcome: 'win' | 'lose' | 'none';
  endReason: VersusMatch['end_reason'];
  myHearts: number;
  foeHearts: number;
  rounds: VersusRecordRound[];
}

const boardOf = (ms: readonly MinionSnapshot[] | undefined): BoardMinion[] =>
  (ms ?? []).map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health, keywords: [...(m.keywords ?? [])], ...(m.golden ? { golden: true } : {}) }));

export function buildVersusMatchRecord(
  match: VersusMatch, rounds: Record<number, VersusRoundRow>, seat: VersusSeat, myCosmetics: RunCosmeticSnapshot | null,
  foeCosmetics: RunCosmeticSnapshot | null = null,
): VersusMatchRecord {
  const other: VersusSeat = seat === 'p1' ? 'p2' : 'p1';
  const rows = Object.values(rounds).sort((a, b) => a.round - b.round);
  return {
    matchId: match.id,
    myName: seat === 'p1' ? match.p1_name : match.p2_name,
    foeName: other === 'p1' ? match.p1_name : match.p2_name,
    myHero: seat === 'p1' ? match.p1_hero : match.p2_hero,
    foeHero: other === 'p1' ? match.p1_hero : match.p2_hero,
    myCosmetics,
    foeCosmetics,
    outcome: match.winner_seat === seat ? 'win' : match.winner_seat ? 'lose' : 'none',
    endReason: match.end_reason,
    myHearts: seat === 'p1' ? match.p1_hearts : match.p2_hearts,
    foeHearts: other === 'p1' ? match.p1_hearts : match.p2_hearts,
    rounds: rows.map((r) => {
      const mine = (seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult;
      return {
        round: r.round,
        result: mine.result,
        myHearts: (seat === 'p1' ? r.p1_hearts : r.p2_hearts) ?? VERSUS_HEARTS,
        foeHearts: (other === 'p1' ? r.p1_hearts : r.p2_hearts) ?? VERSUS_HEARTS,
        mine: boardOf(mine.initial?.player),
        foe: boardOf(mine.initial?.enemy),
        myRunes: [...((seat === 'p1' ? r.p1_scout : r.p2_scout)?.runes ?? [])],
        foeRunes: [...((other === 'p1' ? r.p1_scout : r.p2_scout)?.runes ?? [])],
        mineSnap: [...(mine.initial?.player ?? [])],
        foeSnap: [...(mine.initial?.enemy ?? [])],
        myTier: (seat === 'p1' ? r.p1_scout : r.p2_scout)?.tier,
        foeTier: (other === 'p1' ? r.p1_scout : r.p2_scout)?.tier,
      };
    }),
  };
}
