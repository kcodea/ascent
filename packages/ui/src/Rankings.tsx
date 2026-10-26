import { useEffect, useRef, useState } from 'react';
import { getHero } from '@game/sim';
import type { RunCosmeticSnapshot } from '@game/progression';
import { Icon } from './Icon';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { useGame, displayHandle } from './store';
import { peekSocial, putSocial, useSocial } from './socialCache';
import { fetchTopPlayers, remoteEnabled, type PlayerRow } from './remoteBoards';
import { TitleBadge } from './titles/TitleBadge';
import { LbHeroFrame, LbMedallion } from './LadderBits';
import { RankBar } from './rank/RankBar';
import { compareRankDesc, rankPositionOf, type RankPosition } from './rank/types';
import { useCurrentRank } from './rank/rankSource';
import { avatarSrc } from './art';
import { scalarCaption } from './rank/rankFormat';
import { fetchPortraitLoadouts } from './progression/progressionRemote';
import { frameIdOf } from './portraitFrame/PortraitFrame';
import { heroPortrait, opponentSkins, useLiveLoadout } from './skins/skins';
import { DuosLeaderboard, DUOS_ROWS } from './versus/DuosBoards';
import { versusEnabled } from './versus/versusFlag';

/**
 * Rankings — the player LEADERBOARD (owner request 2026-07-13; polished 2026-09-20 to the Career page's
 * standard; row re-laid 2026-09-20 — owner: "the row is mostly empty"): the top players by skill rating (the
 * "MMR") as a chunky ranked table — a large podium medallion for the top 3 (a plain numeral beyond), the
 * circular hero frame at portrait size, the handle large with the favourite hero under it, the rating as the
 * big gold number in its own column, games played as a labelled value, then the actions: CAREER PAGE (the
 * primary — opens that player's Career, the same thing the row itself does) and WATCH (secondary — plays
 * their latest recorded run). The former "latest board" tile strip and its two-step telemetry read are gone.
 * Your own row is highlighted and scrolled into view once the list lands. Read from the shared `profiles`
 * table (`fetchTopPlayers`); best-effort — empty until the backend is configured. Distinct from the Hall of
 * Champions (victory runs).
 *
 * COORDINATION NOTE: the rating cell is ONE element (`.lb-c-rating`, aliased `.rk-rating`) so the rank-screen
 * work can slot a medal crest into it without re-laying the row.
 *
 * THE MMR COLUMN (owner 2026-10-09: "add the player MMR as a column"): once the table carries medal ranks the
 * rating cell is the crest + bar, which hides the number, so the row's MMR (`rating`, the reporting scalar
 * `100 × division + points`) gets its OWN column between Rank and Games. A legacy table (no ranks at all) keeps
 * its five columns: the Rating cell there already IS the MMR, so a second column would only repeat it.
 */
export const RANKED_ROWS = 10;

/** A row's medal rank, when the profile row carries one (post-migration) — else null (legacy MMR). */
const rankOfRow = (r: PlayerRow): RankPosition | null => rankPositionOf(r.rank);

/** MEDAL RANK ordering (blueprint §8): division first, then points — ranked rows ahead of legacy-only rows,
 *  which keep their server order (rating desc). A list with no ranks at all is returned untouched. */
