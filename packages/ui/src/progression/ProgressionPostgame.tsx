import { useEffect, useMemo, useRef, useState } from 'react';
import { ALPHA_TESTER_TITLE_ID, levelProgress, titleName, type ProgressionResult } from '@game/progression';
import { useGame } from '../store';
import { cratesVisible, markProgressionPresented, useProgression, wasProgressionPresented, type CurrentRunProgression } from './progressionStore';
import { breakdownLines, xpText } from './progressionFormat';
import { CrateOpener, type CrateQueueItem } from './CrateOpener';

/**
 * THE POST-GAME ACCOUNT XP PANEL (account progression MVP, 2026-09-27; handoff §10).
 *
 * Sits under the rank result (Ranked), on the practice end screen, and on the tutorial graduation card. Order:
 * the XP breakdown (complete / Top 4 / first / comeback) → the bar sweeps from the old value to the new one →
 * a level-up moment when a level is crossed (several levels: one sweep through the first boundary, then the
 * final level, never a ceremony per level) → the "Alpha Tester" title reveal on reaching Level 2 → for an
 * ANONYMOUS player at that moment, a gentle "Save your progress" prompt (never a gate) that opens the existing
 * account panel. A failed settlement reads "Progress pending. It will sync automatically." Continue is never
 * here: it stays the screen's own button, always available.
 *
 * CRATES (2026-09-28): when the settlement created crates (one per new level, plus the Welcome Crate on the
 * first game), "Crate earned" appears after the bar settles, with an OPTIONAL Open button (the reveal plays
 * inline; opening is never required to continue). A guest who earns a crate gets the same save prompt.
 *
 * MOTION: the fill is a `transform: scaleX` transition (compositor only, one-shot); the level badge pop is a
 * one-shot keyframe. Reduced motion, or a result already presented (a remount, a reload, a duplicate answer):
 * no sweep, the final state at once. The ceremony plays once per settled run (`markProgressionPresented`).
 *
 * `active` is false while the rank celebration above is still playing, so the two never compete.
 */
export interface ProgressionPostgameProps {
  /** The finished run's local key (its seed): which settlement this screen is about. */
  localKey: string;
  active: boolean;
  /** Test / DEV override for `prefers-reduced-motion`. */
  reducedMotion?: boolean;
}

type Phase = 'hold' | 'fill1' | 'levelup' | 'fill2' | 'done';

const T_START = 350;
const T_FILL = 900;
const T_LEVELUP = 450;
const T_FILL2 = 700;

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** A tutorial replay's answer is the original claim: say so instead of re-showing the award. */
const ALREADY_CLAIMED_AFTER_MS = 15 * 60_000;
function isStaleClaim(cur: CurrentRunProgression): boolean {
  if (!cur.deduped || cur.mode !== 'tutorial' || !cur.result?.settledAt) return false;
  const t = Date.parse(cur.result.settledAt);
  return Number.isFinite(t) && Date.now() - t > ALREADY_CLAIMED_AFTER_MS;
}

export function ProgressionPostgame({ localKey, active, reducedMotion }: ProgressionPostgameProps): JSX.Element | null {
  const capability = useProgression((s) => s.capability);
  const current = useProgression((s) => s.current);
  const cur = current && current.localKey === localKey ? current : null;
  if (capability !== 'on' || !cur || !active || cur.state === 'none' || cur.state === 'rejected') return null;
  if (cur.state === 'pending') {
    return <div className="acctxp acctxp-status" role="status"><span className="lb-spin acctxp-spin" aria-hidden />Adding Account XP</div>;
  }
  if (cur.state === 'retryable' || !cur.result) {
    return <div className="acctxp acctxp-status" role="status">Progress pending. It will sync automatically.</div>;
  }
  if (isStaleClaim(cur)) {
    return <div className="acctxp acctxp-status" role="status">Tutorial XP already earned.</div>;
  }
  return <SettledPanel key={`${cur.mode}:${cur.result.runId}`} result={cur.result} reduced={reducedMotion ?? prefersReducedMotion()} />;
}

