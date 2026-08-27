// @vitest-environment jsdom
/**
 * BUG REPORTER (PR 1) — hotkey tests (blueprint §14.1) + store-integration timer/capture assertions
 * (§14.2/§14.3, the parts provable headlessly) + a source contract on Recruit's overlay wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun } from '@game/sim';
import { installBugReportHotkey, isBugReportShortcut } from './bugReportHotkey';
import { BUG_REPORT_TX_TOAST } from './bugReportCapture';
import { turnClock } from '../turnClock';
import { useGame } from '../store';

const HERE = dirname(fileURLToPath(import.meta.url));

function press(init: KeyboardEventInit & { composing?: boolean } = {}): KeyboardEvent {
  const { composing, ...rest } = init;
  const e = new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true, cancelable: true, bubbles: true, ...rest });
  // jsdom does not honor `isComposing` in the init dict reliably — pin it explicitly.
  if (composing !== undefined) Object.defineProperty(e, 'isComposing', { value: composing });
  window.dispatchEvent(e);
  return e;
}

describe('Ctrl+B hotkey listener (§14.1)', () => {
  it('opens once and prevents the browser default', () => {
    const open = vi.fn();
    const off = installBugReportHotkey(open);
    const e = press();
    expect(open).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    off();
  });

  it('holding the key (repeat) does not open more reports — but still claims the combo', () => {
    const open = vi.fn();
    const off = installBugReportHotkey(open);
    const e = press({ repeat: true });
    expect(open).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true); // the bookmark UI must never pop mid-hold either
    off();
  });

  it('ignores IME composition', () => {
    const open = vi.fn();
    const off = installBugReportHotkey(open);
    press({ composing: true });
    expect(open).not.toHaveBeenCalled();
    off();
  });

  it('plain B, Alt+B and Shift+B do nothing (and keep their browser default)', () => {
    const open = vi.fn();
    const off = installBugReportHotkey(open);
    for (const init of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }] as KeyboardEventInit[]) {
      const e = press(init);
      expect(open).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    }
    off();
  });

  it('Meta+B is the sanctioned macOS alias', () => {
    const open = vi.fn();
    const off = installBugReportHotkey(open);
    press({ ctrlKey: false, metaKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    off();
  });

  it('uninstalling removes the listener (mounted once, cleaned up)', () => {
    const open = vi.fn();
    const off = installBugReportHotkey(open);
    off();
    press();
    expect(open).not.toHaveBeenCalled();
  });

  it('isBugReportShortcut matches the physical KeyB with ctrl/meta only', () => {
    expect(isBugReportShortcut(new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true }))).toBe(true);
    expect(isBugReportShortcut(new KeyboardEvent('keydown', { code: 'KeyB', metaKey: true }))).toBe(true);
    expect(isBugReportShortcut(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true }))).toBe(false);
    expect(isBugReportShortcut(new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

/** A reportable live state: a fresh non-tutorial run, no title/picker/replay/sandbox, no transaction. */
function armStore(): void {
  useGame.setState({
    run: createRun(4242),
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
}

afterEach(() => {
  useGame.setState({ bugReportOpen: false, bugReportDraft: null, bugReportToast: null, presentationTx: null, showTitle: true });
  vi.useRealTimers();
});

describe('openBugReport through the real store (§14.2 / §14.3)', () => {
  it('captures synchronously, opens, and dispatches NOTHING (no action, no frame, same run reference)', () => {
    armStore();
    const before = useGame.getState();
    useGame.getState().openBugReport();
    const after = useGame.getState();
    expect(after.bugReportOpen).toBe(true);
    expect(after.bugReportDraft).not.toBeNull();
    expect(Object.isFrozen(after.bugReportDraft!.capsule)).toBe(true);
    expect(after.run).toBe(before.run); // no dispatch — the run object is untouched
    expect(after.replayActions).toBe(before.replayActions); // no action appended
    expect(after.replayFrames).toBe(before.replayFrames); // no frame appended
  });

  it('never touches the recruit clock: open reads the displayed second, cancel resumes it verbatim', () => {
    armStore();
    turnClock.set(30);
    useGame.getState().openBugReport();
    expect(turnClock.get()).toBe(30); // opening did not reset/advance the clock
    expect(useGame.getState().bugReportDraft!.capsule.timerSecondsRemaining).toBe(30);
    useGame.getState().cancelBugReport();
    expect(turnClock.get()).toBe(30); // closing resumes from the same integer second
    expect(useGame.getState().bugReportDraft).toBeNull(); // capsule discarded with the draft
  });

  it('a report opened at 1 second remaining holds at 1s (capture cannot expire the turn)', () => {
    armStore();
    turnClock.set(1);
    useGame.getState().openBugReport();
    expect(turnClock.get()).toBe(1);
    expect(useGame.getState().bugReportDraft!.capsule.timerSecondsRemaining).toBe(1);
  });

  it('repeat open while already open only bumps the focus seq — the capsule is NOT recaptured', () => {
    armStore();
    useGame.getState().openBugReport();
    const capsule = useGame.getState().bugReportDraft!.capsule;
    const seq = useGame.getState().bugReportFocusSeq;
    useGame.getState().openBugReport();
    expect(useGame.getState().bugReportFocusSeq).toBe(seq + 1);
    expect(useGame.getState().bugReportDraft!.capsule).toBe(capsule);
  });

  it('declines silently on excluded surfaces (title / tutorial / sandbox / replay / game over)', () => {
    armStore();
    const cases: Array<() => void> = [
      () => useGame.setState({ showTitle: true }),
      () => useGame.setState({ heroChoices: ['aster'] }),
      () => useGame.setState({ run: { ...useGame.getState().run, mode: 'tutorial' } }),
      () => useGame.setState({ run: { ...useGame.getState().run, sandbox: true } }),
      () => useGame.setState({ replaying: true }),
      () => useGame.setState({ run: { ...useGame.getState().run, phase: 'gameover' } }),
    ];
    for (const apply of cases) {
      armStore();
      apply();
      useGame.getState().openBugReport();
      expect(useGame.getState().bugReportOpen).toBe(false);
      expect(useGame.getState().bugReportDraft).toBeNull();
      useGame.setState({ replaying: false });
    }
  });

  it('during a presentation transaction: shows the toast, opens nothing, never touches the transaction', () => {
    vi.useFakeTimers();
    armStore();
    const tx = { marker: true } as unknown as ReturnType<typeof useGame.getState>['presentationTx'];
    useGame.setState({ presentationTx: tx });
    useGame.getState().openBugReport();
    expect(useGame.getState().bugReportOpen).toBe(false);
    expect(useGame.getState().bugReportToast).toBe(BUG_REPORT_TX_TOAST);
    expect(useGame.getState().presentationTx).toBe(tx); // the held transaction is not frozen/cleared
    vi.advanceTimersByTime(3000);
    expect(useGame.getState().bugReportToast).toBeNull(); // the toast self-clears
  });
});

describe('Recruit overlay wiring — source contract (§4.1)', () => {
  const src = readFileSync(join(HERE, '..', 'Recruit.tsx'), 'utf8');

  it('bugReportOpen is folded into the overlayOpen expression (pauses clock + combat playback)', () => {
    const m = src.match(/const overlayOpen = useGame\(\(s\) => ([^;]+)\);/);
    expect(m, 'overlayOpen expression not found').toBeTruthy();
    expect(m![1]).toContain('s.bugReportOpen');
  });

  it('the combat replay still pauses through the same path', () => {
    expect(src).toContain('paused: overlayOpen');
  });

  it('the clock-reset effect does NOT key on the reporter (open/close must not reset the turn)', () => {
    // The reset effect's dependency list is the one ending in `heroSelecting, showTitle]` (see Recruit.tsx).
    const resetDeps = src.match(/\}, \[run\.wave, turnSeconds, [^\]]*\]\);/);
    expect(resetDeps, 'clock-reset effect deps not found').toBeTruthy();
    expect(resetDeps![0]).not.toContain('bugReport');
    expect(resetDeps![0]).not.toContain('overlayOpen');
  });
});
