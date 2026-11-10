/**
 * THE SMALL DUOS SIGNALS (2026-11-10, owner: "make the beats much stronger for duos"). Three moments
 * a teammate causes, or shares, that changed the screen with no sound at all:
 *
 *  - THE TEAMMATE VIEW opens or closes (Tab / their portrait). Its six call sites ring `sfx.tick`, which the owner
 *    silenced for every menu control on 2026-11-06, so the swap was mute. A soft two-note cue up (onto their screen)
 *    or down (back to mine).
 *  - MY TEAMMATE JOINS THE PARTY: the seat beside mine fills while we sit in a Duos room. The team motif.
 *  - THE ROUND CLOSES ON US: everyone is locked in and the round's fight has arrived. One low note as the game starts
 *    its End Turn, so the hand-over from the held shop reads as "locked in", not "stuck". (Sound only: the held board stays exactly as it is, as
 *    VersusHud's design says.)
 *
 * THE ANNOUNCER IN RANKED DUOS hangs off the same listener: it tells the announcer when the
 * match on screen is a Ranked Duos game (a run does not say which Versus mode it is), and speaks the team's result
 * line when the team is knocked out or its result opens (once per match), with RankUp after it on a promotion.
 *
 * It only LISTENS: two store subscriptions, installed once by `DuosSignals` (mounted beside the game's other Versus
 * layers), comparing the two or three fields each cue keys on. No rendering, no timers, nothing per frame. It never
 * touches the teammate view, the dock or the store (other owners): the cues hang off state those already publish.
 */
import { useEffect } from 'react';
import { duosMateOf, type VersusGroupSeat } from '@game/sim';
import { currentUserId } from '../identity';
import { sfx } from '../sfx';
import { announceTeamRankUp, announceTeamResult, cancelTeamResultLine, setAnnouncerDuosTable } from '../announcer';
import { isRankedDuosRaw } from './rankedDuosView';
import { isDuosRaw } from './versusGroupView';
import { useSpectate } from './spectate';
import { useVersus, type VersusState } from './versusStore';

type Slice = Pick<VersusState, 'room' | 'match' | 'endTurnWave'>;
type ResultSlice = Pick<VersusState, 'match' | 'knockout' | 'duosResult'>;

/** What the announcer should say about my team's result on this update, given what was already said. Pure.
 *  `said`: the match whose end line was spoken; `ranked`: the match whose RankUp was. */
export function teamResultLine(s: ResultSlice, said: string | null, ranked: string | null): { match: string; placement: number | null; rankUp: boolean } | null {
  const res = s.duosResult;
  if (res) {
    const rankUp = !!res.result?.promoted && ranked !== res.matchId;
    if (said !== res.matchId) return { match: res.matchId, placement: res.placement, rankUp };
    return rankUp ? { match: res.matchId, placement: null, rankUp: true } : null;
  }
  const ko = s.knockout;
  const raw = s.match?.group?.raw;
  if (ko && raw && raw.id === ko.matchId && isRankedDuosRaw(raw) && said !== ko.matchId) return { match: ko.matchId, placement: ko.placement ?? 4, rankUp: false };
  return null;
}

const DUOS_MODES: ReadonlySet<string> = new Set(['duos', 'ranked_duos']);
const SEATS: ReadonlySet<string> = new Set(['p1', 'p2', 'p3', 'p4']);

/** The room I sit in as a Duos player and who holds the seat beside mine (null = empty). Null when this is not a Duos
 *  room, or I hold no seat in it. Pure. */
export function partyMate(s: Slice, me: string | null): { room: string; mate: string | null } | null {
  const room = s.room;
  if (!room || !me || !DUOS_MODES.has(String(room.options?.mode ?? ''))) return null;
  const mine = room.members.find((m) => m.userId === me);
  if (!mine || !SEATS.has(mine.role)) return null;
  const seat = duosMateOf(mine.role as VersusGroupSeat);
  return { room: room.id, mate: room.members.find((m) => m.role === seat)?.userId ?? null };
}

/** Did my teammate just sit down? True only when the same room went from an empty mate seat to a taken one. Pure. */
export function mateJoined(prev: ReturnType<typeof partyMate>, next: ReturnType<typeof partyMate>): boolean {
  return !!prev && !!next && prev.room === next.room && prev.mate === null && next.mate !== null;
}

/**
 * The Duos round that has CLOSED for me, a seated player: `<match>|<wave>` once the round's fight is in and the game is
 * playing its real End Turn (the store's `endTurnWave`), else ''.
 *
 * Not the match row's `phase`: found live, this client's row still read `shop` for seconds after the fight was already
 * on screen (the fight arrives through its own channel, ahead of the row), so a cue keyed on `shop -> resolving` never
 * rang. `endTurnWave` is the store's own "the round closed and its fight is here" mark.
 */
export function duosRoundClosing(s: Slice, me: string | null): string {
  const m = s.match;
  const raw = m?.group?.raw;
  if (!m || !me || !raw || s.endTurnWave == null || !(isDuosRaw(raw) || isRankedDuosRaw(raw))) return '';
  if (!raw.seats.some((x) => x.userId === me && !x.served)) return '';
  return `${m.id}|${s.endTurnWave}`;
}

/** Did a round just close? A closing mark that was not there on the last update. Pure. */
export function roundClosed(prev: string, next: string): boolean {
  return next !== '' && next !== prev;
}

/** Start listening. Returns the stop function. */
export function installDuosSignals(): () => void {
  const me = currentUserId;
  let watching = useSpectate.getState().teammate === true;
  const offView = useSpectate.subscribe((s) => {
    const now = s.teammate === true;
    if (now === watching) return;
    watching = now;
    // A view that closes because the match ended is not a swap the player made.
    const m = useVersus.getState().match;
    if (m && m.phase !== 'complete') sfx.duosViewSwap(now);
  });
  let mate = partyMate(useVersus.getState(), me());
  let round = duosRoundClosing(useVersus.getState(), me());
  let said: string | null = null;
  let ranked: string | null = null;
  let resultOpen = !!useVersus.getState().duosResult;
  setAnnouncerDuosTable(isRankedDuosRaw(useVersus.getState().match?.group?.raw));
  const offParty = useVersus.subscribe((s) => {
    setAnnouncerDuosTable(isRankedDuosRaw(s.match?.group?.raw));
    const line = teamResultLine(s, said, ranked);
    if (line) {
      if (line.placement !== null) { said = line.match; announceTeamResult(line.placement); }
      if (line.rankUp) { ranked = line.match; announceTeamRankUp(); }
    }
    if (resultOpen && !s.duosResult) cancelTeamResultLine(); // Continue: back to the party
    resultOpen = !!s.duosResult;
    const nextMate = partyMate(s, me());
    if (mateJoined(mate, nextMate) && (!s.match || s.match.phase === 'complete')) sfx.duosMateJoined();
    mate = nextMate;
    const nextRound = duosRoundClosing(s, me());
    if (roundClosed(round, nextRound)) sfx.duosLockedIn();
    round = nextRound;
  });
  return () => { offView(); offParty(); };
}

/** Mounts the listeners for the app's life. Renders nothing. */
export function DuosSignals(): null {
  useEffect(() => installDuosSignals(), []);
  return null;
}
