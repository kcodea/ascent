import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RoundMark, RoundStat } from '@game/sim';
import { useGame } from '../store';
import { replayRoundInfo, replayRoundMarks, replayRoundStats, seekReplayPhase, type RoundInfo } from './replayPlayer';
import { statsByWave } from './roundDrawer';
import { clampRailOffset, loadRailPlacement, saveRailPlacement, type RailPlacement } from './railPlacement';

/**
 * REPLAY VIEWER round rail (§7.1 of docs/replay-v2-handoff.md) — a per-round index over the replay, visible
 * only during playback, that doubles as the coarse position indicator (the transport bar handles fine
 * scrubbing within a round).
 *
 * REWORKED 2026-09-19 (owner handoff):
 *  - ONE TABLE, one row per round: Round · Recruit · Combat · Gold · Acts · Tier · Win %. The old
 *    slide-out metrics dock (2026-08-19) is folded in as columns — same numbers, same `rollupRounds` fold.
 *  - TWO CLICKABLE CELLS per round: Recruit seeks to the round's shop opening; Combat lands ON the fight, which
 *    then plays from its start (`seekReplayPhase`). The cell playback is currently IN highlights.
 *  - (The Power column — `boardPowerOf` over the end-of-recruit board — was removed 2026-09-19, owner: "this stat
 *    is not great right now"; the scorer stays in the sim for the balance tools.) Win % = the odds the game computed
 *    for that fight — the exact stamped number on new recordings, a `~`-marked idle-time estimate on old ones,
 *    "—" until it lands (`replayRoundInfo` + `roundInfoTick`).
 *  - COLLAPSIBLE (a slim handle showing the current round) and DRAGGABLE FROM ANYWHERE on its surface (owner
 *    2026-09-20: "literally anywhere should drag it"; the ⋮⋮ grip stays as the affordance). A pointerdown
 *    anywhere on the rail ARMS a drag; it becomes one only once the pointer travels `DRAG_THRESHOLD_PX`, so a
 *    press-and-release on a cell / the toggle is still a plain click that reaches the button, and a press that
 *    turned into a drag swallows the click that would follow it. The placement persists per browser
 *    (`railPlacement.ts`) and is re-clamped on resize so it can never leave the screen.
 *
 * Perf: at most ~19 rows, each memoized on scalars — playback advancing a frame re-renders only the row
 * losing and the row gaining the highlight. The drag writes two CSS vars on the wrapper per pointermove (the
 * rect is measured ONCE at pointerdown) and never re-renders React until the pointer is released. The
 * collapse is a plain conditional render (one-shot, no looping animation).
 */

/** How far the pointer must travel from its press before the press counts as a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

const VERDICT_GLYPH = { win: 'W', loss: 'L', draw: 'D' } as const;

const RailRow = memo(function RailRow({ mark, goldSpent, actions, tierAtStart, info, activeCell, onShop, onCombat }: {
  mark: RoundMark;
  goldSpent: number; actions: number; tierAtStart: number | null;
  info: RoundInfo | undefined;
  /** Which of this round's cells playback is in — `null` when it is in another round. */
  activeCell: 'shop' | 'combat' | null;
  onShop: (wave: number) => void;
  onCombat: (wave: number) => void;
}): JSX.Element {
  const win = info?.winPct ?? null;
  return (
    <div className={`roundrail-row${activeCell ? ' current' : ''}`} role="row">
      <span className="roundrail-num" role="rowheader">R{mark.wave}</span>
      <button
        type="button"
        className={`roundrail-cell shop pressable${activeCell === 'shop' ? ' active' : ''}`}
        disabled={mark.shopIndex === undefined}
        onClick={() => onShop(mark.wave)}
        aria-label={`Round ${mark.wave} recruit`}
        aria-current={activeCell === 'shop' ? 'step' : undefined}
      >
        ⚒
      </button>
      <button
        type="button"
        className={`roundrail-cell combat pressable${activeCell === 'combat' ? ' active' : ''}`}
        disabled={mark.combatIndex === undefined}
        onClick={() => onCombat(mark.wave)}
        aria-label={`Round ${mark.wave} combat`}
        aria-current={activeCell === 'combat' ? 'step' : undefined}
      >
        {mark.result
          ? <span className={`roundrail-verdict ${mark.result}`}>{VERDICT_GLYPH[mark.result]}</span>
          : <span className="roundrail-verdict none">·</span>}
        {mark.resolveLost != null && mark.resolveLost > 0 && <span className="roundrail-loss">−{mark.resolveLost}</span>}
      </button>
      <span className="roundrail-val">{goldSpent}</span>
      <span className="roundrail-val">{actions}</span>
      <span className="roundrail-val">{tierAtStart ?? '—'}</span>
      <span
        className={`roundrail-val win${win === null ? '' : win >= 50 ? ' good' : ' bad'}`}
        aria-label={win === null
          ? 'Win chance not yet computed'
          : info?.winApprox
            ? 'Estimated from the recorded boards (this recording predates stamped odds)'
            : 'The win chance the game computed for this fight at End Turn'}
      >
        {win === null ? '—' : `${info?.winApprox ? '~' : ''}${win}%`}
      </span>
    </div>
  );
});

