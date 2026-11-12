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
const { mirrorOfHero, fitDock, fitFoot, DOCK_CAP_SHARE, DOCK_MIN_SHARE, DOCK_RAIL_GAP, DOCK_FOOT_MAX, DOCK_FOOT_MIN, DOCK_HAND_SPILL } = await import('./DuosMateDock');
const { useDuosCombat, duosLiveAt } = await import('./duosCombat');

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
      // No name pill and no "Teammate" cap (R-DUOS-DOCK-FOOT-01); the name lives in the label for screen readers.
      expect(ui.container.querySelector('.duosdock-name')).toBeNull();
      expect(ui.container.querySelector('.duosdock-cap')).toBeNull();
      expect(hold!.getAttribute('aria-label')).toContain('Bob, your teammate');
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
      expect(ui.container.querySelector('.duosdock-name')).toBeNull();
      expect(ui.container.querySelector('.duosdock-cap')?.textContent).toBe('Back to your board'); // the way back stays
      act(() => { ui.container.querySelector('[data-duos-mate]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
    } finally { ui.unmount(); }
  });

  it('R-DUOS-BACK-TAP-01: a finger tap on "Back to your board" comes back once; the click that follows the tap never re-enters', () => {
    const clock = vi.spyOn(performance, 'now');
    let ui = mount(<DuosMateDock watching />);
    try {
      clock.mockReturnValue(100_000);
      const up = new Event('pointerup', { bubbles: true });
      Object.defineProperty(up, 'pointerType', { value: 'touch' });
      act(() => { ui.container.querySelector('.duosdock')!.dispatchEvent(up); });
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
      // The view is left: the portrait re-renders as the TEAMMATE's (a click on it watches them)...
      ui.unmount();
      ui = mount(<DuosMateDock watching={false} />);
      // ...and the tap's own click arrives 40 ms later, on that fresh portrait. It is the same gesture: swallowed.
      clock.mockReturnValue(100_040);
      act(() => { ui.container.querySelector('[data-duos-mate]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).not.toHaveBeenCalled();
      expect(view.exitTeammateView).toHaveBeenCalledTimes(1);
      // A later, separate tap or click does enter.
      clock.mockReturnValue(100_900);
      act(() => { ui.container.querySelector('[data-duos-mate]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).toHaveBeenCalledTimes(1);
    } finally { ui.unmount(); clock.mockRestore(); }
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
    // 2026-11-12: also when the fight alone says their second board is up (no match: the Scene Builder), and the slot
    // takes that player's BOARD too (runes, buffs, tier), not only the face.
    expect(read('../CombatOpponent.tsx')).toMatch(/artKey=\{duosOn && \(duosFoe \|\| foeTagged\) && !gauntlet \? `duos:\$\{seat\.id\}` : undefined\}/);
    expect(read('../CombatOpponent.tsx')).toContain('board: seatBoardThisRound(lobby, duosSeat) ?? forcedFoe.board');
    expect(read('versus.css')).toMatch(/@keyframes duosswapin \{ from \{ opacity: 0; scale: 0\.94; \}/);
  });

  // R-DUOS-FIGHTER-VIEW-01 (owner 2026-11-12, replacing R-DUOS-SLOTS-02): "only show the player's portrait that is
  // fighting in the left side area. keep the teammate/player not fighting in the teammate pass area ... when the
  // teammates swap, have them slide/drop into their places. if a teammate is dead, grey out their portrait".
  it('R-DUOS-FIGHTER-VIEW-01: the hero slot follows the fighter, the dock holds the other one, greyed when their board fell', () => {
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    const bar = read('../StatusBar.tsx');
    expect(bar).toContain('useDuosCombat((s) => (s.on && s.mateLive ? s.fighter : null))');
    expect(bar).toContain('<QuestBadges run={duosFighterRun ?? undefined} />');
    // The slide: one-shot, transform only, nothing looping; the old overlay copy is gone.
    const css = read('versus.css');
    expect(css).toContain('.statusbar .hero .herolunge.duosslide { animation: duosslidehero 0.46s');
    expect(css).toContain('.duosdock.duosslide .duosdock-hold { animation: duosslidedock 0.46s');
    expect(css).not.toMatch(/duosslide(hero|dock)[^;{]*infinite/);
    expect(css).not.toContain('.duostagin {');
    expect(css).toContain('.duosdock.fallen .duosdock-disc { filter: grayscale(1)');
    expect(read('DuosMateDock.tsx')).not.toContain('function DuosTagIn');
    // Live: the dock stays on screen through a fight (a pass needs its target) and greys when its player's board fell.
    const ui = mount(<DuosMateDock watching={false} inCombat />);
    const idle = { on: false, selfSeatId: null, foeSeatId: null, tag: null, mateLive: false, meFallen: false, mateFallen: false, swaps: 0, slideSeq: 0 };
    try {
      expect(ui.container.querySelector('.duosdock [data-duos-mate]')).not.toBeNull();
      expect(ui.container.querySelector('.duosdock.fallen')).toBeNull();
      // my teammate led and their board fell: they wait here, greyed, while mine fights
      act(() => { useDuosCombat.setState({ ...idle, on: true, mateFallen: true, swaps: 1 }); });
      expect(ui.container.querySelector('.duosdock.fallen')).not.toBeNull();
      expect(ui.container.querySelector('.duosdock [data-duos-mate]')).not.toBeNull();
      // my board fell and theirs is up: I stand here, greyed (the pass target is still here)
      act(() => { useDuosCombat.setState({ ...idle, on: true, mateLive: true, meFallen: true, swaps: 1 }); });
      expect(ui.container.querySelector('.duosdock.fallen')).not.toBeNull();
      act(() => { useDuosCombat.setState({ ...idle, on: true, mateLive: true, swaps: 1 }); });
      expect(ui.container.querySelector('.duosdock.fallen')).toBeNull();
    } finally { ui.unmount(); useDuosCombat.setState({ ...idle, fighter: null }); }
  });

  it('duosLiveAt: who is fighting on my side, from the result alone (no match needed)', () => {
    const tag = (member: number) => ({ type: 'tagIn', side: 'player', member, minions: [] });
    const fell = (member: number) => ({ type: 'boardFallen', side: 'player', member });
    const foe = { type: 'tagIn', side: 'enemy', member: 1, minions: [] };
    const ev = [fell(0), tag(1), foe] as never[];
    expect(duosLiveAt({ duosMember: undefined, tagTeam: undefined }, ev, 3)).toBeNull(); // not a tag-team fight
    // my board fought first (member 0): before the hand-off I am live; after it my teammate is, and I have fallen
    expect(duosLiveAt({ duosMember: 0, tagTeam: undefined }, ev, 0)).toEqual({ mateLive: false, meFallen: false, mateFallen: false, swaps: 0, foeTagged: false });
    expect(duosLiveAt({ duosMember: 0, tagTeam: undefined }, ev, 3)).toEqual({ mateLive: true, meFallen: true, mateFallen: false, swaps: 1, foeTagged: true });
    // I was the reserve (member 1): my teammate opens, then their board falls and mine steps in
    expect(duosLiveAt({ duosMember: 1, tagTeam: undefined }, ev, 0)).toEqual({ mateLive: true, meFallen: false, mateFallen: false, swaps: 0, foeTagged: false });
    expect(duosLiveAt({ duosMember: 1, tagTeam: undefined }, ev, 3)).toEqual({ mateLive: false, meFallen: false, mateFallen: true, swaps: 1, foeTagged: true });
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
      expect(ui.container.querySelector('.duosdock-name')).toBeNull();
      const hold = ui.container.querySelector('[data-duos-mate]')!;
      expect(hold.getAttribute('aria-label')).toBe('Bob, your teammate.');
      expect(hold.getAttribute('role')).toBeNull();
      act(() => { hold.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(view.enterTeammateView).not.toHaveBeenCalled();
      act(() => { dragStore.set({ passOver: 'no', passReason: 'Passing is closed' }); });
      expect(ui.container.querySelector('.duosdock')?.className).not.toContain('pass-');
      expect(ui.container.querySelector('.duosdock-note')).toBeNull();
    } finally { ui.unmount(); }
  });
});

describe(`R-DUOS-DOCK-FOOT-01: larger, at the rail's foot (owner 2026-10-31: "larger and better positioned so that it's easier to see and access")`, () => {
  // The 1920x1080 layout the headless pass measured: hero disc 266, Gold coin, the rail's last tile and tab, the
  // Compendium + gear pair, and a full hand's row.
  const stage = { left: 0, top: 0, width: 1920, height: 1080 };
  const id = (v: number): number => v;
  const b = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
  const hero = b(38, 712, 266, 266);
  const foot = { seats: b(1610, 716, 198, 59), coin: b(1535, 662, 113, 113), tab: b(1768, 784, 36, 61), book: b(1817, 1026, 38, 38), gear: b(1866, 1026, 38, 38), hand: b(366, 770, 1188, 254) };
  const blocks = [foot.seats, foot.coin, foot.tab, foot.book, foot.gear];
  it("fills the room right of the hand, its bottom on the gear's baseline, touching nothing around it", () => {
    const g = fitFoot(hero, foot, stage, id)!;
    expect(g).not.toBeNull();
    const cx = 1920 - g.right - g.d / 2;
    const cy = 1080 - g.bottom - g.d / 2;
    expect(1080 - g.bottom).toBeCloseTo(1064, 6); // the gear's bottom
    expect(cx - g.d / 2).toBeGreaterThanOrEqual(366 + 1188 + DOCK_HAND_SPILL - 0.01); // clear of a full hand
    for (const k of blocks) {
      const dx = Math.max(k.left - cx, 0, cx - (k.left + k.width));
      const dy = Math.max(k.top - cy, 0, cy - (k.top + k.height));
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(g.d / 2 + DOCK_RAIL_GAP - 0.01);
    }
    expect(g.d).toBeGreaterThan(266 * 0.6); // larger than the old rail-squeezed disc (0.55 of yours)
    expect(g.d).toBeLessThanOrEqual(266 * DOCK_FOOT_MAX + 0.01);
  });
  it('with room to spare it stops at DOCK_FOOT_MAX of your own disc; missing pieces fall back to fitDock (null)', () => {
    const open = fitFoot(hero, { ...foot, seats: null, tab: null, coin: b(1535, 400, 113, 113) }, stage, id)!;
    expect(open.d).toBeCloseTo(266 * DOCK_FOOT_MAX, 6);
    expect(fitFoot(hero, { ...foot, coin: null }, stage, id)).toBeNull();
    expect(fitFoot(null, foot, stage, id)).toBeNull();
    // No room at all (the hand's row reaches the stage edge): null, never a speck.
    expect(fitFoot(hero, { ...foot, hand: b(366, 770, 1500, 254) }, stage, id)).toBeNull();
  });
  it('R-DUOS-DOCK-INBOARD-01 (owner 2026-11-10: "The menu etc buttons should not be before the teammate circle. They should be fully cornered."): on a phone the disc sits just left of the corner squares, never in the corner outside them', () => {
    // The phone game the headless pass measured (layout 2208 x 1021), the squares out at the screen's wall
    // (R-PHONE-CORNER-WALL-01): Compendium 2053..2119, gear 2127..2193, Guides above the gear; the rail's last tile ends
    // at y 770, a full hand's row at x 1733.
    const pStage = { left: 0, top: 0, width: 2208, height: 1021 };
    const pHero = b(171, 694, 266, 266);
    const pFoot = { seats: b(1750, 715, 250, 55), coin: b(1668, 645, 113, 113), tab: b(2127, 811, 66, 66), book: b(2053, 885, 66, 66), gear: b(2127, 885, 66, 66), hand: b(545, 722, 1188, 255) };
    const box = (g: { d: number; right: number; bottom: number }) => { const right = 2208 - g.right; return { left: right - g.d, right, cx: right - g.d / 2, cy: 1021 - g.bottom - g.d / 2 }; };
    const g = fitFoot(pHero, pFoot, pStage, id, 'squares')!;
    expect(g).not.toBeNull();
    const at = box(g);
    expect(at.right).toBeLessThanOrEqual(2053 - DOCK_RAIL_GAP + 0.01); // left of the Compendium square, the gap kept
    expect(at.right).toBeGreaterThan(2053 - DOCK_RAIL_GAP - 4.01); // ...and right beside it (the slide's 4 px step)
    expect(at.left).toBeGreaterThanOrEqual(545 + 1188 + DOCK_HAND_SPILL + 100); // a full hand's last card is well clear
    expect(1021 - g.bottom).toBeCloseTo(951, 6); // on the squares' baseline
    for (const k of [pFoot.seats, pFoot.coin, pFoot.tab, pFoot.book, pFoot.gear]) {
      const dx = Math.max(k.left - at.cx, 0, at.cx - (k.left + k.width));
      const dy = Math.max(k.top - at.cy, 0, at.cy - (k.top + k.height));
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(g.d / 2 + DOCK_RAIL_GAP - 0.01);
    }
    // As large as the room under the rail allows: about its old corner size (157), far above the floor.
    expect(g.d).toBeGreaterThan(150);
    expect(g.d).toBeGreaterThanOrEqual(266 * DOCK_FOOT_MIN);
    expect(DOCK_FOOT_MIN).toBe(0.4);
    // The same room hugged from the hand's side (the desktop rule) is the same size, on the other side of it.
    const h = fitFoot(pHero, pFoot, pStage, id)!;
    expect(h.d).toBeCloseTo(g.d, 1);
    expect(box(h).left).toBeLessThan(at.left - 100);
    // Squares still at the play box's edge with the screen's corner free beyond them (before the wall move): never out there.
    const old = fitFoot(pHero, { ...pFoot, tab: b(1964, 811, 66, 66), book: b(1890, 885, 66, 66), gear: b(1964, 885, 66, 66) }, pStage, id, 'squares');
    if (old) expect(box(old).right).toBeLessThanOrEqual(1890);
    // DESKTOP is untouched: the default is the hand's side, and the fit there was already left of the squares.
    const d = fitFoot(hero, foot, stage, id)!;
    expect(1920 - d.right).toBeLessThanOrEqual(1817);
    expect(readFileSync(join(__dirname, 'DuosMateDock.tsx'), 'utf8')).toContain("document.documentElement.hasAttribute('data-phone-zoom') ? 'squares' : 'hand'");
  });
});
