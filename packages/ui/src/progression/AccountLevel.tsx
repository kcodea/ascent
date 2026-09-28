import { useEffect, useState } from 'react';
import { levelProgress, titleName, type ProgressionProfile } from '@game/progression';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { fetchPublicProgression } from './progressionRemote';
import { cratesVisible, mirrorFor, useProgression } from './progressionStore';

/**
 * ACCOUNT LEVEL on the Career page (2026-09-27): Level + XP bar + equipped title, public for every player, plus
 * a small "save your progress" reminder on an ANONYMOUS owner's own page. Hidden entirely until the feature is
 * on (the capability probe), so the page is unchanged before the owner runs the SQL.
 *
 * CRATES (2026-09-28): on your OWN page, once the crates migration is live, a Collection button (with the count
 * of sealed crates) opens the Collection screen (`CollectionScreen.tsx`, its own page since 2026-09-28): open
 * crates, see and equip your titles. Back from it returns here.
 */

/** The progression a Career page shows: your own mirror, or a viewed player's public row (read once per id).
 *  Null while unknown / off / not found. */
export function useCareerProgression(userId: string | null, own: boolean): ProgressionProfile | null {
  const capability = useProgression((s) => s.capability);
  const mirror = useProgression((s) => s.mirror);
  const [viewed, setViewed] = useState<{ userId: string; profile: ProgressionProfile | null } | null>(null);
  useEffect(() => {
    if (own || capability !== 'on' || !userId || viewed?.userId === userId) return;
    let live = true;
    void fetchPublicProgression(userId).then((p) => { if (live) setViewed({ userId, profile: p ?? null }); });
    return () => { live = false; };
  }, [own, capability, userId, viewed?.userId]);
  if (capability !== 'on' || !userId) return null;
  if (own) return mirrorFor(userId, mirror) ?? { accountXp: 0, accountLevel: 1, revision: 0, equippedTitleId: null, titles: [] };
  return viewed?.userId === userId ? viewed.profile : null;
}

export function AccountLevelCard({ profile, own }: { profile: ProgressionProfile; own: boolean }): JSX.Element {
  const anonymous = useGame((s) => s.account.anonymous);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const cratesOn = useProgression(cratesVisible);
  const sealed = useProgression((s) => (s.crateList ?? []).filter((c) => c.state === 'sealed').length);
  const openCollection = useGame((s) => s.openCollection);
  const p = levelProgress(profile.accountXp);
  const title = titleName(profile.equippedTitleId);
  return (
    <div className="cv2-panel cv2-acctlevel" aria-label="Account Level">
      <div className="cv2-acctlevel-row">
        <span className="cv2-acctlevel-badge" aria-label={`Level ${p.level}`}><span className="acctxp-level-l">Lv</span>{p.level}</span>
        <div className="cv2-acctlevel-body">
          <div className="cv2-acctlevel-label">Account Level {p.level}</div>
          <div className="acctxp-track cv2-acctlevel-track" aria-hidden>
            <div className="acctxp-fill" style={{ transform: `scaleX(${p.fraction})` }} />
          </div>
          <div className="cv2-acctlevel-num">{p.xpIntoLevel} / {p.xpForNextLevel} XP</div>
        </div>
      </div>
      {title && <div className="cv2-acctlevel-title"><span className="cv2-acctlevel-title-l">Title</span>{title}</div>}
      {own && cratesOn && (
        <button type="button" className="cv2-btn cv2-btn-sm cv2-acctlevel-coll pressable" onClick={() => { sfx.pulse(); openCollection(); }}>
          Collection
          {sealed > 0 && <span className="cv2-acctlevel-crates" aria-label={`${sealed} sealed ${sealed === 1 ? 'crate' : 'crates'}`}>{sealed}</span>}
        </button>
      )}
      {own && anonymous && (
        <div className="cv2-acctlevel-save">
          <span>Playing as a guest. Create an account to save your progress.</span>
          <button type="button" className="cv2-btn cv2-btn-sm pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Create account</button>
        </div>
      )}
    </div>
  );
}
