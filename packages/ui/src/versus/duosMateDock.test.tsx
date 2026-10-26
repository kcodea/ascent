// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE TEAMMATE PORTRAIT, BOTTOM RIGHT (owner 2026-10-25; R-DUOS-VIEW-01, R-DUOS-PASS-01): on my board it
 * is my TEAMMATE (the pass target, a click watches them); while I watch them it is ME (a click comes back). A drag over
 * it glows for a pass and shows the reason for a refusal. A pass streams INTO it and an arrival streams OUT of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./teammateView', () => ({ enterTeammateView: vi.fn(), exitTeammateView: vi.fn() }));

const { mount } = await import('../renderedText.mount');
const { DuosMateDock } = await import('./DuosMateDock');
const { useVersus } = await import('./versusStore');
const { dragStore } = await import('../dragStore');
const view = await import('./teammateView');
const { playDrop, playEmerge, playArrival, isPassArrival, mateDoor, coinPoses, catchFrames } = await import('./passLob');
const { mirrorOfHero, fitDock, DOCK_CAP_SHARE, DOCK_MIN_SHARE, DOCK_RAIL_GAP } = await import('./DuosMateDock');
const { useDuosCombat } = await import('./duosCombat');

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

  it('R-DUOS-PASS-05: the send dissolves the card where it was (transform / opacity only) and lands in this portrait', () => {
    vi.useFakeTimers();
    const ui = mount(<DuosMateDock watching={false} />);
    const calls: Keyframe[][] = [];
    const proto = Element.prototype as { animate?: unknown };
    const prev = proto.animate;
    proto.animate = function (frames: Keyframe[]) { calls.push(frames); return { onfinish: null, oncancel: null, finish() {}, cancel() {} }; };
    try {
      expect(mateDoor()?.classList.contains('duosdock-disc')).toBe(true);
      const face = document.createElement('div');
      face.className = 'card';
      let landed = 0;
      playDrop({ from: { cx: 900, cy: 700, w: 150, h: 230 }, plate: null, to: { left: 800, top: 600, width: 250, height: 250 }, face, coin: false, onLand: () => { landed++; } });
      // The released card's copy fades (no flip: no rotateY anywhere in the pass).
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const frames of calls) for (const f of frames) {
        for (const k of Object.keys(f)) expect(['transform', 'opacity', 'offset']).toContain(k);
        expect(String(f.transform ?? '')).not.toMatch(/rotateY/);
      }
      expect(calls[0]![calls[0]!.length - 1]!.opacity).toBe(0);
      // No FX renderer here (jsdom): the pass still lands, once.
      vi.advanceTimersByTime(2000);
      expect(landed).toBe(1);
    } finally { proto.animate = prev; ui.unmount(); document.querySelectorAll('.duoslob').forEach((n) => n.remove()); vi.useRealTimers(); }
  });

  it('R-DUOS-PASS-05: an arrival is the hand card coalescing in its slot (it is hidden until then, never flipped)', () => {
    vi.useFakeTimers();
    const card = document.createElement('div');
    card.className = 'card';
    document.body.appendChild(card);
    try {
      let landed = 0;
      playEmerge({ from: { left: 800, top: 600, width: 250, height: 250 }, target: card, onLand: () => { landed++; } });
      expect(landed).toBe(1); // no FX renderer: the coalesce starts at once
      // Never left hidden: with no plate on screen to coalesce over (jsdom has no layout), the card simply shows.
      expect(card.style.opacity).toBe('');
      vi.advanceTimersByTime(3000);
      // A pass's arrival is not the generic "generated card" coalesce: the hand stands its own down for it.
      playArrival('u-arrive');
      expect(isPassArrival('u-arrive')).toBe(true);
      vi.advanceTimersByTime(6000);
      expect(isPassArrival('u-arrive')).toBe(false);
    } finally { card.remove(); vi.useRealTimers(); }
  });

  it('R-DUOS-PASS-05: the streams are the two committed Pixi defs (teal, one-shot); the send lands with a ripple on the portrait', () => {
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    const lob = read('passLob.ts');
    expect(lob).not.toMatch(/rotateY/); // owner 2026-10-26: "the flipping around just doesn't look great"
    expect(lob).toMatch(/playDef\('duos-pass-send'/);
    expect(lob).toMatch(/playDef\('duos-pass-arrive'/);
    expect(lob).toMatch(/playPlateCoalesce\(/);
    expect(lob).toMatch(/playPlateDissolve\(/);
    const def = (id: string) => JSON.parse(read(`../fx/defs/${id}.json`)) as { layers: { primitive: string; anchor: string; muted?: boolean }[] };
    const send = def('duos-pass-send'), arrive = def('duos-pass-arrive');
    expect(send.layers.some((l) => l.primitive === 'ribbon' && l.anchor === 'travel')).toBe(true);
    expect(send.layers.some((l) => l.primitive === 'shockwave' && l.anchor === 'target' && !l.muted)).toBe(true); // the portrait ripple
    expect(arrive.layers.some((l) => l.primitive === 'ribbon' && l.anchor === 'travel')).toBe(true);
    // The arrival's landing is the card's own coalesce: its target bursts / ripple stand down.
    expect(arrive.layers.filter((l) => l.anchor === 'target' && l.primitive !== 'sound').every((l) => l.muted)).toBe(true);
  });

  it('R-DUOS-TAGTEAM-01 (owner 2026-10-26): no "steps in" plate; the foe slot swaps to the live foe', () => {
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    expect(read('duosCombat.tsx')).not.toMatch(/steps in`|DuosTagInPlate/);
    expect(read('../Recruit.tsx')).not.toMatch(/DuosTagInPlate/);
    expect(read('versus.css')).not.toMatch(/\.duostag\b/);
    // The foe slot keys its art by the live foe, and the new face fades in.
    expect(read('../CombatOpponent.tsx')).toMatch(/artKey=\{duosOn && duosFoe && !gauntlet \? `duos:\$\{seat\.id\}` : undefined\}/);
    expect(read('versus.css')).toMatch(/@keyframes duosswapin \{ from \{ opacity: 0; scale: 0\.94; \}/);
  });

  it('R-DUOS-SLOTS-02 (owner 2026-10-26: "the player frame doesn\'t need to swap to the teammate\'s when they come in to attack"): my slot never swaps; the teammate tags in over it', () => {
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    const bar = read('../StatusBar.tsx');
    expect(bar).not.toMatch(/useDuosCombat|duosSelf/);
    expect(bar).toMatch(/heroPortrait\(hero\.id, runSkins\)/);
    // The tag-in: one-shot opacity / scale animations, nothing looping.
    const css = read('versus.css');
    expect(css).toMatch(/@keyframes duostagin \{ from \{ opacity: 0; scale: 0\.88; \} to \{ opacity: 1; scale: 1; \} \}/);
    expect(css).toMatch(/\.duosdock\.tagged \{ opacity: 0; \}/);
    expect(css).not.toMatch(/duostag(in|out)[^;{]*infinite/);
    // Live: while my teammate's board fights on my side, the bottom-right portrait fades out; then it comes back.
    const ui = mount(<DuosMateDock watching={false} inCombat />);
    try {
      expect(ui.container.querySelector('.duosdock.tagged')).toBeNull();
      act(() => { useDuosCombat.setState({ on: true, selfSeatId: 's1', foeSeatId: null, tag: null }); });
      expect(ui.container.querySelector('.duosdock.tagged')).not.toBeNull();
      act(() => { useDuosCombat.setState({ on: true, selfSeatId: null, foeSeatId: null, tag: null }); });
      expect(ui.container.querySelector('.duosdock.tagged')).toBeNull();
    } finally { ui.unmount(); useDuosCombat.setState({ on: false, selfSeatId: null, foeSeatId: null, tag: null }); }
  });

  it('R-DUOS-VIEW-05 (owner 2026-10-26: "we dont need the health there"): no Health box under the teammate', () => {
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      expect(ui.container.querySelector('.duosdock-hp')).toBeNull();
      expect(ui.container.textContent).not.toMatch(/Team Health/);
    } finally { ui.unmount(); }
  });

  it('R-DUOS-VIEW-05 (owner 2026-10-26: "the teammate is behind the lobby rail"): the dock drops to your Health box and shrinks only to clear the rail', () => {
    const stage = { left: 0, top: 0, width: 1920, height: 1080 };
    const hero = { left: 135, top: 1080 - 160 - 270, width: 270, height: 270 };
    const hp = { left: 220, top: 1080 - 100, width: 100, height: 40 }; // its bottom is 60 px up
    const id = (v: number): number => v;
    // A short rail: full size, sitting on the Health box's bottom.
    const free = fitDock(hero, hp, { left: 1500, top: 100, width: 300, height: 300 }, stage, id)!;
    expect([free.d, free.right, free.bottom]).toEqual([270, 135, 60]);
    expect(free.hero).toEqual({ left: 135, bottom: 160, d: 270 });
    // A tall rail (eight rows) ending at y 760: the cap must clear it, so the disc shrinks around its centre.
    const tall = fitDock(hero, hp, { left: 1500, top: 100, width: 300, height: 660 }, stage, id)!;
    const room = 1080 - 60 - 270 * DOCK_CAP_SHARE - 760 - DOCK_RAIL_GAP;
    expect(tall.d).toBeCloseTo(room, 5);
    expect(tall.right).toBeCloseTo(135 + (270 - room) / 2, 5);
    // Never below the floor, however tall the rail.
    expect(fitDock(hero, hp, { left: 1500, top: 0, width: 300, height: 1060 }, stage, id)!.d).toBeCloseTo(270 * DOCK_MIN_SHARE, 5);
    expect(fitDock(null, hp, null, stage, id)).toBeNull();
  });

  it('the coin lands in the portrait and the portrait pop returns exactly to rest', () => {
    const poses = coinPoses(300, 120, 0.3, 0.45);
    const last = poses[poses.length - 1]!;
    expect([Math.round(last.x), Math.round(last.y), last.opacity]).toEqual([300, 120, 0]);
    const pop = catchFrames(1.07).map((f) => Number(/scale\(([\d.]+)\)/.exec(String(f.transform))![1]));
    expect(pop[0]).toBe(1);
    expect(pop[pop.length - 1]).toBe(1);
    expect(Math.max(...pop)).toBeCloseTo(1.07, 2);
  });

  it('R-DUOS-VIEW-03: the teammate portrait mirrors your own (same size, same distance in from the other corner)', () => {
    const stage = { left: 0, top: 0, width: 1920, height: 1080 };
    // Your hero disc: 270 px wide, 135 px in from the left, 93 px up from the bottom.
    const g = mirrorOfHero({ left: 135, top: 1080 - 93 - 270, width: 270, height: 270 }, stage, (v) => v);
    expect(g).toEqual({ d: 270, right: 135, bottom: 93 });
    // A scaled stage converts to stage px; a missing portrait places nothing.
    expect(mirrorOfHero({ left: 67.5, top: 0, width: 135, height: 135 }, { left: 0, top: 0, width: 960, height: 540 }, (v) => v * 2)?.d).toBe(270);
    expect(mirrorOfHero(null, stage, (v) => v)).toBeNull();
  });

  it('R-DUOS-VIEW-02: in combat the portrait stays bottom right as a face only (no click, no pass glow, no note)', () => {
    const ui = mount(<DuosMateDock watching={false} inCombat />);
    try {
      expect(ui.container.querySelector('.duosdock.combat')).not.toBeNull();
      expect(ui.container.querySelector('.duosdock-name')?.textContent).toBe('Bob');
      const hold = ui.container.querySelector('[data-duos-mate]')!;
      expect(hold.getAttribute('role')).toBeNull();
      act(() => { hold.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).not.toHaveBeenCalled();
      act(() => { dragStore.set({ passOver: 'no', passReason: 'Passing is closed' }); });
      expect(ui.container.querySelector('.duosdock')?.className).not.toContain('pass-');
      expect(ui.container.querySelector('.duosdock-note')).toBeNull();
    } finally { ui.unmount(); }
  });
});
