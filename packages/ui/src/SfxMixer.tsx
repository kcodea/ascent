import { useEffect, useRef, useState } from 'react';
import {
  getAudioConfig, setBusGain, setMasterComp, setCategory, previewSfx,
  meterLevel, gainReduction, exportConfig, playScene, SCENES,
} from './sfx';
import { BUS_NAMES, type BusName, type CompConfig, type CategoryConfig } from './audio/config';
import { useDraggablePanel } from './useDraggablePanel';

const MASTER_DIALS: { k: keyof CompConfig; min: number; max: number; step: number }[] = [
  { k: 'threshold', min: -60, max: 0, step: 1 }, { k: 'ratio', min: 1, max: 20, step: 0.5 },
  { k: 'knee', min: 0, max: 40, step: 1 }, { k: 'attack', min: 0, max: 0.05, step: 0.001 },
  { k: 'release', min: 0.01, max: 1, step: 0.01 },
];

/** DEV-only mixing desk: per-bus faders + master limiter dials + live meters (peak + gain-reduction) +
 *  realistic test-scenes + Export config (paste the JSON into DEFAULT_AUDIO_CONFIG). Opened from DevMenu. */
export function SfxMixer() {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const cfg = getAudioConfig();
  const meters = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      for (const key of ['master', ...BUS_NAMES]) {
        const el = meters.current[key];
        if (el) el.style.transform = `scaleX(${meterLevel(key).toFixed(3)})`;
      }
      const gr = meters.current.gr;
      if (gr) gr.style.transform = `scaleX(${gainReduction().toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const catsByBus = (b: BusName): [string, CategoryConfig][] =>
    Object.entries(cfg.categories).filter(([, c]) => c.bus === b);
  const bar = (key: string) => (
    <div className="mtr"><div className="mtr-fill" ref={(el) => { meters.current[key] = el; }} /></div>
  );
  const copy = (): void => {
    void navigator.clipboard?.writeText(exportConfig());
    setCopied(true); window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="desk" ref={panelRef} style={panelStyle}>
      <div className="desk-h drag" onPointerDown={headerPointerDown}>Mixing Desk <span>dev · drag</span></div>

      <section className="desk-master">
        <h4>Master {bar('master')}</h4>
        <div className="desk-gr">GR <div className="mtr"><div className="mtr-fill" ref={(el) => { meters.current.gr = el; }} /></div></div>
        {MASTER_DIALS.map(({ k, min, max, step }) => (
          <label key={k} className="dial"><span>{k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg.master[k]}
              onChange={(e) => { setMasterComp(k, Number(e.target.value)); force((n) => n + 1); }} />
            <b>{cfg.master[k]}</b>
          </label>
        ))}
      </section>

      {BUS_NAMES.map((b) => (
        <section className="desk-bus" key={b}>
          <h4>{b} {bar(b)}</h4>
          <label className="fader"><span>level</span>
            <input type="range" min={0} max={150} value={Math.round(cfg.buses[b].gain * 100)}
              onChange={(e) => { setBusGain(b, Number(e.target.value) / 100); force((n) => n + 1); }} />
            <b>{Math.round(cfg.buses[b].gain * 100)}</b>
          </label>
          {catsByBus(b).map(([cat, c]) => (
            <div className="desk-cat" key={cat}>
              <span className="cn">{cat}</span>
              <input type="range" min={0} max={100} value={Math.round(c.gain * 100)}
                onChange={(e) => { setCategory(cat, { gain: Number(e.target.value) / 100 }); force((n) => n + 1); }} />
              <select value={c.bus} onChange={(e) => { setCategory(cat, { bus: e.target.value as BusName }); force((n) => n + 1); }}>
                {BUS_NAMES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <button onClick={() => previewSfx(cat)} title={`Preview ${cat}`}>▶</button>
            </div>
          ))}
        </section>
      ))}

      <section className="desk-scenes">
        <h4>Scenes</h4>
        {SCENES.map((s) => <button key={s.id} onClick={() => playScene(s.id)}>{s.name}</button>)}
      </section>

      <button className="desk-export" onClick={copy}>{copied ? 'Copied!' : 'Export config'}</button>
    </div>
  );
}
