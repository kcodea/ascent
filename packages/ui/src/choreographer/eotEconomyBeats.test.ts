/**
 * END OF TURN ECONOMY BEATS (owner 2026-10-02, verbatim: "make sure when we have end of turn things that they have
 * beats and modify what they need to. for example rune of shopkeep and frugal with the ancient of time modifier -
 * nothing plays or shows that that is happening at all. please make sure these triggers have a beat. use the self buff
 * burst fx on the shop tier button when this effect triggers"). Oracle R-EOT-ECON-01.
 *
 * Root cause, two halves:
 *   - Rune of Shopkeep DID compile a beat with a `resourceChanged: upgradeCost`, but the presenter for it was a no-op
 *     ("HUD counters read the projection") and the Tier stone read the COMMITTED run, so the price only changed at
 *     the commit, after the Shop had already left the screen. A rune-sourced beat has no unit to pulse: nothing.
 *   - Tradesman x Ancient of Time compiled a beat with NO consequence at all: the End-of-Turn scope diff never
 *     looked at the Shop's economy, so the cut was invisible to presentation.
 *
 * Covered: each compiles a beat whose `resourceChanged: upgradeCost` resolves to the `self-buff-burst` def on the Tier
 * stone (`.tvbwrap`); the projected price is withheld until that beat and lands on exactly the committed price; the
 * recorded replay batch carries the same beat; the other End-of-Turn economy sources (Robin x Time, Coffers) do too.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANCIENT_IDS, createRun, enableAncients, eotRecordOf, prepareActionWithPresentation, reduce, upgradeCostOf,
  type AncientId, type BoardCard, type RunState,
} from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { projectionAt, finalProjection } from './projection';
import { resourceFxFor, RESOURCE_FX_DEF } from './resourceFx';
import selfBuffBurst from '../fx/defs/self-buff-burst.json';

const faceOmen = { type: 'faceOmen' } as never;
const stray: BoardCard = { uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false };

function shopkeepRun(): RunState {
  return { ...createRun(3, 'warden'), phase: 'recruit', board: [stray], runeShopkeep: true, upgradeCost: 9 } as RunState;
}
function ancientRun(heroId: string, id: AncientId, over: Partial<RunState> = {}): RunState {
  let s = enableAncients({ ...createRun(7, heroId), phase: 'recruit', embers: 60, hand: [], board: [stray], ...over } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id } as never);
  expect(s.ancients!.picked).toBe(id);
  return s;
}

/** Compile the live End-of-Turn batch exactly as `playEndOfTurnAuthoritative` does. */
function eot(before: RunState) {
  const prepared = prepareActionWithPresentation(before, faceOmen);
  const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
  return { prepared, timeline };
}

/** The beat a resource consequence delivers on, with what it delivers and where its FX plays. */
function resourceBeats(timeline: ReturnType<typeof compileTimeline>, resource: string) {
  return timeline.consequenceDeliveries
    .map((d) => ({ d, c: d.consequence.payload as { type: string; resource?: string; amount?: number } }))
    .filter(({ c }) => c.type === 'resourceChanged' && c.resource === resource)
    .map(({ d, c }) => ({
      beat: timeline.beats.find((b) => b.id === d.beatId)!,
      atMs: d.atMs,
      amount: c.amount!,
      fx: resourceFxFor(resource, c.amount!),
    }));
}

