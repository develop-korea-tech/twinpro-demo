-- TWIN PRO 서버 규칙(RPC). 화면은 테이블을 읽기만 하고, 상태를 바꾸는 일은 전부 아래 함수로만 한다.
-- 모든 변경 함수: (1) 전역 잠금으로 직렬 처리 (2) 규칙 검사 실패 시 아무것도 바꾸지 않고 {ok:false,msg} 반환 (3) 성공 시 {ok:true,msg}.

create or replace function tp_now() returns timestamp language sql stable as $$ select now from tp_sim_clock where id = 1 $$;
create or replace function tp_res(ok boolean, msg text) returns json language sql immutable as $$ select json_build_object('ok', ok, 'msg', msg) $$;
create or replace function tp_hm(t timestamp) returns text language sql immutable as $$ select to_char(t, 'HH24:MI') $$;
create or replace function tp_unit(u text) returns text language sql immutable as $$ select case u when 'm2' then 'm²' else u end $$;

create or replace function tp_next_id(prefix text, w int) returns text language plpgsql as $$
declare n int;
begin
  if prefix = 'INC' then select coalesce(max(substr(incident_id, 4)::int), 0) into n from tp_incidents;
  elsif prefix = 'HIS' then select coalesce(max(substr(history_id, 4)::int), 0) into n from tp_work_history;
  elsif prefix = 'INT' then select coalesce(max(substr(interval_id, 4)::int), 0) into n from tp_equipment_intervals;
  elsif prefix = 'ACT' then select coalesce(max(substr(actual_id, 4)::int), 0) into n from tp_production_actual;
  elsif prefix = 'QC' then select coalesce(max(substr(inspection_id, 3)::int), 0) into n from tp_inspections;
  end if;
  return prefix || lpad((n + 1)::text, w, '0');
end $$;


-- 시연 코드 확인: PostgREST가 넘겨주는 요청 헤더(request.headers)의 x-demo-code를 해시해 비교
create or replace function tp_code_ok() returns boolean language plpgsql stable as $$
declare h text; c text;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return false; end if;
  c := h::json->>'x-demo-code';
  if c is null then return false; end if;
  return exists (select 1 from tp_config where key = 'demo_code_sha256' and value = encode(sha256(convert_to(c, 'UTF8')), 'hex'));
end $$;
create or replace function tp_check_code() returns json language sql stable security definer as $$
  select case when tp_code_ok() then tp_res(true, '시연 코드가 확인되었습니다. 조작할 수 있습니다.') else tp_res(false, '시연 코드가 맞지 않습니다.') end $$;

create or replace function tp_log(t text) returns void language sql as $$ insert into tp_event_log(at, text) values (tp_now(), t) $$;

create or replace function tp_add_history(p_wo text, p_type text, p_inc text, p_note text) returns void language plpgsql as $$
begin
  insert into tp_work_history values (tp_next_id('HIS', 4), p_wo, tp_now(), p_type, p_inc, p_note, 'demo');
end $$;

-- 설비 상태 변경: 열린 구간을 지금 시각에 닫고 새 구간을 연다(같은 시각에 열린 구간이면 대체). 구간 겹침·역전이 생기지 않는다.
create or replace function tp_set_eq_status(p_eq text, p_status text, p_wo text, p_inc text) returns void language plpgsql as $$
declare o tp_equipment_intervals; t timestamp := tp_now();
begin
  select * into o from tp_equipment_intervals where equipment_id = p_eq and end_at is null;
  if found and o.status = p_status and coalesce(o.work_order_id, '') = coalesce(p_wo, '') then
    update tp_equipment set status = p_status, work_order_id = p_wo where equipment_id = p_eq; return;
  end if;
  if found then
    if o.start_at >= t then delete from tp_equipment_intervals where interval_id = o.interval_id;
    else update tp_equipment_intervals set end_at = t where interval_id = o.interval_id; end if;
  end if;
  insert into tp_equipment_intervals values (tp_next_id('INT', 4), p_eq, t, null, p_status, p_wo, p_inc);
  update tp_equipment set status = p_status, work_order_id = p_wo where equipment_id = p_eq;
end $$;

