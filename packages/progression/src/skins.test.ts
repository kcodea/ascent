import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COSMETICS, COSMETIC_CATEGORY_DEFS, catalogStateEpoch, cosmeticOf, heroSkinOf, isCosmeticLive, liveCosmetics, loadoutFromRows, minionSkinOf,
  parseCosmeticSnapshot, parseServerCatalogState, setServerCatalogState, skinsForTarget, snapshotForRun, type CosmeticDef,
} from './cosmetics';
import { parseProgressionProfile } from './rules';
import { handleInventory, validateInventoryBody } from './inventory';
import type { RpcCall } from './server';

/**
 * THE FIRST SKINS (owner 2026-09-28) at the catalog layer: the four items, the one resolver every renderer uses
 * (`heroSkinOf` / `minionSkinOf`), the recorded per-run snapshot, the kill switch (TS and server copies), and the
 * `equip_cosmetic` inventory action. The SQL side is proven in skins.db.test.ts; rendering in @game/ui.
 */

afterEach(() => setServerCatalogState(null));

const skins = COSMETICS.filter((c) => c.category === 'hero_skin' || c.category === 'minion_skin');

describe('the four skins', () => {
  it('two Black Belt Brian minion skins, one Albus and one Warden hero skin; crate items with art keys and attributed masters', () => {
    expect(skins.map((c) => [c.id, c.category, c.target, c.rarity])).toEqual([
      ['skin_blackbelt_1', 'minion_skin', { type: 'card', id: 'blackbelt' }, 'rare'],
      ['skin_blackbelt_2', 'minion_skin', { type: 'card', id: 'blackbelt' }, 'epic'],
      ['skin_albus_1', 'hero_skin', { type: 'hero', id: 'albus' }, 'epic'],
      ['skin_warden_1', 'hero_skin', { type: 'hero', id: 'warden' }, 'epic'],
    ]);
    for (const c of skins) {
      expect(c.acquisition).toEqual({ type: 'crate' });
      expect(c.assets.art, c.id).toBe(c.id);
      expect(c.assets.master, c.id).toMatch(/^[A-Za-z0-9]+\.png$/);
      expect(c.active).toBe(true);
    }
    expect(skinsForTarget('minion_skin', 'blackbelt').map((c) => c.id)).toEqual(['skin_blackbelt_1', 'skin_blackbelt_2']);
    expect(skinsForTarget('hero_skin', 'warden').map((c) => c.id)).toEqual(['skin_warden_1']);
  });
});

describe('the resolver (default art unless the named skin is live AND made for this target)', () => {
  const snap = { heroSkinByHeroId: { albus: 'skin_albus_1', warden: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2', whelp: 'skin_blackbelt_1' } };
  it('resolves the right skin for its own target', () => {
    expect(heroSkinOf(snap, 'albus')?.id).toBe('skin_albus_1');
    expect(minionSkinOf(snap, 'blackbelt')?.id).toBe('skin_blackbelt_2');
  });
  it('never puts a skin on another target (a forged / mismatched snapshot), a token, or across slots', () => {
    expect(heroSkinOf(snap, 'warden')).toBeNull(); // Albus's skin named for Warden
    expect(minionSkinOf(snap, 'whelp')).toBeNull(); // a Brian skin named for another card (e.g. a token)
    expect(minionSkinOf({ minionSkinByCardId: { albus: 'skin_albus_1' } }, 'albus')).toBeNull();
    expect(heroSkinOf({ heroSkinByHeroId: { blackbelt: 'skin_blackbelt_1' } }, 'blackbelt')).toBeNull();
  });
  it('an unknown / removed id, no snapshot, or no target: default art, never a throw', () => {
    expect(heroSkinOf({ heroSkinByHeroId: { albus: 'skin_from_the_future' } }, 'albus')).toBeNull();
    expect(minionSkinOf(null, 'blackbelt')).toBeNull();
    expect(minionSkinOf(undefined, 'blackbelt')).toBeNull();
    expect(minionSkinOf(snap, undefined)).toBeNull();
    expect(minionSkinOf({}, 'blackbelt')).toBeNull();
  });
});

describe('the kill switch', () => {
  it('a TS-retired item (active: false) is not live and never resolves, even when equipped / recorded', () => {
    const def = cosmeticOf('skin_blackbelt_2')! as { active: boolean };
    def.active = false;
    try {
      expect(isCosmeticLive('skin_blackbelt_2')).toBe(false);
      expect(minionSkinOf({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } }, 'blackbelt')).toBeNull();
      expect(liveCosmetics().map((c) => c.id)).not.toContain('skin_blackbelt_2');
      expect(snapshotForRun({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } })).toBeNull();
    } finally { def.active = true; }
  });

  it('a TS-disabled CATEGORY retires every item in it', () => {
    const cat = COSMETIC_CATEGORY_DEFS.hero_skin as { enabled: boolean };
    cat.enabled = false;
    try {
      expect(isCosmeticLive('skin_albus_1')).toBe(false);
      expect(heroSkinOf({ heroSkinByHeroId: { albus: 'skin_albus_1' } }, 'albus')).toBeNull();
      expect(isCosmeticLive('skin_blackbelt_1')).toBe(true); // other category untouched
    } finally { cat.enabled = true; }
  });

  it('the SERVER switch (read from the public tables) retires an item or a category on a client that still ships it', () => {
    const epoch = catalogStateEpoch();
    setServerCatalogState(parseServerCatalogState(
      [{ cosmetic_id: 'skin_warden_1', active: false }, { cosmetic_id: 'skin_albus_1', active: true }, null, { junk: 1 }],
      [{ category: 'minion_skin', enabled: false }, { category: 'title', enabled: true }],
    ));
    expect(catalogStateEpoch()).toBe(epoch + 1);
    expect(isCosmeticLive('skin_warden_1')).toBe(false);
    expect(isCosmeticLive('skin_albus_1')).toBe(true);
    expect(isCosmeticLive('skin_blackbelt_1')).toBe(false);
    expect(isCosmeticLive('title_wanderer')).toBe(true);
    // restore = the server says so (or the state clears)
    setServerCatalogState(parseServerCatalogState([], []));
    expect(isCosmeticLive('skin_warden_1')).toBe(true);
    expect(isCosmeticLive('skin_blackbelt_1')).toBe(true);
  });

  it('the server can only REMOVE: an unknown server row never makes an unknown id live', () => {
    setServerCatalogState(parseServerCatalogState([{ cosmetic_id: 'skin_new', active: true }], 'garbage'));
    expect(isCosmeticLive('skin_new')).toBe(false);
    expect(parseServerCatalogState(undefined, null)).toEqual({ retiredIds: [], disabledCategories: [] });
  });
});

