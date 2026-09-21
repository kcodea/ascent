// @vitest-environment jsdom
/**
 * THE ROUND RAIL (rework 2026-09-19): one row per round with a Recruit cell and a Combat cell, the current
 * cell highlighted; the Win % column (Power was removed 2026-09-19); collapse to a slim handle; drag from ANY
 * point of the rail (2026-09-20 — a press that travels under the threshold is still a click on the cell).
 * Collapse and drag placement persist per browser and a resize keeps the rail on screen.
 *
 * Driven through the real store + player over a captured bot run, so a change to how the player exposes
 * marks / phase / round info fails here rather than passing against a stub.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import {
  DEFAULT_BOT, combatFrameOf, createLobbyRun, deltaShopFrameOf, reduce, shopFrameOf,
  type ReplayFrame, type ReplayV2, type ShopView,
} from '@game/sim';
import { RoundRail } from './RoundRail';
import { endReplay, replayRoundMarks, startReplay } from './replayPlayer';
import { RAIL_PLACEMENT_KEY, loadRailPlacement } from './railPlacement';
import { useGame } from '../store';
import { mount, type Mounted } from '../renderedText.mount';

function captureBotRun(seed: number, heroId: string, stopAtWave: number): ReplayFrame[] {
  let s = createLobbyRun(seed, heroId);
  const first = shopFrameOf(s, 'turnStart', 0);
  const frames: ReplayFrame[] = [first];
  let lastView: ShopView = first.view;
  let t = 0;
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 4000) {
    if (s.wave >= stopAtWave && s.phase === 'recruit') break;
    const action = DEFAULT_BOT.act(s);
    const next = reduce(s, action);
    if (next === s) break;
    t += 100;
    if (action.type === 'faceOmen' && next.lastCombat) frames.push(combatFrameOf(s, next, t));
    else if (next.phase === 'recruit' && s.phase !== 'recruit') { const kf = shopFrameOf(next, 'turnStart', t); frames.push(kf); lastView = kf.view; }
    else if (next.phase === 'recruit' && s.phase === 'recruit') { const d = deltaShopFrameOf(lastView, next, action.type, t); frames.push(d.frame); lastView = d.view; }
    s = next;
  }
  return frames;
}

const frames = captureBotRun(4242, 'brackus', 4);
const replay: ReplayV2 = {
  version: 2, seed: 4242, heroId: 'brackus', mode: 'lobby', author: 'brackus', patch: 'test', frames,
  result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
};

let ui: Mounted;
const rows = (): HTMLElement[] => [...ui.container.querySelectorAll<HTMLElement>('.roundrail-row')];
const cell = (row: HTMLElement, kind: 'shop' | 'combat'): HTMLButtonElement => row.querySelector<HTMLButtonElement>(`.roundrail-cell.${kind}`)!;
const click = (el: HTMLElement): void => { act(() => { el.click(); }); };
const pointer = (el: HTMLElement, type: string, x: number, y: number): void => {
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); });
};
/** A real press-and-release: the pointer pair, then the click the browser fires after them. */
const press = (el: HTMLElement, from: [number, number], to: [number, number]): void => {
  pointer(el, 'pointerdown', from[0], from[1]);
  if (from[0] !== to[0] || from[1] !== to[1]) pointer(el, 'pointermove', to[0], to[1]);
  pointer(el, 'pointerup', to[0], to[1]);
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: to[0], clientY: to[1], button: 0 })); });
};

beforeEach(() => {
  localStorage.clear();
  act(() => { startReplay(replay); });
  ui = mount(<RoundRail />);
});
afterEach(() => { ui.unmount(); act(() => { endReplay(); }); });

