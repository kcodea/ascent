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

/** DEV-only mixing desk: a horizontal console of channel strips with VERTICAL faders — master limiter dials +
 *  per-bus faders + per-category faders, each with its own ▶ to play that sound individually. Live peak +
 *  gain-reduction meters, realistic test-scenes, and Export config (paste the JSON into DEFAULT_AUDIO_CONFIG).
 *  Draggable (header) and resizable (drag the bottom-right corner). Opened from DevMenu. */
export function SfxMixer() {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const cfg = getAudioConfig();
  const rerender = (): void => force((n) => n + 1);
  const meters = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      for (const key of ['master', ...BUS_NAMES]) {
        const el = meters.current[key];
        if (el) el.style.transform = `scaleY(${meterLevel(key).toFixed(3)})`;
      }
      const gr = meters.current.gr;
      if (gr) gr.style.transform = `scaleY(${gainReduction().toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const vmeter = (key: string) => (
    <div className="vmtr"><div className="vmtr-fill" ref={(el) => { meters.current[key] = el; }} /></div>
  );
  const catsByBus = (b: BusName): [string, CategoryConfig][] =>
    Object.entries(cfg.categories).filter(([, c]) => c.bus === b);
  const copy = (): void => {
    void navigator.clipboard?.writeText(exportConfig());
    setCopied(true); window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="desk" ref={panelRef} style={panelStyle}>
      <div className="desk-h drag" onPointerDown={headerPointerDown}>Mixing Desk <span>dev · drag header · resize ⤡</span></div>
      <div className="desk-hint">Drag a fader up/down to set its level. <b>▶</b> plays that sound. The <b>bus</b> dropdown moves a sound to another group. <b>Scenes</b> fire realistic bursts. <b>Export</b> copies the current tuning.</div>

      <div className="sec-l big">Master &amp; buses — overall levels + limiter</div>
      {/* Console — a horizontal row of channel strips with vertical faders */}
      <div className="console">
        {/* Master strip: the limiter dials (vertical) + peak & gain-reduction meters */}
        <div className="strip strip-master">
          <div className="strip-meters">
            <div className="mcol">{vmeter('master')}<span className="mcol-l">out</span></div>
            <div className="mcol"><div className="vmtr gr"><div className="vmtr-fill" ref={(el) => { meters.current.gr = el; }} /></div><span className="mcol-l">gr</span></div>
          </div>
          <div className="strip-dials">
            {MASTER_DIALS.map(({ k, min, max, step }) => (
              <div className="vdial" key={k}>
                <input className="vfader tiny" type="range" min={min} max={max} step={step} value={cfg.master[k]}
                  onChange={(e) => { setMasterComp(k, Number(e.target.value)); rerender(); }} />
                <span className="vdial-l" title={`master limiter ${k}`}>{k}</span>
                <b>{cfg.master[k]}</b>
              </div>
            ))}
          </div>
          <div className="strip-name">MASTER</div>
        </div>

        {/* Bus strips */}
        {BUS_NAMES.map((b) => (
          <div className={`strip strip-bus bus-${b}`} key={b}>
            {vmeter(b)}
            <input className="vfader" type="range" min={0} max={150} value={Math.round(cfg.buses[b].gain * 100)}
              onChange={(e) => { setBusGain(b, Number(e.target.value) / 100); rerender(); }} />
            <b>{Math.round(cfg.buses[b].gain * 100)}</b>
            <div className="strip-name">{b}</div>
          </div>
        ))}
      </div>

      {/* Scenes — realistic stacks */}
      <div className="desk-scenes">
        <span className="sec-l">scenes</span>
        {SCENES.map((s) => <button key={s.id} onClick={() => playScene(s.id)}>{s.name}</button>)}
      </div>

      <div className="sec-l big">Sounds — grouped by bus (fader = level, ▶ = play, dropdown = bus)</div>
      {/* Categories — grouped by bus; each has a vertical fader, a ▶ to play it individually, and a bus reassign */}
      <div className="desk-cats">
        {BUS_NAMES.map((b) => (
          <div className="cat-group" key={b}>
            <div className={`cat-group-h bus-${b}`}>{b}</div>
            <div className="cat-strips">
              {catsByBus(b).map(([cat, c]) => (
                <div className="cstrip" key={cat}>
                  <input className="vfader sm" type="range" min={0} max={100} value={Math.round(c.gain * 100)}
                    onChange={(e) => { setCategory(cat, { gain: Number(e.target.value) / 100 }); rerender(); }} />
                  <button className="play" onClick={() => previewSfx(cat)} title={`Play ${cat}`}>▶</button>
                  <select value={c.bus} title="move this sound to another bus"
                    onChange={(e) => { setCategory(cat, { bus: e.target.value as BusName }); rerender(); }}>
                    {BUS_NAMES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <div className="cstrip-name" title={cat}>{cat}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button className="desk-export" onClick={copy}>{copied ? 'Copied!' : 'Export config'}</button>
    </div>
  );
}
