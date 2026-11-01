-- 엑셀 원본 적재와 초기화.
-- tp_load_seed(): 비어 있는 테이블에 엑셀 원본(tp_seed)을 넣는다(이미 있는 행은 건너뜀). 처음 설치할 때 한 번.
-- tp_reset_core(): 시연 중 생긴 행(출처 demo, 12:00 이후 조치·기록, 원본에 없는 설비 구간)만 지우고, 원본 행의 바뀐 값은 엑셀 값으로 되돌린다.
create or replace function tp_load_seed() returns json language plpgsql security definer as $$
begin
  perform pg_advisory_xact_lock(4242);
  insert into tp_vessels select * from jsonb_populate_recordset(null::tp_vessels, (select rows from tp_seed where sheet = 'vessels')) on conflict do nothing;
  insert into tp_zones select * from jsonb_populate_recordset(null::tp_zones, (select rows from tp_seed where sheet = 'zones')) on conflict do nothing;
  insert into tp_processes select * from jsonb_populate_recordset(null::tp_processes, (select rows from tp_seed where sheet = 'processes')) on conflict do nothing;
  insert into tp_equipment_snapshot select * from jsonb_populate_recordset(null::tp_equipment_snapshot, (select rows from tp_seed where sheet = 'equipment_snapshot')) on conflict do nothing;
  insert into tp_equipment (equipment_id, equipment_name, process_id, zone_id, resource_kind, capacity_note, status, work_order_id)
    select q.equipment_id, q.equipment_name, q.process_id, q.zone_id, q.resource_kind, q.capacity_note, s.status, s.work_order_id
    from jsonb_populate_recordset(null::tp_equipment, (select rows from tp_seed where sheet = 'equipment')) q join tp_equipment_snapshot s using (equipment_id) on conflict do nothing;
  insert into tp_blocks select * from jsonb_populate_recordset(null::tp_blocks, (select rows from tp_seed where sheet = 'blocks')) on conflict do nothing;
  insert into tp_status_codes select * from jsonb_populate_recordset(null::tp_status_codes, (select rows from tp_seed where sheet = 'status_codes')) on conflict do nothing;
  insert into tp_work_orders select * from jsonb_populate_recordset(null::tp_work_orders, (select rows from tp_seed where sheet = 'work_orders')) on conflict do nothing;
  insert into tp_production_plan select * from jsonb_populate_recordset(null::tp_production_plan, (select rows from tp_seed where sheet = 'production_plan')) on conflict do nothing;
  insert into tp_production_actual select * from jsonb_populate_recordset(null::tp_production_actual, (select rows from tp_seed where sheet = 'production_actual')) on conflict do nothing;
  insert into tp_equipment_intervals select * from jsonb_populate_recordset(null::tp_equipment_intervals, (select rows from tp_seed where sheet = 'equipment_intervals')) on conflict do nothing;
  insert into tp_incidents select * from jsonb_populate_recordset(null::tp_incidents, (select rows from tp_seed where sheet = 'incidents')) on conflict do nothing;
  insert into tp_work_history select * from jsonb_populate_recordset(null::tp_work_history, (select rows from tp_seed where sheet = 'work_history')) on conflict do nothing;
  insert into tp_inspections select * from jsonb_populate_recordset(null::tp_inspections, (select rows from tp_seed where sheet = 'inspections')) on conflict do nothing;
  insert into tp_rework select * from jsonb_populate_recordset(null::tp_rework, (select rows from tp_seed where sheet = 'rework')) on conflict do nothing;
  update tp_incidents set source = 'excel' where source is null;
  update tp_work_history set source = 'excel' where source is null;
  update tp_inspections set source = 'excel' where source is null;
  return tp_reset_core();
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

create or replace function tp_reset_demo() returns json language plpgsql security definer as $$
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  return tp_reset_core();
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'tp\_%' loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
