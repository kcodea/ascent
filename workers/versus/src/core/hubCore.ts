/**
 * THE FRIENDS HUB — the rules, with no Durable Object in sight (so they are unit-tested in plain Node; R-DM-01..05).
 * The object (`hub.ts`) owns sockets, storage and the clock; this decides.
 *
 *   - `DmRateLimiter`: `DM_RATE.count` messages per `DM_RATE.windowMs`, per account (a sliding window: every open game
 *     of the account shares it, because the account's hub is one object).
 *   - `checkSend`: what a `send` must carry before anything is stored (a uuid client id, a friend's id, a clean body).
 *   - `DmBackend`: where messages are stored and friendships are read. Supabase in production (`dmStore.ts`); a memory
 *     backend for the tests and a local `wrangler dev`.
 */
import { cleanDmBody, DM_RATE, DM_REPLY_SNIPPET, isUuid, type DmRow, type DmSendError } from '../hubProtocol';

export class DmError extends Error {
  constructor(public readonly code: DmSendError) {
    super(code);
  }
}

/** A sliding-window limit. Pure apart from the times it is handed. */
export class DmRateLimiter {
  private sent: number[] = [];
  constructor(private readonly count: number = DM_RATE.count, private readonly windowMs: number = DM_RATE.windowMs) {}
  /** Take one slot at `now` (true), or refuse (false: nothing is counted). */
  take(now: number): boolean {
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    if (this.sent.length >= this.count) return false;
    this.sent.push(now);
    return true;
  }
}

export interface SendCheck {
  cid: string;
  to: string;
  body: string;
  /** The message this one answers (protocol 2), or null. The store checks it is in this conversation. */
  replyTo?: string | null;
}

/** Validate a `send`'s arguments (no store call yet). Throws `DmError`. */
export function checkSend(me: string, args: Record<string, unknown>): SendCheck {
  const { cid, to } = args;
  if (!isUuid(cid)) throw new DmError('bad_body');
  if (!isUuid(to) || to.toLowerCase() === me.toLowerCase()) throw new DmError('bad_target');
  const body = cleanDmBody(args.body);
  if (body == null) throw new DmError('bad_body');
  // A reply target that is not a message id is dropped, never refused: the message itself still goes.
  const replyTo = isUuid(args.replyTo) ? args.replyTo.toLowerCase() : null;
  return { cid: cid.toLowerCase(), to: to.toLowerCase(), body, replyTo };
}

/** Where messages live. Every call may throw `DmError` (a refusal) or anything else (the store is unreachable). */
export interface DmBackend {
  readonly live: boolean;
  /** Store a message (friends only, no block either way; the same `cid` again answers the stored row). */
  send(from: string, msg: SendCheck): Promise<DmRow>;
  /** My accepted friends (nobody blocked either way). */
  friendsOf(user: string): Promise<string[]>;
}

/**
 * A memory backend: the unit tests, and a local `wrangler dev` (DEV_AUTH=1, nothing persisted), where a client's hello
 * may name its friends and blocks (`devFriends` / `devBlocked`), so two dev tabs can talk. Never in production.
 */
export class MemoryDmBackend implements DmBackend {
  readonly live = false;
  readonly rows: DmRow[] = [];
  private readonly friends = new Map<string, Set<string>>();
  private readonly blocks = new Set<string>();
  private seq = 0;
  constructor(private readonly clock: () => number = Date.now) {}

  befriend(a: string, b: string): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const s = this.friends.get(x) ?? new Set<string>();
      s.add(y);
      this.friends.set(x, s);
    }
  }
  block(blocker: string, blocked: string): void { this.blocks.add(`${blocker}|${blocked}`); }

  private blocked(a: string, b: string): boolean { return this.blocks.has(`${a}|${b}`) || this.blocks.has(`${b}|${a}`); }

  async send(from: string, msg: SendCheck): Promise<DmRow> {
    const had = this.rows.find((r) => r.from === from && r.cid === msg.cid);
    if (had) return had;
    if (this.blocked(from, msg.to)) throw new DmError('blocked');
    if (!this.friends.get(from)?.has(msg.to)) throw new DmError('not_friends');
    this.seq += 1;
    // A reply must answer a message of THIS conversation (the SQL's rule); anything else is stored as a plain message.
    const orig = msg.replyTo ? this.rows.find((r) => r.id === msg.replyTo && ((r.from === from && r.to === msg.to) || (r.from === msg.to && r.to === from))) : undefined;
    const row: DmRow = {
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`, cid: msg.cid, from, to: msg.to, body: msg.body,
      at: new Date(this.clock()).toISOString(), readAt: null,
      replyTo: orig?.id ?? null,
      reply: orig ? { id: orig.id, from: orig.from, body: [...orig.body].slice(0, DM_REPLY_SNIPPET).join('') } : null,
    };
    this.rows.push(row);
    if (this.rows.length > 500) this.rows.shift();
    return row;
  }

  async friendsOf(user: string): Promise<string[]> {
    return [...(this.friends.get(user) ?? [])].filter((f) => !this.blocked(user, f));
  }
}

/**
 * The refusal a store error stands for. The SQL raises its code as the message (`raise exception 'not_friends'`), and
 * PostgREST hands it back in the body; anything unrecognised is `unavailable` (the client keeps the message and retries).
 */
export function dmErrorOf(text: string): DmSendError {
  for (const code of ['not_friends', 'blocked', 'bad_body', 'bad_target', 'rate_limited'] as const) {
    if (text.includes(code)) return code;
  }
  return 'unavailable';
}
