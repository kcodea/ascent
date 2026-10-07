import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { RUNE_INDEX } from '@game/content';
import { Icon } from '../Icon';
import { RuneCard, runeAccentTribe } from '../RuneCard';
import { prefersReducedMotion, runEntrance, type EntranceHandle } from './entrance';
import './runeforgeEntrance.css';
import './runeforgeLook.css';

/**
 * THE RUNEFORGE DIALOG — the forge overlay's panel (banner, Gold, rune tablets, re-roll), plus its ENTRANCE
 * (owner ask 2026-09-24: the tablets arrive with weight, dust settles, the forge ignites).
 *
 * Lifted out of `Recruit.tsx`'s `RuneforgeOverlay` so the live forge and the tuner's sandbox preview render the
 * SAME markup: a preview that drifted from the real row would be tuning something the player never sees.
 *
 * ── When the entrance plays ───────────────────────────────────────────────────────────────────────────────────
 *  · The forge OPENS (a new `occasion` + offer): the full sequence.
 *  · A RE-ROLL (the offer changes while open): only the new tablets drop (no backdrop fade, shade or embers).
 *  · Returning from "Inspect the board" (the overlay remounts with an offer it has already shown): nothing, the
 *    overlay just fades back as it always did. Remembered per `occasion` + offer, below.
 *  · It only ever mounts once the return-to-shop wipe is idle (`Recruit`'s `overlaysHeld`), and then waits the
 *    tuner's post-wipe pad (`openDelayMs`) before anything shows or sounds.
 * It plays wherever the forge itself shows: live play, the tutorial's forge beat, the Scene Builder and replays
 * (at the replay's speed). Under prefers-reduced-motion it is one plain fade.
 */

/**
 * Forge openings the entrance has already STARTED, so nothing replays it (bounded).
 *
 *  · `done`: it played out (or was skipped). A later mount of the same opening (back from Inspect) shows the forge
 *    settled.
 *  · torn down mid-play: stamped with when. A remount within a few ms is React StrictMode's dev re-run (mount,
 *    clean up, mount in one task), which must replay the whole opening. Any later remount (Inspect pressed during
 *    it, a parent re-keying) settles instead of starting the sequence (and its sounds) over.
 */
const REMOUNT_REPLAY_MS = 50;
const openings = new Map<string, { done: boolean; tornAt: number }>();
function remember(key: string, entry: { done: boolean; tornAt: number }): void {
  openings.delete(key);
  openings.set(key, entry);
  if (openings.size > 16) openings.delete(openings.keys().next().value as string);
}
/** Should a mount of this opening play the entrance? */
function shouldPlay(key: string | null): boolean {
  if (key === null) return true;
  const e = openings.get(key);
  if (!e) return true;
  if (e.done) return false;
  return Date.now() - e.tornAt < REMOUNT_REPLAY_MS;
}
/** Test-only. */
export function resetRuneforgeEntranceMemoForTests(): void {
  openings.clear();
}

/**
 * THE EMBERS (owner 2026-10-07: "the rising dots are okay but they are tiny and too few"): 60 warm sparks of mixed
 * size rising through the forge, a few of them big soft bokeh glows. A FIXED table (a tiny LCG, so the scene is the
 * same every opening) of CSS transform + opacity rises (runeforgeLook.css), compositor-only. `x` lane %, `t` rise
 * seconds, `d` delay (negative: already mid-flight on open), `dx` sideways drift px, `sz` px, `o` peak opacity,
 * `b` bokeh (a big, soft, dim one).
 */
const EMBERS: readonly { x: number; t: number; d: number; dx: number; sz: number; o: number; b: boolean }[] = (() => {
  let seed = 7;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: 60 }, (_, i) => {
    const b = i % 7 === 3;
    return {
      x: Math.round(r() * 1000) / 10,
      t: Math.round((b ? 16 : 9) + r() * 9),
      d: -Math.round(r() * 18 * 10) / 10,
      dx: Math.round((r() - 0.5) * 90),
      sz: b ? Math.round(18 + r() * 16) : Math.round(5 + r() * r() * 12),
      o: b ? 0.28 : Math.round((0.55 + r() * 0.45) * 100) / 100,
      b,
    };
  });
})();

export interface RuneforgeDialogProps {
  offer: readonly string[];
  epic: boolean;
  /** The player's Gold right now. */
  embers: number;
  /** The pivot discounts, aligned with `offer`. */
  discounts?: readonly (number | undefined)[] | undefined;
  /** The free re-roll is spent (this forge or the other). */
  rerollSpent: boolean;
  /** Rune of Duplication is held and this is the Epic forge (see RuneCard's `duplicating`). */
  duplicating: boolean;
  onBuy: (index: number, el: HTMLElement | null) => void;
  onReroll: () => void;
  /**
   * Which forge OPENING this is (run + wave), so the entrance plays once per opening. Omit (the preview) to play
   * on every mount.
   */
  occasion?: string;
  /** Replay speed: the entrance compresses by it. */
  speed?: number;
  /** Extra class on the overlay (the sandbox preview's stacking). */
  className?: string;
}

