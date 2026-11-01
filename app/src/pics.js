// TWIN PRO 관리 화면 [그림] 보기 — 화면마다 질문 하나에 그림 하나로 답한다. 값은 전부 서버에서 읽은 상태 S로 계산한다.
//  설비 상태 = 설비 지도(어디에 있고 얼마나 일했나) · 생산 현황 = 배 완성도(얼마나 완성됐나)
//  작업 관리 = 우선순위 1·2·3(무엇부터 처리하나, 온톨로지 근거 + 처리 단계 실행) / 일정표(누가 언제 무엇을)
//  기준정보 = 구조도(공정과 설비가 어떻게 짜여 있나)
// 사진은 AI로 만든 예시 이미지(실제 설비·선박 아님)다. [표] 보기는 기존 화면(ui.js) 그대로다.
UI.mode = { eq: 'pic', prod: 'pic', wo: 'pri' };   // 기준정보는 표만(그림은 다른 화면과 겹쳐서 뺌)
const MODES = { eq: [['pic', '그림'], ['table', '표']], prod: [['pic', '그림'], ['table', '표']], wo: [['pri', '우선순위'], ['plan', '일정표'], ['table', '표']] };
const modeTabs = v => MODES[v] ? `<span class="pvmode">${MODES[v].map(([k, l]) => `<button class="${UI.mode[v] === k ? 'on' : ''}" data-act="mode" data-arg="${v}:${k}">${l}</button>`).join('')}</span>` : '';
const PHOTO = () => window.EQ_PHOTO || {};
const mainEq = pid => Object.values(S.equipment).filter(x => x.process_id === pid).sort((a, b) => a.equipment_id < b.equipment_id ? -1 : 1)[0];
const eqPhoto = e => PHOTO()[mainEq(e.process_id)?.equipment_id === e.equipment_id ? e.process_id : 'SP'] || '';
const procsSorted = () => Object.values(S.processes).sort((a, b) => a.sequence_no - b.sequence_no);
const EQC = { b: '#2F6FED', n: '#8A93A3', r: '#E5484D', p: '#7C5CE0', o: '#E8920C', g: '#16A34A' };
function pvHead(name, group, q, sub, right = '') {
  return `<div class="pghead pvhead"><h1>${name}</h1><span class="pvq">${q}</span>${sub ? `<span class="pgdesc">${sub}</span>` : ''}<span class="grow"></span>${right}${modeTabs(UI.view)}<span class="crumb">⌂ &gt; ${group} &gt; ${name}</span></div>`;
}
const pvNote = '<span class="pvai">사진은 AI로 만든 예시 이미지</span>';

