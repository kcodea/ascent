-- GOD MODE (owner 2026-10-08): one random real player board for a chosen round, for the Practice God Mode prompt
-- "What round should your opponent board be on?". Read-only; boards is already world-readable (select using (true)).
--
-- Cost: the candidate set is narrowed through `boards_wave_patch_idx` (round + build-version prefix), and the
-- sample is drawn ID-FIRST: only the candidate ids are collected, one is picked uniformly, and only that row's
-- snapshot is returned. It never sorts snapshots (`order by random()` over whole rows would). VOLATILE because it
-- calls random() (the client calls it as a plain POST RPC).

create index if not exists boards_wave_patch_idx on public.boards (wave, patch text_pattern_ops);

create or replace function public.god_board_sample(p_wave int, p_set text, p_patch_prefix text default null)
returns jsonb
language sql volatile set search_path = public as $$
  with c as (
    select array_agg(b.id) as ids
    from public.boards b
    where b.wave = p_wave
      and (p_patch_prefix is null or b.patch like p_patch_prefix || '%')
      and coalesce(b.origin, '') <> 'synthetic'
      and coalesce(b.snapshot->>'setId', 'set1') = p_set
      -- A non-array `minions` must not raise (jsonb_array_length would): the CASE guarantees the type check first.
      and case when jsonb_typeof(b.snapshot->'minions') = 'array'
               then jsonb_array_length(b.snapshot->'minions') > 0
               else false end
  )
  -- The pick is drawn ONCE (an uncorrelated scalar subquery), then looked up by primary key. Null when no candidates.
  select x.snapshot
  from public.boards x
  where x.id = (select c.ids[1 + floor(random() * cardinality(c.ids))::int] from c)
$$;

grant execute on function public.god_board_sample(int, text, text) to anon, authenticated;
