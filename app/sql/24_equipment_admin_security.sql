-- 설비 붙이기 / 없애기 보안(Supabase 전용). 화면(anon)은 시연 코드가 있을 때만 추가 · 사용 중지 · 삭제가 반영된다(함수 안에서 확인).
revoke execute on function tp_equipment_add(text, text, text, text, text, text, int, int), tp_equipment_set_active(text, boolean), tp_equipment_delete(text) from public;
grant execute on function tp_equipment_add(text, text, text, text, text, text, int, int), tp_equipment_set_active(text, boolean), tp_equipment_delete(text) to anon, authenticated;
revoke execute on function tp_equipment_reset() from public, anon, authenticated;
revoke execute on function tp_reset_demo() from public;
grant execute on function tp_reset_demo() to anon, authenticated;
do $$ begin alter publication supabase_realtime add table tp_io_point, tp_equipment_fit; exception when duplicate_object then null; end $$;
