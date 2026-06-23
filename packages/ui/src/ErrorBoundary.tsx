import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes in the game tree. Without a boundary, a single thrown error during
 * render (e.g. an out-of-range array read) makes React unmount the whole tree — the app silently
 * freezes on its last frame and the player can't do anything (a "hard lock" that loses the run).
 * This shows a recoverable fallback instead: "Try to continue" clears the error so a *transient*
 * crash can re-render cleanly, and "Reload" is the hard reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface it for debugging; the fallback owns the user-facing recovery.
    console.error('Game crashed during render:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crashscreen" role="alert">
        <h1>The game hit a snag</h1>
        <p>
          An unexpected error stopped the screen from updating. Try to continue where you left off —
          if it sticks, reload to start fresh.
        </p>
        <pre>{error.message}</pre>
        <div className="crashbtns">
          <button onClick={() => this.setState({ error: null })}>Try to continue</button>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
