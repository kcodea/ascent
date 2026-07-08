import { useEffect, useState } from 'react';
import type { MomentKind } from './choreo/kinds';
import type { Channel, Cue } from './choreo/score';
import { getScore, setCue, resetScore, scoreJson } from './choreo/score';
import { getChoreoConfig, setChoreoValue, resetChoreoConfig, type ChoreoConfig } from './choreo/choreoConfig';
import { ChoreoTimeline } from './ChoreoTimeline';
import { ChoreoPreviewStage } from './ChoreoPreviewStage';
import { CH_DESC, AT_DESC, PROP_DESC, KIND_DESC } from './choreoLabels';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating Choreography panel (choreographer phase 4) — the authoring surface for the Score
 * (`choreo/score.ts`) + the per-kind hold lengths (`choreo/choreoConfig.ts`). A moment rail (left) selects a
 * `MomentKind`; the editor (right) shows that kind's `hold` (ms) slider plus one row per cue — its anchor
 * (`start`/`contact`/`landed`), a ms `offset`, a `×spd` (scales with combat speed) toggle, and an `on` (enabled)
 * toggle. `tempo` is the global choreo speed. "Copy score" grabs the effective score JSON to paste back as the
 * shipped defaults; "Reset" clears both the score overrides and the config to defaults. Everything persists to
 * localStorage and applies to the NEXT moment. Numbers-first — the drag timeline is a later task. Opened from
 * the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const KINDS = Object.keys(getScore()) as MomentKind[];
/** Which choreoConfig hold key a kind's linger maps to (mirrors choreoConfig's KIND_TO_KEY for the UI). */
const HOLD_KEY: Partial<Record<MomentKind, keyof ChoreoConfig>> = {
  damage: 'dmg', shieldPop: 'shield', poisonTick: 'poison', death: 'death', riseDeath: 'death',
  scCast: 'sc', summon: 'summon', buffWave: 'buff', reborn: 'reborn', ascend: 'improve', rally: 'rally',
  toHand: 'toHand', maxGold: 'maxGold', improve: 'improve', hpGrant: 'hpGrant',
};

export function ChoreographyPanel() {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('choreo');
  // While this panel is open, lift the app-wide FX layers (`.pixifx` z110 / `.pixifx-under` z3) ABOVE the panel
  // (z200) so ▶ Preview's bursts + bubbles draw ON TOP of the widget instead of behind it. The layers are
  // pointer-events:none, so raising them never steals clicks from the panel. Restored on unmount (dev-only).
  useEffect(() => {
    document.body.classList.add('choreo-open');
    return () => document.body.classList.remove('choreo-open');
  }, []);
  const [kind, setKind] = useState<MomentKind>('attackExchange');
  const [fireKey, setFireKey] = useState(0);
  const [, force] = useState(0);
  const refresh = (): void => force((n) => n + 1);
  const cfg = getChoreoConfig();
  const cues = getScore()[kind];
  const patch = (ch: Channel, p: Partial<Cue>): void => { setCue(kind, ch, p); refresh(); };
  const holdKey = HOLD_KEY[kind];

  return (
    <div className="sfxmix choreo" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>🎬 Choreography <span>dev · next moment · drag</span></div>
      <div className="choreo-top">
        <label title={PROP_DESC.tempo}>tempo <input type="range" min={0.5} max={3} step={0.05} value={cfg.speed} onChange={(e) => { setChoreoValue('speed', Number(e.target.value)); refresh(); }} /> {cfg.speed.toFixed(2)}×</label>
        <button className="sfxmix-copy" onClick={() => setFireKey((n) => n + 1)} title={PROP_DESC.preview}>▶ Preview</button>
        <button className="sfxmix-copy" onClick={() => void navigator.clipboard?.writeText(scoreJson())} title={PROP_DESC.copy}>Copy score</button>
        <button className="sfxmix-copy" onClick={() => { resetScore(); resetChoreoConfig(); refresh(); }} title={PROP_DESC.reset}>Reset</button>
      </div>
      <ChoreoPreviewStage kind={kind} fireKey={fireKey} />
      <div className="choreo-stage-note" title="The ▶ Preview fires the selected moment's WebGL FX + sfx against the two mock cards above. React-driven damage floats + CSS unit animations aren't reproduced here — judge those in a real fight.">preview renders where the FX layer is live · WebGL FX + sfx only (floats/CSS not reproduced)</div>
      <div className="choreo-body">
        <div className="choreo-rail">
          {KINDS.map((k) => <button key={k} className={`choreo-m${k === kind ? ' on' : ''}`} onClick={() => setKind(k)} title={KIND_DESC[k]}>{k}</button>)}
        </div>
        <div className="choreo-edit">
          <ChoreoTimeline kind={kind} onChange={refresh} />
          {holdKey && <div className="choreo-hold" title={PROP_DESC.hold}>hold <input type="range" min={0} max={1200} step={10} value={cfg[holdKey]} onChange={(e) => { setChoreoValue(holdKey, Number(e.target.value)); refresh(); }} /> {cfg[holdKey]}ms</div>}
          {cues.map((c) => (
            <div className={`choreo-cue${c.enabled === false ? ' off' : ''}`} key={c.ch}>
              <span className="choreo-ch" title={CH_DESC[c.ch]}>{c.ch}</span>
              <select value={c.at} onChange={(e) => patch(c.ch, { at: e.target.value as Cue['at'] })} title={AT_DESC[c.at]}>
                {(['start', 'contact', 'landed'] as const).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input type="number" step={10} value={c.offset ?? 0} onChange={(e) => patch(c.ch, { offset: Number(e.target.value) })} title={PROP_DESC.offset} /> ms
              <label title={PROP_DESC.scaled}><input type="checkbox" checked={c.scaled !== false} onChange={(e) => patch(c.ch, { scaled: e.target.checked })} />×spd</label>
              <label title={PROP_DESC.enabled}><input type="checkbox" checked={c.enabled !== false} onChange={(e) => patch(c.ch, { enabled: e.target.checked })} />on</label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
