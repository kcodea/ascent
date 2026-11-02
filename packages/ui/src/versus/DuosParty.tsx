/**
 * RANKED DUOS, the party's own controls (owner design 2026-10-26; phase 3). A party is a room playing `ranked_duos`:
 * two seats on the room's stage (owner rule: reuse the existing UI, no bespoke chrome), but its own place, apart from
 * Versus (owner 2026-10-27, R-RANKED-DUOS-SPLIT-01): the team, Invite player, Start game and Back.
 *  - THE TEAM NAME (R-RANKED-DUOS-NAME-01): the pair's name heads the party's stage ("Name1 & Name2" until named);
 *    either teammate renames it between games from the Team name window (the room's own `.vsveil` + `.vspanel`).
 *  - FRIENDS ONLY (owner Q6): kept server-side (`setFriendsOnly`), but no longer on the party screen: there is no public
 *    parties list to hide from (2026-10-27).
 *  - THE RESULT (R-RANKED-DUOS-RATING-01, R-RANKED-DUOS-POSTGAME-01): after a game, the solo end screen's own flow over
 *    the room (`RankScreen` out of 4 teams, then Account XP), headed by both teammates; Continue returns to the party.
 */
import { useEffect, useState } from 'react';
import { defaultTeamName, getHero, teamNameProblem, TEAM_NAME_MAX } from '@game/sim';
import { sfx } from '../sfx';
import { RankScreen } from '../rank/RankScreen';
import { LbHeroFrame } from '../LadderBits';
import { ProgressionPostgame } from '../progression/ProgressionPostgame';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { heroPortrait } from '../skins/skinArt';
import { opponentSkins } from '../skins/skins';
import { useGame } from '../store';
import { RANKED_DUOS_TEAM_COUNT } from './rankedDuosView';
import { closeDuosResult, saveTeamName, setVersusStatsOpen, useVersus, type DuosResultMember } from './versusStore';
import { versusRemote, type VersusRoom } from './versusRemote';

/** The server's refusal codes, in plain words (no em dashes). */
const NAME_ERROR: Record<string, string> = {
  name_length: 'A team name is 2 to 16 characters.',
  name_chars: 'Use letters, numbers and single spaces only.',
  name_blocked: 'That name is not allowed.',
  name_reserved: 'That name is reserved.',
  team_in_game: 'Rename your team between games.',
  bad_team: 'You need a teammate to name a team.',
  guest: 'Save your account to name a team.',
};

/** The two seated players of a party (null until both seats are taken). */
export function partyPair(room: VersusRoom | null): [{ userId: string; name: string }, { userId: string; name: string }] | null {
  const a = room?.members.find((m) => m.role === 'p1');
  const b = room?.members.find((m) => m.role === 'p2');
  return a && b ? [{ userId: a.userId, name: a.displayName }, { userId: b.userId, name: b.displayName }] : null;
}

/** The pair's stored team name (null = unnamed), re-read when the pair or the room's revision changes. */
export function usePartyTeamName(room: VersusRoom | null): [string | null, (n: string | null) => void] {
  const pair = partyPair(room);
  const key = pair ? `${pair[0].userId}|${pair[1].userId}` : '';
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setName(null);
    if (!pair) return undefined;
    void versusRemote.duosTeam(pair[0].userId, pair[1].userId).then((t) => { if (live) setName(t?.name ?? null); }).catch(() => undefined);
    return () => { live = false; };
  }, [key]);
  return [name, setName];
}

