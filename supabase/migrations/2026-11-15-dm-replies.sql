-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DIRECT MESSAGE REPLIES (owner 2026-10-30: "reply feature to reply to certain responses"; a friend: "context for a
-- response in this chat. like reply to your message about adding minions to duos"; R-DM-REPLY-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- APPLY AFTER 2026-11-12-direct-messages.sql. ADDITIVE ONLY and idempotent (safe to re-run). No Edge Function.
-- Apply it BEFORE (or with) the hub deploy that carries protocol 2; the hub also falls back to a plain message when
-- this is not applied yet, so the order is not dangerous, only replies wait for it.
--
--  - direct_messages.reply_to: the message a message answers (same conversation), null for a plain one. When the
--    original is pruned (90 days) the reply keeps its text and simply loses the quote (on delete set null).
--  - dm__row: every row now also carries `replyTo` and `reply` ({ id, from, body: its first 140 characters }), so the
--    hub's answer, the live push, `dm_history` and `dm_unread` all show the quote with no extra call.
--  - dm_cf_send gains `p_reply uuid default null`. The 5-argument writer is dropped and replaced in one go, so the hub
--    already deployed (which sends 5 named arguments) resolves to the new one unchanged. A reply target that is not a
--    message of this conversation is ignored (stored as a plain message), never refused.

alter table public.direct_messages add column if not exists reply_to uuid references public.direct_messages(id) on delete set null;
create index if not exists direct_messages_reply on public.direct_messages (reply_to) where reply_to is not null;

create or replace function public.dm__row(m public.direct_messages) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', m.id, 'cid', m.client_id, 'from', m.sender, 'to', m.recipient, 'body', m.body,
    'at', m.created_at, 'readAt', m.read_at, 'replyTo', m.reply_to,
    'reply', (select jsonb_build_object('id', r.id, 'from', r.sender, 'body', left(r.body, 140))
              from public.direct_messages r where m.reply_to is not null and r.id = m.reply_to))
$$;
revoke all on function public.dm__row(public.direct_messages) from public, anon, authenticated;

drop function if exists public.dm_cf_send(text, uuid, uuid, text, uuid);

create or replace function public.dm_cf_send(p_key text, p_from uuid, p_to uuid, p_body text, p_cid uuid, p_reply uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.direct_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_reply uuid := null;
begin
  if not public.dm__key_ok(p_key) then raise exception 'bad_key'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'bad_target'; end if;
  -- A retry of a stored send answers the stored row (before any other check: it already passed them).
  if p_cid is not null then
    select * into v_row from public.direct_messages where sender = p_from and client_id = p_cid;
    if found then return public.dm__row(v_row); end if;
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'bad_body'; end if;
  if not public.friends__is_account(p_from) or not public.friends__is_account(p_to) then raise exception 'not_friends'; end if;
  if public.friends__blocked(p_from, p_to) then raise exception 'blocked'; end if;
  if not public.friends__are_friends(p_from, p_to) then raise exception 'not_friends'; end if;
  if (select count(*) from public.direct_messages where sender = p_from and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited';
  end if;
  -- Only a message of THIS conversation can be answered; anything else is dropped (the message still goes).
  if p_reply is not null then
    select d.id into v_reply from public.direct_messages d
    where d.id = p_reply and ((d.sender = p_from and d.recipient = p_to) or (d.sender = p_to and d.recipient = p_from));
  end if;
  insert into public.direct_messages (sender, recipient, body, client_id, reply_to) values (p_from, p_to, v_body, p_cid, v_reply)
  on conflict (sender, client_id) where client_id is not null do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.direct_messages where sender = p_from and client_id = p_cid;
  end if;
  return public.dm__row(v_row);
end;
$$;

revoke all on function public.dm_cf_send(text, uuid, uuid, text, uuid, uuid) from public;
grant execute on function public.dm_cf_send(text, uuid, uuid, text, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
