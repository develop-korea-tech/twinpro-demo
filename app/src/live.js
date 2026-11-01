// ---------- 운영 추이 연출(가상): 1분 = 현장 1일 ----------
// 백데이터(설비 신호)는 1분 동안 하루 근무(08:00~16:00)만큼 계속 들어오고, 1분이 지나면 하루가 마감되어 일별 집계(tp_daily)에 쌓인다.
// 2026-01-01~09-15 = 가상 이력, 09-16 = 시연 기준일, 09-17~12-31 = 연출 진행(106일 = 106분마다 처음부터 다시).
// 같은 시각이면 누가 열어도 같은 값이 나오도록 시각에서 계산한다(서버 tp_live_gen과 같은 식, 테스트로 일치 확인).
const LV = {
  Y0: Date.UTC(2026, 0, 1), BASE: 258, START: 259, CYCLE: 106,   // 일 번호: 0 = 01/01, 258 = 09/16, 259 = 09/17, 364 = 12/31
  EQ: ['EQ01', 'EQ02', 'EQ03', 'EQ04', 'EQ05', 'EQ06', 'EQ07', 'EQ08'],
  UTIL: [0.62, 0.55, 0.58, 0.50, 0.60, 0.45, 0.12, 0.08],      // 설비별 평균 가동 비율
  RATE: [0.15, 0.02, 0.35, 0.08, 0.6, 0.004, 0.35, 0.35],      // 가동 1분당 실적(공정 단위)
  DEC: [0, 0, 1, 0, 1, 0, 1, 1],                                // 실적 소수 자리
  PF: [0.03, 0.03, 0.06, 0.03, 0.03, 0.03, 0.01, 0.01],         // 하루 고장 확률
  SEASON: [-0.08, -0.05, 0, 0.03, 0.05, 0.06, 0.01, -0.06, 0.03, 0.06, 0.08, 0.04],   // 월별 물량 차이(가동 비율 가감)
  UNIT: ['piece', 'set', 'm', 'point', 'm²', 'block', 'm', 'm'],
};
const lvRnd = (d, e, k) => { const s = (d * 1000 + e * 37 + k * 101) % 2147483646 + 1; let x = s * 48271 % 2147483647; x = x * 48271 % 2147483647; return x / 2147483647; };
const lvDate = d => new Date(LV.Y0 + d * 86400000).toISOString().slice(0, 10);
const lvRound = (v, n) => Math.floor(v * 10 ** n + 0.5) / 10 ** n;   // 서버 tp_lv_round와 같은 반올림
// 설비 e(1~8)의 d일 집계: 운영·가동·대기·고장·점검 분, 고장 건수, 실적
function lvDay(d, e) {
  const i = e - 1, dow = new Date(LV.Y0 + d * 86400000).getUTCDay();
  const op = dow === 0 ? 0 : dow === 6 ? 240 : 480;
  const fault = op && lvRnd(d, e, 1) < LV.PF[i] ? 30 + Math.floor(lvRnd(d, e, 2) * 120) : 0;
  const maint = op && e === 8 && d % 14 === 3 ? 120 : 0;
  const u = Math.min(0.95, Math.max(0.02, LV.UTIL[i] + LV.SEASON[new Date(LV.Y0 + d * 86400000).getUTCMonth()] + (lvRnd(d, e, 3) - 0.5) * 0.2));
  const run = Math.max(0, Math.min(op - fault - maint, Math.floor(op * u + 0.5)));
  const qty = lvRound(run * LV.RATE[i] * (0.9 + 0.2 * lvRnd(d, e, 5)), LV.DEC[i]);
  return { day: lvDate(d), equipment_id: LV.EQ[i], op, run, idle: Math.max(0, op - run - fault - maint), fault, maint, faults: fault ? 1 : 0, qty };
}
// d일 설비 e의 백데이터 신호(f = 근무시간 08:00~16:00 중 위치 0~1)
function lvSignals(d, e) {
  const x = lvDay(d, e), i = e - 1, out = []; if (!x.op || !x.run) return out;
  const src = [2, 4, 6].includes(e) ? 'ETOS' : 'MODBUS';   // 수집 포인트 표와 같은 경로
  const add = (f, signal, value, so = src) => out.push({ f: lvRound(f, 3), equipment_id: LV.EQ[i], signal, value, source: so });
  add(0.02 + 0.01 * i, 'RUN', null);
  const ff = x.fault ? 0.15 + lvRnd(d, e, 4) * 0.6 : 2;
  // 실적은 사람이 시스템에 입력(하루 3번: 10시 · 13시 · 16시 마감), 가동 · 정지 · 이상은 설비 신호(PLC · ETOS)
  let left = x.qty;
  [0.25, 0.625, 0.97].forEach((f0, k) => { const v = k === 2 ? lvRound(left, LV.DEC[i]) : lvRound(x.qty / 3, LV.DEC[i]); left = lvRound(left - v, LV.DEC[i]);
    if (v > 0) add(f0 + 0.003 * i, 'COUNT', v, 'INPUT'); });
  if (x.fault) { add(ff, 'FAULT', null); add(Math.min(0.97, ff + x.fault / x.op), 'RUN', null); }
  add(0.985, 'STOP', null);
  return out.sort((a, b) => a.f - b.f);
}
// 지금(실제 시각) → 연출 날짜와 하루 진행률
function lvNow(ms = Date.now()) {
  const min = Math.floor(ms / 60000), pos = min % LV.CYCLE, frac = (ms % 60000) / 60000;
  return { d: LV.START + pos, pos, frac, left: Math.ceil(60 - frac * 60), start: min * 60000 };
}
// 일별 집계 전체(서버 표가 있으면 서버 값, 없으면 같은 식으로 계산): 이력 + 기준일 + 마감된 연출일
function lvDaily() {
  const n = lvNow(), key = n.d;
  if (S.live && S.live.key === key) return S.live.rows;
  let rows;
  if (S.dailyRows && S.dailyRows.length) rows = S.dailyRows.filter(r => r.kind !== 'LIVE' || r.day < lvDate(n.d));
  else { rows = []; for (let d = 0; d < n.d; d++) for (let e = 1; e <= 8; e++) rows.push({ ...lvDay(d, e), kind: d < LV.BASE ? 'HIST' : d === LV.BASE ? 'BASE' : 'LIVE' }); }
  S.live = { key, rows }; return rows;
}
const lvH = u => Math.max(3, Math.min(100, (u - 20) / 50 * 100));   // 막대 높이: 가동률 20~70% 범위를 확대
const lvSum = (rows, f) => rows.reduce((s, r) => s + (+f(r) || 0), 0);
const lvUtil = rows => { const op = lvSum(rows, r => r.op); return op ? lvSum(rows, r => r.run) / op * 100 : 0; };
// 오늘(진행 중) 지금까지 들어온 신호
function lvToday() {
  const n = lvNow(), day = lvDate(n.d), srv = (S.liveSigRows || []).filter(s => s.day === day);   // 서버 tp_live_signal이 있으면 그 값, 없으면 같은 식으로 계산
  const all = srv.length ? srv.map(s => ({ ...s, f: (Date.parse(s.sent_at) - n.start) / 60000, value: s.value == null ? null : +s.value })) : LV.EQ.flatMap((_, i) => lvSignals(n.d, i + 1));
  return { n, srv: !!srv.length, sig: all.filter(s => s.f <= n.frac).sort((a, b) => a.f - b.f) };
}
const LV_IN = ['절단 실적 입력', '취부 실적 입력', '용접 실적 입력', '검사 결과 입력', '도장 실적 입력', '인계 · 이송 완료 입력', '보수 용접 실적 입력', '용접 실적 입력'];
const lvSigText = s => { const i = LV.EQ.indexOf(s.equipment_id); return s.signal === 'COUNT' ? `${s.equipment_id} ${LV_IN[i]} +${s.value} ${LV.UNIT[i]}` : `${s.equipment_id} ${{ RUN: '가동', STOP: '정지', FAULT: '이상 정지' }[s.signal] || s.signal} 신호`; };
const lvSrc = s => s === 'INPUT' ? '시스템 입력' : IO_SRC[s] || s;
const lvWd = d => '일월화수목금토'[new Date(LV.Y0 + d * 86400000).getUTCDay()];

