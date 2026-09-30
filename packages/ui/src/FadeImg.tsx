import type { ImgHTMLAttributes } from 'react';
import { useArtFade } from './artPreload';

/**
 * An art image that never shows undecoded: invisible until its URL is fetched + decoded, then a one-shot fade
 * (`.art-pending` / `.art-fadein` in styles.css). Already-decoded art renders exactly like a plain image tag. For the
 * portraits outside `Card` (hero select, the mode tiles, the lobby rail) and for the small chrome images ON a card
 * (tier plate and stars, keyword medallion, milestone discs, gilded badge, text backbox). `Card` wires `useArtFade`
 * itself for the art, frame and plate, because the art window also shows a placeholder while waiting. Art pop-in fix, 2026-09-29.
 */
export function FadeImg({ src, className, onLoad, onError, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string | undefined }): React.ReactElement {
  const fade = useArtFade(src);
  return (
    <img
      decoding="sync"
      {...rest}
      ref={fade.ref}
      className={`${className ?? ''}${fade.cls}`}
      src={src}
      onLoad={(e) => { fade.onLoad(e); onLoad?.(e); }}
      onError={(e) => { fade.onError(); onError?.(e); }}
    />
  );
}
