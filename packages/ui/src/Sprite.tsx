import { useEffect, useRef } from 'react';
import { drawSprite, type SpriteName } from './sprites';

/** Renders a pixel-art sprite to a crisp, integer-scaled canvas. */
export function Sprite({ name, scale = 4 }: { name: SpriteName; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSprite(ref.current, name, scale);
  }, [name, scale]);
  const px = 16 * scale;
  return (
    <canvas
      ref={ref}
      width={px}
      height={px}
      className="spr"
      style={{ width: px, height: px, imageRendering: 'pixelated' }}
    />
  );
}
