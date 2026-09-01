// @vitest-environment jsdom
/**
 * BUG BOARD — component + pure-logic tests. The component mounts under jsdom against a mocked fetch
 * (the `renderedText.mount` harness — no testing-library): the board must render a mocked list, fire the
 * exact `/__bugboard/update` POST when a select changes, and send the right work order — the hand-picked
 * stack when one exists, else every open report in the current sort. The endpoint-less prod case must
 * degrade to a hint, never a crash.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import {
  BugBoard, OPEN_STATUSES, defaultStackOf, moveInStack, sortBoardRows, statusCountsOf, type BugBoardRow,
} from './BugBoard';
import { mount, type Mounted } from './renderedText.mount';

const row = (over: Partial<BugBoardRow>): BugBoardRow => ({
  id: '11111111-1111-1111-1111-111111111111',
  created_at: '2026-08-27T10:00:00.000Z',
  status: 'new',
  severity: null,
  priority: null,
  issue_type: 'mechanics',
  description: 'The whelp double-triggered its Echo.',
  patch: '0.9.0+abc1234',
  mode: 'lobby',
  set_id: 'set2',
  hero_id: 'yazzus',
  seed: 12345,
  wave: 7,
  phase: 'combat',
  fingerprint: null,
  duplicate_of: null,
  ...over,
});

const ID1 = '11111111-1111-1111-1111-111111111111';
const ID2 = '22222222-2222-2222-2222-222222222222';
const ID3 = '33333333-3333-3333-3333-333333333333';

const ROWS: BugBoardRow[] = [
  row({ id: ID1, fingerprint: 'f1' }),
  row({ id: ID2, status: 'triaged', priority: 1, fingerprint: 'f1', description: 'Shop froze after reroll.', created_at: '2026-08-27T11:00:00.000Z', issue_type: 'softlock' }),
  row({ id: ID3, status: 'fixed', description: 'Old fixed one.', created_at: '2026-08-26T09:00:00.000Z' }),
];
const DUPES = { f1: 2 };

/* ─────────────────────────────────────── pure ordering logic ─────────────────────────────────────── */

describe('bug board ordering logic', () => {
  it('priority sort puts ranked rows first (1..N), unranked newest-first after', () => {
    expect(sortBoardRows(ROWS, 'priority', DUPES).map((r) => r.id)).toEqual([ID2, ID1, ID3]);
  });

  it('newest sort is created_at desc; dupes sort puts the biggest fingerprint cluster first', () => {
    expect(sortBoardRows(ROWS, 'newest', DUPES).map((r) => r.id)).toEqual([ID2, ID1, ID3]);
    const spread = [row({ id: ID1 }), row({ id: ID2, fingerprint: 'f9', created_at: '2026-08-01T00:00:00.000Z' })];
    expect(sortBoardRows(spread, 'dupes', { f9: 5 }).map((r) => r.id)).toEqual([ID2, ID1]);
  });

  it('defaultStackOf ships only open statuses (new/triaged/needs_info), in the current sort', () => {
    expect(defaultStackOf(ROWS, 'priority', DUPES)).toEqual([ID2, ID1]); // fixed row excluded
  });

  it('moveInStack swaps one step and refuses to move past either end', () => {
    expect(moveInStack([ID1, ID2, ID3], ID3, -1)).toEqual([ID1, ID3, ID2]);
    expect(moveInStack([ID1, ID2], ID1, -1)).toEqual([ID1, ID2]);
    expect(moveInStack([ID1, ID2], ID2, 1)).toEqual([ID1, ID2]);
    expect(moveInStack([ID1], 'missing', 1)).toEqual([ID1]);
  });

  it('statusCountsOf tallies by status', () => {
    expect(statusCountsOf(ROWS)).toEqual({ new: 1, triaged: 1, fixed: 1 });
  });
});

/* ─────────────────────────────────────── mounted component ─────────────────────────────────────── */

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(listStatus = 200): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/__bugboard/list') {
      return new Response(JSON.stringify(listStatus === 200 ? { rows: ROWS, dupeCounts: DUPES } : { error: 'nope' }), { status: listStatus });
    }
    if (url === '/__bugboard/update') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url === '/__bugboard/work-order') return new Response(JSON.stringify({ ok: true, count: 2 }), { status: 200 });
    return new Response('not found', { status: 404 });
  }));
  return { calls };
}

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; vi.unstubAllGlobals(); });
beforeEach(() => { vi.unstubAllGlobals(); });

