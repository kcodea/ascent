// @vitest-environment jsdom
/**
 * GAUNTLET end screen — the stage verdict. Defeated reads "Stage S · Round R" with Retry (same stage) and Home;
 * cleared reads "Stage cleared!" with the stage name, the next-stage unlock line, and Next stage ONLY when that
 * stage is playable and unlocked. The verdict comes from the store's `gauntletResult`, or is re-derived from the
 * run when that is null (it is not persisted). Stage data is injected; Vitest runs with `import.meta.env.DEV` true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GauntletStage } from '@game/content';
import type { RunState } from '@game/sim';

const stages = vi.hoisted(() => new Map<number, unknown>());
vi.mock('@game/content', async (orig) => ({
  ...(await orig<typeof import('@game/content')>()),
  gauntletStage: (n: number) => stages.get(n),
  get GAUNTLET_STAGES() { return [...stages.values()]; },
}));

import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { GAUNTLET_LOCAL_KEY } from './gauntletProgress';
import { GauntletEndScreen } from './GauntletEndScreen';

const minion = { cardId: 'alley', attack: 1, health: 1, cardVersion: 'x' };
const stage = (number: number, status: 'ready' | 'draft', filledRounds: number): GauntletStage => ({
  number, name: `Stage Name ${number}`, opponentName: 'Host', status, runes: {},
  rounds: Array.from({ length: 10 }, (_, i) => ({ board: i < filledRounds ? [minion] : [] })),
});

/** A finished Gauntlet run: seat 0 standing (cleared) or knocked out on `fellOn` (defeated). */
function gauntletRun(stageNo: number, outcome: 'cleared' | 'defeated', fellOn = 4): RunState {
  const player = outcome === 'cleared' ? { alive: true } : { alive: false, eliminatedRound: fellOn };
  return {
    mode: 'gauntlet', phase: 'gameover', gauntletStage: stageNo, seed: 7, heroId: 'x', board: [],
    lobby: { round: outcome === 'cleared' ? 11 : fellOn + 1, seats: [player, { alive: outcome === 'defeated' }] },
  } as unknown as RunState;
}

let m: Mounted | null = null;
const buttons = (): HTMLButtonElement[] => [...m!.container.querySelectorAll<HTMLButtonElement>('button')];
const button = (label: string): HTMLButtonElement | undefined => buttons().find((b) => b.textContent === label);
const real = { startGauntlet: useGame.getState().startGauntlet, openTitle: useGame.getState().openTitle };
const startGauntlet = vi.fn();
const openTitle = vi.fn();

beforeEach(() => {
  localStorage.clear();
  stages.clear();
  startGauntlet.mockReset();
  openTitle.mockReset();
  useGame.setState({ startGauntlet, openTitle, gauntletResult: null });
});
afterEach(() => { m?.unmount(); m = null; useGame.setState({ ...real, gauntletResult: null }); });

describe('GauntletEndScreen', () => {
  it('defeated: shows the stage and round, Retry restarts the same stage, Home goes to the title', () => {
    stages.set(3, stage(3, 'ready', 10));
    useGame.setState({ gauntletResult: { stage: 3, outcome: 'defeated', round: 6, firstClear: false } });
    m = mount(<GauntletEndScreen run={gauntletRun(3, 'defeated', 6)} />);
    const text = m.container.textContent!;
    expect(text).toContain('Defeated');
    expect(text).toContain('Stage 3 · Round 6');
    expect(buttons().map((b) => b.textContent)).toEqual(['Retry', 'Home']);
    button('Retry')!.click();
    expect(startGauntlet).toHaveBeenCalledWith(3);
    button('Home')!.click();
    expect(openTitle).toHaveBeenCalledTimes(1);
  });

  it('defeated with no stored result: derives the round the player fell on from the run', () => {
    stages.set(2, stage(2, 'ready', 10));
    m = mount(<GauntletEndScreen run={gauntletRun(2, 'defeated', 5)} />);
    expect(m.container.textContent).toContain('Stage 2 · Round 5');
  });

  it('cleared: names the stage, announces the unlock and offers Next stage when it is playable', () => {
    stages.set(1, stage(1, 'ready', 10));
    stages.set(2, stage(2, 'ready', 10));
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([1]));
    useGame.setState({ gauntletResult: { stage: 1, outcome: 'cleared', round: 10, firstClear: true } });
    m = mount(<GauntletEndScreen run={gauntletRun(1, 'cleared')} reward={<div className="test-reward">crate</div>} />);
    const text = m.container.textContent!;
    expect(text).toContain('Stage cleared!');
    expect(text).toContain('Stage Name 1');
    expect(text).toContain('Stage 2 unlocked');
    expect(m.container.querySelector('.gauntletend-reward .test-reward')).not.toBeNull();
    expect(buttons().map((b) => b.textContent)).toEqual(['Next stage', 'Home']);
    button('Next stage')!.click();
    expect(startGauntlet).toHaveBeenCalledWith(2);
    button('Home')!.click();
    expect(openTitle).toHaveBeenCalledTimes(1);
  });

  it('cleared: no Next stage when the next stage is not playable (empty draft / no file)', () => {
    stages.set(1, stage(1, 'ready', 10));
    stages.set(2, stage(2, 'draft', 0));
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([1]));
    m = mount(<GauntletEndScreen run={gauntletRun(1, 'cleared')} />);
    expect(m.container.textContent).toContain('Stage cleared!');
    expect(button('Next stage')).toBeUndefined();
    expect(buttons().map((b) => b.textContent)).toEqual(['Home']);

    // Stage 5 has a successor with no file at all: no unlock line, no Next stage.
    stages.set(5, stage(5, 'ready', 10));
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([1, 2, 3, 4, 5]));
    m.render(<GauntletEndScreen run={gauntletRun(5, 'cleared')} />);
    expect(m.container.textContent).not.toContain('unlocked');
    expect(button('Next stage')).toBeUndefined();
  });

  it('renders no native title attribute anywhere', () => {
    stages.set(1, stage(1, 'ready', 10));
    m = mount(<GauntletEndScreen run={gauntletRun(1, 'defeated', 2)} />);
    expect(m.container.querySelector('[title]')).toBeNull();
  });
});
