// ---------- 블록 제조 화면(3D 확장 데모): 블록 하나가 강재 절단 → 소조립 → 블록 용접 → 검사 → 도장 → 이송을 거치는 과정 ----------
// 공정별 수량(piece·set·m·point·m²·block)과 진행률은 서버 데이터 그대로. 부재 이름·크기·무게는 엑셀에 없어 블록 무게·부재 수에 맞춘 '가상 부재 구성'.
const BK = { wrap: null, ready: false, err: null, block: null, s: null, play: false, speed: window.matchMedia('(max-width: 760px)').matches ? 4 : 1, sel: null, set: null, page: 1, drag: false, last: 0 };
const BK_UNIT_NAME = { piece: 'piece', set: 'set', m: 'm', point: 'point', m2: 'm²', block: 'block' };
const BK_TYPE = { BP: ['바닥판', 'Bottom Plate'], LS: ['종보강재', 'Longitudinal Stiffener'], GD: ['거더', 'Girder'], FL: ['늑판', 'Transverse Floor'], SS: ['측판', 'Side Shell'], IB: ['내저판', 'Inner Bottom Plate'], BR: ['브래킷', 'Bracket'] };
const BK_SETS = [['bot1', '바닥 패널 A'], ['bot2', '바닥 패널 B'], ['gird', '거더'], ['flo1', '늑판 A'], ['flo2', '늑판 B'], ['side', '측판'], ['inn1', '내저판 A'], ['inn2', '내저판 B']];
const BK_STATE = ['대기', '절단 완료', '소조립 완료', '조립 중', '용접 완료', '검사 완료', '도장 완료', '이송 완료'];

