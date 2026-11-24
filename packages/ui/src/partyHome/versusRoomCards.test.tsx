// @vitest-environment jsdom
/**
 * THE VERSUS ROOM'S SEATS ARE SHOWCASE CARDS (2026-11-23, PR 2 of the showcase card). Pinned:
 *  - MIRRORING IS BY POSITION: the seat right of the VS mark in a 1v1 (p2) and the right-hand Duos column (p3, p4) face
 *    the VS mark; Group has no VS mark and never mirrors.
 *  - THE EYEBROW is the Versus record ("3W 1L"); no record reads empty.
 *  - THE CARD'S MEMO HOLDS (R-VERSUS-ROOM-MOUNTED-01's perf contract): the room re-renders often (every poll, every drag
 *    zone change), so a seat re-render with unchanged seat data (new pools object, new menu items, new callbacks, a new
 *    but equal rank) never re-renders its card; a real change (Health moved, the menu opened) does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, memo } from 'react';
import type { PhShowcaseCardProps } from './kit/PhShowcaseCard';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

// Count the card's real renders: the same memo as the kit's, around the kit's own render function.
const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock('./kit/PhShowcaseCard', async (orig) => {
  const real = await orig<typeof import('./kit/PhShowcaseCard')>();
  const Inner = (real.PhShowcaseCard as unknown as { type: (p: PhShowcaseCardProps) => JSX.Element }).type;
  return { ...real, PhShowcaseCard: memo((p: PhShowcaseCardProps) => { renders.n++; return Inner(p); }) };
});

const { mount } = await import('../renderedText.mount');
const { recordEyebrow, roomMenuRight, roomMirrored, SeatBanner } = await import('./versusRoomHome');

describe('roomMirrored: by position, facing the VS mark', () => {
  it('a 1v1 mirrors the far seat (p2) only', () => {
    expect(roomMirrored('duel', 'p2')).toBe(true);
    expect(roomMirrored('duel', 'p1')).toBe(false);
  });
  it('Duos mirrors the right-hand column (p3, p4) only', () => {
    expect(roomMirrored('duos', 'p3')).toBe(true);
    expect(roomMirrored('duos', 'p4')).toBe(true);
    expect(roomMirrored('duos', 'p2')).toBe(false);
    expect(roomMirrored('duos', 'p1')).toBe(false);
  });
  it('Group has no VS mark and never mirrors', () => {
    for (const s of ['p1', 'p2', 'p3', 'p4'] as const) expect(roomMirrored('group', s)).toBe(false);
  });
});

describe('roomMenuRight: the left column opens its menu toward the stage', () => {
  it('a 1v1: p1; Group 2 x 2: p1 and p3; Duos: team 1 (p1, p2)', () => {
    const seats = ['p1', 'p2', 'p3', 'p4'] as const;
    expect(seats.slice(0, 2).map((s) => roomMenuRight('duel', s))).toEqual([true, false]);
    expect(seats.map((s) => roomMenuRight('group', s))).toEqual([true, false, true, false]);
    expect(seats.map((s) => roomMenuRight('duos', s))).toEqual([true, true, false, false]);
  });
});

describe('recordEyebrow', () => {
  it('reads the Versus record as "3W 1L"; no record reads empty', () => {
    expect(recordEyebrow({ wins: 3, losses: 1 })).toBe('3W 1L');
    expect(recordEyebrow({ wins: 0, losses: 0 })).toBe('0W 0L');
    expect(recordEyebrow(null)).toBe('');
  });
});

describe("a seat's card keeps its memo across room re-renders", () => {
  const member = { userId: 'them', displayName: 'Orangez', profile: {}, role: 'p2' as const, lastSeenAt: '' };
  const server = { record: { wins: 3, losses: 1 }, rank: { divisionIndex: 4, points: 20 } };
  const toggles: string[] = [];
  // Every call builds FRESH objects and closures, exactly as the room's render does.
  const props = (over: { health?: number; menuOpen?: boolean; tag?: string } = {}) => ({
    side: 'p2' as const, i: 1, size: 'half' as const, mirrored: true, m: member, rival: true,
    rank: { divisionIndex: 4, points: 20 }, server, thumb: false, host: true, over: '', hidden: false,
    pools: { health: over.health ?? 30, armor: 5 }, sealed: false, draggable: false, onPointerDown: () => undefined,
    items: [{ label: 'Add friend', run: () => undefined }], menuOpen: over.menuOpen ?? false,
    onToggleMenu: () => { toggles.push(over.tag ?? 'x'); }, onPick: (run: () => void) => run(),
  });
  afterEach(() => { renders.n = 0; toggles.length = 0; });

  it('unchanged seat data: no card re-render; a changed Health or an opened menu: one', () => {
    const ui = mount(<SeatBanner {...props()} />);
    try {
      expect(renders.n).toBe(1);
      const card = ui.container.querySelector('.phs-card')!;
      expect(card.classList.contains('vsr-seat')).toBe(true);
      expect(card.classList.contains('vsr-s-p2')).toBe(true);
      expect(card.classList.contains('phs-mirrored')).toBe(true);
      expect(card.classList.contains('phs-rival')).toBe(true);
      expect(card.classList.contains('ph-menuright')).toBe(false);
      expect(ui.container.querySelector('.phs-eyebrow')?.textContent).toBe('3W 1L');
      expect(ui.container.querySelector('.phs-band.t-pools .vsr-hp')?.getAttribute('aria-label')).toBe('Health 30, Armor 5');
      expect(ui.container.querySelector('.phs-badge')?.textContent).toBe('Host');
      // The drag handle wraps the card.
      expect(ui.container.firstElementChild?.classList.contains('vsr-dragwrap')).toBe(true);

      ui.render(<SeatBanner {...props()} />);
      ui.render(<SeatBanner {...props({ tag: 'latest' })} />);
      expect(renders.n).toBe(1);
      // The stable press still reaches the LATEST handler.
      act(() => { ui.container.querySelector<HTMLButtonElement>('.phs-press')!.click(); });
      expect(toggles).toEqual(['latest']);

      ui.render(<SeatBanner {...props({ health: 29 })} />);
      expect(renders.n).toBe(2);
      expect(ui.container.querySelector('.vsr-hp')?.getAttribute('aria-label')).toBe('Health 29, Armor 5');

      ui.render(<SeatBanner {...props({ health: 29, menuOpen: true })} />);
      expect(renders.n).toBe(3);
      expect(ui.container.querySelector('.ph-cardmenu')?.textContent).toBe('Add friend');
      ui.render(<SeatBanner {...props({ health: 29, menuOpen: true })} />);
      expect(renders.n).toBe(3);
    } finally { ui.unmount(); }
  });
});

describe('the left-column mark rides the card itself, inside the drag handle', () => {
  it('a menuRight seat carries ph-menuright on its card (the drag wrapper defeats structural selectors)', () => {
    const member = { userId: 'them', displayName: 'Orangez', profile: {}, role: 'p1' as const, lastSeenAt: '' };
    const ui = mount(<SeatBanner side="p1" i={0} size="half" mirrored={false} menuRight m={member} rival={false} server={undefined} thumb={false} host={false}
      over="" hidden={false} pools={null} sealed={false} draggable={false} onPointerDown={() => undefined} items={[]} menuOpen={false}
      onToggleMenu={() => undefined} onPick={() => undefined} />);
    try {
      const card = ui.container.querySelector('.vsr-dragwrap > .phs-card')!;
      expect(card.classList.contains('ph-menuright')).toBe(true);
    } finally { ui.unmount(); }
  });
});
