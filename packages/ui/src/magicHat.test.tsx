// @vitest-environment jsdom
/**
 * MAGICIAN'S MAGIC HAT ON SCREEN (owner 2026-11-10, R-DUOS-MAGICIAN-01).
 *
 *   "Add a counter for magician and when it activates, the hero power should get an obvious animation / glow that it's
 *   going to fire. You can use the hero power ready animation for this"
 *   "Make sure the pass animation fires when this happens too"
 *
 * 1. The view model (`magicHatBadge`): the count, the active flag, the capped state, Shop only.
 * 2. The button: the counter badge above the power, the existing `ready` classes while the hat is active, none in combat
 *    and none while this turn's two copies are spent.
 * 3. The pass presentation signal on BOTH screens for a hat copy: the sender's stream (`passFlightOf`, and the stands /
 *    a watching teammate through `watchedPasses`), the receiver's arrival (a new hand card under the pass key).
 * 4. A reload: the restore replay counts a copy the server holds against the turn's cap.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { createVersusRun, duosWaitingCount, duosWireOf, handCap, magicHatView, reduce, type BoardCard, type RunState, type ShopCard } from '@game/sim';
import { magicHatBadge } from './magicHatUi';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';
import { passFlightOf } from './versus/passLob';
import { isDragPass, watchedPasses } from './versus/spectatorPasses';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));
const { replayRestore } = await import('./versus/duosPasses');

const DUOS = { v: 1 as const, mode: 'duos' as const, modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0).map((c) => c!.id);
const offer = (i: number): ShopCard => ({ uid: `s${i}`, cardId: PLAIN[i % PLAIN.length]! });
const magician = (over: Partial<RunState> = {}): RunState => ({
  ...createVersusRun(11, 'magician', 'set2', DUOS), phase: 'recruit', hand: [], board: [], embers: 100, shop: [], spell: null, ...over,
} as RunState);
const mate = (over: Partial<RunState> = {}): RunState => ({ ...createVersusRun(12, 'warden', 'set2', DUOS), hand: [], board: [], ...over } as RunState);
/** `n` Shop buys, the hand emptied after each. */
function buyN(s: RunState, n: number, start = 0): RunState {
  let out = s;
  for (let i = 0; i < n; i++) out = { ...reduce({ ...out, shop: [offer(start + i)] }, { type: 'buy', uid: `s${start + i}` }), hand: [] };
  return out;
}

describe('the view model: count, active flag, capped', () => {
  it('counts toward 5 and is not ready on the way', () => {
    expect(magicHatBadge(magician())).toMatchObject({ tally: '0/5', ready: false, active: false, capped: false, status: '0/5' });
    expect(magicHatBadge(buyN(magician(), 3))).toMatchObject({ tally: '3/5', ready: false, active: false });
  });

  it('is active and ready at 5, in the Shop', () => {
    expect(magicHatBadge(buyN(magician(), 5))).toMatchObject({ tally: '5/5', ready: true, active: true, capped: false, status: 'active' });
  });

  it('is back to 0/5 and not ready after it fires', () => {
    expect(magicHatBadge(buyN(magician(), 6))).toMatchObject({ tally: '0/5', ready: false, active: false });
  });

  it('never shows ready in combat (no card can be bought there)', () => {
    const fight = { ...buyN(magician(), 5), phase: 'combat' as const };
    expect(magicHatBadge(fight)).toMatchObject({ tally: '5/5', active: true, ready: false });
  });

  it('capped: full, but not ready and not active until the next turn', () => {
    const capped = buyN(magician(), 18);
    expect(magicHatBadge(capped)).toMatchObject({ tally: '5/5', ready: false, active: false, capped: true, status: '5/5 · active next turn' });
    expect(magicHatBadge({ ...capped, wave: capped.wave + 1 })).toMatchObject({ tally: '5/5', ready: true, active: true, capped: false });
  });

  it('is null for a hero without the hat', () => {
    expect(magicHatBadge(mate())).toBeNull();
  });
});

describe('the button: counter badge and the ready call', () => {
  let ui: Mounted;
  const show = (run: RunState): void => {
    act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false }); });
    ui.render(<StatusBar />);
  };
  const panel = (): HTMLElement => ui.container.querySelector<HTMLElement>('.heropanel:not(.heropanel2):not(.equipslot)')!;
  const btn = (): HTMLButtonElement => panel().querySelector<HTMLButtonElement>('.heropowerbtn')!;
  const pill = (): string | null => panel().querySelector('.hpb-tally.hpb-pill')?.textContent ?? null;
  beforeEach(() => { ui = mount(<div />); });
  afterEach(() => { ui.unmount(); });

  it('shows the counter above the power, moving with each buy', () => {
    show(magician());
    expect(pill()).toBe('0/5');
    show(buyN(magician(), 3));
    expect(pill()).toBe('3/5');
    expect(panel().classList.contains('ready')).toBe(false);
    expect(panel().dataset.hat).toBe('counting');
  });

  it('active: the panel and the button wear the existing ready classes, on a passive power', () => {
    show(buyN(magician(), 5));
    expect(pill()).toBe('5/5');
    expect(panel().classList.contains('passive')).toBe(true);
    expect(panel().classList.contains('ready')).toBe(true); // the counter pill's ready style rides this class
    expect(btn().classList.contains('ready')).toBe(true); // the READY CALL (`.statusbar.shopphase .heropowerbtn.ready`)
    expect(ui.container.querySelector('.statusbar')!.classList.contains('shopphase')).toBe(true);
    expect(btn().disabled).toBe(true); // still not a button to press
    expect(panel().dataset.hat).toBe('active');
  });

  it('after it fires the glow is gone and the counter reads 0/5', () => {
    show(buyN(magician(), 5));
    show(buyN(magician(), 6));
    expect(pill()).toBe('0/5');
    expect(panel().classList.contains('ready')).toBe(false);
    expect(btn().classList.contains('ready')).toBe(false);
  });

  it('no stale ready glow in combat, and none while capped', () => {
    show({ ...buyN(magician(), 5), phase: 'combat' });
    expect(btn().classList.contains('ready')).toBe(false);
    expect(panel().classList.contains('ready')).toBe(false);
    show(buyN(magician(), 18));
    expect(pill()).toBe('5/5');
    expect(btn().classList.contains('ready')).toBe(false);
    expect(panel().dataset.hat).toBe('capped');
  });

  it('the tip prints the live rule', () => {
    show(buyN(magician(), 3));
    expect(btn().getAttribute('aria-label')).toContain('3/5');
    show(buyN(magician(), 5));
    expect(btn().getAttribute('aria-label')).toContain('Your hat is active');
  });

  it('wears its power art, with no native tooltip', () => {
    show(magician());
    expect(btn().querySelector('.hpb-art')).toBeTruthy();
    expect(btn().hasAttribute('title')).toBe(false);
  });
});

