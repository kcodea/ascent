/**
 * THE POST-GAME SCREEN (owner 2026-11-27: "The post game screen needs a massive revamp, too. This should included rank and xp gains
 * ... the post game screen should then show all opponents and their boards, turns eliminated etc etc. all runes ancients and otherwise
 * should be shown ... It needs to look like a AAA experience.", then "I need a 10/10 post game screen. Remove extra fluffy text too").
 *
 * It stands at Terys Gate, where the journey brought the player (locationReveal/postGame.tsx), in TWO BEATS (owner pick):
 *  1. THE RESULT: a band of the result's light across the screen (gold a win, green the top four, red the rest), the placement slammed
 *     onto it, one word under it, then the rank and the Account XP side by side, and Continue / Lobby. The rank sequence is
 *     `RankScreen`'s (unchanged: retries, the scoring lock, promotion, the once-per-run marker), laid out by this screen's CSS.
 *  2. THE LOBBY: a scoreboard, one full-width row a seat in placement order: place, hero, name, final board, hero power and Ancient,
 *     runes, and how it ended. No sentences: the row says it.
 *
 * PERFORMANCE: the scoreboard's boards (up to 56 cards) mount one seat a frame, idle, once the journey has landed, under a hidden layer,
 * so the switch is a transform / opacity move only. Keyword FX on those boards show their still frames unless the row is pointed at
 * (styles.css). Every animation is one-shot transform / opacity; nothing loops.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ANCIENTS, getHero, type MatchDetails, type MatchSeat, type RunState } from '@game/sim';
import { ancientTextColor } from '../ancients/ancientsConfig';
import { RankScreen } from '../rank/RankScreen';
import { beginExitFade } from '../rank/exitFade';
import type { RankPosition, RankResult, RankSubmission } from '../rank/types';
import { ProgressionPostgame } from '../progression/ProgressionPostgame';
import { dropJourneyFrame, PostGameGround, postGameLocation, useJourneyFrame, usePostGameHeld } from '../locationReveal/postGame';
import { locationArt, locationName, resultBand, type ResultBand } from '../locationReveal/locations';
import { slideFor, stageHeight } from '../locationReveal/revealGl';
import { A } from '../locationReveal/revealTimeline';
import { SeatAncientBadge, SeatPower } from '../matchDetails/SeatPower';
import { placeLabel } from '../matchDetails/matchDetailsText';
import { StoredTeam } from '../StoredTeam';
import { RuneEmblem } from '../RuneEmblem';
import { RUNE_INDEX } from '@game/content';
import { internSnapshot, opponentSkins, useSkinEpoch } from '../skins/skins';
import { heroPortrait } from '../skins/skinArt';
import { useShowOpponentCosmetics } from '../cosmetics/opponentCosmetics';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import '../partyHome/shell/shell.css';
import '../partyHome/partyHome.css';
import '../partyHome/kit/kit.css';
import '../matchDetails/matchDetails.css';
import '../partyHome/pages/gamesPages.css';
import './postGame.css';

/** The result's word, by band (the same three colours as the journey). */
export const BAND_WORD: Readonly<Record<ResultBand, string>> = { won: 'Victory', top4: 'Top Four', lost: 'Eliminated' };

/** The placement as its two parts: the number and its suffix ("3" + "RD"). */
export function placeParts(place: number): { num: string; suf: string } {
  const tens = place % 100;
  const suf = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][place % 10] ?? 'th');
  return { num: String(place), suf: suf.toUpperCase() };
}

/** The placement drawn as the location reveal draws a name (cut Cinzel, a letter at a time): each glyph its own element, its index the
 *  delay it rises at (`--k`). */
function PlaceLetters({ place }: { place: number }) {
  const { num, suf } = placeParts(place);
  return (
    <>
      <span className="pg2-num">{[...num].map((c, i) => <i key={i} style={{ '--k': i } as CSSProperties}>{c}</i>)}</span>
      <span className="pg2-ord" style={{ '--k': num.length } as CSSProperties}>{suf}</span>
    </>
  );
}

/** How a seat's game ended, as the scoreboard's last column shows it: the winner's crown, "R9" for the round it went out, or its
 *  health when it was still standing as your game ended. */
export function seatOutcome(seat: Pick<MatchSeat, 'self' | 'placement' | 'eliminatedRound' | 'health' | 'armor'>, d: Pick<MatchDetails, 'eliminated' | 'endRound' | 'placement'>):
  { kind: 'won' } | { kind: 'out'; round: number } | { kind: 'in'; health: number; armor: number } {
  if (seat.self) {
    if (d.placement === 1 && !d.eliminated) return { kind: 'won' };
    return { kind: 'out', round: seat.eliminatedRound ?? d.endRound };
  }
  if (seat.placement === 1) return { kind: 'won' };
  if (seat.eliminatedRound !== undefined) return { kind: 'out', round: seat.eliminatedRound };
  return { kind: 'in', health: seat.health, armor: seat.armor };
}

