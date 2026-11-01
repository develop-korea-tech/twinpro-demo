-- 체험 모드 확장: 시연 코드 없이도 '내 화면에서만' 가상 시간을 흐르게 한다(저장 안 됨).
-- 'tick' 단계 = 자동 재생 한 번(시연 시각 +5분, 가동 중 설비마다 계획수량 10% 생산 카운트 신호). 처리 안내 단계와 섞어 순서대로 다시 실행한다.
create or replace function tp_try_steps(p_inc text, p_steps text[], p_note text default null) returns json language plpgsql security definer as $$
declare i tp_incidents; eq text; r json; res json[] := '{}'; k text; d text; x record;
begin
  if p_steps is null or coalesce(array_length(p_steps, 1), 0) = 0 or array_length(p_steps, 1) > 60 then return tp_res(false, '체험 단계가 올바르지 않습니다.'); end if;
  if p_inc is not null then
    select * into i from tp_incidents where incident_id = p_inc;
    if not found then return tp_res(false, '사건을 찾을 수 없습니다.'); end if;
    eq := coalesce(i.equipment_id, (select equipment_id from tp_work_orders where work_order_id = i.work_order_id));
  elsif exists (select 1 from unnest(p_steps) s where s <> 'tick') then return tp_res(false, '사건을 찾을 수 없습니다.');
  end if;
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
        r := case k when 'act' then tp_record_action(p_inc, coalesce(nullif(trim(p_note), ''), '체험 조치'), null)
          when 'resolve' then tp_resolve_incident(p_inc)
          when 'restore' then tp_restore_equipment(eq)
          when 'resume' then tp_resume_work(i.work_order_id)
          else tp_res(false, '알 수 없는 단계입니다.') end;
      end if;
      res := res || json_build_object('step', k, 'ok', (r->>'ok')::boolean, 'msg', r->>'msg');
      exit when not (r->>'ok')::boolean;
    end loop;
    d := json_build_object('ok', true, 'results', to_json(res), 'rows', json_build_object(
      'sim_clock', (select json_agg(t) from tp_sim_clock t), 'signal_log', (select json_agg(t) from tp_signal_log t),
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
  execute 'alter function tp_try_steps(text, text[], text) set search_path = public, pg_temp';
end $$;
