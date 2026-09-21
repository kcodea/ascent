import { createRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sfx } from '../sfx';
import { RankBar, type RankBarAnimRefs } from './RankBar';
import { announcement, cappedDetail, deltaText, ordinal, outcomeText, placementText } from './rankFormat';
import { markRankPresented, wasRankPresented } from './presented';
import { planRankSequence } from './rankSequence';
import { buildRankTimeline } from './rankTimeline';
import type { RankPosition, RankResult, RankSubmission } from './types';

/**
 * THE POST-GAME RANK SCREEN (owner ask 2026-09-20: "the game should dim and the animation plays VICTORY or
 * 2nd etc with the mmr adjustment bar showing up and moving"; blueprint §7).
 *
 * Reveal (placement + pre-match crest) → Establish (old label, old points, the ACTUAL delta) → Apply (the bar
 * travels before → after with a counter, `scaleX` on the fill) → Resolve (gate glow / crest transition /
 * outcome line) → Hold. The sequence is a paused GSAP timeline built from `planRankSequence` and driven through
 * refs — no React re-render per frame; when it settles the bar REMOUNTS on the after-state (`key`), so React's
 * view and GSAP's inline styles can never disagree.
 *
 * CONTINUE is always visible and usable; clicking the rank display (or Skip) settles instantly; neither touches
 * the submission. The celebration plays ONCE per run — `presented.ts` keeps a consumed marker apart from rank
 * state, so a remount after Rewatch, a reload or a duplicate confirmation settles silently. Reduced motion:
 * no timeline, everything present, the container's short CSS fade only. Timelines are killed on unmount.
 */

export interface RankScreenProps {
  placement: number;
  seatCount: number;
  submission: RankSubmission;
  /** The confirmed result (null until confirmed, or for unrated / failed states). */
  result: RankResult | null;
  /** The profile's current position — the crest to show while pending / retryable / rejected. */
  current: RankPosition | null;
  /** A truthful message for the rejected state. */
  error?: string;
  /** Why the run was unrated ("Practice"). */
  unratedReason?: string;
  /** The run identity the consumed marker is keyed on. */
  runId: string;
  onContinue: () => void;
  onRetry?: () => void;
  onRewatch?: () => void;
  /** The final warband, rendered when the player expands it. */
  warband?: ReactNode;
  /** DEV preview: never writes the consumed marker. */
  preview?: boolean;
  /** Test/DEV override for `prefers-reduced-motion`. */
  reducedMotion?: boolean;
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const cues = {
  progress: () => sfx.rankProgress(),
  gate: () => sfx.rankGate(),
  promote: () => sfx.rankPromote(),
  medal: () => sfx.rankMedal(),
};

export function RankScreen(props: RankScreenProps): JSX.Element {
  const { placement, seatCount, submission, result, current, error, unratedReason, runId, onContinue, onRetry, onRewatch, warband, preview = false } = props;
  const reduced = props.reducedMotion ?? prefersReducedMotion();
  const confirmed = submission === 'confirmed' && !!result;
  // The celebration plays only for a freshly confirmed result that has not been presented before.
  const shouldAnimate = confirmed && !reduced && (preview || !wasRankPresented(runId));
  const [settled, setSettled] = useState(!shouldAnimate);
  const [announce, setAnnounce] = useState('');
  const [warbandOpen, setWarbandOpen] = useState(false);
  const tlRef = useRef<ReturnType<typeof buildRankTimeline> | null>(null);
  const finishedRef = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const placementRef = useRef<HTMLDivElement>(null);
  const deltaRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  // Stable refs for the bar GSAP drives (one object for the lifetime of the screen).
  const anim = useMemo<RankBarAnimRefs>(() => ({
    crest: createRef<HTMLDivElement>(), crestNext: createRef<HTMLDivElement>(), label: createRef<HTMLDivElement>(),
    track: createRef<HTMLDivElement>(), fill: createRef<HTMLDivElement>(), tip: createRef<HTMLSpanElement>(), points: createRef<HTMLDivElement>(),
  }), []);

  const finish = useCallback((): void => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (!preview) markRankPresented(runId);
    setSettled(true);
    setAnnounce(announcement(placement, result, submission));
  }, [placement, preview, result, runId, submission]);

  // A result that arrives while the screen is up (pending → confirmed) ARMS the sequence: one render with the
  // before-state + refs attached, then the layout effect below builds and plays over those refs.
  const resultKey = confirmed ? result!.runId : null;
  const [armedFor, setArmedFor] = useState<string | null>(shouldAnimate ? resultKey : null);
  useEffect(() => {
    if (shouldAnimate && resultKey && armedFor !== resultKey) {
      finishedRef.current = false;
      setSettled(false);
      setArmedFor(resultKey);
      return;
    }
    if (confirmed && !shouldAnimate) {
      // Shown without a sequence (reduced motion, or already presented) still counts as presented.
      if (!preview) markRankPresented(runId);
      setAnnounce(announcement(placement, result, submission));
    } else if (!confirmed) setAnnounce(announcement(placement, null, submission));
  }, [shouldAnimate, resultKey, armedFor, confirmed, placement, result, submission, preview, runId]);

