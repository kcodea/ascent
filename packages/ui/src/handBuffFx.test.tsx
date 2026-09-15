// @vitest-environment jsdom
/**
 * HAND BUFF — the owner-authored `hand-buff` def plays on a HAND card whenever that card gets stronger
 * (owner ask 2026-09-15), for a MINION in hand gaining stats and for a SPELL / Ruby in hand whose printed
 * value rises. It replaced the CSS spell-buff grow/shrink + mote blast, which only ever covered spells/Rubies.
 *
 * Three contracts, each pinned:
 *   1. the SHOP fan-out (`diffHandBuffs`) names the minion whose stats rose and the spell whose text rose,
 *      and nothing else (a fresh card, an unchanged card, a minion whose text ticked without a stat gain);
 *   2. the COMBAT fan-out (`handBuffUidsIn`) names the player-side `handBuff` events of ONE beat, one per event;
 *   3. the play itself binds `hand-buff` to the hand card's own DOM element — anchored on it, carrying its uid
 *      for the def's `react` layer — one play PER card, cascaded, never one batched play.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CombatEvent } from '@game/core';

const plays: { id: string; anchors: unknown; opts: unknown }[] = [];
vi.mock('./fx/playDef', () => ({
  playDef: (id: string, anchors: unknown, opts: unknown) => { plays.push({ id, anchors, opts }); return () => {}; },
  canPlayDefs: () => true,
}));

import { diffHandBuffs, fireHandBuff, HAND_BUFF_DEF_ID, HAND_BUFF_GAP_MS, clearAllHandBuffs } from './handBuffFx';
import { handBuffUidsIn } from './useCombatReplay';
import { unitSelector } from './fx/combatAnchors';

/** A mounted hand card carrying the `data-uid` hook the cue binds to, inside the hand zone. */
function stubHandCard(uid: string, x: number): HTMLElement {
  let zone = document.querySelector<HTMLElement>('[data-zone="hand"]');
  if (!zone) {
    zone = document.createElement('div');
    zone.setAttribute('data-zone', 'hand');
    const row = document.createElement('div');
    row.className = 'row hand';
    zone.appendChild(row);
    document.body.appendChild(zone);
  }
  const el = document.createElement('div');
  el.className = 'card';
  el.setAttribute('data-uid', uid);
  el.getBoundingClientRect = () => ({ left: x, top: 500, width: 100, height: 140, right: x + 100, bottom: 640, x, y: 500, toJSON: () => ({}) }) as DOMRect;
  zone.querySelector('.row')!.appendChild(el);
  return el;
}

describe('diffHandBuffs — the shop fan-out', () => {
  const minion = (uid: string, attack: number, health: number, text = 'Shout: nothing.') => ({ uid, text, attack, health });
  const spell = (uid: string, text: string) => ({ uid, spell: true, text, attack: 0, health: 1 });

  it('(a) names a MINION in hand whose stats rose, and (b) a SPELL in hand whose printed value rose', () => {
    const first = diffHandBuffs(new Map(), [minion('m', 2, 3), spell('s', 'Give a minion +2/+2.')]);
    expect(first.changed, 'the first sighting is a baseline, never a buff').toEqual([]);
    const second = diffHandBuffs(first.next, [minion('m', 3, 4), spell('s', 'Give a minion +4/+4.')]);
    expect(second.changed).toEqual(['m', 's']);
  });

  it('a minion whose TEXT changed without a stat gain is not a buff; a stat LOSS is not a buff', () => {
    const base = diffHandBuffs(new Map(), [minion('m', 2, 3, 'Quest: 3 left.')]).next;
    expect(diffHandBuffs(base, [minion('m', 2, 3, 'Quest: 2 left.')]).changed).toEqual([]);
    expect(diffHandBuffs(base, [minion('m', 1, 3)]).changed).toEqual([]);
  });

  it('a Ruby diffs like a spell — its stat line is its printed value', () => {
    const ruby = (a: number) => ({ uid: 'r', ruby: true, text: 'Give a minion this Ruby.', attack: a, health: a });
    const base = diffHandBuffs(new Map(), [ruby(1)]).next;
    expect(diffHandBuffs(base, [ruby(2)]).changed).toEqual(['r']);
  });

  it('a card drawn this render never fires, and a card that left is forgotten', () => {
    const base = diffHandBuffs(new Map(), [minion('m', 2, 3)]).next;
    const out = diffHandBuffs(base, [minion('n', 5, 5)]);
    expect(out.changed).toEqual([]);
    expect([...out.next.keys()]).toEqual(['n']);
  });
});

