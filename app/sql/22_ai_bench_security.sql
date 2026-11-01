-- AI 모델 비교 보안(Supabase 전용). 화면(anon)은 결과 · 모델 목록 읽기만, 회차 확인 · 채점 · 저장은 Edge Function(service_role)만.
alter table tp_ai_model enable row level security;
alter table tp_ai_bench enable row level security;
alter table tp_ai_bench_run enable row level security;
drop policy if exists tp_read on tp_ai_model; create policy tp_read on tp_ai_model for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_ai_bench; create policy tp_read on tp_ai_bench for select to anon, authenticated using (true);
drop policy if exists tp_read on tp_ai_bench_run; create policy tp_read on tp_ai_bench_run for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_ai_model, tp_ai_bench, tp_ai_bench_run from anon, authenticated;
grant select on tp_ai_model, tp_ai_bench, tp_ai_bench_run to anon, authenticated;
revoke execute on function tp_ai_bench_claim(text), tp_ai_bench_score(text), tp_ai_bench_save(text, text, boolean, int, int, int, text, text) from public, anon, authenticated;
grant execute on function tp_ai_bench_claim(text), tp_ai_bench_score(text), tp_ai_bench_save(text, text, boolean, int, int, int, text, text) to service_role;
alter publication supabase_realtime add table tp_ai_bench;
