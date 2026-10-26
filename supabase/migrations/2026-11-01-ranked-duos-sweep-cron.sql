-- RANKED DUOS: schedule the abandoned-pair sweep (R-RANKED-DUOS-LEAVE-01). APPLY AFTER 2026-10-29-ranked-duos.sql, on the
-- live project only (needs the pg_cron extension: Supabase Dashboard > Database > Extensions > pg_cron). Idempotent.
--
-- Every 5 minutes, `versus_ranked_duos_sweep_abandoned()` places and settles any Ranked Duos team whose two players have
-- both been silent for 10 minutes, so closing the game never dodges a loss. Cheap: it reads only the open Ranked Duos
-- matches (usually none) and locks each one it settles.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'ranked-duos-sweep';
  perform cron.schedule('ranked-duos-sweep', '*/5 * * * *', 'select public.versus_ranked_duos_sweep_abandoned()');
end;
$$;
