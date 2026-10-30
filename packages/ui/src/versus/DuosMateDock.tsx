/**
 * VERSUS DUOS — THE TEAMMATE PORTRAIT, BOTTOM RIGHT (owner 2026-10-25: "i think we should have our teammate's hero
 * portrait in the bottom right area which is how we should pass and click their portrait to view their board, then our
 * portrait is in the bottom right to click on to return to our board"). R-DUOS-VIEW-01, R-DUOS-PASS-01, R-DUOS-VIEW-03.
 *
 * THE MIRROR OF YOUR OWN HERO bottom left (owner 2026-10-25: "can you make the teammate portrait as large as the
 * player's and make sure it's wired to show their custom frame as well if they have one"): the same disc size, the same
 * distance in from the stage's right edge (measured off your own portrait, `mirrorOfHero`, so the two can never drift
 * apart), the same frame surface wearing THEIR equipped portrait frame, the same name pill eclipsing the disc's bottom.
 * CLEAR OF THE LOBBY RAIL, NO HEALTH BOX (owner 2026-10-26: "the teammate is behind the lobby rail, so we need to modify
 * the size/position of that a bit. we dont need the health there since we have it under the player frame and it's the
 * same"; R-DUOS-VIEW-05): the team's pool shows only under your own hero; the disc drops into the room that box took
 * (its bottom on your Health box's bottom) and shrinks, only as far as it must, to sit below the rail (`fitDock`; the
 * eight-row Ranked Duos rail is the tall case).
 * THE TAG-IN (owner 2026-10-26: "the player frame doesn't need to swap to the teammate's when they come in to attack. we
 * can fade out their frame from the bottom right, and fade it in eclipsing the player hero in the bottom left";
 * R-DUOS-SLOTS-02): while your teammate's board fights on your side, this portrait fades out bottom right and its copy
 * fades in over your own hero, a little up and to the right, then goes back when your own board steps in or the fight
 * ends. Your hero slot itself never changes. Opacity / transform only, one-shot.
 *  - on your board it is your TEAMMATE: click it to watch their screen; drag a card onto it to pass the card. While a
 *    drag hovers it the disc glows teal (a STATIC shadow on its own layer whose opacity breathes, the `kwglow` pattern:
 *    no animated paint); a refused pass shows a red ring and the reason instead;
 *  - while you watch them it is YOU: click or tap anywhere on it (cap, disc or name) to come back to your board. With
 *    no plate up top (owner 2026-10-25) it is the only on-screen way back (Esc and letting go of Tab work too).
 * A pass drops INTO this disc (`passLob.playDrop`), and a pass to you rises OUT of it (`playArrival`).
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { parseCosmeticSnapshot } from '@game/progression';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { frameIdOf, usePortraitFrame } from '../portraitFrame/PortraitFrame';
import { ensureDefsReady, playDef } from '../fx/playDef';
import { useDragSlice } from '../dragStore';
import { useGame } from '../store';
import { heroPortrait } from '../skins/skinArt';
import { opponentSkins } from '../skins/skins';
import { stageHost, toStage } from '../stage';
import { useDuosPassNote } from './duosPassUi';
import { prewarmPassFx } from './passLob';
import { enterTeammateView, exitTeammateView } from './teammateView';
import { useVersus } from './versusStore';
import { PING_MATE } from '../pings/pingKeys';
import { useSpectate } from './spectate';
import { useDuosCombat } from './duosCombat';
import { useOwnHeroPick } from '../hero-select/ownHeroPick';
import { avatarSrc } from '../art';
import './duosMateSignals.css';
import { mateWorking, useDuosMateSignals } from './duosMateSignals';

/** The tier-up burst over the teammate disc, as a share of the player's own (`shop-tier-up` is authored for the Tier
 *  stone; the disc is about the same size, the burst a touch smaller so it reads as theirs, not mine). */
export const DOCK_TIER_FX_SCALE = 0.85;

