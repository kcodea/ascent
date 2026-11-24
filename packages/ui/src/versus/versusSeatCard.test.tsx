// @vitest-environment jsdom
/**
 * VERSUS PLAYER CARDS (owner 2026-10-16: "for versus - we want to make the players actually show as cards, using their
 * portrait art as the minion art, their equipped title and name in the card text, their versus wins as the attack pill,
 * their versus losses as their health pill. it should use the equipped card plate they have equipped as well").
 * R-VERSUS-PLAYER-CARD-01. Pinned: wins -> Attack, losses -> Health, title -> the rules text, name -> the name line, the
 * avatar -> the art (else the favourite hero, else the default hero), the equipped plate on the REAL Card, the
 * opponent's skin and plate only through "Show opponent cosmetics", and the numbers re-read when the room's key moves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { TITLES } from '@game/progression';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

// The backend: a fake client whose `versus_records` answer the test moves between reads.
const backend = vi.hoisted(() => ({
  records: [] as unknown[],
  rpcError: null as null | { code: string; message: string },
  profiles: [] as unknown[],
  rpcCalls: 0,
  lastArgs: null as unknown,
  refuseRank: false,
  selects: [] as string[],
  /** A select this backend refuses (permission denied), by its column list; null = refuse nothing. */
  refuseCols: null as null | ((cols: string) => boolean),
  /** The session's "may read profiles.avatar" flag (remoteBoards' canReadProfileAvatar), owned by the fake so each test starts fresh. */
  avatarReadable: true,
}));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => {
    const q = {
      select: (cols?: string) => { q.cols = cols ?? ''; backend.selects.push(q.cols); return q; }, in: () => q, eq: () => q, or: () => q,
      cols: '',
      limit: () => Promise.resolve(backend.refuseRank && q.cols.includes('rank_division') ? { data: null, error: { code: '42703', message: 'no column' } }
        : backend.refuseCols?.(q.cols) ? { data: null, error: { code: '42501', message: 'permission denied for table profiles' } }
        : { data: backend.profiles, error: null }),
    };
    return q;
  };
  return {
    ...real,
    canReadProfileAvatar: () => backend.avatarReadable,
    noteProfileAvatarRead: (e: { code?: string } | null | undefined) => { if (e && (e.code === '42501' || e.code === '42703')) backend.avatarReadable = false; },
    supabaseClient: () => ({
      rpc: (_fn: string, args: unknown) => { backend.rpcCalls++; backend.lastArgs = args; return Promise.resolve(backend.rpcError ? { data: null, error: backend.rpcError } : { data: backend.records, error: null }); },
      from: () => query(),
    }),
  };
});

const { mount } = await import('../renderedText.mount');
const { AVATAR_ART, avatarSrc } = await import('../art');
const { heroArt } = await import('../art');
const { useGame } = await import('../store');
const { setIdentity } = await import('../identity');
const { DEFAULT_HERO_ID, RANK_SEASON, initialRankedProfile } = await import('@game/sim');
const { VersusPlayerCard } = await import('./VersusPlayerCard');
const { fetchSeatData, parseVersusRecords, playerCardArt, playerCardView, resetSeatCacheForTests, seatCardSource, seatRankOfRow, useSeatData } = await import('./versusSeatCard');

const TITLE_ID = Object.keys(TITLES)[0]!;
const TITLE = TITLES[TITLE_ID]!.name;
const AVATAR = AVATAR_ART[0]!.id;
const PLATE = { cardPlate: 'plate_aquarium_rocks', title: TITLE_ID };
const member = (profile: Record<string, unknown> = {}) => ({ userId: 'them', displayName: 'Orangez', profile, role: 'p2' as const, lastSeenAt: '' });

afterEach(() => { setIdentity(null); useGame.setState({ showOpponentSkins: true }); resetSeatCacheForTests(); backend.records = []; backend.rpcError = null; backend.profiles = []; backend.rpcCalls = 0; backend.refuseRank = false; backend.selects = []; backend.refuseCols = null; backend.avatarReadable = true; });

