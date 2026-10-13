// @vitest-environment jsdom
/**
 * THE GUIDE CARD'S OWN ACTIONS (step 3). Under My guides a player publishes, unpublishes and deletes a guide from its
 * card. Pins: Publish asks first and Unpublish does not; the card wears its state; a refusal is a sentence on the
 * card and changes nothing; Delete asks, and a guide that is already gone simply leaves; nothing is offered on a
 * guide that is not the player's own, or while guides are offline.
 *
 * And what a keyboard player needs: a question takes focus on its safe answer, and focus goes back to the button the
 * question came from once it is answered; nothing on the card can be pressed twice while an answer is on its way.
 *
 * These tests never lay a page out, so the two layout rules the card depends on are pinned as stylesheet text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { SETS } from '@game/content';
import type { GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import type { GuideWriteResult } from './guidesRemote';

const published: Array<[string, boolean]> = [];
const deleted: string[] = [];
let publishAnswer: (rowId: string, on: boolean) => GuideWriteResult<GuideRecord>;
let deleteAnswer: () => GuideWriteResult<true>;
/** While set, a publish does not answer until this resolves. */
let hold: Promise<void> | null = null;
/** How many times the guides were read again from the server, and what a read of the player's own guides answers
 *  (`undefined`: could not ask, so the store keeps what it holds). Nothing in this file read the guides before a lost
 *  publish answer did, so the read answers "reached, nothing new" and leaves the store as each test set it. */
let reads = 0;
let mineRead: GuideRecord[] | undefined;
/** While set, the NEXT read of the player's own guides waits on this instead. */
let mineHold: Promise<GuideRecord[] | undefined> | null = null;
/** While true, a read cannot reach the server either (the connection is really gone). */
let readsFail = false;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => { reads++; return readsFail ? { state: 'offline' } : { state: 'on', guides: [] }; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => { if (mineHold) { const h = mineHold; mineHold = null; return h; } return mineRead; },
  fetchBookmarkedGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  fetchCommunityPage: async () => ({ guides: [], more: false }),
  communitySearch: (s: string) => s.trim(),
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
  bookmarkGuideRemote: async () => ({ ok: false, code: 'offline' }),
  setPublishedRemote: async (rowId: string, on: boolean) => { published.push([rowId, on]); if (hold) await hold; return publishAnswer(rowId, on); },
  deleteGuideRemote: async (rowId: string) => { deleted.push(rowId); return deleteAnswer(); },
  reportGuideRemote: async () => ({ ok: false, code: 'offline' }),
  setHiddenRemote: async () => ({ ok: false, code: 'offline' }),
  dismissReportsRemote: async () => ({ ok: false, code: 'offline' }),
  retagSetRemote: async () => ({ ok: false, code: 'offline' }),
  fetchOpenReports: async () => undefined,
  fetchHiddenGuides: async () => undefined,
  fetchGuideTags: async () => undefined,
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));

const { CompendiumGuides } = await import('./CompendiumGuides');
const { GUIDES } = await import('./guides');
const { loadGuides, resetGuidesForTests, useGuides } = await import('./guidesStore');
const { currentIdentity, setIdentity } = await import('../identity');
const prevIdentity = currentIdentity();

const ROW = '11111111-1111-4111-8111-111111111111';
const mineGuide = { ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, published: false, hidden: false, authorId: 'u-1', byline: 'Mike', title: 'My Sunmane', revision: 3 };
const serverList = GUIDES.map((g, i) => ({ ...g, rowId: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, revision: 1 }));
const rec = (patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id: ROW, slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: true, publishedAt: '2026-10-13T00:00:00Z', hidden: false,
  sets: ['set2'], tribes: [...mineGuide.tribes], pairsWith: [], iconCard: mineGuide.iconCard, title: 'My Sunmane', tagline: mineGuide.tagline,
  body: mineGuide.body, core: [...mineGuide.core], enablers: [...mineGuide.enablers], mentions: [], aliases: {}, forkedFrom: null,
  forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 3, createdAt: '', updatedAt: '', ...patch,
});

