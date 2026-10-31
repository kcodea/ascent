// @vitest-environment jsdom
/**
 * R-MATCH-BUFFS-01 (owner 2026-10-31): right-click Inspect on a Match History board shows the card's buff breakdown,
 * biggest first, with the smallest folded into one "N more" row, the same panel the game shows in a run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { compactBuffs } from '@game/sim';
import { inspectViewOf } from '../Card';
import { Inspect } from '../Inspect';
import { mount } from '../renderedText.mount';
import { storedCardView } from '../storedBoardView';
import { useGame } from '../store';

const m = mount(<div />);
afterEach(() => { m.render(<div />); useGame.setState({ inspect: null }); });

const rowsOf = (): string[] => [...document.body.querySelectorAll('.inspect-buffs .ib-row')].map((r) => r.textContent ?? '');

describe('Match History inspect shows the stored buff breakdown (R-MATCH-BUFFS-01)', () => {
  it('lists the biggest buffs first and folds the rest into "N more" with their total', () => {
    const buffs = compactBuffs([
      { source: 'Spirit Fire', attack: 1, health: 1, count: 1 },
      { source: 'Striker', attack: 20, health: 0, count: 20 },
      { source: 'Pack Leader', attack: 3, health: 0, count: 1 },
      { source: 'Tiny A', attack: 1, health: 0, count: 1 },
      { source: 'Tiny B', attack: 0, health: 1, count: 1 },
      { source: 'Big HP', attack: 0, health: 10, count: 2 },
    ]);
    const view = storedCardView({ cardId: 'pack', attack: 40, health: 20, buffs });
    m.render(<Inspect />);
    act(() => useGame.setState({ inspect: inspectViewOf(view, undefined) }));
    const rows = rowsOf();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('Striker');
    expect(rows[0]).toContain('+20/+0');
    expect(rows[1]).toContain('Big HP');
    expect(rows[4]).toBe('2 more+1/+1');
  });

  it('an older record with no breakdown shows no Buffs panel', () => {
    m.render(<Inspect />);
    act(() => useGame.setState({ inspect: inspectViewOf(storedCardView({ cardId: 'pack', attack: 4, health: 4 }), undefined) }));
    expect(document.body.querySelector('.inspect-buffs')).toBeNull();
  });
});
