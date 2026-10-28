/**
 * VERSUS ON CLOUDFLARE — the room directory: ONE Durable Object (named "global") that knows which rooms exist and which
 * room each account is in. It replaces `versus_list_rooms`, `versus_open_rooms` and the `versus_members_one_room`
 * unique index. Rooms report their listing summary to it when it changes; it is never on a round's path.
 *
 * One object is a single-threaded hot spot, but its traffic is tiny (a summary per room state change, a list read per
 * menu visit, a 45 s count poll per open menu); the design doc covers sharding it by region if that ever matters.
 */
import { DurableObject } from 'cloudflare:workers';

export interface RoomSummary {
  id: string;
  name: string;
  status: string;
  setId: string;
  contentRevision: string;
  protocol: number;
  createdAt: string | null;
  currentMatchId: string | null;
  hostName: string | null;
  hostProfile: Record<string, unknown> | null;
  players: number;
  spectators: number;
  maxPlayers: number;
  options: Record<string, unknown>;
  friendsOnly: boolean;
  fresh: boolean;
  closed: boolean;
  /** Who is in it (for one-room-per-account). */
  members?: string[];
}

interface DirState {
  rooms: Record<string, RoomSummary>;
  members: Record<string, string>;
}

export class VersusDirectory extends DurableObject {
  private state: DirState | null = null;

  private async load(): Promise<DirState> {
    if (!this.state) this.state = (await this.ctx.storage.get<DirState>('dir')) ?? { rooms: {}, members: {} };
    return this.state;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('dir', this.state);
  }

  /** Put `userId` in `roomId`. Answers the OTHER room the account is already in (refused), or null (done). */
  async claim(userId: string, roomId: string): Promise<string | null> {
    const s = await this.load();
    const cur = s.members[userId];
    if (cur && cur !== roomId && s.rooms[cur] && !s.rooms[cur].closed) return cur;
    s.members[userId] = roomId;
    await this.save();
    return null;
  }

  async release(userId: string, roomId: string): Promise<void> {
    const s = await this.load();
    if (s.members[userId] === roomId) {
      delete s.members[userId];
      await this.save();
    }
  }

  async upsert(summary: RoomSummary): Promise<void> {
    const s = await this.load();
    if (summary.closed) {
      delete s.rooms[summary.id];
      for (const [u, r] of Object.entries(s.members)) if (r === summary.id) delete s.members[u];
    } else s.rooms[summary.id] = summary;
    await this.save();
  }

  async roomOf(userId: string): Promise<string | null> {
    const s = await this.load();
    const r = s.members[userId];
    return r && s.rooms[r] ? r : null;
  }

  /** `versus_list_rooms`: rooms someone was in recently, newest first. */
  async list(): Promise<RoomSummary[]> {
    const s = await this.load();
    return Object.values(s.rooms)
      .filter((r) => r.fresh && !r.closed)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map(({ members: _m, fresh: _f, closed: _c, ...rest }) => rest as RoomSummary);
  }

  /** `versus_open_rooms`: Open rooms on the caller's version that are not the caller's own. */
  async openCounts(userId: string, protocol: number, content: string): Promise<{ open: number; seatOpen: number; duosOpen: number }> {
    const s = await this.load();
    const mine = s.members[userId];
    const open = Object.values(s.rooms).filter((r) => r.fresh && !r.closed && r.status === 'open' && r.protocol === protocol && r.contentRevision === content && r.id !== mine);
    return { open: open.length, seatOpen: open.filter((r) => r.players < r.maxPlayers).length, duosOpen: 0 };
  }
}
