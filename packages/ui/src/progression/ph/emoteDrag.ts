/**
 * DRAG AN EMOTE ONTO A MENU SLOT (owner 2026-11-06: "i want to be able to drag a card to a slot to equip it"; then "remove the
 * mouse cursor while dragging" and "increase the opacity of the emote itself to 100% when dragging").
 *
 * A pointer drag, not the browser's HTML5 drag: that one always paints its own cursor and a see-through ghost. Press an owned
 * emote tile, move a few px, and the emote itself follows the pointer at full opacity while the cursor is hidden. The slot
 * under it pops (`[data-drop]`); letting go there puts the emote in that slot.
 *
 * Performance: the slots' rects are read ONCE when the drag starts (they do not move during it); every move is one transform
 * on the ghost plus an attribute swap when the slot under the pointer changes. The ghost lives in `stageHost()` and is placed
 * in stage px (`toStage`), so it lines up on a scaled stage too.
 */
import { stageHost, toStage } from '../../stage';

const SLOTS = '.phc-actions .colls-emote-slots > *';
const START_PX = 6; // movement before a press becomes a drag (a plain click still selects the tile)

export function startEmoteDrag(e: { button: number; pointerType: string; clientX: number; clientY: number }, art: string | undefined, onDrop: (position: number) => void): void {
  if (e.button !== 0 || e.pointerType === 'touch') return; // touch keeps tap-a-slot
  const x0 = e.clientX, y0 = e.clientY;
  let ghost: HTMLImageElement | null = null;
  let cover: HTMLDivElement | null = null;
  let rects: DOMRect[] = [];
  let slots: HTMLElement[] = [];
  let over = -1;

  const hit = (x: number, y: number): number => rects.findIndex((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  const mark = (i: number): void => {
    if (i === over) return;
    if (over >= 0) slots[over]?.removeAttribute('data-drop');
    if (i >= 0) slots[i]?.setAttribute('data-drop', '');
    over = i;
  };
  const place = (x: number, y: number): void => {
    if (ghost) ghost.style.transform = `translate3d(${toStage(x)}px, ${toStage(y)}px, 0) translate(-50%, -50%)`;
  };
  const begin = (): void => {
    slots = [...document.querySelectorAll<HTMLElement>(SLOTS)];
    rects = slots.map((el) => el.getBoundingClientRect());
    document.documentElement.classList.add('phc-dragging');
    cover = document.createElement('div');
    cover.className = 'phc-dragcover';
    cover.style.cursor = 'none';
    stageHost().appendChild(cover);
    if (art) {
      ghost = document.createElement('img');
      ghost.className = 'phc-dragghost';
      ghost.src = art;
      ghost.alt = '';
      ghost.draggable = false;
      ghost.decoding = 'sync';
      stageHost().appendChild(ghost);
    }
  };
  const end = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    mark(-1);
    ghost?.remove();
    ghost = null;
    cover?.remove();
    cover = null;
    document.documentElement.classList.remove('phc-dragging');
  };
  const move = (ev: PointerEvent): void => {
    if (!cover) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < START_PX) return;
      begin();
    }
    place(ev.clientX, ev.clientY);
    mark(hit(ev.clientX, ev.clientY));
  };
  const up = (ev: PointerEvent): void => {
    const dragging = !!cover;
    const i = dragging ? hit(ev.clientX, ev.clientY) : -1;
    end();
    if (i >= 0) onDrop(i);
  };
  const cancel = (): void => end();
  const key = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') end(); };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
}
