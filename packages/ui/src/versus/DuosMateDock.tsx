/**
 * VERSUS DUOS — THE TEAMMATE PORTRAIT, BOTTOM RIGHT (owner 2026-10-25: "i think we should have our teammate's hero
 * portrait in the bottom right area which is how we should pass and click their portrait to view their board, then our
 * portrait is in the bottom right to click on to return to our board"). R-DUOS-VIEW-01, R-DUOS-PASS-01, R-DUOS-VIEW-03.
 *
 * THE MIRROR OF YOUR OWN HERO bottom left (owner 2026-10-25: "can you make the teammate portrait as large as the
 * player's and make sure it's wired to show their custom frame as well if they have one"): the same disc size, the same
 * distance in from the stage's bottom corner (measured off your own portrait, `mirrorOfHero`, so the two can never
 * drift apart), the same frame surface wearing THEIR equipped portrait frame, the same name pill eclipsing the disc's
 * bottom and the same Hearts box under it (the team's hearts, which are theirs too).
 *  - on your board it is your TEAMMATE: click it to watch their screen; drag a card onto it to pass the card. While a
 *    drag hovers it the disc glows teal (a STATIC shadow on its own layer whose opacity breathes, the `kwglow` pattern:
 *    no animated paint); a refused pass shows a red ring and the reason instead;
 *  - while you watch them it is YOU: click or tap anywhere on it (cap, disc or name) to come back to your board. With
 *    no plate up top (owner 2026-10-25) it is the only on-screen way back (Esc and letting go of Tab work too).
 * A pass drops INTO this disc (`passLob.playDrop`), and a pass to you rises OUT of it (`playArrival`).
 */