describe('the pass presentation fires on both screens for a hat copy', () => {
  const ready = buyN(magician(), 5);
  const sent = reduce({ ...ready, shop: [offer(5)] }, { type: 'buy', uid: 's5' });
  const entry = sent.duos!.outbox[0]!;

  it('SENDER: the entry is a stream from the bought card (a copy of its face), into the teammate portrait', () => {
    expect(entry).toMatchObject({ hat: true, via: 'sale', src: { uid: 's5' } });
    expect(isDragPass(entry)).toBe(false); // an effect send: `playEntryFlight` streams it as the entry ships
    expect(passFlightOf(entry)).toEqual({ at: 'card', uid: 's5', leaves: false, face: true, hat: true });
    // With no source named, it still flies (from the copy's own uid, falling back to the hat on screen).
    expect(passFlightOf({ ...entry, src: undefined })).toMatchObject({ at: 'card', leaves: false, face: true, hat: true });
  });

  it('SENDER, watched (my teammate viewing my board, or the stands): the same entry is a send between two frames', () => {
    expect(watchedPasses(ready, sent).sends).toEqual([entry]);
    expect(watchedPasses(sent, sent).sends).toEqual([]);
  });

  it('RECEIVER: the copy lands as a new hand card under its pass key, the arrival the pass animation plays into', () => {
    const before = mate();
    const after = reduce(before, { type: 'receivePass', from: 'p1', seq: entry.seq, card: duosWireOf(entry) });
    const got = after.hand.find((c) => !before.hand.some((b) => b.uid === c.uid))!;
    expect(got).toMatchObject({ cardId: entry.card.cardId, passKey: 'p1:0' }); // `applyRows` -> `playArrival(got.uid)`
    expect((after.triplesMade ?? 0)).toBe(before.triplesMade ?? 0);
    // ...and a spectator of the receiver (or the Magician viewing their teammate) sees the same arrival.
    expect(watchedPasses(before, after).arrivals).toEqual([got.uid]);
  });

  it('RECEIVER with a full hand: it waits like any effect pass (the "cards waiting" pill), then lands', () => {
    const filler = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !PLAIN.includes(c.id) && c.tier <= 2).slice(0, 10)
      .map((d, i): BoardCard => ({ uid: `h${i}`, cardId: d!.id, tribe: d!.tribe, attack: d!.attack, health: d!.health, keywords: [...d!.keywords], golden: false }));
    const full = mate({ hand: filler, embers: 10 });
    expect(full.hand.length).toBe(handCap(full));
    const held = reduce(full, { type: 'receivePass', from: 'p1', seq: entry.seq, card: duosWireOf(entry) });
    expect(duosWaitingCount(held)).toBe(1);
    expect(held.duos!.refused).toEqual([]);
    const room = reduce(held, { type: 'passCard', uid: 'h0' });
    expect(duosWaitingCount(room)).toBe(0);
    expect(room.hand.at(-1)).toMatchObject({ cardId: entry.card.cardId, passKey: 'p1:0' });
  });
});

describe('a reload: the copy the server holds counts against the turn', () => {
  type Row = Parameters<typeof replayRestore>[3][number];
  const rowOf = (run: RunState, i: number): Row => {
    const e = run.duos!.outbox[i]!;
    return { match_id: 'm', round: e.wave, from_seat: 'p1', to_seat: 'p2', seq: i, card: duosWireOf(e) as unknown as Record<string, unknown>, status: 'landed', created_at: `2026-11-10T12:00:00.00000${i}+00:00` } as Row;
  };

  it('the restored run (hat active at its last lock) does not send a third copy this turn', () => {
    const locked = buyN(magician(), 5); // the lock: active, nothing sent
    const live = buyN(buyN(locked, 1, 5), 6, 6); // this turn: two copies went out
    expect(live.duos!.outbox).toHaveLength(2);
    const rows = [rowOf(live, 0), rowOf(live, 1)];
    let run = locked;
    const res = replayRestore(() => run, (a) => { run = reduce(run, a as Parameters<typeof reduce>[1]); }, 'p1', rows);
    expect(magicHatView(run)).toMatchObject({ count: 0, left: 0, active: false });
    expect(run.duos!.outbox.map((e) => [e.hat, e.restored])).toEqual([[true, true], [true, true]]);
    expect([...res.seqOf]).toEqual([[0, 0], [1, 1]]);
    expect([...res.shipped].sort()).toEqual([0, 1]); // delivered already: nothing is sent or streamed again
    expect(run.hand).toEqual(locked.hand); // nothing left the run
    expect(buyN(run, 6).duos!.outbox).toHaveLength(2); // capped for the turn
  });
});
