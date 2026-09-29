// @vitest-environment jsdom
/**
 * THE STAGE BUILDER PANEL against its real store (`stageBuilderStore.ts`) and the live sandbox run, with the dev
 * endpoint mocked. Pins the panel's contract: the ten stage slots (6–10 have no file yet), round selection, the
 * unsaved-round dot, Save gated on dirty and routed to `saveStage`, the "no effect for opponents" rune badge, and
 * the arm-to-confirm Close while edits are unsaved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, EPIC_RUNES, RUNES, cardRevision, gauntletStage, type GauntletStage } from '@game/content';

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    recordFightResult: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

/** Stage 1 as on disk, with one real minion in round 3 so there is a stat to edit. */
const MINION = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && c.tier === 1)!;
const fixture = (): GauntletStage => {
  const s = structuredClone(gauntletStage(1)!);
  s.rounds[2] = { board: [{ cardId: MINION.id, attack: 2, health: 3, cardVersion: cardRevision(MINION) }] };
  return s;
};
vi.mock('./stageBuilderApi', () => ({
  loadStage: vi.fn(async () => fixture()),
  saveStage: vi.fn(async (s: GauntletStage) => ({ ok: true, path: `stages/0${s.number}.json` })),
}));

import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { StageBuilder } from './StageBuilder';
import { useStageBuilder } from './stageBuilderStore';
import { saveStage } from './stageBuilderApi';
import { runeActsForOpponent } from './runeEffect';

let ui: Mounted | null = null;
const q = <T extends Element = HTMLElement>(sel: string): T | null => ui!.container.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...ui!.container.querySelectorAll<T>(sel)];
const click = (el: Element | null | undefined): void => {
  expect(el, 'the control must be in the panel').toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
/** Type into a React-controlled input (React tracks the native value setter, so set it through the prototype). */
const type = (el: HTMLInputElement | null, value: string): void => {
  expect(el, 'the input must be in the panel').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(el, value); el!.dispatchEvent(new Event('input', { bubbles: true })); });
};
const roundBtn = (n: number): HTMLButtonElement => q<HTMLButtonElement>(`.stb-round[data-round="${n}"]`)!;
const saveBtn = (): HTMLButtonElement => q<HTMLButtonElement>('button.stb-save')!;

beforeEach(async () => {
  localStorage.clear();
  vi.mocked(saveStage).mockClear();
  useGame.setState({ sbRules: 'god', sbBotLevel: 5, sbEditMode: false, sbTavernShowsEnemy: false });
  useGame.getState().startSceneBuilder('warden');
  await act(async () => { await useStageBuilder.getState().openBuilder(1); });
  ui = mount(<StageBuilder />);
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  act(() => { useStageBuilder.getState().close(true); });
  localStorage.clear();
});

describe('the Stage Builder panel', () => {
  it('shows ten stage slots; 6–10 are disabled (no file yet)', () => {
    const stages = qa<HTMLButtonElement>('.stb-stage');
    expect(stages).toHaveLength(10);
    stages.forEach((b, i) => {
      expect(b.disabled, `stage ${i + 1}`).toBe(i >= 5);
      if (i >= 5) expect(b.textContent).toMatch(/no file yet/);
    });
    expect(stages[0]!.textContent).toMatch(/1\s*Demons/);
  });

  it('clicking round 3 selects it', () => {
    click(roundBtn(3));
    expect(useStageBuilder.getState().round).toBe(3);
    expect(roundBtn(3).getAttribute('aria-pressed')).toBe('true');
    expect(q('.stb-minion .stb-mname')?.textContent).toBe(MINION.name);
  });

  it('editing a stat marks round 3 dirty (dot), and Save is enabled only then and calls saveStage', async () => {
    click(roundBtn(3));
    expect(roundBtn(3).querySelector('.stb-dot')).toBeNull();
    expect(saveBtn().disabled).toBe(true);
    type(q<HTMLInputElement>('.stb-minion .badge.atk input'), '9');
    expect(useStageBuilder.getState().draft!.rounds[2]!.board[0]!.attack).toBe(9);
    expect(roundBtn(3).querySelector('.stb-dot')).not.toBeNull();
    expect(roundBtn(2).querySelector('.stb-dot')).toBeNull();
    expect(saveBtn().disabled).toBe(false);
    await act(async () => { saveBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(saveStage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveStage).mock.calls[0]![0].rounds[2]!.board[0]!.attack).toBe(9);
    expect(saveBtn().disabled).toBe(true);
    expect(roundBtn(3).querySelector('.stb-dot')).toBeNull();
  });

  it('a rune with no combat effect for an opponent carries the badge; one that acts does not', () => {
    const all = [...RUNES, ...EPIC_RUNES];
    const inert = all.find((r) => !runeActsForOpponent(r.id))!;
    const acting = all.find((r) => runeActsForOpponent(r.id))!;
    expect(inert).toBeDefined();
    expect(acting).toBeDefined();
    const opt = (id: string): HTMLOptionElement | undefined =>
      qa<HTMLOptionElement>('select.stb-rune[data-slot="round6"] option').find((o) => o.value === id);
    expect(opt(inert.id)?.textContent).toMatch(/— no effect for opponents$/);
    expect(opt(inert.id)?.className).toMatch(/stb-noeffect/);
    expect(opt(acting.id)?.textContent).toBe(acting.name);
  });

  it('Close while dirty asks to confirm first; confirming closes and drops the edits', () => {
    click(roundBtn(3));
    type(q<HTMLInputElement>('.stb-minion .badge.hp input'), '7');
    click(q('button.stb-close'));
    expect(useStageBuilder.getState().open).toBe(true);
    expect(q('.stb-confirm')?.textContent).toMatch(/Unsaved edits — Close anyway\?/);
    click(q('.stb-confirm button.stb-close-yes'));
    expect(useStageBuilder.getState().open).toBe(false);
  });

  it('the header ✕ shows the confirm even with Actions folded, outside every section', () => {
    click(roundBtn(3));
    type(q<HTMLInputElement>('.stb-minion .badge.hp input'), '7');
    // Fold Actions: its Close button (and anything inside it) is no longer rendered.
    const actionsFold = qa<HTMLButtonElement>('.sb-sec .sb-fold').find((b) => /Actions/.test(b.textContent ?? ''));
    click(actionsFold);
    expect(q('button.stb-close')).toBeNull();
    click(q('.devpanel-close'));
    expect(useStageBuilder.getState().open).toBe(true);
    const confirm = q('.stb-confirm');
    expect(confirm?.textContent).toMatch(/Unsaved edits — Close anyway\?/);
    expect(confirm!.closest('.sb-sec')).toBeNull();
    click(q('.stb-confirm button.stb-close-yes'));
    expect(useStageBuilder.getState().open).toBe(false);
  });
});

describe('runeActsForOpponent', () => {
  it('is false for a shop-only rune and true for a combat rune (a shop rune leaves every mod undefined)', () => {
    expect(runeActsForOpponent('rune_happy_birthday')).toBe(false);
    expect([...RUNES, ...EPIC_RUNES].some((r) => runeActsForOpponent(r.id))).toBe(true);
  });
});
