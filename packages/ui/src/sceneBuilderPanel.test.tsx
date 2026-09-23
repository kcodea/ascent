// @vitest-environment jsdom
/**
 * THE SCENE BUILDER PANEL against the live store (owner report 2026-09-23: *"the scene builder is broken for me
 * for some reason ... i dont have infinite money in god mode and cannot add cards to the shop"*).
 *
 * The panel writes the LIVE run through `useGame.setState` (`mutate`), and the board reads the same store, so
 * every rig control is only as real as "one store per tab". What broke the owner's session was a Vite HMR patch
 * that re-evaluated `store.ts` (a merge touching the store or anything under it) and minted a SECOND Zustand
 * store: the modules the patch re-executed (Game, Recruit, the Gold pill) bound to the new one, the panel kept
 * the old one, and every panel write landed in a store nothing rendered. This file pins both halves:
 *
 *   1. the panel's controls land in the store the board reads: God rules open on 999 Gold and the refill tops
 *      it back up, a Library click puts THAT card in the shop row, "+ enemy" pins a minion onto the enemy row;
 *   2. `store.ts` is not hot-swappable: it accepts its own HMR update by reloading the page, so the tab can
 *      never hold two stores (a source tripwire — `import.meta.hot` is undefined under vitest).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CARD_INDEX } from '@game/content';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
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

import { mount, type Mounted } from './renderedText.mount';
import { SceneBuilder } from './SceneBuilder';
import { foeSnapshotOf } from './sandboxEdit';
import { useGame } from './store';

let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => {
  expect(el, 'the control must be in the panel').not.toBeNull();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
/** Let the panel's `queueMicrotask` refill and React's follow-up render settle. */
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const byTitle = (root: ParentNode, title: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`button[title="${title}"]`);

beforeEach(() => {
  localStorage.clear();
  useGame.setState({ sbRules: 'god', sbBotLevel: 5, sbEditMode: false, sbTavernShowsEnemy: false });
  useGame.getState().startSceneBuilder('warden');
  ui = mount(<SceneBuilder />);
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  localStorage.clear();
});

describe('the Scene Builder panel writes the store the board reads', () => {
  it('God rules: the run opens on 999 Gold and the panel tops it back up when it dips', async () => {
    const run = useGame.getState().run;
    expect(run.sandbox).toBe(true);
    expect(run.embers).toBe(999);
    expect(useGame.getState().sbRules).toBe('god');
    // The pill dips (a buy, a reducer turn start) — the panel's refill subscription puts it back on the float.
    act(() => { useGame.setState({ run: { ...useGame.getState().run, embers: 4 } }); });
    await settle();
    expect(useGame.getState().run.embers).toBe(999);
  });

  it('a Library click adds THAT card to the shop row', () => {
    const before = useGame.getState().run.shop.map((c) => c.uid);
    const row = ui!.container.querySelector<HTMLButtonElement>('.sb-card');
    expect(row).not.toBeNull();
    const label = row!.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/^Add .+ to the shop$/);
    click(row);
    const shop = useGame.getState().run.shop;
    expect(shop).toHaveLength(before.length + 1);
    const added = shop[shop.length - 1]!;
    expect(before).not.toContain(added.uid);
    expect(label).toBe(`Add ${CARD_INDEX[added.cardId]!.name} (Tier ${CARD_INDEX[added.cardId]!.tier}) to the shop`);
  });

  it('"+ enemy" pins one more minion onto the enemy row for this wave', () => {
    const run0 = useGame.getState().run;
    const shown = foeSnapshotOf(run0)?.minions.length ?? 0;
    // The tile is gated on the enemy row being shown ("Show the enemy row first").
    expect(byTitle(ui!.container, 'Show the enemy row first')?.disabled).toBe(true);
    click(byTitle(ui!.container, 'The top row shows the opponent you are about to fight'));
    expect(useGame.getState().sbTavernShowsEnemy).toBe(true);
    click(byTitle(ui!.container, 'Add a minion to the enemy row'));
    const run = useGame.getState().run;
    expect(run.sandboxFoeWave).toBe(run.wave);
    const pinned = run.servedBoards?.[run.wave];
    expect(pinned).toBeDefined();
    expect(pinned!.minions).toHaveLength(shown + 1);
    expect(foeSnapshotOf(run)).toBe(pinned);
  });
});

describe('the store is not hot-swappable', () => {
  it('store.ts accepts its own HMR update by reloading the page, so a tab never holds two stores', () => {
    // vitest runs from the repo root (the rules registry's refs are root-relative for the same reason).
    const src = readFileSync(resolve(process.cwd(), 'packages/ui/src/store.ts'), 'utf8');
    // One `create(...)` — the singleton whose re-evaluation is the whole problem.
    expect(src.match(/create<GameStore>\(/g)).toHaveLength(1);
    // The guard: `import.meta.hot.accept(() => { window.location.reload(); })`, absent in prod (no `import.meta.hot`).
    const guard = /if \(import\.meta\.hot\) \{\s*import\.meta\.hot\.accept\(\(\) => \{ window\.location\.reload\(\); \}\);\s*\}/;
    expect(src).toMatch(guard);
    // And nothing else in the store accepts an HMR update (a second accept would swallow the reload).
    expect(src.match(/import\.meta\.hot\.accept\(/g)).toHaveLength(1);
  });
});
