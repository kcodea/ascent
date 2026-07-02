import { CONFIG, isCalibrationRound, lossDamageCap, runRecord } from '@game/sim';
import { BuffsFrame } from './BuffsFrame';
import { Icon } from './Icon';
import { OpponentFrame } from './OpponentFrame';
import { useGame } from './store';

/** Top bar: the round/altitude plaque (left) and the next-enemy frame (top-right). */
export function HudBar() {
  const run = useGame((s) => s.run);
  // Your W–L record over the SCORED rounds (calibration rounds 1–2 don't count) — the run's score (A1).
  const { wins, losses } = runRecord(run);
  const practice = run.mode === 'practice';
  const calibration = !practice && isCalibrationRound(run.wave);
  return (
    <div className="bar">
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
          {/* A notch at the end of the pre-round (Setup) rounds — marks where the scored climb begins. */}
          {!practice && <span className="meter-notch" style={{ left: `${(CONFIG.calibrationRounds / CONFIG.courseRounds) * 100}%` }} />}
        </span>
        {calibration ? (
          <span className="lbl calib" title="Setup rounds (1–2) don't count toward your record">Setup</span>
        ) : (
          <span className="lbl record" title="Your record over the scored rounds (calibration rounds 1–2 don't count)">
            <Icon name="crown" />{wins}–{losses}
          </span>
        )}
        {!practice && <span className="lbl line" title={`Your par for this run — cover or beat ${run.line} wins`}>Line {run.line}</span>}
      </div>
      {/* Top-right: the next-enemy frame (recruit only) with the run-buffs window stacked below it. */}
      <div className="topright">
        <OpponentFrame />
        <BuffsFrame />
      </div>
    </div>
  );
}
