-- TWIN PRO 2026-11-01 한 번에 적용: 우선순위 → 현장 수집 → 운영 추이 → AI 모델 비교 → 설비 관리 → AI 요약 10회. SQL Editor에 통째로 붙여 넣고 Run 한 번.

-- ===== supabase_priority.sql =====
-- TWIN PRO 작업 관리 우선순위: 온톨로지(관계) 뷰 + 우선순위 계산 + AI 우선순위 요약 저장
-- 기존 테이블·함수는 바꾸지 않고 추가만 한다. 화면(src/model.js ontology/priorities)과 같은 정의다.

-- ========== (1) 온톨로지 뷰: (주어 s, 관계 p, 목적어 o) ==========
-- IN_PROCESS 공정 · AT_ZONE 작업구역 · USES 설비 · OF_BLOCK 블록 · NEXT 다음 공정 · ON_EQ 발생 설비 · STOPS 멈춘 작업 · CAN_SUB 대체 가능
create or replace view tp_v_ontology with (security_invoker = true) as
  select equipment_id s, 'IN_PROCESS' p, process_id o from tp_equipment
  union all select equipment_id, 'AT_ZONE', zone_id from tp_equipment
  union all select work_order_id, 'IN_PROCESS', process_id from tp_work_orders
  union all select work_order_id, 'USES', equipment_id from tp_work_orders
  union all select work_order_id, 'OF_BLOCK', block_id from tp_work_orders
  union all select s, 'NEXT', o from (
    select w.work_order_id s, lead(w.work_order_id) over (partition by w.block_id order by p.sequence_no) o
    from tp_work_orders w join tp_processes p using (process_id)) x where o is not null
  union all select incident_id, 'ON_EQ', equipment_id from tp_incidents where status = 'OPEN' and category = 'EQUIPMENT' and equipment_id is not null
  union all select incident_id, 'STOPS', work_order_id from tp_incidents where status = 'OPEN' and work_order_id is not null
  union all select equipment_id, 'CAN_SUB', process_id from tp_equipment_fit;

-- ========== (2) 우선순위 ==========
-- 기준 순서: ① 공정 전체 막힘 ② 작업 멈춤 ③ 멈춘 시간(분) ④ 밀리는 작업 수. 예측 없이 현재 기록만 쓴다.
create or replace function tp_priority() returns json language sql stable security definer as $$
  with recursive
  i as (
    select i.incident_id, i.category, i.summary, i.opened_at,
      (select o from tp_v_ontology where s = i.incident_id and p = 'STOPS' limit 1) wo
    from tp_incidents i where i.status = 'OPEN'),
  j as (
    select i.*, coalesce((select o from tp_v_ontology where s = i.incident_id and p = 'ON_EQ' limit 1),
                         (select o from tp_v_ontology where s = i.wo and p = 'USES' limit 1)) eq
    from i),
  k as (
    select j.*, w.status wst, w.equipment_id weq, coalesce(w.process_id, e.process_id) pid,
      (j.category = 'EQUIPMENT' and coalesce(e.status, '') = 'FAULT') fault
    from j left join tp_work_orders w on w.work_order_id = j.wo left join tp_equipment e on e.equipment_id = j.eq),
  r(inc, x) as (
    select k.incident_id, (select o from tp_v_ontology where s = k.wo and p = 'NEXT' limit 1) from k where k.wo is not null
    union all
    select r.inc, (select o from tp_v_ontology where s = r.x and p = 'NEXT' limit 1) from r where r.x is not null),
  m as (
    select k.*,
      (select coalesce(json_agg(r.x order by p.sequence_no), '[]'::json) from r join tp_work_orders w2 on w2.work_order_id = r.x join tp_processes p on p.process_id = w2.process_id
         where r.inc = k.incident_id and w2.status <> 'COMPLETED') next_list,
      (select count(*) from r join tp_work_orders w2 on w2.work_order_id = r.x where r.inc = k.incident_id and w2.status <> 'COMPLETED')::int n_next,
      case when k.fault then (select coalesce(json_agg(o.s order by o.s), '[]'::json) from tp_v_ontology o join tp_work_orders w3 on w3.work_order_id = o.s
         where o.p = 'USES' and o.o = k.eq and o.s <> coalesce(k.wo, '') and w3.status <> 'COMPLETED') else '[]'::json end same_list,
      case when k.fault then (select count(*) from tp_v_ontology o join tp_work_orders w3 on w3.work_order_id = o.s
         where o.p = 'USES' and o.o = k.eq and o.s <> coalesce(k.wo, '') and w3.status <> 'COMPLETED') else 0 end::int n_same,
      (k.fault and (k.wo is null or k.weq = k.eq)) blocks,
      (k.wo is not null and k.wst <> 'COMPLETED' and (k.wst = 'BLOCKED' or k.category = 'QUALITY')) stopped,
      round(extract(epoch from (tp_now() - k.opened_at)) / 60)::int minutes,
      case when k.category = 'EQUIPMENT' and k.pid is not null then (select coalesce(json_agg(o.s order by o.s), '[]'::json) from tp_v_ontology o
         where o.p = 'CAN_SUB' and o.o = k.pid and o.s <> coalesce(k.eq, '')) else '[]'::json end subs
    from k)
  select coalesce(json_agg(json_build_object('rank', rn, 'incident', incident_id, 'category', category, 'summary', summary,
      'work_order', wo, 'equipment', eq, 'blocks_process', blocks, 'work_stopped', stopped, 'minutes_open', minutes,
      'waiting', n_next + n_same, 'next_work_orders', next_list, 'same_equipment_waiting', same_list, 'substitutes', subs) order by rn), '[]'::json)
  from (select m.*, row_number() over (order by blocks desc, stopped desc, minutes desc, n_next + n_same desc, incident_id) rn from m) z
$$;

-- ========== (3) AI 우선순위 요약 ==========
-- 하루 10회 한도는 AI 운영 요약과 함께 쓴다(tp_ai_claim). 결과는 별도 표에 저장한다.
create table if not exists tp_ai_priority (id bigserial primary key, created_at timestamptz not null default now(), sim_at timestamp not null, text text not null, model text);

create or replace function tp_ai_save_priority(p_text text, p_model text) returns json language plpgsql security definer as $$
begin
  if coalesce(trim(p_text), '') = '' then return tp_res(false, 'AI 응답이 비어 있습니다.'); end if;
  insert into tp_ai_priority (sim_at, text, model) values (tp_now(), left(trim(p_text), 2000), p_model);
  perform tp_log('AI 우선순위 요약 생성');
  return tp_res(true, 'AI 우선순위 요약을 저장했습니다.');
end $$;

-- AI에 넘길 사실: 서버가 계산한 순위 + 근거 관계. 화면이 보낸 값이 아니라 DB의 현재 상태가 근거다.
create or replace function tp_ai_priority_facts() returns json language sql stable security definer as $$
  select json_build_object(
    'sim_now', to_char(tp_now(), 'YYYY-MM-DD HH24:MI'),
    'criteria', json_build_array('1 공정 전체 막힘(고장 설비에 작업이 남아 있음)', '2 작업 멈춤(보류·품질 보류)', '3 멈춘 시간(분)', '4 밀리는 작업 수'),
    'ranking', tp_priority(),
    'equipment', (select json_agg(json_build_object('id', e.equipment_id, 'name', e.equipment_name, 'status', e.status) order by e.equipment_id) from tp_equipment e),
    'relations', (select json_agg(json_build_array(s, p, o)) from tp_v_ontology where p in ('ON_EQ', 'STOPS', 'CAN_SUB'))
  ) $$;

