/**
 * THE PAINTED CHEST PICTURE (Chest Shop screen, 2026-10-20; spec docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md).
 * A tier's chest drawn in plain DOM, its two layers composed exactly as the opening theatre composes them
 * (`artChestModel` in crateFx/chestModel.ts): the lid's attach point sits on the spike line, on the rim, overlapping it
 * by `lidOverlap`; and for a lid with no notch (Epic, Ancient) the spike's apex is drawn AGAIN over the lid
 * (`spikeFront`), as the owner's assembled picture shows it.
 *
 * HOW IT IS PLACED: every number is a percent of the BODY's width, because CSS `padding-top` / `margin-top` percentages
 * resolve against the containing block's WIDTH. So the wrapper is as wide as the body; its `padding-top` is the lid's
 * overhang above the body; the body is an in-flow image under it; the lid is absolutely placed at the wrapper's top;
 * and the spike is an overflow-hidden box (its own `aspect-ratio`) showing the body image again at the body's scale.
 * The lid master was scaled by the same factor as the body, so the lid's width in body units is `lidSrcW` and nothing
 * here needs the images' real sizes: the picture lays out before they load and never reads layout.
 *
 * PHONES: the images load through `chestPictureUrl` (`publicArt`), so a lite-art phone draws the build's 512 px copy
 * (R-TOUCH-GPU-MEMORY-01); the opening theatre keeps loading the originals.
 *
 * Static paint: no animation here (the shop's one-shots move the whole picture by transform).
 */
import { memo } from 'react';
import type { ChestArt } from './crateFx/chestModel';
import { chestArtFor, chestPictureUrl } from './crateFx/chestArt';
import type { ChestTier } from './crateFx/chestTiers';
import './chestPicture.css';

export interface ChestSpikeLayout {
  /** The spike box's left edge and its top (a `margin-top`, so a percent of the body's width), and its width. */
  leftPct: number;
  topPct: number;
  widthPct: number;
  /** The box's width / height (its CSS `aspect-ratio`). */
  aspect: number;
  /** The body image inside the box: its width and left as a percent of the box's width, its top of the box's height. */
  imgWidthPct: number;
  imgLeftPct: number;
  imgTopPct: number;
}

export interface ChestLayout {
  /** The lid's overhang above the body (the wrapper's `padding-top`). */
  padTopPct: number;
  /** The lid's left edge and its width. */
  lidLeftPct: number;
  lidWidthPct: number;
  /** Epic and Ancient: the spike front drawn over the lid. Null when the lid's notch already shows the spike. */
  spike: null | ChestSpikeLayout;
}

/** A chest's composition, every number a percent of the body's width (see the header). */
export function chestLayout(art: ChestArt): ChestLayout {
  const W = art.bodySrcW;
  const pct = (v: number): number => (v / W) * 100;
  const padTopPct = pct(art.lidAttachY - art.rimY - art.lidOverlap);
  const f = art.spikeFront;
  let spike: ChestSpikeLayout | null = null;
  if (f) {
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    spike = {
      leftPct: pct(f.x0),
      topPct: padTopPct + pct(f.y0),
      widthPct: pct(w),
      aspect: w / h,
      imgWidthPct: (W / w) * 100,
      imgLeftPct: (-f.x0 / w) * 100,
      imgTopPct: (-f.y0 / h) * 100,
    };
  }
  return { padTopPct, lidLeftPct: pct(art.spikeX - art.lidAttachX), lidWidthPct: pct(art.lidSrcW), spike };
}

const LAYOUTS = new Map<ChestTier, ChestLayout>();
const layoutOf = (tier: ChestTier): ChestLayout => {
  let l = LAYOUTS.get(tier);
  if (!l) { l = chestLayout(chestArtFor(tier)); LAYOUTS.set(tier, l); }
  return l;
};

/** One tier's painted chest, sized by its container's width (decorative: hidden from readers by its caller's label). */
export const ChestPicture = memo(function ChestPicture({ tier, className }: { tier: ChestTier; className?: string }): JSX.Element {
  const art = chestArtFor(tier);
  const l = layoutOf(tier);
  const body = chestPictureUrl(art.bodyUrl);
  return (
    <span className={className ? `chestpic ${className}` : 'chestpic'} style={{ paddingTop: `${l.padTopPct}%` }} aria-hidden="true">
      <img className="chestpic-body" src={body} alt="" draggable={false} decoding="sync" />
      <img
        className="chestpic-lid" src={chestPictureUrl(art.lidUrl)} alt="" draggable={false} decoding="sync"
        style={{ left: `${l.lidLeftPct}%`, width: `${l.lidWidthPct}%` }}
      />
      {l.spike && (
        <span
          className="chestpic-spike"
          style={{ left: `${l.spike.leftPct}%`, marginTop: `${l.spike.topPct}%`, width: `${l.spike.widthPct}%`, aspectRatio: String(l.spike.aspect) }}
        >
          <img
            src={body} alt="" draggable={false} decoding="sync"
            style={{ left: `${l.spike.imgLeftPct}%`, top: `${l.spike.imgTopPct}%`, width: `${l.spike.imgWidthPct}%` }}
          />
        </span>
      )}
    </span>
  );
});
