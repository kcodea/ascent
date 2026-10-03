import { afterEach, describe, expect, it } from 'vitest';
import {
  COSMETICS, EQUIP_SLOTS, GLOBAL_EQUIP_SLOTS, eligibleCrateCosmetics, loadoutFromRows, parseCosmeticSnapshot, portraitFrameOf,
  setServerCatalogState, snapshotForRun,
} from './cosmetics';
import { validateInventoryBody } from './inventory';

/**
 * PORTRAIT FRAMES (owner 2026-10-01: "we're adding portrait skins: C:\Game Assets\Ascent Art\Skins\Portraits. we want
 * this to replace the default portrait png when a skin is applied"). The 52 frames (every one a crate drop at its
 * folder's rarity, the rank-named masters included), the account-wide `portrait_frame` slot, the loadout and the run
 * snapshot carrying it, and the one resolver that drops unknown / retired / wrong-category ids.
 */
const FRAMES = COSMETICS.filter((c) => c.category === 'portrait_frame');

afterEach(() => setServerCatalogState(null));

describe('the portrait frame catalog', () => {
  it('52 crate frames at their folder rarity (10 Common, 8 Rare, 18 Epic, 9 Legendary, 7 Ancient), each naming its master and art key', () => {
    expect(Object.fromEntries(FRAMES.map((c) => [c.id, c.rarity]))).toEqual({
      frame_honey: 'common', frame_ale: 'common', frame_ruby: 'common', frame_steel: 'common', frame_wood: 'common',
      frame_dark_dragonscale: 'common',
      // frames batch 6 (2026-10-02): the owner moved the four metal rings to Common/ and Shard + Prism to Rare/
      frame_bronze: 'common', frame_silver: 'common', frame_gold: 'common', frame_platinum: 'common',
      frame_glass_shard: 'rare', frame_paragon: 'rare', frame_vines: 'rare', frame_magic: 'rare',
      frame_simple_ring: 'rare', frame_void: 'rare', frame_dark_diamond: 'rare', frame_diamond: 'rare',
      frame_aura: 'epic', frame_ascendant: 'epic', frame_ice: 'epic', frame_pearlescent: 'epic', frame_rank1: 'epic', frame_nimbus: 'epic',
      frame_wedding: 'epic', frame_multichrome_energy: 'epic', frame_blue_energy: 'epic', frame_crackling_ruby: 'epic', frame_topaz: 'epic', frame_jade: 'epic',
      frame_cherry_blossom: 'epic',
      // frames batch 7 (2026-10-03)
      frame_cream: 'epic', frame_crystal: 'epic', frame_disco: 'epic', frame_econ: 'epic', frame_snare: 'epic',
      frame_chromatic_dragonscale: 'legendary', frame_reflective: 'ancient',
      frame_golden_dragonscale: 'legendary', frame_dark_cloud: 'legendary', frame_venom: 'legendary',
      frame_fire: 'legendary', frame_reaper: 'legendary', frame_water: 'legendary', frame_stained_glass: 'legendary', frame_wind: 'legendary',
      // the first Ancient frames (owner 2026-10-02: "i added a new rarity -> Ancient")
      frame_bonds: 'ancient', frame_death: 'ancient', frame_fortune: 'ancient', frame_genesis: 'ancient', frame_time: 'ancient', frame_war: 'ancient',
    });
    for (const c of FRAMES) {
      expect(c.acquisition, c.id).toEqual({ type: 'crate' });
      expect(c.target, c.id).toBeUndefined(); // account-wide: any hero
      expect(c.assets.art, c.id).toBe(c.id);
      expect(c.assets.master, c.id).toMatch(new RegExp(`^${c.rarity[0]!.toUpperCase()}${c.rarity.slice(1)}/[A-Za-z0-9]+\\.png$`));
      expect(c.active).toBe(true);
    }
    const pool = new Set(eligibleCrateCosmetics([]).map((c) => c.id));
    for (const c of FRAMES) expect(pool.has(c.id), c.id).toBe(true);
  });

  it('the names avoid the ranked medal words, so a crate frame never reads as a Ranked reward', () => {
    expect(FRAMES.map((c) => c.name)).toEqual([
      'Honey', 'Ale', 'Ruby', 'Steel', 'Wood', 'Dark Scale', 'Gilt Scale', 'Burnished', 'Sterling', 'Gilded',
      'Seaglass', 'Glass Shard', 'Paragon', 'Vine', 'Magic', 'Simple Ring', 'Void', 'Multichrome Energy', 'Blue Energy', 'Crackling Ruby', 'Topaz', 'Jade',
      'Aura', 'Amethyst', 'Shard', 'Prism', 'Frost', 'Pearlescent',
      'Crimson', 'Nimbus', 'Dark Cloud', 'Venom', 'Wedding', 'Fire', 'Reaper', 'Water', 'Stained Glass', 'Wind',
      'Cherry Blossom', 'Cream', 'Crystal', 'Disco', 'Econ', 'Snare', 'Chromatic Scale',
      'Bonds', 'Death', 'Fortune', 'Genesis', 'Time', 'War', 'Reflective',
    ]);
    expect(new Set(FRAMES.map((c) => c.name)).size).toBe(FRAMES.length);
  });
});

