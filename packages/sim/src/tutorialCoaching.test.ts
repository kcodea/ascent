import { describe, it, expect } from 'vitest';
import { LEARN_ASCENT } from './tutorial/learnAscent';
import { evalPredicate } from './tutorial/evalPredicate';
import type { TutorialContext, TutorialStep } from './tutorial/types';

/**
 * COACHING FIXES from the owner's 2026-08-20 tutorial pass. These pin the SHAPE of the coaching (does the step
 * light up the thing it talks about, does the arrow exist, can the step be satisfied by the wrong action) rather
 * than the copy, which is expected to keep changing.
 */

const steps: TutorialStep[] = LEARN_ASCENT.turns.flatMap((t) => t.steps);
const byId = (id: string): TutorialStep => {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
};
const uiAnchors = (s: TutorialStep): string[] =>
  s.anchors.filter((a) => a.kind === 'ui').map((a) => (a as { id: string }).id);

const ctx = (over: Partial<TutorialContext['run']> = {}, events: TutorialContext['events'] = []): TutorialContext => ({
  run: {
    wave: 1, embers: 3, resolve: 30, maxResolve: 30, tier: 1, frozen: false, phase: 'recruit',
    heroReady: true, shop: [], hand: [], board: [], ...over,
  },
  events,
  sawEver: new Set(events.map((e) => e.type)),
  combatEvents: [],
});

describe('every buy/play step draws the drag it is asking for', () => {
  it('a BUY step spotlights the shop card and arrows it to the hand', () => {
    const buys = steps.filter((s) => s.completion.kind === 'bought');
    expect(buys.length, 'no buy steps found — the course shape changed').toBeGreaterThan(5);
    for (const s of buys) {
      expect(s.connector, `${s.id} has no drag arrow`).toBeDefined();
      expect(s.connector!.from.kind, `${s.id} arrow should start at the shop card`).toBe('card');
      expect(s.connector!.to, `${s.id} arrow should end at the hand`).toEqual({ kind: 'ui', id: 'hand' });
    }
  });

  it('a PLAY step spotlights the HAND card too, not just the empty board', () => {
    const plays = steps.filter((s) => s.completion.kind === 'played');
    expect(plays.length).toBeGreaterThan(5);
    for (const s of plays) {
      const handCard = s.anchors.find((a) => a.kind === 'card' && a.zone === 'hand');
      expect(handCard, `${s.id} never lights the card it wants moved`).toBeDefined();
      // `r8-discover` plays a card that opens the Discover MODAL rather than placing a body, so a
      // "drag to your board" arrow would point somewhere the player must not go. Everything else gets one.
      if (s.id !== 'r8-discover') expect(s.connector, `${s.id} has no drag arrow`).toBeDefined();
    }
  });
});

describe('steps light up what their copy talks about', () => {
  it('the Health beats spotlight the Health box', () => {
    // lobby-self and the first two debriefs all name Health; the number has to be on screen.
    const lobbySelf = LEARN_ASCENT.lobbyIntro.find((s) => s.id === 'lobby-self')!;
    expect(lobbySelf.body).toContain('Health');
    expect(lobbySelf.anchors.filter((a) => a.kind === 'ui').map((a) => (a as { id: string }).id)).toContain('health');
    for (const id of ['r1-debrief', 'r2-debrief']) {
      expect(byId(id).body).toContain('Health');
      expect(uiAnchors(byId(id)), `${id} names Health but does not light it`).toContain('health');
    }
  });

  it('the Discover beat covers the Discover overlay, not a strip of empty board', () => {
    expect(uiAnchors(byId('r8-end'))).toContain('discover');
  });

  it("the Gold beat says unspent Gold is lost, which 'refills every turn' did not", () => {
    expect(byId('r1-gold').body.toLowerCase()).toContain('does not carry over');
  });

  it('the Shout lesson has a payoff beat pointing at the shop it just buffed', () => {
    const payoff = byId('r5-shopbuff');
    expect(payoff.focusMode).toBe('confirm');
    expect(uiAnchors(payoff)).toContain('shop');
    // …and it comes immediately after the play that causes it.
    const turn5 = LEARN_ASCENT.turns.find((t) => t.steps.some((s) => s.id === 'r5-shopbuff'))!;
    const i = turn5.steps.findIndex((s) => s.id === 'r5-shopbuff');
    expect(turn5.steps[i - 1]!.id).toBe('r5-play');
  });

  it('the Echohorn copy no longer promises "a free body mid-fight"', () => {
    expect(byId('r7-buy').body).not.toContain('body mid-fight');
  });

  it('the round-4 debrief stopped promising synergy it does not deliver', () => {
    expect(byId('r4-debrief').body).not.toContain('synergy');
  });
});

describe('positioning cannot be satisfied by clicking', () => {
  const step = () => byId('r7-position');

  it('completes on the T-Rex actually being left-most — not on any reorder', () => {
    expect(step().completion.kind, 'a bare `reordered` accepts any drag').toBe('cardAtSlot');
    const trex = { uid: 'a', cardId: 'b2_trex', golden: false };
    const other = { uid: 'b', cardId: 'b2_wolvie', golden: false };
    // Wrong order, and a reorder event already seen: the old predicate passed here, the new one must not.
    const wrong = ctx({ board: [other, trex] }, [{ type: 'reordered' }]);
    expect(evalPredicate(step().completion, wrong), 'clicking/nudging still completes the step').toBe(false);
    expect(evalPredicate(step().completion, ctx({ board: [trex, other] }))).toBe(true);
  });
});

describe('hero-power reminders', () => {
  const reminders = steps.filter((s) => s.id.endsWith('-power'));

  it('one sits before every guided End Turn', () => {
    expect(reminders.length).toBeGreaterThanOrEqual(7);
    for (const t of LEARN_ASCENT.turns) {
      const end = t.steps.findIndex((s) => s.completion.kind === 'endedTurn');
      if (end <= 0) continue; // free-play rounds have no scripted power beat
      const before = t.steps.slice(0, end).some((s) => s.id.endsWith('-power'));
      if (t.turn <= 9) expect(before, `turn ${t.turn} has no hero-power reminder before End Turn`).toBe(true);
    }
  });

  it('CANNOT soft-lock on a recharge turn — Aster recharges every other turn', () => {
    const r = byId('r2-power').completion;
    // Power down and unused → the reminder clears itself rather than waiting forever.
    expect(evalPredicate(r, ctx({ heroReady: false })), 'reminder would soft-lock while recharging').toBe(true);
    // Power up and unused → it really does ask.
    expect(evalPredicate(r, ctx({ heroReady: true }))).toBe(false);
    // Power up and used → satisfied.
    expect(evalPredicate(r, ctx({ heroReady: true }, [{ type: 'heroPowerUsed' }]))).toBe(true);
  });
});
