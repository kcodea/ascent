import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { fightBodies, fightCardIds } from './fightRoster';
import { combatTimelineFrom } from './choreographer/combatTimeline';
import { combatCardIds } from './audio/phonePrewarm';
import { newCombatScan, scanCombat } from './announcerCombat';
import { attackerCosmeticOf } from './heroBlast/attackerCosmetic';

/**
 * R-DUOS-FX-01: the SECOND board in a Versus Duos tag-team fight plays every animation the first board does.
 *
 * Owner report 2026-11-02: "some animations arent playing in duos it seems like the second player's animations maybe
 * dont play". Root cause: the replay resolves each acting body (uid) to its card, side and name through maps built
 * from `initial` + `summon` events. The teammate's board enters on a `tagIn` event with fresh uids, so every lookup
 * missed it and every card-keyed FX decision (Deathrattle pulse, authored damage / Shout / watcher bindings, Rally and
 * Flurry wind-ups, trigger pulses, the choreographer's card identity, phone audio prewarm) skipped board 2.
 *
 * Proven on a real tag-team `simulate`: the same cards on board 1 and board 2 resolve to the same card ids and sides,
 * and the compiled choreographer timeline names the same cards for both boards' beats.
 */
const body = (cardId: string, tag: string, i: number): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, sourceUid: `${tag}${i}` });
const SAME = ['pack', 'manasaber', 'stray'];

/** My board, then my teammate's identical board, against one wall that wipes both. */
function tagTeamFight(reserveCards: readonly string[] = SAME): CombatResult {
  const mine = SAME.map((c, i) => body(c, 'a', i));
  const mate = reserveCards.map((c, i) => body(c, 'b', i));
  const wall: BoardMinion[] = [{ cardId: 'stray', attack: 200, health: 5000, sourceUid: 'w0' }];
  return simulate(mine, wall, makeRng(7), CARD_INDEX, combatSide(), combatSide(), {
    reserve: { player: { board: mate, state: combatSide() } },
  });
}

const actorsOf = (e: CombatEvent): string[] => {
  const r = e as { source?: string; target?: string; attacker?: string; defender?: string };
  return [r.source, r.target, r.attacker, r.defender].filter((x): x is string => typeof x === 'string' && /^m\d+$/.test(x));
};

describe('R-DUOS-FX-01: the second Duos board resolves like the first', () => {
  it('the fight really tags in (the precondition every assertion below rests on)', () => {
    const r = tagTeamFight();
    expect(r.events.some((e) => e.type === 'tagIn' && e.side === 'player')).toBe(true);
  });

  it('every body that acts in the fight resolves to a card and a side, board 2 included', () => {
    const r = tagTeamFight();
    const known = new Map(fightBodies(r).map((b) => [b.uid, b]));
    const tagIn = r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn')!;
    for (const m of tagIn.minions) {
      expect(known.get(m.uid)?.cardId).toBe(m.cardId);
      expect(known.get(m.uid)?.side).toBe('player');
    }
    for (const e of r.events) for (const uid of actorsOf(e)) expect(known.has(uid), `${e.type} names ${uid}`).toBe(true);
  });

  it('board 2 resolves the same card ids as board 1 (same cards, same Deathrattle decisions)', () => {
    const r = tagTeamFight();
    const cards = fightCardIds(r);
    const tagIn = r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn')!;
    const board1 = r.initial.player.map((m) => cards.get(m.uid));
    const board2 = tagIn.minions.map((m) => cards.get(m.uid));
    expect(board2).toEqual(board1);
    // The Deathrattle medallion / Echo FX gate reads the card's onDeath effect through this map: the same deaths qualify.
    const hasDr = (uid: string): boolean => !!CARD_INDEX[cards.get(uid) ?? '']?.effects?.some((f) => f.on === 'onDeath');
    const b1 = new Set(r.initial.player.map((m) => m.uid));
    const b2 = new Set(tagIn.minions.map((m) => m.uid));
    const drDeaths = (set: Set<string>): number => r.events.filter((e) => e.type === 'death' && set.has(e.target) && hasDr(e.target)).length;
    expect(drDeaths(b1)).toBeGreaterThan(0);
    expect(drDeaths(b2)).toBe(drDeaths(b1));
  });

  it('the choreographer timeline names the card for board 2\'s beats exactly as for board 1\'s', () => {
    const r = tagTeamFight();
    const tl = combatTimelineFrom(r)!;
    const tagIn = r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn')!;
    const byUid = new Map([...r.initial.player, ...tagIn.minions].map((m) => [m.uid, m.cardId]));
    const b1 = new Set(r.initial.player.map((m) => m.uid));
    const b2 = new Set(tagIn.minions.map((m) => m.uid));
    const beatsOf = (set: Set<string>) => tl.beats.filter((b) => b.source.uid && set.has(b.source.uid));
    const one = beatsOf(b1);
    const two = beatsOf(b2);
    expect(one.length).toBeGreaterThan(0);
    expect(two.length).toBeGreaterThan(0);
    // Each beat names its body's CARD, on both boards. Before the fix board 2's beats carried the bare uid (`m7`).
    for (const b of [...one, ...two]) expect(b.source.id).toBe(byUid.get(b.source.uid!));
    // The same card plays the same kinds of beat on either board (Mama Pup swings and is hit on both).
    const kinds = (bs: typeof one, card: string): string[] => [...new Set(bs.filter((b) => b.source.id === card).map((b) => b.trigger))].sort();
    expect(kinds(two, 'pack')).toEqual(kinds(one, 'pack'));
  });

  it('a board-2-only card is prewarmed for phone audio', () => {
    const r = tagTeamFight(['grim']);
    expect(combatCardIds(r)).toContain('grim');
  });

  it('the announcer counts board 2 as the player\'s', () => {
    const r = tagTeamFight();
    const tagIn = r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn')!;
    const scan = newCombatScan(r.initial);
    scanCombat(scan, r.events, r.events.indexOf(tagIn) + 1);
    for (const m of tagIn.minions) expect(scan.player.has(m.uid)).toBe(true);
  });

  it('the end-of-fight hero attack is the live board\'s player\'s attack, on both sides', () => {
    const lobby = {
      seats: [
        { id: 's0', cosmetics: { heroAttack: 'attack_mine' } },
        { id: 's1', cosmetics: { heroAttack: 'attack_mate' } },
        { id: 's3', cosmetics: { heroAttack: 'attack_foe2' } },
      ],
    } as never;
    const run = { cosmetics: { heroAttack: 'attack_mine' }, lobby } as never;
    // My teammate's board ended the fight on my side: THEIR attack plays (through "Show opponent cosmetics").
    expect(attackerCosmeticOf(run, 'player', true, 's1')).toBe('attack_mate');
    expect(attackerCosmeticOf(run, 'player', false, 's1')).toBeNull();
    // The foe team's second board ended it: that player's attack, not the forced opponent's.
    expect(attackerCosmeticOf(run, 'opp', true, 's3')).toBe('attack_foe2');
    // No hand-off: unchanged.
    expect(attackerCosmeticOf(run, 'player', true, null)).toBe('attack_mine');
  });
});
