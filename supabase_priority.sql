-- TWIN PRO 작업 관리 우선순위: 온톨로지(관계) 뷰 + 우선순위 계산 + AI 우선순위 요약 저장
-- 기존 테이블·함수는 바꾸지 않고 추가만 한다. 화면(src/model.js ontology/priorities)과 같은 정의다.

-- ========== (1) 온톨로지 뷰: (주어 s, 관계 p, 목적어 o) ==========
-- IN_PROCESS 공정 · AT_ZONE 작업구역 · USES 설비 · OF_BLOCK 블록 · NEXT 다음 공정 · ON_EQ 발생 설비 · STOPS 멈춘 작업 · CAN_SUB 대체 가능
create or replace view tp_v_ontology with (security_invoker = true) as
  select equipment_id s, 'IN_PROCESS' p, process_id o from tp_equipment
  union all select equipment_id, 'AT_ZONE', zone_id from tp_equipment
  union all select work_order_id, 'IN_PROCESS', process_id from tp_work_orders
  union all select work_order_id, 'USES', equipment_id from tp_work_orders
  union all select work_order_id, 'OF_BLOCK', block_id from tp_work_orders
  union all select s, 'NEXT', o from (
    select w.work_order_id s, lead(w.work_order_id) over (partition by w.block_id order by p.sequence_no) o
    from tp_work_orders w join tp_processes p using (process_id)) x where o is not null
  union all select incident_id, 'ON_EQ', equipment_id from tp_incidents where status = 'OPEN' and category = 'EQUIPMENT' and equipment_id is not null
  union all select incident_id, 'STOPS', work_order_id from tp_incidents where status = 'OPEN' and work_order_id is not null
  union all select equipment_id, 'CAN_SUB', process_id from tp_equipment_fit;

-- ========== (2) 우선순위 ==========
-- 기준 순서: ① 공정 전체 막힘 ② 작업 멈춤 ③ 멈춘 시간(분) ④ 밀리는 작업 수. 예측 없이 현재 기록만 쓴다.
create or replace function tp_priority() returns json language sql stable security definer as $$
  with recursive
  i as (
    select i.incident_id, i.category, i.summary, i.opened_at,
      (select o from tp_v_ontology where s = i.incident_id and p = 'STOPS' limit 1) wo
    from tp_incidents i where i.status = 'OPEN'),
  j as (
    select i.*, coalesce((select o from tp_v_ontology where s = i.incident_id and p = 'ON_EQ' limit 1),
                         (select o from tp_v_ontology where s = i.wo and p = 'USES' limit 1)) eq
    from i),
  k as (
    select j.*, w.status wst, w.equipment_id weq, coalesce(w.process_id, e.process_id) pid,
      (j.category = 'EQUIPMENT' and coalesce(e.status, '') = 'FAULT') fault
    from j left join tp_work_orders w on w.work_order_id = j.wo left join tp_equipment e on e.equipment_id = j.eq),
  r(inc, x) as (
    select k.incident_id, (select o from tp_v_ontology where s = k.wo and p = 'NEXT' limit 1) from k where k.wo is not null
    union all
    select r.inc, (select o from tp_v_ontology where s = r.x and p = 'NEXT' limit 1) from r where r.x is not null),
  m as (
    select k.*,
      (select coalesce(json_agg(r.x order by p.sequence_no), '[]'::json) from r join tp_work_orders w2 on w2.work_order_id = r.x join tp_processes p on p.process_id = w2.process_id
         where r.inc = k.incident_id and w2.status <> 'COMPLETED') next_list,
      (select count(*) from r join tp_work_orders w2 on w2.work_order_id = r.x where r.inc = k.incident_id and w2.status <> 'COMPLETED')::int n_next,
      case when k.fault then (select coalesce(json_agg(o.s order by o.s), '[]'::json) from tp_v_ontology o join tp_work_orders w3 on w3.work_order_id = o.s
         where o.p = 'USES' and o.o = k.eq and o.s <> coalesce(k.wo, '') and w3.status <> 'COMPLETED') else '[]'::json end same_list,
      case when k.fault then (select count(*) from tp_v_ontology o join tp_work_orders w3 on w3.work_order_id = o.s
         where o.p = 'USES' and o.o = k.eq and o.s <> coalesce(k.wo, '') and w3.status <> 'COMPLETED') else 0 end::int n_same,
      (k.fault and (k.wo is null or k.weq = k.eq)) blocks,
      (k.wo is not null and k.wst <> 'COMPLETED' and (k.wst = 'BLOCKED' or k.category = 'QUALITY')) stopped,
      round(extract(epoch from (tp_now() - k.opened_at)) / 60)::int minutes,
      case when k.category = 'EQUIPMENT' and k.pid is not null then (select coalesce(json_agg(o.s order by o.s), '[]'::json) from tp_v_ontology o
         where o.p = 'CAN_SUB' and o.o = k.pid and o.s <> coalesce(k.eq, '')) else '[]'::json end subs
    from k)
  select coalesce(json_agg(json_build_object('rank', rn, 'incident', incident_id, 'category', category, 'summary', summary,
      'work_order', wo, 'equipment', eq, 'blocks_process', blocks, 'work_stopped', stopped, 'minutes_open', minutes,
      'waiting', n_next + n_same, 'next_work_orders', next_list, 'same_equipment_waiting', same_list, 'substitutes', subs) order by rn), '[]'::json)
  from (select m.*, row_number() over (order by blocks desc, stopped desc, minutes desc, n_next + n_same desc, incident_id) rn from m) z
$$;

-- ========== (3) AI 우선순위 요약 ==========
-- 하루 5회 한도는 AI 운영 요약과 함께 쓴다(tp_ai_claim). 결과는 별도 표에 저장한다.
create table if not exists tp_ai_priority (id bigserial primary key, created_at timestamptz not null default now(), sim_at timestamp not null, text text not null, model text);

create or replace function tp_ai_save_priority(p_text text, p_model text) returns json language plpgsql security definer as $$
begin
  if coalesce(trim(p_text), '') = '' then return tp_res(false, 'AI 응답이 비어 있습니다.'); end if;
  insert into tp_ai_priority (sim_at, text, model) values (tp_now(), left(trim(p_text), 2000), p_model);
  perform tp_log('AI 우선순위 요약 생성');
  return tp_res(true, 'AI 우선순위 요약을 저장했습니다.');
end $$;

-- AI에 넘길 사실: 서버가 계산한 순위 + 근거 관계. 화면이 보낸 값이 아니라 DB의 현재 상태가 근거다.
create or replace function tp_ai_priority_facts() returns json language sql stable security definer as $$
  select json_build_object(
    'sim_now', to_char(tp_now(), 'YYYY-MM-DD HH24:MI'),
    'criteria', json_build_array('1 공정 전체 막힘(고장 설비에 작업이 남아 있음)', '2 작업 멈춤(보류·품질 보류)', '3 멈춘 시간(분)', '4 밀리는 작업 수'),
    'ranking', tp_priority(),
    'equipment', (select json_agg(json_build_object('id', e.equipment_id, 'name', e.equipment_name, 'status', e.status) order by e.equipment_id) from tp_equipment e),
    'relations', (select json_agg(json_build_array(s, p, o)) from tp_v_ontology where p in ('ON_EQ', 'STOPS', 'CAN_SUB'))
  ) $$;

-- 보안 함수의 search_path 고정(스키마 하이재킹 방지)
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tp_priority', 'tp_ai_save_priority', 'tp_ai_priority_facts') loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
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
