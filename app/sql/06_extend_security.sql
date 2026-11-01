-- 확장 보안(Supabase 전용). 화면(anon)은 읽기만, 신호·가져오기는 시연 코드 RPC, AI 차감·저장은 Edge Function(service_role)만.
alter table tp_ai_usage enable row level security;
alter table tp_ai_summary enable row level security;
alter table tp_signal_log enable row level security;
drop policy if exists tp_read on tp_ai_usage; create policy tp_read on tp_ai_usage for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_ai_summary; create policy tp_read on tp_ai_summary for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_signal_log; create policy tp_read on tp_signal_log for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_ai_usage, tp_ai_summary, tp_signal_log from anon, authenticated;
revoke execute on function tp_kst_today(), tp_ai_claim(), tp_ai_refund(), tp_ai_save(text, text), tp_ai_facts(),
  tp_ingest_signal(text, text, numeric), tp_import_progress(jsonb) from public, anon, authenticated;
grant execute on function tp_ai_claim(), tp_ai_refund(), tp_ai_save(text, text), tp_ai_facts() to service_role;
grant execute on function tp_ingest_signal(text, text, numeric), tp_import_progress(jsonb) to anon, authenticated;
alter publication supabase_realtime add table tp_ai_summary, tp_ai_usage, tp_signal_log;
