// TWIN PRO 화면 모델 — 서버(Supabase) 테이블을 읽어 화면 계산에 쓰는 읽기 전용 상태 S를 만든다.
// 상태를 바꾸는 규칙(R1~R7)은 전부 서버 함수(sql/02_functions.sql)에 있다. 여기에는 계산만 있다.
const AI_LIMIT = 10;
const BASE = '2026-09-16 12:00', DAY = '2026-09-16', OP_START = '2026-09-07 08:00', SHIFT_END = '2026-09-16 16:00';
const toM = s => { const [d, t] = s.split(' '); const [Y, M, D] = d.split('-').map(Number); const [h, m] = t.split(':').map(Number); return Date.UTC(Y, M - 1, D, h, m) / 60000; };
const p2 = n => String(n).padStart(2, '0');
const fromM = m => { const d = new Date(m * 60000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const hm = s => s ? s.slice(11, 16) : '';
const md = s => s ? s.slice(5, 10).replace('-', '/') : '';
const ts = v => v == null ? null : String(v).replace('T', ' ').slice(0, 16);          // DB 시각 → 'YYYY-MM-DD HH:MM'
const num = v => v == null ? null : Number(v);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const wd = s => WD[new Date(toM(s.slice(0, 10) + ' 00:00') * 60000).getUTCDay()];

const STATUS = {
  eq: { RUNNING: ['가동', 'b'], IDLE: ['대기', 'n'], FAULT: ['고장', 'r'], MAINTENANCE: ['점검', 'p'], OFFSHIFT: ['비운영', 'n'] },   // 색: 가동 파랑 · 대기 회색 · 고장 빨강 · 점검 보라
  wo: { PLANNED: ['계획', 'n'], IN_PROGRESS: ['진행', 'b'], BLOCKED: ['보류', 'r'], COMPLETED: ['완료', 'g'] },
  inc: { OPEN: ['미해소', 'r'], RESOLVED: ['해소', 'g'] },
  cat: { EQUIPMENT: ['설비 고장', 'r'], MATERIAL: ['자재 대기', 'o'], QUALITY: ['품질 보류', 'o'] },
  his: { START: '시작', PAUSE: '중단', RESUME: '재개', COMPLETE: '완료', QUALITY_HOLD: '품질 보류', REWORK_DONE: '보수 완료', ACTION: '조치', RESOLVE: '해소', PROGRESS: '실적', REASSIGN: '설비 변경' },
};
const CAT_ORDER = { EQUIPMENT: 0, MATERIAL: 1, QUALITY: 2 };
const unit = u => (u === 'm2' ? 'm²' : u);
let S = null;

// rows: { processes:[...], equipment:[...], ... } (테이블명에서 tp_ 를 뺀 이름)
function buildState(rows) {
  const st = { now: toM(ts(rows.sim_clock[0].now)), processes: {}, zones: {}, equipment: {}, wo: {}, blocks: {}, vessels: {}, counts: {} };
  for (const [k, v] of Object.entries(rows)) st.counts[k] = v.length;
  const byId = (arr, k) => arr.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k])));
  byId(rows.processes, 'process_id').forEach(p => st.processes[p.process_id] = { ...p, standard_hours: num(p.standard_hours) });
  rows.zones.forEach(z => st.zones[z.zone_id] = z);
  rows.vessels.forEach(v => st.vessels[v.vessel_id] = v);
  byId(rows.blocks, 'block_id').forEach(b => st.blocks[b.block_id] = { ...b, weight_t: num(b.weight_t), target_transfer_at: ts(b.target_transfer_at) });
  // 설비: 사용 중지(active = false) 설비는 화면 목록에서 뺀다(eqAll에는 남겨 이력 표시에 씀). 서버에 설비 관리 확장(23)이 없으면 모두 사용으로 본다
  st.eqAll = {}; byId(rows.equipment, 'equipment_id').forEach(e => { st.eqAll[e.equipment_id] = { ...e }; if (e.active !== false) st.equipment[e.equipment_id] = st.eqAll[e.equipment_id]; });
  st.eqBase = new Set((rows.equipment_snapshot || []).map(e => e.equipment_id));   // 엑셀 원본 설비(시연 중 추가한 설비와 구분)
  st.eqAdminReady = rows.equipment.length > 0 && 'active' in rows.equipment[0];
  byId(rows.work_orders, 'work_order_id').forEach(w => st.wo[w.work_order_id] = {
    ...w, planned_start_at: ts(w.planned_start_at), planned_end_at: ts(w.planned_end_at), actual_start_at: ts(w.actual_start_at), actual_end_at: ts(w.actual_end_at),
    forecast_end_at: ts(w.forecast_end_at), planned_qty: num(w.planned_qty), accepted_qty: num(w.accepted_qty), progress_ratio: num(w.progress_ratio),
  });
  const acts = {};
  rows.incident_actions.slice().sort((a, b) => a.id - b.id).forEach(a => (acts[a.incident_id] ||= []).push({ at: ts(a.at), note: a.note, owner: a.owner }));
  st.incidents = rows.incidents.map(i => ({ ...i, opened_at: ts(i.opened_at), resolved_at: ts(i.resolved_at), actions: acts[i.incident_id] || [] }));
  st.history = rows.work_history.map(h => ({ ...h, event_at: ts(h.event_at) })).sort((a, b) => toM(a.event_at) - toM(b.event_at) || a.history_id.localeCompare(b.history_id));
  st.intervals = rows.equipment_intervals.map(i => ({ id: i.interval_id, eq: i.equipment_id, s: toM(ts(i.start_at)), e: i.end_at ? toM(ts(i.end_at)) : null, status: i.status, wo: i.work_order_id, inc: i.incident_id }));
  st.inspections = rows.inspections.slice().sort((a, b) => a.inspection_id.localeCompare(b.inspection_id));
  st.actuals = rows.production_actual; st.plan = rows.production_plan; st.rework = rows.rework; st.status_codes = rows.status_codes;
  st.events = rows.event_log.slice().sort((a, b) => b.id - a.id).map(e => ({ at: ts(e.at), text: e.text }));
  const ai = (rows.ai_summary || []).slice().sort((a, b) => b.id - a.id)[0];
  st.ai = ai ? { sim_at: ts(ai.sim_at), text: ai.text, model: ai.model } : null;
  const ap = (rows.ai_priority || []).slice().sort((a, b) => b.id - a.id)[0];      // AI 우선순위 요약(작업 관리)
  st.aiPri = ap ? { sim_at: ts(ap.sim_at), text: ap.text, model: ap.model } : null;
  st.aiPriReady = !(typeof MISSING !== 'undefined' && MISSING.has('ai_priority'));   // 서버에 우선순위 확장(15_priority.sql)이 없으면 AI 버튼을 숨김
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);       // 한국 날짜
  st.aiUsed = num((rows.ai_usage || []).find(u => String(u.day).slice(0, 10) === today)?.used) || 0;
  st.simLock = (rows.sim_lock || [])[0] || null;
  st.steps = (rows.incident_steps || []).slice().sort((a, b) => a.id - b.id).map(x => ({ ...x, at: ts(x.at) }));   // 사건 처리 단계 기록(대체 가능 확인·적합성·승인)
  st.fitAll = rows.equipment_fit || []; st.fit = st.fitAll.filter(f => st.equipment[f.equipment_id]);   // 사용 중지 설비는 대체 후보에서 뺀다                                                                                     // 대체 설비 적합성 기준정보
  st.signals = (rows.signal_log || []).slice().sort((a, b) => b.id - a.id).slice(0, 8).map(g => ({ ...g, sim_at: ts(g.sim_at), value: num(g.value), source: g.source || 'SIM' }));
  // 현장 데이터 수집: 수집 포인트(서버 표가 없으면 화면 기본값) + 받은 신호의 출처별 집계
  st.ioAll = ((rows.io_point || []).length ? rows.io_point : typeof ioDefault === 'function' ? ioDefault() : []).slice().sort((a, b) => a.sort - b.sort);
  st.io = st.ioAll.filter(p => st.equipment[p.equipment_id]);   // 사용 중지 설비의 수집 포인트는 화면에서 뺀다
  st.ioReady = !(typeof MISSING !== 'undefined' && MISSING.has('io_point'));
  const sg = (rows.signal_log || []).slice().sort((a, b) => a.id - b.id), sigStat = { n: sg.length, src: { SIM: 0, MODBUS: 0, ETOS: 0 }, byEq: {}, last: null, faultInc: {} };
  sg.forEach(g => { const src = g.source || 'SIM'; sigStat.src[src] = (sigStat.src[src] || 0) + 1; sigStat.byEq[g.equipment_id] = (sigStat.byEq[g.equipment_id] || 0) + 1;
    sigStat.last = { at: ts(g.sim_at), source: src, eq: g.equipment_id }; if (g.ok && g.signal === 'COUNT') sigStat.cntOk = (sigStat.cntOk || 0) + 1;
    const m = g.ok && g.signal === 'FAULT' && /INC\d+/.exec(g.msg || ''); if (m) sigStat.faultInc[m[0]] = { source: src, at: ts(g.sim_at) }; });
  st.sigStat = sigStat;
  // 운영 추이 연출: 서버 일 집계 · 백데이터 신호(없으면 화면에서 같은 식으로 계산)
  st.dailyRows = (rows.daily || []).map(r => ({ ...r, day: String(r.day).slice(0, 10), qty: +r.qty })).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.equipment_id < b.equipment_id ? -1 : 1);
  st.liveSigRows = (rows.live_signal || []).map(r => ({ ...r, day: String(r.day).slice(0, 10) }));
  st.live = null;
  // AI 운영 센터: 비교 모델 목록 · 실측 기록
  st.aiModels = (rows.ai_model || []).map(m => ({ ...m, price_in: +m.price_in, price_out: +m.price_out }));
  st.bench = (rows.ai_bench || []).map(r => ({ ...r, cost_usd: r.cost_usd == null ? null : +r.cost_usd, latency_ms: r.latency_ms == null ? null : +r.latency_ms, score: r.score == null ? null : +r.score }));
  st.aiBenchReady = !(typeof MISSING !== 'undefined' && MISSING.has('ai_bench'));
  return st;
}

