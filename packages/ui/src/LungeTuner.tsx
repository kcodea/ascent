import { useEffect, useState } from 'react';
import {
  EASE_KEYS, LUNGE_DEFAULTS, LUNGE_GROUPS, LUNGE_RANGES, STRIKE_EASES,
  getLungeConfig, resetLungeConfig, setLungeValue, type LungeConfig,
} from './lungeConfig';
import {
  clearLungeSamples, getLungeSamples, lungeClampTally, setLungeProbeEnabled, subscribeLungeProbe,
} from './lungeProbe';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the combat attack lunge.
 *
 * WHY THIS ONE ALSO MEASURES. There is no per-pairing lunge to tune: the board row is centre-justified, so a
 * 6-card side seats differently from a 7-card side, and both re-centre mid-combat as units die. The same nominal
 * "slot 3 → slot 5" is therefore a different vector every time, and the strike duration is DERIVED from that
 * distance — which means a dialled number can be silently overridden by the min/max clamp. The readout shows
 * what the vector functions actually produced on the last swing, including whether it clamped, which is the
 * difference between "my numbers are wrong" and "my numbers are being ignored".
 *
 * Probe recording is off in the shipped path and switched on only while this panel is open, so that lifecycle
 * lives in the component rather than in the spec.
 *
 * THE EASE CONTROLS ARE INDEXES into `STRIKE_EASES`, and the old panel let you pick a curve by dragging to `3`.
 * They now show the curve's NAME (`valueLabels`). They stay sliders rather than becoming dropdowns because the
 * list is genuinely ORDERED — linear at 0, violently late at the top — so dragging along it means something.
 *
 * The old panel's "MODIFIED (n): … — session only" banner is gone: every changed control now carries its own
 * revert dot, which says the same thing next to the thing it is about. Overrides still live in sessionStorage
 * and still die with the tab.
 */
const SPECS: Record<keyof LungeConfig, [string, TunerUnit | undefined, string]> = {
  windupDur:       ['Duration', 's', 'How long the attacker coils before striking. The damage beat is derived from this, so the two stay in sync.'],
  windupDepth:     ['Pull-back', '×', 'How far back the attacker draws, as a fraction of the travel to its target.'],
  windupScale:     ['Swell', '×', 'How much the attacker grows during the coil. It returns to normal size on the strike.'],

  targetSpeed:     ['Target speed', 'px/s', 'The speed every strike aims for. Its duration is derived from this and the actual distance, so a far attack takes longer rather than moving faster.'],
  minStrikeDur:    ['Minimum duration', 's', 'Floor on that derived duration — a very short travel clamps up to this. Watch the readout: a high clamp count here means the near attacks are all one speed.'],
  maxStrikeDur:    ['Maximum duration', 's', 'Ceiling on the derived duration. A high clamp count here is the usual cause of "the far attacks read wrong" — they are all flattened to one speed.'],
  strikeDur:       ['Fallback duration', 's', 'Used only when the distance cannot be measured at all.'],

  bandShortPx:     ['Short band ends at', 'px', 'A travel at or under this uses the short-band curve.'],
  bandLongPx:      ['Long band starts at', 'px', 'A travel over this uses the long-band curve. Anything between the two bands is mid.'],
  easeShortIdx:    ['Short-travel curve', undefined, 'Easing for a short travel. The list runs from linear at the bottom to violently late at the top.'],
  easeMidIdx:      ['Mid-travel curve', undefined, 'Easing for a mid-range travel.'],
  easeLongIdx:     ['Long-travel curve', undefined, 'Easing for a long travel.'],

  leadTilt:        ['Base tilt', '°', 'How far the attacker rotates so it leads with a corner rather than arriving flat. Its direction follows the approach.'],
  faceOnRamp:      ['Face-on ramp', 'px', 'The horizontal distance over which that corner-lead fades in. A defender directly ahead gets none of it.'],
  tiltAngleScale:  ['Angle scaling', '×', 'How much the approach angle itself scales the tilt, on top of the base.'],
  defenderSpin:    ['Defender spin', '°', 'How far the struck unit rotates from the impact.'],
  attackerRebound: ['Attacker rebound', '°', 'How far the attacker kicks back on contact.'],
  buffLeadMs: ['Buff lead', 'ms', 'Extra pause at the top of the wind-up when this swing carries a buff, so the STATS visibly land before the strike goes out. Every buffed attack is this much slower — 0 restores the old timing.'],
  smackLead:       ['Hit-sound lead', 's', 'How early before contact the hit sound plays, so it lands WITH the visual instead of after it.'],

  settleDur:       ['Settle', 's', 'How long the attacker takes to travel home and level out.'],
  attackGap:       ['Gap after attack', 's', 'The pause before the next attack begins.'],
};

