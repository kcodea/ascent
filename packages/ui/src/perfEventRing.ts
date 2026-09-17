/**
 * PERF EVENT RING — the last few DOM input events, so an UNLABELLED long task can name its trigger.
 *
 * The 2026-09-17 shop captures (`docs/perf-handoff-2026-09-17.md`, "Mode B") had 60–119 ms blocking tasks
 * with NO measured span open: no reducer, no store set, no React commit, no FLIP. The Long Tasks API says the
 * main thread blocked and nothing says why. What is cheap to know is *which event was being dispatched* when
 * it happened — a capture-phase listener on `document` sees every pointer / keyboard / wheel event before any
 * handler runs, and recording it costs one ring write (type + target reference + the event's own timestamp,
 * no clock read, no string built). When a long task arrives with an empty label stack, the newest event at
 * or before the task names the handler family that owns it: *"longtask 119 ms — last event: pointermove on
 * .card[data-uid=…] 3 ms earlier"*.
 *
 * The TARGET is kept as a reference and described lazily, only when a long task asks — building a selector
 * string on every pointermove of a 1000 Hz mouse would be the monitor becoming the thing it measures. The ring
 * holds a handful of entries, so a retained element is at most a few events old and never a leak.
 *
 * Pure and DOM-free (targets are duck-typed) so the ring and the describer are unit-testable.
 */

/** The event types the ring listens to — the ones that drive a handler in the shop. */
export const EVENT_RING_TYPES: readonly string[] = [
  'pointermove', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'wheel', 'keydown', 'keyup',
];

export interface RingEvent {
  type: string;
  /** The event's target, as dispatched. Described lazily by `describeEventTarget`. */
  target: unknown;
  /** The event's timestamp on the `performance.now()` clock (`Event.timeStamp`). */
  t: number;
}

/** What the report prints for one attributed long task. */
export interface EventAttribution {
  type: string;
  /** A selector-ish summary of the target — `div.card[data-uid=abc]`. */
  target: string;
  /** How long before the task STARTED the event was dispatched, ms. Negative = inside the task. */
  msBefore: number;
}

/** A fixed-size ring of the newest input events. Overwrites oldest-first; never grows. */
export class EventRing {
  private readonly types: string[];
  private readonly targets: unknown[];
  private readonly ts: Float64Array;
  private head = 0;
  private n = 0;

  constructor(private readonly size = 32) {
    this.types = new Array<string>(size).fill('');
    this.targets = new Array<unknown>(size).fill(null);
    this.ts = new Float64Array(size);
  }

