import type { CSSProperties } from 'react';
import { Icon } from '../Icon';
import { PortraitFrame, pfClass, usePortraitFrame } from './PortraitFrame';
import type { PortraitSide } from './portraitFrameConfig';

/**
 * THE HERO PORTRAIT RING, re-seated outside the run: the same `.hero > .f > img.heroimg` markup StatusBar renders
 * for your in-run portrait (so the disc, the cover crop and the ring are the SAME rules), under a `.cv2-heroframe`
 * host that undoes the tray's transforms and seats the disc in the gold ring (`--ring` sets its size), plus the
 * portrait-frame tuner's ring for `side` when one is on.
 *
 * Shared by the Career pages and the Collection's hero-skin preview (owner 2026-09-30: "for heroes the preview
 * image is off"), so a skin previews exactly as the player will see it in a game.
 */
export function HeroPortraitRing({ art, alt, side = 'self', frameId, small, className, style }: {
  /** The portrait's art url; none draws the anvil placeholder, like the in-run portrait. */
  art: string | undefined;
  alt: string;
  side?: PortraitSide;
  /** The portrait frame to wear (see `usePortraitFrame`): undefined = the side's default (yours for `self`), a frame
   *  cosmetic id = that ring (a recorded run, a Collection preview), null = no cosmetic frame. */
  frameId?: string | null;
  small?: boolean;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  const frame = usePortraitFrame(side, frameId);
  return (
    <div
      className={`cv2-heroframe${small ? ' small' : ''}${className ? ` ${className}` : ''}${pfClass(frame)}`}
      style={frame?.hostStyle || style ? { ...style, ...frame?.hostStyle } : undefined}
    >
      <div className="hero">
        <div className="f">
          {art ? <img decoding="sync" className="heroimg" src={art} alt={alt} draggable={false} /> : <Icon name="anvil" />}
        </div>
        <PortraitFrame frame={frame} />
      </div>
    </div>
  );
}
