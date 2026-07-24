import { useState } from 'react';
import {
  PG_NUM_KEYS, PG_COLOR_KEYS, PG_FLOURISHES, PG_RANGES, PG_DESC,
  getPlateGildConfig, resetPlateGildConfig, setPlateGildValue, playPlateGild, plateGildDuration,
  type PlateGildConfig,
} from './plateGild';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the PLATE GILD (`plateGild.ts`) — three copies combining into a gilded card.
 *
 * Each of the four beats has ONE duration and its internals are shares of it, so tightening a beat can't
 * silently lengthen the effect. The header shows the derived TOTAL, which accounts for the two things that
 * bend it: `crownLead` overlaps the crown into the fuse and SHORTENS the run, and a flourish longer than
 * its beat EXTENDS it.
 *
 * "Play here" fires a mock gild beside the panel — three source rects and a destination — so it can be
 * dialed without assembling a real triple.
 */
const LABELS: Record<string, string> = {
  inMs: '1 · fly in (ms)', fuseMs: '2 · fuse (ms)', crownMs: '3 · crown (ms)', outMs: '4 · fly home (ms)',
  flyInEase: 'in · ease', flyStag: 'in · stagger', centreScale: 'in · centre scale',
  cluster: 'in · cluster', fanTilt: 'in · fan tilt', scrim: 'in · scrim',
  holdFrac: 'fuse · hold share', streamCount: 'fuse · stream', arc: 'fuse · arc',
  fuseSize: 'fuse · mote size', trail: 'fuse · trail',
  crownLead: 'crown · overlap', wireInFrac: 'crown · wire in', wireHoldFrac: 'crown · wire hold',
  wireInten: 'crown · intensity', punch: 'crown · punch', g1v: 'crown · glow near', g2v: 'crown · glow far',
  cardFlash: 'crown · card flash', burst: 'crown · burst', burstSpd: 'crown · burst speed',
  flFrac: 'flourish · length', flSize: 'flourish · size', flInten: 'flourish · intensity',
  flSpin: 'flourish · spin',
  savourFrac: 'home · savour share', flyOutEase: 'home · ease',
  grad: 'gold · gradient', cDeep: 'gold · deep', cMid: 'gold · mid', cCore: 'gold · core',
};

export function PlateGildTuner() {
  const [cfg, setCfg] = useState<PlateGildConfig>(getPlateGildConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('plategild');

  const set = (k: keyof PlateGildConfig, v: number | string): void => {
    setPlateGildValue(k, v);
    setCfg({ ...getPlateGildConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getPlateGildConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetPlateGildConfig(); setCfg({ ...getPlateGildConfig() }); };
  // A mock gild: three scattered sources and a destination, using a real hand card if one is on screen so
  // the clone has something to look like.
  const demo = (): void => {
    const w = 150, h = w * 1.555;
    const real = document.querySelector<HTMLElement>('.row.hand .card[data-uid]')
      ?? document.querySelector<HTMLElement>('.row .card[data-uid]');
    if (!real) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const mk = (x: number, y: number) => ({ left: x, top: y, width: w, height: h });
    playPlateGild(
      [mk(vw * 0.18, vh * 0.72), mk(vw * 0.34, vh * 0.72)],
      mk(vw * 0.26, vh * 0.72),
      real,
    );
  };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        Plate Gild <span>dev · {Math.round(plateGildDuration())}ms total</span>
      </div>
      {PG_NUM_KEYS.map((k) => {
        const [min, max, step] = PG_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={PG_DESC[k]}>{LABELS[k] ?? k}</span>
            <input
              type="range" min={min} max={max} step={step}
              value={cfg[k as keyof PlateGildConfig] as number}
              onChange={(e) => set(k as keyof PlateGildConfig, Number(e.target.value))}
            />
            <span className="sfxmix-val">{String(cfg[k as keyof PlateGildConfig])}</span>
          </div>
        );
      })}
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="The signature only gilding gets.">flourish</span>
        <select value={cfg.flourishType} onChange={(e) => set('flourishType', e.target.value)}>
          {PG_FLOURISHES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="sfxmix-val" />
      </div>
      {PG_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={PG_DESC[k]}>{LABELS[k]}</span>
          <input type="color" value={cfg[k]} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={demo}>Play here</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
