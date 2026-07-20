import { useState } from 'react';
import { gatherRunBuffs } from './runBuffs';
import { useGame } from './store';

/**
 * Run buffs — the run's active permanent buffs (spell power, max Gold, tribe auras…).
 *
 * Owner rework 2026-07-21: this used to be a boxed window in the top-left. It is now a DRAWER that extends
 * out to the RIGHT of the hero portrait, opened by a tab button that eclipses the portrait's right edge —
 * the same "pill eclipsing an edge" language the player-name and hero-name pills already use, so it reads
 * as part of the hero panel rather than another floating box.
 *
 * Collapsed by default so it never covers the board unasked; the tab shows the buff COUNT when closed, so
 * you can see there's something to open without opening it. Only rendered when at least one buff is active.
 */
export function BuffsFrame() {
  const run = useGame((s) => s.run);
  // In combat, the live per-beat buff gains (spell power, max Gold) — folded into the rows so they tick up in
  // sync with the replay instead of jumping at settle. `null` outside combat (rows read the run state alone).
  const combatBuffs = useGame((s) => s.combatBuffs);
  const [open, setOpen] = useState(false);
  const rows = gatherRunBuffs(run, combatBuffs);
  if (rows.length === 0) return null;
  return (
    <div className={`herobuffs${open ? ' open' : ''}`}>
      {/* The tab — eclipses the hero portrait's right edge. The chevron alone carries the affordance; the
          up-arrow icon was dropped (owner 2026-07-21) since it pointed the wrong way for a side drawer and
          crowded the narrow vertical tab. */}
      <button
        className="herobuffs-tab"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide run buffs' : 'Show run buffs'}
        aria-expanded={open}
      >
        {!open && <span className="herobuffs-count">{rows.length}</span>}
        <span className="herobuffs-chev">{open ? '◂' : '▸'}</span>
      </button>
      {/* The drawer, mounted only while open. NOTE: a slide-out animation is NOT wired — see the devlog;
          two attempts (keyframes, then a CSS transition on a persistent element) both left the panel stuck
          at its start frame in this container, and shipping a drawer that never appears is far worse than
          shipping one that simply appears. Reverted to the working reveal until it's understood. */}
      {open && (
        <div className="herobuffs-body">
          <div className="herobuffs-title">Buffs</div>
          {rows.map((r) => (
            <div className="buff-row" key={r.key}>
              <span className="buff-label">{r.label}</span>
              <span className="buff-val">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
