-- 보안: 화면(anon 키)은 읽기만 가능, 쓰기는 RPC 함수로만. Supabase 전용(로컬 테스트에서는 생략).
do $$ declare t text; begin
  foreach t in array array['tp_seed','tp_vessels','tp_zones','tp_processes','tp_equipment','tp_equipment_snapshot','tp_blocks','tp_status_codes','tp_work_orders',
    'tp_production_plan','tp_production_actual','tp_equipment_intervals','tp_incidents','tp_incident_actions','tp_work_history','tp_inspections','tp_rework','tp_sim_clock','tp_event_log','tp_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tp_read on %I', t);
    if t not in ('tp_seed', 'tp_config') then execute format('create policy tp_read on %I for select to anon, authenticated using (true)', t); end if;
  end loop;
end $$;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke select on tp_seed, tp_config from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function tp_register_fault(text, text, text), tp_record_action(text, text, text), tp_resolve_incident(text), tp_restore_equipment(text),
  tp_resume_work(text), tp_hold_work(text, text, text), tp_record_progress(text, numeric), tp_change_equipment(text, text), tp_advance_clock(int),
  tp_rename_process(text, text), tp_reset_demo(), tp_save_work_order(text, text, text, numeric, text, text), tp_check_code() to anon, authenticated;
grant execute on function tp_now(), tp_op_minutes(timestamp, timestamp) to anon, authenticated;
grant select on tp_v_kpi, tp_v_occupancy to anon, authenticated;
-- 실시간: 이 테이블들이 바뀌면 열려 있는 모든 화면이 다시 읽는다
alter publication supabase_realtime add table tp_equipment, tp_work_orders, tp_incidents, tp_incident_actions, tp_sim_clock, tp_processes, tp_event_log;
