// @vitest-environment jsdom
/**
 * THE STAGE BOARD CANVAS (owner ask 2026-09-29) against the real Stage Builder store and the live sandbox run, with
 * the dev endpoint mocked. Pins: the canvas shows ONLY the opponent's warband for the selected round (the authored
 * units + empty "+" slots up to 7, no player row, no shop); double-click opens the unit editor on the DRAFT (stats,
 * an added Ward, Golden, a card swap, remove — each marking the round dirty); the card's printed keywords are
 * locked on; "+" adds a searched card; and the panel no longer offers "Test this round".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, GAUNTLET_BOARD_MAX, cardRevision, gauntletStage, type GauntletStage } from '@game/content';
import type { Keyword } from '@game/core';

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

const minions = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token);
/** A minion with NO printed Ward (so Ward can be added) and one WITH a printed Taunt (to prove the lock). */
const PLAIN = minions.find((c) => c.tier === 1 && !(c.keywords ?? []).includes('DS'))!;
const TAUNTED = minions.find((c) => (c.keywords ?? []).includes('T'))!;
const OTHER = minions.find((c) => c.id !== PLAIN.id && c.id !== TAUNTED.id && c.tier === 2)!;

/** Stage 1 with round 3 holding two authored units (round 3 is ours alone — the other rounds stay as loaded). */
const fixture = (): GauntletStage => {
  const s = structuredClone(gauntletStage(1)!);
  s.rounds[2] = {
    board: [
      { cardId: PLAIN.id, attack: 2, health: 3, cardVersion: cardRevision(PLAIN) },
      { cardId: TAUNTED.id, attack: TAUNTED.attack, health: TAUNTED.health, cardVersion: cardRevision(TAUNTED) },
    ],
  };
  return s;
};
vi.mock('./stageBuilderApi', () => ({
  loadStage: vi.fn(async () => fixture()),
  saveStage: vi.fn(async (s: GauntletStage) => ({ ok: true, path: `stages/0${s.number}.json` })),
}));

import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { StageBuilder } from './StageBuilder';
import { StageBoardCanvas } from './StageBoardCanvas';
import { useStageBuilder } from './stageBuilderStore';

let ui: Mounted | null = null;
/** Portalled content lives under `#stage`, not the mount container — query the whole document. */
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const fire = (el: Element | null | undefined, ev: Event): void => {
  expect(el, 'the control must be rendered').toBeTruthy();
  act(() => { el!.dispatchEvent(ev); });
};
const click = (el: Element | null | undefined): void => fire(el, new MouseEvent('click', { bubbles: true }));
const dblclick = (el: Element | null | undefined): void => fire(el, new MouseEvent('dblclick', { bubbles: true }));
const type = (el: HTMLInputElement | null, value: string): void => {
  expect(el, 'the input must be rendered').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(el, value); el!.dispatchEvent(new Event('input', { bubbles: true })); });
};
const board = () => useStageBuilder.getState().draft!.rounds[2]!.board;
const dirty3 = (): boolean => useStageBuilder.getState().dirtyRounds().includes(3);
const kwBtn = (label: string): HTMLButtonElement =>
  qa<HTMLButtonElement>('.uned .uned-kwbtn').find((b) => (b.getAttribute('aria-label') ?? '').startsWith(label))!;
const openEditor = (i: number): void => dblclick(q(`.stbc-slot[data-stbc-slot="${i}"]`));

beforeEach(async () => {
  localStorage.clear();
  useGame.setState({ sbRules: 'god', sbBotLevel: 5, sbEditMode: false, sbTavernShowsEnemy: false });
  useGame.getState().startSceneBuilder('warden');
  await act(async () => { await useStageBuilder.getState().openBuilder(1); });
  act(() => { useStageBuilder.getState().selectRound(3); });
  ui = mount(<><StageBoardCanvas /><StageBuilder /></>);
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  act(() => { useStageBuilder.getState().close(true); });
  localStorage.clear();
});

