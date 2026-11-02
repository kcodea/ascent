import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { VersusMember, VersusRoom, VersusRoomSummary } from '../../versus/versusRemote';
import {
  defaultRoomName, hostSitsFirst, openSeatText, roomCounts, roomJoin, roomModeOf, roomStartOf, roomTitleOf, seatedOf, seatTeams, visibleRooms,
} from './versusPh';

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const summary = (id: string, p: Partial<VersusRoomSummary> = {}): VersusRoomSummary => ({
  id, name: id, status: 'open', setId: 's', contentRevision: 'r', protocol: 1, createdAt: '', currentMatchId: null, hostName: 'H', hostProfile: null,
  players: 1, spectators: 0, maxPlayers: 2, options: { v: 1, mode: 'duel', modifiers: [] }, ...p,
});
const member = (userId: string, role: VersusMember['role']): VersusMember => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const room = (members: VersusMember[], p: Partial<VersusRoom> = {}): VersusRoom => ({
  id: 'r', name: 'R', host_user_id: 'me', status: 'open', set_id: 's', content_revision: 'c', protocol: 1, revision: 1, gate_deadline: null,
  p1_gate: false, p2_gate: false, current_match_id: null, members, ...p,
} as VersusRoom);

describe('Versus on the party home shell (pure half)', () => {
  it('every kit name the Versus pages import is exported by the kit', async () => {
    const kit = await import('../kit');
    for (const f of ['./VersusBrowserPh.tsx', './VersusRoomPh.tsx']) {
      const m = here(f).match(/import \{([^}]+)\} from '\.\.\/kit';/);
      expect(m, f).toBeTruthy();
      for (const name of m![1]!.split(',').map((x) => x.trim()).filter(Boolean)) expect(kit, `${f} imports ${name}`).toHaveProperty(name);
    }
  });

  it('filters rooms by mode with counts, and lists rooms you can sit in first (server order kept within each group)', () => {
    const rooms = [
      summary('running', { status: 'in_game', players: 2 }),
      summary('full', { players: 2 }),
      summary('group', { maxPlayers: 4, players: 2, options: { v: 1, mode: 'group', modifiers: [] } }),
      summary('duel'),
      summary('duos', { maxPlayers: 4, options: { v: 1, mode: 'duos', modifiers: [] } }),
    ];
    expect(roomCounts(rooms)).toEqual({ all: 5, duel: 3, group: 1, duos: 1 });
    expect(visibleRooms(rooms, 'all').map((r) => r.id)).toEqual(['group', 'duel', 'duos', 'full', 'running']);
    expect(visibleRooms(rooms, 'duel').map((r) => r.id)).toEqual(['duel', 'full', 'running']);
  });

  it('Join a room with a free seat, Watch a full or running one (the classic browser rule)', () => {
    expect(roomJoin(summary('a'))).toEqual({ label: 'Join', as: 'player', primary: true });
    expect(roomJoin(summary('a', { players: 2 }))).toEqual({ label: 'Join', as: 'spectator', primary: false });
    expect(roomJoin(summary('a', { status: 'in_game' }))).toEqual({ label: 'Watch', as: 'spectator', primary: false });
  });

  it('a room title matches its mode (critic round 3: a 1v1 room was titled "Duos room")', () => {
    expect(roomTitleOf('Duos room', 'duel')).toBe('Versus room');
    expect(roomTitleOf('Duos party', 'group')).toBe('Group room');
    expect(roomTitleOf('', 'duos')).toBe('Duos room');
    expect(roomTitleOf("Kevin's room", 'duos')).toBe("Kevin's room");
    expect(defaultRoomName('', 'group')).toBe('Group room');
    expect(defaultRoomName('Kevin', 'group')).toBe("Kevin's room");
  });

  it('lays the seats out per mode: 1v1 two sides, Group four free seats, Duos two teams of two', () => {
    expect(seatTeams('duel')).toEqual([['p1'], ['p2']]);
    expect(seatTeams('group')).toEqual([['p1', 'p2', 'p3', 'p4']]);
    expect(seatTeams('duos')).toEqual([['p1', 'p2'], ['p3', 'p4']]);
    expect(roomModeOf({ v: 1, mode: 'ranked_duos', modifiers: [] })).toBe('duel');
    const seated = seatedOf(room([member('me', 'p2'), member('x', 'spectator')]), 'duel');
    expect([...seated.entries()].map(([s, m]) => `${s}:${m?.userId ?? '-'}`)).toEqual(['p1:-', 'p2:me']);
  });

  it('the host sits by default only in a fresh room they are alone in (critic round 3)', () => {
    expect(hostSitsFirst(room([member('me', 'spectator')]), 'me')).toBe(true);
    expect(hostSitsFirst(room([member('me', 'spectator'), member('x', 'spectator')]), 'me')).toBe(false);
    expect(hostSitsFirst(room([member('me', 'p1')]), 'me')).toBe(false);
    expect(hostSitsFirst(room([member('me', 'spectator')], { host_user_id: 'x' }), 'me')).toBe(false);
    expect(hostSitsFirst(room([member('me', 'spectator')], { status: 'in_game' }), 'me')).toBe(false);
  });

  it('START: the host once enough sit; everyone else reads what they wait for; a spectator watches a live round', () => {
    const base = { status: 'open' as const, host: true, isPlayer: true, running: false, phase: null, round: null, gateLeft: null };
    expect(roomStartOf({ ...base, mode: 'duel', seated: 1 })).toMatchObject({ canStart: false, note: 'Waiting for an opponent.' });
    expect(roomStartOf({ ...base, mode: 'duel', seated: 2 })).toMatchObject({ canStart: true, label: 'Start' });
    expect(roomStartOf({ ...base, mode: 'duel', seated: 2, host: false })).toMatchObject({ canStart: false, note: 'The host starts the match.' });
    expect(roomStartOf({ ...base, mode: 'group', seated: 3 })).toMatchObject({ canStart: true });
    expect(roomStartOf({ ...base, mode: 'duos', seated: 2 }).note).toBe('Waiting for 2 more players.');
    expect(roomStartOf({ ...base, mode: 'duel', seated: 2, status: 'in_game', running: true, isPlayer: false, phase: 'shop', round: 3 }))
      .toMatchObject({ label: 'Watch', note: 'Round 3 is live.' });
    expect(roomStartOf({ ...base, mode: 'duel', seated: 2, status: 'sealed', isPlayer: false, gateLeft: 7 }).note).toBe('The players are getting ready. 7s left.');
  });

  it('an open seat offers a take to someone in the room, nothing to anyone else', () => {
    expect(openSeatText({ open: true, mine: member('me', 'spectator') }).take).toBe(true);
    expect(openSeatText({ open: true, mine: member('me', 'p1') }).take).toBe(true);
    expect(openSeatText({ open: true, mine: null }).take).toBe(false);
    expect(openSeatText({ open: false, mine: member('me', 'spectator') }).take).toBe(false);
  });

  it('player text: no em dashes, no "--", never Oath or climb, no native title tooltips, no bare pointer cursor', () => {
    for (const f of ['./VersusBrowserPh.tsx', './VersusRoomPh.tsx', './versusPh.ts', './versusNav.ts']) {
      const src = here(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const strings = src.match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) ?? [];
      for (const s of strings.filter((x) => !/^['`]--[a-z]/.test(x))) { // (a CSS custom property name is not player text)
        expect(s, f).not.toMatch(/—|--|\boath\b|\bclimb/i);
      }
      expect(src, f).not.toMatch(/<[a-z][a-z0-9]*\b[^>\n]*\stitle=/);
    }
    expect(here('./versusPages.css')).not.toMatch(/cursor:\s*pointer/);
  });
});
