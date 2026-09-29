import { useEffect, useRef, useState } from 'react';
import { achievementOf, crateName, isMasterTitle, titleName } from '@game/progression';
import { TitleBadge } from '../titles/TitleBadge';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { Icon } from '../Icon';
import { achievementsVisible, useProgression } from './progressionStore';
import { hasNewRewards, markNewRewardsSeen, syncNewRewards, unseenCount, useNewRewards, type UnseenRewards } from './newRewards';
import { xpText } from './progressionFormat';
import './collection.css';

/**
 * NEW REWARDS in the Collection (owner ask 2026-09-28). See `newRewards.ts` for the queue. Two pieces:
 *
 *  - `NewPill`: the orange NEW pill every Collection entry point wears while rewards wait (the title plaque, the
 *    side-menu plaque, Career's Collection button). Static: no animation.
 *  - `NewRewardsPopup`: the one tidy summary the Collection opens with: achievements unlocked (with XP, and a link to
 *    them all in Career), titles unlocked, crates earned (Open / Open all through the Collection's own crate
 *    theatre). Any way out of it marks everything seen.
 */

/** Is anything waiting? Keeps the queue pointed at the signed-in account. */
export function useHasNewRewards(): boolean {
  const userId = useGame((s) => s.account.userId);
  useEffect(() => { syncNewRewards(userId); }, [userId]);
  return useNewRewards(hasNewRewards);
}

export function NewPill() {
  return <span className="newpill" aria-label="New rewards">New</span>;
}

/** Where the Career's tab choice lives (Career.tsx `TAB_KEY`): "See all in Career" opens the Achievements tab. */
const CAREER_TAB_KEY = 'ascent.career.tab';

export function NewRewardsPopup({ sealedIds, onOpenCrates }: {
  /** The crates still sealed right now (a queued crate opened elsewhere drops out). */
  sealedIds: ReadonlySet<string> | null;
  /** Open the crates in the Collection's theatre: one, or all. */
  onOpenCrates: (all: boolean) => void;
}) {
  const userId = useGame((s) => s.account.userId);
  const goTo = useGame((s) => s.goTo);
  const achievementsOn = useProgression(achievementsVisible);
  useEffect(() => { syncNewRewards(userId); }, [userId]);
  const live = useNewRewards((s) => s.unseen);
  // Snapshot what was waiting when the Collection opened: the pop-up shows exactly that, once.
  const [shown, setShown] = useState<UnseenRewards | null>(null);
  const took = useRef(false);
  useEffect(() => {
    if (took.current || unseenCount(live) === 0) return;
    took.current = true;
    setShown(live);
  }, [live]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dismiss = (): void => { markNewRewardsSeen(userId); setShown(null); };
  useEffect(() => {
    if (!shown) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sfx.tick(); markNewRewardsSeen(userId); setShown(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown, userId]);
  if (!shown) return null;

  const crates = shown.crates.filter((c) => !sealedIds || sealedIds.has(c.crateId));
  const achievements = shown.achievements.map((a) => ({ ...a, def: achievementOf(a.id) })).filter((a) => !!a.def);
  const titles = shown.titles.filter((t) => titleName(t));
  // Everything it held has gone (the crates opened elsewhere, ids this build does not know): nothing to show.
  if (achievements.length + titles.length + crates.length === 0) { queueMicrotask(dismiss); return null; }
  const openCrates = (all: boolean): void => { sfx.pulse(); dismiss(); onOpenCrates(all); };
  const seeCareer = (): void => {
    sfx.pulse();
    dismiss();
    try { localStorage.setItem(CAREER_TAB_KEY, 'achievements'); } catch { /* the Career just opens on its last tab */ }
    goTo('career');
  };
  return (
    <div className="nrw-scrim" onPointerDown={() => { sfx.tick(); dismiss(); }}>
      <section className="nrw-panel" role="dialog" aria-modal="true" aria-labelledby="nrw-title" onPointerDown={(e) => e.stopPropagation()}>
        <header className="nrw-head">
          <span className="nrw-title" id="nrw-title"><Icon name="gift" />New rewards</span>
          <button ref={closeRef} type="button" className="mdd-close pressable" aria-label="Close new rewards" onClick={() => { sfx.tick(); dismiss(); }}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        {achievements.length > 0 && (
          <div className="nrw-sec">
            <div className="nrw-kicker">Achievements unlocked</div>
            <ul className="nrw-list">
              {achievements.slice(0, 6).map((a) => (
                <li key={a.id} className="nrw-item"><span className="nrw-name">{a.def!.name}</span><b className="nrw-xp">{xpText(a.xp)}</b></li>
              ))}
              {achievements.length > 6 && <li className="nrw-more">+{achievements.length - 6} more</li>}
            </ul>
            {achievementsOn && <button type="button" className="nrw-link pressable" onClick={seeCareer}>See all in Career</button>}
          </div>
        )}
        {titles.length > 0 && (
          <div className="nrw-sec">
            <div className="nrw-kicker">{titles.length === 1 ? 'Title unlocked' : 'Titles unlocked'}</div>
            <div className="nrw-titles">{titles.map((t) => (isMasterTitle(t)
              ? <TitleBadge key={t} id={t} className="nrw-titleplate" />
              : <span key={t} className="nrw-titlechip">{titleName(t)}</span>))}</div>
            <div className="nrw-note">Wear it from the Titles tab.</div>
          </div>
        )}
        {crates.length > 0 && (
          <div className="nrw-sec nrw-crates">
            <span className="acctxp-crates-icon" aria-hidden />
            <div className="nrw-cratetext">
              <div className="nrw-kicker">{crates.length === 1 ? 'Crate earned' : `${crates.length} crates earned`}</div>
              <div className="nrw-note">{crates.map((c) => crateName(c.earnedLevel)).join(', ')}</div>
            </div>
            <div className="nrw-crate-actions">
              <button type="button" className="crate-btn pressable" onClick={() => openCrates(false)}>Open</button>
              {crates.length > 1 && <button type="button" className="colls-quiet pressable quiet" onClick={() => openCrates(true)}>Open all ({crates.length})</button>}
            </div>
          </div>
        )}
        <footer className="nrw-foot">
          <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); dismiss(); }}>Got it</button>
        </footer>
      </section>
    </div>
  );
}