-- R1 고장 등록
create or replace function tp_register_fault(p_eq text, p_summary text, p_severity text default 'HIGH') returns json language plpgsql security definer as $$
declare e tp_equipment; id text; wos text[]; w text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq for update;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if e.status = 'FAULT' then return tp_res(false, p_eq || '는 이미 고장 상태입니다. 기존 사건에 조치를 기록하세요.'); end if;
  if coalesce(trim(p_summary), '') = '' then return tp_res(false, '고장 증상을 입력하세요.'); end if;
  if coalesce(p_severity, 'HIGH') not in ('HIGH', 'MEDIUM', 'LOW') then return tp_res(false, '등급은 HIGH/MEDIUM/LOW 중 하나입니다.'); end if;
  select array_agg(work_order_id order by work_order_id) into wos from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS';
  id := tp_next_id('INC', 3);
  insert into tp_incidents values (id, wos[1], p_eq, 'EQUIPMENT', coalesce(p_severity, 'HIGH'), tp_now(), null, 'OPEN', trim(p_summary), '', '정비조-A', 'demo');
  if wos is not null then
    foreach w in array wos loop
      update tp_work_orders set status = 'BLOCKED', hold_incident = id where work_order_id = w;
      perform tp_add_history(w, 'PAUSE', id, '설비 고장');
    end loop;
  end if;
  perform tp_set_eq_status(p_eq, 'FAULT', coalesce(wos[1], e.work_order_id), id);
  perform tp_log(id || ' ' || p_eq || ' 고장 등록' || coalesce(' → ' || array_to_string(wos, ', ') || ' 보류', ''));
  return tp_res(true, id || ' 고장 사건을 만들었습니다' || coalesce('. ' || array_to_string(wos, ', ') || '를 보류로 바꿨습니다', '') || '.');
end $$;

-- R2 조치 기록 (상태 변화 없음)
create or replace function tp_record_action(p_inc text, p_note text, p_owner text default null) returns json language plpgsql security definer as $$
declare i tp_incidents;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into i from tp_incidents where incident_id = p_inc for update;
  if not found then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
  if i.status <> 'OPEN' then return tp_res(false, '이미 해소된 사건입니다.'); end if;
  if coalesce(trim(p_note), '') = '' then return tp_res(false, '조치 내용을 입력하세요.'); end if;
  insert into tp_incident_actions(incident_id, at, note, owner) values (p_inc, tp_now(), trim(p_note), coalesce(p_owner, i.owner_team));
  if i.work_order_id is not null then perform tp_add_history(i.work_order_id, 'ACTION', p_inc, trim(p_note)); end if;
  perform tp_log(p_inc || ' 조치 기록: ' || trim(p_note));
  return tp_res(true, p_inc || '에 조치를 기록했습니다. 사건과 설비 상태는 그대로입니다.');
end $$;

-- R3 해소 처리 (조치 1건 이상 필요, 설비·작업 상태는 그대로. 품질 사건은 재검사 합격 차수를 기록)
create or replace function tp_resolve_incident(p_inc text) returns json language plpgsql security definer as $$
declare i tp_incidents; q tp_inspections; eqid text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into i from tp_incidents where incident_id = p_inc for update;
  if not found then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
  if i.status <> 'OPEN' then return tp_res(false, '이미 해소된 사건입니다.'); end if;
  if not exists (select 1 from tp_incident_actions where incident_id = p_inc) then return tp_res(false, '해소 전에 조치 기록이 1건 이상 있어야 합니다.'); end if;
  update tp_incidents set status = 'RESOLVED', resolved_at = tp_now() where incident_id = p_inc;
  if i.category = 'QUALITY' then
    select * into q from tp_inspections where work_order_id = i.work_order_id order by attempt_no desc limit 1;
    insert into tp_inspections values (tp_next_id('QC', 3), i.work_order_id, tp_now(), coalesce(q.attempt_no, 0) + 1,
      coalesce(q.failed_points, 0), coalesce(q.failed_points, 0), 0, 'PASS', p_inc, 'demo');
  end if;
  if i.work_order_id is not null then perform tp_add_history(i.work_order_id, 'RESOLVE', p_inc, case when i.category = 'QUALITY' then '재검사 합격, 사건 해소' else '사건 해소' end); end if;
  perform tp_log(p_inc || ' 해소');
  eqid := coalesce(i.equipment_id, (select equipment_id from tp_work_orders where work_order_id = i.work_order_id));
  return tp_res(true, p_inc || '를 해소했습니다.' || case when i.category = 'EQUIPMENT' then ' ' || eqid || '는 아직 고장 상태입니다. 설비 복구를 따로 하세요.' else '' end);
