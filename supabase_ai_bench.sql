-- TWIN PRO AI 운영 센터(2026-10-31): 회사별 AI 모델 비교 표 · 회차 제한 · 자동 채점 · 저장. Supabase SQL Editor에서 한 번 실행합니다. 기존 표는 바꾸지 않고 추가만 합니다.
-- TWIN PRO AI 모델 비교(AI 운영 센터): 같은 서버 사실(tp_ai_facts)을 여러 회사 모델에 주고 응답 속도 · 비용 · 정확도를 실측해 기록한다.
-- 버튼을 눌렀을 때만 실행한다(자동 호출 없음). 하루 3회(회차 기준), 시연 코드 필요. 호출 · 저장은 Edge Function(service_role)만.
-- 모델 목록과 단가는 tp_ai_model 표 값이다. 단가는 공개 가격표 기준이며 바뀔 수 있어 출처 · 확인일을 함께 둔다.

create table if not exists tp_ai_model (model_id text primary key, provider text not null check (provider in ('anthropic', 'openai', 'google')),
  label text not null, tier text not null, price_in double precision not null, price_out double precision not null,   -- USD / 100만 토큰
  price_note text not null, enabled boolean not null default true, sort int not null);
insert into tp_ai_model (model_id, provider, label, tier, price_in, price_out, price_note, sort) values
  ('claude-haiku-5-5', 'anthropic', 'Claude Haiku 5.5', '경량', 0.10, 0.50, '공개 가격표 기준 2026-10 확인 · 변경 가능', 1),
  ('claude-sonnet-5-5', 'anthropic', 'Claude Sonnet 5.5', '중간', 2.00, 10.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 2),
  ('claude-opus-5-5', 'anthropic', 'Claude Opus 5.5', '상위', 4.00, 20.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 3),
  ('gpt-6-luna', 'openai', 'OpenAI GPT-6 Luna', '경량', 0.10, 0.50, '공개 가격표 기준 2026-10 확인 · 변경 가능', 4),
  ('gpt-6.1-terra', 'openai', 'OpenAI GPT-6.1 Terra', '중간', 1.00, 5.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 5),
  ('gpt-6.1-sol', 'openai', 'OpenAI GPT-6.1 Sol', '중간', 2.00, 10.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 6),
  ('gpt-6-astra', 'openai', 'OpenAI GPT-6 Astra', '상위', 10.00, 50.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 7),
  ('gemini-3.1-flash-lite', 'google', 'Gemini 3.1 Flash-Lite', '경량', 0.25, 1.50, '공개 가격표 기준 2026-10 확인 · 변경 가능', 8),
  ('gemini-3.6-flash', 'google', 'Gemini 3.6 Flash', '경량', 0.75, 3.75, '공개 가격표 기준 2026-10 확인 · 변경 가능', 9),
  ('gemini-3.1-pro-preview', 'google', 'Gemini 3.1 Pro', '상위', 2.00, 12.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 10),
  ('gemini-4-argon', 'google', 'Gemini 4 Argon', '중간', 2.00, 10.00, '공개 가격표 기준 2026-10 확인 · 변경 가능', 11)
on conflict (model_id) do update set label = excluded.label, tier = excluded.tier, price_in = excluded.price_in, price_out = excluded.price_out, sort = excluded.sort;

create table if not exists tp_ai_bench_run (run_id text primary key, day date not null, created_at timestamptz not null default now());
create table if not exists tp_ai_bench (id bigserial primary key, created_at timestamptz not null default now(), run_id text not null, sim_at timestamp not null,
  model_id text not null, provider text not null, ok boolean not null, latency_ms int, in_tok int, out_tok int, cost_usd double precision,
  score int, checks json, text text, err text);

