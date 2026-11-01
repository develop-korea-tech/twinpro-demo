// ---------- 3D 확장 데모(과제 제외범위 · 팀 자체 시연 구현) ----------
// Blender 코드로 만든 조선소 모델(twinpro_shipyard.glb)을 Three.js로 띄우고, 서버 데이터(공정별 작업·설비 상태)로 공정 윤곽 상자·이름표·경광등·움직임을 바꾼다.
// 화면 구성: 위 도구줄 / 가운데 3D(제목·범례·설명 자막·공정 카드 겹침) / 오른쪽 합계 패널. 화면을 다시 그려도 3D 캔버스는 그대로 두고 자리만 옮긴다.
const T3_PROC = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'];
const T3_X = { P01: -115, P02: -69, P03: -23, P04: 23, P05: 69, P06: 115 };
const T3_H = { P01: 15, P02: 7, P03: 22, P04: 9, P05: 20, P06: 6 };   // 공정 윤곽 상자 높이(m)
const T3_COLOR = { g: 0x16a34a, r: 0xdc2626, o: 0xf59e0b, b: 0x3b82f6, n: 0x9ca3af };   // 경광등 색
const T3_LINE = { g: 0x4ade80, r: 0xff5a4f, o: 0xf5b041, b: 0x6fd3ff, n: 0x8a96a8 };    // 윤곽 상자 선 색
const T3_LTXT = { g: '작업 중', r: '고장·멈춤', o: '재료 대기·멈춤', b: '오늘 몫 끝남', n: '대기' };
const T3 = { wrap: null, ready: false, err: null, sel: null, st: {}, t0: performance.now(), showLab: true, panel: true };
// 화질: 모든 화면에 낮 하늘(Sky)·하늘에서 받은 반사광·ACES 톤을 쓰고, 터치 없는 넓은 화면(PC·큰 화면)에서만 그림자 해상도를 높인다
const T3_HQ = (() => { try { return !navigator.webdriver && !matchMedia('(pointer: coarse)').matches && Math.max(screen.width, screen.height) >= 1200; } catch (e) { return false; } })();
const T3_SUN = { el: 38, az: 205 };   // 해 높이(도)·방향(+y에서 +x 쪽으로 도). 기본 시점의 앞·왼쪽에서 비추는 맑은 낮(바다는 파랗게, 그림자는 또렷하게)
const hex = c => '#' + c.toString(16).padStart(6, '0');

