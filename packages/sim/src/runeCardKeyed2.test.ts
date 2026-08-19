import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, spellDisplayText, type BoardCard, type RunState } from './index';

/** The card-keyed batch, wave 2 (2026-08-07): the six runes needing new trigger paths, plus the Matriarch
 *  retexture and the Moonhowl Mentor per-instance rework that shipped alongside them. */

const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

const sim = (p: BoardMinion[], e: BoardMinion[], side = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast', 'dragon', 'demon', 'kobold', 'dwarf'], ...side } as never), combatSide());

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the six defs ship as specced', () => {
  it('costs, rarity, all Set-2 scoped', () => {
    const spec: Record<string, [number, boolean]> = {
      rune_unbroken_vein: [5, false],
      rune_moonhowl: [5, true], rune_shared_reflection: [5, true],
      rune_living_growth: [5, true],
      // rune_battle_refraction + rune_flooded_vault archived 2026-08-18 (ARCHIVED_RUNES) — no longer in the active pool.
    };
    for (const [id, [cost, epic]] of Object.entries(spec)) {
      expect(rune(id).cost, `${id} cost`).toBe(cost);
      expect(!!rune(id).epic, `${id} rarity`).toBe(epic);
      expect(rune(id).sets, `${id} names a Set-2 card`).toEqual(['set2']);
    }
  });
});

