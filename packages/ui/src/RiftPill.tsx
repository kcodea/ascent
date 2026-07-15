import type { RiftDef } from '@game/sim';

/**
 * The active-rift telegraph — a small glowing pill ("Rift: <name>") with the game's standard clean
 * floating tooltip (same look as the quest/rune badge tips) carrying the rift's blurb. Shared by the
 * hero-select screen (pre-run) and the in-game HUD (the run's pinned rift). `variant` tunes size/placement:
 * `'hero'` is the big hero-select pill (tooltip below); `'hud'` is the compact HUD pill under the round panel.
 */
export function RiftPill({ rift, variant }: { rift: RiftDef; variant: 'hero' | 'hud' }) {
  return (
    <div className={`riftpill riftpill-${variant}`} role="note" aria-label={`Active rift: ${rift.name}`}>
      <span className="riftpill-tag">Rift</span>
      <span className="riftpill-name">{rift.name}</span>
      <div className="riftpill-tip" role="tooltip">
        <b>{rift.name}</b>
        <span className="riftpill-tip-body">{rift.blurb}</span>
      </div>
    </div>
  );
}
