-- TWIN PRO 운영 추이 연출(2026-10-31): 실제 1분 = 현장 1일. Supabase SQL Editor에서 한 번 실행합니다. 기존 표는 바꾸지 않고 추가만 합니다.
-- 실행 후 1분마다 서버 예약 작업(pg_cron)이 tp_live_tick()을 실행해, 아무도 화면을 열지 않아도 일 집계와 당일 데이터가 쌓입니다.
-- TWIN PRO 운영 추이 연출(가상): 실제 1분 = 현장 1일
-- 일 번호 d: 0 = 2026-01-01, 258 = 09-16(시연 기준일), 259 = 09-17 ~ 364 = 12-31(연출 진행, 106일 = 106분마다 처음부터 다시)
-- tp_daily       : 설비별 일 집계(가상 이력 HIST · 기준일 BASE · 연출 LIVE)
-- tp_live_signal : 진행 중인 날의 당일 데이터(시스템 입력 INPUT + 설비 신호 MODBUS · ETOS, 근무 08:00~16:00를 실제 1분에 펼쳐 시각 sent_at에 놓음)
-- tp_live_tick() : 1분마다(pg_cron) 마감된 날을 집계에 넣고, 오늘 신호를 만든다. 같은 시각이면 언제 실행해도 같은 결과.
-- 계산식은 화면(src/live.js lvDay · lvSignals)과 같다(자동 테스트로 일치 확인). 09-16 사건 처리 시나리오 표와는 별개다.

create table if not exists tp_daily (day date not null, equipment_id text not null references tp_equipment(equipment_id),
  op int not null, run int not null, idle int not null, fault int not null, maint int not null, faults int not null, qty double precision not null,
  kind text not null check (kind in ('HIST', 'BASE', 'LIVE')), primary key (day, equipment_id));
create table if not exists tp_live_signal (id bigserial primary key, day date not null, sent_at timestamptz not null, equipment_id text not null,
  signal text not null, value double precision, source text not null);
create index if not exists tp_live_signal_day on tp_live_signal (day);

-- 같은 입력이면 같은 값을 주는 난수(0~1). 화면 lvRnd와 같은 식
create or replace function tp_lv_rnd(d int, e int, k int) returns double precision language sql immutable as $$
  select ((((((d * 1000 + e * 37 + k * 101) % 2147483646) + 1)::bigint * 48271 % 2147483647) * 48271 % 2147483647))::double precision / 2147483647 $$;
create or replace function tp_lv_round(v double precision, n int) returns double precision language sql immutable as $$
  select floor(v * power(10::double precision, n) + 0.5) / power(10::double precision, n) $$;

-- 설비 e(1~8)의 d일 집계
create or replace function tp_lv_day(d int, e int, out day date, out equipment_id text, out op int, out run int, out idle int, out fault int, out maint int, out faults int, out qty double precision)
language plpgsql immutable as $$
declare util double precision[] := array[0.62, 0.55, 0.58, 0.50, 0.60, 0.45, 0.12, 0.08];
  rate double precision[] := array[0.15, 0.02, 0.35, 0.08, 0.6, 0.004, 0.35, 0.35];
  dec int[] := array[0, 0, 1, 0, 1, 0, 1, 1]; pf double precision[] := array[0.03, 0.03, 0.06, 0.03, 0.03, 0.03, 0.01, 0.01];
  season double precision[] := array[-0.08, -0.05, 0, 0.03, 0.05, 0.06, 0.01, -0.06, 0.03, 0.06, 0.08, 0.04];
  dow int; u double precision;
begin
  day := date '2026-01-01' + d; equipment_id := 'EQ0' || e; dow := extract(dow from day)::int;
  op := case dow when 0 then 0 when 6 then 240 else 480 end;
  fault := case when op > 0 and tp_lv_rnd(d, e, 1) < pf[e] then 30 + floor(tp_lv_rnd(d, e, 2) * 120)::int else 0 end;
  maint := case when op > 0 and e = 8 and d % 14 = 3 then 120 else 0 end;
  u := least(0.95, greatest(0.02, util[e] + season[extract(month from day)::int] + (tp_lv_rnd(d, e, 3) - 0.5) * 0.2));
  run := greatest(0, least(op - fault - maint, floor(op * u + 0.5)::int));
  qty := tp_lv_round(run * rate[e] * (0.9 + 0.2 * tp_lv_rnd(d, e, 5)), dec[e]);
  idle := greatest(0, op - run - fault - maint); faults := case when fault > 0 then 1 else 0 end;