// ---------- 설비 상태 · 설비 지도 ----------
function pvEqCard(e, extra) {
  const c = STATUS.eq[e.status][1], o = occupancy(e.equipment_id);
  return `<button class="pv-ec ${c} ${extra ? 'sm' : ''}" data-act="pvEq" data-arg="${e.equipment_id}" data-link="dot-${e.equipment_id}" data-c="${e.status === 'IDLE' ? '#5D6B85' : EQC[c]}" ${e.status === 'FAULT' ? '' : 'data-dash="1"'}>
    <span class="pv-ph"><img src="${eqPhoto(e)}" alt=""><span class="pill ${c}">${STATUS.eq[e.status][0]}</span>${ioBadge(e.equipment_id)}</span>
    <span class="pv-eb"><span class="pv-en"><small>${e.equipment_id}</small><b>${esc(e.equipment_name)}</b></span>
      <span class="pv-pct"><b>${o.pct.toFixed(1)}<small>%</small></b><em>일한 시간 비율</em></span>
      <span class="pv-tr"><i style="width:${Math.max(1, Math.min(100, o.pct))}%;background:${e.status === 'IDLE' ? '#0F1726' : EQC[c]}"></i></span>
      <span class="pv-since ${e.status === 'FAULT' ? 'c-r' : ''}">${hm(fromM(S.now - statusSince(e.equipment_id)))}부터 ${STATUS.eq[e.status][0]}</span></span></button>`;
}
function viewEqPic() {
  const procs = procsSorted(), all = Object.values(S.equipment), cnt = st => all.filter(x => x.status === st).length;
  const mains = procs.map(p => mainEq(p.process_id)).filter(Boolean);
  const extras = all.filter(e => !mains.includes(e)).sort((a, b) => a.equipment_id < b.equipment_id ? -1 : 1);
  const col = pid => procs.findIndex(p => p.process_id === pid);
  const zone = (p, k) => { const ex = extras.filter(e => e.process_id === p.process_id), m = mainEq(p.process_id), hot = all.some(e => e.process_id === p.process_id && e.status === 'FAULT');
    const dot = (e, x, y) => `<i class="pv-dot ${STATUS.eq[e.status][1]}" id="dot-${e.equipment_id}" style="left:${x}%;top:${y}%"></i>`;
    return `<div class="pv-zone ${hot ? 'hot' : ''}"><span>${p.zone_id} · ${p2(p.sequence_no)} ${esc(p.process_name)}</span>${m ? dot(m, 50, ex.length ? 40 : 55) : ''}${ex.map((e, n) => dot(e, (n + 1) / (ex.length + 1) * 100, 80)).join('')}</div>`; };
  // 아래 줄: 추가 설비 카드는 자기 공정 칸 근처에, 남는 칸에 요약
  const byProc = {}; extras.forEach(e => (byProc[e.process_id] ||= []).push(e));
  let used = 0; const bottom = [];
  for (const [pid, es] of Object.entries(byProc)) { const start = Math.max(used, Math.min(6 - es.length, col(pid) - es.length + 1)); es.forEach((e, n) => bottom.push(`<div style="grid-column:${start + n + 1}">${pvEqCard(e, true)}</div>`)); used = start + es.length; }
  const faults = all.filter(e => e.status === 'FAULT');
  const subs = f => S.fit.filter(x => x.process_id === f.process_id && x.equipment_id !== f.equipment_id).map(x => `${x.equipment_id} ${STATUS.eq[eqOf(x.equipment_id).status][0]}`);
  const msg = faults.length ? faults.map(f => `${f.zone_id}의 <b class="c-rl">${f.equipment_id}이 ${hm(fromM(S.now - statusSince(f.equipment_id)))}부터 고장</b>입니다.${subs(f).length ? ` 대체 후보 설비: ${subs(f).join(' · ')}.` : ''}`).join('<br>') : '고장 난 설비가 없습니다.';
  const den = occupancy(all[0].equipment_id).den;
  const sum = `<div class="pv-sum" style="grid-column:${Math.min(used, 4) + 1} / 7"><div class="cap">지금 설비 ${all.length}대</div>
    <div class="pv-cnt">${[['b', '가동', 'RUNNING'], ['n', '대기', 'IDLE'], ['r', '고장', 'FAULT'], ['p', '점검', 'MAINTENANCE']].map(([c, l, k]) => `<div><span><i style="background:${EQC[c]}"></i>${l}</span><b>${cnt(k)}<small>대</small></b></div>`).join('')}</div>
    <p>${msg}</p><small>% = ${md(OP_START)} ${hm(OP_START)} ~ ${md(nowS())} ${hm(nowS())} 운영시간 ${(den / 60).toFixed(0)}h 중 실제로 일한 시간 · 작업구역 배치는 가상 좌표 · 카드를 누르면 상세(표)</small></div>`;
  return `<div class="pg pg-eqpic">${pvHead('설비 상태', '모니터링', `설비 ${all.length}대는 어디에 있고, 얼마나 일했나?`, '', pvNote)}
    <div class="pv pv-canvas pv-dark pv-eqmap"><svg class="pv-svg"></svg>
      <div class="pv-row6 pv-tops">${mains.map(e => pvEqCard(e)).join('')}</div>
      <div class="pv-row6 pv-zones">${procs.map(zone).join('')}</div>
      <div class="pv-row6 pv-bots">${bottom.join('')}${sum}</div></div></div>`;
}

