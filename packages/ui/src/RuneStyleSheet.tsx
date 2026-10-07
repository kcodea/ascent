import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { RUNE_INDEX } from '@game/content';
import { RuneCard } from './RuneCard';
import './runeStyles.css';

/**
 * THE RUNE CARD STYLE SHEET (DEV only, owner ask 2026-10-07): six genuinely different rune-card plate treatments side
 * by side, numbered 1-6, each shown on the same Basic rune (Rune of Hunger) and one Epic (Rune of Drakko), so the owner
 * can pick in seconds. Owned and rendered by the Scene Builder's "Rune card styles" button (so it exists wherever that
 * button does) and portalled to <body> above everything, an open Runeforge included; Esc or Close returns to whatever
 * was underneath. Nothing here touches the run. The forge keeps its current look until
 * a style is picked; the chosen look then becomes RuneCard's default and this sheet is deleted.
 */
const LOOKS: readonly { n: number; name: string; note: string }[] = [
  { n: 1, name: 'Painted plate', note: "The minion card's own painted plate (cardplate-<tribe>), the art set into it" },
  { n: 2, name: 'Spell sibling', note: "The shop spell tile's painted arch frame around the art, the text on a plate below" },
  { n: 3, name: 'Dark glass', note: 'Deep saturated tribe glass, a layered bright gold rim, crisp art' },
  { n: 4, name: 'Art-forward tall', note: 'The full art large on top, a Gem plate name banner across the middle' },
  { n: 5, name: 'Minimal premium', note: 'Near-black, one tribe accent line and glow, quiet type' },
  { n: 6, name: 'Reference', note: "The reference's rich saturated tint and bright gold frame, without props" },
];

export function RuneStyleSheet({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const basic = RUNE_INDEX['rune_hunger'];
  const epic = RUNE_INDEX['rune_drakko'];
  return createPortal(
    <div className="rss" role="dialog" aria-label="Rune card styles">
      <div className="rss-head">
        <b>Rune card styles</b><span>Pick a number. Basic: Rune of Hunger. Epic: Rune of Drakko.</span>
        <button className="rss-close" onClick={onClose}>Close (Esc)</button>
      </div>
      <div className="rss-grid">
        {LOOKS.map((l) => (
          <section className="rss-cell" key={l.n}>
            <div className="rss-label"><span className="rss-n">{l.n}</span><b>{l.name}</b><i>{l.note}</i></div>
            <div className="rss-cards">
              {basic && <RuneCard rune={basic} affordable onBuy={() => {}} look={l.n} />}
              {epic && <RuneCard rune={epic} affordable onBuy={() => {}} look={l.n} />}
            </div>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}
