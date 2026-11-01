// 브라우저 자동 테스트: 실제 화면(dist/twinpro_test.html)을 띄우고, 서버(로컬 Postgres, Supabase와 같은 SQL)에 붙여 시연 시나리오를 클릭으로 진행한다.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { makeServer } = require('./lib_local.js'); const fs = require('fs'); const path = require('path');
const OUT = 'shots'; fs.mkdirSync(OUT, { recursive: true });
const results = []; let n = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + JSON.stringify(detail) : '')); };
(async () => {
  const srv = await makeServer();
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] }); const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.exposeFunction('__tpLoad', () => srv.load()); await page.exposeFunction('__tpRpc', (fn, args, code) => srv.rpc(fn, args, code)); await page.exposeFunction('__tpAi', (code, mode) => srv.ai(code, mode));
  const CODE = JSON.parse(fs.readFileSync('config.json')).demo_code; const sr = (fn, a) => srv.rpc(fn, a, CODE);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2eIntro')) localStorage.setItem('tpIntroSeen', '1'); } catch (e) {} window.TP_GLB = 'https://test.local/twinpro_shipyard.glb'; window.__TP_TEST_API = { load: () => window.__tpLoad(), rpc: (f, a, c) => window.__tpRpc(f, a, c), ai: (c, m) => window.__tpAi(c, m) }; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/, r => r.fulfill({ path: 'node_modules/three/' + r.request().url().match(/three@0\.160\.0\/(.*)$/)[1], contentType: 'application/javascript' }));
  await page.route('https://test.local/twinpro_shipyard.glb', r => r.fulfill({ path: process.env.TP_GLB_FILE || require('path').resolve('../twinpro_shipyard.glb'), contentType: 'model/gltf-binary' }));
  await page.goto('file://' + path.resolve('dist/twinpro_test.html') + '#dash'); await page.waitForSelector('.sbar');
  const kv = async () => page.$$eval('.sbar .kpi', ks => Object.fromEntries(ks.map(k => [k.querySelector('span').textContent, [...k.querySelector('b').childNodes].filter(n => !(n.nodeType === 1 && ['SMALL', 'EM'].includes(n.tagName))).map(n => n.textContent).join('').trim()])));
  const server = async () => (await srv.db.query('select * from tp_v_kpi')).rows[0];
  const shot = async (name) => { n++; const f = `${OUT}/${String(n).padStart(2, '0')}_${name}.png`; await page.screenshot({ path: f }); return f; };
  const click = async sel => { await page.click(sel); if (sel.includes('.grail')) await page.mouse.move(900, 300); await page.waitForTimeout(sel.includes('.grail') ? 300 : 150); };   // 사이드바를 누른 뒤에는 마우스를 치운다(펼친 사이드바가 내용을 가리지 않게)
  const toast = async () => { await page.waitForSelector('#toast:not([hidden])'); const t = await page.$eval('#toast', t => t.textContent); await page.$eval('#toast', t => { t.hidden = true; }); return t; };
  const reloadDash = async () => {
    const had = await page.evaluate(() => { history.replaceState(null, '', '#dash'); return sessionStorage.getItem('tpDemoCode') || ''; });
    await page.reload(); await page.waitForSelector('.sbar');
    // file:// 주소에서는 새로고침 때 sessionStorage가 가끔 비는 일이 있어(테스트 환경 한정) 있던 시연 코드를 다시 넣고 한 번 더 연다
    if (had && !(await page.evaluate(() => sessionStorage.getItem('tpDemoCode')))) { await page.evaluate(c => sessionStorage.setItem('tpDemoCode', c), had); await page.reload(); await page.waitForSelector('.sbar'); }
    await page.waitForFunction(() => !sessionStorage.getItem('tpDemoCode') || UI.canWrite); await page.waitForTimeout(100); };
  const nav = async v => { if (await page.isVisible('.grail')) return click(`.grail .gri[data-arg="${v}"]`);   // 좁은 화면(휴대폰)은 위쪽 탭·[관리 화면 ▾]
    if (v === 'dash') return click('.gtabs button[data-arg="dash"]'); await click('.gmenu summary'); await click(`.gmenu button[data-arg="${v}"]`); };
  // 관리 화면은 메뉴로 들어오면 [그림] 보기가 먼저 열린다. 기존 시나리오(표·편집)는 [표] 보기로 바꿔 진행한다
  const go = async (v, mode = 'table') => { await nav(v); if (await page.$(`[data-act="mode"][data-arg="${v}:${mode}"]`)) await click(`[data-act="mode"][data-arg="${v}:${mode}"]`); };   // 사이드바를 누른 뒤 마우스를 치워 펼친 사이드바가 내용을 가리지 않게
  const step = async k => { await click(`.pv-pc.on [data-act="priStep"][data-arg$=":${k}"]`); return toast(); };   // 사건 처리 단계 = 작업 관리 우선순위 카드
  const pick = async id => { await go('dash'); await click(`.pmi[data-arg="${id}"]`); await page.waitForSelector('.pv-pc.on'); };   // 관제 '처리 순서' → 작업 관리(그 사건 선택)
  const card = () => page.textContent('.pv-pc.on');
  const fclick = sel => page.$eval(sel, e => e.click());   // 3D 도구줄: 소프트웨어 렌더링(테스트 환경)은 3D 그리기로 화면 갱신이 밀려 Playwright 클릭 대기가 멈추므로 DOM에서 바로 누름
  const wo = async id => (await srv.db.query('select * from tp_work_orders where work_order_id=$1', [id])).rows[0];
  const sync = async (label) => { const k = await kv(), s = await server(); const stopped = await page.$$eval(".node", ns => ns.filter(x => /\b(r|o)\b/.test(x.className)).length);
    const ok = k['설비 가동'] === `${s.eq_running} / ${s.eq_total}` && +k['미해결 사건'] === +s.open_incidents && +k['멈춘 작업'] === stopped;
    check(`[${label}] 관제 KPI = 서버 값`, ok, { 화면: k, 서버: { run: s.eq_running, total: s.eq_total, open: s.open_incidents } }); };

  // 1. 초기값 = 01H 원본
  const k0 = await kv();
  check('초기 KPI: 진행률 74%/100%·멈춘 작업 3·미해결 3·설비 가동 2/8', k0['진행률 (실적 / 계획)'] === '74%' && k0['멈춘 작업'] === '3' && k0['미해결 사건'] === '3' && k0['설비 가동'] === '2 / 8', k0);
  const rail = await page.$$eval('.grail .gri', bs => bs.map(b => b.querySelector('span').textContent));
  await page.hover('.grail .gri[data-arg="eq"]'); await page.waitForTimeout(300); const railW = await page.$eval('.grail', e => e.getBoundingClientRect().width), tip = await page.isVisible('.grail .gri[data-arg="eq"] span'), other = await page.isVisible('.grail .gri[data-arg="prod"] span'); await page.mouse.move(900, 300); await page.waitForTimeout(300);
  check('왼쪽 아이콘 사이드바: 통합 관제 · 관리 4 · AI 운영 센터 · 3D 3 · 안내 순서, 폭은 늘 56px(내용을 가리지 않음) · 마우스 올린 아이콘 옆에만 이름표, 통합 관제에 미해결 3 배지, 위쪽 탭은 숨김', rail.join('|').startsWith('통합 관제미해결 사건 3건|설비 상태|생산 현황|작업 관리|기준정보|AI 운영 센터모델 비교|3D 조선소|블록 내부 3D|공정 교육 재생|안내') && railW === 56 && tip && !other && (await page.textContent('.grail .gbadge')) === '3' && !(await page.isVisible('.gbar .gtabs')) && (await page.$eval('.content', e => e.getBoundingClientRect().left)) >= 56, { rail, railW, tip, other });
  const counts = (await srv.db.query(`select (select count(*) from tp_work_orders) wo,(select count(*) from tp_production_actual) act,(select count(*) from tp_work_history) his,(select count(*) from tp_incidents) inc,(select count(*) from tp_inspections) qc,(select count(*) from tp_production_plan) plan,(select count(*) from tp_blocks) blk,(select count(*) from tp_equipment) eq,(select count(*) from tp_status_codes) sc,(select count(*) from tp_equipment_intervals where interval_id <= 'INT0201') intv,(select count(*) from tp_zones) z,(select count(*) from tp_processes) p,(select count(*) from tp_vessels) v,(select count(*) from tp_rework) rw,(select count(*) from tp_equipment_snapshot) snap`)).rows[0];
  const raw = JSON.parse(fs.readFileSync('data.json')); const exp = { wo: raw.work_orders.length, act: raw.production_actual.length, his: raw.work_history.length, inc: raw.incidents.length, qc: raw.inspections.length, plan: raw.production_plan.length, blk: raw.blocks.length, eq: raw.equipment.length, sc: raw.status_codes.length, intv: raw.equipment_intervals.length, z: raw.zones.length, p: raw.processes.length, v: raw.vessels.length, rw: raw.rework.length, snap: raw.equipment_snapshot.length };
  check('엑셀 15개 시트 행 수 = DB 행 수', Object.keys(exp).every(k => +counts[k] === exp[k]), { DB: counts, 엑셀: exp });
  const occ = await srv.db.query("select occupancy_pct from tp_v_occupancy where equipment_id='EQ03'");
  await go('eq'); const occUi = await page.$eval('.eqc.sel .occ small', e => e.textContent);
  check('EQ03 점유율 40.1% (화면 = 서버)', occUi === '40.1%' && +occ.rows[0].occupancy_pct === 40.1, { 화면: occUi, 서버: occ.rows[0].occupancy_pct });
  check('설비 상태: 사건 처리는 작업 관리 우선순위에서만(조치·해소·복구 버튼 없음)', !(await page.$('[data-act="recordAction"],[data-act="resolve"],[data-act="restore"]')) && (await page.textContent('#content')).includes('작업 관리에서 처리'));
  await go('dash'); await sync('초기'); await shot('dash_initial');
  { const tl = await page.textContent('.tlpanel'), cards = await page.$$eval('.dmap .node .gauge text', ts => ts.map(t => t.textContent)), arts = await page.$$eval('.dmap .dart', is => is.filter(i => i.src.startsWith('data:image/webp')).length);
    check('관제 지도: 공정 카드 게이지 6개(03 = 62.5) + 설비 그림 6개(3D 모델 렌더, 투명 배경) + 대기·예비 설비 2 / 타임라인: 6행 · 설비 고장 표시 · 지금 12:00 선', cards.length === 6 && cards[2] === '62.5%' && arts === 6 && (await page.$$('.dmap .spare')).length === 2 && (await page.$$('.tlb')).length === 6 && tl.includes('설비 고장') && tl.includes('12:00'), { cards, arts }); }
  { const pm = await page.$$eval('.pmi', b => b.map(x => x.dataset.arg)), tabs = await page.$$('.sidecard .ptabs'), btns = await page.$$eval('.sidecard > .ph button', b => b.map(x => x.textContent.trim()));
    check('관제 지금 확인할 것: 탭 없음 · 버튼 하나 [작업 관리 ›] · AI 요약(생성 전에는 규칙 문장 표시) · 처리 순서 INC003 → INC004 → INC005', !tabs.length && btns.join() === '작업 관리 ›' && (await page.textContent('.sidecard .ai-box')).includes('AI 운영 요약') && pm.join() === 'INC003,INC004,INC005', { pm, btns }); }
  const nodes0 = await page.$$eval('.node', ns => ns.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('연결망 노드 6개: B008 정지·INC003, B009 자재 대기, B007 품질 보류', nodes0.length === 6 && nodes0.some(x => /B008/.test(x) && /정지/.test(x) && /INC003/.test(x)) && nodes0.some(x => /B009/.test(x) && /자재 대기/.test(x)) && nodes0.some(x => /B007/.test(x) && /품질 보류/.test(x)), nodes0);

  // 1-1. 보안: 코드 없이 저장 거부 / 직접 쓰기·잘못된 코드 거부 → 코드 입력 후 가능
  const nc = await page.evaluate(() => window.__TP_TEST_API.rpc('tp_advance_clock', { p_min: 10 }, null)); check('보안: 시연 코드 없이 저장 거부', !nc.ok && /시연 코드가 필요/.test(nc.msg), nc.msg);
  const wrong = await srv.rpc('tp_reset_demo', {}, '0000'); check('보안: 잘못된 시연 코드로 초기화 거부', !wrong.ok, wrong.msg);
  const noHdr = await srv.rpc('tp_incident_step', { p_inc: 'INC003', p_step: 'check', p_eq: null }, null); check('보안: 헤더 없는 처리 단계 RPC 거부', !noHdr.ok, noHdr.msg);
  await click('[data-act="codeOpen"]'); await page.fill('#codeIn', CODE); await click('[data-act="codeSave"]'); let t0 = await toast(); check('보안: 시연 코드 확인 후 조작 가능', /확인되었습니다/.test(t0) && (await page.textContent('.gbar')).includes('조작 가능'), t0);
  const sp = await srv.db.query("select count(*) c from pg_proc p where p.proname like 'tp\\_%' and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) x where x like 'search_path=%')");
  check('보안: 모든 tp_ 함수 search_path 고정', +sp.rows[0].c === 0, sp.rows[0]);

  // 2. 거부 전이(서버가 막아야 함)
  const r4 = await sr('tp_restore_equipment', { p_eq: 'EQ03' }); check('R4 거부: 미해소 사건 있으면 복구 불가', !r4.ok && /미해소라 복구할 수 없습니다/.test(r4.msg), r4.msg);
  const r3 = await sr('tp_resolve_incident', { p_inc: 'INC003' }); check('R3 거부: 조치 기록 없으면 해소 불가', !r3.ok && /조치 기록/.test(r3.msg), r3.msg);
  await go('wo'); await page.selectOption('#woDate', ''); await page.fill('#woQ', 'WO008-03'); await page.waitForTimeout(150); await click('tr[data-arg="WO008-03"]');
  await click('.seg button[data-arg="IN_PROGRESS"]'); await click('[data-act="woSave"]'); let t = await toast(); check('R5 거부: 보류 사유 미해소면 재개 불가', /미해소입니다/.test(t), t);
  check('작업 관리: 미해결 사건이 걸린 작업은 설비 칸 잠금 + [관제에서 처리]', !(await page.$('#woEq')) && (await page.textContent('.form')).includes('INC003 미해결') && !!(await page.$('.form [data-act="goInc"]')));
  const r7a = await sr('tp_save_work_order', { p_wo: 'WO008-03', p_eq: 'EQ08', p_status: null, p_qty: null, p_hold: null, p_memo: null }); check('R7 거부: 점검 설비 배정 불가 + 한 트랜잭션 취소', !r7a.ok && /점검 상태라 배정할 수 없습니다/.test(r7a.msg) && (await wo('WO008-03')).equipment_id === 'EQ03', r7a.msg);
  const r7b = await sr('tp_change_equipment', { p_wo: 'WO008-03', p_eq: 'EQ07' }); check('R7 거부: 사건 걸린 작업은 승인 전 설비 변경 불가', !r7b.ok && /관리자 승인/.test(r7b.msg), r7b.msg);
  const r1 = await sr('tp_register_fault', { p_eq: 'EQ03', p_summary: 'x', p_severity: 'HIGH' }); check('R1 거부: 이미 고장인 설비 중복 등록', !r1.ok, r1.msg);
  await shot('wo_reject');

  // 2-1. 비정상 전이 추가(P1-2)
  const ab = [
    ['tp_save_work_order', { p_wo: 'WO010-01', p_eq: null, p_status: 'IN_PROGRESS', p_qty: null, p_hold: null, p_memo: null }, /완료 상태에서는/, '완료된 작업 재개 거부'],
    ['tp_record_progress', { p_wo: 'WO010-01', p_qty: 70 }, /진행 중인 작업만/, '완료된 작업 수량 수정 거부'],
    ['tp_save_work_order', { p_wo: 'WO011-01', p_eq: null, p_status: 'COMPLETED', p_qty: 84, p_hold: null, p_memo: null }, /진행 중인 작업만 완료/, '미래 계획 작업 조기 완료 거부'],
    ['tp_resume_work', { p_wo: 'WO008-04' }, /선행 작업 WO008-03/, '선행 작업 미완료 시 착수 거부'],
    ['tp_record_progress', { p_wo: 'WO006-05', p_qty: 100 }, /줄일 수 없습니다/, '인정수량 감소 거부'],
    ['tp_record_progress', { p_wo: 'WO006-05', p_qty: -1 }, /0 이상/, '음수 수량 거부'],
    ['tp_advance_clock', { p_min: 300 }, /1~240분/, '시계 비정상 진행 거부'],
    ['tp_incident_step', { p_inc: 'INC003', p_step: 'check', p_eq: null }, /1단계 고장 확인/, '처리 단계 건너뛰기 거부(고장 확인 전 대체 확인)'],
    ['tp_incident_step', { p_inc: 'INC004', p_step: 'check', p_eq: null }, /설비 고장 사건에서만/, '자재 사건에 대체 설비 단계 거부'],
  ];
  for (const [fn, a, re, name] of ab) { const r = await sr(fn, a); check('P1-2 ' + name, !r.ok && re.test(r.msg), r.msg); }

  // 3. 시연 시나리오: 사건 선택 → 7단계(고장 확인 → 대체 가능 → 적합성 → 승인 → 설비 변경 → 재개) → 사건은 열린 채 → 복구 후 종료
  await sr('tp_advance_clock', { p_min: 10 }); await reloadDash();
  check('시연 시각 12:10', (await page.textContent('.clock')).includes('12:10'));
  await pick('INC003');
  const p0 = await card();
  check('관제 처리 순서 → 작업 관리 우선순위(INC003 선택): 근거 경로(사건→작업→설비) + 관련 가능성(INC005, 확인 필요) + 왜 멈췄나요(1시간 40분째)', (await page.textContent('.pghead h1')).includes('작업 관리') && /INC003/.test(p0) && /WO008-03/.test(p0) && /관련 가능성/.test(p0) && /INC005/.test(p0) && /1시간 40분째/.test(p0), p0.slice(0, 300));
  check('처리 단계 7개, 1단계만 열림', (await page.$$eval('.pv-pc.on .pv-steps li', l => l.map(x => x.className))).join() === 'on,,,,,,', await page.$$eval('.pv-pc.on .pv-steps li', l => l.map(x => x.className)));
  await go('dash'); check('관제 지도: 고른 사건의 작업(B008) 강조 + 관련 가능 작업 표시', !!(await page.$('.node.sel')) && !!(await page.$('.node.rel')));
  check('노드 선택 → 상세 + [내부 현황 (3D)] 버튼 하나(3D 조선소 위치 버튼 없음)', (await page.textContent('.ndet')).includes('B008 상세') && !(await page.$('.ndet [data-act="go3d"]')) && (await page.$$('.ndet button')).length === 1 && (await page.textContent('.ndet [data-act="bkOpen"]')).includes('내부 현황 (3D)'));
  await pick('INC003'); await click('.pv-pc.on [data-act="figOpen"]'); await page.waitForSelector('.figmodal'); await page.waitForTimeout(300); await shot('fig_eq03');
  check('고장 부위 설명도(Anatomy): 경보 상태 + 읽기값 102.5 / 164 m', (await page.$eval('.figmodal .iso-stage', e => e.dataset.eq)) === 'fault' && (await page.textContent('.figmodal [data-readout]')).includes('102.5 / 164 m') && (await page.textContent('.figmodal')).includes('ALM 31'));
  await page.focus('.figmodal .eqx-stage'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  if (!(await page.$eval('.figmodal .eqx-stage', e => e.classList.contains('is-apart')))) { await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }   // 자동 반복이 이미 분해한 순간이면 한 번 더
  await page.waitForFunction(() => document.querySelector('.figmodal [data-readout]').textContent.includes('늑판-03'), null, { timeout: 5000 }).catch(() => {});   // 스프링이 멈출 때까지
  await shot('fig_eq03_apart');
  check('설명도 동작: Enter → 용접 끝난 부재 분해, 늑판-03에서 멈춤 표시', (await page.$eval('.figmodal .eqx-stage', e => e.classList.contains('is-apart'))) && (await page.textContent('.figmodal [data-readout]')).includes('늑판-03'), await page.evaluate(() => document.querySelector('.figmodal .eqx-stage').className + ' | ' + document.querySelector('.figmodal [data-readout]').textContent + ' | ' + document.activeElement.className));
  await page.keyboard.press('Escape'); check('설명도 닫기(Esc)', !(await page.$('.figmodal')));
  for (const [id, want] of [['INC004', '2 / 8 set · 부재 입고 대기'], ['INC005', '합격 8 / 10곳 · 보수 완료, 재검사 대기']]) {
    await pick(id); await click('.pv-pc.on [data-act="figOpen"]'); await page.waitForSelector('.figmodal'); await page.waitForTimeout(300); await shot(`fig_${id}`);
    check(`${id} 상황 설명도: 보류 상태(주황) + 읽기값 "${want}"`, (await page.$eval('.figmodal .iso-stage', e => e.dataset.eq)) === 'hold' && (await page.textContent('.figmodal [data-readout]')).includes(want) && (await page.textContent('.figmodal h2')).includes('상황 설명도'));
    await page.keyboard.press('Escape');
  }
  await pick('INC003');
  await page.fill('#wizNote', '전원장치 경보 확인, 정비조 점검 시작'); t = await step('act'); check('1 고장 확인 = 조치 기록(상태 변화 없음)', /조치를 기록/.test(t) && (await server()).eq_fault == 1 && (await server()).open_incidents == 3, t);
  t = await step('check'); check('2 대체 가능 여부: 후보 EQ07, EQ08은 점검으로 제외', /대체 후보 EQ07/.test(t) && /EQ08 제외\(점검 중\)/.test(t), t);
  const cand = await page.textContent('.cand'); check('3 적합성 카드: WPS·출력·자격 적합, 위치 조건부 15분, EQ08 제외', /WPS/.test(cand) && /출력/.test(cand) && /작업자 자격/.test(cand) && /이동 15분/.test(cand) && /조건부/.test(cand) && /제외: EQ08/.test(cand), cand);
  await go('dash'); check('대기·예비 설비: EQ07 "대체 가능 여부 미확인" 아님 → 확인 중 강조', !!(await page.$('.spare.sel'))); await pick('INC003');
  t = await step('fit'); check('3 적합성 확인 기록', /EQ07 적합성 확인/.test(t), t);
  await go('dash'); check('대기·예비 설비: EQ07 대체 적합 · 승인 필요', (await page.textContent('.spares')).includes('대체 적합 · 승인 필요')); await pick('INC003');
  t = await step('approve'); check('4 관리자 승인(생산관리)', /생산관리 승인/.test(t), t);
  t = await step('swap'); const w8 = await wo('WO008-03'); check('5 설비 변경: WO008-03 → EQ07(남은 작업만, 실적 102.5 유지)', /EQ07로 바꿨습니다/.test(t) && w8.equipment_id === 'EQ07' && +w8.accepted_qty === 102.5, t);
  t = await step('resume'); const inc3 = (await srv.db.query("select status from tp_incidents where incident_id='INC003'")).rows[0].status;
  check('6 작업 재개: EQ07 가동, INC003은 열린 채 유지', /재개했습니다/.test(t) && (await wo('WO008-03')).status === 'IN_PROGRESS' && inc3 === 'OPEN', { t, inc3 });
  const his = (await srv.db.query("select event_type, note from tp_work_history where work_order_id='WO008-03' and source='demo' order by history_id")).rows;
  check('작업 이력: 설비 변경 사유·승인자·시각 기록', his.some(h => h.event_type === 'REASSIGN' && /사유 INC003/.test(h.note) && /승인 생산관리 12:10/.test(h.note) && /남은 작업 61.5 m/.test(h.note)), his);
  await go('dash'); await sync('대체 재개 후'); const k3 = await kv();
  check('관제: 설비 가동 3/8 · 미해결 3 (사건은 복구 전까지 유지)', k3['설비 가동'] === '3 / 8' && k3['미해결 사건'] === '3', k3);
  const c3 = await page.$eval('.node[data-arg="WO008-03"]', e => e.innerText); const sp3 = await page.textContent('.spares');
  check('혼재 상태: 03 노드 = 배정 설비 EQ07 가동, EQ03 고장·EQ08 점검은 대기·예비 설비에 표시', /가동/.test(c3) && /EQ07/.test(c3) && /EQ03 용접 작업셀/.test(sp3) && /고장/.test(sp3) && /EQ08 예비 용접기/.test(sp3) && /점검/.test(sp3), { c3, sp3 });
  await shot('dash_substituted'); await pick('INC003');
  t = await step('close'); const sv7 = await server();
  check('7 설비 복구 후 사건 종료: EQ03 대기, INC003 해소, 미해결 2', /사건을 종료/.test(t) && sv7.eq_fault == 0 && sv7.open_incidents == 2 && !(await page.$$eval('.pv-pc .pv-pt small', e => e.map(x => x.textContent).join())).includes('INC003'), { t, fault: sv7.eq_fault, open: sv7.open_incidents });
  await go('dash'); await sync('사건 종료 후');
  await page.evaluate(() => ACT.figOpen('INC003')); await page.waitForSelector('.figmodal'); check('설명도: 복구 후 경보 꺼짐(READY · EQ03 복구)', (await page.$eval('.figmodal .iso-stage', e => e.dataset.eq)) === 'ok' && (await page.textContent('.figmodal [data-readout]')).includes('EQ03 복구')); await click('.figmodal [data-act="figClose"]');
  await go('prod'); const b8 = await page.$eval('.bchip[data-arg="B008"]', e => e.innerText); check('생산 현황: B008 작업 상태 진행', /진행/.test(b8), b8);

  // 4. 실적 → 완료 (R6)
  await go('wo'); await page.fill('#woQ', 'WO008-03'); await page.waitForTimeout(150); await click('tr[data-arg="WO008-03"]');
  await page.fill('#woQty', '200'); await click('[data-act="woSave"]'); t = await toast(); check('R6 거부: 계획수량 초과', /넘을 수 없습니다/.test(t), t);
  await page.fill('#woQty', '164'); await click('[data-act="woSave"]'); t = await toast(); check('R6 완료: 계획수량 도달 → 완료, EQ07 대기', /완료했습니다/.test(t) && (await server()).today_done == 3, t);
  await go('dash'); await sync('완료 후');
  await go('prod'); const pa = await page.$$eval('.pa .h', h => h.map(x => x.innerText)); check('생산: 블록 용접 실적 1088/1088 m 100%', pa.some(x => /블록 용접/.test(x) && /1,088 \/ 1,088 m 100%/.test(x)), pa);

  // 5. 역방향: EQ05 고장 등록 → WO006-05 보류 → 관제 사건 목록
  await go('eq'); await click('.eqc[data-arg="EQ05"]'); await click('[data-act="faultForm"]'); await page.fill('#faultSum', '도장 펌프 압력 저하'); await click('[data-act="registerFault"]'); t = await toast();
  check('R1 고장 등록: 사건 생성 + 진행 작업 보류', /INC006/.test(t) && /WO006-05/.test(t), t);
  await go('dash'); await sync('EQ05 고장 후'); check('관제 처리 순서에 INC006 표시', !!(await page.$('.pmi[data-arg="INC006"]')));
  await shot('dash_eq05_fault');
  await pick('INC006'); check('대체 후보 없는 설비 고장: 고장 확인 → 복구·종료 → 재개 3단계', (await page.$$('.pv-pc.on .pv-steps li')).length === 3 && (await page.textContent('.pv-pc.on .pv-steps')).includes('설비 복구 후 사건 종료'));

  // 6. 품질 사건 해소(관제 사건 패널) → 검사 합격률 7/8
  await pick('INC005'); await page.fill('#wizNote', '보수 2개 위치 재검사 합격'); await step('act'); await step('resolve');
  await go('prod'); const q = await page.$$eval('.grid .panel', p => p.map(x => x.innerText).find(x => x.includes('검사 합격률'))); check('품질 사건 해소 → 검사 합격률 7/8 차수', /7 \/ 8차수/.test(q), q);

  // 7. 기준정보: 시연 중 읽기 전용 + 대체 적합성 표시
  await go('base'); check('기준정보: 시연 중 읽기 전용(공정명 입력·저장 없음)', !(await page.$('#procName')) && !(await page.$('[data-act="procSave"]')) && (await page.textContent('#content')).includes('읽기 전용'));
  await click('[data-arg="base:eq"]'); const eq7 = await page.$eval('tr[data-arg="EQ07"]', e => e.innerText); check('기준정보 설비: EQ07 "03 공정 대체 후보 · 적합성 확인 필요"', /03 공정 대체 후보 · 적합성 확인 필요/.test(eq7), eq7);

  // 8. CSV: 현재 필터 결과와 일치 + 한글
  await go('wo'); await page.selectOption('#woDate', ''); await page.fill('#woQ', 'B008'); await page.waitForTimeout(150);
  const [dl] = await Promise.all([page.waitForEvent('download'), click('[data-act="csv"][data-arg="wo"]')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
  const rowsUi = await page.$$eval('table tbody tr[data-act="selWo"]', r => r.length); const lines = csv.trim().split('\r\n');
  check('CSV = 현재 필터 결과(B008) + 한글 정상', lines.length - 1 === 6 && rowsUi === 6 && csv.charCodeAt(0) === 0xFEFF && lines[0].includes('작업지시'), { csv행: lines.length - 1, 화면행: rowsUi, 첫줄: lines[0] });

  // 8-1. 서버 기록(event_log) = 화면 표시 건수, 설비 목록 정렬 고정
  await go('dash'); const evDb = +(await srv.db.query('select count(*) c from tp_event_log')).rows[0].c; const evUi = await page.$eval('#content', c => +(c.innerText.match(/이번 시연 변경 (\d+)건/) || [])[1]);
  check('서버 기록(event_log) 행 수 = 화면 표시', evDb > 0 && evDb === evUi, { DB: evDb, 화면: evUi });
  await go('eq'); const order = await page.$$eval('.eqc[data-act="selEq"]', r => r.map(x => x.dataset.arg)); check('설비 목록 정렬 EQ01~EQ08 고정(상태 변경 후)', JSON.stringify(order) === JSON.stringify(['EQ01','EQ02','EQ03','EQ04','EQ05','EQ06','EQ07','EQ08']), order);

  // 9. 구간 정합성
  const bad = await srv.db.query(`select a.interval_id from tp_equipment_intervals a join tp_equipment_intervals b on a.equipment_id=b.equipment_id and a.interval_id<b.interval_id and a.start_at < coalesce(b.end_at,'2100-01-01') and b.start_at < coalesce(a.end_at,'2100-01-01') union all select interval_id from tp_equipment_intervals where end_at < start_at`);
  const open = await srv.db.query('select equipment_id, count(*) c from tp_equipment_intervals where end_at is null group by 1 having count(*) <> 1');
  check('설비 구간: 겹침·역전 0, 설비마다 열린 구간 1개', bad.rows.length === 0 && open.rows.length === 0, { bad: bad.rows, open: open.rows });

  // 10. 초기화 → 원본 재현 → 같은 시나리오 재실행 결과 동일
  await go('base'); await click('[data-act="reset"]'); await click('[data-act="reset"]'); await toast(); await go('dash'); const kr = await kv();
  check('초기화 후 01H 원본 KPI 재현 + 처리 단계 기록 삭제', JSON.stringify(kr) === JSON.stringify(k0) && +(await srv.db.query('select count(*) c from tp_incident_steps')).rows[0].c === 0, kr);
  await sr('tp_advance_clock', { p_min: 10 }); await sr('tp_record_action', { p_inc: 'INC003', p_note: '재실행', p_owner: null });
  for (const [k, e] of [['check', null], ['fit', 'EQ07'], ['approve', 'EQ07'], ['swap', 'EQ07'], ['resume', null]]) await sr('tp_incident_step', { p_inc: 'INC003', p_step: k, p_eq: e });
  await reloadDash(); const k5 = await kv(); check('초기화 후 같은 시나리오 재실행 = 1차 결과와 동일', JSON.stringify(k5) === JSON.stringify(k3), { 재실행: k5, '1차': k3 });
  // 12. 동시 요청: 같은 작업 재개 2건 동시 → 1건만 성공
  await sr('tp_reset_demo', {}); await sr('tp_record_action', { p_inc: 'INC004', p_note: '부재 입고', p_owner: null }); await sr('tp_resolve_incident', { p_inc: 'INC004' });
  const both = await Promise.all([sr('tp_resume_work', { p_wo: 'WO009-02' }), sr('tp_resume_work', { p_wo: 'WO009-02' })]);
  const runs = +(await srv.db.query("select count(*) c from tp_equipment_intervals where equipment_id='EQ02' and end_at is null")).rows[0].c;
  check('동시 요청: 같은 재개 2건 → 1건 성공·1건 거부, 열린 구간 1개', both.filter(x => x.ok).length === 1 && runs === 1, both.map(x => x.msg));
  // 13. AI 운영 요약: 코드 필요 · 생성 → 모든 화면 표시 · 하루 10회 제한
  const aiTab = async () => { await reloadDash(); };   // AI 요약은 관제 오른쪽 카드에 늘 보임(탭 없음)
  await sr('tp_reset_demo', {}); await aiTab();
  check('AI: 생성 전 안내 + 남은 10/10', (await page.textContent('.ai-box')).includes('아직 생성하지 않음') && (await page.textContent('[data-act="aiGen"]')).includes('남은 10회'));
  const aiNo = await srv.ai('0000'); check('AI: 잘못된 시연 코드면 생성·차감 안 함', !aiNo.ok && +(await srv.db.query('select coalesce(sum(used),0) n from tp_ai_usage')).rows[0].n === 0, aiNo.msg);
  await page.waitForSelector('[data-act="aiGen"]:not([disabled])'); await click('[data-act="aiGen"]'); t = await toast(); await page.waitForSelector('#aiText');
  check('AI: 생성 → 서버 저장 → 대시보드 표시, 남은 9/10', /남은 횟수 9\/10/.test(t) && (await page.textContent('#aiText')).includes('미해소 사건 3건') && (await page.textContent('[data-act="aiGen"]')).includes('남은 9회'), t);
  await sr('tp_advance_clock', { p_min: 5 }); await aiTab();
  check('AI: 이후 변경이 생기면 "이후 변경 있음" 표시', (await page.textContent('.ai-box')).includes('이후 변경 있음'));
  for (let i = 0; i < 9; i++) await srv.ai(CODE);
  const ai6 = await srv.ai(CODE); await aiTab();
  check('AI: 하루 10회 초과 거부 + 버튼 비활성(0/10)', !ai6.ok && /10회를 모두/.test(ai6.msg) && await page.$eval('[data-act="aiGen"]', b => b.disabled) && (await page.textContent('[data-act="aiGen"]')).includes('남은 0회'), ai6.msg);
  await shot('dash_ai');

  // 14. 가상 설비 신호: 규칙을 거쳐 반영·거부, 자동 재생
  await sr('tp_reset_demo', {}); await reloadDash(); await go('eq'); await click('[data-arg="eq:sig"]');
  await page.selectOption('#sigEq', 'EQ05'); await page.selectOption('#sigType', 'COUNT'); await page.fill('#sigVal', '30'); await click('[data-act="sendSignal"]'); t = await toast();
  const q5 = +(await wo('WO006-05')).accepted_qty;
  check('신호 COUNT: EQ05 +30 → WO006-05 실적 반영(R6)', /신호 EQ05 COUNT 30/.test(t) && q5 === 252, { t, q5 });
  await page.selectOption('#sigEq', 'EQ03'); await page.selectOption('#sigType', 'RUN'); await click('[data-act="sendSignal"]'); t = await toast();
  check('신호 RUN: 고장 설비 EQ03 가동 신호 거부(R4·R5)', /고장 상태입니다/.test(t) && (await page.$$eval('.panel table tbody tr', r => r.map(x => x.innerText))).some(x => /EQ03/.test(x) && /거부/.test(x)), t);
  await page.selectOption('#sigEq', 'EQ05'); await page.selectOption('#sigType', 'FAULT'); await click('[data-act="sendSignal"]'); t = await toast();
  check('신호 FAULT: 사건 생성 + 작업 보류(R1)', /INC006/.test(t) && (await server()).eq_fault == 2, t);
  await sr('tp_reset_demo', {}); await reloadDash(); await click('[data-act="speed"][data-arg="4"]'); await go('eq'); await click('[data-arg="eq:sig"]');
  await click('[data-act="simToggle"]'); await page.waitForTimeout(5200); await click('[data-act="simToggle"]');
  const sc = (await server()).sim_now.toISOString().slice(11, 16), sigN = +(await srv.db.query("select count(*) c from tp_signal_log where signal='COUNT' and ok")).rows[0].c;
  check('자동 재생(4× = 2.5초마다 5분): 시각 진행 + 가동 설비 카운트 자동 반영', sc >= '12:10' && sigN >= 2, { sc, sigN });
  await shot('eq_signal');

  // 15. 실적 가져오기(CSV): 미리 확인 → 서버 반영 / 한 행 위반 시 전체 취소 / 없는 작업지시는 반영 버튼 비활성
  await sr('tp_reset_demo', {}); await reloadDash(); await go('wo');
  await click('[data-act="impToggle"]');
  const up = async (name, text) => { await page.setInputFiles('#impFile', { name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + text) }); await page.waitForSelector('.panel table tbody tr td'); await page.waitForTimeout(200); };
  await up('ok.csv', '작업지시,인정수량\r\nWO006-05,240\r\nWO007-04,9\r\n');
  const pv = await page.$$eval('.panel', p => p[0].innerText); check('가져오기 미리 확인: 2행 정상', /2행/.test(pv) && (pv.match(/정상/g) || []).length >= 2, pv.slice(0, 300));
  await click('[data-act="impSend"]'); t = await toast();
  const iq = (await srv.db.query("select work_order_id, accepted_qty from tp_work_orders where work_order_id in ('WO006-05','WO007-04') order by 1")).rows.map(r => +r.accepted_qty);
  check('가져오기 반영: 2건 서버 규칙 통과 → DB 반영', /2건/.test(t) && iq[0] === 240 && iq[1] === 9, { t, iq });
  await up('bad.csv', '작업지시,인정수량\r\nWO006-05,250\r\nWO007-04,5\r\n');
  await click('[data-act="impSend"]'); t = await toast();
  const iq2 = (await wo('WO006-05')).accepted_qty;
  check('가져오기: 한 행(감소) 위반 → 전체 취소(반영 0건)', /반영 0건/.test(t) && /2행 WO007-04/.test(t) && +iq2 === 240, { t, iq2 });
  await up('unknown.csv', '작업지시,인정수량\r\nWO999-99,1\r\n');
  check('가져오기: 없는 작업지시 → 오류 표시 + 반영 버튼 비활성', await page.$eval('[data-act="impSend"]', b => b.disabled) && (await page.textContent('.panel')).includes('없는 작업지시'));
  await shot('wo_import');

  // 16. 사건 선택 시 재생 자동 일시정지
  await sr('tp_reset_demo', {}); await reloadDash();
  await click('.sbar [data-act="simToggle"]'); await page.waitForTimeout(300); check('재생 시작 → 재생 중 표시', (await page.textContent('.pstate')).includes('재생 중'));
  await click('.pmi[data-arg="INC003"]'); await page.waitForTimeout(200);
  check('처리 순서에서 사건 선택 → 재생 자동 일시정지(사건 확인 중) + 상단 추적 칩', (await page.evaluate(() => UI.pausedFor)) === '사건 확인 중' && !(await page.evaluate(() => UI.simOn)) && (await page.textContent('.gfocus')).includes('B008'));
  await click('.gfocus [data-act="selIncClear"]'); check('추적 해제 → 상단 추적 칩 사라짐', !(await page.$('.gfocus')));
  // 17. 재생은 한 화면만: 다른 화면이 잠금을 잡으면 재생 버튼 잠김
  await srv.rpc('tp_sim_claim', { p_owner: 'other-tab' }, CODE); await reloadDash();
  check('다른 화면 재생 중 → 재생 버튼 잠김', (await page.textContent('.sbar')).includes('다른 화면에서 시간 진행 중'));
  const mine = await page.evaluate(() => window.__TP_TEST_API.rpc('tp_sim_claim', { p_owner: 'me' }, null)); check('잠금은 시연 코드 없이 못 잡음', !mine.ok);
  await srv.rpc('tp_sim_release', { p_owner: 'other-tab' }, CODE);
  // 18. 16:00 → 처음부터 다시 보기
  await sr('tp_reset_demo', {}); for (let i = 0; i < 2; i++) await sr('tp_advance_clock', { p_min: 120 }); await reloadDash();
  check('16:00이면 [처음부터 다시 보기] 표시', (await page.textContent('.sbar')).includes('처음부터 다시 보기'));
  await click('.sbar [data-act="reset"]'); await click('.sbar [data-act="reset"]'); await toast();
  check('처음부터 다시 보기 → 12:00 원본', (await page.textContent('.clock')).includes('12:00'));
  // 19. 안내 카드
  await click('.grail [data-act="intro"]'); await page.waitForSelector('.intro');
  check('안내 카드: 공정 연결망 · 원인 추적과 조치 · 2D↔3D + [▶ 시연 시작]', /원인 추적과 조치/.test(await page.textContent('.intro')) && !!(await page.$('[data-act="introStart"]')));
  await page.keyboard.press('Escape');
  // 20. 체험 모드: 시연 코드 없이 7단계 실행 → 화면은 바뀌고 서버는 그대로 → 체험 끝내기로 원상
  await page.evaluate(() => sessionStorage.removeItem('tpDemoCode')); await reloadDash();
  check('체험: 코드 없음 상태(체험 모드 표시)', (await page.textContent('.gbar')).includes('체험 모드') && !!(await page.$('[data-act="codeOpen"]')));
  await pick('INC003'); check('체험: 처리 단계에 체험 모드 안내', (await page.textContent('.pv-pc.on .ictl')).includes('체험 모드'));
  for (const k of ['act', 'check', 'fit', 'approve', 'swap', 'resume']) { await click(`.pv-pc.on [data-act="priStep"][data-arg="INC003:${k}"]`); await page.waitForTimeout(200); }
  await go('dash'); const tv1 = await kv(); const ts1 = await server();
  check('체험: 대체 재개 → 화면 설비 가동 3/8·미해결 3, 서버는 그대로(가동 2)', tv1['설비 가동'] === '3 / 8' && tv1['미해결 사건'] === '3' && ts1.eq_running == 2 && !!(await page.$('.trialbar')), { 화면: tv1, 서버: ts1.eq_running });
  await pick('INC003'); await click('.pv-pc.on [data-act="priStep"][data-arg="INC003:close"]'); await page.waitForTimeout(200);
  await go('dash'); const tv = await kv(), ts = await server();
  check('체험: 7단계 완료 → 화면 미해결 2, 서버는 그대로(고장 1·미해소 3)', tv['미해결 사건'] === '2' && ts.eq_fault == 1 && ts.open_incidents == 3 && !(await page.$('.pmi[data-arg="INC003"]')), { 화면: tv, 서버: { fault: ts.eq_fault, open: ts.open_incidents } });
  await click('.trialbar [data-act="endTrial"]');
  const te = await kv();
  check('체험 끝내기 → 실제 서버 상태(가동 2/8·미해결 3)로 복귀', te['설비 가동'] === '2 / 8' && te['미해결 사건'] === '3' && !(await page.$('.trialbar')), te);
  const rb = await srv.rpc('tp_record_action', { p_inc: 'INC003', p_note: 'x', p_owner: null }, null); check('체험 함수 밖에서는 여전히 코드 없이 저장 불가', !rb.ok, rb.msg);
  // 21. 코드 없이 '내 화면만' 가상 시간 진행(4×) → 화면 시각은 흐르고 서버 시각은 12:00 그대로 → 사건 처리 체험과 이어짐
  await click('.gfocus [data-act="selIncClear"]');
  await click('.sbar [data-act="speed"][data-arg="4"]'); await click('.sbar [data-act="simToggle"]'); await page.waitForTimeout(3600); await click('.sbar [data-act="simToggle"]');
  const lc = await page.textContent('.clock'); const sc2 = (await srv.load()).sim_clock[0].now;
  check('내 화면 재생(4×): 화면 12:10, 서버 12:00 그대로', lc.includes('12:10') && /12:00/.test(sc2) && !!(await page.$('.trialbar')), { 화면: lc, 서버: sc2 });
  await pick('INC003'); await click('.pv-pc.on [data-act="priStep"][data-arg="INC003:act"]'); await page.waitForTimeout(200);
  const st1 = await page.$eval('.pv-pc.on .pv-steps li', l => l.className); await go('dash');
  check('재생 후 사건 처리 체험: 시각 유지(12:10) + 고장 확인 완료', (await page.textContent('.clock')).includes('12:10') && st1 === 'done');
  await click('.trialbar [data-act="endTrial"]');
  check('체험 끝내기 → 12:00', (await page.textContent('.clock')).includes('12:00'));
  // 22. 첫 방문: 주소만 열면 관제 + 안내 카드 → [▶ 시연 시작] = 재생 시작
  await page.evaluate(() => { localStorage.removeItem('tpIntroSeen'); sessionStorage.setItem('e2eIntro', '1'); });
  await page.goto('file://' + path.resolve('dist/twinpro_test.html')); await page.waitForSelector('.intro');
  check('주소만 열면 통합 관제 + 안내 카드', !!(await page.$('.sbar')) && !!(await page.$('.intro')));
  await click('[data-act="introStart"]'); await page.waitForTimeout(300);
  check('[▶ 시연 시작] → 안내 닫힘 + 재생 시작(코드 없음 = 내 화면만)', !(await page.$('.intro')) && (await page.evaluate(() => UI.simOn)) && !!(await page.$('.trialbar')));
  await click('.sbar [data-act="simToggle"]'); await click('.trialbar [data-act="endTrial"]');
  await page.reload(); await page.waitForSelector('.sbar'); check('다시 열면 안내 카드 없음(한 번 본 뒤)', !(await page.$('.intro')));
  await page.evaluate(() => history.replaceState(null, '', '#wo')); await page.reload(); await page.waitForSelector('#content'); check('새로고침해도 보던 화면 유지(#wo)', (await page.textContent('.pghead h1')).includes('작업 관리'));
  // 23. 3D: 관제에서 사건 선택 → 상단 [3D 조선소] 탭 → 03 공장 선택·B008 → 블록 내부 3D 버튼·관제로 돌아가 조치
  await page.setViewportSize({ width: 1280, height: 720 });   // 테스트 브라우저는 소프트웨어 GPU라 작은 창으로
  page.setDefaultTimeout(120000);   // 3D는 소프트웨어 GPU로 그려 느리다(CPU가 적은 테스트 환경 대비)
  await page.evaluate(() => ACT.goPri('INC003')); await page.waitForSelector('.pv-pc.on'); await click('.grail [data-arg="3d"]');
  await page.waitForSelector('.txlab', { timeout: 120000 });
  const labs = await page.$$eval('.txlab', ls => ls.map(l => l.className + ' ' + l.textContent));
  check('3D: 모델 로드 + 공정 라벨 6개, 용접 = 고장(빨강) + 공통 상단 바', labs.length === 6 && labs.some(l => / r /.test(l) && l.includes('용접')) && !!(await page.$('.tx .gbar')) && (await page.textContent('.tx .txbar')).includes('확장 데모'), labs);
  check('3D: 관제에서 고른 03 공정·B008 정보 열림 + [B008 블록 내부 3D]·[관제로 돌아가 조치]', (await page.textContent('.txcard')).includes('B008') && (await page.textContent('.txside')).includes('B008 블록 내부 3D') && !!(await page.$('.txside [data-act="goInc"]')) && !(await page.$('[data-act="easyDo"]')));
  await page.click('.txcard [data-act="t3sel"]', { force: true }); await page.waitForTimeout(300); await page.$eval('.txlab[data-arg="P04"]', e => e.click());   // 라벨이 알람 패널 아래에 있을 수 있어 요소를 직접 누름 await page.waitForTimeout(300); check('3D: 라벨 클릭 → 공정 정보(블록·진행·기계)', (await page.textContent('.txcard')).includes('B007'));
  // 23-0. 3D 관제 연출(t3x): KPI·알람 → 사건 현장(영향·말풍선·절차·근거) → 1단계 실행(체험) → 평면 → 자동 순회 → 톤
  await page.click('.txcard [data-act="t3sel"]', { force: true }); await page.waitForTimeout(300);
  check('3D 관제: 하단 KPI 4개(달성률 74%·멈춘 작업지시 3건) + 사건 알람 3건 + 운영 브리핑(규칙 기반 표기)', (await page.$$('.xkpi > div')).length === 4 && (await page.textContent('.xkpi')).includes('74%') && (await page.textContent('.xkpi')).includes('3건') && (await page.$$('.xali')).length === 3 && (await page.textContent('.xbrief')).includes('운영 판단: EQ07 대체 검토 필요 (INC003)') && (await page.textContent('.xbrief')).includes('규칙 기반'));
  await page.click('.xali[data-arg="INC003"]', { force: true }); await page.waitForTimeout(2800);
  const xi = await page.evaluate(() => ({ h: document.querySelector('.txhead h1').textContent, imp: document.querySelector('.ximp').textContent, st: document.querySelectorAll('.xst').length, on: document.querySelector('.xst.on').textContent, box: [...document.querySelectorAll('.xbox')].map(b => b.textContent).join('|'), ev: document.querySelector('.xev').textContent, side: !!document.querySelector('.txside'), cut: T3X.cut.P03.every(o => !o.visible) }));
  check('3D 사건 현장: 제목·영향(용접 작업셀 고장 → B008 생산 중단)·절차 7단계·말풍선 3개·근거·외피 걷기·현황 패널 접힘', xi.h === '사건 현장 · INC003' && xi.imp.includes('B008 생산 중단') && xi.imp.includes('EQ07') && xi.st === 7 && xi.on.includes('고장 확인') && xi.on.includes('지금 할 일') && xi.box.includes('고장 설비 · EQ03') && xi.box.includes('생산 중단 블록 · B008') && xi.box.includes('대체 검토 설비 · EQ07') && xi.ev.includes('WO008-03') && !xi.side && xi.cut, xi);
  await page.$eval('.xsub [data-act="t3step"]', e => e.click()); await page.waitForFunction(() => document.querySelector('.xst.on') && document.querySelector('.xst.on').textContent.includes('대체 가능 여부'), null, { timeout: 60000 }).catch(() => {});
  const xa = await page.evaluate(() => ({ on: document.querySelector('.xst.on')?.textContent, log: document.querySelectorAll('.xlog:not(.none)').length, c: T3.st.P03.c, ev: document.querySelector('.xev').textContent, res: document.querySelector('.xres')?.textContent || '' }));
  check('3D 1단계 실행(체험): 결과 3줄(방금 처리·현재 상태 유지·다음 단계)·처리 기록 1건·근거에 대체 후보, 공정은 아직 고장(빨강 유지)', xa.on.includes('대체 가능 여부') && xa.log === 1 && xa.c === 'r' && xa.ev.includes('EQ07 대기') && xa.res.includes('✓ 고장 확인') && xa.res.includes('유지') && xa.res.includes('대체 가능 여부 확인'), xa);
  await page.evaluate(() => ACT.endTrial()); await page.waitForTimeout(800);
  await fclick('[data-act="t3plan"]'); await page.waitForTimeout(800);
  check('3D 평면 보기: 제목 평면 관제 + 크레인·지붕 숨김 + 사건 화면 닫힘', (await page.textContent('.txhead h1')) === '평면 관제' && (await page.evaluate(() => T3X.planNodes.every(o => !o.visible) && !T3X.inc)));
  await fclick('[data-act="t3plan"]'); await fclick('[data-act="t3tour"]'); await page.waitForTimeout(800);
  check('3D 자동 순회: 장면 6개 목록 + 장면 제목 + 끝내기', (await page.$$('.xtourl button')).length === 6 && (await page.textContent('.xsub.tour h3')).length > 5 && !!(await page.$('[data-act="t3tourEnd"]')));
  await fclick('[data-act="t3tourEnd"]'); await page.waitForTimeout(500);
  await fclick('[data-act="t3theme"]'); const day = await page.evaluate(() => T3X.theme === 'day' && T3.scene.background === null); await fclick('[data-act="t3theme"]');
  check('3D 순회 끝 → 조선소 전체 복귀, 톤 전환(주간 ↔ 관제)', (await page.textContent('.txhead h1')) === '조선소 전체' && day && (await page.evaluate(() => T3X.theme === 'night')));
  // 23-1. 공정 교육 재생(정상 흐름): 상단 탭 → 01 절단 자막·수량 → 06 단계로 이동 → 끝내기 시 원래 화면
  await page.click('.grail [data-arg="edu"]', { force: true }); await page.mouse.move(900, 300); await page.waitForTimeout(300); await page.waitForSelector('.txb.fill.r[data-act="simEnd"]', { timeout: 60000 });
  check('공정 교육 재생: 탭 강조 + "교육용 표준 공정 재생 — B011 정상 흐름" 표시', (await page.textContent('.grail .gri.on')).includes('공정 교육 재생') && (await page.textContent('.txhead')).includes('교육용 표준 공정 재생 — B011 정상 흐름'));
  { const v = await page.evaluate(() => { const el = document.querySelector('.simvid video'); return { vid: SIM.vid, src: el && [...el.querySelectorAll('source')].map(x => x.getAttribute('src')).join(','), side: !!document.querySelector('.txside'), chips: document.querySelectorAll('.simvchips button').length }; });
    check('공정 교육 재생 기본 = 16배속 녹화 영상(media/twinpro-process-16x.webm · .mp4) · 화면 넓게(오른쪽 패널 숨김) · 단계 칩 6개 · [3D 직접 재생] 버튼', v.vid && v.src === 'media/twinpro-process-16x.webm,media/twinpro-process-16x.mp4' && !v.side && v.chips === 6 && !!(await page.$('.simvbar [data-act="simMode"][data-arg="full"]')), v); }
  await page.evaluate(() => ACT.simVidRate(2)); check('영상 32배속 버튼 → 재생 배율 2', await page.evaluate(() => document.querySelector('.simvid video').playbackRate === 2));
  await page.evaluate(() => ACT.simMode('full')); await page.waitForTimeout(500);
  check('[3D 직접 재생] → 영상 닫힘 · 3D 재생 · 배속 선택 · [16배속 영상] 버튼', !(await page.$('.simvid')) && !!(await page.$('select[data-sim="speed"]')) && !!(await page.$('[data-act="simMode"][data-arg="vid"]')));
  await page.evaluate(() => { SIM.play = false; SIM.t = 8; }); await page.waitForTimeout(1500);
  check('시뮬레이션: 01 강재 절단 자막 + 부재 수량(B011 84 piece)', (await page.textContent('#simT')).includes('01 강재 절단') && /\/ 84 piece/.test(await page.textContent('#simQ')), await page.textContent('#simQ'));
  await page.evaluate(() => ACT.simJump(5)); await page.waitForTimeout(1500);   // 테스트 브라우저(소프트웨어 GPU)는 매 프레임 렌더로 클릭 처리가 느려 함수로 호출
  check('시뮬레이션: 06 이송 단계로 이동, 앞 단계 5개 완료 표시', (await page.textContent('#simT')).includes('06 블록 이송') && (await page.$$('.txchips button.done')).length === 5);
  await page.evaluate(() => ACT.simMode('vid')); await page.waitForTimeout(500); check('[16배속 영상]으로 돌아가면 영상이 다시 열림', !!(await page.$('.simvid video')));
  const simSrv = await server(); await page.evaluate(() => ACT.simEnd()); await page.waitForTimeout(800);
  check('시뮬레이션 끝내기 → 원래 화면(데이터 라벨), 서버는 그대로', !(await page.$('[data-act="simEnd"]')) && !!(await page.$('[data-act="simStart"]')) && simSrv.eq_fault == 1);
  await page.evaluate(() => ACT.goInc('INC003')); check('3D → [작업 관리에서 처리] = 작업 관리 우선순위 + 사건 선택 유지', (await page.textContent('.pv-pc.on .pv-pt')).includes('EQ03'));
  // 24. 블록 내부 3D: 상단 탭 → 추적 중 블록(B008) = 용접 62.5%(102.5/164 m) → 공정 카드·부재 목록·세트, 처음부터 재생 시 절단 단계, 현재 상태로 복귀
  await page.click('.grail [data-arg="blk"]', { force: true }); await page.mouse.move(900, 300); await page.waitForTimeout(300); await page.waitForSelector('.bk .bkcards', { timeout: 60000 });
  check('블록 내부 3D: "조립 재생 · 관제 시각과 별도" + [관제로 복귀]', (await page.textContent('.bktop')).includes('조립 재생 · 관제 시각과 별도') && !!(await page.$('.bktop [data-act="go"][data-arg="dash"]')));
  const cards = await page.$$eval('.bkcard', cs => cs.map(c => c.querySelector('.bkq').textContent.trim()));
  check('블록 제조: B008 공정 카드 = 데이터(72/72 piece · 8/8 set · 102.5/164 m · 0/10 point)', cards[0] === '72 / 72 piece' && cards[1] === '8 / 8 set' && cards[2] === '102.5 / 164 m' && cards[3] === '0 / 10 point', cards);
  check('블록 제조: 부재 72개·세트 8개, 진행 중 부재 1개', (await page.textContent('.bkl')).includes('부재 목록 (72)') && (await page.$$('.bkset')).length === 8 && (await page.$$('.bkt tr.cur')).length <= 1 && (await page.textContent('.bkr')).includes('Transverse Floor'));
  check('블록 제조: 단위 구분(부재는 개수, 용접은 m · 관제와 같은 62.5%)', (await page.textContent('.bkr')).includes('25 / 72개 · 34.7%') && (await page.textContent('.bkr')).includes('102.5 / 164 m · 62.5%') && (await page.textContent('#bkTime')).includes('62.5%'), await page.textContent('.bkr'));
  await page.click('[data-act="bkFocus"]', { force: true }); await page.waitForTimeout(300);
  check('블록 제조: [3D 크게] = 양옆 패널·공정 카드 접힘, 재생 조작 유지', !!(await page.$('.bk.focus')) && !(await page.isVisible('.bkl')) && (await page.isVisible('[data-act="bkPlay"]')));
  await page.click('[data-act="bkFocus"]', { force: true }); await page.waitForTimeout(300);
  await page.click('[data-act="bkFirst"]', { force: true }); await page.waitForTimeout(300);
  check('블록 제조: 처음으로 → P01 절단 0/72', (await page.$$eval('.bkcard', cs => cs[0].querySelector('.bkq').textContent.trim())) === '0 / 72 piece' && (await page.textContent('#bkTime')).includes('P01'));
  await page.click('[data-act="bkNow"]', { force: true }); await page.waitForTimeout(300);
  await page.click('.bkcard[data-arg="0"]', { force: true }); await page.waitForTimeout(400);
  const t01 = await page.textContent('#bkTime'); await page.click('.bkcard[data-arg="2"]', { force: true }); await page.waitForTimeout(400);
  check('블록 제조: 공정 카드 클릭 → P01 장면, 현재 공정(P03) 카드 → 현재 상태', t01.includes('P01') && (await page.textContent('.bkctl')).includes('현재 상태(서버 데이터)'), t01);
  await page.selectOption('#bkBlock', 'B007'); await page.waitForTimeout(500);
  check('블록 제조: 블록 바꾸기(B007 = 검사 중, 용접 156/156 m)', (await page.$$eval('.bkcard', cs => cs[2].querySelector('.bkq').textContent.trim())) === '156 / 156 m' && (await page.textContent('.bkl')).includes('P04'));
  await page.click('.bktop [data-act="go"][data-arg="dash"]', { force: true }); await page.waitForSelector('.sbar', { timeout: 10000 }).catch(() => {}); check('[관제로 복귀] → 통합 관제', !!(await page.$('.sbar')));
  await page.evaluate(c => sessionStorage.setItem('tpDemoCode', c), CODE);
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 23. 관리 화면 [그림] 보기 + 작업 관리 우선순위(온톨로지) → 처리 단계 실행(DB 저장) → 순위 재계산 + AI 우선순위 요약
  await sr('tp_reset_demo', {}); await reloadDash();
  await go('eq', 'pic');
  { const cards = await page.$$eval('.pv-ec', cs => cs.map(c => c.dataset.arg)), e3 = await page.$eval('.pv-ec[data-arg="EQ03"]', c => c.className + ' ' + c.innerText), lines = await page.$$eval('.pv-eqmap svg path', p => p.length);
    check('설비 그림: 카드 8대(실사 사진) · 작업구역 6칸 · EQ03 고장 강조 40.1% · 지시선 8개', cards.length === 8 && (await page.$$('.pv-zone')).length === 6 && / r /.test(' ' + e3) && e3.includes('40.1') && lines === 8 && (await page.$$eval('.pv-ec img', is => is.filter(i => i.src.startsWith('data:image/webp')).length)) === 8, { cards, lines }); }
  await shot('pic_eq');
  await go('prod', 'pic');
  { const tiles = await page.$$eval('.pv-bt', t => t.map(x => x.dataset.arg + ':' + x.className.split(' ')[1])), big = await page.textContent('.pv-big');
    check('생산 그림: 블록 12칸 · 완성 5/12 · B008 멈춤(빨강) · B009 자재 대기(주황) · B011 시작 전', tiles.length === 12 && /^5/.test(big.trim()) && tiles.includes('B008:r') && tiles.includes('B009:o') && tiles.includes('B011:x'), { tiles, big }); }
  await shot('pic_prod');
  await go('wo', 'pri');
  const sqlOrder = async () => (await srv.db.query('select tp_priority() r')).rows[0].r.map(x => x.incident);
  const uiOrder = () => page.$$eval('.pv-pc', cs => cs.map(c => (c.querySelector('.pv-pt small').textContent.match(/INC\d+/) || [])[0]));
  { const ui = await uiOrder(), sq = await sqlOrder(), hit = await page.$eval('.pv-pc.on .pv-why .hit', h => h.textContent), nodes = await page.$$eval('.pv-gc .pv-n', n => n.map(x => x.id)), edges = await page.$$eval('.pv-gc svg line, .pv-gc svg path', l => l.length);
    check('우선순위: 화면 순서 = 서버 tp_priority() 순서(INC003 → INC004 → INC005) · 1순위를 가른 기준 = 공정 전체 막힘', JSON.stringify(ui) === JSON.stringify(sq) && sq.join() === 'INC003,INC004,INC005' && hit.startsWith('공정 전체 막힘'), { ui, sq, hit });
    check('우선순위 근거 연결: 설비·사건·작업·같은 설비 대기·다음 공정·대체 후보 2 노드 + 관계선 6개', ['g-eq', 'g-inc', 'g-wo', 'g-same', 'g-next', 'g-sub0', 'g-sub1'].every(i => nodes.includes(i)) && edges === 6, { nodes, edges });
    const onto = +(await srv.db.query("select count(*) c from tp_v_ontology where p in ('ON_EQ','STOPS','CAN_SUB')")).rows[0].c; check('서버 온톨로지 뷰: 발생 설비 1 + 멈춘 작업 3 + 대체 가능 2 = 6', onto === 6, onto); }
  await shot('pic_wo_pri');
  for (const k of ['act', 'check', 'fit', 'approve', 'swap', 'resume']) { await click(`[data-act="priStep"][data-arg="INC003:${k}"]`); t = await toast(); if (/실패|거부|없습니다/.test(t)) { check('우선순위 카드에서 처리 단계 실행: ' + k, false, t); break; } }
  { const w8 = await wo('WO008-03'), ui = await uiOrder(), sq = await sqlOrder(), steps = +(await srv.db.query("select count(*) c from tp_incident_steps where incident_id='INC003'")).rows[0].c;
    check('우선순위 카드에서 7단계 중 6단계 실행 → DB 저장(EQ07로 이관·재개) · 순위 재계산(INC003 공정 막힘 해제 → 뒤로) · 화면 = 서버', w8.equipment_id === 'EQ07' && w8.status === 'IN_PROGRESS' && steps >= 3 && JSON.stringify(ui) === JSON.stringify(sq) && sq[0] !== 'INC003', { w8: [w8.equipment_id, w8.status], steps, ui, sq });
    check('처리 중인 사건은 순위가 바뀌어도 계속 선택(다음 단계: 복구 후 종료)', (await page.$eval('.pv-pc.on .pv-pt', e => e.textContent)).includes('EQ03') && !!(await page.$('[data-act="priStep"][data-arg="INC003:close"]'))); }
  await srv.db.query('delete from tp_ai_usage');   // 앞 시나리오에서 하루 10회를 다 써서 비움(테스트 DB만)
  await click('[data-act="priAi"]'); t = await toast();
  { const n = +(await srv.db.query('select count(*) c from tp_ai_priority')).rows[0].c, txt = await page.textContent('.pv-ps');
    check('AI 우선순위 요약: 서버 순위 사실로 생성·저장(하루 10회 공용 차감) → 화면에 AI 요약 표시', /우선순위 요약을 생성/.test(t) && n === 1 && txt.includes('AI 요약') && txt.includes('테스트 대역'), { t, n }); }
  await go('wo', 'plan');
  { const bars = (await page.$$('.pv-gb')).length, warn = await page.$$eval('.pv-gb.warn', b => b.map(x => x.dataset.arg));
    check('일정표: 오늘·내일 작업 막대 + 지금 선 + 고장 설비에 잡힌 예정 작업 경고', bars >= 12 && !!(await page.$('.pv-now')) && warn.includes('WO009-03'), { bars, warn }); }
  await shot('pic_wo_plan');
  await go('base');
  check('기준정보: 그림 없이 표만(보기 전환 탭 없음) · 공정 목록 표 · 조회 전용', !(await page.$('.pvmode')) && !(await page.$('.pv-base')) && !!(await page.$('.pg-base table')) && (await page.textContent('#content')).includes('조회 전용'));
  await shot('base_table');

  // 현장 데이터 수집 연결(Modbus · ETOS): 수집 포인트 = 화면 기본값, 출처가 남는 신호 입구, 화면 5개 연결 표시
  { const db = (await srv.db.query('select * from tp_io_point order by sort')).rows.map(r => ({ ...r }));
    const def = await page.evaluate(() => ioDefault());
    const same = db.length === 24 && def.length === 24 && db.every((r, n) => ['point_id', 'equipment_id', 'route', 'endpoint', 'unit_id', 'address', 'data_type', 'signal', 'rule', 'sort'].every(k => String(r[k]) === String(def[n][k])));
    check('수집 포인트: 서버 표 24개(Modbus 5대 · ETOS 3대 × 3) = 화면 기본값(서버 미적용 시 대체)', same, { db: db.length, def: def.length }); }
  await click('[data-arg="base:io"]');
  check('기준정보 [수집 포인트] 탭: 24행 · Modbus/ETOS 배지 · %MW 주소 · 조회 전용', (await page.$$('.pg-base tbody tr')).length === 24 && (await page.$$('.pg-base tbody .iob.m')).length === 5 && (await page.$$('.pg-base tbody .iob.e')).length === 3 && (await page.textContent('#content')).includes('%MW200'));
  await shot('base_io');
  { const bad = await srv.rpc('tp_ingest_signal', { p_eq: 'EQ05', p_signal: 'COUNT', p_value: 1, p_source: 'OPC' }, CODE);
    const okM = await srv.rpc('tp_ingest_signal', { p_eq: 'EQ05', p_signal: 'COUNT', p_value: 2, p_source: 'MODBUS' }, CODE);
    const okE = await srv.rpc('tp_ingest_signal', { p_eq: 'EQ04', p_signal: 'COUNT', p_value: 1, p_source: 'ETOS' }, CODE);
    const sim = await srv.rpc('tp_ingest_signal', { p_eq: 'EQ05', p_signal: 'COUNT', p_value: 1 }, CODE);
    const flt = await srv.rpc('tp_ingest_signal', { p_eq: 'EQ01', p_signal: 'FAULT', p_source: 'MODBUS' }, CODE);
    const src = (await srv.db.query('select source from tp_signal_log order by id desc limit 4')).rows.map(r => r.source).reverse().join(',');
    check('신호 입구: 출처(SIM·MODBUS·ETOS) 기록 · 알 수 없는 출처 거부 · 기존 3인자 호출은 SIM', !bad.ok && okM.ok && okE.ok && sim.ok && flt.ok && src === 'MODBUS,ETOS,SIM,MODBUS' && /MODBUS/.test(okM.msg), { bad: bad.msg, src }); }
  await reloadDash();
  { const chip = await page.textContent('.iochip');
    check('관제: 데이터 수집 칩 = 연결 프로그램 수신(Modbus) · Modbus 5대 · ETOS 3대', chip.includes('연결 프로그램 수신(Modbus)') && chip.includes('Modbus 5대') && chip.includes('ETOS 3대'), chip); }
  await click('.iochip');
  check('연결 구조도: ① PLC(Modbus) ② ETOS(XGT FEnet) → ③ 연결 프로그램 → ④ 서버 입구 · 최근 신호 출처 배지', (await page.$$('.iomodal .iocard')).length === 3 && (await page.textContent('.iomodal')).includes('tp_ingest_signal') && (await page.$$('.iomodal .iolog .iob.m')).length >= 2 && (await page.$$('.iomodal .iolog .iob.e')).length >= 1);
  await shot('io_modal');
  await click('.iomodal [data-act="ioClose"]');
  await go('wo', 'pri');
  { const t = await page.textContent('.pv-pri');
    check('작업 관리: 사건마다 감지 경로(엑셀 기록 + 현장 연결 시 EQ03 Modbus DI 10001 · Modbus FAULT 신호로 자동 등록)', t.includes('EQ03 Modbus DI 10001') && t.includes('Modbus FAULT 신호로 자동 등록') && t.includes('작업자 입력'), t.slice(0, 120)); }
  await go('eq', 'pic'); check('설비 상태 [그림]: 카드 8장에 연결 배지(Modbus 5 · ETOS 3)', (await page.$$('.pv-ec .iob.m')).length === 5 && (await page.$$('.pv-ec .iob.e')).length === 3);
  await click('.pv-ec[data-arg="EQ02"]'); check('설비 상세: 데이터 연결(ETOS-100XP 주소 · 포인트 3개 · 받은 신호 수)', (await page.textContent('.sdio')).includes('ETOS-100XP 192.168.20.10:2004') && (await page.textContent('.sdio')).includes('포인트 3개'));
  // 운영 추이 연출(1분 = 1일): 서버 생성식 = 화면 계산식, 1분 작업이 그 시각의 날짜를 만듦, [추이] 보기
  { const days = [0, 45, 120, 200, 257, 258, 259, 300, 364], sq = [];
    for (const d of days) for (let e = 1; e <= 8; e++) sq.push({ d, e, day: (await srv.db.query('select * from tp_lv_day($1,$2)', [d, e])).rows[0], sig: (await srv.db.query('select * from tp_lv_signals($1,$2)', [d, e])).rows });
    const bad = await page.evaluate(sq => sq.filter(({ d, e, day, sig }) => { const a = lvDay(d, e), b = lvSignals(d, e);
      const k = x => x.map(s => [s.f.toFixed(3), s.signal, s.value == null ? '' : (+s.value).toFixed(3), s.source].join('|')).sort().join(';');
      return ['op', 'run', 'idle', 'fault', 'maint', 'faults'].some(f => a[f] !== day[f]) || Math.abs(a.qty - day.qty) > 1e-9 || k(b) !== k(sig); }).map(x => x.d + ':' + x.e), sq);
    const kinds = (await srv.db.query("select kind, count(*)::int c from tp_daily where kind <> 'LIVE' group by 1 order by 1")).rows.map(r => r.kind + r.c).join(',');
    const ms = Date.UTC(2026, 9, 31, 9, 30, 20), tick = await srv.db.query('select tp_live_tick($1) r', [new Date(ms).toISOString()]);
    const want = await page.evaluate(ms => lvDate(lvNow(ms).d), ms), live = (await srv.db.query("select count(distinct day)::int c from tp_daily where kind = 'LIVE'")).rows[0].c;
    const pos = await page.evaluate(ms => lvNow(ms).pos, ms), inp = (await srv.db.query("select count(*)::int c from tp_live_signal where source = 'INPUT'")).rows[0].c;
    check('운영 추이: 서버 생성식 = 화면 계산식(9일 × 설비 8대) · 가상 이력 258일 + 기준일 · 1분 작업 = 그 시각 날짜 · 마감일 집계 · 시스템 입력 신호', !bad.length && kinds === 'BASE8,HIST2064' && tick.rows[0].r.day === want && live === pos && inp > 0, { bad, kinds, tick: tick.rows[0].r, want, live, pos, inp }); }
  await go('prod', 'trend');
  { const t = await page.textContent('#content');
    check('생산 현황 [추이]: 월 12칸 · 진행 중 달 표시 · 누적 KPI · 당일 진행 · 가상 표기', (await page.$$('.lvm')).length === 12 && (await page.$$('.lvm.cur')).length === 1 && t.includes('2026 누적 가동률') && !!(await page.$('#lvtoday .lvbar')) && t.includes('가상 이력'), t.slice(0, 80)); }
  await shot('prod_trend');
  await click('.lvm[data-arg="03"]'); check('[추이] 월을 누르면 그 달 일별(31칸 · 가상 이력)', (await page.$$('.lvd')).length === 31 && (await page.$$('.lvd.hist')).length >= 25);
  await reloadDash(); { const a = await page.textContent('#lvchip'); await page.waitForFunction(a => document.querySelector('#lvchip').textContent !== a, a, { timeout: 5000 }).catch(() => {}); const b = await page.textContent('#lvchip');
    check('관제: 당일 데이터 수집 칩(1초마다 갱신 · 일 마감까지 남은 초)', a.includes('당일 데이터 수집') && /\d+초/.test(b) && a !== b, { a, b }); }
  await go('prod', 'pic'); check('생산 현황: 실적 출처(엑셀 제공 실적 + 설비 신호 반영 n건)', /설비 신호 반영 \d+건/.test(await page.textContent('.pv-foot')));

  // AI 운영 센터: 회사별 모델을 모델마다 따로 호출 → 각자 끝나는 대로 채움, 키 없는 회사는 건너뜀, 자동 채점 · 비용 · 누적 비교 · 추천
  await go('ai');
  check('AI 운영 센터: 모델 카드 11(Anthropic 3 · OpenAI 4 · Google 4) · 단계 4 · 실행 버튼(하루 3회)', (await page.$$('.aicard')).length === 11 && (await page.$$('.aicard.an')).length === 3 && (await page.$$('.aicard.oa')).length === 4 && (await page.$$('.aicard.gg')).length === 4 && (await page.$$('.aistep')).length === 4 && (await page.textContent('.aigo')).includes('0/3'));
  await click('[data-act="benchRun"]'); await page.waitForTimeout(700);
  { const calling = (await page.$$('.aicard.call')).length, done1 = (await page.$$('.aicard.done')).length;
    await page.waitForSelector('.aigo:not([disabled])', { timeout: 15000 }); await page.waitForTimeout(500);
    const rows = (await srv.db.query('select model_id, ok, latency_ms, score, cost_usd, checks from tp_ai_bench order by model_id')).rows, by = Object.fromEntries(rows.map(r => [r.model_id, r]));
    check('모델 비교 실행: 모델마다 따로 끝남(호출 중 카드와 끝난 카드가 함께 보임) · 서버 기록 7건(Google 4개 키 미등록 건너뜀) · 응답 시간 · 비용 · 점수 저장', calling >= 1 && done1 >= 1 && rows.length === 7 && rows.every(r => r.ok && r.latency_ms > 0 && r.cost_usd > 0) && (await page.textContent('.aicard.gg')).includes('미등록'), { calling, done1, n: rows.length });
    check('자동 채점: 사실 다 들어간 답 100점 · 사건 하나 빠지면 감점(빠진 필수 사실 표시) · 지어낸 ID(INC099 · EQ09)는 30점 감점', by['claude-haiku-5-5'].score === 100 && by['gpt-6-luna'].score < 100 && (typeof by['gpt-6-luna'].checks === 'string' ? JSON.parse(by['gpt-6-luna'].checks) : by['gpt-6-luna'].checks).missing.length > 0 && by['gpt-6.1-terra'].score === 70 && JSON.stringify(by['gpt-6.1-terra'].checks).includes('INC099'), rows.map(r => r.model_id + ':' + r.score));
    const pick = await page.textContent('.aipk');
    check('누적 비교 · 추천: 실측 모델 중 종합 점수 1위(Claude Haiku 5.5) · 표 11행 · 산점도 점 7개', pick.includes('Claude Haiku 5.5') && (await page.$$('.aitab tbody tr')).length === 11 && (await page.$$('.aisc circle')).length === 7, pick); }
  await shot('ai_center');
  { const r2 = await srv.ai(CODE, { mode: 'bench', model_id: 'claude-haiku-5-5', run_id: 'q2' }), r3 = await srv.ai(CODE, { mode: 'bench', model_id: 'claude-haiku-5-5', run_id: 'q3' }), r4 = await srv.ai(CODE, { mode: 'bench', model_id: 'claude-haiku-5-5', run_id: 'q4' }), nc = await srv.ai(null, { mode: 'bench', model_id: 'claude-haiku-5-5', run_id: 'q5' });
    check('모델 비교 제한: 하루 3회차까지(4번째 거부) · 시연 코드 없으면 거부', r2.ok && r3.ok && !r4.ok && /하루 3회/.test(r4.msg) && !nc.ok, { r4: r4.msg, nc: nc.msg }); }

  // 설비 붙이기 / 없애기: 기준정보 → 설비 탭에서 추가 · 사용 중지 · 삭제 → 화면 5개 · 서버 규칙에 반영, 초기화하면 원본 8대
  await sr('tp_reset_demo', {}); await reloadDash();
  await go('base'); await click('[data-act="sub"][data-arg="base:eq"]');
  check('설비 탭: [+ 설비 추가] · 원본 8대는 [사용 중지]만(삭제 버튼 없음)', await page.isVisible('[data-act="eqFormTog"]') && (await page.$$('[data-act="eqActive"]')).length === 8 && !(await page.$('[data-act="eqDel"]')));
  await click('[data-act="eqFormTog"]'); await page.fill('#eqfName', '예비 용접기 2호');
  await shot('base_eq_form'); check('설비 추가 폼: 새 번호 EQ09 · 기본 IP 192.168.10.19 · Unit 1', (await page.textContent('.eqform')).includes('EQ09') && (await page.inputValue('#eqfIp')) === '192.168.10.19' && (await page.inputValue('#eqfUnit')) === '1');
  await click('[data-act="eqAdd"]'); { const t = await toast(); const e9 = (await srv.db.query("select * from tp_equipment where equipment_id = 'EQ09'")).rows[0], io9 = (await srv.db.query("select address from tp_io_point where equipment_id = 'EQ09' order by sort")).rows.map(r => r.address);
    check('설비 추가 → 서버 저장(EQ09 · P03 · 대기) · 수집 포인트 3개(Modbus) · 대체 적합성 「확인 필요」 · 설비 목록 9행', /EQ09/.test(t) && e9 && e9.status === 'IDLE' && e9.process_id === 'P03' && io9.join() === 'Coil 00001,HR 40001,DI 10001' && (await page.$$('.pglist tbody tr')).length === 9 && (await page.textContent('.pglist tbody')).includes('확인 필요'), { t, io9 }); }
  await shot('base_eq_added');
  await click('[data-act="eqFormTog"]'); await page.selectOption('#eqfRoute', 'ETOS'); await page.waitForSelector('#eqfMw'); await page.fill('#eqfName', '중복 주소'); await page.fill('#eqfMw', '201'); await click('[data-act="eqAdd"]');
  { const t = await toast(); check('설비 추가 거부: ETOS 주소(%MW201~203)가 다른 설비와 겹치면 저장 안 함', /이미 다른 설비/.test(t) && +(await srv.db.query('select count(*) n from tp_equipment')).rows[0].n === 9, t); }
  await click('[data-act="eqFormTog"]');
  await go('eq'); { const k = (await page.$$eval('.eqc[data-act="selEq"]', r => r.map(x => x.dataset.arg))); await go('dash'); const kk = (await kv())['설비 가동'];
    check('설비 상태: 카드 9개(EQ09 포함) · 관제 KPI 설비 가동 n / 9', k.length === 9 && k.includes('EQ09') && kk.endsWith('/ 9'), { k, kk }); }
  check('통합 관제: 대기 · 예비 설비 줄에 EQ09', (await page.textContent('.dmap')).includes('예비 용접기 2호'));
  { const subs = await page.evaluate(() => substitutes(incById('INC003')).map(e => e.equipment_id)); const cand = { msg: JSON.stringify(((await srv.db.query('select tp_priority() r')).rows[0].r.find(x => x.incident === 'INC003') || {}).substitutes) };
    check('작업 관리 대체 후보: 화면 · 서버 우선순위(tp_priority) 모두 EQ09 포함(같은 공정)', subs.includes('EQ09') && /EQ09/.test(cand.msg || ''), { subs, msg: cand.msg }); }
  await go('base'); await click('[data-act="sub"][data-arg="base:io"]'); check('수집 포인트: 27개(EQ09 Modbus 192.168.10.19:502)', (await page.$$('.pglist tbody tr')).length === 27 && (await page.textContent('.pglist tbody')).includes('192.168.10.19:502'));
  await click('[data-act="sub"][data-arg="base:eq"]'); await click('[data-act="eqActive"][data-arg="EQ05:0"]');
  { const t = await toast(); check('사용 중지 거부: 가동 중인 EQ05는 이유 표시 후 그대로', /가동 중/.test(t) && (await srv.db.query("select active from tp_equipment where equipment_id = 'EQ05'")).rows[0].active === true, t); }
  await click('[data-act="eqActive"][data-arg="EQ07:0"]'); await toast();
  { const sig = await sr('tp_ingest_signal', { p_eq: 'EQ07', p_signal: 'RUN' }), cand = (await srv.db.query("select s from tp_v_ontology where p = 'CAN_SUB' order by s")).rows.map(r => r.s);
    check('사용 중지 EQ07: 목록에 회색 행(이력 유지) · 신호 입구 거부 · 대체 가능 관계에서 빠짐', (await page.$$('tr.eqoff')).length === 1 && /사용 중지된 설비/.test(sig.msg) && !cand.includes('EQ07') && cand.includes('EQ09'), { sig: sig.msg, cand }); }
  await shot('base_eq_off');
  await go('eq'); check('설비 상태: EQ07 빠짐(카드 8개)', (await page.$$('.eqc[data-act="selEq"]')).length === 8 && !(await page.$('.eqc[data-arg="EQ07"]')));
  await go('base'); await click('[data-act="sub"][data-arg="base:eq"]'); await click('[data-act="eqActive"][data-arg="EQ07:1"]'); await toast();
  await click('[data-act="eqDel"][data-arg="EQ09"]'); check('삭제는 두 번 눌러 확인', (await page.textContent('[data-act="eqDel"][data-arg="EQ09"]')).includes('한 번 더'));
  await click('[data-act="eqDel"][data-arg="EQ09"]'); { const t = await toast(); const n = +(await srv.db.query("select count(*) n from tp_equipment where equipment_id = 'EQ09'")).rows[0].n;
    check('기록 없는 추가 설비 삭제: EQ09 · 수집 포인트 · 적합성 함께 삭제, EQ07은 다시 사용', /삭제했습니다/.test(t) && n === 0 && +(await srv.db.query('select count(*) n from tp_io_point')).rows[0].n === 24 && (await page.$$('.pglist tbody tr')).length === 8 && !(await page.$('tr.eqoff')), t); }
  { const d1 = await sr('tp_equipment_delete', { p_eq: 'EQ01' }); await sr('tp_equipment_add', { p_name: '시험 설비', p_process: 'P05', p_zone: null, p_kind: '설비', p_route: 'INPUT' }); await sr('tp_equipment_set_active', { p_eq: 'EQ06', p_active: false });
    await sr('tp_reset_demo', {}); const rows = (await srv.db.query('select equipment_id, active from tp_equipment order by 1')).rows;
    check('원본 설비는 삭제 거부 · [데이터 초기화]하면 추가 설비 삭제 + 원본 8대 모두 사용', /원본 설비/.test(d1.msg) && rows.length === 8 && rows.every(r => r.active), { d1: d1.msg, n: rows.length }); }
  await sr('tp_reset_demo', {}); await reloadDash();
  for (const v of ['dash', 'eq', 'prod', 'wo', 'base']) { await go(v); await shot('final_' + v); }
  check('콘솔 오류 0건', errors.length === 0, errors);
  await page.setViewportSize({ width: 400, height: 900 }); await go('dash'); const ow = await page.evaluate(() => document.documentElement.scrollWidth); await shot('mobile_dash');
  check('폭 400px에서 가로 스크롤 없음', ow <= 400, ow);
  await browser.close();
  fs.writeFileSync('e2e_result.json', JSON.stringify({ pass: results.filter(r => r.ok).length, total: results.length, results }, null, 1));
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} PASS`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