const nowS = () => fromM(S.now);
const proc = id => S.processes[id];
const eqOf = id => S.equipment[id] || (S.eqAll && S.eqAll[id]);
const woList = () => Object.values(S.wo);
const incById = id => S.incidents.find(i => i.incident_id === id);
const openIncidents = () => S.incidents.filter(i => i.status === 'OPEN').sort((a, b) => CAT_ORDER[a.category] - CAT_ORDER[b.category] || toM(a.opened_at) - toM(b.opened_at));
const incEquipment = i => i.equipment_id || (i.work_order_id ? S.wo[i.work_order_id]?.equipment_id : null);
const isDelayed = w => w.status !== 'COMPLETED' && toM(w.planned_end_at) <= S.now;
const blockWos = b => woList().filter(w => w.block_id === b).sort((x, y) => proc(x.process_id).sequence_no - proc(y.process_id).sequence_no);
const currentWo = b => blockWos(b).find(w => w.status !== 'COMPLETED') || null;
const woHistory = wo => S.history.filter(h => h.work_order_id === wo);
const lastHistory = wo => woHistory(wo).pop();
const todayWos = () => woList().filter(w => w.planned_start_at.startsWith(DAY)).sort((a, b) => proc(a.process_id).sequence_no - proc(b.process_id).sequence_no);
const transferWo = b => blockWos(b).find(w => w.process_id === 'P06');

