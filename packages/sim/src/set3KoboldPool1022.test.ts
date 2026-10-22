/**
 * SET 3 KOBOLD POOL CALL, owner 2026-10-22:
 *
 *   Archived from Set 3: Kobe, Blazer (both stay Set 2 cards).
 *   Back into Set 3: Shardluck, Delver (archived 2026-10-13) and Gemgorge Fiend, today named Cavern Fiend (archived
 *     from every set 2026-10-10; it returns to Set 3 only), at their existing tier, stats and text.
 *   Dealski        "When you play a Choose One card, get a random Ruby."              (was: get 2 Rubies)
 *   Prismatic Pick "Choose One: Discover 2 Rubies or your next Choose One card gains both effects." (was: a Ruby)
 *
 * Owner ruling the same day: a Ruby DISCOVER offers only the SPECIAL Ruby types, never the plain Ruby ("it's
 * discovering a ruby which means it's of the random ruby types, this should also NOT discover a regular ruby, only
 * the special ones").
 */
import { describe, it, expect } from 'vitest';
import { makeRng, simulate, RUBY_TYPE_IDS, SPECIAL_RUBY_IDS } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, EQUIPMENT_INDEX, SETS, poolFor } from '@game/content';
import { createRun, reduce, equipmentText, sideFromSnapshot, type Action, type BoardCard, type RunState } from './index';
import { snapshotBoard } from './snapshot';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: [...SETS.set3.tribes],
    hand: [], board: [], shop: [], recruitBuffFx: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const rubiesInHand = (s: RunState): string[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.ruby).map((c) => c.cardId);
const LEFT = ['k_kobe', 'k_blazer'] as const;
const BACK = ['k3_veinchant', 'k3_facetbound', 'k_gemgorge'] as const;

