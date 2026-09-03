import { useEffect, useRef, useState } from 'react';
import {
  getAudioConfig, setBusGain, setMasterComp, setCategory, previewSfx,
  meterLevel, gainReduction, exportConfig, playScene, SCENES,
  clipNames, clipGain, setClipGain, previewClip,
} from './sfx';
import { BUS_NAMES, CATEGORY_LABEL, type BusName, type CompConfig, type CategoryConfig } from './audio/config';
import { familyOf, CLIP_LABEL } from './audio/clipFamily';
import { useDraggablePanel } from './useDraggablePanel';

const MASTER_DIALS: { k: keyof CompConfig; min: number; max: number; step: number }[] = [
  { k: 'threshold', min: -60, max: 0, step: 1 }, { k: 'ratio', min: 1, max: 20, step: 0.5 },
  { k: 'knee', min: 0, max: 40, step: 1 }, { k: 'attack', min: 0, max: 0.05, step: 0.001 },
  { k: 'release', min: 0.01, max: 1, step: 0.01 },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Round to 3 decimals so the readouts stay tidy (0.09, not 0.09000000001). */
const tidy = (v: number): number => Math.round(v * 1000) / 1000;

/** DEV-only mixing desk: a horizontal console of channel strips with VERTICAL faders — master limiter dials +
 *  per-bus faders + per-category faders. EVERY fader has a numeric field beside it that shows the current value
 *  and can be TYPED into for an exact setting (drag = coarse, type = precise). Each sound also has a ▶ to play it
 *  and a bus dropdown. Live peak + gain-reduction meters, test-scenes, and Export config (paste into
 *  DEFAULT_AUDIO_CONFIG). Draggable (header) + resizable (bottom-right corner). Opened from DevMenu. */
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
  // Every committed clip bucketed under its category (group) — so a bundle category (attack, heroSelect, …)
  // can show one channel fader per clip beneath its group fader. Derived from the audio glob, so a new file
  // just appears. A 1-clip category is left as its single group fader (that fader already IS its one sound).
  const clipsByCat = new Map<string, string[]>();
  for (const clip of clipNames()) {
    const cat = familyOf(clip);
    (clipsByCat.get(cat) ?? clipsByCat.set(cat, []).get(cat)!).push(clip);
  }
  const copy = (): void => {
    void navigator.clipboard?.writeText(exportConfig());
    setCopied(true); window.setTimeout(() => setCopied(false), 1400);
  };

  /** A number field bound to a value; commits any parseable number (ignores mid-typing junk), clamped. */
  const numField = (value: number, min: number, max: number, apply: (n: number) => void, title: string) => (
    <input className="numf" type="number" min={min} max={max} step="any" value={tidy(value)} title={title}
      onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) { apply(clamp(n, min, max)); rerender(); } }} />
  );

  return (
    <div className="desk" ref={panelRef} style={panelStyle}>
      <div className="desk-h drag" onPointerDown={headerPointerDown}>Mixing Desk <span>dev · drag header · resize ⤡</span></div>
      <div className="desk-hint">Drag a fader <b>or type an exact number</b> under it. <b>▶</b> plays that sound · <b>bus</b> dropdown regroups it · <b>Scenes</b> fire bursts · <b>Export</b> copies the tuning.</div>

      <div className="sec-l big">Master &amp; buses — overall levels + limiter</div>
      {/* Console — a horizontal row of channel strips with vertical faders + typed numeric fields */}
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
                {numField(cfg.master[k], min, max, (n) => setMasterComp(k, n), `master limiter ${k}`)}
                <span className="vdial-l" title={`master limiter ${k}`}>{k}</span>
              </div>
            ))}
          </div>
          <div className="strip-name">MASTER</div>
        </div>

        {/* Bus strips — gain 0..1.5 */}
        {BUS_NAMES.map((b) => (
          <div className={`strip strip-bus bus-${b}`} key={b}>
            {vmeter(b)}
            <input className="vfader" type="range" min={0} max={1.5} step={0.01} value={cfg.buses[b].gain}
              onChange={(e) => { setBusGain(b, Number(e.target.value)); rerender(); }} />
            {numField(cfg.buses[b].gain, 0, 1.5, (n) => setBusGain(b, n), `${b} bus gain`)}
            <div className="strip-name">{b}</div>
          </div>
        ))}
      </div>

      {/* Scenes — realistic stacks */}
      <div className="desk-scenes">
        <span className="sec-l">scenes</span>
        {SCENES.map((s) => <button key={s.id} onClick={() => playScene(s.id)}>{s.name}</button>)}
      </div>

      <div className="sec-l big">Sounds — grouped by bus (fader / number = level, ▶ = play, dropdown = bus)</div>
      {/* Categories — grouped by bus; each: vertical fader, typed number, ▶, bus reassign, name. gain 0..1 */}
      <div className="desk-cats">
        {BUS_NAMES.map((b) => (
          <div className={`cat-group bus-${b}`} key={b}>
            <div className={`cat-group-h bus-${b}`}>{b}</div>
            <div className="cat-strips">
              {catsByBus(b).map(([cat, c]) => (
                <div className="cstrip" key={cat}>
                  <input className="vfader sm" type="range" min={0} max={1} step={0.01} value={c.gain}
                    onChange={(e) => { setCategory(cat, { gain: Number(e.target.value) }); rerender(); }} />
                  {numField(c.gain, 0, 1, (n) => setCategory(cat, { gain: n }), `${cat} level`)}
                  <button className="play" onClick={() => previewSfx(cat)} title={`Play ${CATEGORY_LABEL[cat] ?? cat}`}>▶</button>
                  <select value={c.bus} title="move this sound to another bus"
                    onChange={(e) => { setCategory(cat, { bus: e.target.value as BusName }); rerender(); }}>
                    {BUS_NAMES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <div className="cstrip-name" title={CATEGORY_LABEL[cat] ? `${CATEGORY_LABEL[cat]} (${cat})` : cat}>{CATEGORY_LABEL[cat] ?? cat}</div>
                  {/* Per-clip CHANNEL faders — one per sound bundled under this group. Only when the group holds
                      MORE than one clip; a 1-clip category's group fader above already moves its single sound.
                      Each fader is a multiplier on top of the group (1 = untouched → the mix is unchanged). */}
                  {(clipsByCat.get(cat) ?? []).length > 1 && (
                    <div className="clip-faders">
                      {(clipsByCat.get(cat) ?? []).map((clip) => (
                        <div className="clipstrip" key={clip}>
                          <button className="play" onClick={() => previewClip(clip)} title={`Play ${CLIP_LABEL[clip] ?? clip}`}>▶</button>
                          <input className="chfader" type="range" min={0} max={2} step={0.01} value={clipGain(clip)}
                            onChange={(e) => { setClipGain(clip, Number(e.target.value)); rerender(); }} />
                          {numField(clipGain(clip), 0, 2, (n) => setClipGain(clip, n), `${clip} channel level (× group)`)}
                          <div className="clipstrip-name" title={clip}>{CLIP_LABEL[clip] ?? clip}</div>
                        </div>
                      ))}
                    </div>
                  )}
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
