// ---------- 3D 관제 연출(확장 데모 · 과제 제외범위를 팀이 시연용으로 구현) ----------
// 수요기업(팀솔루션 DXE·KAIROS) 화면 문법을 따름: 짙은 남색 배경 + 밝은 모델, 바닥에 그린 정보(공정 번호·상태 테두리·이송 경로),
// 지시선 말풍선, 단계 자막 + 근거 표시, 하단 KPI·우상단 알람. 모든 숫자·색은 서버 데이터(t3State·caseSteps)에서 나온다.
//  - 톤: 관제(야간) ↔ 주간           - PLAN: 지붕·크레인을 걷어낸 평면 관제
//  - 사건 장면: 알람 → 카메라 이동 → 말풍선 → 점검 절차(서버 규칙 그대로 실행)
//  - TOUR: 조감 → 흐름 → 평면 → 사건 → 절차 → 도크 자동 순회(발표·예비 영상용)
const T3X = { theme: 'night', plan: false, inc: null, tour: null, lq: !T3_HQ, fly: null, key: {} };   // lq: 휴대폰·작은 화면·자동 테스트는 저화질(그림자·흐르는 화살표 끔)으로 시작, 버튼으로 바꿈
const T3X_COL = { g: '#4ade80', r: '#ff5a4f', o: '#f5b041', b: '#6fd3ff', n: '#8a96a8' };
const T3X_ICO = { g: '▶', r: '■', o: '‖', b: '✓', n: '·' };   // 색만으로 구분하지 않도록 상태 기호를 함께 쓴다
const T3X_NAVY = 0x0a1322;
const T3X_HIDE_PLAN = ['P01_crane', 'P02_crane', 'P02_gantry', 'P03_crane', 'GOL_trolley', 'static_P03__roof_gray', 'static_P03__skylight', 'static_P05__roof_gray', 'static_P05__skylight'];
const T3X_HOME = [[-215, -150, 105], [-10, 6, 0]], T3X_PLAN = [[0, -34, 282], [0, 2, 0]];
const T3X_CUT = ['roof_gray', 'skylight', 'wall_blue', 'wall_white', 'ban_hall', 'ban_paint', 'louver'];   // 사건 장면에서 걷어내는 건물 외피(03 용접동·05 도장동)
const t3xEase = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

function t3xInit() {   // t3Init 끝에서 한 번: 원래 낮 설정을 기억하고, 바닥 표기·경로·말풍선 층을 만든다
  const T = T3.THREE, sc = T3.scene, B = { mats: [] };
  sc.traverse(o => { if (o.isMesh && o.material?.uniforms?.sunPosition) B.sky = o;
    if (o.isDirectionalLight) B.sun = { o, i: o.intensity, c: o.color.getHex() };
    if (o.isHemisphereLight) B.hemi = { o, i: o.intensity, c: o.color.getHex(), g: o.groundColor.getHex() }; });
  B.fog = sc.fog; B.env = sc.environment; B.exp = T3.r.toneMappingExposure;
  const NIGHT = { sea: 0x06101e, hill: 0x0c1626, tree: 0x0d1a22, trunk: 0x0d1a22 };   // 바닥(콘크리트·아스팔트·작업장)은 실제 색 유지(사용자 검토: 실제 바닥 색이 낫다)
  const DIM = { ground: 0.8, pad: 0.8, concrete: 0.82, asphalt: 0.85 };   // 관제 톤에서 바닥만 약 20% 어둡게(상태 테두리 대비, GPT QC 1차)
  const GLOW = { lamp: [0xfff1c8, 2.5], lamp_orange: [0xffb257, 2.5], glass: [0x1d4f7a, 0.9], skylight: [0x2a6fa8, 0.8] };
  const seen = new Set();
  sc.traverse(o => { if (!o.isMesh || !o.material?.name || seen.has(o.material)) return; const m = o.material, n = m.name.replace(/\.\d+$/, ''); seen.add(m);
    if (NIGHT[n] != null || GLOW[n] || DIM[n]) B.mats.push({ m, n, c: m.color.getHex(), e: m.emissive?.getHex(), ei: m.emissiveIntensity, env: m.envMapIntensity }); });
  B.NIGHT = NIGHT; B.GLOW = GLOW; B.DIM = DIM; T3X.base = B;
  // 바닥 표기: 공정마다 번호·이름·상태 판(도로 앞 띠) + 작업장 테두리(상태 색) + 발광 테두리
  T3X.floor = {}; T3X.g = new T.Group(); sc.add(T3X.g);
  const strip = (x, y, sx, sy, mat, z) => { const m = new T.Mesh(new T.PlaneGeometry(sx, sy), mat); m.position.set(x, y, z); m.renderOrder = 2; return m; };
  for (const p of T3_PROC) {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 224;
    const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 8;
    const lab = strip(T3_X[p], -26.6, 40, 7, new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, toneMapped: false }), 0.42);
    const line = new T.MeshBasicMaterial({ color: 0x8a96a8, toneMapped: false }), glow = new T.MeshBasicMaterial({ color: 0x8a96a8, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    const fr = new T.Group(), W = 41, H = 45, x = T3_X[p];
    for (const [t, mat, z] of [[0.45, line, 0.44], [2.2, glow, 0.43]]) for (const [cx, cy, sx, sy] of [[x, -H / 2, W + t, t], [x, H / 2, W + t, t], [x - W / 2, 0, t, H + t], [x + W / 2, 0, t, H + t]]) fr.add(strip(cx, cy, sx, sy, mat, z));
    const ring = new T.Mesh(new T.RingGeometry(23, 24.2, 64), new T.MeshBasicMaterial({ color: 0xff5a4f, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })); ring.position.set(x, 0, 0.46); ring.visible = false;
    T3X.g.add(lab, fr, ring); T3X.floor[p] = { cv, tx, lab, line, glow, ring };
  }
  // 이송 경로: 도로 위 선 + 흘러가는 화살표(01 → 06)
  const road = new T.MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false }), roadGlow = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false });
  T3X.g.add(strip(0, -31, 276, 0.4, road, 0.45), strip(0, -31, 276, 2.4, roadGlow, 0.44));
  const sh = new T.Shape(); sh.moveTo(-1.4, -1.3); sh.lineTo(1.6, 0); sh.lineTo(-1.4, 1.3); sh.lineTo(-0.5, 0); sh.lineTo(-1.4, -1.3);
  T3X.arrows = new T.InstancedMesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: 0xbae6fd, toneMapped: false }), 46); T3X.arrows.renderOrder = 3; T3X.g.add(T3X.arrows);
  T3X.m4 = new T.Matrix4(); t3xArrows(0);
  // 말풍선(지시선) 층
  T3X.cl = document.createElement('div'); T3X.cl.className = 'xcl'; T3X.cl.innerHTML = '<svg class="xclsvg"></svg><div class="xclbox"></div>'; T3.labels.appendChild(T3X.cl);
  T3X.planNodes = T3X_HIDE_PLAN.map(n => T3.find(n)).filter(Boolean);
  T3X.cut = {}; for (const p of ['P03', 'P05']) T3X.cut[p] = T3X_CUT.map(m => T3.find(`static_${p}__${m}`)).filter(Boolean);
  T3.r.shadowMap.autoUpdate = false; T3.r.shadowMap.needsUpdate = true;   // 그림자는 물체가 움직이거나 보이기가 바뀔 때만 다시 계산(카메라·화살표만 바뀌면 그대로)
  t3xTheme(); t3xQuality(); t3xSync();
}
function t3xArrows(t) { const n = T3X.arrows.count, step = 6, off = (t * 5) % step;
  for (let i = 0; i < n; i++) { const x = -136 + i * step + off; T3X.m4.makeTranslation(Math.min(136, x), -31, 0.47); T3X.arrows.setMatrixAt(i, T3X.m4); }
  T3X.arrows.instanceMatrix.needsUpdate = true; }