// ---------- 생산 현황 · 배 완성도 ----------
function blkState(b) {
  const ws = blockWos(b), c = currentWo(b), done = ws.filter(w => w.status === 'COMPLETED').length;
  if (!c) { const l = proc(ws[ws.length - 1].process_id); return { k: 'g', prog: 1, l: `${p2(l.sequence_no)} ${l.process_name} 완료` }; }
  const p = proc(c.process_id), ns = nodeState(c), prog = (done + (c.progress_ratio || 0)) / ws.length, name = `${p2(p.sequence_no)} ${p.process_name}`;
  if (c.status === 'PLANNED' && done === 0 && !c.accepted_qty) return { k: 'x', prog: 0, l: '시작 전', c };
  if (ns.c === 'r') return { k: 'r', prog, l: `${p2(p.sequence_no)} ${ns.l === '정지' ? '멈춤' : ns.l}`, c };
  if (ns.c === 'o') return { k: 'o', prog, l: `${p2(p.sequence_no)} ${ns.l}`, c };
  if (c.status === 'IN_PROGRESS') return { k: 'b', prog, l: `${name} 중`, c };
  return { k: 'n', prog, l: `${name} 대기`, c };
}
function viewProdPic() {
  const blocks = Object.values(S.blocks).sort((a, b) => a.block_id < b.block_id ? -1 : 1), st = blocks.map(b => ({ b, s: blkState(b.block_id) }));
  const n = k => st.filter(x => k.includes(x.s.k)).length, ph = PHOTO();
  const target = blocks.map(b => b.target_transfer_at).sort().pop(), start = woList().map(w => w.planned_start_at).sort()[0];
  const left = Math.max(0, Math.ceil((toM(target) - S.now) / 1440)), pos = Math.max(0, Math.min(100, (S.now - toM(start)) / (toM(target) - toM(start)) * 100));
  const tile = ({ b, s }) => `<button class="pv-bt ${s.k}" data-act="pvBlock" data-arg="${b.block_id}">
    <span class="pv-bi"><img class="base" src="${ph.block || ''}" alt="">${s.k === 'x' ? '' : `<span class="fill" style="height:${(s.prog * 100).toFixed(0)}%"><img src="${ph.block || ''}" alt=""></span>`}</span>
    <span class="pv-bl"><b>${b.block_id}</b><em>${s.k === 'g' ? '✓' : s.k === 'x' ? '' : pct(s.prog * 100, 0)}</em></span><small>${esc(s.l)}</small></button>`;
  return `<div class="pg pg-prodpic">${pvHead('생산 현황', '모니터링', '배는 얼마나 완성됐나?', '', pvNote)}
    <div class="pv pv-prod">
      <div class="pv-dark pv-hero">
        <div class="pv-ship"><img src="${ph.ship_build || ''}" alt="건조 중인 선체(예시 그림)">
          <div class="pv-co" style="left:2%;top:6%"><small>공정에 들어가 있는 블록(멈춤 포함)</small><b>진행 중 블록 ${n('bnro')}개</b></div>
          <div class="pv-co" style="right:2%;bottom:6%"><small>이송까지 끝난 블록</small><b>완성 블록 ${n('g')}개</b></div></div>
        <div class="pv-heroR"><div class="cap">블록 ${blocks.length}개 중</div>
          <div class="pv-big">${n('g')}<span> / ${blocks.length} 완성</span></div>
          <div class="pv-mini"><span><b>${n('bn')}</b> 진행</span><span><b class="c-rl">${n('ro')}</b> 멈춤·대기</span><span><b>${n('x')}</b> 시작 전</span></div>
          <div class="pv-goal"><img src="${ph.ship_done || ''}" alt="완성 선박(예시 그림)"><div><div class="cap">완성 목표 (마지막 블록 이송)</div><b>${md(target)}</b><small>오늘부터 ${left}일 남음</small></div></div></div>
        <span class="pv-foot">그림은 AI로 만든 예시이며 실제 선박이 아닙니다 · 숫자는 서버 데이터 · 실적 출처: 엑셀 제공 실적 + 설비 신호 반영 ${cntOk()}건 <button class="lnk" data-act="ioOpen">수집 경로 ›</button></span></div>
      <div class="pv-blocks">
        <div class="pv-bh"><b>블록 ${blocks.length}개</b><span>사진이 차오른 만큼 6개 공정 중 진행됨 · 누르면 블록이 거쳐 온 길(표)</span><span class="grow"></span>
          <span class="legend pvleg"><span><i style="background:#0F1726"></i>완성</span><span><i style="background:${EQC.b}"></i>진행</span><span><i style="background:${EQC.r}"></i>멈춤</span><span><i style="background:${EQC.o}"></i>자재·품질 대기</span><span><i class="dash"></i>시작 전</span></span></div>
        <div class="pv-tiles">${st.map(tile).join('')}</div>
        <div class="pv-tl"><div class="pv-tlb"><i style="width:${pos}%"></i><em style="left:${pos}%"></em></div>
          <div class="pv-tll"><span>${md(start)} 시작</span><b style="left:${pos}%">오늘 ${md(nowS())} ${hm(nowS())}</b><span class="r">${md(target)} 완성 목표</span></div></div></div></div></div>`;
}

