// @vitest-environment jsdom
/**
 * R-CAREER-ADD-FRIEND-01 + R-SETTINGS-ACCOUNT-TAG-01 (owner 2026-11-18), with the network faked.
 *
 * Add friend in another player's Career header: one press sends the request by player id and the button reads Request
 * sent; a friend reads Friends; a player who asked you gets Accept friend; a refusal says why beside the button; nothing
 * shows for yourself, a guest or a blocked player; the party home Career shows it on another player's page only.
 * Settings, Account: the name with its tag and a Copy button, for guests too, absent with no tag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../../../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../../../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../remoteBoards')>()), remoteEnabled: () => true }));

import { useGame } from '../../../store';
import { resetFriendsForTests, setFriendsRemoteForTests, useFriends } from '../../../friends/friendsStore';
import { FriendsError, type FriendsList, type FriendsRemote } from '../../../friends/friendsRemote';
import { __resetAddFriendAsk } from '../../../friends/AddFriendButton';
import { PhAddFriend } from './PhAddFriend';
import { PhCareer, type PhCareerProps } from './PhCareer';
import { PhSettings } from '../PhSettings';

const ME = '00000000-0000-0000-0000-000000000001';
const THEM = '00000000-0000-0000-0000-000000000002';
const card = (id: string) => ({ userId: id, author: 'Arivas', discriminator: '1234', avatar: null, favoriteHero: null, frame: null, skin: null, since: null });
const emptyList = (): FriendsList => ({ friends: [], incoming: [], outgoing: [], blocked: [], invites: [], sent: [], serverNow: new Date().toISOString() });

let fake: { list: FriendsList; requested: string[]; accepted: string[]; fail: string | null };
const fakeRemote = (): FriendsRemote => ({
  list: async () => fake.list,
  requestById: async (userId: string) => {
    if (fake.fail) throw new FriendsError(fake.fail);
    fake.requested.push(userId);
    fake.list = { ...fake.list, outgoing: [card(userId)] } as FriendsList;
    return { status: 'sent', userId };
  },
  respond: async (userId: string) => {
    fake.accepted.push(userId);
    fake.list = { ...fake.list, incoming: [], friends: [{ ...card(userId), status: 'offline', lastSeen: null }] } as unknown as FriendsList;
    return {};
  },
} as unknown as FriendsRemote);

let ui: Mounted | null = null;
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const account = (anonymous: boolean, discriminator: string | null = '4821'): void => {
  useGame.setState({ account: { userId: ME, email: anonymous ? null : 'a@b.c', anonymous, discriminator }, playerName: 'Kevin' });
};
const btn = (): HTMLButtonElement | null => ui!.container.querySelector<HTMLButtonElement>('.phc-addfriend button');
const show = async (userId: string = THEM): Promise<void> => { ui = mount(<PhAddFriend userId={userId} />); await flush(); };

beforeEach(() => {
  resetFriendsForTests(); __resetAddFriendAsk();
  fake = { list: emptyList(), requested: [], accepted: [], fail: null };
  setFriendsRemoteForTests(fakeRemote());
  account(false);
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); resetFriendsForTests(); });

describe('R-CAREER-ADD-FRIEND-01: Add friend in a Career header', () => {
  it('one press sends the request by player id, then reads Request sent and cannot be pressed again', async () => {
    await show();
    expect(btn()?.textContent).toBe('Add friend');
    expect(btn()?.disabled).toBe(false);
    act(() => { btn()!.click(); });
    await flush();
    expect(fake.requested).toEqual([THEM]);
    expect(btn()?.textContent).toBe('Request sent');
    expect(btn()?.disabled).toBe(true);
  });

  it('a friend reads Friends, with nothing to press', async () => {
    fake.list = { ...emptyList(), friends: [{ ...card(THEM), status: 'offline', lastSeen: null }] } as unknown as FriendsList;
    await show();
    expect(btn()?.textContent).toBe('Friends');
    expect(btn()?.disabled).toBe(true);
  });

  it('a request already sent reads Request sent', async () => {
    fake.list = { ...emptyList(), outgoing: [card(THEM)] } as FriendsList;
    await show();
    expect(btn()?.textContent).toBe('Request sent');
    expect(btn()?.disabled).toBe(true);
  });

  it('a player who already asked you gets Accept friend, and one press makes you friends', async () => {
    fake.list = { ...emptyList(), incoming: [card(THEM)] } as FriendsList;
    await show();
    expect(btn()?.textContent).toBe('Accept friend');
    act(() => { btn()!.click(); });
    await flush();
    expect(fake.accepted).toEqual([THEM]);
    expect(fake.requested).toEqual([]);
    expect(btn()?.textContent).toBe('Friends');
  });

  it('a refused request says why beside the button and leaves Add friend to press again', async () => {
    fake.fail = 'rate_limited';
    await show();
    act(() => { btn()!.click(); });
    await flush();
    expect(ui!.container.querySelector('.phc-addfriend-err')?.textContent).toBe('Slow down a little. Try again later.');
    expect(btn()?.textContent).toBe('Add friend');
    expect(btn()?.disabled).toBe(false);
  });

  it('shows nothing for yourself, for a guest, or for a blocked player', async () => {
    await show(ME);
    expect(btn()).toBeNull();
    ui!.unmount();
    account(true);
    await show();
    expect(btn()).toBeNull();
    ui!.unmount();
    account(false);
    useFriends.setState({ list: { ...emptyList(), blocked: [card(THEM)] } as FriendsList });
    await show();
    expect(btn()).toBeNull();
  });

  it('the party home Career shows it in the header of another player only, and uses no native tooltip', () => {
    const props = (over: Partial<PhCareerProps>): PhCareerProps => ({
      own: false, name: 'Arivas', loading: false, ready: true, back: null, title: null, addFriend: <button className="probe">Add friend</button>, pageState: null,
      profileArt: undefined, favoriteHero: 'Robin', level: null, onCreateAccount: null,
      stats: { games: 1, firsts: 0, top4Pct: 0, losses: 1, avgPlacement: 5, tribe: null },
      rank: null, mmr: 0, rankPending: false, userId: null, tab: 'trends', onTab: vi.fn(), achievementsOn: true, tabSub: '',
      history: { filter: null, state: null, view: null },
      heroes: { list: [], sort: 'games', onSort: vi.fn(), onPick: vi.fn(), art: () => undefined, state: null },
      trends: { window: 30, onWindow: vi.fn(), body: <div /> }, practice: { state: null, view: null }, achievements: null, ...over,
    } as PhCareerProps);
    ui = mount(<PhCareer {...props({})} />);
    expect(ui.container.querySelector('.phk-pagehead .phk-pageactions .probe')).not.toBeNull();
    expect(ui.container.querySelector('[title]')).toBeNull();
    ui.unmount();
    ui = mount(<PhCareer {...props({ own: true })} />);
    expect(ui.container.querySelector('.probe')).toBeNull();
  });
});

describe('R-SETTINGS-ACCOUNT-TAG-01: your name and tag in Settings, Account', () => {
  const openAccount = (): void => {
    act(() => { useGame.setState({ showTitle: true, settingsOpen: true } as never); });
    ui = mount(<PhSettings />);
    const tab = [...ui.container.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => t.textContent === 'Account')!;
    act(() => { tab.click(); });
  };
  const tagRow = (): HTMLElement | undefined => [...ui!.container.querySelectorAll<HTMLElement>('.phs-row')].find((r) => /#\d{4}/.test(r.querySelector('.phs-name')?.textContent ?? ''));

  it('shows name#tag with a Copy button that copies it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    openAccount();
    expect(tagRow()?.querySelector('.phs-name')?.textContent).toBe('Kevin#4821');
    const copy = tagRow()!.querySelector('button')!;
    expect(copy.textContent).toBe('Copy');
    act(() => { copy.click(); });
    await flush();
    expect(writeText).toHaveBeenCalledWith('Kevin#4821');
    expect(tagRow()!.querySelector('button')!.textContent).toBe('Copied');
  });

  it('a blocked clipboard says so and throws nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    openAccount();
    act(() => { tagRow()!.querySelector('button')!.click(); });
    await flush();
    expect(tagRow()!.querySelector('button')!.textContent).toBe('Could not copy');
  });

  it('a guest with a tag sees it too; with no tag yet the row is left out', () => {
    account(true);
    openAccount();
    expect(tagRow()?.querySelector('.phs-name')?.textContent).toBe('Kevin#4821');
    expect(tagRow()?.querySelector('.phs-note')?.textContent).toBe('Your name and tag. Sign in to add friends.');
    ui!.unmount();
    account(true, null);
    openAccount();
    expect(tagRow()).toBeUndefined();
  });
});
