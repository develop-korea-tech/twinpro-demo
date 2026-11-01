-- TWIN PRO AI 운영 요약 · 우선순위 요약 한도: 하루 5회 → 10회 (2026-11-01). Supabase SQL Editor에서 한 번 실행합니다.
create or replace function tp_ai_claim() returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4243);
  insert into tp_ai_usage as u (day, used) values (tp_kst_today(), 1)
    on conflict (day) do update set used = u.used + 1 where u.used < 10
    returning used into n;
  if n is null then return tp_res(false, '오늘 AI 요약 10회를 모두 사용했습니다. 내일(한국 시간 0시) 다시 가능합니다. 지금은 규칙 기반 요약을 보여 줍니다.'); end if;
  return json_build_object('ok', true, 'msg', '', 'used', n);
end $$;
