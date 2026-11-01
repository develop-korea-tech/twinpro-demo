-- 우선순위 보안(Supabase 전용). 화면(anon)은 뷰·순위 읽기만, AI 우선순위 저장·사실은 Edge Function(service_role)만.
grant select on tp_v_ontology to anon, authenticated;
revoke execute on function tp_priority() from public;
grant execute on function tp_priority() to anon, authenticated, service_role;
alter table tp_ai_priority enable row level security;
drop policy if exists tp_read on tp_ai_priority; create policy tp_read on tp_ai_priority for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_ai_priority from anon, authenticated;
revoke execute on function tp_ai_save_priority(text, text), tp_ai_priority_facts() from public, anon, authenticated;
grant execute on function tp_ai_save_priority(text, text), tp_ai_priority_facts() to service_role;
alter publication supabase_realtime add table tp_ai_priority;
