/**
 * R-FX-ANCIENT-ORIGIN-01 (owner rulings 2026-11-17): where each Bonds pairing's grant VISIBLY starts, on top of the shared
 * hero-power tag (R-FX-ANCIENT-TENDRIL-01). "frank should tendril from the minion, drakko should just show a self buff on
 * drakkos themselves, warden should go from the minion as well, albus goes from hero power, this should show tendrils
 * from the minion that was buffed" (Midas). Drives the real reducer / simulator and asserts the exact body each grant
 * leaves, in the Shop and in combat. The broad sweeps (every pairing honours the table) live in ancientTendrilsShop /
 * ancientTendrilsCombat.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import { ANCIENT_GRANT_ORIGIN, DRAKKO_CARD_ID, ancientGrantOrigin, reduce, type BoardCard } from '@game/sim';
import { body, combatVerdict, foes, pickedRun, shopRun, shopStep } from './ancientTendrils.testkit';
import { groupBuffCasts } from './choreo/channels/buffCast';
import { groupSelfBuffs } from './choreo/channels/buffSelf';
import type { Moment } from './choreo/compile';

const gilded = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return body(uid, cardId, { golden: true, attack: d.attack * 2, health: d.health * 2, ...over });
};
const pup = (uid: string, cardId: string, attack: number, health: number, keywords: BoardCard['keywords'] = []): BoardCard =>
  body(uid, cardId, { attack, health, keywords });

describe('R-FX-ANCIENT-ORIGIN-01: the per-pairing origin table', () => {
  it('pins the owner rulings', () => {
    expect(ancientGrantOrigin('frank', 'bonds')).toBe('trigger');
    expect(ancientGrantOrigin('warden', 'bonds')).toBe('trigger');
    expect(ancientGrantOrigin('midas', 'bonds')).toBe('trigger');
    expect(ancientGrantOrigin('drakko', 'bonds')).toBe('self');
    expect(ancientGrantOrigin('albus', 'bonds')).toBe('hero');
  });
  it('every other pairing keeps the hero-power button', () => {
    expect(ancientGrantOrigin('warden', 'time')).toBe('hero');
    expect(ancientGrantOrigin('hunch', 'bonds')).toBe('hero');
    expect(ancientGrantOrigin('drakko', undefined)).toBe('hero');
    expect(Object.keys(ANCIENT_GRANT_ORIGIN).sort()).toEqual(['albus', 'drakko', 'frank', 'midas', 'warden']);
  });
});

describe('R-FX-ANCIENT-ORIGIN-01: Shop', () => {
  it('Frank x Bonds: the tendril leaves the sold Clearance minion slot', () => {
    let s = pickedRun('frank', 'bonds', { board: [body('x', 'hm_test_squire', { attack: 1, health: 1 })] });
    s = reduce(s, { type: 'heroPower' });
    const o = s.shop.find((x) => { const d = CARD_INDEX[x.cardId]; return !!d && !d.spell && !d.ruby && !x.starform; })!;
    s = reduce(s, { type: 'buy', uid: o.uid });
    const sold = s.hand[s.hand.length - 1]!.uid;
    s = reduce(s, { type: 'play', uid: sold });
    const { next, verdict } = shopStep(s, { type: 'sell', uid: sold });
    expect(verdict.origins).toEqual([`x:trigger:${sold}`]);
    expect(next.recruitBuffFx).toEqual([expect.objectContaining({ sourceUid: sold, targetUid: 'x', kind: 'deathrattle' })]);
    expect(next.recruitBuffFx.some((r) => r.fromHeroPower)).toBe(false);
  });
  it('Warden x Bonds: the tendril leaves the Ward minion that gained stats', () => {
    const v = shopRun(pickedRun('warden', 'bonds', {
      board: [pup('a', 'hm_test_squire', 1, 5, ['DS']), pup('b', 'shaper', 1, 5, ['DS']), pup('c', 'beetle', 1, 5)],
    }), [{ type: 'heroPower', uid: 'c' }]).verdict;
    expect(v.grants.length).toBeGreaterThan(0);
    // Each recipient's tendril starts at the OTHER Warded minion, the one whose gain set it off.
    for (const o of v.origins) expect(o).toMatch(/^(a:trigger:b|b:trigger:a)$/);
  });
  it('Midas x Bonds: the tendril leaves the Gilded minion whose gain set it off', () => {
    const v = shopRun(pickedRun('midas', 'bonds', {
      embers: 20, heroReady: true, board: [gilded('a', 'beatboxer'), gilded('b', 'dw_edward'), body('p', 'sandbag')], hand: [body('sf', 'spiritfire')],
    }), [{ type: 'play', uid: 'sf', targetUid: 'a' }]).verdict;
    expect(v.origins).toEqual(['b:trigger:a']);
  });
  it('Drakko x Bonds: no tendril, the Drakko plays its self-buff', () => {
    const { s, verdict } = shopRun(pickedRun('drakko', 'bonds', {
      embers: 99, board: [body('d', DRAKKO_CARD_ID)], hand: [body('h', 'hoarder')],
    }), [{ type: 'play', uid: 'h' }]);
    expect(verdict.origins).toEqual(['d:self']);
    // No record targets the Drakko, so Recruit.tsx's stat-diff plays the self-buff burst on it.
    expect(s.recruitBuffFx.filter((r) => r.targetUid === 'd')).toEqual([]);
  });
  it('Albus x Bonds: stays on the hero-power button', () => {
    const v = shopRun(pickedRun('albus', 'bonds', {
      board: [body('a', 'hm_test_squire'), body('b', 'n2_spellsword'), body('c', 'tara'), body('d', 'dw_brakka')], hand: [body('h', 'c3_binary')],
    }), [{ type: 'play', uid: 'h' }]).verdict;
    expect(v.grants.length).toBeGreaterThan(0);
    expect(v.origins.every((o) => o.endsWith(':hero'))).toBe(true);
  });
});

/** The whole fight as one moment, through the two stock groupers the combat score uses. */
const whole = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length } as Moment);

