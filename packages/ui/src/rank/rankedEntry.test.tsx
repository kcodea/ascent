// @vitest-environment jsdom
/**
 * THE RANKED ENTRY (owner 2026-10-11, R-RANK-06), verbatim: "when clicking on the play section there should be a
 * confirmation that says: This is a ranked lobby, abandoning the match after this point will lose you MMR. Would
 * you like to proceed? Then have two button options: 1. Yes, let's go. 2. No, go back. from there, even at the hero
 * select screen, if they go back, they should place as if they came in eighth place and lose the associated mmr".
 * And, asked what closing the game on hero select should do: "Reopen on the same heroes".
 *
 * Pinned against the REAL Title, HeroSelect and store, with the rank queue mocked (the `quitCostsRating.test.ts`
 * recipe):
 *   - the Play card opens the confirmation in the owner's words and starts nothing by itself; "No, go back."
 *     closes it; "Yes, let's go." commits an entry and opens hero select;
 *   - Back from that hero select takes two presses and settles the entry's id as an 8th, tagged an abandon;
 *   - picking a hero spends the entry: the run carries the entry's id, and nothing is settled;
 *   - an entry left by a closed session is read back whole (same id, same heroes), and a live entry is resumed
 *     by the next Play instead of being re-rolled;
 *   - Practice and Gauntlet hero selects keep a free, one-press Back.
 *
 * And the presentation (owner 2026-10-12): "can this actually take place on the play menu screen instead? and have
 * the background blurred and darkened? ... i want the screen to darken and blur as this window expands out with a
 * little bit of a bounce". The mode picker stays mounted under a veil; the motion is transform + opacity only.
 * Then: "can you use the border that the compendium uses? and emulate the title and underline structure here?" and
 * "make the buttons look like the UI elements" in the Compendium's top right: the painted frame + crests, a title
 * over the painted divider, and the two answers as Gem plates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RANK_RULES, resolveRank } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return { ...mod, remoteEnabled: () => true, refreshOpponentPoolAndRecords: vi.fn() };
});

vi.mock('./rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => ({ ...(req as object), userId: 'me', at: 'now', attempts: 0 })),
    flushPendingRanks: vi.fn(async () => {}),
    installRankRetryTriggers: vi.fn(),
  };
});

// A player who has finished the tutorial: the Play card goes straight to the ranked confirmation.
vi.mock('../tutorial/tutorialProfile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../tutorial/tutorialProfile')>();
  return { ...mod, getCourseProgress: () => ({ status: 'completed' }) };
});

import { Title } from '../Title';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { enqueuePendingRank, flushPendingRanks } from './rankSubmission';
import {
  RANKED_CONFIRM_EXIT_MS, RANKED_CONFIRM_NO, RANKED_CONFIRM_TEXT, RANKED_CONFIRM_TITLE, RANKED_CONFIRM_YES, RANKED_ENTRY_PLACEMENT,
  clearRankedEntry, loadRankedEntry, saveRankedEntry, type RankedEntry,
} from './rankedEntry';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const queued = () => vi.mocked(enqueuePendingRank).mock.calls.map((c) => c[0]);
const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
const press = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };
const stored = (): RankedEntry | null => loadRankedEntry(() => true);
const MID = { divisionIndex: 4, points: 50, demotionReady: false };
const DIALOG = '[role="dialog"][aria-label="Ranked lobby"]';
/** Let the "No, go back." exit finish (a real timer in Title; it then unmounts the card). */
const afterExit = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, RANKED_CONFIRM_EXIT_MS + 60)); }); };

beforeEach(() => {
  vi.mocked(enqueuePendingRank).mockClear();
  vi.mocked(flushPendingRanks).mockClear();
  localStorage.clear();
  useGame.setState({ showTitle: true, titleView: 'modes', heroChoices: null, pendingMode: 'lobby', pendingSeed: undefined, rankedEntry: null, savedRun: null, replaying: false, playerName: 'Mike' });
});

