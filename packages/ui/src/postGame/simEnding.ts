/**
 * DEV ONLY: A SIMULATED ENDING (owner 2026-11-27: "add a scene builder option for me to end game as x place. make sure it doesnt grant
 * mmr and it is just a simulated experience so i can see the full workflow").
 *
 * The Scene Builder's "Play ending" runs the REAL presentation, start to finish, on a copy of the table: the gate shuts, the crystal
 * forms, the journey to Terys Gate in the place's colour, the result, a rank change of the chosen kind (its bar animating, a set-up
 * locking gold or red), an Account XP gain, then the lobby rows. It goes nowhere near the reducer's run end: no rating is submitted,
 * no match, career, replay or ledger record is written, nothing is uploaded (the Scene Builder run is `sandbox` besides). The rank and
 * the XP shown are made up here and live only in this module and the progression store's on-screen slot until the screen is left.
 */
import { create } from 'zustand';
import { buildMatchDetails, type RunState } from '@game/sim';
import type { ProgressionResult } from '@game/progression';
import { useGame } from '../store';
import { useProgression } from '../progression/progressionStore';
import { requestRankedGate } from '../rankedGate/rankedGateController';
import { holdPostGame, postGameJourney } from '../locationReveal/postGame';
import { currentRankOf } from '../rank/rankSource';
import type { RankPosition, RankResult } from '../rank/types';
import { playPlacementTone } from '../placementTone';
import { closeSceneBuilderPanel } from '../sceneBuilderPanel';

export type SimRank = 'none' | 'gain' | 'loss' | 'promotion' | 'demotion';
export const SIM_RANKS: readonly { id: SimRank; label: string }[] = [
  { id: 'none', label: 'Unrated' }, { id: 'gain', label: 'Gain' }, { id: 'loss', label: 'Loss' },
  { id: 'promotion', label: 'Promotion set-up' }, { id: 'demotion', label: 'Demotion set-up' },
];

/** The simulated ending on screen, if any: the end screen reads its rank from here instead of the store's real one. */
export const useSimEnding = create<{ active: boolean; rank: RankResult | null; capability?: string }>(() => ({ active: false, rank: null }));

/** A made-up rank result of the chosen kind, from `pos` (the player's real standing, or Gold II 60). */
export function simRankResult(kind: SimRank, place: number, pos: RankPosition): RankResult | null {
  if (kind === 'none') return null;
  const at = (p: number): RankPosition => ({ divisionIndex: pos.divisionIndex, points: Math.max(0, Math.min(100, Math.round(p))) });
  const before = kind === 'promotion' ? at(88) : kind === 'demotion' ? at(10) : at(Math.min(80, Math.max(20, pos.points)));
  const after = kind === 'promotion' ? at(100) : kind === 'demotion' ? at(0) : kind === 'gain' ? at(before.points + 18) : at(before.points - 18);
  const baseDelta = kind === 'promotion' ? 40 : kind === 'demotion' ? -40 : kind === 'gain' ? 18 : -18;
  const appliedDelta = after.points - before.points;
  return {
    runId: `sim-${Date.now()}`, seasonId: 0, rulesVersion: 1, revisionBefore: 0, revisionAfter: 0, placement: place,
    before, after, baseDelta, appliedDelta, cappedPoints: Math.abs(baseDelta - appliedDelta),
    wasPromotionGame: false, promotionKind: null, requiredFinish: null, promotionUnlocked: kind === 'promotion', promoted: false, demoted: false,
    wasDemotionGame: false, demotionUnlocked: kind === 'demotion', strengthBonus: 0, lobbyStrength: null,
    highestAfter: { ...(appliedDelta >= 0 ? after : before) },
  } as RankResult;
}

