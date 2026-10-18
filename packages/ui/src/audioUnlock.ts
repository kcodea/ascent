/**
 * iOS AUDIO UNLOCK (owner 2026-10-18 mobile audit, R-TOUCH-AUDIO-01).
 *
 * Web Audio starts SUSPENDED until a user gesture resumes it, and iOS Safari is strict about WHICH gesture: a
 * `pointerdown` does not count there, only a `touchend` / `click` (or a key). The game used to warm the context on
 * the first pointerdown / keydown and then drop its listeners, so on an iPhone the context could stay suspended (no
 * sound at all) and, once iOS had INTERRUPTED it (a call, Siri, the app sent to the background, the silent switch),
 * nothing ever resumed it again.
 *
 * Now: every gesture (pointerdown, touchend, click, keydown) creates the context if needed and resumes it whenever it
 * is not running. Those listeners stay installed for the life of the page: an interruption can happen at any time, and
 * the check is one property read per gesture. Coming back to the page (`visibilitychange` to visible, `pageshow` from
 * the back-forward cache) and the context's own `statechange` to `interrupted` / `suspended` try a resume too, without
 * creating a context nobody asked for. A refused resume (no gesture yet) simply waits for the next touch.
 */

/** The gestures that may unlock audio. `touchend` + `click` are the ones iOS accepts. */
export const UNLOCK_GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'] as const;

/** Minimal context surface (tests pass a fake). `interrupted` is iOS Safari's state after a call / backgrounding. */
export interface UnlockableContext {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener?(type: 'statechange', cb: () => void): void;
}

/** Pure: does a context in this state need a resume? */
export function needsResume(state: string | undefined): boolean {
  return state === 'suspended' || state === 'interrupted';
}

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Install the unlock. `getCtx(true)` creates the context on a gesture; `getCtx(false)` only returns an existing one.
 * Returns an uninstall (tests).
 */
export function installAudioUnlock(win: Target, doc: Target & { visibilityState?: string }, getCtx: (create: boolean) => UnlockableContext | null): () => void {
  const watched = new WeakSet<object>();
  const tryResume = (ctx: UnlockableContext | null): void => {
    if (!ctx) return;
    if (!watched.has(ctx) && ctx.addEventListener) {
      watched.add(ctx);
      // An interruption (or a suspend we did not ask for): try straight away; a refusal waits for the next gesture.
      ctx.addEventListener('statechange', () => { if (needsResume(ctx.state)) tryResume(ctx); });
    }
    if (needsResume(ctx.state)) {
      try { void ctx.resume().catch(() => { /* refused without a gesture: the next one retries */ }); } catch { /* same */ }
    }
  };
  const onGesture = (): void => tryResume(getCtx(true));
  const onReturn = (): void => { if (doc.visibilityState === undefined || doc.visibilityState === 'visible') tryResume(getCtx(false)); };
  const opts = { capture: true, passive: true } as const;
  for (const g of UNLOCK_GESTURES) win.addEventListener(g, onGesture, opts);
  win.addEventListener('pageshow', onReturn);
  win.addEventListener('focus', onReturn);
  doc.addEventListener('visibilitychange', onReturn);
  return () => {
    for (const g of UNLOCK_GESTURES) win.removeEventListener(g, onGesture, opts);
    win.removeEventListener('pageshow', onReturn);
    win.removeEventListener('focus', onReturn);
    doc.removeEventListener('visibilitychange', onReturn);
  };
}
