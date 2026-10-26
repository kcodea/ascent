// @vitest-environment jsdom
/**
 * THE ROOM OPTIONS WINDOW (owner 2026-10-25: "Improve the room settings layout and center it/darken the background when
 * opened", R-VERSUS-OPTIONS-02): the options open as the game's centered dialog over a dark scrim (the Match details
 * `.mdd-scrim` / `.mdd-panel`), close on the X, a press on the scrim and Esc (each after the one-shot close fade), and
 * are read-only with a plain note for anyone but the host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef: () => null }));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => query() }) };
});

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { versusTestToolsEnabled } = await import('./versusFlag');
const { sfx } = await import('../sfx');
const { VersusRoom } = await import('./VersusRoom');
const { useVersus } = await import('./versusStore');
const { versusRemote } = await import('./versusRemote');
const { VERSUS_OPTIONS_CLOSE_MS } = await import('./versusOptionsUi');
type Room = import('./versusRemote').VersusRoom;
type Role = import('./versusRemote').VersusRole;

const member = (userId: string, role: Role) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const roomOf = (members: ReturnType<typeof member>[]): Room =>
  ({ id: 'r', name: 'Room', host_user_id: 'host', status: 'open', members, current_match_id: null, options: { v: 1, mode: 'duel', modifiers: [] }, options_rev: 1 } as unknown as Room);

beforeEach(() => {
  vi.useFakeTimers();
  (Element.prototype as { animate?: unknown }).animate = function () { return { finish() {}, cancel() {} }; };
  for (const k of ['deny', 'play', 'sell', 'cardTouch', 'pulse', 'gate', 'tick'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useVersus.setState({ room: null, seatMove: null, error: null, screen: 'browser', optionsNotice: null } as never);
  setIdentity(null);
});

function enter(me: string) {
  setIdentity({ userId: me } as never);
  useVersus.setState({ screen: 'room', match: null, error: null, seatMove: null, room: roomOf([member('host', 'p1'), member('b', 'spectator')]) } as never);
  return mount(<VersusRoom />);
}
const click = (el: Element | null | undefined): void => { act(() => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const open = (ui: ReturnType<typeof mount>): void => click(ui.container.querySelector('.vsroommode'));
const settle = (): void => { act(() => { vi.advanceTimersByTime(VERSUS_OPTIONS_CLOSE_MS + 10); }); };
const panel = (): Element | null => document.querySelector('.vsoptions');

describe('Room options window (R-VERSUS-OPTIONS-02)', () => {
  it('opens centered over a dark scrim, as a modal dialog with a Mode and a Modifier section', () => {
    const ui = enter('host');
    try {
      open(ui);
      const scrim = document.querySelector('.mdd-scrim.vsopt-scrim');
      expect(scrim).not.toBeNull();
      expect(scrim!.querySelector('.mdd-panel.vsoptions[role="dialog"][aria-modal="true"]')).not.toBeNull();
      expect([...panel()!.querySelectorAll('.vsopt-h')].map((h) => h.textContent)).toEqual(['Mode', 'Modifier']);
      // Each option names itself and says one plain line; the picked one is lit.
      const on = [...panel()!.querySelectorAll('.vsopt-card.on .vsopt-name')].map((n) => n.textContent);
      expect(on).toEqual(['1v1', 'None']);
      for (const card of panel()!.querySelectorAll('.vsopt-card')) expect(card.querySelector('.vsopt-desc')?.textContent).toBeTruthy();
      expect(panel()!.textContent).not.toMatch(/\u2014|Oath|climb/);
      expect(panel()!.querySelector('[title]')).toBeNull();
    } finally { ui.unmount(); }
  });

  it('closes on the X', () => {
    const ui = enter('host');
    try {
      open(ui);
      click(panel()!.querySelector('.mdd-close'));
      expect(document.querySelector('.vsopt-scrim.closing')).not.toBeNull();
      settle();
      expect(panel()).toBeNull();
    } finally { ui.unmount(); }
  });

  it('closes on a press on the scrim, but not on a press inside the window', () => {
    const ui = enter('host');
    try {
      open(ui);
      act(() => { panel()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
      settle();
      expect(panel()).not.toBeNull();
      act(() => { document.querySelector('.vsopt-scrim')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
      settle();
      expect(panel()).toBeNull();
    } finally { ui.unmount(); }
  });

  it('closes on Esc, and the Esc never reaches anything under it', () => {
    const ui = enter('host');
    const below = vi.fn();
    window.addEventListener('keydown', below);
    try {
      open(ui);
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      settle();
      expect(panel()).toBeNull();
      expect(below).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', below); ui.unmount(); }
  });

  it('the host can pick; everyone else sees every option read-only with the host note', () => {
    const set = vi.spyOn(versusRemote, 'setOptions');
    const ui = enter('b');
    try {
      open(ui);
      expect(panel()!.querySelector('.vsopt-lock')?.textContent).toBe('Only the host can change these.');
      const cards = [...panel()!.querySelectorAll('.vsopt-card')] as HTMLButtonElement[];
      // 3 modes + 3 modifiers; with the Versus test tools on (dev / test builds) the Ranked Duos test mode too.
      expect(cards).toHaveLength(versusTestToolsEnabled() ? 7 : 6);
      expect(cards.every((c) => c.disabled)).toBe(true);
      click(cards.find((c) => c.querySelector('.vsopt-name')?.textContent === '2v2'));
      expect(set).not.toHaveBeenCalled();
    } finally { ui.unmount(); }
    const host = enter('host');
    try {
      open(host);
      expect(panel()!.querySelector('.vsopt-lock')).toBeNull();
      expect(([...panel()!.querySelectorAll('.vsopt-card')] as HTMLButtonElement[]).every((c) => !c.disabled)).toBe(true);
    } finally { host.unmount(); }
  });
});
