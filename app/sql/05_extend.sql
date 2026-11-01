-- TWIN PRO 확장: (1) AI 운영 요약(하루 10회)  (2) 가상 설비 신호 입구  (3) 엑셀/CSV 실적 가져오기
-- 기존 테이블·함수는 바꾸지 않고 추가만 한다. 상태 변경은 전부 기존 규칙 함수(R1~R7)를 거친다.

-- ========== (1) AI 운영 요약 ==========
-- 사용량: 한국 날짜별 생성 횟수. 결과: 생성된 요약(모든 화면이 실시간으로 같은 요약을 본다).
create table if not exists tp_ai_usage (day date primary key, used int not null default 0);
create table if not exists tp_ai_summary (id bigserial primary key, created_at timestamptz not null default now(), sim_at timestamp not null, text text not null, model text);

create or replace function tp_kst_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 1회 차감(시연 코드 필요, 하루 10회). Edge Function만 호출한다(화면에서 직접 호출 불가).
create or replace function tp_ai_claim() returns json language plpgsql security definer as $$
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

-- 생성 실패 시 1회 되돌림(Edge Function 전용)
create or replace function tp_ai_refund() returns void language sql security definer as $$
  update tp_ai_usage set used = greatest(0, used - 1) where day = tp_kst_today() $$;

-- 결과 저장(Edge Function 전용)
create or replace function tp_ai_save(p_text text, p_model text) returns json language plpgsql security definer as $$
begin
  if coalesce(trim(p_text), '') = '' then return tp_res(false, 'AI 응답이 비어 있습니다.'); end if;
  insert into tp_ai_summary (sim_at, text, model) values (tp_now(), left(trim(p_text), 4000), p_model);
  perform tp_log('AI 운영 요약 생성');
  return tp_res(true, 'AI 운영 요약을 저장했습니다.');
end $$;

-- AI에 넘길 사실(JSON). 서버 DB에서 직접 만든다 → 화면이 보낸 값이 아니라 DB의 현재 상태가 근거.
create or replace function tp_ai_facts() returns json language sql stable security definer as $$
  select json_build_object(
    'sim_now', to_char(tp_now(), 'YYYY-MM-DD HH24:MI'),
    'kpi', (select row_to_json(k) from (select eq_total, eq_running, eq_idle, eq_fault, eq_maint, today_done, today_total, overdue, open_incidents,
              transferred, due_done, due_total, insp_pass, insp_total from tp_v_kpi) k),
    'equipment', (select json_agg(json_build_object('id', e.equipment_id, 'name', e.equipment_name, 'process', p.process_name, 'status', c.label_ko,
              'work_order', e.work_order_id) order by e.equipment_id)
            from tp_equipment e join tp_processes p using (process_id) left join tp_status_codes c on c.code_id = 'equipment:' || e.status),
    'open_incidents', (select json_agg(json_build_object('id', i.incident_id, 'category', i.category, 'severity', i.severity,
              'opened_at', to_char(i.opened_at, 'MM/DD HH24:MI'), 'minutes_open', round(extract(epoch from (tp_now() - i.opened_at)) / 60),
              'summary', i.summary, 'equipment', coalesce(i.equipment_id, w.equipment_id), 'work_order', i.work_order_id, 'block', w.block_id,
              'work_order_status', w.status, 'actions', (select json_agg(a.note order by a.id) from tp_incident_actions a where a.incident_id = i.incident_id))
              order by i.opened_at)
            from tp_incidents i left join tp_work_orders w on w.work_order_id = i.work_order_id where i.status = 'OPEN'),
    'today_work_orders', (select json_agg(json_build_object('id', w.work_order_id, 'block', w.block_id, 'process', p.process_name, 'equipment', w.equipment_id,
              'status', w.status, 'planned_end', to_char(w.planned_end_at, 'MM/DD HH24:MI'), 'progress_pct', round(w.progress_ratio * 100, 1),
              'overdue', w.planned_end_at <= tp_now() and w.status <> 'COMPLETED', 'hold_reason', w.hold_incident) order by p.sequence_no)
            from tp_work_orders w join tp_processes p using (process_id) where w.planned_start_at::date = date '2026-09-16'),
    'recent_events', (select json_agg(x) from (select to_char(at, 'HH24:MI') || ' ' || text x from tp_event_log order by id desc limit 8) e)
  ) $$;

