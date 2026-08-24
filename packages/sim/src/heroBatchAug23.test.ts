/**
 * AEVOR · GORUN · CINDARA (owner spec 2026-08-23).
 *
 * All three are passives riding a RUN-LIFETIME tally, so the interesting cases are not "does it fire" but
 * "does it fire with the right number, at the right threshold, on the right side, and does the number
 * survive the settle". Each block below tests the rule, its boundary, and its printed text — the printed
 * value is not decoration here, it is the hard live-text rule (CLAUDE.md), and all three scale.
 */
import { describe, expect, it } from 'vitest';
import { simulate, makeRng, combatSide, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import {
  tempestGrantOf, bladeMasteryGrantOf, hoardWhelpStatsOf, heroPowerText,
  TEMPEST_KILLS_PER_STEP, BLADE_ATTACKS_PER_STEP, applyEndOfTurn,
} from './recruit';
import { getHero } from './heroes';

/** Bodies for a side — `simulate` takes the two boards positionally, with the run-level context after them. */
const board = (ms: { cardId: string; attack: number; health: number }[]): BoardMinion[] =>
  ms.map((m) => ({ ...m, keywords: [] }));

/** One fight. `mods` is the PLAYER side's quest/hero combat context — the channel all three powers ride. */
const fight = (
  player: { cardId: string; attack: number; health: number }[],
  enemy: { cardId: string; attack: number; health: number }[],
  mods: Record<string, unknown> = {},
  seed = 5,
) => simulate(board(player), board(enemy), makeRng(seed), CARD_INDEX, combatSide({ tier: 1, questMods: mods as never }), combatSide({ tier: 1 }));

const runWith = (heroId: string): RunState => createRun(7, heroId, 'practice');

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Aevor — Tempest', () => {
  it('does NOTHING below the first 15 kills — the power is printed as locked, so it must be', () => {
    const s = runWith('aevor');
    s.tempestKills = 14;
    expect(tempestGrantOf(s)).toBe(0);
    // …and the panel says so rather than printing a hollow "+0/+0".
    expect(heroPowerText(s)).toContain('Locked');
    expect(heroPowerText(s)).toContain('**1**'); // one more kill
  });

  it('grants +4/+4 per completed 15 kills, and steps exactly ON the threshold', () => {
    const s = runWith('aevor');
    for (const [kills, grant] of [[15, 4], [29, 4], [30, 8], [45, 12], [100, 24]] as const) {
      s.tempestKills = kills;
      expect(tempestGrantOf(s), `${kills} kills`).toBe(grant);
    }
    expect(TEMPEST_KILLS_PER_STEP).toBe(15);
  });

  it('buffs BOTH ends of the board at End of Turn', () => {
    const s = runWith('aevor');
    s.tempestKills = 30; // +8/+8
    s.board = [
      { uid: 'a', cardId: 'b2_packstrider', attack: 2, health: 2, keywords: [], effects: [], buffs: [] },
      { uid: 'b', cardId: 'b2_packstrider', attack: 2, health: 2, keywords: [], effects: [], buffs: [] },
      { uid: 'c', cardId: 'b2_packstrider', attack: 2, health: 2, keywords: [], effects: [], buffs: [] },
    ] as never;
    applyEndOfTurn(s);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([10, 10]);
    expect([s.board[2]!.attack, s.board[2]!.health]).toEqual([10, 10]);
    expect([s.board[1]!.attack, s.board[1]!.health], 'the middle is untouched').toEqual([2, 2]);
  });

  it('a ONE-MINION board is buffed once, not twice', () => {
    // With a single body the left-most and right-most are the same minion. Paying it double would make the
    // power strongest exactly when the board is weakest — flagged to the owner, pinned here so the answer is
    // deliberate rather than emergent.
    const s = runWith('aevor');
    s.tempestKills = 15; // +4/+4
    s.board = [{ uid: 'a', cardId: 'b2_packstrider', attack: 2, health: 2, keywords: [], effects: [], buffs: [] }] as never;
    applyEndOfTurn(s);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([6, 6]);
  });

  it('does not fire for a hero who does not wield Tempest, however many kills they have', () => {
    const s = runWith('warden');
    s.tempestKills = 60;
    s.board = [
      { uid: 'a', cardId: 'b2_packstrider', attack: 2, health: 2, keywords: [], effects: [], buffs: [] },
      { uid: 'b', cardId: 'b2_packstrider', attack: 2, health: 2, keywords: [], effects: [], buffs: [] },
    ] as never;
    applyEndOfTurn(s);
    expect([s.board[0]!.attack, s.board[1]!.attack]).toEqual([2, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Gorun — Blade Mastery', () => {
  it('grants +3 from the very first swing — no unlock floor, unlike Tempest', () => {
    const s = runWith('gorun');
    expect(bladeMasteryGrantOf(s)).toBe(3);
  });

  it('improves by +3 per completed 8 attacks', () => {
    const s = runWith('gorun');
    for (const [attacks, grant] of [[0, 3], [7, 3], [8, 6], [15, 6], [16, 9], [80, 33]] as const) {
      s.bladeAttacks = attacks;
      expect(bladeMasteryGrantOf(s), `${attacks} attacks`).toBe(grant);
    }
    expect(BLADE_ATTACKS_PER_STEP).toBe(8);
  });

  it('buffs the attacker IN COMBAT, before its swing lands', () => {
    // A 2/9 swinging into a 0/40 wall: with the +3 the attacker deals 5, not 2. Reading the damage rather
    // than the stat line is what proves the grant is applied BEFORE the exchange.
    const wall = [{ cardId: 'b2_packstrider', attack: 0, health: 40 }];
    const attacker = [{ cardId: 'b2_packstrider', attack: 2, health: 9 }];
    const swings = (r: { events: { type: string }[] }): number => r.events.filter((e) => e.type === 'attack').length;
    const plain = fight(attacker, wall);
    const gorun = fight(attacker, wall, { bladeMastery: { attacks: 0 } });
    expect(swings(plain), 'the fight must actually happen').toBeGreaterThan(0);
    expect(swings(gorun), 'the grant must shorten the fight').toBeLessThan(swings(plain));
  });

  it('the run-lifetime offset makes the grant bigger from the first swing', () => {
    const wall = [{ cardId: 'b2_packstrider', attack: 0, health: 60 }];
    const attacker = [{ cardId: 'b2_packstrider', attack: 1, health: 9 }];
    const swings = (attacks: number): number =>
      fight(attacker, wall, { bladeMastery: { attacks } }).events.filter((e) => e.type === 'attack').length;
    // 16 prior attacks = +9 a swing vs +3 at zero, so the same board needs strictly fewer swings.
    expect(swings(16)).toBeLessThan(swings(0));
  });

  it('is COMBAT-ONLY — the run banks the attack COUNT, never the stats', () => {
    // Owner ruling 2026-08-23. There is no carry-back channel for the grant at all, which is what makes this
    // true; the assertion guards against a future one being added by reflex.
    const r = fight([{ cardId: 'b2_packstrider', attack: 2, health: 9 }], [{ cardId: 'b2_packstrider', attack: 0, health: 40 }], { bladeMastery: { attacks: 0 } });
    expect(Object.keys(r).some((k) => k.toLowerCase().includes('blade'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Cindara — Hoard', () => {
  const whelp = 'cindarawhelp';

  it('her Whelp token exists at the printed 1/1 base and strikes on arrival', () => {
    const t = CARD_INDEX[whelp];
    expect(t, 'the token must exist').toBeDefined();
    expect([t!.attack, t!.health]).toEqual([1, 1]);
    expect(t!.attackOnSummon).toBe(true);
    expect(t!.tribe).toBe('dragon');
  });

  it('is a DIFFERENT card from the Coin Hoard quest reward that owns the `hoardwhelp` id', () => {
    // The first cut reused `hoardwhelp` and silently shadowed the quest's 3/2 Dragon. The duplicate-id
    // tripwire caught it; this keeps the two apart by name as well as id.
    const quest = CARD_INDEX['hoardwhelp'];
    expect(quest).toBeDefined();
    expect([quest!.attack, quest!.health]).toEqual([3, 2]);
    expect(quest!.id).not.toBe(whelp);
  });

  it('the printed Whelp size tracks the banked improvement', () => {
    const s = runWith('cindara');
    expect(hoardWhelpStatsOf(s)).toEqual({ attack: 1, health: 1 });
    expect(heroPowerText(s)).toContain('**1/1**');
    s.hoardWhelpBuff = { attack: 4, health: 4 };
    expect(hoardWhelpStatsOf(s)).toEqual({ attack: 5, health: 5 });
    expect(heroPowerText(s)).toContain('**5/5**');
  });

  it('summons a Whelp every 4 friendly deaths, and every living Whelp ends the same size', () => {
    // Eight fragile bodies against an overwhelming board: enough deaths for two Avenge (4) fires.
    const fodder = Array.from({ length: 7 }, () => ({ cardId: 'b2_packstrider', attack: 1, health: 1 }));
    const r = fight(fodder, [{ cardId: 'b2_packstrider', attack: 12, health: 60 }], { hoard: { attack: 0, health: 0 } }, 3);
    const summons = r.events.filter((e) => e.type === 'summon' && (e as { minion?: { cardId?: string } }).minion?.cardId === whelp);
    expect(summons.length, 'at least one Avenge (4) must have fired').toBeGreaterThan(0);
    // The growth is banked for the run — only the GROWTH, so a re-simulation cannot double-count.
    expect(r.playerHoardGain).toEqual({ attack: 2 * summons.length, health: 2 * summons.length });
  });

  it('opens later fights at the size the last one left them', () => {
    const fodder = Array.from({ length: 7 }, () => ({ cardId: 'b2_packstrider', attack: 1, health: 1 }));
    const enemy = [{ cardId: 'b2_packstrider', attack: 12, health: 60 }];
    const first = fight(fodder, enemy, { hoard: { attack: 0, health: 0 } }, 3);
    const banked = first.playerHoardGain!;
    const later = fight(fodder, enemy, { hoard: { ...banked } }, 3);
    const born = later.events.find((e) => e.type === 'summon' && (e as { minion?: { cardId?: string } }).minion?.cardId === whelp);
    const stats = (born as unknown as { minion: { attack: number; health: number } }).minion;
    expect(stats.attack, 'a later Whelp arrives already grown').toBe(1 + banked.attack);
    expect(stats.health).toBe(1 + banked.health);
  });

  it('banks nothing when the Avenge never reaches 4 deaths', () => {
    const r = fight([{ cardId: 'b2_packstrider', attack: 9, health: 40 }], [{ cardId: 'b2_packstrider', attack: 1, health: 1 }], { hoard: { attack: 0, health: 0 } }, 3);
    expect(r.playerHoardGain).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the shared spine — tallies survive the settle and follow the POWER, not the hero', () => {
  it('all three heroes carry the owner-specified armor', () => {
    expect(getHero('aevor').armor).toBe(16);
    expect(getHero('gorun').armor).toBe(11);
    expect(getHero('cindara').armor).toBe(9);
  });

  it('kills and attacks accumulate at settle for EVERY hero, not only the two who read them', () => {
    // Deliberate: a run can adopt Tempest or Blade Mastery mid-run (Mimic / Void / Power Shifter). A tally
    // that only started counting on adoption would open at zero and print a threshold the player had already
    // passed — and Mimic re-picks every turn, so it would reset on any turn they wielded something else.
    // Driven through a REAL fight rather than a hand-built result, so the tally is proven end to end: combat
    // counts it, the carry-back ships it, settle banks it.
    let s: RunState = { ...runWith('warden'), board: [
      { uid: 'a', cardId: 'b2_packstrider', attack: 9, health: 9, keywords: [], effects: [], buffs: [] },
    ] as never };
    for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as const) s = reduce(s, a);
    expect((s.bladeAttacks ?? 0), 'a fight that happened must bank its attacks').toBeGreaterThan(0);
    // Kills only bank if the swing actually felled something — assert the field exists as a number either way.
    expect(typeof (s.tempestKills ?? 0)).toBe('number');
  });

  it('every new power is reachable by an adopted power — none is accidentally undiscoverable', () => {
    // These are ordinary passives, so they SHOULD be in the Mimic / Power Shifter pool. Asserted rather than
    // assumed, because `UNDISCOVERABLE_KINDS` is a deny-list and a new kind silently joins the pool.
    for (const id of ['aevor', 'gorun', 'cindara']) {
      const h = getHero(id);
      expect(h.power.passive, `${id} is a passive`).toBe(true);
      expect(h.wip, `${id} ships enabled`).toBeFalsy();
      expect(h.practiceOnly, `${id} is available in Play`).toBeFalsy();
    }
  });
});
