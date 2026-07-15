import type { AnomalyDef } from '@game/sim';

/**
 * The active-anomaly telegraph — a small glowing pill ("Anomaly: <name>") with the game's standard clean
 * floating tooltip (same look as the quest/rune badge tips) carrying the anomaly's blurb. Shared by the
 * hero-select screen (pre-run) and the in-game HUD (the run's pinned anomaly). `variant` tunes size/placement:
 * `'hero'` is the big hero-select pill (tooltip below); `'hud'` is the compact HUD pill under the round panel.
 */
export function AnomalyPill({ anomaly, variant }: { anomaly: AnomalyDef; variant: 'hero' | 'hud' }) {
  return (
    <div className={`anomalypill anomalypill-${variant}`} role="note" aria-label={`Active anomaly: ${anomaly.name}`}>
      <span className="anomalypill-tag">Anomaly</span>
      <span className="anomalypill-name">{anomaly.name}</span>
      <div className="anomalypill-tip" role="tooltip">
        <b>{anomaly.name}</b>
        <span className="anomalypill-tip-body">{anomaly.blurb}</span>
      </div>
    </div>
  );
}
