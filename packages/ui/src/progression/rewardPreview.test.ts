import { describe, expect, it } from 'vitest';
import { cosmeticOf, type CosmeticDef } from '@game/progression';
import { previewForDef, rewardLabel, rewardPreview } from './rewardPreview';
import { rewardLabel as reexported } from './CrateOpener';

describe('rewardPreview', () => {
  it.each([
    ['skin_albus_1', 'hero'],
    ['skin_blackbelt_1', 'minion'],
    ['emote_hi', 'emote'],
    ['plate_amethyst', 'plate'],
    ['frame_honey', 'frame'],
  ] as const)('%s previews as %s art', (id, kind) => {
    const p = rewardPreview(id);
    expect(p.art?.kind).toBe(kind);
    expect(p.art?.url).toBeTruthy();
    expect(p.emblem).toBeNull();
    expect(p.category).toBe(cosmeticOf(id)?.category);
    expect(p.label.name).toBe(cosmeticOf(id)?.name);
  });

  it.each([
    ['alpha_tester', 'title'],
    ['announcer_lemon', 'announcer'],
    ['attack_blast', 'hero_attack'],
  ] as const)('%s previews as the %s emblem', (id, emblem) => {
    const p = rewardPreview(id);
    expect(p.art).toBeNull();
    expect(p.emblem).toBe(emblem);
    expect(p.category).toBe(emblem);
  });

  // The board and music categories have no catalog item yet, so they go through the pure core with a hand-made def.
  it.each(['music', 'board'] as const)('a %s def previews as the %s emblem', (category) => {
    const def = { id: 'x', category, name: 'X', rarity: 'rare', assets: {}, active: true } as unknown as CosmeticDef;
    const p = previewForDef(def);
    expect(p.art).toBeNull();
    expect(p.emblem).toBe(category);
    expect(p.category).toBe(category);
  });

  it('an unknown id is the unknown emblem with the fallback label', () => {
    const p = rewardPreview('no_such_reward');
    expect(p.art).toBeNull();
    expect(p.emblem).toBe('unknown');
    expect(p.category).toBeNull();
    expect(p.label.name).toBe('New reward');
    expect(rewardPreview(null).label.name).toBe('New reward');
  });

  it('an art category with no art falls back to the unknown emblem', () => {
    const def = { id: 'emote_missing_art', category: 'emote', name: 'E', rarity: 'rare', assets: {}, active: true } as unknown as CosmeticDef;
    const p = previewForDef(def);
    expect(p.art).toBeNull();
    expect(p.emblem).toBe('unknown');
    expect(p.category).toBe('emote');
  });

  it('rewardLabel stays importable from CrateOpener', () => {
    expect(reexported).toBe(rewardLabel);
  });
});