/** The Team name window: either teammate, between games. */
export function TeamNamePanel({ room, me, name, onSaved, onClose }: { room: VersusRoom; me: string | null; name: string | null; onSaved: (n: string | null) => void; onClose: () => void }) {
  const pair = partyPair(room);
  const partner = pair?.find((p) => p.userId !== me) ?? null;
  const [draft, setDraft] = useState(name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fallback = pair ? defaultTeamName(pair[0].name, pair[1].name) : '';
  const save = async (value: string): Promise<void> => {
    if (!partner) return;
    const clean = value.trim();
    if (clean) {
      const p = teamNameProblem(clean);
      if (p) { setError(NAME_ERROR[p] ?? 'That name cannot be used.'); return; }
    }
    setBusy(true);
    try {
      const stored = await saveTeamName(partner.userId, clean);
      sfx.pulse();
      onSaved(stored);
      onClose();
    } catch (e) {
      sfx.deny();
      setError(NAME_ERROR[(e as { code?: string }).code ?? ''] ?? 'Could not save the name. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vsveil" role="dialog" aria-modal="true" aria-label="Team name" onClick={onClose}>
      <div className="vspanel vsteamname" onClick={(e) => e.stopPropagation()}>
        <div className="vspanel-title">Team name</div>
        <p className="vspanel-note">Your team with {partner?.name ?? 'your teammate'} has its own rating. Either of you can rename it between games.</p>
        <form onSubmit={(e) => { e.preventDefault(); void save(draft); }}>
          <input className="vsinput" maxLength={TEAM_NAME_MAX} placeholder={fallback} value={draft} autoFocus
            onChange={(e) => { setDraft(e.target.value); setError(null); }} aria-label="Team name" />
          {error && <div className="vspanel-error" role="alert">{error}</div>}
          <div className="vspanel-actions">
            <button type="submit" className="vsplate vsprimary" disabled={busy || !partner}>Save</button>
            {name && <button type="button" className="vsplate" disabled={busy} onClick={() => { void save(''); }}>Use "{fallback}"</button>}
            <button type="button" className="vsplate" onClick={() => { sfx.pulse(); onClose(); }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The team's two players on the post-game screen: each hero's portrait (in its owner's frame and skins) and name. */
function DuosResultTeam({ team }: { team: DuosResultMember[] }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  if (team.length === 0) return null;
  return (
    <div className="vsduosresult-faces" aria-label="Your team">
      {team.map((m) => {
        const skins = m.self ? m.cosmetics : opponentSkins(showOpp, m.cosmetics);
        return (
          <div key={m.userId} className={`vsduosresult-face${m.self ? ' self' : ''}`}>
            <LbHeroFrame heroId={m.hero} size="big" side={m.self ? 'self' : 'opp'} art={m.hero ? heroPortrait(m.hero, skins) : undefined} frameId={frameIdOf(skins)} />
            <span className="vsduosresult-name">{m.self ? 'You' : m.name}</span>
            {m.hero && <span className="vsduosresult-hero">{getHero(m.hero).name}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * THE RANKED DUOS POST-GAME (owner 2026-11-02, R-RANKED-DUOS-POSTGAME-01: "add a post game screen just like ranked
 * solo's that shows your team's ranked progress/xp etc same flow as solos"; "the continue then returns you to your duos
 * party"). The solo ranked end screen 1:1 (`RankScreen`, its placement reveal, the team's medal bar and points, the
 * promotion / demotion moment, then the Account XP panel with Aether and the rewards line), headed by the team: its
 * name and both teammates' portraits. Out of 4 teams. Match details opens the match stats; Continue closes the screen
 * onto the party, where the pair stays together for the next game.
 */
export function DuosResultOverlay() {
  const res = useVersus((s) => s.duosResult);
  const hasStats = useVersus((s) => s.lastMatch != null);
  if (!res) return null;
  const submission = res.unrated ? 'unrated' : res.result ? 'confirmed' : res.pending ? 'pending' : 'rejected';
  return (
    <div className="vsduosresult" role="dialog" aria-label="Ranked Duos result">
      <div className={`heroselect endscreen lobbyend rankend${res.placement === 1 ? ' won' : ''}`}>
        <div className="hsbox endbox">
          {res.teamName && <div className="vsduosresult-team hudpill-name">{res.teamName}</div>}
          <DuosResultTeam team={res.team} />
          <RankScreen
            placement={res.placement}
            seatCount={RANKED_DUOS_TEAM_COUNT}
            submission={submission}
            result={res.result}
            current={res.result?.after ?? null}
            error={submission === 'rejected' ? 'The team result is not in yet. It will show on the leaderboard.' : undefined}
            unratedReason={res.unrated ? 'No recorded teams' : undefined}
            runId={`duos:${res.matchId}`}
            onContinue={() => { sfx.pulse(); closeDuosResult(); }}
            // ACCOUNT XP waits its turn, as on the solo screen: not while the team's rank is still settling or celebrating.
            extra={(settled) => <ProgressionPostgame localKey={`versus:${res.matchId}`} active={settled && submission !== 'pending'} />}
            onMatchDetails={hasStats ? () => { sfx.tick(); setVersusStatsOpen(true); } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
