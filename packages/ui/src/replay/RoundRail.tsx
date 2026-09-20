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
 *  - COLLAPSIBLE (a slim handle showing the current round) and DRAGGABLE by its grab handle; the placement
 *    persists per browser (`railPlacement.ts`) and is re-clamped on resize so it can never leave the screen.
 *
 * Perf: at most ~19 rows, each memoized on scalars — playback advancing a frame re-renders only the row
 * losing and the row gaining the highlight. The drag writes two CSS vars on the wrapper per pointermove (the
 * rect is measured ONCE at pointerdown) and never re-renders React until the pointer is released. The
 * collapse is a plain conditional render (one-shot, no looping animation).
 */

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
        title={`Round ${mark.wave} — jump to the shop`}
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
        title={`Round ${mark.wave} — play the fight from its start`}
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
        title={win === null
          ? 'Win chance — not yet computed'
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
  /** The offset the pointer is dragging RIGHT NOW (written to CSS vars per move; committed to state on release). */
  const dragRef = useRef<{ startX: number; startY: number; dx0: number; dy0: number; rect: DOMRect; vw: number; vh: number; last: { dx: number; dy: number } | null } | null>(null);
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

  const onGrabDown = (e: React.PointerEvent<HTMLElement>): void => {
    const el = wrapRef.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const cur = placementRef.current;
    // ONE layout read for the whole gesture: the rail's box now, and the viewport. Every move is arithmetic.
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, dx0: cur.dx, dy0: cur.dy,
      rect: el.getBoundingClientRect(), vw: window.innerWidth, vh: window.innerHeight, last: null,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    el.classList.add('dragging');
  };
  const onGrabMove = (e: React.PointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    const el = wrapRef.current;
    if (!d || !el) return;
    const next = clampRailOffset(
      { dx: d.dx0 + (e.clientX - d.startX), dy: d.dy0 + (e.clientY - d.startY) },
      { dx: d.dx0, dy: d.dy0 }, d.rect, { width: d.vw, height: d.vh },
    );
    applyVars(el, next.dx, next.dy); // the cached rect stays valid: it is the box under dx0/dy0, and the clamp maps through the delta
    d.last = next;
  };
  const onGrabUp = (e: React.PointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    dragRef.current = null;
    wrapRef.current?.classList.remove('dragging');
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d?.last) return;
    const p = { ...placementRef.current, dx: d.last.dx, dy: d.last.dy };
    setPlacement(p);
    saveRailPlacement(p);
  };
  const toggleCollapsed = (): void => {
    const p = { ...placementRef.current, collapsed: !placementRef.current.collapsed };
    setPlacement(p);
    saveRailPlacement(p);
  };

  if (!session || marks.length === 0) return null;

  const grab = (
    <span
      className="roundrail-grab"
      role="button"
      tabIndex={0}
      aria-label="Drag to move the round rail"
      title="Drag to move"
      onPointerDown={onGrabDown}
      onPointerMove={onGrabMove}
      onPointerUp={onGrabUp}
      onPointerCancel={onGrabUp}
    >
      ⋮⋮
    </span>
  );

  if (placement.collapsed) {
    return (
      <div className="roundrail-wrap collapsed" ref={wrapRef}>
        <div className="roundrail-mini" role="group" aria-label="Replay rounds (collapsed)">
          {grab}
          <span className="roundrail-mini-round">
            {session.ended ? 'Final' : `R${session.round}`}
            <i className="roundrail-mini-phase">{session.ended ? '' : session.phase === 'combat' ? ' ⚔' : ' ⚒'}</i>
          </span>
          <button type="button" className="roundrail-toggle pressable" onClick={toggleCollapsed} title="Expand the round rail" aria-label="Expand the round rail" aria-expanded={false}>▸</button>
        </div>
      </div>
    );
  }

  return (
    <div className="roundrail-wrap" ref={wrapRef}>
      <nav className="roundrail" aria-label="Replay rounds">
        <div className="roundrail-bar">
          {grab}
          <span className="roundrail-title">Rounds</span>
          <button type="button" className="roundrail-toggle pressable" onClick={toggleCollapsed} title="Collapse the round rail" aria-label="Collapse the round rail" aria-expanded={true}>◂</button>
        </div>
        {/* PARTIAL recording: state the recorded range BEFORE playback rather than letting a rail that starts
            at R7 read as "rounds were filtered out". Since draft persistence shipped (2026-08-20) an ordinary
            quit-and-resume records in full, so this is the honest label for the cases that failed anyway —
            a pre-persistence recording, or storage that refused. */}
        {session.partial && (
          <div className="roundrail-partial" title="This recording does not cover the whole run — the earlier rounds were never captured.">
            <span className="roundrail-partial-tag">Partial replay</span>
            <span className="roundrail-partial-range">Rounds {session.partial.firstWave}–{session.partial.lastWave} recorded</span>
          </div>
        )}
        <div className="roundrail-grid" role="table" aria-label="Rounds">
          <div className="roundrail-head" role="row">
            <span role="columnheader">Round</span>
            <span role="columnheader" title="Jump to the round's shop">Recruit</span>
            <span role="columnheader" title="Play the round's fight from its start">Combat</span>
            <span role="columnheader" title="Gold spent this round">Gold</span>
            <span role="columnheader" title="Actions this turn">Acts</span>
            <span role="columnheader" title="Shop tier at the start of the turn">Tier</span>
            <span role="columnheader" title="The game's computed chance of winning the round's fight">Win %</span>
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
