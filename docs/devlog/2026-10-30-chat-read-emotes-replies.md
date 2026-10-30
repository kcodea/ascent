# 2026-10-30: chat reads when seen, emotes in chat, replies

Branch `feat/chat-unread-emotes-replies`. Three owner asks on the friends chat (R-DM-READ-01, R-DM-EMOTE-01,
R-DM-REPLY-01).

- **Read when seen (bug).** A message that landed while the page was hidden stayed unread until the chat was closed
  and reopened. Now `viewing()` means: chat window on that tab (pinned or not) AND the page visible AND focused
  (`pageSeen`). `visibilitychange`, window `focus`, a press or focus inside the chat window, and sending all call
  `noteDmSeen()` / `markRead()`, which clears the badge, tab count and toast and writes `dm_mark_read` once, only
  when something was unread. Live messages seen while looking are written in one coalesced write
  (`DM_READ_COALESCE_MS`), not one per message. The hub-connect unread read now also writes the read for the
  conversation in front of me (it used to hide the count locally but never tell the store).
- **Emotes.** No schema change: a `:emote_id:` token in the body, shown as the painted bubble only for a live emote
  with art in this build (`chatEmotes.ts`). Old clients see the token text. The composer picker lists the player's
  emote menu (`useEquippedEmotes`).
- **Replies.** `direct_messages.reply_to` (+ `dm__row` now carries `replyTo` and a 140-char `reply` quote) in
  `supabase/migrations/2026-11-15-dm-replies.sql`; `dm_cf_send` gains `p_reply default null` (the 5-arg version is
  dropped in the same script so the deployed hub keeps resolving). Hub protocol 2 (`HubSendArgs.replyTo`), min stays 1.
  The hub sends `p_reply` only when set and retries without it on PGRST202, so plain messages never depend on the SQL.
  The client keeps a quote only when the stored row has one.

Ops: apply the migration, then the hub redeploys with the next pack (its code hash moved).