const EASE_SET = new Set<string>(EASE_KEYS as string[]);

const controls: TunerControl<Extract<keyof LungeConfig, string>>[] = LUNGE_GROUPS.flatMap((g) =>
  g.keys.map((key) => {
    const [label, unit, hint] = SPECS[key];
    const [min, max, step] = LUNGE_RANGES[key];
    const base = { key: key as Extract<keyof LungeConfig, string>, label, hint, group: g.title, min, max, step };
    // An ease index shows its curve name in the value column instead of the raw number.
    return EASE_SET.has(key) ? { ...base, valueLabels: STRIKE_EASES } : { ...base, unit };
  }),
);

/** What the vector functions actually produced for the swings just watched. */
function LungeReadout(): JSX.Element {
  const last = getLungeSamples()[0];
  const tally = lungeClampTally();
  return (
    <div className="lunge-read">
      <div className="lunge-read-h">
        <span>Last swing</span>
        <button onClick={clearLungeSamples} title="Clear the sample buffer">clear</button>
      </div>
      {last ? (
        <>
          <div className="lunge-read-row"><span>travel</span><b>{Math.round(last.travel)}px</b><span>of {Math.round(last.dist)} c-c</span></div>
          <div className="lunge-read-row">
            <span>duration</span>
            <b className={last.clamped ? 'clamp' : undefined}>{last.strikeDur.toFixed(3)}s</b>
            <span>{last.clamped ? `CLAMPED ${last.clamped}` : 'free'}</span>
          </div>
          <div className="lunge-read-row"><span>ease</span><b>{last.band}</b><span>{last.ease}</span></div>
          <div className="lunge-read-row"><span>approach</span><b>{last.approachDeg.toFixed(1)}°</b><span>tilt {last.leadTilt.toFixed(1)}°</span></div>
        </>
      ) : (
        <div className="lunge-read-row"><span>watch a combat…</span></div>
      )}
      {tally.total > 0 && (
        <div className={`lunge-read-row tally${tally.max > 0 ? ' warn' : ''}`}>
          <span>clamped</span>
          <b>{tally.min + tally.max}/{tally.total}</b>
          <span>{tally.max} max · {tally.min} min</span>
        </div>
      )}
    </div>
  );
}

export const SPEC: TunerSpec<LungeConfig> = {
  id: 'lunge',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Lunge',
  note: 'dev · next attack · session only',
  read: getLungeConfig,
  write: setLungeValue,
  reset: resetLungeConfig,
  defaults: LUNGE_DEFAULTS,
  controls,
  readout: () => <LungeReadout />,
};

export function LungeTuner(): JSX.Element {
  const [, bump] = useState(0);
  // Recording is off in the shipped path; switch it on only while this panel is open, and re-render as swings
  // arrive so the readout stays live.
  useEffect(() => {
    setLungeProbeEnabled(true);
    const unsub = subscribeLungeProbe(() => bump((n) => n + 1));
    return () => { setLungeProbeEnabled(false); unsub(); };
  }, []);
  return <TunerPanel spec={SPEC} />;
}