end $$;

-- R4 설비 복구 (해당 설비의 미해소 설비고장 사건이 없어야 함)
create or replace function tp_restore_equipment(p_eq text) returns json language plpgsql security definer as $$
declare e tp_equipment; open_ids text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq for update;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if e.status <> 'FAULT' then return tp_res(false, p_eq || '는 고장 상태가 아닙니다.'); end if;
  select string_agg(i.incident_id, ', ') into open_ids from tp_incidents i left join tp_work_orders w on w.work_order_id = i.work_order_id
   where i.status = 'OPEN' and i.category = 'EQUIPMENT' and coalesce(i.equipment_id, w.equipment_id) = p_eq;
  if open_ids is not null then return tp_res(false, open_ids || '가 미해소라 복구할 수 없습니다.'); end if;
  perform tp_set_eq_status(p_eq, 'IDLE', e.work_order_id, null);
  perform tp_log(p_eq || ' 복구 → 대기');
  return tp_res(true, p_eq || '를 대기 상태로 복구했습니다. 보류된 작업은 작업 관리에서 재개하세요.');
end $$;

-- R5 작업 시작·재개
create or replace function tp_resume_work(p_wo text) returns json language plpgsql security definer as $$
declare w tp_work_orders; e tp_equipment; h tp_incidents; busy text; was text; pre text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into w from tp_work_orders where work_order_id = p_wo for update;
  if not found then return tp_res(false, '작업지시를 찾을 수 없습니다.'); end if;
  if w.status not in ('BLOCKED', 'PLANNED') then return tp_res(false, (select label_ko from tp_status_codes where code_id = 'work_order:' || w.status) || ' 상태에서는 시작·재개할 수 없습니다.'); end if;
  if w.status = 'BLOCKED' and w.hold_incident is not null then
    select * into h from tp_incidents where incident_id = w.hold_incident;
    -- 예외: 설비 고장 사건이 열려 있어도, 승인을 받아 남은 작업을 다른 설비로 옮긴 경우에는 재개할 수 있다(사건은 고장 설비 복구 때까지 열린 채로 둔다)
    if found and h.status = 'OPEN' and not (h.category = 'EQUIPMENT' and w.equipment_id <> h.equipment_id
        and exists (select 1 from tp_incident_steps s where s.incident_id = h.incident_id and s.step = 'approve' and s.equipment_id = w.equipment_id)) then
      return tp_res(false, '보류 사유 ' || h.incident_id || '가 미해소입니다. 먼저 해소하세요.'); end if;
  end if;
  if w.status = 'PLANNED' and w.predecessor_id is not null then
    select status into pre from tp_work_orders where work_order_id = w.predecessor_id;
    if pre <> 'COMPLETED' then return tp_res(false, '선행 작업 ' || w.predecessor_id || '가 완료되지 않았습니다.'); end if;
  end if;
  select * into e from tp_equipment where equipment_id = w.equipment_id for update;
  if e.status in ('FAULT', 'MAINTENANCE') then return tp_res(false, '배정 설비 ' || e.equipment_id || '가 ' || case e.status when 'FAULT' then '고장' else '점검' end || ' 상태입니다.'); end if;
  select work_order_id into busy from tp_work_orders where equipment_id = e.equipment_id and status = 'IN_PROGRESS' and work_order_id <> p_wo limit 1;
  if busy is not null then return tp_res(false, e.equipment_id || '에서 ' || busy || '가 진행 중입니다.'); end if;
  was := w.status;
  update tp_work_orders set status = 'IN_PROGRESS', hold_incident = null, actual_start_at = coalesce(actual_start_at, tp_now()) where work_order_id = p_wo;
  perform tp_set_eq_status(e.equipment_id, 'RUNNING', p_wo, null);
  perform tp_add_history(p_wo, case was when 'PLANNED' then 'START' else 'RESUME' end, case when h.status = 'OPEN' then h.incident_id end,
    case when was = 'PLANNED' then '작업 시작' when h.status = 'OPEN' then '대체 설비 ' || e.equipment_id || '로 작업 재개 · ' || h.incident_id || '은 설비 복구 때까지 유지' else '조치 후 작업 재개' end);
  perform tp_log(p_wo || case was when 'PLANNED' then ' 시작' else ' 재개' end || ' → ' || e.equipment_id || ' 가동');
  return tp_res(true, p_wo || '를 ' || case was when 'PLANNED' then '시작' else '재개' end || '했습니다. ' || e.equipment_id || '가 가동으로 바뀌었습니다.');
