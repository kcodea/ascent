import { useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import { CONFIG, isCalibrationRound, lossDamageCap, runRecord } from '@game/sim';
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
  // Your W–L record over the SCORED rounds (calibration rounds 1–2 don't count) — the run's score (A1).
  const { wins, losses } = runRecord(run);
  const practice = run.mode === 'practice';
  const calibration = !practice && isCalibrationRound(run.wave);
  return (
    <div className="bar">
      <div className="wm disp">ASCENT</div>
      <div className="alt">
        <span className="wavecol">
          <span className="w">{practice ? `WAVE ${run.wave}` : `ROUND ${run.wave} / ${CONFIG.courseRounds}`}</span>
          {/* The most Resolve a loss this wave can cost — the round damage cap (see lossDamageCap). Hidden in
              Practice, where Resolve is unlimited and losses deal no damage. */}
          {!practice && (
            <span className="maxdmg" title="Most Resolve you can lose if you lose this combat">
              <Icon name="heart" />Max −{lossDamageCap(run.wave)}
            </span>
          )}
        </span>
        <span className="meter">
          <i style={{ width: `${Math.min(100, (run.wave / CONFIG.courseRounds) * 100)}%` }} />
        </span>
        {calibration ? (
          <span className="lbl calib" title="Calibration rounds (1–2) don't count toward your record">Calibration</span>
        ) : (
          <span className="lbl record" title="Your record over the scored rounds (calibration rounds 1–2 don't count)">
            <Icon name="crown" />{wins}–{losses}
          </span>
        )}
        {!practice && <span className="lbl line" title={`Your par for this run — cover or beat ${run.line} wins`}>Line {run.line}</span>}
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
