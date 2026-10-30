-- DM RETENTION: 1 DAY (owner 2026-10-30: "we can shrink it so dm's get cleared after 1 day instead of 90. we dont need
-- chat history like that"). dm_prune now deletes direct messages older than 1 day (was 90 days) and runs HOURLY (was
-- daily at 04:17), so a message lives about 24-25 hours at most. Reports keep their own copy of the body
-- (dm_reports.body) and keep their 180-day window, so a reported message can still be reviewed after the original is
-- gone. reply_to is `on delete set null`, so pruning a quoted message never breaks a newer reply.

create or replace function public.dm_prune()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int;
begin
  delete from public.direct_messages where created_at < now() - interval '1 day';
  get diagnostics v_n = row_count;
  delete from public.dm_reports where created_at < now() - interval '180 days';
  return v_n;
end;
$function$;

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'dm-prune'), schedule := '17 * * * *');