/** A tap's own release swaps; the browser's click that follows it within this window is the same gesture. */
const TAP_CLICK_MS = 700;
let lastTap = -Infinity;

/** Where the dock sits: its disc's diameter and its distance in from the stage's right and bottom edges (stage px), plus
 *  your own hero disc (left / bottom / diameter, stage px), where the tag-in copy lands. */
export interface DockGeometry { d: number; right: number; bottom: number; hero?: { left: number; bottom: number; d: number } }

type Box = { left: number; top: number; width: number; height: number };
/** The "Teammate" cap rides above the disc: its overhang as a share of your hero disc (28u over the 252u panel disc). */
export const DOCK_CAP_SHARE = 28 / 252;
/** The smallest the dock may shrink to clear the rail, as a share of your hero disc. */
export const DOCK_MIN_SHARE = 0.55;
/** The gap kept between the rail's bottom and the top of the dock's cap (stage px). */
export const DOCK_RAIL_GAP = 10;

/**
 * CLEAR OF THE RAIL (pure; owner 2026-10-26, R-DUOS-VIEW-05). From your hero disc's mirror (`mirrorOfHero`): no Health box
 * under the teammate, so the disc's bottom sits where YOUR Health box's bottom is (`hpBox`), and the disc shrinks, keeping
 * its centre, only as far as it must for its cap to clear the lobby rail's bottom (`rail`), never below
 * `DOCK_MIN_SHARE` of your own. All boxes in screen px; `stageLen` converts to stage px. Null when the hero is not laid out.
 */
export function fitDock(hero: Box | null, hpBox: Box | null, rail: Box | null, stage: Box, stageLen: (px: number) => number): DockGeometry | null {
  const base = mirrorOfHero(hero, stage, stageLen);
  if (!base || !hero) return null;
  const stageH = stageLen(stage.height);
  const bottom = hpBox && hpBox.height > 0 ? Math.max(0, stageLen(stage.top + stage.height - (hpBox.top + hpBox.height))) : base.bottom;
  const cap = base.d * DOCK_CAP_SHARE;
  let d = base.d;
  if (rail && rail.height > 0) {
    const room = stageH - bottom - cap - stageLen(rail.top + rail.height - stage.top) - DOCK_RAIL_GAP;
    d = Math.max(base.d * DOCK_MIN_SHARE, Math.min(base.d, room));
  }
  return {
    d, right: base.right + (base.d - d) / 2, bottom,
    hero: { left: stageLen(hero.left - stage.left), bottom: stageLen(stage.top + stage.height - (hero.top + hero.height)), d: base.d },
  };
}

/**
 * YOUR OWN PORTRAIT, MIRRORED (pure): the hero disc's box and the stage's box (both screen px, plus the stage scale
 * `toStage`) give the teammate disc the same diameter and the same distance in from the right edge that yours has from
 * the left, at the same height. Null when the hero portrait is not laid out.
 */
export function mirrorOfHero(
  hero: { left: number; top: number; width: number; height: number } | null,
  stage: { left: number; top: number; width: number; height: number },
  stageLen: (px: number) => number,
): DockGeometry | null {
  if (!hero || !(hero.width > 0) || !(stage.width > 0)) return null;
  return {
    d: stageLen(hero.width),
    right: stageLen(hero.left - stage.left),
    bottom: stageLen(stage.top + stage.height - (hero.top + hero.height)),
  };
}

/** The lobby rail on screen (null when there is none). */
const railEl = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.lobbyrail'));

/** Measures your own hero disc, your Health box and the lobby rail (layout reads on mount, on a resize and when the rail
 *  changes size; never per frame). */
function measureDock(): DockGeometry | null {
  if (typeof document === 'undefined') return null;
  const art = document.querySelector<HTMLElement>('.statusbar .hero .heroimg') ?? document.querySelector<HTMLElement>('.statusbar .hero .f');
  const hp = document.querySelector<HTMLElement>('.statusbar .hero .hpbox');
  return fitDock(art?.getBoundingClientRect() ?? null, hp?.getBoundingClientRect() ?? null, railEl()?.getBoundingClientRect() ?? null, stageBox(stageHost().getBoundingClientRect()), toStage);
}

