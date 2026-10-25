// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE TEAMMATE PORTRAIT, BOTTOM RIGHT (owner 2026-10-25; R-DUOS-VIEW-01, R-DUOS-PASS-01): on my board it
 * is my TEAMMATE (the pass target, a click watches them); while I watch them it is ME (a click comes back). A drag over
 * it glows for a pass and shows the reason for a refusal. The pass animation drops INTO it and an arrival comes OUT of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./teammateView', () => ({ enterTeammateView: vi.fn(), exitTeammateView: vi.fn() }));

const { mount } = await import('../renderedText.mount');
const { DuosMateDock } = await import('./DuosMateDock');
const { useVersus } = await import('./versusStore');
const { dragStore } = await import('../dragStore');
const view = await import('./teammateView');
const { playDrop, playEmerge, mateDoor } = await import('./passLob');

const seat = (s: string, userId: string, name: string, hero: string) => ({ seat: s, userId, name, hero });
function setMatch(): void {
  useVersus.setState({
    room: { members: [] },
    match: { group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } }, raw: { seats: [
      seat('p1', 'u1', 'Ann', 'warden'), seat('p2', 'u2', 'Bob', 'warden'), seat('p3', 'u3', 'Cy', 'warden'), seat('p4', 'u4', 'Di', 'warden'),
    ] } } },
  } as never);
}

beforeEach(() => { setMatch(); });
afterEach(() => {
  vi.clearAllMocks();
  dragStore.set({ passOver: null, passReason: null });
  useVersus.setState({ room: null, match: null } as never);
});

describe('the teammate portrait, bottom right', () => {
  it('on my board: my teammate, a pass target; a click watches them', () => {
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      const hold = ui.container.querySelector('[data-duos-mate]');
      expect(hold).not.toBeNull();
      expect(ui.container.querySelector('.duosdock-name')?.textContent).toBe('Bob');
      expect(ui.container.querySelector('.duosdock-disc')).not.toBeNull();
      act(() => { hold!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).toHaveBeenCalledTimes(1);
      expect(view.exitTeammateView).not.toHaveBeenCalled();
    } finally { ui.unmount(); }
  });

  it('while watching: MY portrait, and a click comes back', () => {
    const ui = mount(<DuosMateDock watching />);
    try {
      expect(ui.container.querySelector('.duosdock.self')).not.toBeNull();
      expect(ui.container.querySelector('.duosdock-name')?.textContent).toBe('Ann');
      act(() => { ui.container.querySelector('[data-duos-mate]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
    } finally { ui.unmount(); }
  });

  it('a drag over it: the teal glow for a pass, a red ring and the reason for a refusal', () => {
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      act(() => { dragStore.set({ passOver: 'ok', passReason: null }); });
      expect(ui.container.querySelector('.duosdock')?.className).toContain('pass-ok');
      expect(ui.container.querySelector('.duosdock-glow')).not.toBeNull();
      act(() => { dragStore.set({ passOver: 'no', passReason: 'Their hand is full' }); });
      expect(ui.container.querySelector('.duosdock')?.className).toContain('pass-no');
      expect(ui.container.querySelector('.duosdock-note')?.textContent).toBe('Their hand is full');
    } finally { ui.unmount(); }
  });

  it('the pass goes INTO this portrait and an arrival comes OUT of it (transform / opacity keyframes only)', () => {
    const ui = mount(<DuosMateDock watching={false} />);
    const calls: Keyframe[][] = [];
    const proto = Element.prototype as { animate?: unknown };
    const prev = proto.animate;
    proto.animate = function (frames: Keyframe[]) { calls.push(frames); return { onfinish: null, oncancel: null, finish() {}, cancel() {} }; };
    try {
      expect(mateDoor()?.classList.contains('duosdock-disc')).toBe(true);
      const box = { left: 0, top: 0, width: 100, height: 140 };
      playDrop({ from: box, to: { left: 800, top: 600, width: 200, height: 200 }, face: null, back: 'b.png', coin: false });
      playEmerge({ from: { left: 800, top: 600, width: 200, height: 200 }, to: box, back: 'b.png' });
      expect(calls.length).toBeGreaterThanOrEqual(4);
      for (const frames of calls) for (const f of frames) for (const k of Object.keys(f)) expect(['transform', 'opacity', 'offset']).toContain(k);
      // The drop ends small and gone inside the disc; the arrival starts small and invisible there.
      const drop = calls[0]!;
      expect(drop[drop.length - 1]!.opacity).toBe(0);
      expect(String(drop[drop.length - 1]!.transform)).toMatch(/scale\(0\.1\d*\)/);
      const emerge = calls[2]!;
      expect(emerge[0]!.opacity).toBe(0);
    } finally { proto.animate = prev; ui.unmount(); document.querySelectorAll('.duoslob').forEach((n) => n.remove()); }
  });
});