-- 보안 함수의 search_path 고정(스키마 하이재킹 방지)
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tp_priority', 'tp_ai_save_priority', 'tp_ai_priority_facts') loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
-- 우선순위 보안(Supabase 전용). 화면(anon)은 뷰·순위 읽기만, AI 우선순위 저장·사실은 Edge Function(service_role)만.
grant select on tp_v_ontology to anon, authenticated;
revoke execute on function tp_priority() from public;
grant execute on function tp_priority() to anon, authenticated, service_role;
alter table tp_ai_priority enable row level security;
drop policy if exists tp_read on tp_ai_priority; create policy tp_read on tp_ai_priority for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_ai_priority from anon, authenticated;
revoke execute on function tp_ai_save_priority(text, text), tp_ai_priority_facts() from public, anon, authenticated;
grant execute on function tp_ai_save_priority(text, text), tp_ai_priority_facts() to service_role;
alter publication supabase_realtime add table tp_ai_priority;

-- ===== supabase_io.sql =====
-- TWIN PRO 현장 데이터 수집 연결(2026-10-31): 수집 포인트 표 + 신호 출처. Supabase SQL Editor에서 한 번 실행합니다. 기존 데이터는 바꾸지 않고 추가만 합니다.
-- TWIN PRO 현장 데이터 수집 연결: 수집 포인트(가상 기준정보) + 신호 출처
-- 현장 신호는 두 경로로 들어온다고 정의한다.
--   MODBUS : 개별 장비(PLC·장비 컨트롤러)를 Modbus TCP로 직접 읽음
--   ETOS   : 여러 장비(RS-485 등)를 모은 집약 라우팅 장비(AC&T ETOS 통신 서버)의 메모리(%MW)를 IP(XGT FEnet, 포트 2004)로 읽음
-- 두 경로 모두 연결 프로그램(tools/io_bridge)이 값의 변화를 RUN·STOP·COUNT·FAULT 신호로 바꿔
-- 기존 서버 입구 tp_ingest_signal 하나로 보낸다. 입구 뒤의 규칙(R1~R7)·DB·화면은 바꾸지 않는다.
-- 주소·IP는 실제 현장 값이 아닌 가상 기준정보다(화면에 '가상 기준정보'로 표기).

-- ========== (1) 수집 포인트 ==========
create table if not exists tp_io_point (
  point_id text primary key,
  equipment_id text not null references tp_equipment(equipment_id),
  route text not null check (route in ('MODBUS', 'ETOS')),
  endpoint text not null,          -- MODBUS: 장비 IP:포트(502) / ETOS: 통신 서버 이름 IP:포트(2004)
  unit_id int,                     -- Modbus 장치 번호(ETOS는 없음)
  address text not null,           -- MODBUS: Coil 00001 · DI 10001 · HR 40001 / ETOS: 메모리 주소 %MWn
  data_type text not null,
  signal text not null,            -- 이 포인트가 만드는 신호
  rule text not null,              -- 값 → 신호 변환 규칙
  sort int not null);

delete from tp_io_point;
insert into tp_io_point (point_id, equipment_id, route, endpoint, unit_id, address, data_type, signal, rule, sort)
select e.eq || '-' || p.k, e.eq, e.route,
  case e.route when 'MODBUS' then e.ip || ':502' else 'ETOS-100XP 192.168.20.10:2004' end,
  case e.route when 'MODBUS' then 1 end,
  case e.route when 'MODBUS' then p.mb else '%MW' || (e.n * 100 + p.n - 1) end,
  case e.route when 'MODBUS' then case when p.k = 'CNT' then 'UINT16 누적값' else 'BOOL' end else case when p.k = 'CNT' then 'WORD 누적값' else 'WORD 0/1' end end,
  p.sig, p.rule, e.n * 10 + p.n
from (values ('EQ01', 'MODBUS', '192.168.10.11', 'Z01', 1), ('EQ02', 'ETOS', null, 'Z02', 2), ('EQ03', 'MODBUS', '192.168.10.13', 'Z03', 3),
             ('EQ04', 'ETOS', null, 'Z04', 4), ('EQ05', 'MODBUS', '192.168.10.15', 'Z05', 5), ('EQ06', 'ETOS', null, 'Z06', 6),
             ('EQ07', 'MODBUS', '192.168.10.17', 'Z03', 7), ('EQ08', 'MODBUS', '192.168.10.18', 'Z03', 8)) e(eq, route, ip, zone, n),
     (values ('RUN', 'Coil 00001', 'RUN/STOP', '0 → 1이면 RUN(가동), 1 → 0이면 STOP(정지)', 1),
             ('CNT', 'HR 40001', 'COUNT', '이전 값과의 차이(증가분)를 COUNT 수량으로', 2),
             ('ALM', 'DI 10001', 'FAULT', '0 → 1이면 FAULT(이상 정지)', 3)) p(k, mb, sig, rule, n);

-- ========== (2) 신호 출처 ==========
alter table tp_signal_log add column if not exists source text not null default 'SIM';