describe('the table', () => {
  it('renders one row per recorded round with a Recruit cell and a Combat cell, plus the four data columns (no Power)', () => {
    const marks = replayRoundMarks();
    expect(rows()).toHaveLength(marks.length);
    const head = [...ui.container.querySelectorAll('.roundrail-head span')].map((s) => s.textContent);
    expect(head).toEqual(['Round', 'Recruit', 'Combat', 'Gold', 'Acts', 'Tier', 'Win %']);
    expect(head, 'the Power column is gone (owner 2026-09-19)').not.toContain('Power');
    for (const [i, row] of rows().entries()) {
      expect(row.querySelector('.roundrail-num')?.textContent).toBe(`R${marks[i]!.wave}`);
      expect(cell(row, 'shop')).not.toBeNull();
      expect(cell(row, 'combat')).not.toBeNull();
      expect(row.querySelectorAll('.roundrail-val')).toHaveLength(4);
    }
    // The open final round (cut at its shop opening) has no fight: its Combat cell is disabled.
    const last = rows().at(-1)!;
    expect(cell(last, 'combat').disabled).toBe(true);
    expect(cell(rows()[0]!, 'combat').disabled).toBe(false);
  });

  it('highlights the cell playback is in, and clicking the other cell moves it there', () => {
    const r1 = rows()[0]!;
    expect(cell(r1, 'shop').classList.contains('active'), 'frame 0 is round 1\'s shop').toBe(true);
    expect(cell(r1, 'combat').classList.contains('active')).toBe(false);
    click(cell(r1, 'combat'));
    expect(useGame.getState().replaySession?.index).toBe(replayRoundMarks()[0]!.combatIndex);
    expect(cell(rows()[0]!, 'combat').classList.contains('active')).toBe(true);
    expect(cell(rows()[0]!, 'shop').classList.contains('active')).toBe(false);
    click(cell(rows()[1]!, 'shop'));
    expect(useGame.getState().replaySession?.round).toBe(2);
    expect(cell(rows()[1]!, 'shop').classList.contains('active')).toBe(true);
    expect(cell(rows()[0]!, 'combat').classList.contains('active')).toBe(false);
  });

  it('Win % (the last data column) reads "—" until a value lands', () => {
    const vals = (row: HTMLElement): string[] => [...row.querySelectorAll('.roundrail-val')].map((v) => v.textContent ?? '');
    for (const row of rows()) {
      const [, , , win] = vals(row);
      expect(win).toBe('—');
    }
  });
});

describe('collapse + drag (persisted)', () => {
  it('collapses to a slim handle naming the current round, and the state persists across a remount', () => {
    click(ui.container.querySelector<HTMLElement>('.roundrail-toggle')!);
    expect(ui.container.querySelector('.roundrail-mini')).not.toBeNull();
    expect(ui.container.querySelector('.roundrail-grid')).toBeNull();
    expect(ui.container.querySelector('.roundrail-mini-round')?.textContent).toContain('R1');
    expect(loadRailPlacement().collapsed).toBe(true);
    ui.unmount();
    ui = mount(<RoundRail />);
    expect(ui.container.querySelector('.roundrail-mini'), 'remounted collapsed').not.toBeNull();
    click(ui.container.querySelector<HTMLElement>('.roundrail-toggle')!);
    expect(ui.container.querySelector('.roundrail-grid')).not.toBeNull();
    expect(loadRailPlacement().collapsed).toBe(false);
  });

  it('dragging from the grip moves the rail by the pointer delta, writes the offset as CSS vars, and persists it', () => {
    const grab = ui.container.querySelector<HTMLElement>('.roundrail-grab')!;
    const wrap = ui.container.querySelector<HTMLElement>('.roundrail-wrap')!;
    pointer(grab, 'pointerdown', 100, 100);
    pointer(grab, 'pointermove', 160, 130);
    pointer(grab, 'pointerup', 160, 130);
    // jsdom lays nothing out (rect 0×0 at 0,0; viewport 1024×768) — the clamp keeps min(40, size) = 0 px
    // visible, so the delta lands unclamped here.
    expect(wrap.style.getPropertyValue('--rrl-dx')).toBe('60px');
    expect(wrap.style.getPropertyValue('--rrl-dy')).toBe('30px');
    const saved = JSON.parse(localStorage.getItem(RAIL_PLACEMENT_KEY)!);
    expect(saved).toMatchObject({ dx: 60, dy: 30 });
    // A remount restores the placement.
    ui.unmount();
    ui = mount(<RoundRail />);
    expect(ui.container.querySelector<HTMLElement>('.roundrail-wrap')!.style.getPropertyValue('--rrl-dx')).toBe('60px');
  });

  it('a resize pulls a rail parked off the far edge back on screen', () => {
    localStorage.setItem(RAIL_PLACEMENT_KEY, JSON.stringify({ dx: 99_999, dy: 0, collapsed: false }));
    ui.unmount();
    // jsdom lays nothing out, so stand in for the measurement: the rail's box sits 5000 px in under that offset.
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({ left: 5000, top: 100, width: 300, height: 400, right: 5300, bottom: 500, x: 5000, y: 100, toJSON: () => ({}) }) as DOMRect;
    try {
      ui = mount(<RoundRail />);
      act(() => { window.dispatchEvent(new Event('resize')); });
    } finally {
      Element.prototype.getBoundingClientRect = orig;
    }
    const p = loadRailPlacement();
    // Pulled back by the overhang (the stub keeps reporting 5000, so the mount pass and the resize pass each pull
    // once — what matters is that a resize re-clamps and persists).
    expect(p.dx).toBeLessThan(99_999);
    expect(p.dx).toBe(99_999 + 2 * (window.innerWidth - 40 - 5000));
  });
});