// ---------- 관제: 실시간 백데이터 칩(1초마다 글자만 갱신) ----------
function lvChipInner() {
  const t = lvToday(), last = t.sig[t.sig.length - 1], rows = lvDaily(), days = [...new Set(rows.filter(r => r.op).map(r => r.day))].slice(-30);   // 휴무일 빼고 최근 30 근무일
  const ut = days.map(dd => lvUtil(rows.filter(r => r.day === dd && r.op)));
  const mx = Math.max(60, ...ut), pts = ut.map((v, i) => `${(i / Math.max(1, ut.length - 1) * 100).toFixed(1)},${(22 - v / mx * 20).toFixed(1)}`).join(' ');
  return `<i class="on"></i><span>당일 데이터 수집 <b>${md(lvDate(t.n.d))}(${lvWd(t.n.d)}) ${lvDay(t.n.d, 1).op ? '근무 중' : '휴무일'}</b><small>오늘 입력 · 신호 ${t.sig.length}건${last ? ` · 방금 ${esc(lvSigText(last))} · ${lvSrc(last.source)}` : ''}</small></span>
    <svg class="lvspark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-label="최근 30일 가동률"><polyline points="${pts}"/></svg><span class="lvleft"><b>${t.n.left}초</b><small>뒤 하루 마감</small></span>`;
}
const lvChip = () => `<button class="iochip lvchip" id="lvchip" data-act="lvOpen" title="운영 추이 연출(가상) · 실제 1분 = 현장 1일">${lvChipInner()}</button>`;
let lvTimer = null, lvKey = null;
function lvTick() {
  const el = document.getElementById('lvchip'); if (el) el.innerHTML = lvChipInner();
  const k = lvNow().d; if (lvKey !== null && k !== lvKey) { S.live = null;   // 하루 마감: 서버 값은 예약 작업이 쓴 뒤(3초 후) 다시 읽고, 서버 표가 없으면 화면 계산으로 다시 그림
    const onTrend = UI.view === 'prod' && UI.mode.prod === 'trend';   // 3D 등 다른 화면은 다시 그리지 않음(다음에 열 때 반영)
    if (S.dailyRows && S.dailyRows.length && typeof reload === 'function' && (onTrend || UI.view === 'dash')) setTimeout(reload, 3000); else if (onTrend) render(); }
  lvKey = k;
  const tv = document.getElementById('lvtoday'); if (tv) tv.innerHTML = lvTodayInner();
}
if (typeof window !== 'undefined' && !lvTimer) lvTimer = setInterval(lvTick, 1000);