describe('R-FX-ANCIENT-ORIGIN-01: combat', () => {
  it('Warden x Bonds: each grant streams from the Ward minion that gained stats', () => {
    const { s, verdict } = combatVerdict(pickedRun('warden', 'bonds', {
      board: [body('t', 'taragosa', { health: 900, keywords: ['DS'] }), pup('a', 'hm_test_squire', 1, 900, ['DS']), pup('b', 'hm_test_squire', 1, 900, ['DS'])],
    }), foes(1, 0, 400));
    expect(verdict.grants).toBeGreaterThan(0);
    expect(verdict.missing).toEqual([]);
    expect(verdict.origins.every((o) => o.startsWith('trigger:'))).toBe(true);
    const ev = s.lastCombat!.events as CombatEvent[];
    const casts = groupBuffCasts(whole(ev), ev);
    // The tendril channel carries the trigger body as the cast's source (a unit, never the label).
    const units = new Set(s.lastCombat!.initial.player.map((m) => m.uid));
    expect(casts.some((c) => units.has(c.source) && c.source !== c.target)).toBe(true);
    expect(casts.some((c) => c.source === 'Aegis')).toBe(false);
  });
  it('Midas x Bonds: each grant streams from the Gilded minion that gained stats', () => {
    const v = combatVerdict(pickedRun('midas', 'bonds', {
      board: [body('a', 'beatboxer', { golden: true, health: 300 }), body('b', 'dw_edward', { golden: true, health: 300 }), body('t', 'taragosa', { golden: true, health: 900 })],
    }), foes(1, 0, 400)).verdict;
    expect(v.grants).toBeGreaterThan(0);
    expect(v.missing).toEqual([]);
    for (const o of v.origins) {
      const [, target, from] = o.split(':');
      expect(from).not.toBe(target);
    }
  });
  it('Drakko x Bonds: each grant is the Drakko own self-buff, no tendril', () => {
    const { s, verdict } = combatVerdict(pickedRun('drakko', 'bonds', {
      board: [body('d', 'drummer', { health: 90 }), body('a', 'alley', { health: 90 }), body('r', 'ryme', { attack: 1, health: 1, keywords: ['T'] })],
    }), foes(1, 3, 200));
    expect(verdict.grants).toBeGreaterThan(0);
    expect(verdict.missing).toEqual([]);
    expect(verdict.origins.every((o) => o.startsWith('self:'))).toBe(true);
    const ev = s.lastCombat!.events as CombatEvent[];
    const stamped = ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.from !== undefined);
    expect(stamped.length).toBe(verdict.grants);
    const drakkos = new Set(stamped.map((e) => e.target));
    expect(groupBuffCasts(whole(ev), ev).some((c) => drakkos.has(c.target) && c.source === 'Ancient of Bonds')).toBe(false);
    expect(groupSelfBuffs(whole(ev), ev).some((b) => drakkos.has(b.uid))).toBe(true);
  });
});
