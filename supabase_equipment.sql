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