describe('the equip slot, the loadout and the snapshot', () => {
  it('portrait_frame is an account-wide slot (target \'\'), accepted by the inventory request parser', () => {
    expect(EQUIP_SLOTS).toContain('portrait_frame');
    expect(GLOBAL_EQUIP_SLOTS).toEqual(['hero_attack', 'portrait_frame']);
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'portrait_frame', targetId: '', cosmeticId: 'frame_fire' }))
      .toEqual({ ok: true, request: { action: 'equip_cosmetic', slot: 'portrait_frame', targetId: '', cosmeticId: 'frame_fire' } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'portrait_frame', targetId: '', cosmeticId: null })).toMatchObject({ ok: true });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'portrait_frame', targetId: 'warden', cosmeticId: 'frame_fire' })).toMatchObject({ ok: false, error: 'bad_target' });
  });

  it('the loadout row folds into the snapshot shape; a named target is ignored', () => {
    expect(loadoutFromRows([{ slot: 'portrait_frame', targetId: '', cosmeticId: 'frame_fire' }])).toEqual({ portraitFrame: 'frame_fire' });
    expect(loadoutFromRows([{ slot: 'portrait_frame', target_id: '', cosmetic_id: 'frame_gold' }])).toEqual({ portraitFrame: 'frame_gold' });
    expect(loadoutFromRows([{ slot: 'portrait_frame', targetId: 'warden', cosmeticId: 'frame_fire' }])).toEqual({});
  });

  it('a run records a LIVE frame; a recorded snapshot keeps any well-formed id (a newer client\'s frame survives a pass-through)', () => {
    expect(snapshotForRun({ portraitFrame: 'frame_fire' })).toEqual({ portraitFrame: 'frame_fire' });
    expect(snapshotForRun({ portraitFrame: 'frame_nope' })).toBeNull();
    expect(snapshotForRun({ portraitFrame: 'attack_blast' })).toBeNull();
    expect(parseCosmeticSnapshot({ portraitFrame: 'frame_future' })).toEqual({ portraitFrame: 'frame_future' });
    expect(parseCosmeticSnapshot({ portraitFrame: 'bad id!' })).toBeNull();
  });

  it('portraitFrameOf: the frame, or null for none / unknown / another category / retired (item or category)', () => {
    expect(portraitFrameOf({ portraitFrame: 'frame_water' })?.id).toBe('frame_water');
    expect(portraitFrameOf(null)).toBeNull();
    expect(portraitFrameOf({ portraitFrame: 'frame_unknown' })).toBeNull();
    expect(portraitFrameOf({ portraitFrame: 'title_wanderer' })).toBeNull();
    setServerCatalogState({ retiredIds: ['frame_water'], disabledCategories: [] });
    expect(portraitFrameOf({ portraitFrame: 'frame_water' })).toBeNull();
    setServerCatalogState({ retiredIds: [], disabledCategories: ['portrait_frame'] });
    expect(portraitFrameOf({ portraitFrame: 'frame_fire' })).toBeNull();
  });
});
