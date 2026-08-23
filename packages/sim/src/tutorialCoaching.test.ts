import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
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
    heroReady: true, shop: [], hand: [], board: [], ownedRunes: [], ...over,
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
    // The overlay is raised AND resolved inside `r8-discover` now (full-course audit 2026-08-23): completing
    // on the play that opened it left the modal up across the next beat, which then coached the hero power at
    // a screen the reducer refuses while a Discover is pending. So the cutout belongs on the beat that spans
    // the choice — `r8-end` runs after the pick, over an ordinary board.
    expect(uiAnchors(byId('r8-discover'))).toContain('discover');
    expect(byId('r8-discover').completion).toEqual({ kind: 'discovered' });
    expect(uiAnchors(byId('r8-end')), 'the overlay is gone by End Turn').not.toContain('discover');
  });

  it("the Gold beat says unspent Gold is lost, which 'refills every turn' did not", () => {
    expect(byId('r1-gold').body.toLowerCase()).toContain('does not carry over');
  });

  it('the Shout lesson pays off ON THE BOARD, in one step', () => {
    // Owner report 2026-08-23 (tier legality): the Shout teacher was Sea Urchin, a TIER 4 minion offered on a
    // round played at Tier 3 — the course was showing an over-tier card while about to explain the tier rule.
    // Pennycat is Tier 1 and its Shout summons a Stray beside it, so the trigger resolves where the player is
    // already looking. That also collapses three steps (play → pick → play your pick) into one, and Discover
    // keeps its own lesson on the Round 8 Triple Reward.
    const play = byId('r5-play');
    expect(play.completion).toEqual({ kind: 'played', cardId: 'alley' });
    expect(play.lessonId).toBe('keyword_shout');
    // The Discover lesson still exists in the course — just once, where it is the actual subject.
    const discoverSteps = LEARN_ASCENT.turns.flatMap((t) => t.steps).filter((s) => s.lessonId === 'keyword_discover');
    expect(discoverSteps.length).toBeGreaterThan(0);
  });

  it('every minion the course offers or asks for is a BEAST (owner ask 2026-08-21)', () => {
    // The course teaches one tribe end to end so the synergies land on the player's own board. This sweeps
    // every scripted shop offer AND every card a step names, so a future edit cannot quietly reintroduce an
    // off-tribe minion.
    const offered = new Set<string>();
    for (const t of LEARN_ASCENT.turns) for (const roll of t.shopRolls) {
      for (const id of roll.minions) offered.add(id);
      if (roll.spell) offered.add(roll.spell);
    }
    for (const t of LEARN_ASCENT.turns) for (const s of t.steps) {
      const c = s.completion as { cardId?: string };
      if (c.cardId) offered.add(c.cardId);
    }
    for (const id of offered) {
      const def = CARD_INDEX[id];
      expect(def, `${id} must exist`).toBeTruthy();
      if (def!.spell || def!.token) continue; // spells and reward tokens are tribeless by nature
      expect([def!.tribe, def!.tribe2], `${id} (${def!.name}) must be a Beast`).toContain('beast');
    }
  });

  it('the lobby thins to a single opponent for the final round', () => {
    const sched = LEARN_ASCENT.seatsRemaining!;
    expect(sched).toHaveLength(LEARN_ASCENT.rounds);
    expect(sched[sched.length - 2], 'one opponent left entering the last round').toBe(1);
    // Monotonic: the table only ever shrinks.
    for (let i = 1; i < sched.length; i++) expect(sched[i]!).toBeLessThanOrEqual(sched[i - 1]!);
  });

  it('nothing the course sells can break round 8 triple', () => {
    // Round 8 teaches the golden triple by buying the THIRD copy of a minion the player already holds two of.
    // A "sell something to make room" step earlier in the course that targets that same card silently makes
    // the golden impossible — the Triple Reward never appears and the Discover lesson strands (hit while
    // reworking round 7's sell target on 2026-08-21).
    const tripleCard = (steps.find((s) => s.id === 'r8-buy')!.completion as { cardId: string }).cardId;
    const sellsBefore = LEARN_ASCENT.turns
      .filter((t) => t.turn < 8)
      .flatMap((t) => t.steps)
      .filter((s) => s.completion.kind === 'sold')
      .map((s) => (s.completion as { cardId: string }).cardId);
    expect(sellsBefore, `the course sells ${tripleCard}, which round 8 needs a third of`).not.toContain(tripleCard);
  });

  it('every Discover the course opens is locked to Beasts', () => {
    expect(LEARN_ASCENT.discoverTribe).toBe('beast');
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
