/**
 * THE CAST PREVIEW LAYER — renders `castPreview.ts`'s entries: the spell a rune or minion just cast, as the
 * plated card the hover reveal shows (`Card` with `forceFull plated`), SCALED by the Cast Preview tuner (owner
 * 2026-09-23: the full-size card was "far too large … massive"), floating beside the caster. Mounted once from
 * `Game.tsx` so it serves the shop AND the combat replay. Size, side, offset, fade timings and max opacity all
 * come from `castPreviewConfig.ts` (per context: shop / combat); nothing here is a hard-coded number.
 *
 *   · A fixed, `pointer-events: none` layer: it never blocks input and never shifts layout.
 *   · One layout read per preview, at mount (`useLayoutEffect`, before paint): the card's own size, for the
 *     on-screen clamp + the sideways nudge off a live neighbour (`placeCastPreview`). Never per frame.
 *   · Entrance/exit are one-shot CSS animations on opacity + transform (`castprevin` / `castprevout`).
 *
 * `CastPreviewLayerView` is the pure half (entries + a view builder in), so a jsdom test can mount it without
 * the game store; `CastPreviewLayer` wires it to the store and the shop's live-text chain (`conjuredView`, the
 * builder the combat fly-ins use — a spell prints its CURRENT value, a Ruby its live worth).
 */
import { memo, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Card, type CardView } from './Card';
import { useGame } from './store';
import { conjuredView } from './Recruit';
import { getCastPreviews, placeCastPreview, subscribeCastPreviews, type CastPreviewEntry, type OccupiedSpan } from './castPreview';
import { castPreviewLook, castPreviewTimings, getCastPreviewConfig, subscribeCastPreviewConfig } from './castPreviewConfig';

/** Placements of the previews currently up — read by a newcomer's placement so it can dodge them. Module-level
 *  because the entries live in a module store too; cleared as each preview unmounts. */
const placed = new Map<number, OccupiedSpan>();

const CastPreviewCard = memo(function CastPreviewCard({ entry, view }: { entry: CastPreviewEntry; view: CardView }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The tuned look, LIVE: a knob change re-renders this card and re-runs the one measure below (per change,
  // never per frame), so a preview already on screen resizes / moves as the owner drags.
  const cfg = useSyncExternalStore(subscribeCastPreviewConfig, getCastPreviewConfig, getCastPreviewConfig);
  const look = castPreviewLook(entry.context, cfg);
  const ms = castPreviewTimings(entry.context, cfg);
  const [pos, setPos] = useState<{ left: number; top: number; chip: { top: number; right: number } } | null>(null);
  // Re-place when the entry is REPLACED (a same-source recast moved the anchor) — the id stays, the anchor changes.
  const { left: aLeft, top: aTop, width: aW, height: aH } = entry.anchor;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // THE ONE MEASURE, before paint. The card's layout box is the compact TILE (129 px square); the plated body
    // (`.cardplate`) is drawn around it and overhangs the tile on every side (58 px above, ~400 px below at the
    // hover zoom, measured 2026-09-23). Placing by the tile put the card OVER the rune badge instead of above it,
    // so the footprint is the union of the tile's box and the plate's — what the eye sees — and the position is
    // corrected by the plate's overhang. Still one synchronous layout pass per preview; never per frame.
    const outer = el.getBoundingClientRect();
    let left = outer.left, top = outer.top, right = outer.right, bottom = outer.bottom;
    for (const sel of ['.cardplate', '.card']) {
      const r = el.querySelector(sel)?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    const w = right - left, h = bottom - top;
    const dx = left - outer.left, dy = top - outer.top; // the visual box's offset from the positioned box
    const occupied = [...placed.entries()].filter(([id]) => id !== entry.id).map(([, span]) => span);
    const p = placeCastPreview({
      anchor: { left: aLeft, top: aTop, width: aW, height: aH }, w, h,
      viewportW: window.innerWidth, viewportH: window.innerHeight, occupied,
      side: look.side, offsetX: look.offsetX, offsetY: look.offsetY,
    });
    placed.set(entry.id, { left: p.left, right: p.left + w });
    // The count chip rides the VISUAL top-right corner (the plate's), not the tile's.
    setPos({ left: p.left - dx, top: p.top - dy, chip: { top: dy - 6, right: -(right - outer.right) - 6 } });
  }, [entry.id, aLeft, aTop, aW, aH, look.scale, look.side, look.offsetX, look.offsetY]);
  useLayoutEffect(() => () => { placed.delete(entry.id); }, [entry.id]);
  // The fade durations ride the one-shot entrance/exit animations; the max opacity is a STATIC opacity on the
  // inner wrapper (the animation fades the outer 0 → 1, so the composite peaks at `alpha`). `--cp-scale` folds
  // the tuned size into the inner `zoom` (a layout zoom, so the one measure sees the real footprint).
  const base: CSSProperties = {
    animationDuration: `${entry.leaving ? ms.fadeOut : ms.fadeIn}ms`,
    ['--cp-scale' as string]: String(look.scale),
  };
  const style: CSSProperties = pos
    ? { ...base, left: pos.left, top: pos.top }
    : { ...base, left: aLeft + aW / 2, top: aTop, visibility: 'hidden' }; // unmeasured: off-paint for one layout pass
  return (
    <div ref={ref} className={`castprev${entry.leaving ? ' leaving' : ''}`} style={style} data-spell-id={entry.spellId} data-source-key={entry.sourceKey} data-context={entry.context}>
      <div className="castprev-inner" style={{ opacity: look.alpha }}>
        <Card card={view} forceFull plated />
      </div>
      {entry.count > 1 && <span className="castprev-count" style={pos ? { top: pos.chip.top, right: pos.chip.right } : undefined}>×{entry.count}</span>}
    </div>
  );
});

/** The pure layer: entries in, cards out. `viewOf` builds a spell's live card view (null → that entry is skipped). */
export function CastPreviewLayerView({ entries, viewOf }: { entries: readonly CastPreviewEntry[]; viewOf: (spellId: string) => CardView | null }) {
  if (entries.length === 0) return null;
  return (
    <div className="castprev-layer" aria-hidden="true">
      {entries.map((e) => {
        const view = viewOf(e.spellId);
        return view ? <CastPreviewCard key={e.id} entry={e} view={view} /> : null;
      })}
    </div>
  );
}

export function CastPreviewLayer() {
  const entries = useSyncExternalStore(subscribeCastPreviews, getCastPreviews, getCastPreviews);
  const run = useGame((s) => s.run);
  // Views are memoised per (spell, run) — `Card` is memo'd on the view's VALUE, so a run change that leaves the
  // spell's live text alone re-renders nothing below this line.
  const cache = useMemo(() => new Map<string, CardView | null>(), [run]);
  const viewOf = (spellId: string): CardView | null => {
    if (!cache.has(spellId)) cache.set(spellId, conjuredView(spellId, run));
    return cache.get(spellId) ?? null;
  };
  return <CastPreviewLayerView entries={entries} viewOf={viewOf} />;
}