function bkBlockDefault() { const w = todayWos().find(x => x.process_id === 'P03'); return w ? w.block_id : Object.keys(S.blocks)[0]; }
function bkWos(b) { return T3_PROC.map(p => woList().find(w => w.block_id === b && w.process_id === p)); }
function bkDataS(b) {   // 데이터 기준 위치: 끝나지 않은 첫 공정 번호 + 그 진행률 (0~6)
  const ws = bkWos(b);
  for (let i = 0; i < 6; i++) { const w = ws[i]; if (!w || w.status !== 'COMPLETED') return i + (w ? Math.min(0.999, +w.progress_ratio || 0) : 0); }
  return 6;
}
const BK_BOM = {};
function bkBom(bid) {   // 가상 부재 구성(블록마다 같은 결과): 바닥판·종보강재·거더·늑판·측판·내저판·브래킷
  if (BK_BOM[bid]) return BK_BOM[bid];
  const b = S.blocks[bid], ws = bkWos(bid), N = ws[0]?.planned_qty || 60, M = ws[1]?.planned_qty || 8;
  const L = +(11 + (b.weight_t - 30) / 6).toFixed(1), B = 8, H = 2.6, z0 = 1.0, parts = [];
  const add = (type, unit, size, pos, thick) => parts.push({ type, unit, size, pos, thick });
  for (let i = 0; i < 4; i++) add('BP', i < 2 ? 'bot1' : 'bot2', [L, B / 4 - 0.02, 0.03], [0, -B / 2 + B / 4 * (i + 0.5), z0 + 0.015], 0.016);
  const gy = [-B / 4, 0, B / 4];
  for (const y of gy) add('GD', 'gird', [L, 0.04, H - 0.06], [0, y, z0 + H / 2], 0.014);
  const ly = []; for (let y = -B / 2 + 0.8; y < B / 2 - 0.3; y += 0.8) if (gy.every(g => Math.abs(g - y) > 0.3)) ly.push(+y.toFixed(2));
  for (const y of ly) for (const h of [-1, 1]) add('LS', y < 0 ? 'bot1' : 'bot2', [L / 2 - 0.05, 0.03, 0.32], [h * L / 4, y, z0 + 0.19], 0.012);
  const nF = Math.floor(L / 2.4) + 1, fx = [];
  for (let i = 0; i < nF; i++) fx.push(-L / 2 + 0.3 + (L - 0.6) * i / (nF - 1));
  fx.forEach((x, i) => add('FL', i < nF / 2 ? 'flo1' : 'flo2', [0.04, B - 0.06, H - 0.06], [x, 0, z0 + H / 2], 0.012));
  for (const s of [-1, 1]) add('SS', 'side', [L, 0.04, H], [0, s * B / 2, z0 + H / 2], 0.015);
  for (let i = 0; i < 4; i++) add('IB', i < 2 ? 'inn1' : 'inn2', [L, B / 4 - 0.02, 0.03], [0, -B / 2 + B / 4 * (i + 0.5), z0 + H + 0.015], 0.014);
  const spots = []; fx.forEach((x, i) => { for (const y of [...gy, -B / 2 + 0.3, B / 2 - 0.3]) for (const z of [z0 + 0.4, z0 + H - 0.4]) spots.push([x + (i === nF - 1 ? -0.3 : 0.3), y, z, i < nF / 2 ? 'flo1' : 'flo2']); });
  for (let k = 0; parts.length < N && k < spots.length; k++) { const p = spots[(k * 7) % spots.length]; add('BR', p[3], [0.5, 0.03, 0.5], p.slice(0, 3), 0.012); }
  while (parts.length > N) parts.splice(parts.findIndex(p => p.type === 'LS'), 1);
  // 세트 = 단위(유닛)를 M개로 묶음. 조립(용접) 순서 = 세트 순서
  const units = BK_SETS.map(u => u[0]), per = Math.ceil(units.length / M), sets = [];
  for (let k = 0; k < M; k++) { const us = units.slice(k * per, k * per + per); if (!us.length) break; sets.push({ id: `S${String(k + 1).padStart(2, '0')}`, name: us.map(u => BK_SETS.find(x => x[0] === u)[1]).join('·'), units: us, parts: [] }); }
  const ord = []; for (const st of sets) for (const p of parts) if (st.units.includes(p.unit)) { p.set = sets.indexOf(st); st.parts.push(p); ord.push(p); }
  const cnt = {}; ord.forEach((p, i) => { p.i = i; cnt[p.type] = (cnt[p.type] || 0) + 1; p.no = cnt[p.type];
    p.code = `${bid}-${String(i + 1).padStart(3, '0')}`; p.name = `${BK_TYPE[p.type][0]}-${String(p.no).padStart(2, '0')}`;
    const real = p.size.slice(); real[real.indexOf(Math.min(...real))] = p.thick; p.mm = real.map(v => Math.round(v * 1000));
    p.vol = real[0] * real[1] * real[2]; p.weld = Math.max(...p.size) * (p.type === 'BR' ? 2 : 1.2); });
  const kg = b.weight_t * 1000 / ord.reduce((a, p) => a + p.vol, 0), wl = (ws[2]?.planned_qty || 160) / ord.reduce((a, p) => a + p.weld, 0);
  let acc = 0; for (const p of ord) { p.kg = Math.round(p.vol * kg); p.weld *= wl; p.w0 = acc; acc += p.weld; p.w1 = acc; }
  for (const st of sets) { st.w0 = st.parts[0].w0; st.w1 = st.parts[st.parts.length - 1].w1; }
  return (BK_BOM[bid] = { bid, L, B, H, z0, parts: ord, sets, N: ord.length, M: sets.length, weldTotal: acc });
}
function bkAt(bom, s) {   // s(0~6) 시점의 부재·세트 상태
  const st = Math.min(5, Math.floor(s)), f = s >= 6 ? 1 : s - st, N = bom.N, M = bom.M;
  const cut = s >= 1 ? N : Math.floor(N * f), setsDone = s >= 2 ? M : s >= 1 ? Math.floor(M * f) : 0;
  const weldM = s >= 3 ? bom.weldTotal : s >= 2 ? bom.weldTotal * f : 0;
  const parts = bom.parts.map(p => {
    let k = 0;
    if (p.i < cut) k = 1;
    if (p.set < setsDone) k = 2;
    if (s >= 2 && p.w1 <= weldM + 1e-6) k = 4; else if (s >= 2 && p.w0 < weldM) k = 3;
    if (s >= 4 && k >= 4) k = 5;
    if (s >= 4 && p.i < (s >= 5 ? N : N * f)) k = 6;
    if (s >= 6) k = 7;
    return k;
  });
  const curSet = s >= 2 && s < 3 ? bom.sets.findIndex(x => x.w1 > weldM) : s >= 1 && s < 2 && setsDone < M ? setsDone : -1;
  const cur = st === 0 && s < 1 ? Math.min(N - 1, cut) : st === 2 ? bom.parts.findIndex(p => p.w1 > weldM) : -1;
  return { st, f, parts, setsDone, weldM, curSet, cur, cut };
}
function bkS() { return BK.s == null ? bkDataS(BK.block) : BK.s; }
function bkSetState(bom, a, k) { const ps = bom.sets[k].parts.map(p => a.parts[p.i]); const mn = Math.min(...ps), mx = Math.max(...ps);
  return mx >= 3 && mn < 4 ? '조립 중' : BK_STATE[mn] + (mx > mn && mn < 2 ? ' 진행' : ''); }