function SettledPanel({ result, reduced }: { result: ProgressionResult; reduced: boolean }): JSX.Element {
  const anonymous = useGame((s) => s.account.anonymous);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const before = useMemo(() => levelProgress(result.before.lifetimeXp), [result.before.lifetimeXp]);
  const after = useMemo(() => levelProgress(result.after.lifetimeXp), [result.after.lifetimeXp]);
  const crossed = after.level > before.level;
  // Decided ONCE per mount: a result already presented settles silently.
  const [animate] = useState(() => !reduced && !wasProgressionPresented(result.mode, result.runId));
  const [phase, setPhase] = useState<Phase>(animate ? 'hold' : 'done');
  const presentedRef = useRef(false);

  useEffect(() => {
    if (!animate) { if (!presentedRef.current) { presentedRef.current = true; markProgressionPresented(result.mode, result.runId); } return; }
    const timers: number[] = [];
    const at = (ms: number, p: Phase): void => { timers.push(window.setTimeout(() => setPhase(p), ms)); };
    at(T_START, 'fill1');
    if (crossed) {
      at(T_START + T_FILL, 'levelup');
      at(T_START + T_FILL + T_LEVELUP, 'fill2');
      at(T_START + T_FILL + T_LEVELUP + T_FILL2, 'done');
    } else {
      at(T_START + T_FILL, 'done');
    }
    // Leaving mid-sweep still counts as presented: a return must not replay it.
    presentedRef.current = true;
    markProgressionPresented(result.mode, result.runId);
    return () => { timers.forEach((t) => window.clearTimeout(t)); };
  }, [animate, crossed, result.mode, result.runId]);

  const onBefore = phase === 'hold' || phase === 'fill1';
  const shown = onBefore ? before : after;
  const fill = phase === 'hold' ? before.fraction
    : phase === 'fill1' ? (crossed ? 1 : after.fraction)
    : phase === 'levelup' ? 0
    : after.fraction;
  const sweeping = phase === 'fill1' || phase === 'fill2';
  const done = phase === 'done';
  const lines = breakdownLines(result);
  const unlockedAlpha = result.unlockedTitles.includes(ALPHA_TESTER_TITLE_ID);
  const reachedTwo = result.before.level < 2 && result.after.level >= 2;
  const cratesOn = useProgression(cratesVisible);
  const showCrates = done && cratesOn && result.crateIds.length > 0;
  const showSavePrompt = done && anonymous && (unlockedAlpha || reachedTwo || showCrates);
  const levelsGained = after.level - before.level;

  return (
    <section className={`acctxp${animate ? ' animated' : ''}${done ? ' done' : ''}`} aria-label="Account XP">
      <div className="acctxp-head">
        <span className="acctxp-eyebrow">Account XP</span>
        <span className="acctxp-total">{xpText(result.xp.total)}</span>
      </div>
      <ul className="acctxp-lines" aria-label="XP breakdown">
        {lines.map((l) => (
          <li key={l.key} className={`acctxp-line ${l.key}`}><span>{l.label}</span><b>{xpText(l.xp)}</b></li>
        ))}
      </ul>
      <div className="acctxp-barrow">
        <span className={`acctxp-level${phase === 'levelup' || (done && crossed && animate) ? ' up' : ''}`} aria-label={`Level ${shown.level}`}>
          <span className="acctxp-level-l">Lv</span>{shown.level}
        </span>
        <div className="acctxp-track" aria-hidden>
          <div
            className="acctxp-fill"
            style={{
              transform: `scaleX(${fill})`,
              transition: sweeping ? `transform ${phase === 'fill1' ? T_FILL : T_FILL2}ms cubic-bezier(0.25, 0.8, 0.3, 1)` : 'none',
            }}
          />
        </div>
        <span className="acctxp-num">{shown.xpIntoLevel} / {shown.xpForNextLevel}</span>
      </div>
      {crossed && (phase === 'levelup' || phase === 'fill2' || done) && (
        <div className="acctxp-levelup" role="status">
          {levelsGained > 1 ? `Level up! Level ${after.level} (+${levelsGained} levels)` : `Level up! Level ${after.level}`}
        </div>
      )}
      {done && unlockedAlpha && (
        <div className="acctxp-titlereveal" role="status">
          <span className="acctxp-titlereveal-eyebrow">Title unlocked</span>
          <span className="acctxp-titlereveal-name">{titleName(ALPHA_TESTER_TITLE_ID)}</span>
        </div>
      )}
      {showCrates && <PostgameCrates result={result} reduced={reduced} />}
      {showSavePrompt && (
        <div className="acctxp-save">
          <div className="acctxp-save-head">Save your progress</div>
          <div className="acctxp-save-body">You are playing as a guest. Create an account to keep your level and title on any device.</div>
          <button type="button" className="acctxp-save-btn pressable" onClick={openAccountPanel}>Create account</button>
        </div>
      )}
    </section>
  );
}

/** "Crate earned" + the optional Open button, for the crates THIS settlement created (oldest level first). */
function PostgameCrates({ result, reduced }: { result: ProgressionResult; reduced: boolean }): JSX.Element | null {
  const crateList = useProgression((s) => s.crateList);
  const [opening, setOpening] = useState(false);
  const n = result.crateIds.length;
  const queue: CrateQueueItem[] = useMemo(() => result.crateIds.map((crateId, i) => ({
    crateId, earnedLevel: Math.max(1, result.after.level - (n - 1 - i)),
  })), [result.crateIds, result.after.level, n]);
  // Crates already opened elsewhere (the Collection, an earlier visit to this screen) drop out.
  const sealed = queue.filter((c) => crateList?.find((x) => x.crateId === c.crateId)?.state !== 'opened');
  if (!opening && sealed.length === 0) return null;
  return (
    <div className="acctxp-crates">
      {!opening ? (
        <div className="acctxp-crates-row">
          <span className="acctxp-crates-icon" aria-hidden />
          <div className="acctxp-crates-text">
            <span className="acctxp-crates-head">{n === 1 ? 'Crate earned' : `${n} crates earned`}</span>
            <span className="acctxp-crates-sub">Open now, or later from your Collection.</span>
          </div>
          <button type="button" className="crate-btn pressable" onClick={() => setOpening(true)}>Open</button>
        </div>
      ) : (
        <CrateOpener queue={sealed.length ? sealed : queue} autoOpen reducedMotion={reduced} onClose={() => setOpening(false)} />
      )}
    </div>
  );
}
