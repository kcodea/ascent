/**
 * RUNE OF SPELLHIDE THROUGH THE REAL RUN -> COMBAT PIPELINE (owner 2026-09-24): *"Fix Rune of Spellhide never
 * finding its Beast in combat."* The shop records `{ spellId, uid }` with the RUN board uid; `simulate()` gives every
 * combat body a fresh uid (`m0`, `m1`, ...) and keeps the run uid on `sourceUid`. The Start-of-Combat re-cast
 * matched `m.uid === rec.uid`, so through the real bridge it never found its Beast and silently skipped. This test
 * drives the reducer (buy rune, cast on a Beast, face the fight) rather than hand-building a combat side, so the
 * uid translation is exercised exactly as a player hits it. Oracle: R-RUNE-16 in packages/rules/src/registry/approved/runes.ts.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

const card = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

/** A run holding Rune of Spellhide, with one Beast (+ a non-Beast) on the board and N Spirit Fires in hand. */
function armed(spells = 1): RunState {
  const s: RunState = {
    ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, gold: 0, shop: [],
    runeforgeOffer: ['rune_spellhide'],
    board: [card('beast', 'stray', 1, 1), card('other', 'sandbag', 0, 50)],
    hand: Array.from({ length: spells }, (_, i) => card(`sf${i}`, 'spiritfire')),
  } as RunState;
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

/** Cast Spirit Fire (+2/+3) on the Beast, face the fight, and return the combat + the Beast's combat body. */
function castAndFight(s: RunState, casts = 1) {
  for (let i = 0; i < casts; i++) s = reduce(s, { type: 'play', uid: `sf${i}`, targetUid: 'beast' }) as RunState;
  const recorded = s.spellhidePending ?? [];
  s = reduce(s, { type: 'faceOmen' }) as RunState;
  const combat = s.lastCombat!;
  const body = combat.initial.player.find((m) => m.cardId === 'stray')!;
  return { recorded, combat, body };
}

describe('Rune of Spellhide: the Start-of-Combat re-cast finds its Beast through the real pipeline', () => {
  it('the shop cast is recorded against the RUN uid, and combat re-casts it onto that Beast', () => {
    const { recorded, combat, body } = castAndFight(armed());
    expect(recorded).toEqual([{ spellId: 'spiritfire', uid: 'beast' }]);
    expect(body, 'the Beast reached combat').toBeDefined();
    expect(body.uid, 'combat renames the body, so the lookup must go through sourceUid').not.toBe('beast');
    const fired = combat.events.filter((e) => e.type === 'questTrigger' && e.flag === 'runeSpellhide' && e.side === 'player');
    expect(fired, 'Rune of Spellhide never fired: its Beast was not found in combat').toHaveLength(1);
    const buffs = combat.events.filter((e) => e.type === 'buff' && e.target === body.uid && e.attack === 2 && e.health === 3);
    expect(buffs.length, 'the re-cast Spirit Fire (+2/+3) did not land on the Beast').toBeGreaterThanOrEqual(1);
  });

  it('only the turn’s FIRST stat spell on a Beast is recorded and re-cast', () => {
    const { recorded, combat } = castAndFight(armed(2), 2);
    expect(recorded).toHaveLength(1);
    expect(combat.events.filter((e) => e.type === 'questTrigger' && e.flag === 'runeSpellhide')).toHaveLength(1);
  });
});