function bkShell() {
  if (!BK.block || !S.blocks[BK.block]) BK.block = bkBlockDefault();
  const bid = BK.block, bom = bkBom(bid), ws = bkWos(bid), s = bkS(), a = bkAt(bom, s), ds = bkDataS(bid);
  const blk = S.blocks[bid], st = Math.min(5, Math.floor(ds));
  const cards = T3_PROC.map((p, i) => { const w = ws[i], done = i < Math.floor(s) || s >= 6, on = i === a.st && s < 6;
    const q = !w ? '-' : done ? w.planned_qty : i === a.st ? +(w.planned_qty * a.f).toFixed(w.unit === 'm' || w.unit === 'm2' ? 1 : 0) : 0;
    const live = i === st && ds < 6 && w; const tag = done ? '<span class="bkchip g">✓ 완료</span>' : on ? '<span class="bkchip b">진행</span>' : '<span class="bkchip">대기</span>';
    return `<button class="bkcard ${done ? 'done' : ''} ${on ? 'on' : ''}" data-act="bkStage" data-arg="${i}" title="${esc(proc(p).process_name)} 장면으로 이동${i === st && ds < 6 ? ' (현재 상태)' : ''}"><div class="bkct"><b>${p}</b> ${esc(proc(p).process_name)}${live && w.status === 'BLOCKED' ? ' <span class="bkchip r">멈춤</span>' : ''}</div>
      <div class="bkthumb" style="background-image:url(${(window.BK_THUMBS || {})[p] || ''})">${tag}</div>
      <div class="bkq"><b>${q}</b> / ${w ? w.planned_qty : '-'} ${BK_UNIT_NAME[w?.unit] || ''}</div><i class="bkbar"><em style="width:${done ? 100 : on ? a.f * 100 : 0}%"></em></i></button>`; }).join('<span class="bkarr">▶</span>');
  const sel = BK.sel != null ? bom.parts[BK.sel] : bom.parts[Math.max(0, a.cur)];
  const list = bom.parts.filter(p => BK.set == null || p.set === BK.set), PER = 12, pages = Math.max(1, Math.ceil(list.length / PER)); BK.page = Math.min(BK.page, pages);
  const rows = list.slice((BK.page - 1) * PER, BK.page * PER).map(p => { const k = a.parts[p.i];
    return `<tr class="${sel === p ? 'sel' : ''} ${p.i === a.cur ? 'cur' : ''}" data-act="bkSel" data-arg="${p.i}"><td>${p.code.slice(-3)}</td><td>${p.name}</td><td>${bom.sets[p.set].id}</td><td><span class="bkst k${k}">${p.i === a.cur ? '● 진행 중' : BK_STATE[k]}</span></td></tr>`; }).join('');
  const done = a.parts.filter(k => k >= 4).length;
  const sets = bom.sets.map((x, k) => { const ss = bkSetState(bom, a, k);
    return `<button class="bkset ${BK.set === k ? 'sel' : ''} ${a.curSet === k ? 'on' : ''} ${/완료/.test(ss) && !/진행/.test(ss) ? 'done' : ''}" data-act="bkSet" data-arg="${k}"><b>${x.id}</b><span>${esc(x.name)}</span><small>부재 ${x.parts.length}개 · ${ss}</small></button>`; }).join('');
  const k = a.parts[sel.i];
  const stName = s >= 6 ? '이송 완료' : `${T3_PROC[a.st]} ${proc(T3_PROC[a.st]).process_name} ${pct(a.f * 100)}`;
  return `<div class="bk ${BK.focus ? 'focus' : ''}">
    ${topBar()}<header class="bktop"><b class="bklogo">블록 내부 3D</b><span class="bkchip b">조립 재생 · 관제 시각과 별도</span>
      <button class="bklink" data-act="go" data-arg="dash">↩ 관제로 복귀</button>
      <span class="grow"></span><span class="bkchip warn">확장 데모 · 가상 부재 구성</span>
      <select id="bkBlock" data-bk="block">${Object.values(S.blocks).map(b => `<option value="${b.block_id}" ${b.block_id === bid ? 'selected' : ''}>${b.block_id} · ${bkDataS(b.block_id) >= 6 ? '완료' : T3_PROC[Math.floor(bkDataS(b.block_id))] + ' ' + proc(T3_PROC[Math.floor(bkDataS(b.block_id))]).process_name}</option>`).join('')}</select></header>
    <div class="bkcards">${cards}</div>
    <div class="bkmain">
      <aside class="bkl"><section class="bkp"><h3>블록 정보</h3><div class="bkblk"><b>${bid}</b><span>${esc(blk.block_name)}</span></div>
          <div class="bkkv"><span>블록 타입</span><b>평블록 (Double Bottom)</b><span>크기</span><b>${bom.L} × ${bom.B} × ${bom.H} m</b><span>무게</span><b>${blk.weight_t} t</b>
          <span>현재 공정 (데이터)</span><b>${ds >= 6 ? '이송 완료' : `${T3_PROC[st]} ${esc(proc(T3_PROC[st]).process_name)}`}</b><span>용접 완료 부재</span><b>${done} / ${bom.N}개</b></div>
          <i class="bkbar big"><em style="width:${Math.min(100, s / 6 * 100)}%"></em></i></section>
        <section class="bkp grow"><h3>부재 목록 (${list.length}) ${BK.set != null ? `<button class="bklink" data-act="bkSet" data-arg="">전체 보기</button>` : ''}</h3>
          <table class="bkt"><thead><tr><th>번호</th><th>부재명</th><th>세트</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="bkpg">${Array.from({ length: pages }, (_, i) => `<button class="${BK.page === i + 1 ? 'on' : ''}" data-act="bkPage" data-arg="${i + 1}">${i + 1}</button>`).join('')}</div></section></aside>
      <section class="bkc"><div id="bkhost"></div><div class="bkstage">${s >= 6 ? '✓ 이송 완료 · 도크로 출발' : `현재 위치: ${esc(S.zones?.[proc(T3_PROC[a.st]).zone_id]?.zone_name || proc(T3_PROC[a.st]).process_name)}`}</div>
        ${BK.err ? `<div class="t3msg">3D를 불러오지 못했습니다(인터넷 연결 필요).<small>${esc(BK.err)}</small></div>` : !BK.ready ? '<div class="t3msg">3D 준비 중…</div>' : ''}</section>
      <aside class="bkr"><section class="bkp"><h3>부재 상세정보</h3><div class="bkblk"><b>${sel.code.slice(-3)}</b><span>${sel.name}</span></div>
          <div class="bkkv"><span>부재명</span><b>${sel.name}</b><span>종류</span><b>${BK_TYPE[sel.type][1]}</b><span>규격</span><b>${sel.mm.join(' × ')} mm</b><span>무게</span><b>${sel.kg.toLocaleString()} kg</b>
          <span>소속 세트</span><b>${bom.sets[sel.set].id} ${esc(bom.sets[sel.set].name)}</b><span>조립 순서</span><b>${sel.i + 1} / ${bom.N}</b><span>용접 길이</span><b>${sel.weld.toFixed(1)} m</b>
          <span>현재 상태</span><b><span class="bkst k${k}">${sel.i === a.cur ? '● 진행 중' : BK_STATE[k]}</span></b></div></section>
        <section class="bkp"><h3>지금 일어나는 일</h3><p class="bkexp">${bkExplain(bom, a, s)}</p></section>
        <section class="bkp"><h3>최종 조립 결과 (${bid})</h3><div class="bkkv"><span>총 부재 수</span><b>${bom.N}개</b><span>소조립 세트</span><b>${bom.M}세트</b>
          <span>● 용접 완료 부재</span><b>${done} / ${bom.N}개 · ${pct(done / bom.N * 100)}</b><span>● 용접 길이</span><b title="작업지시 실적 기준">${a.weldM.toFixed(1)} / ${bom.weldTotal.toFixed(0)} m · ${pct(a.weldM / bom.weldTotal * 100)}</b><span>목표 이송</span><b>${esc(md(blk.target_transfer_at))} ${hm(blk.target_transfer_at)}</b></div></section></aside>
    </div>
    <div class="bkbottom"><div class="bksets"><div class="bksh">소조립 세트 (${bom.M})</div>${sets}</div>
      <div class="bkctl"><button data-act="bkFirst" title="처음으로">⏮</button><button class="pri" data-act="bkPlay">${BK.play ? '⏸ 일시정지' : '▶ 조립 시뮬레이션'}</button><button data-act="bkNow" title="서버 데이터의 현재 상태로">● 현재 상태</button><button data-act="bkFocus" title="양옆 패널과 공정 카드를 접고 3D만 크게 봅니다">${BK.focus ? '⤡ 패널 보기' : '⤢ 3D 크게'}</button>
        <select data-bk="speed">${[0.5, 1, 2, 4].map(v => `<option value="${v}" ${BK.speed === v ? 'selected' : ''}>${v}x</option>`).join('')}</select>
        <input type="range" id="bkSlider" min="0" max="600" value="${Math.round(s * 100)}"><span id="bkTime" class="bktime">${stName}</span>
        <span class="small">${BK.s == null ? '● 현재 상태(서버 데이터)' : `재생 중 · 현재는 ${ds >= 6 ? '이송 완료' : T3_PROC[st] + ' ' + pct((ds - st) * 100)}`}</span></div></div>
  </div>`;
}
function bkExplain(bom, a, s) {
  if (s >= 6) return '블록이 운반차에 실려 도크로 출발했습니다. 도크에서 다른 블록들과 합쳐져 배가 됩니다.';
  const f = pct(a.f * 100);
  return [`강판을 잘라 부재 ${bom.N}개를 만듭니다. 지금 ${a.cut}개를 잘랐습니다. 잘린 부재는 바닥(적치장)에 놓입니다.`,
    `잘린 부재를 묶어 소조립 세트 ${bom.M}개를 만듭니다. 지금 ${a.setsDone}세트가 완성됐습니다. 세트는 다음 공정(블록 용접)으로 넘어갑니다.`,
    `넘어온 세트를 크레인으로 하나씩 블록 자리에 내려 용접합니다. 용접 ${a.weldM.toFixed(1)} m / ${bom.weldTotal.toFixed(0)} m (${f}). 아직 안 들어간 자리는 파란 윤곽으로 보입니다.`,
    `완성된 블록의 치수·용접 상태를 10곳에서 검사합니다(초록 = 합격, 빨강 = 불합격).`,
    `녹을 제거하고 도장합니다. ${f} 칠했습니다.`, `운반차가 블록을 싣고 도크로 옮깁니다.`][a.st];
}

