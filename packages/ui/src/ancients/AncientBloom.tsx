import type { CSSProperties } from 'react';
import type { AncientHeroSignature } from './ancientHeroThemes';
import { bloomMarkup, type BloomSvg } from './ancientHeroBloom';

/**
 * The awakening's MEDALLION (the hero power's art in the middle of the bloom) with the hero's bloom-style layers round
 * it (`ancientHeroBloom.ts` says which; `playHeroBloom` animates them; `ancients.css` paints them). Static markup:
 * every mark is drawn once, only transform / opacity move. `sig === null` is the default theme's plain medallion.
 */

/** Small runic marks (24-unit box), the omen glyphs' family. */
const GLYPHS = [
  'M8 2 V22 M8 7 L16 2 M8 13 L16 8',
  'M12 2 V22 M5 7 L12 12 L19 7',
  'M6 2 V22 M18 2 V22 M6 12 L18 12',
  'M12 2 L20 12 L12 22 L4 12 Z',
  'M6 22 L12 2 L18 22 M8 15 H16',
  'M12 2 V22 M4 9 L20 15 M20 9 L4 15',
  'M7 4 L17 4 L7 20 L17 20',
  'M12 3 V21 M6 8 L12 3 L18 8',
];
/** A point on a circle in a 100-unit box: clock angle (0 = top, clockwise) at radius r. */
const pt = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
};
const f = (v: number): string => v.toFixed(2);
/** The dial: a thin ring with 24 ticks (a longer one every quarter), drawn once. */
const DIAL_TICKS = Array.from({ length: 24 }, (_, j) => {
  const [x1, y1] = pt(j * 15, j % 6 === 0 ? 40.5 : 43.5);
  const [x2, y2] = pt(j * 15, 47);
  return `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`;
}).join(' ');
/** A thin jagged ring (lightning-thin), deterministic. */
const JAG = Array.from({ length: 40 }, (_, j) => pt(j * 9, j % 2 ? 45.2 + ((j * 7) % 3) * 0.6 : 48.4 - ((j * 5) % 3) * 0.5).map(f).join(',')).join(' ');
const arcPath = (r: number, from: number, to: number): string => {
  const steps = 32;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const [x, y] = pt(from + ((to - from) * i) / steps, r);
    return `${i ? 'L' : 'M'}${f(x)} ${f(y)}`;
  }).join(' ');
};

function Svg({ s }: { s: BloomSvg }): JSX.Element {
  switch (s.kind) {
    case 'dial':
      return (
        <svg viewBox="0 0 100 100" className={s.bright ? 'bright' : undefined}>
          <circle cx="50" cy="50" r="47" /><path d={DIAL_TICKS} />
        </svg>
      );
    case 'jag':
      return <svg viewBox="0 0 100 100"><polygon className="glow" points={JAG} /><polygon points={JAG} /></svg>;
    case 'glyph':
      return <svg viewBox="0 0 24 24" style={{ transform: `rotate(${s.rot}deg)` }}><path d={GLYPHS[s.i % GLYPHS.length]} /></svg>;
    case 'vine':
      return (
        <svg viewBox="0 0 24 24" style={{ transform: `rotate(${s.rot + 90}deg)${s.flip ? ' scaleX(-1)' : ''}` }}>
          <path d="M1 16 C 7 10, 13 16, 23 9" /><path d="M12 13.4 C 12.5 9.5, 15.5 8.6, 16.8 10.4 C 17.8 11.8, 16 13, 14.8 12" />
          <path className="leaf" d="M6 12.6 C 5 9.5, 7.5 7.6, 9.4 8.2 C 9.2 10.4, 8 12.2, 6 12.6 Z" />
        </svg>
      );
    case 'arc': {
      const [ax, ay] = pt(s.from, s.r), [bx, by] = pt(s.to, s.r);
      return (
        <svg viewBox="0 0 100 100">
          <path d={arcPath(s.r, s.from, s.to)} />
          {s.dots && <><circle className="dot" cx={f(ax)} cy={f(ay)} r="1.3" /><circle className="dot" cx={f(bx)} cy={f(by)} r="1.3" /></>}
        </svg>
      );
    }
    case 'crown':
      return <svg viewBox="0 0 40 24"><path d="M5 20 L7 8 L14 14 L20 4 L26 14 L33 8 L35 20 Z" /><path d="M7 16.5 H33" /></svg>;
  }
}

export function AncientBloomMedal({ art, sig, hidden }: { art: string; sig: AncientHeroSignature | null; hidden: boolean }): JSX.Element {
  const mk = bloomMarkup(sig);
  return (
    <div className={`anc-gate-medalwrap${mk ? ` ${mk.wrapCls}` : ''}`}>
      {mk?.out.map((c) => <span key={c} className={c} />)}
      <div className="anc-gate-medal" style={hidden ? { opacity: 0 } : undefined}>
        <img className="anc-gate-medal-art" src={art} alt="" draggable={false} decoding="sync" />
        {mk?.in.map((c) => <span key={c} className={c} />)}
      </div>
      {mk?.layers.map((l, li) => (
        <div key={li} className={`anc-acc anc-acc-${l.name}${l.cls ? ` ${l.cls}` : ''}`}>
          {l.parts.map((p, i) => (
            <i key={i} className={`anc-acc-p p${i}${p.cls ? ` ${p.cls}` : ''}`} style={p.pos ? ({ left: `${p.pos.x}%`, top: `${p.pos.y}%` } as CSSProperties) : undefined}>
              {p.svg && <Svg s={p.svg} />}
              {p.img && <img src={art} alt="" draggable={false} decoding="sync" />}
            </i>
          ))}
        </div>
      ))}
    </div>
  );
}