describe('BugBoard component', () => {
  it('renders the mocked list: rows, status counts, and the dupe badge', async () => {
    mockFetch();
    m = mount(<BugBoard onClose={() => {}} />);
    await flush();
    expect(m.container.querySelector(`[data-testid="bug-row-${ID1}"]`)).toBeTruthy();
    expect(m.container.textContent).toContain('The whelp double-triggered its Echo.');
    expect(m.container.querySelector('[data-testid="status-counts"]')?.textContent).toBe('1 new · 1 triaged · 1 fixed');
    expect(m.container.textContent).toContain('×2'); // f1 fingerprint shared by two reports
  });

  it('changing a status select POSTs the exact /__bugboard/update body', async () => {
    const { calls } = mockFetch();
    m = mount(<BugBoard onClose={() => {}} />);
    await flush();
    const select = m.container.querySelector(`select[aria-label="status of ${ID1}"]`) as HTMLSelectElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(select, 'reproduced');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const update = calls.find((c) => c.url === '/__bugboard/update');
    expect(update).toBeTruthy();
    expect(JSON.parse(String(update!.init!.body))).toEqual({ id: ID1, status: 'reproduced' });
  });

  it('Send to Claude with no stack ships ALL open reports in the current (priority) sort', async () => {
    const { calls } = mockFetch();
    m = mount(<BugBoard onClose={() => {}} />);
    await flush();
    const send = [...m.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Send to Claude'))!;
    expect(send.textContent).toContain('(all open)');
    await act(async () => { send.click(); });
    await flush();
    const wo = calls.find((c) => c.url === '/__bugboard/work-order');
    expect(JSON.parse(String(wo!.init!.body))).toEqual({ orderedReportIds: [ID2, ID1] });
    expect(m.container.querySelector('[data-testid="sent-confirmation"]')?.textContent)
      .toContain('work-order.json written (2 bugs) — tell Claude: "fix the bug stack"');
  });

  it('a hand-picked stack overrides the default order and shows the side panel', async () => {
    const { calls } = mockFetch();
    m = mount(<BugBoard onClose={() => {}} />);
    await flush();
    // Pick ID1 only — the stack (not the two open reports) must be what ships.
    const pick = m.container.querySelector(`input[aria-label="pick ${ID1}"]`) as HTMLInputElement;
    await act(async () => { pick.click(); });
    expect(m.container.querySelector('[data-testid="stack-panel"]')).toBeTruthy();
    const send = [...m.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Send to Claude'))!;
    expect(send.textContent).toContain('(stack of 1)');
    await act(async () => { send.click(); });
    await flush();
    const wo = calls.find((c) => c.url === '/__bugboard/work-order');
    expect(JSON.parse(String(wo!.init!.body))).toEqual({ orderedReportIds: [ID1] });
  });

  it('degrades to a hint when the endpoints 404 (prod build) — no crash', async () => {
    mockFetch(404);
    m = mount(<BugBoard onClose={() => {}} />);
    await flush();
    expect(m.container.textContent).toContain('dev-server-only');
  });
});

/**
 * THE DEFAULT VIEW (owner ask 2026-08-31: *"the bug board should only show unresolved bugs. any
 * resolved/fixed bugs should go away"*).
 *
 * Two claims worth pinning, because both were wrong before: what counts as unresolved, and that a
 * `reproduced` report is one of them — it used to be excluded from every default work order, which is the
 * opposite of what triaging a bug to "reproduced" should do.
 */
describe('BugBoard — unresolved is the default view', () => {
  const mk = (id: string, status: string): BugBoardRow =>
    ({ id, created_at: '2026-08-31', status, severity: 'medium', issue_type: 'mechanics', description: id } as BugBoardRow);

  it('counts every status that still needs work as OPEN, reproduced included', () => {
    expect([...OPEN_STATUSES].sort()).toEqual(['needs_info', 'new', 'reproduced', 'triaged']);
  });

  it('treats fixed / closed / duplicate as resolved, so they drop out of the default view', () => {
    for (const done of ['fixed', 'closed', 'duplicate']) {
      expect(OPEN_STATUSES.includes(done), `${done} must not be an open status`).toBe(false);
    }
  });

  it('the default work order carries a reproduced report', () => {
    // The regression this closes: `defaultStackOf` filters on OPEN_STATUSES, so a reproduced bug was
    // silently missing from "Send to Claude (all open)".
    const rows = [mk('a', 'new'), mk('b', 'reproduced'), mk('c', 'fixed')];
    expect(defaultStackOf(rows, 'priority', {})).toEqual(['a', 'b']);
  });
});