export function sortRankAware(rows: PlayerRow[]): PlayerRow[] {
  if (!rows.some((r) => rankOfRow(r))) return rows;
  return rows
    .map((r, i) => ({ r, i, rank: rankOfRow(r) }))
    .sort((a, b) => {
      if (a.rank && b.rank) return compareRankDesc(a.rank, b.rank) || a.i - b.i;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** A ladder row plus the player's equipped hero skins + portrait frame (`cosmetic_loadouts`), read after the rows land. */
export type RankedRow = PlayerRow & { skins?: RunCosmeticSnapshot };

/** The Leaderboard's cache key + loader (shared with the title's idle prefetch). The rows are published as soon as
 *  they land (keeping the skins the cached rows already had, so a refresh never flashes default art), then the
 *  equipped hero skins and portrait frames for those ten players follow in ONE read. */
export const RANKINGS_KEY = 'rankings';
export const loadRankings = async (): Promise<RankedRow[]> => {
  const rows: RankedRow[] = sortRankAware(await fetchTopPlayers(RANKED_ROWS));
  if (rows.length === 0) return rows;
  const prev = new Map((peekSocial<RankedRow[]>(RANKINGS_KEY)?.data ?? []).map((r) => [r.userId, r.skins] as const));
  putSocial(RANKINGS_KEY, rows.map((r) => (prev.get(r.userId) ? { ...r, skins: prev.get(r.userId) } : r)));
  const skins = await fetchPortraitLoadouts(rows.map((r) => r.userId));
  return rows.map((r) => {
    const s = skins.get(r.userId);
    return s ? { ...r, skins: s } : r;
  });
};

export function Rankings() {
  const show = useGame((s) => s.showRankings);
  const myId = useGame((s) => s.account.userId);
  const myName = useGame((s) => s.playerName);
  const myDisc = useGame((s) => s.account.discriminator);
  const myRank = useCurrentRank();
  const myAvatar = useGame((s) => s.playerAvatar);
  const showOppCosmetics = useGame((s) => s.showOpponentSkins); // other players' titles ride the same switch
  const openCareer = useGame((s) => s.openCareer);
  // Cached across opens (socialCache.ts): a revisit paints the last ladder at once and refreshes behind it.
  const rows = useSocial<RankedRow[]>(show ? RANKINGS_KEY : null, loadRankings) ?? null;
  // YOUR row wears your live loadout (always current, never filtered); everyone else's through "Show opponent skins".
  const myLoadout = useLiveLoadout();
  const mineRef = useRef<HTMLDivElement | null>(null);
  // RANKED DUOS (owner 2026-10-26, Q5): Solo players | Duos teams (the Career's tab style).
  const [board, setBoard] = useState<'solo' | 'duos'>('solo');
  const duosTab = versusEnabled() && board === 'duos';

  // Bring YOUR row into view once the list has painted — one scroll, not a per-frame read.
  useEffect(() => {
    if (!rows || !mineRef.current) return;
    mineRef.current.scrollIntoView({ block: 'nearest' }); // nearest: a podium row is already in view; a row below scrolls up just enough
  }, [rows]);

  if (!show) return null;

  // Medal ranks on the table → the rating cell is the crest + bar, and the MMR number gets its own column.
  const ranked = !!rows?.some((r) => rankOfRow(r));


  const renderRow = (r: RankedRow, i: number): JSX.Element => {
    const hero = r.favoriteHero ? getHero(r.favoriteHero) : null;
    const handle = displayHandle(r.author, r.discriminator, r.userId);
    const rowRank = rankOfRow(r);
    // Match the player by their real identity (`user_id`), NOT the display name — two accounts can
    // share a name (that's what the `#tag` disambiguates), and matching by name lit up every row of
    // duplicates as "YOU" (owner report 2026-08-10).
    const mine = !!myId && r.userId === myId;
    // Another player's equipped cosmetics (skin + frame), through "Show opponent cosmetics".
    const theirs = mine ? null : opponentSkins(showOppCosmetics, r.skins);
    // The row OPENS THEIR CAREER. Rankings stays mounted underneath, so Back returns here rather
    // than to the title — the Career overlay renders after it and simply covers it. The row's medal
    // rank rides along (when the backend carries one) so the Seasonal Ranked card there paints the
    // SAME crest + bar this row shows, at once, instead of a bare rating number (owner 2026-09-21).
    const openTheirs = (): void => {
      // Silent (owner 2026-10-16: Leaderboard row clicks make no blip).
      openCareer({ userId: r.userId, author: r.author, rating: r.rating, gamesPlayed: r.gamesPlayed, favoriteHero: r.favoriteHero, ...(r.rank ? { rank: r.rank } : {}), ...(r.avatar ? { avatar: r.avatar } : {}) });
    };
    // A div[role=button], not a <button> — the row nests its action buttons and a button can't nest a button.
    return (
      <div
        role="button"
        tabIndex={0}
        className={`lb-trow lb-trow-btn${mine ? ' me' : ''}`}
        key={r.userId || r.author}
        ref={mine ? mineRef : undefined}
        onClick={openTheirs}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openTheirs(); }}
        aria-label={`View ${handle}'s career`}
      >
        <span className="lb-c-rank"><LbMedallion rank={i + 1} /></span>
        <span className="lb-c-player">
          {/* The portrait: the player's equipped skin for that hero (owner 2026-10-12) in their equipped PORTRAIT
              FRAME (owner 2026-10-16: "the player frames they have equipped arent showing here and they should").
              Your row reads your live frame (`frameId` undefined on the self side); everyone else's comes from
              their loadout through "Show opponent cosmetics". The RANK ring is a different thing: it goes on the
              RANK column's crest (RankCrest). */}
          {/* The PLAYER's chosen profile picture (owner 2026-10-16), yours always, theirs through "Show opponent cosmetics";
              with none chosen (or before the profiles.avatar migration), their favourite hero in its skin as before. */}
          <LbHeroFrame heroId={r.favoriteHero} side={mine ? 'self' : 'opp'} art={(mine ? avatarSrc(myAvatar ?? r.avatar ?? null) : showOppCosmetics ? avatarSrc(r.avatar ?? null) : undefined) ?? heroPortrait(r.favoriteHero, mine ? (myLoadout ?? r.skins) : theirs)} frameId={mine ? undefined : frameIdOf(theirs)} />
          <span className="lb-who">
            <span className="lb-handle">{handle}{mine && <span className="lb-you">you</span>}<TitleBadge id={mine || showOppCosmetics ? r.equippedTitleId : null} className="lb-handle-title" /></span>
            <span className="lb-herosub">{hero ? hero.name : 'No favorite hero yet'}</span>
          </span>
        </span>
        <span className="lb-c-rating rk-rating">
          {rowRank
            ? <RankBar position={rowRank} size="row" showGate={false} />
            : ranked
              ? <span className="lb-unranked">Unranked</span> // the MMR column beside it carries the number
              : <><span className="lb-rating">{r.rating}</span><span className="lb-unit">MMR</span></>}
        </span>
        {ranked && <span className="lb-c-mmr"><span className="lb-num lb-mmr">{r.rating}</span><span className="lb-unit">MMR</span></span>}
        <span className="lb-c-games"><span className="lb-num">{r.gamesPlayed}</span><span className="lb-unit">played</span></span>
        {/* No buttons (owner 2026-10-16: "the big CAREER PAGE + WATCH buttons on every row are heavy"): the whole row opens
            the Career. Watch-live waits on live rows carrying a user id (they carry only a display name today, and
            matching players by name is banned), so no Watch is shown rather than a guess. */}
        <span className="lb-c-act" aria-hidden="true"><span className="lb-row-go">›</span></span>
      </div>
    );
  };

  // THE PODIUM (UI refinement WS-5, 2026-10-16): the top three stand as large cards across the top (2nd, 1st, 3rd),
  // the rest form a tighter table under them. Same rows, same cells, just laid out as cards (styles.css .lb-podium).
  const podium = !!rows && rows.length >= 3;
  const restFrom = podium ? 3 : 0;
  const rest = rows ? rows.slice(restFrom) : [];
  // YOUR STANDING, pinned to the foot of the view when you are not on the board (your row, when you are on it,
  // pins itself to the foot while it is scrolled below the view: `position: sticky` in styles.css, no JS).
  const meOnBoard = !!rows && !!myId && rows.some((r) => r.userId === myId);
  const pin = rows && rows.length > 0 && !meOnBoard && myRank ? (
    <div className="lb-mepin" role="note" aria-label="Your standing">
      <span className="lb-mepin-you">You</span>
      <span className="lb-mepin-name">{displayHandle(myName, myDisc, myId)}</span>
      <span className="lb-mepin-rank"><RankBar position={myRank} size="row" showGate={false} /></span>
      <span className="lb-mepin-mmr"><span className="lb-num lb-mmr">{scalarCaption(myRank)}</span><span className="lb-unit">MMR</span></span>
      <span className="lb-mepin-note">Outside the top {RANKED_ROWS}</span>
    </div>
  ) : null;

  return (
    <SidebarHost className="lbpage rankpage lb-ladder">
      <MenuSidebar current="rankings" />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Leaderboard</div>
            <div className="lbsub">{duosTab ? `Top ${DUOS_ROWS} Ranked Duos teams` : `Top ${RANKED_ROWS} players by MMR`}</div>
          </div>
        </div>
        {versusEnabled() && (
          <div className="cv2-tabs lb-boardtabs" role="tablist" aria-label="Leaderboard">
            <button type="button" role="tab" className={`cv2-tab${board === 'solo' ? ' on' : ''}`} aria-selected={board === 'solo'} onClick={() => setBoard('solo')}>
              <Icon name="crown" />Solo
            </button>
            <button type="button" role="tab" className={`cv2-tab${board === 'duos' ? ' on' : ''}`} aria-selected={board === 'duos'} onClick={() => setBoard('duos')}>
              <Icon name="shield" />Duos
            </button>
          </div>
        )}
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Leaderboard unavailable. No backend configured.</div></div>
        ) : duosTab ? (
          <DuosLeaderboard show={show} myId={myId ?? null} />
        ) : rows === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Summoning the ladder…</div></div>
        ) : rows.length === 0 ? (
          <div className="lbempty lb-state"><Icon name="crown" /><div>No ranked players yet. Finish a run to claim a slot.</div></div>
        ) : (
          <div className={`lb-panel lb-table${ranked ? ' lb-has-mmr' : ''}`} role="table" aria-label="Top players by rating">
            {podium && (
              <div className="lb-podium" role="rowgroup" aria-label="Top three">{rows.slice(0, 3).map((r, i) => renderRow(r, i))}</div>
            )}
            {/* The column header always exists (it names the cells for assistive tech); it is only hidden when the
                podium holds every row and there is no table under it. */}
            {(
            <div className={`lb-trow lb-thead${rest.length === 0 ? ' lb-thead-idle' : ''}`} role="row">
              <span className="lb-c-rank">#</span>
              <span className="lb-c-player">Player</span>
              <span className="lb-c-rating">{ranked ? 'Rank' : 'MMR'}</span>
              {ranked && <span className="lb-c-mmr">MMR</span>}
              <span className="lb-c-games">Games</span>
              <span className="lb-c-act" />
            </div>
            )}
            {rest.map((r, j) => renderRow(r, j + restFrom))}
            {pin}
          </div>
        )}
      </div>
    </SidebarHost>
  );
}
