// @vitest-environment jsdom
/**
 * RULEBOOK TRIAGE — fly-through questionnaire tests (Doc Bot 2.0 WP B; owner-review-pipeline.md §4).
 *
 * The owner's bar: "fly through logic questions … buttons to easily decide answers in 2-5s each." The board
 * previously had ZERO keyboard support — these tests pin the keyboard flow AND that every answer (key or
 * click) is the same durable POST /__rulebook/decide write the list view makes. Mounted under jsdom against
 * a mocked fetch via the shared `renderedText.mount` harness (no testing-library — BugBoard precedent).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import type { ResolvedRule } from '@game/rules';
import { RulebookTriage } from './RulebookTriage';
import { mount, type Mounted } from './renderedText.mount';

type FetchCall = { url: string; body: Record<string, unknown> };

/** The worklist under test is a FIXTURE, not the live registry: the board is meant to reach zero pending
 *  (the owner's 2026-08-28 sitting decided all 77 cards), and a UI suite that breaks when triage finishes
 *  is testing the wrong thing. Three cards is enough for next-card, skip-to-tail and undo. */
const CARD = (id: string, title: string): ResolvedRule => ({
  id,
  title,
  statement: `${title} — ✓ yes · ✕ no (say why) · ✎ your wording`,
  domain: 'triggers',
  status: 'needs-ruling',
  evidence: [{ kind: 'docbot-scan', ref: 'fixture' }],
  currentBehaviour: 'fixture behaviour',
  cardText: 'Fixture — Exemplar: "a printed line."',
  example: 'a concrete example',
  sourceQueue: 'contracts.conventions',
  effective: 'needs-ruling',
});
const FIXTURE: ResolvedRule[] = [
  CARD('q-fix-alpha', 'Alpha family'),
  CARD('q-fix-beta', 'Beta family'),
  CARD('q-fix-gamma', 'Gamma family'),
];
const undecided = (): ResolvedRule[] => FIXTURE;

let calls: FetchCall[] = [];
let m: Mounted | null = null;

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return { ok: true, json: async () => ({}) } as Response;
  }));
});

afterEach(() => {
  m?.unmount();
  m = null;
  vi.unstubAllGlobals();
});

const clickByText = (container: HTMLElement, text: string): void => {
  const el = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
  expect(el, `no button containing "${text}"`).toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

const key = async (k: string): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    await Promise.resolve();
  });
};

const enterFly = (): { container: HTMLElement; firstId: string } => {
  m = mount(<RulebookTriage onClose={() => {}} rules={FIXTURE} />);
  const firstId = undecided()[0]!.id;
  clickByText(m.container, '⚡ Fly through');
  expect(m.container.querySelector('[data-fly]'), 'fly-through view did not open').toBeTruthy();
  return { container: m.container, firstId };
};

describe('fly-through questionnaire', () => {
  it('opens one-question-per-screen with a progress bar and big key-twinned buttons', () => {
    const { container } = enterFly();
    const total = undecided().length;
    expect(container.querySelector('[data-fly-progress]')?.textContent).toContain(`0 of ${total} answered`);
    expect(container.querySelector('[data-fly-card]')?.textContent).toContain(undecided()[0]!.title);
    for (const label of ['✓ Approve', '✎ Revise', '✕ Reject', '⏭ Skip']) {
      expect([...container.querySelectorAll('[data-fly-card] button')].some((b) => (b.textContent ?? '').includes(label)), `missing ${label} button`).toBe(true);
    }
  });

  it('Y approves via the SAME durable POST the list makes, and the progress bar advances', async () => {
    const { container, firstId } = enterFly();
    await key('y');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/__rulebook/decide');
    expect(calls[0]!.body).toEqual({ id: firstId, decision: 'approve' });
    expect(container.querySelector('[data-fly-progress]')?.textContent).toContain('1 of');
    // the next card fronted
    expect(container.querySelector('[data-fly-card]')?.textContent).toContain(undecided()[1]!.id);
  });

  it('N rejects; Enter approves; each keypress is one immediate write', async () => {
    const { firstId } = enterFly();
    await key('n');
    expect(calls[0]!.body).toEqual({ id: firstId, decision: 'reject' });
    await key('Enter');
    expect(calls[1]!.body).toEqual({ id: undecided()[1]!.id, decision: 'approve' });
  });

  it('S skips with NO write and requeues to the sitting tail; skips are counted honestly', async () => {
    const { container, firstId } = enterFly();
    await key('s');
    expect(calls).toHaveLength(0);
    expect(container.querySelector('[data-fly-card]')?.textContent).not.toContain(firstId);
    expect(container.querySelector('[data-fly-progress]')?.textContent).toContain('1 skipped');
  });

  it('E opens the revise input; Esc cancels back without a write; Enter in the input saves the revision', async () => {
    const { container, firstId } = enterFly();
    await key('e');
    const input = container.querySelector('[data-fly-card] input') as HTMLInputElement | null;
    expect(input, 'revise input did not open').toBeTruthy();
    await key('Escape'); // cancels the revise, does NOT leave fly-through
    expect(container.querySelector('[data-fly-card] input')).toBeNull();
    expect(container.querySelector('[data-fly]')).toBeTruthy();
    expect(calls).toHaveLength(0);
    // reopen and save through the input
    await key('e');
    const input2 = container.querySelector('[data-fly-card] input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input2, 'my wording');
      input2.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ id: firstId, decision: 'revise', note: 'my wording' });
  });

  it('U undoes the last answer through the existing {clear} POST and refronts the card', async () => {
    const { container, firstId } = enterFly();
    await key('y');
    await key('u');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual({ clear: firstId });
    expect(container.querySelector('[data-fly-card]')?.textContent).toContain(firstId);
  });

  it('Esc leaves fly-through back to the list view', async () => {
    const { container } = enterFly();
    await key('Escape');
    expect(container.querySelector('[data-fly]')).toBeNull();
  });

  it('the big buttons make the same writes as the keys (every key has a visible button twin)', async () => {
    const { container, firstId } = enterFly();
    const approve = [...container.querySelectorAll('[data-fly-card] button')].find((b) => (b.textContent ?? '').includes('✓ Approve'))!;
    await act(async () => {
      approve.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ id: firstId, decision: 'approve' });
  });
});