-- ========== (2) 가상 설비 신호 입구 ==========
-- 실제 현장에서는 PLC·게이트웨이가 보낼 신호를 같은 입구로 받는다. 신호는 그대로 상태를 바꾸지 않고, 기존 규칙 함수(R1·R5·R6·보류)를 거친다.
-- 신호: RUN(가동) · STOP(정지) · COUNT(생산 카운트, 값 = 증가 수량) · FAULT(이상 정지)
create table if not exists tp_signal_log (id bigserial primary key, created_at timestamptz not null default now(), sim_at timestamp not null,
  equipment_id text not null, signal text not null, value numeric, ok boolean not null, msg text);

create or replace function tp_ingest_signal(p_eq text, p_signal text, p_value numeric default null) returns json language plpgsql security definer as $$
declare e tp_equipment; w tp_work_orders; r json; sig text := upper(coalesce(trim(p_signal), ''));
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  perform pg_advisory_xact_lock(4242);
  select * into e from tp_equipment where equipment_id = p_eq;
  if not found then return tp_res(false, '설비를 찾을 수 없습니다.'); end if;
  if sig = 'FAULT' then
    r := tp_register_fault(p_eq, '설비 신호: 이상 정지', 'HIGH');
  elsif sig = 'COUNT' then
    select * into w from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' limit 1;
    if p_value is null or p_value <= 0 then r := tp_res(false, '생산 카운트 값은 0보다 커야 합니다.');
    elsif w.work_order_id is null then r := tp_res(false, p_eq || '에서 진행 중인 작업이 없어 카운트를 반영하지 않았습니다.');
    else r := tp_record_progress(w.work_order_id, least(w.planned_qty, w.accepted_qty + p_value)); end if;
  elsif sig = 'STOP' then
    select * into w from tp_work_orders where equipment_id = p_eq and status = 'IN_PROGRESS' limit 1;
    if w.work_order_id is null then r := tp_res(false, p_eq || '에서 진행 중인 작업이 없습니다.');
    else r := tp_hold_work(w.work_order_id, null, '설비 신호: 정지'); end if;
  elsif sig = 'RUN' then
    if e.status = 'FAULT' then r := tp_res(false, p_eq || '는 고장 상태입니다. 사건 해소 → 설비 복구 후에 가동 신호를 받을 수 있습니다.');
    else
      select * into w from tp_work_orders where equipment_id = p_eq and status in ('BLOCKED', 'PLANNED') order by (status = 'BLOCKED') desc, planned_start_at limit 1;
      if w.work_order_id is null then r := tp_res(false, p_eq || '에 배정된 대기 작업이 없습니다.');
      else r := tp_resume_work(w.work_order_id); end if;
    end if;
  else
    r := tp_res(false, '알 수 없는 신호입니다(RUN·STOP·COUNT·FAULT).');
  end if;
  insert into tp_signal_log (sim_at, equipment_id, signal, value, ok, msg) values (tp_now(), p_eq, sig, p_value, (r->>'ok')::boolean, r->>'msg');
  return json_build_object('ok', (r->>'ok')::boolean, 'msg', '[신호 ' || p_eq || ' ' || sig || coalesce(' ' || p_value, '') || '] ' || (r->>'msg'));
end $$;

-- ========== (3) 엑셀/CSV 실적 가져오기 ==========
-- p_rows = [{"work_order_id":"WO008-03","accepted_qty":120}, ...]  누적 인정수량. 한 건이라도 거부되면 전부 취소(한 트랜잭션).
create or replace function tp_import_progress(p_rows jsonb) returns json language plpgsql security definer as $$
declare x jsonb; r json; n int := 0; i int := 0;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [시연 코드]에 입력하세요.'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return tp_res(false, '가져올 행이 없습니다.'); end if;
  if jsonb_array_length(p_rows) > 200 then return tp_res(false, '한 번에 200행까지 가져올 수 있습니다.'); end if;
  begin
    for x in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      if (x->>'accepted_qty') is null or (x->>'accepted_qty') !~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then
        raise exception '%행 %: 인정수량이 숫자가 아닙니다.', i, coalesce(x->>'work_order_id', '?'); end if;
      r := tp_record_progress(x->>'work_order_id', (x->>'accepted_qty')::numeric);
      if not (r->>'ok')::boolean then raise exception '%행 %: %', i, coalesce(x->>'work_order_id', '?'), r->>'msg'; end if;
      n := n + 1;
    end loop;
  exception when others then
    return tp_res(false, '가져오기를 취소했습니다(반영 0건). ' || sqlerrm);
  end;
  perform tp_log('실적 가져오기 ' || n || '건');
  return tp_res(true, '실적 ' || n || '건을 서버 규칙(R6) 검사 후 반영했습니다.');
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'tp\_%' loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