describe('End-of-Turn upgrade discounts play the self buff burst on the Tier button (R-EOT-ECON-01)', () => {
  it('the FX def is the authored self-buff-burst, used as-is', () => {
    expect(RESOURCE_FX_DEF).toBe('self-buff-burst');
    expect((selfBuffBurst as { id: string }).id).toBe('self-buff-burst');
    expect(resourceFxFor('upgradeCost', -3)).toEqual({ def: 'self-buff-burst', selector: '.tvbwrap' });
    expect(resourceFxFor('upgradeCost', 0)).toBeNull();
  });

  it('the live presenter plays that def on the resolved HUD control, and the Tier price reads the delivered delta', () => {
    // Source pins: the presenter is a hook over live DOM (no jsdom in this repo), as in reliquaryRibbon.test.ts.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../Recruit.tsx'), 'utf8');
    const i = src.indexOf('resourceChanged: (resource, amount) => {');
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 700);
    expect(block).toContain('resourceFxFor(resource, amount)');
    expect(block).toContain("playDef('self-buff-burst'");
    expect(src).toContain('upgradeCost={Math.max(0, upgradeCostOf(run) + (eotRes?.upgradeCost ?? 0))}');
    expect(src).toContain('setEotResources(p.resources.size ? Object.fromEntries(p.resources) : null);');
    // The Tier stone is the element the table targets.
    expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../TavernUpButton.tsx'), 'utf8')).toContain('tvbwrap');
  });

  it('Rune of Shopkeep: its own beat carries the price drop, targeted at the Tier button', () => {
    const before = shopkeepRun();
    const { prepared, timeline } = eot(before);
    const hits = resourceBeats(timeline, 'upgradeCost');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat.source.id).toBe('rune_shopkeep');
    expect(hits[0]!.beat.policyKey).toBe('rune:rune_shopkeep:endOfTurn');
    expect(hits[0]!.fx).toEqual({ def: 'self-buff-burst', selector: '.tvbwrap' });
    expect(hits[0]!.amount).toBe(-3);
    expect(upgradeCostOf(before)).toBe(9);
    expect((timeline.consequenceDeliveries.find((d) => d.beatId === hits[0]!.beat.id)!.consequence.payload as { valueAfter?: number }).valueAfter).toBe(6);
  });

  it('Tradesman x Ancient of Time: the hero beat is no longer empty, and it targets the Tier button', () => {
    const before = ancientRun('hermithank', 'time', { upgradeCost: 7 });
    const priceBefore = upgradeCostOf(before); // 7 + Frugal's 2
    expect(priceBefore).toBe(9);
    const { timeline } = eot(before);
    const hits = resourceBeats(timeline, 'upgradeCost');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat.source.kind).toBe('hero');
    expect(hits[0]!.beat.source.label).toBe('Ancient of Time');
    expect(hits[0]!.fx).toEqual({ def: 'self-buff-burst', selector: '.tvbwrap' });
    expect(hits[0]!.amount).toBe(-3);
    // Every compiled beat delivers something: no empty End-of-Turn beat.
    for (const b of timeline.beats) expect(timeline.consequenceDeliveries.some((d) => d.beatId === b.id)).toBe(true);
  });

  it("the cut eats Frugal's surcharge, down to 0, and the beat carries the PRINTED price", () => {
    // Running cost 2 (+2 Frugal = 4): Time's 3 empties the running cost and eats 1 of the +2 → 1 (ruling "down to 0").
    const low = eot(ancientRun('hermithank', 'time', { upgradeCost: 2 })).timeline;
    expect(resourceBeats(low, 'upgradeCost')[0]!.amount).toBe(-3);
    expect(finalProjection(low).resources.get('upgradeCost')).toBe(-3);
    // Running cost 0 (price 2): only the surcharge is left to cut → 0, so the beat drops the price by 2, not 3.
    const zero = eot(ancientRun('hermithank', 'time', { upgradeCost: 0 })).timeline;
    expect(resourceBeats(zero, 'upgradeCost')[0]!.amount).toBe(-2);
  });

  it('the price is withheld until its beat, then drops (consequence lands with the FX, not before)', () => {
    const { timeline } = eot(shopkeepRun());
    const hit = resourceBeats(timeline, 'upgradeCost')[0]!;
    expect(projectionAt(timeline, hit.atMs - 1).resources.get('upgradeCost') ?? 0).toBe(0);
    expect(projectionAt(timeline, hit.atMs).resources.get('upgradeCost')).toBe(-3);
  });

  it('a replay records the same beat (the recorded batch compiles to the identical Tier-button burst)', () => {
    const before = ancientRun('hermithank', 'time', { upgradeCost: 7 });
    const { prepared } = eot(before);
    const rec = eotRecordOf(prepared.batch, 1000, prepared.after)!;
    expect(rec).not.toBeNull();
    const replayed = compileTimeline(normalizePresentationBatch(rec.batch));
    const hits = resourceBeats(replayed, 'upgradeCost');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fx).toEqual({ def: 'self-buff-burst', selector: '.tvbwrap' });
  });
});

describe('the rest of the End-of-Turn economy has a beat with a HUD target (R-EOT-ECON-01 audit)', () => {
  it('Robin x Ancient of Time: +1 max Gold rides its beat onto the Gold pill', () => {
    const { timeline } = eot(ancientRun('robin', 'time'));
    const hits = resourceBeats(timeline, 'maxGold');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat.source.label).toBe('Ancient of Time');
    expect(hits[0]!.fx).toEqual({ def: 'self-buff-burst', selector: '.goldpill' });
  });

  it('Rune of the Coffers: +1 max Gold rides its beat onto the Gold pill', () => {
    const { timeline } = eot({ ...shopkeepRun(), runeShopkeep: false, runeCoffers: true } as RunState);
    const hits = resourceBeats(timeline, 'maxGold');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat.policyKey).toBe('rune:rune_coffers:endOfTurn');
    expect(hits[0]!.fx?.selector).toBe('.goldpill');
  });

  it('Xerox x Ancient of Fortune: Gold banked for next turn rides its beat onto the Gold pill', () => {
    const pair = [stray, { ...stray, uid: 'b2' }];
    const { timeline } = eot(ancientRun('xerox', 'fortune', { board: pair }));
    const hits = resourceBeats(timeline, 'nextTurnGold');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBeGreaterThan(0);
    expect(hits[0]!.fx?.selector).toBe('.goldpill');
  });

  it('a card banking Gold for next turn (Scrap Vendor) carries it on its own minion beat', () => {
    const vendor = { uid: 'v1', cardId: 'scrapvendor', tribe: 'mech', attack: 1, health: 1, keywords: [], golden: false };
    const { timeline } = eot({ ...shopkeepRun(), runeShopkeep: false, board: [vendor] } as RunState);
    const hits = resourceBeats(timeline, 'nextTurnGold');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat.source.uid).toBe('v1');
  });

  it('free Refreshes and next-turn Gold have a HUD home', () => {
    expect(resourceFxFor('freeRefresh', 1)).toEqual({ def: 'self-buff-burst', selector: '.rfbwrap' });
    expect(resourceFxFor('nextTurnGold', 4)).toEqual({ def: 'self-buff-burst', selector: '.goldpill' });
  });
});