function t3xTheme() {   // 관제(짙은 남색) ↔ 주간
  const T = T3.THREE, sc = T3.scene, B = T3X.base, n = T3X.theme === 'night';
  if (B.sky) B.sky.visible = !n;
  sc.background = n ? new T.Color(T3X_NAVY) : null; sc.fog = n ? new T.Fog(T3X_NAVY, 320, 1250) : B.fog;
  T3.r.toneMappingExposure = n ? 0.62 : B.exp;
  if (B.sun) { B.sun.o.intensity = n ? 2.2 : B.sun.i; B.sun.o.color.setHex(n ? 0xd6e4ff : B.sun.c); }
  if (B.hemi) { B.hemi.o.intensity = n ? 1.3 : B.hemi.i; B.hemi.o.color.setHex(n ? 0xc4d6f2 : B.hemi.c); B.hemi.o.groundColor.setHex(n ? 0x101a2b : B.hemi.g); }
  for (const x of B.mats) { const nc = B.NIGHT[x.n], gl = B.GLOW[x.n], dm = B.DIM[x.n];
    if (dm) x.m.color.setHex(x.c).multiplyScalar(n ? dm : 1);
    if (nc != null) { x.m.color.setHex(n ? nc : x.c); if (x.env != null) x.m.envMapIntensity = n ? 0.35 : x.env; }
    if (gl && x.m.emissive) { x.m.emissive.setHex(n ? gl[0] : x.e); x.m.emissiveIntensity = n ? gl[1] : x.ei; } }
  for (const p of T3_PROC) { const f = T3X.floor[p]; if (f) f.glow.visible = n; }
  T3.dirty = true;
}
function t3xQuality() { if (!T3.r) return; T3.r.setPixelRatio(T3X.lq ? 1 : Math.min(2, window.devicePixelRatio || 1)); T3.r.shadowMap.enabled = !T3X.lq; T3X.shadow = true;
  T3.scene.traverse(o => { if (o.material && o.isMesh) o.material.needsUpdate = true; }); t3Resize(); T3.dirty = true; }
function t3xSync() {   // 상태가 바뀐 공정만 바닥 판을 다시 그린다
  if (!T3X.floor) return;
  for (const p of T3_PROC) { const s = T3.st[p], f = T3X.floor[p]; if (!f) continue;
    const c = s ? s.c : 'n', key = [c, s?.w.block_id, s && t3Qty(s.w), s?.word, T3X.inc].join('|');
    f.line.color.set(T3X_COL[c]); f.glow.color.set(T3X_COL[c]);
    if (T3X.key[p] === key) continue; T3X.key[p] = key;
    const g = f.cv.getContext('2d'); g.clearRect(0, 0, 1280, 224);
    g.fillStyle = 'rgba(8,15,28,.72)'; g.fillRect(0, 0, 1280, 224); g.fillStyle = T3X_COL[c]; g.fillRect(0, 0, 14, 224);
    g.textBaseline = 'middle'; g.fillStyle = T3X_COL[c]; g.font = 'bold 168px "IBM Plex Mono", monospace'; g.fillText(p.slice(1), 40, 118);
    g.fillStyle = '#eef4ff'; g.font = 'bold 72px "Noto Sans KR", sans-serif'; g.fillText(proc(p).process_name, 300, 66);
    g.font = 'bold 76px "Noto Sans KR", sans-serif'; const st = `${T3X_ICO[c]} ${s ? s.word : '작업 없음'}`, sw = g.measureText(st).width;
    g.fillStyle = T3X_COL[c]; g.fillRect(286, 112, sw + 32, 96); g.fillStyle = '#08111f'; g.fillText(st, 302, 162);   // 상태 단어는 색 띠 위 검은 글씨(뒤쪽 공정에서도 대비 유지)
    if (s) { g.fillStyle = 'rgba(238,244,255,.8)'; g.font = 'bold 50px "IBM Plex Mono", monospace'; const t = s.w.block_id; g.fillText(t, 1256 - g.measureText(t).width, 66); }
    f.tx.needsUpdate = true; }
  T3.dirty = true;
}
// ---------- 카메라 이동 ----------
function t3xFly(pos, tgt, dur = 2.2) { const V = T3.THREE.Vector3;
  T3X.fly = { p0: T3.cam.position.clone(), t0: T3.ctl.target.clone(), p1: new V(...pos), t1: new V(...tgt), s: performance.now(), d: dur * 1000 }; T3.dirty = true; }
