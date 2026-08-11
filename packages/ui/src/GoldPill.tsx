import { Icon } from './Icon';

/**
 * Standalone GOLD pill (owner ask 2026-08-11) — the Gold readout moved off the top stat strip to its own
 * glass button pinned BOTTOM-RIGHT of the board: a yellow glass plaque with the live Gold total over it. The
 * top strip now carries only the turn timer. Stage-pinned like the other board furniture (see `.goldpill` in
 * styles.css). Keeps the old strip's hover: this turn's Gold + the projected START of the next two waves.
 */
export function GoldPill({ gold, nextTurnGold, afterNextGold, wave }: {
  gold: number;
  nextTurnGold: number;
  afterNextGold: number;
  wave: number;
}): JSX.Element {
  return (
    <div className="goldpill" role="status" aria-label={`Gold: ${gold}`}>
      <Icon name="mana" />
      <span className="goldpill-v">{gold}</span>
      {/* Hover: this turn's Gold + the projected START of the next two waves (cascading up, cap-aware). */}
      <div className="sbtip goldtip" role="tooltip">
        <div className="gt-now">Gold · <b>{gold}</b> this turn</div>
        <div className="gt-row"><span>Next turn</span><b><Icon name="mana" />{nextTurnGold}</b></div>
        <div className="gt-row"><span>Wave {wave + 2}</span><b><Icon name="mana" />{afterNextGold}</b></div>
      </div>
    </div>
  );
}
