import { useEffect, useState } from 'react';
import {
  EASE_KEYS, LUNGE_GROUPS, LUNGE_RANGES, STRIKE_EASES, getLungeConfig, lungeOverrides, resetLungeConfig,
  setLungeValue, type LungeConfig,
} from './lungeConfig';
import {
  clearLungeSamples, getLungeSamples, lungeClampTally, setLungeProbeEnabled, subscribeLungeProbe,
} from './lungeProbe';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the combat attack lunge.
 *
 * ## Why it's shaped like this
 *
 * There is no per-pairing lunge to tune. The board `.row` is centre-justified, so a 6-card side seats
 * differently from a 7-card side, and both rows re-centre mid-combat as units die — the same nominal
 * "slot 3 → slot 5" is a different vector before and after a death. So every dial here is a property of the
 * approach VECTOR (distance, angle), and the panel is built to make those FUNCTIONS legible:
 *
 *   - sliders are grouped by which function they shape (`LUNGE_GROUPS`), not dumped in one flat list;
 *   - a live READOUT shows what the functions produced for the swings you just watched — travel, the
 *     resolved duration, the ease band, the tilt — because the function's real output over real vectors is
 *     the only thing worth judging;
 *   - a CLAMP tally calls out how often `min/maxStrikeDur` bound the duration. A high `max` count means the
 *     long strikes are all flattened to one speed, which is the usual cause of "the far ones read wrong".
 *
 * Two deliberate differences from the version deleted in #537, which persisted to localStorage and skewed
 * every later combat silently and permanently:
 *   - overrides live in **sessionStorage** — they survive an HMR reload mid-tuning, and die with the tab;
 *   - a loud **MODIFIED** banner lists every key differing from the shipped defaults, so it's never silent.
 * "Copy" grabs the JSON to paste back into `DEFAULTS` in lungeConfig.ts (shipping is still a code change).
 */
const LABELS: Record<keyof LungeConfig, string> = {
  windupDur: 'duration',
  windupDepth: 'depth',
  windupScale: 'swell',
  targetSpeed: 'target px/s',
  minStrikeDur: 'min dur',
  maxStrikeDur: 'max dur',
  strikeDur: 'fallback dur',
  bandShortPx: 'short ≤ px',
  bandLongPx: 'long > px',
  easeShortIdx: 'short ease',
  easeMidIdx: 'mid ease',
  easeLongIdx: 'long ease',
  leadTilt: 'base tilt',
  tiltAngleScale: 'angle scale',
  defenderSpin: 'defender spin',
  attackerRebound: 'atk rebound',
  smackLead: 'smack lead',
  settleDur: 'settle dur',
  attackGap: 'attack gap',
};

export function LungeTuner() {
  const [cfg, setCfg] = useState<LungeConfig>(getLungeConfig());
  const [copied, setCopied] = useState(false);
  const [, bump] = useState(0);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('lunge');

  // Recording is off in the shipped path; the tuner switches it on only while it's open.
  useEffect(() => {
    setLungeProbeEnabled(true);
    const unsub = subscribeLungeProbe(() => bump((n) => n + 1));
    return () => { setLungeProbeEnabled(false); unsub(); };
  }, []);

  const set = (k: keyof LungeConfig, v: number): void => {
    setLungeValue(k, v);
    setCfg({ ...getLungeConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getLungeConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetLungeConfig(); setCfg({ ...getLungeConfig() }); };

  const overrides = lungeOverrides();
  const samples = getLungeSamples();
  const last = samples[0];
  const tally = lungeClampTally();

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Lunge Tuner <span>dev · next attack · drag</span></div>

      {overrides.length > 0 && (
        <div className="lunge-mod">
          MODIFIED ({overrides.length}): {overrides.map((k) => LABELS[k]).join(', ')} — session only
        </div>
      )}

      {/* What the vector functions actually produced, for the swings just watched. */}
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

      {LUNGE_GROUPS.map((g) => (
        <div className="lunge-sec" key={g.title}>
          <div className="lunge-sec-h">{g.title}</div>
          {g.keys.map((k) => {
            const [min, max, step] = LUNGE_RANGES[k];
            const isEase = EASE_KEYS.includes(k);
            return (
              <div className="sfxmix-row" key={k}>
                <span className="sfxmix-name">{LABELS[k]}</span>
                <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
                <span className="sfxmix-val">{isEase ? STRIKE_EASES[cfg[k]] ?? '?' : cfg[k]}</span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