export interface PostGameScreenProps {
  run: RunState;
  place: number;
  seatCount: number;
  practice: boolean;
  submission: RankSubmission;
  result: RankResult | null;
  current: RankPosition | null;
  error?: string;
  unratedReason?: string;
  runId: string;
  onRetry?: () => void;
  match: MatchDetails | null;
  scoring?: { done: number; total: number } | null;
  onContinue: () => void;
  onRewatch?: () => void;
}

/** How long the result (the rank's outcome, then the Account XP filling in) holds before the screen moves into the lobby. */
export const AUTO_LOBBY_MS = 4200;

/**
 * The backdrop framed EXACTLY as the journey left the place, so nothing jumps (or is seen twice) as the wave washes the results in:
 * the reveal's settled camera (revealShaders `at`: painting = VP - OFS + (screen - VP) * 0.962, the ground having no depth) on its
 * stage (the painting's height covering the screen, `stageHeight`, slid by `slideFor`). Returns the CSS background size and position
 * in px for a `w` x `h` screen.
 */
export function revealFrame(loc: { vp: readonly [number, number]; focus: readonly [number, number] }, w: number, h: number): { size: string; pos: string } {
  // The reveal is drawn in the gate's layer, 16 px past the screen on every side (`.lrev`), its stage centred on that.
  const gw = w + 32;
  const gh = h + 32;
  const H = stageHeight(gw, gh);
  const W = H * A;
  const [ox, oy] = slideFor(loc, gw, gh);
  const k = 0.962;
  const u0x = loc.vp[0] + (ox - loc.vp[0]) / k;
  const u0y = loc.vp[1] + (oy - loc.vp[1]) / k;
  const left = -16 + (gw - W) / 2 + u0x * W;
  const top = -16 + (gh - H) / 2 + u0y * H;
  return { size: `${(W / k).toFixed(1)}px ${(H / k).toFixed(1)}px`, pos: `${left.toFixed(1)}px ${top.toFixed(1)}px` };
}

/** React 18 has no `inert` prop: the attribute itself, for the beat that is out of sight (nothing in it can be focused or clicked). */
const inertIf = (on: boolean): Record<string, string> => (on ? { inert: '' } : {});

