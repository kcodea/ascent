import type { gatherRunBuffs } from './runBuffs';

/**
 * Run buffs — the run's active permanent buffs (spell power, max Gold, tribe auras…).
 *
 * Owner rework 2026-08-14: no longer a side drawer with its own tab. It is a CONTROLLED pop-out owned by the
 * hero panel: clicking the hero portrait toggles `open`, and the panel expands UPWARD out of the portrait's
 * top edge into the empty top-left board space, anchored at the bottom so it grows up as more buffs accrue
 * (see `.herobuffs` in styles.css). `rows` is computed once in `StatusBar` (so the portrait's up-arrow
 * affordance can gate on the same count). Renders nothing when there are no buffs.
 */
export function BuffsFrame({ open, rows }: { open: boolean; rows: ReturnType<typeof gatherRunBuffs> }) {
  if (rows.length === 0) return null;
  return (
    <div className={`herobuffs${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="herobuffs-body">
        <div className="herobuffs-title">Buffs</div>
        {rows.map((r) => (
          <div className="buff-row" key={r.key}>
            <span className="buff-label">{r.label}</span>
            {/* A faint leader line filling the gap between the buff name and its amount. */}
            <span className="buff-lead" aria-hidden="true" />
            <span className="buff-val">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
