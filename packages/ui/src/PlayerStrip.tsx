/**
 * THE PLAYER STRIP (UI refinement 2026-10-16; owner on the Mode screen: "are you going to put something above") —
 * who you are, across the top of the Mode screen, the way Valorant / League / Hearthstone hubs show it. Built only
 * from existing pieces: the gold portrait ring + your equipped frame (`.portring` + `PortraitFrame`, the title's
 * account corner), your name and equipped title (`TitleBadge`), the rank crest + division + MMR (`RankCrest`,
 * `rankLabel`, `scalarCaption`), the account level badge + XP bar (`.acctxp-level` / `.acctxp-track`, the Career's
 * Account Level card) and the sealed-crate count. A compact strip, not a panel; the whole strip opens your Career.
 * Each part simply drops out when its data is not there (a guest has no rank, level or title).
 */
import { levelProgress } from '@game/progression';
import { avatarSrc } from './art';
import { PortraitFrame, pfClass, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { RankCrest } from './rank/RankBar';
import { useCurrentRank } from './rank/rankSource';
import { rankLabel, scalarCaption } from './rank/rankFormat';
import { TitleBadge } from './titles/TitleBadge';
import { cratesVisible, mirrorFor, useProgression } from './progression/progressionStore';
import { sfx } from './sfx';
import { tempHandle, useGame } from './store';

export function PlayerStrip() {
  const goTo = useGame((s) => s.goTo);
  const playerName = useGame((s) => s.playerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const userId = useGame((s) => s.account.userId);
  const frame = usePortraitFrame('self');
  const rank = useCurrentRank();
  const capability = useProgression((s) => s.capability);
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const cratesOn = useProgression(cratesVisible);
  const sealed = useProgression((s) => (s.crateList ?? []).filter((c) => c.state === 'sealed').length);
  const name = playerName || tempHandle(userId);
  const art = avatarSrc(playerAvatar);
  const lv = capability === 'on' && mirror ? levelProgress(mirror.accountXp) : null;

  return (
    <button type="button" className="pstrip" onClick={() => { sfx.pulse(); goTo('career'); }} aria-label={`${name}. Open your Career`}>
      <span className="pstrip-portrait">
        <span className={`portring${pfClass(frame)}`} style={frame?.hostStyle}>
          <span className="hero">
            <span className="f">
              {art
                ? <img decoding="sync" className="heroimg" src={art} alt="" draggable={false} />
                : <span className="pstrip-ph">{(name.trim()[0] ?? '').toUpperCase()}</span>}
            </span>
            <PortraitFrame frame={frame} />
          </span>
        </span>
      </span>
      <span className="pstrip-who">
        <span className="pstrip-name">{name}</span>
        {mirror?.equippedTitleId && <TitleBadge id={mirror.equippedTitleId} className="pstrip-title" />}
      </span>
      {rank && (
        <span className="pstrip-rank">
          <RankCrest divisionIndex={rank.divisionIndex} size="mini" hideDivision />
          <span className="pstrip-rank-txt">
            <span className="pstrip-rank-name">{rankLabel(rank)}</span>
            <span className="pstrip-rank-mmr">{scalarCaption(rank)} MMR</span>
          </span>
        </span>
      )}
      {lv && (
        <span className="pstrip-level">
          <span className="acctxp-level" aria-label={`Level ${lv.level}`}><span className="acctxp-level-l">Lv</span>{lv.level}</span>
          <span className="pstrip-xp">
            <span className="acctxp-track" aria-hidden><span className="acctxp-fill" style={{ transform: `scaleX(${lv.fraction})` }} /></span>
            <span className="pstrip-xp-num">{lv.xpIntoLevel} / {lv.xpForNextLevel} XP</span>
          </span>
        </span>
      )}
      {cratesOn && sealed > 0 && <span className="pstrip-crates">{sealed} sealed {sealed === 1 ? 'crate' : 'crates'}</span>}
      <span className="pstrip-go" aria-hidden="true">Career ›</span>
    </button>
  );
}
