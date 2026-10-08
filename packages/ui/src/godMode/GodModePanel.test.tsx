// packages/ui/src/godMode/GodModePanel.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, makeGodModeRun, GOD_MODE_MAX_ROUNDS } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { GodModePanel } from './GodModePanel';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; localStorage.clear(); });
const godRun = () => ({ ...makeGodModeRun(createLobbyRun(3, 'warden', { maxRounds: GOD_MODE_MAX_ROUNDS }, 'practice', { opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [], godMode: true })), phase: 'recruit' as const });
const show = (): HTMLElement => { act(() => { useGame.setState({ run: godRun() }); }); ui = mount(<GodModePanel />); return document.body; };

describe('GodModePanel', { timeout: 60_000 }, () => {
  it('has the four lists and the tier + tribe chips (Neutral chip, spells ignore tribe)', () => {
    const el = show();
    for (const label of ['Minions', 'Spells', 'Runes', 'Epic runes']) expect(el.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect([...el.querySelectorAll('.godp-tier')].map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect([...el.querySelectorAll('.godp-tribe')].some((b) => b.textContent === 'Neutral')).toBe(true);
  });
  it('clicking a minion prints it into the shop', () => {
    const el = show();
    const before = useGame.getState().run.shop.length;
    const row = el.querySelector<HTMLButtonElement>('[aria-label="Minions"] .godp-row')!;
    act(() => { row.click(); });
    expect(useGame.getState().run.shop.length).toBe(before + 1);
  });
  it('clicking a rune grants it', () => {
    const el = show();
    const row = el.querySelector<HTMLButtonElement>('[aria-label="Runes"] .godp-row:not(:disabled)')!;
    act(() => { row.click(); });
    expect((useGame.getState().run.ownedRunes ?? []).length).toBe(1);
  });
  it('renders nothing outside the shop phase', () => {
    act(() => { useGame.setState({ run: { ...godRun(), phase: 'combat' } }); });
    ui = mount(<GodModePanel />);
    expect(document.body.querySelector('.godp')).toBeNull();
  });
  it('is visibly inert while a Discover / quest / Runeforge window owns the screen', () => {
    act(() => { useGame.setState({ run: { ...godRun(), questOffer: ['q'] } as ReturnType<typeof godRun> }); });
    ui = mount(<GodModePanel />);
    const el = document.body;
    expect(el.querySelector('.godp')!.classList.contains('inert')).toBe(true);
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.godp-row')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((b) => b.disabled)).toBe(true);
    const before = useGame.getState().run.shop.length;
    act(() => { el.querySelector<HTMLButtonElement>('[aria-label="Minions"] .godp-row')!.click(); });
    expect(useGame.getState().run.shop.length).toBe(before);
  });
  it('greys out under the Ancients offer too (the reducer refuses God Mode actions there)', () => {
    act(() => { useGame.setState({ run: { ...godRun(), ancientsEnabled: true, ancients: { ...(godRun().ancients ?? {}), offer: ['x'] } } as unknown as ReturnType<typeof godRun> }); });
    ui = mount(<GodModePanel />);
    expect(document.body.querySelector('.godp')!.classList.contains('inert')).toBe(true);
    expect([...document.body.querySelectorAll<HTMLButtonElement>('.godp-row')].every((b) => b.disabled)).toBe(true);
  });
  it('a spot saved off-stage (a wider window) renders on-stage, header grabbable', () => {
    localStorage.setItem('ascent.godmode.panel', JSON.stringify({ x: 3000, y: 2000, collapsed: false, tiers: [], tribes: [] }));
    const el = show();
    const panel = el.querySelector<HTMLElement>('.godp')!;
    expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(window.innerWidth - 120);
    expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(window.innerHeight - 40);
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0);
  });
});
