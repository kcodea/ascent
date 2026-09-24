import { describe, it, expect } from 'vitest';
import { combatSide, damageMeterOf, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';

/**
 * OWNER BATCH 2026-09-24 — Kobolds, Celestials and Dwarves.
 *
 *  - "Facetwright's Choice" → "Facetwright" (display name only; id `facetwright` kept for saves/replays).
 *  - Pickles: "Choose One: Get 3 Rubies or a Facetwright." (gilded 6 Rubies / 2 Facetwrights).
 *  - Jewel: "Choose One: Get a random Kobold or increase your max Gold by 1." (gilded 2 Kobolds / +2 max Gold).
 *  - Delver: T2, 4/3 (text unchanged).
 *  - Kurse: "Avenge (3): Summon a Gemheart Golem with this minion's Rubies. It attacks immediately." The
 *    immediate attack is a MECHANIC change specific to Kurse (owner clarification 2026-09-24); other Golem
 *    summoners only share the wording.
 *  - Maestro Lux: "Pummel (12): Get a random Celestial. (Once per combat.)" (was a Shout Discover).
 *  - Han Gover: "(Max 5 per combat.)" (cap tests live in set3Dwarves.test.ts + core pummelTrigger.test.ts).
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 4, tribes: ['kobold', 'celestial', 'dwarf'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const playChoose = (s: RunState, uid: string, index: number): RunState =>
  act(act(s, { type: 'play', uid } as Action), { type: 'chooseOne', index } as Action);

describe('Facetwright (renamed from "Facetwright\'s Choice", display only)', () => {
  it('keeps its id and prints the new name', () => {
    const d = CARD_INDEX['facetwright']!;
    expect(d.name).toBe('Facetwright');
    expect(d.spell).toBe(true);
  });
});

describe('Pickles: "Choose One: Get 3 Rubies or a Facetwright."', () => {
  it('prints both halves (gilded 6 Rubies / 2 Facetwrights) and declares one primitive per branch', () => {
    const c = CARD_INDEX['k3_splitpick']!;
    expect([c.tier, c.attack, c.health]).toEqual([2, 3, 3]); // T2 3/3 since the 2026-09-24 kobold/dwarf batch
    expect(c.text).toBe('**Choose One:** Get **3 Rubies** or a **Facetwright**.');
    expect(c.goldenText).toBe('**Choose One:** Get **6 Rubies** or **2 Facetwrights**.');
    expect(c.chooseOne!.map((o) => o.effects)).toEqual([
      [{ on: 'onPlay', do: 'battlecryGetRubies', params: { count: 3 } }],
      [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'facetwright' } }],
    ]);
  });

  it('the Ruby branch hands 3 Rubies (6 gilded)', () => {
    const rubies = (s: RunState) => s.hand.filter((h) => CARD_INDEX[h.cardId]?.ruby).length;
    expect(rubies(playChoose(run({ hand: [body('p', 'k3_splitpick')] }), 'p', 0))).toBe(3);
    expect(rubies(playChoose(run({ hand: [body('p', 'k3_splitpick', { golden: true })] }), 'p', 0))).toBe(6);
  });

  it('the Facetwright branch hands a Facetwright (2 gilded), and nothing else', () => {
    const s = playChoose(run({ hand: [body('p', 'k3_splitpick')] }), 'p', 1);
    expect(s.hand.map((h) => h.cardId)).toEqual(['facetwright']);
    const g = playChoose(run({ hand: [body('p', 'k3_splitpick', { golden: true })] }), 'p', 1);
    // (Playing a Gilded minion also hands its own triple reward; count the Facetwrights.)
    expect(g.hand.filter((h) => h.cardId === 'facetwright')).toHaveLength(2);
  });
});

describe('Jewel: "Choose One: Get a random Kobold or increase your max Gold by 1."', () => {
  it('prints both halves (gilded 2 Kobolds / +2) and reuses the shared primitives', () => {
    const c = CARD_INDEX['k3_jeweler']!;
    expect([c.tier, c.attack, c.health]).toEqual([4, 5, 5]);
    expect(c.text).toBe('**Choose One:** Get a random **Kobold** or increase your max **Gold** by **1**.');
    expect(c.goldenText).toBe('**Choose One:** Get **2** random **Kobolds** or increase your max **Gold** by **2**.');
    expect(c.chooseOne!.map((o) => o.effects![0]!.do)).toEqual(['battlecryGainRandomMinion', 'gainMaxMana']);
  });

  it('the Kobold branch hands a random Kobold at or below the shop tier (2 gilded), no Discover', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = playChoose(run({ hand: [body('j', 'k3_jeweler')], rngCursor: seed * 7919 }), 'j', 0);
      expect(s.discover ?? null, `seed ${seed}`).toBeNull();
      expect(s.hand).toHaveLength(1);
      const got = CARD_INDEX[s.hand[0]!.cardId]!;
      expect(got.tribe === 'kobold' || got.tribe2 === 'kobold' || !!got.universalTribe, got.id).toBe(true);
      expect(got.tier).toBeLessThanOrEqual(4);
    }
    const g = playChoose(run({ hand: [body('j', 'k3_jeweler', { golden: true })] }), 'j', 0);
    // (Playing a Gilded minion also hands its own triple reward; count the minions.)
    expect(g.hand.filter((h) => h.cardId !== 'discoverspell').map((h) => CARD_INDEX[h.cardId]!.tribe)).toEqual(['kobold', 'kobold']);
  });

  it('the Gold branch raises max Gold permanently (+1, +2 gilded) through the above-the-cap bonus', () => {
    expect(playChoose(run({ hand: [body('j', 'k3_jeweler')], maxGoldBonus: 0 }), 'j', 1).maxGoldBonus).toBe(1);
    expect(playChoose(run({ hand: [body('j', 'k3_jeweler', { golden: true })], maxGoldBonus: 0 }), 'j', 1).maxGoldBonus).toBe(2);
  });

  it('Gold Font (the spell that owns `gainMaxMana`) is unchanged: +1', () => {
    const font = Object.values(CARD_INDEX).find((c) => c.spell && c.effects.some((e) => e.do === 'gainMaxMana'))!;
    expect(font.effects.find((e) => e.do === 'gainMaxMana')!.params).toEqual({ amount: 1 });
  });
});

describe('Delver: T2 4/3 (owner 2026-09-24), text unchanged', () => {
  it('is a Tier 2 4/3 Kobold, still "Echo: get a Veinstorm", sold at Tier 2 in set 3', () => {
    const c = CARD_INDEX['k3_veinchant']!;
    expect([c.tribe, c.tier, c.attack, c.health]).toEqual(['kobold', 2, 4, 3]);
    expect(c.text).toBe('**Echo:** get a **Veinstorm**.');
    expect(poolFor('set3').buyable.find((x) => x.id === 'k3_veinchant')?.tier).toBe(2);
  });
});

// ── combat: Kurse's Golem swings on arrival; Carver's waits its turn ────────────────────────────────────────
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra } as BoardMinion);
const bag = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const SET3 = poolFor('set3').all.map((c) => c.id);
const fight = (mine: BoardMinion[], foes: BoardMinion[]) =>
  simulate(mine, foes, makeRng(3), CARD_INDEX,
    combatSide({ tier: 6, poolIds: SET3, tribes: ['kobold', 'celestial', 'dwarf'] } as never), combatSide({ tier: 1 }));
/** The first `attack` event after the Golem's summon, and the Golem's uid. */
const afterGolem = (events: readonly CombatEvent[]) => {
  const i = events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'gemheart-shard');
  expect(i, 'a Golem was summoned').toBeGreaterThanOrEqual(0);
  const golem = (events[i] as Extract<CombatEvent, { type: 'summon' }>).minion.uid;
  const next = events.slice(i + 1).find((e) => e.type === 'attack') as Extract<CombatEvent, { type: 'attack' }> | undefined;
  return { golem, next };
};