function t3xPlanSet(on) { T3X.plan = on; T3X.shadow = true; for (const o of T3X.planNodes || []) o.visible = !on;
  for (const p of T3_PROC) { const l = T3X.floor?.[p]?.lab; if (l) { l.scale.setScalar(on ? 1.15 : 1); l.position.y = on ? -27.5 : -26.6; } }   // 평면에서는 상태 판을 키운다
  t3xCutSet(T3X.cutP); }
function t3xCutSet(p) { T3X.cutP = p || null; T3X.shadow = true; for (const k in T3X.cut || {}) for (const o of T3X.cut[k]) o.visible = k !== p && !(T3X.plan && T3X.planNodes.includes(o)); T3.dirty = true; }   // 사건 공정의 건물 외피만 걷어 안을 보인다
function t3xTitle() { if (T3X.tour) { const R = T3X.tour; return `자동 순회 · ${R.shots[Math.max(0, R.i)].k}`; }
  if (T3X.inc) return `사건 현장 · ${T3X.inc}`; return T3X.plan ? '평면 관제' : '조선소 전체'; }
const t3xIncProc = inc => inc.work_order_id ? S.wo[inc.work_order_id].process_id : eqOf(inc.equipment_id || incEquipment(inc))?.process_id;
function t3xIncView(p) { const x = T3_X[p]; return [[x - 30, -70, 58], [x + 3, -2, 2]]; }
function t3xFrame(now) {   // t3Loop에서 매 프레임: 카메라 이동·자동 순회·화살표·사건 고리. 다시 그려야 하면 true
  let need = false;
  if (T3X.tour) need = t3xTourTick(now) || need;
  const F = T3X.fly; if (F) { const k = Math.min(1, (now - F.s) / F.d), e = t3xEase(k);
    T3.cam.position.lerpVectors(F.p0, F.p1, e); T3.ctl.target.lerpVectors(F.t0, F.t1, e); T3.ctl.update(); if (k >= 1) T3X.fly = null; need = true; }
  if (!T3X.lq && !document.hidden && now - (T3X.al || 0) > 66) { T3X.al = now; t3xArrows(now / 1000); need = true; }   // 화살표는 초당 15장까지만(가벼움 우선)
  const ip = T3X.inc && incById(T3X.inc) && t3xIncProc(incById(T3X.inc));
  for (const p of T3_PROC) { const r = T3X.floor[p]?.ring; if (!r) continue; const on = p === ip; r.visible = on;
    if (on) { const k = (now / 1400) % 1; r.scale.setScalar(0.92 + k * 0.25); r.material.opacity = 0.9 * (1 - k); need = true; } }
  return need;
}
// ---------- 말풍선(지시선) ----------
function t3xCallouts() {
  const inc = T3X.inc && incById(T3X.inc); if (!inc || SIM.on) return [];
  const cs = caseSteps(inc), p = t3xIncProc(inc), w = cs.w, e = cs.e, out = [];
  const pos = n => { const o = T3.find(n); if (!o) return null; const b = new T3.THREE.Box3().setFromObject(o); const c = b.getCenter(new T3.THREE.Vector3()); c.z = b.max.z; return c; };
  const bp = pos(`${p}_beacon`), kp = pos(`${p}_block`) || (bp && bp.clone().setZ(3));
  const sub = substitutes(inc)[0];
  if (bp) out.push({ at: bp, dx: 120, dy: -120, c: inc.category === 'EQUIPMENT' ? 'r' : 'o', h: `${inc.category === 'EQUIPMENT' ? '고장 설비' : '관련 설비'} · ${esc(e?.equipment_id || '')}`, s: `${esc(e?.equipment_name || '')} · ${STATUS.eq[e?.status]?.[0] || ''} · ${hm(inc.opened_at)}부터`, n: '①' });
  if (kp && w) out.push({ at: kp, dx: -200, dy: -150, c: w.status === 'BLOCKED' ? 'r' : 'b', h: `${w.status === 'BLOCKED' || nodeState(w).stop ? '생산 중단 블록' : '영향 블록'} · ${w.block_id}`, s: `${esc(proc(w.process_id).process_name)} · ${t3Qty(w)} · ${STATUS.wo[w.status][0]}`, n: '②' });
  if (sub && bp) out.push({ at: bp.clone().add(new T3.THREE.Vector3(9, 7, 0)), dx: 170, dy: 60, c: 'b', h: `${w && w.equipment_id === sub.equipment_id ? '대체 투입 설비' : '대체 검토 설비'} · ${esc(sub.equipment_id)}`, s: `${esc(sub.equipment_name)} · ${STATUS.eq[sub.status][0]} · 같은 공정`, n: '③' });
  return out;
}
function t3xPlace() {   // 말풍선 위치(매 그림마다)
  if (!T3X.cl) return; const list = t3xCallouts(), w = T3.r.domElement.clientWidth, h = T3.r.domElement.clientHeight;
  const svg = T3X.cl.firstChild, box = T3X.cl.lastChild; let lines = '', html = '';
  for (const c of list) { const v = c.at.clone().project(T3.cam); if (v.z > 1) continue;
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h, bx = Math.max(8, Math.min(w - 240 - (T3X.inc ? 290 : 0), x + c.dx)), by = Math.max(70, Math.min(h - 250, y + c.dy));
    lines += `<line x1="${x}" y1="${y}" x2="${bx + (c.dx < 0 ? 228 : 0)}" y2="${by + 22}" class="${c.c}"/><circle cx="${x}" cy="${y}" r="5" class="${c.c}"/>`;
    html += `<div class="xbox ${c.c}" style="transform:translate(${bx}px,${by}px)"><i>${c.n}</i><b>${c.h}</b><span>${c.s}</span></div>`; }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.innerHTML = lines; box.innerHTML = html;
}
// ---------- HUD ----------
const T3X_STEP_TXT = {
  act: ['현장에서 고장을 확인하고 기록합니다.', '기록이 남아야 다음 사람이 같은 확인을 반복하지 않습니다.'],
  actM: ['부족한 부재를 확인하고 긴급 공급 요청을 기록합니다.', '언제 무엇이 오는지 남겨야 뒤 공정이 일정을 다시 잡습니다.'],
  actQ: ['불합격 위치를 확인하고 보수 조치를 기록합니다.', '보수 기록이 있어야 재검사를 할 수 있습니다.'],
  check: ['같은 공정의 다른 설비 중 쓸 수 있는 것이 있는지 봅니다.', '고장 설비를 고치는 동안 작업을 멈추지 않기 위해서입니다.'],
  fit: ['대체 설비가 이 작업에 맞는지 4가지(용접 절차·출력·작업자 자격·위치)로 확인합니다.', '아무 설비나 쓰면 품질 문제가 생깁니다.'],
  approve: ['생산관리 담당이 대체 투입을 승인합니다.', '설비를 바꾸는 결정은 책임자가 내립니다.'],
  swap: ['남은 작업만 대체 설비로 옮깁니다.', '이미 한 실적은 원래 설비 기록에 그대로 남습니다.'],
  resume: ['작업을 다시 시작합니다.', '멈춘 시간이 길수록 뒤 공정이 밀립니다.'],
  close: ['고장 설비 정비가 끝나면 복구를 확인하고 사건을 닫습니다.', '사건은 설비가 돌아올 때까지 열려 있습니다.'],
  resolve: ['조치 결과를 확인하고 사건을 해소합니다.', '해소해야 보류가 풀립니다.'],
};
function t3xEvidence(inc, cs, a) {   // 근거: 서버 데이터에서 그대로
  const w = cs.w, f = [];
  f.push(`${inc.incident_id} ${hm(inc.opened_at)} 발생 · ${esc(inc.summary)}`);
  if (w) f.push(`작업지시 ${w.work_order_id} · ${t3Qty(w)} · ${STATUS.wo[w.status][0]}`);
  if (cs.e) f.push(`설비 ${cs.e.equipment_id} 상태 ${STATUS.eq[cs.e.status][0]}`);
  if (a && a.key === 'check') f.push(`같은 공정 설비 ${substitutes(inc).map(e => `${e.equipment_id} ${STATUS.eq[e.status][0]}`).join(', ') || '없음'}`);
  if (a && a.key === 'fit') { const sub = substitutes(inc).find(e => !['FAULT', 'MAINTENANCE'].includes(e.status)), fit = sub && S.fit.find(x => x.equipment_id === sub.equipment_id && x.process_id === w.process_id);
    if (fit) f.push(`${sub.equipment_id} 적합성 기준정보: WPS ${fit.wps_state} · 출력 ${fit.power_state} · 자격 ${fit.cert_state} · 위치 ${fit.loc_state}`); }
  if (a && a.key === 'swap' && w) f.push(`남은 작업 ${+(w.planned_qty - w.accepted_qty).toFixed(1)} ${unit(w.unit)}`);
  return f;
}
function t3xKpis() {
  const k = kpis(), g = progressKpi(), st = Object.values(T3.st || {}), stopped = todayWos().filter(w => nodeState(w).stop).length;
  return [['오늘 생산 달성률', `${pct(g.a, 0)}<small>계획 ${pct(g.p, 0)}</small>`, g.gap >= 0.5 ? 'o' : '', '오늘 작업지시 6건의 실적 비율(인정수량 ÷ 계획수량) 평균. 작은 글씨는 지금 시각까지 끝났어야 할 계획 비율'],
    ['현재 작업 중 공정', `${st.filter(s => s.c === 'g').length}<small>/ 6</small>`, '', '설비가 돌고 있는 공정 수(공정 6개 = 작업장 6곳)'],
    ['멈춘 작업지시', `${stopped}<small>건</small>`, stopped ? 'r' : '', '고장·자재 대기·품질 보류로 멈춘 오늘 작업지시 수'], ['미해결 사건', `${k.open}<small>건</small>`, k.open ? 'r' : '', '아직 닫히지 않은 사건 수(사건 1건이 작업 여러 개를 멈출 수 있음)']];
}
function t3xBrief() {   // 운영 브리핑: 판단 1줄 + 핵심·영향·전체 3줄(서버 값으로 즉시 계산). AI 요약이 있으면 따로 펼쳐 볼 수 있다
  const incs = openIncidents(), k = kpis(), g = progressKpi(), top = focusCase()[0] || incs[0];
  let judge = '조치할 사건이 없습니다', core = '모든 공정 정상 흐름';
  if (top) { const cs = caseSteps(top), w = cs.w, sub = substitutes(top).filter(x => !['FAULT', 'MAINTENANCE'].includes(x.status))[0];
    judge = cs.active ? (top.category === 'EQUIPMENT' && sub && ['act', 'check', 'fit', 'approve', 'swap'].includes(cs.active.key) ? `${sub.equipment_id} 대체 검토 필요 (${top.incident_id})` : `${cs.active.title} 필요 (${top.incident_id})`) : `${top.incident_id} 처리 완료`;
    core = `${cs.e.equipment_id} ${STATUS.cat[top.category][0]}${w ? ` → ${w.block_id} ${proc(w.process_id).process_name} ${STATUS.wo[w.status][0]}` : ''}`; }
  const rest = incs.filter(i => i !== top), cat = c => rest.filter(i => i.category === c).length;
  const eff = rest.length ? [cat('MATERIAL') && `자재 대기 ${cat('MATERIAL')}건`, cat('QUALITY') && `품질 보류 ${cat('QUALITY')}건`, cat('EQUIPMENT') && `다른 설비 고장 ${cat('EQUIPMENT')}건`].filter(Boolean).join(', ') : '다른 사건 없음';
  const ai = S.ai;
  return `<div class="xbrief"><div class="xalh">운영 브리핑<small>규칙 기반 · 서버 값으로 즉시 계산</small></div>
    <div class="xjudge">운영 판단: ${esc(judge)}</div>
    <div class="xbl"><span>핵심</span>${esc(core)}</div><div class="xbl"><span>영향</span>${esc(eff)}</div><div class="xbl"><span>전체</span>오늘 생산 달성률 ${pct(g.a, 0)} · 미해결 사건 ${k.open}건</div>
    ${ai ? `<details class="xai"><summary>AI 요약 보기 · ${hm(ai.sim_at)} 생성${ai.sim_at === nowS() ? '' : ' · 이후 변경 있음'}</summary><p>${esc(ai.text)}</p></details>` : ''}
    <div class="xbrow"><span>근거: 서버 DB의 설비·작업지시·사건</span><button class="txlink" data-act="aiGen" ${!UI.canWrite || UI.aiBusy ? 'disabled title="시연 코드가 있어야 AI(Claude) 요약을 새로 만들 수 있습니다"' : ''}>${UI.aiBusy ? '생성 중…' : '✦ AI 요약 생성'}</button></div></div>`;
}
function t3xLog(inc) {   // 이 사건의 처리 기록(서버에 저장된 조치·단계 기록)
  const name = { check: '대체 가능 여부 확인', fit: '적합성 확인', approve: '관리자 승인', swap: '설비 변경', resume: '작업 재개', close: '복구·사건 종료' };
  const l = [...inc.actions.map(x => [x.at, `조치 기록 · ${x.note}`]), ...S.steps.filter(x => x.incident_id === inc.incident_id).map(x => [x.at, `${name[x.step] || x.step}${x.equipment_id ? ' · ' + x.equipment_id : ''}${x.by_name ? ' · ' + x.by_name : ''}`])]
    .sort((p, q) => String(p[0]).localeCompare(String(q[0])));
  const cs = caseSteps(inc), w = cs.w;   // 설비 변경·재개는 작업지시 상태로 남는다(같은 서버 값에서 표시)
  if (w && w.equipment_id !== cs.eqId && !l.some(x => x[1].startsWith('설비 변경'))) l.push([nowS(), `설비 변경 · 남은 작업 ${w.equipment_id}로 이관`]);
  if (w && w.equipment_id !== cs.eqId && w.status !== 'BLOCKED' && !l.some(x => x[1].startsWith('작업 재개'))) l.push([nowS(), `작업 재개 · ${w.block_id} ${STATUS.wo[w.status][0]}`]);
  if (inc.status === 'RESOLVED') l.push([inc.resolved_at, '사건 해소']);
  return l.slice(-5);
}
const T3X_QTY = { piece: '절단 부재', set: '소조립 세트', m: '용접 길이', point: '검사 위치', m2: '도장 면적', block: '이송 블록' };
function t3xImpact(inc, cs) {   // 사건 → 생산 영향 → 조치 목표(제목 아래)
  const w = cs.w, e = cs.e, sub = substitutes(inc).filter(x => !['FAULT', 'MAINTENANCE'].includes(x.status))[0];
  const what = inc.category === 'EQUIPMENT' ? `${esc(e.equipment_name)} 고장` : inc.category === 'MATERIAL' ? '부재 공급 지연' : '검사 불합격';
  const goal = inc.status === 'RESOLVED' ? '처리 완료 · 사건 닫힘' : cs.active?.key === 'close' ? `${cs.eqId} 정비 후 복구 확인 · 사건 종료(작업은 ${w?.equipment_id}에서 진행 중)` : inc.category === 'EQUIPMENT' ? (sub ? `대체 설비 ${sub.equipment_id} 검토 후 남은 작업 재개` : '설비 복구 후 작업 재개') : inc.category === 'MATERIAL' ? '부재 도착 확인 후 작업 재개' : '보수 · 재검사 합격 후 보류 해제';
  return `<div class="ximp"><b class="${inc.category === 'EQUIPMENT' ? 'r' : 'o'}">${what} → ${w ? `${w.block_id} ${nodeState(w).stop ? '생산 중단' : '영향'}` : '영향 확인 중'}</b>
    <div><span>영향 공정</span><em>${w ? `${proc(w.process_id).process_id.slice(1)} ${esc(proc(w.process_id).process_name)}` : '-'}</em><span>현재 상태</span><em>${w ? `${T3X_QTY[w.unit] || '작업량'} ${t3Qty(w)} · ${STATUS.wo[w.status][0]}` : '-'}</em><span>조치 목표</span><em>${goal}</em></div></div>`;
}
function t3xHud() {   // t3Shell 안(시뮬레이션이 아닐 때)
  if (SIM.on) return '';
  if (T3X.tour) return t3xTourHud();
  const incs = openIncidents(), sel = T3.sel, inc = T3X.inc && incById(T3X.inc);
  const kpi = `<div class="xkpi">${t3xKpis().map(([l, v, c, tip]) => `<div class="${c}" title="${tip}"><span>${l} ⓘ</span><b>${v}</b></div>`).join('')}</div>`;
  const alarms = sel ? '' : `<div class="xal"><div class="xalh">사건 알람 <b>${incs.length}</b><small>누르면 그 현장으로 이동</small></div>
    ${incs.length ? incs.map(i => { const p = t3xIncProc(i), c = i.category === 'EQUIPMENT' ? 'r' : 'o';
      return `<button class="xali ${c} ${T3X.inc === i.incident_id ? 'on' : ''}" data-act="t3inc" data-arg="${i.incident_id}"><i></i><b>${T3X_ICO[c]} ${p ? p.slice(1) + ' ' + esc(proc(p).process_name) : ''} · ${STATUS.cat[i.category][0]}</b><span>${i.incident_id} · ${hm(i.opened_at)} · ${esc(i.summary)}</span></button>`; }).join('') : '<p class="xnone">열린 사건이 없습니다.</p>'}
    ${T3X.plan ? '' : t3xBrief()}</div>`;   // 평면에서는 공정 판을 가리지 않게 알람만
  if (!inc) return alarms + `<div class="xbot">${kpi}<p class="xhint">바닥 테두리 색·기호 = 공정 상태 · 오른쪽 알람을 누르면 사건 현장으로 이동합니다 · <b>▶ 자동 순회</b>로 3분 시연</p></div>`;
  const cs = caseSteps(inc), a = cs.active, n = cs.st.findIndex(x => x === a), tx = a && (T3X_STEP_TXT[a.key === 'act' && inc.category !== 'EQUIPMENT' ? (inc.category === 'MATERIAL' ? 'actM' : 'actQ') : a.key]);
  const log = t3xLog(inc), mode = UI.canWrite ? '<em class="sv">저장 모드</em>' : '<em class="tr">체험 모드 · 저장 안 됨</em>';
  const steps = `<div class="xsteps"><div class="xalh">점검 절차 · ${inc.incident_id} ${mode}<button data-act="t3inc" data-arg="" title="사건 화면 닫기">✕</button></div>
    <div class="xleg">✓ 완료 · ● 지금 할 일 · ○ 대기</div>
    ${cs.st.map((x, i) => `<div class="xst ${x.done ? 'done' : x === a ? 'on' : ''}"><i>${x.done ? '✓' : x === a ? '●' : '○'}</i><span>${esc(x.title)}${x.key === 'approve' ? ' <u>승인 필요</u>' : ''}</span><small>${x.done ? '완료' : x === a ? '지금 할 일' : '대기'}</small></div>`).join('')}
    <div class="xsec">처리 기록 · 서버</div>${log.length ? log.map(([t, x]) => `<div class="xlog"><span>${hm(t)}</span>${esc(x)}</div>`).join('') : '<div class="xlog none">아직 기록이 없습니다. 아래 버튼을 누르면 여기에 남습니다.</div>'}
    <button class="txb wide" data-act="goInc" data-arg="${inc.incident_id}">작업 관리에서 처리 ›</button></div>`;
  const ev = t3xEvidence(inc, cs, a), L = T3X.last && T3X.last.inc === inc.incident_id ? T3X.last : null, w = cs.w;
  const still = w ? (nodeState(w).stop ? `${cs.e.equipment_id} ${STATUS.eq[cs.e.status][0]} · ${w.block_id} ${STATUS.wo[w.status][0]} 유지${a && a.key !== 'resume' ? ' (작업 재개 단계에서 바뀝니다)' : ''}` : `${w.block_id} ${STATUS.wo[w.status][0]} · ${w.equipment_id}에서 진행`) : '';
  const res = L ? `<div class="xres"><div><span>방금 처리</span><b>✓ ${esc(L.title)}</b></div><div><span>현재 상태</span><em>${esc(still)}</em></div><div><span>다음 단계</span><em>${a ? esc(a.title) : '없음 · 사건 종료'}</em></div></div>` : '';
  const cap = `<div class="xsub">${res}<small>${a ? `점검 절차 ${n + 1} / ${cs.st.length} · 지금 할 일` : '처리 완료'}</small>
    <h3>${a ? esc(a.title) : '모든 단계를 마쳤습니다'}</h3><p>${a ? `${tx[0]} <em>${tx[1]}</em>` : '사건이 닫혔고 공정 색이 바뀌었습니다. 다른 알람을 눌러 보세요.'}</p>
    <div class="xev"><b>근거 · 서버 데이터</b>${ev.map(x => `<span>${x}</span>`).join('')}</div>
    ${a ? `<div class="xrow"><button class="txb fill w" data-act="t3step" data-arg="${a.key}" ${UI.busy ? 'disabled' : ''}>${esc(a.btn)} ›</button><span class="xnote">누르면 서버 규칙으로 처리되고, 오른쪽 처리 기록과 3D 색이 함께 바뀝니다${a.key === 'act' ? ' (이 단계만으로는 공정이 다시 돌지 않습니다)' : ''}.</span></div>` : ''}</div>`;
  return t3xImpact(inc, cs) + steps + `<div class="xbot">${cap}</div>`;
}
// ---------- 자동 순회(TOUR) ----------
function t3xTourShots() {
  const st = Object.values(T3.st || {}), inc = focusCase()[0] || openIncidents()[0], cs = inc && caseSteps(inc), p = inc && t3xIncProc(inc);
  const cnt = c => st.filter(s => s.c === c).length, k = kpis(), g = progressKpi();
  const sub = inc && substitutes(inc)[0];
  const shots = [
    { k: '조선소 전체', see: '6개 공정의 위치와 블록이 흐르는 방향', h: '6개 조선 블록 생산 공정을 한눈에', cam: [[-240, -190, 140], [0, 10, 0]], drift: 0.25, d: 10, plan: false, inc: null,
      p: `블록 하나가 도로를 따라 <b>01 강재 절단 → 06 블록 이송</b>을 거쳐 뒤쪽 도크의 배가 됩니다. 지금 보이는 색과 숫자는 모두 서버 데이터(09/16 ${hm(nowS())} 기준)입니다.` },
    { k: '공정 흐름', see: '공정 번호 · 이송 경로 · 상태 색', h: '블록은 공정 순서에 따라 이동합니다', cam: [[-150, -96, 30], [-70, -24, 2]], pan: 120, d: 10, plan: false, inc: null,
      p: `바닥의 큰 번호가 공정 순서, 파란 화살표가 블록이 옮겨 가는 길입니다. 테두리 색이 상태입니다: <b class="g">초록 작업 중</b> · <b class="r">빨강 고장</b> · <b class="o">주황 대기·보류</b> · <b class="b">파랑 오늘 몫 끝남</b>.` },
    { k: '평면 관제', see: '공정마다 상태 판(기호+글자)과 하단 KPI', h: '색과 기호로 정상·대기·고장을 구분합니다', cam: T3X_PLAN, d: 10, plan: true, inc: null,
      p: `지붕과 크레인을 걷어내고 위에서 봅니다. 작업 중 ${cnt('g')}곳 · 멈춤 ${cnt('r') + cnt('o')}곳 · 미해결 사건 ${k.open}건. 계획 ${pct(g.p, 0)} 대비 실적 ${pct(g.a, 0)}입니다.` },
  ];
  if (inc) {
    const w = cs.w, e = cs.e;
    shots.push({ k: '사건 현장', see: '고장 설비 → 영향 블록 → 대체 후보', h: '설비 고장이 어느 블록 생산을 멈췄는지 봅니다', cam: t3xIncView(p), d: 11, plan: false, inc: inc.incident_id,
      p: `${hm(inc.opened_at)} <b class="r">${e.equipment_id} ${esc(e.equipment_name)}</b> ${STATUS.cat[inc.category][0]}(${inc.incident_id}). ${w ? `블록 ${w.block_id} ${esc(proc(w.process_id).process_name)}이 ${t3Qty(w)}에서 ${STATUS.wo[w.status][0]} 상태입니다.` : ''} 말풍선 ①②③이 고장 설비·멈춘 블록·대체 후보입니다.` });
    shots.push({ k: '점검 절차', see: '지금 할 일 · 근거 · 처리 기록', h: '근거 확인 → 조치 → 이력 기록', cam: [[T3_X[p] - 10, -78, 52], [T3_X[p] + 4, -2, 2]], d: 11, plan: false, inc: inc.incident_id,
      p: cs.active ? `다음 할 일은 <b>${esc(cs.active.title)}</b>입니다. ${sub ? `같은 공정의 ${sub.equipment_id}를 용접 절차·출력·자격·위치 4가지로 확인하고 승인받아 남은 작업만 옮깁니다.` : ''} 단계마다 근거(사건·작업지시·설비 상태)가 함께 표시되고, 버튼은 서버 규칙 그대로 실행됩니다.` : '이 사건은 모든 단계를 마쳤습니다.' });
  }
  shots.push({ k: '도크', see: '생산 공정의 마지막: 블록이 배에 탑재', h: '완성된 블록은 도크에서 배가 됩니다', cam: [[-40, -40, 78], [40, 44, 0]], drift: -0.18, d: 10, plan: false, inc: null,
    p: `완성된 블록은 골리앗 크레인으로 도크의 배에 탑재됩니다. 블록 한 개의 전 과정은 <b>공정 교육 재생</b>, 블록 속 부재 조립은 <b>블록 내부 3D</b>에서 이어서 볼 수 있습니다.` });
  return shots;
}
function t3xTourStart() { if (SIM.on || !T3.ready) return; T3.sel = null; T3X.tour = { i: -1, t: 0, last: performance.now(), play: true, shots: t3xTourShots() }; T3.ctl.enabled = false; render(); }
function t3xTourStop() { if (!T3X.tour) return; T3X.tour = null; T3X.inc = null; t3xPlanSet(false); t3xCutSet(null); T3.ctl.enabled = true; t3xFly(...T3X_HOME); t3xSync(); render(); }
function t3xTourGo(i) { const R = T3X.tour, s = R.shots[i]; R.i = i; R.t = 0; R.base = null;
  t3xPlanSet(!!s.plan); T3X.inc = s.inc; t3xCutSet(s.inc && t3xIncProc(incById(s.inc))); t3xSync(); t3xFly(s.cam[0], s.cam[1], i === 0 ? 1.8 : 2.4); render(); }
