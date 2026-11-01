-- 운영(Supabase) 적용용 묶음: 관제 사건 처리 7단계(대체 설비 확인·승인) 추가분만.

-- 순서: 표 2개 → 바뀐 규칙 함수 3개(R5 재개·R7 설비 변경·초기화) → 처리 단계 함수·체험 함수(11) → 보안(12).

-- 기존 데이터는 지우지 않는다. 여러 번 실행해도 결과가 같다.

begin;

-- 대체 설비 적합성 기준정보(가상). 고장 사건에서 남은 작업을 다른 설비로 옮기기 전에 4항목을 확인한다. 시연 중에는 바꾸지 않는다(읽기 전용).
-- 상태값: OK(적합) · COND(조건부) · NO(부적합)
create table if not exists tp_equipment_fit (equipment_id text, process_id text, wps_state text, wps_note text, power_state text, power_note text,
  cert_state text, cert_note text, loc_state text, loc_note text, move_min int, note text, primary key (equipment_id, process_id));
-- 고장 사건 처리 단계 기록: check(대체 가능 여부 확인) · fit(적합성 확인) · approve(관리자 승인). 설비 변경·재개·종료는 작업·사건 상태로 판단한다.
create table if not exists tp_incident_steps (id bigserial primary key, incident_id text not null, step text not null, equipment_id text, at timestamp not null, by_name text);

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

create or replace function tp_reset_core() returns json language plpgsql security definer as $$
declare e record; l tp_equipment_intervals; base timestamp := '2026-09-16 12:00';
begin
  perform pg_advisory_xact_lock(4242);
  -- 1) 시연 중 생긴 행만 삭제
  delete from tp_incident_actions where at >= base;
  delete from tp_incident_steps;
  delete from tp_event_log where at >= base;
  delete from tp_work_history where source = 'demo';
  delete from tp_inspections where source = 'demo';
  delete from tp_production_actual where record_source = 'DEMO';
  delete from tp_incidents where source = 'demo';
  delete from tp_equipment_intervals i where not exists (
    select 1 from jsonb_array_elements((select rows from tp_seed where sheet = 'equipment_intervals')) s where s->>'interval_id' = i.interval_id);
  -- 2) 원본 행의 값을 엑셀 값으로 복원
  update tp_equipment_intervals i set start_at = s.start_at, end_at = s.end_at, status = s.status, work_order_id = s.work_order_id, incident_id = s.incident_id
    from jsonb_populate_recordset(null::tp_equipment_intervals, (select rows from tp_seed where sheet = 'equipment_intervals')) s where s.interval_id = i.interval_id;
  update tp_work_orders w set equipment_id = s.equipment_id, actual_start_at = s.actual_start_at, actual_end_at = s.actual_end_at, status = s.status,
      accepted_qty = s.accepted_qty, progress_ratio = s.progress_ratio, forecast_end_at = s.forecast_end_at, hold_incident = null, memo = ''
    from jsonb_populate_recordset(null::tp_work_orders, (select rows from tp_seed where sheet = 'work_orders')) s where s.work_order_id = w.work_order_id;
  update tp_equipment x set status = s.status, work_order_id = s.work_order_id from tp_equipment_snapshot s where s.equipment_id = x.equipment_id;
  update tp_processes p set process_name = s.process_name
    from jsonb_populate_recordset(null::tp_processes, (select rows from tp_seed where sheet = 'processes')) s where s.process_id = p.process_id;
  update tp_incidents i set status = s.status, resolved_at = s.resolved_at, action_note = s.action_note, owner_team = s.owner_team
    from jsonb_populate_recordset(null::tp_incidents, (select rows from tp_seed where sheet = 'incidents')) s where s.incident_id = i.incident_id;
  insert into tp_sim_clock values (1, base) on conflict (id) do update set now = excluded.now;
  -- 3) 보류 사유 = 보류 작업의 마지막 PAUSE/HOLD 이력 사건
  update tp_work_orders w set hold_incident = (select h.incident_id from tp_work_history h where h.work_order_id = w.work_order_id and h.incident_id is not null
    and (h.event_type like '%PAUSE%' or h.event_type like '%HOLD%') order by h.event_at desc limit 1) where w.status = 'BLOCKED';
  -- 4) 기준시점 열린 구간: 마지막 구간이 12:00에 끝나고 스냅샷과 같으면 계속 열고, 아니면 12:00부터 새 구간
  for e in select * from tp_equipment order by equipment_id loop
    select * into l from tp_equipment_intervals where equipment_id = e.equipment_id order by start_at desc limit 1;
    if l.end_at = base and l.status = e.status and coalesce(l.work_order_id, '') = coalesce(e.work_order_id, '') then
      update tp_equipment_intervals set end_at = null where interval_id = l.interval_id;
    else
      insert into tp_equipment_intervals values (tp_next_id('INT', 4), e.equipment_id, base, null, e.status, e.work_order_id, null);
    end if;
  end loop;
  return tp_res(true, '09/16 12:00 원본 데이터로 초기화했습니다.');