describe('the recorded snapshot', () => {
  it('parses tolerantly: old payloads have none; junk is dropped; unknown ids are KEPT (a newer client\'s item)', () => {
    expect(parseCosmeticSnapshot(undefined)).toBeNull();
    expect(parseCosmeticSnapshot('x')).toBeNull();
    expect(parseCosmeticSnapshot({})).toBeNull();
    expect(parseCosmeticSnapshot({ heroSkinByHeroId: [], minionSkinByCardId: 5 })).toBeNull();
    expect(parseCosmeticSnapshot({ heroSkinByHeroId: { albus: 'skin_albus_1', 'bad key!': 'x', warden: 7 }, minionSkinByCardId: { blackbelt: 'skin_future_9' } }))
      .toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_future_9' } });
  });
  it('caps a hostile payload', () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, 'skin_blackbelt_1']));
    expect(Object.keys(parseCosmeticSnapshot({ minionSkinByCardId: big })!.minionSkinByCardId!)).toHaveLength(64);
  });
  it('a run records only what it can show (its hero, its cards) and only live items', () => {
    const loadout = { heroSkinByHeroId: { albus: 'skin_albus_1', warden: 'skin_warden_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } };
    expect(snapshotForRun(loadout, { heroIds: ['albus'], cardIds: ['blackbelt', 'whelp'] })).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
    expect(snapshotForRun(loadout, { heroIds: ['cia'], cardIds: [] })).toBeNull();
    expect(snapshotForRun(loadout)).toEqual(loadout);
    expect(snapshotForRun(null)).toBeNull();
  });
  it('loadout rows from the SQL JSON or a table read', () => {
    expect(loadoutFromRows([
      { slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' },
      { slot: 'minion_skin', target_id: 'blackbelt', cosmetic_id: 'skin_blackbelt_2' },
      { slot: 'announcer', targetId: '', cosmeticId: 'x' }, null, 'junk',
    ])).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
    expect(loadoutFromRows(undefined)).toEqual({});
  });
  it('the profile parser: a pre-skins server sends neither field; a skins server sends both', () => {
    const base = { accountXp: 10, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [] };
    expect(parseProgressionProfile(base)).toEqual(base);
    expect(parseProgressionProfile({ ...base, cosmetics: ['skin_albus_1', 3], loadout: [{ slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }] }))
      .toEqual({ ...base, cosmetics: ['skin_albus_1'], loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' } } });
  });
});

describe('equip_cosmetic (the inventory Edge Function)', () => {
  const USER = '00000000-0000-0000-0000-000000000001';
  const profile = { accountXp: 300, accountLevel: 2, revision: 6, equippedTitleId: null, titles: [], cosmetics: ['skin_albus_1'], loadout: [{ slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }] };
  const rpc = (data: unknown, error: { message?: string } | null = null): RpcCall => vi.fn(async () => ({ data, error }));

  it('validates slot, target and id; null is Default', () => {
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }))
      .toEqual({ ok: true, request: { action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'minion_skin', targetId: 'blackbelt', cosmeticId: null }))
      .toMatchObject({ ok: true, request: { cosmeticId: null } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'title', targetId: 'x', cosmeticId: 'title_wanderer' })).toMatchObject({ ok: false, error: 'bad_slot' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: '', cosmeticId: null })).toMatchObject({ ok: false, error: 'bad_target' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'a b', cosmeticId: null })).toMatchObject({ ok: false, error: 'bad_target' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus' })).toMatchObject({ ok: false, error: 'bad_cosmetic_id' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'Skin!' })).toMatchObject({ ok: false, error: 'bad_cosmetic_id' });
  });

  it('calls the SQL with the caller + request only and returns the new profile; SQL refusals map to 4xx', async () => {
    const ok = rpc({ status: 'equipped', profile });
    const res = await handleInventory(USER, { action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }, ok);
    expect(ok).toHaveBeenCalledWith('equip_cosmetic', { p_user: USER, p_slot: 'hero_skin', p_target_id: 'albus', p_cosmetic_id: 'skin_albus_1' });
    expect(res).toEqual({ status: 200, body: { status: 'equipped', profile } });
    for (const [msg, status] of [['not_owned', 409], ['wrong_target', 409], ['not_equippable', 409], ['bad_slot', 400]] as const) {
      expect(await handleInventory(USER, { action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }, rpc(null, { message: msg })))
        .toEqual({ status, body: { error: msg } });
    }
  });
});

// Type-level guard: a CosmeticDef literal with a target keeps compiling (the catalog shape is shared with Deno).
const _typed: CosmeticDef = skins[0]!;
void _typed;
