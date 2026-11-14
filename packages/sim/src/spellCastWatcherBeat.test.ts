/**
 * R-SPELLCAST-WATCHER-BEAT-01 — a `spellCast` watcher's reaction is its OWN nested beat.
 *
 * Found by Doc Bot's beat-conservation builder sweep (2026-11-14): Big Brain Billy ("When you cast a Shop spell,
 * this gains +2/+2") sat next to the target of a Ruby Transfer. The cast's scope stole Billy's Rubies (claimed),
 * then Billy's own +2/+2 fired BARE after that scope had closed (unclaimed), so the batch claimed -2/-2 for a body
 * that netted +0/+0. The fix wraps every `spellCast` watcher dispatch (`fireSpellCastWatcher`) in a nested trigger
 * carrying `factory:<do>:spellCast`. These fixtures prove it by construction, with no seed luck.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { GamePresentationEvent } from '@game/core';
import { createRun, reduceWithPresentation, type Action, type RunState } from './index';
import { beatConservationViolations } from './docbot/beatConservation';

function mk(uid: string, id: string) {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
}
function withState(patch: Record<string, unknown>): RunState {
  return { ...createRun(11, 'warden'), phase: 'recruit', hand: [], embers: 10, ...patch } as unknown as RunState;
}
const triggers = (events: readonly GamePresentationEvent[]) =>
  events.filter((e): e is Extract<GamePresentationEvent, { type: 'sourceTrigger' }> => e.type === 'sourceTrigger');

function run(state: RunState, action: Action) {
  const { state: after, batch } = reduceWithPresentation(state, action, true);
  const events = batch?.events ?? [];
  return { after, events, violations: beatConservationViolations(state, after, action, events, { underClaims: true }) };
}

describe('R-SPELLCAST-WATCHER-BEAT-01: spellCast watchers emit their own beat', () => {
  it('Ruby Transfer stealing from an adjacent Big Brain Billy: the steal and the +2/+2 both reconcile', () => {
    // Billy holds a 2/2 Ruby; the Transfer targets his right neighbour, so it steals that Ruby AND Billy hears the cast.
    const billy = { ...mk('b1', 'dw_bigbrainbilly'), attack: 4, health: 4, buffs: [{ source: 'Ruby', attack: 2, health: 2, count: 1 }] };
    const state = withState({ board: [billy, mk('b2', 'pup')], hand: [mk('h1', 'rubytransfer')] });
    const { after, events, violations } = run(state, { type: 'play', uid: 'h1', targetUid: 'b2' });

    const b = after.board.find((c) => c.uid === 'b1')!;
    expect(b.attack).toBe(4); // -2 Ruby stolen, +2 from the cast
    expect(violations).toEqual([]);
    const own = triggers(events).filter((t) => t.source.kind === 'minion' && t.source.uid === 'b1');
    expect(own.map((t) => t.policyKey)).toEqual(['factory:spellCastBuffSelf:spellCast']);
  });

  it('a plain Shop spell: the watcher gain is claimed on its own beat, not left unattributed', () => {
    const state = withState({ board: [mk('b1', 'dw_bigbrainbilly')], hand: [mk('h1', 'wo_mine')] });
    const { after, events, violations } = run(state, { type: 'play', uid: 'h1' });

    expect(after.board[0]!.attack).toBe(CARD_INDEX.dw_bigbrainbilly!.attack + 2);
    expect(violations).toEqual([]);
    const beat = triggers(events).find((t) => t.policyKey === 'factory:spellCastBuffSelf:spellCast');
    expect(beat?.source).toMatchObject({ kind: 'minion', uid: 'b1' });
    const gain = events.find((e) => e.type === 'statsChanged' && e.parentId === beat!.id);
    expect(gain).toMatchObject({ attack: 2, health: 2 });
  });
});