// ---------- 생산 현황 [추이]: 연간 → 월간 ----------
function lvTodayInner() {
  const t = lvToday(), per = LV.EQ.map((eq, i) => { const s = t.sig.filter(x => x.equipment_id === eq), q = lvRound(lvSum(s.filter(x => x.signal === 'COUNT'), x => x.value), LV.DEC[i]);
    return `<span class="lvq"><small>${eq}</small><b>${q}</b><em>${LV.UNIT[i]}</em></span>`; }).join('');
  const last = t.sig.slice(-4).reverse().map(s => `<li><em>${['08', '09', '10', '11', '12', '13', '14', '15'][Math.min(7, Math.floor(s.f * 8))]}:${String(Math.floor((s.f * 8 % 1) * 60)).padStart(2, '0')}</em><span class="iob ${s.source === 'ETOS' ? 'e' : s.source === 'INPUT' ? 's' : 'm'}">${lvSrc(s.source)}</span>${esc(lvSigText(s))}</li>`).join('');
  return `<div class="lvth"><b>${md(lvDate(t.n.d))}(${lvWd(t.n.d)}) ${lvDay(t.n.d, 1).op ? '진행 중' : '휴무일'}</b><span class="lvbar"><i style="width:${(t.n.frac * 100).toFixed(1)}%"></i></span><small>${t.n.left}초 뒤 일 마감 · 입력 · 신호 ${t.sig.length}건</small></div>
    <div class="lvqs">${per}</div><ul class="lvlog">${last || `<li class="small">${lvDay(t.n.d, 1).op ? '근무 시작 전' : '일요일 휴무 · 입력 없음'}</li>`}</ul>`;
}
function viewProdTrend() {
  const rows = lvDaily(), n = lvNow(), months = Array.from({ length: 12 }, (_, m) => String(m + 1).padStart(2, '0'));
  const selM = UI.lvMonth || lvDate(n.d).slice(5, 7), mRows = m => rows.filter(r => r.day.slice(5, 7) === m);
  const kindOf = rs => rs.some(r => r.kind === 'LIVE') ? 'live' : rs.some(r => r.kind === 'BASE') ? 'base' : rs.length ? 'hist' : 'none';
  const blocks = rs => lvSum(rs.filter(r => r.equipment_id === 'EQ06'), r => r.qty);
  const mBars = months.map(m => { const rs = mRows(m), has = rs.some(r => r.op), u = lvUtil(rs.filter(r => r.op)), b = blocks(rs), k = kindOf(rs), cur = m === lvDate(n.d).slice(5, 7);
    return `<button class="lvm ${k} ${m === selM ? 'sel' : ''} ${cur ? 'cur' : ''}" data-act="lvMonth" data-arg="${m}"><span class="lvmv" style="height:${has ? lvH(u) : 0}%"></span><b>${has ? u.toFixed(0) + '%' : '-'}</b><em>${+m}월</em><small>${rs.length ? `완성 ${b}블록` : ''}</small></button>`; }).join('');
  const days = [...new Set(mRows(selM).map(r => r.day))].sort(), nDays = new Date(Date.UTC(2026, +selM, 0)).getUTCDate(), today = lvDate(n.d);
  const dBars = Array.from({ length: nDays }, (_, j) => { const dd = `2026-${selM}-${String(j + 1).padStart(2, '0')}`, rs = rows.filter(r => r.day === dd);
    if (dd === today) return `<span class="lvd now" title="오늘 진행 중"><span class="lvdv" style="height:${(n.frac * 100).toFixed(0)}%"></span><em>${j + 1}</em></span>`;
    if (!rs.length) return `<span class="lvd none"><span class="lvdv"></span><em>${j + 1}</em></span>`;
    const op = rs.filter(r => r.op), u = lvUtil(op), f = lvSum(rs, r => r.faults), k = kindOf(rs);
    return `<span class="lvd ${k} ${op.length ? '' : 'off'}" title="${dd} ${op.length ? `가동률 ${u.toFixed(1)}% · 고장 ${f}건 · 완성 ${blocks(rs)}블록` : '휴무'}"><span class="lvdv" style="height:${op.length ? lvH(u) : 0}%"></span>${f ? '<i class="lvf"></i>' : ''}<em>${j + 1}</em></span>`; }).join('');
  const yr = rows, ytdU = lvUtil(yr.filter(r => r.op)), mr = mRows(selM);
  const proc6 = LV.EQ.slice(0, 6).map((eq, i) => `<div><span>${p2(i + 1)} ${esc(proc('P0' + (i + 1))?.process_name || '')}</span><b>${lvRound(lvSum(mr.filter(r => r.equipment_id === eq || (i === 2 && ['EQ07', 'EQ08'].includes(r.equipment_id))), r => r.qty), LV.DEC[i]).toLocaleString()}</b><em>${LV.UNIT[i]}</em></div>`).join('');
  return `<div class="pg pg-trend">${pvHead('생산 현황', '모니터링', '공장은 1년 동안 어떻게 돌았나?', '실제 1분 = 현장 1일로 계속 쌓이는 운영 추이 연출(가상)', `<span class="pvai">가상 이력 · 연출 데이터</span>`)}
    <div class="lvtop">
      <div class="lvk"><small>2026 누적 가동률</small><b>${cnt('lv-u', ytdU, 1)}<i>%</i></b><em>${[...new Set(yr.map(r => r.day))].length}일 집계</em></div>
      <div class="lvk"><small>2026 누적 완성 블록</small><b>${cnt('lv-b', blocks(yr))}<i>개</i></b><em>06 블록 이송 실적</em></div>
      <div class="lvk"><small>2026 누적 고장</small><b>${cnt('lv-f', lvSum(yr, r => r.faults))}<i>건</i></b><em>원본 설비 8대 합계</em></div>
      <div class="lvk lvnow" id="lvtoday">${lvTodayInner()}</div></div>
    <section class="panel lvyear"><div class="ph"><h2>연간 · 월별 가동률</h2><span class="sub">막대 = 그 달 원본 설비 8대 평균 가동률(20~70% 구간 확대) · 누르면 아래에 일별</span><span class="grow"></span>
      <span class="legend"><span><i class="lvlg hist"></i>가상 이력(01~09/15)</span><span><i class="lvlg base"></i>시연 기준일(09/16)</span><span><i class="lvlg live"></i>연출 진행(1분 = 1일)</span></span></div>
      <div class="lvms">${mBars}</div></section>
    <div class="lvrow"><section class="panel lvmonth"><div class="ph"><h2>${+selM}월 일별 가동률</h2><span class="sub">${days.length}일 집계 · 빨간 점 = 고장 발생일 · 일요일 휴무 · 토요일 반일</span></div><div class="lvds">${dBars || '<div class="empty">아직 쌓인 날이 없습니다.</div>'}</div></section>
      <section class="panel lvproc"><div class="ph"><h2>${+selM}월 공정별 실적</h2><span class="sub">공정 단위 그대로(합산하지 않음)</span></div><div class="lvps">${proc6}</div></section></div>
    <div class="small lvfoot">01/01~09/15는 연간 조회를 보이기 위한 가상 이력, 09/17 이후는 실제 1분마다 하루씩 쌓이는 연출입니다(12/31 다음은 09/17부터 다시). 09/16 사건 처리 시나리오와는 별개 데이터입니다.${S.dailyRows && S.dailyRows.length ? ' · 서버 tp_daily에서 읽음' : ' · 서버 표 적용 전이라 같은 식으로 화면에서 계산'}</div></div>`;
}
MODES.prod = [['pic', '그림'], ['trend', '추이'], ['table', '표']];
Object.assign(VIEW_RENDER, { prod: (r => () => UI.mode.prod === 'trend' ? viewProdTrend() : r())(VIEW_RENDER.prod) });
Object.assign(ACT, {
  lvMonth(m) { UI.lvMonth = m; render(); },
  lvOpen() { UI.mode.prod = 'trend'; UI.keepMode = true; ACT.go('prod'); },
});
if (typeof module !== 'undefined') module.exports = { lvDay, lvSignals, lvRnd, lvNow, LV };
