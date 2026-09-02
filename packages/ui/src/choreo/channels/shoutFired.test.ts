import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { compileMoments } from '../compile';
import { buildBeats } from '../../combatBeats';
import { holdMsForKind } from '../choreoConfig';
import { shoutsAheadOf, shoutsFiredIn } from './shoutFired';

/**
 * The SHOUT-FIRED channel. What these pin, top to bottom: the per-event scan (pairs × count), the compiler
 * giving each fire its OWN moment with the consequences it produced (and the oracle agreeing), the swing that
 * caused the fires parking until its own strike, and each fire's moment holding real screen time.
 */
const attack = (attacker: string, defender: string): CombatEvent => ({ type: 'attack', attacker, defender, swing: 0 } as CombatEvent);
const shout = (source: string, target: string): CombatEvent => ({ type: 'shout', source, target } as CombatEvent);
const rally = (source: string, target: string): CombatEvent => ({ type: 'rally', source, target } as CombatEvent);
const sp = (source: string, text = '+2/+0 Spell Power'): CombatEvent => ({ type: 'sc', source, text } as CombatEvent);
const dmg = (target: string, source: string): CombatEvent => ({ type: 'dmg', target, amount: 1, remainingHp: 1, source } as CombatEvent);
const death = (target: string): CombatEvent => ({ type: 'death', target, side: 'player' } as CombatEvent);
const buff = (target: string): CombatEvent => ({ type: 'buff', target, attack: 1, health: 1, source: 's' } as CombatEvent);
const span = (start: number, end: number): Moment => ({ start, end } as unknown as Moment);

/** The owner's swing: Cinderchef attacks, Hawkus rallies Dawnclaw's Echo, Wardkeeper's Shout fires ×3 (gilded Drakko). */
const ownerSwing = (): CombatEvent[] => [
  attack('chef', 'e1'), buff('chef'), rally('hawk', 'dawn'),
  shout('dawn', 'ward'), sp('ward'), shout('dawn', 'ward'), sp('ward'), shout('dawn', 'ward'), sp('ward'),
  dmg('e1', 'chef'), dmg('chef', 'e1'),
];

describe('shoutsFiredIn', () => {
  it('counts the fires of one source→target pair', () => {
    const ev = ownerSwing();
    expect(shoutsFiredIn(span(0, ev.length), ev)).toEqual([{ source: 'dawn', target: 'ward', count: 3 }]);
  });

  it('keeps distinct pairs apart, in order of first appearance (Ryme: both neighbours)', () => {
    const ev = [shout('ryme', 'left'), shout('ryme', 'right'), shout('ryme', 'left')];
    expect(shoutsFiredIn(span(0, 3), ev).map((f) => [f.source, f.target, f.count])).toEqual([['ryme', 'left', 2], ['ryme', 'right', 1]]);
  });

  it('returns nothing for a moment with no re-fire, and ignores events outside the span', () => {
    expect(shoutsFiredIn(span(0, 2), [buff('a'), buff('b')])).toEqual([]);
    expect(shoutsFiredIn(span(0, 3), ownerSwing())).toEqual([]);
  });
});

describe('each fire is its own moment', () => {
  it('the swing keeps its Rally; every fire (with its narration) is a moment of its own; then the results', () => {
    const ev = ownerSwing();
    expect(compileMoments(ev).map((m) => [m.kind, m.start, m.end])).toEqual([
      ['attackExchange', 0, 3], ['shout', 3, 5], ['shout', 5, 7], ['shout', 7, 9], ['damage', 9, 11],
    ]);
  });

  it('a fire owns the consequences behind it — a buff wave, a card, a Ruby — until the next fire', () => {
    const ev = [shout('dawn', 'ward'), buff('a'), buff('b'), sp('ward'), shout('dawn', 'ward'), buff('a'), dmg('x', 'y')];
    expect(compileMoments(ev).map((m) => [m.kind, m.start, m.end])).toEqual([['shout', 0, 4], ['shout', 4, 6], ['damage', 6, 7]]);
  });

  it('…and the equivalence oracle agrees on both', () => {
    for (const ev of [ownerSwing(), [shout('d', 'w'), buff('a'), sp('w'), shout('d', 'w'), buff('a'), dmg('x', 'y')]]) {
      expect(buildBeats(ev).map((b) => [b.start, b.end])).toEqual(compileMoments(ev).map((m) => [m.start, m.end]));
    }
  });

  it('on the death path too (Dawnclaw dying): the death, then one moment per fire', () => {
    const ev = [dmg('dawn', 'e1'), death('dawn'), shout('dawn', 'ward'), sp('ward'), shout('dawn', 'ward'), sp('ward')];
    expect(compileMoments(ev).map((m) => m.kind)).toEqual(['damage', 'shout', 'shout']);
  });

  it("a fire's moment holds real screen time — enough for its number to roll", () => {
    expect(holdMsForKind('shout')).toBeGreaterThanOrEqual(650);
  });
});

