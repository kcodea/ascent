import { describe, expect, it } from 'vitest';
import {
  EventRing, SpanRing, attributeLongTask, attributeToEvent, describeEventTarget, eventAttributionLine,
} from './perfEventRing';

/**
 * The blind spot the 2026-09-17 handoff called "Mode B": a 60–119 ms blocking task with NO measured span
 * open. The event ring exists so such a task can name the input event that was being dispatched. These
 * tests pin the two halves — the ring's "last event at or before t" and the span-ring intersection that
 * decides whether a task is labelled at all — without a DOM (targets are duck-typed).
 */
const card = { tagName: 'DIV', className: 'card shop lit', getAttribute: (n: string) => (n === 'data-uid' ? 'u_42' : null) };
const row = { tagName: 'DIV', className: 'row hand', getAttribute: () => null };

describe('the input-event ring', () => {
  it('names the last event dispatched at or before a time, not the newest overall', () => {
    const ring = new EventRing(8);
    ring.push('pointerdown', card, 100);
    ring.push('pointermove', card, 110);
    ring.push('pointermove', row, 250); // after the task — must not be blamed
    expect(ring.lastBefore(200)?.type).toBe('pointermove');
    expect(ring.lastBefore(200)?.t).toBe(110);
    expect(ring.lastBefore(105)?.type).toBe('pointerdown');
    expect(ring.lastBefore(50)).toBeNull();
  });

  it('overwrites oldest-first at capacity and never grows', () => {
    const ring = new EventRing(3);
    for (let i = 0; i < 10; i++) ring.push('pointermove', null, i);
    expect(ring.length).toBe(3);
    expect(ring.lastBefore(100)?.t).toBe(9);
    expect(ring.lastBefore(6)).toBeNull(); // 0..6 have been overwritten; only 7, 8, 9 remain
  });

  it('describes a target as a selector-ish summary: tag, two classes, the data-uid', () => {
    expect(describeEventTarget(card)).toBe('div.card.shop[data-uid=u_42]');
    expect(describeEventTarget(row)).toBe('div.row.hand');
    expect(describeEventTarget(null)).toBe('?');
    expect(describeEventTarget({ nodeType: 3 })).toBe('text');
  });

  it('attributes an unlabelled task to the event before it, with how long before', () => {
    const ring = new EventRing(8);
    ring.push('pointermove', card, 997);
    const a = attributeToEvent(ring, 1000, 1119);
    expect(a).toEqual({ type: 'pointermove', target: 'div.card.shop[data-uid=u_42]', msBefore: 3 });
    expect(eventAttributionLine(a!)).toBe('pointermove on div.card.shop[data-uid=u_42] 3.0 ms earlier');
  });

  it('says so when the event fired INSIDE the task (coalesced during the handler)', () => {
    const ring = new EventRing(8);
    ring.push('pointermove', row, 1050);
    const a = attributeToEvent(ring, 1000, 1119)!;
    expect(a.msBefore).toBe(-50);
    expect(eventAttributionLine(a)).toContain('50.0 ms into the task');
  });
});

describe('long-task attribution: labels first, the event ring only when nothing was open', () => {
  it('names the spans that overlapped the task, oldest first, without duplicates', () => {
    const spans = new SpanRing(16);
    spans.push('render:recruit', 900, 950);   // ended before the task — not inside it
    spans.push('store:set', 1000, 1040);
    spans.push('reduce:buy', 1005, 1010);
    spans.push('layout:flip', 1040, 1100);
    spans.push('layout:flip', 1100, 1110);    // a second call of the same label
    spans.push('fx:tick', 1200, 1210);        // after the task
    expect(spans.labelsOverlapping(1000, 1119)).toEqual(['store:set', 'reduce:buy', 'layout:flip']);
  });

  it('a labelled task keeps its labels and asks the event ring nothing', () => {
    const spans = new SpanRing(16);
    spans.push('store:set', 1000, 1040);
    const events = new EventRing(8);
    events.push('pointermove', card, 999);
    const a = attributeLongTask(spans, events, 1000, 1119);
    expect(a.labels).toEqual(['store:set']);
    expect(a.lastEvent).toBeUndefined();
  });

  it('an UNLABELLED task is attributed to the last input event — the Mode B case', () => {
    const spans = new SpanRing(16);
    spans.push('render:recruit', 500, 520); // long before
    const events = new EventRing(8);
    events.push('pointerdown', card, 800);
    events.push('pointermove', card, 997);
    const a = attributeLongTask(spans, events, 1000, 1119);
    expect(a.labels).toEqual([]);
    expect(a.lastEvent).toEqual({ type: 'pointermove', target: 'div.card.shop[data-uid=u_42]', msBefore: 3 });
  });

  it('an unlabelled task with no event at all stays honest: no labels, no event', () => {
    expect(attributeLongTask(new SpanRing(4), new EventRing(4), 1000, 1100)).toEqual({ labels: [] });
  });
});
