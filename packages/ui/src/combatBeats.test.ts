import { describe, expect, it } from 'vitest';
import { makeRng, simulate, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { buildBeats, attackerOfImpact } from './combatBeats';

describe('buildBeats', () => {
  it('a REAL exchange shows dealt + taken damage in the SAME impact beat — even through a Deathrattle kill', () => {
    // End-to-end lock-in for the simultaneous-exchange rule (owner ruling 2026-07-02): the engine logs the
    // clash as [attack · dmg defender · dmg attacker · death …], so the beat grouper folds BOTH damage
    // numbers (and the death pop) into one impact frame; the rattle's summons follow in later beats.
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'sandbag', attack: 0, health: 5 }],
      [{ cardId: 'pack', attack: 2, health: 2 }], // Mama Pup — Deathrattle summons 2 Pups
      makeRng(3), CARD_INDEX,
    );
    const strayUid = r.initial.player[0]!.uid;
    const packUid = r.initial.enemy[0]!.uid;
    const beats = buildBeats(r.events);
    const beatOf = (pred: (e: CombatEvent) => boolean): number =>
      beats.findIndex((b) => r.events.slice(b.start, b.end).some(pred));
    const dealt = beatOf((e) => e.type === 'dmg' && e.target === packUid);
    const taken = beatOf((e) => e.type === 'dmg' && e.target === strayUid);
    const death = beatOf((e) => e.type === 'death' && e.target === packUid);
    const summon = beatOf((e) => e.type === 'summon' && e.minion.cardId === 'pup');
    expect(dealt).toBeGreaterThanOrEqual(0);
    expect(taken).toBe(dealt); // both damage numbers rise in the same frame
    expect(death).toBe(dealt); // the death pop lands with them
    expect(summon).toBeGreaterThan(dealt); // the rattle's tokens follow after the impact
  });

  it('attackerOfImpact resolves the clash attacker from the wind-up beat (a REAL exchange)', () => {
    // Regression: an attack's damage lands in the beat AFTER the attack, so the attacker must be read from
    // the PREVIOUS (wind-up) beat — not the impact beat, which holds no `attack` event. Both units survive
    // the first clash here, so BOTH take an in-unit damage number; only the attacked one should keep it.
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'sandbag', attack: 2, health: 8 }], // attack>0 so it retaliates; health high enough to live
      makeRng(3), CARD_INDEX,
    );
    const beats = buildBeats(r.events);
    const attackIdx = beats.findIndex((b) => b.primary.type === 'attack');
    const impactIdx = attackIdx + 1;
    const atk = beats[attackIdx]!.primary as Extract<CombatEvent, { type: 'attack' }>;
    const dmgTargets = r.events
      .slice(beats[impactIdx]!.start, beats[impactIdx]!.end)
      .filter((e): e is Extract<CombatEvent, { type: 'dmg' }> => e.type === 'dmg')
      .map((e) => e.target);
    expect(dmgTargets).toContain(atk.attacker); // attacker took retaliation …
    expect(dmgTargets).toContain(atk.defender); // … and the defender took the hit (both in ONE impact beat)
    const attacker = attackerOfImpact(beats, impactIdx);
    expect(attacker).toBe(atk.attacker);
    const shown = dmgTargets.filter((t) => t !== attacker); // apply the suppression rule
    expect(shown).not.toContain(atk.attacker); // the attacker's number is gone …
    expect(shown).toContain(atk.defender); // … only the attacked unit's number survives
  });

  it('attackerOfImpact is null for non-attack damage (SC cast) — those floats are not suppressed', () => {
    const ev: CombatEvent[] = [
      { type: 'sc', source: 'a', text: 'scorch' },
      { type: 'dmg', target: 'b', amount: 1, remainingHp: 4 },
    ];
    const beats = buildBeats(ev);
    expect(attackerOfImpact(beats, 1)).toBeNull(); // impact preceded by an `sc`, not an `attack`
  });

  it('a mid-cascade keyword grant (Mumi → Rise) rides the impact beat — it never splits the result run', () => {
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'mumi', defender: 'wall', swing: 0 },
      { type: 'dmg', target: 'wall', amount: 5, remainingHp: 35 },
      { type: 'dmg', target: 'mumi', amount: 10, remainingHp: 0 }, // retaliation kills Mumi
      { type: 'death', target: 'mumi', side: 'player' },
      { type: 'keyword', target: 'knit', keyword: 'R', source: 'mumi' }, // the rattle's grant
    ];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2); // wind-up + ONE impact beat holding dmg+dmg+death+keyword together
    expect(beats[1]).toEqual({ start: 1, end: 5, primary: ev[1] });
  });

  it('a plain attack → wind-up beat, then the impact (damage) beat', () => {
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 2 },
      { type: 'dmg', target: 'a', amount: 2, remainingHp: 5 }, // retaliation
    ];
    const beats = buildBeats(ev);
    expect(beats).toEqual([
      { start: 0, end: 1, primary: ev[0] }, // wind-up (the attack)
      { start: 1, end: 3, primary: ev[1] }, // impact: both dmg together
    ]);
  });

  it('an on-attack buff is absorbed into the wind-up, so the damage still lands in the next beat (at connection)', () => {
    // The sim emits: attack → Better Bot buffs another mech → THEN the damage. The buff must not push the
    // damage into a later beat — it rides in the wind-up; the impact beat is still the very next one.
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
      { type: 'buff', target: 'c', attack: 1, health: 0, source: 'a' },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 2 },
      { type: 'dmg', target: 'a', amount: 2, remainingHp: 5 },
    ];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2);
    expect(beats[0]).toEqual({ start: 0, end: 2, primary: ev[0] }); // attack + buff = the wind-up
    expect(beats[1]).toEqual({ start: 2, end: 4, primary: ev[2] }); // impact: the next beat (connection)
  });

  it('absorbs a run of on-attack flashes (rally + summon + buff) into the wind-up', () => {
    const ev: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
      { type: 'rally', source: 'a', target: 'd' },
      { type: 'summon', minion: { uid: 't', cardId: 'fred', name: 'Fodder', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false }, side: 'player', index: 1 },
      { type: 'buff', target: 'c', attack: 1, health: 1, source: 'a' },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 0 },
      { type: 'death', target: 'b', side: 'enemy' },
    ];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2);
    expect(beats[0]).toEqual({ start: 0, end: 4, primary: ev[0] }); // attack + rally + summon + buff
    expect(beats[1]).toEqual({ start: 4, end: 6, primary: ev[4] }); // dmg + death together at connection
  });

  it('a standalone buff run (no preceding attack) still gets its own beat', () => {
    const ev: CombatEvent[] = [
      { type: 'buff', target: 'a', attack: 2, health: 2, source: 's' },
      { type: 'buff', target: 'b', attack: 2, health: 2, source: 's' },
      { type: 'dmg', target: 'a', amount: 1, remainingHp: 4 },
    ];
    const beats = buildBeats(ev);
    expect(beats).toEqual([
      { start: 0, end: 2, primary: ev[0] }, // the two buffs land together
      { start: 2, end: 3, primary: ev[2] },
    ]);
  });

  it('Start-of-Combat cast is its own beat; its damage is the next beat', () => {
    const ev: CombatEvent[] = [
      { type: 'sc', source: 'a', text: 'Ember Whelp scorches the front line' },
      { type: 'dmg', target: 'b', amount: 1, remainingHp: 4 },
    ];
    const beats = buildBeats(ev);
    expect(beats).toEqual([
      { start: 0, end: 1, primary: ev[0] },
      { start: 1, end: 2, primary: ev[1] },
    ]);
  });
});
