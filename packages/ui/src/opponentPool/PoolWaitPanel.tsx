import { useSyncExternalStore } from 'react';
import type { PoolGate } from './poolGate';

/**
 * "Finding opponents..." (fix 2026-09-28). Drawn over the launch curtain while a lobby waits for the opponent
 * pool, and turned into an honest choice when the pool cannot be reached. Renders nothing while the gate is
 * idle, which is every launch where the pool had already loaded. The waiting text fades in after a short
 * delay (opacity only), so a wait of a few hundred ms never flashes a message.
 */
export function PoolWaitPanel({ gate }: { gate: PoolGate }) {
  const phase = useSyncExternalStore(gate.subscribe, gate.phase, gate.phase);
  if (phase === 'idle') return null;
  if (phase === 'waiting') {
    return (
      <div className="pool-wait" role="status" aria-live="polite">
        <div className="pool-wait-card pool-wait-delay">
          <div className="pool-wait-title">Finding opponents…</div>
          <div className="pool-wait-body">Loading other players' boards.</div>
          <div className="pool-wait-actions">
            <button type="button" className="btn" onClick={() => gate.cancel()}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="pool-wait" role="alertdialog" aria-labelledby="pool-wait-fail-title">
      <div className="pool-wait-card">
        <div className="pool-wait-title" id="pool-wait-fail-title">Couldn't reach other players' boards.</div>
        <div className="pool-wait-body">Check your connection and retry. If you play anyway, your opponents will be bots and the game won't be rated.</div>
        <div className="pool-wait-actions">
          <button type="button" className="btn go" onClick={() => gate.retry()}>Retry</button>
          <button type="button" className="btn" onClick={() => gate.playAnyway()}>Play anyway</button>
          <button type="button" className="btn" onClick={() => gate.cancel()}>Back to menu</button>
        </div>
      </div>
    </div>
  );
}