  /** One store per event. `t` is the event's own timestamp — no clock read. */
  push(type: string, target: unknown, t: number): void {
    const i = this.head;
    this.types[i] = type;
    this.targets[i] = target;
    this.ts[i] = t;
    this.head = (i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  /** The newest event dispatched at or before `t`, or null when the ring has none that early. */
  lastBefore(t: number): RingEvent | null {
    for (let k = 0; k < this.n; k++) {
      const i = (this.head - 1 - k + this.size) % this.size;
      if (this.ts[i]! <= t) return { type: this.types[i]!, target: this.targets[i], t: this.ts[i]! };
    }
    return null;
  }

  /** Forget everything — on monitor start, so a stale event cannot be blamed for a fresh task. */
  clear(): void {
    this.head = 0;
    this.n = 0;
    this.targets.fill(null);
  }

  get length(): number { return this.n; }
}

/** The shape of an element the describer reads — duck-typed so tests need no DOM. */
interface ElementLike {
  tagName?: unknown;
  classList?: { length: number; item(i: number): string | null } | undefined;
  className?: unknown;
  getAttribute?: (name: string) => string | null;
  nodeType?: number;
}

/**
 * A selector-ish summary of an event target: `div.card.shop[data-uid=abc]`. At most two classes and the
 * `data-uid`, because the point is to name the handler family (a card, the hand row, the end-turn button),
 * not to reproduce the element. `window` / `document` / a text node are named as such; anything else is `?`.
 */
export function describeEventTarget(target: unknown): string {
  if (target === null || target === undefined) return '?';
  if (typeof window !== 'undefined' && target === window) return 'window';
  if (typeof document !== 'undefined' && target === document) return 'document';
  const el = target as ElementLike;
  if (typeof el.tagName !== 'string') {
    return el.nodeType === 3 ? 'text' : el.nodeType === 9 ? 'document' : '?';
  }
  let out = el.tagName.toLowerCase();
  const classes: string[] = [];
  if (el.classList && typeof el.classList.item === 'function') {
    for (let i = 0; i < el.classList.length && classes.length < 2; i++) {
      const c = el.classList.item(i);
      if (c) classes.push(c);
    }
  } else if (typeof el.className === 'string') {
    for (const c of el.className.split(/\s+/)) { if (c && classes.length < 2) classes.push(c); }
  }
  for (const c of classes) out += `.${c}`;
  const uid = typeof el.getAttribute === 'function' ? el.getAttribute('data-uid') : null;
  if (uid) out += `[data-uid=${uid}]`;
  return out;
}

/**
 * Attribute a long task `[start, end]` to the newest event dispatched at or before its end. An event that
 * fired INSIDE the task (a pointermove coalesced while the handler ran) reads as a negative `msBefore`; the
 * one that triggered a handler-owned task lands within a millisecond or two before `start`.
 */
export function attributeToEvent(ring: EventRing, start: number, end: number): EventAttribution | null {
  const ev = ring.lastBefore(end);
  if (!ev) return null;
  return { type: ev.type, target: describeEventTarget(ev.target), msBefore: +(start - ev.t).toFixed(1) };
}

/**
 * The closed-span ring the monitor keeps for long-task attribution. A `longtask` entry is delivered AFTER the
 * task ends, when the live span stack is empty again — so "what was open during it" has to be answered from
 * what CLOSED recently: every span's label, start and end, in a fixed ring (three stores per close). A task
 * window is then intersected against it.
 */
export class SpanRing {
  private readonly labels: string[];
  private readonly t0: Float64Array;
  private readonly t1: Float64Array;
  private head = 0;
  private n = 0;

  constructor(private readonly size = 256) {
    this.labels = new Array<string>(size).fill('');
    this.t0 = new Float64Array(size);
    this.t1 = new Float64Array(size);
  }

  push(label: string, t0: number, t1: number): void {
    const i = this.head;
    this.labels[i] = label;
    this.t0[i] = t0;
    this.t1[i] = t1;
    this.head = (i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  /** Distinct labels whose span overlapped `[start, end]`, oldest first, at most `max`. */
  labelsOverlapping(start: number, end: number, max = 6): string[] {
    const out: string[] = [];
    // Newest first; the ring is chronological by END, so once a span ended before the task began, stop.
    for (let k = 0; k < this.n; k++) {
      const i = (this.head - 1 - k + this.size) % this.size;
      if (this.t1[i]! < start) break;
      if (this.t0[i]! > end) continue;
      const label = this.labels[i]!;
      if (!out.includes(label)) out.push(label);
      if (out.length >= max) break;
    }
    return out.reverse();
  }

  clear(): void {
    this.head = 0;
    this.n = 0;
  }

  get length(): number { return this.n; }
}

/** A long task's attribution: the labels that ran inside it, or — with none — the input event before it. */
export interface LongTaskAttribution { labels: string[]; lastEvent?: EventAttribution }

/**
 * Attribute one long task. Labels win when any span overlapped the task; the event ring is consulted ONLY
 * when the task was unlabelled, because that is the case the ring exists for — an attributed task already
 * has a better answer than "a pointermove was happening".
 */
export function attributeLongTask(spans: SpanRing, events: EventRing, start: number, end: number): LongTaskAttribution {
  const labels = spans.labelsOverlapping(start, end);
  if (labels.length > 0) return { labels };
  const lastEvent = attributeToEvent(events, start, end);
  return lastEvent ? { labels, lastEvent } : { labels };
}

/** One line for a report or the HUD: `pointermove on div.card[data-uid=abc] 3.0 ms earlier`. */
export function eventAttributionLine(a: EventAttribution): string {
  const when = a.msBefore >= 0 ? `${a.msBefore.toFixed(1)} ms earlier` : `${(-a.msBefore).toFixed(1)} ms into the task`;
  return `${a.type} on ${a.target} ${when}`;
}
