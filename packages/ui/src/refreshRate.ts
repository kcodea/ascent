/**
 * REFRESH-RATE DETECTION — the calibration under the perf HUD's `long` / `jank` thresholds.
 *
 * The bug this exists to kill: `perfMonitor` shipped with `LONG_FRAME_MS = 33` and `JANK_MS = 50`, which
 * are *60 Hz numbers wearing a millisecond costume*. On the owner's 360 Hz display a frame drops at ~2.8 ms,
 * so `long` only counted after ~8 dropped frames and `jank` after ~12 — the HUD reported a clean session
 * while the game dropped frames continuously. A fixed ms threshold silently encodes an assumed refresh rate.
 *
 * Hardcoding 240 would be the same mistake one notch along, so the thresholds are DERIVED from the display
 * we are actually presenting to. Everything here is pure and unit-tested: the sampler is rAF-bound and
 * cannot be exercised headlessly, but a mis-derived threshold is invisible rather than loud, so the maths
 * is pinned.
 *
 * ## How the refresh is estimated
 *
 * `screen.refreshRate` is non-standard and absent in every browser we ship to, so the only signal available
 * is the rAF cadence itself. The naive read — the *mean* or *median* rAF interval over a warm-up second —
 * is exactly wrong: the first second of a session is the most loaded second there is (module eval, shader
 * link, first paint), so a loaded warm-up reads as a low refresh rate and then under-reports forever.
 *
 * The fix is the direction of the error. **Load can only ever make a frame interval LONGER, never shorter** —
 * you cannot present frames faster than the panel scans out. So the refresh is the *fastest sustained*
 * cadence, and the robust estimator is a LOW percentile of the observed intervals (`P_LO`), not a central
 * one. A window that is 90% jank still reports the true refresh, as long as one frame in ten made it.
 * A low percentile rather than the bare minimum because rAF occasionally double-fires with a near-zero
 * delta; the minimum would latch onto that, a decile absorbs a dozen of them per window.
 *
 * The result is then SNAPPED to the ladder of refresh rates that real panels actually run at, when it lands
 * within `SNAP_TOL` of one. This is what makes a variable-refresh (VRR / G-Sync) display behave: it never
 * holds a clean cadence, so a raw estimate wanders (143.2, 146.9, 141.8 …) and the thresholds would wobble
 * with it. Snapping parks the whole neighbourhood on 144.
 *
 * ## How a throttled period is prevented from re-baselining it
 *
 * `nextRefreshState` is deliberately asymmetric:
 *
 * - **Faster is adopted immediately.** An observation faster than the current estimate is proof the earlier
 *   estimate was too low — the panel demonstrably presented at that rate. There is no failure mode where
 *   load makes this over-read.
 * - **Slower must be sustained.** A lower observation is ambiguous: a genuinely slower display, or the
 *   browser throttling rAF (occluded window, power saving, an intervention that has nothing to do with our
 *   load). So it must be corroborated by `SLOW_CONFIRMATIONS` consecutive, mutually-consistent windows
 *   before it is adopted. A transient throttle expires; an actual monitor change (drag the window to a
 *   60 Hz panel) lands a few seconds later.
 *
 * Backgrounded tabs throttle rAF to near zero, which would be the loudest poison of all — `perfMonitor`
 * already flags those buckets `hidden`, and the caller must not feed a hidden bucket's samples in at all.
 * That is enforced at the call site in `perfMonitor.closeBucket`, and `hidden` buckets are the one case the
 * "slower must be sustained" rule is NOT relied on to catch.
 *
 * A detected "refresh" of 5 Hz or 5000 Hz is a bug, not a display: anything outside
 * [`MIN_REFRESH_HZ`, `MAX_REFRESH_HZ`] is rejected as no evidence rather than clamped into it, because
 * clamping would launder a broken sample into a confident-looking number.
 */

/** Below this, it isn't a display — it's a stalled tab. Rejected as no evidence. */
export const MIN_REFRESH_HZ = 24;
/** Above this, it isn't a display — it's rAF double-firing or a bogus clock. Rejected as no evidence. */
export const MAX_REFRESH_HZ = 1000;
/** What we assume until the first window of frames has been seen. The historic hardcoded assumption —
 *  now explicit, and only ever in force for the first second. */
export const DEFAULT_REFRESH_HZ = 60;

/** A frame interval this long or longer dropped at least one frame — "not smooth". 2 frames. */
export const LONG_FRAME_FRAMES = 2;
/** A frame interval this long reads as a visible hitch rather than a stutter. 3 frames. */
export const JANK_FRAMES = 3;

/**
 * Fewer samples than this is not a window, it's noise — return no evidence rather than a confident wrong
 * number. At 240 Hz a 1s bucket yields ~240; even a badly janking second clears 30.
 */
export const MIN_SAMPLES = 30;
/** The percentile of the interval distribution taken as the refresh. See the header: LOW, not central. */
export const P_LO = 0.1;
/** Snap to a real-panel rate when within this fraction of one — the VRR/jitter stabiliser. */
export const SNAP_TOL = 0.06;
/** Two estimates within this fraction of each other are "the same display". */
export const SAME_TOL = 0.05;
/** Consecutive corroborating windows required before adopting a SLOWER estimate. ~3s at 1s buckets. */
export const SLOW_CONFIRMATIONS = 3;