describe('handBuffUidsIn — the combat fan-out', () => {
  const hb = (uid: string, side: 'player' | 'enemy' = 'player'): CombatEvent =>
    ({ type: 'handBuff', uid, cardId: 'x', side, attack: 1, health: 1 }) as CombatEvent;

  it('names the player-side handBuff events of ONE beat, one entry per event, in order', () => {
    const events = [hb('before'), hb('a'), hb('b', 'enemy'), hb('a'), { type: 'sc', text: 'x' } as CombatEvent, hb('after')];
    expect(handBuffUidsIn({ start: 1, end: 5 }, events)).toEqual(['a', 'a']);
  });

  it('tolerates an end index past the event array', () => {
    expect(handBuffUidsIn({ start: 0, end: 99 }, [hb('a')])).toEqual(['a']);
  });
});

describe('fireHandBuff — the play', () => {
  beforeEach(() => { plays.length = 0; vi.useFakeTimers(); });
  afterEach(() => { clearAllHandBuffs(); vi.useRealTimers(); document.body.innerHTML = ''; });

  it('binds `hand-buff` to the hand card: anchored on its centre, carrying its uid for the react layer', () => {
    stubHandCard('m', 100);
    fireHandBuff(['m']);
    expect(plays).toEqual([{
      id: HAND_BUFF_DEF_ID,
      anchors: { source: { x: 150, y: 570 }, target: { x: 150, y: 570 } },
      opts: { uids: { source: 'm', target: 'm' } },
    }]);
    expect(HAND_BUFF_DEF_ID).toBe('hand-buff');
  });

  it("the def's react layer can reach a hand card through the shared unit selector", () => {
    const el = stubHandCard('s', 300);
    expect(document.querySelector(unitSelector('s'))).toBe(el);
  });

  it('plays ONCE PER CARD on a multi-card buff, cascaded by the shop gap — never one batched play', () => {
    stubHandCard('a', 0); stubHandCard('b', 120); stubHandCard('c', 240);
    fireHandBuff(['a', 'b', 'c']);
    expect(plays.map((p) => (p.opts as { uids: { target: string } }).uids.target)).toEqual(['a']);
    vi.advanceTimersByTime(HAND_BUFF_GAP_MS);
    expect(plays.map((p) => (p.opts as { uids: { target: string } }).uids.target)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(HAND_BUFF_GAP_MS);
    expect(plays.map((p) => (p.opts as { uids: { target: string } }).uids.target)).toEqual(['a', 'b', 'c']);
    expect(plays.every((p) => p.id === 'hand-buff')).toBe(true);
  });

  it('a uid with no hand card on screen plays nothing (drawn this frame, played, sold)', () => {
    fireHandBuff(['ghost']);
    vi.advanceTimersByTime(1000);
    expect(plays).toEqual([]);
  });

  it('the teardown (and clearAllHandBuffs) cancels the lands still queued', () => {
    stubHandCard('a', 0); stubHandCard('b', 120);
    const stop = fireHandBuff(['a', 'b']);
    stop();
    vi.advanceTimersByTime(1000);
    expect(plays.map((p) => (p.opts as { uids: { target: string } }).uids.target)).toEqual(['a']);
  });
});
