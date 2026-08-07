import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { HEROES } from './heroes';
import { hasTier7Access } from './config';
import { createRun, reduce, projectEndOfTurnSteps, type RunState } from './index';

/**
 * The final tranche of the owner's 2026-07-27 batch (built 2026-07-28): three new minions, the Tier-7 gate,
 * the all-type Discover rule, the hero disables, the "Shop spells" wording ruling, and the End-of-Turn FX beats.
 */
const minion = (uid: string, cardId: string, tribe: string, attack: number, health: number, extra = {}) =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false, ...extra }) as never;

const bm = (cardId: string, uid: string, attack = 5, health = 40, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords }) as unknown as BoardMinion;

describe('Moira — End of Turn: trigger adjacent Shouts', () => {
  it('fires BOTH neighbours, and nothing further out', () => {
    // Hoard Chronicler is "Shout: get a random Shop spell", so the hand size IS the trigger count. Three of
    // them in a row with Moira in the middle: the two ADJACENT fire, the far one must not.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [
        minion('far', 'd2_chronicler', 'dragon', 3, 5),
        minion('L', 'd2_chronicler', 'dragon', 3, 5),
        minion('M', 'b2_moira', 'beast', 6, 4),
        minion('R', 'd2_chronicler', 'dragon', 3, 5),
      ],
      hand: [],
    };
    const after = reduce(s, { type: 'faceOmen' });
    expect(after.hand.length, 'exactly the two neighbours should have fired').toBe(2);
  });

  it('gilded fires the whole thing twice', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [
        minion('L', 'd2_chronicler', 'dragon', 3, 5),
        minion('M', 'b2_moira', 'beast', 12, 8, { golden: true }),
        minion('R', 'd2_chronicler', 'dragon', 3, 5),
      ],
      hand: [],
    };
    const after = reduce(s, { type: 'faceOmen' });
    expect(after.hand.length, 'golden should double the whole trigger, not the grant').toBe(4);
  });

  it('a neighbour with no Shout is simply skipped, not counted as the slot', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [
        minion('L', 'sandbag', 'neutral', 1, 1),
        minion('M', 'b2_moira', 'beast', 6, 4),
        minion('R', 'd2_chronicler', 'dragon', 3, 5),
      ],
      hand: [],
    };
    expect(reduce(s, { type: 'faceOmen' }).hand.length).toBe(1);
  });
});