/**
 * THE STAGE'S BOX, ALWAYS A BOX (R-VERSUS-RELIABLE-06; found on the bench prod build 2026-10-27: the dock's inline style
 * stayed empty in shop and fight, so it sat at its CSS fallback and the tag-in copy never mounted). At the design size
 * and above the stage is not scaled and `#stage` is `display: contents`, which has NO box: its rect is all zeros, and
 * `mirrorOfHero` (rightly) refuses a zero-width stage, so no geometry was ever produced on a full-size window. An
 * unscaled stage IS the viewport (its origin is the window's top-left, no transform), so its box is the window's.
 */
export function stageBox(rect: Box, win: { w: number; h: number } = typeof window === 'undefined' ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight }): Box {
  return rect.width > 0 && rect.height > 0 ? rect : { left: 0, top: 0, width: win.w, height: win.h };
}

/**
 * `heroSelect` (owner 2026-10-26: "there should be teammate portrait in the bottom right, like it is in game, but have the
 * player's portrait to be clickable and view the hero options so they can work together on who to pick";
 * R-DUOS-HEROSELECT-01): the same dock on Hero Select. Click it to see your teammate's hero choices; while you look, it is
 * YOU, and clicking it brings you back to your own. The face is the hero picked so far (theirs from their screen, mine
 * from mine), else the player's profile picture. No passing there (no hand yet).
 */