describe('the Stage Board canvas', () => {
  it("shows only the round's opponent units, then empty + slots up to 7 — no player row, no shop", () => {
    expect(qa('.stbc .stbc-slot')).toHaveLength(2);
    expect(qa('.stbc .stbc-slot .card')).toHaveLength(2);
    expect(qa('.stbc .stbc-add')).toHaveLength(GAUNTLET_BOARD_MAX - 2);
    expect(q('.stbc [data-zone]')).toBeNull(); // no warband / tavern / hand zones
    expect(q('.stbc .card.spell, .stbc .shopspells, .stbc .lobbyrail'), 'no shop spells, no lobby rail').toBeNull();
    expect(q('.stbc')!.textContent).not.toMatch(/Refresh|Freeze|End Turn/);
    expect(q('.stbc-head')?.textContent).toMatch(/Round\s*3/);
    expect(q('.stbc-head')?.textContent).toContain(useStageBuilder.getState().draft!.opponentName);
  });

  it('double-click opens the editor; a stat edit writes the draft and marks round 3 dirty', () => {
    expect(q('.uned')).toBeNull();
    openEditor(0);
    expect(q('.uned')).not.toBeNull();
    expect(dirty3()).toBe(false);
    type(q<HTMLInputElement>('.uned .badge.atk input'), '9');
    expect(board()[0]!.attack).toBe(9);
    expect(dirty3()).toBe(true);
    // The panel reads the same draft.
    expect(q('.stb-round[data-round="3"] .stb-dot')).not.toBeNull();
  });

  it('Ward toggles as an ADDED keyword; the printed keyword is locked on', () => {
    openEditor(0);
    click(kwBtn('Ward'));
    expect(board()[0]!.addedKeywords).toEqual(['DS' satisfies Keyword]);
    expect(q('.stbc-slot[data-stbc-slot="0"] .card')!.className).toMatch(/dscard/);
    expect(dirty3()).toBe(true);
    click(kwBtn('Ward'));
    expect(board()[0]!.addedKeywords).toBeUndefined();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    openEditor(1);
    const taunt = kwBtn('Taunt');
    expect(taunt.disabled).toBe(true);
    expect(taunt.className).toMatch(/\bon\b/);
    expect(taunt.getAttribute('aria-label')).toMatch(/printed on the card/);
    click(taunt);
    expect(board()[1]!.addedKeywords).toBeUndefined();
  });

  it('Golden, card swap and remove all edit the draft', () => {
    openEditor(0);
    click(q('.uned .uned-golden'));
    expect(board()[0]!.golden).toBe(true);
    expect(q('.stbc-slot[data-stbc-slot="0"] .card')!.className).toMatch(/golden/);

    type(q<HTMLInputElement>('.uned .uned-find'), OTHER.name);
    const row = qa<HTMLButtonElement>('.uned .uned-foundrow').find((b) => b.textContent === OTHER.name);
    click(row);
    expect(board()[0]!.cardId).toBe(OTHER.id);
    expect(board()[0]!.attack).toBe(OTHER.attack);

    click(q('.uned .uned-remove'));
    expect(board().map((m) => m.cardId)).toEqual([TAUNTED.id]);
    expect(qa('.stbc .stbc-slot')).toHaveLength(1);
    expect(qa('.stbc .stbc-add')).toHaveLength(GAUNTLET_BOARD_MAX - 1);
    expect(dirty3()).toBe(true);
  });

  it('a + slot searches, adds the picked card at its printed stats and opens the editor on it', () => {
    click(q('.stbc .stbc-add'));
    type(q<HTMLInputElement>('.stbc-picker .uned-find'), OTHER.name);
    const row = qa<HTMLButtonElement>('.stbc-picker .uned-foundrow').find((b) => b.textContent?.includes(OTHER.name));
    click(row);
    expect(board()).toHaveLength(3);
    expect(board()[2]).toMatchObject({ cardId: OTHER.id, attack: OTHER.attack, health: OTHER.health });
    expect(q('.stbc-picker')).toBeNull();
    expect(q('.uned select')?.getAttribute('aria-label')).toMatch(/Which card/);
    expect((q<HTMLSelectElement>('.uned select'))!.value).toBe(OTHER.id);
  });

  it('the panel no longer offers "Test this round"', () => {
    const labels = qa<HTMLButtonElement>('.stagebuilder button').map((b) => b.textContent ?? '');
    expect(labels.some((t) => /Test this round/.test(t))).toBe(false);
  });
});