end $$;

-- 작업 보류 (진행 중 → 보류, 사유 = 미해소 사건 또는 메모)
create or replace function tp_hold_work(p_wo text, p_inc text, p_memo text) returns json language plpgsql security definer as $$
declare w tp_work_orders; i tp_incidents; e tp_equipment;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into w from tp_work_orders where work_order_id = p_wo for update;
  if not found then return tp_res(false, '작업지시를 찾을 수 없습니다.'); end if;
  if w.status <> 'IN_PROGRESS' then return tp_res(false, '진행 중인 작업만 보류할 수 있습니다.'); end if;
  if p_inc is not null then select * into i from tp_incidents where incident_id = p_inc and status = 'OPEN'; end if;
  if i.incident_id is null and coalesce(trim(p_memo), '') = '' then return tp_res(false, '보류 사유(미해소 사건)를 고르거나 메모에 사유를 적으세요.'); end if;
  update tp_work_orders set status = 'BLOCKED', hold_incident = i.incident_id, memo = coalesce(nullif(trim(p_memo), ''), memo) where work_order_id = p_wo;
  select * into e from tp_equipment where equipment_id = w.equipment_id;
  if e.status = 'RUNNING' and e.work_order_id = p_wo then perform tp_set_eq_status(e.equipment_id, 'IDLE', p_wo, i.incident_id); end if;
  perform tp_add_history(p_wo, 'PAUSE', i.incident_id, coalesce(i.summary, trim(p_memo)));
  perform tp_log(p_wo || ' 보류');
  return tp_res(true, p_wo || '를 보류했습니다.');
end $$;

-- R6 실적 입력 (0 ≤ 인정수량 ≤ 계획수량, 감소 불가. 계획 도달 + 관련 미해소 사건 없음 → 완료)
create or replace function tp_record_progress(p_wo text, p_qty numeric) returns json language plpgsql security definer as $$
declare w tp_work_orders; d numeric; open_ids text; e tp_equipment;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into w from tp_work_orders where work_order_id = p_wo for update;
  if not found then return tp_res(false, '작업지시를 찾을 수 없습니다.'); end if;
  if w.status <> 'IN_PROGRESS' then return tp_res(false, '진행 중인 작업만 실적을 입력할 수 있습니다.'); end if;
  if p_qty is null or p_qty < 0 then return tp_res(false, '인정수량은 0 이상의 숫자여야 합니다.'); end if;
  if p_qty > w.planned_qty then return tp_res(false, '인정수량은 계획수량 ' || w.planned_qty || ' ' || tp_unit(w.unit) || '를 넘을 수 없습니다.'); end if;
  if p_qty < w.accepted_qty then return tp_res(false, '인정수량은 줄일 수 없습니다(현재 ' || w.accepted_qty || ').'); end if;
  d := p_qty - w.accepted_qty;
  if d > 0 then insert into tp_production_actual values (tp_next_id('ACT', 4), p_wo, tp_now(), tp_now(), d, w.unit, 'DEMO'); end if;
  update tp_work_orders set accepted_qty = p_qty, progress_ratio = least(1, p_qty / planned_qty) where work_order_id = p_wo;
  if p_qty = w.planned_qty then
    select string_agg(incident_id, ', ') into open_ids from tp_incidents where status = 'OPEN' and work_order_id = p_wo;
    if open_ids is not null then
      if d > 0 then perform tp_add_history(p_wo, 'PROGRESS', null, '인정수량 ' || p_qty); end if;
      perform tp_log(p_wo || ' 실적 ' || p_qty);
      return tp_res(true, '실적을 저장했습니다. ' || open_ids || '가 미해소라 완료 처리는 하지 않았습니다.');
    end if;
    update tp_work_orders set status = 'COMPLETED', actual_end_at = tp_now(), forecast_end_at = tp_now() where work_order_id = p_wo;
    perform tp_add_history(p_wo, 'COMPLETE', null, '목표 수량 완료');
    select * into e from tp_equipment where equipment_id = w.equipment_id;
    if e.work_order_id = p_wo and not exists (select 1 from tp_work_orders where equipment_id = e.equipment_id and status = 'IN_PROGRESS') then
      perform tp_set_eq_status(e.equipment_id, 'IDLE', null, null);
    end if;
    perform tp_log(p_wo || ' 완료');
    return tp_res(true, p_wo || '를 완료했습니다.');
  end if;
  if d > 0 then perform tp_add_history(p_wo, 'PROGRESS', null, '인정수량 ' || p_qty || ' ' || tp_unit(w.unit)); perform tp_log(p_wo || ' 실적 ' || p_qty); end if;
  return tp_res(true, case when d > 0 then '인정수량 ' || p_qty || ' ' || tp_unit(w.unit) || '를 저장했습니다.' else '변경된 실적이 없습니다.' end);
