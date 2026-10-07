/**
 * THE START OF COMBAT CAST BEAT (owner ask 2026-10-07): "we need to show these spells being cast in a start of
 * combat beat. can you use the spell preview that we use for runes except that can also be for start of combat
 * spell casts? for opponents, they should cast on the right side of the screen opposite where the player's side is."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type CombatEvent } from '@game/core';
import { bankedCastAnchor, bankedCastsIn } from './bankedCast';
import { compileMoments } from '../compile';
import { momentKind } from '../kinds';
import { holdMsForKind } from '../choreoConfig';
import { getScore } from '../score';
import { buildBeats } from '../../combatBeats';
import { clearCastPreviews, getCastPreviews, showBankedCastPreviews } from '../../castPreview';

const fight = (): CombatEvent[] => {
  const me = [{ cardId: 'stray', attack: 2, health: 6 }, { cardId: 'stray', attack: 2, health: 6 }];
  const foe = [{ cardId: 'stray', attack: 2, health: 6 }, { cardId: 'stray', attack: 2, health: 6 }];
  return simulate(me, foe, makeRng(4), CARD_INDEX,
    combatSide({ tier: 2, questMods: { fleetingVigor: { attack: 2, health: 1 }, weakenTargets: 1 } }),
    combatSide({ tier: 2, questMods: { markFoeRightmostTaunt: true, bankedImps: 1 } })).events;
};

beforeEach(() => { vi.useFakeTimers(); clearCastPreviews(); });
afterEach(() => { clearCastPreviews(); vi.useRealTimers(); });

describe('the bankedCast moment', () => {
  it('each cast is its OWN moment (kind `bankedCast`, scored with the `bankedCastFx` channel), ahead of its effect', () => {
    const events = fight();
    const moments = compileMoments(events);
    const casts = moments.filter((m) => m.kind === 'bankedCast');
    // player: Fleeting Vigor (opening) + Weaken (inline); enemy: Open the Gates + Marked Target (opening)
    expect(casts.map((m) => bankedCastsIn(m, events).map((c) => `${c.side}:${c.spellId}`)).flat())
      .toEqual(['player:fleetingvigor', 'enemy:openthegates', 'enemy:markedtarget', 'player:weaken']);
    for (const m of casts) {
      expect(m.end - m.start).toBe(1); // the marker alone — its effect is the NEXT moment, so the card reads first
      const next = events[m.end];
      expect(next?.type).not.toBe('attack');
    }
    expect(getScore().bankedCast.some((c) => c.ch === 'bankedCastFx')).toBe(true);
    expect(momentKind({ type: 'bankedCast', side: 'player', spellId: 'weaken' })).toBe('bankedCast');
    expect(holdMsForKind('bankedCast')).toBeGreaterThan(holdMsForKind('buffWave')); // a real read, not a flash
  });

  it('the compiler and its equivalence oracle (`buildBeats`) still agree', () => {
    const events = fight();
    expect(compileMoments(events).map((m) => [m.start, m.end])).toEqual(buildBeats(events).map((b) => [b.start, b.end]));
  });
});

describe('where the cast shows', () => {
  const mine = { left: 40, top: 600, width: 200, height: 60 };
  it('the player\'s on the player\'s anchor (the rune rack); an opponent\'s MIRRORED on the right', () => {
    expect(bankedCastAnchor('player', mine, 1600)).toEqual(mine);
    expect(bankedCastAnchor('enemy', mine, 1600)).toEqual({ ...mine, left: 1600 - 40 - 200 });
  });

  it('feeds the SAME cast preview a rune uses: one card per (side, spell), ×N for a multi-cast, opponent values for a foe', () => {
    const shown = showBankedCastPreviews(
      [{ side: 'player', spellId: 'weaken', count: 2 }, { side: 'enemy', spellId: 'fleetingvigor', count: 1 }],
      () => mine, 1600, { attack: 3, health: 1 },
    );
    expect(shown).toBe(2);
    const [p, e] = getCastPreviews();
    expect(p).toMatchObject({ sourceKey: 'banked:player:weaken', spellId: 'weaken', count: 2, context: 'shop', anchor: mine });
    expect(p!.foe).toBeUndefined();
    expect(e).toMatchObject({ sourceKey: 'banked:enemy:fleetingvigor', count: 1, anchor: { left: 1360 }, foe: { spellPower: { attack: 3, health: 1 } } });
  });

  it('shows nothing when the player\'s anchor is not on screen (never a guessed position)', () => {
    expect(showBankedCastPreviews([{ side: 'enemy', spellId: 'weaken', count: 1 }], () => null, 1600)).toBe(0);
    expect(getCastPreviews()).toEqual([]);
  });
});
