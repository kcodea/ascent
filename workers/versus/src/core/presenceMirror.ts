/**
 * THE PRESENCE MIRROR — when the friends hub writes my presence into Supabase (R-FRIENDS-HUB-LIVE-01). Pure: the clock
 * and the writer are handed in.
 *
 * The hub is the live source of presence (friends hear it over their sockets the moment it changes). The Supabase row
 * (`player_presence`, through `hub_presence_cf`) is a mirror for two readers that cannot ask the hub: the server-side
 * "is this friend online" check on an invite (`friends__online`, a 300 s window), and an older client's friends list.
 *
 *   - a CHANGE is written at once, but never more often than every `HUB_PRESENCE_MIN_GAP_MS` (latest wins: a burst of
 *     changes is one write);
 *   - while I am connected and nothing changes, a keep-alive every `HUB_PRESENCE_REFRESH_MS` (well inside the window);
 *   - my last game closing writes Offline once (a closed game reads Offline at once, as the old pagehide beat did);
 *   - a failed write retries (1 s, 2 s, 4 s ... capped at 60 s); the newest wanted presence is what goes.
 */
import { HUB_PRESENCE_MIN_GAP_MS, HUB_PRESENCE_REFRESH_MS, type HubPresence } from '../hubProtocol';

const keyOf = (p: HubPresence | null): string => (p ? JSON.stringify(p) : 'offline');
const backoff = (attempt: number): number => Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));

export class PresenceMirror {
  private wanted: { p: HubPresence | null; key: string } | null = null;
  private sentKey = '';
  private sentAt = -Infinity;
  private retryAt: number | null = null;
  private attempt = 0;
  private inflight = false;

  /** The presence I want mirrored now (null: offline). */
  want(p: HubPresence | null): void {
    this.wanted = { p, key: keyOf(p) };
  }

  /** Is a write due at `now`? `connected`: I have a game open (the keep-alive runs only then). */
  due(now: number, connected: boolean): boolean {
    const w = this.wanted;
    if (!w || this.inflight) return false;
    if (this.retryAt != null) return now >= this.retryAt;
    if (w.key !== this.sentKey) return now - this.sentAt >= HUB_PRESENCE_MIN_GAP_MS;
    return connected && w.p != null && now - this.sentAt >= HUB_PRESENCE_REFRESH_MS;
  }

  /** When the next write falls due (the hub's alarm), or null (nothing owed). */
  nextAt(now: number, connected: boolean): number | null {
    const w = this.wanted;
    if (!w || this.inflight) return null;
    if (this.retryAt != null) return this.retryAt;
    if (w.key !== this.sentKey) return Math.max(now, this.sentAt + HUB_PRESENCE_MIN_GAP_MS);
    return connected && w.p != null ? this.sentAt + HUB_PRESENCE_REFRESH_MS : null;
  }

  /** Write if due. Never throws: a failure schedules a retry. */
  async flush(now: number, write: (p: HubPresence | null) => Promise<void>, connected: boolean): Promise<boolean> {
    if (!this.due(now, connected)) return false;
    const w = this.wanted!;
    this.inflight = true;
    try {
      await write(w.p);
      this.sentKey = w.key;
      this.sentAt = now;
      this.retryAt = null;
      this.attempt = 0;
      return true;
    } catch (e) {
      this.retryAt = now + backoff(this.attempt++);
      console.warn(JSON.stringify({ ev: 'hub_presence_mirror_retry', attempt: this.attempt, error: String(e) }));
      return false;
    } finally {
      this.inflight = false;
    }
  }

  snapshot(): { sentKey: string; at: number } {
    return { sentKey: this.sentKey, at: this.sentAt };
  }

  /** After a wake: what was last written (kept in the hub's storage), so a woken hub never writes early. */
  restore(saved: { sentKey: string; at: number } | null | undefined): void {
    if (!saved || typeof saved.sentKey !== 'string' || !Number.isFinite(saved.at)) return;
    this.sentKey = saved.sentKey;
    this.sentAt = saved.at;
  }

  /** Nothing wanted yet this wake (the alarm then re-wants what is true: my stored presence, or offline). */
  get idle(): boolean { return this.wanted == null; }
  /** The last write was Offline (or nothing was ever written). */
  get sentOffline(): boolean { return this.sentKey === '' || this.sentKey === 'offline'; }
}