function opMinutes(fromS, toMin) {
  let t = 0; const a = toM(fromS);
  for (let d = Math.floor(a / 1440) * 1440; d < toMin; d += 1440) { const s = Math.max(a, d + 480), e = Math.min(toMin, d + 960); if (e > s) t += e - s; }
  return t;
}
function eqMinutes(eq, status) {
  const from = toM(OP_START);
  return S.intervals.filter(i => i.eq === eq && i.status === status).reduce((t, i) => t + Math.max(0, Math.min(i.e ?? S.now, S.now) - Math.max(i.s, from)), 0);
}
function occupancy(eq) { const den = opMinutes(OP_START, S.now), run = eqMinutes(eq, 'RUNNING'); return { run, den, pct: den ? run / den * 100 : 0 }; }
function segments(eq) {
  const out = [];
  for (const i of S.intervals.filter(x => x.eq === eq).sort((a, b) => a.s - b.s)) {
    const e = i.e ?? S.now, p = out[out.length - 1];
    if (p && p.status === i.status && p.e === i.s && (p.wo || null) === (i.wo || null)) p.e = e; else out.push({ ...i, e });
  }
  return out;
}
function faultStats(eq) { const f = segments(eq).filter(s => s.status === 'FAULT'); return { min: f.reduce((t, s) => t + s.e - s.s, 0), count: f.length }; }
function statusSince(eq) {
  const segs = segments(eq); const last = segs[segs.length - 1];
  if (!last || last.status !== eqOf(eq).status) return 0;
  let s = last.s;
  for (let k = segs.length - 2; k >= 0 && segs[k].status === last.status && segs[k].e === s; k--) s = segs[k].s;
  return S.now - s;
}
function kpis() {
  const eqs = Object.values(S.equipment); const cnt = st => eqs.filter(e => e.status === st).length;
  const today = todayWos(), due = woList().filter(w => toM(w.planned_end_at) <= S.now);
  const transferred = Object.values(S.blocks).filter(b => transferWo(b.block_id)?.status === 'COMPLETED');
  const onTime = transferred.filter(b => { const w = transferWo(b.block_id); return w.actual_end_at && toM(w.actual_end_at) <= toM(b.target_transfer_at); });
  return {
    total: eqs.length, running: cnt('RUNNING'), idle: cnt('IDLE'), fault: cnt('FAULT'), maint: cnt('MAINTENANCE'),
    todayDone: today.filter(w => w.status === 'COMPLETED').length, todayTotal: today.length, overdue: woList().filter(isDelayed), open: openIncidents().length,
    transferred: transferred.length, blocks: Object.keys(S.blocks).length, dueDone: due.filter(w => w.status === 'COMPLETED').length, dueTotal: due.length,
    onTime: onTime.length, inspPass: S.inspections.filter(q => q.result === 'PASS').length, inspTotal: S.inspections.length,
  };
}
// 계획 진행률: 계획 시작~종료(운영시간 08~16시 기준) 중 지금까지 지난 비율. 실적 진행률 = 인정수량 ÷ 계획수량(완료 = 100%)
function planRatio(w) { const a = toM(w.planned_start_at), b = toM(w.planned_end_at); const tot = opMinutes(w.planned_start_at, b); return tot ? Math.min(1, opMinutes(w.planned_start_at, Math.max(a, S.now)) / tot) : 1; }
const actRatio = w => w.status === 'COMPLETED' ? 1 : w.progress_ratio;
function progressKpi() { const ws = todayWos(); const a = ws.reduce((t, w) => t + actRatio(w), 0) / ws.length, p = ws.reduce((t, w) => t + planRatio(w), 0) / ws.length; return { a: a * 100, p: p * 100, gap: (p - a) * 100 }; }
function processActual() {
  return Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no).map(p => {
    const ws = woList().filter(w => w.process_id === p.process_id && toM(w.planned_end_at) <= S.now);
    const a = ws.reduce((t, w) => t + w.accepted_qty, 0), pl = ws.reduce((t, w) => t + w.planned_qty, 0);
    return { p, a, pl, pct: pl ? a / pl * 100 : null, unit: unit(p.unit) };
  });
}
// 통계 이상 감지(관리도): 비율 r = 시간당 실적 ÷ 그 작업지시의 계획 속도(계획수량 ÷ 계획 운영시간).
// 기준 = 오늘(DAY) 이전 실적 행의 r 평균·표준편차(공정별). 지금 직전 1시간의 r을 z = (r − 평균) ÷ 표준편차로 보고
// |z| ≥ 3 이상, |z| ≥ 2 주의(Shewhart 관리도). 세트·블록 단위(시간당 실적이 없는 공정)는 판정하지 않는다.
const SPC_SKIP = ['set', 'block'];
const actQty = (wo, a, b) => S.actuals.reduce((q, r) => {   // 작업지시 wo의 (a, b] 분 구간 실적(구간에 걸친 행은 겹친 비율만)
  if (r.work_order_id !== wo) return q; const s = toM(ts(r.period_start_at)), e = toM(ts(r.period_end_at)), d = Number(r.accepted_qty_delta);
  return q + (e > s ? d * Math.max(0, Math.min(b, e) - Math.max(a, s)) / (e - s) : s > a && s <= b ? d : 0); }, 0);
