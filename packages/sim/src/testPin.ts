import { afterAll, beforeAll } from 'vitest';
import { SETS } from '@game/content';
import { CONFIG } from './config';

/**
 * Pin a test FILE to the set-1 era: set 1 active, quests on, the universal Runeforge off.
 *
 * Set 2 went live on 2026-07-31 (set 1 disabled, `questsEnabled` off, `runeforgeEnabled` on), which changed
 * what `createRun` pins and which turns open quest/forge overlays. The legacy suites test set-1 CONTENT and
 * the quest-era run loop — mechanics that are still shipped and must keep working for set-1 replays and the
 * eventual set rotation — so they pin the era they were written for rather than being rewritten against a
 * pool that no longer contains their fixture cards.
 *
 * Safe to mutate module state here: vitest isolates test FILES in separate workers, so a pin never leaks
 * into another file. Call at the top of the file, outside any `describe`.
 */
export function pinSet1Era(): void {
  let prev: { s1: boolean; s2: boolean; quests: boolean; forge: boolean } | undefined;
  beforeAll(() => {
    prev = { s1: SETS.set1.enabled, s2: SETS.set2.enabled, quests: CONFIG.questsEnabled, forge: CONFIG.runeforgeEnabled };
    SETS.set1.enabled = true;
    SETS.set2.enabled = false;
    CONFIG.questsEnabled = true;
    CONFIG.runeforgeEnabled = false;
  });
  afterAll(() => {
    if (!prev) return;
    SETS.set1.enabled = prev.s1;
    SETS.set2.enabled = prev.s2;
    CONFIG.questsEnabled = prev.quests;
    CONFIG.runeforgeEnabled = prev.forge;
  });
}
