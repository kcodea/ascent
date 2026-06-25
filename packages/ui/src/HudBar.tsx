import { useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import { BuffsFrame } from './BuffsFrame';
import { Icon } from './Icon';
import { OpponentFrame } from './OpponentFrame';
import { isMuted, toggleMute } from './sfx';
import { useGame } from './store';

const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', undead: 'skull', mech: 'gear', demon: 'eye', neutral: 'star',
};
const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', undead: 'Undead', mech: 'Mech', demon: 'Demon', neutral: 'Neutral',
};

/** Top bar: wordmark + altitude (wave) meter + the tribes in play this run. */
export function HudBar() {
  const run = useGame((s) => s.run);
  const playerName = useGame((s) => s.playerName);
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  const [muted, setMuted] = useState(isMuted());
  // Combat wins this run — read straight off the per-combat history (W/L/D), so it always agrees with the
  // end-screen summary. (A win = a combat won; you can climb a wave on a loss, so wins ≤ waves fought.)
  const wins = run.history.filter((r) => r === 'win').length;
  return (
    <div className="bar">
      <div className="wm disp">ASCENT</div>
      <div className="alt">
        <span className="w">WAVE {run.wave}</span>
        <span className="meter">
          <i style={{ width: `${Math.min(100, run.wave * 8)}%` }} />
        </span>
        <span className="lbl wins" title="Combats won this run"><Icon name="crown" />{wins}</span>
        <span className="lbl">Best {run.best}</span>
      </div>
      {/* Combat replay speed — only during the fight; sits to the LEFT of the tribes bar (out of the
          top-right buffs/opponent column). */}
      {run.phase === 'combat' && (
        <div className="combatspeed" title="Combat replay speed">
          <span className="csl">Speed</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={combatSpeed}
            onChange={(e) => setCombatSpeed(Number(e.target.value))}
            aria-label="Combat replay speed"
          />
          <span className="combatspeed-val">{combatSpeed.toFixed(1)}×</span>
        </div>
      )}
      <div className="tribes" title="Tribes in play this run">
        <span className="tl">Tribes</span>
        {run.tribes.map((t) => (
          <span className="tb" key={t} style={{ '--c': `var(--t-${t})` } as CSSProperties} title={TRIBE_LABEL[t]}>
            <Icon name={TRIBE_ICON[t]} />
          </span>
        ))}
      </div>
      <button className="mutebtn" title={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(toggleMute())}>
        <Icon name={muted ? 'mute' : 'sound'} />
      </button>
      {/* The player's name on its own line, below the ASCENT/Wave boxes — mirrors the opponent frame
          (below-right). Absolutely positioned so it never reflows the bar. */}
      {playerName && <div className="barplayer" title="You">{playerName}</div>}
      {/* Top-right column: the next-enemy frame (recruit only) with the run-buffs window stacked below it. */}
      <div className="topright">
        <OpponentFrame />
        <BuffsFrame />
      </div>
    </div>
  );
}
