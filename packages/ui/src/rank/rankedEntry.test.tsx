// @vitest-environment jsdom
/**
 * THE RANKED ENTRY (owner 2026-10-11, R-RANK-06), verbatim: "when clicking on the play section there should be a
 * confirmation that says: This is a ranked lobby, abandoning the match after this point will lose you MMR. Would
 * you like to proceed? Then have two button options: 1. Yes, let's go. 2. No, go back. from there, even at the hero
 * select screen, if they go back, they should place as if they came in eighth place and lose the associated mmr".
 * And, asked what closing the game on hero select should do: "Reopen on the same heroes".
 *
 * Pinned against the REAL Title, HeroSelect and store, with the rank queue mocked (the `quitCostsRating.test.ts`
 * recipe):
 *   - the Play card opens the confirmation in the owner's words and starts nothing by itself; "No, go back."
 *     closes it; "Yes, let's go." commits an entry and opens hero select;
 *   - Back from that hero select takes two presses and settles the entry's id as an 8th, tagged an abandon;
 *   - picking a hero spends the entry: the run carries the entry's id, and nothing is settled;
 *   - an entry left by a closed session is read back whole (same id, same heroes), and a live entry is resumed
 *     by the next Play instead of being re-rolled;
 *   - Practice and Gauntlet hero selects keep a free, one-press Back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { RANK_RULES, resolveRank } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return { ...mod, remoteEnabled: () => true, refreshOpponentPoolAndRecords: vi.fn() };
});

vi.mock('./rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => ({ ...(req as object), userId: 'me', at: 'now', attempts: 0 })),
    flushPendingRanks: vi.fn(async () => {}),
    installRankRetryTriggers: vi.fn(),
  };
});

// A player who has finished the tutorial: the Play card goes straight to the ranked confirmation.
vi.mock('../tutorial/tutorialProfile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../tutorial/tutorialProfile')>();
  return { ...mod, getCourseProgress: () => ({ status: 'completed' }) };
});

import { Title } from '../Title';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { enqueuePendingRank, flushPendingRanks } from './rankSubmission';
import {
  RANKED_CONFIRM_NO, RANKED_CONFIRM_TEXT, RANKED_CONFIRM_YES, RANKED_ENTRY_PLACEMENT,
  clearRankedEntry, loadRankedEntry, saveRankedEntry, type RankedEntry,
} from './rankedEntry';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const queued = () => vi.mocked(enqueuePendingRank).mock.calls.map((c) => c[0]);
const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
const press = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };
const stored = (): RankedEntry | null => loadRankedEntry(() => true);
const MID = { divisionIndex: 4, points: 50, demotionReady: false };

beforeEach(() => {
  vi.mocked(enqueuePendingRank).mockClear();
  vi.mocked(flushPendingRanks).mockClear();
  localStorage.clear();
  useGame.setState({ showTitle: true, titleView: 'modes', heroChoices: null, pendingMode: 'lobby', pendingSeed: undefined, rankedEntry: null, savedRun: null, replaying: false, playerName: 'Mike' });
});

describe('the Play card asks before it starts a ranked lobby', () => {
  const openConfirm = (): void => {
    ui = mount(<Title onSettings={() => {}} />);
    act(() => document.querySelector<HTMLButtonElement>('.modecard[data-mp="play"]')!.click());
  };

  it('shows the confirmation in the owner\'s words, with exactly the two answers, and starts nothing yet', () => {
    openConfirm();
    const dialog = document.querySelector('[role="dialog"][aria-label="Ranked lobby"]');
    expect(dialog).not.toBeNull();
    expect(RANKED_CONFIRM_TEXT).toBe('This is a ranked lobby, abandoning the match after this point will lose you MMR. Would you like to proceed?');
    expect(dialog!.querySelector('.rankedconfirm-text')!.textContent).toBe(RANKED_CONFIRM_TEXT);
    expect([...dialog!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(["Yes, let's go.", 'No, go back.']);
    expect(RANKED_CONFIRM_YES).toBe("Yes, let's go.");
    expect(RANKED_CONFIRM_NO).toBe('No, go back.');
    expect(useGame.getState().heroChoices, 'hero select is not open yet').toBeNull();
    expect(useGame.getState().rankedEntry).toBeNull();
    expect(stored()).toBeNull();
  });

  it('"No, go back." closes it and leaves the player on the mode picker, uncommitted', () => {
    openConfirm();
    act(() => button(RANKED_CONFIRM_NO)!.click());
    expect(document.querySelector('[role="dialog"][aria-label="Ranked lobby"]')).toBeNull();
    const st = useGame.getState();
    expect(st.showTitle).toBe(true);
    expect(st.titleView).toBe('modes');
    expect(st.heroChoices).toBeNull();
    expect(st.rankedEntry).toBeNull();
    expect(queued()).toHaveLength(0);
  });

  it('"Yes, let\'s go." commits a ranked entry (persisted) and opens hero select on its heroes', () => {
    openConfirm();
    act(() => button(RANKED_CONFIRM_YES)!.click());
    const st = useGame.getState();
    expect(st.showTitle).toBe(false);
    expect(st.pendingMode).toBe('lobby');
    expect(st.rankedEntry).not.toBeNull();
    expect(st.heroChoices).toEqual(st.rankedEntry!.heroChoices);
    expect(st.pendingSeed).toBe(st.rankedEntry!.seed);
    expect(st.rankedEntry!.runId.length).toBeGreaterThan(0);
    expect(stored(), 'the entry survives the game being closed').toEqual(st.rankedEntry);
    expect(queued(), 'confirming settles nothing').toHaveLength(0);
  });
});

describe('after the confirmation, going back from hero select is an 8th', () => {
  const enter = (): RankedEntry => {
    act(() => useGame.getState().startLobby());
    ui = mount(<HeroSelect />);
    return useGame.getState().rankedEntry!;
  };

  it('Back takes two presses: the first only names the cost', () => {
    enter();
    const back = document.querySelector<HTMLButtonElement>('.hsback')!;
    expect(back.textContent).toBe('← Main Menu');
    press(back);
    expect(back.classList.contains('armed')).toBe(true);
    expect(back.textContent).toBe('Abandon? Counts as 8th place');
    expect(useGame.getState().heroChoices, 'still on hero select').not.toBeNull();
    expect(queued()).toHaveLength(0);
  });

  it('the second press settles the entry as an 8th (an abandon, the 8th-place award) and opens the title', () => {
    const entry = enter();
    const back = document.querySelector<HTMLButtonElement>('.hsback')!;
    press(back);
    press(back);
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ runId: entry.runId, placement: 8, seed: entry.seed, kind: 'abandon' });
    expect(RANKED_ENTRY_PLACEMENT).toBe(8);
    expect(resolveRank(MID, 8).appliedDelta).toBe(RANK_RULES.placementAwards[7]);
    expect(resolveRank(MID, 8).appliedDelta).toBeLessThan(0);
    expect(vi.mocked(flushPendingRanks)).toHaveBeenCalled();
    const st = useGame.getState();
    expect(st.showTitle).toBe(true);
    expect(st.heroChoices).toBeNull();
    expect(st.rankedEntry).toBeNull();
    expect(stored(), 'the settled entry is spent').toBeNull();
  });

  it('abandoning twice cannot settle twice', () => {
    enter();
    act(() => useGame.getState().abandonRankedEntry());
    act(() => useGame.getState().abandonRankedEntry());
    expect(queued()).toHaveLength(1);
  });

  it('picking a hero spends the entry: the game carries its id and nothing is settled', () => {
    const entry = enter();
    act(() => useGame.getState().pickHero(entry.heroChoices[0]!));
    const st = useGame.getState();
    expect(st.run.mode).toBe('lobby');
    expect(st.run.runId).toBe(entry.runId);
    expect(st.run.seed).toBe(entry.seed);
    expect(st.rankedEntry).toBeNull();
    expect(stored()).toBeNull();
    expect(queued()).toHaveLength(0);
  });

  it('Practice and Gauntlet hero selects keep a free, one-press Back', () => {
    for (const pendingMode of ['practice', 'gauntlet'] as const) {
      act(() => useGame.setState({ showTitle: false, pendingMode, heroChoices: ['aster', 'warden'], rankedEntry: null }));
      ui = mount(<HeroSelect />);
      press(document.querySelector<HTMLButtonElement>('.hsback')!);
      expect(useGame.getState().showTitle, pendingMode).toBe(true);
      ui.unmount(); ui = null;
    }
    expect(queued()).toHaveLength(0);
  });
});

describe('closing the game on hero select keeps the same heroes (no reroll, no penalty)', () => {
  it('the stored entry reads back whole, and a build that can no longer offer it drops it at no cost', () => {
    const entry: RankedEntry = { runId: 'r-entry', seed: 4242, heroChoices: ['aster', 'warden', 'brackus'], at: '2026-10-11T00:00:00.000Z' };
    saveRankedEntry(entry);
    expect(loadRankedEntry(() => true)).toEqual(entry);
    expect(loadRankedEntry(() => false), 'not offerable any more').toBeNull();
    expect(loadRankedEntry(() => true), 'and it was dropped, not kept').toBeNull();
    localStorage.setItem('ascent.rankedentry', '{"runId":7}');
    expect(loadRankedEntry(() => true), 'a malformed record is no entry').toBeNull();
    clearRankedEntry();
  });

  it('a live entry is RESUMED by the next Play: same id, same heroes, no second roll', () => {
    act(() => useGame.getState().startLobby());
    const first = useGame.getState().rankedEntry!;
    // The opponent wait was cancelled (or any door that is not Back): the title opens, the entry stays owed.
    act(() => useGame.getState().openTitle());
    expect(useGame.getState().rankedEntry).toEqual(first);
    expect(queued(), 'leaving that way is not an abandon').toHaveLength(0);
    act(() => useGame.getState().startLobby());
    const st = useGame.getState();
    expect(st.rankedEntry).toEqual(first);
    expect(st.heroChoices).toEqual(first.heroChoices);
    expect(st.pendingSeed).toBe(first.seed);
  });
});
