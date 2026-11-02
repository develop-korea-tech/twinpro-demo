// TWIN PRO 화면 — 상태 S(서버에서 읽은 값)로 5개 화면을 그리고, 사용자 조작은 서버 함수(RPC)로 보낸 뒤 다시 읽는다.
const UI = {
  view: 'dash', busy: false, speed: window.matchMedia('(max-width: 760px)').matches ? 4 : 1,   // 휴대폰은 처음부터 4배속
  conn: '연결 중', draft: {}, page: { wo: 1, his: 1 }, sub: { wo: 'list', base: 'proc', eq: 'his', sum: '' },
  sel: { eq: 'EQ03', block: 'B008', wo: 'WO009-02', proc: 'P03', inc: null, node: null },
  f: { eq: { proc: '', st: '', q: '', kind: '' }, prod: { vessel: '', proc: '', st: '', q: '' }, wo: { proc: '', st: '', date: '16-17', q: '', overdue: false }, base: { q: '', zone: '' } },
  faultForm: false, resetArm: false, codeOpen: false, canWrite: false, intro: false, menuOpen: false, pausedFor: '',
};
const VIEWS = [['dash', '관제 대시보드', '모니터링'], ['eq', '설비 상태', '모니터링'], ['prod', '생산 현황', '모니터링'], ['wo', '작업 관리', '관리'], ['base', '기준정보', '관리'], ['ai', 'AI 운영 센터', 'AI']];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (m, code, label) => { const [l, c] = STATUS[m][code] || [code, 'n']; return `<span class="badge ${c}">${esc(label || l)}</span>`; };
const delayBadge = w => isDelayed(w) ? '<span class="badge delay">지연</span>' : '-';
const pct = (v, d = 1) => v == null ? '—' : `${(+v).toFixed(d).replace(/\.0+$/, '')}%`;
const colorVar = c => `var(--${c})`;
const bar = (ratio, c, w = 80) => `<span class="bar"><i style="width:${w}px"><em style="width:${Math.min(100, ratio * 100)}%;background:${colorVar(c)}"></em></i><small>${pct(ratio * 100)}</small></span>`;
const procColor = pid => `var(--${pid})`;
const eqName = id => `${id} ${eqOf(id)?.equipment_name || ''}`;
const dateLabel = s => `${md(s)} (${wd(s)})`;
const minLabel = m => m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + '분' : ''}`.trim() : `${m}분`;
const draft = (k, dflt) => (k in UI.draft ? UI.draft[k] : dflt);
const radios = (name, opts, val) => `<span class="radios">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" data-filter="${name}" ${val === v ? 'checked' : ''}> ${l}</label>`).join('')}</span>`;
const selectBox = (name, opts, val, attr = 'data-filter') => `<select id="${name}" ${attr}="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const procOpts = () => [['', '전체'], ...Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no).map(p => [p.process_id, `${p.process_id} ${p.process_name}`])];
const icon = pid => (ICONS[pid] || '');

// ---------- 공통 틀: 모든 화면 위의 어두운 상단 바(사이드바 없음) ----------
const TOP_TABS = [['dash', '통합 관제'], ['3d', '3D 조선소'], ['blk', '블록 내부 3D'], ['edu', '공정 교육 재생']];
const MGMT = VIEWS.slice(1).filter(v => v[2] === '관리' || v[2] === '모니터링');
// 휴대폰(폭 760px 이하): 화면은 통합 관제 · 블록 내부 3D · 공정 교육 재생 3개만. 3D 조선소와 관리 화면은 넓은 화면에서만 연다
const isMob = () => window.matchMedia('(max-width: 760px)').matches;
const mobOk = () => UI.view === 'dash' || UI.view === 'blk' || (UI.view === '3d' && (SIM.on || T3.wantSim));
// 왼쪽 아이콘 사이드바(넓은 화면): 평소 아이콘만, 마우스를 올리면 펼쳐져 글자가 보인다. 좁은 화면(휴대폰)은 위쪽 탭·[관리 화면 ▾]를 그대로 쓴다
const RAIL_ICO = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  '3d': '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  blk: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  edu: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  eq: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  prod: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  wo: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"/>',
  base: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2 2.2.8-2.2.8L18 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
  intro: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
};
function railNav() {
  const cur = UI.view === '3d' && SIM.on ? 'edu' : UI.view, open = S ? openIncidents().length : 0;
  const it = (act, arg, label, sub) => `<button class="gri ${cur === arg ? 'on' : ''}" data-act="${act}" data-arg="${arg}" title="${label}"><svg viewBox="0 0 24 24">${RAIL_ICO[arg]}</svg><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>${arg === 'dash' && open ? `<b class="gbadge">${open}</b>` : ''}</button>`;
  return `<nav class="grail" aria-label="화면 메뉴"><div class="grlogo">TP<span>TWIN PRO</span></div>
    <div class="grsec">모니터링</div>${it('topGo', 'dash', '통합 관제', open ? `미해결 사건 ${open}건` : '')}
    <div class="grsec">관리</div>${MGMT.map(([v, l]) => it('go', v, l)).join('')}
    <div class="grsec">AI</div>${it('go', 'ai', 'AI 운영 센터', '모델 비교')}
    <div class="grsec">3D</div>${it('topGo', '3d', '3D 조선소')}${it('topGo', 'blk', '블록 내부 3D')}${it('topGo', 'edu', '공정 교육 재생')}
    <span class="grow"></span><button class="gri" data-act="intro" title="안내"><svg viewBox="0 0 24 24">${RAIL_ICO.intro}</svg><span>안내</span></button></nav>`;
}
function topBar() {
  const cur = UI.view === '3d' && SIM.on ? 'edu' : UI.view;
  const inc = UI.sel.inc && incById(UI.sel.inc), w = inc && inc.work_order_id && S.wo[inc.work_order_id];
  const focus = inc ? `<span class="gfocus">◎ 추적 중: ${w ? w.block_id + ' · ' : ''}${w ? `${p2(proc(w.process_id).sequence_no)} ${esc(proc(w.process_id).process_name)} · ` : ''}${STATUS.cat[inc.category][0]}<button data-act="selIncClear" title="추적 해제">✕</button></span>` : '';
  const code = UI.canWrite ? '' : UI.codeOpen
    ? `<span class="gcode"><input type="password" id="codeIn" data-draft="codeIn" value="${esc(draft('codeIn', ''))}" placeholder="시연 코드" autocomplete="off"><button class="gbtn" data-act="codeSave">확인</button></span>`
    : '<button class="gbtn" data-act="codeOpen" title="팀에서 받은 시연 코드를 넣으면 서버에 저장됩니다. 코드가 없으면 체험 모드(내 화면에만 반영)">🔑 조작 권한</button>';
  return `${railNav()}<header class="gbar"><b class="glogo">TWIN PRO</b>
    <nav class="gtabs">${TOP_TABS.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-act="topGo" data-arg="${v}">${l}</button>`).join('')}</nav>
    <span class="grow"></span>${focus}<span class="grow"></span>
    <span class="gmode">${UI.canWrite ? '가상 데이터 · 조작 가능(저장됨)' : '가상 데이터 · 체험 모드'}</span>${code}
    <details class="gmenu" ${UI.menuOpen ? 'open' : ''}><summary data-act="menuTog" class="${VIEW_RENDER[UI.view] && UI.view !== 'dash' ? 'on' : ''}">관리 화면 ▾</summary>
      <div>${VIEWS.slice(1).map(([v, l]) => `<button class="${UI.view === v ? 'on' : ''}" data-act="go" data-arg="${v}">${l}</button>`).join('')}</div></details>
    <button class="gbtn" data-act="intro">? 안내</button></header>
    ${UI.trial ? `<div class="trialbar">🧪 <b>체험 중</b> · 지금 보이는 결과는 서버에 저장되지 않고 내 화면에만 보입니다.<span class="grow"></span><button class="btn" data-act="endTrial">체험 끝내기 (원래대로)</button></div>` : ''}`;
}
function shell() {
  return `${topBar()}<main class="content ${UI.view !== UI.lastView ? 'enter' : ''}" id="content">${VIEW_RENDER[UI.view]()}</main>${UI.intro ? introBox() : ''}${UI.figModal ? figModal() : ''}${UI.ioModal ? ioModal() : ''}`;
}
// 재생 조작: ⏸/▶ + 배속(1× = 실제 10초당 가상 5분). 16:00이면 '처음부터', 다른 화면이 재생 중이면 잠금
const simMs = () => 10000 / (UI.speed || 1);
function playCtl() {
  const end = S.now >= toM(SHIFT_END) && !UI.simOn;
  if (end && !UI.canWrite) return UI.trial ? '<button class="btn pri" data-act="endTrial">↺ 처음부터 다시 보기</button>' : '<span class="small">16:00 운영 종료</span>';
  if (end) return `<button class="btn ${UI.resetArm ? 'danger' : 'pri'}" data-act="reset">${UI.resetArm ? '한 번 더 누르면 12:00으로' : '↺ 처음부터 다시 보기'}</button>`;
  if (othersPlaying()) return '<button class="btn" disabled title="다른 화면에서 가상 시간을 진행 중입니다. 시간이 같이 흐릅니다">다른 화면에서 시간 진행 중</button>';
  const tip = UI.canWrite ? '가상 시간이 흐르며 작업이 진행됩니다(모든 화면에 반영)' : '내 화면에서만 가상 시간이 흐릅니다. 서버에 저장되지 않습니다';
  return `<span class="speed"><button class="pp ${UI.simOn ? 'on' : ''}" data-act="simToggle" title="${tip}">${UI.simOn ? '⏸' : '▶'}</button>${[1, 2, 4].map(v => `<button class="${(UI.speed || 1) === v ? 'on' : ''}" data-act="speed" data-arg="${v}">${v}×</button>`).join('')}</span>`;
}
// 관리 화면 공통 머리: 제목 + 이 화면이 무엇인지 한 줄 + 경로
function pageHead(name, group, desc, right = '') { return `<div class="pghead"><h1>${name}</h1><span class="pgdesc">${desc}</span><span class="grow"></span>${right}${modeTabs(UI.view)}<span class="crumb">⌂ &gt; ${group} &gt; ${name}</span></div>`; }
// 필터 칩(요약 숫자 겸용): opts = [[값, 이름, 개수, 색]]
const chips = (key, opts, val) => `<span class="fchips">${opts.map(([v, l, n, c]) => `<button class="fchip ${val === v ? 'on' : ''} ${c || ''}" data-act="fchip" data-arg="${key}:${v}">${c ? '<i></i>' : ''}${l}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')}</span>`;
// 설비 그림(3D 렌더): 공정의 첫 설비는 공정 그림, 같은 공정의 대체·예비 설비는 이동식 용접기 그림
const eqArtOf = e => { const art = window.EQ_ART || {}; const first = Object.values(S.equipment).filter(x => x.process_id === e.process_id).sort((a, b) => a.equipment_id < b.equipment_id ? -1 : 1)[0]; return art[first && first.equipment_id !== e.equipment_id ? 'SP' : e.process_id] || ''; };
function title(name, group) { return `<div class="ptitle"><h1>${name}</h1><span class="crumb">⌂ &gt; ${group} &gt; ${name}</span></div>`; }

