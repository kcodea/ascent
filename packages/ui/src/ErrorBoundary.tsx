import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches render-time crashes in the game tree. Without a boundary, a single thrown error during
 * render (e.g. an out-of-range array read) makes React unmount the whole tree — the app silently
 * freezes on its last frame and the player can't do anything (a "hard lock" that loses the run).
 * This shows a recoverable fallback instead: "Try to continue" clears the error so a *transient*
 * crash can re-render cleanly, and "Reload" is the hard reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface it for debugging; the fallback owns the user-facing recovery.
    console.error('Game crashed during render:', error, info.componentStack);
    // Stash the component stack so the crash screen can show WHERE it broke — self-diagnosing without devtools.
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    // The full detail — JS stack (file:line) + the React component stack — for reporting a crash. Minified in a
    // prod build, but the component names + top frames still pinpoint where it broke.
    const detail = [error.stack ?? `${error.name}: ${error.message}`, componentStack ? `\nComponent stack:${componentStack}` : ''].join('');
    return (
      <div className="crashscreen" role="alert">
        <h1>The game hit a snag</h1>
        <p>
          An unexpected error stopped the screen from updating. Try to continue where you left off —
          if it sticks, reload to start fresh.
        </p>
        <pre>{error.message}</pre>
        <details className="crashdetails">
          <summary>Show details (for a bug report)</summary>
          <pre className="crashstack">{detail}</pre>
          <button
            className="crashcopy"
            onClick={() => { void navigator.clipboard?.writeText(`${error.message}\n\n${detail}`).catch(() => {}); }}
          >
            Copy details
          </button>
        </details>
        <div className="crashbtns">
          <button onClick={() => this.setState({ error: null })}>Try to continue</button>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