describe('Kurse: "Avenge (3): Summon a Gemheart Golem with this minion\'s Rubies. It attacks immediately."', () => {
  it('prints the new wording and carries the immediate-attack flag (mechanic change, Kurse only)', () => {
    const c = CARD_INDEX['k3_kurse']!;
    expect([c.tier, c.attack, c.health]).toEqual([4, 7, 4]);
    expect(c.text).toBe("**Avenge (3):** Summon a **Gemheart Golem** with this minion's Rubies. It attacks immediately.");
    expect(c.goldenText).toBe("**Avenge (3):** Summon a **2/2 Gemheart Golem** with double this minion's Rubies. It attacks immediately.");
    expect(c.effects).toEqual([{ on: 'avenge', do: 'avengeSummonRubyStats', params: { count: 3, tokenId: 'gemheart-shard', charge: true } }]);
  });

  it("the Golem attacks the moment it lands: the next attack after its summon is the Golem's", () => {
    const r = fight([bm('k3_kurse', 'KU', 10, 100), bm('sandbag', 'f1', 1, 1), bm('sandbag', 'f2', 1, 1), bm('sandbag', 'f3', 1, 1)], [bag(1, 400)]);
    const { golem, next } = afterGolem(r.events);
    expect(next?.attacker).toBe(golem);
  });

  it("Gemheart Carver's Echo Golem does NOT attack immediately (wording only, no behaviour change)", () => {
    const c = CARD_INDEX['k_gemheart']!;
    // Two Golems since the owner Ruby batch 2026-09-24 (`golems: 2`); neither attacks immediately.
    expect(c.text).toBe("**Echo:** Summon **2 Gemheart Golems** with this minion's Rubies.");
    expect(c.effects[0]!.params).toEqual({ tokenId: 'gemheart-shard', golems: 2 });
    const r = fight([bm('k_gemheart', 'GC', 5, 1), bm('sandbag', 'f1', 0, 50)], [bag(1, 400)]);
    const { golem, next } = afterGolem(r.events);
    expect(next?.attacker).not.toBe(golem);
  });

  it('the other Golem texts share the wording and do not promise an immediate attack', () => {
    expect(CARD_INDEX['k3_porkbelly']!.text).toBe("Before this attacks, summon a **Gemheart Golem** with this minion's Rubies, and it attacks first.");
    expect(CARD_INDEX['k_gemheart']!.text).not.toContain('attacks immediately');
  });
});

