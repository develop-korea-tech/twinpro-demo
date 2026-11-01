// ---------- 현장 데이터 수집 연결(Modbus · ETOS) ----------
// 지금 단계: 화면의 시뮬레이터가 서버 입구(tp_ingest_signal)로 RUN·STOP·COUNT·FAULT 신호를 보낸다.
// 현장 연결 시: 연결 프로그램(tools/io_bridge)이 개별 장비(LS XGT PLC, Modbus TCP)·집약 라우팅 장비(AC&T ETOS 통신 서버, XGT FEnet IP)의 값을 읽어 같은 입구로 보낸다.
// 입구 뒤의 규칙(R1~R7)·DB·화면은 그대로이므로, 이 파일은 "어디서 들어온 신호인가"를 보여 주는 일만 한다.
const IO_ROUTE = { MODBUS: ['Modbus TCP', '개별 장비(PLC) 직결 · 포트 502', 'm'], ETOS: ['ETOS 통신 서버', '집약 라우팅 장비 경유 · XGT FEnet(IP) 포트 2004', 'e'] };
const IO_SRC = { SIM: '시뮬레이터', MODBUS: 'Modbus', ETOS: 'ETOS' };
const IO_PT = [['RUN', 'Coil 00001', 'RUN/STOP', '0 → 1이면 RUN(가동), 1 → 0이면 STOP(정지)'], ['CNT', 'HR 40001', 'COUNT', '이전 값과의 차이(증가분)를 COUNT 수량으로'], ['ALM', 'DI 10001', 'FAULT', '0 → 1이면 FAULT(이상 정지)']];
const IO_EQ = [['EQ01', 'MODBUS', '192.168.10.11', 'Z01'], ['EQ02', 'ETOS', null, 'Z02'], ['EQ03', 'MODBUS', '192.168.10.13', 'Z03'], ['EQ04', 'ETOS', null, 'Z04'],
  ['EQ05', 'MODBUS', '192.168.10.15', 'Z05'], ['EQ06', 'ETOS', null, 'Z06'], ['EQ07', 'MODBUS', '192.168.10.17', 'Z03'], ['EQ08', 'MODBUS', '192.168.10.18', 'Z03']];
// 서버에 수집 포인트 표(17_io.sql)가 아직 없을 때 쓰는 같은 정의(테스트가 서버 표와 같은지 확인)
function ioDefault() {
  return IO_EQ.flatMap(([eq, route, ip, zone], i) => IO_PT.map(([k, mb, signal, rule], j) => ({
    point_id: `${eq}-${k}`, equipment_id: eq, route, endpoint: route === 'MODBUS' ? `${ip}:502` : 'ETOS-100XP 192.168.20.10:2004', unit_id: route === 'MODBUS' ? 1 : null,
    address: route === 'MODBUS' ? mb : `%MW${(i + 1) * 100 + j}`, data_type: route === 'MODBUS' ? (k === 'CNT' ? 'UINT16 누적값' : 'BOOL') : (k === 'CNT' ? 'WORD 누적값' : 'WORD 0/1'), signal, rule, sort: (i + 1) * 10 + j + 1 })));
}
const ioLink = eq => S.io.find(p => p.equipment_id === eq) || null;
const ioPoints = eq => S.io.filter(p => p.equipment_id === eq);
const ioEqs = route => [...new Set(S.io.filter(p => p.route === route).map(p => p.equipment_id))];
const ioBadge = eq => { const l = ioLink(eq); return l ? `<span class="iob ${IO_ROUTE[l.route][2]}" title="${IO_ROUTE[l.route][1]} · ${esc(l.endpoint)}">${l.route === 'MODBUS' ? 'Modbus' : 'ETOS'}</span>` : ''; };
const ioMode = () => { const l = S.sigStat.last; return l && l.source !== 'SIM' ? `연결 프로그램 수신(${IO_SRC[l.source]})` : '시뮬레이터'; };
const ioFaultAddr = eq => { const p = S.io.find(x => x.equipment_id === eq && x.signal === 'FAULT'); return p ? `${IO_SRC[p.route]} ${p.address}` : ''; };
// 실적에 반영된 생산 카운트 신호 수(출처 무관)
const cntOk = () => S.sigStat.cntOk || 0;
// 사건이 어떤 경로로 들어왔는지(감지 경로)
function incDetect(inc) {
  const s = S.sigStat.faultInc[inc.incident_id];
  if (s) return `${IO_SRC[s.source]} FAULT 신호로 자동 등록 (${hm(s.at)})`;
  const base = toM(inc.opened_at) <= toM(DAY + ' 12:00') ? '엑셀 제공 기록' : '화면에서 등록';
  if (inc.category === 'EQUIPMENT') { const eq = incEquipment(inc), a = eq && ioFaultAddr(eq);
    return a ? `${base} · 현장 연결 시 ${eq} ${a}(이상 정지) → FAULT 신호로 자동 등록` : base; }
  return `${base} · ${inc.category === 'MATERIAL' ? '자재 대기' : '품질 보류'}는 센서가 아닌 작업자 입력(화면)으로 등록`;
}