const prefersReduced = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function PostGameScreen(p: PostGameScreenProps): JSX.Element {
  const band = resultBand(p.place);
  const at = postGameLocation(p.run);
  const ground = useMemo(() => (at ? <PostGameGround key={at.id} location={at} /> : null), [at]);
  const [beat, setBeat] = useState<'result' | 'lobby'>('result');
  const [leaving, setLeaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const held = usePostGameHeld();
  // The journey's own last frame (the full version), else the painting framed as the reveal frames it (`revealFrame`).
  const journey = useJourneyFrame();
  useEffect(() => () => dropJourneyFrame(), []);
  // The backdrop's framing follows the screen's shape (`framePosition`).
  const [frame, setFrame] = useState<{ size: string; pos: string }>({ size: 'cover', pos: '50% 50%' });
  useLayoutEffect(() => {
    if (!at) return undefined;
    const measure = (): void => { const el = rootRef.current; if (el && el.clientWidth) setFrame(revealFrame(at, el.clientWidth, el.clientHeight)); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [at]);
  // The sharp picture is decoded while the journey plays (the screen is mounted behind the doors), so the wash lands on it whole.
  useEffect(() => {
    if (!at) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = locationArt(at.id, 'full');
    img.decode?.().catch(() => { /* it paints when it arrives */ });
  }, [at]);
  // The scoreboard mounts behind the result, a seat a frame, once the journey has arrived (nothing competes with the wave).
  const mounted = useStagger(p.match?.seats.length ?? 0, !held);

  // THE ORDER (owner 2026-11-27: "show the ranked gain/loss ... Then show experience / account related gains after that, then Into the
  // post game rows"): the rank plays (RankScreen), the Account XP after it (its `extra`), then the screen moves into the lobby by itself,
  // once. Any press of the player's own takes over (`moved`).
  const [rankShown, setRankShown] = useState(false);
  const moved = useRef(false);
  const toLobby = useCallback(() => { moved.current = true; sfx.tick(); setBeat('lobby'); }, []);
  const toResult = useCallback(() => { moved.current = true; sfx.tick(); setBeat('result'); }, []);
  const ready = !held && !!p.match && (p.submission === 'pending' ? false : p.submission === 'confirmed' ? rankShown : true);
  useEffect(() => {
    if (!ready || moved.current || leaving) return undefined;
    const id = window.setTimeout(() => { if (!moved.current) { moved.current = true; setBeat('lobby'); } }, AUTO_LOBBY_MS);
    return () => window.clearTimeout(id);
  }, [ready, leaving]);
  // Continue from the lobby beat: the same cross-fade into the main menu as the result's own Continue (rank/exitFade.ts).
  const leave = useCallback(() => {
    if (leaving || p.scoring) return;
    setLeaving(true);
    const overlay = rootRef.current;
    if (overlay) beginExitFade(overlay, prefersReduced());
    p.onContinue();
  }, [leaving, p]);
  // Esc on the lobby beat goes back to the result.
  useEffect(() => {
    if (beat !== 'lobby') return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toResult(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [beat, toResult]);

  return (
    <div ref={rootRef} className={`heroselect endscreen lobbyend rankend pg2 ph-tokens band-${band}${at ? ' at-place' : ''}${held ? '' : ' arrived'}${beat === 'lobby' ? ' on-lobby' : ''}`}>
      {ground}
      {/* THE PLACE ITSELF, sharp (owner 2026-11-27: "Have the ranked progress and experience from the game all happen on top of that
          art, then go from there to the post game rows"): the picture the journey landed on, still drifting, and its name where the
          journey left it. The lobby steps back onto the blurred ground. */}
      {at && (journey
        ? <JourneyFrame frame={journey} />
        : <div className="pg2-sharp" aria-hidden="true" style={{ backgroundImage: `url(${locationArt(at.id, 'full')})`, backgroundSize: frame.size, backgroundPosition: frame.pos }} />)}
      {at && <div className="pg2-placename" aria-hidden="true">{[...locationName(at)].map((c, i) => <i key={i}>{c}</i>)}</div>}
      <div className="pg2-vignette" aria-hidden="true" />
      <div className="pg2-result" aria-hidden={beat === 'lobby'} {...inertIf(beat === 'lobby')}>
        <div className="pg2-band" aria-hidden="true"><b className="pg2-rays" /><i className="pg2-bloom" /><em className="pg2-flare" /></div>
        <div className="hsbox endbox">
          <RankScreen
            placement={p.place}
            seatCount={p.seatCount}
            submission={p.submission}
            result={p.result}
            current={p.current}
            error={p.error}
            unratedReason={p.unratedReason}
            runId={p.runId}
            onContinue={p.onContinue}
            onRetry={p.onRetry}
            extra={(settled) => <ProgressionPostgame localKey={String(p.run.seed)} active={settled && (p.practice || p.submission !== 'pending')} />}
            onMatchDetails={p.match ? toLobby : undefined}
            detailsLabel="Lobby"
            continueClassName="ph-start"
            headline={<div className="pg2-word"><span>{BAND_WORD[band]}</span></div>}
            placeText={<PlaceLetters place={p.place} />}
            onSettled={() => setRankShown(true)}
            scoring={p.scoring}
          />
        </div>
      </div>
      {p.match && (
        <section className="pg2-lobby" aria-hidden={beat !== 'lobby'} {...inertIf(beat !== 'lobby')} aria-label="Lobby">
          <header className="pg2-lbar">
            <button type="button" className="pg2-back" onClick={toResult} aria-label="Back to your result"><Icon name="chevron" /></button>
            <div className="pg2-lacts">
              {p.onRewatch && <button type="button" className="phk-btn v-plate s-l" onClick={p.onRewatch} disabled={leaving}><span>Rewatch</span></button>}
              <button type="button" className={`ph-start pg2-lcontinue${p.scoring ? ' scoring' : ''}`} onClick={leave} disabled={leaving || !!p.scoring}><span>Continue</span></button>
            </div>
          </header>
          <Scoreboard details={p.match} mounted={mounted} />
        </section>
      )}
    </div>
  );
}

/** The journey's last frame, exactly where it was on screen (the reveal's canvas is centred, `stageH` tall), drifting on slowly. */
function JourneyFrame({ frame }: { frame: { canvas: HTMLCanvasElement; w: number; h: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const c = frame.canvas;
    c.className = 'pg2-frame';
    c.style.width = `${frame.w}px`;
    c.style.height = `${frame.h}px`;
    host.appendChild(c);
    return () => { c.remove(); };
  }, [frame]);
  return <div className="pg2-sharp pg2-sharp-frame" ref={ref} aria-hidden="true" />;
}

/** Mount `n` items one a frame (idle when the browser offers it) once `go` is true. */
function useStagger(n: number, go: boolean): number {
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!go || k >= n) return undefined;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setK((v) => v + 1), { timeout: 120 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setK((v) => v + 1), 16);
    return () => window.clearTimeout(id);
  }, [go, k, n]);
  return k;
}

/** The scoreboard: every seat in placement order, one row each. */
function Scoreboard({ details, mounted }: { details: MatchDetails; mounted: number }) {
  useSkinEpoch();
  const showOpponents = useShowOpponentCosmetics();
  return (
    <div className="pg2-board">
      <div className="pg2-heads" aria-hidden="true">
        <span className="h-player">Player</span><span className="h-power">Power</span><span className="h-anc">Ancient</span>
        <span className="h-runes">Runes</span><span className="h-team">Final board</span><span className="h-end">Result</span>
      </div>
      <div className="pg2-rows" role="list">
      {details.seats.map((seat, i) => (
        <SeatRow key={seat.id} seat={seat} details={details} index={i} live={i < mounted}
          skins={internSnapshot(seat.self ? seat.cosmetics ?? null : opponentSkins(showOpponents, seat.cosmetics))} />
      ))}
      </div>
    </div>
  );
}

const bandOf = (seat: MatchSeat, d: MatchDetails): ResultBand | 'in' => {
  const pl = seat.self ? d.placement : seat.placement;
  return pl === undefined ? 'in' : resultBand(pl);
};

/** The place in its cell: "3" with a small "rd". A seat still standing when your game ended has no place yet: a dash. */
function PlaceMark({ place }: { place: string }) {
  if (/^Top \d+$/.test(place) || !place) return <div className="pg2-place open"><span>–</span></div>;
  const m = /^(\d+)(st|nd|rd|th)$/.exec(place);
  return <div className="pg2-place">{m ? <><span>{m[1]}</span><i>{m[2]}</i></> : <span>{place || '?'}</span>}</div>;
}

/** One seat: place, hero, name, board, hero power + Ancient, runes, how it ended. */
const SeatRow = memo(function SeatRow({ seat, details, index, live, skins }: {
  seat: MatchSeat; details: MatchDetails; index: number; live: boolean; skins: ReturnType<typeof internSnapshot>;
}) {
  const heroName = seat.heroId ? getHero(seat.heroId).name : '';
  const place = placeLabel(seat, details);
  const killer = seat.id === details.knockedOutBy;
  const outcome = seatOutcome(seat, details);
  const runes = (seat.board?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  const art = heroPortrait(seat.heroId, skins);
  const anc = seat.ancient && ANCIENTS[seat.ancient.id] ? seat.ancient : null;
  const said = outcome.kind === 'won' ? 'Winner' : outcome.kind === 'out' ? `Out in round ${outcome.round}` : `Still in, ${outcome.health} health`;
  return (
    <article role="listitem" className={`pg2-row band-${bandOf(seat, details)}${seat.self ? ' self' : ''}${killer ? ' killer' : ''}`} style={{ '--i': index } as CSSProperties}
      aria-label={`${place ? `${place}. ` : ''}${seat.name}${seat.self ? ' (you)' : ''}, ${heroName}. ${said}.${killer ? ' Knocked you out.' : ''}`}>
      <PlaceMark place={place} />
      <div className="pg2-face">
        {art && <img src={art} alt="" decoding="sync" draggable={false} />}
        {killer && <span className="pg2-killmark" aria-hidden="true"><Icon name="sword" /></span>}
      </div>
      <div className="pg2-names">
        <span className="pg2-name">{seat.name}</span>
        <span className="pg2-heroname">{heroName}</span>
      </div>
      <div className="pg2-power"><SeatPower heroId={seat.heroId} ancient={seat.ancient} who={seat.self ? 'Your' : `${seat.name}'s`} /></div>
      {/* THE PICKS (owner 2026-11-27: "Post game rows should show runes and ancient selections as well"): the Ancient picked, in the
          hero power frame the lobby tiles use (R-LOBBY-TILE-ANCIENT-01), named; then every rune owned (hover: its text, final value). */}
      <div className="pg2-anc">
        {anc && <><SeatAncientBadge ancient={anc} /><span className="pg2-anc-name" style={{ color: ancientTextColor(anc.id) }}>{ANCIENTS[anc.id].name.replace(/^Ancient of /, '')}</span></>}
      </div>
      <div className="pg2-runes" aria-label="Runes">
        {runes.map((id, i) => <RuneEmblem runeId={id} live={seat.board?.runeLive} key={`${id}#${i}`} />)}
      </div>
      <div className="pg2-team">
        {live && seat.board && seat.board.minions.length > 0 && <StoredTeam minions={seat.board.minions} skins={skins} label={`${seat.name}'s board`} compact />}
      </div>
      <div className={`pg2-end ${outcome.kind}`} aria-hidden="true">
        {outcome.kind === 'won' && <Icon name="crown" />}
        {outcome.kind === 'out' && <><small>Out</small><b>R{outcome.round}</b></>}
        {outcome.kind === 'in' && <><Icon name="heart" /><b>{outcome.health}</b></>}
      </div>
    </article>
  );
});