function t3xTourTick(now) { const R = T3X.tour; const dt = Math.min(0.1, (now - R.last) / 1000); R.last = now;
  if (R.i < 0) { t3xTourGo(0); return true; }
  if (R.play) R.t += dt;
  const s = R.shots[R.i];
  if (R.t >= s.d) { if (R.i + 1 < R.shots.length) t3xTourGo(R.i + 1); else { R.play = false; R.t = s.d; render(); } return true; }
  if (!T3X.fly && (s.drift || s.pan)) { const V = T3.THREE.Vector3; if (!R.base) R.base = { p: T3.cam.position.clone(), t: T3.ctl.target.clone(), t0: R.t };
    const k = (R.t - R.base.t0) / Math.max(1, s.d - R.base.t0);
    if (s.pan) { T3.cam.position.copy(R.base.p).add(new V(s.pan * k, 0, 0)); T3.ctl.target.copy(R.base.t).add(new V(s.pan * k, 0, 0)); }
    if (s.drift) { const off = R.base.p.clone().sub(R.base.t).applyAxisAngle(new V(0, 0, 1), s.drift * k); T3.cam.position.copy(R.base.t).add(off); T3.ctl.target.copy(R.base.t); }
    T3.ctl.update(); }
  const bar = document.getElementById('xtourBar'); if (bar) bar.style.width = `${Math.min(100, R.t / s.d * 100)}%`;
  return true;
}
function t3xTourHud() { const R = T3X.tour, s = R.shots[Math.max(0, R.i)], n = R.shots.length, i = Math.max(0, R.i);
  return `<div class="xtourl">${R.shots.map((x, j) => `<button class="${j < i ? 'done' : j === i ? 'on' : ''}" data-act="t3tourGo" data-arg="${j}">${p2(j + 1)} ${x.k}</button>`).join('')}</div>
    <div class="xbot"><div class="xsub tour"><small>자동 순회 ${i + 1} / ${n} · ${s.k}</small><h3>${s.h}</h3><div class="xsee">지금 보는 것 · ${s.see}</div><p>${s.p}</p><i class="xtbar"><em id="xtourBar"></em></i><span class="xnote">순회는 화면만 움직이며 데이터는 바꾸지 않습니다</span></div></div>`; }