const planRate = w => w.planned_qty / (opMinutes(w.planned_start_at, toM(w.planned_end_at)) / 60);
function spcBase(pid) {
  const day0 = toM(DAY + ' 00:00'), rs = [];
  for (const r of S.actuals) { const w = S.wo[r.work_order_id], s = toM(ts(r.period_start_at)), e = toM(ts(r.period_end_at));
    if (w && w.process_id === pid && e > s && e <= day0) rs.push(Number(r.accepted_qty_delta) / ((e - s) / 60) / planRate(w)); }
  const n = rs.length, m = rs.reduce((a, b) => a + b, 0) / (n || 1), sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, m, sd };
}
function spc() {
  return todayWos().map(w => {
    const p = proc(w.process_id), base = spcBase(w.process_id), out = { w, p, base };
    if (SPC_SKIP.includes(w.unit)) return { ...out, st: 'skip', why: '세트·블록 단위라 시간당 실적이 없음' };
    if (w.status === 'PLANNED' || !w.actual_start_at) return { ...out, st: 'skip', why: '시작 전' };
    const a = Math.max(S.now - 60, toM(w.actual_start_at)), b = Math.min(S.now, toM(w.planned_end_at), w.status === 'COMPLETED' && w.actual_end_at ? toM(w.actual_end_at) : Infinity);
    if (w.status === 'COMPLETED' && b <= S.now - 60) return { ...out, st: 'skip', why: '완료' };
    if (S.now - 60 >= toM(w.planned_end_at)) return { ...out, st: 'skip', why: '계획 시간 밖(진척은 지연 표시로 봄)' };
    if (b - a < 30 || base.n < 5 || !(base.sd > 0)) return { ...out, st: 'skip', why: b - a < 30 ? '1시간 실적 부족' : '기준 데이터 부족' };
    const q = actQty(w.work_order_id, a, b), r = q / ((b - a) / 60) / planRate(w), z = (r - base.m) / base.sd;
    return { ...out, q, a, b, r, z, st: Math.abs(z) >= 3 ? 'r' : Math.abs(z) >= 2 ? 'o' : 'g' };
  });
}
// ---------- 온톨로지(관계)와 우선순위 ----------
// 서버 표의 행을 (주어, 관계, 목적어) 세 쌍으로 펼친다. 서버의 tp_v_ontology 뷰와 같은 정의다.
// 우선순위와 근거 연결은 이 관계만 따라가서 계산한다(표를 직접 뒤지지 않음).
const REL = { IN_PROCESS: '공정', AT_ZONE: '작업구역', USES: '설비', OF_BLOCK: '블록', NEXT: '다음 공정', ON_EQ: '발생 설비', STOPS: '멈춘 작업', CAN_SUB: '대체 가능' };
function ontology() {
  const t = [];
  for (const e of Object.values(S.equipment)) t.push([e.equipment_id, 'IN_PROCESS', e.process_id], [e.equipment_id, 'AT_ZONE', e.zone_id]);
  for (const w of woList()) t.push([w.work_order_id, 'IN_PROCESS', w.process_id], [w.work_order_id, 'USES', w.equipment_id], [w.work_order_id, 'OF_BLOCK', w.block_id]);
  for (const b of Object.keys(S.blocks)) { const ws = blockWos(b); for (let k = 1; k < ws.length; k++) t.push([ws[k - 1].work_order_id, 'NEXT', ws[k].work_order_id]); }
  for (const i of S.incidents) if (i.status === 'OPEN') {
    if (i.category === 'EQUIPMENT' && i.equipment_id) t.push([i.incident_id, 'ON_EQ', i.equipment_id]);
    if (i.work_order_id) t.push([i.incident_id, 'STOPS', i.work_order_id]);
  }
  for (const f of S.fit) t.push([f.equipment_id, 'CAN_SUB', f.process_id]);
  return t;
}
const relOut = (T, s, p) => T.filter(x => x[0] === s && x[1] === p).map(x => x[2]);
const relIn = (T, o, p) => T.filter(x => x[2] === o && x[1] === p).map(x => x[0]);
// 우선순위: 미해결 사건마다 기준 4개를 관계에서 계산하고, 기준 순서대로 줄 세운다(예측 없음, 현재 기록만).
//  ① 공정 전체 막힘 = 공정 설비가 고장이고 작업이 아직 그 설비에 있음(대체 설비로 옮기면 해제)
//  ② 작업 멈춤 = 연결된 작업이 보류이거나 품질 보류 중
//  ③ 멈춘 시간 = 사건이 열린 뒤 지난 분
//  ④ 밀리는 작업 = 같은 블록의 남은 다음 공정 + (고장이면) 그 설비를 쓰기로 한 다른 미완료 작업
const PRI_KEYS = ['blocks', 'stopped', 'min', 'wait'];
function priorities() {
  const T = ontology();
  const list = S.incidents.filter(i => i.status === 'OPEN').map(i => {
    const wo = relOut(T, i.incident_id, 'STOPS')[0] || null, w = wo ? S.wo[wo] : null;
    const eq = relOut(T, i.incident_id, 'ON_EQ')[0] || (wo ? relOut(T, wo, 'USES')[0] : null) || null;
    const fault = i.category === 'EQUIPMENT' && !!eq && eqOf(eq).status === 'FAULT';
    const next = [];
    for (let x = wo && relOut(T, wo, 'NEXT')[0]; x; x = relOut(T, x, 'NEXT')[0]) if (S.wo[x].status !== 'COMPLETED') next.push(x);
    const same = fault ? relIn(T, eq, 'USES').filter(x => x !== wo && S.wo[x].status !== 'COMPLETED').sort() : [];
    const blocks = fault && (!w || w.equipment_id === eq);
    const stopped = !!w && w.status !== 'COMPLETED' && (w.status === 'BLOCKED' || i.category === 'QUALITY');
    const pid = w ? w.process_id : eq ? eqOf(eq).process_id : null;
    const subs = i.category === 'EQUIPMENT' && pid ? relIn(T, pid, 'CAN_SUB').filter(x => x !== eq).sort() : [];
    return { inc: i, wo, w, eq, pid, blocks, stopped, min: S.now - toM(i.opened_at), next, same, wait: next.length + same.length, subs };
  });
  list.sort((a, b) => b.blocks - a.blocks || b.stopped - a.stopped || b.min - a.min || b.wait - a.wait || a.inc.incident_id.localeCompare(b.inc.incident_id));
  list.forEach((x, n) => { const o = list[n + 1] || list[n - 1]; x.rank = n + 1; x.hit = o ? PRI_KEYS.find(k => x[k] !== o[k]) || null : null; });
  return list;
}
if (typeof module !== 'undefined') module.exports = { buildState, setS: s => { S = s; }, kpis, processActual, occupancy, faultStats, statusSince, segments, openIncidents, toM, ontology, priorities };
