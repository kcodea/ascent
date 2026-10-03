/**
 * RUNE OF AMPLIFICATION'S END OF TURN BEAT (owner 2026-10-03, verbatim: "Where should Rune of Amplification's End
 * of Turn effect play? i think it should get an end of turn beat"). Oracle R-EOT-AMPLIFY-01.
 *
 * Before: the rune Amplified every unused Equipment at End of Turn with no beat at all (the #1924 audit listed it
 * as "not a Shop number"), so the slot only turned blue after the commit, with nothing played.
 *
 * Covered: the live End-of-Turn batch compiles the rune's own beat, carrying one `equipmentAmplified:<id>` counter
 * that resolves to the `self-buff-burst` def on the Equipment slot; the slot's blue state is withheld until that
 * beat; a used Equipment opens no beat; a replay's recorded batch carries the same beat.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import {
  createRun, eotRecordOf, equipmentAmplifiedOf, prepareActionWithPresentation, reduce, EQUIPMENT_AMPLIFIED_COUNTER,
  type Action, type BoardCard, type RunState,
} from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { projectionAt, finalProjection } from './projection';
import { amplifiedIdsOf, equipmentFxFor, EQUIPMENT_FX_DEF } from './equipmentFx';
import { AMPLIFIED_SLOT_SELECTOR } from '../useAmplifiedSlotFx';

const faceOmen = { type: 'faceOmen' } as Action;
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

/** A Set 3 Shop holding Bloodpot (Frank's Equipment) with Rune of Amplification, the Equipment not yet used. */
function amplificationRun(): RunState {
  let s = { ...createRun(7), setId: 'set3', phase: 'recruit', embers: 40, hand: [body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] })] } as RunState;
  s = reduce(s, { type: 'play', uid: 'f', toIndex: 1 } as Action);
  s = reduce({ ...s, runeforgeOffer: ['rune_amplification'], embers: 40 }, { type: 'buyRune', index: 0 } as Action);
  expect(s.runeAmplification).toBe(true);
  expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(0);
  return s;
}

function eot(before: RunState) {
  const prepared = prepareActionWithPresentation(before, faceOmen);
  return { prepared, timeline: compileTimeline(normalizePresentationBatch(prepared.batch!)) };
}

function amplifyBeats(timeline: ReturnType<typeof compileTimeline>) {
  return timeline.consequenceDeliveries
    .map((d) => ({ d, c: d.consequence.payload as { type: string; counter?: string; amount?: number } }))
    .filter(({ c }) => c.type === 'counterChanged' && c.counter?.startsWith(EQUIPMENT_AMPLIFIED_COUNTER))
    .map(({ d, c }) => ({ beat: timeline.beats.find((b) => b.id === d.beatId)!, atMs: d.atMs, counter: c.counter!, fx: equipmentFxFor(c.counter!, c.amount!) }));
}

describe('Rune of Amplification gets an End-of-Turn beat on the Equipment slot (R-EOT-AMPLIFY-01)', () => {
  it('compiles the rune\'s own beat, targeting the Equipment slot with the self-buff-burst', () => {
    const before = amplificationRun();
    const { prepared, timeline } = eot(before);
    const hits = amplifyBeats(timeline);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat.source.id).toBe('rune_amplification');
    expect(hits[0]!.beat.policyKey).toBe('rune:rune_amplification:endOfTurn');
    expect(hits[0]!.counter).toBe('equipmentAmplified:bloodpot');
    expect(hits[0]!.fx).toEqual({ def: 'self-buff-burst', selector: AMPLIFIED_SLOT_SELECTOR, equipmentId: 'bloodpot' });
    expect(EQUIPMENT_FX_DEF).toBe('self-buff-burst');
    // The engine result is unchanged by the beat: the Equipment is Amplified after the action.
    expect(equipmentAmplifiedOf(prepared.after, 'bloodpot')).toBe(1);
  });

  it('the slot turns blue ON the beat, not before (the projection withholds it)', () => {
    const { timeline } = eot(amplificationRun());
    const hit = amplifyBeats(timeline)[0]!;
    expect(amplifiedIdsOf(projectionAt(timeline, hit.atMs - 1).counters).has('bloodpot')).toBe(false);
    expect(amplifiedIdsOf(projectionAt(timeline, hit.atMs).counters).has('bloodpot')).toBe(true);
    expect([...amplifiedIdsOf(finalProjection(timeline).counters)]).toEqual(['bloodpot']);
  });

  it('an Equipment used this turn is not Amplified, so no beat opens', () => {
    const used = reduce(amplificationRun(), { type: 'activateEquipment', targetUid: 't' } as Action);
    expect(equipmentAmplifiedOf(reduce(used, faceOmen), 'bloodpot')).toBe(0);
    // Nothing else fires this End of Turn, so the empty rune scope is discarded and the batch is empty altogether.
    const prepared = prepareActionWithPresentation(used, faceOmen);
    const beats = prepared.batch ? compileTimeline(normalizePresentationBatch(prepared.batch)).beats : [];
    expect(beats.some((b) => b.policyKey === 'rune:rune_amplification:endOfTurn')).toBe(false);
  });

  it('a replay records the same beat', () => {
    const { prepared } = eot(amplificationRun());
    const rec = eotRecordOf(prepared.batch, 1000, prepared.after)!;
    expect(rec).not.toBeNull();
    const hits = amplifyBeats(compileTimeline(normalizePresentationBatch(rec.batch)));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fx?.selector).toBe(AMPLIFIED_SLOT_SELECTOR);
  });

  it('the live presenter plays the burst on the slot, and the slot reads the delivered ids only while the lock holds', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const recruit = readFileSync(join(here, '../Recruit.tsx'), 'utf8');
    const i = recruit.indexOf('counterChanged: (counter, amount) => {');
    expect(i).toBeGreaterThan(0);
    const block = recruit.slice(i, i + 600);
    expect(block).toContain('equipmentFxFor(counter, amount)');
    expect(block).toContain("playDef('self-buff-burst'");
    expect(recruit).toContain('setEotAmplified(amplifiedIdsOf(p.counters));');
    const bar = readFileSync(join(here, '../StatusBar.tsx'), 'utf8');
    expect(bar).toContain('(eotLock && eotAmplified.has(selectedEquipDef.id))');
  });
});
