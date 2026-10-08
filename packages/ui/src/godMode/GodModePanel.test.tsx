// packages/ui/src/godMode/GodModePanel.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, makeGodModeRun, GOD_MODE_MAX_ROUNDS } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { GodModePanel } from './GodModePanel';
import { placeGodFlyout } from './GodFlyout';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(__dirname, 'godMode.css'), 'utf8');
/** One rule's body, matched at the start of a line (so `.godp-sects` doesn't hit `.godp-filter + .godp-sects`). */
const rule = (sel: string): string => { const i = CSS.indexOf(`\n${sel} {`); return i < 0 ? '' : CSS.slice(i, CSS.indexOf('}', i)); };

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; localStorage.clear(); });
const godRun = () => ({ ...makeGodModeRun(createLobbyRun(3, 'warden', { maxRounds: GOD_MODE_MAX_ROUNDS }, 'practice', { opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [], godMode: true })), phase: 'recruit' as const });
const show = (run: ReturnType<typeof godRun> = godRun()): HTMLElement => { act(() => { useGame.setState({ run }); }); ui = mount(<GodModePanel />); return document.body; };
const sect = (el: HTMLElement, label: string): HTMLButtonElement =>
  [...el.querySelectorAll<HTMLButtonElement>('.godp-sect')].find((b) => b.textContent?.replace('▸', '') === label)!;
const press = (el: HTMLElement, label: string): void => { act(() => { sect(el, label).click(); }); };

