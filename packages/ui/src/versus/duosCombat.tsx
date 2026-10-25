/**
 * VERSUS DUOS — THE HAND-OFF ON SCREEN (owner 2026-10-25: "boards flying in after one another"; R-DUOS-TAGTEAM-01).
 *
 * The fight itself is one ordinary combat replay: a `tagIn` event replaces that side's row with the teammate's board,
 * whose bodies fly in (`.unit.tagin`, styles.css). This module adds the two things a replay alone cannot know:
 *  - WHO is fighting now: once the other team's second board steps in, the combat opponent's portrait and name are
 *    that player's (`useDuosCombat.foeSeatId`, read by CombatOpponent);
 *  - the "steps in" PLATE: the stepping-in player's portrait (the foe portrait disc, their hero and skin) and their
 *    name on the game's name pill, on their team's side, for the length of the hand-off beats. One-shot keyframe on a
 *    keyed element, transform / opacity only.
 * Both are derived from the result's own `duosFirst` + the match's seats: pure reads, no network.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { CombatEvent, CombatResult } from '@game/core';
import { duosMateOf, duosTeamOf, type VersusGroupSeat } from '@game/sim';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { heroPortrait } from '../skins/skinArt';
import { opponentSkins } from '../skins/skins';
import { parseCosmeticSnapshot } from '@game/progression';
import { useGame } from '../store';
import { useVersus } from './versusStore';
import { useSpectate } from './spectate';
import { duosLobbySeatId } from './versusGroupView';

interface DuosCombatState {
  /** The rail seat id of the board the opponent side is fighting with right now (null = the forced opponent). */
  foeSeatId: string | null;
  /** The latest hand-off on screen: which side, whose board, and its event index (keys the plate). */
  tag: { side: 'player' | 'enemy'; seat: VersusGroupSeat; at: number } | null;
}
export const useDuosCombat = create<DuosCombatState>(() => ({ foeSeatId: null, tag: null }));

/** The seat whose board fights on `side` after `tagIns` hand-offs there (0 = the team's first board). */
function activeSeat(result: CombatResult, viewer: VersusGroupSeat, side: 'player' | 'enemy', tagged: boolean): VersusGroupSeat | null {
  const first = result.duosFirst;
  if (!first) return null;
  const mine = duosTeamOf(viewer);
  const team = side === 'player' ? mine : mine === 'a' ? 'b' : 'a';
  const head = first[team as 'a' | 'b'] as VersusGroupSeat;
  return tagged ? duosMateOf(head) : head;
}

/** Recruit calls this with the replay's cursor: keeps `useDuosCombat` in step with the fight on screen. */
export function useDuosCombatSync(combat: CombatResult | undefined, events: readonly CombatEvent[], processedEnd: number, fighting: boolean): void {
  const viewer = useVersus((s) => s.match?.group?.me ?? null);
  const watched = useSpectate((s) => (s.active ? s.seat : null));
  const raw = useVersus((s) => s.match?.group?.raw ?? null);
  const seat = viewer ?? watched;
  useEffect(() => {
    if (!fighting || !combat?.duosFirst || !seat || !raw) {
      if (useDuosCombat.getState().foeSeatId || useDuosCombat.getState().tag) useDuosCombat.setState({ foeSeatId: null, tag: null });
      return;
    }
    let enemyTagged = false;
    let last: DuosCombatState['tag'] = null;
    const end = Math.min(processedEnd, events.length);
    for (let i = 0; i < end; i++) {
      const e = events[i];
      if (e?.type !== 'tagIn') continue;
      if (e.side === 'enemy') enemyTagged = true;
      const s = activeSeat(combat, seat, e.side, true);
      if (s) last = { side: e.side, seat: s, at: i };
    }
    const foeSeat = enemyTagged ? activeSeat(combat, seat, 'enemy', true) : null;
    const foeSeatId = foeSeat ? duosLobbySeatId(raw, seat, foeSeat) : null;
    const cur = useDuosCombat.getState();
    if (cur.foeSeatId !== foeSeatId || cur.tag?.at !== last?.at) useDuosCombat.setState({ foeSeatId, tag: last });
  }, [combat, events, processedEnd, fighting, seat, raw]);
}

/** How long the plate stays (ms): the boardFallen + tagIn beats at combat speed 1, then it is gone. */
const PLATE_MS = 1700;

/** The "steps in" plate for the latest hand-off. */
export const DuosTagInPlate = memo(function DuosTagInPlate(): JSX.Element | null {
  const tag = useDuosCombat((s) => s.tag);
  const raw = useVersus((s) => s.match?.group?.raw ?? null);
  const members = useVersus((s) => s.room?.members ?? null);
  const showOppSkins = useGame((s) => s.showOpponentSkins);
  const runCos = useGame((s) => s.run.cosmetics);
  const viewer = useVersus((s) => s.match?.group?.me ?? null);
  const [shownAt, setShownAt] = useState<number | null>(null);
  useEffect(() => {
    if (tag == null) { setShownAt(null); return undefined; }
    setShownAt(tag.at);
    const t = window.setTimeout(() => setShownAt((x) => (x === tag.at ? null : x)), PLATE_MS);
    return () => window.clearTimeout(t);
  }, [tag]);
  const row = tag && raw ? raw.seats.find((x) => x.seat === tag.seat) ?? null : null;
  const art = useMemo(() => {
    if (!row) return undefined;
    if (row.seat === viewer) return heroPortrait(row.hero, runCos ?? null);
    const cos = parseCosmeticSnapshot(members?.find((m) => m.userId === row.userId)?.profile?.cosmetics) ?? undefined;
    return heroPortrait(row.hero, opponentSkins(showOppSkins, cos));
  }, [row, viewer, runCos, members, showOppSkins]);
  if (!tag || !row || shownAt !== tag.at) return null;
  return (
    <div key={tag.at} className={`duostag duostag-${tag.side}`} aria-live="polite">
      <FoePortraitDisc art={art} gauntlet={false} frame={null} extraClass=" duostag-disc" />
      <span className="duostag-name hudpill-name">{row.seat === viewer ? 'You step in' : `${row.name} steps in`}</span>
    </div>
  );
});