export const DuosMateDock = memo(function DuosMateDock({ watching, inCombat = false, heroSelect = false }: { watching: boolean; inCombat?: boolean; heroSelect?: boolean }): JSX.Element | null {
  // Hero Select: the heroes picked so far (the seat rows carry a hero only once every pick is in).
  const matePick = useSpectate((s) => (heroSelect ? s.matePick ?? null : null));
  const myPick = useOwnHeroPick((s) => (heroSelect ? s.heroId : null));
  // Whose face: my teammate on my board, me while I watch them. One primitive key, so the dock only re-renders when
  // the face, its name or its cosmetics change.
  const key = useVersus((s) => {
    const g = s.match?.group;
    const d = g?.duos;
    if (!g?.me || !d) return null;
    const seat = watching ? g.me : d.mate;
    const row = g.raw.seats.find((x) => x.seat === seat);
    if (!row) return null;
    const profile = s.room?.members.find((m) => m.userId === row.userId)?.profile;
    const cos = profile?.cosmetics ?? null;
    const hero = heroSelect ? (watching ? myPick : matePick) : row.hero;
    const avatar = heroSelect && !hero && typeof profile?.avatar === 'string' ? profile.avatar : null;
    return JSON.stringify([hero, row.name, cos ?? null, avatar]);
  });
  // My teammate dropped out (their board plays on auto): the portrait says so before any drag.
  const away = useVersus((s) => {
    const g = s.match?.group;
    if (watching || !g?.duos) return false;
    const row = g.raw.seats.find((x) => x.seat === g.duos!.mate);
    return !!row?.auto || (!!g.raw.paused_at && g.raw.paused_seat === g.duos.mate);
  });
  const showOppSkins = useGame((s) => s.showOpponentSkins);
  const passOver = useDragSlice((st) => (watching || inCombat || heroSelect ? null : st.passOver), Object.is);
  const passReason = useDragSlice((st) => (watching || inCombat || heroSelect ? null : st.passReason), Object.is);
  const note = useDuosPassNote((st) => (watching || heroSelect || !st.text ? null : `${st.n}|${st.text}`));
  // THE TAG-IN (R-DUOS-SLOTS-02): my teammate's board is fighting on my side right now.
  const tagged = useDuosCombat((st) => inCombat && !watching && !heroSelect && st.on && !!st.selfSeatId);
  // MY TEAMMATE'S SIGNALS (owner 2026-10-27, R-DUOS-MATE-SIGNALS-01): only while this portrait is THEIRS (on my board, in
  // the shop or the fight; never while I watch them, where their own screen shows it, nor at Hero Select).
  const signals = !watching && !heroSelect;
  const mate = useVersus((s) => (signals ? s.match?.group?.duos?.mate ?? null : null));
  // Their shop tiered up: the player's own tier-up burst over the disc (`shop-tier-up`, TavernUpButton's def).
  const tierPop = useDuosMateSignals((st) => (mate ? st.tierPop[mate] ?? 0 : 0));
  // The round is waiting on their screen (their End of Turn going off, or their late fight): the working glow.
  const seen = useDuosMateSignals((st) => (mate ? st.seen[mate] ?? null : null));
  const roundKey = useVersus((s) => {
    const m = s.match;
    const g = m?.group;
    if (!signals || !m || !g?.duos?.mate) return null;
    const row = g.raw.seats.find((x) => x.seat === g.duos!.mate);
    return `${m.round}|${m.phase}|${s.readyRound === m.round || m.p1_ready ? 1 : 0}|${row?.ready ? 1 : 0}`;
  });
  const myWave = useGame((s) => s.run.wave);
  // EFFECT PASSES WAITING FOR MY HAND ROOM (owner 2026-10-30, R-DUOS-EFFECT-PASS-QUEUE-01): a count pill by the portrait,
  // so a card on its way is never a surprise. A number selector (stable), never while I watch my teammate.
  const waiting = useGame((s) => (watching || heroSelect ? 0 : s.run.duos?.waiting?.length ?? 0));
  const myPhase = useGame((s) => s.run.phase);
  const working = useMemo(() => {
    if (!roundKey) return false;
    const [round, matchPhase, meBack, mateBack] = roundKey.split('|');
    return mateWorking({ seen, round: Number(round), matchPhase: matchPhase!, myWave, myPhase, meBack: meBack === '1', mateBack: mateBack === '1', away });
  }, [roundKey, seen, myWave, myPhase, away]);
  const holdRef = useRef<HTMLDivElement>(null);
  const seenPop = useRef(tierPop);
  useEffect(() => {
    if (tierPop === seenPop.current) return;
    seenPop.current = tierPop;
    if (!tierPop) return;
    // One layout read per tier-up (an event, never a frame): the disc's live centre.
    const r = holdRef.current?.getBoundingClientRect();
    if (!r || !(r.width > 0)) return;
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    playDef('shop-tier-up', { source: c, target: c }, { scale: DOCK_TIER_FX_SCALE });
  }, [tierPop]);
  const face = useMemo(() => {
    if (!key) return null;
    const [hero, name, cosRaw, avatar] = JSON.parse(key) as [string | null, string, unknown, string | null];
    const cos = parseCosmeticSnapshot(cosRaw) ?? undefined;
    const skins = watching ? cos ?? null : opponentSkins(showOppSkins, cos);
    const art = hero ? heroPortrait(hero, skins) : avatarSrc(avatar);
    return { name, art, frameId: frameIdOf(skins) };
  }, [key, watching, showOppSkins]);
  // THE SAME RING AS YOUR OWN PORTRAIT: the bottom-left hero's frame surface ('self', 'socket'), worn with THEIR
  // equipped frame (through "Show opponent cosmetics", like every other player's face), or the default look when they
  // have none.
  const frame = usePortraitFrame('self', face ? face.frameId : null, 'socket');
  // Size and place: your own portrait, mirrored. Measured once on mount (retried for a frame or two while the HUD lays
  // out) and on a resize.
  const [geo, setGeo] = useState<DockGeometry | null>(null);
  useLayoutEffect(() => {
    // Hero Select has no hero portrait of mine on screen to mirror: the dock keeps its default place (the same spot).
    if (heroSelect) return undefined;
    let raf = 0;
    let tries = 0;
    const measure = (): void => {
      const g = measureDock();
      if (g) setGeo((p) => (p && Math.abs(p.d - g.d) < 0.5 && Math.abs(p.right - g.right) < 0.5 && Math.abs(p.bottom - g.bottom) < 0.5 ? p : g));
      else if (tries++ < 30) raf = requestAnimationFrame(measure);
    };
    measure();
    const onResize = (): void => { cancelAnimationFrame(raf); tries = 0; raf = requestAnimationFrame(measure); };
    window.addEventListener('resize', onResize);
    // The rail grows with its rows (four in Versus Duos, eight in Ranked Duos) and may mount after the dock: re-fit when
    // its SIZE changes (its combat slide is a transform, which never fires this).
    let ro: ResizeObserver | null = null;
    let watched: HTMLElement | null = null;
    const watchRail = (): void => {
      const el = railEl();
      if (el === watched || typeof ResizeObserver === 'undefined') return;
      ro?.disconnect();
      watched = el;
      if (el) { ro = new ResizeObserver(onResize); ro.observe(el); }
    };
    watchRail();
    const railPoll = window.setInterval(watchRail, 2000); // a rail that mounts later (cheap: one query, no layout read)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); ro?.disconnect(); window.clearInterval(railPoll); };
  }, [heroSelect]);
  // The pass stream's FX, pre-warmed (both defs once, invisible) so the first pass links no shader on its frames.
  useEffect(() => { if (!heroSelect) void ensureDefsReady().then(() => prewarmPassFx()); }, [heroSelect]);
  if (!face) return null;
  const refusal = passOver === 'no' ? passReason : null;
  const shownNote = refusal ?? (note && !inCombat ? note.slice(note.indexOf('|') + 1) : null);
  // WHILE WATCHING (owner 2026-10-25: "Clicking your portrait should take you back to your board from viewing your
  // teammates"): with no plate up top this is the only on-screen way back, so the WHOLE portrait (cap, disc and name
  // pill) is the button, and a tap answers on the finger's release (a touch drag layer can swallow the synthetic click);
  // the click that follows a tap is ignored, so one tap is one swap.
  const back = watching && !inCombat;
  const style = geo ? ({ '--duos-d': `${geo.d}px`, right: `${geo.right}px`, bottom: `${geo.bottom}px` } as CSSProperties) : undefined;
  // No hero yet and no profile picture (Hero Select): their initial, as the room's portrait ring draws it.
  const disc = (
    <FoePortraitDisc art={face.art} gauntlet={false} frame={frame} extraClass=" duosdock-disc">
      {!face.art && <span className="duosdock-initial" aria-hidden="true">{(face.name.trim()[0] ?? '?').toUpperCase()}</span>}
    </FoePortraitDisc>
  );
  return (
    <>
    <div
      className={`duosdock${geo ? ' placed' : ''}${watching ? ' self' : ''}${away ? ' away' : ''}${inCombat ? ' combat' : ''}${tagged ? ' tagged' : ''}${heroSelect ? ' hsdock' : ''}${passOver ? ` pass-${passOver}` : ''}${working ? ' working' : ''}`}
      style={style}
      // LIVE PINGS (R-PING-08): the teammate portrait (the pass slot) takes a ping. It is the TEAMMATE on your screen and
      // your own portrait while you watch theirs: the same person, on both screens.
      data-ping={PING_MATE}
      {...(back ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': heroSelect ? 'Your portrait. Click to go back to your hero choices.' : 'Your portrait. Click to go back to your board.',
        onPointerUp: (e: PointerEvent) => { if (e.pointerType !== 'mouse') { lastTap = performance.now(); exitTeammateView(); } },
        onClick: () => { if (performance.now() - lastTap > TAP_CLICK_MS) exitTeammateView(); },
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); exitTeammateView(); } },
      } : {})}
    >
      {/* IN COMBAT (owner 2026-10-25) the portrait stays but is only a face: the fight is the team's (both of you watch
          the same one) and passing is shop-only, so it takes no click. */}
      {inCombat ? (
        <div ref={holdRef} className="duosdock-hold" data-duos-mate="" aria-label={`${face.name}, your teammate.`}>
          <span className="duosdock-work" aria-hidden="true" />
          {disc}
        </div>
      ) : back ? (
        <div className="duosdock-hold" data-duos-mate="">
          <span className="duosdock-glow" aria-hidden="true" />
          <span className="duosdock-no" aria-hidden="true" />
          {disc}
        </div>
      ) : (
        <div
          ref={holdRef}
          className="duosdock-hold"
          data-duos-mate=""
          role="button"
          aria-label={heroSelect ? `${face.name}, your teammate. Click to see their hero choices.` : `${face.name}, your teammate. Click to watch their board, or drag a card here to pass it.`}
          onClick={() => enterTeammateView()}
        >
          <span className="duosdock-work" aria-hidden="true" />
          <span className="duosdock-glow" aria-hidden="true" />
          <span className="duosdock-no" aria-hidden="true" />
          {disc}
        </div>
      )}
      <span className="duosdock-cap hudpill-name">{watching ? (heroSelect ? 'Back to your heroes' : 'Back to your board') : away ? 'Away' : 'Teammate'}</span>
      <span className="duosdock-name hudpill-name">{face.name}</span>
      {shownNote && <span key={shownNote + (note ?? '')} className="duosdock-note hudpill-name">{shownNote}</span>}
      {!shownNote && waiting > 0 && (
        <span className="duosdock-note duosdock-waiting hudpill-name" aria-label={`${waiting} passed ${waiting === 1 ? 'card is' : 'cards are'} waiting for room in your hand.`}>
          {waiting === 1 ? 'Hand full: 1 card waiting' : `Hand full: ${waiting} cards waiting`}
        </span>
      )}
    </div>
    {inCombat && geo?.hero && <DuosTagIn on={tagged} hero={geo.hero} art={face.art} frame={frame} name={face.name} working={working} />}
    </>
  );
});

