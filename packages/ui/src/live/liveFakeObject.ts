/**
 * TESTS ONLY: an in-memory stand-in for a live game's Durable Object (the relay rules of
 * `workers/versus/src/liveGame.ts`, whose real round trip is `workers/versus/test/it/live.it.ts`): the cached keyframe,
 * the listing row, the stands pushed on every join / leave, the relayed broadcasts and the end. Plug it in with
 * `setCfLiveSocketForTests(obj.make)`. Never imported by the game.
 */
import type { CfLiveSocket, CfSocketOptions, LiveHelloAnswer } from './liveCf';

export const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function fakeLiveObject(gameId: string, opts: { player?: string } = {}) {
  type Sock = { o: CfSocketOptions; role: 'publish' | 'watch'; user: string; open: boolean };
  const socks: Sock[] = [];
  let key: unknown = null;
  let listing: Record<string, unknown> | null = null;
  const requests: { op: string; args: unknown }[] = [];
  const stands = () => socks.filter((s) => s.open && s.role === 'watch').map((s) => ({ user_id: s.user, display_name: String(s.o.hello.name ?? ''), profile: (s.o.hello.profile as Record<string, unknown> | undefined) ?? null }));
  const row = () => (listing ? {
    game_id: gameId, display_name: String(listing.name), hero_id: String(listing.hero), cosmetics: null, division_index: 3, rank_points: 10, rating: 0,
    round: Number(listing.round), phase: listing.phase as 'shop', placement: null, spectators: stands().length, started_at: '', mode: null, live_host: 'cf:rev',
  } : null);
  const pushStands = () => { const list = stands(); for (const s of socks) if (s.open) s.o.onPush({ t: 'watchers', list, n: list.length }); };
  let n = 0;
  const make = (o: CfSocketOptions): CfLiveSocket => {
    const me: Sock = { o, role: o.hello.role as 'publish' | 'watch', user: o.hello.role === 'publish' ? opts.player ?? 'u-player' : `w-${++n}`, open: false };
    return {
      async connect() {
        me.open = true;
        socks.push(me);
        if (me.role === 'watch') {
          o.onHello(wire({ role: 'watch', userId: me.user, row: row(), key, watchers: stands() }) as LiveHelloAnswer);
          pushStands();
        } else o.onHello({ role: 'publish', userId: me.user, row: row(), key: null, watchers: stands() } as LiveHelloAnswer);
      },
      async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
        requests.push({ op, args: wire(args) });
        if (op === 'listing') { listing = wire(args); for (const s of socks) if (s.open && s.role === 'watch') s.o.onPush({ t: 'row', row: row()! }); return { watchers: stands().length } as T; }
        if (op === 'key') { key = wire(args.frame); return null as T; }
        if (op === 'end') { for (const s of socks) if (s.open && s.role === 'watch') s.o.onPush({ t: 'end', placement: (args.placement as number) ?? null, abandoned: args.placement == null, row: { ...row()!, phase: 'end', placement: (args.placement as number) ?? null } }); return null as T; }
        return null as T;
      },
      broadcast(event, payload) { for (const s of socks) if (s !== me && s.open) s.o.onPush({ t: 'bc', event, payload: wire(payload), from: me.user }); },
      close() { if (!me.open) return; me.open = false; pushStands(); },
    };
  };
  /** A bare socket on the object (a stand-in player or watcher driven by the test itself). */
  const raw = (role: 'publish' | 'watch', hello: Record<string, unknown> = {}, onPush: CfSocketOptions['onPush'] = () => undefined) =>
    make({ baseUrl: '', gameId, hello: { role, ...hello }, onHello: () => undefined, onPush, onDead: () => undefined });
  return { make, raw, requests, socks, get key() { return key; }, set key(v: unknown) { key = v; }, stands, ops: (op: string) => requests.filter((r) => r.op === op) };
}

/** A socket that never opens (a Worker that does not answer). */
export const hangingSocket = (): CfLiveSocket => ({ connect: () => new Promise<void>(() => undefined), request: async () => null as never, broadcast: () => undefined, close: () => undefined });