describe('a player card says who they are and how they do in Versus', () => {
  it('wins are the Attack, losses the Health, the title the text, the name the name line', () => {
    const v = playerCardView({ userId: 'u', name: 'LEMON', avatar: null, favoriteHero: null, titleId: TITLE_ID, cosmetics: null, record: { wins: 12, losses: 7 }, rank: null });
    expect(v.attack).toBe(12);
    expect(v.health).toBe(7);
    expect(v.text).toBe(TITLE);
    expect(v.name).toBe('LEMON');
    expect(v.spell).toBeUndefined();
    expect(v.keywords).toEqual([]);
  });

  it('fallbacks: no record reads 0 / 0, no title prints no text, an unknown title prints none', () => {
    expect(playerCardView({ userId: 'u', name: 'x', avatar: null, favoriteHero: null, titleId: null, cosmetics: null, record: null, rank: null })).toMatchObject({ attack: 0, health: 0, text: '' });
    expect(playerCardView({ userId: 'u', name: 'x', avatar: null, favoriteHero: null, titleId: 'title_from_the_future', cosmetics: null, record: null, rank: null }).text).toBe('');
  });

  it('the art: the chosen profile picture, else the favourite hero (the Leaderboard fallback), else the default hero', () => {
    expect(playerCardArt({ avatar: AVATAR, favoriteHero: 'indy', cosmetics: null })).toBe(avatarSrc(AVATAR));
    expect(playerCardArt({ avatar: null, favoriteHero: 'indy', cosmetics: null })).toBe(heroArt('indy'));
    expect(playerCardArt({ avatar: 'minion:not_a_card', favoriteHero: null, cosmetics: null })).toBe(heroArt(DEFAULT_HERO_ID));
    expect(playerCardView({ userId: 'u', name: 'x', avatar: null, favoriteHero: null, titleId: null, cosmetics: null, record: null, rank: null }).artUrl).toBe(heroArt(DEFAULT_HERO_ID));
  });

  it("an opponent's skins and plate show only through Show opponent cosmetics (their avatar and title always); yours always", () => {
    const m = member({ avatar: AVATAR, cosmetics: PLATE });
    const on = seatCardSource({ member: m, own: false, showOpp: true, server: { record: { wins: 2, losses: 1 }, favoriteHero: 'indy' } });
    expect(on).toMatchObject({ avatar: AVATAR, titleId: TITLE_ID, favoriteHero: 'indy', record: { wins: 2, losses: 1 } });
    expect(on.cosmetics?.cardPlate).toBe('plate_aquarium_rocks');
    const off = seatCardSource({ member: m, own: false, showOpp: false, server: { record: { wins: 2, losses: 1 }, favoriteHero: 'indy' } });
    expect(off).toMatchObject({ avatar: AVATAR, titleId: TITLE_ID, cosmetics: null, favoriteHero: 'indy', record: { wins: 2, losses: 1 } });
    // The server's live avatar / title win over the room profile's copy.
    expect(seatCardSource({ member: m, own: false, showOpp: true, server: { avatar: 'hero:indy', titleId: 'x' } })).toMatchObject({ avatar: 'hero:indy', titleId: 'x' });
    // Your own card reads your live values, switch or not.
    const mine = seatCardSource({ member: m, own: true, showOpp: false, server: undefined, self: { avatar: 'hero:indy', titleId: TITLE_ID, cosmetics: { cardPlate: 'plate_magma' } } });
    expect(mine).toMatchObject({ avatar: 'hero:indy', titleId: TITLE_ID, cosmetics: { cardPlate: 'plate_magma' } });
  });
});

