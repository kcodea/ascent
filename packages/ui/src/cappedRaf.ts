/**
 * A FRAME LOOP CAPPED BELOW THE DISPLAY'S REFRESH (R-PERF-FUSE-BURN-01, perf pass 2026-11-18).
 *
 * `requestAnimationFrame` runs once per display frame: 240 or 360 times a second on the displays the game is played
 * on. A slow visual (the crystal fuse's debris, a breathing badge) looks the same stepped 60 times a second, and
 * costs a quarter or a sixth. The obvious cap ("ask for every frame, skip most of them") still costs: a pending rAF
 * makes the browser produce a MAIN frame on every display frame, and on each of those it also updates every running
 * CSS animation on the main thread (`docs/performance.md` 3o). So on a fast display this loop sleeps on a timer
 * through the frames it skips and only asks for the one it wants; on a display at or near the cap it is a plain rAF
 * loop, because a timer in front of every frame can only make it late.
 */

/** A display this much faster than the cap gets the timer path (144 Hz against a 60 Hz cap does; 75 Hz does not). */
const FAST_DISPLAY = 1.25;

/**
 * How long to sleep before asking for the next frame, in ms; 0 = ask now. Pure, exported for its test.
 * `sinceLastMs` = time since the last callback ran, `capMs` = the cap's interval, `frameMs` = the display's.
 * The sleep ends about one display frame BEFORE the target, so the rAF that follows lands on the first vsync at or
 * just short of it.
 */
export function cappedRafSleepMs(sinceLastMs: number, capMs: number, frameMs: number): number {
  if (!(frameMs > 0) || capMs < frameMs * FAST_DISPLAY) return 0;
  const sleep = capMs - sinceLastMs - frameMs;
  return sleep >= 1 ? sleep : 0;
}

/** Whether a frame that arrived `sinceLastMs` after the last run should run the callback. The slack is half a display
 *  frame (so vsync jitter never skips the frame the timer aimed at), and never more than a quarter of the cap: a
 *  display that is faster than `frameMs` claims (the refresh estimate has not landed yet, or the monitor is off) still
 *  runs the callback at about the cap, it just does not sleep between frames. Pure, exported for its test. */
export function cappedRafDue(sinceLastMs: number, capMs: number, frameMs: number): boolean {
  const slack = Math.min(frameMs > 0 ? frameMs * 0.5 : capMs, capMs * 0.25);
  return sinceLastMs >= capMs - slack;
}

/**
 * Run `cb(now)` at most `hz` times a second, on display frames, until the returned stop function is called.
 * `displayHz` is read on every frame (the estimate can firm up while the loop runs).
 */
export function cappedRaf(cb: (now: number) => void, hz: number, displayHz: () => number): () => void {
  const capMs = 1000 / Math.max(1, hz);
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  let stopped = false;
  const frameMs = (): number => { const d = displayHz(); return d > 0 ? 1000 / d : 0; };
  const ask = (): void => { timer = null; if (!stopped) raf = requestAnimationFrame(frame); };
  const schedule = (): void => {
    const sleep = cappedRafSleepMs(performance.now() - last, capMs, frameMs());
    if (sleep > 0) timer = setTimeout(ask, sleep);
    else raf = requestAnimationFrame(frame);
  };
  const frame = (now: number): void => {
    raf = 0;
    if (stopped) return;
    if (cappedRafDue(now - last, capMs, frameMs())) { last = now; cb(now); }
    if (!stopped) schedule();
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
  };
}