// ---------- 관제: 데이터 수집 칩 + 연결 구조도 ----------
function ioChip() {
  const st = S.sigStat, l = st.last;
  return `<button class="iochip" data-act="ioOpen" title="현장 데이터가 들어오는 경로(연결 구조도)"><i class="${l && l.source !== 'SIM' ? 'on' : ''}"></i><span>데이터 수집 <b>${ioMode()}</b></span>
    <small>Modbus ${ioEqs('MODBUS').length}대 · ETOS ${ioEqs('ETOS').length}대 · ${l ? `마지막 수신 ${hm(l.at)}` : '수신 기록 없음'}</small></button>`;
}
function ioModal() {
  const ph = PHOTO(), st = S.sigStat;
  const eqList = r => ioEqs(r).map(e => `${e} ${esc(eqOf(e)?.equipment_name || '')}`).join(' · ');
  const rows = S.signals.slice(0, 6).map(g => `<tr><td>${hm(g.sim_at)}</td><td>${g.equipment_id}</td><td>${(SIGNALS.find(x => x[0] === g.signal) || [, g.signal])[1]}${g.value != null ? ' ' + g.value : ''}</td><td><span class="iob ${g.source === 'MODBUS' ? 'm' : g.source === 'ETOS' ? 'e' : 's'}">${IO_SRC[g.source || 'SIM']}</span></td><td class="c">${g.ok ? '<span class="badge g">반영</span>' : '<span class="badge r">거부</span>'}</td></tr>`).join('');
  return `<div class="modal-bg" data-act="ioClose"><div class="modal iomodal" data-act="stay" role="dialog" aria-label="현장 데이터 수집 연결 구조">
    <div class="ph"><h2>현장 데이터 수집 연결 구조</h2><span class="sub">지금 단계와 현장 연결 시 같은 서버 입구 · 같은 규칙을 씁니다</span><span class="grow"></span><button class="btn" data-act="ioClose">닫기 ✕</button></div>
    <div class="ioflow">
      <div class="iosrc">
        <div class="iocard m"><img src="${ph.io_modbus || ''}" alt="LS XGB PLC와 이더넷 모듈(현장 사진)"><div><small>① 개별 장비 · LS XGT 계열 PLC</small><b>Modbus TCP 직결</b><em>설비 PLC의 Coil · DI · HR 값을 이더넷 모듈로 직접 읽음 (포트 502)</em><span>${eqList('MODBUS')}</span></div></div>
        <div class="iocard e"><img src="${ph.io_etos || ''}" alt="AC&T ETOS-100XP 통신 서버(카탈로그)"><div><small>② 집약 라우팅 장비 · AC&T ETOS</small><b>ETOS 통신 서버 · IP</b><em>RS-485 등으로 모은 여러 장비 값을 ETOS 메모리(%MW)에서 IP로 읽음 (XGT FEnet, 포트 2004)</em><span>${eqList('ETOS')}</span></div></div>
      </div>
      <span class="ioarr">→</span>
      <div class="iocard x"><div class="iobr">⇄</div><div><small>③ 연결 프로그램</small><b>tools/io_bridge</b><em>값의 변화를 RUN · STOP · COUNT · FAULT 신호로 바꿔 보냄 (현장 수집 PC)</em></div></div>
      <span class="ioarr">→</span>
      <div class="iostack"><div class="iostep hot"><small>④ 서버 입구</small><b>tp_ingest_signal</b><em>출처 기록 (SIM · MODBUS · ETOS)</em></div><div class="iostep"><small>⑤ 규칙</small><b>R1 ~ R7</b><em>가동 · 보류 · 실적 · 고장 등록</em></div><div class="iostep"><small>⑥ DB → 화면</small><b>화면 5개 실시간</b><em>Realtime으로 모든 화면에 반영</em></div></div>
    </div>
    <div class="iocmp"><div><b>지금 단계</b><span>엑셀 15개 시트(초기 데이터) + 화면 시뮬레이터가 ④ 입구로 신호를 보냄</span></div><div><b>현장 연결 시</b><span>①② 장비 값을 ③ 연결 프로그램이 같은 ④ 입구로 보냄 → ⑤⑥과 화면은 바꾸지 않음</span></div></div>
    <div class="iolog"><div class="ph"><h2>최근 받은 신호</h2><span class="sub">전체 ${st.n}건 · 시뮬레이터 ${st.src.SIM} · Modbus ${st.src.MODBUS} · ETOS ${st.src.ETOS}</span><span class="grow"></span><button class="btn line" data-act="ioPts">수집 포인트 표 보기 ›</button></div>
      <div class="tw"><table><thead><tr><th>시연 시각</th><th>설비</th><th>신호</th><th>출처</th><th class="c">결과</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="c small">아직 받은 신호가 없습니다.</td></tr>'}</tbody></table></div></div>
    <div class="small iofoot">① PLC 사진은 HIET 수처리 현장 시공 사진, ② ETOS는 AC&T 카탈로그 이미지 · IP · 주소는 가상 기준정보입니다(현장 연결 시 실제 값으로 교체)${S.ioReady ? '' : ' · 서버에 수집 포인트 표가 아직 없어 화면 기본값을 표시'}</div></div></div>`;
}

