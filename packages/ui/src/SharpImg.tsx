import type { ImgHTMLAttributes } from 'react';
import { FadeImg } from './FadeImg';
import { useSharpArt } from './fullResArt';

/**
 * A hero portrait in a BIG slot (R-PHONE-HERO-SHARP-01, owner 2026-10-31: "Hero art in mobile is blurry"): on a phone it
 * shows the 512 px master once decoded and the 384 px phone copy until then (`useSharpArt`). `fade` renders through
 * `FadeImg` (the art-pending fade) for the slots that already used it. Desktop: exactly the plain / Fade image.
 */
export function SharpImg({ src, fade, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string | undefined; fade?: boolean }): React.ReactElement {
  const shown = useSharpArt(src);
  return fade ? <FadeImg {...rest} src={shown} /> : <img decoding="sync" {...rest} src={shown} />;
}
