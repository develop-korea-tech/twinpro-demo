-- TWIN PRO 시연 DB 스키마 (Supabase/Postgres)
-- 받은 엑셀 15개 시트 = tp_ 테이블 15개(컬럼명 동일). 시연 중 바뀌는 값(설비 현재 상태, 작업 보류 사유, 조치 이력, 시연 시계)만 추가 컬럼/테이블.
-- 시간은 현장 시각(KST) 그대로 timestamp(시간대 없음)로 저장한다.

create table if not exists tp_seed (sheet text primary key, rows jsonb not null);   -- 엑셀 원본(초기화용)

create table if not exists tp_vessels (vessel_id text primary key, vessel_name text, ship_type text);
create table if not exists tp_zones (zone_id text primary key, zone_name text, x int, y int);
create table if not exists tp_processes (process_id text primary key, sequence_no int, process_name text, unit text, zone_id text, standard_hours numeric);
create table if not exists tp_equipment (equipment_id text primary key, equipment_name text, process_id text, zone_id text, resource_kind text, capacity_note text,
  status text not null, work_order_id text);                                       -- status/work_order_id = 현재 상태(초기값 = equipment_snapshot)
create table if not exists tp_equipment_snapshot (equipment_id text primary key, as_of timestamp, status text, work_order_id text);
create table if not exists tp_blocks (block_id text primary key, vessel_id text, block_name text, weight_t numeric, drawing_revision text, target_transfer_at timestamp);
create table if not exists tp_status_codes (code_id text primary key, domain text, code text, label_ko text, meaning text);
create table if not exists tp_work_orders (work_order_id text primary key, block_id text, process_id text, equipment_id text, predecessor_id text,
  planned_start_at timestamp, planned_end_at timestamp, planned_qty numeric, unit text, actual_start_at timestamp, actual_end_at timestamp,
  status text not null, accepted_qty numeric, progress_ratio numeric, team_id text, forecast_end_at timestamp,
  hold_incident text, memo text default '');
create table if not exists tp_production_plan (plan_id text primary key, work_order_id text, plan_version text, plan_date timestamp, planned_qty numeric, unit text);
create table if not exists tp_production_actual (actual_id text primary key, work_order_id text, period_start_at timestamp, period_end_at timestamp,
  accepted_qty_delta numeric, unit text, record_source text);
create table if not exists tp_equipment_intervals (interval_id text primary key, equipment_id text, start_at timestamp not null, end_at timestamp,   -- end_at null = 지금 열린 구간
  status text not null, work_order_id text, incident_id text);
create table if not exists tp_incidents (incident_id text primary key, work_order_id text, equipment_id text, category text, severity text,
  opened_at timestamp, resolved_at timestamp, status text not null, summary text, action_note text, owner_team text, source text default 'excel');
create table if not exists tp_incident_actions (id bigserial primary key, incident_id text not null, at timestamp not null, note text not null, owner text);
create table if not exists tp_work_history (history_id text primary key, work_order_id text, event_at timestamp, event_type text, incident_id text, note text, source text default 'excel');
create table if not exists tp_inspections (inspection_id text primary key, work_order_id text, inspected_at timestamp, attempt_no int, checked_points int,
  passed_points int, failed_points int, result text, incident_id text, source text default 'excel');
create table if not exists tp_rework (rework_id text primary key, incident_id text, parent_work_order_id text, equipment_id text, start_at timestamp, end_at timestamp,
  repaired_points int, status text, note text);
create table if not exists tp_sim_clock (id int primary key default 1 check (id = 1), now timestamp not null);
create table if not exists tp_event_log (id bigserial primary key, at timestamp not null, text text not null, created_at timestamptz default now());

-- 대체 설비 적합성 기준정보(가상). 고장 사건에서 남은 작업을 다른 설비로 옮기기 전에 4항목을 확인한다. 시연 중에는 바꾸지 않는다(읽기 전용).
-- 상태값: OK(적합) · COND(조건부) · NO(부적합)
create table if not exists tp_equipment_fit (equipment_id text, process_id text, wps_state text, wps_note text, power_state text, power_note text,
  cert_state text, cert_note text, loc_state text, loc_note text, move_min int, note text, primary key (equipment_id, process_id));
-- 고장 사건 처리 단계 기록: check(대체 가능 여부 확인) · fit(적합성 확인) · approve(관리자 승인). 설비 변경·재개·종료는 작업·사건 상태로 판단한다.
create table if not exists tp_incident_steps (id bigserial primary key, incident_id text not null, step text not null, equipment_id text, at timestamp not null, by_name text);

-- 같은 설비에 열린 구간은 하나만
create unique index if not exists tp_one_open_interval on tp_equipment_intervals (equipment_id) where end_at is null;

-- 시연 코드(쓰기 권한). 화면은 누구나 볼 수 있고, 상태를 바꾸는 RPC는 요청 헤더 x-demo-code가 맞아야 실행된다. 값은 SHA-256 해시로만 저장.
create table if not exists tp_config (key text primary key, value text not null);