const t3Hidden = () => S.eqBase && S.eqBase.size ? Object.keys(S.equipment).filter(id => !S.eqBase.has(id)).length : 0;   // 3D 모델에 없는 추가 설비 수
function t3Url() { return window.TP_GLB || 'twinpro_shipyard.glb?v=' + (window.TP_GLB_V || ''); }
function t3State() {   // 공정별 상태(쉬운 화면과 같은 기준)
  const out = {};
  for (const w of todayWos()) { const [c, word] = easyState(w); out[w.process_id] = { c, word, w, e: eqOf(w.equipment_id) }; }
  return out;
}
const t3Qty = w => `${+(w.planned_qty * (w.status === 'COMPLETED' ? 1 : w.progress_ratio)).toFixed(w.unit === 'm' || w.unit === 'm2' ? 1 : 0)} / ${w.planned_qty} ${BK_UNIT_NAME[w.unit] || w.unit}`;
function t3Shell() {
  const S3 = t3State(), k = kpis(), now = `${md(nowS())} (${wd(nowS())}) ${hm(nowS())}`;
  const sel = T3.sel && S3[T3.sel];
  const bar = `<div class="txbar">
      <button class="txb" data-act="go" data-arg="dash">↩ 관제로 돌아가 조치</button>
      <span class="txb fill g" title="수요기업 제공 엑셀(15시트)을 서버 DB에 넣은 시연용 데이터입니다. 실제 설비와 연결되어 있지 않습니다">제공 데이터 기반 · 09/16 12:00 기준</span>
      ${SIM.on ? '<button class="txb fill r" data-act="simEnd">시뮬레이션 끝내기</button>' : `<button class="txb fill w" data-act="simStart" ${T3.ready ? '' : 'disabled'}>▶ 공정 시뮬레이션</button>`}
      ${SIM.on ? '' : playCtl().replace(/class="btn[^"]*"/, 'class="txb"')}${t3xBar()}
      <button class="txb ${T3.showLab ? 'fill w' : ''}" data-act="t3tog" data-arg="showLab">이름표</button><button class="txb ${T3.panel ? 'fill w' : ''}" data-act="t3tog" data-arg="panel">패널</button>
      <span class="grow"></span><span class="txtag">확장 데모 · 가상 모델 · 상태·수량은 서버 데이터</span></div>`;
  const legend = `<div class="txlegend">${['g', 'r', 'o', 'b'].map(c => `<span><i style="background:${hex(T3_LINE[c])}"></i>${T3X_ICO[c]} ${T3_LTXT[c]}</span>`).join('')}</div>`;
  const head = SIM.on ? `<div class="txhead"><small class="edu">교육용 표준 공정 재생 — ${SIM.block} 정상 흐름 · 관제 데이터와 별도</small><h1>블록이 배가 되기까지</h1></div>`
    : `<div class="txhead"><small>서버 데이터 기준 · 관제와 같은 시각 · ${now}</small><h1>${t3xTitle()}</h1></div>`;
  const chips = SIM.on ? `<div class="txchips">${SIM_STEPS.map((s, i) => `<button class="${i < simStep() ? 'done' : i === simStep() ? 'on' : ''}" data-act="simJump" data-arg="${i}">— ${s}</button>`).join('')}</div>`
    : T3X.tour || T3X.inc ? '' : `<div class="txchips"><span class="on">— 공정 6곳</span><span>— 오늘 블록 ${todayWos().length}개 <i>DATA</i></span></div>`;
  const cap = !SIM.on ? '' : `<div class="txcap"><small>${simStep() + 1} / ${SIM_STEPS.length}</small><b id="simT"></b><p id="simD"></p><div class="simq" id="simQ"></div><i class="simbar"><em id="simBar"></em></i></div>${SIM.vid ? '<div id="simvidhost"></div>' : ''}`
    ;
  const info = !SIM.on && sel ? (() => { const ws = bkWos(sel.w.block_id);
    return `<div class="txcard"><div class="txch"><small>공정 ${proc(T3.sel).process_id.slice(1)} · ${esc(S.zones[proc(T3.sel).zone_id]?.zone_name || '')}</small><button data-act="t3sel" data-arg="">✕</button></div>
      <h2>${esc(proc(T3.sel).process_name)}</h2><p>블록 ${sel.w.block_id}(${esc(S.blocks[sel.w.block_id]?.block_name || '')})를 작업하고 있습니다. 기계: ${esc(eqName(sel.e.equipment_id))}.</p>
      <div class="txsec">이 공정 · DATA</div>
      <div class="txkv"><span>상태</span><b style="color:${hex(T3_LINE[sel.c])}">${sel.word}</b><span>수량</span><b>${t3Qty(sel.w)}</b><span>진행</span><b>${pct(sel.w.progress_ratio * 100)}</b><span>작업지시</span><b>${sel.w.work_order_id}</b></div>
      <div class="txsec">블록 ${sel.w.block_id}의 공정별 진행</div>
      ${ws.map((w, i) => w ? `<div class="txrow"><span>${T3_PROC[i]}</span><i><em style="width:${(w.status === 'COMPLETED' ? 1 : w.progress_ratio) * 100}%"></em></i><small>${t3Qty(w)}</small></div>` : '').join('')}
      <button class="txb fill w wide" data-act="bkOpen" data-arg="${sel.w.block_id}">이 블록 제조 과정 보기 ›</button></div>`; })() : '';
  const inc = easyCase(), cs = inc && caseSteps(inc), a = cs && cs.active;
  const sideOn = T3.panel && !(SIM.on && SIM.vid) && (SIM.on || (!T3X.inc && !T3X.tour && !T3X.plan));   // 16배속 영상은 화면을 넓게   // 사건·순회 중에는 3D를 넓게(전체 현황은 하단 KPI·알람에 있음)
  const side = !sideOn ? '' : SIM.on ? simSide() : `<aside class="txside">
      <div class="txsec">오늘 합계 · ${md(nowS())}</div>
      <div class="txkv"><span>작업 중 공정</span><b>${Object.values(S3).filter(s => s.c === 'g').length} / 6</b><span>가동 기계</span><b>${k.running} / ${k.total}</b><span>오늘 끝난 작업</span><b>${k.todayDone} / ${k.todayTotal}</b><span>해결 안 된 문제</span><b class="${k.open ? 'r' : ''}">${k.open}</b>${t3Hidden() ? `<span>3D 미표시 설비</span><b title="시연 중 추가한 설비는 3D 모델이 없어 그리지 않습니다(공정 상태 · 합계에는 반영)">${t3Hidden()}대</b>` : ''}</div>
      <div class="txsec">공정별 블록 · DATA</div>
      <div class="txkv">${T3_PROC.map(p => S3[p] ? `<span>${p} ${EASY_NAME[p]}</span><b><i class="dot" style="background:${hex(T3_LINE[S3[p].c])}"></i>${S3[p].w.block_id} · ${pct(S3[p].w.progress_ratio * 100)}</b>` : '').join('')}</div>
      <div class="txsec">확인할 문제</div>
      ${!inc ? '<p class="txnote">지금 멈춘 공정이 없습니다.</p>' : `<p class="txnote"><b class="${a ? 'r' : ''}">${a ? '⚠ ' : '✓ '}${cs.w ? cs.w.block_id + ' · ' : ''}${esc(proc(cs.w ? cs.w.process_id : eqOf(cs.eqId).process_id).process_name)} · ${STATUS.cat[inc.category][0]}</b> (${inc.incident_id})<br>${a ? `다음 단계: ${a.title}` : '처리 완료'}</p>
        ${cs.w ? `<button class="txb fill w wide" data-act="bkOpen" data-arg="${cs.w.block_id}">🔍 ${cs.w.block_id} 블록 내부 3D</button>` : ''}<button class="txb wide" data-act="goInc" data-arg="${inc.incident_id}">↩ 관제로 돌아가 조치</button>`}
      ${UI.trial ? '<p class="txnote">🧪 체험 중 · 저장되지 않고 내 화면에만 보입니다.</p>' : ''}
      <div class="txsec">이 화면은</div>
      <p class="txnote">조선소 모델은 외부 자료 없이 Blender 코드로 만든 가상 조선소입니다. 공정 상태·블록·수량은 서버 데이터 그대로이며, 실제 설비와 연결되어 있지 않습니다. 드래그로 회전, 휠로 확대합니다.</p></aside>`;
  return `<div class="tx">${topBar()}
    ${bar}<div class="txmain ${sideOn ? '' : 'nopanel'}"><div class="txview"><div id="t3host"></div>${head}${chips}${SIM.on ? '' : legend}${cap}${info}${t3xHud()}
      ${T3.err ? `<div class="t3msg">3D 모델을 불러오지 못했습니다. 인터넷 연결을 확인하세요.<small>${esc(T3.err)}</small></div>` : !T3.ready ? '<div class="t3msg">3D 조선소 모델을 불러오는 중… (약 3MB)</div>' : ''}</div>${side}</div></div>`;
}
async function t3Init() {
  if (T3.wrap) return;
  T3.wrap = document.createElement('div'); T3.wrap.className = 't3wrap';
  T3.labels = document.createElement('div'); T3.labels.className = 't3labels'; T3.wrap.appendChild(T3.labels);
  try {
    const THREE = await import('three');
    const [{ GLTFLoader }, { OrbitControls }, { Sky }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js'), import('three/addons/objects/Sky.js')]);
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.55;
    T3.wrap.insertBefore(r.domElement, T3.labels);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xb4c3d1, 450, 1600);   // 수평선 쪽 옅은 푸른 안개
    const D = Math.PI / 180, sunDir = new THREE.Vector3(Math.sin(T3_SUN.az * D) * Math.cos(T3_SUN.el * D), Math.cos(T3_SUN.az * D) * Math.cos(T3_SUN.el * D), Math.sin(T3_SUN.el * D));
    const sky = new Sky(); sky.scale.setScalar(1800); sky.material.uniforms.up.value.set(0, 0, 1);
    Object.entries({ turbidity: 4, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.8 }).forEach(([k, v]) => { sky.material.uniforms[k].value = v; });
    sky.material.uniforms.sunPosition.value.copy(sunDir); scene.add(sky);
    const pm = new THREE.PMREMGenerator(r);
    { const envScene = new THREE.Scene(); envScene.add(sky.clone());   // 반사·주변광을 하늘에서 받는다
      scene.environment = pm.fromScene(envScene, 0, 1, 3000).texture; }
    scene.add(new THREE.HemisphereLight(0xcfdcef, 0x3a3832, 0.6));   // 그늘 쪽은 푸른 하늘빛
    const sun = new THREE.DirectionalLight(0xfff0dc, 4.2); sun.position.copy(sunDir).multiplyScalar(320);
    sun.castShadow = true; sun.shadow.mapSize.set(T3_HQ ? 4096 : 2048, T3_HQ ? 4096 : 2048); Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 160, bottom: -160, near: 10, far: 800 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.3;
    scene.add(sun); scene.add(sun.target);
    const cam = new THREE.PerspectiveCamera(32, 16 / 9, 1, 2000); cam.up.set(0, 0, 1);
    const ctl = new OrbitControls(cam, r.domElement); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * 0.47; ctl.minDistance = 25; ctl.maxDistance = 520;
    cam.position.set(-215, -150, 105); ctl.target.set(-10, 6, 0); ctl.update(); ctl.addEventListener('change', () => { T3.dirty = true; });
    const gltf = await new GLTFLoader().loadAsync(t3Url());
    const root = gltf.scene; root.rotation.x = Math.PI / 2;   // glTF(Y-up) → Z-up
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && /sea|ground|far|hill|tree|trunk/.test(o.material.name)) o.castShadow = false;
      if (o.material && /^(ground|pad)/.test(o.material.name) && !o.material.userData.dim) { o.material.userData.dim = 1; o.material.color.multiplyScalar(0.55); }   // 바닥이 밝으면 하얗게 떠서 콘크리트 톤으로 낮춤
      if (o.material && /^sea/.test(o.material.name)) { o.material.roughness = 0.12; o.material.metalness = 0.4; o.material.envMapIntensity = 1.3; } } });
    scene.add(root); t3Ship(THREE, scene);
    const find = n => root.getObjectByName(n);
    T3.THREE = THREE; T3.r = r; T3.scene = scene; T3.cam = cam; T3.ctl = ctl; T3.parts = {}; T3.find = find;
    for (const p of T3_PROC) {
      const beaconMat = []; find(`${p}_beacon`)?.traverse(o => { if (o.isMesh && /beacon/.test(o.material.name)) { o.material = o.material.clone(); beaconMat.push(o.material); } });
      const h = T3_H[p], box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(40, 44, h)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
      box.position.set(T3_X[p], 0, h / 2 + 0.3); box.renderOrder = 5; scene.add(box);
      const lab = document.createElement('button'); lab.className = 'txlab'; lab.dataset.act = 't3sel'; lab.dataset.arg = p; T3.labels.appendChild(lab);
      const lamp = new THREE.PointLight(0xff0000, 0, 30); lamp.position.set(T3_X[p] + 16.5, -19, 9); scene.add(lamp);
      T3.parts[p] = { beaconMat, box, lab, lamp };
    }
    T3.anim = { crane: find('P01_crane'), trolley: find('P01_trolley'), gantry: find('P02_gantry'), bridge: find('P03_crane'), spark: find('P03_spark'), trans: find('P06_transporter') };
    for (const k in T3.anim) if (T3.anim[k]) T3.anim[k].userData.p0 = T3.anim[k].position.clone();
    T3.sparkLight = new THREE.PointLight(0x9fd0ff, 0, 18); T3.sparkLight.position.set(-19.5, -8.5, 6.5); scene.add(T3.sparkLight);
    const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(); let down = null;
    r.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('pointerup', e => {   // 클릭(드래그 아님) → 가장 가까운 공정 선택
      if (SIM.on || T3X.tour || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const b = r.domElement.getBoundingClientRect(); v2.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1);
      ray.setFromCamera(v2, cam); const hit = ray.intersectObject(root, true)[0]; if (!hit) return;
      const pt = hit.point; if (pt.y > 26 || pt.y < -40) return;
      const p = T3_PROC.reduce((a, b2) => Math.abs(T3_X[b2] - pt.x) < Math.abs(T3_X[a] - pt.x) ? b2 : a); ACT.t3sel(p);
    });
    T3.ready = true; t3Sync(); t3xInit(); if (T3.wantSim) { T3.wantSim = false; simStart(); } render(); t3Loop();
  } catch (e) { T3.err = e.message || String(e); render(); }
}
// 도크의 배: 공정 교육 재생 블록(sim3d.js)과 같은 치수·구멍·도장 색의 블록을 2열 3단으로 쌓는다(블록이 많아 InstancedMesh로 한 번에 그림).
// 밖에서 보이는 판만 넣는다: 바닥판·측판·양 끝 늑판(경감공)·내저판(맨홀·평철)·인양 러그. 맨 위 단 (46, 40.7)은 재생의 탑재 자리라 비워 둔다
function t3Ship(T, scene) {
  const L = 12.5, Bw = 5.2, H = 3.4, Hw = 3.24, fx = Array.from({ length: 6 }, (_, i) => -L / 2 + 0.25 + (L - 0.5) * i / 5);
  const ctx = { bays: [-3 * Bw / 8, -Bw / 8, Bw / 8, 3 * Bw / 8], fx, cx: 0, manhole: true }, FLN = [-1.3, 0, 1.3].map(y => [y, 0.12, Hw / 2 + 0.01, false]);
  const parts = [[new T.BoxGeometry(L, Bw, 0.08), 0, 0, -1.66], ...[-1, 1].map(s => [new T.BoxGeometry(L, 0.08, H), 0, s * (Bw / 2 + 0.04), 0]),
    ...[fx[0], fx[5]].map(x => [plateGeo(T, [0.08, Bw, Hw], flatHoles('FL', [0.08, Bw, Hw], ctx), FLN), x, 0, 0]),
    ...[-1.3, 1.3].map(y => [plateGeo(T, [L, 2.6, 0.08], flatHoles('IB', [L, 2.6, 0.08], { manhole: true })), 0, y, 1.66]),
    ...[-1.95, -0.65, 0.65, 1.95].map(y => [new T.BoxGeometry(L, 0.025, 0.25), 0, y, 1.825])];
  const pos = [], nor = [];
  for (const [g0, x, y, z] of parts) { const g = (g0.index ? g0.toNonIndexed() : g0); g.translate(x, y, z); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  const at = []; const base = [0.25 - 2 * (H + 0.05), 0.25 - (H + 0.05), 0.25];
  base.forEach((z0, ti) => [40.7, 53.3].forEach((y, ri) => { for (let k = -14; k <= 6; k++) { const x = 46 + 5.25 * k;
    if (ti === 2 && (x > 46.01 || (ri === 0 && x > 41))) continue; at.push([x, y, z0 + H / 2]); } }));
  at.push([46, 61, 6.2 + H / 2]);   // 골리앗 두 번째 트롤리에 걸린 다음 블록(twin3d/scene.py T2)
  const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2), one = new T.Vector3(1, 1, 1), m4 = new T.Matrix4();
  const mk = (g, mat, list) => { const im = new T.InstancedMesh(g, mat, list.length); list.forEach((p, i) => im.setMatrixAt(i, m4.compose(new T.Vector3(...p), q, one))); im.castShadow = im.receiveShadow = true; scene.add(im); };
  mk(geo, new T.MeshStandardMaterial({ color: 0x7f97ab, metalness: 0.3, roughness: 0.55 }), at);
  const lug = new T.BoxGeometry(0.3, 0.06, 0.36), lugs = []; for (const p of at) for (const [dx, dy] of [[-1.3, -4.2], [1.3, -4.2], [-1.3, 4.2], [1.3, 4.2]]) lugs.push([p[0] + dx, p[1] + dy, p[2] + 1.88]);
  const lq = new T.Quaternion(); const im = new T.InstancedMesh(lug, new T.MeshStandardMaterial({ color: 0xe8a317, metalness: 0.3, roughness: 0.45 }), lugs.length);
  lugs.forEach((p, i) => im.setMatrixAt(i, m4.compose(new T.Vector3(...p), lq, one))); scene.add(im);
}
function t3Mount() {   // 화면을 다시 그린 뒤 캔버스를 새 자리로 옮긴다
  const host = document.getElementById('t3host'); if (!host) return;
  if (!T3.wrap) { t3Init(); }
  if (T3.wrap && T3.wrap.parentNode !== host) host.appendChild(T3.wrap);
  if (T3.ready) { t3Sync(); t3Resize(); if (!T3.looping) t3Loop(); }
}
function t3Resize() { const h = document.getElementById('t3host'); if (!h || !T3.r) return; const w = h.clientWidth, ht = h.clientHeight; if (!w || !ht) return;
  const c = T3.r.domElement; if (c.width !== Math.round(w * T3.r.getPixelRatio()) || c.height !== Math.round(ht * T3.r.getPixelRatio())) { T3.r.setSize(w, ht); T3.cam.aspect = w / ht; T3.cam.updateProjectionMatrix(); T3.dirty = true; } }
