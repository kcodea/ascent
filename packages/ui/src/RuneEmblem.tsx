import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RUNE_INDEX } from '@game/content';
import { mdBold } from './Card';
import { runeArt } from './art';
import { Icon } from './Icon';
import { rectToStage, stageHost, stageViewport } from './stage';

/** One rune the run picked: its emblem (the real rune art) + name; hovering floats the rune's text in a
 *  styled panel (portalled + fixed, so the scrolling list never clips it — never a native tooltip). */
export function RuneEmblem({ runeId }: { runeId: string }) {
  const rune = RUNE_INDEX[runeId];
  const [tip, setTip] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (!rune) return null;
  const art = runeArt(rune.id);
  const show = (el: HTMLElement): void => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // One layout read per hover (never per frame): anchor the panel under the emblem, centred, flipping
      // above when the row sits near the bottom of the screen.
      const r = rectToStage(el.getBoundingClientRect()); // stage px (stage.ts): written as the tip's CSS left/top
      const vp = stageViewport();
      const w = 280;
      const left = Math.max(8, Math.min(vp.w - w - 8, r.left + r.width / 2 - w / 2));
      const above = r.bottom + 150 > vp.h;
      setTip({ left, top: above ? r.top - 10 : r.bottom + 10, above });
    }, 160);
  };
  const hide = (): void => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    setTip(null);
  };
  return (
    <div className={`cv2-rune${rune.epic ? ' epic' : ''}`} onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={hide}>
      <div className="cv2-rune-disc">
        {art ? <img decoding="sync" className="cv2-rune-art" src={art} alt="" aria-hidden /> : <span className="cv2-rune-emblem" aria-hidden><Icon name="anvil" /></span>}
      </div>
      <div className="cv2-rune-name">{rune.name}</div>
      {tip && createPortal(
        <div className={`cv2-rune-tip${tip.above ? ' above' : ''}`} role="tooltip" style={{ left: tip.left, top: tip.top }}>
          <div className="cv2-rune-tip-name">{rune.name}<span className="cv2-rune-tip-kind">{rune.epic ? 'Epic Rune' : 'Rune'}</span></div>
          <div className="cv2-rune-tip-body" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
        </div>,
        stageHost(),
      )}
    </div>
  );
}
