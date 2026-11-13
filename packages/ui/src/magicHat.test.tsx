// @vitest-environment jsdom
/**
 * MAGICIAN'S MAGIC HAT ON SCREEN (owner 2026-11-10, R-DUOS-MAGICIAN-01; three buys, a random copy that leaves from
 * the hat, and his spoken lines: owner 2026-11-12).
 *
 *   "Add a counter for magician and when it activates, the hero power should get an obvious animation / glow that it's
 *   going to fire. You can use the hero power ready animation for this"
 *   "Make sure the pass animation fires when this happens too"
 *
 * 1. The view model (`magicHatBadge`): the count, the active flag, the capped state, Shop only.
 * 2. The button: the counter badge above the power, the existing `ready` classes while the hat is active, none in combat
 *    and none while this turn's two copies are spent.
 * 3. The pass presentation signal on BOTH screens for a hat copy: the sender's stream FROM THE HAT with the copy's face
 *    (`passFlightOf`, `playEntryFlight`, and the stands / a watching teammate through `watchedPasses`), the receiver's
 *    arrival (a new hand card under the pass key).
 * 4. The Magician's line: a pure function of the copy's uid, once per copy (the teammate's transport path is pinned in
 *    `versus/hatLines.test.ts`).
 * 5. A reload: the restore replay counts a copy the server holds against the turn's cap.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { createVersusRun, duosWaitingCount, duosWireOf, handCap, magicHatView, reduce, type BoardCard, type RunState, type ShopCard } from '@game/sim';
import { magicHatBadge } from './magicHatUi';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';
import { passFlightOf, playEntryFlight, playPassFlight, setHatSender } from './versus/passLob';
import { HAT_LINE_COUNT, hatLineOf, resetHatLines, speakHatLine } from './versus/hatLines';
import { hatCardView } from './versus/hatSend';
import { sfx } from './sfx';
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

describe('the view model: count, ready flag, capped', () => {
  it('counts toward 3 and is not ready on the way', () => {
    expect(magicHatBadge(magician())).toMatchObject({ tally: '0/3', ready: false, active: false, capped: false, status: '0/3' });
    expect(magicHatBadge(buyN(magician(), 1))).toMatchObject({ tally: '1/3', ready: false, active: false });
  });

  it('is ready at 2/3, in the Shop: the next buy sends the copy', () => {
    expect(magicHatBadge(buyN(magician(), 2))).toMatchObject({ tally: '2/3', ready: true, active: true, capped: false, status: '2/3 · ready' });
  });

  it('is back to 0/3 and not ready after it fires', () => {
    expect(magicHatBadge(buyN(magician(), 3))).toMatchObject({ tally: '0/3', ready: false, active: false });
  });

  it('never shows ready in combat (no card can be bought there)', () => {
    const fight = { ...buyN(magician(), 2), phase: 'combat' as const };
    expect(magicHatBadge(fight)).toMatchObject({ tally: '2/3', active: true, ready: false });
  });

  it('capped: no glow at 2/3 or 3/3 once the two copies are spent; a full hat is ready again next turn', () => {
    expect(magicHatBadge(buyN(magician(), 8))).toMatchObject({ tally: '2/3', ready: false, active: false, capped: false });
    const capped = buyN(magician(), 9);
    expect(magicHatBadge(capped)).toMatchObject({ tally: '3/3', ready: false, active: false, capped: true, status: '3/3 · sends next turn' });
    expect(magicHatBadge({ ...capped, wave: capped.wave + 1 })).toMatchObject({ tally: '3/3', ready: true, active: true, capped: false });
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
    expect(pill()).toBe('0/3');
    show(buyN(magician(), 1));
    expect(pill()).toBe('1/3');
    expect(panel().classList.contains('ready')).toBe(false);
    expect(panel().dataset.hat).toBe('counting');
  });

  it('at 2/3: the panel and the button wear the existing ready classes, on a passive power', () => {
    show(buyN(magician(), 2));
    expect(pill()).toBe('2/3');
    expect(panel().classList.contains('passive')).toBe(true);
    expect(panel().classList.contains('ready')).toBe(true); // the counter pill's ready style rides this class
    expect(btn().classList.contains('ready')).toBe(true); // the READY CALL (`.statusbar.shopphase .heropowerbtn.ready`)
    expect(ui.container.querySelector('.statusbar')!.classList.contains('shopphase')).toBe(true);
    expect(btn().disabled).toBe(true); // still not a button to press
    expect(panel().dataset.hat).toBe('active');
  });

  it('after it fires the glow is gone and the counter reads 0/3', () => {
    show(buyN(magician(), 2));
    show(buyN(magician(), 3));
    expect(pill()).toBe('0/3');
    expect(panel().classList.contains('ready')).toBe(false);
    expect(btn().classList.contains('ready')).toBe(false);
  });

  it('no stale ready glow in combat, and none while capped', () => {
    show({ ...buyN(magician(), 2), phase: 'combat' });
    expect(btn().classList.contains('ready')).toBe(false);
    expect(panel().classList.contains('ready')).toBe(false);
    show(buyN(magician(), 9));
    expect(pill()).toBe('3/3');
    expect(btn().classList.contains('ready')).toBe(false);
    expect(panel().dataset.hat).toBe('capped');
  });

  it('the tip prints the live rule', () => {
    show(buyN(magician(), 1));
    expect(btn().getAttribute('aria-label')).toContain('1/3');
    show(buyN(magician(), 2));
    expect(btn().getAttribute('aria-label')).toContain('Your hat is ready');
  });

  it('wears its power art, with no native tooltip', () => {
    show(magician());
    expect(btn().querySelector('.hpb-art')).toBeTruthy();
    expect(btn().hasAttribute('title')).toBe(false);
  });
});

describe('the pass presentation fires on both screens for a hat copy', () => {
  const ready = buyN(magician(), 2);
  const sent = reduce({ ...ready, shop: [offer(2)] }, { type: 'buy', uid: 's2' });
  const entry = sent.duos!.outbox[0]!;

  it('SENDER: the entry is a send FROM THE HAT (the hero power), never from the Shop card', () => {
    expect(entry).toMatchObject({ hat: true, via: 'sale' });
    expect(entry.src).toBeUndefined();
    expect(isDragPass(entry)).toBe(false); // an effect send: `playEntryFlight` streams it as the entry ships
    expect(passFlightOf(entry)).toEqual({ at: 'hat', uid: entry.card.uid });
    // An older checkpoint's entry named the bought Shop offer: it leaves from the hat all the same.
    expect(passFlightOf({ ...entry, src: { uid: 's2' } })).toEqual({ at: 'hat', uid: entry.card.uid });
  });

  it('SENDER: the flight is handed the COPY itself, so the hat shows which card came out', () => {
    const seen: unknown[] = [];
    setHatSender((card, run) => { seen.push([card, run]); return true; });
    try {
      expect(playEntryFlight({ ...entry, seq: 900 }, sent, 'face-test')).toBe(true);
      expect(seen).toEqual([[entry.card, sent]]);
      expect(playEntryFlight({ ...entry, seq: 900 }, sent, 'face-test')).toBe(false); // a retry ships it again: it flies once
      expect(seen).toHaveLength(1);
      // The face is the card as it was bought (the entry's card), one of the three, with its name.
      const view = hatCardView(entry.card, sent);
      expect(view.cardId).toBe(entry.card.cardId);
      expect([0, 1, 2].map((i) => PLAIN[i])).toContain(view.cardId);
      expect(view.name).toBe(CARD_INDEX[entry.card.cardId]!.name);
    } finally { setHatSender(null); }
  });

  it('SENDER, with no face renderer or no hat on screen: nothing throws (the stream alone, or nothing)', () => {
    setHatSender(null);
    expect(playPassFlight({ at: 'hat', uid: 'hat1' }, { card: entry.card, run: sent })).toBe(false); // no status bar mounted
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

describe("the Magician's line: the same on both screens, once per copy", () => {
  const sent = buyN(magician(), 3);
  const entry = sent.duos!.outbox[0]!;
  let said: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { resetHatLines(); said = vi.spyOn(sfx, 'magicianPass').mockImplementation(() => undefined); });
  afterEach(() => { said.mockRestore(); });

  it('the line is a pure function of the copy uid: 1..5, the same every time, and all five come up', () => {
    const seen = new Set<number>();
    for (let n = 0; n < 200; n++) {
      const line = hatLineOf(`hat${n}`);
      expect(line).toBe(hatLineOf(`hat${n}`));
      expect(Number.isInteger(line) && line >= 1 && line <= HAT_LINE_COUNT).toBe(true);
      seen.add(line);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(HAT_LINE_COUNT).toBe(5);
  });

  it('both sides hold the value it is chosen from: the copy uid rides the wire card untouched', () => {
    expect(entry.card.uid).toMatch(/^hat\d+$/);
    expect(duosWireOf(entry).uid).toBe(entry.card.uid); // what the teammate's row carries
  });

  it('there is a clip for every line, and nothing else under that name', () => {
    const clips = Object.keys(import.meta.glob('./audio/heroes/magician.pass*.mp3')).map((k) => k.split('/').pop()).sort();
    expect(clips).toEqual([1, 2, 3, 4, 5].map((n) => `magician.pass${n}.mp3`));
  });

  it('one play per copy: a second call for the same uid is silent, another copy speaks', () => {
    expect(speakHatLine('hat7')).toBe(true);
    expect(speakHatLine('hat7')).toBe(false);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenLastCalledWith(hatLineOf('hat7'));
    expect(speakHatLine('hat8')).toBe(true);
    expect(said).toHaveBeenCalledTimes(2);
    expect(speakHatLine(undefined)).toBe(false);
  });

  it('SENDER: the send speaks the line as the copy leaves the hat, once even if the entry ships again', () => {
    setHatSender(() => true);
    try {
      playEntryFlight({ ...entry, seq: 910 }, sent, 'line-test');
      playEntryFlight({ ...entry, seq: 910 }, sent, 'line-test');
      playEntryFlight({ ...entry, seq: 911 }, sent, 'line-test'); // the same copy seen through another path on this screen
      expect(said).toHaveBeenCalledTimes(1);
      expect(said).toHaveBeenCalledWith(hatLineOf(entry.card.uid));
    } finally { setHatSender(null); }
  });

  it('an ordinary effect pass says nothing', () => {
    playEntryFlight({ ...entry, hat: undefined, seq: 920 }, sent, 'line-test');
    expect(said).not.toHaveBeenCalled();
  });
});

describe('a reload: the copy the server holds counts against the turn', () => {
  type Row = Parameters<typeof replayRestore>[3][number];
  const rowOf = (run: RunState, i: number): Row => {
    const e = run.duos!.outbox[i]!;
    return { match_id: 'm', round: e.wave, from_seat: 'p1', to_seat: 'p2', seq: i, card: duosWireOf(e) as unknown as Record<string, unknown>, status: 'landed', created_at: `2026-11-10T12:00:00.00000${i}+00:00` } as Row;
  };

  it('the restored run (two cards in the hat at its last lock) does not send a third copy this turn', () => {
    const locked = buyN(magician(), 2); // the lock: one buy short, nothing sent
    const live = buyN(buyN(locked, 1, 2), 3, 3); // this turn: two copies went out
    expect(live.duos!.outbox).toHaveLength(2);
    const rows = [rowOf(live, 0), rowOf(live, 1)];
    let run = locked;
    const res = replayRestore(() => run, (a) => { run = reduce(run, a as Parameters<typeof reduce>[1]); }, 'p1', rows);
    expect(magicHatView(run)).toMatchObject({ count: 0, left: 0, active: false });
    expect(run.duos!.outbox.map((e) => [e.hat, e.restored])).toEqual([[true, true], [true, true]]);
    expect([...res.seqOf]).toEqual([[0, 0], [1, 1]]);
    expect([...res.shipped].sort()).toEqual([0, 1]); // delivered already: nothing is sent or streamed again
    expect(run.hand).toEqual(locked.hand); // nothing left the run
    expect(run.magicHatCards).toBeUndefined(); // the hat was emptied with each copy
    expect(buyN(run, 6).duos!.outbox).toHaveLength(2); // capped for the turn
  });
});
