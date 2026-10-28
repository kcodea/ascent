/**
 * VERSUS ON CLOUDFLARE — the Worker (spike, 2026-10-28). Routes, auth, and nothing else: every room's rules live in its
 * Durable Object (`room.ts`), the listing in the directory object (`directory.ts`).
 *
 *   GET  /health               protocol + content identity (no auth): the Netlify-pack check that client and Worker match
 *   POST /rooms                create a room (auth); answers the room json (as `versus_create_room`)
 *   GET  /rooms                the room list (auth; `versus_list_rooms`)
 *   GET  /rooms/open           open-room counts for the menus (auth; `versus_open_rooms`)
 *   GET  /me/room              the caller's room id (auth)
 *   GET  /rooms/<id>/ws        the room's WebSocket (auth via the subprotocol; upgraded in the room object)
 *   GET  /rooms/<id>/metrics   DEV only: the room's counters (the measurement script)
 */
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { bearerOf, verifyCaller, type AuthEnv } from './auth';
import { originAllowed } from './origins';
import type { CreateRoomInput } from './core/roomCore';
import { VersusDirectory } from './directory';
import { VERSUS_CF_BEARER_PREFIX, VERSUS_CF_PROTOCOL, VERSUS_CF_ROUTES } from './protocol';
import { INTERNAL_USER_HEADER, VersusRoom, type RoomEnv } from './room';

export { VersusRoom, VersusDirectory };

export interface Env extends RoomEnv, AuthEnv {
  ALLOWED_ORIGINS?: string;
  ROOMS: DurableObjectNamespace<VersusRoom>;
}

/** CORS headers for one request: only an allowed Origin is ever reflected. */
const corsFor = (origin: string | null): Record<string, string> => ({
  ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_WS = /^\/rooms\/([0-9a-f-]{36})\/(ws|metrics)$/i;
const CONTENT = engineContentRevision();

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response('origin not allowed', { status: 403 });
    const cors = corsFor(origin);
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === VERSUS_CF_ROUTES.health) {
      return json(200, { cfProtocol: VERSUS_CF_PROTOCOL, protocol: VERSUS_PROTOCOL, contentRevision: CONTENT });
    }
    const caller = await verifyCaller(bearerOf(req, VERSUS_CF_BEARER_PREFIX), env);
    const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));

    const ws = ROOM_WS.exec(url.pathname);
    if (ws && UUID.test(ws[1])) {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(ws[1].toLowerCase()));
      if (ws[2] === 'metrics') return env.DEV_AUTH === '1' ? json(200, await stub.metricsSnapshot()) : json(404, { error: 'not_found' });
      if (!caller) return new Response('unauthorized', { status: 401 });
      // The verified user rides an internal header (the object is only reachable through this Worker).
      const headers = new Headers(req.headers);
      headers.set(INTERNAL_USER_HEADER, caller.userId);
      return stub.fetch(new Request(req, { headers }));
    }
    if (!caller) return json(401, { error: 'not_signed_in' });

    if (url.pathname === VERSUS_CF_ROUTES.rooms && req.method === 'POST') {
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; } catch { return json(400, { error: 'bad_body' }); }
      const id = crypto.randomUUID();
      const elsewhere = await dir.claim(caller.userId, id);
      if (elsewhere) return json(409, { error: 'already_in_room', roomId: elsewhere });
      const input: CreateRoomInput = {
        id, name: String(body.name ?? ''), hostUserId: caller.userId, displayName: String(body.display ?? ''),
        profile: (body.profile && typeof body.profile === 'object' ? body.profile : {}) as Record<string, unknown>,
        setId: String(body.setId ?? ''), contentRevision: String(body.contentRevision ?? ''), protocol: Number(body.protocol), options: body.options ?? null,
      };
      const res = await env.ROOMS.get(env.ROOMS.idFromName(id)).init(input);
      if (!res.ok) {
        await dir.release(caller.userId, id);
        return json(400, { error: res.error });
      }
      return json(200, res.room);
    }
    if (url.pathname === VERSUS_CF_ROUTES.rooms && req.method === 'GET') return json(200, await dir.list());
    if (url.pathname === VERSUS_CF_ROUTES.openRooms) {
      return json(200, await dir.openCounts(caller.userId, Number(url.searchParams.get('protocol')), String(url.searchParams.get('content') ?? '')));
    }
    if (url.pathname === VERSUS_CF_ROUTES.myRoom) return json(200, { roomId: await dir.roomOf(caller.userId) });
    return json(404, { error: 'not_found' });
  },
};
