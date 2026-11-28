import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES, type CosmeticDef, type CrateRarity } from './cosmetics';
import { DEFAULT_PACK_ECONOMY } from './packEconomy';
import type { PackLook } from './packs';
import { packPool, rollPack } from './packRoll';

const DUP = DEFAULT_PACK_ECONOMY.duplicateAether;
const zeros = Array.from({ length: 15 }, () => 0);

function item(id: string, category: CosmeticDef['category'], rarity: CosmeticDef['rarity'], extra: Partial<CosmeticDef> = {}): CosmeticDef {
  return { id, category, name: id, rarity, acquisition: { type: 'crate' }, assets: {}, active: true, ...extra };
}
/** A catalog with every rarity in every one of three categories, two items each. */
function fullCatalog(): CosmeticDef[] {
  const out: CosmeticDef[] = [];
  for (const cat of ['emote', 'title', 'announcer'] as const)
    for (const r of COSMETIC_RARITIES) for (const n of [1, 2]) out.push(item(`${cat}-${r}-${n}`, cat, r));
  return out;
}
const rarityLook = (r: CrateRarity): PackLook => ({ kind: 'rarity', id: `rarity-${r}`, name: r, guaranteedFloor: r });
const categoryLook = (c: string): PackLook => ({ kind: 'category', id: `category-${c}`, name: c, guaranteedFloor: 'common' });
const rand = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const drawSet = (r: () => number) => Array.from({ length: 15 }, r);