describe('Maestro Lux: "Pummel (12): Get a random Celestial. (Once per combat.)"', () => {
  const lux = (over: Partial<BoardMinion> = {}): BoardMinion => bm('ce3_starcharter', 'lux', 3, 4, over);
  const celestialsGranted = (r: ReturnType<typeof fight>) =>
    // All-types cards count as every tribe (the shared tribe helpers), so they are legal "random Celestial" picks.
    (r.playerHandGrants ?? []).filter((id) => CARD_INDEX[id]?.tribe === 'celestial' || CARD_INDEX[id]?.tribe2 === 'celestial' || !!CARD_INDEX[id]?.universalTribe);

  it('the card: T4 3/4 Celestial, a passive Pummel (12) meter with a random-Celestial body, no Shout', () => {
    const c = CARD_INDEX['ce3_starcharter']!;
    expect([c.tribe, c.tier, c.attack, c.health]).toEqual(['celestial', 4, 3, 4]);
    expect(c.effects).toEqual([{ on: 'passive', do: 'dealtDamageGrantRandomTribe', params: { every: 12, tribe: 'celestial', count: 1 } }]);
    expect(c.text).toBe('**Pummel (12):** Get a random **Celestial**. (Once per combat.)');
    expect(c.goldenText).toBe('**Pummel (12):** Get **2** random **Celestials**. (Once per combat.)');
    expect(damageMeterOf(c)).toEqual({ do: 'dealtDamageGrantRandomTribe', every: 12 });
  });

  it('11 damage: nothing; 12: one random Celestial flown to hand (a toHand from Lux) with a pummelTrigger', () => {
    expect(celestialsGranted(fight([lux({ attack: 11 })], [bag(0, 11)]))).toEqual([]);
    const r = fight([lux({ attack: 12 })], [bag(0, 12)]);
    expect(celestialsGranted(r)).toHaveLength(1);
    expect(r.events.filter((e) => e.type === 'pummelTrigger')).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'toHand' && e.source === r.initial.player[0]!.uid)).toBe(true);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'lux', total: 12 }]);
  });

  it('ONCE per combat: 36 damage (three crossings, one hit or three) still pays one Celestial', () => {
    expect(celestialsGranted(fight([lux({ attack: 36 })], [bag(0, 1)]))).toHaveLength(1);
    expect(celestialsGranted(fight([lux({ attack: 12 })], [bag(0, 12), bag(0, 12), bag(0, 12)]))).toHaveLength(1);
  });

  it('GILDED: two Celestials, still once', () => {
    expect(celestialsGranted(fight([lux({ attack: 24, golden: true })], [bag(0, 1)]))).toHaveLength(2);
  });

  it('the Celestial carries back across the combat to shop boundary into the real hand, and the meter persists', () => {
    const r = fight([lux({ attack: 12 })], [bag(0, 12)]);
    let s = run({ phase: 'combat', board: [body('lux', 'ce3_starcharter')], hand: [], lastCombat: r });
    s = act(s, { type: 'settleCombat' });
    expect(s.hand.map((h) => h.cardId)).toEqual(r.playerHandGrants);
    const got = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(got.tribe === 'celestial' || !!got.universalTribe).toBe(true);
    expect(s.board.find((c) => c.uid === 'lux')!.damageDealt).toBe(12);
  });
});
