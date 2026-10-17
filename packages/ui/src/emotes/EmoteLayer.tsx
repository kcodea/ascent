import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cosmeticOf } from '@game/progression';
import { emoteReplayDelays, playerOpponent, seatEmoteSchedule, type EmotePhase, type RunLobby } from '@game/sim';
import { useGame } from '../store';
import { stageHost, stageViewport } from '../stage';
import { sfx } from '../sfx';
import { emoteSrc } from './emoteArt';
import { clearEmoteBubbles, setEmoteFoe, showEmoteBubble } from './emoteBubble';
import { useEmoteSlots } from './emoteLoadout';
import { EmptyEmoteSlot } from './EmptyEmoteSlot';
import {
  EMOTE_COOLDOWN_MS, PLAYER_SEAT, closeEmoteMenu, emoteCooldownRemaining, emoteNow, emotePhaseClock, markEmotePhase, onEmotePhase,
  phaseOfRun, placeEmoteMenu, sayEmote, useEmoteUi,
} from './emoteRuntime';
import { deliverEmote, subscribeEmotes } from './emoteTransport';
import { resetHeldEmotes } from './emoteRecording';
import './emotes.css';

/**
 * THE EMOTE LAYER (owner spec 2026-10-13), mounted once per run beside the StatusBar. It owns no per-frame work:
 *
 *  - THE CLOCK: it maps the run's phase onto the emote phase clock (a shop turn starts when the run enters `recruit`
 *    for a wave, a combat when it enters `combat`), through a store subscription, never a render.
 *  - THE BUBBLES: every emote the transport delivers pops beside its seat (`showEmoteBubble`).
 *  - THE REPLAY: at each phase start, the recorded emotes of every seat that is a real player's run are scheduled at
 *    their recorded offsets (`seatEmoteSchedule`), off the transition frame; the next phase start cancels what is left.
 *    In combat only the foe you are fighting can be seen, so only its emotes are scheduled. Bots and generated seats
 *    never emote. Nothing is scheduled while a replay is being watched.
 *  - THE MENU: your four emotes, opened by right-clicking your portrait (StatusBar), with the 20 s cooldown.
 */
export const EmoteLayer = memo(function EmoteLayer(): JSX.Element | null {
  useEffect(() => {
    resetHeldEmotes();
    const unsubscribe = subscribeEmotes((m) => { showEmoteBubble(m.seat, m.emoteId); });
    const timers: number[] = [];
    const cancelReplay = (): void => { for (const t of timers.splice(0)) window.clearTimeout(t); };

    /** Schedule the served seats' recorded emotes for the phase that just started. */
    const scheduleReplay = (phase: EmotePhase, round: number, startedAt: number): void => {
      cancelReplay();
      setEmoteFoe(null);
      const st = useGame.getState();
      const lobby: RunLobby | undefined = st.run.lobby ?? undefined;
      if (!lobby || st.replaySession || st.run.godMode) return;
      // Off the phase transition's frame: a snapshot seat's board is a lookup, but the transition is busy enough.
      timers.push(window.setTimeout(() => {
        const cur = useGame.getState().run.lobby;
        if (!cur || cur.round !== lobby.round) return;
        let seats: string[];
        if (phase === 'combat') {
          const foe = playerOpponent(cur);
          if (!foe || foe.ghost) return;
          setEmoteFoe(foe.seat.id);
          seats = [foe.seat.id];
        } else {
          seats = cur.seats.filter((s) => s.id !== PLAYER_SEAT && s.kind === 'snapshot' && s.alive).map((s) => s.id);
        }
        for (const seat of seats) {
          // Each at its recorded offset into this phase; one whose moment has passed is dropped, never played late.
          for (const { emote: e, waitMs } of emoteReplayDelays(seatEmoteSchedule(cur, seat, phase), startedAt, emoteNow())) {
            timers.push(window.setTimeout(() => deliverEmote({ emoteId: e.id, seat, phase, offsetMs: e.at, round }), waitMs));
          }
        }
      }, 0));
    };
    const offPhase = onEmotePhase((c) => {
      if (c.phase) scheduleReplay(c.phase, c.round, c.startedAt);
      else { cancelReplay(); setEmoteFoe(null); }
      closeEmoteMenu();
    });

    // The run -> the clock. A subscription (not a render) so a re-render never resets a phase.
    const sync = (run: { phase: string; wave: number }): void => markEmotePhase(phaseOfRun(run), run.wave);
    sync(useGame.getState().run);
    const offStore = useGame.subscribe((s, prev) => {
      if (s.run.phase !== prev.run.phase || s.run.wave !== prev.run.wave) sync(s.run);
    });
    // A phase already running when the layer mounted (a resumed game) still schedules its seats from now on.
    const c = emotePhaseClock();
    if (c.phase) scheduleReplay(c.phase, c.round, c.startedAt);

    return () => {
      unsubscribe(); offPhase(); offStore(); cancelReplay();
      markEmotePhase(null, 0);
      setEmoteFoe(null);
      clearEmoteBubbles();
      closeEmoteMenu();
    };
  }, []);

  const menu = useEmoteUi((s) => s.menu);
  return menu ? <EmoteMenu at={menu} /> : null;
});