// ---------- 작업 관리 · 우선순위 ----------
function priHead(x) {
  const p = x.pid && proc(x.pid), w = x.w;
  if (x.inc.category === 'EQUIPMENT') return `${x.eq} ${eqOf(x.eq).equipment_name} ${eqOf(x.eq).status === 'FAULT' ? '고장' : '복구 확인'}`;
  return `${w ? w.block_id + ' ' : ''}${p ? p.process_name + ' ' : ''}${STATUS.cat[x.inc.category][0]}`;
}
function priWhy(x) {
  if (x.blocks) return `${x.eq} 고장으로 ${x.wo || '작업'}이 멈췄고, 다음 공정 ${x.next.length}건과 이 설비를 쓰기로 한 작업 ${x.same.length}건이 기다립니다`;
  if (x.stopped) return `${x.wo}이 멈춘 지 ${minLabel(x.min)}이 지났고, 다음 공정 ${x.next.length}건이 기다립니다`;
  return `${x.wo ? x.wo + '은 다시 진행 중이고, ' : ''}사건만 열려 있습니다`;
}
function priSentence(L) {
  if (!L.length) return '미해결 사건이 없습니다. 지금 먼저 처리할 일이 없습니다.';
  const h = L.map(priHead);
  return `지금은 <b>${esc(h[0])}</b> 처리가 가장 급합니다. ${esc(priWhy(L[0]))}.${L[1] ? ` 그다음은 <b>${esc(h[1])}</b>${L[2] ? `, 그 다음은 <b>${esc(h[2])}</b>` : ''}${L.length > 3 ? ` 외 ${L.length - 3}건` : ''}입니다.` : ''}`;
}
const PRI_LBL = { blocks: '공정 전체 막힘', stopped: '작업 멈춤', min: '멈춘 시간', wait: '밀리는 작업' };
function priCard(x, sel) {
  const cs = caseSteps(x.inc), a = cs.active, id = x.inc.incident_id, img = x.eq ? eqPhoto(eqOf(x.eq)) : '';
  const chip = (k, v) => `<span class="${x.hit === k ? 'hit' : ''}">${PRI_LBL[k]}<b>${v}</b></span>`;
  const sub = x.inc.category === 'EQUIPMENT' ? `<span>대체 설비<b>${x.subs.length ? x.subs.map(e => `${e} ${STATUS.eq[eqOf(e).status][0]}`).join(' · ') : '없음'}</b></span>` : '';
  const path = `${id} → ${x.wo || '-'}${x.eq ? ` (${x.eq})` : ''} → 다음 공정 ${x.next.length}건${x.same.length ? ` · 같은 설비 대기 ${x.same.length}건` : ''}`;
  const steps = sel ? `<ol class="pv-steps">${cs.st.map((s, n) => `<li class="${s.done ? 'done' : s === a ? 'on' : ''}"><b>${s.done ? '✓' : n + 1}</b>${s.title}</li>`).join('')}</ol>
    ${a ? stepCtl(x.inc, cs, a).replace(/data-act="stepDo" data-arg="/g, `data-act="priStep" data-arg="${id}:`) : '<div class="note ok"><b>처리 완료</b>남은 단계가 없습니다.</div>'}` : '';
  return `<div class="pv-pc ${sel ? 'on' : ''}" ${sel ? '' : `data-act="priSel" data-arg="${id}"`}>
    <div class="pv-rk"><span>순위</span><b>${x.rank}</b></div>
    <div class="pv-pph">${img ? `<img src="${img}" alt="">` : ''}</div>
    <div class="pv-pb"><div class="pv-pt">${esc(priHead(x))}<small>${id} · ${STATUS.cat[x.inc.category][0]}</small></div>
      <div class="pv-why">${chip('blocks', x.blocks ? '예' : '아니오')}${chip('stopped', x.stopped ? '예' : '아니오')}${chip('min', minLabel(x.min))}${chip('wait', x.wait + '건')}${sub}</div>
      <div class="pv-path"><em>근거 경로</em>${path}</div>
      <div class="pv-path pv-det"><em>감지 경로</em>${esc(incDetect(x.inc))}</div>
      ${sel ? `<div class="pv-whyt"><em>왜 멈췄나요?</em>${incWhy(x.inc)}${relatedIncs(x.inc).length ? `<span class="pv-rel">${incRelText(x.inc)}</span>` : ''}</div>` : ''}
      ${sel ? steps : `<div class="pv-do"><em>지금 단계</em>${a ? a.title : '처리 완료'}<span class="grow"></span><button class="btn">처리하기 ›</button></div>`}
      ${sel ? `<div class="pv-links">${x.wo ? `<button class="btn line" data-act="goWo" data-arg="${x.wo}">작업지시 ${x.wo} 열기 ›</button>` : ''}${hasFig(x.inc) ? `<button class="btn line" data-act="figOpen" data-arg="${id}">🔍 ${x.inc.category === 'EQUIPMENT' ? '고장 부위' : '상황'} 설명도</button>` : ''}</div>` : ''}</div></div>`;
}
function priGraph(x) {
  if (!x) return '<div class="pv-graph pv-dark"><div class="empty">미해결 사건이 없습니다.</div></div>';
  const id = x.inc.incident_id, w = x.w, cat = x.inc.category, e = x.eq && eqOf(x.eq);
  const node = (nid, kind, name, sub, c, img, cls = '') => `<div class="pv-n ${c} ${cls}" id="${nid}">${img ? `<span class="pv-ni"><img src="${img}" alt=""></span>` : '<i></i>'}<span><small>${kind}</small><b>${name}</b><em>${sub}</em></span></div>`;
  const edge = (a, b, l, k = '') => `<i class="pv-edge" data-a="${a}" data-b="${b}" data-l="${l}" data-k="${k}"></i>`;
  const wc = w ? nodeState(w).c : 'n', short = l => l.length > 2 ? `${l[0]} 외 ${l.length - 1}건` : l.join(' · ');
  const cells = [], edges = [];
  if (e) cells.push(['0 / 1', node('g-eq', '설비', `${e.equipment_id} ${esc(e.equipment_name)}`, `${STATUS.eq[e.status][0]} · ${hm(fromM(S.now - statusSince(e.equipment_id)))}부터`, STATUS.eq[e.status][1], eqPhoto(e))]);
  cells.push(['0 / 2', node('g-inc', '사건', id, `${STATUS.cat[cat][0]} · ${minLabel(x.min)}째 미해결`, 'r')]);
  if (w) cells.push(['1 / 2', node('g-wo', '작업지시', w.work_order_id, `${w.block_id} · ${esc(proc(w.process_id).process_name)} · ${nodeState(w).l}`, wc)]);
  if (x.same.length) cells.push(['1 / 1', node('g-same', '같은 설비 대기', `작업 ${x.same.length}건`, short(x.same), 'o')]);
  if (x.next.length) cells.push(['2 / 1', node('g-next', '다음 공정', `작업 ${x.next.length}건`, `${x.next[0]}~${x.next[x.next.length - 1].slice(-2)} · 밀림`, 'o')]);
  x.subs.forEach((s, n) => { const se = eqOf(s); cells.push([`${2 + n} / 2`, node('g-sub' + n, '대체 후보 설비', `${s} ${esc(se.equipment_name)}`, `${STATUS.eq[se.status][0]}${['FAULT', 'MAINTENANCE'].includes(se.status) ? ' · 지금 사용 불가' : ' · 적합성 확인 필요'}`, STATUS.eq[se.status][1], eqPhoto(se))]); });
  if (e && cat === 'EQUIPMENT') edges.push(edge('g-eq', 'g-inc', '고장 발생')); else if (e && w) edges.push(edge('g-wo', 'g-eq', '쓰는 설비'));
  if (w) edges.push(edge('g-inc', 'g-wo', cat === 'QUALITY' ? '품질 보류' : '작업 멈춤'));
  if (x.same.length) edges.push(edge('g-eq', 'g-same', '같은 설비 필요'));
  if (x.next.length && w) edges.push(edge('g-wo', 'g-next', '다음 공정'));
  x.subs.forEach((s, n) => edges.push(edge('g-sub' + n, 'g-wo', n ? '' : '대체 후보', n ? 'side' : 'dash')));
  const rows = Math.max(3, ...cells.map(([g]) => +g.split(' / ')[0] + 1));
  return `<div class="pv-graph pv-dark"><div class="pv-gh"><b>${x.rank}순위 근거 연결</b><span>온톨로지(설비 · 사건 · 작업지시 관계)에서 그대로 가져옴</span></div>
    <div class="pv-canvas pv-gc" style="grid-template-rows:repeat(${rows}, auto)"><svg class="pv-svg"></svg>${cells.map(([g, h]) => `<div style="grid-row:${+g.split(' / ')[0] + 1};grid-column:${g.split(' / ')[1]}">${h}</div>`).join('')}${edges.join('')}</div>
    <div class="pv-gf">${esc(priWhy(x))}.${x.subs.length ? `<br>대체 후보: ${x.subs.map(s => `${s} ${STATUS.eq[eqOf(s).status][0]}`).join(' · ')} — 적합성 확인·관리자 승인 후에만 옮깁니다.` : ''}</div></div>`;
}
function viewWoPri() {
  const L = priorities(), selId = L.some(x => x.inc.incident_id === UI.sel.pri) ? UI.sel.pri : L[0]?.inc.incident_id, sx = L.find(x => x.inc.incident_id === selId);
  const ai = S.aiPri, fresh = ai && ai.sim_at === nowS();
  const aiBtn = S.aiPriReady ? `<button class="btn line" data-act="priAi" ${UI.aiBusy ? 'disabled' : ''} ${UI.canWrite ? '' : 'disabled title="시연 코드가 필요합니다(하루 10회)"'}>${UI.aiBusy ? 'AI 요약 중…' : fresh ? 'AI로 다시 요약' : 'AI로 요약'}</button><span class="small">오늘 ${S.aiUsed}/${AI_LIMIT}회</span>` : '';
  const sumText = fresh ? esc(ai.text) : priSentence(L);
  const sum = `<div class="pv-ps"><div class="pv-psh"><span class="pv-tag ${fresh ? '' : 'rule'}">${fresh ? 'AI 요약' : '규칙 요약'}</span><span class="small">${hm(nowS())} 기준 · 미해결 ${L.length}건 · 순위는 아래 기준으로 서버 데이터에서 계산${fresh ? `, 문장만 AI(${esc(ai.model || '')})가 씀` : ''}${ai && !fresh ? ` · 이전 AI 요약(${md(ai.sim_at)} ${hm(ai.sim_at)})은 지금 상태와 달라 숨김` : ''}</span><span class="grow"></span>${aiBtn}</div>
    <div class="pv-pst" id="priText">${sumText}</div></div>`;
  const crit = `<div class="pv-crit"><span class="cap">순위 기준</span><span><b>①</b> 공정 전체가 막혔나</span><span><b>②</b> 작업이 지금 멈춰 있나</span><span><b>③</b> 멈춘 시간</span><span><b>④</b> 밀리는 작업 수</span><span class="small">검은 칸 = 바로 아래(위) 순위와 갈린 기준 · 예측이 아닌 현재 기록</span></div>`;
  return `<div class="pg pg-wopri">${pvHead('작업 관리', '관리', '지금 무엇부터 처리해야 하나?', '', UI.trial ? '<span class="pvai">체험 중 · 저장 안 됨</span>' : '')}
    <div class="pv pv-pri"><div class="pv-pl">${sum}<div class="pv-cards">${L.map(x => priCard(x, x === sx)).join('') || '<div class="empty">미해결 사건이 없습니다. 처리할 일이 없습니다.</div>'}</div>${crit}</div>${priGraph(sx)}</div></div>`;
}

