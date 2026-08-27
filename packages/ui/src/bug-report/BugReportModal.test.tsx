// @vitest-environment jsdom
/**
 * BUG REPORTER (PR 1) — modal behavior under jsdom (blueprint §1.2 keyboard + copy, §14.1 repeat-press).
 *
 * Mount harness follows the repo's rendered-text convention: a tiny createRoot + act wrapper, per-file jsdom
 * docblock, no testing-library. Store state is driven directly through the real `useGame` actions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createRun } from '@game/sim';
import { useGame } from '../store';
import { BugReportModal } from './BugReportModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<BugReportModal />); });
  return container;
}

function openReporter(): void {
  useGame.setState({
    run: createRun(777),
    replayActions: [],
    replayFrames: [],
    showTitle: false,
    heroChoices: null,
    practiceSetupOpen: false,
    replaying: false,
    presentationTx: null,
    bugReportOpen: false,
    bugReportDraft: null,
    bugReportToast: null,
  });
  act(() => { useGame.getState().openBugReport(); });
}

afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
  useGame.setState({ bugReportOpen: false, bugReportDraft: null, bugReportToast: null, showTitle: true });
});

describe('BugReportModal', () => {
  it('renders the report dialog with the blueprint copy and focuses the textarea', () => {
    openReporter();
    const el = mount();
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(el.textContent).toContain('Report a problem');
    expect(el.textContent).toContain('What happened?');
    expect(el.textContent).toContain('This report includes the current run state, recent actions, and combat events.');
    expect(el.textContent).toContain('Current turn and latest combat log attached');
    const text = el.querySelector<HTMLTextAreaElement>('.bgrtext');
    expect(text).toBeTruthy();
    expect(document.activeElement).toBe(text);
  });

  it('shows the SHOP phase badge with the round number', () => {
    openReporter();
    const el = mount();
    const wave = useGame.getState().bugReportDraft!.capsule.wave;
    expect(el.querySelector('.bgrbadge')?.textContent).toContain('SHOP');
    expect(el.querySelector('.bgrbadge')?.textContent).toContain(`Round ${wave}`);
  });

  it('disables Submit under 10 characters and enables it once the description is long enough', () => {
    openReporter();
    const el = mount();
    const submit = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('.bgrsubmit')!;
    expect(submit().disabled).toBe(true);
    act(() => { useGame.getState().updateBugReportDraft({ description: 'short' }); });
    expect(submit().disabled).toBe(true);
    act(() => { useGame.getState().updateBugReportDraft({ description: 'my Echo did not fire at all' }); });
    expect(submit().disabled).toBe(false);
  });

  it('Escape cancels: the modal closes and the draft (capsule included) is discarded', () => {
    openReporter();
    const el = mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }));
    });
    expect(useGame.getState().bugReportOpen).toBe(false);
    expect(useGame.getState().bugReportDraft).toBeNull();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Ctrl+Enter submits when valid and closes the reporter', () => {
    openReporter();
    mount();
    act(() => { useGame.getState().updateBugReportDraft({ description: 'a perfectly valid description' }); });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true, bubbles: true }));
    });
    expect(useGame.getState().bugReportOpen).toBe(false);
    expect(useGame.getState().bugReportDraft).toBeNull();
  });

  it('a repeated Ctrl+B while open refocuses the textarea instead of closing (§1.2)', () => {
    openReporter();
    const el = mount();
    const text = el.querySelector<HTMLTextAreaElement>('.bgrtext')!;
    act(() => { text.blur(); });
    expect(document.activeElement).not.toBe(text);
    act(() => { useGame.getState().openBugReport(); }); // what the hotkey routes to while already open
    expect(useGame.getState().bugReportOpen).toBe(true);
    expect(document.activeElement).toBe(text);
  });

  it('renders the §4.3 toast off bugReportToast', () => {
    useGame.setState({ bugReportOpen: false, bugReportDraft: null, bugReportToast: 'Finish the current effect, then press Ctrl+B again.' });
    const el = mount();
    expect(el.querySelector('.bgrtoast')?.textContent).toContain('Finish the current effect');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });
});
