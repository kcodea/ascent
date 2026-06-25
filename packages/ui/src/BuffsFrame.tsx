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
  const [collapsed, setCollapsed] = useState(false);
  const rows = gatherRunBuffs(run);
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
