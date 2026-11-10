// @vitest-environment jsdom
/**
 * ROOM ON THE SPECTATOR RAIL (owner 2026-11-09: "when someone sends a long message, any bubbles that pop up from another
 * spectator below are way off, is it possible to slide down the spectator cards while a long bubble or series of bubbles
 * are active?"; R-CHAT-BUBBLE-RAIL-ROOM-01): a spectator's bubbles that reach past their row push the rows below down by
 * that much; the bubbles beside those rows ride along; when the bubbles go, the rows close up again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

import { RAIL_ROOM_GAP, railRoomFor, syncRailRoom } from './ChatBubbleLayer';
import { stageHost } from '../stage';

const ROW_H = 58;
const ROW_GAP = 4;

/** Rows stacked like the rail: each row's top is the rows above plus their margins (jsdom has no layout of its own). */
function rail(ids: string[]): HTMLElement[] {
  const col = document.createElement('div');
  col.className = 'vsspec-seats';
  document.body.appendChild(col);
  const rows = ids.map((id) => {
    const r = document.createElement('span');
    r.dataset.watcher = id;
    col.appendChild(r);
    return r;
  });
  rows.forEach((r, i) => {
    r.getBoundingClientRect = () => {
      let top = 0;
      for (let j = 0; j < i; j++) top += ROW_H + ROW_GAP + (parseFloat(rows[j]!.style.marginBottom) || 0);
      return { top, left: 0, width: 112, height: ROW_H, right: 112, bottom: top + ROW_H, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
  });
  return rows;
}

function bubble(speaker: string, top: number, h: number): HTMLElement {
  const b = document.createElement('div');
  b.className = 'chatbub';
  b.dataset.speaker = speaker;
  b.dataset.bid = `${speaker}:${top}`;
  b.style.top = `${top}px`;
  b.style.visibility = 'visible';
  Object.defineProperty(b, 'offsetHeight', { value: h });
  stageHost().appendChild(b);
  return b;
}

beforeEach(() => {
  stageHost().getBoundingClientRect = () => ({ top: 0, left: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { document.body.innerHTML = ''; });

describe('room on the spectator rail (R-CHAT-BUBBLE-RAIL-ROOM-01)', () => {
  it('a row pushes the rows below only by how far its bubbles reach past it', () => {
    expect(railRoomFor(undefined, ROW_H)).toBe(0);
    expect(railRoomFor(40, ROW_H)).toBe(0); // a bubble that fits beside its row asks for nothing
    expect(railRoomFor(150, ROW_H)).toBe(150 + RAIL_ROOM_GAP - ROW_H);
  });

  it('a long message slides the rows below down, their bubbles ride along, and it closes up when the bubbles go', () => {
    const rows = rail(['a', 'b', 'c']);
    const a1 = bubble('a', 5, 50);
    const a2 = bubble('a', 61, 50); // the long message's second bubble: its stack reaches 111px below row a's top
    const b1 = bubble('b', 70, 40); // b's bubble, beside b's row
    syncRailRoom();
    const room = 111 + RAIL_ROOM_GAP - ROW_H;
    expect(rows[0]!.style.marginBottom).toBe(`${room}px`);
    expect(rows[1]!.style.marginBottom).toBe(''); // b's bubble fits beside it
    expect(rows[1]!.getBoundingClientRect().top).toBe(ROW_H + ROW_GAP + room); // b now starts below a's stack
    expect(b1.style.top).toBe(`${70 + room}px`); // and its bubble moved with it, level with b again
    expect(a1.style.top).toBe('5px'); // a's own bubbles stay where they are
    expect(rows[2]!.getBoundingClientRect().top).toBe(2 * (ROW_H + ROW_GAP) + room);
    // The long message ends: the rows close up and b's bubble rides back.
    a1.remove();
    a2.remove();
    syncRailRoom();
    expect(rows[0]!.style.marginBottom).toBe('');
    expect(b1.style.top).toBe('70px');
  });
});