describe('Mineral Master — any friendly Rally plays Rubies on your Kobolds', () => {
  it('pays out on ANOTHER minion’s Rally, not just its own swing', () => {
    const r = simulate(
      [bm('k_mineralmaster', 'MM', 0, 400), bm('k_chipwick', 'K', 1, 400), bm('b2_packstrider', 'P', 5, 400, ['RL'])],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const paid = (r.events.filter((e) => e.type === 'buff') as { source?: string }[]).filter((b) => b.source === 'm0');
    expect(paid.length, 'a friendly Rally did not trigger it').toBeGreaterThan(0);
  });

  it('an ally swing with NO Rally keyword does not pay', () => {
    // The discriminator: `onAttack` is broadcast to every friendly minion, so without the RL gate this fires on
    // every swing in the fight — an ally-attack watcher, not a Rally watcher.
    const r = simulate(
      [bm('k_mineralmaster', 'MM', 0, 400), bm('k_chipwick', 'K', 1, 400), bm('sandbag', 'S', 5, 400)],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const paid = (r.events.filter((e) => e.type === 'buff') as { source?: string }[]).filter((b) => b.source === 'm0');
    expect(paid, 'paid out on a plain ally swing').toEqual([]);
  });
});

describe('Paragon — the all-type minion', () => {
  it('counts as every tribe and lives in set 2', () => {
    expect(CARD_INDEX['n2_paragon']!.universalTribe).toBe(true);
    expect(poolFor('set2').all.some((c) => c.id === 'n2_paragon')).toBe(true);
  });

  it('matches the owner’s example: 2 Dragons + a Beast + Paragon → one Dragon, the Beast, Paragon', () => {
    const r = simulate(
      [bm('n2_paragon', 'P', 0, 400), bm('d2_ashscribe', 'D1', 0, 400), bm('d2_chronicler', 'D2', 0, 400),
       bm('b2_packstrider', 'B', 5, 400, ['RL'])],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const grants = (r.events.filter((e) => e.type === 'buff') as { target: string; source?: string; attack: number }[])
      .filter((b) => b.source === 'm0' && b.attack === 4); // +3/+3 -> +4/+4 (owner 2026-08-07)
    expect(grants.length, 'Paragon granted nothing').toBeGreaterThan(0);
    const firstWave = grants.slice(0, 3).map((g) => g.target);
    expect(new Set(firstWave).size, 'a recipient was buffed twice in one Rally').toBe(3);
    expect(firstWave, 'Paragon must collect its own payout — it IS a minion of every type').toContain('m0');
  });

  it('…and with 3 Dragons it picks ONE of them, not all three', () => {
    // The owner's second example, and the reason this is neither "one per active tribe" nor "everyone".
    const r = simulate(
      [bm('n2_paragon', 'P', 0, 400), bm('d2_ashscribe', 'D1', 0, 400), bm('d2_chronicler', 'D2', 0, 400),
       bm('d2_skald', 'D3', 0, 400), bm('b2_packstrider', 'B', 5, 400, ['RL'])],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(7), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const grants = (r.events.filter((e) => e.type === 'buff') as { target: string; source?: string; attack: number }[])
      .filter((b) => b.source === 'm0' && b.attack === 4); // +3/+3 -> +4/+4 (owner 2026-08-07)
    const firstWave = grants.slice(0, 3).map((g) => g.target);
    const dragons = ['m1', 'm2', 'm3'];
    expect(firstWave.filter((t) => dragons.includes(t)).length, 'more than one Dragon was picked').toBe(1);
  });

  it('the gift is PERMANENT — it rides the perma-buff carry-back home', () => {
    const r = simulate(
      [bm('n2_paragon', 'P', 0, 400), bm('b2_packstrider', 'B', 5, 400, ['RL'])],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const carried = (r.playerPermaBuffs ?? []).find((b) => b.sourceUid === 'P');
    expect(carried, 'Paragon’s own gift never left combat').toBeTruthy();
    expect(carried!.attack).toBeGreaterThan(0);
  });
});

describe('the all-type Discover rule (Wayfinder, owner ruling 2026-07-27)', () => {
  /** A SET-2 run at max tier holding one minion of every active tribe, plus the Wayfinder to play.
   *  Set 2 specifically, because that is the owner's worked example and because set 1's only all-type minion
   *  (Lab Experiment) is Tier 7 — unreachable at tavern tier 6, so the branch correctly declines there. */
  const boardOfEveryTribe = (): RunState => {
    const s = { ...createRun(1, undefined, undefined, undefined, 'set2'), phase: 'recruit', tier: 6, embers: 60 } as RunState;
    const one: string[] = [];
    for (const t of s.tribes.filter((x) => x !== 'neutral')) {
      const pick = poolFor('set2').buyable.find((c) => !c.universalTribe && (c.tribe === t || c.tribe2 === t));
      if (pick) one.push(pick.id);
    }
    return {
      ...s,
      board: one.map((id, i) => minion(`b${i}`, id, CARD_INDEX[id]!.tribe, 1, 1)),
      hand: [minion('w', 'wayfinder', 'neutral', 4, 2)],
    };
  };

  it('the fixture really does cover every active tribe (else the rule is never exercised)', () => {
    const s = boardOfEveryTribe();
    const covered = new Set<string>();
    for (const c of s.board) {
      const d = CARD_INDEX[c.cardId]!;
      for (const t of [d.tribe, d.tribe2]) if (t && t !== 'neutral') covered.add(t);
    }
    expect(covered.size).toBe(s.tribes.filter((t) => t !== 'neutral').length);
  });

  it('controlling every tribe makes Wayfinder offer ONLY all-type minions', () => {
    const after = reduce(boardOfEveryTribe(), { type: 'play', uid: 'w' });
    expect(after.discover?.length ?? 0, 'no Discover opened').toBeGreaterThan(0);
    for (const id of after.discover!) {
      expect(CARD_INDEX[id]!.universalTribe, `offered ${id}, which is not an all-type minion`).toBe(true);
    }
  });

  it('…and an ordinary board still gets the normal uncontrolled-tribe spread', () => {
    // The control. Without it the assertion above would pass just as well against a Wayfinder that had broken.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', tier: 6, embers: 60,
      board: [], hand: [minion('w', 'wayfinder', 'neutral', 4, 2)],
    };
    const after = reduce(s, { type: 'play', uid: 'w' });
    expect(after.discover?.length ?? 0).toBeGreaterThan(0);
    expect(after.discover!.every((id) => CARD_INDEX[id]!.universalTribe),
      'an empty board should NOT be funnelled into the all-type branch').toBe(false);
  });
});

describe('Tier 7 access (owner ruling 2026-07-28)', () => {
  it('a plain run has none; Summit and the hero/quest flag are the only two ways in', () => {
    expect(hasTier7Access({})).toBe(false);
    expect(hasTier7Access({ rift: 'summit' })).toBe(true);
    expect(hasTier7Access({ tier7Access: true })).toBe(true);
  });
});

describe('hero disables (owner 2026-07-28)', () => {
  const DISABLED = ['cassen', 'jenkins', 'chronoshero', 'tiff', 'djinn'];

  it('all five are withheld from every picker', () => {
    for (const id of DISABLED) {
      const h = HEROES.find((x) => x.id === id);
      expect(h, `${id} exists`).toBeTruthy();
      expect(h!.wip, `${id} should be disabled`).toBe(true);
    }
  });

  it('…and they stay RESOLVABLE, so an in-flight save or a replay still loads', () => {
    // Disabling is a picker concern, not a registry deletion.
    for (const id of DISABLED) expect(createRun(1, id).heroId).toBe(id);
  });
});

describe('"Shop spells" wording ruling (owner 2026-07-27)', () => {
  it('a card that grants a random spell says "Shop spell" — Rubies are never in that pool', () => {
    expect(CARD_INDEX['d2_chronicler']!.text).toMatch(/Shop spell/i);
  });

  it('a card that raises spell power says it too', () => {
    expect(CARD_INDEX['aeonguard']!.text).toMatch(/Shop spell/i);
  });

  it('the Grimoire keeps the INCLUSIVE wording, because a Ruby really does spend its charge', () => {
    expect(CARD_INDEX['d2_grimoire']!.text).not.toMatch(/Shop spell/i);
  });
});

describe('End-of-Turn FX beats (owner report 2026-07-28)', () => {
  it('Void Curator carries BOTH a spell-power rise and an Imp-aura rise on its beat', () => {
    // The bug was two separate misses: the spell cue matched on Aeon Guard's factory id specifically, and the
    // aura wash is gated on the run still being in recruit AFTER the action — which End of Turn never is.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('T', 'dm_tallymonger', 'demon', 6, 6)],
    };
    const { fx } = projectEndOfTurnSteps(s);
    expect(fx.some((f) => f.spellPower), 'no spell-power rise recorded on any beat').toBe(true);
    expect(fx.some((f) => f.impAura), 'no Imp-aura rise recorded on any beat').toBe(true);
  });

  it('…and Aeon Guard still reports the spell-power rise the cue was named for', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('A', 'aeonguard', 'mech', 6, 6)],
    };
    const { fx } = projectEndOfTurnSteps(s);
    expect(fx.some((f) => f.spellPower)).toBe(true);
    expect(fx.some((f) => f.impAura), 'Aeon Guard touches no Imps').toBe(false);
  });

  it('a beat that moves neither channel records neither (guards against an always-on cue)', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('S', 'sandbag', 'neutral', 1, 1)],
    };
    const { fx } = projectEndOfTurnSteps(s);
    expect(fx.some((f) => f.spellPower || f.impAura)).toBe(false);
  });
});
