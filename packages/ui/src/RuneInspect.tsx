import { useEffect, useLayoutEffect, useRef } from 'react';
import { RuneCard, runeRewardViews } from './RuneCard';
import { Card } from './Card';
import { upgradeImages } from './fullResArt';
import { closeRuneInspect, useRuneInspect } from './runeInspectStore';
import { useGame } from './store';
import { usePhLayer } from './partyHome/shell/usePhLayer';
import { planRuneInspect, type Box } from './runeInspectLayout';
import './discoverEntrance/discoverEntrance.css'; // the gold action pill the Pick button reuses

const NOOP = (): void => {};

/** The clear space between the rune and the first card it names, and between two named cards (layout px, before the fit scale). */
const GAP = 28;
/** The largest the group is drawn: the card Inspect's own enlargement (`.inspect-card`, scale 1.9). */
const MAX_K = 1.9;

const union = (a: Box, b: Box): Box => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });
/** Screen rects -> the overlay's own layout px. The game may draw scaled (the stage), zoomed (a phone's page scale) or turned a
 *  quarter (a phone held upright, the game laid sideways), so the map is probed, not assumed: see `fitGroup`. */
type ToLocal = (r: DOMRect) => Box;
/** What a plated card PAINTS: its plate, the "Shop Spell" label under it and a frame's spill reach far past its layout box (a
 *  Mooncloud plate's clouds past the standard edge), so the box alone cannot place it. The union of everything it draws. */
function paintedBox(el: Element, loc: ToLocal): Box {
  let u = loc(el.getBoundingClientRect());
  for (const d of el.querySelectorAll('*')) {
    const r = d.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) u = union(u, loc(r));
  }
  return u;
}

/**
 * Lay the rune and the cards it names out as ONE centred group (R-RUNE-INSPECT-01; owner report 2026-11-13, Compendium: the
 * Staff of Guel preview lapped over the rune card, hung lower than it, and the pair sat off centre). A plated card paints
 * far outside its layout box, so flex layout cannot space it: this measures what each piece actually paints, ONCE per open
 * (and on a window resize; never per frame), and `planRuneInspect` places it. Written straight onto the elements' styles
 * before the first paint.
 */
function fitGroup(ov: HTMLElement, group: HTMLElement, pick: boolean): void {
  const rune = group.querySelector('.rune-inspect-tablet .runecard');
  const origin = group.querySelector('.rune-inspect-origin');
  if (!rune || !origin) return;
  const items = [...group.querySelectorAll<HTMLElement>('.rune-inspect-reward')];
  group.style.transform = 'none';
  for (const it of items) it.style.translate = '';
  // Probe the map from layout px to screen px with two known moves of the group.
  const o0 = origin.getBoundingClientRect();
  group.style.transform = 'translate(1000px, 0px)';
  const o1 = origin.getBoundingClientRect();
  group.style.transform = 'translate(0px, 1000px)';
  const o2 = origin.getBoundingClientRect();
  group.style.transform = 'none';
  const ex = { x: (o1.left - o0.left) / 1000, y: (o1.top - o0.top) / 1000 };
  const ey = { x: (o2.left - o0.left) / 1000, y: (o2.top - o0.top) / 1000 };
  const det = ex.x * ey.y - ey.x * ex.y;
  if (!det) return; // not laid out (a hidden tab): keep the plain layout
  // Local coordinates with the group's own top-left as (0, 0).
  const pt = (x: number, y: number): { x: number; y: number } => {
    const dx = x - o0.left;
    const dy = y - o0.top;
    return { x: (ey.y * dx - ey.x * dy) / det, y: (ex.x * dy - ex.y * dx) / det };
  };
  const loc: ToLocal = (r) => {
    const a = pt(r.left, r.top);
    const b = pt(r.right, r.bottom);
    const c = pt(r.left, r.bottom);
    const d = pt(r.right, r.top);
    return { l: Math.min(a.x, b.x, c.x, d.x), t: Math.min(a.y, b.y, c.y, d.y), r: Math.max(a.x, b.x, c.x, d.x), b: Math.max(a.y, b.y, c.y, d.y) };
  };

  // The rune: its card plus the cost coin riding its top edge (its art's blurred copy is clipped by the face, so not a union
  // of all). The named cards line up with the rune CARD's top; the coin above it only counts for the fit.
  const coin = rune.querySelector('.runecard-cost');
  const body = loc(rune.getBoundingClientRect());
  const R = coin ? union(body, loc(coin.getBoundingClientRect())) : body;
  const U = items.map((it) => paintedBox(it, loc));
  // Each card's plate top (its frame's top edge; a minion's gem may ride above it) is what lines up with the rune's top.
  const tops = items.map((it, i) => { const p = it.querySelector('.cardplate:not(.plate-interior)'); return p ? loc(p.getBoundingClientRect()).t : U[i].t; });
  const plan = planRuneInspect({ body, rune: R, cards: U, tops, ov: loc(ov.getBoundingClientRect()), pick, gap: GAP, maxK: MAX_K });
  items.forEach((it, i) => { const o = plan.off[i]; it.style.translate = `${o.x}px ${o.y}px`; });
  const { k, tx, ty } = plan;
  group.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
}