/** The table as it would stand if the game had just ended with the player at `place`: every other seat given a place around it. */
export function endedRun(run: RunState, place: number): RunState {
  const lobby = run.lobby!;
  const n = lobby.seats.length;
  const p = Math.max(1, Math.min(n, Math.round(place)));
  const others = lobby.seats.slice(1).map((s) => ({ ...s })).sort((a, b) => (b.resolve + b.armor) - (a.resolve + a.armor));
  const places = Array.from({ length: n }, (_, i) => i + 1).filter((k) => k !== p);
  others.forEach((s, i) => {
    const k = places[i]!;
    s.placement = k;
    s.alive = k === 1;
    if (k !== 1) { s.resolve = 0; s.armor = 0; s.eliminatedRound = Math.max(1, lobby.round - (k - 1)); }
  });
  const me = { ...lobby.seats[0]!, placement: p, alive: p === 1, ...(p === 1 ? {} : { resolve: 0, armor: 0, eliminatedRound: lobby.round }) };
  return { ...run, phase: 'gameover', ...(p === 1 ? {} : { resolve: 0, armor: 0 }), lobby: { ...lobby, finished: true, seats: [me, ...others] } } as RunState;
}

/** The run's own board as the match record shows it. */
const selfBoardOf = (run: RunState) => ({
  minions: run.board.map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health, keywords: m.keywords ?? [], golden: !!m.golden })),
  tier: run.tier, runes: [...(run.ownedRunes ?? [])],
}) as Parameters<typeof buildMatchDetails>[1]['selfBoard'];

/** Play the whole ending as `place`, with a rank change of `rank`. Returns a reason it cannot, or null. */
export function playSimulatedEnding(place: number, rank: SimRank): string | null {
  const st = useGame.getState();
  const run = st.run as RunState;
  if (!run.lobby) return 'Start a Scene Builder game (it needs a table).';
  if (run.phase === 'gameover' || run.phase === 'victory') return 'This game has already ended.';
  const ended = endedRun(run, place);
  const p = ended.lobby!.seats[0]!.placement!;
  let details = null;
  try { details = buildMatchDetails(ended.lobby!, { name: 'You', placement: p, selfBoard: selfBoardOf(run) }); } catch (e) { console.warn('[simEnding] no match details', e); }
  const result = simRankResult(rank, p, currentRankOf(st) ?? { divisionIndex: 7, points: 60 });
  const xp = simXp(p, String(ended.seed));
  const journey = postGameJourney(ended, () => { playPlacementTone(useGame.getState().run, 260); });
  if (!journey) return 'No journey to play.';
  closeSceneBuilderPanel(); // out of the way of the results (the dev menu brings it back)
  void requestRankedGate(() => {
    holdPostGame(true);
    useSimEnding.setState({ active: true, rank: result, capability: useProgression.getState().capability });
    useProgression.setState({ capability: 'on', current: xp });
    useGame.setState({ run: ended, lastMatch: details ? { seed: ended.seed, details } : null });
  }, 'entry', { reveal: journey, word: false }).finally(() => holdPostGame(false));
  return null;
}

/** The made-up Account XP of the ending (the post-game panel reads the progression store's current slot). */
function simXp(place: number, localKey: string) {
  const base = 100;
  const topFour = place <= 4 ? 50 : 0;
  const firstPlace = place === 1 ? 50 : 0;
  const total = base + topFour + firstPlace;
  const before = 1180;
  const result: ProgressionResult = {
    runId: `sim-${Date.now()}`, mode: 'practice', rulesVersion: 1, placement: place, comeback: false,
    xp: { base, topFour, firstPlace, comeback: 0, total },
    before: { lifetimeXp: before, level: 0 }, after: { lifetimeXp: before + total, level: 0 },
    unlockedTitles: [], cratesAwarded: 0, crateIds: [], achievements: [], achievementXp: 0, aether: null, aetherBalance: null,
    revisionAfter: 0, settledAt: null, accountXp: before + total, accountLevel: 0, revision: 0, equippedTitleId: null, titles: [],
  } as unknown as ProgressionResult; // no achievements, crates or titles: nothing to toast, open or grant
  return { localKey, mode: 'practice' as const, runId: result.runId, state: 'confirmed' as const, result, deduped: false, error: null };
}

/** Leave the simulated ending: its rank and XP go with it. */
export function clearSimEnding(): void {
  const s = useSimEnding.getState();
  if (!s.active) return;
  useSimEnding.setState({ active: false, rank: null });
  useProgression.setState({ current: null, ...(s.capability ? { capability: s.capability as never } : {}) });
}
