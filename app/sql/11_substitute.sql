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
