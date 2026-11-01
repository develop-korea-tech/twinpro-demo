-- 현장 데이터 수집 연결 보안(Supabase 전용). 수집 포인트는 읽기만, 신호 입구는 기존과 같이 시연 코드가 있어야 반영된다.
alter table tp_io_point enable row level security;
drop policy if exists tp_read on tp_io_point; create policy tp_read on tp_io_point for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on tp_io_point from anon, authenticated;
grant select on tp_io_point to anon, authenticated;
revoke execute on function tp_ingest_signal(text, text, numeric, text) from public;
grant execute on function tp_ingest_signal(text, text, numeric, text) to anon, authenticated;
