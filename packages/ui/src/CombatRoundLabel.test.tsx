// @vitest-environment jsdom
/**
 * COMBAT ROUND LABEL (owner ask 2026-09-25): the arena reads exactly `ROUND X` — the lobby round in a lobby run,
 * the wave everywhere else (the same number the Fight Recap headlines) — and renders nothing when the round is
 * unknown. No `title=` (native tooltips are banned).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { CombatRoundLabel, combatRound, combatRoundLabel } from './CombatRoundLabel';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const lobbyAt = (round: number): RunState['lobby'] => ({ round } as unknown as RunState['lobby']);

describe('combatRound / combatRoundLabel', () => {
  it('uses the lobby round in a lobby run, not the wave', () => {
    expect(combatRound(lobbyAt(7), 3)).toBe(7);
    expect(combatRoundLabel(lobbyAt(7), 3)).toBe('ROUND 7');
  });
  it('falls back to the wave outside the lobby', () => {
    expect(combatRound(undefined, 4)).toBe(4);
    expect(combatRoundLabel(undefined, 4)).toBe('ROUND 4');
  });
  it('is null when the round is unknown', () => {
    expect(combatRound(undefined, 0)).toBeNull();
    expect(combatRound(undefined, Number.NaN)).toBeNull();
    expect(combatRoundLabel(undefined, 0)).toBeNull();
  });
});

describe('CombatRoundLabel', () => {
  it('renders exactly ROUND X in the .combatround element, with no title attribute', () => {
    ui = mount(<CombatRoundLabel round={combatRound(lobbyAt(12), 5)} />);
    const el = ui.container.querySelector('.combatround');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('ROUND 12');
    expect(ui.container.querySelector('[title]')).toBeNull();
  });
  it('renders nothing when the round is unknown', () => {
    ui = mount(<CombatRoundLabel round={null} />);
    expect(ui.container.querySelector('.combatround')).toBeNull();
  });
});