-- 입구 함수에 출처 인자(p_source, 기본 SIM)를 더한다. 기존 3인자 호출(화면 시뮬레이터)은 그대로 동작한다.
drop function if exists tp_ingest_signal(text, text, numeric);
create or replace function tp_ingest_signal(p_eq text, p_signal text, p_value numeric default null, p_source text default 'SIM') returns json language plpgsql security definer as $$
declare e tp_equipment; w tp_work_orders; r json; sig text := upper(coalesce(trim(p_signal), '')); src text := upper(coalesce(trim(p_source), 'SIM'));
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  if src not in ('SIM', 'MODBUS', 'ETOS') then return tp_res(false, '알 수 없는 신호 출처입니다(SIM·MODBUS·ETOS).'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if sig = 'FAULT' then
    r := tp_register_fault(p_eq, '설비 신호: 이상 정지', 'HIGH');
  elsif sig = 'COUNT' then
    select * into w from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' limit 1;
    if p_value is null or p_value <= 0 then r := tp_res(false, '생산 카운트 값은 0보다 커야 합니다.');
    elsif w.work_order_id is null then r := tp_res(false, p_eq || '에서 진행 중인 작업이 없어 카운트를 반영하지 않았습니다.');
    else r := tp_record_progress(w.work_order_id, least(w.planned_qty, w.accepted_qty + p_value)); end if;
  elsif sig = 'STOP' then
    select * into w from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' limit 1;
    if w.work_order_id is null then r := tp_res(false, p_eq || '에서 진행 중인 작업이 없습니다.');
    else r := tp_hold_work(w.work_order_id, null, '설비 신호: 정지'); end if;
  elsif sig = 'RUN' then
    if e.status = 'FAULT' then r := tp_res(false, p_eq || '는 고장 상태입니다. 사건 해소 → 설비 복구 후에 가동 신호를 받을 수 있습니다.');
    else
      select * into w from tp_work_orders where equipment_id = p_eq and status in ('BLOCKED', 'PLANNED') order by (status = 'BLOCKED') desc, planned_start_at limit 1;
      if w.work_order_id is null then r := tp_res(false, p_eq || '에 배정된 대기 작업이 없습니다.');
      else r := tp_resume_work(w.work_order_id); end if;
    end if;
  else
    r := tp_res(false, '알 수 없는 신호입니다(RUN·STOP·COUNT·FAULT).');
  end if;
  insert into tp_signal_log (sim_at, equipment_id, signal, value, ok, msg, source) values (tp_now(), p_eq, sig, p_value, (r->>'ok')::boolean, r->>'msg', src);
  return json_build_object('ok', (r->>'ok')::boolean, 'msg', '[신호 ' || p_eq || ' ' || sig || coalesce(' ' || p_value, '') || ' · ' || src || '] ' || (r->>'msg'));
end $$;

-- 보안 함수의 search_path 고정
alter function tp_ingest_signal(text, text, numeric, text) set search_path = public, pg_temp;

-- 현장 데이터 수집 연결 보안(Supabase 전용). 수집 포인트는 읽기만, 신호 입구는 기존과 같이 시연 코드가 있어야 반영된다.
alter table tp_io_point enable row level security;
drop policy if exists tp_read on tp_io_point; create policy tp_read on tp_io_point for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_io_point from anon, authenticated;
grant select on tp_io_point to anon, authenticated;
revoke execute on function tp_ingest_signal(text, text, numeric, text) from public;
grant execute on function tp_ingest_signal(text, text, numeric, text) to anon, authenticated;

-- ===== supabase_live.sql =====
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

-- ===== supabase_ai_bench.sql =====
-- TWIN PRO AI 운영 센터(2026-10-31): 회사별 AI 모델 비교 표 · 회차 제한 · 자동 채점 · 저장. Supabase SQL Editor에서 한 번 실행합니다. 기존 표는 바꾸지 않고 추가만 합니다.
-- TWIN PRO AI 모델 비교(AI 운영 센터): 같은 서버 사실(tp_ai_facts)을 여러 회사 모델에 주고 응답 속도 · 비용 · 정확도를 실측해 기록한다.
-- 버튼을 눌렀을 때만 실행한다(자동 호출 없음). 하루 3회(회차 기준), 시연 코드 필요. 호출 · 저장은 Edge Function(service_role)만.
-- 모델 목록과 단가는 tp_ai_model 표 값이다. 단가는 공개 가격표 기준이며 바뀔 수 있어 출처 · 확인일을 함께 둔다.

create table if not exists tp_ai_model (model_id text primary key, provider text not null check (provider in ('anthropic', 'openai', 'google')),
  label text not null, tier text not null, price_in double precision not null, price_out double precision not null,   -- USD / 100만 토큰
  price_note text not null, enabled boolean not null default true, sort int not null);
insert into tp_ai_model (model_id, provider, label, tier, price_in, price_out, price_note, sort) values
  ('claude-haiku-5-5', 'anthropic', 'Claude Haiku 5.5', '경량', 0.10, 0.50, '공개 가격표 기준 2026-10 확인 · 변경 가능', 1),
  ('claude-sonnet-5-5', 'anthropic', 'Claude Sonnet 5.5', '중간', 2.00, 10.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 2),
  ('claude-opus-5-5', 'anthropic', 'Claude Opus 5.5', '상위', 4.00, 20.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 3),
  ('gpt-6-luna', 'openai', 'OpenAI GPT-6 Luna', '경량', 0.10, 0.50, '공개 가격표 기준 2026-10 확인 · 변경 가능', 4),
  ('gpt-6.1-terra', 'openai', 'OpenAI GPT-6.1 Terra', '중간', 1.00, 5.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 5),
  ('gpt-6.1-sol', 'openai', 'OpenAI GPT-6.1 Sol', '중간', 2.00, 10.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 6),
  ('gpt-6-astra', 'openai', 'OpenAI GPT-6 Astra', '상위', 10.00, 50.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 7),
  ('gemini-3.1-flash-lite', 'google', 'Gemini 3.1 Flash-Lite', '경량', 0.25, 1.50, '공개 가격표 기준 2026-10 확인 · 변경 가능', 8),
  ('gemini-3.6-flash', 'google', 'Gemini 3.6 Flash', '경량', 0.75, 3.75, '공개 가격표 기준 2026-10 확인 · 변경 가능', 9),
  ('gemini-3.1-pro-preview', 'google', 'Gemini 3.1 Pro', '상위', 2.00, 12.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 10),
  ('gemini-4-argon', 'google', 'Gemini 4 Argon', '중간', 2.00, 10.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 11)
on conflict (model_id) do update set label = excluded.label, tier = excluded.tier, price_in = excluded.price_in, price_out = excluded.price_out, sort = excluded.sort;

create table if not exists tp_ai_bench_run (run_id text primary key, day date not null, created_at timestamptz not null default now());
create table if not exists tp_ai_bench (id bigserial primary key, created_at timestamptz not null default now(), run_id text not null, sim_at timestamp not null,
  model_id text not null, provider text not null, ok boolean not null, latency_ms int, in_tok int, out_tok int, cost_usd double precision,
  score int, checks json, text text, err text);

-- 회차 확인: 같은 회차의 모델 호출은 모두 통과, 새 회차는 하루 3회까지(한국 날짜)
create or replace function tp_ai_bench_claim(p_run text) returns json language plpgsql security definer as $$
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다.'); end if;
  if coalesce(trim(p_run), '') = '' then return tp_res(false, '회차 번호가 없습니다.'); end if;
  insert into tp_ai_bench_run (run_id, day) values (p_run, tp_kst_today()) on conflict (run_id) do nothing;
  if p_run not in (select run_id from tp_ai_bench_run where day = tp_kst_today() order by created_at, run_id limit 3) then
    return tp_res(false, '모델 비교는 하루 3회까지입니다. 내일 다시 실행하세요.'); end if;
  return tp_res(true, '확인');
end $$;

-- 자동 채점(100점): 필수 사실 50 · 지어낸 ID 없음 30 · 형식 20
--   필수 사실 = 미해소 사건 ID와 그 설비 ID가 답에 들어갔는지 / 지어낸 ID = 답에 나온 INC·EQ·WO·블록 ID 중 서버 사실에 없는 것
--   형식 = [현황 요약] [이상 상황 설명] [보고용 한 문단] 세 제목과 800자 이내
create or replace function tp_ai_bench_score(p_text text) returns json language plpgsql stable security definer as $$
declare f text := tp_ai_facts()::text; t text := coalesce(p_text, ''); req text[]; miss text[]; fab text[]; ids text[]; heads int; s double precision;
begin
  select coalesce(array_agg(distinct x), '{}') into req from (
    select incident_id x from tp_incidents where status = 'OPEN'
    union select coalesce(i.equipment_id, w.equipment_id) from tp_incidents i left join tp_work_orders w using (work_order_id) where i.status = 'OPEN') q where x is not null;
  select coalesce(array_agg(x), '{}') into miss from unnest(req) x where position(x in t) = 0;
  select coalesce(array_agg(distinct m[1]), '{}') into ids from regexp_matches(t, '(INC[0-9]{3}|EQ[0-9]{2}|WO[0-9]{3}-[0-9]{2}|B[0-9]{3})', 'g') m;
  select coalesce(array_agg(x), '{}') into fab from unnest(ids) x where position(x in f) = 0;
  heads := (position('[현황 요약]' in t) > 0)::int + (position('[이상 상황 설명]' in t) > 0)::int + (position('[보고용 한 문단]' in t) > 0)::int;
  s := 50.0 * (cardinality(req) - cardinality(miss)) / greatest(cardinality(req), 1)
     + case when cardinality(fab) = 0 then 30 else 0 end
     + 20.0 * heads / 3 * case when length(t) <= 800 then 1 else 0.5 end;
  return json_build_object('score', round(s)::int, 'required', req, 'missing', miss, 'fabricated', fab, 'heads', heads, 'length', length(t));
end $$;

-- 결과 저장: 비용은 tp_ai_model 단가 × 실제 토큰, 점수는 위 채점
create or replace function tp_ai_bench_save(p_run text, p_model text, p_ok boolean, p_latency int, p_in int, p_out int, p_text text, p_err text) returns json language plpgsql security definer as $$
declare m tp_ai_model; sc json; cost double precision;
begin
  select * into m from tp_ai_model where model_id = p_model;
  if not found then return tp_res(false, '모델 목록에 없는 모델입니다.'); end if;
  cost := (coalesce(p_in, 0) * m.price_in + coalesce(p_out, 0) * m.price_out) / 1000000;
  sc := case when p_ok then tp_ai_bench_score(p_text) end;
  insert into tp_ai_bench (run_id, sim_at, model_id, provider, ok, latency_ms, in_tok, out_tok, cost_usd, score, checks, text, err)
  values (p_run, tp_now(), p_model, m.provider, p_ok, p_latency, p_in, p_out, cost, (sc->>'score')::int, sc, left(p_text, 3000), left(p_err, 500));
  return json_build_object('ok', true, 'score', (sc->>'score')::int, 'cost_usd', cost, 'checks', sc);
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tp_ai_bench_claim', 'tp_ai_bench_score', 'tp_ai_bench_save') loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- AI 모델 비교 보안(Supabase 전용). 화면(anon)은 결과 · 모델 목록 읽기만, 회차 확인 · 채점 · 저장은 Edge Function(service_role)만.
alter table tp_ai_model enable row level security;
alter table tp_ai_bench enable row level security;
alter table tp_ai_bench_run enable row level security;
drop policy if exists tp_read on tp_ai_model; create policy tp_read on tp_ai_model for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_ai_bench; create policy tp_read on tp_ai_bench for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_ai_bench_run; create policy tp_read on tp_ai_bench_run for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_ai_model, tp_ai_bench, tp_ai_bench_run from anon, authenticated;
grant select on tp_ai_model, tp_ai_bench, tp_ai_bench_run to anon, authenticated;
revoke execute on function tp_ai_bench_claim(text), tp_ai_bench_score(text), tp_ai_bench_save(text, text, boolean, int, int, int, text, text) from public, anon, authenticated;
grant execute on function tp_ai_bench_claim(text), tp_ai_bench_score(text), tp_ai_bench_save(text, text, boolean, int, int, int, text, text) to service_role;
alter publication supabase_realtime add table tp_ai_bench;

-- ===== supabase_equipment.sql =====
-- TWIN PRO 설비 붙이기 / 없애기(2026-10-31): 기준정보 → 설비 탭의 추가 · 사용 중지 · 삭제. Supabase SQL Editor에서 한 번 실행합니다.
-- 먼저 supabase_priority.sql · supabase_io.sql · supabase_live.sql · supabase_ai_bench.sql을 실행한 뒤에 실행합니다(그 파일의 함수 · 표를 사용 중지 조건 한 줄을 더해 다시 만듭니다).
-- TWIN PRO 설비 붙이기 / 없애기(기준정보 → 설비): 시연 중 설비를 추가 · 사용 중지 · 삭제한다.
--   추가     : 이름 · 공정 · 작업구역 · 자원 종류 · 데이터 연결(MODBUS · ETOS · INPUT(시스템 입력만))을 받아 새 설비 번호(EQnn)를 만든다.
--              대기(IDLE) 상태로 시작하고, 연결 경로에 맞는 수집 포인트 3개와 대체 적합성 기준정보(전 항목 '확인 필요' = COND)를 함께 만든다.
--   사용 중지: 작업 · 사건 이력이 있는 설비는 지우지 않고 화면에서만 뺀다(active = false). 다시 [사용]으로 되돌릴 수 있다.
--              진행 중 · 남은 작업이 배정되어 있거나 미해결 사건 · 가동 · 고장 상태면 거부한다(이유 표시).
--   삭제     : 시연 중 추가했고 기록(작업 · 사건 · 신호 · 처리 단계 · 가동 구간)이 없는 설비만 완전 삭제한다. 엑셀 원본 8대는 삭제하지 않는다.
--   초기화   : [데이터 초기화](tp_reset_demo) 때 추가한 설비를 지우고 원본 8대를 모두 사용으로 되돌린다.
-- 운영 추이(1분 = 1일, tp_live_tick)는 원본 8대 기준 그대로다(추가 설비는 반영하지 않음). 3D 조선소는 모델이 고정이라 추가 설비를 그리지 않는다.

-- ========== (1) 사용 여부 ==========
alter table tp_equipment add column if not exists active boolean not null default true;

-- ========== (2) 설비 추가 · 사용 중지 · 삭제 ==========
create or replace function tp_equipment_add(p_name text, p_process text, p_zone text, p_kind text, p_route text, p_ip text default null, p_unit int default null, p_mw int default null)
returns json language plpgsql security definer as $$
declare id text; n int; rt text := upper(coalesce(trim(p_route), '')); zone text := nullif(trim(coalesce(p_zone, '')), ''); ip text := trim(coalesce(p_ip, '')); ep text; t timestamp := tp_now();
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  if coalesce(trim(p_name), '') = '' then return tp_res(false, '설비 이름을 입력하세요.'); end if;
  if length(trim(p_name)) > 30 then return tp_res(false, '설비 이름은 30자 이내로 입력하세요.'); end if;
  if not exists (select 1 from tp_processes where process_id = p_process) then return tp_res(false, '공정을 고르세요.'); end if;
  zone := coalesce(zone, (select zone_id from tp_processes where process_id = p_process));
  if not exists (select 1 from tp_zones where zone_id = zone) then return tp_res(false, '작업구역을 찾을 수 없습니다.'); end if;
  if coalesce(p_kind, '') not in ('설비', '검사자원') then return tp_res(false, '자원 종류는 설비 또는 검사자원입니다.'); end if;
  if rt not in ('MODBUS', 'ETOS', 'INPUT') then return tp_res(false, '데이터 연결을 고르세요(Modbus · ETOS · 시스템 입력만).'); end if;
  if rt = 'MODBUS' then
    if ip !~ '^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$' then return tp_res(false, '장비 IP 형식이 올바르지 않습니다(예: 192.168.10.19).'); end if;
    if p_unit is null or p_unit not between 1 and 247 then return tp_res(false, 'Modbus Unit 번호는 1~247입니다.'); end if;
    ep := ip || ':502';
    if exists (select 1 from tp_io_point p join tp_equipment e using (equipment_id) where p.endpoint = ep and p.unit_id = p_unit) then
      return tp_res(false, ep || ' Unit ' || p_unit || '은(는) 이미 다른 설비가 씁니다.'); end if;
  elsif rt = 'ETOS' then
    if p_mw is null or p_mw not between 0 and 9997 then return tp_res(false, 'ETOS 메모리 시작 번호(%MW)는 0~9997입니다.'); end if;
    if exists (select 1 from tp_io_point where tp_io_point.route = 'ETOS' and substr(address, 4)::int between p_mw and p_mw + 2) then
      return tp_res(false, '%MW' || p_mw || ' ~ %MW' || (p_mw + 2) || '은(는) 이미 다른 설비가 씁니다.'); end if;
  end if;
  select coalesce(max(substr(equipment_id, 3)::int), 0) + 1 into n from tp_equipment where equipment_id ~ '^EQ[0-9]+$';
  if n > 99 then return tp_res(false, '설비는 99대까지 등록할 수 있습니다.'); end if;
  id := 'EQ' || lpad(n::text, 2, '0');
  insert into tp_equipment (equipment_id, equipment_name, process_id, zone_id, resource_kind, capacity_note, status, work_order_id, active)
    values (id, trim(p_name), p_process, zone, p_kind, '시연 중 추가 설비', 'IDLE', null, true);
  insert into tp_equipment_intervals values (tp_next_id('INT', 4), id, t, null, 'IDLE', null, null);
  insert into tp_equipment_fit values (id, p_process, 'COND', '확인 필요 · 신규 설비 WPS 보유 확인 전', 'COND', '확인 필요 · 정격 출력 확인 전',
    'COND', '확인 필요 · 작업자 자격 확인 전', 'COND', '확인 필요 · 작업 위치 · 이동 시간 확인 전', 0, '신규 설비 · 적합성 확인 필요') on conflict do nothing;
  if rt <> 'INPUT' then
    insert into tp_io_point (point_id, equipment_id, route, endpoint, unit_id, address, data_type, signal, rule, sort)
    select id || '-' || k, id, rt, case rt when 'MODBUS' then ep else 'ETOS-100XP 192.168.20.10:2004' end, case rt when 'MODBUS' then p_unit end,
      case rt when 'MODBUS' then mb else '%MW' || (p_mw + j - 1) end,
      case rt when 'MODBUS' then case when k = 'CNT' then 'UINT16 누적값' else 'BOOL' end else case when k = 'CNT' then 'WORD 누적값' else 'WORD 0/1' end end,
      sig, rule, n * 10 + j
    from (values ('RUN', 'Coil 00001', 'RUN/STOP', '0 → 1이면 RUN(가동), 1 → 0이면 STOP(정지)', 1),
                 ('CNT', 'HR 40001', 'COUNT', '이전 값과의 차이(증가분)를 COUNT 수량으로', 2),
                 ('ALM', 'DI 10001', 'FAULT', '0 → 1이면 FAULT(이상 정지)', 3)) p(k, mb, sig, rule, j);
  end if;
  perform tp_log(id || ' 설비 추가 ' || trim(p_name) || ' (' || p_process || ' · ' || case rt when 'MODBUS' then 'Modbus ' || ep when 'ETOS' then 'ETOS %MW' || p_mw else '시스템 입력' end || ')');
  return json_build_object('ok', true, 'id', id, 'msg', id || ' ' || trim(p_name) || '을(를) 추가했습니다. 대기 상태로 시작하며 모든 화면에 반영됩니다.');
end $$;

create or replace function tp_equipment_set_active(p_eq text, p_active boolean) returns json language plpgsql security definer as $$
declare e tp_equipment; wos text; incs text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq for update;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if p_active is null or e.active = p_active then return tp_res(true, ''); end if;
  if p_active then
    update tp_equipment set active = true where equipment_id = p_eq;
    perform tp_log(p_eq || ' 설비 다시 사용');
    return tp_res(true, p_eq || ' ' || e.equipment_name || '을(를) 다시 사용합니다. 모든 화면에 다시 나타납니다.');
  end if;
  select string_agg(incident_id, ', ' order by incident_id) into incs from tp_incidents i where i.status = 'OPEN'
    and (i.equipment_id = p_eq or i.work_order_id in (select work_order_id from tp_work_orders where equipment_id = p_eq));
  if incs is not null then return tp_res(false, p_eq || '에 미해결 사건 ' || incs || '이(가) 있어 사용 중지할 수 없습니다. 사건을 먼저 처리하세요.'); end if;
  if e.status in ('RUNNING', 'FAULT') then return tp_res(false, p_eq || '는 ' || case e.status when 'RUNNING' then '가동' else '고장' end || ' 중이라 사용 중지할 수 없습니다.'); end if;
  select string_agg(work_order_id, ', ' order by work_order_id) into wos from tp_work_orders where equipment_id = p_eq and status <> 'COMPLETED';
  if wos is not null then return tp_res(false, p_eq || '에 남은 작업 ' || wos || '이(가) 있습니다. 작업 관리에서 다른 설비로 옮긴 뒤 사용 중지하세요.'); end if;
  update tp_equipment set active = false where equipment_id = p_eq;
  perform tp_log(p_eq || ' 설비 사용 중지');
  return tp_res(true, p_eq || ' ' || e.equipment_name || '을(를) 사용 중지했습니다. 이력은 남기고 화면 · 대체 후보 · 신호 입구에서 뺍니다.');
end $$;

create or replace function tp_equipment_delete(p_eq text) returns json language plpgsql security definer as $$
declare e tp_equipment;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq for update;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if exists (select 1 from jsonb_array_elements((select rows from tp_seed where sheet = 'equipment')) s where s->>'equipment_id' = p_eq) then
    return tp_res(false, p_eq || '는 엑셀 원본 설비라 삭제하지 않습니다. 화면에서 빼려면 [사용 중지]를 쓰세요.'); end if;
  if exists (select 1 from tp_work_orders where equipment_id = p_eq) or exists (select 1 from tp_incidents where equipment_id = p_eq)
     or exists (select 1 from tp_rework where equipment_id = p_eq) or exists (select 1 from tp_signal_log where equipment_id = p_eq)
     or exists (select 1 from tp_incident_steps where equipment_id = p_eq) or exists (select 1 from tp_equipment_intervals where equipment_id = p_eq and status <> 'IDLE') then
    return tp_res(false, p_eq || '는 작업 · 사건 · 신호 기록이 있어 삭제하지 않습니다. [사용 중지]를 쓰세요.'); end if;
  delete from tp_io_point where equipment_id = p_eq;
  delete from tp_equipment_fit where equipment_id = p_eq;
  delete from tp_equipment_intervals where equipment_id = p_eq;
  delete from tp_equipment where equipment_id = p_eq;
  perform tp_log(p_eq || ' 설비 삭제 ' || e.equipment_name);
  return tp_res(true, p_eq || ' ' || e.equipment_name || '을(를) 삭제했습니다.');
end $$;

-- ========== (3) 사용 중지 설비 제외: 기존 함수 · 뷰를 같은 내용 + 조건 한 줄로 다시 만든다 ==========
-- 상태 개수(KPI) · AI 사실 · 온톨로지(대체 가능 관계) · 대체 후보 확인 · 설비 변경(R7) · 신호 입구에서 사용 중지 설비를 뺀다.
create or replace view tp_v_kpi with (security_invoker = true) as select
  tp_now() as sim_now,
  (select count(*) from tp_equipment where active) as eq_total,
  (select count(*) from tp_equipment where active and status = 'RUNNING') as eq_running,
  (select count(*) from tp_equipment where active and status = 'IDLE') as eq_idle,
  (select count(*) from tp_equipment where active and status = 'FAULT') as eq_fault,
  (select count(*) from tp_equipment where active and status = 'MAINTENANCE') as eq_maint,
  (select count(*) from tp_work_orders where planned_start_at::date = date '2026-09-16' and status = 'COMPLETED') as today_done,
  (select count(*) from tp_work_orders where planned_start_at::date = date '2026-09-16') as today_total,
  (select count(*) from tp_work_orders where planned_end_at <= tp_now() and status <> 'COMPLETED') as overdue,
  (select count(*) from tp_incidents where status = 'OPEN') as open_incidents,
  (select count(*) from tp_work_orders where process_id = 'P06' and status = 'COMPLETED') as transferred,
  (select count(*) from tp_work_orders where planned_end_at <= tp_now() and status = 'COMPLETED') as due_done,
  (select count(*) from tp_work_orders where planned_end_at <= tp_now()) as due_total,
  (select count(*) from tp_inspections where result = 'PASS') as insp_pass,
  (select count(*) from tp_inspections) as insp_total;

create or replace function tp_ai_facts() returns json language sql stable security definer as $$
  select json_build_object(
    'sim_now', to_char(tp_now(), 'YYYY-MM-DD HH24:MI'),
    'kpi', (select row_to_json(k) from (select eq_total, eq_running, eq_idle, eq_fault, eq_maint, today_done, today_total, overdue, open_incidents,
              transferred, due_done, due_total, insp_pass, insp_total from tp_v_kpi) k),
    'equipment', (select json_agg(json_build_object('id', e.equipment_id, 'name', e.equipment_name, 'process', p.process_name, 'status', c.label_ko,
              'work_order', e.work_order_id) order by e.equipment_id)
            from tp_equipment e join tp_processes p using (process_id) left join tp_status_codes c on c.code_id = 'equipment:' || e.status where e.active),
    'open_incidents', (select json_agg(json_build_object('id', i.incident_id, 'category', i.category, 'severity', i.severity,
              'opened_at', to_char(i.opened_at, 'MM/DD HH24:MI'), 'minutes_open', round(extract(epoch from (tp_now() - i.opened_at)) / 60),
              'summary', i.summary, 'equipment', coalesce(i.equipment_id, w.equipment_id), 'work_order', i.work_order_id, 'block', w.block_id,
              'work_order_status', w.status, 'actions', (select json_agg(a.note order by a.id) from tp_incident_actions a where a.incident_id = i.incident_id))
              order by i.opened_at)
            from tp_incidents i left join tp_work_orders w on w.work_order_id = i.work_order_id where i.status = 'OPEN'),
    'today_work_orders', (select json_agg(json_build_object('id', w.work_order_id, 'block', w.block_id, 'process', p.process_name, 'equipment', w.equipment_id,
              'status', w.status, 'planned_end', to_char(w.planned_end_at, 'MM/DD HH24:MI'), 'progress_pct', round(w.progress_ratio * 100, 1),
              'overdue', w.planned_end_at <= tp_now() and w.status <> 'COMPLETED', 'hold_reason', w.hold_incident) order by p.sequence_no)
            from tp_work_orders w join tp_processes p using (process_id) where w.planned_start_at::date = date '2026-09-16'),
    'recent_events', (select json_agg(x) from (select to_char(at, 'HH24:MI') || ' ' || text x from tp_event_log order by id desc limit 8) e)
  ) $$;

create or replace view tp_v_ontology with (security_invoker = true) as
  select equipment_id s, 'IN_PROCESS' p, process_id o from tp_equipment where active
  union all select equipment_id, 'AT_ZONE', zone_id from tp_equipment where active
  union all select work_order_id, 'IN_PROCESS', process_id from tp_work_orders
  union all select work_order_id, 'USES', equipment_id from tp_work_orders
  union all select work_order_id, 'OF_BLOCK', block_id from tp_work_orders
  union all select s, 'NEXT', o from (
    select w.work_order_id s, lead(w.work_order_id) over (partition by w.block_id order by p.sequence_no) o
    from tp_work_orders w join tp_processes p using (process_id)) x where o is not null
  union all select incident_id, 'ON_EQ', equipment_id from tp_incidents where status = 'OPEN' and category = 'EQUIPMENT' and equipment_id is not null
  union all select incident_id, 'STOPS', work_order_id from tp_incidents where status = 'OPEN' and work_order_id is not null
  union all select f.equipment_id, 'CAN_SUB', f.process_id from tp_equipment_fit f join tp_equipment e on e.equipment_id = f.equipment_id where e.active;

create or replace function tp_ai_priority_facts() returns json language sql stable security definer as $$
  select json_build_object(
    'sim_now', to_char(tp_now(), 'YYYY-MM-DD HH24:MI'),
    'criteria', json_build_array('1 공정 전체 막힘(고장 설비에 작업이 남아 있음)', '2 작업 멈춤(보류·품질 보류)', '3 멈춘 시간(분)', '4 밀리는 작업 수'),
    'ranking', tp_priority(),
    'equipment', (select json_agg(json_build_object('id', e.equipment_id, 'name', e.equipment_name, 'status', e.status) order by e.equipment_id) from tp_equipment e where e.active),
    'relations', (select json_agg(json_build_array(s, p, o)) from tp_v_ontology where p in ('ON_EQ', 'STOPS', 'CAN_SUB'))
  ) $$;

create or replace function tp_incident_step(p_inc text, p_step text, p_eq text default null) returns json language plpgsql security definer as $$
declare i tp_incidents; w tp_work_orders; n tp_equipment; f tp_equipment_fit; r json; t text; c text; x record;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into i from tp_incidents where incident_id = p_inc for update;
  if not found then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
  if i.status <> 'OPEN' then return tp_res(false, '이미 종료된 사건입니다.'); end if;
  if i.category <> 'EQUIPMENT' or i.work_order_id is null then return tp_res(false, '설비 고장 사건에서만 쓰는 단계입니다.'); end if;
  if not exists (select 1 from tp_incident_actions where incident_id = p_inc) then return tp_res(false, '먼저 1단계 고장 확인을 기록하세요.'); end if;
  select * into w from tp_work_orders where work_order_id = i.work_order_id;

  if p_step = 'check' then
    for x in select e.equipment_id, e.status from tp_equipment e where e.active and e.process_id = w.process_id and e.equipment_id <> i.equipment_id order by e.equipment_id loop
      if x.status in ('FAULT', 'MAINTENANCE') then c := concat_ws(' · ', c, x.equipment_id || ' 제외(' || case x.status when 'FAULT' then '고장' else '점검 중' end || ')');
      elsif exists (select 1 from tp_work_orders where equipment_id = x.equipment_id and status = 'IN_PROGRESS') then c := concat_ws(' · ', c, x.equipment_id || ' 제외(다른 작업 진행 중)');
      else t := concat_ws(', ', t, x.equipment_id); end if;
    end loop;
    if t is null then return tp_res(false, '같은 공정에 대체할 수 있는 설비가 없습니다. ' || coalesce(c, '')); end if;
    insert into tp_incident_steps (incident_id, step, at, by_name) values (p_inc, 'check', tp_now(), i.owner_team);
    perform tp_log(p_inc || ' 대체 가능 여부 확인: 후보 ' || t);
    return tp_res(true, '대체 후보 ' || t || coalesce(' · ' || c, '') || '. 후보의 적합성을 확인하세요.');
  end if;

  if p_step in ('fit', 'approve', 'swap') then
    if p_eq is null then return tp_res(false, '대체할 설비를 고르세요.'); end if;
    select * into n from tp_equipment where equipment_id = p_eq;
    if not found or n.process_id <> w.process_id or p_eq = i.equipment_id then return tp_res(false, p_eq || '는 대체 후보가 아닙니다.'); end if;
    if not n.active then return tp_res(false, p_eq || '는 사용 중지된 설비라 대체 후보가 아닙니다.'); end if;
  end if;

  if p_step = 'fit' then
    if not exists (select 1 from tp_incident_steps where incident_id = p_inc and step = 'check') then return tp_res(false, '먼저 2단계 대체 가능 여부를 확인하세요.'); end if;
    if n.status in ('FAULT', 'MAINTENANCE') then return tp_res(false, p_eq || '는 ' || case n.status when 'FAULT' then '고장' else '점검' end || ' 상태라 대체할 수 없습니다.'); end if;
    select * into f from tp_equipment_fit where equipment_id = p_eq and process_id = w.process_id;
    if not found then return tp_res(false, p_eq || '의 적합성 기준정보가 없습니다.'); end if;
    if 'NO' in (f.wps_state, f.power_state, f.cert_state, f.loc_state) then return tp_res(false, p_eq || '는 적합성 항목 중 부적합이 있어 대체할 수 없습니다.'); end if;
    insert into tp_incident_steps (incident_id, step, equipment_id, at, by_name) values (p_inc, 'fit', p_eq, tp_now(), i.owner_team);
    t := 'WPS·출력·자격 ' || case when 'COND' in (f.wps_state, f.power_state, f.cert_state) then '일부 조건부' else '적합' end
      || ', 위치 ' || case f.loc_state when 'COND' then '조건부(이동 ' || f.move_min || '분)' else '적합' end;
    perform tp_log(p_inc || ' 적합성 확인 ' || p_eq || ': ' || t);
    return tp_res(true, p_eq || ' 적합성 확인: ' || t || '. 관리자 승인을 받으세요.');
  end if;

  if p_step = 'approve' then
    if not exists (select 1 from tp_incident_steps where incident_id = p_inc and step = 'fit' and equipment_id = p_eq) then return tp_res(false, '먼저 3단계 ' || p_eq || ' 적합성을 확인하세요.'); end if;
    insert into tp_incident_steps (incident_id, step, equipment_id, at, by_name) values (p_inc, 'approve', p_eq, tp_now(), '생산관리');
    perform tp_log(p_inc || ' ' || p_eq || ' 대체 승인(생산관리)');
    return tp_res(true, '생산관리 승인: ' || w.work_order_id || '의 남은 작업을 ' || p_eq || '로 옮길 수 있습니다.');
  end if;

  if p_step = 'swap' then
    return tp_change_equipment(w.work_order_id, p_eq);   -- 승인 여부는 R7이 검사
  end if;

  if p_step = 'resume' then
    return tp_resume_work(w.work_order_id);               -- 대체 설비 재개 허용 여부는 R5가 검사
  end if;

  if p_step = 'close' then
    if (select status from tp_equipment where equipment_id = i.equipment_id) <> 'FAULT' then return tp_res(false, i.equipment_id || '는 고장 상태가 아닙니다.'); end if;
    r := tp_record_action(p_inc, i.equipment_id || ' 복구 확인', null);
    r := tp_resolve_incident(p_inc); if not (r->>'ok')::boolean then return r; end if;
    r := tp_restore_equipment(i.equipment_id); if not (r->>'ok')::boolean then raise exception '%', r->>'msg'; end if;
    return tp_res(true, i.equipment_id || ' 복구 → 대기, ' || p_inc || ' 사건을 종료했습니다.');
  end if;

  return tp_res(false, '알 수 없는 단계입니다.');
end $$;

create or replace function tp_change_equipment(p_wo text, p_eq text) returns json language plpgsql security definer as $$
declare w tp_work_orders; n tp_equipment; o tp_equipment; inc text; ap tp_incident_steps; oi text; note text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into w from tp_work_orders where work_order_id = p_wo for update;
  if not found then return tp_res(false, '작업지시를 찾을 수 없습니다.'); end if;
  select * into n from tp_equipment where equipment_id = p_eq for update;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if not n.active then return tp_res(false, p_eq || '는 사용 중지된 설비라 배정할 수 없습니다.'); end if;
  if w.equipment_id = p_eq then return tp_res(true, ''); end if;
  if n.process_id <> w.process_id then return tp_res(false, p_eq || '는 ' || (select process_name from tp_processes where process_id = w.process_id) || ' 공정 설비가 아닙니다.'); end if;
  if w.status = 'COMPLETED' then return tp_res(false, '완료된 작업은 설비를 바꿀 수 없습니다.'); end if;
  if n.status in ('FAULT', 'MAINTENANCE') then return tp_res(false, p_eq || '는 ' || case n.status when 'FAULT' then '고장' else '점검' end || ' 상태라 배정할 수 없습니다.'); end if;
  if w.status = 'IN_PROGRESS' and exists (select 1 from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' and work_order_id <> p_wo) then
    return tp_res(false, p_eq || '에서 다른 작업이 진행 중입니다.'); end if;
  select incident_id into inc from tp_incidents where status = 'OPEN' and (incident_id = w.hold_incident or work_order_id = p_wo) order by opened_at limit 1;
  if inc is not null then
    select * into ap from tp_incident_steps where incident_id = inc and step = 'approve' and equipment_id = p_eq order by id desc limit 1;
    if ap.id is null then return tp_res(false, inc || '가 걸린 작업입니다. 설비 변경은 관제 사건 패널에서 적합성 확인·관리자 승인 후에 합니다.'); end if;
  end if;
  select * into o from tp_equipment where equipment_id = w.equipment_id;
  update tp_work_orders set equipment_id = p_eq where work_order_id = p_wo;
  if w.status = 'IN_PROGRESS' then
    if o.work_order_id = p_wo and o.status = 'RUNNING' then perform tp_set_eq_status(o.equipment_id, 'IDLE', null, null); end if;
    perform tp_set_eq_status(p_eq, 'RUNNING', p_wo, null);
  elsif o.work_order_id = p_wo then   -- 고장 설비에 남아 있던 작업 표시를 비운다(상태는 그대로)
    select incident_id into oi from tp_equipment_intervals where equipment_id = o.equipment_id and end_at is null;
    perform tp_set_eq_status(o.equipment_id, o.status, null, oi);
  end if;
  note := '설비 변경 ' || o.equipment_id || ' → ' || p_eq;
  if inc is not null then note := note || ' · 남은 작업 ' || (w.planned_qty - w.accepted_qty) || ' ' || tp_unit(w.unit) || ' 이관 · 사유 ' || inc || ' · 승인 ' || ap.by_name || ' ' || tp_hm(ap.at); end if;
  perform tp_add_history(p_wo, 'REASSIGN', inc, note);
  perform tp_log(p_wo || ' 설비 변경 ' || o.equipment_id || ' → ' || p_eq);
  return tp_res(true, p_wo || '의 설비를 ' || p_eq || '로 바꿨습니다.');
end $$;

create or replace function tp_ingest_signal(p_eq text, p_signal text, p_value numeric default null, p_source text default 'SIM') returns json language plpgsql security definer as $$
declare e tp_equipment; w tp_work_orders; r json; sig text := upper(coalesce(trim(p_signal), '')); src text := upper(coalesce(trim(p_source), 'SIM'));
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  if src not in ('SIM', 'MODBUS', 'ETOS') then return tp_res(false, '알 수 없는 신호 출처입니다(SIM·MODBUS·ETOS).'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if not e.active then return tp_res(false, p_eq || '는 사용 중지된 설비입니다. 기준정보 → 설비에서 [사용]으로 바꾼 뒤 신호를 받습니다.'); end if;
  if sig = 'FAULT' then
    r := tp_register_fault(p_eq, '설비 신호: 이상 정지', 'HIGH');
  elsif sig = 'COUNT' then
    select * into w from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' limit 1;
    if p_value is null or p_value <= 0 then r := tp_res(false, '생산 카운트 값은 0보다 커야 합니다.');
    elsif w.work_order_id is null then r := tp_res(false, p_eq || '에서 진행 중인 작업이 없어 카운트를 반영하지 않았습니다.');
    else r := tp_record_progress(w.work_order_id, least(w.planned_qty, w.accepted_qty + p_value)); end if;
  elsif sig = 'STOP' then
    select * into w from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' limit 1;
    if w.work_order_id is null then r := tp_res(false, p_eq || '에서 진행 중인 작업이 없습니다.');
    else r := tp_hold_work(w.work_order_id, null, '설비 신호: 정지'); end if;
  elsif sig = 'RUN' then
    if e.status = 'FAULT' then r := tp_res(false, p_eq || '는 고장 상태입니다. 사건 해소 → 설비 복구 후에 가동 신호를 받을 수 있습니다.');
    else
      select * into w from tp_work_orders where equipment_id = p_eq and status in ('BLOCKED', 'PLANNED') order by (status = 'BLOCKED') desc, planned_start_at limit 1;
      if w.work_order_id is null then r := tp_res(false, p_eq || '에 배정된 대기 작업이 없습니다.');
      else r := tp_resume_work(w.work_order_id); end if;
    end if;
  else
    r := tp_res(false, '알 수 없는 신호입니다(RUN·STOP·COUNT·FAULT).');
  end if;
  insert into tp_signal_log (sim_at, equipment_id, signal, value, ok, msg, source) values (tp_now(), p_eq, sig, p_value, (r->>'ok')::boolean, r->>'msg', src);
  return json_build_object('ok', (r->>'ok')::boolean, 'msg', '[신호 ' || p_eq || ' ' || sig || coalesce(' ' || p_value, '') || ' · ' || src || '] ' || (r->>'msg'));
end $$;

-- ========== (4) 초기화: 추가한 설비를 지우고 원본 8대를 사용으로 ==========
create or replace function tp_equipment_reset() returns void language plpgsql security definer as $$
declare added text[];
begin
  select coalesce(array_agg(equipment_id), '{}') into added from tp_equipment
  where equipment_id not in (select s->>'equipment_id' from jsonb_array_elements((select rows from tp_seed where sheet = 'equipment')) s);
  delete from tp_io_point where equipment_id = any (added);
  delete from tp_equipment_fit where equipment_id = any (added);
  delete from tp_equipment_intervals where equipment_id = any (added);
  delete from tp_signal_log where equipment_id = any (added);
  delete from tp_rework where equipment_id = any (added);
  delete from tp_equipment where equipment_id = any (added);
  update tp_equipment set active = true where not active;
end $$;

create or replace function tp_reset_demo() returns json language plpgsql security definer as $$
declare r json;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  r := tp_reset_core();
  perform tp_equipment_reset();
  return r;
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('tp_equipment_add', 'tp_equipment_set_active', 'tp_equipment_delete', 'tp_equipment_reset', 'tp_reset_demo', 'tp_ai_facts', 'tp_ai_priority_facts',
                      'tp_incident_step', 'tp_change_equipment', 'tp_ingest_signal') loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 설비 붙이기 / 없애기 보안(Supabase 전용). 화면(anon)은 시연 코드가 있을 때만 추가 · 사용 중지 · 삭제가 반영된다(함수 안에서 확인).
revoke execute on function tp_equipment_add(text, text, text, text, text, text, int, int), tp_equipment_set_active(text, boolean), tp_equipment_delete(text) from public;
grant execute on function tp_equipment_add(text, text, text, text, text, text, int, int), tp_equipment_set_active(text, boolean), tp_equipment_delete(text) to anon, authenticated;
revoke execute on function tp_equipment_reset() from public, anon, authenticated;
revoke execute on function tp_reset_demo() from public;
grant execute on function tp_reset_demo() to anon, authenticated;
do $$ begin alter publication supabase_realtime add table tp_io_point, tp_equipment_fit; exception when duplicate_object then null; end $$;

-- ===== supabase_ai_limit10.sql =====
-- TWIN PRO AI 운영 요약 · 우선순위 요약 한도: 하루 5회 → 10회 (2026-11-01). Supabase SQL Editor에서 한 번 실행합니다.
create or replace function tp_ai_claim() returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4243);
  insert into tp_ai_usage as u (day, used) values (tp_kst_today(), 1)
    on conflict (day) do update set used = u.used + 1 where u.used < 10
    returning used into n;
  if n is null then return tp_res(false, '오늘 AI 요약 10회를 모두 사용했습니다. 내일(한국 시간 0시) 다시 가능합니다. 지금은 규칙 기반 요약을 보여 줍니다.'); end if;
  return json_build_object('ok', true, 'msg', '', 'used', n);
end $$;