// ---------- 1. 통합 관제(대시보드) ----------
// 공정 노드 상태: 정지(빨강) · 자재 대기/품질 보류(주황) · 가동(파랑) · 완료(초록) · 대기(회색)
function nodeState(w) {
  const e = eqOf(w.equipment_id), hold = w.hold_incident && incById(w.hold_incident);
  const q = S.incidents.find(i => i.status === 'OPEN' && i.category === 'QUALITY' && i.work_order_id === w.work_order_id);
  const inc = (hold && hold.status === 'OPEN' ? hold : null) || q || S.incidents.find(i => i.status === 'OPEN' && i.work_order_id === w.work_order_id) || null;
  if (w.status === 'COMPLETED') return { c: 'g', l: '완료', inc };
  if (w.status === 'BLOCKED') return inc?.category === 'MATERIAL' ? { c: 'o', l: '자재 대기', inc, stop: 1 } : { c: 'r', l: '정지', inc, stop: 1 };
  if (q) return { c: 'o', l: '품질 보류', inc: q, stop: 1 };
  if (w.status === 'IN_PROGRESS' && e.status === 'RUNNING') return { c: 'b', l: '가동', inc };
  return { c: 'n', l: '대기', inc };
}
const curIncs = () => { const l = openIncidents(); const s = UI.sel.inc && incById(UI.sel.inc); if (s && !l.includes(s)) l.unshift(s); return l; };
function substitutes(inc) {   // 같은 공정의 다른 설비 중 적합성 기준정보가 있는 것
  const w = inc.work_order_id && S.wo[inc.work_order_id]; if (!w || inc.category !== 'EQUIPMENT') return [];
  return Object.values(S.equipment).filter(e => e.process_id === w.process_id && e.equipment_id !== inc.equipment_id && S.fit.some(f => f.equipment_id === e.equipment_id && f.process_id === w.process_id));
}
const stepRec = (inc, k) => S.steps.filter(s => s.incident_id === inc.incident_id && s.step === k).pop();
// 처리 단계. 설비 고장 + 대체 후보 있음 = 7단계 / 대체 후보 없음 = 고장 확인 → 복구·종료 → 재개 / 자재·품질 = 조치 → 해소 → 재개
function caseSteps(inc) {
  const w = inc.work_order_id ? S.wo[inc.work_order_id] : null, eqId = inc.equipment_id || incEquipment(inc), e = eqOf(eqId);
  const res = inc.status === 'RESOLVED', acted = inc.actions.length > 0 || res;
  let st;
  if (inc.category === 'EQUIPMENT' && w && substitutes(inc).length) {
    const moved = w.equipment_id !== eqId, run = moved && w.status !== 'BLOCKED';
    const fit = stepRec(inc, 'fit'), ap = stepRec(inc, 'approve');
    st = [
      { key: 'act', title: '고장 확인', btn: '고장 확인 기록', done: acted },
      { key: 'check', title: '대체 가능 여부 확인', btn: '대체 가능 여부 확인', done: !!stepRec(inc, 'check') || moved || res },
      { key: 'fit', title: '적합성 확인 (WPS·출력·자격·위치)', btn: '적합성 확인', done: !!fit || moved || res },
      { key: 'approve', title: '관리자 승인', btn: '관리자 승인 (생산관리)', done: !!ap || moved || res },
      { key: 'swap', title: '설비 변경 (남은 작업만 이관)', btn: `남은 작업 ${ap?.equipment_id || ''}로 이관`, done: moved || res },
      { key: 'resume', title: '작업 재개', btn: '작업 재개', done: run || res },
      { key: 'close', title: '설비 복구 후 사건 종료', btn: `${eqId} 복구 확인 · 사건 종료`, done: res },
    ];
  } else if (inc.category === 'EQUIPMENT') {
    st = [{ key: 'act', title: '고장 확인', btn: '고장 확인 기록', done: acted },
      { key: 'close', title: '설비 복구 후 사건 종료', btn: `${eqId} 복구 확인 · 사건 종료`, done: res }];
    if (w) st.push({ key: 'resume', title: '작업 재개', btn: '작업 재개', done: w.status !== 'BLOCKED' });
  } else {
    st = [{ key: 'act', title: '조치 기록', btn: '조치 기록', done: acted },
      { key: 'resolve', title: inc.category === 'QUALITY' ? '재검사 합격 · 사건 해소' : '사건 해소', btn: '사건 해소', done: res }];
    if (w && inc.category !== 'QUALITY') st.push({ key: 'resume', title: '작업 재개', btn: '작업 재개', done: w.status !== 'BLOCKED' });
  }
  return { st, active: st.find(x => !x.done), w, eqId, e };
}
function focusCase() { return openIncidents().filter(i => caseSteps(i).active); }
const easyCase = () => (UI.sel.inc && incById(UI.sel.inc)) || focusCase()[0] || null;
function relatedIncs(inc) {   // 관련 가능성: 고장 설비에서 앞 공정을 마친 블록의 품질 사건(확인 필요, 사실 아님)
  if (inc.category !== 'EQUIPMENT') return [];
  return openIncidents().filter(i => i !== inc && i.category === 'QUALITY' && i.work_order_id && blockWos(S.wo[i.work_order_id].block_id).some(w => w.equipment_id === inc.equipment_id && w.status === 'COMPLETED'));
}
function statusBar() {   // 위: 가상 시각·재생 / 아래: 지표 띠(설비 상태 개수 + 진행·멈춤·사건). 지표는 서버 값 그대로
  const k = kpis(), g = progressKpi(), now = nowS();
  const stopped = todayWos().filter(w => nodeState(w).stop).length;
  const state = UI.simOn || othersPlaying() ? '<span class="pstate on">▶ 재생 중</span>' : UI.pausedFor ? `<span class="pstate wait">⏸ 일시정지 · ${UI.pausedFor}</span>` : '<span class="pstate">⏸ 정지</span>';
  const eqc = [['가동', k.running, 'b'], ['대기', k.idle, 'n'], ['고장', k.fault, 'r'], ['점검', k.maint, 'p']];
  return `<div class="sbar"><div class="sclock"><span>가상 시각</span><b class="clock">${md(now)} (${wd(now)}) ${hm(now)}</b></div>${state}
    ${playCtl()}<span class="small">1× = 실제 10초당 가상 5분</span>${ioChip()}${lvChip()}<span class="grow"></span>
    <div class="kpi"><span>설비 가동</span><b>${cnt('k-run', k.running)} / ${k.total}<small class="eqcnt">${eqc.slice(1).map(([l, v, c]) => `<i class="${v ? c : ''}">${l} ${v}</i>`).join('')}</small></b><small class="kpis2">설비 ${k.total}대 = 가동 ${k.running} + 대기 ${k.idle} + 고장 ${k.fault} + 점검 ${k.maint} (설비 기준)</small></div>
    <div class="kpi"><span>진행률 (실적 / 계획)</span><b>${cnt('k-prog', Math.round(+g.a || 0))}%<small>/ ${pct(g.p, 0)}</small>${g.gap >= 0.5 ? `<em class="gap">지연 ${g.gap.toFixed(0)}%p</em>` : ''}</b></div>
    <div class="kpi"><span>멈춘 작업</span><b class="${stopped ? 'c-r' : ''}">${cnt('k-stop', stopped)}<small>/ ${todayWos().length}</small></b></div>
    <div class="kpi"><span>미해결 사건</span><b class="${k.open ? 'c-r' : ''}">${cnt('k-open', k.open)}</b></div></div>`;
}
function gauge(ratio, c) {   // 공정 카드의 원형 게이지(실적 비율)
  const R = 21, C = 2 * Math.PI * R, a = Math.max(0, Math.min(1, ratio));
  return `<svg class="gauge" viewBox="0 0 52 52" aria-hidden="true"><circle class="gt" cx="26" cy="26" r="${R}"/><circle class="gv ${c}" cx="26" cy="26" r="${R}" stroke-dasharray="${(a * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 26 26)"/>
    <text x="26" y="30" text-anchor="middle">${+(a * 100).toFixed(1)}<tspan dx="0.5" font-size="8">%</tspan></text></svg>`;
}
function dayTimeline() {   // 오늘 공정 타임라인(08:00~16:00): 공정마다 오늘 작업지시 설비의 상태 구간 + 사건 표시, 지금 이후는 비움
  const a0 = toM(DAY + ' 08:00'), a1 = toM(DAY + ' 16:00'), W = a1 - a0, now = Math.min(S.now, a1), x = m => ((Math.max(a0, Math.min(a1, m)) - a0) / W * 100).toFixed(2);
  const tot = { RUNNING: 0, IDLE: 0, FAULT: 0, MAINTENANCE: 0 };
  const rows = todayWos().map((w, ri) => { const p = proc(w.process_id), eqs = [...new Set([w.equipment_id, ...S.incidents.filter(i => i.work_order_id === w.work_order_id && i.equipment_id).map(i => i.equipment_id)])];
    const segs = eqs.flatMap(eq => segments(eq).filter(sg => (sg.wo === w.work_order_id || !sg.wo && eq === w.equipment_id) && sg.e > a0 && sg.s < now).map(sg => ({ ...sg, eq })));
    segs.forEach(sg => { if (tot[sg.status] != null) tot[sg.status] += Math.min(sg.e, now) - Math.max(sg.s, a0); });
    const bars = segs.map(sg => `<i class="${STATUS.eq[sg.status]?.[1] || 'n'}" style="left:${x(sg.s)}%;width:${(x(Math.min(sg.e, now)) - x(sg.s)).toFixed(2)}%" title="${sg.eq} ${STATUS.eq[sg.status]?.[0] || sg.status} ${hm(fromM(Math.max(sg.s, a0)))}~${hm(fromM(Math.min(sg.e, now)))}"></i>`).join('');
    const marks = S.incidents.filter(i => i.work_order_id === w.work_order_id && toM(i.opened_at) >= a0 && toM(i.opened_at) <= now).map(i => `<b class="mk ${STATUS.cat[i.category][1]}" style="left:${x(toM(i.opened_at))}%" title="${i.incident_id} ${hm(i.opened_at)} ${esc(i.summary)}">${STATUS.cat[i.category][0]}</b>`).join('');
    return `<span class="tln" style="grid-row:${ri + 1}">${p2(p.sequence_no)} ${esc(p.process_name)}<small>${w.equipment_id}</small></span><div class="tlb" style="grid-row:${ri + 1}">${bars}${marks}</div>`; }).join('');
  const ticks = [8, 9, 10, 11, 12, 13, 14, 15, 16].map(h => `<span style="left:${((h - 8) / 8 * 100).toFixed(2)}%">${p2(h)}:00</span>`).join('');
  const leg = [['RUNNING', 'b'], ['IDLE', 'n'], ['FAULT', 'r'], ['MAINTENANCE', 'p']].map(([k, c]) => `<span><i class="${c}"></i>${STATUS.eq[k][0]} ${minLabel(tot[k])}</span>`).join('');
  return `<section class="panel tlpanel"><div class="ph"><h2>오늘 공정 타임라인</h2><span class="sub">${md(DAY)} · <b class="tlk">실적 08:00~${hm(nowS())}</b> | <span class="tlk2">계획 ${hm(nowS())}~16:00</span></span><span class="grow"></span><span class="tleg">${leg}</span></div>
    <div class="tlg">${rows}<div class="tlax" style="grid-row:${todayWos().length + 1}">${ticks}</div><div class="tlov" style="grid-row:1 / span ${todayWos().length + 1}"><em class="tlfut" style="left:${x(now)}%"></em><i style="left:${x(now)}%"><b>${hm(nowS())}</b></i></div></div></section>`;
}
function viewDash() {
  const inc = UI.sel.inc && incById(UI.sel.inc);
  const selWo = UI.sel.node || (inc && inc.work_order_id) || null;
  const rel = new Set(inc ? relatedIncs(inc).map(i => i.work_order_id) : []);
  const art = window.EQ_ART || {};
  const nodes = todayWos().map(w => {
    const p = proc(w.process_id), ns = nodeState(w), e = eqOf(w.equipment_id), a = actRatio(w), pl = planRatio(w) * 100, gap = pl - a * 100;
    return `<div class="dcell"><button class="node ${ns.c} ${selWo === w.work_order_id ? 'sel' : ''} ${rel.has(w.work_order_id) ? 'rel' : ''}" data-act="selNode" data-arg="${w.work_order_id}">
      <span class="nh"><small>${p2(p.sequence_no)}</small><b>${esc(p.process_name)}</b><span class="badge ${ns.c}">${ns.l}</span></span>
      <span class="nbody">${gauge(a, 'v')}<span class="ninfo"><span class="blk">${w.block_id}</span><small class="nwo">${w.work_order_id} · ${e.equipment_id}</small>
        ${rel.has(w.work_order_id) ? '<span class="rtag">영향 가능 · 확인 필요</span>' : ns.inc && ns.inc.status === 'OPEN' ? `<span class="itag">${ns.inc.incident_id}</span>` : `<b class="${gap >= 0.5 ? 'c-r' : 'c-g'} ngap">${gap >= 0.5 ? `지연 ${pct(gap)}p` : '계획대로'}</b>`}</span></span></button>
      <span class="dimg"><img class="dart" src="${art[p.process_id] || ''}" alt="${esc(e.equipment_name)}"><img class="dlamp ${STATUS.eq[e.status][1]}" src="${art[STATUS.eq[e.status][1]] || art.n || ''}" alt=""></span>
      <span class="deq ${STATUS.eq[e.status][1]}"><i></i>${esc(eqName(e.equipment_id))}</span></div>`;
  }).join('');
  const sw = selWo && S.wo[selWo];
  const detail = sw ? (() => { const pre = sw.predecessor_id && S.wo[sw.predecessor_id], z = S.zones[proc(sw.process_id).zone_id];
    return `<div class="ndet"><div class="grow"><b>${sw.block_id} 상세</b><span>작업지시 ${sw.work_order_id} · 담당 ${esc(sw.team_id || '-')} · 선행 공정 ${pre ? `${p2(proc(pre.process_id).sequence_no)} ${esc(proc(pre.process_id).process_name)} ${pre.status === 'COMPLETED' ? `완료(${md(pre.actual_end_at || pre.planned_end_at)})` : STATUS.wo[pre.status][0]}` : '없음'} · 위치 ${esc(z?.zone_name || '')} · 실적 ${pct(actRatio(sw) * 100)} / 계획 ${pct(planRatio(sw) * 100)}</span></div>
      <button class="btn pri" data-act="bkOpen" data-arg="${sw.block_id}" title="${sw.block_id} 블록 안을 지금 공정(${p2(proc(sw.process_id).sequence_no)} ${esc(proc(sw.process_id).process_name)}) 상태 그대로 3D로 봅니다">🔍 내부 현황 (3D)</button></div>`; })()
    : '<div class="ndet empty">공정 카드를 누르면 작업지시·담당·선행 공정·위치와 [내부 현황 (3D)]가 열립니다.</div>';
  const assigned = new Set(todayWos().map(w => w.equipment_id));
  const spare = Object.values(S.equipment).filter(e => !assigned.has(e.equipment_id)).map(e => {
    const fitInc = openIncidents().find(i => i.category === 'EQUIPMENT' && substitutes(i).includes(e));
    let tag = '';
    if (e.status === 'MAINTENANCE') tag = '사용 불가 · 점검 중';
    else if (e.status === 'FAULT') tag = '고장 · 복구 대기';
    else if (fitInc && stepRec(fitInc, 'approve')?.equipment_id === e.equipment_id) tag = '대체 승인됨 · 이관 대기';
    else if (fitInc && stepRec(fitInc, 'fit')?.equipment_id === e.equipment_id) tag = '대체 적합 · 승인 필요';
    else if (fitInc) tag = '대체 가능 여부 미확인';
    const on = fitInc && fitInc === inc && caseSteps(inc).active && ['fit', 'approve', 'swap'].includes(caseSteps(inc).active.key) && e.status === 'IDLE';
    return `<div class="spare ${on ? 'sel' : ''}"><img class="sart" src="${art.SP || ''}" alt=""><img class="slamp" src="${art[STATUS.eq[e.status][1]] || art.n || ''}" alt=""><b>${esc(eqName(e.equipment_id))}</b>${badge('eq', e.status)}<span class="small">${p2(proc(e.process_id).sequence_no)} 공정${tag ? ' · ' + tag : ''}</span></div>`; }).join('');
  const legend = [['b', '가동'], ['n', '대기'], ['o', '자재 대기·품질 보류'], ['r', '정지'], ['g', '완료']].map(([c, l]) => `<span><i class="${c}"></i>${l}</span>`).join('');
  return `<div class="dash3">${statusBar()}
  <div class="d3grid">
    <div class="d3main">
      <section class="dmap"><div class="dmh"><h2>공정 관제 지도</h2><span class="sub">작업구역 6 · 설비 ${Object.keys(S.equipment).length} · 블록 흐름 01 → 06 · 카드를 누르면 상세</span><span class="grow"></span><span class="dleg">${legend}</span></div>
        <div class="nodes ${isLive() ? 'live' : ''}">${nodes}</div><div class="dflow"><i></i></div>
        <div class="dfoot"><span class="dlbl">대기·예비 설비</span><div class="spares">${spare || '<span class="small">없음</span>'}</div><span class="grow"></span><span class="dbase">기준 ${md(nowS())} ${hm(nowS())}</span></div></section>
      ${detail}
      ${dayTimeline()}
    </div>
    <section class="d3side panel sidecard"><div class="ph"><h2>지금 확인할 것</h2><span class="grow"></span><button class="btn pri" data-act="goPri">작업 관리 ›</button></div>
      <div class="sitline">${sitLine()}</div>
      <div class="sumbody">${aiBox()}${priMini()}</div>
      <div class="sidefoot"><span class="small">미해결 ${openIncidents().length}건 · 사건 처리(단계 실행)는 작업 관리 우선순위에서 합니다 · 확인되지 않은 원인은 단정하지 않습니다.</span><div class="row"><button class="btn" data-act="copySummary">요약 복사</button><span class="small">이번 시연 변경 ${S.events.filter(e => e.text !== '데모 데이터 초기화').length}건</span></div></div>
    </section>
  </div></div>`;
}
// 사건 설명 문장(작업 관리 우선순위 카드의 '왜 멈췄나요?'): 서버 상태 그대로, 확인되지 않은 원인은 단정하지 않음
function incWhy(inc) {
  const w = inc.work_order_id && S.wo[inc.work_order_id];
  const min = (inc.resolved_at ? toM(inc.resolved_at) : S.now) - toM(inc.opened_at);
  const moved = w && inc.category === 'EQUIPMENT' && w.equipment_id !== inc.equipment_id;
  return inc.category === 'EQUIPMENT'
    ? `${esc(eqName(inc.equipment_id))}이 ${hm(inc.opened_at)}에 고장 나 ${w ? `${w.block_id} ${esc(proc(w.process_id).process_name)}(${w.work_order_id})이 멈췄습니다. ` : ''}${inc.status === 'OPEN' ? `${minLabel(min)}째 사건이 열려 있습니다. ` : ''}${moved ? `남은 작업은 대체 설비 ${w.equipment_id}로 옮겨 ${STATUS.wo[w.status][0]} 상태입니다. ${inc.status === 'OPEN' ? `사건은 ${inc.equipment_id} 복구 때까지 열려 있습니다.` : ''}` : w ? `남은 작업은 ${pct((1 - actRatio(w)) * 100)}입니다.` : ''} 원인: ${esc(inc.summary)}`
    : inc.category === 'MATERIAL' ? `${w ? w.block_id + ' ' + esc(proc(w.process_id).process_name) + '이 ' : ''}${esc(inc.summary)}로 멈춰 있습니다. ${esc(inc.action_note || '')}`
    : `${w ? w.block_id + ' 검사에서 ' : ''}${esc(inc.summary)}. ${esc(inc.action_note || '')}`;
}
const incRelText = inc => relatedIncs(inc).map(r => `관련 가능성(확인 필요): ${r.incident_id} ${S.wo[r.work_order_id].block_id} ${esc(r.summary)} — ${inc.equipment_id}에서 앞 공정을 한 블록`).join('<br>');
// 관제 오른쪽 '지금 확인할 것': AI 요약 + 처리 순서(작업 관리 우선순위와 같은 계산). 처리는 작업 관리에서
function priMini() {
  const L = priorities(); if (!L.length) return '<div class="empty">미해결 사건이 없습니다.</div>';
  return `<div class="primini"><div class="pmh">처리 순서 <small>작업 관리 우선순위와 같은 기준 · 누르면 작업 관리에서 처리</small></div>${L.map(x => { const a = caseSteps(x.inc).active;
    return `<button class="pmi r${Math.min(x.rank, 3)}" data-act="goPri" data-arg="${x.inc.incident_id}"><b>${x.rank}</b><span><em>${esc(priHead(x))}</em><small>${x.inc.incident_id} · ${STATUS.cat[x.inc.category][0]} · ${a ? '지금 단계: ' + a.title : '처리 완료'}</small></span><i>›</i></button>`; }).join('')}</div>`;
}
// 사건 설명도(Anatomy 키트로 만든 그림, 분해·조립 동작 포함). 사건 패널 '왜 멈췄나요?'의 버튼으로 크게 연다.
// INC003 = EQ03 용접기 경보(B008), INC004 = B009 부재 공급 대기, INC005 = B007 검사 불합격. 그림은 figures/<id>/build.mjs로 만든다.
// 그림 요소는 사건마다 한 번만 만들어 두고(동작 상태 유지) 다시 그릴 때마다 모달 자리로 옮긴다. 경광등·표시·읽기값만 서버 상태에 맞춰 바꾼다
const hasFig = inc => !!(inc && (window.FIGS || {})[inc.incident_id]);
const FIG = {};
function figHtml(inc) {
  return hasFig(inc) ? `<button class="btn line figbtn" data-act="figOpen">🔍 ${inc.category === 'EQUIPMENT' ? '고장 부위' : '상황'} 설명도 보기</button>` : '';
}
function figModal() {
  const inc = UI.sel.inc && incById(UI.sel.inc); if (!hasFig(inc)) return '';
  const name = `${inc.category === 'EQUIPMENT' ? '고장 부위' : '상황'} 설명도`;
  return `<div class="modal-bg" data-act="figClose"><div class="modal figmodal" data-act="stay" role="dialog" aria-label="${inc.incident_id} ${name}">
    <div class="ph"><h2>${name} · ${inc.incident_id}</h2><span class="sub">${esc(inc.summary)}</span><span class="grow"></span><button class="btn" data-act="figClose">닫기 ✕</button></div>
    <div id="fighost"></div></div></div>`;
}
function figState(inc) {   // 사건별 서버 상태 → 그림 상태(data-eq)와 오른쪽 아래 읽기값
  const w = inc.work_order_id && S.wo[inc.work_order_id], open = inc.status === 'OPEN';
  if (inc.incident_id === 'INC003') {
    const fault = eqOf('EQ03').status === 'FAULT', moved = w && w.equipment_id !== 'EQ03';
    return { eq: fault ? 'fault' : 'ok', code: fault ? 'ALM 31' : 'READY',
      read: !fault ? 'EQ03 복구 · 대기' : moved ? `남은 작업 ${w.equipment_id}로 이관 · EQ03 경보 유지` : `${+w.accepted_qty.toFixed(1)} / ${w.planned_qty} m · EQ03 경보 ALM 31` };
  }
  if (inc.category === 'MATERIAL') return { eq: open ? 'hold' : 'ok', read: `${w ? `${+w.accepted_qty} / ${w.planned_qty} ${w.unit} · ` : ''}${open ? '부재 입고 대기' : '부재 입고, 취부 재개'}` };
  const q = S.inspections.filter(x => x.work_order_id === inc.work_order_id).pop();
  return { eq: open ? 'hold' : 'ok', read: open ? `합격 ${q ? q.passed_points : 8} / ${q ? q.checked_points : 10}곳 · 보수 완료, 재검사 대기` : '재검사 합격 · 품질 보류 해제' };
}
function figMount() {
  const host = document.getElementById('fighost'); if (!host) return;
  const inc = incById(UI.sel.inc), id = inc.incident_id, st = figState(inc);
  if (!FIG[id]) {
    const el = FIG[id] = document.createElement('div'); el.className = 'ifig iso'; el.dataset.theme = 'light'; el.innerHTML = window.FIGS[id];
    if (window.FIG_RUN) window.FIG_RUN(el);
  }
  const el = FIG[id];
  host.replaceWith(el);
  el.querySelector('.iso-stage').dataset.eq = st.eq;
  const code = el.querySelector('.eq-code[data-cart="fault"]'); if (code && st.code) code.textContent = st.code;
  const out = el.querySelector('[data-readout]'); if (out.dataset.base !== st.read) { out.dataset.base = st.read; out.textContent = st.read; }
}
function stepCtl(inc, cs, a) {
  const busy = UI.busy ? 'disabled' : '';
  const trialNote = UI.canWrite ? '' : '<div class="small">🧪 체험 모드: 실제 서버 규칙으로 처리하지만 저장하지 않습니다. 저장하려면 위쪽 [🔑 조작 권한].</div>';
  let extra = '';
  if (a.key === 'act') extra = `<textarea id="wizNote" data-draft="wizNote" placeholder="${inc.category === 'EQUIPMENT' ? '예: 전원장치 경보 확인, 정비조 점검 시작' : '예: 부재 긴급 공급 요청'}">${esc(draft('wizNote', ''))}</textarea>`;
  if (a.key === 'check') extra = `<div class="small">같은 공정 설비: ${substitutes(inc).map(e => `${e.equipment_id} ${STATUS.eq[e.status][0]}`).join(' · ')}</div>`;
  if (['fit', 'approve', 'swap'].includes(a.key)) {
    const cand = substitutes(inc).filter(e => !['FAULT', 'MAINTENANCE'].includes(e.status));
    const ex = substitutes(inc).filter(e => ['FAULT', 'MAINTENANCE'].includes(e.status));
    const eqId = a.key === 'fit' ? (cand.find(e => e.equipment_id === UI.draft.subEq) || cand[0])?.equipment_id : stepRec(inc, a.key === 'approve' ? 'fit' : 'approve')?.equipment_id;
    const f = S.fit.find(x => x.equipment_id === eqId && x.process_id === cs.w.process_id);
    const mark = s => s === 'OK' ? '<b class="c-g">✓</b>' : s === 'COND' ? '<b class="c-o">△</b>' : '<b class="c-r">✕</b>';
    const word = s => s === 'OK' ? '적합' : s === 'COND' ? '조건부' : '부적합';
    extra = eqId && f ? `<div class="cand"><b>대체 후보 · ${esc(eqName(eqId))}</b>${a.key === 'fit' && cand.length > 1 ? cand.map(e => `<button class="btn ${e.equipment_id === eqId ? 'pri' : ''}" data-act="subEq" data-arg="${e.equipment_id}">${e.equipment_id}</button>`).join('') : ''}
      <div class="fit">${[['WPS (용접 절차)', f.wps_state, f.wps_note], ['출력', f.power_state, f.power_note], ['작업자 자격', f.cert_state, f.cert_note], ['위치', f.loc_state, f.loc_note]].map(([l, s, n]) => `<span>${mark(s)} ${l}</span><span>${esc(n)} — ${word(s)}</span>`).join('')}</div>
      ${ex.map(e => `<div class="small">제외: ${esc(eqName(e.equipment_id))} — ${STATUS.eq[e.status][0]} 중</div>`).join('')}
      <div class="small">${a.key === 'swap' ? `승인: ${esc(stepRec(inc, 'approve').by_name)} ${hm(stepRec(inc, 'approve').at)} · 남은 작업 ${+(cs.w.planned_qty - cs.w.accepted_qty).toFixed(1)} ${unit(cs.w.unit)}만 이관, 이미 한 실적은 ${inc.equipment_id}에 그대로` : '승인자: 생산관리 담당(관리자)'}</div></div>` : '<div class="small">대체할 수 있는 설비가 없습니다.</div>';
  }
  if (a.key === 'resume' && inc.category === 'EQUIPMENT' && cs.w.equipment_id !== inc.equipment_id) extra = `<div class="small">${cs.w.equipment_id}에서 작업을 재개합니다. 재개해도 ${inc.incident_id}은 ${inc.equipment_id} 복구 때까지 닫히지 않습니다.</div>`;
  if (a.key === 'close') extra = `<div class="small">${inc.equipment_id} 정비가 끝나면 누릅니다: 복구 확인 기록 → 사건 해소 → ${inc.equipment_id} 대기 복구를 한 번에 처리합니다.</div>`;
  return `<div class="ictl">${extra}<div class="row"><button class="btn pri" data-act="stepDo" data-arg="${a.key}" ${busy}>${a.btn} ›</button>${a.key === 'fit' || a.key === 'approve' ? '<button class="btn" data-act="selIncClear">취소</button>' : ''}</div>${trialNote}</div>`;
}
function introBox() {
  return `<div class="modal-bg" data-act="introClose"><div class="modal intro" data-act="stay" role="dialog" aria-label="처음 안내">
    <h2>TWIN PRO · 조선 블록 생산 관제 시연</h2><p class="small">교육용 가상 데이터(09/16)로 움직입니다. 실제 공장과 연결되어 있지 않습니다.</p>
    <div class="icards"><div><b>01 공정 연결망</b>절단부터 이송까지 6개 공정과 설비·작업이 연결되어 시간에 따라 움직입니다.</div>
      <div><b>02 원인 추적과 조치</b>멈춘 작업을 누르면 원인이 이어져 보이고, 대체 설비는 확인과 승인을 거쳐 투입합니다.</div>
      <div><b>03 2D ↔ 3D</b>관제에서 고른 블록의 위치와 내부 조립 상태를 3D로 바로 확인합니다.</div></div>
    <div class="intro-btns"><button class="btn pri big" data-act="introStart">▶ 시연 시작</button></div>
    <p class="small c">왼쪽 아래 ? 아이콘(휴대폰은 [? 안내])으로 언제든 다시 열 수 있습니다</p>
  </div></div>`;
}
const EASY_NAME = { P01: '자르기', P02: '붙이기', P03: '용접', P04: '검사', P05: '칠하기', P06: '옮기기' };
function easyState(w) {   // 3D 화면의 공정 색(관제와 같은 기준)
  const ns = nodeState(w);
  const word = { r: '고장·멈춤', o: ns.l === '자재 대기' ? '재료 기다림 · 멈춤' : '품질 보류', b: '작업 중', g: '오늘 몫 끝남', n: '대기' }[ns.c];
  return [ns.c === 'b' ? 'g' : ns.c === 'g' ? 'b' : ns.c, word];   // 3D 색 체계: g=작업 중, b=끝남
}
function aiBox() {
  const left = Math.max(0, AI_LIMIT - S.aiUsed);
  const fresh = S.ai && S.ai.sim_at === nowS() && S.events[0] && S.events[0].text === 'AI 운영 요약 생성';   // 생성 뒤 시각 진행·서버 변경이 없으면 최신
  const why = !UI.canWrite ? '시연 코드를 입력해야 생성할 수 있습니다' : !left ? '오늘 사용 횟수를 모두 썼습니다' : '';
  return `<div class="ai-box"><div class="ai-h"><b>AI 운영 요약</b><span class="small">${S.ai ? `시연 시각 ${hm(S.ai.sim_at)} 기준${fresh ? '' : ' · <span class="c-o">이후 변경 있음</span>'}` : '아직 생성하지 않음'}</span>
    <button class="btn pri" data-act="aiGen" ${why || UI.aiBusy ? `disabled title="${why || '생성 중'}"` : ''}>${UI.aiBusy ? '생성 중…' : `✦ AI 요약 생성`} <small>오늘 남은 ${left}회</small></button></div>
    ${S.ai ? `<div class="ai-text" id="aiText">${esc(S.ai.text)}</div><span class="small">Claude(${esc(S.ai.model || '')})가 서버 DB의 현재 값만으로 작성 · 하루 ${AI_LIMIT}회 제한</span>`
      : `<div class="ai-text rule"><span class="pv-tag rule">규칙 문장 · AI 생성 전</span> ${priSentence(priorities())}</div><span class="small">[✦ AI 요약 생성]을 누르면 AI(Claude)가 지금의 설비·작업·사건 사실을 읽고 요약합니다. 하루 ${AI_LIMIT}회.</span>`}</div>`;
}
function histText(h) { return h ? `${hm(h.event_at)} ${STATUS.his[h.event_type] || h.event_type} · ${h.note || ''}` : '-'; }
// 관제 오른쪽 카드 맨 위 한 줄: 운영 요약의 전체 문장(가동 공정 · 실적 대비 계획)
function sitLine() {
  const g = progressKpi(), ws = todayWos(), run = ws.filter(w => nodeState(w).c === 'b').length;
  const down = Object.values(S.equipment).filter(e => e.status === 'FAULT' && !openIncidents().some(i => i.equipment_id === e.equipment_id));
  return `<b>${hm(nowS())} 기준</b> 6개 공정 중 ${run}개 가동 · 실적 ${pct(g.a, 0)} / 계획 ${pct(g.p, 0)} ${g.gap >= 0.5 ? `<em>${g.gap.toFixed(0)}%p 지연</em>` : '· 계획대로'}${down.length ? ` · ${down.map(e => e.equipment_id).join(', ')} 복구 대기` : ''}`;
}
// 사건 한 건의 운영 요약 문장(사건 번호 없이). 사건 목록 2줄째에 쓴다
function incSentence(i) {
  const w = i.work_order_id && S.wo[i.work_order_id];
  if (i.category === 'EQUIPMENT') return `${eqName(i.equipment_id)} 고장으로 ${w ? `${w.block_id} ${proc(w.process_id).process_name}이 ` + (w.status === 'BLOCKED' ? `${hm(i.opened_at)}부터 멈춰 있습니다.` : `대체 설비 ${w.equipment_id}에서 ${STATUS.wo[w.status][0]} 중입니다(사건은 복구 때까지 유지).`) : '사건이 열려 있습니다.'}`;
  if (i.category === 'MATERIAL') return `${w ? w.block_id + '는 ' : ''}${i.summary}.`;
  return `${w ? w.block_id + '는 ' : ''}${i.summary}로 재검사 판정 대기입니다.`;
}
function summaryText() {
  const g = progressKpi(), ws = todayWos();
  const s = [`${hm(nowS())} 기준 6개 공정 중 ${ws.filter(w => nodeState(w).c === 'b').length}개 가동.`];
  for (const i of openIncidents()) {
    const w = i.work_order_id && S.wo[i.work_order_id];
    if (i.category === 'EQUIPMENT') s.push(`${eqName(i.equipment_id)} 고장(${i.incident_id})으로 ${w ? `${w.block_id} ${proc(w.process_id).process_name}이 ` + (w.status === 'BLOCKED' ? `${hm(i.opened_at)}부터 멈춰 있습니다.` : `대체 설비 ${w.equipment_id}에서 ${STATUS.wo[w.status][0]} 중입니다(사건은 복구 때까지 유지).`) : '사건이 열려 있습니다.'}`);
    else if (i.category === 'MATERIAL') s.push(`${w ? w.block_id + '는 ' : ''}${i.summary}(${i.incident_id}).`);
    else s.push(`${w ? w.block_id + '는 ' : ''}${i.summary}(${i.incident_id})로 재검사 판정 대기입니다.`);
  }
  if (!openIncidents().length) s.push('미해결 사건이 없습니다.');
  const down = Object.values(S.equipment).filter(e => e.status === 'FAULT' && !openIncidents().some(i => i.equipment_id === e.equipment_id));
  if (down.length) s.push(`${down.map(e => e.equipment_id).join(', ')}는 사건 종료 후 복구 대기입니다.`);
  s.push(`전체 실적 ${pct(g.a, 0)}로 계획 ${pct(g.p, 0)} 대비 ${g.gap >= 0.5 ? `${g.gap.toFixed(0)}%p 늦습니다.` : '계획대로입니다.'}`);
  return s.join(' ');
}

