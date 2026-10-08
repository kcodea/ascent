-- GOD MODE (owner 2026-10-08): one random real player board for a chosen round, for the Practice God Mode prompt
-- "What round should your opponent board be on?". Read-only; boards is already world-readable (select using (true)).
create or replace function public.god_board_sample(p_wave int, p_set text, p_patch_prefix text default null)
returns jsonb
language sql stable set search_path = public as $$
  select b.snapshot
  from public.boards b
  where b.wave = p_wave
    and coalesce(b.snapshot->>'setId', 'set1') = p_set
    and (p_patch_prefix is null or b.patch like p_patch_prefix || '%')
    and coalesce(b.origin, '') <> 'synthetic'
    and jsonb_array_length(coalesce(b.snapshot->'minions', '[]'::jsonb)) > 0
  order by random()
  limit 1
$$;

grant execute on function public.god_board_sample(int, text, text) to anon, authenticated;