function t3Sync() { if (!T3.ready) return; T3.st = t3State(); T3.dirty = true;
  for (const p of T3_PROC) { const s = T3.st[p], part = T3.parts[p]; if (!s) continue;
    for (const m of part.beaconMat) { m.color.setHex(T3_COLOR[s.c]); m.emissive.setHex(T3_COLOR[s.c]); }
    part.box.material.color.setHex(T3.sel === p ? 0x6fd3ff : T3_LINE[s.c]); part.box.material.opacity = T3.sel === p ? 1 : 0.7;
    part.lab.className = `txlab ${s.c} ${T3.sel === p ? 'sel' : ''}`;
    part.lab.innerHTML = `<b>${p.slice(1)} ${esc(proc(p).process_name)}</b><span>${s.w.block_id} · ${t3Qty(s.w)} · ${s.word}</span>`; }
  t3xSync(); }
function t3PlaceLabels(simKey) {   // 공정 상자 왼쪽 위 모서리에 이름표
  const V = T3.THREE.Vector3, w = T3.r.domElement.clientWidth, h = T3.r.domElement.clientHeight;
  for (const p of T3_PROC) { const part = T3.parts[p];
    const xi = !SIM.on && T3X.inc && incById(T3X.inc), fp = xi && t3xIncProc(xi);
    const show = T3.showLab && (!SIM.on || p === simKey) && (SIM.on || !T3X.plan) && p !== fp; part.box.visible = show && !xi; if (!show) { part.lab.style.display = 'none'; continue; }
    const v = new V(T3_X[p] - 20, -22, T3_H[p] + 0.3).project(T3.cam);
    part.lab.style.display = v.z < 1 ? '' : 'none'; part.lab.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(0, -100%)`; }
}
function t3Loop() {
  if (!T3.ready || UI.view !== '3d' || !T3.wrap.isConnected) { T3.looping = false; return; }
  T3.looping = true; requestAnimationFrame(t3Loop); t3Resize();
  const now = performance.now(), t = (now - T3.t0) / 1000, live = isLive();
  if (SIM.on) {   // 공정 시뮬레이션: 매 프레임 그림, 모든 공정 정상(초록), 시뮬레이션 블록이 있는 공정 상자만 표시
    if (SIM.vid) return;   // 녹화 영상을 보는 동안 3D는 그리지 않음
    const dt = Math.min(0.1, (now - (T3.simLast || now)) / 1000); T3.simLast = now;
    if (SIM.play) { SIM.t = Math.min(SIM_TOTAL, SIM.t + dt * SIM.speed); if (SIM.t >= SIM_TOTAL) { SIM.play = false; render(); } }
    simApply(dt);
    const sk = T3_PROC[Math.min(5, simStep())];
    for (const p of T3_PROC) { const part = T3.parts[p]; part.lamp.intensity = 0; part.box.material.color.setHex(0x6fd3ff); part.box.material.opacity = 1;
      for (const m of part.beaconMat) { m.color.setHex(T3_COLOR.g); m.emissive.setHex(T3_COLOR.g); m.emissiveIntensity = 4; } }
    T3.parts[sk].lab.innerHTML = `<b>${sk.slice(1)} ${esc(proc(sk).process_name)}</b><span>블록 ${SIM.block} · 시뮬레이션</span>`; T3.parts[sk].lab.className = 'txlab sel';
    t3PlaceLabels(sk);
    T3.sparkLight.intensity = 0;   // 시뮬레이션 불꽃은 sim3d가 직접 그림
    T3.blinkKey = null; t3xPlace(); T3.r.shadowMap.needsUpdate = true; T3.r.render(T3.scene, T3.cam); return;
  }
  if (T3.simLast) { T3.simLast = 0; T3X.shadow = true; t3Sync(); }   // 시뮬레이션이 끝나면 물체가 제자리로 돌아오므로 그림자 다시 계산
  const xa = t3xFrame(now); if (!T3X.fly && !T3X.tour) T3.ctl.update();
  // 필요할 때만 그린다: 카메라 이동·데이터 변경·경광등 깜빡임 전환, 재생 중에는 초당 30장까지(저사양 노트북 배려)
  const blinkKey = T3_PROC.map(p => T3.st[p] && T3.st[p].c === 'r' ? (Math.sin(t * 6) > 0 ? 1 : 0) : T3.st[p] && T3.st[p].c === 'o' ? Math.round(Math.sin(t * 2) * 3) : '').join();
  const anim = live && T3_PROC.some(p => T3.st[p] && T3.st[p].c === 'g');
  if (!T3.dirty && !xa && blinkKey === T3.blinkKey && !(anim && now - (T3.last || 0) > 33)) return;
  T3.dirty = false; T3.blinkKey = blinkKey; T3.last = now;
  for (const p of T3_PROC) { const s = T3.st[p], part = T3.parts[p]; if (!s) continue;
    const blink = s.c === 'r' ? (Math.sin(t * 6) > 0 ? 1 : 0.15) : s.c === 'o' ? 0.55 + 0.35 * Math.sin(t * 2) : 1;
    for (const m of part.beaconMat) m.emissiveIntensity = 4 * blink;
    if (s.c === 'r' && T3.sel !== p) part.box.material.opacity = 0.35 + 0.65 * blink;
    part.lamp.color.setHex(T3_COLOR[s.c]); part.lamp.intensity = s.c === 'r' ? 600 * blink : 0; }
  t3PlaceLabels(); t3xPlace();
  const run = p => live && T3.st[p] && T3.st[p].c === 'g', A = T3.anim;
  if (A.trolley && run('P01')) A.trolley.position.x = A.trolley.userData.p0.x + Math.sin(t * 0.5) * 9;
  if (A.crane && run('P01')) A.crane.position.z = A.crane.userData.p0.z - Math.sin(t * 0.23) * 6;   // glTF는 Y-up: 블렌더 y = -z
  if (A.gantry && run('P02')) A.gantry.position.x = A.gantry.userData.p0.x + Math.sin(t * 0.4) * 9;
  if (A.bridge && run('P03')) A.bridge.position.z = A.bridge.userData.p0.z - Math.sin(t * 0.3) * 6;
  if (A.trans && run('P06')) A.trans.position.x = A.trans.userData.p0.x + Math.sin(t * 0.15) * 22;
  const weld = run('P03'); if (A.spark) A.spark.visible = weld && Math.random() > 0.3; T3.sparkLight.intensity = weld ? 300 + Math.random() * 500 : 0;
  if (anim || T3X.shadow) { T3.r.shadowMap.needsUpdate = true; T3X.shadow = false; }   // 크레인이 움직일 때·보이기가 바뀔 때만 그림자 갱신
  T3.r.render(T3.scene, T3.cam);
}
Object.assign(ACT, { t3tog(k) { T3[k] = !T3[k]; T3.dirty = true; render(); } });
