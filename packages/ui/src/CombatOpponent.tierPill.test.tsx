// @vitest-environment jsdom
/**
 * The foe's SHOP TIER pill (owner ask 2026-10-02: "a pill that says the Shop Tier X below the opponent health pill").
 * Pins: a lobby foe's pill reads "Shop Tier N" with N = the tier of the board it is fielding (the served
 * `PreparedBoard.tier`), it hangs INSIDE the health pill (absolutely placed, so the column never shifts), the Buffs
 * arrow rides under it, an unknown tier hides it, and a Gauntlet foe (no health pill) shows none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, playerOpponent, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { CombatOpponent, OppTierPill, tierKnown } from './CombatOpponent';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => {
  act(() => { useGame.setState({ combatStaged: false }); });
  ui?.unmount(); ui = null;
});

describe('CombatOpponent shop tier pill', () => {
  it('shows "Shop Tier N" under the health pill, N = the served board tier', () => {
    const run: RunState = { ...createLobbyRun(4242, 'warden'), phase: 'combat' };
    const foe = playerOpponent(run.lobby!)!;
    expect(foe?.seat).toBeTruthy();
    act(() => { useGame.setState({ run, combatStaged: true }); });
    ui = mount(<CombatOpponent />);
    const pill = document.body.querySelector('.combatopp-hp > .combatopp-tier');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe(`Shop Tier ${foe.board.tier}`);
    expect(pill!.querySelector('.combatopp-tier-n')!.textContent).toBe(String(foe.board.tier));
    expect(pill!.hasAttribute('title')).toBe(false);
  });

  it('renders the given tier, and nothing when the tier is unknown', () => {
    ui = mount(<OppTierPill tier={4} />);
    expect(ui.container.querySelector('.combatopp-tier')!.textContent).toBe('Shop Tier 4');
    ui.unmount(); ui = null;
    for (const t of [undefined, null, 0, Number.NaN, 2.5]) {
      ui = mount(<OppTierPill tier={t} />);
      expect(ui.container.querySelector('.combatopp-tier')).toBeNull();
      ui.unmount(); ui = null;
    }
    expect(tierKnown(1)).toBe(true);
    expect(tierKnown(undefined)).toBe(false);
  });

  it('carries the Buffs arrow under itself when asked', () => {
    ui = mount(<OppTierPill tier={3} arrow="▾" />);
    const arrow = ui.container.querySelector('.combatopp-tier > .oppbuffs-arrow');
    expect(arrow!.textContent).toBe('▾');
    expect(ui.container.querySelector('.combatopp-tier')!.textContent).toBe('Shop Tier 3▾');
  });
});
