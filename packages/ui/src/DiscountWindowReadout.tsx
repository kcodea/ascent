import type { RunState } from '@game/sim';
import { useTurnSeconds } from './turnClock';

/**
 * The live readout for a clock-window card discount (Thymepiece: "all cards cost −1 Gold for the next 8
 * seconds"). Renders under the Equipment slot while a window is open — "−1 Gold · 6s" — and nothing at all
 * otherwise.
 *
 * Its OWN component on purpose: it subscribes to the per-second turn clock (`useTurnSeconds`), and that
 * subscription must stay in a leaf this small — the StatusBar and the recruit tree never re-render on a tick
 * (see turnClock.ts). The seconds left are DERIVED from the clock (`turnClock − untilClock`), never a second
 * timer, so the readout pauses with the clock exactly as the window does and can never drift from the
 * reducer's expiry. `untilClock: null` is a window with no clock reading (a legacy recording) — it runs to
 * the end of the turn and prints that instead of a count.
 */
export function DiscountWindowReadout({ window }: { window: NonNullable<RunState['cardDiscountWindow']> }): JSX.Element {
  const seconds = useTurnSeconds();
  const left = window.untilClock === null ? null : Math.max(0, seconds - window.untilClock);
  return (
    <div className="hplabel discountwin" aria-live="polite">
      −{window.amount} Gold · {left === null ? 'this turn' : `${left}s`}
    </div>
  );
}
