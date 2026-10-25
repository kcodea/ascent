/**
 * VERSUS DUOS — THE TEAMMATE PORTRAIT, BOTTOM RIGHT (owner 2026-10-25: "i think we should have our teammate's hero
 * portrait in the bottom right area which is how we should pass and click their portrait to view their board, then our
 * portrait is in the bottom right to click on to return to our board"). R-DUOS-VIEW-01, R-DUOS-PASS-01.
 *
 * The mirror of your own hero bottom left, in the game's round portrait disc (`FoePortraitDisc`, the combat opponent's
 * face) with its name pill:
 *  - on your board it is your TEAMMATE: click it to watch their screen; drag a card onto it to pass the card. While a
 *    drag hovers it the disc glows teal (a STATIC shadow on its own layer whose opacity breathes, the `kwglow` pattern:
 *    no animated paint); a refused pass shows a red ring and the reason instead;
 *  - while you watch them it is YOU: click or tap anywhere on it (cap, disc or name) to come back to your board. With
 *    no plate up top (owner 2026-10-25) it is the only on-screen way back (Esc and letting go of Tab work too).
 * A pass drops INTO this disc (`passLob.playDrop`), and a pass to you rises OUT of it (`playArrival`).
 */
import { memo, useMemo, type KeyboardEvent, type PointerEvent } from 'react';
import { parseCosmeticSnapshot } from '@game/progression';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { useDragSlice } from '../dragStore';
import { useGame } from '../store';
import { heroPortrait } from '../skins/skinArt';
import { opponentSkins } from '../skins/skins';
import { useDuosPassNote } from './duosPassUi';
import { enterTeammateView, exitTeammateView } from './teammateView';
import { useVersus } from './versusStore';

/** A tap's own release swaps; the browser's click that follows it within this window is the same gesture. */
const TAP_CLICK_MS = 700;
let lastTap = -Infinity;

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
  const showOppSkins = useGame((s) => s.showOpponentSkins);
  const passOver = useDragSlice((st) => (watching || inCombat ? null : st.passOver), Object.is);
  const passReason = useDragSlice((st) => (watching || inCombat ? null : st.passReason), Object.is);
  const note = useDuosPassNote((st) => (watching || !st.text ? null : `${st.n}|${st.text}`));
  const face = useMemo(() => {
    if (!key) return null;
    const [hero, name, cosRaw] = JSON.parse(key) as [string, string, unknown];
    const cos = parseCosmeticSnapshot(cosRaw) ?? undefined;
    return { name, art: heroPortrait(hero, watching ? cos ?? null : opponentSkins(showOppSkins, cos)) };
  }, [key, watching, showOppSkins]);
  if (!face) return null;
  const refusal = passOver === 'no' ? passReason : null;
  const shownNote = refusal ?? (note && !inCombat ? note.slice(note.indexOf('|') + 1) : null);
  // WHILE WATCHING (owner 2026-10-25: "Clicking your portrait should take you back to your board from viewing your
  // teammates"): with no plate up top this is the only on-screen way back, so the WHOLE portrait (cap, disc and name
  // pill) is the button, and a tap answers on the finger's release (a touch drag layer can swallow the synthetic click);
  // the click that follows a tap is ignored, so one tap is one swap.
  const back = watching && !inCombat;
  return (
    <div
      className={`duosdock${watching ? ' self' : ''}${away ? ' away' : ''}${inCombat ? ' combat' : ''}${passOver ? ` pass-${passOver}` : ''}`}
      {...(back ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': 'Your portrait. Click to go back to your board.',
        onPointerUp: (e: PointerEvent) => { if (e.pointerType !== 'mouse') { lastTap = performance.now(); exitTeammateView(); } },
        onClick: () => { if (performance.now() - lastTap > TAP_CLICK_MS) exitTeammateView(); },
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); exitTeammateView(); } },
      } : {})}
    >
      <span className="duosdock-cap hudpill-name">{watching ? 'Back to your board' : away ? 'Away' : 'Teammate'}</span>
      {/* IN COMBAT (owner 2026-10-25) the portrait stays but is only a face: the fight is the team's (both of you watch
          the same one) and passing is shop-only, so it takes no click. */}
      {inCombat ? (
        <div className="duosdock-hold" data-duos-mate="" aria-label={`${face.name}, your teammate.`}>
          <FoePortraitDisc art={face.art} gauntlet={false} frame={null} extraClass=" duosdock-disc" />
        </div>
      ) : back ? (
      <div className="duosdock-hold" data-duos-mate="">
        <span className="duosdock-glow" aria-hidden="true" />
        <span className="duosdock-no" aria-hidden="true" />
        <FoePortraitDisc art={face.art} gauntlet={false} frame={null} extraClass=" duosdock-disc" />
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
        <FoePortraitDisc art={face.art} gauntlet={false} frame={null} extraClass=" duosdock-disc" />
      </div>
      )}
      <span className="duosdock-name hudpill-name">{face.name}</span>
      {shownNote && <span key={shownNote + (note ?? '')} className="duosdock-note hudpill-name">{shownNote}</span>}
    </div>
  );
});