end $$;

-- 설비 고장 사건 처리 7단계(관제 사건 패널):
--   1 고장 확인(조치 기록 R2) → 2 대체 가능 여부 확인 → 3 적합성 확인(WPS·출력·자격·위치) → 4 관리자 승인 → 5 설비 변경(남은 작업만, R7)
--   → 6 작업 재개(R5, 사건은 열린 채) → 7 설비 복구 후 사건 종료(조치 기록 → 해소 R3 → 복구 R4)
-- 단계 순서는 서버가 검사한다. 2~4단계 기록은 tp_incident_steps에 남는다.

-- 대체 설비 적합성 기준정보(가상 값)
insert into tp_equipment_fit values
  ('EQ07', 'P03', 'OK', 'WPS-W03(FCAW 수평·수직) 보유', 'OK', '정격 400A, 요구 350A 이상', 'OK', 'TEAM-03 용접사 FCAW 자격 보유',
   'COND', '같은 03 공장, 작업 위치로 이동 15분', 15, '03 공정 대체 후보 · 적합성 확인 필요'),
  ('EQ08', 'P03', 'OK', 'WPS-W03(FCAW 수평·수직) 보유', 'OK', '정격 400A, 요구 350A 이상', 'OK', 'TEAM-03 용접사 FCAW 자격 보유',
   'OK', '03 공장 내 대기 위치', 0, '예방점검 완료 후 대체 가능')
on conflict do nothing;

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
    for x in select e.equipment_id, e.status from tp_equipment e where e.process_id = w.process_id and e.equipment_id <> i.equipment_id order by e.equipment_id loop
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