end $$;

-- R7 설비 변경 (같은 공정, 고장·점검 불가, 진행 중이면 대상 설비가 비어 있어야 함,
--   미해소 사건이 걸린 작업은 관제 사건 처리에서 관리자 승인을 받은 설비로만 변경. 남은 작업만 옮기고 이미 한 실적은 그대로 둔다)
create or replace function tp_change_equipment(p_wo text, p_eq text) returns json language plpgsql security definer as $$
declare w tp_work_orders; n tp_equipment; o tp_equipment; inc text; ap tp_incident_steps; oi text; note text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into w from tp_work_orders where work_order_id = p_wo for update;
  if not found then return tp_res(false, '작업지시를 찾을 수 없습니다.'); end if;
  select * into n from tp_equipment where equipment_id = p_eq for update;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
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

-- 시연 시계 (+분). 16:00 운영 종료까지만.
create or replace function tp_advance_clock(p_min int) returns json language plpgsql security definer as $$
declare t timestamp;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  if p_min is null or p_min <= 0 or p_min > 240 then return tp_res(false, '진행 시간은 1~240분입니다.'); end if;
  t := tp_now() + make_interval(mins => p_min);
  if t > timestamp '2026-09-16 16:00' then return tp_res(false, '16:00 운영 종료 시각까지만 진행할 수 있습니다.'); end if;
  update tp_sim_clock set now = t where id = 1;
  return tp_res(true, '시연 시각 ' || tp_hm(t));
end $$;

