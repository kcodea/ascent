import { memo, useCallback, useMemo, useState } from 'react';
import type { RoundMark, RoundStat } from '@game/sim';
import { useGame } from '../store';
import { seekReplay, replayRoundMarks, replayRoundStats } from './replayPlayer';
import { statsByWave } from './roundDrawer';

/**
 * REPLAY VIEWER round rail (§7.1 of docs/replay-v2-handoff.md) — a left-hand vertical index over the
 * replay's rounds, visible only during playback. One row per round: the round number, the fight's verdict
 * (W/L/D) and the Resolve it cost; the CURRENT round highlights as playback advances (the rail doubles as
 * the coarse position indicator — the transport bar handles fine scrubbing within a round). Clicking a row
 * seeks to that round's SHOP OPENING (`mark.tMs` is the wave's `turnStart` frame), which the player resolves
 * in O(log n) with no rebuild.
 *
 * Plus the METRICS DOCK (owner rework 2026-08-19; it replaced a per-round hover drawer): a panel that slides
 * out of the rail to the RIGHT and EXTENDS it — the same rows, continued — showing Gold spent / Actions /
 * Shop tier at start for ALL rounds at once. A chevron handle on the rail's edge toggles it; the slide is a
 * one-shot transform/opacity transition (compositor-only — no looping paint animation). Dock rows share the
 * rail rows' exact height/padding so the two grids read as one table.
 *
 * Position/size are owner-tunable via the 🎞 Replay Rail dev tuner (`--rrl-*` vars; styles.css fallbacks).
 *
 * Perf: at most ~19 rows per column, each row memoized — playback advancing a frame re-renders only the row
 * losing and the row gaining the highlight, in each grid. The stats come from `replayRoundStats()` — the
 * `rollupRounds` fold computed ONCE per `startReplay` and cached in the player module.
 */

const VERDICT_GLYPH = { win: 'W', loss: 'L', draw: 'D' } as const;

const RailRow = memo(function RailRow({ mark, active, onPick }: {
  mark: RoundMark;
  active: boolean;
  onPick: (mark: RoundMark) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`roundrail-row pressable${active ? ' active' : ''}`}
      onClick={() => onPick(mark)}
    >
      <span className="roundrail-num">R{mark.wave}</span>
      {mark.result && <span className={`roundrail-verdict ${mark.result}`}>{VERDICT_GLYPH[mark.result]}</span>}
      {mark.resolveLost != null && mark.resolveLost > 0 && <span className="roundrail-loss">−{mark.resolveLost}</span>}
    </button>
  );
});

const DockRow = memo(function DockRow({ stat, active }: {
  stat: { wave: number; goldSpent: number; actions: number; tierAtStart: number | null };
  active: boolean;
}): JSX.Element {
  return (
    <div className={`rounddock-row${active ? ' active' : ''}`}>
      <span className="rounddock-val">{stat.goldSpent}</span>
      <span className="rounddock-val">{stat.actions}</span>
      <span className="rounddock-val">{stat.tierAtStart ?? '—'}</span>
    </div>
  );
});

export function RoundRail(): JSX.Element | null {
  const session = useGame((st) => st.replaySession);
  /** The dock starts open — it's the feature, not a power-user extra; the chevron collapses it. */
  const [dockOpen, setDockOpen] = useState(true);

  // The marks and the rollup are computed once per startReplay and stable for the whole playback — memo on
  // the session's EXISTENCE (a fresh replay is a fresh session object chain starting from null).
  const marks = useMemo(() => (session ? replayRoundMarks() : []), [session != null]);
  const byWave = useMemo<Map<number, RoundStat>>(
    () => (session ? statsByWave(replayRoundStats()) : new Map()),
    [session != null],
  );

  /** Stable handler so the memoized rows never re-render for handler identity. */
  const onPick = useCallback((mark: RoundMark) => { seekReplay(mark.tMs); }, []);
  const toggleDock = useCallback(() => setDockOpen((v) => !v), []);

  if (!session || marks.length === 0) return null;
  return (
    <div className="roundrail-wrap">
      <nav className="roundrail" aria-label="Replay rounds">
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
        {/* The header row is IN FLOW in both grids (an earlier absolutely-positioned header was clipped by
            the dock's overflow) — the rail gets a matching cell so data rows stay level across the seam. */}
        <div className="roundrail-head">Round</div>
        {marks.map((m) => (
          <RailRow key={m.wave} mark={m} active={m.wave === session.round} onPick={onPick} />
        ))}
      </nav>
      <aside className={`rounddock${dockOpen ? ' open' : ''}`} aria-hidden={!dockOpen} aria-label="Round metrics">
        <div className="rounddock-head">
          <span title="Gold spent this round">Gold</span>
          <span title="Actions this turn">Acts</span>
          <span title="Shop tier at the start of the turn">Tier</span>
        </div>
        {marks.map((m) => {
          const s = byWave.get(m.wave);
          return (
            <DockRow
              key={m.wave}
              stat={{ wave: m.wave, goldSpent: s?.goldSpent ?? 0, actions: s?.actions ?? 0, tierAtStart: s?.tierAtStart ?? null }}
              active={m.wave === session.round}
            />
          );
        })}
      </aside>
      <button
        type="button"
        className={`rounddock-handle pressable${dockOpen ? ' open' : ''}`}
        onClick={toggleDock}
        aria-label={dockOpen ? 'Collapse round metrics' : 'Expand round metrics'}
        aria-expanded={dockOpen}
      >
        {dockOpen ? '‹' : '›'}
      </button>
    </div>
  );
}