describe('drag from anywhere (owner 2026-09-20)', () => {
  it('a press on a CELL that travels past the threshold drags the rail — and the click that follows does NOT seek', () => {
    const wrap = ui.container.querySelector<HTMLElement>('.roundrail-wrap')!;
    const combat = cell(rows()[0]!, 'combat');
    const before = useGame.getState().replaySession?.index;
    press(combat, [100, 100], [160, 130]);
    expect(wrap.style.getPropertyValue('--rrl-dx')).toBe('60px');
    expect(wrap.style.getPropertyValue('--rrl-dy')).toBe('30px');
    expect(JSON.parse(localStorage.getItem(RAIL_PLACEMENT_KEY)!)).toMatchObject({ dx: 60, dy: 30 });
    expect(useGame.getState().replaySession?.index, 'the drag-release click is swallowed').toBe(before);
    expect(wrap.classList.contains('dragging')).toBe(false);
  });

  it('a press on a cell that does NOT travel (or travels under 4 px) is a click: the cell still seeks and the rail stays put', () => {
    const wrap = ui.container.querySelector<HTMLElement>('.roundrail-wrap')!;
    press(cell(rows()[0]!, 'combat'), [100, 100], [100, 100]);
    expect(useGame.getState().replaySession?.index).toBe(replayRoundMarks()[0]!.combatIndex);
    expect(wrap.style.getPropertyValue('--rrl-dx')).toBe('0px');
    press(cell(rows()[1]!, 'shop'), [100, 100], [102, 103]); // a 2-3 px wobble is still a click
    expect(useGame.getState().replaySession?.round).toBe(2);
    expect(wrap.style.getPropertyValue('--rrl-dx')).toBe('0px');
    expect(localStorage.getItem(RAIL_PLACEMENT_KEY)).toBeNull();
  });

  it('the title bar, a data cell and the collapsed handle all drag too', () => {
    const wrap = ui.container.querySelector<HTMLElement>('.roundrail-wrap')!;
    press(ui.container.querySelector<HTMLElement>('.roundrail-title')!, [0, 0], [10, 0]);
    expect(wrap.style.getPropertyValue('--rrl-dx')).toBe('10px');
    press(rows()[0]!.querySelector<HTMLElement>('.roundrail-val')!, [0, 0], [0, 20]);
    expect(wrap.style.getPropertyValue('--rrl-dy')).toBe('20px');
    // Collapse (a plain click on the toggle still works), then drag the mini handle.
    press(ui.container.querySelector<HTMLElement>('.roundrail-toggle')!, [5, 5], [5, 5]);
    expect(ui.container.querySelector('.roundrail-mini')).not.toBeNull();
    // (Rightwards: jsdom's 0×0 rect sits at the origin, so a leftward move is clamped back on screen.)
    press(ui.container.querySelector<HTMLElement>('.roundrail-mini-round')!, [0, 0], [8, 0]);
    expect(ui.container.querySelector<HTMLElement>('.roundrail-wrap')!.style.getPropertyValue('--rrl-dx')).toBe('18px');
  });
});
