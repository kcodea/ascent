-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FRIENDS PRESENCE: the Offline window 180 s -> 300 s (2026-11-09, fix/friends-presence-gap; R-FRIENDS-PRESENCE-GAP-01).
-- Run AFTER 2026-10-28-friends.sql. Idempotent. Only the window changes; every reader (`friends__presence`,
-- `friends__online`, the beat's online count) already reads it through `friends__stale()`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner report 2026-10-28: Mike's friends list showed the owner Offline while the owner had the game open. In prod
-- `player_presence` a signed-in, online player's last beat was 196 s old, past the 180 s window: the client beat every
-- 120 s while the tab was hidden, and browsers throttle hidden-tab timers (Chrome batches them to once a minute), so a
-- beat often landed after 180 s. The client now beats every 60 s hidden too, caps a failing beat's retry at 90 s, and
-- sends an explicit Offline beat when the page closes, so a wider window costs no accuracy on a real close: it only
-- absorbs a throttled timer (60 s pace + up to a minute late) or one failed beat with margin.
create or replace function public.friends__stale() returns interval language sql immutable as $$ select interval '300 seconds' $$;
revoke all on function public.friends__stale() from public, anon, authenticated;
