/**
 * "Saving this will bake the seed in" — the warning that sits above every control which writes a def.
 *
 * ── Why this is a shared component and not two copies of some JSX ──
 * `save()` and `commit()` both write `seedLocked ? seed : undefined`, which is correct and deliberate: an
 * unlocked composition means "roll fresh", so writing a seed anyway would freeze a look the author left free.
 * The hazard is the other direction — forgetting the lock is on. A baked seed makes every play of that effect
 * in the real game the identical roll, forever: occasionally wanted (an exactly-choreographed signature hit),
 * usually not, because repeated procs start reading as mechanical. The lock is in the session snapshot, so it
 * survives reloads and is easy to forget.
 *
 * The fix is NOT auto-unlocking on save — that would silently change what gets written and destroy the
 * legitimate baked-seed case outright. The fix is making the hazard visible at the moment of decision, which
 * means beside **every** button that writes a seed, not just the nearest one.
 *
 * Save and Commit live in two independently-scrolling columns (`.fxwb-side` and `.fxrail`), so a warning
 * rendered next to Save says nothing at all about a Commit happening in the other column with the warning
 * scrolled out of view — and Commit is the path that matters more, because it writes `bindings.json` and makes
 * the effect live for real. Hence one component, rendered in both places, rather than a guarantee that quietly
 * only covered half the surface.
 *
 * Renders nothing when the seed is unlocked, so callers can drop it in unconditionally.
 */
export function SeedBakeWarning({
  seedLocked,
  seed,
  onUnlock,
  writeVerb,
}: {
  seedLocked: boolean;
  seed: number;
  /**
   * Called by the Unlock button. Both call sites pass `toggleSeedLock`, a TOGGLE rather than a one-way unlock —
   * safe only because of the `if (!seedLocked) return null` guard below: this component exists solely while the
   * seed is locked, so the toggle can only ever run in the locked→unlocked direction. If that guard is ever
   * relaxed (e.g. to show a muted "seed is free" line), this must become a real unlock or the button starts
   * re-locking a free seed.
   */
  onUnlock: () => void;
  /** What the adjacent button does, so the sentence reads true next to either Save or Commit. */
  writeVerb: 'Saving' | 'Committing';
}): React.ReactElement | null {
  if (!seedLocked) return null;
  return (
    <div className="fxwb-def-seedwarn">
      <span className="fxwb-def-seedwarn-txt">
        🔒 {writeVerb} bakes seed <strong>{seed}</strong> into this def — every play of it in the game will be
        the identical roll. Unlock to let it roll fresh each time.
      </span>
      <button
        type="button"
        className="fxwb-def-seedwarn-unlock"
        title="Unlock the seed — this def then rolls fresh randomness on every play, and no seed is written"
        onClick={onUnlock}
      >
        Unlock
      </button>
    </div>
  );
}
