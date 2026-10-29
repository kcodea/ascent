/**
 * THE FRIENDS SURFACES' SHARED BITS (R-FRIENDS-01..05). The Friends page that first held them is gone (owner 2026-10-29,
 * R-FRIENDS-DOCK-02: everything it did moved into the one global Friends dock); these are the pieces every friends
 * surface draws with: a friend's portrait in their frame, their handle, the status words, the sort, a friend's game at a
 * glance and the button that asks once more.
 */
import { memo, useState } from 'react';
import { Icon } from '../Icon';
import { LbHeroFrame } from '../LadderBits';
import { avatarSrc } from '../art';
import { sfx } from '../sfx';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { heroPortrait, opponentSkins } from '../skins/skins';
import { displayHandle, useGame } from '../store';
import type { RunCosmeticSnapshot } from '@game/progression';
import { lastSeenText, modeText } from './friendsStore';
import type { Friend, FriendCard } from './friendsRemote';
import { activityText, gameStatusDetail, ORD, stepText, type FriendActivity, type FriendGameStatus } from './gameStatus';
import './friends.css';

/** A card's recorded cosmetics (frame + favourite-hero skin) as a snapshot the portrait helpers read. */
export function cardSkins(c: Pick<FriendCard, 'favoriteHero' | 'frame' | 'skin'>): RunCosmeticSnapshot | null {
  if (!c.frame && !c.skin) return null;
  return {
    ...(c.frame ? { portraitFrame: c.frame } : {}),
    ...(c.skin && c.favoriteHero ? { heroSkinByHeroId: { [c.favoriteHero]: c.skin } } : {}),
  };
}

/** A friend's portrait in their frame: their chosen picture (through "Show opponent cosmetics", like the Leaderboard),
 *  else their favourite hero in its skin. */
export const FriendPortrait = memo(function FriendPortrait({ card }: { card: FriendCard }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const skins = opponentSkins(showOpp, cardSkins(card));
  const art = (showOpp ? avatarSrc(card.avatar) : undefined) ?? heroPortrait(card.favoriteHero, skins);
  return <LbHeroFrame heroId={card.favoriteHero} art={art} frameId={frameIdOf(skins)} />;
});

export const handleOf = (c: Pick<FriendCard, 'author' | 'discriminator' | 'userId'>): string => displayHandle(c.author, c.discriminator, c.userId);

/** "Online" / "Online: Browsing Career" / "In a game: Ranked" / "Last seen 3 minutes ago". */
export function statusText(f: Pick<Friend, 'status' | 'mode' | 'lastSeen' | 'activity'>, now = Date.now()): string {
  if (f.status === 'online') {
    if (f.activity) return `Online: ${activityText(f.activity, modeText)[0]}`;
    const m = f.mode === 'versus_room' ? 'In a Versus room' : f.mode === 'watching' || f.mode === 'replay' ? modeText(f.mode) : null;
    return m ? `Online: ${m}` : 'Online';
  }
  if (f.status === 'in_game') {
    const m = modeText(f.mode);
    return m ? `In a game: ${m}` : 'In a game';
  }
  return lastSeenText(f.lastSeen, now);
}

const ORDER = { online: 0, in_game: 1, offline: 2 } as const;
export function sortFriends(list: readonly Friend[]): Friend[] {
  return [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status] || handleOf(a).localeCompare(handleOf(b)));
}

/** A button that asks once more before it acts (Block on an incoming request). */
export function ConfirmButton({ label, confirm, onConfirm, disabled }: { label: string; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={`lb-btn lb-btn-ghost pressable fr-small${armed ? ' fr-armed' : ''}`} disabled={disabled}
      onClick={() => { sfx.pulse(); if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      onBlur={() => setArmed(false)}>
      {armed ? confirm : label}
    </button>
  );
}

/**
 * A FRIEND'S GAME at a glance (R-FRIENDS-STATUS-01, R-FRIENDS-ACTIVITY-01): ONE line under the status: the hero they
 * play (a small portrait in the game's own frame), what they are doing ("Round 6 · Fighting Ann"), then their place,
 * Health + Armor (the game's own pill icons) and tier. The players, the teammate and the long words live in the
 * row's hover / tap (`friendDetail`). Static text, no animation.
 */
export const FriendGame = memo(function FriendGame({ game }: { game: FriendGameStatus }) {
  return (
    <div className="fr-game">
      {game.hero && <span className="fr-gamehero" aria-hidden="true"><LbHeroFrame heroId={game.hero} /></span>}
      <span className="fr-gameline">{stepText(game)}</span>
      {game.place && <span className="fr-gamechip">{`${ORD(game.place.rank)} of ${game.place.left}`}</span>}
      {game.health != null && (
        <span className="fr-gamechip fr-vitals" aria-label={game.armor ? `${game.health} Health and ${game.armor} Armor` : `${game.health} Health`}>
          <Icon name="heartPill" />{game.health}{game.armor ? <><Icon name="armor" />{game.armor}</> : null}
        </span>
      )}
      {game.tier != null && <span className="fr-gamechip">{`Tier ${game.tier}`}</span>}
    </div>
  );
});

/** An online friend's second line, when the activity has one ("3 of 4 players · Waiting"). */
export function ActivityDetail({ activity }: { activity: FriendActivity }) {
  const detail = activityText(activity, modeText)[1];
  return detail ? <div className="fr-game"><span className="fr-gamevs">{detail}</span></div> : null;
}

/** The full detail the row's hover / tap shows: every line, so the row itself stays two short lines. Null when the
 *  row already says it all. */
export function friendDetail(f: Pick<Friend, 'status' | 'mode' | 'game' | 'activity'>): string | null {
  if (f.status === 'in_game' && f.game) return gameStatusDetail(f.game, modeText(f.mode)).join('\n');
  if (f.status === 'online' && f.activity) {
    const [line, detail] = activityText(f.activity, modeText);
    return detail ? `${line}\n${detail}` : null;
  }
  return null;
}