describe('GodModePanel', { timeout: 60_000 }, () => {
  it('the panel holds the tier + tribe chips and four list buttons — no list until a button is pressed', () => {
    const el = show();
    expect([...el.querySelectorAll('.godp-sect')].map((b) => b.textContent!.replace('▸', ''))).toEqual(['Minions', 'Spells', 'Runes', 'Epic runes']);
    expect([...el.querySelectorAll('.godp-tier')].map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect([...el.querySelectorAll('.godp-tribe')].some((b) => b.textContent === 'Neutral')).toBe(true);
    expect(el.querySelector('[aria-label="Tier filter"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Tribe filter (minions)"]')).not.toBeNull();
    expect(el.querySelector('.godp-fly')).toBeNull();
    expect(el.querySelector('.godp-row')).toBeNull();
    expect(el.querySelector('.godp .godp-search')).toBeNull(); // nothing in the panel itself scrolls or searches
  });
  it('pressing Minions opens a side window with a focused search + rows; the button reads pressed', () => {
    const el = show();
    press(el, 'Minions');
    const fly = el.querySelector<HTMLElement>('.godp-fly')!;
    expect(fly).not.toBeNull();
    expect(fly.querySelector('.godp-lh')!.textContent).toBe('Minions');
    expect(document.activeElement).toBe(fly.querySelector('.godp-search'));
    expect(fly.querySelectorAll('.godp-row').length).toBeGreaterThan(0);
    expect(sect(el, 'Minions').classList.contains('on')).toBe(true);
    expect(sect(el, 'Minions').getAttribute('aria-expanded')).toBe('true');
  });
  it('clicking a minion row prints it into the shop', () => {
    const el = show();
    press(el, 'Minions');
    const before = useGame.getState().run.shop.length;
    act(() => { el.querySelector<HTMLButtonElement>('[aria-label="Minions"] .godp-row')!.click(); });
    expect(useGame.getState().run.shop.length).toBe(before + 1);
  });
  it('a rune granted from the Runes window lands, with the confirmation', () => {
    const el = show();
    press(el, 'Runes');
    const row = el.querySelector<HTMLButtonElement>('[aria-label="Runes"] .godp-row:not(:disabled)')!;
    act(() => { row.click(); });
    expect((useGame.getState().run.ownedRunes ?? []).length).toBe(1);
    expect(el.querySelector('.godp-toast')!.textContent).toMatch(/^Gained /);
  });
  it('one window at a time: another button switches it; the same button, ✕ and Esc close it', () => {
    const el = show();
    press(el, 'Minions');
    press(el, 'Spells');
    expect(el.querySelectorAll('.godp-fly').length).toBe(1);
    expect(el.querySelector('.godp-fly .godp-lh')!.textContent).toBe('Spells');
    press(el, 'Spells');
    expect(el.querySelector('.godp-fly')).toBeNull();
    press(el, 'Epic runes');
    act(() => { el.querySelector<HTMLButtonElement>('.godp-fly-x')!.click(); });
    expect(el.querySelector('.godp-fly')).toBeNull();
    press(el, 'Runes');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(el.querySelector('.godp-fly')).toBeNull();
  });
  it('collapsing the panel hides the side window too', () => {
    const el = show();
    press(el, 'Minions');
    act(() => { el.querySelector<HTMLButtonElement>('.godp-fold')!.click(); });
    expect(el.querySelector('.godp-fly')).toBeNull();
    expect(el.querySelector('.godp-sect')).toBeNull();
  });
  it('renders nothing outside the shop phase', () => {
    show({ ...godRun(), phase: 'combat' } as unknown as ReturnType<typeof godRun>);
    expect(document.body.querySelector('.godp')).toBeNull();
    expect(document.body.querySelector('.godp-fly')).toBeNull();
  });
  it('is visibly inert while a Discover / quest / Runeforge window owns the screen', () => {
    const el = show({ ...godRun(), questOffer: ['q'] } as ReturnType<typeof godRun>);
    expect(el.querySelector('.godp')!.classList.contains('inert')).toBe(true);
    press(el, 'Minions');
    expect(el.querySelector('.godp-fly')!.classList.contains('inert')).toBe(true);
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.godp-row')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((b) => b.disabled)).toBe(true);
    const before = useGame.getState().run.shop.length;
    act(() => { el.querySelector<HTMLButtonElement>('[aria-label="Minions"] .godp-row')!.click(); });
    expect(useGame.getState().run.shop.length).toBe(before);
  });
  it('greys out under the Ancients offer too (the reducer refuses God Mode actions there)', () => {
    const el = show({ ...godRun(), ancientsEnabled: true, ancients: { ...(godRun().ancients ?? {}), offer: ['x'] } } as unknown as ReturnType<typeof godRun>);
    expect(el.querySelector('.godp')!.classList.contains('inert')).toBe(true);
    press(el, 'Runes');
    expect([...el.querySelectorAll<HTMLButtonElement>('.godp-row')].every((b) => b.disabled)).toBe(true);
  });
  it('a spot saved off-stage (a wider window) renders on-stage, header grabbable', () => {
    localStorage.setItem('ascent.godmode.panel', JSON.stringify({ x: 3000, y: 2000, collapsed: false, tiers: [], tribes: [] }));
    const el = show();
    const panel = el.querySelector<HTMLElement>('.godp')!;
    expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(window.innerWidth - 120);
    expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(window.innerHeight - 40);
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0);
  });
  it('titles: Tier Filter and Tribe Filter in the panel, the open list titled in its window', () => {
    const el = show();
    expect([...el.querySelectorAll('.godp .godp-lh')].map((h) => h.textContent)).toEqual(['Tier Filter', 'Tribe Filter']);
    press(el, 'Epic runes');
    expect(el.querySelector('.godp-fly .godp-lh')!.textContent).toBe('Epic runes');
  });
  it('the header reads GOD MODE; the four list buttons are stacked, one per line, full width', () => {
    const el = show();
    expect(el.querySelector('.godp-head .godp-title')!.textContent).toBe('God Mode');
    const sects = el.querySelector('.godp-sects')!;
    expect([...sects.children].map((b) => b.className.split(' ')[0])).toEqual(['godp-sect', 'godp-sect', 'godp-sect', 'godp-sect']);
    expect([...sects.children].map((b) => b.textContent!.replace('▸', ''))).toEqual(['Minions', 'Spells', 'Runes', 'Epic runes']);
  });
  it('a shop action that leaves owned runes alone does not change the open rune list', () => {
    const el = show();
    press(el, 'Runes');
    const first = el.querySelector('[aria-label="Runes"] .godp-row');
    act(() => { useGame.getState().dispatch({ type: 'godPrint', cardId: useGame.getState().run.shop[0]?.cardId ?? 'sandbag' }); });
    expect(el.querySelector('[aria-label="Runes"] .godp-row')).toBe(first);
  });
  it('tier chips 1-7 sit 3 to a row, and include Tier 7 (which filters)', () => {
    const el = show();
    const tiers = el.querySelector('[aria-label="Tier filter"]')!;
    expect(tiers.classList.contains('godp-tiers')).toBe(true);
    expect(rule('.godp-chips.godp-tiers')).toContain('grid-template-columns: repeat(3, 1fr)');
    act(() => { [...el.querySelectorAll<HTMLButtonElement>('.godp-tier')].find((b) => b.textContent === '7')!.click(); });
    expect(JSON.parse(localStorage.getItem('ascent.godmode.panel')!).tiers).toEqual([7]);
  });
  it('Minions and Spells each take a full row; Runes and Epic runes share one row', () => {
    const el = show();
    const cls = (label: string): DOMTokenList => sect(el, label).classList;
    expect(cls('Minions').contains('wide') && cls('Spells').contains('wide')).toBe(true);
    expect(cls('Runes').contains('half') && cls('Epic runes').contains('half')).toBe(true);
    expect(rule('.godp-sects')).toContain('grid-template-columns: 1fr 1fr');
    expect(rule('.godp-sect.wide')).toContain('grid-column: 1 / -1');
  });
  it('the side window list has the themed (gold on dark) scroll bar', () => {
    expect(rule('.godp-rows, .godp, .godp-fly')).toContain('scrollbar-color: var(--ui-title) var(--ui-chip-bg)');
    expect(rule('.godp-rows::-webkit-scrollbar-thumb')).toContain('var(--ui-title)');
  });
});

describe('placeGodFlyout', () => {
  const vp = { w: 1920, h: 1080 };
  it('sits right of the panel when it fits, top-aligned', () => {
    expect(placeGodFlyout({ x: 24, y: 140, w: 330 }, { w: 300, h: 500 }, vp)).toEqual({ x: 362, y: 140, side: 'right' });
  });
  it('flips to the left when the stage has no room on the right', () => {
    expect(placeGodFlyout({ x: 1500, y: 140, w: 330 }, { w: 300, h: 500 }, vp)).toEqual({ x: 1192, y: 140, side: 'left' });
  });
  it('stays fully on-stage (nudged up off the bottom edge)', () => {
    const p = placeGodFlyout({ x: 24, y: 900, w: 330 }, { w: 300, h: 500 }, vp);
    expect(p.y + 500).toBeLessThanOrEqual(1080 - 8);
    expect(p.x).toBeGreaterThanOrEqual(8);
  });
});
