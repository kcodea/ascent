import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoundMark, RoundStat } from '@game/sim';
import { useGame } from '../store';
import { seekReplay, replayRoundMarks, replayRoundStats } from './replayPlayer';
import { drawerStatFor, statsByWave, type DrawerStat } from './roundDrawer';

/**
 * REPLAY VIEWER round rail (§7.1 of docs/replay-v2-handoff.md) — a left-hand vertical index over the
 * replay's rounds, visible only during playback. One row per round: the round number, the fight's verdict
 * (W/L/D) and the Resolve it cost; the CURRENT round highlights as playback advances (the rail doubles as
 * the coarse position indicator — the transport bar handles fine scrubbing within a round). Clicking a row
 * seeks to that round's SHOP OPENING (`mark.tMs` is the wave's `turnStart` frame), which the player resolves
 * in O(log n) with no rebuild.
 *
 * Plus the METRICS DRAWER (§7.4, owner ruling 2026-08-19): a compact panel that slides out of the rail to
 * the RIGHT showing exactly three numbers for one round — Gold spent / Actions / Shop tier at start.
 * Interaction model: HOVER a row for ~150ms to preview that round's numbers (leaving closes the preview);
 * CLICK a row to seek AND pin the drawer — once pinned it tracks the CURRENT playback round (the sought
 * round immediately, then each round as playback advances), until its close button unpins it. Hover always
 * previews over a pin without disturbing it.
 *
 * Perf: at most ~19 rows, each a memoized component keyed on its own (wave, verdict, active, selected)
 * tuple — playback advancing a frame re-renders only the row losing and the row gaining the highlight.
 * The drawer's numbers come from `replayRoundStats()` — the `rollupRounds` fold computed ONCE per
 * `startReplay` and cached in the player module — indexed by wave in one memo per replay. The drawer is an
 * absolutely-positioned sibling of the rail (zero layout shift; it can never cover the rows) and its slide
 * is a one-shot transform/opacity transition (compositor-only — no looping paint animation).
 */

const VERDICT_GLYPH = { win: 'W', loss: 'L', draw: 'D' } as const;

/** Hover dwell before the drawer opens — long enough that skimming the rail doesn't strobe the panel. */
const HOVER_OPEN_MS = 150;

const RailRow = memo(function RailRow({ mark, active, selected, onPick, onHover }: {
  mark: RoundMark;
  active: boolean;
  selected: boolean;
  onPick: (mark: RoundMark) => void;
  onHover: (wave: number | null) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`roundrail-row pressable${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      onClick={() => onPick(mark)}
      onMouseEnter={() => onHover(mark.wave)}
      onMouseLeave={() => onHover(null)}
      title={`Jump to round ${mark.wave}`}
    >
      <span className="roundrail-num">R{mark.wave}</span>
      {mark.result && <span className={`roundrail-verdict ${mark.result}`}>{VERDICT_GLYPH[mark.result]}</span>}
      {mark.resolveLost != null && mark.resolveLost > 0 && <span className="roundrail-loss">−{mark.resolveLost}</span>}
    </button>
  );
});

/** The §7.4 three-line panel. Kept mounted while the rail lives so the open/close slide can transition;
 *  `stat` is the last round shown, held through the slide-out so the panel never blanks mid-animation. */
function MetricsDrawer({ open, stat, pinned, onUnpin }: {
  open: boolean;
  stat: DrawerStat | null;
  pinned: boolean;
  onUnpin: () => void;
}): JSX.Element | null {
  if (!stat) return null; // nothing has ever been hovered/pinned — no panel to slide
  return (
    <aside className={`rounddrawer${open ? ' open' : ''}`} aria-hidden={!open} aria-label={`Round ${stat.wave} metrics`}>
      <div className="rounddrawer-head">
        <span className="rounddrawer-title">Round {stat.wave}</span>
        {pinned && (
          <button type="button" className="rounddrawer-close pressable" onClick={onUnpin} aria-label="Close metrics">×</button>
        )}
      </div>
      <div className="rounddrawer-line"><span>Gold spent</span><span className="rounddrawer-val">{stat.goldSpent}</span></div>
      <div className="rounddrawer-line"><span>Actions</span><span className="rounddrawer-val">{stat.actions}</span></div>
      <div className="rounddrawer-line"><span>Shop tier at start</span><span className="rounddrawer-val">{stat.tierAtStart ?? '—'}</span></div>
    </aside>
  );
}

export function RoundRail(): JSX.Element | null {
  const session = useGame((st) => st.replaySession);
  /** The wave a row hover is previewing (set after the dwell), or null when the pointer is off the rail. */
  const [hoverWave, setHoverWave] = useState<number | null>(null);
  /** Click-pinned: the drawer stays open tracking the CURRENT playback round until explicitly closed. */
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The marks and the rollup are computed once per startReplay and stable for the whole playback — memo on
  // the session's EXISTENCE (a fresh replay is a fresh session object chain starting from null).
  const marks = useMemo(() => (session ? replayRoundMarks() : []), [session != null]);
  const byWave = useMemo<Map<number, RoundStat>>(
    () => (session ? statsByWave(replayRoundStats()) : new Map()),
    [session != null],
  );

  /** Stable handlers so the memoized rows never re-render for handler identity. */
  const onHover = useCallback((wave: number | null) => {
    if (hoverTimer.current !== null) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (wave === null) { setHoverWave(null); return; }
    hoverTimer.current = setTimeout(() => { hoverTimer.current = null; setHoverWave(wave); }, HOVER_OPEN_MS);
  }, []);
  const onPick = useCallback((mark: RoundMark) => {
    setPinned(true); // pin FIRST — the drawer tracks the sought round the instant the seek lands
    seekReplay(mark.tMs);
  }, []);
  const onUnpin = useCallback(() => setPinned(false), []);
  useEffect(() => () => { if (hoverTimer.current !== null) clearTimeout(hoverTimer.current); }, []);

  // The round the drawer is showing: a hover preview wins; otherwise the pin follows playback's round.
  const drawerWave = hoverWave ?? (pinned && session ? session.round : null);
  // Hold the last shown stat through the slide-out so closing never blanks the panel mid-animation.
  const lastStat = useRef<DrawerStat | null>(null);
  if (drawerWave != null) lastStat.current = drawerStatFor(drawerWave, byWave);

  if (!session || marks.length === 0) return null;
  return (
    <div className="roundrail-wrap">
      <nav className="roundrail" aria-label="Replay rounds">
        {marks.map((m) => (
          <RailRow
            key={m.wave}
            mark={m}
            active={m.wave === session.round}
            selected={m.wave === drawerWave}
            onPick={onPick}
            onHover={onHover}
          />
        ))}
      </nav>
      <MetricsDrawer open={drawerWave != null} stat={lastStat.current} pinned={pinned} onUnpin={onUnpin} />
    </div>
  );
}