import { memo, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { parseCosmeticSnapshot } from '@game/progression';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { Icon } from '../Icon';
import { frameIdOf, usePortraitFrame } from '../portraitFrame/PortraitFrame';
import { ensureDefsReady } from '../fx/playDef';
import { useDragSlice } from '../dragStore';
import { useGame } from '../store';
import { heroPortrait } from '../skins/skinArt';
import { opponentSkins } from '../skins/skins';
import { stageHost, toStage } from '../stage';
import { useDuosPassNote } from './duosPassUi';
import { prewarmPassFx } from './passLob';
import { enterTeammateView, exitTeammateView } from './teammateView';
import { useVersus } from './versusStore';

/** A tap's own release swaps; the browser's click that follows it within this window is the same gesture. */
const TAP_CLICK_MS = 700;
let lastTap = -Infinity;

/** Where the dock sits: its disc's diameter and its distance in from the stage's right and bottom edges (stage px). */
export interface DockGeometry { d: number; right: number; bottom: number }

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

/** Measures your own hero disc (one layout read, on mount and on a resize; never per frame). */
function measureDock(): DockGeometry | null {
  if (typeof document === 'undefined') return null;
  const art = document.querySelector<HTMLElement>('.statusbar .hero .heroimg') ?? document.querySelector<HTMLElement>('.statusbar .hero .f');
  const host = stageHost();
  return mirrorOfHero(art?.getBoundingClientRect() ?? null, host.getBoundingClientRect(), toStage);
}

export const DuosMateDock = memo(function DuosMateDock({ watching, inCombat = false }: { watching: boolean; inCombat?: boolean }): JSX.Element | null {
  // Whose face: my teammate on my board, me while I watch them. One primitive key, so the dock only re-renders when
  // the face, its name or its cosmetics change.
  const key = useVersus((s) => {
    const g = s.match?.group;
    const d = g?.duos;
    if (!g?.me || !d) return null;
    const seat = watching ? g.me : d.mate;
    const row = g.raw.seats.find((x) => x.seat === seat);
    if (!row) return null;
    const cos = s.room?.members.find((m) => m.userId === row.userId)?.profile?.cosmetics ?? null;
    return JSON.stringify([row.hero, row.name, cos ?? null]);
  });
  // My teammate dropped out (their board plays on auto): the portrait says so before any drag.
  const away = useVersus((s) => {
    const g = s.match?.group;
    if (watching || !g?.duos) return false;
    const row = g.raw.seats.find((x) => x.seat === g.duos!.mate);
    return !!row?.auto || (!!g.raw.paused_at && g.raw.paused_seat === g.duos.mate);
  });
  // The TEAM's hearts, exactly as your own Hearts box shows them (they drop when a lost fight settles, not before).
  const hearts = useGame((s) => (s.run.mode === 'versus' ? s.run.lobby?.seats[0]?.resolve ?? null : null));
  const showOppSkins = useGame((s) => s.showOpponentSkins);
  const passOver = useDragSlice((st) => (watching || inCombat ? null : st.passOver), Object.is);
  const passReason = useDragSlice((st) => (watching || inCombat ? null : st.passReason), Object.is);
  const note = useDuosPassNote((st) => (watching || !st.text ? null : `${st.n}|${st.text}`));
  const face = useMemo(() => {
    if (!key) return null;
    const [hero, name, cosRaw] = JSON.parse(key) as [string, string, unknown];
    const cos = parseCosmeticSnapshot(cosRaw) ?? undefined;
    const skins = watching ? cos ?? null : opponentSkins(showOppSkins, cos);
    return { name, art: heroPortrait(hero, skins), frameId: frameIdOf(skins) };
  }, [key, watching, showOppSkins]);
  // THE SAME RING AS YOUR OWN PORTRAIT: the bottom-left hero's frame surface ('self', 'socket'), worn with THEIR
  // equipped frame (through "Show opponent cosmetics", like every other player's face), or the default look when they
  // have none.
  const frame = usePortraitFrame('self', face ? face.frameId : null, 'socket');
  // Size and place: your own portrait, mirrored. Measured once on mount (retried for a frame or two while the HUD lays
  // out) and on a resize.
  const [geo, setGeo] = useState<DockGeometry | null>(null);
  useLayoutEffect(() => {
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
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  // The pass stream's FX, pre-warmed (both defs once, invisible) so the first pass links no shader on its frames.
  useEffect(() => { void ensureDefsReady().then(() => prewarmPassFx()); }, []);
  if (!face) return null;
  const refusal = passOver === 'no' ? passReason : null;
  const shownNote = refusal ?? (note && !inCombat ? note.slice(note.indexOf('|') + 1) : null);
  // WHILE WATCHING (owner 2026-10-25: "Clicking your portrait should take you back to your board from viewing your
  // teammates"): with no plate up top this is the only on-screen way back, so the WHOLE portrait (cap, disc and name
  // pill) is the button, and a tap answers on the finger's release (a touch drag layer can swallow the synthetic click);
  // the click that follows a tap is ignored, so one tap is one swap.
  const back = watching && !inCombat;
  const style = geo ? ({ '--duos-d': `${geo.d}px`, right: `${geo.right}px`, bottom: `${geo.bottom}px` } as CSSProperties) : undefined;
  const disc = <FoePortraitDisc art={face.art} gauntlet={false} frame={frame} extraClass=" duosdock-disc" />;
  return (
    <div
      className={`duosdock${geo ? ' placed' : ''}${watching ? ' self' : ''}${away ? ' away' : ''}${inCombat ? ' combat' : ''}${passOver ? ` pass-${passOver}` : ''}`}
      style={style}
      {...(back ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': 'Your portrait. Click to go back to your board.',
        onPointerUp: (e: PointerEvent) => { if (e.pointerType !== 'mouse') { lastTap = performance.now(); exitTeammateView(); } },
        onClick: () => { if (performance.now() - lastTap > TAP_CLICK_MS) exitTeammateView(); },
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); exitTeammateView(); } },
      } : {})}
    >
      {/* IN COMBAT (owner 2026-10-25) the portrait stays but is only a face: the fight is the team's (both of you watch
          the same one) and passing is shop-only, so it takes no click. */}
      {inCombat ? (
        <div className="duosdock-hold" data-duos-mate="" aria-label={`${face.name}, your teammate.`}>{disc}</div>
      ) : back ? (
        <div className="duosdock-hold" data-duos-mate="">
          <span className="duosdock-glow" aria-hidden="true" />
          <span className="duosdock-no" aria-hidden="true" />
          {disc}
        </div>
      ) : (
        <div
          className="duosdock-hold"
          data-duos-mate=""
          role="button"
          aria-label={`${face.name}, your teammate. Click to watch their board, or drag a card here to pass it.`}
          onClick={() => enterTeammateView()}
        >
          <span className="duosdock-glow" aria-hidden="true" />
          <span className="duosdock-no" aria-hidden="true" />
          {disc}
        </div>
      )}
      <span className="duosdock-cap hudpill-name">{watching ? 'Back to your board' : away ? 'Away' : 'Teammate'}</span>
      <span className="duosdock-name hudpill-name">{face.name}</span>
      {hearts != null && (
        <div className="duosdock-hp hudpill-hp" aria-label={`Team hearts: ${hearts}`}>
          <Icon name="heartPill" />
          <span className="hpval">{hearts}</span>
        </div>
      )}
      {shownNote && <span key={shownNote + (note ?? '')} className="duosdock-note hudpill-name">{shownNote}</span>}
    </div>
  );
});