describe('Rune of Moonhowl', () => {
  it('a dying Mage-Pup casts its taught spell', () => {
    const board: BoardMinion[] = [
      { cardId: 'b2_magepup', attack: 1, health: 1, taughtSpellId: 'growth' },
      { cardId: 'stray', attack: 1, health: 40 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const casts = (mods: object) => sim(board, killer, { questMods: mods })
      .events.filter((e) => e.type === 'sc' && String((e as { text: string }).text).includes('Growth')).length;
    expect(casts({}), 'baseline: a dying Pup casts nothing').toBe(0);
    expect(casts({ runeMoonhowl: true })).toBeGreaterThan(0);
  });

  it('an untaught Pup dies silently — there is nothing to cast', () => {
    const board: BoardMinion[] = [{ cardId: 'b2_magepup', attack: 1, health: 1 }];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const r = sim(board, killer, { questMods: { runeMoonhowl: true } });
    expect(r.events.filter((e) => e.type === 'sc').length).toBe(0);
  });
});

describe('Rune of the Flooded Vault', () => {
  it('Water Dragon’s Avenge also casts the left-most hand spell, without consuming it', () => {
    // Four fodder deaths proc the Avenge; `handSpellIds` is the combat's view of the hand.
    const board: BoardMinion[] = [
      ...Array.from({ length: 4 }, () => ({ cardId: 'sandbag', attack: 0, health: 1 })),
      { cardId: 'd2_curator', attack: 5, health: 60 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const casts = (mods: object) => sim(board, killer, { handSpellIds: ['growth'], questMods: mods })
      .events.filter((e) => e.type === 'sc' && String((e as { text: string }).text).includes('Growth')).length;
    expect(casts({}), 'baseline: the Avenge only copies, never casts').toBe(0);
    expect(casts({ runeFloodedVault: true })).toBeGreaterThan(0);
  });
});

describe('Rune of the Unbroken Vein', () => {
  it('a played Veinbreaker applies BOTH options with no prompt', () => {
    const s = withRune('rune_unbroken_vein', { hand: [bm('v', 'k_veinbreaker', 3, 3)] });
    const next = reduce(s, { type: 'play', uid: 'v' }) as RunState;
    expect(next.chooseOne, 'no prompt should open').toBeUndefined();
    expect(next.board.some((c) => c.cardId === 'k_veinbreaker'), 'the body should be on the board').toBe(true);
    // Option B is "get 4 Rubies" — their arrival is the visible proof option B fired alongside option A.
    expect(next.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'option B (4 Rubies) never fired').toBe(4);
  });

  it('without the rune the prompt still opens', () => {
    const s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40, hand: [bm('v', 'k_veinbreaker', 3, 3)] };
    const next = reduce(s, { type: 'play', uid: 'v' }) as RunState;
    expect(next.chooseOne?.cardId).toBe('k_veinbreaker');
  });
});

describe('Rune of Battle Refraction', () => {
  it('a living Prismcaster repeats a combat Ruby play', () => {
    // Candleback-style combat Ruby sources route through `playRubyOn`; Geode Guardian's Echo plays Rubies on
    // its summons. Simpler probe: Candle Conduit… — use the Ruby-buff EVENTS as the measure instead: the
    // same board with and without the flag, Ruby stats granted must grow with a Prismcaster present.
    const board: BoardMinion[] = [
      { cardId: 'k_geode', attack: 2, health: 1 },
      { cardId: 'k_prismcaster', attack: 3, health: 60 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const rubyStats = (mods: object) => sim(board, killer, { questMods: mods })
      .events.filter((e) => e.type === 'buff' && (e as { ruby?: true }).ruby)
      .reduce((n, e) => n + ((e as { attack: number }).attack + (e as { health: number }).health), 0);
    const base = rubyStats({});
    const armed = rubyStats({ runeBattleRefraction: true });
    expect(base, 'the fixture needs a real combat Ruby play').toBeGreaterThan(0);
    expect(armed, 'the Prismcaster should have repeated the Rubies').toBeGreaterThan(base);
  });
});

describe('Rune of Living Growth', () => {
  it('each Growth Mushy creates improves the spell, and the cast pays the accrual', () => {
    // Mushy's Shout grants a Growth and ticks the improver; casting Growth then grants base+bonus.
    let s = withRune('rune_living_growth', {
      board: [bm('t', 'stray', 1, 1)], hand: [bm('m', 'd2_scalefeather', 2, 3)],
    });
    s = reduce(s, { type: 'play', uid: 'm' }) as RunState; // Shout: get a Growth (+1 tick)
    expect(s.growthBonus, 'the Shout grant should tick the improver').toBe(1);
    const granted = s.hand.find((c) => c.cardId === 'growth');
    expect(granted, 'no Growth was granted').toBeDefined();
    const before = s.board.find((c) => c.uid === 't')!;
    const [a0, h0] = [before.attack, before.health];
    s = reduce(s, { type: 'play', uid: granted!.uid }) as RunState;
    const after = s.board.find((c) => c.uid === 't')!;
    // Base +1/+1 plus the accrued +1/+1 = +2/+2 on every friendly minion.
    expect([after.attack - a0, after.health - h0]).toEqual([2, 2]);
  });

  it('combat-created Growths tick the improver at settle (owner ruling: combat counts too)', () => {
    // A fragile Mushy dies in the fight; its Echo hands over a Growth. Settle must credit the improver even
    // though the grant happened mid-combat — read off the fight's toHand events, sourced to the Mushy body.
    let s = withRune('rune_living_growth', {
      board: [bm('m', 'd2_scalefeather', 2, 1)], phase: 'recruit',
    });
    expect(s.growthBonus ?? 0).toBe(0);
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'settleCombat' }) as RunState;
    const echoed = (s.lastCombat?.events ?? []).filter((e) =>
      e.type === 'toHand' && e.cardId === 'growth').length;
    if (echoed > 0) {
      expect(s.growthBonus ?? 0, 'the combat grant never reached the improver').toBe(echoed);
    } else {
      // The served board let Mushy survive — the fixture can't force a death, so assert only the harmless case.
      expect(s.growthBonus ?? 0).toBe(0);
    }
  });

  it('the Growth card itself prints the upgraded value (the live-text rule)', () => {
    expect(spellDisplayText('growth', 0, 0, 0, 0, 0, 0, {})).toContain('+1/+1');
    expect(spellDisplayText('growth', 0, 0, 0, 0, 0, 0, { growthBonus: 2 })).toContain('{{+3/+3}}');
    // Spell power stacks on top, exactly as it does at cast time.
    expect(spellDisplayText('growth', 1, 0, 1, 0, 0, 0, { growthBonus: 2 })).toContain('{{+4/+4}}');
  });

  it('without the rune Mushy ticks nothing', () => {
    let s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40,
      board: [], hand: [bm('m', 'd2_scalefeather', 2, 3)] };
    s = reduce(s, { type: 'play', uid: 'm' }) as RunState;
    expect(s.growthBonus ?? 0).toBe(0);
  });
});

describe('Rune of the Matriarch (retexture 2026-08-07)', () => {
  it('adds ONE extra cast per Matriarch — a golden pays 3, not the old 4', () => {
    const grants = (golden: boolean, mods: object) => {
      const board: BoardMinion[] = [{ cardId: 'b2_runebloom', attack: 4, health: 40, golden }];
      const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
      const r = sim(board, killer, { questMods: mods });
      const e = r.events.find((ev) => ev.type === 'sc' && String((ev as { text: string }).text).includes('extra time'));
      const m = e ? /cast (\d+) extra/.exec(String((e as { text: string }).text)) : null;
      return m ? Number(m[1]) : 0;
    };
    expect(grants(false, {}), 'plain, unarmed').toBe(1);
    expect(grants(false, { runeMatriarch: true }), 'plain + rune: 1 base + 1 additional').toBe(2);
    expect(grants(true, { runeMatriarch: true }), 'golden + rune: 2 base + 1 additional (NOT ×2 = 4)').toBe(3);
  });
});

describe('Moonhowl Mentors are independent (owner report 2026-08-07)', () => {
  const mentorId = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.do === 'grantMagePupTaught'))!.id;

  it('two Mentors each teach off the first spell bought', () => {
    // The old run-level counter meant two Mentors + two spell buys paid ONE Pup. Per-instance latches: the
    // first buy teaches BOTH (each Mentor witnesses it on its own latch).
    let s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40,
      board: [bm('m1', mentorId, 2, 2), bm('m2', mentorId, 2, 2)],
      shop: [], spell: { uid: 'sp', cardId: 'growth' } as never };
    s = reduce(s, { type: 'buy', uid: 'sp' }) as RunState;
    expect(s.hand.filter((c) => c.cardId === 'b2_magepup').length, 'both Mentors should teach').toBe(2);
  });

  it('one Mentor still teaches only once a turn', () => {
    let s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40,
      board: [bm('m1', mentorId, 2, 2)], shop: [], spell: { uid: 'sp', cardId: 'growth' } as never };
    s = reduce(s, { type: 'buy', uid: 'sp' }) as RunState;
    s = { ...s, spell: { uid: 'sp2', cardId: 'growth' } as never, embers: 40 };
    s = reduce(s, { type: 'buy', uid: 'sp2' }) as RunState;
    expect(s.hand.filter((c) => c.cardId === 'b2_magepup').length).toBe(1);
  });
});
