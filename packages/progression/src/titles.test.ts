import { afterEach, describe, expect, it } from 'vitest';
import {
  ALPHA_TESTER_TITLE_ID, COSMETICS, parseCosmeticSnapshot, setServerCatalogState, snapshotForRun, titleOf, withEquippedTitle,
} from './cosmetics';

/**
 * TITLES in the run's cosmetic snapshot (owner ask 2026-09-28: "it'd be cool to show them where possible ... when the
 * player is the opponent in combat, it could show the title + the titles colors"). The equipped title is RECORDED
 * with the run like skins and the hero attack, so opponents, replays and history show the title worn then. Only a
 * live catalog title is ever recorded or shown.
 */
afterEach(() => setServerCatalogState(null));

describe('titleOf (the one display gate)', () => {
  it('resolves every live catalog title, and nothing else', () => {
    for (const c of COSMETICS.filter((x) => x.category === 'title')) expect(titleOf({ title: c.id })?.id).toBe(c.id);
    expect(titleOf({ title: 'title_from_the_future' })).toBeNull(); // unknown (a newer client's title)
    expect(titleOf({ title: 'skin_albus_1' })).toBeNull();           // real item, wrong category
    expect(titleOf({ title: 'attack_blast' })).toBeNull();
    expect(titleOf({})).toBeNull();
    expect(titleOf(null)).toBeNull();
  });

  it('a title retired by the server (item or category) shows nothing, and a restore brings it back', () => {
    expect(titleOf({ title: 'title_the_unbroken' })?.rarity).toBe('legendary');
    setServerCatalogState({ retiredIds: ['title_the_unbroken'], disabledCategories: [] });
    expect(titleOf({ title: 'title_the_unbroken' })).toBeNull();
    setServerCatalogState({ retiredIds: [], disabledCategories: ['title'] });
    expect(titleOf({ title: ALPHA_TESTER_TITLE_ID })).toBeNull();
    setServerCatalogState(null);
    expect(titleOf({ title: 'title_the_unbroken' })?.id).toBe('title_the_unbroken');
  });
});

describe('recording the title with the run', () => {
  it('withEquippedTitle folds the profile title into the loadout; snapshotForRun records it', () => {
    const loadout = { heroSkinByHeroId: { albus: 'skin_albus_1' } };
    expect(snapshotForRun(withEquippedTitle(loadout, 'title_kingbreaker'))).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, title: 'title_kingbreaker' });
    expect(snapshotForRun(withEquippedTitle(null, ALPHA_TESTER_TITLE_ID))).toEqual({ title: ALPHA_TESTER_TITLE_ID });
    expect(withEquippedTitle(loadout, null)).toBe(loadout);
    expect(withEquippedTitle(undefined, null)).toBeNull();
  });

  it('an unknown or retired title is never recorded (the run stays byte-identical to one with no title)', () => {
    expect(snapshotForRun(withEquippedTitle(null, 'title_from_the_future'))).toBeNull();
    setServerCatalogState({ retiredIds: ['title_kingbreaker'], disabledCategories: [] });
    expect(snapshotForRun(withEquippedTitle({ heroAttack: 'attack_blast' }, 'title_kingbreaker'))).toEqual({ heroAttack: 'attack_blast' });
  });
});

describe('parsing a recorded snapshot', () => {
  it('keeps a title id (even one this client does not know) and drops junk; old snapshots have none', () => {
    expect(parseCosmeticSnapshot({ title: 'title_star_chaser' })).toEqual({ title: 'title_star_chaser' });
    expect(parseCosmeticSnapshot({ title: 'title_from_the_future' })).toEqual({ title: 'title_from_the_future' });
    expect(parseCosmeticSnapshot({ title: '<script>' })).toBeNull();
    expect(parseCosmeticSnapshot({ title: 42 })).toBeNull();
    expect(parseCosmeticSnapshot({ heroAttack: 'attack_blast' })).toEqual({ heroAttack: 'attack_blast' });
  });
});
