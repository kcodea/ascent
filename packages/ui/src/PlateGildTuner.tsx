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
 * "Play here" fires a mock gild over a real card on screen, so it can be dialed without assembling a real
 * triple. The effect opens with the copies already gathered centre screen, so it only needs that card's
 * rect and how many copies were consumed.
 */
const LABELS: Record<string, string> = {
  inMs: '1 · appear (ms)', fuseMs: '2 · fuse (ms)', crownMs: '3 · crown (ms)', outMs: '4 · fly home (ms)',
  flyInEase: 'appear · ease', flyStag: 'appear · stagger', centreScale: 'appear · scale',
  cluster: 'appear · cluster', fanTilt: 'appear · fan tilt', scrim: 'appear · scrim',
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
  // A mock gild against a real card on screen, so the clone has something to look like. The effect opens
  // with the copies already gathered, so all it needs is that card's rect and how many were consumed.
  const demo = (): void => {
    const real = document.querySelector<HTMLElement>('.row.hand .card[data-uid]')
      ?? document.querySelector<HTMLElement>('.row .card[data-uid]');
    if (!real) return;
    const r = real.getBoundingClientRect();
    if (r.width > 0) playPlateGild(r, real, 3);
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
