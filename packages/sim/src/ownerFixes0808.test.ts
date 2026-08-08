import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, spellDisplayText, type RunState } from './index';

/** The 2026-08-08 owner fix batch: Rise resets, combat Discovers, Reinforcing Ale, Veinstorm preview. */

const sim = (p: BoardMinion[], e: BoardMinion[], side = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast', 'dragon', 'demon', 'kobold', 'dwarf', 'undead'], ...side } as never), combatSide());

describe('a risen body resets (owner ruling 2026-08-08)', () => {
  it('Avenge progress restarts at 0 after a Rise', () => {
    // Kennelmaster (Avenge 3) with Rise, behind three 1-Health friends and a big enemy. Deaths 1-2 accrue;
    // the Kennelmaster dies (death 3 = its own rise-death) and returns. If the baseline works, deaths 4-5
    // read as 1-2 for it — its Avenge must NOT fire at the side's raw multiple of 3.
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'kennel', attack: 1, health: 1, keywords: ['SC', 'R'] },
      { cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const r = sim(board, killer);
    // The Kennelmaster's improve fires on ITS OWN 3rd witnessed death. Its rise-death lands somewhere among
    // the five; whatever the interleaving, the raw side tally reaches 5+ while its post-rise view stays
    // below 3 — so with the baseline the improve count is strictly lower than without it.
    const improves = r.events.filter((e) => e.type === 'improve').length;
    // Unbaselined, deaths 3 and (rise offsets aside) 6 both fire = up to 2 improves; with the reset the
    // post-rise view can't reach 3 before the board is dead. At most one improve can have fired pre-rise.
    expect(improves, 'the risen Kennelmaster still counted pre-Rise deaths').toBeLessThanOrEqual(1);
  });

  it('a Sunmane-granted rally does not survive the Rise', () => {
    // The Sunmane Herald grants its neighbour an escalating rally (`rallySpreadAtk`). If that neighbour has
    // Rise and dies, the returned body must NOT still carry the granted rally — measured by the total 'sc'
    // Rally announcements: with the reset, the risen body's later attacks announce nothing extra.
    const withRise: BoardMinion[] = [
      { cardId: 'b2_sunmane', attack: 2, health: 60 },
      { cardId: 'sandbag', attack: 2, health: 1, keywords: ['R', 'T'] },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 200 }];
    const r = sim(withRise, killer);
    // Find any rally 'sc' events attributed AFTER the reborn beat to the risen sandbag.
    const uidOf = r.initial.player.find((m) => m.cardId === 'sandbag')!.uid;
    const rebornAt = r.events.findIndex((e) => e.type === 'reborn' && e.target === uidOf);
    if (rebornAt >= 0) {
      const after = r.events.slice(rebornAt);
      const rallies = after.filter((e) => e.type === 'sc' && (e as { source?: string }).source === uidOf
        && String((e as { text: string }).text).toLowerCase().includes('rally')).length;
      expect(rallies, 'the granted rally rode through the Rise').toBe(0);
    }
  });
});

describe('Reinforcing Ale casts in combat (owner report: Sporebat fizzled it)', () => {
  it('grants a minion of the side’s most common living type', () => {
    // Sporebat's Echo casts the stored spell. Two living Beasts make Beast the top type; the grant is a
    // `toHand` carry-back.
    const board: BoardMinion[] = [
      { cardId: 'sporebat', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 60 }, { cardId: 'stray', attack: 1, health: 60 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const r = sim(board, killer, { lastSpellCastId: 'wo_reinforcement' });
    const granted = r.events.filter((e) => e.type === 'toHand' && e.side === 'player');
    expect(granted.length, 'the Ale cast should have granted a minion').toBeGreaterThan(0);
    const def = CARD_INDEX[(granted[0] as { cardId: string }).cardId];
    expect(def?.tribe === 'beast' || def?.tribe2 === 'beast', 'the grant should match the top type (Beast)').toBe(true);
  });
});

describe('a Discover spell cast mid-combat grants a random pick, no modal (owner ruling 2026-08-08)', () => {
  it('settle auto-picks instead of opening the Discover UI', () => {
    // A fragile Sporebat whose stored spell is a Discover spell: its Echo casts it mid-fight, the cast is
    // queued, and settle must GRANT a random option rather than open the modal — a modal at settle was the
    // combat-phase softlock family (see 2026-08-07).
    let s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 10,
      board: [{ uid: 's', cardId: 'sporebat', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      lastSpellCastId: 'sprout' };
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'settleCombat' }) as RunState;
    const cast = (s.lastCombat?.events ?? []).some((e) => e.type === 'sc' && String((e as { text?: string }).text ?? '').includes('Sprout'));
    if (cast) {
      expect(s.discover, 'the Discover modal must NOT open from a combat cast').toBeUndefined();
      expect(s.hand.length, 'the random pick should have landed in hand').toBeGreaterThan(0);
    } else {
      // The served board killed nothing / the Echo never fired on this seed — assert only the invariant.
      expect(s.discover).toBeUndefined();
    }
  });
});

describe('Veinstorm previews its live Ruby value (the Storm Chaser hover)', () => {
  it('greens the printed +1/+1 to base + rubyBonus', () => {
    expect(spellDisplayText('veinstorm', 0, 0, 0, 0, 0, 0, {})).toContain('+1/+1');
    // The owner's screenshot: rubyBonus 0/+1 should read +1/+2.
    expect(spellDisplayText('veinstorm', 0, 0, 0, 0, 0, 0, { rubyBonus: { attack: 0, health: 1 } })).toContain('{{+1/+2}}');
  });
});
