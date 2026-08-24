/**
 * FIBBSY — hover preview shows a Ruby at its LIVE value (owner ask 2026-08-24).
 *
 * StatusBar builds the preview instance the same way the render does: a Ruby's stats are its def base plus the
 * run's `rubyStatBonus`, and `instView` renders the "+A/+H" grant text off those. This pins the arithmetic
 * (the JSX that portals the card is a one-liner) so the preview can never promise a value the mint won't hand.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, rubyStatBonus, type RunState } from '@game/sim';
import { instView } from './instView';

function rubyPreviewText(run: RunState): string {
  // Mirrors StatusBar's previewRuby branch exactly.
  const rb = rubyStatBonus(run);
  const base = CARD_INDEX['ruby'];
  const view = instView(
    { uid: 'power-preview', cardId: 'ruby', tribe: 'neutral', attack: (base?.attack ?? 0) + rb.attack, health: (base?.health ?? 0) + rb.health, keywords: [], golden: false },
    run.tier, undefined, 0, 0, run.spellsThisTurn, run.deathrattlesTriggered,
    run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, undefined, undefined,
    { rubyBonus: rb, impAura: run.impBuff, topTribe: null },
  );
  return view.text;
}

describe('Fibbsy Ruby hover preview', () => {
  it('shows +1/+1 at base (no ruby bonus)', () => {
    expect(rubyPreviewText(createRun(3, 'fibbsy', 'practice'))).toContain('+1/+1');
  });

  it('tracks the live ruby bonus — +3/+3 with a +2/+2 accrued bonus', () => {
    const run = { ...createRun(3, 'fibbsy', 'practice'), rubyBonus: { attack: 2, health: 2 } } as RunState;
    expect(rubyPreviewText(run)).toContain('+3/+3');
  });

  it('the Ruby token it previews is a real 1/1 card', () => {
    const ruby = CARD_INDEX['ruby'];
    expect(ruby).toBeDefined();
    expect([ruby!.attack, ruby!.health]).toEqual([1, 1]);
    expect(ruby!.ruby).toBe(true);
  });
});