// ---------- 기준정보: 수집 포인트(I/O) ----------
function viewBaseIo() {
  const ph = PHOTO(), st = S.sigStat;
  const rows = S.io.map((p, n) => { const e = eqOf(p.equipment_id), first = n === 0 || S.io[n - 1].equipment_id !== p.equipment_id, cnt = st.byEq[p.equipment_id] || 0;
    return `<tr class="${first ? 'iogrp' : ''}" data-act="goEq" data-arg="${p.equipment_id}"><td>${first ? `<b>${p.equipment_id}</b> ${esc(e?.equipment_name || '')}` : ''}</td><td>${first ? ioBadge(p.equipment_id) : ''}</td><td>${first ? esc(p.endpoint) : ''}</td><td class="c">${first ? (p.unit_id ?? '-') : ''}</td>
      <td><code>${esc(p.address)}</code></td><td>${esc(p.data_type)}</td><td>${esc(p.signal)}</td><td class="clip" title="${esc(p.rule)}">${esc(p.rule)}</td><td class="c">${first ? (cnt ? `${cnt}건` : '-') : ''}</td></tr>`; }).join('');
  return `<div class="pg pg-base">${pageHead('기준정보', '관리', '현장 장비 값을 어디에서 읽어 어떤 신호로 바꾸는지 정한 수집 포인트입니다. 연결 프로그램(tools/io_bridge)이 이 표대로 읽습니다.', `<span class="badge n rdonly">🔒 조회 전용</span>${adminRow()}`)}${baseTabs()}
  <section class="panel ioroutes">
    <div class="iort m"><img src="${ph.io_modbus || ''}" alt=""><div><b>개별 장비 · LS XGT PLC · Modbus TCP</b><span>${ioEqs('MODBUS').length}대 · 장비 IP:502 · Coil 00001 가동 / DI 10001 이상 / HR 40001 누적 수량</span></div></div>
    <div class="iort e"><img src="${ph.io_etos || ''}" alt=""><div><b>집약 라우팅 장비 · AC&T ETOS · XGT FEnet(IP)</b><span>${ioEqs('ETOS').length}대 · ETOS-100XP 192.168.20.10:2004 · 설비마다 %MW 3개(가동 · 누적 수량 · 이상)</span></div></div>
    <div class="iort x"><div><b>두 경로 모두 같은 서버 입구</b><span>tp_ingest_signal → 규칙 R1~R7 → DB → 화면 5개 · <button class="lnk" data-act="ioOpen">연결 구조도 ›</button></span></div></div></section>
  <section class="panel pglist"><div class="ph"><h2>수집 포인트</h2><span class="sub">설비 ${new Set(S.io.map(p => p.equipment_id)).size}대 · 포인트 ${S.io.length}개 · IP·주소는 가상 기준정보 · PLC 사진은 HIET 현장 사진, ETOS는 AC&T 카탈로그 · 시연 중 읽기 전용</span><button class="btn line" data-act="csv" data-arg="baseIo">⭳ 엑셀(CSV)</button></div>
    <div class="tw"><table><thead><tr><th>설비</th><th>경로</th><th>접속 주소</th><th class="c">Unit</th><th>주소</th><th>형식</th><th>만드는 신호</th><th>변환 규칙</th><th class="c">받은 신호</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
}

Object.assign(VIEW_RENDER, { base: (r => () => UI.sub.base === 'io' ? viewBaseIo() : r())(VIEW_RENDER.base) });
Object.assign(ACT, {
  ioOpen() { UI.ioModal = true; render(); },
  ioClose() { UI.ioModal = false; render(); },
  ioPts() { UI.ioModal = false; UI.sub.base = 'io'; ACT.go('base'); },
});
