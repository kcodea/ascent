// @vitest-environment jsdom
/**
 * GAUNTLET IN-RUN PANEL — the rail a Gauntlet run shows in place of the 8-seat lobby table. Pins: the stage's
 * opponent name + tribe emblem, "Round N / 10" (held at 10 once the final round is past), the Gauntlet's own loss
 * cap ("Max loss: 5" on round 3, "No cap" on round 9), your own Resolve, and NO seat list / scouting. Plus the
 * regression that the normal lobby rail still reads the normal cap table (round 8 → −15), and the combat opponent:
 * the stage's tribe emblem in place of the stand-in hero portrait, no hero power, name kept.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createGauntletRun, createLobbyRun, type RunState } from '@game/sim';
import type { GauntletStage } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { CombatOpponent } from '../CombatOpponent';
import { useGame } from '../store';
import { GauntletPanel } from './GauntletPanel';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const stage: GauntletStage = {
  number: 1, name: 'Demons', opponentName: 'The Demon Host', tribe: 'demon', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [{ cardId: 'alley', attack: 1, health: 1, cardVersion: 'x' }] })),
};

const atRound = (round: number): RunState => {
  const run = createGauntletRun(777, 'warden', stage);
  return { ...run, wave: round, lobby: { ...run.lobby!, round } };
};

const show = (run: RunState): HTMLElement => {
  act(() => { useGame.setState({ run }); });
  ui = mount(<GauntletPanel lobby={run.lobby!} stage={run.gauntletStage} />);
  return ui.container;
};

describe('GauntletPanel', () => {
  it('shows the opponent, the round out of 10 and the Gauntlet cap, with no seat list', () => {
    const run = atRound(3);
    const el = show(run);
    expect(el.textContent).toContain('The Demon Host');
    expect(el.textContent).toContain('Round 3 / 10');
    expect(el.textContent).toContain('Max loss: 5');
    expect(el.textContent).toContain(String(run.resolve));
    expect(el.querySelector('.gauntletrail-emblem')).not.toBeNull();
    // No scouting: no seat rows, no hover scout card, and no native tooltips.
    expect(el.querySelector('.lobbyseat')).toBeNull();
    expect(el.querySelector('.lobbyseats')).toBeNull();
    expect(el.querySelector('[title]')).toBeNull();
    const rail = el.querySelector('.lobbyrail')!;
    act(() => { rail.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    expect(document.body.querySelector('.lobbyscout')).toBeNull();
  });

  it('reads "No cap" on the uncapped final rounds', () => {
    const el = show(atRound(9));
    expect(el.textContent).toContain('Round 9 / 10');
    expect(el.textContent).toContain('No cap');
    expect(el.textContent).not.toContain('Max loss');
  });

  it('holds the round at 10 once the final round is past', () => {
    const el = show(atRound(11));
    expect(el.textContent).toContain('Round 10 / 10');
  });
});

describe('CombatOpponent in a Gauntlet', () => {
  it('wears the tribe emblem, keeps the name and shows no hero power', () => {
    const run: RunState = { ...atRound(2), phase: 'combat' };
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    const opp = document.body.querySelector('.combatopp')!;
    expect(opp).not.toBeNull();
    expect(opp.querySelector('.combatopp-name')!.textContent).toBe('The Demon Host');
    expect(opp.querySelector('.combatopp-emblem')).not.toBeNull();
    expect(opp.querySelector('.combatopp-img')).toBeNull();
    expect(document.body.querySelector('.opp-power')).toBeNull();
    expect(document.body.querySelector('.combatopp-hp')).not.toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
  });
});

describe('lobby rail (regression)', () => {
  it('still reads the normal cap table: round 8 → −15', () => {
    const base = createLobbyRun(4242, 'warden');
    const run: RunState = { ...base, wave: 8, lobby: { ...base.lobby!, round: 8 } };
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    expect(ui.container.querySelector('.lobbymax')!.textContent).toBe('−15');
  });
});
