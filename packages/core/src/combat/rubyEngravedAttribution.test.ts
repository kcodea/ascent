import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult } from '../index';

/**
 * R-RUBY-ENGRAVED-01 (owner 2026-11-02: "specifically the engraved buff being from a ruby, not all engraved buffs,
 * but the buffs that are rubies should be counted as ruby buffs"). A Ruby that lands on an ENGRAVED body in combat
 * carries home as a RUBY (the run card's 'Ruby' ledger, which every "this minion's Rubies" reader counts), never as a
 * generic Engraved gain. Three holes are pinned here:
 *  - a golden Taurus doubles its neighbour's gains (`gainMult`); the doubled half of a Ruby used to go home 'Engraved'.
 *  - Transcendant engraves adjacent Dragons as a live AURA (no EG keyword); a Ruby there used to go home 'Engraved'.
 *  - a PERMANENT Ruby (Rune of Engraving Gems) on a Transcendant-adjacent Dragon used to carry home TWICE.
 * Non-Ruby Engraved gains stay 'Engraved'.
 *
 * Setup: Kobebes (1 Health) dies to the first hit and its Echo casts 3 Rubies (3/3 at base strength) on each Kobold.
 */
const kobebes: BoardMinion = { cardId: 'k_kobabyboldies', attack: 0, health: 1, sourceUid: 'K' };
const kobold = (extra: Partial<BoardMinion> = {}): BoardMinion => ({ cardId: 'k_mineralmaster', attack: 1, health: 900, sourceUid: 'M', ...extra });
const side = (questMods: object = {}) => combatSide({ tier: 6, tribes: ['kobold', 'dragon'], questMods: questMods as never });
const foe: BoardMinion = { cardId: 'sandbag', attack: 1, health: 3000 };

const asPlayer = (p: BoardMinion[], mods: object = {}, seed = 3) =>
  simulate(p, [foe], makeRng(seed), CARD_INDEX, side(mods), combatSide({ tier: 6 }));
const asEnemy = (p: BoardMinion[], mods: object = {}, seed = 3) =>
  simulate([foe], p, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), side(mods));

type Row = NonNullable<CombatResult['playerPermaBuffs']>[number];
const rowsFor = (rows: readonly Row[] | undefined, uid: string) => (rows ?? []).filter((r) => r.sourceUid === uid);
const rubyLanded = (r: CombatResult, uid: string) => r.events
  .filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff' && !!(e as { ruby?: true }).ruby && e.target === uid)
  .reduce((acc, e) => ({ attack: acc.attack + e.attack, health: acc.health + e.health }), { attack: 0, health: 0 });

describe('R-RUBY-ENGRAVED-01: an Engraved Ruby carries home as a Ruby', () => {
  it('control: a native Engraved body keeps its Ruby as one Ruby row', () => {
    const r = asPlayer([kobold({ keywords: ['EG'] }), kobebes]);
    expect(rowsFor(r.playerPermaBuffs, 'M')).toEqual([{ sourceUid: 'M', attack: 3, health: 3, engraved: false, ruby: true }]);
  });

  it("a golden Taurus's doubled Ruby goes home whole as a Ruby (no 'Engraved' remainder)", () => {
    const r = asPlayer([kobold(), { cardId: 'taurus', attack: 1, health: 900, golden: true, sourceUid: 'T' }, kobebes]);
    const m = r.initial.player[0]!.uid;
    expect(rubyLanded(r, m), 'the doubled Ruby that actually landed').toEqual({ attack: 6, health: 6 });
    expect(rowsFor(r.playerPermaBuffs, 'M')).toEqual([{ sourceUid: 'M', attack: 6, health: 6, engraved: false, ruby: true }]);
  });

  it('a Ruby on a Dragon beside Transcendant (an aura Engrave) goes home as a Ruby', () => {
    const r = asPlayer([kobold({ addedTribes: ['dragon'] }), { cardId: 'd2_transcendence', attack: 1, health: 900, sourceUid: 'T' }, kobebes]);
    expect(rowsFor(r.playerPermaBuffs, 'M')).toEqual([{ sourceUid: 'M', attack: 3, health: 3, engraved: false, ruby: true }]);
  });

  it('a PERMANENT Ruby beside Transcendant carries home once, not twice', () => {
    const r = asPlayer([kobold({ addedTribes: ['dragon'] }), { cardId: 'd2_transcendence', attack: 1, health: 900, sourceUid: 'T' }, kobebes], { runeEngravingGems: true });
    const m = r.initial.player[0]!.uid;
    const rows = rowsFor(r.playerPermaBuffs, 'M');
    const kept = rows.reduce((acc, x) => ({ attack: acc.attack + x.attack, health: acc.health + x.health }), { attack: 0, health: 0 });
    expect(kept, 'carry-back equals what landed').toEqual(rubyLanded(r, m));
    expect(rows.every((x) => x.ruby)).toBe(true);
  });

  it('a NON-Ruby Engraved gain stays Engraved (only Ruby stats change label)', () => {
    // Rune of Warding triples the right-most minion's Health at Start of Combat: a plain combat buff, not a Ruby.
    const r = simulate([{ cardId: 'sandbag', attack: 0, health: 10, keywords: ['EG'], sourceUid: 'E' }], [foe], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeWarding: true } as never }), combatSide());
    const rows = rowsFor(r.playerPermaBuffs, 'E');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.engraved && !x.ruby)).toBe(true);
  });

  it('is symmetric: the ENEMY side carries the same Ruby rows (R-SYMMETRY-01)', () => {
    const boards: BoardMinion[][] = [
      [kobold(), { cardId: 'taurus', attack: 1, health: 900, golden: true, sourceUid: 'T' }, kobebes],
      [kobold({ addedTribes: ['dragon'] }), { cardId: 'd2_transcendence', attack: 1, health: 900, sourceUid: 'T' }, kobebes],
    ];
    for (const b of boards) {
      const p = rowsFor(asPlayer(b).playerPermaBuffs, 'M');
      const e = rowsFor(asEnemy(b).enemyCarry?.permaBuffs, 'M');
      expect(e).toEqual(p);
      expect(p.every((x) => x.ruby)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const b: BoardMinion[] = [kobold(), { cardId: 'taurus', attack: 1, health: 900, golden: true, sourceUid: 'T' }, kobebes];
    expect(JSON.stringify(asPlayer(b, {}, 11))).toBe(JSON.stringify(asPlayer(b, {}, 11)));
  });
});