describe('the seat is the REAL Card, in the equipped plate', () => {
  const render = (profile: Record<string, unknown>, server = { record: { wins: 31, losses: 4 } }) => mount(<VersusPlayerCard m={member(profile)} server={server} />);

  it('renders the game Card: name, title text, wins / losses in the normal badges, the avatar art, the plate', () => {
    setIdentity({ userId: 'me' } as never);
    useGame.setState({ showOpponentSkins: true });
    const ui = render({ avatar: AVATAR, cosmetics: PLATE });
    try {
      const card = document.querySelector('.vspcard-hold .card.plated')!;
      expect(card).not.toBeNull();
      expect(card.querySelector('.badge.atk .value')?.textContent).toBe('31');
      expect(card.querySelector('.badge.hp .value')?.textContent).toBe('4');
      expect(card.textContent).toContain('Orangez');
      expect(card.querySelector('.desc')?.textContent).toBe(TITLE);
      expect(card.querySelector('img.artimg')?.getAttribute('src')).toBe(avatarSrc(AVATAR));
      expect(card.querySelector('img.cardplate')?.getAttribute('src')).toContain('frames/plates/plate_aquarium_rocks.webp');
    } finally { ui.unmount(); }
  });

  it('Show opponent cosmetics off: the standard plate; the avatar, title and record stay', () => {
    setIdentity({ userId: 'me' } as never);
    useGame.setState({ showOpponentSkins: false });
    const ui = render({ avatar: AVATAR, cosmetics: PLATE });
    try {
      const card = document.querySelector('.vspcard-hold .card.plated')!;
      expect(card.querySelector('img.cardplate')?.getAttribute('src')).toContain('frames/cardplate-standard.webp');
      expect(card.querySelector('.desc')?.textContent).toBe(TITLE);
      expect(card.querySelector('img.artimg')?.getAttribute('src')).toBe(avatarSrc(AVATAR));
      expect(card.querySelector('.badge.atk .value')?.textContent).toBe('31'); // the record is not a cosmetic
    } finally { ui.unmount(); }
  });

  it('an unknown record (RPC not live yet) prints a dash, never a made-up 0', () => {
    setIdentity({ userId: 'me' } as never);
    const ui = mount(<VersusPlayerCard m={member({})} server={undefined} />);
    try {
      expect(document.querySelector('.vspcard-hold.vspcard-norec')).not.toBeNull();
      expect(document.querySelector('.vspcard-hold')?.getAttribute('aria-label')).toContain('loading');
    } finally { ui.unmount(); }
    const ui2 = render({});
    try { expect(document.querySelector('.vspcard-hold.vspcard-norec')).toBeNull(); } finally { ui2.unmount(); }
  });

  it('a click or right-click never opens Inspect', () => {
    setIdentity({ userId: 'me' } as never);
    const ui = render({});
    try {
      const before = useGame.getState().inspect;
      act(() => { document.querySelector('.vspcard-hold .card')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
      expect(useGame.getState().inspect).toBe(before);
    } finally { ui.unmount(); }
  });
});

describe('the numbers: one bounded read, refreshed when the room moves', () => {
  it('parses versus_records and ignores junk rows', () => {
    const m = parseVersusRecords([{ userId: 'a', wins: 3, losses: 2 }, { userId: 'b', wins: '4', losses: 0 }, { userId: 7 }, null]);
    expect([...m]).toEqual([['a', { wins: 3, losses: 2 }], ['b', { wins: 4, losses: 0 }]]);
    expect(parseVersusRecords(null).size).toBe(0);
  });

  it('reads every card in one batch (deduped, at most 24 ids: four group seats + 20 spectators), and keeps the last good numbers when a read fails', async () => {
    backend.records = [{ userId: 'a', wins: 5, losses: 1 }];
    backend.profiles = [{ user_id: 'a', favorite_hero: 'indy', equipped_title_id: TITLE_ID, avatar: AVATAR }];
    const first = await fetchSeatData(['a', 'a', 'b', 'c']);
    expect([...first.keys()]).toEqual(['a', 'b', 'c']);
    expect(backend.rpcCalls).toBe(1);
    const many = await fetchSeatData(Array.from({ length: 30 }, (_, i) => `u${i}`));
    expect(many.size).toBe(24);
    expect(first.get('a')).toEqual({ record: { wins: 5, losses: 1 }, favoriteHero: 'indy', titleId: TITLE_ID, avatar: AVATAR });
    backend.rpcError = { code: 'PGRST202', message: 'no function' }; // not deployed: no client-side count
    const second = await fetchSeatData(['a']);
    expect(second.get('a')?.record).toEqual({ wins: 5, losses: 1 });
  });

  it('a new key (the match ended, the room reopened) re-reads: the card shows the new record without a reload', async () => {
    function Probe({ k }: { k: string }) {
      const d = useSeatData(['a'], k);
      const r = d.get('a')?.record;
      return <span className="probe">{r ? `${r.wins}-${r.losses}` : 'none'}</span>;
    }
    backend.records = [{ userId: 'a', wins: 1, losses: 0 }];
    const ui = mount(<Probe k="a|open|m1" />);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(document.querySelector('.probe')?.textContent).toBe('1-0');
      backend.records = [{ userId: 'a', wins: 1, losses: 1 }];
      ui.render(<Probe k="a|open|m1" />); // same key: no read
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(document.querySelector('.probe')?.textContent).toBe('1-0');
      ui.render(<Probe k="a|open|m2" />); // the match ended
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(document.querySelector('.probe')?.textContent).toBe('1-1');
      expect(backend.rpcCalls).toBe(2);
    } finally { ui.unmount(); }
  });
});

describe('the stands: spectators as a hand of player cards (owner 2026-10-16)', () => {
  it('every spectator is a small real player card in the fan, read in ONE batched call with the seats', async () => {
    const { VersusRoom } = await import('./VersusRoom');
    const { useVersus } = await import('./versusStore');
    setIdentity({ userId: 'me' } as never);
    backend.records = [{ userId: 'me', wins: 2, losses: 2 }, { userId: 's1', wins: 12, losses: 4 }];
    const spec = (id: string) => ({ userId: id, role: 'spectator' as const, displayName: id, profile: {}, lastSeenAt: '' });
    useVersus.setState({ screen: 'room', match: null, room: { id: 'r', name: 'Room', host_user_id: 'me', status: 'open', members: [
      { userId: 'me', role: 'p1', displayName: 'LEMON', profile: {}, lastSeenAt: '' }, spec('s1'), spec('s2'), spec('s3'),
    ] } as never });
    const ui = mount(<VersusRoom />);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      // The hand: three slots placed by the hand's CSS, and the three spectators' own cards in the room's card layer
      // (R-VERSUS-ROOM-MOUNTED-01), each a real plated card.
      const fan = document.querySelectorAll('.vscards .vsbcard');
      expect(fan).toHaveLength(3);
      expect((document.querySelector('.vsbench') as HTMLElement).style.getPropertyValue('--n')).toBe('3');
      expect([...document.querySelectorAll('.vsbench .vsbslot')].map((f) => (f as HTMLElement).style.getPropertyValue('--off'))).toEqual(['-1', '0', '1']);
      expect(document.querySelectorAll('.vsbcard .vspcard-hold .card.plated')).toHaveLength(3);
      expect(fan[0]!.querySelector('.badge.atk .value')?.textContent).toBe('12');
      expect(backend.rpcCalls).toBe(1); // seats + spectators in one read, no N+1
      expect(backend.lastArgs).toEqual({ p_users: ['me', 's1', 's2', 's3'] });
      // An open seat is the recessed placeholder card (R-VERSUS-ROOM-POLISH-02). I am seated, so it offers no Join: it
      // says it is waiting (a spectator would see the slot itself as the Join).
      expect(document.querySelector('.vspcard-p2 .vspcard-empty .card.plated')).not.toBeNull();
      expect(document.querySelector('.vspcard-p2 .vstake')).toBeNull();
      expect(document.querySelector('.vspcard-p2 .vspcard-empty')?.textContent).toContain('Waiting for an opponent');
      // The host (me) wears the crown on my seat card; no Host pill under it.
      expect(document.querySelector('.vsmcard-p1 .vshostmark')).not.toBeNull();
    } finally { ui.unmount(); useVersus.setState({ room: null, screen: 'browser' } as never); }
  });

  it('the fan and its hover are transform-only, with no looping animation in the room', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const hover = /\.vsbcard:hover \.vsbcard-lift\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(hover).toMatch(/transform:/);
    expect(hover).not.toMatch(/filter|box-shadow|width|height|top|left/);
    // R-VERSUS-HAND-HOVER-01: the hover never moves what is hovered: the lift takes no pointer, the still pads do, and
    // what changes on hover is a transform or the pointer only.
    expect(/\.vsbcard-lift\s*\{([^}]*)\}/.exec(css)![1]).toMatch(/pointer-events:\s*none/);
    expect(/\.vsbcard \{([^}]*)\}/.exec(css)![1]).toMatch(/pointer-events:\s*none/);
    for (const m of css.matchAll(/\.vsbcard:hover \.vsbcard-(?:hit|hitup|band)\s*\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/top|left|width|height|background|filter|shadow/);
    const room = css.slice(css.indexOf('.vsvignette'), css.indexOf('/* Controls on the game'));
    expect(room).not.toMatch(/animation\s*:/);
  });
});