async function bkInit() {
  if (BK.wrap) return;
  BK.wrap = document.createElement('div'); BK.wrap.className = 't3wrap'; BK.lab = document.createElement('div'); BK.lab.className = 't3labels'; BK.wrap.appendChild(BK.lab);
  try {
    const THREE = await import('three');
    const [{ OrbitControls }, { RoomEnvironment }] = await Promise.all([import('three/addons/controls/OrbitControls.js'), import('three/addons/environments/RoomEnvironment.js')]);
    const r = new THREE.WebGLRenderer({ antialias: true }); r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.2; BK.wrap.insertBefore(r.domElement, BK.lab);
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x1b2230); sc.fog = new THREE.Fog(0x1b2230, 90, 220);
    sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    sc.add(new THREE.HemisphereLight(0xdfe6f0, 0x4a505a, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(-30, -40, 60); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 }); sun.shadow.bias = -0.0005; sc.add(sun);
    const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 600); cam.up.set(0, 0, 1); cam.position.set(-20, -31, 15);
    const ctl = new OrbitControls(cam, r.domElement); ctl.target.set(0, -3, 1.5); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.48; ctl.minDistance = 8; ctl.maxDistance = 160; ctl.update();
    ctl.addEventListener('change', () => { BK.dirty = true; });
    // 작업장: 어두운 바닥 + 격자 + 기둥 + 천장 크레인
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2, ...o });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 160), M(0x2c323b, { roughness: 0.9, metalness: 0 })); floor.receiveShadow = true; sc.add(floor);
    const grid = new THREE.GridHelper(240, 80, 0x4a5563, 0x3a434f); grid.rotation.x = Math.PI / 2; grid.position.z = 0.01; sc.add(grid);
    const box = (sx, sy, sz, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; sc.add(o); return o; };
    const steel = M(0x8a929c, { metalness: 0.6 }), yel = M(0xe8a317, { metalness: 0.3, roughness: 0.45 });
    for (let x = -42; x <= 42; x += 12) box(0.8, 0.8, 16, x, 26, 8, steel);   // 뒤쪽 기둥만(앞쪽은 시야를 가림)
    box(90, 0.8, 1.0, 0, 26, 15.5, steel);
    BK.crane = new THREE.Group(); const g1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 50, 1.4), yel); g1.position.set(0, 0, 16.6); const tr = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 1.2), yel); tr.position.set(0, 0, 17.8);
    BK.crane.add(g1, tr); BK.trolley = tr; sc.add(BK.crane);   // 천장 크레인은 그림자를 만들지 않음(블록 위에 검은 띠가 생김)
    BK.cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x9aa4b2 })); sc.add(BK.cable);
    for (const [x, y] of [[-4, -14], [4, -14], [-4, 14], [4, 14]]) for (let k = 0; k < 3; k++) box(4.2, 2.2, 0.12, x * 2.2, y, 0.3 + k * 0.13, M(k % 2 ? 0x6b4a3a : 0x7a8088, { metalness: 0.5 }));   // 강판 적치
    BK.mat = { stl: M(0x9aa3ad, { metalness: 0.3, roughness: 0.5 }), cut: M(0xc2c9d1, { metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.85 }),
      pri: M(0x8c2f1c, { metalness: 0.3, roughness: 0.55 }), pnt: M(0xb9c2cc, { metalness: 0.25, roughness: 0.4 }),
      cur: M(0x22c55e, { emissive: 0x16a34a, emissiveIntensity: 0.9 }), sel: M(0x60a5fa, { emissive: 0x2563eb, emissiveIntensity: 0.6 }),
      ghost: new THREE.LineBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.35 }), lug: M(0xe8a317, { metalness: 0.3, roughness: 0.45 }) };
    BK.stools = []; for (const x of [-5, 0, 5]) for (const y of [-2.5, 2.5]) BK.stools.push(box(0.9, 0.9, 1.0, x, y, 0.5, yel));
    BK.spmt = new THREE.Group(); const sd = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 0.8), yel); sd.position.z = 0.6; sd.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), yel); cab.position.set(10, 0, 1.4); BK.spmt.add(sd, cab);
    for (let i = 0; i < 7; i++) for (const y of [-2.4, 2.4]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.4, 14), M(0x15171a)); w.position.set(-8 + i * 2.6, y, 0.4); BK.spmt.add(w); }
    sc.add(BK.spmt);
    BK.marks = []; for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), M(0x9ca3af)); sc.add(m); BK.marks.push(m); }
    Object.assign(BK, { THREE, r, sc, cam, ctl, ready: true, built: null });
    render();
  } catch (e) { BK.err = e.message || String(e); render(); }
}
function bkBuild() {   // 선택한 블록의 부재 메시(최종 위치 + 윤곽선)
  const T = BK.THREE, bom = bkBom(BK.block); if (BK.built === bom.bid) return;
  if (BK.grp) BK.sc.remove(BK.grp);
  BK.grp = new T.Group(); BK.sc.add(BK.grp);
  const half = Math.ceil(bom.M / 2);
  const stage = (k) => { const side = k < half ? -1 : 1, idx = k % half, row = Math.floor(idx / 2) + 1, col = idx % 2;   // 세트 적치 위치(블록 앞·뒤 바닥, 2열)
    return new T.Vector3((col - 0.5) * (bom.L + 1.5), side * row * (bom.B + 2.5), 0); };
  const gys = [-bom.B / 4, 0, bom.B / 4], ctx = { bays: [-3 * bom.B / 8, -bom.B / 8, bom.B / 8, 3 * bom.B / 8], fx: bom.parts.filter(q => q.type === 'FL').map(q => q.pos[0]).sort((a, b) => a - b), cx: 0 };
  let ibn = 0;
  BK.meshes = bom.parts.map(p => {
    const hs = flatHoles(p.type, p.size, { ...ctx, manhole: p.type === 'IB' && ibn++ % 2 === 0 });
    const g = plateGeo(T, p.size, hs), m = new T.Mesh(g, BK.mat.stl); m.castShadow = m.receiveShadow = true;
    if (p.type === 'SS' && p.pos[1] < 0) { const st = stencilMesh(T, bom.bid, 3.2); st.position.set(-bom.L * .18, -.04, 0); m.add(st);
      for (const x of [-bom.L / 3, 0, bom.L / 3]) { const l = lugMesh(T, BK.mat.lug); l.position.set(x, 0, p.size[2] / 2 + .18); m.add(l); } }
    const fin = new T.Vector3(...p.pos), set = bom.sets[p.set], c = set.parts.reduce((a, q) => a.add(new T.Vector3(...q.pos)), new T.Vector3()).multiplyScalar(1 / set.parts.length);
    const minz = Math.min(...set.parts.map(q => q.pos[2] - q.size[2] / 2));
    const stg = fin.clone().sub(c).add(stage(p.set)).add(new T.Vector3(0, 0, c.z - minz + 0.05));
    const e = new T.LineSegments(new T.EdgesGeometry(g), BK.mat.ghost); e.position.copy(fin);
    BK.grp.add(m, e); m.userData = { fin, stg, i: p.i }; return { m, e, fin, stg };
  });
  BK.built = bom.bid; BK.dirty = true;
}
function bkApply() {   // s 시점 상태를 3D에 반영
  if (!BK.ready) return; bkBuild();
  const bom = bkBom(BK.block), s = bkS(), a = bkAt(bom, s), T = BK.THREE;
  const weldSet = a.st === 2 && a.curSet >= 0 ? bom.sets[a.curSet] : null, sf = weldSet ? Math.min(1, (a.weldM - weldSet.w0) / Math.max(1e-6, (weldSet.w1 - weldSet.w0)) * 3) : 0;   // 세트가 내려오는 비율(용접 첫 1/3 동안)
  let hook = null;
  BK.meshes.forEach((o, i) => { const k = a.parts[i], p = bom.parts[i];
    let pos;
    if (k <= 2) pos = o.stg; else pos = o.fin;
    if (weldSet && p.set === a.curSet) { const t = Math.max(0, Math.min(1, sf)); pos = new T.Vector3().lerpVectors(o.stg, o.fin, t); pos.z += Math.sin(t * Math.PI) * 6; hook = hook || pos; }
    o.m.position.copy(pos); o.m.visible = k >= 1;
    o.m.material = i === a.cur || (a.st === 1 && p.set === a.curSet && k === 1) ? BK.mat.cur : i === BK.sel || p.set === BK.set ? BK.mat.sel : k >= 6 ? BK.mat.pnt : k >= 4 ? BK.mat.pri : k >= 2 ? BK.mat.stl : BK.mat.cut;
    o.e.visible = k < 3 || (weldSet && p.set === a.curSet && sf < 1); });
  // 이송: 운반차 + 블록 이동
  const move = s >= 5 ? Math.min(1, s - 5) * 34 : 0; BK.spmt.visible = s >= 5; BK.spmt.position.set(move, 0, s >= 5 ? 0 : -5);
  BK.grp.position.set(move, 0, 0); BK.stools.forEach(x => { x.visible = s < 5; });
  BK.meshes.forEach(o => { if (s >= 5) o.e.visible = false; });
  // 검사 지점
  const insp = S.inspections.filter(q => q.work_order_id === bkWos(BK.block)[3]?.work_order_id).pop(), fail = insp ? insp.failed_points : 0;
  BK.marks.forEach((m, i) => { const vis = s >= 3 && s < 4.5; m.visible = vis; const x = -bom.L / 2 + bom.L * (i % 5 + 0.5) / 5, y = i < 5 ? -bom.B / 2 - 0.3 : bom.B / 2 + 0.3;
    m.position.set(x + move, y, bom.z0 + bom.H * 0.9); const chk = s >= 4 || i < (s - 3) * 10; m.material.color.setHex(!chk ? 0x9ca3af : i >= 10 - fail && s < 4 ? 0xef4444 : 0x22c55e); });
  // 천장 크레인: 내려오는 세트 위로
  if (hook) { BK.crane.position.x = hook.x; BK.trolley.position.y = hook.y; BK.cable.geometry.setFromPoints([new T.Vector3(hook.x, hook.y, 17.2), new T.Vector3(hook.x, hook.y, hook.z + 1.5)]); BK.cable.visible = true; }
  else BK.cable.visible = false;
  BK.a = a; BK.dirty = true;
}
function bkMount() {
  const host = document.getElementById('bkhost'); if (!host) return;
  if (!BK.wrap) bkInit();
  if (BK.wrap && BK.wrap.parentNode !== host) host.appendChild(BK.wrap);
  if (BK.ready) { bkApply(); if (!BK.looping) bkLoop(); }
}
function bkLoop() {
  if (!BK.ready || UI.view !== 'blk' || !BK.wrap.isConnected) { BK.looping = false; BK.play = false; return; }
  BK.looping = true; requestAnimationFrame(bkLoop);
  const now = performance.now(), dt = Math.min(0.1, (now - (BK.tl || now)) / 1000); BK.tl = now;
  const h = document.getElementById('bkhost'); if (h) { const w = h.clientWidth, ht = h.clientHeight; const c = BK.r.domElement;
    if (w && ht && (c.width !== Math.round(w * BK.r.getPixelRatio()) || c.height !== Math.round(ht * BK.r.getPixelRatio()))) { BK.r.setSize(w, ht); BK.cam.aspect = w / ht; BK.cam.updateProjectionMatrix(); BK.dirty = true; } }
  if (BK.play) { BK.s = Math.min(6, (BK.s ?? 0) + dt * 0.1 * BK.speed); bkApply(); if (BK.s >= 6) BK.play = false;
    if (!BK.drag && now - BK.last > 400) { BK.last = now; render(); } }
  BK.ctl.update();
  if (!BK.dirty) return; BK.dirty = false;
  BK.r.render(BK.sc, BK.cam); bkLabels();
}
function bkLabels() {   // 진행 중 부재·선택 부재·최근 완료 부재에 이름표
  const bom = bkBom(BK.block), a = BK.a; if (!a) return;
  const ids = new Set(); if (a.cur >= 0) ids.add(a.cur); if (BK.sel != null) ids.add(BK.sel);
  for (let i = bom.N - 1, n = 0; i >= 0 && n < 1; i--) if (a.parts[i] >= 4 && a.parts[i] < 6 && i !== a.cur) { ids.add(i); n++; }
  const w = BK.r.domElement.clientWidth, h = BK.r.domElement.clientHeight;
  BK.lab.innerHTML = [...ids].map(i => { const o = BK.meshes[i].m; if (!o.visible) return ''; const p = o.getWorldPosition(new BK.THREE.Vector3()); p.z += bom.parts[i].size[2] / 2 + 0.3; const v = p.project(BK.cam); if (v.z > 1) return '';
    return `<span class="bklab ${i === a.cur ? 'cur' : i === BK.sel ? 'sel' : ''}" style="left:${(v.x + 1) / 2 * w}px;top:${(1 - v.y) / 2 * h}px">${bom.parts[i].code.slice(-3)} ${bom.parts[i].name}</span>`; }).join('');
}
Object.assign(ACT, {
  bkSel(i) { BK.sel = BK.sel === +i ? null : +i; render(); },
  bkSet(k) { BK.set = k === '' || BK.set === +k ? null : +k; BK.page = 1; render(); },
  bkPage(n) { BK.page = +n; render(); },
  bkPlay() { if (BK.play) { BK.play = false; return render(); } if (BK.s == null || BK.s >= 6) BK.s = 0; BK.play = true; render(); },
  bkFirst() { BK.play = false; BK.s = 0; render(); },
  bkStage(i) { BK.play = false; const ds = bkDataS(BK.block); i = +i;   // 공정 카드: 데이터의 현재 공정이면 현재 상태, 아니면 그 공정의 작업 장면(60% 지점)
    BK.s = i === Math.min(5, Math.floor(ds)) && ds < 6 ? null : i + 0.6; render(); },
  bkNow() { BK.play = false; BK.s = null; render(); },
  bkFocus() { BK.focus = !BK.focus; render(); },
  bkOpen(b) { BK.block = b || null; BK.s = null; BK.sel = null; BK.set = null; BK.play = false; ACT.go('blk'); },
});
document.addEventListener('input', e => { if (e.target.id === 'bkSlider') { BK.play = false; BK.s = e.target.value / 100; BK.drag = true; bkApply();
  const t = document.getElementById('bkTime'); if (t) { const a = BK.a; t.textContent = BK.s >= 6 ? '이송 완료' : `${T3_PROC[a.st]} ${proc(T3_PROC[a.st]).process_name} ${pct(a.f * 100)}`; } } });
document.addEventListener('change', e => { if (e.target.id === 'bkSlider') { BK.drag = false; render(); }
  if (e.target.dataset && e.target.dataset.bk === 'block') { ACT.bkOpen(e.target.value); }
  if (e.target.dataset && e.target.dataset.bk === 'speed') { BK.speed = +e.target.value; } });
