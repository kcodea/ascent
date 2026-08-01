# Player accounts, handles, and a trustworthy ladder — spec

**Status:** proposed (2026-07-31). Owner decisions locked: offline play works, duplicate display names with a
`#tag` discriminator, **the ladder is public**.

This is the plan for replacing "a display name in localStorage" with real accounts you administer from
Supabase — designed so the auth *provider* can be swapped for Steam later without a second migration.

---

## 1. Where we are

Identity today is a 24-character string in `localStorage` (`ascent.playername`). That string IS the identity:
it's the `author` column on `boards`, `runs`, `run_telemetry`, and the **primary key** of `profiles`. Renaming
yourself to someone else's name inherits their leaderboard slot. The Supabase client is constructed with
`auth: { persistSession: false, autoRefreshToken: false }` — auth is switched off, not merely unused.

**The live security posture is worth stating plainly**, because it's the thing accounts are meant to fix:

```sql
create policy "anon update profiles" on public.profiles
  for update to anon using (true) with check (true);
```

`using (true)` means any client may update **any** row. Today, anyone with devtools can set any player's
rating — including yours. Fine at friends-and-testers scale; not fine for a public ladder.

Two facts found while scoping, both of which shape the plan:

- **`@game/sim` is fully portable.** Zero `window`/`document`/`localStorage` references; its only dependencies
  are `@game/core` and `@game/content`, which are equally pure. Server-side replay validation is therefore
  *possible* — the deterministic simulation was built for exactly this.
- **…but a lobby replay costs ~20 seconds of CPU.** Replaying a lobby re-simulates seven bot seats through
  their entire runs (this is why `store.ts` captures lobby boards live instead of replaying — see the comment
  at the `lobbyBoards` branch). That rules out synchronous validation on every submit and reshapes T6 below.

---

## 2. Identity model

```
user_id       uuid      — auth.users.id. The real identity. Never shown.
display_name  text      — mutable, NOT unique. "Kevin"
discriminator text(4)   — "4821". Assigned by the server.
handle        =         — display_name + '#' + discriminator, e.g. Kevin#4821
```

Uniqueness is `unique (lower(display_name), discriminator)` — the Discord model. A second Kevin gets a
different tag; the pair is what's unique, so common names never run out. The discriminator is assigned by a
DB function that generates a random 4-digit and retries on collision, and is **re-rolled on rename** (only if
the new name/tag pair collides).

`author` (the display string) stays on rows as a **denormalized convenience** for rendering, but stops being
an identity key. Everything joins on `user_id`.

---

## 3. Offline, guest, and the rated/unrated line

Offline play works. The consequence that has to be stated up front:

> **Offline and guest runs are UNRATED.** Rating moves only when the server accepts a result.

This isn't a limitation, it's the whole point — if a client could bank MMR offline, server authority would be
theatre. Three states:

| State | Play | Boards read | Boards written | Rating |
|---|---|---|---|---|
| **Guest** (no account) | full | cached pool | no | none |
| **Signed in, offline** | full | cached pool | queued | unrated |
| **Signed in, online** | full | live pool | yes | **rated** |

The lobby already reads its opponent pool from a boot-time cache, so an offline lobby plays normally against
the last-synced boards. The end screen shows "Unrated — offline" in place of the rating block (the same slot
practice mode already uses for its "Practice — unrated" tag).

**Guest → account upgrade:** a guest's local run history and career stats carry over on first sign-in; their
local *rating* does not (the server profile is authoritative — this is already how `syncProfileFromServer`
behaves as of 2026-07-31).

---

## 4. Schema v2

Migration is cheap because a data reset is already planned. Truncate, then:

```sql
-- Profiles: keyed on the account, not the name.
create table public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  discriminator char(4) not null,
  rating        int not null default 0,
  season        int not null default 2,
  games_played  int not null default 0,
  favorite_hero text,
  patch         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lower(display_name), discriminator)
);

-- Every content table gains the real key. `author` stays for display only.
alter table public.boards         add column user_id uuid references auth.users(id) on delete set null;
alter table public.runs           add column user_id uuid references auth.users(id) on delete set null;
alter table public.run_telemetry  add column user_id uuid references auth.users(id) on delete set null;
alter table public.board_results  add column user_id uuid references auth.users(id) on delete set null;
```

### RLS — the actual win

```sql
-- Content tables: read is public; you may only write rows that are YOURS.
create policy "read"        on public.boards for select using (true);
create policy "insert own"  on public.boards for insert to authenticated
  with check (auth.uid() = user_id);
-- (identical shape for runs, run_telemetry, board_results)

-- Profiles: readable by all, but NO client may write rating.
create policy "read profiles"   on public.profiles for select using (true);
create policy "update own name" on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and rating = (select rating from public.profiles p where p.user_id = auth.uid()));
```

That last `with check` is the load-bearing line: a player may rename themselves, and may not move their own
rating by a single point. Rating is written **only** by the service role (§6).

**Anonymous writes are dropped entirely** (`to authenticated`). Guests read the pool and contribute nothing —
which is also a spam-surface win.

---

