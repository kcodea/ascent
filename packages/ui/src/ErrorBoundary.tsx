import { Component, type ErrorInfo, type ReactNode } from 'react';
import { crumb } from './crashLog';
import { useGame } from './store';
import { turnClock } from './turnClock';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  componentStack: string | null;
  /** A silent retry is under way: render nothing for a frame, then the game again. */
  retrying: boolean;
}

/** A crash this soon after a retry (silent or Continue) is the same crash again, not a passing one. */
export const RECRASH_MS = 10_000;

/**
 * What the boundary does with a caught crash (pure, tested). `retry`: remount the game at once without showing
 * anything. `show`: show the Paused screen. A first crash, or one long after the last retry, is retried silently; a
 * crash right after a retry is shown, since retrying again would loop.
 */
export function crashResponse(now: number, lastRetryAt: number | null): 'retry' | 'show' {
  return lastRetryAt !== null && now - lastRetryAt < RECRASH_MS ? 'show' : 'retry';
}

/** What Continue on the Paused screen does: remount, or (crashing again right after a remount) save and reload. */
export function continueAction(now: number, lastRetryAt: number | null): 'remount' | 'reload' {
  return lastRetryAt !== null && now - lastRetryAt < RECRASH_MS ? 'reload' : 'remount';
}

/**
 * Catches render-time crashes in the game tree. Without a boundary, a single thrown error during render makes React
 * unmount the whole tree: the app freezes on its last frame and the run is lost.
 *
 * R-PHONE-RESUME-01 (owner 2026-10-27 on his iPhone: "seems to be an issue with minimizing the game and coming back. it
 * shows an error. is there a way to fix this or clean it up so you just press continue without an error code there"):
 *  - A crash is first retried SILENTLY (one remount, nothing shown). Most crashes on coming back are passing ones (a
 *    request that failed while the phone woke up), and the remount is exactly what Continue from the title does.
 *  - Only a crash that comes straight back shows the screen, and it reads as a pause: one Continue button, no error
 *    text. Continue remounts; if the game crashed again right after a remount, it saves and reloads the page, which
 *    lands on the title's Continue with the run intact.
 *  - The error is still logged: the console, and a crash-log breadcrumb (crashLog.ts) for the phone diagnostics. The
 *    detail stays one tap away under "Details" for a bug report.
 */
/** When the boundary last remounted the game (one boundary in the app; module scope so the static
 *  `getDerivedStateFromError` can read it without side effects). */
let lastRetryAt: number | null = null;

/** A remount must not hand the Shop a full clock: the clock-reset effect opens a mounting turn at full time unless a
 *  resume is pending, so hand it the seconds showing now, exactly as Continue from the title does. */
function holdShopClock(): void {
  try {
    const st = useGame.getState();
    if (st.showTitle || st.run.phase !== 'recruit' || st.run.mode === 'versus') return;
    useGame.setState({ pendingResumeSeconds: turnClock.get() });
  } catch { /* no store: nothing to hold */ }
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null, retrying: false };
  private retryTimer = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Decided here (pure), so a silent retry renders nothing at all: the Paused screen never flashes.
    return { error, componentStack: null, retrying: crashResponse(Date.now(), lastRetryAt) === 'retry' };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Game crashed during render:', error, info.componentStack);
    try { crumb('render error', { m: String(error?.message ?? error).slice(0, 160) }); } catch { /* the log is best-effort */ }
    this.setState({ componentStack: info.componentStack ?? null });
    if (!this.state.retrying) return;
    lastRetryAt = Date.now();
    holdShopClock();
    // Next task: this commit unmounted the tree (render null), the next mounts it fresh.
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.setState({ error: null, componentStack: null, retrying: false }), 0);
  }

  override componentWillUnmount(): void {
    window.clearTimeout(this.retryTimer);
  }

  private onContinue = (): void => {
    const now = Date.now();
    if (continueAction(now, lastRetryAt) === 'reload') {
      try { useGame.getState().flushSave(); } catch { /* the autosave already holds the last turn */ }
      window.location.reload();
      return;
    }
    lastRetryAt = now;
    holdShopClock();
    this.setState({ error: null, componentStack: null, retrying: false });
  };

  override render(): ReactNode {
    const { error, componentStack, retrying } = this.state;
    if (!error) return this.props.children;
    if (retrying) return null;
    // The full detail (JS stack + React component stack) for a bug report: minified in a prod build, but the
    // component names + top frames still pinpoint where it broke.
    const detail = [error.stack ?? `${error.name}: ${error.message}`, componentStack ? `\nComponent stack:${componentStack}` : ''].join('');
    return (
      <div className="crashscreen" role="alert">
        <h1>Game paused</h1>
        <p>The game was interrupted. Press Continue to pick up where you left off.</p>
        <div className="crashbtns">
          <button onClick={this.onContinue}>Continue</button>
        </div>
        <details className="crashdetails">
          <summary>Details</summary>
          <pre className="crashstack">{`${error.message}\n\n${detail}`}</pre>
          <button
            className="crashcopy"
            onClick={() => { void navigator.clipboard?.writeText(`${error.message}\n\n${detail}`).catch(() => {}); }}
          >
            Copy details
          </button>
        </details>
      </div>
    );
  }
}