// ---------- 작업 관리 · 일정표 ----------
function viewWoPlan() {
  const days = [DAY, fromM(toM(DAY + ' 00:00') + 1440).slice(0, 10)], procs = procsSorted();
  const xOf = (s) => { const d = days.indexOf(s.slice(0, 10)), h = (toM(s) - toM(s.slice(0, 10) + ' 08:00')) / 60; return (d * 8 + Math.max(0, Math.min(8, h))) / 16 * 100; };
  const nowX = days.includes(nowS().slice(0, 10)) ? xOf(nowS()) : null;
  const bar = w => { const ns = nodeState(w), x0 = xOf(w.planned_start_at), x1 = xOf(w.planned_end_at), e = eqOf(w.equipment_id), warn = w.status === 'PLANNED' && e.status === 'FAULT';
    const k = w.status === 'PLANNED' ? (warn ? 'warn' : 'plan') : w.status === 'COMPLETED' ? 'done' : ns.c;
    const f = w.status === 'COMPLETED' ? 1 : w.progress_ratio || 0;
    const tag = w.status === 'COMPLETED' ? '완료' : w.status === 'PLANNED' ? (warn ? `⚠ ${w.equipment_id} 고장` : '예정') : `${ns.l} ${pct(f * 100, 0)}`;
    return `<button class="pv-gb ${k} ${k !== 'plan' && k !== 'warn' && f < .5 ? 'lo' : ''} ${f >= .9 ? 'full' : ''}" style="left:${x0}%;width:${Math.max(2, x1 - x0)}%" data-act="goWo" data-arg="${w.work_order_id}" title="${w.work_order_id} · ${w.equipment_id}">
      ${k !== 'plan' && k !== 'warn' ? `<i style="width:${f * 100}%"></i>` : ''}<b>${w.block_id}</b><small>${w.work_order_id} · ${w.equipment_id}</small><em>${tag}</em></button>`; };
  const rows = procs.map(p => { const m = mainEq(p.process_id), ws = woList().filter(w => w.process_id === p.process_id && days.includes(w.planned_start_at.slice(0, 10)));
    return `<div class="pv-gr"><div class="pv-gh2"><span class="pv-gi"><img src="${m ? eqPhoto(m) : ''}" alt=""></span><span><b>${p2(p.sequence_no)} ${esc(p.process_name)}</b><small>${m ? `${m.equipment_id} ${esc(m.equipment_name)}` : ''}</small></span></div>
      <div class="pv-gl">${ws.map(bar).join('')}</div></div>`; }).join('');
  const ticks = days.flatMap((d, i) => [8, 10, 12, 14, 16].filter(h => !(i && h === 8)).map(h => `<span style="left:${(i * 8 + h - 8) / 16 * 100}%">${p2(h)}:00</span>`)).join('');
  return `<div class="pg pg-woplan">${pvHead('작업 관리', '관리', '누가 언제 무엇을 만드나?', '', pvNote)}
    <div class="pv pv-plan"><div class="pv-gtop"><span></span><div class="pv-gdays">${days.map((d, i) => `<span class="${i ? 'tm' : ''}">${dateLabel(d)}${i ? ' · 내일' : ' · 오늘'}</span>`).join('')}</div></div>
      <div class="pv-grows">${rows}${nowX != null ? `<div class="pv-now" style="left:calc(var(--gh) + (100% - var(--gh)) * ${nowX / 100})"><span>지금 ${hm(nowS())}</span></div>` : ''}<div class="pv-tm" style="left:calc(var(--gh) + (100% - var(--gh)) * .5)"></div></div>
      <div class="pv-gax"><span></span><div>${ticks}</div></div>
      <div class="legend pvleg"><span><i style="background:#0F1726"></i>완료</span><span><i style="background:${EQC.b}"></i>진행(채운 만큼)</span><span><i style="background:${EQC.r}"></i>멈춤</span><span><i style="background:${EQC.o}"></i>자재·품질 대기</span><span><i class="dash"></i>예정</span><span class="small">막대를 누르면 작업지시 편집(표)으로 이동 · 계획 시간 기준 위치</span></div></div></div>`;
}

