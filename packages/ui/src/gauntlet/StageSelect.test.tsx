// @vitest-environment jsdom
/**
 * GAUNTLET stage select — ten slots in stage order, each reading its `stageSlotState`: only a playable, unlocked
 * (or DEV-draft) slot is clickable and it starts that stage; locked and "Coming soon" slots are disabled. Stage
 * data is injected (the shipped stages are all empty drafts today). Vitest runs with `import.meta.env.DEV` true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GauntletStage } from '@game/content';

const stages = vi.hoisted(() => new Map<number, unknown>());
vi.mock('@game/content', async (orig) => ({
  ...(await orig<typeof import('@game/content')>()),
  gauntletStage: (n: number) => stages.get(n),
  get GAUNTLET_STAGES() { return [...stages.values()]; },
}));

import { act } from 'react';
import { resetIdentityForTests, setIdentity } from '../identity';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { GAUNTLET_LOCAL_KEY, recordClear } from './gauntletProgress';
import { StageSelect } from './StageSelect';

const minion = { cardId: 'alley', attack: 1, health: 1, cardVersion: 'x' };
const stage = (number: number, status: 'ready' | 'draft', filledRounds: number, tribe?: GauntletStage['tribe']): GauntletStage => ({
  number, name: `S${number}`, opponentName: 'Host', status, runes: {}, tribe,
  rounds: Array.from({ length: 10 }, (_, i) => ({ board: i < filledRounds ? [minion] : [] })),
});

let m: Mounted | null = null;
const slots = (): HTMLButtonElement[] => [...m!.container.querySelectorAll<HTMLButtonElement>('.gslot')];
const slot = (n: number): HTMLButtonElement => slots()[n - 1];

beforeEach(() => {
  localStorage.clear();
  stages.clear();
  resetIdentityForTests();
});
const realStart = useGame.getState().startGauntlet;
const realOpenAccount = useGame.getState().openAccountPanel;
afterEach(() => {
  m?.unmount(); m = null;
  resetIdentityForTests();
  useGame.setState({ startGauntlet: realStart, openAccountPanel: realOpenAccount });
});
const signIn = (): void => setIdentity({ userId: 'u-1', displayName: 'Kev', anonymous: false, email: 'k@example.com' });
const banner = (): HTMLElement | null => m!.container.querySelector<HTMLElement>('.gstage-guest');

describe('StageSelect', () => {
  it('renders ten slots in stage order; with no progress only a DEV draft with content is playable', () => {
    stages.set(1, stage(1, 'draft', 1, 'demon'));
    stages.set(2, stage(2, 'draft', 0, 'kobold'));
    m = mount(<StageSelect />);
    expect(slots()).toHaveLength(10);
    expect(slots().map((b) => b.dataset.stage)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(slot(1).dataset.state).toBe('draft');
    expect(slot(1).disabled).toBe(false);
    expect(slot(1).textContent).toContain('S1');
    expect(slot(1).textContent).toContain('Draft');
    expect(slot(1).querySelector('.gslot-emblem')).not.toBeNull();
    // An empty draft and the stages with no file are "Coming soon": disabled, name hidden.
    for (const n of [2, 3, 6, 10]) {
      expect(slot(n).dataset.state).toBe('soon');
      expect(slot(n).disabled).toBe(true);
      expect(slot(n).textContent).toContain('???');
      expect(slot(n).textContent).toContain('Coming soon');
    }
    expect(slots().filter((b) => !b.disabled)).toHaveLength(1);
  });

  it('locks a ready stage whose predecessor is uncleared, with a hover tip and aria-disabled', () => {
    stages.set(1, stage(1, 'ready', 10, 'demon'));
    stages.set(2, stage(2, 'ready', 10, 'kobold'));
    m = mount(<StageSelect />);
    expect(slot(1).dataset.state).toBe('available');
    expect(slot(2).dataset.state).toBe('locked');
    expect(slot(2).disabled).toBe(true);
    expect(slot(2).getAttribute('aria-disabled')).toBe('true');
    expect(slot(2).classList.contains('gtip')).toBe(true);
    expect(slot(2).dataset.tip).toBe('Clear Stage 1 to unlock');
    expect(slot(2).hasAttribute('title')).toBe(false);
  });

  it('marks a cleared stage and keeps it clickable; clicking an available slot starts that stage', () => {
    stages.set(1, stage(1, 'ready', 10));
    stages.set(2, stage(2, 'ready', 10));
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([1]));
    const start = vi.fn();
    useGame.setState({ startGauntlet: start });
    m = mount(<StageSelect />);
    expect(slot(1).dataset.state).toBe('cleared');
    expect(slot(1).disabled).toBe(false);
    expect(slot(1).textContent).toContain('✓');
    expect(slot(2).dataset.state).toBe('available');
    slot(2).click();
    expect(start).toHaveBeenCalledWith(2);
    slot(1).click();
    expect(start).toHaveBeenCalledWith(1);
    // Disabled slots never start anything.
    slot(3).click();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('a cleared slot notes that replays grant no crate (game hover bubble, never a native title)', () => {
    stages.set(1, stage(1, 'ready', 10));
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([1]));
    m = mount(<StageSelect />);
    expect(slot(1).classList.contains('gtip')).toBe(true);
    expect(slot(1).dataset.tip).toBe('Already cleared. No crate for replays.');
    expect(slot(1).getAttribute('aria-description')).toBe('Already cleared. No crate for replays.');
    expect(m.container.querySelector('[title]')).toBeNull();
  });

  it('signed out (guest or no session): a banner says progress stays on this device, with a Sign in button', () => {
    stages.set(1, stage(1, 'ready', 10));
    const openAccountPanel = vi.fn();
    useGame.setState({ openAccountPanel });
    m = mount(<StageSelect />);
    expect(banner()?.textContent).toContain("You're not signed in. Progress is saved on this device only, and clears won't grant crates.");
    const btn = banner()!.querySelector('button')!;
    expect(btn.textContent).toBe('Sign in');
    btn.click();
    expect(openAccountPanel).toHaveBeenCalledTimes(1);

    // An anonymous session is still "not signed in".
    m.unmount();
    setIdentity({ userId: 'anon-1', displayName: 'Kev', anonymous: true, email: null });
    m = mount(<StageSelect />);
    expect(banner()).not.toBeNull();
  });

  it('signed in: no banner, and the slots re-read progress when the account progress changes', () => {
    stages.set(1, stage(1, 'ready', 10));
    stages.set(2, stage(2, 'ready', 10));
    signIn();
    m = mount(<StageSelect />);
    expect(banner()).toBeNull();
    expect(slot(1).dataset.state).toBe('available');
    expect(slot(2).dataset.state).toBe('locked');
    act(() => { recordClear(1); });
    expect(slot(1).dataset.state).toBe('cleared');
    expect(slot(2).dataset.state).toBe('available');
  });
});
