// @vitest-environment jsdom
/**
 * R-DUOS-PASS-FLIGHT-01 (owner 2026-11-01): "anytime a card passes something like this, or like disco, show the passing
 * animation from the source card into the teammate's portrait, just like we do for handout. from the discover selection,
 * the card(s) that is passed should fire that animation".
 *
 * THE TRIGGER MAPPING: which on-screen element each kind of send streams from (`passFlightOf`, pure), and the element
 * that resolves to on the page (`passFlightEl`). Plus: each entry flies once (a network retry ships it again).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { passFlightEl, passFlightOf, playEntryFlight, type PassFlightEntry } from './passLob';

const team = (t: PassFlightEntry['team'], extra: Partial<PassFlightEntry> = {}): PassFlightEntry =>
  ({ card: { uid: 'team3', cardId: '__team' }, team: t, ...extra });

describe('passFlightOf: where each send starts', () => {
  it('Matchmaker: the passed pick streams from the Discover option it was picked from', () => {
    expect(passFlightOf({ card: { uid: 'b9', cardId: 'x' }, via: 'spell', src: { discover: 2 } })).toEqual({ at: 'discover', index: 2 });
  });

  it('Disco: each un-picked option streams from its own option card', () => {
    expect(passFlightOf(team({ kind: 'gift', cardId: 'a' }, { src: { discover: 0 } }))).toEqual({ at: 'discover', index: 0 });
    expect(passFlightOf(team({ kind: 'gift', cardId: 'c' }, { src: { discover: 2 } }))).toEqual({ at: 'discover', index: 2 });
  });

  it('Handout, CueBee, Salesman of the Year: the card itself leaves from where it stood', () => {
    expect(passFlightOf({ card: { uid: 's4', cardId: 'x' }, via: 'spell' })).toEqual({ at: 'card', uid: 's4', leaves: true, face: true });
    expect(passFlightOf({ card: { uid: 'b2', cardId: 'x' }, via: 'sale' })).toEqual({ at: 'card', uid: 'b2', leaves: true, face: true });
  });

  it('a card that sends and stays: the stream leaves it; its face dissolves only when the gift IS that card', () => {
    const cardIdOf = (uid: string): string | undefined => ({ mo: 'duo_monstrocity', an: 'duo_antsy' } as Record<string, string>)[uid];
    expect(passFlightOf(team({ kind: 'gift', cardId: 'duo_monstrocity' }, { src: { uid: 'mo' } }), null, cardIdOf))
      .toEqual({ at: 'card', uid: 'mo', leaves: false, face: true });
    expect(passFlightOf(team({ kind: 'gift', randomSpell: true }, { src: { uid: 'an' } }), null, cardIdOf))
      .toEqual({ at: 'card', uid: 'an', leaves: false, face: false });
    expect(passFlightOf(team({ kind: 'gold', amount: 3 } as never, { src: { uid: 'sw' } }))).toEqual({ at: 'card', uid: 'sw', leaves: false, face: false });
  });

  it('a rune\'s gift streams from its badge; Gold Gifter from the Equipment slot', () => {
    expect(passFlightOf(team({ kind: 'tripleReward' }, { src: { rune: 'rune_teammate_synergy' } }))).toEqual({ at: 'rune', id: 'rune_teammate_synergy' });
    expect(passFlightOf(team({ kind: 'gold' }, { src: { equip: 'gold_gifter' } }))).toEqual({ at: 'equip', id: 'gold_gifter' });
  });

  it('IN COMBAT: the unit the teamSend named; a rune meter\'s gift (no body) its rune', () => {
    expect(passFlightOf(team({ kind: 'gift', mateTribe: true } as never, { combatIdx: 0 }), 'u7')).toEqual({ at: 'unit', uid: 'u7', rune: null });
    expect(passFlightOf(team({ kind: 'gift', randomSpell: true }, { combatIdx: 1 }), null)).toEqual({ at: 'unit', uid: null, rune: 'rune_shoutful_bounty' });
    expect(passFlightOf(team({ kind: 'gift', randomMinion: true }, { combatIdx: 2 }), null)).toEqual({ at: 'unit', uid: null, rune: 'rune_echoing_results' });
  });

  it('nothing to fly: a drag pass (its drop played already) and a team effect that is not a card or Gold', () => {
    expect(passFlightOf({ card: { uid: 'h1', cardId: 'x' } })).toBeNull();
    for (const kind of ['maxGold', 'upgradeDiscount', 'catch', 'sold', 'listen', 'mateGild']) {
      expect(passFlightOf(team({ kind }, { src: { uid: 'x' } }))).toBeNull();
    }
  });

  it('a buff for the teammate streams too: Buddy System from its rune badge (Duos batch 2)', () => {
    expect(passFlightOf(team({ kind: 'buffLeftmost', attack: 3, health: 2, runeId: 'rune_buddy_system' } as never, { src: { rune: 'rune_buddy_system' } }))).toEqual({ at: 'rune', id: 'rune_buddy_system' });
  });
});

describe('passFlightEl: the element on the page', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('resolves each kind (Discover option by position, a card by uid, rune badge, Equipment slot, combat unit, hero)', () => {
    document.body.innerHTML = `
      <div class="discover-ov dce"><div class="disc-cards">
        <div class="disc-slot"><div class="card" id="o0"></div></div>
        <div class="disc-slot"><div class="card" id="o1"></div></div>
        <div class="disc-slot"><div class="card" id="o2"></div></div>
      </div></div>
      <div class="card" data-uid="mo" id="mo"></div>
      <div class="questbadges"><div class="runebadge" data-source-id="rune_shoutful_bounty" id="rb"></div></div>
      <div class="equipslot"><button class="heropowerbtn" id="eq"></button></div>
      <div class="unit" data-uid="u7" id="u7"></div>
      <div class="statusbar"><div class="hero"><div class="f" id="hero"></div></div></div>`;
    expect(passFlightEl({ at: 'discover', index: 1 })?.id).toBe('o1');
    expect(passFlightEl({ at: 'card', uid: 'mo', leaves: false, face: true })?.id).toBe('mo');
    expect(passFlightEl({ at: 'rune', id: 'rune_shoutful_bounty' })?.id).toBe('rb');
    expect(passFlightEl({ at: 'equip', id: 'gold_gifter' })?.id).toBe('eq');
    expect(passFlightEl({ at: 'unit', uid: 'u7', rune: null })?.id).toBe('u7');
    expect(passFlightEl({ at: 'unit', uid: 'gone', rune: 'rune_shoutful_bounty' })?.id).toBe('rb');
    expect(passFlightEl({ at: 'unit', uid: null, rune: null })?.id).toBe('hero');
  });

  it('a scouted or quest overlay is never mistaken for a Discover', () => {
    document.body.innerHTML = '<div class="discover-ov quest-ov"><div class="disc-cards"><div class="disc-slot"><div class="card"></div></div></div></div>';
    expect(passFlightEl({ at: 'discover', index: 0 })).toBeNull();
  });
});

describe('playEntryFlight', () => {
  it('flies an entry once (a retry ships it again, it streams once); a drag pass never', () => {
    const run = { seed: 77, hand: [], board: [], shop: [] };
    // No teammate portrait on the page: it resolves, finds no door, and is still counted as flown.
    const e = { seq: 0, wave: 1, card: { uid: 's4', cardId: 'x' }, via: 'spell' as const };
    playEntryFlight(e, run);
    expect(playEntryFlight(e, run)).toBe(false);
    expect(playEntryFlight({ seq: 1, wave: 1, card: { uid: 'h1', cardId: 'x' } }, run)).toBe(false);
  });
});
