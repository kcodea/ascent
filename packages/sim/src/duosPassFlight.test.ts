/**
 * R-DUOS-PASS-FLIGHT-01 (owner 2026-11-01): "anytime a card passes something like this, or like disco, show the passing
 * animation from the source card into the teammate's portrait, just like we do for handout. from the discover selection,
 * the card(s) that is passed should fire that animation".
 *
 * The engine half: every outbox entry an effect queues carries a PRESENTATION-ONLY `src` naming what sent it on the
 * sender's screen (a Discover option, the card, a rune, the Equipment slot), so the UI streams it from there. Gameplay
 * never reads it and the wire never carries it.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { reduce } from './reducer';
import { type BoardCard, type RunState } from './state';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosWireOf, queueTeamEffect, stampOutboxSrc } from './duosPass';
import { duosOnTripleReward } from './duosRunes';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}
function seat(over: Partial<RunState> = {}, seed = 11): RunState {
  const run = createVersusRun(seed, 'warden', 'set2', DUOS);
  return { ...run, hand: [], board: [], embers: 10, ...over };
}

describe('R-DUOS-PASS-FLIGHT-01: every effect send names its source on screen', () => {
  it('Disco: each option I did not take streams from ITS option card', () => {
    let ann = reduce(seat({ hand: [card('duo_disco', 'd1')] }), { type: 'play', uid: 'd1' });
    ann = reduce(ann, { type: 'discover', index: 1 });
    expect(ann.duos!.outbox.map((e) => e.src)).toEqual([{ discover: 0 }, { discover: 2 }]);
  });

  it('Matchmaker: the passed pick streams from the option I picked', () => {
    let ann = reduce(seat({ hand: [card('duo_matchmaker', 'mm')] }), { type: 'play', uid: 'mm' });
    const last = ann.discover!.length - 1;
    ann = reduce(ann, { type: 'discover', index: last });
    expect(ann.duos!.outbox[0]).toMatchObject({ via: 'spell', src: { discover: last } });
  });

  it('Monstrocity: bought, the copy streams from the bought card; Discovered, from the option', () => {
    const run = seat();
    const bought = reduce({ ...run, shop: [{ uid: 'mo', cardId: 'duo_monstrocity' }, ...run.shop.slice(1)] }, { type: 'buy', uid: 'mo' });
    expect(bought.duos!.outbox[0]!.src).toEqual({ uid: 'mo' });
    const found = reduce(seat({ discover: ['duo_monstrocity'] }), { type: 'discover', index: 0 });
    expect(found.duos!.outbox[0]!.src).toEqual({ discover: 0 });
  });

  it('a spell played from hand (Share the Wealth) streams from the spell card', () => {
    const ann = reduce(seat({ hand: [card('duo_sharewealth', 's1')] }), { type: 'play', uid: 's1' });
    const sends = ann.duos!.outbox.filter((e) => e.team?.kind === 'gift');
    expect(sends.length).toBeGreaterThan(0);
    for (const e of sends) expect(e.src).toEqual({ uid: 's1' });
  });

  it('CueBee\'s Pass leaves from where the minion stood (no src: the card itself)', () => {
    const [m] = [card(Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && !c.duos && c.effects.length === 0)!.id, 'm0')];
    const ann = reduce(seat({ hand: [card('duo_w_pass', 'p1')], board: [card('duo_cuebee', 'cb'), m!] }), { type: 'play', uid: 'p1', targetUid: 'm0' });
    const e = ann.duos!.outbox.at(-1)!;
    expect(e).toMatchObject({ via: 'spell', card: { uid: 'm0' } });
    expect(e.src).toBeUndefined();
  });

  it('a rune\'s gift names the rune (Teammate Synergy)', () => {
    const s = seat({ duos: { outbox: [], received: [], refused: [], runes: { synergyLeft: 1 } } });
    duosOnTripleReward(s, 3, false);
    expect(s.duos!.outbox[0]).toMatchObject({ team: { kind: 'tripleReward' }, src: { rune: 'rune_teammate_synergy' } });
  });

  it('`stampOutboxSrc` fills the new entries only; `force` re-stamps them (an Equipment press)', () => {
    const s = seat();
    queueTeamEffect(s, { kind: 'gold', amount: 3 }, undefined, { uid: 'old' });
    const from = s.duos!.outbox.length;
    queueTeamEffect(s, { kind: 'gold', amount: 3 });
    queueTeamEffect(s, { kind: 'gold', amount: 3 }, undefined, { uid: 'body' });
    stampOutboxSrc(s, from, { equip: 'gold_gifter' });
    expect(s.duos!.outbox.map((e) => e.src)).toEqual([{ uid: 'old' }, { equip: 'gold_gifter' }, { uid: 'body' }]);
    stampOutboxSrc(s, from, { equip: 'gold_gifter' }, true);
    expect(s.duos!.outbox.map((e) => e.src)).toEqual([{ uid: 'old' }, { equip: 'gold_gifter' }, { equip: 'gold_gifter' }]);
  });

  it('presentation only: the wire never carries it', () => {
    let ann = reduce(seat({ hand: [card('duo_disco', 'd1')] }), { type: 'play', uid: 'd1' });
    ann = reduce(ann, { type: 'discover', index: 0 });
    for (const e of ann.duos!.outbox) expect('src' in duosWireOf(e)).toBe(false);
  });
});
