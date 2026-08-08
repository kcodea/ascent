import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/** Owner batch 2026-08-08 (fourth pass): Jensen & Fi through a Rise, and temp keywords through a triple. */

const sim = (p: BoardMinion[], e: BoardMinion[], seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'dragon', 'demon', 'kobold', 'dwarf', 'undead', 'mech'] }), combatSide());

const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 2, health: 2, keywords: [], golden: false, ...extra });

describe('Jensen & Fi destroys its killer even through a Rise', () => {
  const fight = (keywords: string[]) => {
    const board: BoardMinion[] = [{ cardId: 'jenkins', attack: 3, health: 2, keywords: keywords as never }];
    // A lone attacker far too fat for Jensen to grind down (3 Attack vs 300 Health) — so if it dies, the
    // ONLY thing that could have killed it is the Deathrattle destroy.
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 300 }];
    const r = sim(board, enemy);
    return { r, foe: r.initial.enemy[0]!, self: r.initial.player[0]! };
  };

  it('without Rise it destroys the killer (the baseline that always worked)', () => {
    const { r, foe } = fight([]);
    expect(r.events.some((e) => e.type === 'death' && e.target === foe.uid)).toBe(true);
  });

  it('WITH Rise it destroys the killer ON THE RISE DEATH, not one death later', () => {
    // The bug: the Rise branch fires the body's own Echo directly and then emits `onDeath` with
    // `ownAlreadyFired`, so the bus carrying the killer never reached Jensen's own handler.
    //
    // Asserting merely "the killer eventually died" does NOT catch it — a risen Jensen dies a SECOND time
    // through the normal path, which does pass the killer, so the destroy just landed a death late. The
    // ordering is what the fix is about: the kill must resolve before the body returns.
    const { r, foe, self } = fight(['R']);
    const killerDeath = r.events.findIndex((e) => e.type === 'death' && e.target === foe.uid);
    const reborn = r.events.findIndex((e) => e.type === 'reborn' && e.target === self.uid);
    expect(killerDeath, 'the killer was never destroyed at all').toBeGreaterThanOrEqual(0);
    expect(reborn, 'the fixture needs Jensen to actually Rise').toBeGreaterThanOrEqual(0);
    expect(killerDeath, 'the destroy landed AFTER the Rise — the rise-death dropped its killer')
      .toBeLessThan(reborn);
  });
});

describe('a triple never launders a TEMPORARY keyword into a permanent one', () => {
  /** Triple three copies of `cardId`, each carrying the given instance fields, and report the golden. */
  const tripleOf = (cardId: string, extra: Partial<BoardCard>): BoardCard | undefined => {
    const s: RunState = {
      ...createRun(5), phase: 'recruit', wave: 6, embers: 40,
      board: [bc('a', cardId, extra), bc('b', cardId, extra), bc('c', cardId, extra)],
    } as RunState;
    // `checkTriples` runs on the play path; a direct buy/play of the third copy is what fires it in a real
    // run, so drive it through the reducer rather than calling the private helper.
    const next = reduce({ ...s, board: s.board.slice(0, 2), hand: [bc('d', cardId, extra)] },
      { type: 'play', uid: 'd' }) as RunState;
    // A completed triple hands the golden over in HAND (verified by probe), not onto the board.
    return [...next.board, ...next.hand].find((c) => c.golden);
  };

  it('a one-combat Rise (tempReborn) does NOT survive the combine', () => {
    const golden = tripleOf('alley', { keywords: ['R'], tempReborn: true });
    expect(golden, 'the three copies should have tripled').toBeDefined();
    expect(golden!.keywords, 'the temporary Rise became permanent on the golden').not.toContain('R');
  });

  it('a one-combat Ward (tempShield) does NOT survive the combine either', () => {
    const golden = tripleOf('alley', { keywords: ['DS'], tempShield: true });
    expect(golden).toBeDefined();
    expect(golden!.keywords, 'the temporary Ward became permanent on the golden').not.toContain('DS');
  });

  it('a REAL Rise still carries through — only the temporary marker is stripped', () => {
    // Same keyword, no `tempReborn` marker: this one is genuinely the body's, and must survive.
    const golden = tripleOf('alley', { keywords: ['R'] });
    expect(golden).toBeDefined();
    expect(golden!.keywords, 'a permanent Rise was wrongly stripped').toContain('R');
  });

  it('a printed keyword survives even when every copy is marked temporary', () => {
    // If the BASE card prints the keyword, the pill is the card's own — a temp marker on the instances
    // must not strip what the printed body always had.
    const printed = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && c.keywords.includes('DS'));
    if (!printed) return;
    const golden = tripleOf(printed.id, { keywords: [...printed.keywords], tempShield: true });
    expect(golden).toBeDefined();
    expect(golden!.keywords, `${printed.name} prints Ward — it must keep it`).toContain('DS');
  });
});
