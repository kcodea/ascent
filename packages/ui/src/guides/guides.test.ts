/**
 * LOBBY RAIL GUIDES are data (guides.ts, guides.bundled.ts). Guides are edited live now, and the built-in file is
 * regenerated from them by `npm run guides:pull`, so this file pins only the STRUCTURE: every card id a guide names
 * resolves to a real card IN THE GUIDE'S SET, every tribe it names belongs to that set, the icon has art, no
 * placeholder or em dash is left in player text, and the visibility rule (own set only, tribes in the lobby only,
 * neutral always). It never pins a particular title or card list.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { artFor } from '../art';
import { GUIDES, PLACEHOLDER_BODY, guidesFor } from './guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';

describe('lobby rail guides', () => {
  it('has unique ids and at least one core unit per guide', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.core.length, g.id).toBeGreaterThan(0);
  });

  it('every card id resolves to a card in the guide\'s own set', () => {
    for (const g of BUNDLED_GUIDE_DATA) {
      const pool = poolFor(g.set);
      const inSet = new Set([...pool.buyable, ...pool.spells].map((c) => c.id));
      for (const id of [...g.core, ...g.enablers, ...(g.mentions ?? [])]) {
        expect(CARD_INDEX[id], `${g.id}: unknown card id "${id}"`).toBeDefined();
        expect(inSet.has(id), `${g.id}: "${id}" is not in ${g.set}`).toBe(true);
      }
    }
  });

  it("every guide's icon card resolves and has art", () => {
    for (const g of GUIDES) {
      expect(CARD_INDEX[g.iconCard], `${g.id}: unknown icon card "${g.iconCard}"`).toBeDefined();
      expect(artFor(g.iconCard), `${g.id}: no art for "${g.iconCard}"`).toBeTruthy();
    }
  });

  it('every tribe a guide names is one of its set\'s tribes', () => {
    for (const g of BUNDLED_GUIDE_DATA) {
      for (const t of [...g.tribes, ...(g.pairsWith ?? [])]) expect(SETS[g.set].tribes, `${g.id}: ${t}`).toContain(t);
    }
  });

  it('every alias names a card the guide lists, and every mention is named in the body', () => {
    for (const g of GUIDES) {
      const listed = new Set([...g.core, ...g.enablers, ...(g.mentions ?? [])]);
      for (const [word, id] of Object.entries(g.aliases ?? {})) {
        expect(listed.has(id), `${g.id}: alias "${word}" -> ${id}`).toBe(true);
        expect(g.body.toLowerCase(), `${g.id}: alias "${word}"`).toContain(word.toLowerCase());
      }
      for (const id of g.mentions ?? []) expect(g.body, `${g.id}: mention ${id}`).toContain(CARD_INDEX[id]!.name);
    }
  });

  it('no set 2 guide is a placeholder, and no player text holds an em dash', () => {
    for (const g of BUNDLED_GUIDE_DATA.filter((x) => x.set === 'set2')) expect(g.body, g.id).not.toBe(PLACEHOLDER_BODY);
    for (const g of GUIDES) expect(g.body, g.id).not.toMatch(/\u2014|--/); // no em dashes in player text
  });

  describe('which guides show (the rule, worked out from the data)', () => {
    type G = (typeof GUIDES)[number];
    const SET_IDS = Object.keys(SETS) as (keyof typeof SETS)[];
    /** The rule: this set is one of the guide's sets, and the guide is neutral or for a tribe that is in the lobby. */
    const shows = (g: G, set: string, lobby: readonly string[]): boolean =>
      (g.sets as readonly string[]).includes(set) && (g.tribes.length === 0 || g.tribes.some((t) => lobby.includes(t)));
    /** Lobbies to try for a set: nobody, each tribe alone, a pair, and all of them. */
    const lobbies = (set: keyof typeof SETS): (typeof SETS)[keyof typeof SETS]['tribes'][number][][] => {
      const ts = [...SETS[set].tribes];
      return [[], ...ts.map((t) => [t]), ts.slice(0, 2), ts];
    };

    it('shows exactly the guides of this set that are neutral or for a tribe in the lobby, each once', () => {
      for (const set of SET_IDS) {
        for (const lobby of lobbies(set)) {
          const got = guidesFor(set, lobby);
          const want = GUIDES.filter((g) => shows(g, set, lobby)).map((g) => g.id).sort();
          expect(got.map((g) => g.id).sort(), `${set} with ${lobby.join(',') || 'nobody'}`).toEqual(want);
          for (const g of got) expect((g.sets as readonly string[]), g.id).toContain(set);
        }
      }
    });

    it('never shows a guide for a tribe that is not in the lobby, and a crossover tribe alone does not bring one in', () => {
      for (const g of GUIDES) {
        if (g.tribes.length === 0) continue;
        for (const set of SET_IDS.filter((s) => (g.sets as readonly string[]).includes(s))) {
          const others = SETS[set].tribes.filter((t) => !g.tribes.includes(t));
          expect(guidesFor(set, others).map((x) => x.id), `${g.id} in ${set}`).not.toContain(g.id);
          const crossover = (g.pairsWith ?? []).filter((t) => !g.tribes.includes(t));
          expect(guidesFor(set, crossover).map((x) => x.id), `${g.id} crossover alone`).not.toContain(g.id);
        }
      }
    });

    it('lists neutral guides last and keeps each first tribe together, tribes in the order they first appear, each group in guide order', () => {
      for (const set of SET_IDS) {
        const got = guidesFor(set, [...SETS[set].tribes]);
        const lastTribed = got.map((g) => g.tribes.length > 0).lastIndexOf(true);
        const firstNeutral = got.findIndex((g) => g.tribes.length === 0);
        if (firstNeutral >= 0) expect(lastTribed, `${set}: a neutral guide comes before a tribe guide`).toBeLessThan(firstNeutral);
        const base = [...got].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        const groupOrder: string[] = [];
        for (const g of got.filter((x) => x.tribes.length > 0)) {
          const t = g.tribes[0]!;
          if (groupOrder[groupOrder.length - 1] !== t) {
            expect(groupOrder, `${set}: ${t} appears in two separate runs`).not.toContain(t);
            groupOrder.push(t);
          }
        }
        const firstSeen: string[] = [];
        for (const g of base) if (g.tribes.length > 0 && !firstSeen.includes(g.tribes[0]!)) firstSeen.push(g.tribes[0]!);
        expect(groupOrder, `${set}: tribe groups out of order`).toEqual(firstSeen);
        for (const t of groupOrder) {
          const inGroup = got.filter((g) => g.tribes[0] === t);
          expect(inGroup.map((g) => g.id), `${set}: ${t} group out of guide order`).toEqual(base.filter((g) => g.tribes[0] === t).map((g) => g.id));
        }
      }
    });
  });

  it('has at least one guide for every tribe of Set 2, the set the built-in guides were written for', () => {
    for (const t of SETS.set2.tribes) {
      expect(GUIDES.filter((g) => (g.sets as readonly string[]).includes('set2') && g.tribes.includes(t)).length, t).toBeGreaterThan(0);
    }
  });
});