// ---------- 2. 설비 상태 ----------
function eqRows() {
  const f = UI.f.eq;
  return Object.values(S.equipment).filter(e => (!f.proc || e.process_id === f.proc) && (!f.st || e.status === f.st) && (!f.kind || e.resource_kind === f.kind)
    && (!f.q || (e.equipment_id + e.equipment_name).toLowerCase().includes(f.q.toLowerCase())));
}
function viewEq() {
  const f = UI.f.eq, list = eqRows();
  const e = eqOf(UI.sel.eq) || list[0]; const id = e.equipment_id;
  const occ = occupancy(id), fs = faultStats(id), since = statusSince(id);
  const art = window.EQ_ART || {};
  const cards = list.map(x => { const o = occupancy(x.equipment_id), c = STATUS.eq[x.status][1], w = x.work_order_id && S.wo[x.work_order_id];
    return `<button class="eqc ${c} ${x.equipment_id === id ? 'sel' : ''}" data-act="selEq" data-arg="${x.equipment_id}">
      <span class="eqc-h"><b>${x.equipment_id}</b><span class="nm">${esc(x.equipment_name)}</span>${ioBadge(x.equipment_id)}${badge('eq', x.status)}</span>
      <span class="eqc-img"><img class="art" src="${eqArtOf(x)}" alt=""><img class="lamp" src="${art[c] || art.n || ''}" alt=""></span>
      <span class="eqc-p">${x.process_id.slice(1)} ${esc(proc(x.process_id).process_name)} · ${esc(x.resource_kind)}</span>
      <span class="occ"><em>점유율</em>${bar(o.pct / 100, c, 70)}</span>
      <span class="eqc-w">${w ? `작업 ${w.work_order_id} · ${w.block_id}` : '배정된 작업 없음'}<em class="${x.status === 'FAULT' ? 'c-r' : ''}">${hm(fromM(S.now - statusSince(x.equipment_id)))}부터 ${STATUS.eq[x.status][0]}</em></span></button>`; }).join('');
  const all = Object.values(S.equipment), cnt = st => all.filter(x => x.status === st).length;
  const segs = segments(id).filter(s => s.status !== 'OFFSHIFT').reverse().slice(0, 7);
  const his = segs.map(s => { const inc = s.inc && incById(s.inc); const w = s.wo && S.wo[s.wo];
    const note = inc ? `${inc.incident_id} ${inc.summary}` : s.status === 'RUNNING' && w ? `${w.block_id} ${proc(w.process_id).process_name}` : s.status === 'IDLE' ? '대기' : STATUS.eq[s.status][0];
    return `<tr><td>${md(fromM(s.s))} ${hm(fromM(s.s))}</td><td class="c">${badge('eq', s.status)}</td><td>${s.wo || '-'}</td><td>${esc(note)}</td></tr>`; }).join('');
  const days = ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'];
  const lanes = days.map(d => { const d0 = toM(d + ' 08:00'), d1 = d0 + 480;
    const parts = S.intervals.filter(i => i.eq === id && i.s < d1 && (i.e ?? S.now) > d0).map(i => { const a = Math.max(i.s, d0), b = Math.min(i.e ?? S.now, d1, S.now); if (b <= a) return '';
      const c = STATUS.eq[i.status]?.[1] || 'n'; return `<i style="left:${(a - d0) / 4.8}%;width:${(b - a) / 4.8}%;background:${colorVar(c)}" title="${hm(fromM(a))}~${hm(fromM(b))} ${STATUS.eq[i.status]?.[0] || i.status}"></i>`; }).join('');
    return `<span>${dateLabel(d)}</span><div class="lane">${parts}</div>`; }).join('');
  const incs = openIncidents().filter(i => incEquipment(i) === id);
  const inc = incs.find(i => i.incident_id === UI.sel.inc) || incs[0];
  let action = '';
  if (inc) {
    const w = inc.work_order_id && S.wo[inc.work_order_id];
    action = `<div class="alertbox">
      <div class="row"><b>${inc.incident_id} · ${STATUS.cat[inc.category][0]} · ${inc.severity}</b>${badge('inc', inc.status)}${incs.length > 1 ? incs.filter(x => x !== inc).map(x => `<button class="btn" data-act="selEqInc" data-arg="${x.incident_id}">${x.incident_id}</button>`).join('') : ''}</div>
      <div class="small">${md(inc.opened_at)} ${hm(inc.opened_at)} 발생 · ${esc(inc.summary)}${w ? ` · ${w.work_order_id} (${w.block_id}) ${STATUS.wo[w.status][0]}${w.equipment_id !== id ? ' · 대체 설비 ' + w.equipment_id : ''}` : ''}</div>
      ${inc.action_note ? `<div><b style="font-size:12px">엑셀 기록 조치 메모:</b> <span style="font-size:12px">${esc(inc.action_note)} · 담당 ${esc(inc.owner_team)}</span></div>` : ''}
      ${inc.actions.length ? `<div class="tw"><table><thead><tr><th>시각</th><th>담당</th><th>조치 내용(서버 기록)</th></tr></thead><tbody>${inc.actions.map(a => `<tr><td>${hm(a.at)}</td><td>${esc(a.owner)}</td><td>${esc(a.note)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="row"><span class="small grow">사건 처리는 작업 관리 우선순위에서 합니다(처리 단계 순서를 지키기 위해).</span><button class="btn pri" data-act="goInc" data-arg="${inc.incident_id}">작업 관리에서 처리 ›</button></div></div>`;
  } else action = `<div class="empty">이 설비에 미해소 사건이 없습니다.</div>`;
  const eqBtns = e.status === 'FAULT'
    ? `<span class="small">설비 복구는 작업 관리 우선순위의 [설비 복구 후 사건 종료] 단계에서 합니다.</span>`
    : UI.faultForm ? `<div class="field" style="flex:1"><span class="lb">고장 증상</span><div class="in" style="flex:1"><input type="text" id="faultSum" data-draft="faultSum" value="${esc(draft('faultSum', ''))}" placeholder="예: 도장 펌프 압력 저하" style="flex:1"></div></div>
        ${selectBox('faultSev', [['HIGH', 'HIGH'], ['MEDIUM', 'MEDIUM'], ['LOW', 'LOW']], draft('faultSev', 'HIGH'), 'data-draft')}<button class="btn danger" data-act="registerFault" data-arg="${id}">고장 등록</button><button class="btn" data-act="faultForm">취소</button>`
      : `<button class="btn danger" data-act="faultForm">고장 등록…</button><span class="small">고장 등록 시 이 설비의 진행 중 작업이 보류됩니다.</span>`;
  const allOpen = openIncidents();
  return `<div class="pg pg-eq">${pageHead('설비 상태', '모니터링', `설비 ${Object.keys(S.equipment).length}대가 지금 어떤 상태인지, 지난 5일 동안 어떻게 돌았는지 봅니다. 설비를 누르면 오른쪽에 자세한 내용이 나옵니다.`)}
  <div class="pgbar">${chips('eqSt', [['', '전체', all.length], ['RUNNING', '가동', cnt('RUNNING'), 'b'], ['IDLE', '대기', cnt('IDLE'), 'n'], ['FAULT', '고장', cnt('FAULT'), 'r'], ['MAINTENANCE', '점검', cnt('MAINTENANCE'), 'p']], f.st)}
    <span class="pgsep"></span>${selectBox('eqProc', procOpts(), f.proc)}${chips('eqKind', [['', '전체 자원'], ['설비', '설비'], ['검사자원', '검사자원']], f.kind)}
    <input type="text" id="eqQ" data-filter="eqQ" value="${esc(f.q)}" placeholder="설비 코드·이름 찾기"><span class="grow"></span>
    <button class="btn" data-act="resetFilter" data-arg="eq">↻ 초기화</button><button class="btn line" data-act="csv" data-arg="eq">⭳ 엑셀(CSV)</button></div>
  <div class="pgbody">
    <div class="pgmain">
      <section class="panel pgcards"><div class="ph"><h2>설비 ${list.length}대</h2><span class="sub">점유율 = 운영시간 ${(occ.den / 60).toFixed(1).replace('.0', '')}h(09/07 08:00~${hm(nowS())}) 중 실제로 돌아간 비율 · 그림은 3D 조선소와 같은 모델</span></div>
        <div class="eqgrid">${cards || '<div class="empty">조건에 맞는 설비가 없습니다.</div>'}</div></section>
      ${UI.sub.eq === 'sig' ? signalPanel(id) : `<section class="panel pghis"><div class="ph">${eqSubTabs()}<span class="sub">${id} ${esc(e.equipment_name)} · 최근 순</span></div>
        <div class="tw"><table><thead><tr><th>시각</th><th class="c">상태</th><th>연관 작업</th><th>사건 · 메모</th></tr></thead><tbody>${his}</tbody></table></div></section>`}
    </div>
    <section class="panel pgside"><div class="ph"><h2>${id} ${esc(e.equipment_name)}</h2>${badge('eq', e.status)}<span class="sub">${e.process_id.slice(1)} ${esc(proc(e.process_id).process_name)} · ${e.zone_id} ${esc(S.zones[e.zone_id].zone_name)}</span></div>
      <div class="sdhero"><img class="art" src="${eqArtOf(e)}" alt=""><div class="sdfacts">
        <div><span>지금</span><b class="${e.status === 'FAULT' ? 'c-r' : ''}">${STATUS.eq[e.status][0]} ${minLabel(since)}째</b></div>
        <div><span>하는 작업</span><b>${e.work_order_id ? `${e.work_order_id} (${S.wo[e.work_order_id].block_id})` : '없음'}</b></div>
        <div><span>점유율(가동 비율)</span><b>${pct(occ.pct)}</b><small>가동 ${(occ.run / 60).toFixed(1)} h ÷ 운영 ${(occ.den / 60).toFixed(0)} h</small></div>
        <div><span>고장 누계</span><b class="${fs.count ? 'c-r' : ''}">${(fs.min / 60).toFixed(1)} h · ${fs.count}회</b></div>
        ${ioLink(id) ? `<div class="sdio"><span>데이터 연결 <small>가상 기준정보</small></span><b>${ioBadge(id)} ${esc(ioLink(id).endpoint)}${ioLink(id).unit_id ? ` · Unit ${ioLink(id).unit_id}` : ''}</b><small>포인트 ${ioPoints(id).length}개 · 받은 신호 ${S.sigStat.byEq[id] || 0}건 <button class="lnk" data-act="ioPts">수집 포인트 ›</button></small></div>` : ''}</div></div>
      <h3 class="sdh">① 지난 5일 가동 기록 <small>하루 08:00~16:00를 시간 순으로 · 왼쪽 → 오른쪽</small></h3>
      <div class="tl">${lanes}<span></span><div class="axis">${['08:00', '10:00', '12:00', '14:00', '16:00'].map((t, n) => `<span style="left:${n * 25}%">${t}</span>`).join('')}</div></div>
      <div class="legend tlleg"><span><i class="b"></i>가동</span><span><i class="n"></i>대기</span><span><i class="r"></i>고장</span><span><i class="p"></i>점검</span><span><i class="x"></i>기록 없음(${hm(nowS())} 이후)</span></div>
      <h3 class="sdh">② 이 설비의 사건 <small>${incs.length}건 · 전체 미해결 ${allOpen.length}건</small></h3>
      ${action}
      <h3 class="sdh">③ 할 일</h3>
      <div class="row">${eqBtns}</div>
    </section>
  </div></div>`;
}
const eqSubTabs = () => `<span class="ptabs"><button class="${UI.sub.eq !== 'sig' ? 'on' : ''}" data-act="sub" data-arg="eq:his">상태 변경 이력</button><button class="${UI.sub.eq === 'sig' ? 'on' : ''}" data-act="sub" data-arg="eq:sig">가상 설비 신호${S.signals.length ? ` <small>${S.signals.length}</small>` : ''}</button></span>`;
const SIGNALS = [['COUNT', '생산 카운트'], ['RUN', '가동'], ['STOP', '정지'], ['FAULT', '이상 정지']];
function signalPanel(id) {
  const sig = draft('sigType', 'COUNT'), eq = draft('sigEq', id);
  const rows = S.signals.map(g => `<tr><td>${hm(g.sim_at)}</td><td>${g.equipment_id}</td><td>${(SIGNALS.find(x => x[0] === g.signal) || [, g.signal])[1]}${g.value != null ? ' ' + g.value : ''}</td>
    <td><span class="iob ${g.source === 'MODBUS' ? 'm' : g.source === 'ETOS' ? 'e' : 's'}">${IO_SRC[g.source] || g.source}</span></td><td class="c">${g.ok ? '<span class="badge g">반영</span>' : '<span class="badge r">거부</span>'}</td><td class="clip" title="${esc(g.msg)}">${esc(g.msg)}</td></tr>`).join('');
  return `<section class="panel"><div class="ph">${eqSubTabs()}<span class="sub">IoT 입구 시뮬레이터(출처 SIM) · 현장 연결 시 Modbus·ETOS 신호도 같은 서버 입구(tp_ingest_signal) · R1~R7 규칙 적용</span><button class="lnk" data-act="ioOpen">연결 구조도 ›</button></div>
    <div class="row">${selectBox('sigEq', Object.values(S.equipment).map(e => [e.equipment_id, `${e.equipment_id} ${e.equipment_name} (${STATUS.eq[e.status][0]})`]), eq, 'data-draft')}
      ${selectBox('sigType', SIGNALS, sig, 'data-draft')}
      <input type="number" id="sigVal" data-draft="sigVal" min="1" step="1" style="width:90px" placeholder="수량" value="${esc(draft('sigVal', ''))}" ${sig === 'COUNT' ? '' : 'disabled'}>
      <button class="btn pri" data-act="sendSignal" ${UI.canWrite ? '' : 'disabled title="시연 코드를 입력해야 신호를 보낼 수 있습니다"'}>신호 보내기</button>
      <span class="grow"></span>
      <button class="btn ${UI.simOn ? 'danger' : 'line'}" data-act="simToggle" ${othersPlaying() ? 'disabled title="다른 화면에서 재생 중입니다"' : !UI.canWrite ? 'title="코드가 없으면 내 화면에서만 흐릅니다(저장 안 됨)"' : ''}>${UI.simOn ? '■ 멈춤' : '▶ 가상 시간 진행'}</button>
</div><span class="small">가상 시간 진행 = 1× 기준 10초마다 시연 시각 +5분, 가동 중인 설비가 계획수량의 10%씩 생산 카운트 전송</span>
    <div class="tw"><table><thead><tr><th>시연 시각</th><th>설비</th><th>신호</th><th>출처</th><th class="c">결과</th><th>서버 응답</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="c small">아직 받은 신호가 없습니다.</td></tr>'}</tbody></table></div></section>`;
}

// ---------- 3. 생산 현황 ----------
function blockRows() {
  const f = UI.f.prod;
  return Object.values(S.blocks).filter(b => { const c = currentWo(b.block_id); const st = c ? c.status : 'COMPLETED';
    return (!f.vessel || b.vessel_id === f.vessel) && (!f.proc || (c && c.process_id === f.proc)) && (!f.st || st === f.st) && (!f.q || b.block_id.toLowerCase().includes(f.q.toLowerCase())); });
}
function viewProd() {
  const k = kpis(), f = UI.f.prod, list = blockRows();
  const sel = S.blocks[UI.sel.block] ? UI.sel.block : list[0]?.block_id;
  const card = (dot, l, v, u, extra, cls, scope) => `<div class="panel" style="gap:4px"><span><span class="badge ${dot}" style="background:none;padding:0 6px 0 0"></span>${l}</span>
    <div><b style="font-size:28px">${v}</b> <span class="small">${u}</span> <b class="${cls}" style="margin-left:14px">${extra}</b></div><span class="small">${scope}</span></div>`;
  const b = S.blocks[sel]; const bws = blockWos(sel);
  const cw = currentWo(sel); const binc = S.incidents.filter(i => i.status === 'OPEN' && bws.some(w => w.work_order_id === i.work_order_id));
  const art = window.EQ_ART || {}, pas = processActual(), allB = Object.values(S.blocks);
  const stOf = bb => { const c = currentWo(bb.block_id); return c ? c.status : 'COMPLETED'; };
  const bcnt = st => allB.filter(bb => stOf(bb) === st).length;
  const chip = bb => { const c = currentWo(bb.block_id), st = stOf(bb), late = blockWos(bb.block_id).some(isDelayed), cl = STATUS.wo[st][1];
    return `<button class="bchip ${cl} ${bb.block_id === sel ? 'sel' : ''}" data-act="selBlock" data-arg="${bb.block_id}"><span class="bh"><b>${bb.block_id}</b>${badge('wo', st)}</span>
      <span class="bt"><i style="width:${Math.round((c ? c.progress_ratio : 1) * 100)}%"></i></span><span class="bf">${c ? `진척 ${pct(c.progress_ratio * 100)}` : '이송 완료'}${late ? '<em>지연</em>' : ''}<small>${bb.vessel_id} · ${bb.weight_t}t</small></span></button>`; };
  const cols = Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no).map(pp => { const x = pas.find(q => q.p.process_id === pp.process_id), here = list.filter(bb => currentWo(bb.block_id)?.process_id === pp.process_id);
    return `<div class="bcol"><div class="bcolh"><img src="${art[pp.process_id] || ''}" alt=""><b>${p2(pp.sequence_no)} ${esc(pp.process_name)}</b>
      ${x ? `<div class="pa"><small class="palbl">공정 전체 실적</small><div class="h"><span>${esc(x.p.process_name)}</span><span style="color:${x.pct === 100 ? 'var(--g)' : 'var(--o)'}">${nfmt(x.a)} / ${nfmt(x.pl)} ${x.unit} ${pct(x.pct)}</span></div><div class="track"><em style="width:${x.pct || 0}%;background:${procColor(x.p.process_id)}"></em></div></div>` : ''}</div>
      <div class="bcolb">${here.map(chip).join('') || '<span class="bempty">없음</span>'}</div></div>`; }).join('');
  const done = list.filter(bb => !currentWo(bb.block_id));
  const steps = bws.map(w => { const cur = currentWo(sel) === w;
    return `<div class="jstep ${STATUS.wo[w.status][1]} ${cur ? 'cur' : ''}" data-act="goWo" data-arg="${w.work_order_id}"><i>${w.status === 'COMPLETED' ? '✓' : proc(w.process_id).sequence_no}</i>
      <div><b>${esc(proc(w.process_id).process_name)}</b><small>${md(w.planned_start_at)} · ${w.work_order_id} · ${w.equipment_id}</small></div>
      <span class="jq">${+w.accepted_qty.toFixed(1)} / ${w.planned_qty} ${unit(w.unit)}</span>${badge('wo', w.status)}</div>`; }).join('');
  return `<div class="pg pg-prod">${pageHead('생산 현황', '모니터링', '블록 12개가 6개 공정 중 어디에 있는지 봅니다. 블록은 왼쪽(강재 절단)에서 오른쪽(이송 완료)으로 흐릅니다.')}
  <div class="grid g-4 pgkpi">
    ${card('b', '이송 완료 블록', k.transferred, `/ ${k.blocks}개`, pct(k.transferred / k.blocks * 100), 'c-b', '전체 12블록 중 이송 공정을 마친 블록')}
    ${card('g', '기한 도래 작업 완료', k.dueDone, `/ ${k.dueTotal}건`, k.dueTotal ? pct(k.dueDone / k.dueTotal * 100) : '—', 'c-g', `계획 종료 ≤ ${hm(nowS())} 작업 ${k.dueTotal}건 중 완료`)}
    ${card('b', '납기 준수율', k.transferred ? pct(k.onTime / k.transferred * 100, 0).replace('%', '') : '—', '%', `${k.onTime} / ${k.transferred}블록`, 'c-b', `이송 완료 블록 중 목표 시각 이내`)}
    ${card('r', '검사 합격률', (k.inspPass / k.inspTotal * 100).toFixed(1), '%', `${k.inspPass} / ${k.inspTotal}차수`, 'c-r', '검사 차수 단위 · 재검사 포함')}
  </div>
  <div class="pgbar">${chips('prodSt', [['', '전체', allB.length], ['IN_PROGRESS', '진행', bcnt('IN_PROGRESS'), 'b'], ['BLOCKED', '보류', bcnt('BLOCKED'), 'r'], ['PLANNED', '계획', bcnt('PLANNED'), 'n'], ['COMPLETED', '이송 완료', bcnt('COMPLETED'), 'g']], f.st)}
    <span class="pgsep"></span>${chips('prodVessel', [['', '전체 호선'], ...Object.keys(S.vessels).map(v => [v, v])], f.vessel)}${selectBox('prodProc', procOpts(), f.proc)}
    <input type="text" id="prodQ" data-filter="prodQ" value="${esc(f.q)}" placeholder="블록 번호 찾기"><span class="grow"></span>
    <button class="btn" data-act="resetFilter" data-arg="prod">↻ 초기화</button><button class="btn line" data-act="csv" data-arg="prod">⭳ 엑셀(CSV)</button></div>
  <div class="pgbody">
    <section class="panel pgboard"><div class="ph"><h2>블록 흐름판</h2><span class="sub">${list.length}개 블록 · 블록 카드는 지금 있는 공정 칸에 놓입니다 · 칸 머리 = 그 공정 전체 실적(계획 종료 ≤ ${hm(nowS())} 작업분) · 카드 막대 = 그 블록의 진척</span></div>
      <div class="board">${cols}<div class="bcol done"><div class="bcolh"><span class="bdone">✓</span><b>다 끝난 블록</b><small>이송까지 완료 ${done.length}개</small></div><div class="bcolb">${done.map(chip).join('') || '<span class="bempty">없음</span>'}</div></div></div></section>
    <section class="panel pgside"><div class="ph"><h2>${sel} 블록이 거쳐 온 길</h2>${bws.some(isDelayed) ? '<span class="badge delay">지연</span>' : ''}<span class="sub">${esc(b.block_name)} · ${b.vessel_id} · ${b.weight_t}t · 목표 이송 ${md(b.target_transfer_at)} ${hm(b.target_transfer_at)}</span></div>
      <div class="journey">${steps}</div>
      ${binc.length ? `<div class="alertbox"><b>멈춘 이유</b>${binc.map(i => `<div class="row"><span class="grow">${i.incident_id} ${STATUS.cat[i.category][0]} · ${esc(i.summary)}</span><button class="btn pri" data-act="goInc" data-arg="${i.incident_id}">작업 관리에서 처리 ›</button></div>`).join('')}</div>` : ''}
      <div class="links">${cw ? `<button class="btn line" data-act="goEq" data-arg="${cw.equipment_id}">설비 ${cw.equipment_id} 보기 ›</button><button class="btn line" data-act="goWo" data-arg="${cw.work_order_id}">작업지시 ${cw.work_order_id} 열기 ›</button>` : ''}</div></section>
  </div></div>`;
}

// ---------- 4. 작업 관리 ----------
const ST_ORDER = { BLOCKED: 0, IN_PROGRESS: 1, COMPLETED: 2, PLANNED: 3 };
const nfmt = v => (+(+v).toFixed(1)).toLocaleString('en-US');   // 1,026.5 처럼 천 단위 쉼표
const woNeed = w => w.status === 'BLOCKED' || (w.status !== 'COMPLETED' && isDelayed(w));   // 확인 필요 = 보류이거나 기한이 지났는데 안 끝난 작업
const WO_GRP = [['NEED', '조치 필요', '보류 중이거나 계획보다 늦어진 작업'], ['IN_PROGRESS', '진행', ''], ['PLANNED', '계획', ''], ['COMPLETED', '완료', '']];
const woGrp = w => woNeed(w) ? 'NEED' : w.status;
function woRows() {
  const f = UI.f.wo;
  const inDate = w => f.date === '' ? true : f.date === '16-17' ? /2026-09-1[67]/.test(w.planned_start_at) : w.planned_start_at.startsWith(`2026-09-${f.date}`);
  return woList().filter(w => inDate(w) && (!f.proc || w.process_id === f.proc) && (!f.st || (f.st === 'NEED' ? woNeed(w) : w.status === f.st)) && (!f.q || (w.block_id + w.work_order_id).toLowerCase().includes(f.q.toLowerCase())) && (!f.overdue || isDelayed(w)))
    .sort((a, b) => a.planned_start_at.localeCompare(b.planned_start_at) || ST_ORDER[a.status] - ST_ORDER[b.status] || b.work_order_id.localeCompare(a.work_order_id));
}
function viewWo() {
  const f = UI.f.wo;
  const tabs = `<div class="subtabs"><button class="${UI.sub.wo === 'list' ? 'on' : ''}" data-act="sub" data-arg="wo:list">작업 지시<small>${woList().length}</small></button><button class="${UI.sub.wo === 'his' ? 'on' : ''}" data-act="sub" data-arg="wo:his">작업 이력<small>${S.history.length}</small></button></div>`;
  if (UI.sub.wo === 'his') return `<div class="pg pg-wo">${pageHead('작업 관리', '관리', '작업지시마다 언제 무엇이 바뀌었는지 기록입니다.')}${tabs}${viewHistory()}</div>`;
  const list = woRows(), w = S.wo[UI.sel.wo] || list.find(woNeed) || list[0];
  const inRange = woList().filter(x => f.date === '' ? true : f.date === '16-17' ? /2026-09-1[67]/.test(x.planned_start_at) : x.planned_start_at.startsWith(`2026-09-${f.date}`));
  const row = x => { const e = eqOf(x.equipment_id), warn = x.status === 'PLANNED' && e.status === 'FAULT', last = histText(lastHistory(x.work_order_id));
    return `<tr data-act="selWo" data-arg="${x.work_order_id}" class="${w && x.work_order_id === w.work_order_id ? 'sel' : ''}">
      <td><b>${x.block_id} · ${esc(proc(x.process_id).process_name)}</b><div class="small">${x.work_order_id}</div></td><td>${esc(e.equipment_name)} ${badge('eq', e.status)}</td>
      <td>${md(x.planned_start_at)}<div class="small">${hm(x.planned_start_at)}~${hm(x.planned_end_at)}</div></td><td class="c">${badge('wo', x.status)} ${delayBadge(x).replace(/^-$/, '')}</td>
      <td>${bar(x.progress_ratio, x.status === 'BLOCKED' ? 'r' : x.status === 'COMPLETED' ? 'g' : 'b', 60)}</td>
      <td><div class="ell" title="${warn ? '지정 설비 고장 — 확인 필요' : esc(last)}">${warn ? '<span class="warn-t">⚠ 지정 설비 고장 — 확인 필요</span>' : `<span class="small">${esc(last)}</span>`}</div></td></tr>`; };
  const body = WO_GRP.map(([g, l, d]) => { const rs = list.filter(x => woGrp(x) === g); return rs.length ? `<tr class="grp ${g === 'NEED' ? 'need' : ''}"><td colspan="6">${l} <b>${rs.length}</b>${d ? `<span>${d}</span>` : ''}</td></tr>${rs.map(row).join('')}` : ''; }).join('');
  return `<div class="pg pg-wo">${pageHead('작업 관리', '관리', '작업지시를 조치가 필요한 것부터 보고, 골라서 상태·수량을 바꿉니다. 저장하면 관제·설비·생산 화면에 같이 반영됩니다.')}${tabs}
  <div class="pgbar">${chips('woSt', [['', '전체', inRange.length], ['NEED', '조치 필요', inRange.filter(woNeed).length, 'r'], ['IN_PROGRESS', '진행', inRange.filter(x => x.status === 'IN_PROGRESS').length, 'b'], ['PLANNED', '계획', inRange.filter(x => x.status === 'PLANNED').length, 'n'], ['COMPLETED', '완료', inRange.filter(x => x.status === 'COMPLETED').length, 'g']], f.st)}
    <span class="pgsep"></span>${selectBox('woDate', [['16-17', '계획일 09/16 ~ 09/17'], ['16', '계획일 09/16'], ['17', '계획일 09/17'], ['', '전체 기간']], f.date)}${selectBox('woProc', procOpts(), f.proc)}
    <input type="text" id="woQ" data-filter="woQ" value="${esc(f.q)}" placeholder="블록·작업지시 번호 찾기"><span class="grow"></span>
    <button class="btn" data-act="resetFilter" data-arg="wo">↻ 초기화</button><button class="btn line" data-act="impToggle">⭱ 실적 가져오기</button><button class="btn line" data-act="csv" data-arg="wo">⭳ 엑셀(CSV)</button></div>
  ${UI.imp ? importPanel() : ''}
  <div class="pgbody">
    <section class="panel pglist"><div class="ph"><h2>작업지시 ${list.length}건</h2><span class="sub">조치 필요 → 진행 → 계획 → 완료 순 · 줄을 누르면 오른쪽에서 편집</span></div>
      <div class="tw"><table><thead><tr><th>블록 · 공정 / 작업지시</th><th>설비</th><th>계획</th><th class="c">상태</th><th>진행률</th><th>최근 이력</th></tr></thead><tbody>${body || '<tr><td colspan="6" class="c small">조건에 맞는 작업지시가 없습니다.</td></tr>'}</tbody></table></div></section>
    ${w ? woEditor(w) : '<section class="panel"><div class="empty">작업지시를 선택하세요.</div></section>'}
  </div></div>`;
}
// ---------- 실적 가져오기(엑셀/CSV) ----------
// 파일의 각 행 = 작업지시 + 누적 인정수량. 화면은 미리 확인만 하고, 반영 여부는 서버 규칙(R6)이 한 트랜잭션으로 판단한다.
function importCheck(r) {
  const w = S.wo[r.wo];
  if (!w) return ['err', '없는 작업지시'];
  if (!/^\s*\d+(\.\d+)?\s*$/.test(r.qty)) return ['err', '수량이 숫자가 아님'];
  const q = Number(r.qty);
  if (w.status !== 'IN_PROGRESS') return ['warn', `${STATUS.wo[w.status][0]} 상태 → 서버 거부 예상`];
  if (q > w.planned_qty) return ['warn', '계획수량 초과 → 서버 거부 예상'];
  if (q < w.accepted_qty) return ['warn', '현재보다 감소 → 서버 거부 예상'];
  return ['ok', q === w.planned_qty ? '반영 시 완료 처리' : `+${+(q - w.accepted_qty).toFixed(1)} ${unit(w.unit)}`];
}
function importPanel() {
  const rows = UI.imp.rows || [];
  const chk = rows.map(importCheck), errs = chk.filter(c => c[0] === 'err').length;
  const body = rows.map((r, n) => { const w = S.wo[r.wo], [k, m] = chk[n];
    return `<tr><td class="c">${n + 1}</td><td>${esc(r.wo)}</td><td class="num">${esc(r.qty)}</td><td class="num">${w ? `${w.accepted_qty} / ${w.planned_qty} ${unit(w.unit)}` : '-'}</td><td class="c">${w ? badge('wo', w.status) : '-'}</td>
      <td><span class="badge ${k === 'ok' ? 'g' : k === 'warn' ? 'o' : 'r'}">${k === 'ok' ? '정상' : k === 'warn' ? '주의' : '오류'}</span> <span class="small">${esc(m)}</span></td></tr>`; }).join('');
  return `<section class="panel"><div class="ph"><h2>실적 가져오기</h2><span class="sub">엑셀(.xlsx)·CSV · 열: 작업지시, 인정수량(누적) · MES 등 외부 시스템 내보내기 파일도 같은 경로로 들어옵니다</span><button class="btn" data-act="impToggle">닫기</button></div>
    <div class="row"><input type="file" id="impFile" accept=".csv,.xlsx,.xls"><button class="btn line" data-act="impTemplate">⭳ 양식 내려받기(진행 중 작업)</button>
      <span class="grow"></span><span class="small">${UI.imp.name ? esc(UI.imp.name) + ' · ' : ''}${rows.length}행${errs ? ` · 오류 ${errs}행` : ''}</span>
      <button class="btn pri" data-act="impSend" ${!rows.length || errs || !UI.canWrite ? `disabled title="${!UI.canWrite ? '시연 코드가 필요합니다' : errs ? '오류 행을 고친 뒤 다시 올리세요' : '파일을 먼저 고르세요'}"` : ''}>서버에 반영 (${rows.length}행)</button></div>
    ${rows.length ? `<div class="tw"><table><thead><tr><th class="c">행</th><th>작업지시</th><th class="num">가져올 인정수량</th><th class="num">현재 / 계획</th><th class="c">작업 상태</th><th>사전 확인</th></tr></thead><tbody>${body}</tbody></table></div>
      <span class="small">한 행이라도 서버 규칙에 걸리면 전체를 취소합니다(반영 0건). '주의' 행은 서버가 거부하는 모습을 보여 줄 때 그대로 두세요.</span>` : '<div class="empty">파일을 고르면 여기에서 미리 확인합니다.</div>'}</section>`;
}
function parseCsv(text) {
  const out = []; let row = [], cur = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c; }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(v => v.trim() !== ''));
}
function importRows(table) {
  const h = (table[0] || []).map(x => x.trim().toLowerCase());
  const iw = h.findIndex(x => /작업지시|work_order/.test(x)), iq = h.findIndex(x => /인정수량|accepted_qty/.test(x));
  if (iw < 0 || iq < 0) throw new Error('첫 줄에 "작업지시"와 "인정수량" 열이 있어야 합니다.');
  return table.slice(1).map(r => ({ wo: (r[iw] || '').trim(), qty: (r[iq] || '').trim() }));
}
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, ng) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => ng(new Error('엑셀 읽기 도구를 불러오지 못했습니다. CSV로 저장해 올려 주세요.')); document.head.appendChild(s); });
}
async function readImportFile(f) {
  try {
    let table;
    if (/\.xlsx?$/i.test(f.name)) { await loadXlsxLib(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); table = parseCsv(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])); }
    else table = parseCsv(await f.text());
    const rows = importRows(table); if (rows.length > 200) throw new Error('한 번에 200행까지 가져올 수 있습니다.');
    UI.imp = { name: f.name, rows }; toast(`${rows.length}행을 읽었습니다. 사전 확인 후 [서버에 반영]을 누르세요.`);
  } catch (e) { UI.imp = { rows: [] }; toast('파일을 읽지 못했습니다: ' + (e.message || e), true); }
  render();
}
function woEditor(w) {
  const id = w.work_order_id, p = proc(w.process_id);
  const eqOptions = Object.values(S.equipment).filter(e => e.process_id === w.process_id).map(e => [e.equipment_id, `${e.equipment_name} (${e.equipment_id}) · ${STATUS.eq[e.status][0]}`]);
  const st = draft('woStatus', w.status);
  const holdOpts = [['', '— 사유 선택 —'], ...openIncidents().filter(i => i.work_order_id === id || incEquipment(i) === w.equipment_id).map(i => [i.incident_id, `${i.incident_id} · ${i.summary}`])];
  const h = w.hold_incident && incById(w.hold_incident);
  const lockInc = S.incidents.find(i => i.status === 'OPEN' && (i.incident_id === w.hold_incident || i.work_order_id === id));   // 미해결 사건이 걸린 작업은 설비 칸 잠금
  const his = woHistory(id).slice().reverse().slice(0, 6).map(x => `<tr><td>${md(x.event_at)} ${hm(x.event_at)}</td><td>${esc(STATUS.his[x.event_type] || x.event_type)}</td><td>${esc(x.note || '')}${x.incident_id ? ' · ' + x.incident_id : ''}</td></tr>`).join('');
  return `<section class="panel pgside woed"><div class="ph"><h2>${w.block_id} · ${esc(p.process_name)}</h2>${badge('wo', w.status)}${isDelayed(w) ? '<span class="badge delay">지연</span>' : ''}<span class="sub">${id}</span></div>
    <h3 class="sdh">① 지금 상태</h3>
    <div class="sdfacts wofacts"><div><span>블록</span><b>${w.block_id}</b><small>${esc(S.blocks[w.block_id].block_name)}</small></div><div><span>공정</span><b>${w.process_id.slice(1)} ${esc(p.process_name)}</b></div>
      <div><span>계획 기간</span><b>${md(w.planned_start_at)} ${hm(w.planned_start_at)}~${hm(w.planned_end_at)}</b></div><div><span>진행</span><b>${+w.accepted_qty.toFixed(1)} / ${w.planned_qty} ${unit(w.unit)}</b><small>${pct(w.progress_ratio * 100)}</small></div>
      ${h ? `<div class="wide"><span>멈춘 이유</span><b class="c-r">${h.incident_id} · ${esc(h.summary)} (${STATUS.inc[h.status][0]})</b></div>` : ''}</div>
    ${lockInc ? `<div class="wolock"><b>${STATUS.cat[lockInc.category][0]} 사건 ${lockInc.incident_id} 미해결 → 이 작업을 '진행'으로 바꿀 수 없습니다.</b><span>작업 관리 우선순위에서 사건을 먼저 처리(${lockInc.category === 'EQUIPMENT' ? '설비 복구 또는 대체 설비 승인' : '조치 기록 → 해소'})하세요. 여기서 바로 바꾸면 서버가 거부합니다.</span><button class="btn pri" data-act="goInc" data-arg="${lockInc.incident_id}">${lockInc.incident_id} 사건 처리하기 ›</button></div>` : ''}
    <h3 class="sdh">② 바꿀 것</h3>
    <div class="form">
      <div class="frow"><span class="req">설비</span><div>${lockInc ? `<input readonly value="${esc(eqName(w.equipment_id))}" style="width:auto;flex:1"><span class="small">🔒 ${lockInc.incident_id} 미해결 중 · 설비 변경은 별도 승인 필요</span><button class="btn line" data-act="goInc" data-arg="${lockInc.incident_id}">우선순위에서 처리 ›</button>`
        : `${selectBox('woEq', eqOptions, draft('woEq', w.equipment_id), 'data-draft')}<span class="small">같은 공정 설비만 · 고장·점검 설비는 서버가 거부</span>`}</div></div>
      <div class="frow"><span class="req">작업 상태</span><div><div class="seg">${['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'].map(s => `<button class="${st === s ? 'on' : ''}" data-act="woStatus" data-arg="${s}">${STATUS.wo[s][0]}</button>`).join('')}</div></div></div>
      <div class="frow"><span>인정수량</span><div><input type="number" id="woQty" data-draft="woQty" min="0" max="${w.planned_qty}" step="any" value="${esc(draft('woQty', w.accepted_qty))}" style="width:120px"><span class="small">/ ${w.planned_qty} ${unit(w.unit)} · 진행률 ${pct(w.progress_ratio * 100)}</span></div></div>
      <div class="frow"><span>보류 사유</span><div>${st === 'BLOCKED' && w.status !== 'BLOCKED' ? selectBox('woHold', holdOpts, draft('woHold', ''), 'data-draft') : `<input readonly value="${h ? `${h.incident_id} · ${esc(h.summary)} (${STATUS.inc[h.status][0]})` : '-'}">`}</div></div>
      <div class="frow"><span>메모</span><div><input type="text" id="woMemo" data-draft="woMemo" value="${esc(draft('woMemo', w.memo || ''))}" placeholder="메모(보류 사유를 직접 적을 때도 사용)"></div></div>
    </div>
    <h3 class="sdh">③ 저장</h3>
    <div class="row"><span class="grow small">저장하면 서버가 규칙 검사(설비 고장·미해결 사건·선행 작업·수량 범위) → 이력 기록 → 관제·설비·생산 화면 반영을 한 번에 합니다. 하나라도 걸리면 전부 취소됩니다.</span><button class="btn" data-act="woCancel">취소</button><button class="btn pri" data-act="woSave" data-arg="${id}">저장</button></div>
    <h3 class="sdh wohis">이 작업의 이력</h3>
    <div class="tw wohis"><table><thead><tr><th>시각</th><th>구분</th><th>내용</th></tr></thead><tbody>${his || '<tr><td colspan="3" class="small c">이력 없음</td></tr>'}</tbody></table></div>
  </section>`;
}
function viewHistory() {
  const q = (UI.draft.hisQ || '').toLowerCase();
  const list = S.history.slice().reverse().filter(h => !q || (h.work_order_id + (h.incident_id || '') + (h.note || '')).toLowerCase().includes(q));
  const per = 15, pages = Math.max(1, Math.ceil(list.length / per)); UI.page.his = Math.min(UI.page.his, pages);
  const rows = list.slice((UI.page.his - 1) * per, UI.page.his * per).map(h => `<tr data-act="goWo" data-arg="${h.work_order_id}"><td>${h.history_id}</td><td>${md(h.event_at)} ${hm(h.event_at)}</td><td>${h.work_order_id}</td>
    <td>${esc(STATUS.his[h.event_type] || h.event_type)}</td><td>${h.incident_id || '-'}</td><td>${esc(h.note || '')}</td><td>${h.source === 'demo' ? '<span class="badge b">시연</span>' : '<span class="badge n">엑셀</span>'}</td></tr>`).join('');
  return `<div class="search"><div class="field"><span class="lb">검색</span><div class="in"><input type="text" id="hisQ" data-draft="hisQ" value="${esc(UI.draft.hisQ || '')}" placeholder="작업지시·사건·내용"></div></div><button class="btn pri" data-act="noop">검색</button></div>
  <section class="panel"><div class="ph"><h2>작업 이력</h2><span class="sub">총 ${list.length}건 · 최근 순 · 출처: 엑셀 원본 / 시연 중 서버 기록</span><button class="btn line" data-act="csv" data-arg="his">⭳ 엑셀(CSV)</button></div>
    <div class="tw"><table><thead><tr><th>이력 ID</th><th>시각</th><th>작업지시</th><th>구분</th><th>사건</th><th>내용</th><th>출처</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pager">${Array.from({ length: pages }, (_, n) => `<button class="${UI.page.his === n + 1 ? 'on' : ''}" data-act="page" data-arg="his:${n + 1}">${n + 1}</button>`).join('')}</div></section>`;
}

