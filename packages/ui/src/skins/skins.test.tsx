// @vitest-environment jsdom
/**
 * SKINS v1 (owner 2026-09-28) on screen:
 *  - every live skin ships its art and targets a real, non-token card / a real hero (the "removing an active
 *    cosmetic from assets must fail CI" rule, handoff §13);
 *  - a Card inside a skin scope paints the skin; Gilded keeps its frame and effects over the skin; any other card
 *    (a token, another minion) keeps its own art; no scope = default art;
 *  - "Show opponent skins" off blanks OPPONENT scopes only, never your own, and persists like the other settings;
 *  - the kill switch: a retired item (TS catalog or the server's one-line switch) falls back to default art on the
 *    next render even while equipped / recorded, and a restore brings it back; unknown ids never throw;
 *  - hero portraits resolve the same way; the per-snapshot map is referentially stable (the perf contract);
 *  - a NEW run records the player's live loadout (`run.cosmetics`), which is what history and replays show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { HEROES } from '@game/sim';
import { COSMETICS, cosmeticOf, minionSkinOf, type RunCosmeticSnapshot } from '@game/progression';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));

import { Card, type CardView } from '../Card';
import { mount } from '../renderedText.mount';
import { artFor, heroArt, skinArtKeys } from '../art';
import { useGame } from '../store';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from '../progression/progressionStore';
import { MinionSkins, heroPortrait, internSnapshot, minionSkinMap, skinArtOf, useOpponentSkins, useRunSkins } from './skins';

const m = mount(<div />);
beforeEach(() => { resetProgressionForTests(); localStorage.clear(); useGame.setState({ showOpponentSkins: true }); });
afterEach(() => { m.render(<div />); resetProgressionForTests(); });

const brian = (golden = false): CardView => {
  const d = CARD_INDEX.blackbelt!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [], golden, text: d.text ?? '', tier: d.tier };
};
const other = (): CardView => {
  const d = CARD_INDEX.pack!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [], golden: false, text: d.text ?? '', tier: d.tier };
};
const artSrc = (): string | null => m.container.querySelector<HTMLImageElement>('img.artimg')?.getAttribute('src') ?? null;
const SKIN2: RunCosmeticSnapshot = { minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } };
const skins = COSMETICS.filter((c) => c.category === 'hero_skin' || c.category === 'minion_skin');

describe('the catalog <-> the bundle', () => {
  it('every live skin ships its art file (removing one fails CI)', () => {
    const keys = new Set(skinArtKeys());
    for (const c of skins.filter((s) => s.active)) {
      expect(keys.has(c.assets.art!), `${c.id} has no art/skins/${c.assets.art}.webp`).toBe(true);
      expect(skinArtOf(c), c.id).toBeTruthy();
    }
  });
  it('the Legendary Black Belt Brian (owner 2026-09-28: "i added a legendary black belt brian skin") exists, targets blackbelt, and ships its art', () => {
    const c = cosmeticOf('skin_blackbelt_3')!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master]).toEqual(['minion_skin', 'legendary', { type: 'card', id: 'blackbelt' }, 'BlackBeltBrianSkinLegendary.png']);
    expect(skinArtKeys()).toContain('skin_blackbelt_3');
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_3' } }, 'blackbelt')?.id).toBe('skin_blackbelt_3');
  });
  it('the Bellringer Voss skin (owner 2026-09-28: "put the bellringer voss skin in too") exists, targets n2_bellringer, and ships its art', () => {
    const c = cosmeticOf('skin_bellringer_1')!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master]).toEqual(['minion_skin', 'epic', { type: 'card', id: 'n2_bellringer' }, 'BellringerVossSkinEpic.png']);
    expect(CARD_INDEX['n2_bellringer']?.name).toBe('Bellringer Voss');
    expect(skinArtKeys()).toContain('skin_bellringer_1');
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { n2_bellringer: 'skin_bellringer_1' } }, 'n2_bellringer')?.id).toBe('skin_bellringer_1');
  });
  it('every skin targets a REAL collectible card (never a token) or a REAL hero, by stable id', () => {
    for (const c of skins) {
      if (c.category === 'minion_skin') {
        const def = CARD_INDEX[c.target!.id];
        expect(def, `${c.id} -> ${c.target!.id}`).toBeTruthy();
        expect(def!.token, `${c.id} targets a token`).toBeFalsy();
      } else {
        expect(HEROES.some((h) => h.id === c.target!.id), `${c.id} -> ${c.target!.id}`).toBe(true);
      }
    }
    expect(CARD_INDEX.blackbelt!.name).toBe('Black Belt Brian');
    expect(HEROES.find((h) => h.id === 'albus')!.name).toBe('Albus');
    expect(HEROES.find((h) => h.id === 'warden')!.name).toBe('Warden');
  });
});

describe('a Card inside a skin scope', () => {
  it('paints the skin for its target card; default art with no scope', () => {
    m.render(<Card card={brian()} />);
    expect(artSrc()).toBe(artFor('blackbelt'));
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(artSrc()).not.toBe(artFor('blackbelt'));
  });

  it('GILDED: the skin with the normal Gilded frame on top (no separate unlock)', () => {
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian(true)} /></MinionSkins>);
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(m.container.querySelector('.card')!.className).toMatch(/\bgolden\b/);
  });

  it('any other card (a token, another minion) keeps its own art, even when a snapshot names it (forged / mismatched)', () => {
    m.render(<MinionSkins snapshot={{ minionSkinByCardId: { blackbelt: 'skin_blackbelt_1', pack: 'skin_blackbelt_1' } }}><Card card={other()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('pack'));
  });

  it('an unknown id (a newer client, a removed item, an old replay) is default art, never a throw', () => {
    m.render(<MinionSkins snapshot={{ minionSkinByCardId: { blackbelt: 'skin_from_the_future' } }}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('blackbelt'));
    m.render(<MinionSkins snapshot={{ garbage: 1 } as unknown as RunCosmeticSnapshot}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('blackbelt'));
  });
});

describe('Show opponent skins (opponent-only)', () => {
  function Opp({ snap }: { snap: RunCosmeticSnapshot }): JSX.Element {
    return <div className="opp"><MinionSkins snapshot={useOpponentSkins(snap)}><Card card={brian()} /></MinionSkins></div>;
  }
  const tree = (): JSX.Element => (
    <>
      <div className="own"><MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins></div>
      <Opp snap={{ minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } }} />
    </>
  );
  const src = (sel: string): string | null => m.container.querySelector<HTMLImageElement>(`${sel} img.artimg`)?.getAttribute('src') ?? null;

  it('on (default): both sides wear their owner\'s skin; off: the opponent reverts, yours never does', () => {
    m.render(tree());
    expect(src('.own')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(src('.opp')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_1')));
    act(() => useGame.getState().setShowOpponentSkins(false));
    expect(src('.own')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(src('.opp')).toBe(artFor('blackbelt'));
    act(() => useGame.getState().setShowOpponentSkins(true));
    expect(src('.opp')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_1')));
  });

  it('is stored like the other client settings, on by default', () => {
    expect(localStorage.getItem('ascent.showopponentskins')).toBeNull();
    act(() => useGame.getState().setShowOpponentSkins(false));
    expect(localStorage.getItem('ascent.showopponentskins')).toBe('false');
  });
});

describe('the kill switch on screen', () => {
  it('the SERVER retires an item: every scope falls back on the next render; restoring brings it back', () => {
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    act(() => applyServerCatalogState({ retiredIds: ['skin_blackbelt_2'], disabledCategories: [] }));
    expect(artSrc()).toBe(artFor('blackbelt'));
    expect(localStorage.getItem('ascent.cosmetics.server')).toContain('skin_blackbelt_2'); // an offline client keeps honouring it
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: [] }));
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
  });

  it('the server disables the CATEGORY: minion skins fall back, hero skins stay', () => {
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['minion_skin'] }));
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('blackbelt'));
    expect(heroPortrait('albus', { heroSkinByHeroId: { albus: 'skin_albus_1' } })).toBe(skinArtOf(cosmeticOf('skin_albus_1')));
  });

  it('a TS-retired item (removed from the bundled catalog\'s active set) falls back too', () => {
    const def = cosmeticOf('skin_warden_1') as { active: boolean };
    def.active = false;
    try {
      expect(heroPortrait('warden', { heroSkinByHeroId: { warden: 'skin_warden_1' } })).toBe(heroArt('warden'));
    } finally { def.active = true; }
    expect(heroPortrait('warden', { heroSkinByHeroId: { warden: 'skin_warden_1' } })).toBe(skinArtOf(cosmeticOf('skin_warden_1')));
  });
});

describe('hero portraits', () => {
  it('the skin for its own hero; default for another hero, no snapshot, an unknown id or no hero', () => {
    const snap = { heroSkinByHeroId: { albus: 'skin_albus_1', cia: 'skin_albus_1', warden: 'nope' } };
    expect(heroPortrait('albus', snap)).toBe(skinArtOf(cosmeticOf('skin_albus_1')));
    expect(heroPortrait('cia', snap)).toBe(heroArt('cia'));
    expect(heroPortrait('warden', snap)).toBe(heroArt('warden'));
    expect(heroPortrait('albus', null)).toBe(heroArt('albus'));
    expect(heroPortrait(undefined, snap)).toBeUndefined();
  });
});

describe('performance: resolve once per snapshot', () => {
  it('the same snapshot object maps to the SAME map (a stable context value); no snapshot is one shared empty map', () => {
    const snap = { minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } };
    expect(minionSkinMap(snap)).toBe(minionSkinMap(snap));
    expect(minionSkinMap(null)).toBe(minionSkinMap(undefined));
    expect(minionSkinMap({})).toBe(minionSkinMap(null));
    const before = minionSkinMap(snap);
    act(() => applyServerCatalogState({ retiredIds: ['skin_blackbelt_1'], disabledCategories: [] }));
    expect(minionSkinMap(snap)).not.toBe(before); // the kill switch re-resolves
    expect(minionSkinMap(snap).size).toBe(0);
  });

  it('a structuredClone (what every reducer dispatch produces) resolves to the SAME map and the SAME interned object', () => {
    const snap = { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } };
    const clone = structuredClone(snap);
    expect(minionSkinMap(clone)).toBe(minionSkinMap(snap));
    expect(internSnapshot(clone)).toBe(internSnapshot(snap));
    expect(internSnapshot(null)).toBeNull();
  });

  it('the store selector is stable across dispatch clones: a shop click does not re-render a skin scope', () => {
    useGame.setState({ run: { ...useGame.getState().run, cosmetics: { minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } } } });
    let renders = 0;
    function Probe(): JSX.Element { renders++; useRunSkins(); return <div />; }
    m.render(<Probe />);
    const before = renders;
    act(() => useGame.setState({ run: structuredClone(useGame.getState().run) }));
    act(() => useGame.setState({ run: structuredClone(useGame.getState().run) }));
    expect(renders).toBe(before);
  });
});

describe('a new run records the live loadout', () => {
  it('newRun stamps run.cosmetics from the account\'s loadout; nothing when wearing nothing', () => {
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [], loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } } } });
    act(() => useGame.getState().newRun(4242, 'albus'));
    expect(useGame.getState().run.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [] } });
    act(() => useGame.getState().newRun(4243, 'albus'));
    expect('cosmetics' in useGame.getState().run).toBe(false);
  });
});
