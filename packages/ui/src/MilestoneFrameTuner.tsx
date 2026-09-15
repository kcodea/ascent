import { useState } from 'react';
import { SPEC } from './milestoneFrameConfig';
import { TunerPanel } from './TunerPanel';

/** The digit shown on each tier's preview badge — the threshold that lights it, so the 4-digit tiers show how
 *  a big number fits the disc. */
const TIER_NUM: Record<number, string> = { 1: '50', 2: '100', 3: '500', 4: '1000', 5: '5000' };
const src = (stat: 'atk' | 'hp', tier: number): string =>
  `${import.meta.env.BASE_URL}frames/milestone-${stat}-${tier}.webp`;

/**
 * A live preview of every milestone tier, rendered with the REAL badge markup (`.badge`/`.msframe`/`.mstint`/
 * `.value`), so it reflects the tuner's CSS vars as you drag — no need to hunt down a minion at each value. The
 * state buttons swap the up/down class so the three tint colours can be judged.
 */
function MilestonePreview(): JSX.Element {
  const [state, setState] = useState<'' | 'up' | 'down'>('up');
  const row = (stat: 'atk' | 'hp'): JSX.Element => (
    <div className="msprev-row">
      {[1, 2, 3, 4, 5].map((t) => (
        <span key={t} className={`badge ${stat}${state ? ` ${state}` : ''}`} data-milestone={t}>
          <img decoding="sync" className="msframe" src={src(stat, t)} alt="" aria-hidden="true" />
          <span className="mstint" aria-hidden="true" />
          <span className="value">{TIER_NUM[t]}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="msprev">
      <div className="msprev-states">
        {([['', 'Neutral'], ['up', 'Buffed'], ['down', 'Reduced']] as const).map(([s, label]) => (
          <button key={label} className={`btn${state === s ? ' on' : ''}`} onClick={() => setState(s)}>{label}</button>
        ))}
      </div>
      <div className="msprev-label">Attack</div>
      {row('atk')}
      <div className="msprev-label">Health</div>
      {row('hp')}
    </div>
  );
}

/**
 * DEV-only tuner for the STAT MILESTONE BADGES (owner ask 2026-09-15) — the per-tier frame art discs, the state
 * tint over them, and the number's size / position / colour. The panel carries a live preview of all ten tiers
 * (owner ask: "put the number value display in the tuner"), so every tier is visible while tuning.
 */
export function MilestoneFrameTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <MilestonePreview /> }} />;
}