// ---------- 5. 기준정보 ----------
// 설비 탭: 설비 붙이기(추가) · 없애기(사용 중지 / 기록 없는 추가 설비만 삭제). 서버 규칙은 23_equipment_admin.sql
const EQ_ROUTE = [['MODBUS', 'Modbus TCP · 개별 장비(PLC) 직결'], ['ETOS', 'ETOS 통신 서버 · 집약 라우팅 장비 경유'], ['INPUT', '시스템 입력만 · 센서 없음']];
const eqIsBase = id => !S.eqBase || S.eqBase.has(id);
function eqNextNo() { return Math.max(0, ...Object.keys(S.eqAll || S.equipment).map(k => +(/^EQ(\d+)$/.exec(k) || [])[1] || 0)) + 1; }
function eqForm() {
  const n = eqNextNo(), pid = draft('eqfProc', 'P03'), rt = draft('eqfRoute', 'MODBUS'), procs = Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no);
  const conn = rt === 'MODBUS' ? `<label><span>장비 IP</span><input type="text" id="eqfIp" data-draft="eqfIp" value="${esc(draft('eqfIp', `192.168.10.${10 + n}`))}" style="width:140px"></label>
      <label><span>Unit</span><input type="number" id="eqfUnit" data-draft="eqfUnit" min="1" max="247" value="${esc(draft('eqfUnit', 1))}" style="width:70px"></label><em>포트 502 · Coil 00001 가동 / HR 40001 수량 / DI 10001 이상</em>`
    : rt === 'ETOS' ? `<label><span>%MW 시작</span><input type="number" id="eqfMw" data-draft="eqfMw" min="0" max="9997" value="${esc(draft('eqfMw', n * 100))}" style="width:100px"></label><em>ETOS-100XP 192.168.20.10:2004 · %MW 3개(가동 · 누적 수량 · 이상)</em>`
    : '<em>센서 연결 없이 작업자가 화면에서 실적 · 상태를 입력합니다(수집 포인트 없음)</em>';
  return `<section class="panel eqform"><div class="ph"><h2>설비 추가 <small>새 번호 EQ${String(n).padStart(2, '0')}</small></h2><span class="sub">대기 상태로 시작 · 대체 적합성은 「확인 필요」로 시작 · IP · 주소는 가상 기준정보</span><span class="grow"></span><button class="btn" data-act="eqFormTog">닫기</button></div>
    <div class="eqfrow"><label><span>설비 이름</span><input type="text" id="eqfName" data-draft="eqfName" maxlength="30" value="${esc(draft('eqfName', ''))}" placeholder="예: 예비 용접기 2호"></label>
      <label><span>공정</span>${selectBox('eqfProc', procs.map(p => [p.process_id, `${p.process_id} ${p.process_name}`]), pid, 'data-draft')}</label>
      <label><span>작업구역</span>${selectBox('eqfZone', Object.values(S.zones).map(z => [z.zone_id, `${z.zone_id} ${z.zone_name}`]), draft('eqfZone', proc(pid).zone_id), 'data-draft')}</label>
      <label><span>자원 종류</span>${selectBox('eqfKind', [['설비', '설비'], ['검사자원', '검사자원']], draft('eqfKind', pid === 'P04' ? '검사자원' : '설비'), 'data-draft')}</label></div>
    <div class="eqfrow"><label><span>데이터 연결</span>${selectBox('eqfRoute', EQ_ROUTE, rt, 'data-draft')}</label>${conn}<span class="grow"></span>
      <button class="btn pri" data-act="eqAdd" ${UI.canWrite ? '' : 'disabled title="조작 권한(시연 코드)이 필요합니다"'}>추가</button></div></section>`;
}
function viewBaseEq(tabs) {
  const fitTxt = e => { const f = (S.fitAll || S.fit).find(x => x.equipment_id === e.equipment_id); return f ? `${f.note} · WPS ${f.wps_state === 'OK' ? '적합' : '확인'} · 출력 ${f.power_state === 'OK' ? '적합' : '확인'} · 자격 ${f.cert_state === 'OK' ? '적합' : '확인'} · 위치 ${f.loc_state === 'OK' ? '적합' : f.loc_state === 'COND' ? (f.move_min ? `조건부(이동 ${f.move_min}분)` : '확인') : '부적합'}` : '-'; };
  const all = Object.values(S.eqAll || S.equipment), off = all.filter(e => e.active === false), ready = S.eqAdminReady, dis = UI.canWrite ? '' : 'disabled title="조작 권한(시연 코드)이 필요합니다"';
  const conn = e => { const p = (S.ioAll || S.io).find(x => x.equipment_id === e.equipment_id); return p ? `<span class="iob ${IO_ROUTE[p.route][2]}">${p.route === 'MODBUS' ? 'Modbus' : 'ETOS'}</span>` : '<span class="iob s">시스템 입력</span>'; };
  const btns = e => !ready ? '' : `${e.active === false ? `<button class="btn line sm" data-act="eqActive" data-arg="${e.equipment_id}:1" ${dis}>사용</button>` : `<button class="btn sm" data-act="eqActive" data-arg="${e.equipment_id}:0" ${dis}>사용 중지</button>`}${eqIsBase(e.equipment_id) ? '' : `<button class="btn sm ${UI.eqDelArm === e.equipment_id ? 'danger' : 'line'}" data-act="eqDel" data-arg="${e.equipment_id}" ${dis}>${UI.eqDelArm === e.equipment_id ? '한 번 더 누르면 삭제' : '삭제'}</button>`}`;
  const rows = all.map(e => `<tr class="${e.active === false ? 'eqoff' : ''}" ${e.active === false ? '' : `data-act="goEq" data-arg="${e.equipment_id}"`}><td>${e.equipment_id}${eqIsBase(e.equipment_id) ? '' : ' <span class="badge b">추가</span>'}</td><td>${esc(e.equipment_name)}</td><td>${e.process_id} ${esc(proc(e.process_id).process_name)}</td><td>${e.zone_id} ${esc(S.zones[e.zone_id].zone_name)}</td><td>${esc(e.resource_kind)}</td><td>${conn(e)}</td><td class="clip" title="${esc(fitTxt(e))}">${esc(fitTxt(e))}</td><td class="c">${e.active === false ? '<span class="badge n">사용 중지</span>' : badge('eq', e.status)}</td>${ready ? `<td class="eqbtns">${btns(e)}</td>` : ''}</tr>`).join('');
  const head = ready ? `<button class="btn pri" data-act="eqFormTog">${UI.eqForm ? '추가 닫기' : '+ 설비 추가'}</button>${adminRow()}` : `<span class="badge n rdonly">🔒 조회 전용</span>${adminRow()}`;
  return `<div class="pg pg-base">${pageHead('기준정보', '관리', `설비 ${all.length - off.length}대의 기준값입니다. [+ 설비 추가]로 붙이고 [사용 중지]로 뺍니다. 작업 · 사건 기록이 있는 설비는 지우지 않고 사용 중지합니다(이력은 그대로).`, head)}${tabs}
    ${ready && UI.eqForm ? eqForm() : ''}
    <section class="panel pglist"><div class="ph"><h2>설비 목록</h2><span class="sub">엑셀 equipment 시트 ${S.eqBase ? S.eqBase.size : 8}대${all.length - (S.eqBase ? S.eqBase.size : 8) > 0 ? ` + 시연 중 추가 ${all.length - (S.eqBase ? S.eqBase.size : 8)}대` : ''}${off.length ? ` · 사용 중지 ${off.length}대(화면 5개 · 대체 후보 · 신호 입구에서 제외)` : ''} · 대체 적합성은 가상 기준정보${ready ? '' : ' · 서버에 설비 관리 확장(supabase_equipment.sql) 적용 전이라 읽기 전용'}</span><button class="btn line" data-act="csv" data-arg="baseEq">⭳ 엑셀(CSV)</button></div>
      <div class="tw"><table><thead><tr><th>설비코드</th><th>설비명</th><th>공정</th><th>작업구역</th><th>자원</th><th>데이터 연결</th><th>대체 적합성</th><th class="c">상태</th>${ready ? '<th>관리</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
      ${ready ? '<div class="small eqnote">사용 중지 거부: 진행 중 · 남은 작업이 배정된 설비, 미해결 사건 · 가동 · 고장 중인 설비 · 삭제는 시연 중 추가했고 기록이 없는 설비만 · [데이터 초기화]를 누르면 원본 8대로 돌아갑니다 · 운영 추이(1분 = 1일)는 원본 8대 기준 · 3D 조선소는 모델이 고정이라 추가 설비를 그리지 않습니다</div>' : ''}</section></div>`;
}
function viewBase() {
  const tabs = baseTabs();
  const procs = Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no);
  if (UI.sub.base === 'eq') return viewBaseEq(tabs);
  const sel = S.processes[UI.sel.proc] || procs[0];
  const linked = Object.values(S.equipment).filter(e => e.process_id === sel.process_id);
  const rows = procs.map(p => `<tr data-act="selProc" data-arg="${p.process_id}" class="${p.process_id === sel.process_id ? 'sel' : ''}"><td class="c">${p.sequence_no}</td><td>${p.process_id}</td><td>${esc(p.process_name)}</td><td>${p.zone_id} ${esc(S.zones[p.zone_id].zone_name)}</td>
    <td class="c">${unit(p.unit)}</td><td class="c">${p.standard_hours} h</td><td class="c">${Object.values(S.equipment).filter(e => e.process_id === p.process_id).length}대</td><td class="c"><span class="toggle" title="사용"></span></td><td><span class="sw" style="background:${procColor(p.process_id)}"></span><span class="small">고정</span></td></tr>`).join('');
  const art = window.EQ_ART || {};
  const flow = procs.map((p, n) => { const eqs = Object.values(S.equipment).filter(e => e.process_id === p.process_id);
    return `${n ? '<span class="pfarr">→</span>' : ''}<button class="pfc ${p.process_id === sel.process_id ? 'sel' : ''}" data-act="selProc" data-arg="${p.process_id}" style="--pc:${procColor(p.process_id)}">
      <span class="pfn">${p2(p.sequence_no)}</span><img src="${art[p.process_id] || ''}" alt=""><b>${esc(p.process_name)}</b><small>${p.zone_id} ${esc(S.zones[p.zone_id].zone_name)}</small>
      <span class="pfm"><em>단위 ${unit(p.unit)}</em><em>설비 ${eqs.length}대</em></span></button>`; }).join('');
  const woCount = woList().filter(w => w.process_id === sel.process_id).length;
  return `<div class="pg pg-base">${pageHead('기준정보', '관리', '블록이 거치는 6개 공정과 공정마다 쓰는 설비의 기준값입니다. 공정을 누르면 오른쪽에 그 공정의 기준과 설비가 나옵니다.', `<span class="badge n rdonly">🔒 조회 전용</span>${adminRow()}`)}${tabs}
  <section class="panel pgflow"><div class="ph"><h2>공정 흐름</h2><span class="sub">블록은 01 → 06 순서로 흐릅니다 · 관제 지도·3D 조선소와 같은 순서와 그림</span></div><div class="pflow">${flow}</div></section>
  <div class="pgbody">
    <section class="panel pglist"><div class="ph"><h2>공정 목록</h2><span class="sub">총 ${procs.length}건 · 시연 중 읽기 전용 · 기준 경과시간 4h는 제공 데이터의 단순화 값</span><button class="btn line" data-act="csv" data-arg="baseProc">⭳ 엑셀(CSV)</button></div>
      <div class="tw"><table><thead><tr><th class="c">순서</th><th>공정 코드</th><th>공정명</th><th>작업구역</th><th class="c">단위</th><th class="c">기준 경과시간</th><th class="c">연결 설비</th><th class="c">사용</th><th>공정 색</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="panel pgside"><div class="ph"><h2>${p2(sel.sequence_no)} ${esc(sel.process_name)}</h2><span class="sub">${sel.process_id} · 시연 중 읽기 전용</span></div>
      <h3 class="sdh">① 공정 기준</h3>
      <div class="sdfacts wofacts"><div><span>공정 코드 · 순서</span><b>${sel.process_id} · ${sel.sequence_no}번째</b></div><div><span>작업구역</span><b>${sel.zone_id} ${esc(S.zones[sel.zone_id].zone_name)}</b></div>
        <div><span>실적 단위</span><b>${unit(sel.unit)}</b></div><div><span>기준 경과시간</span><b>${sel.standard_hours} h</b></div></div>
      <h3 class="sdh">② 이 공정의 설비 <small>${linked.length}대 · 누르면 설비 상태 화면</small></h3>
      <div class="lkeq">${linked.map(e => `<button class="lke" data-act="goEq" data-arg="${e.equipment_id}"><img src="${eqArtOf(e)}" alt=""><span><b>${e.equipment_id} ${esc(e.equipment_name)}</b><small>${esc(e.capacity_note)}</small></span>${badge('eq', e.status)}</button>`).join('')}</div>
      <h3 class="sdh">③ 바꿀 수 있나요?</h3>
      <div class="alertbox" style="background:var(--o-bg);border-color:#F2C677"><b class="c-o" style="font-size:13px">삭제·사용 중지 불가</b><span style="font-size:12px">연결 설비 ${linked.length}대와 작업지시 ${woCount}건이 있어 삭제·사용 중지할 수 없습니다. 순서 변경은 해커톤 이후 지원합니다.</span></div>
      <div class="note"><b>시연 중 공정 기준은 읽기 전용입니다</b>공정 값은 관제 판단의 기준이라 시연 중에는 바꾸지 않습니다. 설비는 [설비] 탭에서 추가 · 사용 중지할 수 있습니다.</div>
    </section>
  </div></div>`;
}
const baseTabs = () => `<div class="subtabs"><button class="${UI.sub.base === 'proc' ? 'on' : ''}" data-act="sub" data-arg="base:proc">공정<small>${Object.keys(S.processes).length}</small></button><button class="${UI.sub.base === 'eq' ? 'on' : ''}" data-act="sub" data-arg="base:eq">설비<small>${Object.keys(S.equipment).length}</small></button><button class="${UI.sub.base === 'io' ? 'on' : ''}" data-act="sub" data-arg="base:io">수집 포인트<small>${S.io.length}</small></button></div>`;
const VIEW_RENDER = { dash: viewDash, eq: viewEq, prod: viewProd, wo: viewWo, base: viewBase };