describe('the swing that caused the fires parks until its own strike', () => {
  const exchange = (ev: CombatEvent[]): Moment => compileMoments(ev)[0]!;

  it('fires ahead of the attacker\'s own damage → park', () => {
    const ev = ownerSwing();
    expect(shoutsAheadOf(exchange(ev), ev, 'chef')).toBe(true);
  });

  it('no fire → no park; a fire AFTER the strike (the defender\'s Deathrattle re-firing a Shout) → no park', () => {
    const plain = [attack('a', 'b'), buff('a'), dmg('b', 'a'), dmg('a', 'b')];
    expect(shoutsAheadOf(exchange(plain), plain, 'a')).toBe(false);
    const after = [attack('a', 'b'), dmg('b', 'a'), death('b'), shout('b', 'c'), sp('c')];
    expect(shoutsAheadOf(exchange(after), after, 'a')).toBe(false);
  });

  it('a cancelled swing (the next attack comes first) does not park either', () => {
    const ev = [attack('a', 'b'), rally('h', 'd'), attack('c', 'b'), shout('d', 'w')];
    expect(shoutsAheadOf(exchange(ev), ev, 'a')).toBe(false);
    expect(shoutsAheadOf(exchange(ev), ev, null)).toBe(false);
  });

  it('the replay asks this question where it decides to park (source pin)', () => {
    const replay = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../useCombatReplay.ts'), 'utf8');
    const i = replay.indexOf('let heldWindup = false;');
    expect(i).toBeGreaterThan(-1);
    expect(replay.slice(i, i + 1400).includes('shoutsAheadOf(cur, events, atkUid)'), 'a Shout re-fire ahead of the strike must park the swing').toBe(true);
  });
});

describe('the parked strike lands like a normal swing (source pins)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const engine = readFileSync(join(here, '../engine.ts'), 'utf8');
  const replay = readFileSync(join(here, '../../useCombatReplay.ts'), 'utf8');

  it("a held wind-up's contact fires the late-bound release, not a no-op", () => {
    expect(engine.includes("onContact: ctx.holdAfterWindup === true ? () => ctx.onParkedContact?.() : () => ctx.advance()"),
      'the resumed strike must be able to advance the clock at its real contact').toBe(true);
  });

  it('the beat clock resumes the strike itself and lets contact advance into the damage beat', () => {
    const i = replay.indexOf('if (parkedCommitLead(next, events) > 0 && held && !held.resumed) {');
    expect(i, 'the clock owns the resume').toBeGreaterThan(-1);
    const block = replay.slice(i, i + 1200);
    expect(block.includes('parkedContactRef.current = go'), 'contact is bound to the advance at resume time').toBe(true);
    expect(block.includes('h.tl.play()'), 'the held timeline is resumed from the clock, after the stillness').toBe(true);
    expect(block.includes('PARKED_RESUME_FALLBACK_MS'), 'a dead timeline can never stall the fight').toBe(true);
  });

  it('the layout-effect release no longer double-plays a strike the clock already resumed', () => {
    expect(replay.includes('if (held.resumed && (struck || died)) {')).toBe(true);
  });
});