function t3xBar() {   // 도구줄 버튼
  if (SIM.on) return '';
  if (T3X.tour) return `<button class="txb fill w" data-act="t3tourPlay">${T3X.tour.play ? '⏸ 일시정지' : T3X.tour.i + 1 >= T3X.tour.shots.length && T3X.tour.t >= T3X.tour.shots[T3X.tour.i].d ? '↺ 처음부터' : '▶ 계속'}</button><button class="txb" data-act="t3tourNext">다음 ⏭</button><button class="txb fill r" data-act="t3tourEnd">■ 순회 끝내기</button>`;
  return `<button class="txb fill w" data-act="t3tour" ${T3.ready ? '' : 'disabled'}>▶ 자동 순회</button>
    <button class="txb ${T3X.plan ? 'fill w' : ''}" data-act="t3plan">평면 보기</button>
    <button class="txb" data-act="t3theme" title="관제 톤(어두운 배경) ↔ 주간">${T3X.theme === 'night' ? '☀ 주간' : '☾ 관제 톤'}</button>
    <button class="txb" data-act="t3lq" title="느린 PC·휴대폰은 저화질">${T3X.lq ? '화질: 저' : '화질: 고'}</button>`;
}
Object.assign(ACT, {
  t3plan() { if (SIM.on) return; t3xPlanSet(!T3X.plan); T3X.inc = null; t3xCutSet(null); T3.sel = null; if (T3X.plan) t3xFly(...T3X_PLAN, 1.8); else t3xFly(...T3X_HOME, 1.8); t3xSync(); render(); },
  t3theme() { T3X.theme = T3X.theme === 'night' ? 'day' : 'night'; t3xTheme(); render(); },
  t3lq() { T3X.lq = !T3X.lq; t3xQuality(); render(); },
  t3inc(id) { if (SIM.on) return; T3X.inc = id || null; T3.sel = null;
    const p = id && t3xIncProc(incById(id)); t3xCutSet(p);
    if (id) { if (T3X.plan) t3xPlanSet(false); const v = t3xIncView(p); t3xFly(v[0], v[1]); } else t3xFly(...T3X_HOME);
    t3xSync(); render(); },
  async t3step(k) { const inc = incById(T3X.inc); if (!inc) return; const st = caseSteps(inc).st.find(x => x.key === k);
    UI.sel.inc = inc.incident_id; await stepDo(inc, k); T3X.last = { inc: inc.incident_id, key: k, title: st ? st.title : k }; T3.dirty = true; render(); },
  t3tour() { t3xTourStart(); },
  t3tourEnd() { t3xTourStop(); },
  t3tourPlay() { const R = T3X.tour; if (!R) return; if (!R.play && R.i + 1 >= R.shots.length && R.t >= R.shots[R.i].d) { R.shots = t3xTourShots(); t3xTourGo(0); R.play = true; return; } R.play = !R.play; render(); },
  t3tourNext() { const R = T3X.tour; if (!R) return; if (R.i + 1 < R.shots.length) t3xTourGo(R.i + 1); },
  t3tourGo(j) { if (T3X.tour) t3xTourGo(+j); },
});
function t3xReset() { T3X.tour = null; T3X.inc = null; T3X.fly = null; if (T3X.plan) t3xPlanSet(false); t3xCutSet(null); }
{ const ss = simStart; simStart = function () { t3xReset(); return ss.apply(this, arguments); }; }   // 공정 시뮬레이션은 크레인·카메라를 직접 쓰므로 연출 상태를 먼저 푼다