export function RuneforgeDialog({ offer, epic, embers, discounts, rerollSpent, duplicating, onBuy, onReroll, occasion, speed, className }: RuneforgeDialogProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EntranceHandle | null>(null);
  const shownRef = useRef<string | null>(null);
  const offerSig = offer.join('|');

  // Layout effect: every animation is scheduled before the first paint of the new tablets.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // A re-roll is the offer CHANGING under a mounted overlay. The same offer again is StrictMode's dev re-run
    // of this effect (mount, clean up, mount), which must replay the whole opening, not the re-roll variant.
    const first = shownRef.current === null || shownRef.current === offerSig;
    shownRef.current = offerSig;
    const key = occasion !== undefined ? `${occasion}|${epic ? 'E' : 'B'}|${offerSig}` : null;
    if (!shouldPlay(key)) return; // already arrived (back from Inspect, or a remount mid-play)
    const h = runEntrance(root, {
      epic, withBackdrop: first, speed, reduced: prefersReducedMotion(),
      onDone: () => { if (key !== null) remember(key, { done: true, tornAt: 0 }); },
    });
    if (key !== null) remember(key, { done: false, tornAt: Number.POSITIVE_INFINITY });
    handleRef.current = h;
    return () => {
      const unfinished = h.isRunning();
      h.cancel();
      // `cancel` settles, which fires onDone (done). A teardown MID-play overrides that with its timestamp, so only an
      // immediate StrictMode re-run replays it; anything later shows the settled forge.
      if (unfinished && key !== null) remember(key, { done: false, tornAt: Date.now() });
      if (handleRef.current === h) handleRef.current = null;
    };
    // `epic`/`occasion`/`speed` are fixed for one opening; the OFFER is what re-runs it (a re-roll).
  }, [offerSig]);

  return (
    <div
      ref={rootRef}
      className={`discover-ov forge-ov rfe${epic ? ' forge-epic rfe-epic' : ''}${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={epic ? 'The Epic Runeforge' : 'The Runeforge'}
      // ANY press while the entrance plays settles it. A press on a tablet still in the air lands here (falling
      // tablets are pointer-events: none), so it skips without buying; a landed tablet also takes its click.
      onPointerDownCapture={() => { if (handleRef.current?.isRunning()) handleRef.current.skip(); }}
    >
      {/* The stage: the rising embers over the forge's illustrated backdrop (runeforgeLook.css). Inert. */}
      <div className="rf-stage" aria-hidden="true">
        <div className="rf-motes">
          {EMBERS.map((m, i) => (
            <span key={i} className={`rf-mote${m.b ? ' rf-bokeh' : ''}`} style={{ '--x': `${m.x}%`, '--t': `${m.t}s`, '--d': `${m.d}s`, '--dx': `${m.dx}px`, '--sz': `${m.sz}px`, '--o': m.o } as CSSProperties} />
          ))}
        </div>
      </div>
      <div className="rfe-shade" aria-hidden="true" />
      <div className="disc-panel forge-panel">
        {/* The title: a Gem plate, with one short line beneath the name. */}
        <div className="disc-banner forge-banner">
          <span className="disp">{epic ? 'Epic Runeforge' : 'Runeforge'}</span>
          <span className="rf-subtitle">Choose one rune to keep</span>
        </div>
        {/* The player's CURRENT Gold: the runes charge Gold, so the panel must say what's in the purse (owner ask
            2026-07-16). Re-renders with every buy/re-roll. */}
        <div className="forge-gold" aria-description="Your Gold right now"><Icon name="mana" /><b>{embers}</b></div>
        <div className="disc-cards forge-cards">
          {offer.map((id, i) => {
            const rune = RUNE_INDEX[id];
            if (!rune) return null;
            // The pivot discount (aligned array, seeded at draw): a rune that doesn't follow the board can
            // arrive cheaper — the buy path charges the same number.
            const liveCost = Math.max(0, rune.cost - (discounts?.[i] ?? 0));
            return (
              // `--rfe-z`: each tablet stacks above the one to its left, so a cost coin is never under a neighbour.
              <div className="rfe-slot" key={id} data-rfe-index={i} style={{ '--rfe-z': i + 1 } as CSSProperties}>
                <RuneCard
                  rune={rune} cost={liveCost} affordable={embers >= liveCost} pickSfx
                  duplicating={duplicating}
                  onBuy={(el) => onBuy(i, el)}
                />
                {/* The ignite glow + light sweep, played once as the tablet settles. Inert otherwise. */}
                <span className="rfe-fx" aria-hidden="true">
                  <span className="rfe-ignite" />
                  <span className="rfe-sweep"><span className="rfe-sweep-band" /></span>
                </span>
              </div>
            );
          })}
        </div>
        {/* The re-roll STAYS MOUNTED once spent (hidden, disabled, out of the tab order) rather than
            unmounting. The overlay centres the panel vertically, so a footer that collapsed to zero height
            re-centred the whole panel and the rune tablets visibly dropped by half the button's height on
            the click (owner report 2026-09-22: "the runes move down when the player uses the free
            re-roll"). Reserving the space keeps the row pinned; nothing else about the button changes. */}
        <div className="forge-actions">
          <button
            className={`forge-reroll gtip${rerollSpent ? ' forge-reroll-spent' : ''}`}
            onClick={onReroll}
            disabled={rerollSpent}
            aria-hidden={rerollSpent || undefined}
            tabIndex={rerollSpent ? -1 : undefined}
            aria-description={rerollSpent ? undefined : "Re-roll the offered Runes for free, once per game. Spending it here forfeits the other forge's re-roll."}
            data-tip={rerollSpent ? undefined : "Re-roll the offered Runes for free, once per game. Spending it here forfeits the other forge's re-roll."}
          >
            <Icon name="refresh" /><span className="rf-rr"><span>Re-roll</span><b className="forge-reroll-cost">Free</b></span>
          </button>
        </div>
      </div>
    </div>
  );
}