describe('Kobe and Blazer leave Set 3 (still Set 2 cards)', () => {
  it('are out of every Set 3 pool, still in Set 2, still resolve by id', () => {
    for (const id of LEFT) {
      expect(poolFor('set3').all.some((c) => c.id === id), `${id} out of set 3`).toBe(false);
      expect(poolFor('set2').buyable.some((c) => c.id === id), `${id} still set 2`).toBe(true);
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} is not archived everywhere`).toBe(false);
      expect(CARD_INDEX[id]).toBeTruthy();
    }
    // Unchanged otherwise.
    expect(CARD_INDEX['k_kobe']).toMatchObject({ tier: 4, attack: 5, health: 6 });
    expect(CARD_INDEX['k_blazer']).toMatchObject({ tier: 3, attack: 2, health: 5 });
  });

  it('an OLD Set 3 save holding them still loads and plays: shop action, snapshot and a deterministic combat replay', () => {
    let s = run({ board: [body('kb', 'k_kobe'), body('bz', 'k_blazer'), body('n', 'u3_poochy')] });
    s = act(s, { type: 'sell', uid: 'n' });
    expect(s.board.map((c) => c.cardId)).toEqual(['k_kobe', 'k_blazer']);
    const snap = snapshotBoard(s);
    expect(snap.minions.map((m) => m.cardId)).toEqual(['k_kobe', 'k_blazer']);
    const side = sideFromSnapshot(snap, 6, poolFor('set3').all.map((c) => c.id));
    const foes = [{ cardId: 'sandbag', attack: 0, health: 200, keywords: [] }] as never;
    const empty = sideFromSnapshot({ ...snap, minions: [] }, 1, []);
    const a = simulate(snap.minions, foes, makeRng(9), CARD_INDEX, side, empty);
    const b = simulate(snap.minions, foes, makeRng(9), CARD_INDEX, side, empty);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    // Blazer's Rally (a Ruby on every friendly minion) still resolves from the old save.
    const blazer = a.initial.player.find((m) => m.cardId === 'k_blazer')!.uid;
    expect(a.events.some((e) => (e as { source?: string }).source === blazer), 'Blazer acts in the replay').toBe(true);
  });
});

describe('Shardluck, Delver and Cavern Fiend return to Set 3', () => {
  it('are buyable Set 3 Kobolds at their existing tier, stats and text, and out of the archive', () => {
    for (const id of BACK) {
      expect(poolFor('set3').buyable.some((c) => c.id === id), `${id} in set 3`).toBe(true);
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} not archived`).toBe(false);
    }
    expect(CARD_INDEX['k3_veinchant']).toMatchObject({ name: 'Delver', tribe: 'kobold', tier: 2, attack: 4, health: 3, text: '**Echo:** get a **Veinstorm**.' });
    expect(CARD_INDEX['k3_facetbound']).toMatchObject({ name: 'Shardluck', tribe: 'kobold', tier: 6, attack: 8, health: 5 });
    expect(CARD_INDEX['k_gemgorge']).toMatchObject({ name: 'Cavern Fiend', tribe: 'kobold', tribe2: 'demon', tier: 6, attack: 6, health: 6 });
  });

  it('Set 2 does not regain Cavern Fiend, and Delver / Shardluck stay Set 3 only', () => {
    for (const id of BACK) expect(poolFor('set2').all.some((c) => c.id === id), id).toBe(false);
  });

  it('Delver: its Echo hands a Veinstorm home from a Set 3 combat (granted by id; Veinstorm resolves globally)', () => {
    const mine = [{ cardId: 'k3_veinchant', attack: 4, health: 1, sourceUid: 'D', keywords: [] }] as never;
    const foes = [{ cardId: 'sandbag', attack: 9, health: 400, keywords: [] }] as never;
    const set3 = sideFromSnapshot({ minions: [] } as never, 6, poolFor('set3').all.map((c) => c.id));
    const r = simulate(mine, foes, makeRng(4), CARD_INDEX, set3, sideFromSnapshot({ minions: [] } as never, 1, []));
    expect(JSON.stringify(r.playerHandGrants ?? [])).toContain('veinstorm');
  });

  it('Cavern Fiend in a Set 3 run: every 3 casts it Consumes the highest-Health Shop minion', () => {
    let s = run({
      board: [body('cf', 'k_gemgorge')],
      shop: [{ uid: 'o1', cardId: 'u3_poochy' }, { uid: 'o2', cardId: 'k3_porkbelly' }] as never,
    });
    const before = s.board[0]!.health;
    for (let i = 0; i < 3; i++) {
      s.hand.push(body(`r${i}`, 'ruby'));
      s = act(s, { type: 'play', uid: `r${i}`, targetUid: 'cf' });
    }
    expect(s.shop.some((o) => o.cardId === 'k3_porkbelly'), 'the highest-Health offer was eaten').toBe(false);
    expect(s.board[0]!.health).toBeGreaterThan(before + 3);
  });
});

describe('Dealski: "When you play a Choose One card, get a random Ruby."', () => {
  it('prints the new text, keeps T4 6/6', () => {
    const d = CARD_INDEX['k3_dealski']!;
    expect([d.tier, d.attack, d.health]).toEqual([4, 6, 6]);
    expect(d.text).toBe('When you play a **Choose One** card, get a random **Ruby**.');
    expect(d.goldenText).toBe('When you play a **Choose One** card, get **2** random **Rubies**.');
  });

  const play = (golden: boolean, rngCursor: number) => {
    let s = run({ rngCursor, board: [body('d', 'k3_dealski', { golden })], hand: [body('x', 'k3_jeweler')] });
    s = act(s, { type: 'play', uid: 'x' });
    if (s.chooseOne) s = act(s, { type: 'chooseOne', index: 1 }); // the max-Gold branch: no card of its own
    return rubiesInHand(s);
  };

  it('one random Ruby (Gilded 2), drawn from all six types, reproducible from the seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const p = play(false, seed * 7919);
      expect(p).toHaveLength(1);
      expect(play(true, seed * 7919)).toHaveLength(2);
      expect(play(false, seed * 7919), 'same seed, same Ruby').toEqual(p);
      for (const id of p) { expect(RUBY_TYPE_IDS).toContain(id); seen.add(id); }
    }
    expect(seen.size, 'genuinely random across types').toBeGreaterThan(2);
  });

  it('a non-Choose-One play pays nothing', () => {
    let s = run({ board: [body('d', 'k3_dealski')], hand: [body('x', 'u3_poochy')] });
    s = act(s, { type: 'play', uid: 'x' });
    expect(rubiesInHand(s)).toEqual([]);
  });
});

