import { describe, expect, it } from 'vitest';
import { inRunTribes, type CardDef } from '@game/core';
import { CARD_INDEX, SETS, activeSet } from '@game/content';
import {
  createLobbyRun, normalizePracticeTribes, poolOf, practiceRunTribes, practiceTribeOptions, reduce, runTribesForSeed,
  togglePracticeTribe, type Action, type PracticeConfig, type PracticeTribe, type RunState,
} from './index';
import { offerDiscover, offerSpellDiscover } from './recruit';
import { runSpells } from './spellPool';

/**
 * PRACTICE TRIBES (owner 2026-09-27): "yeah let's change tribe surge to that tribe's cards plus neutral cards, and
 * all spells associated, but make it multi select. so i can choose demons + dragons and have
 * demons/dragons/neutrals in the game. reword 'none' to 'Normal'". Earlier the same day: "practice tribe surge
 * should only have the active set's tribes."
 */
const cfg = (tribes: PracticeTribe[]): PracticeConfig => ({ opponents: 'bots', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes });
const practice = (seed: number, tribes: PracticeTribe[]): RunState => createLobbyRun(seed, 'aster', {}, 'practice', cfg(tribes));
const tribesOf = (c: CardDef): string[] => [c.tribe, ...(c.tribe2 ? [c.tribe2] : [])];

describe('Practice tribe options', () => {
  it('are exactly the active set tribes (no other set tribe, no neutral)', () => {
    expect(practiceTribeOptions()).toEqual(activeSet().tribes.filter((t) => t !== 'neutral'));
  });
  it('a set 2 run never offers Spirit; set 3 does', () => {
    expect(practiceTribeOptions('set2')).not.toContain('spirit');
    expect(practiceTribeOptions('set2')).toEqual([...SETS.set2.tribes]);
    expect(practiceTribeOptions('set3')).toContain('spirit');
  });
});

describe('the Tribes row selection rules (Normal is exclusive)', () => {
  const [a, b] = practiceTribeOptions() as [PracticeTribe, PracticeTribe];
  it('picking a tribe from Normal selects just it; a second tribe adds to it', () => {
    expect(togglePracticeTribe([], a)).toEqual([a]);
    expect(togglePracticeTribe([a], b).sort()).toEqual([a, b].sort());
  });
  it('picking Normal clears every tribe', () => {
    expect(togglePracticeTribe([a, b], null)).toEqual([]);
  });
  it('unpicking a lit tribe removes it, and unpicking the last returns to Normal', () => {
    expect(togglePracticeTribe([a, b], a)).toEqual([b]);
    expect(togglePracticeTribe([b], b)).toEqual([]);
  });
  it('keeps the set order and drops tribes the set does not have or junk from an old draft', () => {
    const opts = practiceTribeOptions('set2');
    expect(normalizePracticeTribes([...opts].reverse(), 'set2')).toEqual(opts);
    expect(normalizePracticeTribes(['spirit', 'demon', 7, 'demon'], 'set2')).toEqual(['demon']);
    expect(normalizePracticeTribes(undefined)).toEqual([]);
    expect(normalizePracticeTribes('dragon')).toEqual([]);
  });
});

