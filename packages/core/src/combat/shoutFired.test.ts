import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';

/**
 * A COMBAT SHOUT RE-FIRE IS A COUNTED EVENT (owner 2026-09-01).
 *
 * The owner's board: Cinderchef (Rally) · Dawnclaw (Echo: trigger an adjacent Shout) · gilded Wardkeeper
 * (Shout) · gilded Drakko (Shouts trigger three times) · Hawkus (a Rally triggers your left-most Echo).
 * Cinderchef's first swing → Hawkus fires Dawnclaw's Echo → Wardkeeper's Shout fires THREE times. The engine
 * always did that; the replay showed one, because each fire was an `sc` narration line — silent inside a
 * wind-up, one pulse per unit, three identical floats on one pixel. Every re-fire site now logs one `shout`
 * event PER FIRE through `fireShout`, so the multiplier reaches the signal the way a Rally's does.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, golden = false): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], golden } as unknown as BoardMinion);

const shouts = (events: readonly CombatEvent[]) => events.filter((e): e is Extract<CombatEvent, { type: 'shout' }> => e.type === 'shout');

const ownerBoard = () => [
  bm('d2_cinderchef', 'chef', 1, 3),
  bm('b2_dawnclaw', 'dawn', 5, 3),
  bm('dw_wardkeeper', 'ward', 12, 8, true),
  bm('drummer', 'drak', 4, 8, true),
  bm('b2_hawkus', 'hawk', 6, 9),
];
const fight = (board: BoardMinion[], seed = 1) => simulate(
  board, [bm('k_candleback', 'e1', 1, 30), bm('k_candleback', 'e2', 1, 30)],
  makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

describe('a combat Shout re-fire logs one counted `shout` event per fire', () => {
  it("the owner's board: Cinderchef's first swing fires Wardkeeper's Shout THREE times (gilded Drakko), each its own event", () => {
    const r = fight(ownerBoard());
    // `initial.player` keeps board order; the sim assigns its own uids (`sourceUid` is not carried).
    const [dawn, ward] = [r.initial.player[1]!.uid, r.initial.player[2]!.uid];
    const firstSwing = r.events.findIndex((e) => e.type === 'attack');
    const firstDamage = r.events.findIndex((e, i) => i > firstSwing && e.type === 'dmg');
    const inWindup = shouts(r.events.slice(firstSwing, firstDamage));
    expect(inWindup.map((e) => [e.source, e.target])).toEqual([[dawn, ward], [dawn, ward], [dawn, ward]]);
    // …and each fire narrates its OWN consequence right behind it, which is what the UI attributes per fire.
    for (const s of inWindup) {
      const i = r.events.indexOf(s);
      expect(r.events[i + 1], 'the fire\'s "+2/+0 Spell Power" line follows its shout event').toMatchObject({ type: 'sc', source: ward, text: '+2/+0 Spell Power' });
    }
    // The old narration line is GONE — the event replaced it, so nothing is presented twice.
    expect(r.events.some((e) => e.type === 'sc' && /triggers .*Battlecry/.test(e.text))).toBe(false);
  });

  it("Dawnclaw's real death fires the same three, and the fight carries +12 Spell Power back (2 chains × 3 × +2)", () => {
    const r = fight(ownerBoard());
    const dawn = r.initial.player[1]!.uid;
    const dawnDeath = r.events.findIndex((e) => e.type === 'death' && e.target === dawn);
    expect(dawnDeath).toBeGreaterThan(0);
    expect(shouts(r.events.slice(dawnDeath)).length).toBe(3);
    expect(shouts(r.events).length).toBe(6);
    expect((r as unknown as { playerSpellPower?: { attack: number } }).playerSpellPower).toEqual({ attack: 12, health: 0 });
  });

  it('a plain Drakko fires twice; no Drakko fires once — the event count IS the fire count', () => {
    const plain = ownerBoard(); plain[3] = bm('drummer', 'drak', 2, 4);
    const rPlain = fight(plain);
    const first = (r: ReturnType<typeof simulate>) => { const a = r.events.findIndex((e) => e.type === 'attack'); const d = r.events.findIndex((e, i) => i > a && e.type === 'dmg'); return shouts(r.events.slice(a, d)).length; };
    expect(first(rPlain)).toBe(2);
    const none = ownerBoard().filter((m) => m.sourceUid !== 'drak');
    expect(first(fight(none))).toBe(1);
  });

  it('no Shout beside Dawnclaw → no shout event (the Echo has nothing to re-fire)', () => {
    const r = fight([bm('d2_cinderchef', 'chef', 1, 3), bm('b2_dawnclaw', 'dawn', 5, 3), bm('d2_cinderchef', 'chef2', 1, 3), bm('b2_hawkus', 'hawk', 6, 9)]);
    expect(shouts(r.events)).toEqual([]);
  });
});
