-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- NAME FILTER: rape, rapist, nazi and hitler are BLOCKED, not just flagged (owner 2026-11-22: "All should be blocked";
-- R-NAME-FILTER-01). Redefines moderation.name_verdict with the lists of packages/sim/src/nameFilter.ts, verbatim (the
-- four words stay in the flag list too, so other forms like "raping" are still flagged). Open flags already matched on
-- one of these words become severity 'block'. APPLY AFTER 2026-11-28-moderation.sql. Idempotent.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════

-- { verdict: 'ok' | 'flag' | 'block', term }. The four lists are packages/sim/src/nameFilter.ts's, verbatim.
create or replace function moderation.name_verdict(p text)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  c_block_sub constant text[] := array['nigger', 'nigga', 'faggot', 'tranny', 'wetback'];
  c_block_words constant text[] := array['fag', 'kike', 'spic', 'chink', 'gook', 'coon', 'dyke', 'retard', 'retarded',
    'rape', 'rapist', 'nazi', 'hitler'];
  c_flag_sub constant text[] := array['fuck', 'fuk', 'fck', 'shit', 'cunt', 'bitch', 'pussy', 'whore', 'slut', 'asshole', 'arsehole', 'twat', 'wank', 'jizz',
    'dildo', 'cocksuck', 'dickhead', 'porn', 'penis', 'vagina', 'boob', 'hentai', 'killyourself',
    'teamascent', 'ascentteam', 'ascentofficial', 'ascentstaff'];
  c_flag_words constant text[] := array['ass', 'arse', 'tits', 'cum', 'cock', 'dick', 'prick', 'bastard', 'sex', 'anal', 'kys', 'stfu', 'gtfo', 'wtf',
    'rape', 'rapist', 'nazi', 'hitler', 'heil', 'negro',
    'admin', 'administrator', 'moderator', 'mod', 'developer', 'official', 'staff'];
  c_block_end constant text[] := array['', 's', 'z'];
  c_flag_end constant text[] := array['', 's', 'es', 'z', 'ed', 'er', 'ers', 'ing', 'y'];
  v_words text[];
  v_hit text;
  r int;
begin
  for r in 1..2 loop
    v_words := moderation.name_words(p, r = 1);
    continue when cardinality(v_words) = 0;
    v_hit := moderation.name_hit(v_words, c_block_sub, c_block_words, c_block_end);
    if v_hit is not null then return jsonb_build_object('verdict', 'block', 'term', v_hit); end if;
  end loop;
  for r in 1..2 loop
    v_words := moderation.name_words(p, r = 1);
    continue when cardinality(v_words) = 0;
    v_hit := moderation.name_hit(v_words, c_flag_sub, c_flag_words, c_flag_end);
    if v_hit is not null then return jsonb_build_object('verdict', 'flag', 'term', v_hit); end if;
  end loop;
  return jsonb_build_object('verdict', 'ok', 'term', null);
end;
$$;

update moderation.name_flags set severity = 'block'
 where status = 'open' and severity <> 'block' and term in ('rape', 'rapist', 'nazi', 'hitler');