// ---------- 지시선·관계선 그리기(그린 뒤 실제 위치를 재서 SVG로) ----------
function pvMount() {
  document.querySelectorAll('.pv-canvas').forEach(cv => {
    const svg = cv.querySelector(':scope > svg.pv-svg'); if (!svg) return;
    const R = cv.getBoundingClientRect(); if (!R.width) return;
    svg.setAttribute('width', R.width); svg.setAttribute('height', R.height); svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    const box = el => { const r = el.getBoundingClientRect(); return { l: r.left - R.left, t: r.top - R.top, r: r.right - R.left, b: r.bottom - R.top, cx: (r.left + r.right) / 2 - R.left, cy: (r.top + r.bottom) / 2 - R.top }; };
    let out = '';
    cv.querySelectorAll('[data-link]').forEach(el => { const d = cv.querySelector('#' + el.dataset.link); if (!d) return;
      const a = box(el), b = box(d), c = el.dataset.c || '#5D6B85', dash = el.dataset.dash ? 'stroke-dasharray="3 4"' : '', wdt = el.dataset.dash ? 1.4 : 2.4;
      const down = a.b < b.cy, y1 = down ? a.b : a.t;
      out += Math.abs(a.cx - b.cx) < 2 ? `<path d="M${a.cx} ${y1} L${b.cx} ${b.cy}" stroke="${c}" stroke-width="${wdt}" fill="none" ${dash}/>`
        : `<path d="M${a.cx} ${y1} V${down ? y1 + 26 : y1 - 26} H${b.cx} V${b.cy}" stroke="${c}" stroke-width="${wdt}" fill="none" ${dash}/>`; });
    cv.querySelectorAll('.pv-edge').forEach(el => { const A = cv.querySelector('#' + el.dataset.a), B = cv.querySelector('#' + el.dataset.b); if (!A || !B) return;
      const a = box(A), b = box(B), k = el.dataset.k, l = el.dataset.l, col = k ? '#5D6B85' : '#AAB4C5', dash = k ? 'stroke-dasharray="5 5"' : '';
      if (k === 'side') { const x = Math.max(a.r, b.r) + 14; out += `<path d="M${a.r} ${a.cy} H${x} V${b.cy} H${b.r}" stroke="${col}" stroke-width="1.5" fill="none" ${dash}/>`; return; }
      out += `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="${col}" stroke-width="1.5" ${dash}/>`;
      if (l) { const mx = (a.cx + b.cx) / 2, my = Math.abs(a.cy - b.cy) < 4 ? a.cy : (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2, wl = l.length * 12 + 18;
        const yy = Math.abs(a.cy - b.cy) < 4 ? a.cy : Math.min(a.b, b.b) < Math.max(a.t, b.t) ? (Math.min(a.b, b.b) + Math.max(a.t, b.t)) / 2 : my;
        const xx = Math.abs(a.cy - b.cy) < 4 ? (Math.min(a.r, b.r) + Math.max(a.l, b.l)) / 2 : a.cx + (b.cx - a.cx) * ((yy - a.cy) / ((b.cy - a.cy) || 1));
        out += `<rect x="${xx - wl / 2}" y="${yy - 11}" width="${wl}" height="22" rx="11" fill="#0E1726" stroke="#2A3650"/><text x="${xx}" y="${yy + 4}" text-anchor="middle" font-size="11.5" fill="#C9D1DE">${esc(l)}</text>`; } });
    svg.innerHTML = out;
  });
}
window.addEventListener('resize', () => { clearTimeout(window.__pvT); window.__pvT = setTimeout(pvMount, 120); });

// ---------- 화면 연결 ----------
Object.assign(VIEW_RENDER, {
  eq: () => UI.mode.eq === 'pic' ? viewEqPic() : viewEq(),
  prod: () => UI.mode.prod === 'pic' ? viewProdPic() : viewProd(),
  wo: () => UI.mode.wo === 'pri' ? viewWoPri() : UI.mode.wo === 'plan' ? viewWoPlan() : viewWo(),
});
// ---------- 동작 ----------
Object.assign(ACT, {
  mode(a) { const [v, k] = a.split(':'); UI.mode[v] = k; render(); },
  pvEq(id) { UI.mode.eq = 'table'; ACT.goEq(id); },
  pvBlock(id) { UI.mode.prod = 'table'; ACT.goBlock(id); },
  priSel(id) { UI.sel.pri = id; UI.sel.inc = id; delete UI.draft.subEq; delete UI.draft.wizNote; UI.figModal = false;   // 처리할 사건을 고르면 위쪽에 추적 칩, 재생은 자동으로 멈춤
    if (UI.simOn) { stopSim(); UI.pausedFor = '사건 확인 중'; } render(); },
  goPri(id) { if (id) { UI.sel.pri = id; UI.sel.inc = id; if (UI.simOn) { stopSim(); UI.pausedFor = '사건 확인 중'; } } ACT.go('wo'); },   // 관제·다른 화면 → 작업 관리 우선순위(그 사건 선택)
  priStep(a) { const [id, k] = a.split(':'); UI.sel.pri = id; return stepDo(incById(id), k); },
  async priAi() { if (UI.aiBusy) return; UI.aiBusy = true; render();
    try { const r = await API.ai('priority'); toast(r.msg || (r.ok ? '완료' : '실패'), !r.ok); if (!r.ok && /시연 코드가 필요/.test(r.msg || '')) { UI.canWrite = false; UI.codeOpen = true; } }
    catch (e) { toast('AI 서버 호출 실패: ' + (e.message || e), true); }
    finally { UI.aiBusy = false; await reload().catch(() => render()); } },
});
