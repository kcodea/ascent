/**
 * THE SIM WORKER (perf pass 2026-11-18, R-PERF-SIM-WORKER-01): every background combat simulation runs here, off
 * the main thread. All the logic is in `handler.ts`; this file only binds it to the worker message port.
 */
import { loadStrengthReference } from '@game/sim';
import { createSimWorkerHandler } from './handler';
import type { SimWorkerReply, SimWorkerRequest } from './protocol';

interface WorkerScope {
  postMessage(msg: SimWorkerReply): void;
  onmessage: ((e: MessageEvent<SimWorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;

// A MessageChannel, not `setTimeout(0)`: nested zero timers are clamped to 4 ms, which would idle the worker for a
// third of every chunk. Messages from the page still get in between two chunks.
const channel = new MessageChannel();
let deferred: (() => void) | null = null;
channel.port1.onmessage = () => { const fn = deferred; deferred = null; fn?.(); };

const handler = createSimWorkerHandler({
  post: (reply) => scope.postMessage(reply),
  defer: (fn) => { deferred = fn; channel.port2.postMessage(0); },
  now: () => performance.now(),
  loadReference: loadStrengthReference,
});
scope.onmessage = (e) => handler.onMessage(e.data);