function adminRow() {
  return `<div class="admin"><b>관리</b><span class="small">공용 데이터를 09/16 12:00 엑셀 원본으로 되돌립니다(조작 권한 필요 · 두 번 눌러 확인).</span><span class="grow"></span>
    <button class="btn ${UI.resetArm ? 'danger' : ''}" data-act="reset" ${UI.canWrite ? '' : 'disabled title="조작 권한(시연 코드)이 필요합니다"'}>${UI.resetArm ? '한 번 더 누르면 초기화' : '데이터 초기화'}</button></div>`;
}
// ---------- CSV ----------
function csvData(kind) {
  if (kind === 'eq') return [['설비코드', '설비명', '공정', '자원', '상태', '점유율(%)', '연관 작업'], ...eqRows().map(e => [e.equipment_id, e.equipment_name, proc(e.process_id).process_name, e.resource_kind, STATUS.eq[e.status][0], occupancy(e.equipment_id).pct.toFixed(1), e.work_order_id || ''])];
  if (kind === 'prod') return [['블록', '블록명', '호선', '중량(t)', '현재 공정', '작업 상태', '진척(%)', '목표 이송', '지연'], ...blockRows().map(b => { const c = currentWo(b.block_id); return [b.block_id, b.block_name, b.vessel_id, b.weight_t, c ? proc(c.process_id).process_name : '이송 완료', STATUS.wo[c ? c.status : 'COMPLETED'][0], ((c ? c.progress_ratio : 1) * 100).toFixed(1), b.target_transfer_at, blockWos(b.block_id).some(isDelayed) ? '지연' : '']; })];
  if (kind === 'wo') return [['작업지시', '블록', '공정', '설비', '계획 시작', '계획 종료', '작업 상태', '인정수량', '계획수량', '단위', '진행률(%)', '지연'], ...woRows().map(w => [w.work_order_id, w.block_id, proc(w.process_id).process_name, w.equipment_id, w.planned_start_at, w.planned_end_at, STATUS.wo[w.status][0], w.accepted_qty, w.planned_qty, unit(w.unit), (w.progress_ratio * 100).toFixed(1), isDelayed(w) ? '지연' : ''])];
  if (kind === 'his') return [['이력 ID', '시각', '작업지시', '구분', '사건', '내용', '출처'], ...S.history.slice().reverse().map(h => [h.history_id, h.event_at, h.work_order_id, STATUS.his[h.event_type] || h.event_type, h.incident_id || '', h.note || '', h.source === 'demo' ? '시연' : '엑셀'])];
  if (kind === 'baseIo') return [['포인트', '설비', '경로', '접속 주소', 'Unit', '주소·태그', '형식', '만드는 신호', '변환 규칙'], ...S.io.map(p => [p.point_id, p.equipment_id, p.route, p.endpoint, p.unit_id ?? '', p.address, p.data_type, p.signal, p.rule])];
  if (kind === 'baseProc') return [['순서', '공정 코드', '공정명', '작업구역', '단위', '기준 경과시간'], ...Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no).map(p => [p.sequence_no, p.process_id, p.process_name, p.zone_id, unit(p.unit), p.standard_hours])];
  return [['설비코드', '설비명', '공정', '작업구역', '자원', '비고', '상태'], ...Object.values(S.eqAll || S.equipment).map(e => [e.equipment_id, e.equipment_name, e.process_id, e.zone_id, e.resource_kind, e.capacity_note, e.active === false ? '사용 중지' : STATUS.eq[e.status][0]])];
}
const CSV_NAME = { eq: '설비목록', prod: '블록별진행', wo: '작업지시', his: '작업이력', baseProc: '공정', baseEq: '설비', baseIo: '수집포인트' };
function exportCsv(kind) {
  const data = csvData(kind);
  const csv = '﻿' + data.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const tsv = data.map(r => r.map(v => String(v ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n');
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `TWINPRO_${CSV_NAME[kind]}_${hm(nowS()).replace(':', '')}.csv`; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { /* 다운로드가 막힌 환경 */ }
  navigator.clipboard?.writeText(tsv).then(() => toast(`${data.length - 1}행을 CSV로 저장하고 클립보드에도 복사했습니다(엑셀에 붙여넣기 가능).`), () => toast(`${data.length - 1}행 CSV 파일을 만들었습니다.`));
  return data;
}

// ---------- 동작 ----------
let toastTimer;
function toast(msg, ng) { let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = 'toast' + (ng ? ' ng' : ''); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5200); }
async function call(fn, args, after) {
  if (UI.busy) return; UI.busy = true; UI.selfAt = Date.now(); document.body.style.cursor = 'progress';
  try { const r = await API.rpc(fn, args); toast(r.msg || (r.ok ? '완료' : '실패'), !r.ok);
    if (!r.ok && /시연 코드/.test(r.msg)) { UI.canWrite = false; UI.codeOpen = true; }
    if (r.ok && after) after(); await reload(); return r; }
  catch (e) { toast('서버 호출 실패: ' + (e.message || e), true); }
  finally { UI.busy = false; document.body.style.cursor = ''; render(); }
}
function render() {
  if (UI.ptrDown) { UI.renderPending = true; return; }   // 누르는 중에 화면을 다시 그리면 클릭이 사라지므로, 손을 뗀 뒤 그린다
  const app = document.getElementById('app'); const sx = window.scrollX, sy = window.scrollY;
  const focus = document.activeElement && document.activeElement.id;
  if (isMob() && !mobOk()) { if (SIM.on) simStop(true); UI.view = 'dash'; UI.menuOpen = false; try { history.replaceState(null, '', '#dash'); } catch (e) { /* file:// 등 */ } }   // 휴대폰에서 없는 화면으로 가려 하면(사건 선택 등) 관제에 머문다
  app.innerHTML = UI.view === '3d' ? t3Shell() : UI.view === 'blk' ? bkShell() : shell();
  if (UI.view === '3d') { t3Mount(); simVidMount(); } if (UI.view === 'blk') bkMount(); if (UI.figModal) figMount(); if (UI.view !== '3d' && UI.view !== 'blk') pvMount(); cntMount(); UI.lastView = UI.view;   // 화면이 바뀔 때만 들어오는 움직임
  if (focus) { const el = document.getElementById(focus); if (el && el.focus) { el.focus(); if (el.setSelectionRange && el.type === 'text') { const n = el.value.length; el.setSelectionRange(n, n); } } }
  window.scrollTo(sx, sy);
}
const ACT = {
  noop() { render(); },
  fchip(a) { const i = a.indexOf(':'); FILTER[a.slice(0, i)](a.slice(i + 1), {}); UI.page.wo = 1; render(); },
  // 메뉴로 들어오면 [그림] 보기, 다른 화면에서 특정 설비·작업을 열면(keepMode) [표] 보기
  go(v) { if (v === 'easy') v = 'dash'; if (!UI.keepMode && MODES[v]) UI.mode[v] = MODES[v][0][0]; UI.keepMode = false; if (v !== '3d' && SIM.on) simStop(true); UI.view = v; UI.menuOpen = false; try { history.replaceState(null, '', '#' + v); } catch (e) { /* file:// 등 */ } UI.resetArm = false; render(); window.scrollTo(0, 0); },
  topGo(v) { if (v === 'blk') return ACT.bkOpen(easyCase()?.work_order_id ? S.wo[easyCase().work_order_id].block_id : '');
    if (v === 'edu') { T3.wantSim = true; ACT.go('3d'); if (T3.ready) { T3.wantSim = false; simStart(); render(); } return; }   // wantSim을 먼저 세워야 휴대폰에서 3D 조선소로 보지 않고 재생 화면으로 연다
    if (v === '3d') { if (SIM.on) simStop(true); const c = easyCase(); if (c && c.work_order_id) T3.sel = S.wo[c.work_order_id].process_id; } ACT.go(v); },
  go3d(pid) { T3.sel = pid || null; ACT.go('3d'); },
  menuTog() { UI.menuOpen = !UI.menuOpen; render(); },
  goEq(id) { UI.mode.eq = 'table'; UI.keepMode = true; UI.sel.eq = id; UI.sel.inc = null; UI.faultForm = false; UI.f.eq = { proc: '', st: '', q: '', kind: '' }; delete UI.draft.actNote; ACT.go('eq'); },
  goWo(id) { if (!id) return; UI.mode.wo = 'table'; UI.keepMode = true; UI.sel.wo = id; clearWoDraft(); UI.f.wo = { proc: '', st: '', date: '', q: '', overdue: false }; const i = woRows().findIndex(w => w.work_order_id === id); UI.page.wo = Math.floor(i / 10) + 1; UI.sub.wo = 'list'; ACT.go('wo'); },
  goWoAll() { UI.mode.wo = 'table'; UI.keepMode = true; UI.f.wo = { proc: '', st: '', date: '16-17', q: '', overdue: false }; UI.page.wo = 1; UI.sub.wo = 'list'; ACT.go('wo'); },
  goOverdue() { UI.mode.wo = 'table'; UI.keepMode = true; UI.f.wo = { proc: '', st: '', date: '', q: '', overdue: true }; UI.page.wo = 1; UI.sub.wo = 'list'; ACT.go('wo'); },
  goBlock(id) { UI.mode.prod = 'table'; UI.keepMode = true; if (id) UI.sel.block = id; UI.f.prod = { vessel: '', proc: '', st: '', q: '' }; ACT.go('prod'); },
  goInc(id) { ACT.goPri(id); },   // 사건 처리는 작업 관리 우선순위에서
  selEq(id) { UI.sel.eq = id; UI.sel.inc = null; UI.faultForm = false; delete UI.draft.actNote; render(); },
  selInc(id) { UI.sel.inc = id; const i = incById(id); UI.sel.node = i && i.work_order_id || null; delete UI.draft.subEq; UI.figModal = false;
    if (UI.simOn) { stopSim(); UI.pausedFor = '사건 확인 중'; } render(); },   // 사건을 고르면 재생을 자동으로 멈춘다
  selIncClear() { UI.sel.inc = null; UI.pausedFor = ''; render(); },
  selEqInc(id) { UI.sel.inc = id; render(); },
  selNode(id) { UI.sel.node = UI.sel.node === id ? null : id; render(); },
  subEq(e) { UI.draft.subEq = e; render(); },
  figOpen(id) { if (id) UI.sel.inc = id; UI.figModal = true; render(); },
  figClose() { UI.figModal = false; render(); },
  speed(v) { UI.speed = +v; if (UI.simOn) { clearInterval(simTimer); simTimer = setInterval(simTick, simMs()); } render(); },
  stepDo(k) { return stepDo(incById(UI.sel.inc), k); },
  selBlock(id) { UI.sel.block = id; render(); },
  selWo(id) { if (UI.sel.wo !== id) clearWoDraft(); UI.sel.wo = id; render(); },
  selProc(id) { UI.sel.proc = id; delete UI.draft.procName; render(); },
  sub(a) { const [k, v] = a.split(':'); UI.sub[k] = v; render(); },
  page(a) { const [k, v] = a.split(':'); UI.page[k] = +v; render(); },
  resetFilter(k) { UI.f[k] = { eq: { proc: '', st: '', q: '', kind: '' }, prod: { vessel: '', proc: '', st: '', q: '' }, wo: { proc: '', st: '', date: '16-17', q: '', overdue: false } }[k]; render(); },
  codeOpen() { UI.codeOpen = true; render(); document.getElementById('codeIn')?.focus(); },
  async codeSave() { setDemoCode((UI.draft.codeIn || '').trim()); delete UI.draft.codeIn; const r = await API.rpc('tp_check_code', {}).catch(e => ({ ok: false, msg: e.message }));
    UI.canWrite = !!r.ok; UI.codeOpen = !r.ok; toast(r.msg, !r.ok); if (r.ok && UI.trial) return endTrial(); render(); },
  endTrial() { endTrial('체험을 끝내고 실제 서버 상태로 돌아왔습니다.'); },
  faultForm() { UI.faultForm = !UI.faultForm; render(); },
  woStatus(s) { UI.draft.woStatus = s; render(); },
  woCancel() { clearWoDraft(); render(); },
  clock(m) { call('tp_advance_clock', { p_min: +m }); },
  reset() { if (!UI.resetArm) { UI.resetArm = true; render(); setTimeout(() => { if (UI.resetArm) { UI.resetArm = false; render(); } }, 4000); return; }
    UI.resetArm = false; call('tp_reset_demo', {}, () => { UI.draft = {}; UI.sel.inc = null; UI.sel.node = null; UI.pausedFor = ''; }); },
  registerFault(eq) { call('tp_register_fault', { p_eq: eq, p_summary: UI.draft.faultSum || '', p_severity: UI.draft.faultSev || 'HIGH' }, () => { delete UI.draft.faultSum; UI.faultForm = false; }); },
  eqFormTog() { UI.eqForm = !UI.eqForm; render(); if (UI.eqForm) document.getElementById('eqfName')?.focus(); },
  eqAdd() { const d = UI.draft, n = eqNextNo(), pid = d.eqfProc || 'P03', rt = d.eqfRoute || 'MODBUS';
    call('tp_equipment_add', { p_name: d.eqfName || '', p_process: pid, p_zone: d.eqfZone || proc(pid).zone_id, p_kind: d.eqfKind || (pid === 'P04' ? '검사자원' : '설비'), p_route: rt,
      p_ip: rt === 'MODBUS' ? (d.eqfIp ?? `192.168.10.${10 + n}`) : null, p_unit: rt === 'MODBUS' ? +(d.eqfUnit ?? 1) : null, p_mw: rt === 'ETOS' ? +(d.eqfMw ?? n * 100) : null },
      () => { UI.eqForm = false; for (const k of Object.keys(UI.draft)) if (k.startsWith('eqf')) delete UI.draft[k]; }); },
  eqActive(a) { const [id, on] = a.split(':'); UI.eqDelArm = null; call('tp_equipment_set_active', { p_eq: id, p_active: on === '1' }); },
  eqDel(id) { if (UI.eqDelArm !== id) { UI.eqDelArm = id; render(); setTimeout(() => { if (UI.eqDelArm === id) { UI.eqDelArm = null; render(); } }, 4000); return; }
    UI.eqDelArm = null; call('tp_equipment_delete', { p_eq: id }); },
  woSave(id) {
    const w = S.wo[id]; const d = UI.draft;
    const qty = 'woQty' in d && d.woQty !== '' && Number(d.woQty) !== w.accepted_qty ? Number(d.woQty) : null;
    call('tp_save_work_order', { p_wo: id, p_eq: d.woEq && d.woEq !== w.equipment_id ? d.woEq : null, p_status: d.woStatus && d.woStatus !== w.status ? d.woStatus : null,
      p_qty: qty, p_hold: d.woHold || null, p_memo: 'woMemo' in d ? d.woMemo : null }, clearWoDraft);
  },
  csv(k) { exportCsv(k); },
  stay() {},
  wizOpen(id) { ACT.goInc(id); },
  t3sel(p) { T3.sel = p || null; render(); },
};
async function stepDo(inc, k) { if (!inc) return; const cs = caseSteps(inc), id = inc.incident_id;
  const usable = substitutes(inc).filter(e => !['FAULT', 'MAINTENANCE'].includes(e.status));
  const eqArg = k === 'fit' ? (usable.find(e => e.equipment_id === UI.draft.subEq) || usable[0])?.equipment_id : k === 'approve' ? stepRec(inc, 'fit')?.equipment_id : k === 'swap' ? stepRec(inc, 'approve')?.equipment_id : null;
  const note = k === 'act' ? (UI.draft.wizNote || '').trim() || (inc.category === 'EQUIPMENT' ? '고장 확인: ' + inc.summary : '현장 조치: ' + inc.summary) : null;
  if (!UI.canWrite) {          // 체험: 코드 없이 서버 규칙으로 실행해 보고 결과만 화면에 보여 줌(저장 안 됨)
    if (!UI.trial) UI.trial = { inc: null, steps: [], note: '' };
    const arg = k === 'act' ? note.replace(/\|/g, '/') : eqArg || '';
    UI.trial.steps.push(`${k}|${id}${arg ? '|' + arg : ''}`); if (k === 'act') delete UI.draft.wizNote;
    UI.busy = true; await runTrial(true); UI.busy = false; return render(); }
  if (k === 'act') return call('tp_record_action', { p_inc: id, p_note: note, p_owner: null }, () => { delete UI.draft.wizNote; });
  if (k === 'resolve') return call('tp_resolve_incident', { p_inc: id });
  if (k === 'resume') return call('tp_resume_work', { p_wo: cs.w.work_order_id });
  return call('tp_incident_step', { p_inc: id, p_step: k, p_eq: eqArg || null });
}
Object.assign(ACT, {
  intro() { UI.intro = true; render(); },
  introClose() { UI.intro = false; try { localStorage.setItem('tpIntroSeen', '1'); } catch (e) { /* 저장 불가 */ } render(); },
  introStart() { ACT.introClose(); if (!UI.simOn && S.now < toM(SHIFT_END)) ACT.simToggle(); },
  impToggle() { UI.imp = UI.imp ? null : { rows: [] }; render(); },
  impTemplate() { const data = [['작업지시', '인정수량', '계획수량', '단위', '블록', '공정'], ...woList().filter(w => w.status === 'IN_PROGRESS').map(w => [w.work_order_id, w.accepted_qty, w.planned_qty, unit(w.unit), w.block_id, proc(w.process_id).process_name])];
    const csv = '\uFEFF' + data.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'TWINPRO_실적가져오기_양식.csv'; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { /* 다운로드가 막힌 환경 */ }
    toast(`진행 중 작업 ${data.length - 1}건으로 양식을 만들었습니다. 인정수량(누적)만 고쳐서 올리세요.`); },
  impSend() { const rows = (UI.imp?.rows || []).map(r => ({ work_order_id: r.wo, accepted_qty: Number(r.qty) }));
    call('tp_import_progress', { p_rows: rows }, () => { UI.imp = { rows: [] }; }); },
  sendSignal() { const t = draft('sigType', 'COUNT'); call('tp_ingest_signal', { p_eq: draft('sigEq', UI.sel.eq), p_signal: t, p_value: t === 'COUNT' ? Number(UI.draft.sigVal || 0) : null }); },
  async simToggle() { if (UI.simOn) return stopSim('가상 시간을 멈췄습니다.');
    if (!UI.canWrite) { if (!UI.trial) UI.trial = { inc: null, steps: [], note: '' };
      UI.simOn = true; UI.pausedFor = ''; simTimer = setInterval(simTick, simMs()); toast(`내 화면에서만 가상 시간이 흐릅니다(${UI.speed}× · ${simMs() / 1000}초마다 5분). 서버에는 저장되지 않습니다.`); render(); return simTick(); }
    const r = await API.rpc('tp_sim_claim', { p_owner: MY_ID }).catch(e => ({ ok: false, msg: e.message })); if (!r.ok) { toast(r.msg, true); return reload(); }
    UI.simOn = true; UI.pausedFor = ''; simTimer = setInterval(simTick, simMs()); toast(`가상 시간 진행(${UI.speed}× · ${simMs() / 1000}초마다 5분). 다른 사람 화면도 같이 움직입니다.`); render(); simTick(); },
  async aiGen() { if (UI.aiBusy) return; UI.aiBusy = true; render();
    try { const r = await API.ai(); toast(r.msg || (r.ok ? '완료' : '실패'), !r.ok); if (!r.ok && /시연 코드가 필요/.test(r.msg || '')) { UI.canWrite = false; UI.codeOpen = true; } }
    catch (e) { toast('AI 서버 호출 실패: ' + (e.message || e), true); }
    finally { UI.aiBusy = false; await reload().catch(() => render()); } },
  copySummary() { const t = S.ai ? S.ai.text : summaryText(kpis()); navigator.clipboard?.writeText(t).then(() => toast('운영 요약을 복사했습니다.'), () => { const r = document.createRange(); r.selectNodeContents(document.getElementById('summaryText') || document.getElementById('aiText')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('복사가 막혀 있어 요약 문장을 선택해 두었습니다. Ctrl+C로 복사하세요.'); }); },
});
// 자동 재생: 이 탭에서만 돈다(탭을 닫으면 멈춤). 신호는 전부 서버 규칙을 거친다.
let simTimer = null, simBusy = false;
const isLive = () => UI.simOn || othersPlaying() || Date.now() - (UI.clockAt || 0) < 7000;   // 이 화면이 재생 중이거나, 다른 화면의 재생으로 시각이 방금 바뀜
function stopSim(msg, ng) { clearInterval(simTimer); simTimer = null; UI.simOn = false; if (UI.canWrite) API.rpc('tp_sim_release', { p_owner: MY_ID }).catch(() => {}); if (msg) toast(msg, ng); render(); }
const MY_ID = (() => { try { let v = sessionStorage.getItem('tpTab'); if (!v) { v = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('tpTab', v); } return v; } catch (e) { return Math.random().toString(36).slice(2, 10); } })();
const othersPlaying = () => { const l = S.simLock; return !!l && l.owner !== MY_ID && Date.parse(l.until) > Date.now(); };
async function simTick() {
  if (simBusy || UI.busy) return; simBusy = true; UI.selfAt = Date.now();
  try {
    if (!UI.canWrite) { const t = UI.trial; if (!t) return stopSim();
      t.steps.push('tick'); const n = t.steps.length; await runTrial(false);
      if (t.steps.length < n) return S.now + 5 > toM(SHIFT_END) ? stopSim('16:00 운영 종료로 재생을 멈췄습니다. [↺ 처음부터 다시 보기]를 누르면 처음 상태로 돌아갑니다.') : stopSim('서버 응답이 없어 재생을 멈췄습니다.', true);
      UI.clockAt = Date.now(); return render(); }
    const lk = await API.rpc('tp_sim_claim', { p_owner: MY_ID }); if (!lk.ok) return stopSim(lk.msg, true);
    const c = await API.rpc('tp_advance_clock', { p_min: 5 }); if (!c.ok) return stopSim(/16:00/.test(c.msg) ? '16:00 운영 종료로 재생을 멈췄습니다. [데이터 초기화]를 두 번 누르면 12:00으로 돌아갑니다.' : '자동 재생 종료: ' + c.msg, !/16:00/.test(c.msg));
    let n = 0;
    for (const e of Object.values(S.equipment).filter(x => x.status === 'RUNNING')) { const w = S.wo[e.work_order_id]; if (!w || w.status !== 'IN_PROGRESS') continue;
      const r = await API.rpc('tp_ingest_signal', { p_eq: e.equipment_id, p_signal: 'COUNT', p_value: Math.max(1, Math.round(w.planned_qty * 0.1)) }); if (r.ok) n++; }
    await reload();
  } catch (e) { stopSim('자동 재생 오류: ' + (e.message || e), true); }
  finally { simBusy = false; }
}
function clearWoDraft() { for (const k of ['woEq', 'woStatus', 'woQty', 'woHold', 'woMemo']) delete UI.draft[k]; }
const FILTER = {
  eqProc: v => UI.f.eq.proc = v, eqSt: v => UI.f.eq.st = v, eqQ: v => UI.f.eq.q = v, eqKind: v => UI.f.eq.kind = v,
  prodVessel: v => UI.f.prod.vessel = v, prodProc: v => UI.f.prod.proc = v, prodSt: v => UI.f.prod.st = v, prodQ: v => UI.f.prod.q = v,
  woProc: v => UI.f.wo.proc = v, woSt: v => UI.f.wo.st = v, woDate: v => UI.f.wo.date = v, woQ: v => UI.f.wo.q = v, woOver: (v, el) => UI.f.wo.overdue = el.checked,
};
document.addEventListener('pointerdown', () => { UI.ptrDown = true; }, true);
document.addEventListener('pointerup', () => { setTimeout(() => { UI.ptrDown = false; if (UI.renderPending) { UI.renderPending = false; render(); } }, 0); }, true);
document.addEventListener('pointercancel', () => { UI.ptrDown = false; if (UI.renderPending) { UI.renderPending = false; render(); } }, true);
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  if (t.tagName === 'TR' && e.target.closest('button,a,input,select,textarea') && e.target.closest('[data-act]') !== t) return;
  e.preventDefault(); const fn = ACT[t.dataset.act]; if (fn) fn(t.dataset.arg);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.draft) { UI.draft[el.dataset.draft] = el.value; if (el.dataset.draft === 'hisQ') { UI.page.his = 1; render(); } return; }
  if (el.dataset.filter && el.type === 'text') { FILTER[el.dataset.filter](el.value, el); UI.page.wo = 1; render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'codeIn' || e.target.id === 'codeIn2')) { e.preventDefault(); UI.draft.codeIn = e.target.value; ACT.codeSave(); }
  if (e.key === 'Escape' && UI.intro) ACT.introClose(); if (e.key === 'Escape' && UI.figModal) ACT.figClose(); if (e.key === 'Escape' && UI.ioModal) ACT.ioClose(); });
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'impFile' && el.files && el.files[0]) { readImportFile(el.files[0]); return; }
  if (el.dataset.draft && el.tagName === 'SELECT') { UI.draft[el.dataset.draft] = el.value; if (el.id === 'eqfProc') { delete UI.draft.eqfZone; delete UI.draft.eqfKind; } if (['sigType', 'eqfProc', 'eqfRoute'].includes(el.id)) render(); return; }
  if (el.dataset.filter && el.type !== 'text') { FILTER[el.dataset.filter](el.value, el); UI.page.wo = 1; render(); }
});

