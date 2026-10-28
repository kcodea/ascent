/**
 * A CODE-SPLIT CHUNK THAT FAILED TO LOAD IS TRIED AGAIN (R-PHONE-RESUME-01, owner 2026-10-27 on his iPhone: "seems to be
 * an issue with minimizing the game and coming back. it shows an error").
 *
 * The first requests a page makes after iOS wakes it from the background often fail outright (`TypeError: Load
 * failed`) while the network comes back. A `React.lazy` import that fails once throws into the error boundary, and
 * React caches the rejected promise, so pressing Continue there threw the same error again. This retries the import a
 * few times, each try waiting until the page is visible, before it gives up.
 */

const visible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';

function whenVisible(): Promise<void> {
  if (visible()) return Promise.resolve();
  return new Promise((resolve) => {
    const on = (): void => { if (!visible()) return; document.removeEventListener('visibilitychange', on); resolve(); };
    document.addEventListener('visibilitychange', on);
  });
}

/** `load()`, tried up to `tries` times, `waitMs` (doubling) apart, each try once the page is visible. */
export async function retryImport<T>(load: () => Promise<T>, tries = 4, waitMs = 500): Promise<T> {
  let wait = waitMs;
  for (let attempt = 1; ; attempt++) {
    await whenVisible();
    try {
      return await load();
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}
