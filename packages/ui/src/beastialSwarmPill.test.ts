/**
 * RUNE OF BEASTIAL SWARM — pill shows its CURRENT per-death buff (owner ask 2026-08-24).
 *
 * The rune already showed an Avenge (2) x/2 countdown DURING combat (`runeCombatTally`). What it lacked was
 * the number that actually matters between fights: how big each friendly-Beast death buff is right now, which
 * starts +2/+2 and grows permanently. That value is banked on `beastialSwarmLevel`.
 */
import { describe, expect, it } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { runeTally } from './runeTally';

const withRune = (level?: number): RunState =>
  ({ ...createRun(3, 'warden', 'practice'), questFlags: { runeBeastialSwarm: true }, beastialSwarmLevel: level } as RunState);

describe('Rune of Beastial Swarm pill', () => {
  it('shows the base +2/+2 before it has grown', () => {
    expect(runeTally(withRune(undefined), 'rune_beastial_swarm')).toBe('+2/+2');
  });

  it('shows the grown value once Avenge (2) has improved it', () => {
    expect(runeTally(withRune(6), 'rune_beastial_swarm')).toBe('+6/+6');
  });

  it('shows nothing when the rune is not owned', () => {
    const noRune = { ...createRun(3, 'warden', 'practice') } as RunState;
    expect(runeTally(noRune, 'rune_beastial_swarm')).toBeNull();
  });
});
