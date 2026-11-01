// ---------- AI 운영 센터: 같은 서버 사실을 여러 회사 모델에 주고 응답 속도 · 비용 · 정확도를 실측 비교 ----------
// 버튼을 눌렀을 때만 호출한다(자동 호출 없음). 모델마다 따로 호출해 각자 끝나는 대로 화면에 채운다(응답 시간은 서버에서 잰 값).
const AI_MODELS_DEFAULT = [   // 서버 tp_ai_model 표가 아직 없을 때 쓰는 같은 목록(단가 USD / 100만 토큰)
  ['claude-haiku-5-5', 'anthropic', 'Claude Haiku 5.5', '경량', 0.10, 0.50], ['claude-sonnet-5-5', 'anthropic', 'Claude Sonnet 5.5', '중간', 2.00, 10.00],
  ['claude-opus-5-5', 'anthropic', 'Claude Opus 5.5', '상위', 4.00, 20.00], ['gpt-6-luna', 'openai', 'OpenAI GPT-6 Luna', '경량', 0.10, 0.50],
  ['gpt-6.1-terra', 'openai', 'OpenAI GPT-6.1 Terra', '중간', 1.00, 5.00], ['gpt-6.1-sol', 'openai', 'OpenAI GPT-6.1 Sol', '중간', 2.00, 10.00],
  ['gpt-6-astra', 'openai', 'OpenAI GPT-6 Astra', '상위', 10.00, 50.00], ['gemini-3.1-flash-lite', 'google', 'Gemini 3.1 Flash-Lite', '경량', 0.25, 1.50],
  ['gemini-3.6-flash', 'google', 'Gemini 3.6 Flash', '경량', 0.75, 3.75], ['gemini-3.1-pro-preview', 'google', 'Gemini 3.1 Pro', '상위', 2.00, 12.00],
  ['gemini-4-argon', 'google', 'Gemini 4 Argon', '중간', 2.00, 10.00],
].map(([model_id, provider, label, tier, price_in, price_out], i) => ({ model_id, provider, label, tier, price_in, price_out, enabled: true, sort: i + 1, price_note: '공개 가격표 기준 2026-10 확인 · 변경 가능' }));
const AI_KRW = 1400;   // 원화 환산(1 USD = 1,400원, 표시용 가정)
const AI_PROV = { anthropic: ['Anthropic', 'an'], openai: ['OpenAI', 'oa'], google: ['Google', 'gg'] };
const aiModels = () => (S.aiModels && S.aiModels.length ? S.aiModels : AI_MODELS_DEFAULT).filter(m => m.enabled !== false).sort((a, b) => a.sort - b.sort);
const won = usd => usd == null ? '-' : usd * AI_KRW < 1 ? `${(usd * AI_KRW).toFixed(2)}원` : `${(usd * AI_KRW).toFixed(1)}원`;
UI.bench = UI.bench || null;

// 모델별 누적 통계(서버 기록 tp_ai_bench). 가상 예시(simulated) 행이 있는 모델은 가상 예시 행만으로 계산하고 sim 표시
function aiStats() {
  const st = aiModels().map(m => { let rs = (S.bench || []).filter(r => r.model_id === m.model_id); const sim = rs.some(r => r.simulated); if (sim) rs = rs.filter(r => r.simulated);
    const ok = rs.filter(r => r.ok), avg = f => ok.length ? ok.reduce((s, r) => s + (+f(r) || 0), 0) / ok.length : null;
    return { m, sim, n: rs.length, ok: ok.length, rate: rs.length ? ok.length / rs.length * 100 : null, lat: avg(r => r.latency_ms), cost: avg(r => r.cost_usd), score: avg(r => r.score) }; });
  // 상대평가 종합 점수 = 평균 정확도(KPI) × 속도 순위 계수 × 비용 순위 계수. 계수는 1위 1.00 → 꼴찌 0.75(등 간격)
  // 가장 빠르면서 가장 싸고 정확도 100인 모델만 100점이 되므로, 정확도가 같아도 속도 · 비용에서 차이가 난다
  const has = st.filter(s => s.ok), N = has.length, cf = i => 1 - 0.25 * i / Math.max(N - 1, 1);
  const rk = k => [...has].sort((a, b) => a[k] - b[k]).forEach((s, i) => s[k + 'C'] = cf(i));
  rk('lat'); rk('cost'); has.forEach(s => s.total = s.score * s.latC * s.costC);
  [...has].sort((a, b) => b.total - a.total).forEach((s, i) => s.rel = i + 1);
  return st;
}
// 추천: 실측 모델 중 종합 점수가 가장 높은 모델. 가상 예시는 추천에서 뺀다
function aiPick(st) { const c = st.filter(s => s.ok && !s.sim).sort((a, b) => b.total - a.total); return c[0] || null; }

