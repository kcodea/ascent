// @vitest-environment jsdom
/**
 * NEW REWARDS (owner ask 2026-09-28: "can you have the unlocks, achievements, and crates be a pop up when the player
 * gets back to the collection? and just highlight the collection's text in orange or have a "new" pill"). The queue
 * survives a reload, never shows a reward twice, keeps accounts apart, and drives the NEW pill on the Collection
 * entry points until the pop-up is dismissed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { ProgressionResult } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

import { markNewRewardsSeen, queueNewCrate, queueNewRewards, resetNewRewardsForTests, syncNewRewards, unseenCount, useNewRewards } from './newRewards';
import { MenuSidebar } from '../MenuSidebar';
import { useGame } from '../store';

const result = (over: Partial<ProgressionResult> = {}): Pick<ProgressionResult, 'achievements' | 'unlockedTitles' | 'crateIds' | 'after'> => ({
  achievements: ['career.games.1'], unlockedTitles: ['alpha_tester'], crateIds: ['c-1', 'c-2'], after: { lifetimeXp: 600, level: 3 }, ...over,
});
/** A reload: the in-memory store forgets, the account's queue is read back from storage. */
const reload = (userId: string): void => { useNewRewards.setState({ userId: null, unseen: { achievements: [], titles: [], crates: [] } }); syncNewRewards(userId); };

let ui: Mounted | null = null;
beforeEach(() => { resetNewRewardsForTests(); useGame.setState({ account: { userId: 'u-1', email: 'k@example.com', anonymous: false, discriminator: null } }); });
afterEach(() => { ui?.unmount(); ui = null; });

describe('the queue', () => {
  it('queues achievements (with XP), first-time titles and crates (oldest level first), and survives a reload', () => {
    queueNewRewards('u-1', result());
    reload('u-1');
    const u = useNewRewards.getState().unseen;
    expect(u.achievements).toEqual([{ id: 'career.games.1', xp: 25 }]);
    expect(u.titles).toEqual(['alpha_tester']);
    expect(u.crates).toEqual([{ crateId: 'c-1', earnedLevel: 2 }, { crateId: 'c-2', earnedLevel: 3 }]);
  });

  it('a Gauntlet crate (2026-09-29) is queued as given, with no inferred level, once, and survives a reload', () => {
    const g = { crateId: 'g-3', earnedLevel: null, source: 'gauntlet:3' };
    queueNewCrate('u-1', g);
    queueNewCrate('u-1', g);
    queueNewRewards('u-1', result({ crateIds: ['g-3'] })); // even a settlement naming it cannot re-queue it
    reload('u-1');
    expect(useNewRewards.getState().unseen.crates).toEqual([g]);
  });

  it('never twice: a duplicate answer adds nothing, and a seen reward never comes back', () => {
    queueNewRewards('u-1', result());
    queueNewRewards('u-1', result());
    expect(unseenCount(useNewRewards.getState().unseen)).toBe(4);
    markNewRewardsSeen('u-1');
    queueNewRewards('u-1', result()); // the same settlement replayed after the pop-up
    reload('u-1');
    expect(unseenCount(useNewRewards.getState().unseen)).toBe(0);
    queueNewRewards('u-1', result({ achievements: ['ranked.first_win'], unlockedTitles: [], crateIds: [] }));
    expect(useNewRewards.getState().unseen.achievements.map((a) => a.id)).toEqual(['ranked.first_win']);
  });

  it('accounts are kept apart', () => {
    queueNewRewards('u-1', result());
    reload('u-2');
    expect(unseenCount(useNewRewards.getState().unseen)).toBe(0);
    reload('u-1');
    expect(unseenCount(useNewRewards.getState().unseen)).toBe(4);
  });
});

describe('the NEW pill on the Collection entry points', () => {
  it('the side menu Collection plaque wears NEW (orange) while rewards wait, and drops it once seen', () => {
    queueNewRewards('u-1', result());
    ui = mount(<MenuSidebar current="career" onBack={() => {}} />);
    const plaque = (): HTMLElement | undefined => [...ui!.container.querySelectorAll<HTMLElement>('.sbbtn')].find((b) => b.textContent?.includes('Collection'));
    expect(plaque()?.classList.contains('hasnew')).toBe(true);
    expect(plaque()?.querySelector('.newpill')?.textContent).toBe('New');
    act(() => { markNewRewardsSeen('u-1'); });
    expect(plaque()?.classList.contains('hasnew')).toBe(false);
    expect(plaque()?.querySelector('.newpill')).toBeNull();
    expect(ui.container.querySelector('[title]')).toBeNull();
  });
});
