import { useState } from 'react';
import { Icon } from './Icon';
import { gatherRunBuffs } from './runBuffs';
import { useGame } from './store';

/**
 * Top-right buffs window (under the next-enemy frame): the run's active permanent buffs at a glance. Open by
 * default, collapsible, and only rendered when at least one tracked buff is active.
 */
export function BuffsFrame() {
  const run = useGame((s) => s.run);
  // In combat, the live per-beat buff gains (spell power, max Gold) — folded into the rows so they tick up in
  // sync with the replay instead of jumping at settle. `null` outside combat (rows read the run state alone).
  const combatBuffs = useGame((s) => s.combatBuffs);
  const [collapsed, setCollapsed] = useState(false);
  const rows = gatherRunBuffs(run, combatBuffs);
  if (rows.length === 0) return null;
  return (
    <div className="buffsframe">
      <button className="buffs-head" onClick={() => setCollapsed((c) => !c)} title="Active run buffs">
        <Icon name="up" />
        <span className="buffs-title">Buffs</span>
        {collapsed && <span className="buffs-count">{rows.length}</span>}
        <span className="buffs-chev">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="buffs-body">
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