/**
 * THE RUNE INSPECT (owner 2026-10-25, R-TOUCH-TAPINSPECT-01): the rune card enlarged with the cards its reward names beside it,
 * over the same dimmed backdrop as the card Inspect. Opened by a hold on a Runeforge offer (touch; its Pick button buys it
 * exactly as the tap used to) or by a press on a rune in the Compendium. Tap the backdrop (or Escape) to close. It closes
 * itself when the forge closes (the offer it shows is gone).
 */
export function RuneInspect() {
  const view = useRuneInspect((s) => s.view);
  const forgeOpen = useGame((s) => !!s.run?.runeforgeOffer);
  const ref = useRef<HTMLDivElement | null>(null);
  const ovRef = useRef<HTMLDivElement | null>(null);
  usePhLayer(!!view, closeRuneInspect);
  useEffect(() => { if (view && !forgeOpen && !view.fromBook) closeRuneInspect(); }, [view, forgeOpen]);
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeRuneInspect(); };
    window.addEventListener('keydown', onKey);
    const restore = upgradeImages(ref.current);
    // The rune's own hover preview (the RuneCard under the press, R-RUNE-PREVIEW) would float, blurred, behind the view.
    document.body.classList.add('rune-inspecting');
    return () => { window.removeEventListener('keydown', onKey); restore(); document.body.classList.remove('rune-inspecting'); };
  }, [view]);
  useLayoutEffect(() => {
    const ov = ovRef.current;
    const group = ref.current;
    if (!view || !ov || !group) return;
    const pick = view.affordable;
    const fit = (): void => fitGroup(ov, group, pick);
    fit();
    group.classList.add('is-fit');
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [view]);
  if (!view) return null;
  const rewards = runeRewardViews(view.rune);
  return (
    <div className="inspect-ov rune-inspect-ov" ref={ovRef} onClick={closeRuneInspect} onContextMenu={(e) => { e.preventDefault(); closeRuneInspect(); }} role="dialog" aria-label={`${view.rune.name}. Close to dismiss.`}>
      <div className="rune-inspect" ref={ref} onClick={(e) => e.stopPropagation()}>
        <i className="rune-inspect-origin" aria-hidden="true" />
        <div className="rune-inspect-pop">
          <div className="rune-inspect-tablet">
            <RuneCard rune={view.rune} cost={view.cost} duplicating={view.duplicating} affordable={view.affordable || !!view.fromBook} onBuy={NOOP} />
          </div>
          {rewards.length > 0 && (
            <div className="rune-inspect-rewards">
              {rewards.map((rv, i) => <div className="rune-inspect-reward" key={`${rv.cardId ?? i}-${i}`}><Card card={rv} forceFull suppressPop plated /></div>)}
            </div>
          )}
        </div>
      </div>
      {view.affordable && (
        <button
          type="button"
          className="disc-toggle disc-peek inspect-act"
          onClick={(e) => { e.stopPropagation(); const pick = view.pick; closeRuneInspect(); pick(); }}
          aria-label={`Pick ${view.rune.name}`}
        >
          <span className="disc-peek-glow" aria-hidden="true" />
          <span className="disc-peek-label">Pick</span>
        </button>
      )}
    </div>
  );
}
