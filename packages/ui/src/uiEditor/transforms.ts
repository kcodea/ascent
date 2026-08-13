/** Round to at most 2 decimals and drop a trailing ".0". */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function composeTransform(t: { x: number; y: number }, scale: number): string {
  const parts: string[] = [];
  if (t.x !== 0 || t.y !== 0) parts.push(`translate(${n(t.x)}px, ${n(t.y)}px)`);
  if (scale !== 1) parts.push(`scale(${n(scale)})`);
  return parts.join(' ');
}

export function resizeToPx(
  base: { w: number; h: number },
  dW: number,
  dH: number,
  keepAspect: boolean,
): { width: string; height: string } {
  let w = base.w + dW;
  let h = keepAspect ? base.h * (w / base.w) : base.h + dH;
  w = Math.max(1, w);
  h = Math.max(1, h);
  return { width: `${n(w)}px`, height: `${n(h)}px` };
}