describe('a Practice game with picked tribes plays only those tribes plus neutral', () => {
  const picks: PracticeTribe[] = ['demon', 'dragon'];
  const allowed = new Set<string>(['neutral', ...picks]);
  const onTribe = (id: string): boolean => {
    const c = CARD_INDEX[id]!;
    return c.token === true || tribesOf(c).some((t) => allowed.has(t));
  };

  it('its run tribes are exactly the picked ones, and the hero offer sees the same tribes', () => {
    expect(activeSet().tribes).toEqual(expect.arrayContaining(picks)); // the fixture needs a set with both
    for (const seed of [1, 2, 3, 99]) {
      const run = practice(seed, picks);
      expect([...run.tribes].sort()).toEqual([...picks].sort());
      expect(practiceRunTribes(seed, cfg(picks))).toEqual(run.tribes);
      expect(run.practiceConfig?.tribes).toEqual(run.tribes);
    }
  });

  it('the stocked pool, every spell and every drawable card are those tribes or neutral (dual types count)', () => {
    const run = practice(5, picks);
    for (const id of Object.keys(run.pool)) expect(onTribe(id), id).toBe(true);
    for (const c of poolOf(run).all) expect(c.token || inRunTribes(c, picks), c.id).toBe(true);
    for (const c of runSpells(run)) expect(c.tribe === 'neutral' || picks.includes(c.tribe as PracticeTribe), c.id).toBe(true);
    // A dual type counts when either tribe is picked (e.g. a Dragon/Demon under a Demon-only pick).
    const dual = poolOf({ setId: run.setId }).buyable.find((c) => c.tribe2 === 'demon' && c.tribe !== 'demon');
    if (dual) expect(poolOf(practice(5, ['demon'])).buyable.map((c) => c.id)).toContain(dual.id);
  });

  it('shop, Discover and spell offers over many refreshes never leave the picked tribes', () => {
    let s: RunState = { ...practice(11, picks), tier: 6, embers: 9999, maxEmbers: 9999 };
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      s = reduce(s, { type: 'roll' } as Action);
      for (const o of s.shop) { expect(onTribe(o.cardId), `shop ${o.cardId}`).toBe(true); seen.add(CARD_INDEX[o.cardId]!.tribe); }
      if (s.spell) expect(onTribe(s.spell.cardId), `spell ${s.spell.cardId}`).toBe(true);
      const d: RunState = structuredClone(s);
      offerDiscover(d, 1 + (i % 6));
      for (const id of d.discover ?? []) expect(onTribe(id), `discover ${id}`).toBe(true);
      const sd: RunState = structuredClone(s);
      offerSpellDiscover(sd);
      for (const id of sd.discover ?? []) expect(onTribe(id), `spell discover ${id}`).toBe(true);
    }
    // Both picked tribes (and neutral) actually show up: a filter, not an empty shop.
    for (const t of ['neutral', ...picks]) expect(seen.has(t), t).toBe(true);
  });

  it('a single picked tribe is fine too: the run plays several rounds of buying and fighting without error', () => {
    for (const tribe of practiceTribeOptions()) {
      let s: RunState = practice(21, [tribe]);
      expect(s.tribes).toEqual([tribe]);
      for (let round = 0; round < 8 && s.phase === 'recruit'; round++) {
        s = { ...s, embers: 60, maxEmbers: 60 };
        if (s.tier < 6) s = reduce(s, { type: 'upgrade' } as Action);
        for (let k = 0; k < 6; k++) {
          const offer = s.shop[0];
          if (!offer || s.hand.length >= 8) break;
          s = reduce(s, { type: 'buy', uid: offer.uid } as Action);
          s = settlePrompts(s);
        }
        for (const card of [...s.hand]) {
          if (s.board.length >= 7) break;
          s = reduce(s, { type: 'play', uid: card.uid } as Action);
          s = settlePrompts(s);
        }
        s = settlePrompts(s);
        for (const c of s.board) expect(onTribeFor(tribe, c.cardId), `${tribe} board ${c.cardId}`).toBe(true);
        for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
        if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' } as Action);
        if (s.questOffer?.length) s = reduce(s, { type: 'buyQuest', index: 0 } as Action);
      }
      expect(s.wave, `${tribe}: the loop kept playing rounds`).toBeGreaterThan(5);
    }
  });

  it('Normal (no tribes picked) is the usual seeded roll and the full set pool', () => {
    for (const seed of [1, 2, 3]) {
      const run = practice(seed, []);
      expect(run.tribes).toEqual(runTribesForSeed(seed));
      expect(practiceRunTribes(seed, cfg([]))).toEqual(runTribesForSeed(seed));
      expect(poolOf(run)).toBe(poolOf({ setId: run.setId }));
    }
  });
});

/** Answer whatever the last action opened (a Discover, a Choose One) with its first option. */
function settlePrompts(s: RunState): RunState {
  for (let g = 0; g < 6; g++) {
    if (s.discover?.length) s = reduce(s, { type: 'discover', index: 0 } as Action);
    else if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 } as Action);
    else break;
  }
  return s;
}

function onTribeFor(tribe: PracticeTribe, id: string): boolean {
  const c = CARD_INDEX[id];
  if (!c) return true;
  return c.token === true || c.tribe === 'neutral' || c.tribe === tribe || c.tribe2 === tribe;
}
