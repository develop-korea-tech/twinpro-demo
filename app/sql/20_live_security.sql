-- 운영 추이 연출 보안 + 1분 자동 실행(Supabase 전용). 화면(anon)은 읽기만, 생성은 서버 예약 작업(pg_cron)만.
alter table tp_daily enable row level security;
alter table tp_live_signal enable row level security;
drop policy if exists tp_read on tp_daily; create policy tp_read on tp_daily for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_live_signal; create policy tp_read on tp_live_signal for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_daily, tp_live_signal from anon, authenticated;
grant select on tp_daily, tp_live_signal to anon, authenticated;
revoke execute on function tp_live_tick(timestamptz) from public, anon, authenticated;

-- 1분마다 tp_live_tick() 실행(pg_cron). 이미 있으면 바꿔 등록
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'tp_live_tick';
select cron.schedule('tp_live_tick', '* * * * *', 'select public.tp_live_tick()');
