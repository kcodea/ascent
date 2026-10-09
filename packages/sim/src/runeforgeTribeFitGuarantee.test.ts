/**
 * The Runeforge's ONE guaranteed slot is TRIBE-ALIGNED when the board holds a tribe at the forge's board-fit
 * threshold (owner 2026-10-08). A tester with 4 Dragons + 3 Dwarves at the Epic forge was shown Broodpit, Wild
 * Hunt, Food Chain and Gemstorm: no Dragon or Dwarf rune. Owner: "he should have at least 1 rune that is tribe
 * aligned here for one of those".
 *
 * Root cause: the guarantee accepted ANY tag overlap, and mechanic tags are presence tags, so a Demon rune whose
 * text says "summon" (Broodpit, Food Chain) "followed" a Dragon/Dwarf board and the swap never fired. And a
 * tribe-gated rune whose text never prints the tribe word (Rune of Baal, Chimerus, the Whelps) was not a tribe
 * rune to the guarantee at all.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX, runeSynergies } from '@game/content';
import { createRun, reduce, type RunState } from './index';

type BC = RunState['board'][number];
const mk = (uid: string, cardId: string): BC => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...(d.keywords ?? [])], golden: false } as BC;
};
const board = (ids: string[]): BC[] => ids.map((id, i) => mk(`u${i}`, id));

const DRAGONS = ['d2_chronicler', 'd2_scalechanter', 'd2_recaller', 'd2_flamebeat'];
const DWARVES = ['dw_coinfire', 'dw_wardkeeper', 'dw_brewer'];
const FILLERS = ['n2_spellsword', 'drummer', 'venom'];
const SET2_TRIBES = ['kobold', 'dragon', 'beast', 'demon', 'dwarf'] as const;

/** A rune is Dwarf/Dragon aligned by its tribe gate or by the tribe word in its text. */
const aligned = (id: string, tribes: readonly string[]): boolean => {
  const rn = RUNE_INDEX[id]!;
  return tribes.some((t) => (rn.tribes ?? []).includes(t as never) || runeSynergies(rn).includes(t as never));
};

/** Open a real forge (the `devOpenRuneforge` action routes through `openEpicRuneforge` / the scheduled Basic
 *  forge, the same openers a run uses) on a Set 2 run holding `ids` on the board. */
const forge = (seed: number, ids: string[], epic: boolean): RunState => {
  const s0 = createRun(seed, 'warden', 'ascent', undefined, 'set2', SET2_TRIBES);
  return reduce({ ...s0, wave: epic ? 9 : 6, phase: 'recruit', board: board(ids), hand: [] }, { type: 'devOpenRuneforge', epic });
};

const SEEDS = 500;
const share = (ids: string[], epic: boolean, tribes: readonly string[]): number => {
  let hit = 0;
  for (let seed = 1; seed <= SEEDS; seed++) if (forge(seed, ids, epic).runeforgeOffer!.some((id) => aligned(id, tribes))) hit++;
  return hit / SEEDS;
};

describe('Runeforge: the guaranteed slot is tribe-aligned (owner 2026-10-08: "at least 1 rune that is tribe aligned")', () => {
  it('Epic forge, 4 Dragons + 3 Dwarves: every offer holds a Dragon or Dwarf rune', () => {
    expect(share([...DRAGONS, ...DWARVES], true, ['dragon', 'dwarf'])).toBe(1);
  });

  it('Epic forge, 3 Dragons + 3 Dwarves: every offer holds a Dragon or Dwarf rune', () => {
    expect(share([...DRAGONS.slice(0, 3), ...DWARVES, FILLERS[0]!], true, ['dragon', 'dwarf'])).toBe(1);
  });

  it('Basic forge, 2 Dragons + 2 Dwarves: every offer holds a Dragon or Dwarf rune', () => {
    expect(share([...DRAGONS.slice(0, 2), ...DWARVES.slice(0, 2), ...FILLERS], false, ['dragon', 'dwarf'])).toBe(1);
  });

  it('Epic forge, 3 Dragons alone: every offer holds a Dragon rune', () => {
    expect(share([...DRAGONS.slice(0, 3), ...FILLERS], true, ['dragon'])).toBe(1);
  });

  it('Epic forge, 2 Dragons + 2 Dwarves is below the Epic threshold: no tribe guarantee (the draw stays random)', () => {
    const s = share([...DRAGONS.slice(0, 2), ...DWARVES.slice(0, 2), ...FILLERS], true, ['dragon', 'dwarf']);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('a tribe-gated rune whose text never names the tribe is a fit: no pivot discount on Rune of Baal for a Dwarf board', () => {
    expect(RUNE_INDEX['rune_baal']!.tribes).toContain('dwarf');
    expect(runeSynergies(RUNE_INDEX['rune_baal']!)).not.toContain('dwarf');
    let seen = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = forge(seed, [...DWARVES, 'dw_orin', ...FILLERS], true);
      const i = s.runeforgeOffer!.indexOf('rune_baal');
      if (i < 0) continue;
      seen++;
      expect(s.runeforgeDiscounts?.[i], `seed ${seed}: a fitting rune never carries the pivot discount`).toBeUndefined();
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed yields the same offer and discounts', () => {
    const a = forge(42, [...DRAGONS, ...DWARVES], true);
    const b = forge(42, [...DRAGONS, ...DWARVES], true);
    expect(a.runeforgeOffer).toEqual(b.runeforgeOffer);
    expect(a.runeforgeDiscounts).toEqual(b.runeforgeDiscounts);
  });
});