describe('Prismatic Pick: "Choose One: Discover 2 Rubies or your next Choose One card gains both effects."', () => {
  const armed = (over: Partial<RunState> = {}, golden = false): RunState =>
    act(run({ hand: [body('art', 'k3_prismpick', { golden })], ...over }), { type: 'play', uid: 'art', toIndex: 0 });

  it('prints the new text on the Equipment, its branch and Picksy', () => {
    const eq = EQUIPMENT_INDEX['prismatic_pick']!;
    expect(eq.text).toBe('Choose One: **Discover 2 Rubies** or your next **Choose One** card this turn gains **both** effects.');
    expect(eq.chooseOne![0]!.text).toBe('**Discover 2 Rubies**.');
    expect(CARD_INDEX['k3_prismpick']!.text).toContain('**Discover 2 Rubies**');
  });

  it('branch 1 is TWO Ruby Discovers, and NEITHER ever offers the plain Ruby (owner ruling 2026-10-22), across seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = act(act(armed({ rngCursor: seed * 104729 }), { type: 'activateEquipment' }), { type: 'chooseOne', index: 0 });
      let opened = 0;
      while (s.discover?.length) {
        opened++;
        for (const id of s.discover) {
          expect(id, 'never the plain Ruby').not.toBe('ruby');
          expect(SPECIAL_RUBY_IDS).toContain(id);
        }
        s = act(s, { type: 'discover', index: 0 });
      }
      expect(opened, 'two Discovers').toBe(2);
      const got = rubiesInHand(s);
      expect(got).toHaveLength(2);
      expect(got).not.toContain('ruby');
    }
  });

  it('Gilded: four Ruby Discovers', () => {
    let s = act(act(armed({}, true), { type: 'activateEquipment' }), { type: 'chooseOne', index: 0 });
    let opened = 0;
    while (s.discover?.length) { opened++; s = act(s, { type: 'discover', index: 0 }); }
    expect(opened).toBe(4);
  });

  it('branch 2 arms a charge through the shared Choose-Both path: the next Choose One resolves BOTH, then it is spent', () => {
    let s = act(act(armed(), { type: 'activateEquipment' }), { type: 'chooseOne', index: 1 });
    expect(s.chooseBothCharges).toBe(1);
    const maxBefore = s.maxEmbers;
    s.hand.push(body('j', 'k3_jeweler'));
    s = act(s, { type: 'play', uid: 'j' });
    expect(s.chooseOne, 'no prompt: both branches resolve').toBeFalsy();
    expect(s.hand.some((c) => CARD_INDEX[c.cardId]?.tribe === 'kobold' && !CARD_INDEX[c.cardId]?.ruby), 'the random-Kobold branch').toBe(true);
    expect((s.maxGoldBonus ?? 0) > 0 || s.maxEmbers > maxBefore, 'the max-Gold branch').toBe(true);
    expect(s.chooseBothCharges ?? 0, 'the charge is spent').toBe(0);
  });

  it('live text shows an armed charge in the Equipment slot, and nothing when none is armed', () => {
    const eq = EQUIPMENT_INDEX['prismatic_pick']!;
    expect(equipmentText(eq, 'plain', { chooseBothCharges: 0 })).toBe(eq.text);
    expect(equipmentText(eq, 'plain', { chooseBothCharges: 1 })).toBe(`${eq.text} **(1 armed)**`);
    expect(equipmentText(eq, 'gilded', { chooseBothCharges: 2 })).toBe(`${eq.goldenText} **(2 armed)**`);
    // An Equipment that cannot arm a charge never prints it.
    const blast = EQUIPMENT_INDEX['blast_pump']!;
    expect(equipmentText(blast, 'plain', { chooseBothCharges: 3 })).toBe(blast.text);
  });
});
