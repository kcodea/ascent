import { memo, useMemo, useState } from 'react';
import type { RoundMark } from '@game/sim';
import { useGame } from '../store';
import { seekReplay, replayRoundMarks } from './replayPlayer';

/**
 * REPLAY VIEWER round rail (§7.1 of docs/replay-v2-handoff.md) — a left-hand vertical index over the
 * replay's rounds, visible only during playback. One row per round: the round number, the fight's verdict
 * (W/L/D) and the Resolve it cost; the CURRENT round highlights as playback advances (the rail doubles as
 * the coarse position indicator — the transport bar handles fine scrubbing within a round). Clicking a row
 * seeks to that round's SHOP OPENING (`mark.tMs` is the wave's `turnStart` frame), which the player resolves
 * in O(log n) with no rebuild.
 *
 * Perf: at most ~19 rows, each a memoized component keyed on its own (wave, verdict, active, selected)
 * tuple — playback advancing a frame re-renders only the row losing and the row gaining the highlight.
 *
 * Phase D seam: `selectedWave` is the rail-owned hover/selection state the metrics drawer (§7.4) will
 * attach to — the drawer slides out of the selected row; lifting this state into a prop is the only change
 * that phase needs here.
 */

const VERDICT_GLYPH = { win: 'W', loss: 'L', draw: 'D' } as const;

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

export function RoundRail(): JSX.Element | null {
  const session = useGame((st) => st.replaySession);
  const [selectedWave, setSelectedWave] = useState<number | null>(null);
  // The marks are computed once per startReplay and stable for the whole playback — memo on the session's
  // EXISTENCE (a fresh replay is a fresh session object chain starting from null).
  const marks = useMemo(() => (session ? replayRoundMarks() : []), [session != null]);
  if (!session || marks.length === 0) return null;
  return (
    <nav className="roundrail" aria-label="Replay rounds">
      {marks.map((m) => (
        <RailRow
          key={m.wave}
          mark={m}
          active={m.wave === session.round}
          selected={m.wave === selectedWave}
          onPick={pickMark}
          onHover={setSelectedWave}
        />
      ))}
    </nav>
  );
}

/** Module-scope so every RailRow shares one referentially-stable handler (keeps the memo effective). */
function pickMark(mark: RoundMark): void {
  seekReplay(mark.tMs);
}