create or replace function tp_rename_process(p_pid text, p_name text) returns json language plpgsql security definer as $$
declare old text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  if coalesce(trim(p_name), '') = '' then return tp_res(false, '공정명을 입력하세요.'); end if;
  select process_name into old from tp_processes where process_id = p_pid for update;
  if not found then return tp_res(false, '공정을 찾을 수 없습니다.'); end if;
  update tp_processes set process_name = trim(p_name) where process_id = p_pid;
  perform tp_log(p_pid || ' 공정명 변경 ' || old || ' → ' || trim(p_name));
  return tp_res(true, p_pid || ' 공정명을 ''' || trim(p_name) || '''으로 바꿨습니다. 모든 화면에 반영됩니다.');
end $$;

-- 초기화: 엑셀 원본(tp_seed)으로 모든 테이블을 되돌리고 시연 시계를 09/16 12:00으로.
create or replace function tp_op_minutes(a timestamp, b timestamp) returns numeric language sql immutable as $$
  select coalesce(sum(greatest(0, extract(epoch from (least(b, d + interval '16 hour') - greatest(a, d + interval '8 hour'))) / 60)), 0)
  from generate_series(date_trunc('day', a), date_trunc('day', b), interval '1 day') d
$$;
create or replace view tp_v_occupancy with (security_invoker = true) as
  select e.equipment_id,
    round(coalesce(sum(extract(epoch from (least(coalesce(i.end_at, tp_now()), tp_now()) - greatest(i.start_at, timestamp '2026-09-07 08:00'))) / 60)
      filter (where i.status = 'RUNNING'), 0) / tp_op_minutes(timestamp '2026-09-07 08:00', tp_now()) * 100, 1) as occupancy_pct
  from tp_equipment e left join tp_equipment_intervals i on i.equipment_id = e.equipment_id group by e.equipment_id;
create or replace view tp_v_kpi with (security_invoker = true) as select
  tp_now() as sim_now,
  (select count(*) from tp_equipment) as eq_total,
  (select count(*) from tp_equipment where status = 'RUNNING') as eq_running,
  (select count(*) from tp_equipment where status = 'IDLE') as eq_idle,
  (select count(*) from tp_equipment where status = 'FAULT') as eq_fault,
  (select count(*) from tp_equipment where status = 'MAINTENANCE') as eq_maint,
  (select count(*) from tp_work_orders where planned_start_at::date = date '2026-09-16' and status = 'COMPLETED') as today_done,
  (select count(*) from tp_work_orders where planned_start_at::date = date '2026-09-16') as today_total,
  (select count(*) from tp_work_orders where planned_end_at <= tp_now() and status <> 'COMPLETED') as overdue,
  (select count(*) from tp_incidents where status = 'OPEN') as open_incidents,
  (select count(*) from tp_work_orders where process_id = 'P06' and status = 'COMPLETED') as transferred,
  (select count(*) from tp_work_orders where planned_end_at <= tp_now() and status = 'COMPLETED') as due_done,
  (select count(*) from tp_work_orders where planned_end_at <= tp_now()) as due_total,
  (select count(*) from tp_inspections where result = 'PASS') as insp_pass,
  (select count(*) from tp_inspections) as insp_total;

-- 작업지시 편집 저장(한 트랜잭션): 설비 변경 → 상태 전이 → 실적 → 메모. 하나라도 실패하면 전부 취소.
create or replace function tp_save_work_order(p_wo text, p_eq text, p_status text, p_qty numeric, p_hold text, p_memo text) returns json language plpgsql security definer as $$
declare w tp_work_orders; r json; msgs text[] := '{}';
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  select * into w from tp_work_orders where work_order_id = p_wo;
  if not found then return tp_res(false, '작업지시를 찾을 수 없습니다.'); end if;
  begin
    if p_eq is not null and p_eq <> w.equipment_id then
      r := tp_change_equipment(p_wo, p_eq); if not (r->>'ok')::boolean then raise exception '%', r->>'msg'; end if; msgs := msgs || (r->>'msg');
    end if;
    if p_status is not null and p_status <> w.status then
      if p_status = 'IN_PROGRESS' then r := tp_resume_work(p_wo);
      elsif p_status = 'BLOCKED' then r := tp_hold_work(p_wo, nullif(p_hold, ''), p_memo);
      elsif p_status = 'COMPLETED' then
        if w.status <> 'IN_PROGRESS' then raise exception '진행 중인 작업만 완료할 수 있습니다.'; end if;
        if exists (select 1 from tp_incidents where status = 'OPEN' and work_order_id = p_wo) then
          raise exception '%가 미해소라 완료할 수 없습니다.', (select string_agg(incident_id, ', ') from tp_incidents where status = 'OPEN' and work_order_id = p_wo); end if;
        r := tp_record_progress(p_wo, coalesce(p_qty, w.planned_qty));
        if (r->>'ok')::boolean and (select status from tp_work_orders where work_order_id = p_wo) <> 'COMPLETED' then raise exception '%', r->>'msg'; end if;
      else raise exception '계획 상태로 되돌릴 수 없습니다.'; end if;
      if not (r->>'ok')::boolean then raise exception '%', r->>'msg'; end if; msgs := msgs || (r->>'msg');
    end if;
    if p_qty is not null and p_qty <> (select accepted_qty from tp_work_orders where work_order_id = p_wo) then
      r := tp_record_progress(p_wo, p_qty); if not (r->>'ok')::boolean then raise exception '%', r->>'msg'; end if; msgs := msgs || (r->>'msg');
    end if;
    if p_memo is not null and p_memo is distinct from (select memo from tp_work_orders where work_order_id = p_wo) then
      update tp_work_orders set memo = p_memo where work_order_id = p_wo; msgs := msgs || '메모를 저장했습니다.'::text;
    end if;
  exception when others then
    return tp_res(false, sqlerrm);
  end;
  if array_length(msgs, 1) is null then return tp_res(true, '변경된 내용이 없습니다.'); end if;
  return tp_res(true, array_to_string(array_remove(msgs, ''), ' '));
end $$;

-- 보안 함수의 search_path 고정(스키마 하이재킹 방지)
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'tp\_%' loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