// ---------- 서버 연결 ----------
let reloadTimer = null;
let RAW = null;   // 서버에서 읽은 원본 행. 체험 중에는 이 위에 체험 결과를 덮어 화면을 그린다(서버에는 저장 안 됨)
async function reload() { const prev = S && S.now; RAW = await API.load();
  if (UI.trial && UI.trial.steps.length) await runTrial(false); else S = buildState(RAW);
  if (prev != null && S.now > prev) { UI.clockAt = Date.now(); clearTimeout(liveTimer); liveTimer = setTimeout(render, 7200); }
  if (othersPlaying()) { clearTimeout(lockTimer); lockTimer = setTimeout(render, Date.parse(S.simLock.until) - Date.now() + 200); }
  render(); }
let liveTimer = null, lockTimer = null;
// 체험 모드: 시연 코드 없이 처리 안내 단계를 서버 규칙 그대로 실행해 보고 결과만 받는다(서버가 바로 되돌림)
async function runTrial(say) {
  const t = UI.trial;
  const r = await API.rpc('tp_try_steps', { p_inc: t.inc, p_steps: t.steps, p_note: t.note || null }).catch(e => ({ ok: false, msg: e.message }));
  if (!r || !r.ok || !r.results) { t.steps.pop(); if (say) toast('체험 실행 실패: ' + (r && r.msg || '서버 응답 없음'), true); if (!t.rows) S = buildState(RAW); return; }
  const last = r.results[r.results.length - 1];
  if (!last.ok) { t.steps.pop(); if (say) toast('[체험] ' + last.msg, true); if (t.steps.length) return; t.rows = null; S = buildState(RAW); return; }
  t.rows = r.rows; const merged = { ...RAW }; for (const [k, v] of Object.entries(r.rows)) merged[k] = v || [];
  S = buildState(merged); if (say) toast('[체험 · 저장 안 됨] ' + last.msg);
}
function endTrial(msg) { if (UI.trial && simTimer) { clearInterval(simTimer); simTimer = null; UI.simOn = false; }   // 체험 중 재생은 내 화면 재생뿐
  UI.trial = null; S = buildState(RAW); if (msg) toast(msg); render(); }
