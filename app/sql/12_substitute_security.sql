-- 사건 처리 단계 보안(Supabase 전용). 화면(anon)은 읽기만, 단계 기록은 시연 코드 RPC(또는 체험 모드)로만.
alter table tp_equipment_fit enable row level security;
alter table tp_incident_steps enable row level security;
drop policy if exists tp_read on tp_equipment_fit; create policy tp_read on tp_equipment_fit for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_incident_steps; create policy tp_read on tp_incident_steps for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_equipment_fit, tp_incident_steps from anon, authenticated;
revoke execute on function tp_incident_step(text, text, text) from public;
grant execute on function tp_incident_step(text, text, text) to anon, authenticated;
alter publication supabase_realtime add table tp_incident_steps;
