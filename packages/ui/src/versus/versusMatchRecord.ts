/**
 * VERSUS — the record behind the room's "Previous match stats" (owner 2026-10-14). Built once, when the player leaves
 * a finished match for the room, from what the match already holds: the match row and the committed rounds (each
 * seat's own perspective of the one fight). Session memory only: Versus writes no history (R-VERSUS-RANK-01).
 */
import type { BoardMinion, CombatResult, MinionSnapshot } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import { duosMateOf, runeCarryOf, runeLiveStateOfCarries, versusDuosStartingVitals, versusStartingVitals, type RuneLiveState, type VersusGroupSeat, type VersusSeat } from '@game/sim';
import type { VersusGroupMatchRaw, VersusGroupRoundRaw, VersusMatch, VersusRoundRow } from './versusRemote';
import { copyName, groupSeatOf, projectGroupMatch, projectGroupRounds } from './versusGroupView';

export interface VersusRecordRound {
  round: number;
  /** From my side. */
  result: 'win' | 'lose' | 'draw';
  /** Health and Armor after this round (R-VERSUS-HEALTH-01). A hearts-era round (before 2026-10-26) shows its hearts
   *  as the Health, no Armor. */
  myHp: number;
  myArmor: number;
  foeHp: number;
  foeArmor: number;
  /** The two boards as they entered the fight. */
  mine: BoardMinion[];
  foe: BoardMinion[];
  /** Each player's runes as of that round's lock (the recorded scouts; empty on a round recorded before scouts). */
  myRunes: string[];
  foeRunes: string[];
  /** The grown value of each player's self-improving runes going INTO this round (R-RUNE-LIVE-TEXT-01), folded from
   *  the fights before it, so the rune hover prints the number it really had. Optional: an older record. */
  myRuneLive?: RuneLiveState;
  foeRuneLive?: RuneLiveState;
  /** The fight's starting snapshots (`CombatResult.initial`, stored whole on the round row): what the right-click
   *  inspect reads (live text inputs, keywords, gilded, the buff breakdown). Optional: a record built before this. */
  mineSnap?: MinionSnapshot[];
  foeSnap?: MinionSnapshot[];
  /** Each player's shop tier at that round's lock (the scouts), for the inspect's tier-reading text. */
  myTier?: number;
  foeTier?: number;
  /** VERSUS GROUP: who I fought this round (another player, or "Copy of X"), when it is not the record's one foe. */
  foeName?: string;
  foeHero?: string | null;
}

/** VERSUS GROUP's table in the record (R-VERSUS-GROUP-07): every player, their final (or current) place, Health and Armor. */
export interface VersusRecordSeat {
  name: string;
  heroId: string | null;
  placement: number | null;
  hp: number;
  armor: number;
  me: boolean;
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
  myHp: number;
  myArmor: number;
  foeHp: number;
  foeArmor: number;
  rounds: VersusRecordRound[];
  /** VERSUS GROUP (3-4 players): my place of `of`, and the whole table (standings order). Absent on a 1v1 record. */
  placement?: number | null;
  of?: number;
  table?: VersusRecordSeat[];
}

/** A seat's pools on a row: the Health + Armor columns, else a hearts-era row's hearts (shown as the Health), else `start`. */
function poolOn(health: number | null | undefined, armor: number | null | undefined, hearts: number | null | undefined, start: { health: number; armor: number }): { hp: number; armor: number } {
  if (health != null) return { hp: Math.max(0, health), armor: Math.max(0, armor ?? 0) };
  if (hearts != null) return { hp: Math.max(0, hearts), armor: 0 };
  return { hp: start.health, armor: start.armor };
}

const boardOf = (ms: readonly MinionSnapshot[] | undefined): BoardMinion[] =>
  (ms ?? []).map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health, keywords: [...(m.keywords ?? [])], ...(m.golden ? { golden: true } : {}) }));

