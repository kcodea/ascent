import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * SET 2 — the 2026-08-18 Echo-trigger pair (Hawkus / Spots) and the random-Beast summon TIER CAP
 * (Bullseye / Menagerie Mammoth). Combat cases drive `simulate`; a `rally` event is one Echo proc (the same
 * observable cue the Echohorn Stag tests count).
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const bm = (cardId: string, uid: string, attack = 0, health = 400, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });
const run = (p: BoardMinion[], e: BoardMinion[], tier = 6, seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier, tribes: ALL_TRIBES }), combatSide({ tier }));
const procsFrom = (r: ReturnType<typeof simulate>, cardId: string) => {
  const uid = r.initial.player.find((m) => m.cardId === cardId)?.uid;
  return r.events.filter((e) => e.type === 'rally' && (e as { source: string }).source === uid).length;
};

describe('set 2 — Hawkus: any friendly Rally triggers your left-most Echo', () => {
  it('a Rally swing (an RL minion attacking) fires Hawkus; the left-most Echo procs', () => {
    // `spore` is a plain Echo body (its Deathrattle buffs friends — what it does is irrelevant, it just has to
    // BE the left-most Echo). The attacker is a wall GIVEN the Rally keyword, so its swing is a Rally.
    const r = run(
      [bm('spore', 'E', 0, 400), bm('b2_hawkus', 'H', 0, 400), bm('sandbag', 'A', 4, 400, ['RL'])],
      [bm('sandbag', 'W', 0, 40000)],
    );
    expect(procsFrom(r, 'b2_hawkus'), 'Hawkus fired on the Rally swings').toBeGreaterThan(0);
  });

  it('a PLAIN swing (no Rally keyword) never fires Hawkus', () => {
    const r = run(
      [bm('spore', 'E', 0, 400), bm('b2_hawkus', 'H', 0, 400), bm('sandbag', 'A', 4, 400)], // attacker has NO RL
      [bm('sandbag', 'W', 0, 40000)],
    );
    expect(procsFrom(r, 'b2_hawkus'), 'an ordinary swing is not a Rally').toBe(0);
  });
});

describe('set 2 — Spots: Start of Combat triggers your 2 left-most Echoes', () => {
  it('fires exactly the two left-most Echoes once each at Start of Combat', () => {
    // Three Echo bodies + Spots. Only the two LEFT-MOST should proc — so exactly 2 rally cues from Spots.
    const r = run(
      [bm('spore', 'E1', 0, 400), bm('spore', 'E2', 0, 400), bm('spore', 'E3', 0, 400), bm('b2_spots', 'S', 0, 400)],
      [bm('sandbag', 'W', 0, 40000)],
    );
    expect(procsFrom(r, 'b2_spots'), 'the 2 left-most Echoes each triggered once').toBe(2);
  });
});

describe('set 2 — random-Beast summons are capped at the summoner’s tier (owner fix)', () => {
  const summonedTiers = (r: ReturnType<typeof simulate>): number[] =>
    r.events
      .filter((e) => e.type === 'summon' && (e as { side: string }).side === 'player')
      .map((e) => CARD_INDEX[(e as { minion: { cardId: string } }).minion.cardId]?.tier ?? 0);

  it('Menagerie Mammoth at Tier 2 summons only Tier ≤ 2 Beasts', () => {
    const r = run([bm('b2_mammoth', 'M', 0, 1)], [bm('sandbag', 'W', 10, 400)], 2);
    const tiers = summonedTiers(r);
    expect(tiers.length, 'the Echo summoned some Beasts').toBeGreaterThan(0);
    expect(tiers.every((t) => t <= 2), `every summon must be Tier ≤ 2 — saw ${tiers.join(',')}`).toBe(true);
  });

  it('Bullseye at Tier 3 summons only a Tier ≤ 3 Beast', () => {
    const r = run([bm('b2_bullseye', 'B', 0, 1)], [bm('sandbag', 'W', 10, 400)], 3);
    const tiers = summonedTiers(r);
    expect(tiers.length, 'the Echo summoned a Beast').toBeGreaterThan(0);
    expect(tiers.every((t) => t <= 3), `every summon must be Tier ≤ 3 — saw ${tiers.join(',')}`).toBe(true);
  });
});