function aiCard(m, s) {
  const b = UI.bench && UI.bench.items[m.model_id], last = !b && (S.bench || []).filter(r => r.model_id === m.model_id).sort((x, y) => y.id - x.id)[0], sk = !b && (UI.benchSkip || {})[m.model_id];
  const st = b ? b.status : sk ? 'skip' : last ? (last.ok ? 'done' : 'err') : 'idle';
  const r = b ? b.res || {} : sk ? { msg: sk } : last ? { latency_ms: last.latency_ms, cost_usd: last.cost_usd, score: last.score, checks: typeof last.checks === 'string' ? JSON.parse(last.checks) : last.checks, text: last.text, msg: last.err } : {};
  const ck = r.checks || {}, tot = !b && s && s.total != null, sc = tot ? Math.round(s.total) : r.score, p = AI_PROV[m.provider], sim = !b && last && last.simulated;
  const ring = sc == null ? '' : `<svg class="airing" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18"/><circle class="v ${sc >= 90 ? 'g' : sc >= 70 ? 'o' : 'r'}" cx="22" cy="22" r="18" stroke-dasharray="${(sc / 100 * 113.1).toFixed(1)} 113.1" transform="rotate(-90 22 22)"/><text x="22" y="26" text-anchor="middle">${sc}</text></svg>${tot ? `<small class="airl">종합 ${s.rel}위</small>` : ''}`;
  const body = st === 'call' ? `<div class="aicall"><span class="aidots"><i></i><i></i><i></i></span>응답 기다리는 중 <b id="bt-${m.model_id}">0.0초</b></div>`
    : st === 'skip' ? `<div class="aiskip">${esc(r.msg || '키 미등록')}</div>`
    : st === 'err' ? `<div class="aierr">${esc(r.msg || '호출 실패')}</div>`
    : st === 'done' ? `<div class="aires"><span class="airw">${ring}</span><div class="aimet">${tot ? `<span><small>정확도</small><b>${s.score.toFixed(0)}점</b></span>` : ''}<span><small>응답</small><b>${(r.latency_ms / 1000).toFixed(1)}초</b></span><span><small>비용</small><b>${won(r.cost_usd)}</b></span></div></div>
        <div class="aichk"><span class="${(ck.missing || []).length ? 'bad' : 'ok'}">필수 사실 ${(ck.required || []).length - (ck.missing || []).length}/${(ck.required || []).length}</span><span class="${(ck.fabricated || []).length ? 'bad' : 'ok'}">지어낸 ID ${(ck.fabricated || []).length}${(ck.fabricated || []).length ? ` (${ck.fabricated.join(', ')})` : ''}</span><span class="${ck.heads === 3 ? 'ok' : 'bad'}">형식 ${ck.heads ?? 0}/3</span></div>
        ${sim ? '<div class="aisimn">가상 예시 값 · 실제 호출 아님(결제 전 모델)</div>' : r.text ? `<details class="aitxt"><summary>답변 보기</summary><pre>${esc(r.text)}</pre></details>` : ''}`
    : `<div class="aiidle">아직 실행 기록이 없습니다.</div>`;
  return `<div class="aicard ${st} ${p[1]}${sim ? ' sim' : ''}"><div class="aich"><span class="aipv ${p[1]}">${p[0]}</span><b>${esc(m.label)}</b><em>${m.tier}</em></div>
    <div class="aiid"><span class="aiidc"><code>${esc(m.model_id)}</code>${sim ? '<span class="aisimb">가상 예시</span>' : ''}</span><small>단가 $${m.price_in} / $${m.price_out} (100만 토큰 입력/출력)</small></div>${body}</div>`;
}
function viewAi() {
  const ms = aiModels(), st = aiStats(), pick = aiPick(st), run = UI.bench, busy = run && Object.values(run.items).some(x => x.status === 'call');
  const runsToday = new Set((S.bench || []).filter(r => !r.simulated && String(r.created_at || '').slice(0, 10) === new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)).map(r => r.run_id)).size;
  const step = !run ? 0 : busy ? 2 : 4, done = run ? Object.values(run.items).filter(x => x.status !== 'call').length : 0;
  const stepEl = (n, t, s) => `<div class="aistep ${step === n ? 'on' : step > n ? 'done' : ''}"><b>${step > n ? '✓' : n}</b><span><strong>${t}</strong><small>${s}</small></span></div>`;
  const mx = k => Math.max(...st.map(s => s[k] || 0), 0.000001);
  const rows = st.map(s => `<tr class="${pick && pick.m === s.m ? 'pick' : ''}"><td><span class="aipv ${AI_PROV[s.m.provider][1]}">${AI_PROV[s.m.provider][0]}</span> ${esc(s.m.label)}${s.sim ? ' <span class="aisimb">가상 예시</span>' : ''}${pick && pick.m === s.m ? ' <span class="badge g">추천</span>' : ''}</td><td class="c">${s.n || '-'}</td>
    <td class="c">${s.rate == null ? '-' : s.rate.toFixed(0) + '%'}</td>
    <td><span class="aibar"><i style="width:${s.lat == null ? 0 : s.lat / mx('lat') * 100}%"></i></span>${s.lat == null ? '-' : (s.lat / 1000).toFixed(1) + '초'}</td>
    <td><span class="aibar c"><i style="width:${s.cost == null ? 0 : s.cost / mx('cost') * 100}%"></i></span>${won(s.cost)}</td>
    <td><span class="aibar s"><i style="width:${s.score == null ? 0 : s.score}%"></i></span>${s.score == null ? '-' : s.score.toFixed(0) + '점'}</td>
    <td class="c">${s.rel ? `<b class="airel${s.rel <= 3 ? ' best' : ''}">${s.total.toFixed(1)}점 · ${s.rel}위</b>` : '-'}</td></tr>`).join('');
  // 비용(로그) × 정확도 산점도: 왼쪽 위일수록 싸고 정확함
  const pts = st.filter(s => s.ok).map(s => ({ s, x: Math.log10(Math.max(s.cost * AI_KRW, 0.01)), y: s.score })), xs = pts.map(p => p.x);
  const lo = Math.min(70, Math.floor(Math.min(...pts.map(p => p.y), 100) / 10) * 10 - 10);   // 세로 눈금 아래 끝: 점수가 몰려 있으면 70점부터 그려 점이 겹치지 않게
  const x0 = Math.min(...xs, 0) - 0.3, x1 = Math.max(...xs, 0) + 0.3, X = x => 50 + (x - x0) / (x1 - x0) * 490, Y = y => 190 - Math.max(0, y - lo) / (100 - lo) * 170;
  // 같은 자리(비용 · 정확도가 같은 모델)는 이름을 한 줄로 묶고, 오른쪽 끝 이름은 왼쪽으로 붙여 잘리지 않게 한다
  const grp = []; pts.filter(p => !p.s.sim).forEach(p => { const px = X(p.x), py = Y(p.y), g = grp.find(q => Math.abs(q.px - px) < 6 && Math.abs(q.py - py) < 6); if (g) g.ps.push(p); else grp.push({ px, py, ps: [p] }); });
  const sc = grp.sort((a, b) => a.px - b.px).map((g, i) => { const anc = g.px > 470 ? 'end' : g.px < 110 ? 'start' : 'middle', name = g.ps.map(p => esc(p.s.m.label.replace(/^(Claude|OpenAI|Gemini) /, ''))).join(' · ');
    return `<g transform="translate(${g.px.toFixed(1)},${g.py.toFixed(1)})">${g.ps.map((p, k) => `<circle r="7" cx="${k * 5}" class="${AI_PROV[p.s.m.provider][1]}${p.s.sim ? ' sim' : ''}"/>`).join('')}<text x="${anc === 'end' ? 6 : anc === 'start' ? -6 : 0}" y="${i % 2 ? 22 : -12}" text-anchor="${anc}">${name}</text></g>`; }).join('') + pts.filter(p => p.s.sim).map(p => `<circle r="6" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" class="${AI_PROV[p.s.m.provider][1]} sim"><title>${esc(p.s.m.label)} · 가상 예시</title></circle>`).join('');
  return `<div class="pg pg-ai">${pvHead('AI 운영 센터', 'AI', '어떤 AI 모델이 우리 공장 요약을 가장 잘 하나?', '같은 서버 사실을 회사별 모델에 동시에 주고 응답 속도 · 비용 · 정확도를 실측합니다', '<span class="pvai">AI는 요약 문장만 씁니다 · 순위 · 판단 규칙은 서버</span>')}
    <section class="aipipe ${busy ? 'busy' : ''}">
      ${stepEl(1, '서버 사실 읽기', `tp_ai_facts · 사건 ${openIncidents().length}건 · 설비 ${Object.keys(S.equipment).length}대`)}<i class="aiarr"></i>
      ${stepEl(2, `모델 ${ms.length}개 동시 호출`, run ? `${done}/${ms.length} 응답` : '같은 지시문 · 같은 데이터')}<i class="aiarr"></i>
      ${stepEl(3, '자동 채점', '필수 사실 50 · 지어낸 ID 없음 30 · 형식 20')}<i class="aiarr"></i>
      ${stepEl(4, '저장 · 추천', '서버 tp_ai_bench에 기록 → 누적 비교')}
      <span class="grow"></span>
      <button class="btn pri aigo" data-act="benchRun" ${busy || !UI.canWrite ? 'disabled' : ''} title="${UI.canWrite ? '' : '시연 코드(조작 권한)가 있어야 실행할 수 있습니다'}">${busy ? '비교 실행 중…' : '▶ 모델 비교 실행'}<small>오늘 ${Math.min(runsToday, 3)}/3회</small></button></section>
    <div class="aicards">${ms.map(m => aiCard(m, st.find(x => x.m === m))).join('')}</div>
    <div class="airow">
      <section class="panel"><div class="ph"><h2>누적 비교</h2><span class="sub">서버 기록 ${(S.bench || []).length}건(실측 ${(S.bench || []).filter(r => !r.simulated).length} · 가상 예시 ${(S.bench || []).filter(r => r.simulated).length}) · 종합 점수 = 평균 정확도 × 속도 순위 계수 × 비용 순위 계수(1위 1.00 → 꼴찌 0.75) · 응답 성공률 = 정상 응답 ÷ 호출 · 비용은 실제 토큰 × 단가(1 USD = ${AI_KRW.toLocaleString()}원 가정)</span></div>
        <div class="tw"><table class="aitab"><thead><tr><th>모델</th><th class="c">호출</th><th class="c">응답 성공률</th><th>평균 응답 시간</th><th>건당 비용</th><th>평균 정확도</th><th class="c">종합 점수(상대평가)</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="panel aipick"><div class="ph"><h2>추천 모델</h2><span class="sub">실측 모델 중 종합 점수 1위</span></div>
        ${pick ? `<div class="aipk"><span class="aipv ${AI_PROV[pick.m.provider][1]}">${AI_PROV[pick.m.provider][0]}</span><b>${esc(pick.m.label)}</b><p>종합 ${pick.total.toFixed(1)}점(전체 ${pick.rel}위) · 정확도 ${pick.score.toFixed(0)}점 · 건당 ${won(pick.cost)} · ${(pick.lat / 1000).toFixed(1)}초</p></div>` : '<div class="empty">기준을 넘은 모델이 아직 없습니다. 비교를 실행하세요.</div>'}
        <svg class="aisc" viewBox="0 0 560 220"><line x1="50" y1="190" x2="550" y2="190"/><line x1="50" y1="12" x2="50" y2="190"/><line class="g90" x1="50" y1="${Y(90)}" x2="550" y2="${Y(90)}"/><text x="46" y="${Y(90) + 4}" class="ax" text-anchor="end">90점</text><text x="46" y="${Y(100) + 4}" class="ax" text-anchor="end">100</text><text x="46" y="194" class="ax" text-anchor="end">${lo}</text><text x="50" y="212" class="ax">실측 = 색 점(이름) · 가상 예시 = 점선 점</text><text x="550" y="212" class="ax" text-anchor="end">건당 비용 → (로그 눈금, 왼쪽이 쌈)</text>${sc}</svg></section></div>
    <div class="small aifoot">단가는 각 회사 공개 가격표 기준(2026-10 확인, 바뀔 수 있음)이며 서버 tp_ai_model 표에서 고칩니다. 「가상 예시」는 결제 전 모델의 화면 예시 값으로 실제 호출이 아니며 추천에서 뺍니다. 키가 없는 회사 모델은 '키 미등록'으로 건너뜁니다(ANTHROPIC_API_KEY · OPENAI_API_KEY · GEMINI_API_KEY는 Supabase 비밀값에만 둠).${S.aiBenchReady ? '' : ' · 서버에 비교 표(supabase_ai_bench.sql)가 아직 없어 실행 기록을 남길 수 없습니다.'}</div></div>`;
}
let benchTimer = null;
Object.assign(VIEW_RENDER, { ai: viewAi });
Object.assign(ACT, {
  async benchRun() {
    if (!UI.canWrite) { UI.codeOpen = true; render(); return; }
    const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ms = aiModels();
    UI.bench = { run, items: Object.fromEntries(ms.map(m => [m.model_id, { status: 'call', t0: performance.now() }])) }; render();
    clearInterval(benchTimer); benchTimer = setInterval(() => { if (!UI.bench) return; for (const [k, x] of Object.entries(UI.bench.items)) { const el = document.getElementById('bt-' + k); if (el && x.status === 'call') el.textContent = ((performance.now() - x.t0) / 1000).toFixed(1) + '초'; } }, 100);
    await Promise.all(ms.map(async m => { let r; try { r = await API.aiBench(m.model_id, run); } catch (e) { r = { ok: false, msg: String(e.message || e) }; }
      UI.bench.items[m.model_id] = { status: r.skipped ? 'skip' : r.ok ? 'done' : 'err', res: r }; if (r.skipped) (UI.benchSkip ||= {})[m.model_id] = r.msg; if (UI.view === 'ai') render(); }));
    clearInterval(benchTimer);
    const quota = Object.values(UI.bench.items).find(x => /하루 3회|시연 코드/.test(x.res?.msg || ''));
    toast(quota ? quota.res.msg : `모델 비교 완료: ${Object.values(UI.bench.items).filter(x => x.status === 'done').length}개 응답 · 서버에 기록했습니다.`, !!quota);
    await reload(); UI.bench = null; render();
  },
});