end $$;

-- d일 설비 e의 백데이터 신호(f = 근무시간 중 위치 0~1)
create or replace function tp_lv_signals(d int, e int) returns table (f double precision, equipment_id text, signal text, value double precision, source text)
language plpgsql immutable as $$
declare x record; i int := e - 1; dec int[] := array[0, 0, 1, 0, 1, 0, 1, 1]; ff double precision; lft double precision; v double precision; ft double precision; k int;
  src text := case when e in (2, 4, 6) then 'ETOS' else 'MODBUS' end; eq text := 'EQ0' || e;
begin
  select * into x from tp_lv_day(d, e);
  if x.op = 0 or x.run = 0 then return; end if;
  f := tp_lv_round(0.02 + 0.01 * i, 3); equipment_id := eq; signal := 'RUN'; value := null; source := src; return next;
  ff := case when x.fault > 0 then 0.15 + tp_lv_rnd(d, e, 4) * 0.6 else 2 end;
  -- 실적은 사람이 시스템에 입력(하루 3번: 10시 · 13시 · 16시 마감, 출처 INPUT), 가동 · 정지 · 이상은 설비 신호(PLC · ETOS)
  lft := x.qty;
  for k in 0..2 loop
    ft := (array[0.25, 0.625, 0.97]::double precision[])[k + 1] + 0.003 * i;
    v := case when k = 2 then tp_lv_round(lft, dec[e]) else tp_lv_round(x.qty / 3, dec[e]) end;
    lft := tp_lv_round(lft - v, dec[e]);
    if v > 0 then f := tp_lv_round(ft, 3); signal := 'COUNT'; value := v; source := 'INPUT'; return next; source := src; end if;
  end loop;
  if x.fault > 0 then
    f := tp_lv_round(ff, 3); signal := 'FAULT'; value := null; return next;
    f := tp_lv_round(least(0.97, ff + x.fault::double precision / x.op), 3); signal := 'RUN'; return next;
  end if;
  f := 0.985; signal := 'STOP'; value := null; return next;
end $$;

-- 가상 이력(01-01 ~ 09-15)과 시연 기준일(09-16) 채우기
insert into tp_daily (day, equipment_id, op, run, idle, fault, maint, faults, qty, kind)
select x.day, x.equipment_id, x.op, x.run, x.idle, x.fault, x.maint, x.faults, x.qty, case when d < 258 then 'HIST' else 'BASE' end
from generate_series(0, 258) d, generate_series(1, 8) e, lateral tp_lv_day(d, e) x
on conflict (day, equipment_id) do nothing;

-- 1분마다 실행: 마감된 연출일 집계 + 오늘 신호
create or replace function tp_live_tick(p_now timestamptz default now()) returns json language plpgsql security definer as $$
declare m bigint := floor(extract(epoch from p_now) / 60); pos int; cur int; t0 timestamptz; n int;
begin
  pos := (m % 106)::int; cur := 259 + pos; t0 := to_timestamp(m * 60);
  if exists (select 1 from tp_daily where kind = 'LIVE' and day >= date '2026-01-01' + cur) then   -- 회차가 처음부터 다시 시작됨
    delete from tp_daily where kind = 'LIVE'; delete from tp_live_signal;
  end if;
  insert into tp_daily (day, equipment_id, op, run, idle, fault, maint, faults, qty, kind)
  select x.day, x.equipment_id, x.op, x.run, x.idle, x.fault, x.maint, x.faults, x.qty, 'LIVE'
  from generate_series(259, cur - 1) d, generate_series(1, 8) e, lateral tp_lv_day(d, e) x
  on conflict (day, equipment_id) do nothing;
  if not exists (select 1 from tp_live_signal where day = date '2026-01-01' + cur) then
    insert into tp_live_signal (day, sent_at, equipment_id, signal, value, source)
    select date '2026-01-01' + cur, t0 + s.f * interval '60 seconds', s.equipment_id, s.signal, s.value, s.source
    from generate_series(1, 8) e, lateral tp_lv_signals(cur, e) s;
  end if;
  delete from tp_live_signal where day < date '2026-01-01' + cur - 1;
  select count(*) into n from tp_live_signal where day = date '2026-01-01' + cur;
  return json_build_object('ok', true, 'day', date '2026-01-01' + cur, 'signals', n);
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('tp_live_tick', 'tp_lv_rnd', 'tp_lv_round', 'tp_lv_day', 'tp_lv_signals') loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
select tp_live_tick();

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
