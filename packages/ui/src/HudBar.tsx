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
  // Practice runs the SAME course as Ascent, so the plaque reads identically (round count, dashes, Setup, Line).
  // The one difference the HUD reflects is invulnerability: the "Max −X" loss row is hidden (no Resolve at risk).
  const practice = run.mode === 'practice';
  const calibration = isCalibrationRound(run.wave);
  return (
    <div className="bar">
      <div className="alt">
        <span className="wavecol">
          <span className="w">{`ROUND ${run.wave} / ${CONFIG.courseRounds}`}</span>
          {/* The most Resolve a loss this wave can cost — the round damage cap (see lossDamageCap). Hidden in
              Practice, where Resolve is unlimited and losses deal no damage. */}
          {!practice && (
            <span className="maxdmg" title="Most Resolve you can lose if you lose this combat">
              <Icon name="heart" />Max −{lossDamageCap(run.wave)}
            </span>
          )}
        </span>
        {/* Per-round track: one dash per course round — a win prints a green ✓, a loss a red ✕, rounds not yet
            played stay a faint dash, and the current round is lit orange. Setup rounds (1–2) read a touch
            quieter with a small gap after (where the scored climb begins). Shown in Practice too (same course). */}
        {(
          <span className="rounds" role="img" aria-label={`Round ${run.wave} of ${CONFIG.courseRounds}`}>
            {Array.from({ length: CONFIG.courseRounds }, (_, i) => {
              const round = i + 1;
              const result = run.history[i]; // 'win' | 'lose' | 'draw' | undefined (current / upcoming)
              const state = round === run.wave ? 'cur' : (result ?? 'future');
              const calib = round <= CONFIG.calibrationRounds;
              const label =
                result === 'win' ? 'Win' : result === 'lose' ? 'Loss' : result === 'draw' ? 'Draw'
                  : round === run.wave ? 'now' : 'upcoming';
              return (
                <span
                  key={round}
                  className={`rd rd-${state}${calib ? ' rd-calib' : ''}${round === CONFIG.calibrationRounds ? ' rd-edge' : ''}`}
                  title={`Round ${round}${calib ? ' · Setup' : ''} — ${label}`}
                >
                  {state === 'win' ? '✓' : state === 'lose' ? '✕' : ''}
                </span>
              );
            })}
          </span>
        )}
        {calibration ? (
          <span className="lbl calib" title="Setup rounds (1–2) don't count toward your record">Setup</span>
        ) : (
          <span className="lbl record" title="Your record over the scored rounds (calibration rounds 1–2 don't count)">
            <Icon name="crown" />{wins}–{losses}
          </span>
        )}
        <span className="lbl line" title={`Your par for this run — cover or beat ${run.line} wins`}>Line {run.line}</span>
      </div>
      {/* Top-right: the next-enemy frame (recruit only) with the run-buffs window stacked below it. */}
      <div className="topright">
        <OpponentFrame />
        <BuffsFrame />
      </div>
    </div>
  );
}
