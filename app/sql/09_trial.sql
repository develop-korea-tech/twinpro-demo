-- 체험 모드: 시연 코드 없이 처리 안내 4단계를 실제 서버 규칙으로 실행해 보고, 결과만 돌려준 뒤 전부 되돌린다(저장 안 됨).
-- 원리: 하위 트랜잭션 안에서 규칙 함수를 그대로 실행 → 결과 행을 JSON으로 담아 예외를 던짐 → 예외를 잡으면서 하위 트랜잭션이 롤백됨.
create or replace function tp_code_ok() returns boolean language plpgsql stable as $$
declare h text; c text;
begin
  if current_setting('tp.trial', true) = '1' then return true; end if;   -- tp_try_steps 안에서만 켜짐(트랜잭션 한정, 끝나면 롤백)
  h := current_setting('request.headers', true);
  if h is null or h = '' then return false; end if;
  c := h::json->>'x-demo-code';
  if c is null then return false; end if;
  return exists (select 1 from tp_config where key = 'demo_code_sha256' and value = encode(sha256(convert_to(c, 'UTF8')), 'hex'));
end $$;

create or replace function tp_try_steps(p_inc text, p_steps text[], p_note text default null) returns json language plpgsql security definer as $$
declare i tp_incidents; eq text; r json; res json[] := '{}'; k text; d text;
begin
  if p_steps is null or coalesce(array_length(p_steps, 1), 0) = 0 or array_length(p_steps, 1) > 4 then return tp_res(false, '체험 단계가 올바르지 않습니다.'); end if;
  select * into i from tp_incidents where incident_id = p_inc;
  if not found then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
  eq := coalesce(i.equipment_id, (select equipment_id from tp_work_orders where work_order_id = i.work_order_id));
  begin
    perform set_config('tp.trial', '1', true);
    foreach k in array p_steps loop
      r := case k when 'act' then tp_record_action(p_inc, coalesce(nullif(trim(p_note), ''), '체험 조치'), null)
        when 'resolve' then tp_resolve_incident(p_inc)
        when 'restore' then tp_restore_equipment(eq)
        when 'resume' then tp_resume_work(i.work_order_id)
        else tp_res(false, '알 수 없는 단계입니다.') end;
      res := res || json_build_object('step', k, 'ok', (r->>'ok')::boolean, 'msg', r->>'msg');
      exit when not (r->>'ok')::boolean;
    end loop;
    d := json_build_object('ok', true, 'results', to_json(res), 'rows', json_build_object(
      'equipment', (select json_agg(t) from tp_equipment t), 'work_orders', (select json_agg(t) from tp_work_orders t),
      'incidents', (select json_agg(t) from tp_incidents t), 'incident_actions', (select json_agg(t) from tp_incident_actions t),
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
  execute 'alter function tp_code_ok() set search_path = public, pg_temp';
  execute 'alter function tp_try_steps(text, text[], text) set search_path = public, pg_temp';
end $$;