let ui: Mounted | null = null;
const prev = useGame.getState();
/** Mount the tab on My guides for player u-1 (or as told), drawing whatever the store's `mine` holds. */
function Host(): JSX.Element {
  const mine = useGuides((s) => s.mine);
  const tab = useGuides((s) => s.tab);
  const list = useGuides((s) => s.list);
  return <CompendiumGuides guides={tab === 'mine' ? mine : list} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" />;
}
const show = (patch: Partial<ReturnType<typeof useGuides.getState>> = {}, who: 'player' | 'guest' = 'player', strict = false): HTMLElement => {
  act(() => {
    useGame.setState({ account: { userId: who === 'guest' ? 'g-1' : 'u-1', email: who === 'guest' ? null : 'm@example.test', anonymous: who === 'guest', discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', list: serverList, team: false, mine: [mineGuide], mineOwner: 'u-1', tab: 'mine', ...patch });
  });
  setIdentity({ userId: who === 'guest' ? 'g-1' : 'u-1', displayName: 'Mike', anonymous: who === 'guest', email: who === 'guest' ? null : 'm@example.test' });
  ui = mount(strict ? <StrictMode><Host /></StrictMode> : <Host />);
  return ui.container;
};
const card = (c: HTMLElement, id = ROW): HTMLElement => c.querySelector<HTMLElement>(`.bookguide[data-guide="${id}"]`)!;
/** A browser takes focus off a button that has just been switched off; this test environment leaves it there (and
 *  will not blur it). So move focus to the page the way a browser would. */
const dropFocus = (): void => {
  const t = document.createElement('button');
  document.body.appendChild(t);
  t.focus();
  t.blur();
  t.remove();
};
const button = (el: Element, text: string): HTMLButtonElement | undefined => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = async (el: Element, text: string): Promise<void> => {
  const b = button(el, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const badges = (el: Element): string[] => [...el.querySelectorAll('.bookguide-badge')].map((b) => b.textContent ?? '');
/** The card's own buttons (its header row), never the ones inside a question. */
const own = (c: HTMLElement, text: string): HTMLButtonElement | undefined => button(card(c).querySelector('.bookguide-actions')!, text);
/** The question the card is asking. */
const asked = (c: HTMLElement): HTMLElement => card(c).querySelector<HTMLElement>('.bookguide-ask[role="group"]')!;

beforeEach(async () => {
  localStorage.clear();
  resetGuidesForTests();
  published.length = 0; deleted.length = 0;
  hold = null;
  // As the game does when an account lands: the store is told who is at the keyboard. A read asked for later (a lost
  // publish answer) is then a refresh for the same account, not an account change that clears its guides.
  mineRead = undefined; readsFail = false; mineHold = null;
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  await loadGuides();
  reads = 0;
  publishAnswer = (_id, on) => ({ ok: true, value: rec({ published: on }) });
  deleteAnswer = () => ({ ok: true, value: true });
});
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName }); });
  setIdentity(prevIdentity);
});

