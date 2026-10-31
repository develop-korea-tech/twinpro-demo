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