  // The timeline reads the result + finish through refs so a parent re-render handing an EQUAL result object
  // (or a new `finish` identity) can never restart a sequence in flight: only the run identity re-arms it.
  const resultRef = useRef(result);
  resultRef.current = result;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useLayoutEffect(() => {
    const result = resultRef.current;
    if (!shouldAnimate || !result || settled || armedFor !== resultKey) return;
    const steps = planRankSequence(result);
    const tl = buildRankTimeline(steps, {
      placement: placementRef.current, crestOld: anim.crest.current, crestNew: anim.crestNext.current,
      label: anim.label.current, track: anim.track.current, fill: anim.fill.current, tip: anim.tip.current,
      points: anim.points.current, delta: deltaRef.current, detail: detailRef.current, outcome: outcomeRef.current,
    }, cues, () => finishRef.current());
    tlRef.current = tl;
    tl.play();
    return () => {
      // Leaving mid-sequence (Rewatch, Continue) counts as presented — a return must not replay it. A timeline
      // that never ticked (StrictMode's synchronous re-run in dev) does not.
      if (!preview && tl.time() > 0 && !finishedRef.current) markRankPresented(runId);
      tl.kill();
      tlRef.current = null;
    };
  }, [shouldAnimate, settled, armedFor, resultKey, anim, preview, runId]);

  useEffect(() => { continueRef.current?.focus(); }, []);

  const skip = useCallback((): void => {
    const tl = tlRef.current;
    if (tl) { tl.progress(1, true); tl.kill(); tlRef.current = null; }
    finish();
  }, [finish]);

  const won = placement === 1;
  const transitions = !!result && (result.promoted || result.demoted);
  const shownPos: RankPosition | null = result ? (settled ? result.after : result.before) : current;
  const delta = result ? deltaText(result) : null;
  const detail = result ? cappedDetail(result) : null;
  const outcome = result ? outcomeText(result) : null;
  const deltaTone = result ? (result.promoted || result.appliedDelta > 0 ? 'up' : result.appliedDelta < 0 ? 'down' : 'flat') : 'flat';

  return (
    <div className={`rankend-panel${settled ? ' settled' : ' playing'}`}>
      <div className={`rankend-place${won ? ' won' : ''}`} ref={placementRef} aria-label={`Finished ${ordinal(placement)} of ${seatCount}`}>
        <span className="rankend-place-text">{placementText(placement)}</span>
        <span className="rankend-place-of">{won ? `1st of ${seatCount}` : `of ${seatCount}`}</span>
      </div>

      {shownPos && (
        <div
          className="rankend-rank"
          role="button"
          tabIndex={0}
          aria-label={settled ? 'Rank result' : 'Rank result — activate to skip the animation'}
          onClick={settled ? undefined : skip}
          onKeyDown={settled ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skip(); } }}
        >
          {/* Keyed on the settle so the after-state remounts clean of GSAP's inline styles. */}
          <RankBar
            key={settled ? 'after' : 'before'}
            position={shownPos}
            size="xl"
            showGate={false}
            anim={settled ? undefined : anim}
            nextDivisionIndex={!settled && transitions ? result!.after.divisionIndex : undefined}
          />
          {result && (
            <>
              <div className={`rankend-delta ${deltaTone}`} ref={deltaRef}>{delta}</div>
              {detail && <div className="rankend-detail" ref={detailRef}>{detail}</div>}
              {outcome && (
                <div className={`rankend-outcome${result.promoted ? ' promo' : result.demoted ? ' demo' : result.promotionUnlocked ? ' gate' : ''}`} ref={outcomeRef}>
                  {outcome}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {submission === 'pending' && (
        <div className="rankend-status pending" role="status"><span className="lb-spin rankend-spin" aria-hidden />Updating rank…</div>
      )}
      {submission === 'retryable' && (
        <div className="rankend-status retry" role="status">Rank update pending — your result is saved and will be retried.</div>
      )}
      {submission === 'rejected' && (
        <div className="rankend-status rejected" role="alert">{error ?? 'Rank update failed. This result could not be ranked.'}</div>
      )}
      {submission === 'unrated' && (
        <div className="rankend-status unrated">Unrated{unratedReason ? ` · ${unratedReason}` : ''}</div>
      )}

      <div className="rankend-actions">
        <button ref={continueRef} type="button" className="endplay pressable rankend-continue" onClick={onContinue}>Continue</button>
        {submission === 'retryable' && onRetry && (
          <button type="button" className="endplay pressable rankend-retry" onClick={onRetry}>Retry</button>
        )}
      </div>
      <div className="rankend-secondary">
        {!settled && <button type="button" className="rankend-link" onClick={skip}>Skip animation</button>}
        {onRewatch && <button type="button" className="rankend-link" onClick={onRewatch}>Rewatch</button>}
        {warband && (
          <button type="button" className="rankend-link" aria-expanded={warbandOpen} onClick={() => setWarbandOpen((o) => !o)}>
            {warbandOpen ? 'Hide warband' : 'Final warband'}
          </button>
        )}
      </div>
      {warband && warbandOpen && <div className="rankend-warband">{warband}</div>}
      <div className="rankend-live" aria-live="polite">{announce}</div>
    </div>
  );
}
