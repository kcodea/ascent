import { useEffect, useRef, useState } from 'react';
import { COSMETIC_CATEGORY_DEFS, RARITY_LABELS, cosmeticOf, crateName, type OpenCrateResult } from '@game/progression';
import { sfx } from '../sfx';
import { openCrate } from './progressionStore';

/**
 * THE CRATE OPENER (2026-09-28): one sealed crate at a time, opened on the player's click, never forced.
 *
 * Used twice: under the post-game Account XP panel ("Crate earned", for the crates THIS game created) and in the
 * Collection (every sealed crate). The server picks the reward at open time; this only names the crate.
 *
 * Phases: `sealed` (the crate + an Open button) → `opening` (the crate shakes while the request is in flight, at
 * least MIN_SHAKE_MS so the reveal never pops in with no build up) → `revealed` (the lid lifts, the reward plate
 * scales in, coloured by rarity), or `exhausted` (nothing new left: the crate stays sealed, said plainly), or
 * `error` (Try again). After a reveal, "Open next" moves to the next crate in the queue.
 *
 * MOTION: transform / opacity only. The idle float and the shake loop on `transform`; the idle glow is the
 * OPACITY of a pseudo-element with a static shadow (the kwglow pattern). Reveal pieces are one-shot. Reduced
 * motion: no float, no shake, no delay; the reward simply fades in.
 */

export interface CrateQueueItem { crateId: string; earnedLevel: number }

type Phase = 'sealed' | 'opening' | 'revealed' | 'exhausted' | 'error';

const MIN_SHAKE_MS = 520;

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The reward's player-facing name; a newer server's item on an older client still reads sensibly. */
export function rewardLabel(rewardId: string | null): { name: string; kind: string; rarity: string | null; rarityLabel: string | null } {
  const def = cosmeticOf(rewardId);
  if (!def) return { name: 'New reward', kind: 'Update the game to see it', rarity: null, rarityLabel: null };
  const kind = def.category === 'title' ? 'New title' : `New ${COSMETIC_CATEGORY_DEFS[def.category].label.replace(/s$/, '').toLowerCase()}`;
  return { name: def.name, kind, rarity: def.rarity, rarityLabel: RARITY_LABELS[def.rarity] };
}

export interface CrateOpenerProps {
  /** Sealed crates to open, in order. Items opened here are skipped as the list updates. */
  queue: readonly CrateQueueItem[];
  /** Start opening the first crate at once (the caller's own Open button was the click). */
  autoOpen?: boolean;
  reducedMotion?: boolean;
  /** Test hook: the minimum shake (ms). */
  minShakeMs?: number;
  /** Called as an opening starts (before the request): the caller can freeze its queue. */
  onStart?: () => void;
  onOpened?: (r: OpenCrateResult) => void;
}

export function CrateOpener({ queue, autoOpen = false, reducedMotion, minShakeMs, onStart, onOpened }: CrateOpenerProps): JSX.Element | null {
  const reduced = reducedMotion ?? prefersReducedMotion();
  const [active, setActive] = useState<CrateQueueItem | null>(null);
  const [phase, setPhase] = useState<Phase>('sealed');
  const [result, setResult] = useState<OpenCrateResult | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const live = useRef(true);
  // Set on every mount (StrictMode mounts twice; a cleanup-only effect would leave it false for good).
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const pending = queue.filter((c) => !done.has(c.crateId) && c.crateId !== active?.crateId);
  const shown = active ?? pending[0] ?? null;

  const start = (item: CrateQueueItem): void => {
    onStart?.();
    setActive(item);
    setResult(null);
    setPhase('opening');
    const began = Date.now();
    const hold = reduced ? 0 : (minShakeMs ?? MIN_SHAKE_MS);
    void openCrate(item.crateId).then((out) => {
      const wait = Math.max(0, hold - (Date.now() - began));
      const land = (): void => {
        if (!live.current) return;
        if (out.status !== 'ok') { setPhase('error'); return; }
        setResult(out.result);
        if (out.result.status === 'pool_exhausted') { setPhase('exhausted'); return; }
        setDone((d) => new Set(d).add(item.crateId));
        setPhase('revealed');
        sfx.discover();
        onOpened?.(out.result);
      };
      if (wait > 0) window.setTimeout(land, wait); else land();
    });
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoStarted.current || !queue[0]) return;
    autoStarted.current = true;
    start(queue[0]);
  }, [autoOpen]); // once, on mount: `start` and `queue` are read at that moment on purpose

  if (!shown) return null;
  const reward = result && result.rewardId ? rewardLabel(result.rewardId) : null;
  const next = phase === 'revealed' ? pending[0] ?? null : null;
  const opened = phase === 'revealed' && !!reward;

  return (
    <div className={`crate${reduced ? ' reduced' : ''} phase-${phase}`} aria-live="polite">
      <div className="crate-stage">
        <div className={`crate-box${phase === 'opening' ? ' shaking' : ''}${opened ? ' open' : ''}${reward?.rarity ? ` r-${reward.rarity}` : ''}`} aria-hidden>
          <span className="crate-glow" />
          <span className="crate-lid" />
          <span className="crate-body"><span className="crate-lock" /></span>
          {opened && <span className="crate-burst" />}
        </div>
        {opened && reward && (
          <div className={`crate-reward${reward.rarity ? ` r-${reward.rarity}` : ''}`} role="status">
            <span className="crate-reward-kind">{reward.kind}</span>
            <span className="crate-reward-name">{reward.name}</span>
            {reward.rarityLabel && <span className="crate-reward-rarity">{reward.rarityLabel}</span>}
          </div>
        )}
      </div>
      <div className="crate-name">{crateName(shown.earnedLevel)}</div>
      {phase === 'sealed' && (
        <button type="button" className="crate-btn pressable" onClick={() => { sfx.pulse(); start(shown); }}>Open</button>
      )}
      {phase === 'opening' && <div className="crate-note" role="status">Opening</div>}
      {phase === 'exhausted' && (
        <div className="crate-note" role="status">You own every reward for now. This crate stays sealed until new rewards arrive.</div>
      )}
      {phase === 'error' && (
        <>
          <div className="crate-note" role="status">Could not open the crate. Try again.</div>
          <button type="button" className="crate-btn pressable" onClick={() => { sfx.pulse(); start(shown); }}>Try again</button>
        </>
      )}
      {next && (
        <button type="button" className="crate-btn pressable" onClick={() => { sfx.pulse(); start(next); }}>
          {pending.length > 1 ? `Open next (${pending.length} left)` : 'Open next'}
        </button>
      )}
    </div>
  );
}
