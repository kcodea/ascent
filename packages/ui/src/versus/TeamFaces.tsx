/**
 * A TEAM, PRESENTED AS A TEAM (2026-11-10, owner: "make the beats much stronger for duos").
 *
 * The two moments that belong to the pair, its result and its elimination, showed the pair as two small static
 * portraits (the result) or not at all (the elimination dialog). `TeamFaces` is the one row both use now: each
 * teammate's hero in its owner's frame and skins (the leaderboard's own `LbHeroFrame`, no new art), me first, with a
 * short entrance: the two come in from either side and meet, then settle together. A win leaves a soft gold light
 * behind them; a team that is out drains to grey once it has landed.
 *
 * Motion is one-shot and transform / opacity only on the moving element (the grey is a one-shot filter transition on
 * the still portrait inside it, after the entrance has ended). `prefers-reduced-motion` shows the final state at once.
 */
import { useMemo } from 'react';
import { duosMateOf, getHero } from '@game/sim';
import { parseCosmeticSnapshot } from '@game/progression';
import { LbHeroFrame } from '../LadderBits';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { heroPortrait } from '../skins/skinArt';
import { opponentSkins } from '../skins/skins';
import { useGame } from '../store';
import { currentUserId } from '../identity';
import { useVersus, type DuosResultMember } from './versusStore';
import { groupSeatOf, isDuosRaw } from './versusGroupView';
import { isRankedDuosRaw } from './rankedDuosView';

export type TeamMood = 'won' | 'placed' | 'out';

/** The mood a final team place (1 to 4) is shown in. */
export const teamMoodOf = (placement: number): TeamMood => (placement === 1 ? 'won' : placement <= 2 ? 'placed' : 'out');

export function TeamFaces({ team, mood, label = 'Your team' }: { team: readonly DuosResultMember[]; mood: TeamMood; label?: string }): JSX.Element | null {
  const showOpp = useGame((s) => s.showOpponentSkins);
  if (team.length === 0) return null;
  return (
    <div className={`vsteam vsduosresult-faces ${mood}${team.length === 1 ? ' solo' : ''}`} aria-label={label}>
      {team.map((m) => {
        const skins = m.self ? m.cosmetics : opponentSkins(showOpp, m.cosmetics);
        return (
          <div key={m.userId} className={`vsteam-face vsduosresult-face${m.self ? ' self' : ''}`}>
            <LbHeroFrame heroId={m.hero} size="big" side={m.self ? 'self' : 'opp'} art={m.hero ? heroPortrait(m.hero, skins) : undefined} frameId={frameIdOf(skins)} />
            <span className="vsteam-name vsduosresult-name">{m.self ? 'You' : m.name}</span>
            {m.hero && <span className="vsteam-hero vsduosresult-hero">{getHero(m.hero).name}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * My side of the match on screen, me first: both teammates in a Duos match (Versus Duos or Ranked Duos), just me in a
 * group match. Empty when I hold no seat. Read from the match the store already has; re-renders only when the pair's
 * names, heroes or skins change.
 */
export function useMyTeam(): DuosResultMember[] {
  const key = useVersus((s) => {
    const raw = s.match?.group?.raw;
    const me = currentUserId();
    const mine = raw ? groupSeatOf(raw, me) : null;
    if (!raw || !mine) return '';
    const mateSeat = isDuosRaw(raw) || isRankedDuosRaw(raw) ? duosMateOf(mine.seat) : null;
    const mate = mateSeat ? raw.seats.find((x) => x.seat === mateSeat) ?? null : null;
    const cos = (uid: string): unknown => s.room?.members.find((m) => m.userId === uid)?.profile?.cosmetics ?? null;
    return JSON.stringify([mine, mate].filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ userId: x.userId, name: x.name, hero: x.hero, self: x.userId === me, cos: cos(x.userId) })));
  });
  const myCos = useGame((s) => (s.run.mode === 'versus' ? s.run.cosmetics ?? null : null));
  return useMemo(() => {
    if (!key) return [];
    const rows = JSON.parse(key) as { userId: string; name: string; hero: string | null; self: boolean; cos: unknown }[];
    return rows.map((r): DuosResultMember => ({ userId: r.userId, name: r.name, hero: r.hero, self: r.self, cosmetics: (r.self ? myCos : null) ?? parseCosmeticSnapshot(r.cos) ?? null }));
  }, [key, myCos]);
}