/**
 * R-ENGRAVE-05 (owner ruling 2026-11-03: "'Engraved' isn't a buff type, it just makes buffs and enchantments gained
 * in combat permanent. So if a minion is buffed by growth +20/20 it should just keep that growth +20/20."). Every kept
 * combat gain goes home under the label the Shop would give it; no kept row is ever labelled 'Engraved'.
 */
describe('R-ENGRAVE-05: Engraved keeps each combat gain as itself', () => {
  const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 }];
  const keptOf = (r: CombatResult, uid: string) => rowsFor(r.playerPermaBuffs, uid);

  it('a combat Growth on an Engraved minion goes home as Growth', () => {
    const r = simulate(
      [{ cardId: 'taragosa', attack: 4, health: 900, sourceUid: 'TG' }, { cardId: 'sandbag', attack: 1, health: 900, keywords: ['EG'], sourceUid: 'S' }],
      wall, makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const rows = keptOf(r, 'S');
    expect(rows.length).toBeGreaterThan(0);
    // (Target Dummy also keeps its own on-damage Attack, under its own name: also never 'Engraved'.)
    expect(rows.some((x) => x.label === 'Engraved')).toBe(false);
    const growth = rows.find((x) => x.label === 'Growth')!;
    expect(growth).toBeDefined();
    // the row carries exactly the Growth stats the body gained
    const s = r.initial.player[1]!.uid;
    const got = r.events.filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff' && e.target === s && e.spellId === 'growth')
      .reduce((acc, e) => ({ attack: acc.attack + e.attack, health: acc.health + e.health }), { attack: 0, health: 0 });
    expect({ attack: growth.attack, health: growth.health }).toEqual(got);
  });

  it("a labelled grant keeps its label (Rune of Warding's Health is the rune's, not 'Engraved')", () => {
    const r = simulate([{ cardId: 'sandbag', attack: 0, health: 10, keywords: ['EG'], sourceUid: 'E' }], [foe], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeWarding: true } as never }), combatSide());
    const rows = keptOf(r, 'E');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.label && x.label !== 'Engraved')).toBe(true);
  });

  it('a Transcendant-adjacent Dragon keeps a non-Ruby gain under its own label, once', () => {
    // Taragosa's Growth on an ally attack lands on the Dragon beside a Transcendant (an aura Engrave).
    const r = simulate(
      [{ cardId: 'taragosa', attack: 4, health: 900, sourceUid: 'TG' }, { cardId: 'sandbag', attack: 1, health: 900, addedTribes: ['dragon'], sourceUid: 'D' }, { cardId: 'd2_transcendence', attack: 1, health: 900, sourceUid: 'T' }],
      wall, makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['dragon'] }), combatSide({ tier: 1 }));
    const rows = keptOf(r, 'D');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((x) => x.label === 'Engraved')).toBe(false);
  });

  it('symmetric for the enemy side', () => {
    const b: BoardMinion[] = [{ cardId: 'taragosa', attack: 4, health: 900, sourceUid: 'TG' }, { cardId: 'sandbag', attack: 1, health: 900, keywords: ['EG'], sourceUid: 'S' }];
    const p = simulate(b, wall, makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const e = simulate(wall, b, makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    expect(rowsFor(e.enemyCarry?.permaBuffs, 'S')).toEqual(rowsFor(p.playerPermaBuffs, 'S'));
  });
});
