import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { holdMsForKind } from './choreoConfig';
import { rubiedLandsIn } from './channels/rubyLanded';

const bm = (cardId: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health } as BoardMinion);

/**
 * Mid-combat triggers must play LIVE — effect AND animation — at the beat they fire (owner report
 * 2026-08-04): "dawnclaw with a deepvein tender next to it… the animation and the effect need to play mid
 * combat in real time… subsequent rubies would give +1 additional health in real time."
 *
 * The engine half landed with the Effect Arena (PR #871): Dawnclaw's Echo re-fires the adjacent Shouts left
 * to right, Deepvein Tender's Ruby Power applies IMMEDIATELY (gainRubyBonus reads live for the rest of the
 * fight), so Frenzied Excavator's Rubies land at 1/2, not 1/1. This suite pins the PRESENTATION half: the
 * choreography compiler must give each of those events its own timed beat — narrations, the Ruby wave with
 * the live magnitude — so the replay shows the cascade as it happens, never "after combat resolves".
 *
 * Dawnclaw is GOLDEN here (owner 2026-08-11): after that rework an UNgilded Dawnclaw triggers only ONE adjacent
 * Shout, so to exercise BOTH neighbours in one cascade the test uses the gilded body (which triggers both).
 */
describe('mid-combat trigger beats — Dawnclaw + Deepvein Tender + Frenzied Excavator', () => {
  const r = simulate(
    [bm('k_deepvein', 2, 9999), { ...bm('b2_dawnclaw', 1, 1), golden: true }, bm('k_frenzied', 3, 9999)],
    [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const moments = compileMoments(r.events);
  const narrations = moments
    .map((m, i) => ({ i, m, text: (m.primary as { text?: string }).text }))
    .filter((x) => x.m.kind === 'scNarrate' || x.m.kind === 'scCast');

  const iDeep = narrations.find((n) => n.text?.includes('triggers Deepvein Tender'))?.i ?? -1;
  const iPower = narrations.find((n) => n.text?.includes('Ruby Power'))?.i ?? -1;
  const iExc = narrations.find((n) => n.text?.includes('triggers Frenzied Excavator'))?.i ?? -1;

  it('each trigger is its own narration beat, left to right: Deepvein → Ruby Power → Excavator', () => {
    expect(iDeep, "Dawnclaw's Echo names Deepvein Tender").toBeGreaterThanOrEqual(0);
    expect(iPower, 'the Ruby Power gain is telegraphed').toBeGreaterThan(iDeep);
    expect(iExc, 'the Excavator fires AFTER Deepvein (left to right)').toBeGreaterThan(iPower);
  });

  it("Dawnclaw's death beat precedes the whole cascade (the triggers ride the Echo, live)", () => {
    // Dawnclaw is m1 — the first PLAYER death in this fight (the flanks are 40 hp walls).
    const deathEvent = r.events.findIndex((e) => e.type === 'death');
    const deathMoment = moments.findIndex((m) => m.start <= deathEvent && deathEvent < m.end);
    expect(deathMoment).toBeGreaterThanOrEqual(0);
    expect(iDeep).toBeGreaterThan(deathMoment);
  });

  it('the Excavator Rubies are a ruby buff-wave at the LIVE magnitude (1/2 — Deepvein already counted)', () => {
    const waves = moments
      .map((m, i) => ({ i, lands: rubiedLandsIn(m, r.events) }))
      .filter((x) => x.lands.length > 0);
    expect(waves.length, 'a Ruby wave exists in the replay').toBeGreaterThan(0);
    const wave = waves[0]!;
    expect(wave.i, 'the wave lands after the Excavator narration, mid-combat').toBeGreaterThan(iExc);
    for (const l of wave.lands) {
      expect(l.attack / l.count, 'a Ruby is base 1 Attack').toBe(1);
      expect(l.health / l.count, 'a Ruby is 2 Health — the +1 Deepvein JUST granted, in real time').toBe(2);
    }
  });

  it('every beat in the cascade occupies real screen time (never a zero-hold skip)', () => {
    for (const i of [iDeep, iPower, iExc]) {
      expect(holdMsForKind(moments[i]!.kind)).toBeGreaterThan(0);
    }
    const wave = moments.find((m) => rubiedLandsIn(m, r.events).length > 0)!;
    expect(holdMsForKind(wave.kind)).toBeGreaterThan(0);
  });
});
