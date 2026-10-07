import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { RUNE_INDEX } from '@game/content';
import { Icon } from '../Icon';
import { RuneCard } from '../RuneCard';
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
 * THE AMBIENT MOTES (owner ask 2026-10-07: "some moving dust/etc in there to make it feel a bit more alive"): a FIXED
 * table, so the scene is identical every opening, and modest (18). Each is a CSS transform + opacity rise
 * (runeforgeLook.css), compositor-only. `x` lane %, `t` rise seconds, `d` delay (negative: already mid-flight on
 * open), `dx` sideways drift px, `sz` px, `o` peak opacity.
 */
const MOTES: readonly { x: number; t: number; d: number; dx: number; sz: number; o: number }[] = [
  { x: 6, t: 15, d: -2, dx: 30, sz: 4, o: 0.7 }, { x: 13, t: 19, d: -11, dx: -24, sz: 3, o: 0.55 },
  { x: 19, t: 13, d: -6, dx: 18, sz: 5, o: 0.8 }, { x: 26, t: 21, d: -15, dx: -36, sz: 3, o: 0.5 },
  { x: 32, t: 16, d: -9, dx: 26, sz: 4, o: 0.65 }, { x: 38, t: 23, d: -3, dx: -14, sz: 2, o: 0.5 },
  { x: 44, t: 14, d: -12, dx: 34, sz: 4, o: 0.75 }, { x: 50, t: 18, d: -7, dx: -28, sz: 3, o: 0.6 },
  { x: 56, t: 20, d: -16, dx: 20, sz: 5, o: 0.7 }, { x: 61, t: 15, d: -4, dx: -32, sz: 3, o: 0.55 },
  { x: 67, t: 22, d: -10, dx: 16, sz: 4, o: 0.65 }, { x: 73, t: 13, d: -1, dx: -20, sz: 3, o: 0.7 },
  { x: 79, t: 19, d: -13, dx: 30, sz: 4, o: 0.6 }, { x: 85, t: 16, d: -8, dx: -26, sz: 5, o: 0.75 },
  { x: 91, t: 21, d: -5, dx: 22, sz: 3, o: 0.5 }, { x: 96, t: 17, d: -14, dx: -18, sz: 4, o: 0.6 },
  { x: 35, t: 25, d: -19, dx: 40, sz: 2, o: 0.45 }, { x: 64, t: 24, d: -21, dx: -40, sz: 2, o: 0.45 },
];

/** THE STREAKS OF MAGIC (owner 2026-10-07: "streaks of magic to create a feeling of awe/magic in the air"): a fixed
 *  table of four soft arcs that now and then sweep across the forge and fade (runeforgeLook.css). `sx`/`sy` start %,
 *  `st` cycle seconds (visible ~20% of it), `sd` delay, `sr` tilt. */
const STREAKS: readonly { sx: number; sy: number; st: number; sd: number; sr: number }[] = [
  { sx: 6, sy: 18, st: 13, sd: -1, sr: -8 }, { sx: 52, sy: 10, st: 17, sd: -7, sr: 6 },
  { sx: 14, sy: 62, st: 15, sd: -11, sr: 10 }, { sx: 48, sy: 70, st: 19, sd: -4, sr: -5 },
];
function Streak({ i }: { i: number }): JSX.Element {
  const id = `rfsg-${i}`;
  return (
    <svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: 'rgb(var(--rf-streak))', stopOpacity: 0 }} />
          <stop offset="0.55" style={{ stopColor: 'rgb(var(--rf-streak))', stopOpacity: 0.9 }} />
          <stop offset="0.8" style={{ stopColor: '#fff', stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--rf-streak))', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d="M0 80 Q 200 -10 400 40" fill="none" stroke={`url(#${id})`} strokeWidth="9" strokeLinecap="round" opacity="0.18" />
      <path d="M0 80 Q 200 -10 400 40" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

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
      {/* The stage: the forge glow, the streaks of magic and the rising embers (runeforgeLook.css). Inert. */}
      <div className="rf-stage" aria-hidden="true">
        <div className="rf-glow" />
        {STREAKS.map((st, i) => (
          <div key={`s${i}`} className="rf-streak" style={{ '--sx': `${st.sx}%`, '--sy': `${st.sy}%`, '--st': `${st.st}s`, '--sd': `${st.sd}s`, '--sr': `${st.sr}deg` } as CSSProperties}><Streak i={i} /></div>
        ))}
        <div className="rf-motes">
          {MOTES.map((m, i) => (
            <span key={i} className="rf-mote" style={{ '--x': `${m.x}%`, '--t': `${m.t}s`, '--d': `${m.d}s`, '--dx': `${m.dx}px`, '--sz': `${m.sz}px`, '--o': m.o } as CSSProperties} />
          ))}
        </div>
      </div>
      <div className="rfe-shade" aria-hidden="true" />
      <div className="disc-panel forge-panel">
        {/* Title only — the anvil icon was removed from the forge banner (owner ask 2026-08-30). */}
        <div className="disc-banner forge-banner"><span className="disp">{epic ? 'Epic Runeforge' : 'Runeforge'}</span></div>
        {/* The player's CURRENT Gold — the runes charge Gold, so the panel must say what's in the purse
            (owner ask 2026-07-16). Re-renders with every buy/re-roll. */}
        <div className="forge-sub">Choose a Rune. It stays with you for the rest of the game.</div>
        <div className="forge-gold" aria-description="Your Gold right now"><Icon name="mana" /><b>{embers}</b> Gold</div>
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
            <Icon name="refresh" /> Re-roll · <b className="forge-reroll-cost">Free</b>
          </button>
        </div>
      </div>
    </div>
  );
}
