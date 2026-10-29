/**
 * R-VERSUS-CF-CONNECT-01 (live 2026-10-29): a room that is gone (closed and forgotten) answers its socket with 404. If the
 * directory still names the caller as in it (the room's closing write was lost), every new room was refused with
 * `already_in_room` and `/me/room` kept pointing at a room no socket could open, so Duo + Play never got a party. The
 * Worker now drops that stale claim the moment the room says 404, and only for that room.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
const { default: worker } = await import('../src/index');

const ROOM = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function env(roomStatus: number) {
  const release = vi.fn(async () => undefined);
  const roomFetch = vi.fn(async () => new Response(roomStatus === 404 ? 'no_room' : null, { status: roomStatus === 404 ? 404 : 200 }));
  return {
    release,
    roomFetch,
    env: {
      DEV_AUTH: '1',
      ALLOWED_ORIGINS: '',
      ROOMS: { idFromName: (n: string) => n, get: () => ({ fetch: roomFetch }) },
      DIRECTORY: { idFromName: (n: string) => n, get: () => ({ release }) },
      LIVE: { idFromName: (n: string) => n, get: () => ({}) },
    },
  };
}

const upgrade = (): Request => new Request(`http://w/rooms/${ROOM}/ws`, {
  headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'ascent-versus.v1, bearer.dev.11111111-2222-4333-8444-555555555555.Kev' },
});

describe('a gone room releases the caller\'s stale directory claim (R-VERSUS-CF-CONNECT-01)', () => {
  it('404 from the room: the caller\'s claim on THAT room is dropped', async () => {
    const t = env(404);
    const res = await worker.fetch(upgrade(), t.env as never);
    expect(res.status).toBe(404);
    expect(t.roomFetch).toHaveBeenCalledTimes(1);
    expect(t.release).toHaveBeenCalledWith('11111111-2222-4333-8444-555555555555', ROOM);
  });

  it('a live room: nothing is released', async () => {
    const t = env(200);
    await worker.fetch(upgrade(), t.env as never);
    expect(t.release).not.toHaveBeenCalled();
  });
});
