-- VERSUS: one sweep for every mode (R-VERSUS-SWEEP-01). APPLY AFTER 2026-11-02-versus-server-reliability.sql, on the live
-- project only (needs the pg_cron extension, already enabled by 2026-11-01-ranked-duos-sweep-cron.sql). Idempotent.
--
-- Every 2 minutes, `versus_sweep()` ends any 1v1 / Group / Duos match whose players have all been silent for 10 minutes
-- ('abandoned', no winner), runs the Ranked Duos abandoned sweep (which it now contains, so the old 'ranked-duos-sweep'
-- job is removed here), and prunes versus_events older than 14 days. Cheap: it reads only open matches untouched for
-- 10 minutes (a partial index), at most 50 per mode per run, each taken FOR UPDATE SKIP LOCKED.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('ranked-duos-sweep', 'versus-sweep');
  perform cron.schedule('versus-sweep', '*/2 * * * *', 'select public.versus_sweep()');
end;
$$;
