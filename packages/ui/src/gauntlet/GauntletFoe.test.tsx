// @vitest-environment jsdom
/**
 * GAUNTLET IN-RUN FOE — what a Gauntlet run floats on the right of the shop in place of the 8-seat lobby rail (owner
 * ask 2026-09-29: no rail, just the opponent's portrait + name). Pins: the stage opponent's name + tribe emblem in a
 * portrait disc, one "Round N / 10 · Max loss N" line (held at 10 once the final round is past; "No cap" on round 9),
 * NO rail box, NO seat list / scouting and NO player Resolve. Plus the regression that the normal lobby rail still
 * reads the normal cap table (round 8 → −15), and the combat opponent: the stage's tribe emblem in place of the
 * stand-in hero portrait, no hero power, no health pill, name kept. */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createGauntletRun, createLobbyRun, type RunState } from '@game/sim';
import type { GauntletStage } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { CombatOpponent } from '../CombatOpponent';
import { useGame } from '../store';
import { GauntletFoe } from './GauntletFoe';

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
  ui = mount(<GauntletFoe />);
  return ui.container;
};

describe('GauntletFoe', () => {
  it('floats the opponent emblem + name with one round / cap line — no rail box, no seat list, no own health', () => {
    const run = atRound(3);
    const el = show(run);
    expect(el.querySelector('.gauntletfoe-name')!.textContent).toBe('The Demon Host');
    expect(el.querySelector('.gauntletfoe-portrait .gauntletfoe-emblem svg')).not.toBeNull();
    expect(el.querySelector('.gauntletfoe-meta')!.textContent).toBe('Round 3 / 10 · Max loss 5');
    // No rail chrome, no seats, no scouting, no player Resolve/Armor, no native tooltips.
    expect(el.querySelector('.lobbyrail')).toBeNull();
    expect(el.querySelector('.lobbyseat, .lobbyseats, .lobbyhp, .lobbyarmor')).toBeNull();
    expect(el.textContent).not.toContain('You');
    expect(el.querySelector('[title]')).toBeNull();
    const foe = el.querySelector('.gauntletfoe')!;
    act(() => { foe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    expect(document.body.querySelector('.lobbyscout')).toBeNull();
  });

  it('reads "No cap" on the uncapped final rounds', () => {
    const el = show(atRound(9));
    expect(el.querySelector('.gauntletfoe-meta')!.textContent).toBe('Round 9 / 10 · No cap');
  });

  it('holds the round at 10 once the final round is past', () => {
    const el = show(atRound(11));
    expect(el.querySelector('.gauntletfoe-meta')!.textContent).toMatch(/^Round 10 \/ 10 · /);
  });
});

describe('CombatOpponent in a Gauntlet', () => {
  it('wears the tribe emblem, keeps the name and shows no hero power or health (it takes no damage, R-GAUNTLET-02)', () => {
    const run: RunState = { ...atRound(2), phase: 'combat' };
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    const opp = document.body.querySelector('.combatopp')!;
    expect(opp).not.toBeNull();
    expect(opp.querySelector('.combatopp-name')!.textContent).toBe('The Demon Host');
    expect(opp.querySelector('.combatopp-emblem')).not.toBeNull();
    expect(opp.querySelector('.combatopp-img')).toBeNull();
    expect(document.body.querySelector('.opp-power')).toBeNull();
    expect(document.body.querySelector('.combatopp-hp')).toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
  });

  it('a lobby foe still shows its health pill (regression)', () => {
    const run: RunState = { ...createLobbyRun(4242, 'warden'), phase: 'combat' };
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    expect(document.body.querySelector('.combatopp-hp')).not.toBeNull();
    act(() => { useGame.setState({ combatStaged: false }); });
  });
});

describe('Now Facing in a Gauntlet (Recruit source pin — the wipe is too deep in Recruit to mount here)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Recruit.tsx'), 'utf8');
  const at = src.indexOf('<div className="wipevs-label">Now Facing</div>');
  const block = src.slice(at, src.indexOf('<div className="wipevs-name">', at));

  it('wears the stage tribe emblem instead of the stand-in hero portrait; a lobby keeps the portrait', () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toMatch(/run\.mode === 'gauntlet'\s*\?\s*<span className="wipevs-face wipevs-emblem"><Icon name=\{tribe \? TRIBE_ICON\[tribe\]/);
    expect(block).toMatch(/:\s*<img decoding="sync" className="wipevs-face" src=\{heroPortrait\(foe\.seat\.heroId/);
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