export function buildVersusMatchRecord(
  match: VersusMatch, rounds: Record<number, VersusRoundRow>, seat: VersusSeat, myCosmetics: RunCosmeticSnapshot | null,
  foeCosmetics: RunCosmeticSnapshot | null = null,
): VersusMatchRecord {
  const other: VersusSeat = seat === 'p1' ? 'p2' : 'p1';
  const rows = Object.values(rounds).sort((a, b) => a.round - b.round);
  const startOf = (s: VersusSeat) => versusStartingVitals(s === 'p1' ? match.p1_hero : match.p2_hero, match.options);
  const myEnd = poolOn(seat === 'p1' ? match.p1_health : match.p2_health, seat === 'p1' ? match.p1_armor : match.p2_armor, seat === 'p1' ? match.p1_hearts : match.p2_hearts, startOf(seat));
  const foeEnd = poolOn(other === 'p1' ? match.p1_health : match.p2_health, other === 'p1' ? match.p1_armor : match.p2_armor, other === 'p1' ? match.p1_hearts : match.p2_hearts, startOf(other));
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
    myHp: myEnd.hp, myArmor: myEnd.armor, foeHp: foeEnd.hp, foeArmor: foeEnd.armor,
    rounds: rows.map((r, i) => {
      const mine = (seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult;
      const before = rows.slice(0, i).map((p) => (seat === 'p1' ? p.p1_result : p.p2_result) as CombatResult | null);
      const my = poolOn(seat === 'p1' ? r.p1_health : r.p2_health, seat === 'p1' ? r.p1_armor : r.p2_armor, seat === 'p1' ? r.p1_hearts : r.p2_hearts, startOf(seat));
      const foe = poolOn(other === 'p1' ? r.p1_health : r.p2_health, other === 'p1' ? r.p1_armor : r.p2_armor, other === 'p1' ? r.p1_hearts : r.p2_hearts, startOf(other));
      return {
        round: r.round,
        result: mine.result,
        myHp: my.hp, myArmor: my.armor, foeHp: foe.hp, foeArmor: foe.armor,
        mine: boardOf(mine.initial?.player),
        foe: boardOf(mine.initial?.enemy),
        myRunes: [...((seat === 'p1' ? r.p1_scout : r.p2_scout)?.runes ?? [])],
        foeRunes: [...((other === 'p1' ? r.p1_scout : r.p2_scout)?.runes ?? [])],
        myRuneLive: runeLiveStateOfCarries(before.map((b) => runeCarryOf(b, 'player'))),
        foeRuneLive: runeLiveStateOfCarries(before.map((b) => runeCarryOf(b, 'enemy'))),
        mineSnap: [...(mine.initial?.player ?? [])],
        foeSnap: [...(mine.initial?.enemy ?? [])],
        myTier: (seat === 'p1' ? r.p1_scout : r.p2_scout)?.tier,
        foeTier: (other === 'p1' ? r.p1_scout : r.p2_scout)?.tier,
      };
    }),
  };
}

/**
 * VERSUS GROUP's "Previous match stats" (owner ask 2026-10-24, R-VERSUS-GROUP-07): my fights round by round (each with
 * the player, or Copy, I fought that round) plus the whole table: every player's place, Health and Armor. Built from the raw
 * group rows from MY seat (never the spectator view a player who is out is shown later), so it reads the same whenever it
 * is (re)built; rebuilt as the table finishes so the places fill in.
 */
export function buildGroupMatchRecord(
  raw: VersusGroupMatchRaw, rounds: readonly VersusGroupRoundRaw[], me: string, myCosmetics: RunCosmeticSnapshot | null,
  cosmeticsOf: (userId: string) => RunCosmeticSnapshot | null = () => null,
): VersusMatchRecord | null {
  const mine = groupSeatOf(raw, me);
  if (!mine) return null;
  const view = projectGroupMatch(raw, me);
  const rows = projectGroupRounds(raw, rounds, me);
  const base = buildVersusMatchRecord(view, rows, 'p1', myCosmetics, view.group?.foe ? cosmeticsOf(raw.seats.find((x) => x.seat === view.group!.foe!.seat)?.userId ?? '') : null);
  const nameOf = (seat: VersusGroupSeat, copy: boolean): string => {
    const r = raw.seats.find((x) => x.seat === seat);
    return r ? (copy ? copyName(r.name) : r.name) : '';
  };
  const recRounds = base.rounds.map((r) => {
    const g = rows[r.round]?.group;
    const f = g ? g.fights.find((x) => x.a_seat === mine.seat || (x.b_seat === mine.seat && !x.b_copy)) : null;
    if (!f) return r;
    const foe = f.a_seat === mine.seat ? { seat: f.b_seat, copy: f.b_copy } : { seat: f.a_seat, copy: false };
    return { ...r, foeName: nameOf(foe.seat, foe.copy), foeHero: raw.seats.find((x) => x.seat === foe.seat)?.hero ?? null };
  });
  const won = raw.phase === 'complete' && raw.winner_seat === mine.seat;
  const placement = won ? 1 : mine.placement;
  // Duos and RANKED DUOS (the recorded teams ride the row as virtual seats, `withServedSeats`): every row on its team's pool.
  const ranked = raw.options?.mode === 'ranked_duos';
  const duos = raw.options?.mode === 'duos' || ranked;
  const table = [...raw.seats]
    .map((x) => {
      const start = duos ? versusDuosStartingVitals(x.hero, raw.seats.find((y) => y.seat === duosMateOf(x.seat))?.hero, raw.options) : versusStartingVitals(x.hero, raw.options);
      const pool = poolOn(x.health, x.armor, x.hearts, start);
      return { name: x.name, heroId: x.hero, placement: raw.phase === 'complete' && raw.winner_seat === x.seat ? 1 : x.placement, hp: pool.hp, armor: pool.armor, me: x.seat === mine.seat };
    })
    .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0) || (b.hp + b.armor) - (a.hp + a.armor));
  return {
    ...base,
    outcome: placement === 1 ? 'win' : placement != null ? 'lose' : 'none',
    rounds: recRounds,
    placement,
    of: ranked ? 4 : raw.seat_count, // Ranked Duos places TEAMS, 1st to 4th
    table,
  };
}
