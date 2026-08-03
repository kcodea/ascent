import { useEffect, useRef, useState } from 'react';
import { alignmentsOf, boardHasCelestial } from '@game/sim';
import { getAlignHudConfig } from './alignHudConfig';
import { useGame } from './store';

/**
 * ── THE ALIGNMENT HUD (owner ask 2026-08-03) ───────────────────────────────────────────────────────────
 *
 * A gradient strip under the warband line that shows the player which half of the sky each slot is in.
 *
 * Design decisions worth knowing:
 *
 *  • **It only appears when it can matter.** No Celestial on the board → no strip, so a normal board looks
 *    exactly as it did. It fades in/out rather than popping.
 *
 *  • **It reads as ONE sky, not seven chips.** A single Dawn→Dusk gradient spans the warband, with the
 *    Eclipse seam as a bright band positioned at the centre body — a continuous horizon the player places
 *    minions along, rather than per-slot badges competing with the cards' own frames.
 *
 *  • **The seam moves with the board.** Its position is a CSS variable (`--seam`) driven by the eclipse
 *    index; on an EVEN board there is no Eclipse, the seam hides, and the halves meet hard in the middle —
 *    the rule made visible.
 *
 *  • **Fully tunable** (owner ask): length, width, opacity, colours, vibrance, seam glow and the play spark
 *    all live in `alignHudConfig` (`--ah-*` vars), dialled from the DEV Alignment HUD tuner.
 *
 *  • **PLAY SPARKS**: when a minion lands on a side — or an aligned effect fires — that half of the sky
 *    flashes once. The signal is `run.alignSpark` (a transient sim-fx channel, the `karwindFlash` pattern):
 *    the sim notes WHAT happened, this component animates it. Keyed remounts replay the one-shot CSS
 *    animation; it animates OPACITY only (compositor-safe, never a paint loop).
 *
 *  • **Performance.** The strip animates `opacity`/`transform` only. The gradient is static paint that
 *    changes only when the board changes.
 *
 * Tick marks sit under each occupied slot so a player can read a specific minion's side without counting.
 */
export function AlignmentHud() {
  const board = useGame((s) => s.run.board);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const spark = useGame((s) => s.run.alignSpark);
  // The spark currently PLAYING (remounted per seq so the one-shot animation replays). Held in state rather
  // than read directly so a stale note from an earlier action doesn't flash on mount.
  const [live, setLive] = useState<{ seq: number; sides: ('dawn' | 'dusk')[] } | null>(null);
  const seen = useRef(spark?.seq ?? 0);
  useEffect(() => {
    if (!spark || spark.seq === seen.current) return;
    seen.current = spark.seq;
    if (!getAlignHudConfig().sparkOn) return;
    setLive(spark);
    const t = setTimeout(() => setLive(null), getAlignHudConfig().sparkMs + 60);
    return () => clearTimeout(t);
  }, [spark]);

  // Alignment is a RECRUIT-phase property (it locks at combat start), so the strip is a shop-phase tool.
  if (inCombat || !boardHasCelestial(board)) return null;

  const aligns = alignmentsOf(board);
  const n = board.length;
  const eclipseIdx = aligns.indexOf('eclipse');
  // Seam position as a percentage across the strip: the centre of the eclipse slot. −1 (no eclipse on an
  // even board) hides it, and the two halves butt together at 50%.
  const seamPct = eclipseIdx >= 0 ? ((eclipseIdx + 0.5) / n) * 100 : 50;

  return (
    <div
      className={`alignhud${eclipseIdx >= 0 ? ' has-eclipse' : ''}`}
      style={{ ['--seam' as string]: `${seamPct}%` }}
      aria-hidden="true"
    >
      <div className="alignhud-sky" />
      {/* Side sparks — one-shot flashes over the half that just did something. Keyed on seq so a repeat
          spark on the same side remounts and replays. */}
      {live?.sides.map((side) => (
        <div key={`${live.seq}-${side}`} className={`alignhud-spark as-${side}`} />
      ))}
      <div className="alignhud-seam" />
      <div className="alignhud-ticks">
        {aligns.map((a, i) => (
          <span key={board[i]!.uid} className={`ah-tick ah-${a}`}>
            {a === 'eclipse' ? 'Eclipse' : a === 'dawn' ? 'Dawn' : 'Dusk'}
          </span>
        ))}
      </div>
    </div>
  );
}