/** Refresh rates real panels ship at. A raw estimate near one of these is that one. */
export const REFRESH_LADDER: readonly number[] = [
  24, 25, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 280, 300, 360, 480, 500,
];

export interface FrameThresholds {
  /** The frame budget itself: 1000 / hz. 4.17 ms at 240 Hz. */
  frameMs: number;
  /** Dropped ≥1 frame. */
  longFrameMs: number;
  /** A visible hitch. */
  jankMs: number;
  /** The refresh these were derived from — a threshold is meaningless without it. */
  refreshHz: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The thresholds for a given refresh. Pure, total, and the ONLY place a ms threshold is produced.
 *
 * The multiples are chosen so that at 60 Hz this reproduces the historic constants bit for bit
 * (2 × 16.67 = 33.3, 3 × 16.67 = 50.0) — every log recorded before this change stays comparable, and the
 * change is a re-calibration rather than a redefinition. `hz` is clamped here so a caller that hands over
 * a junk number gets bounded thresholds instead of a division blow-up; the *estimator* rejects junk
 * outright rather than clamping (see `estimateRefreshHz`).
 */
export function thresholdsFor(hz: number): FrameThresholds {
  const safe = Number.isFinite(hz) ? Math.min(MAX_REFRESH_HZ, Math.max(MIN_REFRESH_HZ, hz)) : DEFAULT_REFRESH_HZ;
  const frameMs = 1000 / safe;
  return {
    frameMs: round2(frameMs),
    longFrameMs: round2(frameMs * LONG_FRAME_FRAMES),
    jankMs: round2(frameMs * JANK_FRAMES),
    refreshHz: round2(safe),
  };
}

/** Snap to the nearest real-panel rate if it's within SNAP_TOL, else leave the raw value alone. */
export function snapToLadder(hz: number): number {
  let best = hz;
  let bestErr = SNAP_TOL;
  for (const rung of REFRESH_LADDER) {
    const err = Math.abs(hz - rung) / rung;
    if (err < bestErr) { bestErr = err; best = rung; }
  }
  return best;
}

/**
 * Estimate the display refresh from a window of frame INTERVALS (ms).
 *
 * Returns `null` for "no evidence" — too few usable samples, or a result outside the plausible band. A null
 * must leave the current estimate alone; it is not a reading of 0.
 */
export function estimateRefreshHz(intervalsMs: readonly number[]): number | null {
  const usable: number[] = [];
  for (const v of intervalsMs) if (Number.isFinite(v) && v > 0) usable.push(v);
  if (usable.length < MIN_SAMPLES) return null;
  usable.sort((a, b) => a - b);
  const lo = usable[Math.min(usable.length - 1, Math.floor(usable.length * P_LO))]!;
  const hz = 1000 / lo;
  // Reject rather than clamp: a clamped 5000 Hz sample would masquerade as a real 1000 Hz display.
  if (hz < MIN_REFRESH_HZ || hz > MAX_REFRESH_HZ) return null;
  return round2(snapToLadder(hz));
}

export interface RefreshState {
  /** The refresh currently in force. */
  hz: number;
  /** A slower candidate awaiting corroboration, if any. */
  pending: number | null;
  /** How many consecutive windows have corroborated `pending`. */
  pendingCount: number;
  /** True once a real measurement has replaced DEFAULT_REFRESH_HZ — recorded so a log says which it was. */
  detected: boolean;
}

export const initialRefreshState = (): RefreshState => ({
  hz: DEFAULT_REFRESH_HZ, pending: null, pendingCount: 0, detected: false,
});

const near = (a: number, b: number): boolean => Math.abs(a - b) / b <= SAME_TOL;

/**
 * Fold one window's estimate into the running state. Pure — the whole anti-poisoning policy lives here so
 * it can be tested without a browser. See the header for why it is asymmetric.
 */
export function nextRefreshState(state: RefreshState, candidate: number | null): RefreshState {
  // No evidence this window (throttled, too few frames, absurd sample): hold, and forget any half-built
  // case for a slower rate — corroboration must be CONSECUTIVE or a slow drip of noise would accumulate.
  if (candidate === null) return state.pending === null ? state : { ...state, pending: null, pendingCount: 0 };

  // First real reading replaces the assumed default outright.
  if (!state.detected) return { hz: candidate, pending: null, pendingCount: 0, detected: true };

  // Same display, allowing for jitter: confirm and clear any pending case.
  if (near(candidate, state.hz)) {
    return state.pending === null ? state : { ...state, pending: null, pendingCount: 0 };
  }

  // FASTER than we thought. Load cannot manufacture a short interval, so this is proof the old estimate was
  // too low. Adopt at once — under-reporting the refresh is the failure mode that started all this.
  if (candidate > state.hz) return { hz: candidate, pending: null, pendingCount: 0, detected: true };

  // SLOWER. Ambiguous — a real display change, or rAF throttled for reasons unrelated to our frame cost.
  // Require consecutive, mutually-consistent corroboration before letting it move the thresholds.
  if (state.pending !== null && near(candidate, state.pending)) {
    const pendingCount = state.pendingCount + 1;
    if (pendingCount >= SLOW_CONFIRMATIONS) {
      return { hz: candidate, pending: null, pendingCount: 0, detected: true };
    }
    return { ...state, pendingCount };
  }
  return { ...state, pending: candidate, pendingCount: 1 };
}