/** How long the tag-in copy takes to fade out before it unmounts (matches `duostagout` in versus.css). */
const TAG_OUT_MS = 240;

/**
 * THE TAG-IN COPY (R-DUOS-SLOTS-02): my teammate's portrait over my own hero bottom left, a little up and to the right
 * (the pair, like a tag team), while their board fights on my side. Fades in, and out again when it ends (it stays
 * mounted for the fade-out, then goes). Pointer-events none: my hero underneath keeps its own clicks and its lunge.
 * Fixed in stage px off my hero disc's measured box, so it never reads layout itself.
 */
function DuosTagIn({ on, hero, art, frame, name, working }: { on: boolean; hero: NonNullable<DockGeometry['hero']>; art: string | undefined; frame: ReturnType<typeof usePortraitFrame>; name: string; working: boolean }): JSX.Element | null {
  const [shown, setShown] = useState(on);
  const timer = useRef(0);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (on) setShown(true);
    else timer.current = window.setTimeout(() => setShown(false), TAG_OUT_MS);
    return () => window.clearTimeout(timer.current);
  }, [on]);
  if (!shown && !on) return null;
  const style = { '--duos-d': `${hero.d}px`, left: `${hero.left}px`, bottom: `${hero.bottom}px` } as CSSProperties;
  return (
    <div className={`duostagin${on ? '' : ' out'}${working ? ' working' : ''}`} style={style} aria-label={`${name} is fighting for your team.`}>
      <div className="duostagin-hold">
        {/* While their portrait stands in over mine, it carries their "still working" glow too (R-DUOS-MATE-SIGNALS-01). */}
        <span className="duosdock-work" aria-hidden="true" />
        <FoePortraitDisc art={art} gauntlet={false} frame={frame} extraClass=" duosdock-disc" />
        <span className="duosdock-name hudpill-name">{name}</span>
      </div>
    </div>
  );
}