## 5. The identity seam (Steam-shaped from day one)

One module, one interface, two implementations. Building this *first* is what makes Steam a ticket instead of
a second migration.

```ts
// packages/ui/src/identity/types.ts
export interface Identity {
  userId: string;
  handle: { name: string; tag: string };
}
export interface AuthProvider {
  /** Restore a persisted session, if any. Runs at boot; never blocks it. */
  restore(): Promise<Identity | null>;
  signIn(creds?: unknown): Promise<Identity>;
  signOut(): Promise<void>;
  /** Rename — the server re-rolls the discriminator on collision. */
  setDisplayName(name: string): Promise<Identity>;
}
```

- **`emailPasswordProvider`** (now) — Supabase Auth, `persistSession: true`.
- **`steamProvider`** (later) — Steamworks `GetAuthSessionTicket` → Edge Function validates the ticket against
  Valve's `ISteamUserAuth/AuthenticateUserTicket` → looks up or creates the Supabase user carrying that
  `steam_id` → mints a session with the admin API. The player never sees a login form.

Everything downstream consumes `Identity`, never a provider. The Electron shell in `apps/desktop` is already
the Steam packaging path.

---

## 6. Server-authoritative rating

The ladder is public, so the client cannot be the thing that computes MMR. But full replay validation costs
~20 s of CPU per lobby (§1), which no synchronous submit path can absorb. **Two tiers:**

### Tier 1 — cheap authority on every submit (required)

An Edge Function `submit-result` is the only writer of `profiles.rating`:

1. Takes `{ runId, seed, placement, mode, patch }` from an authenticated client.
2. Rejects: duplicate `runId` (replay attack), `mode !== 'lobby'`, a placement outside 1–8, and results
   arriving faster than a lobby can physically be played (rate limit per `user_id`).
3. Computes the delta **server-side** with the shared `resolveLobbyRating` from `@game/sim` — the same pure
   function the client uses, so the number is never in dispute.
4. Writes `profiles.rating` with the service role.

This makes rating unforgeable *in magnitude* (you cannot claim +500) while still trusting the claimed
placement. Combined with rate limits, that ceiling is low enough that abuse is grinding, not exploiting.

### Tier 2 — deferred replay audit (before the ladder goes public)

The full action log uploads with the run (it already exists — `replay = { seed, heroId, mode, actions }`). A
scheduled job re-simulates submissions **out of band** and flags mismatches:

- Audits the **top N** of the ladder plus a random sample — not every game. Cheating that doesn't reach the
  leaderboard doesn't matter.
- A mismatch flags the account for review rather than auto-banning (a sim change between client and server
  versions would otherwise mass-flag honest players — pin the audit to the run's `patch`).

This is the same "server-side replay validation" already anticipated in `schema.sql` and `docs/board-pool.md`,
and it's the reason the engine was built pure and deterministic in the first place.

---

## 7. Tickets

| # | Ticket | Est. | Depends on |
|---|---|---|---|
| **T1** | Identity seam + `emailPasswordProvider`; client `persistSession: true` | 0.5 d | — |
| **T2** | Schema v2: `user_id` columns, handle model + discriminator function, RLS rewrite | 1 d | — |
| **T3** | Client re-key: 5 upload paths + reads carry `user_id`; `author` becomes display-only | 1 d | T1, T2 |
| **T4** | Auth UI: sign-up / sign-in / account panel / sign-out; handle display `Kevin#4821` | 1.5 d | T1 |
| **T5** | Guest + offline: unrated tagging, upload queue + flush, guest→account carry-over | 1 d | T3 |
| **T6a** | Edge Function `submit-result` — server-computed rating, `profiles` locked to service role | 1.5 d | T2, T3 |
| **T6b** | Deferred replay audit job (top-N + sample, patch-pinned) | 2 d | T6a |
| **T7** | `steamProvider` + ticket-validation Edge Function | 2 d | T1, T6a |

**~6.5 days** to accounts with a trustworthy-enough public ladder (T1–T6a).
**~8.5 days** including the audit (T6b).
**T7 when Steam is real** — it slots in without touching T2–T6.

### Suggested order

1. **T1 + T2 + T3** — the migration, while a data reset is already on the table. Ship it and the identity
   problem is solved even before there's a login screen (guests simply can't write).
2. **T4 + T5** — the player-facing half.
3. **T6a** — before the ladder is public.
4. **T6b / T7** — before Steam.

---

## 8. Open questions

1. **Email verification on sign-up?** Off is friendlier for testers; on is one line of Supabase config and
   stops throwaway-account ladder spam. Recommend: off now, on before public launch.
2. **Do guests get a local handle?** e.g. `Guest#1234` for the lobby rail, or just "You". Cosmetic.
3. **Rename cooldown?** Free renaming is fine with `user_id` as the key, but a public ladder plus free
   renaming makes impersonation easy. Recommend a 7-day cooldown.
4. **Season resets** — with `profiles.season` already in place, a season rollover is `update profiles set
   rating = 0, season = 3`, and clients adopt it on next launch. Worth deciding whether history is archived
   per season (a `season_results` table) or simply discarded.