describe('publishing from the card', () => {
  it('a private guide of the player wears Private and offers Publish and Delete beside Edit and Duplicate', () => {
    const c = show();
    expect(badges(card(c))).toContain('Private');
    for (const t of ['Edit', 'Duplicate', 'Publish', 'Delete']) expect(button(card(c), t), t).toBeDefined();
    expect(button(card(c), 'Unpublish')).toBeUndefined();
  });
  it('Publish asks first; Cancel changes nothing', async () => {
    const c = show();
    await press(card(c), 'Publish');
    expect(card(c).textContent).toContain('Publish this guide? Everyone will be able to read it.');
    expect(published).toEqual([]);
    await press(card(c), 'Cancel');
    expect(card(c).textContent).not.toContain('Everyone will be able to read it.');
    expect(published).toEqual([]);
  });
  it('confirming publishes; the card then reads Published and offers Unpublish', async () => {
    const c = show();
    await press(card(c), 'Publish');
    await press(card(c).querySelector('.bookguide-ask')!, 'Publish');
    expect(published).toEqual([[ROW, true]]);
    expect(useGuides.getState().mine[0]!.published).toBe(true);
    expect(badges(card(c))).toContain('Published');
    expect(badges(card(c))).not.toContain('Private');
    expect(button(card(c), 'Unpublish')).toBeDefined();
  });
  it('Unpublish does not ask', async () => {
    const c = show({ mine: [{ ...mineGuide, published: true, publishedAt: '2026-10-13T00:00:00Z' }] });
    await press(card(c), 'Unpublish');
    expect(published).toEqual([[ROW, false]]);
    expect(badges(card(c))).toContain('Private');
  });
  it('an unpublish that did not work never says to publish, says nothing was changed for no answer at all, and the guide stays published until the server says otherwise', async () => {
    const c = show({ mine: [{ ...mineGuide, published: true, publishedAt: '2026-10-13T00:00:00Z' }] });
    for (const [code, sentence] of [
      ['offline', 'Could not reach the server. Check again in a moment to see whether it changed.'],
      ['not_found', 'This guide no longer exists.'],
      ['not_allowed', 'You cannot change this guide. Duplicate it to make your own.'],
      ['server', 'Something went wrong. Check again in a moment to see whether it changed.'],
      ['guide_malformed', 'Something went wrong. Check again in a moment to see whether it changed.'],
      ['blocked_text', 'Something went wrong. Check again in a moment to see whether it changed.'],
    ] as const) {
      publishAnswer = () => ({ ok: false, code, field: 'title' });
      await press(card(c), 'Unpublish');
      expect(card(c).querySelector('[role="alert"]')!.textContent, code).toBe(sentence);
      expect(useGuides.getState().mine[0]!.published, code).toBe(true);
      expect(badges(card(c)), code).toContain('Published');
    }
  });
  it('a refused publish is a sentence on the card, and the guide stays private', async () => {
    publishAnswer = () => ({ ok: false, code: 'reserved_name', field: 'title' });
    const c = show();
    await press(card(c), 'Publish');
    await press(card(c).querySelector('.bookguide-ask')!, 'Publish');
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('The title uses a reserved name. Edit the guide, then publish it.');
    expect(useGuides.getState().mine[0]!.published).toBe(false);
    expect(badges(card(c))).toContain('Private');
  });
  it('a publish whose answer is lost never says nothing was changed, and the guides are read again', async () => {
    publishAnswer = () => ({ ok: false, code: 'offline' });
    const c = show();
    await press(card(c), 'Publish');
    expect(reads).toBe(0);
    await press(asked(c), 'Publish');
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(reads).toBe(1);
    // The read could not ask for the player's own guides: the card keeps what it showed.
    expect(badges(card(c))).toContain('Private');
  });
  it('an unpublish whose answer is lost reads the guides again too', async () => {
    publishAnswer = () => ({ ok: false, code: 'offline' });
    const c = show({ mine: [{ ...mineGuide, published: true, publishedAt: '2026-10-13T00:00:00Z' }] });
    await press(card(c), 'Unpublish');
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(reads).toBe(1);
  });
  it('the publish did land: once the server is reached the card reads Published', async () => {
    publishAnswer = () => ({ ok: false, code: 'offline' });
    mineRead = [rec({ published: true })];
    const c = show();
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(reads).toBe(1);
    expect(useGuides.getState().mine[0]!.published).toBe(true);
    expect(badges(card(c))).toContain('Published');
    expect(badges(card(c))).not.toContain('Private');
    expect(own(c, 'Unpublish')).toBeDefined();
  });
  it('a publish whose answer is lost while an older read is still on its way ends with what the server holds', async () => {
    publishAnswer = () => ({ ok: false, code: 'offline' });
    const c = show();
    // A read begins before the publish. It will answer what was true when it was asked: private.
    let release: (g: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { release = r; });
    let older: Promise<void> = Promise.resolve();
    await act(async () => { older = loadGuides(); await new Promise((r) => setTimeout(r, 0)); });
    mineRead = [rec({ published: true })]; // the publish did land: what a read made after it finds
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(published).toEqual([[ROW, true]]);
    await act(async () => { release([rec({ published: false, publishedAt: null })]); await older; await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(badges(card(c))).toContain('Published');
    expect(badges(card(c))).not.toContain('Private');
    expect(own(c, 'Unpublish')).toBeDefined();
  });
  it('the connection is really gone: the read fails too, the sentence stays on the card, and the tab says guides are offline', async () => {
    publishAnswer = () => ({ ok: false, code: 'offline' });
    const c = show();
    await press(card(c), 'Publish');
    readsFail = true;
    await press(asked(c), 'Publish');
    expect(reads).toBe(1);
    expect(useGuides.getState().capability).toBe('offline');
    // Nothing the player had is taken away: the guide is still listed, as it was.
    expect(useGuides.getState().mine.map((g) => g.rowId)).toEqual([ROW]);
    expect(badges(card(c))).toContain('Private');
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(c.textContent).toContain('Guides are offline.');
    expect(own(c, 'Publish')!.disabled).toBe(true);
  });
  it('a publish answered with anything that is not a known refusal may have landed: it says to check again and the guides are read again', async () => {
    // `guide_malformed`: the publish was made and the guide it answered could not be read. `guide_failed`: the
    // function's call to the database failed or lost its answer. `server`: an answer this build cannot use.
    for (const code of ['guide_malformed', 'guide_failed', 'server', 'unavailable', 'something_new']) {
      ui?.unmount();
      reads = 0;
      publishAnswer = () => ({ ok: false, code, field: 'title' });
      const c = show();
      await press(card(c), 'Publish');
      await press(asked(c), 'Publish');
      expect(card(c).querySelector('[role="alert"]')!.textContent, code).toBe('Something went wrong. Check again in a moment to see whether it changed.');
      expect(reads, code).toBe(1);
      expect(badges(card(c)), code).toContain('Private'); // the read could not ask for the player's own guides
    }
  });
  it('an unpublish answered with anything that is not a known refusal reads the guides again too', async () => {
    for (const code of ['guide_malformed', 'guide_failed', 'server', 'something_new', 'conflict']) {
      ui?.unmount();
      reads = 0;
      publishAnswer = () => ({ ok: false, code });
      const c = show({ mine: [{ ...mineGuide, published: true, publishedAt: '2026-10-13T00:00:00Z' }] });
      await press(card(c), 'Unpublish');
      expect(card(c).querySelector('[role="alert"]')!.textContent, code).toBe('Something went wrong. Check again in a moment to see whether it changed.');
      expect(reads, code).toBe(1);
    }
  });
  it('the publish did land though its answer could not be read: the read that follows shows the card as Published', async () => {
    publishAnswer = () => ({ ok: false, code: 'guide_malformed' });
    mineRead = [rec({ published: true })];
    const c = show();
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(reads).toBe(1);
    expect(useGuides.getState().mine[0]!.published).toBe(true);
    expect(badges(card(c))).toContain('Published');
    expect(badges(card(c))).not.toContain('Private');
    expect(own(c, 'Unpublish')).toBeDefined();
    // The sentence is still there to be read: nothing in it is untrue.
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment to see whether it changed.');
  });
  it('an unpublish the server refused asks for no read', async () => {
    for (const code of ['not_found', 'not_allowed', 'sign_in_required', 'unauthenticated']) {
      ui?.unmount();
      publishAnswer = () => ({ ok: false, code });
      const c = show({ mine: [{ ...mineGuide, published: true, publishedAt: '2026-10-13T00:00:00Z' }] });
      await press(card(c), 'Unpublish');
      expect(card(c).querySelector('[role="alert"]'), code).not.toBeNull();
    }
    expect(reads).toBe(0);
  });
  it('a publish the server refused asks for no read', async () => {
    for (const code of ['reserved_name', 'blocked_text', 'guide_hidden', 'conflict', 'rate_limited', 'not_found', 'not_allowed', 'sign_in_required', 'unauthenticated']) {
      ui?.unmount();
      publishAnswer = () => ({ ok: false, code, field: 'title' });
      const c = show();
      await press(card(c), 'Publish');
      await press(asked(c), 'Publish');
      expect(card(c).querySelector('[role="alert"]'), code).not.toBeNull();
    }
    expect(reads).toBe(0);
  });
  it('a guide the team has hidden says so and cannot be published', () => {
    const c = show({ mine: [{ ...mineGuide, hidden: true }] });
    expect(badges(card(c))).toContain('Hidden by Team Ascent');
    expect(button(card(c), 'Publish')!.disabled).toBe(true);
  });
  it('a published guide with bookmarks says how many', () => {
    const c = show({ mine: [{ ...mineGuide, published: true, bookmarkCount: 2 }] });
    expect(badges(card(c))).toContain('2 bookmarks');
    act(() => { useGuides.setState({ mine: [{ ...mineGuide, published: true, bookmarkCount: 1 }] }); });
    expect(badges(card(c))).toContain('1 bookmark');
  });
  it('while a publish is on its way the card says it is busy and none of its buttons can be pressed', async () => {
    let answer!: () => void;
    hold = new Promise<void>((r) => { answer = r; });
    const c = show();
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(card(c).getAttribute('aria-busy')).toBe('true');
    expect(card(c).querySelector('.bookguide-ask')).toBeNull();
    for (const t of ['Edit', 'Duplicate', 'Publish', 'Delete']) expect(own(c, t)!.disabled, t).toBe(true);
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    expect(published).toEqual([[ROW, true]]);
    expect(card(c).hasAttribute('aria-busy')).toBe(false);
    expect(own(c, 'Unpublish')!.disabled).toBe(false);
  });
  it('a card drawn twice by React in development still comes back from an action', async () => {
    const c = show({}, 'player', true);
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(card(c).hasAttribute('aria-busy')).toBe(false);
    expect(own(c, 'Unpublish')!.disabled).toBe(false);
  });
});

describe('deleting from the card', () => {
  it('Delete asks; Keep it changes nothing', async () => {
    const c = show();
    await press(card(c), 'Delete');
    expect(card(c).textContent).toContain('Delete this guide? It cannot be brought back.');
    await press(card(c), 'Keep it');
    expect(deleted).toEqual([]);
    expect(card(c)).not.toBeNull();
  });
  it('Delete for good removes the guide from My guides', async () => {
    const c = show();
    await press(card(c), 'Delete');
    await press(card(c), 'Delete for good');
    expect(deleted).toEqual([ROW]);
    expect(useGuides.getState().mine).toEqual([]);
    expect(c.querySelector(`.bookguide[data-guide="${ROW}"]`)).toBeNull();
  });
  it('a guide that is already gone on the server just leaves', async () => {
    deleteAnswer = () => ({ ok: false, code: 'not_found' });
    const c = show();
    await press(card(c), 'Delete');
    await press(card(c), 'Delete for good');
    expect(useGuides.getState().mine).toEqual([]);
  });
  it('a delete whose answer was lost is not told as a failure: it says to check, keeps the guide and reads the guides again', async () => {
    deleteAnswer = () => ({ ok: false, code: 'offline' });
    const c = show();
    await press(card(c), 'Delete');
    await press(card(c), 'Delete for good');
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it was deleted.');
    expect(useGuides.getState().mine.length).toBe(1);
    expect(reads).toBe(1);
  });
  it('a delete whose answer came and could not be read is not told as a failure either: it says to check, keeps the guide and reads the guides again', async () => {
    deleteAnswer = () => ({ ok: false, code: 'server' });
    const c = show();
    await press(card(c), 'Delete');
    await press(card(c), 'Delete for good');
    expect(card(c).querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment to see whether it was deleted.');
    expect(useGuides.getState().mine.length).toBe(1);
    expect(reads).toBe(1);
  });
  it('a delete the server refused keeps the guide and reads nothing again', async () => {
    for (const [code, sentence] of [
      ['not_allowed', 'You cannot change this guide. Duplicate it to make your own.'],
      ['sign_in_required', 'Sign in to write guides.'],
      ['unauthenticated', 'Sign in to write guides.'],
    ] as const) {
      ui?.unmount();
      deleteAnswer = () => ({ ok: false, code });
      const c = show();
      await press(card(c), 'Delete');
      await press(card(c), 'Delete for good');
      expect(card(c).querySelector('[role="alert"]')!.textContent, code).toBe(sentence);
      expect(useGuides.getState().mine.length, code).toBe(1);
    }
    expect(reads).toBe(0);
  });
  it('a delete answered with anything that is not a known refusal may have landed: it says to check, keeps the guide and reads the guides again', async () => {
    for (const code of ['guide_malformed', 'guide_failed', 'unavailable', 'something_new', 'rate_limited']) {
      ui?.unmount();
      reads = 0;
      deleteAnswer = () => ({ ok: false, code });
      const c = show();
      await press(card(c), 'Delete');
      await press(card(c), 'Delete for good');
      expect(card(c).querySelector('[role="alert"]')!.textContent, code).toBe('Something went wrong. Check again in a moment to see whether it was deleted.');
      expect(useGuides.getState().mine.length, code).toBe(1);
      expect(reads, code).toBe(1);
    }
  });
  it('the delete did land though its answer was no "deleted": the read that follows takes the guide off the list', async () => {
    deleteAnswer = () => ({ ok: false, code: 'guide_failed' });
    mineRead = []; // what the server holds once the delete has landed
    const c = show();
    await press(card(c), 'Delete');
    await press(card(c), 'Delete for good');
    expect(reads).toBe(1);
    expect(useGuides.getState().mine).toEqual([]);
    expect(c.querySelector(`.bookguide[data-guide="${ROW}"]`)).toBeNull();
  });
});

describe('a question on the card, by keyboard', () => {
  it('Publish puts focus on Cancel; Cancel hands it back to the card\'s Publish button', async () => {
    const c = show();
    await press(card(c), 'Publish');
    expect(document.activeElement).toBe(button(asked(c), 'Cancel'));
    await press(asked(c), 'Cancel');
    expect(own(c, 'Publish')).toBeDefined();
    expect(document.activeElement).toBe(own(c, 'Publish'));
  });
  it('Delete puts focus on Keep it; Keep it hands it back to the card\'s Delete button', async () => {
    const c = show();
    await press(card(c), 'Delete');
    expect(document.activeElement).toBe(button(asked(c), 'Keep it'));
    await press(asked(c), 'Keep it');
    expect(own(c, 'Delete')).toBeDefined();
    expect(document.activeElement).toBe(own(c, 'Delete'));
  });
  it('one question replaces the other, and focus follows it', async () => {
    const c = show();
    await press(card(c), 'Publish');
    await press(card(c), 'Delete');
    expect(card(c).querySelectorAll('.bookguide-ask').length).toBe(1);
    expect(card(c).textContent).not.toContain('Everyone will be able to read it.');
    expect(document.activeElement).toBe(button(asked(c), 'Keep it'));
    await press(asked(c), 'Keep it');
    expect(document.activeElement).toBe(own(c, 'Delete'));
  });
  it('after a confirmed publish focus is on the button that now reads Unpublish', async () => {
    const c = show();
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(own(c, 'Unpublish')).toBeDefined();
    expect(document.activeElement).toBe(own(c, 'Unpublish'));
  });
  it('after a refused publish or delete focus is back on the button that was pressed', async () => {
    publishAnswer = () => ({ ok: false, code: 'offline' });
    deleteAnswer = () => ({ ok: false, code: 'offline' });
    const c = show();
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    expect(document.activeElement).toBe(own(c, 'Publish'));
    await press(card(c), 'Delete');
    await press(asked(c), 'Delete for good');
    expect(document.activeElement).toBe(own(c, 'Delete'));
  });
  it('Unpublish asks nothing, so its button is switched off while it waits: focus comes back to it when the server has answered', async () => {
    for (const refused of [false, true]) {
      ui?.unmount();
      let answer!: () => void;
      hold = new Promise<void>((r) => { answer = r; });
      if (refused) publishAnswer = () => ({ ok: false, code: 'offline' });
      const c = show({ mine: [{ ...mineGuide, published: true, publishedAt: '2026-10-13T00:00:00Z' }] });
      own(c, 'Unpublish')!.focus();
      await press(card(c), 'Unpublish');
      expect(own(c, 'Unpublish')!.disabled).toBe(true);
      dropFocus();
      expect(document.activeElement).toBe(document.body);
      await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
      const back = own(c, refused ? 'Unpublish' : 'Publish')!;
      expect(back.disabled, String(refused)).toBe(false);
      expect(document.activeElement, String(refused)).toBe(back);
      hold = null;
    }
  });
  it('focus is not pulled back to a card the player has already left', async () => {
    let answer!: () => void;
    hold = new Promise<void>((r) => { answer = r; });
    const c = show();
    await press(card(c), 'Publish');
    await press(asked(c), 'Publish');
    const elsewhere = button(c, 'New guide')!;
    elsewhere.focus();
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    expect(own(c, 'Unpublish')).toBeDefined();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('who is offered what', () => {
  it('a Team Ascent guide offers a player neither Publish nor Delete', () => {
    const c = show({ tab: 'team' });
    const first = c.querySelector<HTMLElement>('.bookguide')!;
    expect(button(first, 'Publish')).toBeUndefined();
    expect(button(first, 'Delete')).toBeUndefined();
    expect(button(first, 'Duplicate')).toBeDefined();
  });
  it('offline, Publish and Delete are drawn but cannot be pressed', () => {
    const c = show({ capability: 'offline' });
    expect(button(card(c), 'Publish')!.disabled).toBe(true);
    expect(button(card(c), 'Delete')!.disabled).toBe(true);
  });
  // Publish, Unpublish and Delete are for the player's OWN guide only. Each case below fails if its part of that
  // rule is dropped: the author, the server row, the signed-in account.
  const ownOnly = ['Publish', 'Unpublish', 'Delete'];
  it("another author's guide shown under My guides offers none of Publish, Unpublish, Delete", () => {
    for (const isPublished of [false, true]) {
      ui?.unmount();
      const c = show({ mine: [{ ...mineGuide, authorId: 'u-9', published: isPublished }] });
      expect(card(c)).not.toBeNull();
      for (const t of ownOnly) expect(button(card(c), t), `${t} ${String(isPublished)}`).toBeUndefined();
      expect(button(card(c), 'Duplicate')).toBeDefined();
    }
  });
  it("the player's guide with no server row offers none of Publish, Unpublish, Delete", () => {
    for (const isPublished of [false, true]) {
      ui?.unmount();
      const c = show({ mine: [{ ...mineGuide, rowId: null, published: isPublished }] });
      expect(card(c)).not.toBeNull();
      for (const t of ownOnly) expect(button(card(c), t), `${t} ${String(isPublished)}`).toBeUndefined();
      expect(button(card(c), 'Duplicate')).toBeDefined();
    }
  });
  it('a guest looking at a list that holds a guide that is not Team Ascent\'s is offered none of Publish, Unpublish, Delete', () => {
    for (const isPublished of [false, true]) {
      ui?.unmount();
      // The strongest case: the store holds the guide for the guest's own id, and the guide names that id as its author.
      const c = show({ mine: [{ ...mineGuide, authorId: 'g-1', published: isPublished }], mineOwner: 'g-1' }, 'guest');
      expect(card(c)).not.toBeNull();
      for (const t of ownOnly) expect(button(card(c), t), `${t} ${String(isPublished)}`).toBeUndefined();
      expect(button(card(c), 'Duplicate')).toBeDefined();
    }
  });
  it('the guest line names the three things an account is for', async () => {
    const c = show({ mine: [], mineOwner: null, tab: 'team' }, 'guest');
    await press(c, 'New guide');
    expect(c.querySelector('.gtool-signin')!.textContent).toContain('Sign in to write, bookmark and report guides. It is free and takes a minute.');
  });
});

describe('the two layout rules the card depends on', () => {
  const css = readFileSync(join(__dirname, 'compendiumGuides.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** One rule's text, found by its whole selector at the start of a line. */
  const rule = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at + 1, css.indexOf('}', at) + 1);
  };
  it('the buttons are two across, so four of them are two rows beside the title, and a lone one keeps its width', () => {
    expect(rule('.bookguide-actions')).toContain('display: grid');
    expect(rule('.bookguide-actions')).toContain('grid-template-columns: repeat(2, auto)');
    expect(rule('.bookguide-actions > :only-child')).toContain('grid-column: 1 / -1');
  });
  it('a question does not stretch down the card, sits inside the side padding, and adds no look of its own', () => {
    const ask = rule('.bookguide-ask');
    expect(ask).toContain('flex: none');
    // The card is a column; the toolbar note's own rule would give the question the card's spare height.
    expect(rule('.bookguide')).toContain('flex-direction: column');
    expect(rule('.gtool-note')).toContain('flex: 1 1 100%');
    expect(css.indexOf('\n.bookguide-ask {')).toBeGreaterThan(css.indexOf('\n.gtool-note {'));
    const side = /padding: \d+px (\d+px)/.exec(rule('.bookguide-body'))![1];
    expect(side).toBe('26px');
    expect(ask).toContain(`margin: 20px ${side} 0`);
    expect(ask).not.toMatch(/color|background|border|font|cursor/);
  });
});