-- 체험 모드: 사건 여러 건과 처리 단계를 섞어 실행한다. 단계 문자열 '단계|사건ID|인자' (예: 'act|INC003|전원장치 점검', 'fit|INC003|EQ07')
-- 예전 형식('act', 'resolve', 'restore', 'resume' + p_inc, p_note)과 'tick'은 그대로 동작한다.
create or replace function tp_try_steps(p_inc text, p_steps text[], p_note text default null) returns json language plpgsql security definer as $$
declare i tp_incidents; eq text; r json; res json[] := '{}'; k text; d text; x record; parts text[]; op text; inc text; arg text;
begin
  if p_steps is null or coalesce(array_length(p_steps, 1), 0) = 0 or array_length(p_steps, 1) > 150 then return tp_res(false, '체험 단계가 올바르지 않습니다.'); end if;
  if p_inc is not null and not exists (select 1 from tp_incidents where incident_id = p_inc) then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
  if p_inc is null and exists (select 1 from unnest(p_steps) s where s <> 'tick' and position('|' in s) = 0) then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
  begin
    perform set_config('tp.trial', '1', true);
    foreach k in array p_steps loop
      if k = 'tick' then
        r := tp_advance_clock(5);
        if (r->>'ok')::boolean then
          for x in select w.equipment_id, w.planned_qty from tp_work_orders w join tp_equipment e on e.equipment_id = w.equipment_id
                   where e.status = 'RUNNING' and w.status = 'IN_PROGRESS' order by w.equipment_id loop
            perform tp_ingest_signal(x.equipment_id, 'COUNT', greatest(1, round(x.planned_qty * 0.1)));
          end loop;
        end if;
      else
        if position('|' in k) > 0 then parts := string_to_array(k, '|'); op := parts[1]; inc := parts[2]; arg := array_to_string(parts[3:], '|');
        else op := k; inc := p_inc; arg := p_note; end if;
        select * into i from tp_incidents where incident_id = inc;
        if not found then r := tp_res(false, '사건을 찾을 수 없습니다.');
        else
          eq := coalesce(i.equipment_id, (select equipment_id from tp_work_orders where work_order_id = i.work_order_id));
          r := case op when 'act' then tp_record_action(inc, coalesce(nullif(trim(arg), ''), '체험 조치'), null)
            when 'resolve' then tp_resolve_incident(inc)
            when 'restore' then tp_restore_equipment(eq)
            when 'resume' then tp_resume_work(i.work_order_id)
            when 'check' then tp_incident_step(inc, 'check')
            when 'fit' then tp_incident_step(inc, 'fit', arg)
            when 'approve' then tp_incident_step(inc, 'approve', arg)
            when 'swap' then tp_incident_step(inc, 'swap', arg)
            when 'close' then tp_incident_step(inc, 'close')
            else tp_res(false, '알 수 없는 단계입니다.') end;
        end if;
      end if;
      res := res || json_build_object('step', k, 'ok', (r->>'ok')::boolean, 'msg', r->>'msg');
      exit when not (r->>'ok')::boolean;
    end loop;
    d := json_build_object('ok', true, 'results', to_json(res), 'rows', json_build_object(
      'sim_clock', (select json_agg(t) from tp_sim_clock t), 'signal_log', (select json_agg(t) from tp_signal_log t),
      'equipment', (select json_agg(t) from tp_equipment t), 'work_orders', (select json_agg(t) from tp_work_orders t),
      'incidents', (select json_agg(t) from tp_incidents t), 'incident_actions', (select json_agg(t) from tp_incident_actions t),
      'incident_steps', coalesce((select json_agg(t) from tp_incident_steps t), '[]'),
      'equipment_intervals', (select json_agg(t) from tp_equipment_intervals t), 'work_history', (select json_agg(t) from tp_work_history t),
      'inspections', (select json_agg(t) from tp_inspections t), 'production_actual', (select json_agg(t) from tp_production_actual t),
      'event_log', (select json_agg(t) from tp_event_log t)))::text;
    raise exception using errcode = 'TP001', message = 'TP_TRIAL', detail = d;
  exception when sqlstate 'TP001' then
    get stacked diagnostics d = pg_exception_detail;
  end;
  perform set_config('tp.trial', '', true);
  return d::json;
end $$;

do $$ begin
  execute 'alter function tp_incident_step(text, text, text) set search_path = public, pg_temp';
  execute 'alter function tp_try_steps(text, text[], text) set search_path = public, pg_temp';
end $$;

-- 사건 처리 단계 보안(Supabase 전용). 화면(anon)은 읽기만, 단계 기록은 시연 코드 RPC(또는 체험 모드)로만.
alter table tp_equipment_fit enable row level security;
alter table tp_incident_steps enable row level security;
drop policy if exists tp_read on tp_equipment_fit; create policy tp_read on tp_equipment_fit for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_incident_steps; create policy tp_read on tp_incident_steps for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_equipment_fit, tp_incident_steps from anon, authenticated;
revoke execute on function tp_incident_step(text, text, text) from public;
grant execute on function tp_incident_step(text, text, text) to anon, authenticated;
do $$ begin alter publication supabase_realtime add table tp_incident_steps; exception when duplicate_object then null; end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'tp\_%' loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

commit;