-- 회차 확인: 같은 회차의 모델 호출은 모두 통과, 새 회차는 하루 3회까지(한국 날짜)
create or replace function tp_ai_bench_claim(p_run text) returns json language plpgsql security definer as $$
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다.'); end if;
  if coalesce(trim(p_run), '') = '' then return tp_res(false, '회차 번호가 없습니다.'); end if;
  insert into tp_ai_bench_run (run_id, day) values (p_run, tp_kst_today()) on conflict (run_id) do nothing;
  if p_run not in (select run_id from tp_ai_bench_run where day = tp_kst_today() order by created_at, run_id limit 3) then
    return tp_res(false, '모델 비교는 하루 3회까지입니다. 내일 다시 실행하세요.'); end if;
  return tp_res(true, '확인');
end $$;

-- 자동 채점(100점): 필수 사실 50 · 지어낸 ID 없음 30 · 형식 20
--   필수 사실 = 미해소 사건 ID와 그 설비 ID가 답에 들어갔는지 / 지어낸 ID = 답에 나온 INC·EQ·WO·블록 ID 중 서버 사실에 없는 것
--   형식 = [현황 요약] [이상 상황 설명] [보고용 한 문단] 세 제목과 800자 이내
create or replace function tp_ai_bench_score(p_text text) returns json language plpgsql stable security definer as $$
declare f text := tp_ai_facts()::text; t text := coalesce(p_text, ''); req text[]; miss text[]; fab text[]; ids text[]; heads int; s double precision;
begin
  select coalesce(array_agg(distinct x), '{}') into req from (
    select incident_id x from tp_incidents where status = 'OPEN'
    union select coalesce(i.equipment_id, w.equipment_id) from tp_incidents i left join tp_work_orders w using (work_order_id) where i.status = 'OPEN') q where x is not null;
  select coalesce(array_agg(x), '{}') into miss from unnest(req) x where position(x in t) = 0;
  select coalesce(array_agg(distinct m[1]), '{}') into ids from regexp_matches(t, '(INC[0-9]{3}|EQ[0-9]{2}|WO[0-9]{3}-[0-9]{2}|B[0-9]{3})', 'g') m;
  select coalesce(array_agg(x), '{}') into fab from unnest(ids) x where position(x in f) = 0;
  heads := (position('[현황 요약]' in t) > 0)::int + (position('[이상 상황 설명]' in t) > 0)::int + (position('[보고용 한 문단]' in t) > 0)::int;
  s := 50.0 * (cardinality(req) - cardinality(miss)) / greatest(cardinality(req), 1)
     + case when cardinality(fab) = 0 then 30 else 0 end
     + 20.0 * heads / 3 * case when length(t) <= 800 then 1 else 0.5 end;
  return json_build_object('score', round(s)::int, 'required', req, 'missing', miss, 'fabricated', fab, 'heads', heads, 'length', length(t));
end $$;

-- 결과 저장: 비용은 tp_ai_model 단가 × 실제 토큰, 점수는 위 채점
create or replace function tp_ai_bench_save(p_run text, p_model text, p_ok boolean, p_latency int, p_in int, p_out int, p_text text, p_err text) returns json language plpgsql security definer as $$
declare m tp_ai_model; sc json; cost double precision;
begin
  select * into m from tp_ai_model where model_id = p_model;
  if not found then return tp_res(false, '모델 목록에 없는 모델입니다.'); end if;
  cost := (coalesce(p_in, 0) * m.price_in + coalesce(p_out, 0) * m.price_out) / 1000000;
  sc := case when p_ok then tp_ai_bench_score(p_text) end;
  insert into tp_ai_bench (run_id, sim_at, model_id, provider, ok, latency_ms, in_tok, out_tok, cost_usd, score, checks, text, err)
  values (p_run, tp_now(), p_model, m.provider, p_ok, p_latency, p_in, p_out, cost, (sc->>'score')::int, sc, left(p_text, 3000), left(p_err, 500));
  return json_build_object('ok', true, 'score', (sc->>'score')::int, 'cost_usd', cost, 'checks', sc);
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tp_ai_bench_claim', 'tp_ai_bench_score', 'tp_ai_bench_save') loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

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
