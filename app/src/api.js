// 서버 연결 계층. 기본은 Supabase(supabase-js). 자동 테스트에서는 window.__TP_TEST_API(같은 SQL을 올린 로컬 Postgres)를 쓴다.
const TABLES = ['vessels', 'zones', 'processes', 'equipment', 'equipment_snapshot', 'blocks', 'status_codes', 'work_orders', 'production_plan', 'production_actual',
  'equipment_intervals', 'incidents', 'incident_actions', 'work_history', 'inspections', 'rework', 'sim_clock', 'event_log', 'ai_summary', 'ai_usage', 'signal_log', 'sim_lock', 'equipment_fit', 'incident_steps', 'ai_priority', 'io_point', 'daily', 'live_signal', 'ai_model', 'ai_bench'];
const OPTIONAL = new Set(['ai_model', 'ai_bench', 'daily', 'live_signal', 'ai_summary', 'ai_usage', 'signal_log', 'sim_lock', 'equipment_fit', 'incident_steps', 'ai_priority', 'io_point']);   // 확장 SQL(3단계) 적용 전에도 화면이 열리도록: 없으면 빈 표
const MISSING = new Set();   // 서버에 아직 없는 확장 표(확장 SQL 적용 전) → 그 기능 버튼을 숨긴다
const LS = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const BUILT_URL = '__SUPABASE_URL__', BUILT_KEY = '__SUPABASE_ANON_KEY__';
const SUPABASE_URL = LS('tpSupabaseUrl') || BUILT_URL, SUPABASE_ANON_KEY = LS('tpSupabaseKey') || BUILT_KEY;
const NEEDS_SETUP = !window.__TP_TEST_API && (!/^https:\/\//.test(SUPABASE_URL) || SUPABASE_ANON_KEY.startsWith('__'));
let DEMO_CODE = (() => { try { return sessionStorage.getItem('tpDemoCode') || ''; } catch (e) { return ''; } })();
function setDemoCode(c) { DEMO_CODE = c; try { sessionStorage.setItem('tpDemoCode', c); } catch (e) { /* 저장 불가 환경 */ } API.resetWriter && API.resetWriter(); }
const SERVER_LABEL = window.__TP_TEST_API ? '로컬 Postgres(테스트)' : 'Supabase Postgres';
const API = NEEDS_SETUP ? null : window.__TP_TEST_API ? {
  load: () => window.__TP_TEST_API.load(),
  rpc: (fn, args) => window.__TP_TEST_API.rpc(fn, args, DEMO_CODE),
  ai: mode => window.__TP_TEST_API.ai(DEMO_CODE, mode),
  aiBench: (model_id, run_id) => window.__TP_TEST_API.ai(DEMO_CODE, { mode: 'bench', model_id, run_id }),
  subscribe: () => {},
} : (() => {
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let writer = null;   // 쓰기용 클라이언트: 시연 코드를 x-demo-code 헤더로 보낸다
  const getWriter = () => writer || (writer = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'tp-writer' }, global: { headers: { 'x-demo-code': DEMO_CODE } } }));
  async function all(t) {           // 1000행 제한을 넘는 표도 끝까지 읽는다
    let out = [], from = 0;
    for (;;) { const { data, error } = await sb.from('tp_' + t).select('*').range(from, from + 999);
      if (error) { if (OPTIONAL.has(t)) { MISSING.add(t); return []; } throw new Error(`${t}: ${error.message}`); }
      out = out.concat(data); if (data.length < 1000) return out; from += 1000; }
  }
  return {
    async load() { const r = await Promise.all(TABLES.map(all)); return Object.fromEntries(TABLES.map((t, i) => [t, r[i]])); },
    resetWriter() { writer = null; },
    async rpc(fn, args) { const { data, error } = await getWriter().rpc(fn, args); if (error) throw new Error(error.message); return data; },
    async ai(mode) {          // AI 운영 요약(mode 없음) · AI 우선순위 요약(mode = 'priority'): Edge Function(tp-ai-summary)이 시연 코드 확인 → 하루 10회 차감 → Claude 호출 → DB 저장
      const r = await fetch(`${SUPABASE_URL}/functions/v1/tp-ai-summary`, { method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY, 'x-demo-code': DEMO_CODE, 'Content-Type': 'application/json' }, body: JSON.stringify(mode ? { mode } : {}) });
      const j = await r.json().catch(() => null); if (!j) throw new Error(`AI 서버 응답 오류(HTTP ${r.status})`); return j; },
    async aiBench(model_id, run_id) {   // AI 모델 비교 한 건(회사별 모델): Edge Function이 회차 확인 → 사실 → 호출 · 시간 측정 → 채점 · 저장
      const r = await fetch(`${SUPABASE_URL}/functions/v1/tp-ai-summary`, { method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY, 'x-demo-code': DEMO_CODE, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'bench', model_id, run_id }) });
      const j = await r.json().catch(() => null); if (!j) throw new Error(`AI 서버 응답 오류(HTTP ${r.status})`); return j; },
    subscribe(onChange, onStatus) {
      sb.channel('tp-all').on('postgres_changes', { event: '*', schema: 'public' }, p => { if (String(p.table).startsWith('tp_')) onChange(); })
        .subscribe(s => onStatus(s === 'SUBSCRIBED' ? '실시간 연결' : s === 'CLOSED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? '실시간 끊김 · 조작 후 다시 읽음' : '연결 중'));
    },
  };
})();