/** The right-click menu: your four emotes, and the cooldown while it runs. Portaled to the stage host. */
function EmoteMenu({ at }: { at: { x: number; y: number; below?: boolean; anchor?: { top: number; bottom: number } } }): JSX.Element {
  const slots = useEmoteSlots();
  const ref = useRef<HTMLDivElement>(null);
  // A PLACED menu (a spectator's, off their top-left plate): measured once on open (its own layout size, stage px),
  // then put below the plate when it fits, else above, inside the stage (R-SPECTATE-HUD-02). Hidden for that one
  // pre-paint pass so it never flashes in the wrong place. The player's own menu keeps its fixed CSS offset.
  const [placed, setPlaced] = useState<{ left: number; top: number; side: 'below' | 'above' } | null>(null);
  useLayoutEffect(() => {
    if (!at.anchor || !ref.current) return;
    const el = ref.current;
    setPlaced(placeEmoteMenu({ x: at.x, top: at.anchor.top, bottom: at.anchor.bottom }, { w: el.offsetWidth, h: el.offsetHeight }, stageViewport(), at.below ? 'below' : 'above'));
  }, [at]);
  const [left, setLeft] = useState(() => emoteCooldownRemaining());
  // The bar's start point, fixed for this menu: the animation then runs on its own (no per-tick restyle).
  const [left0] = useState(left);
  const cooling = left > 0;

  // The countdown: one tick a second, only while the menu is open AND cooling (the bar itself is a one-shot CSS
  // transform animation, so nothing repaints per frame).
  useEffect(() => {
    if (!cooling) return;
    const id = window.setInterval(() => setLeft(emoteCooldownRemaining()), 250);
    return () => window.clearInterval(id);
  }, [cooling]);

  // Escape, or a press anywhere outside the menu, closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeEmoteMenu(); };
    const onDown = (e: PointerEvent): void => { if (!ref.current?.contains(e.target as Node)) closeEmoteMenu(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); };
  }, []);

  const say = (id: string): void => {
    if (sayEmote(id)) sfx.pulse();
  };
  const secs = Math.ceil(left / 1000);
  return createPortal(
    <div
      ref={ref}
      className={`atip emote-menu${at.anchor ? ` placed ${placed?.side ?? ''}` : at.below ? ' below' : ''}${cooling ? ' cooling' : ''}`}
      role="menu"
      aria-label="Emotes"
      style={at.anchor
        ? { left: `${placed?.left ?? at.x}px`, top: `${placed?.top ?? at.y}px`, visibility: placed ? undefined : 'hidden' }
        : { left: `${at.x}px`, top: `${at.y}px` }}
      data-side={placed?.side}
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      <b className="atip-title">Emotes</b>
      {/* ALL FOUR slots, always (owner 2026-10-15: "show the empty emote slots so it's obvious they have empty slots"):
          an empty one is the dashed empty-slot frame, never clickable, its hover pointing at crates. */}
      <div className="emote-grid">
        {slots.map((id, i) => {
          if (!id) return <EmptyEmoteSlot key={`empty-${i}`} position={i} role="menuitem" />;
          const def = cosmeticOf(id);
          const src = emoteSrc(id);
          return (
            <button
              key={id} type="button" role="menuitem" className="emote-pick pressable" disabled={cooling}
              aria-label={cooling ? `${def?.name ?? id}, ready in ${secs} seconds` : `Say ${def?.name ?? id}`}
              onClick={() => say(id)}
            >
              {src && <img src={src} alt="" draggable={false} decoding="sync" />}
            </button>
          );
        })}
      </div>
      <div className="emote-cd" aria-live="polite">
        {cooling ? (
          <>
            <span className="emote-cd-bar" aria-hidden="true">
              <span style={{ animationDuration: `${EMOTE_COOLDOWN_MS}ms`, animationDelay: `-${EMOTE_COOLDOWN_MS - left0}ms` }} />
            </span>
            <span className="emote-cd-txt">Ready in {secs}s</span>
          </>
        ) : (
          <span className="emote-cd-txt">Pick one to say it</span>
        )}
      </div>
    </div>,
    stageHost(),
  );
}