describe('every seat carries its rank (the showcase card)', () => {
  it('seatRankOfRow: the live season reads as it is', () => {
    expect(seatRankOfRow({ rank_season: RANK_SEASON, rank_division: 7, rank_points: 40 })).toEqual({ divisionIndex: 7, points: 40 });
  });
  it('seatRankOfRow: an older season reads as the fresh-season start', () => {
    const p = initialRankedProfile().position;
    expect(seatRankOfRow({ rank_season: 'old-season', rank_division: 12, rank_points: 80 })).toEqual({ divisionIndex: p.divisionIndex, points: p.points });
  });
  it('seatRankOfRow: a row without the rank columns (an older server, or a read that dropped them) is null', () => {
    expect(seatRankOfRow({ rank_season: null, rank_division: null })).toBeNull();
    expect(seatRankOfRow({ user_id: 'a' })).toBeNull();
  });
  it('seatRankOfRow: a never-ranked player (the column defaults, season 0) reads as the fresh-season start', () => {
    const p = initialRankedProfile().position;
    expect(seatRankOfRow({ rank_season: 0, rank_division: 0, rank_points: 0 })).toEqual({ divisionIndex: p.divisionIndex, points: p.points });
  });
  it('seatRankOfRow: a live-season row with an invalid position is null', () => {
    expect(seatRankOfRow({ rank_season: RANK_SEASON, rank_division: -1, rank_points: 0 })).toBeNull();
  });

  it('seatCardSource carries the server rank for anyone, and `self.rank` for you', () => {
    const rank = { divisionIndex: 3, points: 10 };
    expect(seatCardSource({ member: member(), own: false, showOpp: true, server: { rank } }).rank).toEqual(rank);
    expect(seatCardSource({ member: member(), own: false, showOpp: true, server: undefined }).rank).toBeNull();
    expect(seatCardSource({ member: member(), own: true, showOpp: true, server: { rank }, self: { avatar: null, titleId: null, cosmetics: null, rank: null } }).rank).toBeNull();
    expect(seatCardSource({ member: member(), own: true, showOpp: true, server: { rank }, self: { avatar: null, titleId: null, cosmetics: null, rank: { divisionIndex: 5, points: 2 } } }).rank).toEqual({ divisionIndex: 5, points: 2 });
    // A caller that does not pass `self.rank` falls back to what the server says.
    expect(seatCardSource({ member: member(), own: true, showOpp: true, server: { rank }, self: { avatar: null, titleId: null, cosmetics: null } }).rank).toEqual(rank);
  });

  it('fetchSeatData reads the rank, and keeps avatar + title when the rank columns are refused', async () => {
    backend.profiles = [{ user_id: 'a', favorite_hero: 'indy', equipped_title_id: TITLE_ID, rank_season: RANK_SEASON, rank_division: 4, rank_points: 20 }];
    expect((await fetchSeatData(['a'])).get('a')?.rank).toEqual({ divisionIndex: 4, points: 20 });
    resetSeatCacheForTests();
    backend.refuseRank = true;
    backend.profiles = [{ user_id: 'a', favorite_hero: 'indy', equipped_title_id: TITLE_ID }];
    const got = (await fetchSeatData(['a'])).get('a');
    expect(got?.titleId).toBe(TITLE_ID);
    expect(got?.rank).toBeUndefined();
    expect(backend.selects.some((c) => c.includes('rank_division'))).toBe(true);
  });

  // The cached seat object keeps its identity across reads while nothing changed (the room's cards are memoised on it,
  // R-VERSUS-ROOM-MOUNTED-01): an equal rank in a NEW object keeps it; a changed rank replaces it.
  it('an unchanged rank (same values, new object) keeps the cached seat object; a changed rank does not', async () => {
    const row = (d: number, p: number) => [{ user_id: 'a', favorite_hero: 'indy', equipped_title_id: TITLE_ID, rank_season: RANK_SEASON, rank_division: d, rank_points: p }];
    backend.profiles = row(4, 20);
    const first = (await fetchSeatData(['a'])).get('a')!;
    backend.profiles = row(4, 20);
    const same = (await fetchSeatData(['a'])).get('a')!;
    expect(same).toBe(first);
    backend.profiles = row(4, 21);
    const moved = (await fetchSeatData(['a'])).get('a')!;
    expect(moved).not.toBe(first);
    expect(moved.rank).toEqual({ divisionIndex: 4, points: 21 });
    backend.profiles = row(5, 21);
    expect((await fetchSeatData(['a'])).get('a')).not.toBe(moved);
  });

  // The fall-back chain (fetchProfiles): a refused avatar+rank read is blamed on the avatar ONLY once the rank-only read
  // succeeds. Blaming it too early would hide every player's chosen picture for the session over a rank-column problem.
  it('avatar + rank refused, rank alone fine: the avatar is marked unreadable and the rank still arrives', async () => {
    backend.refuseCols = (cols) => cols.includes('avatar');
    backend.profiles = [{ user_id: 'a', favorite_hero: 'indy', equipped_title_id: TITLE_ID, rank_season: RANK_SEASON, rank_division: 4, rank_points: 20 }];
    const got = (await fetchSeatData(['a'])).get('a');
    expect(backend.avatarReadable).toBe(false);
    expect(got?.rank).toEqual({ divisionIndex: 4, points: 20 });
    expect(got?.titleId).toBe(TITLE_ID);
    expect(backend.selects[0]).toContain('avatar');
    expect(backend.selects[1]).not.toContain('avatar');
    expect(backend.selects[1]).toContain('rank_division');
  });
  it('avatar + rank refused and rank alone refused too: the avatar is NOT blamed (its own read decides)', async () => {
    backend.refuseCols = (cols) => cols.includes('rank_division');
    backend.profiles = [{ user_id: 'a', favorite_hero: 'indy', equipped_title_id: TITLE_ID, avatar: AVATAR }];
    const got = (await fetchSeatData(['a'])).get('a');
    expect(backend.avatarReadable).toBe(true);
    expect(got?.avatar).toBe(AVATAR);
    expect(got?.rank).toBeUndefined();
    expect(backend.selects.slice(0, 3).map((c) => [c.includes('avatar'), c.includes('rank_division')])).toEqual([[true, true], [false, true], [true, false]]);
  });
});
