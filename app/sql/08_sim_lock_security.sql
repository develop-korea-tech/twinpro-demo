-- 재생 잠금 보안(Supabase 전용): 화면은 잠금 상태를 읽기만, 잡기·놓기는 시연 코드 RPC로만
alter table tp_sim_lock enable row level security;
drop policy if exists tp_read on tp_sim_lock; create policy tp_read on tp_sim_lock for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_sim_lock from anon, authenticated;
revoke execute on function tp_sim_claim(text), tp_sim_release(text) from public;
grant execute on function tp_sim_claim(text), tp_sim_release(text) to anon, authenticated;
alter publication supabase_realtime add table tp_sim_lock;