describe('rollPack', () => {
  const catalog = fullCatalog();
  it('draws of 0 on a Common pack give five Common cards', () => {
    const cards = rollPack({ look: rarityLook('common'), owned: [], draws: zeros, catalog });
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => c.rarity === 'common')).toBe(true);
    expect(cards.map((c) => c.guaranteed)).toEqual([false, false, false, false, true]);
  });
  it('a Rare pack card 5 is never Common; an Ancient pack card 5 is Ancient', () => {
    const r = rand(7);
    for (let i = 0; i < 200; i++) {
      const d = drawSet(r);
      expect(rollPack({ look: rarityLook('rare'), owned: [], draws: d, catalog })[4]!.rarity).not.toBe('common');
      expect(rollPack({ look: rarityLook('ancient'), owned: [], draws: d, catalog })[4]!.rarity).toBe('ancient');
    }
  });
  it('a category pack card 5 is in its category and unowned while one remains', () => {
    const r = rand(11);
    for (let i = 0; i < 100; i++) {
      const c5 = rollPack({ look: categoryLook('emote'), owned: [], draws: drawSet(r), catalog })[4]!;
      expect(c5.rewardId.startsWith('emote-')).toBe(true);
    }
    const cat = [item('emote-a', 'emote', 'common'), item('emote-b', 'emote', 'common'), item('title-a', 'title', 'common')];
    const c5 = rollPack({ look: categoryLook('emote'), owned: ['emote-a'], draws: zeros, catalog: cat })[4]!;
    expect(c5).toMatchObject({ rewardId: 'emote-b', duplicate: null });
  });
  it('Review Focus 4: cards 1-2 grant both unowned emotes, card 5 is an owned emote paying its own rarity', () => {
    const cat = [item('emote-a', 'emote', 'common'), item('emote-b', 'emote', 'common'), item('title-a', 'title', 'common')];
    // cards 1-2: category draw 0 picks emote (categories in catalog order: title, emote? see below), item draws 0 then 0.9
    const draws = [0, 0.99, 0, 0, 0.99, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const cards = rollPack({ look: categoryLook('emote'), owned: [], draws, catalog: cat });
    expect(cards[0]).toMatchObject({ rewardId: 'emote-a', duplicate: null });
    expect(cards[1]).toMatchObject({ rewardId: 'emote-b', duplicate: null });
    expect(cards[4]!.rewardId.startsWith('emote-')).toBe(true);
    expect(cards[4]!.guaranteed).toBe(true);
    expect(cards[4]!.duplicate).toEqual({ aether: DUP.common });
  });
  it('a category pack whose pool is fully owned still rolls a duplicate', () => {
    const cat = [item('emote-a', 'emote', 'epic'), item('title-a', 'title', 'common')];
    const cards = rollPack({ look: categoryLook('emote'), owned: ['emote-a'], draws: zeros, catalog: cat });
    expect(cards[4]).toMatchObject({ rewardId: 'emote-a', rarity: 'epic', duplicate: { aether: DUP.epic } });
  });
  it('two cards rolling the same item make the second a duplicate; owned-before is a duplicate', () => {
    const cat = [item('x', 'emote', 'common')];
    const cards = rollPack({ look: rarityLook('common'), owned: [], draws: zeros, catalog: cat });
    expect(cards[0]!.duplicate).toBeNull();
    expect(cards.slice(1).every((c) => c.duplicate?.aether === DUP.common)).toBe(true);
    const owned = rollPack({ look: rarityLook('common'), owned: ['x'], draws: zeros, catalog: cat });
    expect(owned.every((c) => c.duplicate !== null)).toBe(true);
  });
  it('a duplicate Epic pays 60 whatever the pack', () => {
    const cat = [item('e', 'emote', 'epic')];
    for (const look of [rarityLook('common'), rarityLook('epic'), categoryLook('emote')]) {
      const cards = rollPack({ look, owned: ['e'], draws: zeros, catalog: cat });
      expect(cards.every((c) => c.duplicate?.aether === 60)).toBe(true);
    }
  });
  it('falls back to the nearest rarity with something, never below the floor on a rarity pack card 5', () => {
    const cat = [item('c', 'emote', 'common'), item('l', 'emote', 'legendary')];
    const cards = rollPack({ look: rarityLook('rare'), owned: [], draws: zeros, catalog: cat });
    expect(cards[0]!.rarity).toBe('common');
    expect(cards[4]!.rarity).toBe('legendary');
  });
  it('never rolls a Secret, inactive or non-crate item', () => {
    const cat = [
      ...fullCatalog(), item('s', 'emote', 'secret'), item('off', 'emote', 'common', { active: false }),
      item('ach', 'emote', 'common', { acquisition: { type: 'achievement', id: 'a' } }),
    ];
    const r = rand(3);
    for (let i = 0; i < 300; i++)
      for (const c of rollPack({ look: rarityLook('common'), owned: [], draws: drawSet(r), catalog: cat }))
        expect(['s', 'off', 'ach']).not.toContain(c.rewardId);
  });
  it('a style pack card 5 comes from its style; unknown themed ids throw', () => {
    const cat = [item('s1', 'emote', 'rare', { packStyles: ['themed-plushie'] }), item('o', 'emote', 'rare')];
    const look: PackLook = { kind: 'themed', id: 'themed-plushie', name: 'P', guaranteedFloor: 'common' };
    expect(rollPack({ look, owned: [], draws: zeros, catalog: cat })[4]!.rewardId).toBe('s1');
    expect(() => rollPack({ look: { ...look, id: 'themed-nope' }, owned: [], draws: zeros, catalog: cat })).toThrow();
  });
  it('is deterministic and throws unless given 15 draws', () => {
    const d = drawSet(rand(5));
    expect(rollPack({ look: rarityLook('epic'), owned: [], draws: d, catalog })).toEqual(rollPack({ look: rarityLook('epic'), owned: [], draws: d, catalog }));
    expect(() => rollPack({ look: rarityLook('epic'), owned: [], draws: d.slice(0, 14), catalog })).toThrow();
  });
});

describe('packPool', () => {
  it('filters by kind and sorts by id', () => {
    const cat = [item('b', 'emote', 'common'), item('a', 'title', 'common', { packStyles: ['themed-voxel'] }), item('s', 'emote', 'secret')];
    expect(packPool(cat, 'all').map((c) => c.id)).toEqual(['a', 'b']);
    expect(packPool(cat, { category: 'emote' }).map((c) => c.id)).toEqual(['b']);
    expect(packPool(cat, { style: 'themed-voxel' }).map((c) => c.id)).toEqual(['a']);
  });
});
