/**
 * THE MAGIC HAT'S SEND (owner 2026-11-12, R-DUOS-MAGICIAN-01): "it passes a random minion from those 3 buys, so the pass
 * will come from his hat hero power instead of the minion bought area".
 *
 * The copy is a RANDOM card out of the hat, so the screen has to say which: the copy's own face (the card as it was
 * bought, drawn from the outbox entry, never from a card on screen that may since have been played, sold or tripled)
 * rises out of the Magic Hat hero power button, holds a beat so it can be read, then goes the way every send goes: it
 * fades as its plate dissolves and the existing `duos-pass-send` stream flies into the teammate portrait (`playDrop`,
 * unchanged, with Mike's tuned values).
 *
 * Nothing authored and nothing looping: one `Card` in its own React root, inside the same `.duoslob` / `.dragcard`
 * context a drag pass's fading copy uses; one transform / opacity one-shot for the rise; two timers; all gone when the
 * stream leaves. Layout is read once (the hat, one card for its size, the portrait).
 *
 * Registered with `passLob.ts` (`setHatSender`) rather than imported by it, so the pass module stays free of React.
 */
import { createRoot } from 'react-dom/client';
import type { BoardCard, RunState } from '@game/sim';
import { Card, type CardView } from '../Card';
import { instView, liveBoardView } from '../instView';
import { stageHost, toScreen, toStage } from '../stage';
import { catchPulse, mateDoor, playDrop, setHatSender } from './passLob';

/** The rise out of the hat, and the beat the face holds so the player can read which card it is (ms). */
export const HAT_RISE_MS = 240;
export const HAT_HOLD_MS = 620;

/** The copy's face as a card view: the live view when the run can build it, else the plain instance view. */
export function hatCardView(card: BoardCard, run: RunState | null | undefined): CardView {
  if (run) { try { return liveBoardView(card, run); } catch { /* a partial run (a watcher's frame): the plain view */ } }
  return instView(card);
}

/** The Magic Hat on screen: the hero power button of the run being shown. */
const hatEl = (): HTMLElement | null => document.querySelector<HTMLElement>('.statusbar .heropowerbtn');

/**
 * Play one hat send: `card` (the outbox entry's card) rises out of the hat, holds, and streams into the teammate
 * portrait. Returns whether it started (false: no hat or no portrait on screen).
 */
export function playHatSend(card: BoardCard, run: RunState | null | undefined): boolean {
  if (typeof document === 'undefined') return false;
  const hat = hatEl();
  const door = mateDoor();
  if (!hat || !door) return false;
  const hr = hat.getBoundingClientRect();
  if (hr.width <= 0) return false;
  // The size of a card on this screen (stage px), read off one that is there; a Shop card's usual size otherwise.
  const ref = document.querySelector<HTMLElement>('.card.compact[data-uid]');
  const w = ref?.offsetWidth || 132;
  const h = ref?.offsetHeight || 176;
  // It stands on the hat: centred over the button (kept on screen), its foot at the button's middle. Screen px.
  const sw = toScreen(w), sh = toScreen(h);
  const cx = Math.min(Math.max(hr.left + hr.width / 2, sw / 2 + 8), window.innerWidth - sw / 2 - 8);
  const cy = Math.max(sh / 2 + 8, hr.top + hr.height / 2 - sh / 2);
  const from = { cx, cy, w, h };
  const stream = (face: HTMLElement | null): void => {
    const plate = face ? (face.querySelector<HTMLElement>('.cardplate:not(.plate-interior)') ?? face).getBoundingClientRect() : null;
    playDrop({ from, plate, face, to: door.getBoundingClientRect(), coin: false, onLand: () => catchPulse(door) });
  };
  if (typeof Element === 'undefined' || !('animate' in Element.prototype)) { stream(null); return true; }

  const outer = document.createElement('div');
  outer.className = 'duoslob hatsend';
  outer.style.left = `${toStage(cx) - w / 2}px`;
  outer.style.top = `${toStage(cy) - h / 2}px`;
  outer.style.width = `${w}px`;
  outer.style.height = `${h}px`;
  outer.style.transformOrigin = '50% 100%';
  const ctx = document.createElement('div');
  ctx.className = 'dragcard duoslob-dragctx';
  ctx.style.width = `${w}px`;
  ctx.style.height = `${h}px`;
  outer.appendChild(ctx);
  stageHost().appendChild(outer);
  const root = createRoot(ctx);
  root.render(<Card card={hatCardView(card, run)} suppressPop />);
  // Out of the hat: up from the button and to full size (transform / opacity only, one shot).
  outer.animate(
    [{ opacity: 0, transform: `translateY(${Math.round(h * 0.42)}px) scale(0.3)` }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
    { duration: HAT_RISE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' },
  );
  window.setTimeout(() => {
    // The send itself: `playDrop` clones the face where it stands (its fade, the plate's dissolve, the stream), so this
    // host can go in the same frame.
    stream(ctx.querySelector<HTMLElement>('.card'));
    outer.remove();
    window.setTimeout(() => root.unmount(), 0);
  }, HAT_RISE_MS + HAT_HOLD_MS);
  return true;
}

setHatSender((card, run) => playHatSend(card as BoardCard, run as RunState | null));