describe('the Play card asks before it starts a ranked lobby', () => {
  const openConfirm = (): void => {
    ui = mount(<Title onSettings={() => {}} />);
    act(() => document.querySelector<HTMLButtonElement>('.modecard[data-mp="play"]')!.click());
  };

  it('shows the confirmation in the owner\'s words, with exactly the two answers, and starts nothing yet', () => {
    openConfirm();
    const dialog = document.querySelector(DIALOG);
    expect(dialog).not.toBeNull();
    expect(RANKED_CONFIRM_TEXT).toBe('This is a ranked lobby, abandoning the match after this point will lose you MMR. Would you like to proceed?');
    expect(dialog!.querySelector('.rankedconfirm-text')!.textContent).toBe(RANKED_CONFIRM_TEXT);
    expect([...dialog!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(["Yes, let's go.", 'No, go back.']);
    expect(RANKED_CONFIRM_YES).toBe("Yes, let's go.");
    expect(RANKED_CONFIRM_NO).toBe('No, go back.');
    expect(useGame.getState().heroChoices, 'hero select is not open yet').toBeNull();
    expect(useGame.getState().rankedEntry).toBeNull();
    expect(stored()).toBeNull();
  });

  it('"No, go back." plays the short exit, then closes it and leaves the player on the mode picker, uncommitted', async () => {
    openConfirm();
    act(() => button(RANKED_CONFIRM_NO)!.click());
    expect(document.querySelector(DIALOG)!.classList.contains('closing'), 'the exit is playing').toBe(true);
    await afterExit();
    expect(document.querySelector(DIALOG)).toBeNull();
    const st = useGame.getState();
    expect(st.showTitle).toBe(true);
    expect(st.titleView).toBe('modes');
    expect(st.heroChoices).toBeNull();
    expect(st.rankedEntry).toBeNull();
    expect(queued()).toHaveLength(0);
  });

  it('opens OVER the mode picker: the picker stays on screen behind a veil, the card above it', () => {
    openConfirm();
    const dialog = document.querySelector<HTMLElement>(DIALOG)!;
    expect(dialog.classList.contains('rankedconfirm-ov')).toBe(true);
    expect(dialog.classList.contains('modepick'), 'it is not its own opaque page any more').toBe(false);
    const picker = document.querySelector('.modepick');
    expect(picker, 'the mode picker is still mounted underneath').not.toBeNull();
    expect(picker!.contains(dialog)).toBe(false);
    expect(picker!.querySelector('.modecard[data-mp="play"]')).not.toBeNull();
    const kids = [...dialog.children].map((c) => c.className);
    expect(kids[0], 'the veil is painted first, under the card').toBe('rankedconfirm-veil');
    expect(kids[1]).toContain('rankedconfirm');
  });

  it('wears the Compendium chrome: its frame and crests, a title over the divider, Gem-plate answers', () => {
    openConfirm();
    const win = document.querySelector<HTMLElement>(`${DIALOG} .rankedconfirm`)!;
    expect(win.querySelectorAll('.rc-crest')).toHaveLength(2);
    expect(win.querySelector('.rc-crest-foot')).not.toBeNull();
    const kids = [...win.children].filter((c) => !c.classList.contains('rc-crest')).map((c) => c.className);
    expect(kids, 'title, then the question, then the answers').toEqual(['rc-title', 'rankedconfirm-text', 'rankedconfirm-actions']);
    expect(win.querySelector('.rc-title')!.textContent).toBe(RANKED_CONFIRM_TITLE);
    expect([...win.querySelectorAll('button')].map((b) => b.className)).toEqual(['rc-btn rc-btn-yes', 'rc-btn']);
    expect(win.querySelector('[title]'), 'no native tooltip').toBeNull();

    // The same painted art and theme tokens the Compendium uses (compendium.css), in this window's own rules.
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
    const book = readFileSync(join(__dirname, '..', 'compendium.css'), 'utf8');
    const rule = (sel: string): string => { const at = css.indexOf(`${sel} {`); expect(at, sel).toBeGreaterThan(-1); return css.slice(at, css.indexOf('}', at)); };
    for (const art of ['/frames/compendium-frame.webp', '/frames/compendium-crest.webp', '/frames/compendium-crest-foot.webp', '/frames/name-divider.webp']) {
      expect(book, `the Compendium still uses ${art}`).toContain(art);
    }
    expect(rule('.rankedconfirm::after')).toContain("border-image: url('/frames/compendium-frame.webp') 270 stretch");
    expect(rule('.rc-crest')).toContain('/frames/compendium-crest.webp');
    expect(rule('.rc-crest-foot')).toContain('/frames/compendium-crest-foot.webp');
    expect(rule('.rc-title::after')).toContain('/frames/name-divider.webp');
    expect(rule('.rc-title')).toContain('color: var(--ui-title)');
    // A Gem plate: the book's pill grammar (sheen + plate inside a gold edge, a 7px corner).
    const pill = rule('.rc-btn');
    expect(pill).toContain('background: var(--ui-sheen) padding-box, var(--ui-plate) padding-box, var(--ui-edge) border-box');
    expect(pill).toContain('border-radius: 7px');
    expect(book).toContain('background: var(--ui-sheen) padding-box, var(--ui-plate) padding-box, var(--ui-edge) border-box');
    expect(css).not.toMatch(/\.rc-(btn|title|crest)[^{]*\{[^}]*cursor:\s*pointer/);
  });

  it('a press on the dimmed picker around the card is "No": it closes and commits nothing', async () => {
    openConfirm();
    act(() => document.querySelector<HTMLElement>('.rankedconfirm-veil')!.click());
    await afterExit();
    expect(document.querySelector(DIALOG)).toBeNull();
    expect(useGame.getState().rankedEntry).toBeNull();
    expect(useGame.getState().heroChoices).toBeNull();
  });

  it('reopening during the exit cancels it: the card stays', async () => {
    openConfirm();
    act(() => button(RANKED_CONFIRM_NO)!.click());
    act(() => document.querySelector<HTMLButtonElement>('.modecard[data-mp="play"]')!.click());
    await afterExit();
    const dialog = document.querySelector(DIALOG);
    expect(dialog).not.toBeNull();
    expect(dialog!.classList.contains('closing')).toBe(false);
  });

  it('the motion is compositor-only: transform + opacity keyframes, a static blur, reduced motion honoured', () => {
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
    const block = (name: string): string => {
      const at = css.indexOf(`@keyframes ${name} {`);
      expect(at, name).toBeGreaterThan(-1);
      let depth = 0;
      for (let i = css.indexOf('{', at); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
      }
      throw new Error(`unterminated @keyframes ${name}`);
    };
    for (const name of ['rc-veil', 'rc-veil-out', 'rc-pop', 'rc-out']) {
      const props = [...block(name).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.length, name).toBeGreaterThan(0);
      expect(props.filter((prop) => prop !== 'opacity' && prop !== 'transform'), name).toEqual([]);
    }
    // The bounce: out past full size, a dip under it, then rest at exactly 1.
    const scales = [...block('rc-pop').matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(scales[0]).toBeLessThan(1);
    expect(Math.max(...scales)).toBeGreaterThan(1);
    expect(scales[scales.length - 1]).toBe(1);
    const veil = css.slice(css.indexOf('.rankedconfirm-veil {'), css.indexOf('}', css.indexOf('.rankedconfirm-veil {')));
    expect(veil).toMatch(/backdrop-filter: blur\(\d+px\)/);
    expect(veil, 'the veil darkens').toMatch(/background: rgba\(/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.rankedconfirm-veil,[^}]*animation: none;/);
    expect(css).toContain(`rc-out ${RANKED_CONFIRM_EXIT_MS / 1000}s`);
    expect(css).not.toMatch(/\.rankedconfirm[^{]*\{[^}]*cursor:\s*pointer/);
  });

  it('"Yes, let\'s go." sounds like End Turn, and plays none of the gate\'s cues itself; "No, go back." plays neither', () => {
    // Owner 2026-10-13: "add the 'end turn' sound effect we use in game when clicking the end turn and start combat
    // crystal ... that can be the sound that emits when clicking the 'yes continue' button", and "move the 'ding'
    // tone to when the crystal explodes, not upon clicking 'yes continue'". No gate is mounted in this file, so
    // anything `sfx.gate` plays here would be the Title's own doing.
    const gate = vi.spyOn(sfx, 'gate').mockImplementation(() => {});
    const endTurn = vi.spyOn(sfx, 'combatStart').mockImplementation(() => {});
    openConfirm();
    act(() => button(RANKED_CONFIRM_NO)!.click());
    expect(endTurn).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLButtonElement>('.modecard[data-mp="play"]')!.click());
    act(() => button(RANKED_CONFIRM_YES)!.click());
    expect(useGame.getState().rankedEntry, 'the Yes went through').not.toBeNull();
    expect(endTurn, 'the End Turn cue, once').toHaveBeenCalledTimes(1);
    expect(gate).not.toHaveBeenCalled();
    gate.mockRestore();
    endTurn.mockRestore();
  });

  it('"Yes, let\'s go." acts on the PRESS, and the release that follows does nothing more', () => {
    const endTurn = vi.spyOn(sfx, 'combatStart').mockImplementation(() => {});
    openConfirm();
    const yes = button(RANKED_CONFIRM_YES)!;
    // A right-button press is not a "Yes".
    act(() => { yes.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 })); });
    expect(endTurn).not.toHaveBeenCalled();
    expect(useGame.getState().rankedEntry).toBeNull();
    act(() => { yes.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    expect(endTurn, 'it answers as the button goes down').toHaveBeenCalledTimes(1);
    expect(useGame.getState().rankedEntry, 'and the entry is committed there').not.toBeNull();
    act(() => { yes.click(); });
    expect(endTurn, 'the release (click) is not a second Yes').toHaveBeenCalledTimes(1);
    endTurn.mockRestore();
  });

  it('"Yes, let\'s go." commits a ranked entry (persisted) and opens hero select on its heroes', () => {
    openConfirm();
    act(() => button(RANKED_CONFIRM_YES)!.click());
    const st = useGame.getState();
    expect(st.showTitle).toBe(false);
    expect(st.pendingMode).toBe('lobby');
    expect(st.rankedEntry).not.toBeNull();
    expect(st.heroChoices).toEqual(st.rankedEntry!.heroChoices);
    expect(st.pendingSeed).toBe(st.rankedEntry!.seed);
    expect(st.rankedEntry!.runId.length).toBeGreaterThan(0);
    expect(stored(), 'the entry survives the game being closed').toEqual(st.rankedEntry);
    expect(queued(), 'confirming settles nothing').toHaveLength(0);
  });
});

describe('after the confirmation, going back from hero select is an 8th', () => {
  const enter = (): RankedEntry => {
    act(() => useGame.getState().startLobby());
    ui = mount(<HeroSelect />);
    return useGame.getState().rankedEntry!;
  };

  it('Back takes two presses: the first only names the cost', () => {
    enter();
    const back = document.querySelector<HTMLButtonElement>('.hsback')!;
    expect(back.textContent).toBe('← Main Menu');
    press(back);
    expect(back.classList.contains('armed')).toBe(true);
    expect(back.textContent).toBe('Abandon? Counts as 8th place');
    expect(useGame.getState().heroChoices, 'still on hero select').not.toBeNull();
    expect(queued()).toHaveLength(0);
  });

  it('the second press settles the entry as an 8th (an abandon, the 8th-place award) and opens the title', () => {
    const entry = enter();
    const back = document.querySelector<HTMLButtonElement>('.hsback')!;
    press(back);
    press(back);
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ runId: entry.runId, placement: 8, seed: entry.seed, kind: 'abandon' });
    expect(RANKED_ENTRY_PLACEMENT).toBe(8);
    expect(resolveRank(MID, 8).appliedDelta).toBe(RANK_RULES.placementAwards[7]);
    expect(resolveRank(MID, 8).appliedDelta).toBeLessThan(0);
    expect(vi.mocked(flushPendingRanks)).toHaveBeenCalled();
    const st = useGame.getState();
    expect(st.showTitle).toBe(true);
    expect(st.heroChoices).toBeNull();
    expect(st.rankedEntry).toBeNull();
    expect(stored(), 'the settled entry is spent').toBeNull();
  });

  it('abandoning twice cannot settle twice', () => {
    enter();
    act(() => useGame.getState().abandonRankedEntry());
    act(() => useGame.getState().abandonRankedEntry());
    expect(queued()).toHaveLength(1);
  });

  it('picking a hero spends the entry: the game carries its id and nothing is settled', () => {
    const entry = enter();
    act(() => useGame.getState().pickHero(entry.heroChoices[0]!));
    const st = useGame.getState();
    expect(st.run.mode).toBe('lobby');
    expect(st.run.runId).toBe(entry.runId);
    expect(st.run.seed).toBe(entry.seed);
    expect(st.rankedEntry).toBeNull();
    expect(stored()).toBeNull();
    expect(queued()).toHaveLength(0);
  });

  it('Practice and Gauntlet hero selects keep a free, one-press Back', () => {
    for (const pendingMode of ['practice', 'gauntlet'] as const) {
      act(() => useGame.setState({ showTitle: false, pendingMode, heroChoices: ['aster', 'warden'], rankedEntry: null }));
      ui = mount(<HeroSelect />);
      press(document.querySelector<HTMLButtonElement>('.hsback')!);
      expect(useGame.getState().showTitle, pendingMode).toBe(true);
      ui.unmount(); ui = null;
    }
    expect(queued()).toHaveLength(0);
  });
});

describe('closing the game on hero select keeps the same heroes (no reroll, no penalty)', () => {
  it('the stored entry reads back whole, and a build that can no longer offer it drops it at no cost', () => {
    const entry: RankedEntry = { runId: 'r-entry', seed: 4242, heroChoices: ['aster', 'warden', 'brackus'], at: '2026-10-11T00:00:00.000Z' };
    saveRankedEntry(entry);
    expect(loadRankedEntry(() => true)).toEqual(entry);
    expect(loadRankedEntry(() => false), 'not offerable any more').toBeNull();
    expect(loadRankedEntry(() => true), 'and it was dropped, not kept').toBeNull();
    localStorage.setItem('ascent.rankedentry', '{"runId":7}');
    expect(loadRankedEntry(() => true), 'a malformed record is no entry').toBeNull();
    clearRankedEntry();
  });

  it('a live entry is RESUMED by the next Play: same id, same heroes, no second roll', () => {
    act(() => useGame.getState().startLobby());
    const first = useGame.getState().rankedEntry!;
    // The opponent wait was cancelled (or any door that is not Back): the title opens, the entry stays owed.
    act(() => useGame.getState().openTitle());
    expect(useGame.getState().rankedEntry).toEqual(first);
    expect(queued(), 'leaving that way is not an abandon').toHaveLength(0);
    act(() => useGame.getState().startLobby());
    const st = useGame.getState();
    expect(st.rankedEntry).toEqual(first);
    expect(st.heroChoices).toEqual(first.heroChoices);
    expect(st.pendingSeed).toBe(first.seed);
  });
});