export function RoundRail(): JSX.Element | null {
  const session = useGame((st) => st.replaySession);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<RailPlacement>(() => loadRailPlacement());
  /** The press in progress: ARMED from pointerdown (a click until proven otherwise), DRAGGING once the pointer
   *  has travelled the threshold (written to CSS vars per move; committed to state on release). */
  const dragRef = useRef<{ startX: number; startY: number; dx0: number; dy0: number; rect: DOMRect; vw: number; vh: number; pointerId: number; dragging: boolean; last: { dx: number; dy: number } | null } | null>(null);
  /** Set when a press ended as a drag, so the click the browser fires next is swallowed before a cell sees it. */
  const swallowClickRef = useRef(false);
  const placementRef = useRef(placement);
  placementRef.current = placement;

  // The marks and the rollup are computed once per startReplay and stable for the whole playback — memo on
  // the session's EXISTENCE (a fresh replay is a fresh session object chain starting from null).
  const marks = useMemo(() => (session ? replayRoundMarks() : []), [session != null]);
  const byWave = useMemo<Map<number, RoundStat>>(
    () => (session ? statsByWave(replayRoundStats()) : new Map()),
    [session != null],
  );
  // Win % fills in as the idle backfill lands (the tick bumps per landed round).
  const infoByWave = useMemo<Map<number, RoundInfo>>(() => {
    const m = new Map<number, RoundInfo>();
    if (session) for (const i of replayRoundInfo()) m.set(i.wave, i);
    return m;
  }, [session != null, session?.roundInfoTick]);

  /** Stable handlers so the memoized rows never re-render for handler identity. */
  const onShop = useCallback((wave: number) => { seekReplayPhase(wave, 'shop'); }, []);
  const onCombat = useCallback((wave: number) => { seekReplayPhase(wave, 'combat'); }, []);

  /** Reflect the committed offset onto the wrapper (the drag writes the same vars directly mid-gesture). */
  const applyVars = (el: HTMLElement, dx: number, dy: number): void => {
    el.style.setProperty('--rrl-dx', `${Math.round(dx)}px`);
    el.style.setProperty('--rrl-dy', `${Math.round(dy)}px`);
  };
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el) applyVars(el, placement.dx, placement.dy);
  }, [placement.dx, placement.dy, session != null, placement.collapsed]);

  // On RESIZE (or the rail changing shape), re-clamp so a rail parked at the old edge is still reachable. One
  // rect read per resize event — never per frame.
  useEffect(() => {
    if (!session) return;
    const onResize = (): void => {
      const el = wrapRef.current;
      if (!el) return;
      const cur = placementRef.current;
      const next = clampRailOffset(cur, cur, el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
      if (next.dx !== cur.dx || next.dy !== cur.dy) {
        const p = { ...cur, ...next };
        setPlacement(p);
        saveRailPlacement(p);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [session != null, placement.collapsed]);

  const onRailDown = (e: React.PointerEvent<HTMLElement>): void => {
    const el = wrapRef.current;
    if (!el || e.button !== 0) return;
    // ARM only — no preventDefault, no capture: a plain click must still reach the cell / toggle underneath.
    const cur = placementRef.current;
    // ONE layout read for the whole gesture: the rail's box now, and the viewport. Every move is arithmetic.
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, dx0: cur.dx, dy0: cur.dy,
      rect: el.getBoundingClientRect(), vw: window.innerWidth, vh: window.innerHeight,
      pointerId: e.pointerId, dragging: false, last: null,
    };
  };
  const onRailMove = (e: React.PointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    const el = wrapRef.current;
    if (!d || !el) return;
    const mx = e.clientX - d.startX, my = e.clientY - d.startY;
    if (!d.dragging) {
      if (Math.abs(mx) < DRAG_THRESHOLD_PX && Math.abs(my) < DRAG_THRESHOLD_PX) return; // still a click
      d.dragging = true;
      try { el.setPointerCapture(d.pointerId); } catch { /* unsupported */ }
      el.classList.add('dragging');
    }
    const next = clampRailOffset(
      { dx: d.dx0 + mx, dy: d.dy0 + my },
      { dx: d.dx0, dy: d.dy0 }, d.rect, { width: d.vw, height: d.vh },
    );
    applyVars(el, next.dx, next.dy); // the cached rect stays valid: it is the box under dx0/dy0, and the clamp maps through the delta
    d.last = next;
  };
  const onRailUp = (): void => {
    const d = dragRef.current;
    dragRef.current = null;
    const el = wrapRef.current;
    if (!d?.dragging) return; // a click — let the browser deliver it to whatever was pressed
    el?.classList.remove('dragging');
    try { el?.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
    swallowClickRef.current = true;
    if (!d.last) return;
    const p = { ...placementRef.current, dx: d.last.dx, dy: d.last.dy };
    setPlacement(p);
    saveRailPlacement(p);
  };
  /** The click that follows a drag-release lands on whatever the pointer was over — never a seek / toggle. */
  const onRailClickCapture = (e: React.MouseEvent<HTMLElement>): void => {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const toggleCollapsed = (): void => {
    const p = { ...placementRef.current, collapsed: !placementRef.current.collapsed };
    setPlacement(p);
    saveRailPlacement(p);
  };

  if (!session || marks.length === 0) return null;

  // The grip is an AFFORDANCE now — the drag handlers live on the wrapper, so any point of the rail drags it.
  const grab = (
    <span className="roundrail-grab" aria-hidden="true">
      ⋮⋮
    </span>
  );
  const dragProps = {
    onPointerDown: onRailDown,
    onPointerMove: onRailMove,
    onPointerUp: onRailUp,
    onPointerCancel: onRailUp,
    onClickCapture: onRailClickCapture,
  };

  if (placement.collapsed) {
    return (
      <div className="roundrail-wrap collapsed" ref={wrapRef} {...dragProps}>
        <div className="roundrail-mini" role="group" aria-label="Replay rounds (collapsed)">
          {grab}
          <span className="roundrail-mini-round">
            {session.ended ? 'Final' : `R${session.round}`}
            <i className="roundrail-mini-phase">{session.ended ? '' : session.phase === 'combat' ? ' ⚔' : ' ⚒'}</i>
          </span>
          <button type="button" className="roundrail-toggle pressable" onClick={toggleCollapsed} aria-label="Expand the round rail" aria-expanded={false}>▸</button>
        </div>
      </div>
    );
  }

  return (
    <div className="roundrail-wrap" ref={wrapRef} {...dragProps}>
      <nav className="roundrail" aria-label="Replay rounds">
        <div className="roundrail-bar">
          {grab}
          <span className="roundrail-title">Rounds</span>
          <button type="button" className="roundrail-toggle pressable" onClick={toggleCollapsed} aria-label="Collapse the round rail" aria-expanded={true}>◂</button>
        </div>
        {/* PARTIAL recording: state the recorded range BEFORE playback rather than letting a rail that starts
            at R7 read as "rounds were filtered out". Since draft persistence shipped (2026-08-20) an ordinary
            quit-and-resume records in full, so this is the honest label for the cases that failed anyway —
            a pre-persistence recording, or storage that refused. */}
        {session.partial && (
          <div className="roundrail-partial" aria-label="This recording does not cover the whole run. The earlier rounds were never captured.">
            <span className="roundrail-partial-tag">Partial replay</span>
            <span className="roundrail-partial-range">Rounds {session.partial.firstWave}–{session.partial.lastWave} recorded</span>
          </div>
        )}
        <div className="roundrail-grid" role="table" aria-label="Rounds">
          <div className="roundrail-head" role="row">
            <span role="columnheader">Round</span>
            <span role="columnheader" aria-description="Jump to the round's shop">Recruit</span>
            <span role="columnheader" aria-description="Play the round's fight from its start">Combat</span>
            <span role="columnheader" aria-description="Gold spent this round">Gold</span>
            <span role="columnheader" aria-description="Actions this turn">Acts</span>
            <span role="columnheader" aria-description="Shop tier at the start of the turn">Tier</span>
            <span role="columnheader" aria-description="The game's computed chance of winning the round's fight">Win %</span>
          </div>
          {marks.map((m) => {
            const s = byWave.get(m.wave);
            return (
              <RailRow
                key={m.wave}
                mark={m}
                goldSpent={s?.goldSpent ?? 0}
                actions={s?.actions ?? 0}
                tierAtStart={s?.tierAtStart ?? null}
                info={infoByWave.get(m.wave)}
                activeCell={!session.ended && m.wave === session.round ? (session.phase === 'combat' ? 'combat' : 'shop') : null}
                onShop={onShop}
                onCombat={onCombat}
              />
            );
          })}
        </div>
      </nav>
    </div>
  );
}
