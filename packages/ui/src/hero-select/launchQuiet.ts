/** The board has been built, drawn and drawn again: three frames in a row that came when they should. A launch that leaves sooner
 *  has the last of that work swallow the first part of its animation. `most` ms at the most. */
export async function quietFrames(most = 900): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return;
  const t0 = performance.now();
  let last = t0;
  for (let calm = 0; calm < 3;) {
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    const now = performance.now();
    calm = now - last < 22 ? calm + 1 : 0;
    last = now;
    if (now - t0 > most) return;
  }
}
