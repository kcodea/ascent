// @vitest-environment jsdom
/**
 * PRACTICE'S DEV SET PICKER (owner 2026-10-26: "can you add a dev only practice option in sandbox to select the set to
 * practice with? this would then just use the bot runs for that sandbox test environment."). The dev-only Set row on
 * the Practice screen, and the store seam that carries the pick onto the run (and never into a player build).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SETS, activeSet, type SetId } from '@game/content';
import { practiceTribeOptions, type PracticeConfig } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { useGame } from './store';
import { PracticeOptions } from './PracticeOptions';

const LIVE: SetId = activeSet().id;
const DEV: SetId = (Object.keys(SETS) as SetId[]).find((id) => id !== LIVE)!;

let ui: Mounted | null = null;
afterEach(() => {
  ui?.unmount(); ui = null;
  vi.unstubAllEnvs();
  act(() => { useGame.getState().setPracticeDraft({ setId: undefined, tribes: [], godMode: false }); });
});
const open = (draft: Partial<PracticeConfig> = {}): HTMLElement => {
  act(() => { useGame.setState({ practiceSetupOpen: true, practiceDraft: { ...useGame.getState().practiceDraft, godMode: false, rank: 'all', tribes: [], setId: undefined, ...draft } }); });
  ui = mount(<PracticeOptions />);
  return ui.container;
};
const row = (el: HTMLElement, label: string): HTMLElement | undefined =>
  [...el.querySelectorAll<HTMLElement>('.porow')].find((r) => r.querySelector('.poseg')?.getAttribute('aria-label') === label);
const buttons = (el: HTMLElement, label: string) => [...(row(el, label)?.querySelectorAll<HTMLButtonElement>('.poseg-btn') ?? [])];
const lit = (el: HTMLElement, label: string) => buttons(el, label).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
const press = (b: HTMLElement): void => { act(() => { b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };

describe('the Practice screen: dev-only Set row', { timeout: 120_000 }, () => {
  it('offers every defined set by its display name, the live set lit by default', () => {
    const el = open();
    expect(buttons(el, 'Set').map((b) => b.textContent)).toEqual(Object.values(SETS).map((s) => (s.id === LIVE ? `${s.name} (live)` : s.name)));
    expect(lit(el, 'Set')).toEqual([`${SETS[LIVE].name} (live)`]);
  });

  it("picking another set writes it to the setup, swaps the Tribes row to that set's tribes and benches Opponent Rank", () => {
    const el = open();
    press(buttons(el, 'Set').find((b) => b.textContent === SETS[DEV].name)!);
    expect(useGame.getState().practiceDraft.setId).toBe(DEV);
    expect(buttons(el, 'Tribes').slice(1).map((b) => b.textContent?.toLowerCase())).toEqual(practiceTribeOptions(DEV));
    expect(buttons(el, 'Opponent Rank').every((b) => b.disabled)).toBe(true);
    expect(row(el, 'Set')!.textContent).toContain('bots playing this set');
  });

  it('is not rendered in a player build', () => {
    vi.stubEnv('DEV', false);
    const el = open({ setId: DEV });
    expect(row(el, 'Set')).toBeUndefined();
    // …and a stored pick has no say there: the rank row is live and the tribes are the live set's.
    expect(buttons(el, 'Opponent Rank').some((b) => b.disabled)).toBe(false);
    expect(buttons(el, 'Tribes').slice(1).map((b) => b.textContent?.toLowerCase())).toEqual(practiceTribeOptions(LIVE));
  });

  it('carries no native tooltip and no em dash', () => {
    const el = open({ setId: DEV });
    expect(row(el, 'Set')!.querySelector('[title]')).toBeNull();
    expect(row(el, 'Set')!.textContent).not.toMatch(/—|--/);
  });
});

describe('the Set pick reaches the run', { timeout: 120_000 }, () => {
  it('a dev build starts the Practice game on the picked set against bots on that set; the live switch is untouched', () => {
    open({ setId: DEV });
    act(() => { useGame.getState().confirmPracticeSetup(); });
    expect(useGame.getState().practiceDraft.setId).toBe(DEV);
    const hero = useGame.getState().heroChoices![0]!;
    act(() => { useGame.getState().pickHero(hero); });
    const run = useGame.getState().run;
    expect(run.mode).toBe('practice');
    expect(run.setId).toBe(DEV);
    expect(run.practiceConfig?.setId).toBe(DEV);
    expect(run.lobby!.seats.filter((s) => s.kind !== 'player').every((s) => s.kind === 'hybrid' && s.setId === DEV)).toBe(true);
    expect(activeSet().id).toBe(LIVE);
    act(() => { useGame.getState().openTitle(); });
  });

  it('a player build drops a stored pick at confirm, so the game is on the live set', () => {
    open({ setId: DEV });
    vi.stubEnv('DEV', false);
    act(() => { useGame.getState().confirmPracticeSetup(); });
    expect(useGame.getState().practiceDraft.setId).toBeUndefined();
    act(() => { useGame.getState().openTitle(); });
  });
});
