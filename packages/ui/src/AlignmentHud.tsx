import { alignmentsOf, boardHasCelestial } from '@game/sim';
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
 *    Eclipse seam as a bright band positioned at the centre body. That way the player sees a continuous
 *    horizon they are placing minions along, which is the mental model the mechanic wants — rather than a
 *    row of per-slot badges that would compete with the cards' own frames.
 *
 *  • **The seam moves with the board.** Its position is a CSS variable (`--seam`) driven by the eclipse
 *    index, so re-centring after a play/sell is a cheap variable change on ONE element. On an EVEN board
 *    there is no Eclipse, so the seam hides and the two halves meet hard in the middle — which is exactly
 *    the rule made visible.
 *
 *  • **Performance.** Per the repo's north star: the strip animates `opacity`/`transform` only. The gradient
 *    itself is static paint that changes only when the board changes — never a looping paint animation.
 *
 * Tick marks sit under each occupied slot so a player can read a specific minion's side without counting.
 */
export function AlignmentHud() {
  const board = useGame((s) => s.run.board);
  const inCombat = useGame((s) => s.run.phase === 'combat');
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
