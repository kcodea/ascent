/**
 * ROOM NAMES (R-NAME-FILTER-01): a room name the filter blocks never opens a room (`name_blocked`, which the client
 * shows as plain text); a flagged one opens and is reported once to `moderation_cf_flag` with the writer secret.
 */
import { describe, expect, it } from 'vitest';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { CoreError, newRoomState } from '../src/core/roomCore';
import { reportRoomName, roomNameNeedsFlag } from '../src/nameFlag';

const U1 = '00000000-0000-0000-0000-000000000001';
const input = (name: string) => ({ id: 'r-1', name, hostUserId: U1, displayName: 'One', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL });

describe('room names', () => {
  it('a blocked name is refused with name_blocked', () => {
    let err: unknown;
    try { newRoomState(input('N1gg3r Room'), 0); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CoreError);
    expect((err as CoreError).code).toBe('name_blocked');
  });

  it('a flagged or clean name opens the room; only the flagged one is reported', () => {
    expect(newRoomState(input('Shit Talkers'), 0).room.name).toBe('Shit Talkers');
    expect(newRoomState(input("Kevin's Duel"), 0).room.name).toBe("Kevin's Duel");
    expect(roomNameNeedsFlag('Shit Talkers')).toBe(true);
    expect(roomNameNeedsFlag("Kevin's Duel")).toBe(false);
  });

  it('reports with the publishable key and the writer secret, and not at all with persistence off', async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const f = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      return new Response('{"flagged":true}', { status: 200 });
    }) as typeof fetch;
    const env = { PERSIST: '1', SUPABASE_URL: 'https://db.example.supabase.co/', SUPABASE_ANON_KEY: 'pub', VERSUS_WRITER_SECRET: 'sec' };
    expect(await reportRoomName(env, { id: 'r-1', name: 'Shit Talkers', hostUserId: U1 }, f)).toBe(true);
    expect(calls).toEqual([{ url: 'https://db.example.supabase.co/rest/v1/rpc/moderation_cf_flag', headers: expect.objectContaining({ apikey: 'pub' }),
      body: { p_key: 'sec', p_room: 'r-1', p_name: 'Shit Talkers', p_owner: U1 } }]);
    expect(await reportRoomName({ ...env, PERSIST: '0' }, { id: 'r-1', name: 'x', hostUserId: U1 }, f)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