function scheduleReload() { if (Date.now() - (UI.selfAt || 0) > 3000 && !UI.simOn) { UI.extAt = Date.now(); setTimeout(render, 5200); } clearTimeout(reloadTimer); reloadTimer = setTimeout(() => reload().catch(e => toast('다시 읽기 실패: ' + e.message, true)), 250); }
function setupScreen() {
  document.getElementById('app').innerHTML = `<div class="content" style="max-width:640px;margin:48px auto"><div class="ptitle"><h1>서버 연결 설정</h1></div>
    <p>Supabase 프로젝트의 <b>Project URL</b>과 <b>anon public 키</b>를 입력하세요. (Supabase 대시보드 → Project Settings → API) 이 브라우저에만 저장됩니다.</p>
    <div class="form"><div class="frow"><span>Project URL</span><div><input id="sUrl" placeholder="https://xxxx.supabase.co"></div></div>
    <div class="frow"><span>anon 키</span><div><input id="sKey" placeholder="eyJ..."></div></div></div>
    <div class="row"><span class="grow"></span><button class="btn pri" id="sSave">저장하고 연결</button></div></div>`;
  document.getElementById('sSave').onclick = () => { try { localStorage.setItem('tpSupabaseUrl', document.getElementById('sUrl').value.trim()); localStorage.setItem('tpSupabaseKey', document.getElementById('sKey').value.trim()); } catch (e) { /* 저장 불가 */ } location.reload(); };
}
async function boot() {
  const hv = location.hash.slice(1); if (VIEW_RENDER[hv] || hv === '3d' || hv === 'blk') UI.view = hv;   // 새로고침해도 보던 화면 유지(#dash 등)
  try { UI.intro = UI.view === 'dash' && !localStorage.getItem('tpIntroSeen'); } catch (e) { UI.intro = false; }   // 처음 방문이면 안내 카드
  if (NEEDS_SETUP) return setupScreen();
  try { await reload(); UI.conn = '실시간 연결';
    if (DEMO_CODE) { const r = await API.rpc('tp_check_code', {}).catch(() => ({ ok: false })); UI.canWrite = !!r.ok; } API.subscribe(scheduleReload, s => { UI.conn = s; render(); }); render(); }
  catch (e) { document.getElementById('app').innerHTML = `<div class="content"><h1>서버에 연결하지 못했습니다</h1><p>${esc(e.message || e)}</p><p class="small">설정의 Supabase 주소와 공개 키를 확인하세요.</p></div>`; }
}
