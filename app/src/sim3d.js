// ---------- 공정 시뮬레이션(조선소 3D): 블록 하나가 강재 절단 → 소조립 → 블록 조립·용접 → 검사 → 도장 → 이송·탑재 되는 정상 흐름 ----------
// 서버의 고장·멈춤 데이터와 분리된 시연용 재생. 수량(piece·set·m·point·m²)은 엑셀 데이터(다음 착공 블록) 값을 쓴다.
// 규칙(QC 검수 반영): ① 공중의 물체는 반드시 크레인 훅에 걸려 있다 ② 놓인 물체는 바닥·받침·운반차·다른 부재 위에 있다
// ③ 02에서 만든 세트 8개(부재 15장)가 그대로 03 블록이 된다 ④ 모든 위치는 시간 t의 함수(일시정지·단계 이동·배속이 자연스럽게 됨).
const SIM = { on: false, play: false, t: 0, speed: 1, phase: -1, vid: true, rate: 1 };   // vid = 16배속 녹화 영상 재생(기본), rate = 영상 재생 배율(1 = 16배속, 2 = 32배속)
const SIM_VIDEO = 'media/twinpro-process-16x', SIM_VX = 16;   // .webm(VP9, 크롬·엣지·파이어폭스) → 안 되면 .mp4(H.264, 사파리)   // 전체 재생을 16배속으로 녹화한 영상(tools/record_sim.js)
const SIM_PH = [   // [키, 길이(초, 계획을 만든 뒤 다시 계산), 단계 번호(칩), 제목, 기본 설명]
  ['w1', 40, 0, '01 강재 절단', ''], ['m12', 10, 0, '부재 운반', '부재 운반차가 잘린 부재와 판넬용 강판을 판넬 라인으로 옮깁니다.'],
  ['w2', 60, 1, '02 소조립·취부', ''], ['m23', 14, 1, '세트 운반', 'SPMT가 세트 8개(부재 15장)를 블록 조립 공장으로 옮깁니다.'],
  ['w3', 80, 2, '03 블록 조립·용접', ''], ['m34', 14, 2, '블록 운반', '완성된 블록을 검사장으로 옮깁니다.'],
  ['w4', 22, 3, '04 치수·용접 검사', ''], ['m45', 14, 3, '블록 운반', '검사를 통과한 블록을 도장 공장으로 옮깁니다.'],
  ['w5', 20, 4, '05 표면처리·도장', ''], ['m56', 16, 5, '06 블록 이송', 'SPMT가 완성된 블록을 골리앗 크레인 아래로 옮깁니다.'],
  ['er', 28, 5, '탑재', ''],
];
const SIM_STEPS = ['01 절단', '02 소조립', '03 용접', '04 검사', '05 도장', '06 이송·탑재'];
let SIM_TOTAL = SIM_PH.reduce((a, p) => a + p[1], 0);
let SB = null;   // 시뮬레이션 계획(크레인·차량·물체·카메라·자막의 시간표)

function simBlockId() { const w = woList().filter(x => x.process_id === 'P01' && x.status === 'PLANNED').sort((a, b) => a.block_id.localeCompare(b.block_id))[0]; return w ? w.block_id : bkBlockDefault(); }
function simQty() { const ws = bkWos(SIM.block); return ws.map(w => w ? +w.planned_qty : 0); }
function simPhaseAt(t) { let a = 0; for (let i = 0; i < SIM_PH.length; i++) { if (t < a + SIM_PH[i][1] || i === SIM_PH.length - 1) return { i, u: Math.max(0, Math.min(1, (t - a) / SIM_PH[i][1])), start: a }; a += SIM_PH[i][1]; } }
const ease = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
const clamp01 = u => Math.max(0, Math.min(1, u));
function kfEval(a, t) {   // 시간표 [[t, 값...]] 사이를 부드럽게(구간마다 가감속)
  if (t <= a[0][0]) return a[0].slice(1);
  for (let i = 0; i < a.length - 1; i++) { const p = a[i], q = a[i + 1]; if (t < q[0]) { const f = q[0] > p[0] ? ease((t - p[0]) / (q[0] - p[0])) : 1; return p.slice(1).map((v, j) => v + (q[j + 1] - v) * f); } }
  return a[a.length - 1].slice(1);
}

// ---------- 장비 정의(Blender 모델과 같은 기준값) ----------
// 크레인 상태 = (b: 거더 위치, tr: 트롤리 위치, z: 훅 기준점 높이). gap = 훅 기준점 → 훅 아래끝, sling = 줄걸이 길이
const SIM_CR = {
  c1: { b: 'P01_crane', ax: 'y', tn: 'P01_trolley', tax: 'x', hook: 'P01_hook', wires: 'P01_wires', wl: 8.05, b0: -2, t0: -119, z0: 6.65, gap: 0.74, sling: 0 },
  c2: { b: 'P02_crane', ax: 'x', tn: 'P02_ctrolley', tax: 'y', hook: 'P02_chook', wires: 'P02_cwires', wl: 2.0, b0: -69, t0: 0, z0: 10.6, gap: 0.73, sling: 2.0 },
  c3: { b: 'P03_crane', ax: 'y', tn: 'P03_trolley', tax: 'x', hook: 'P03_hook', wires: 'P03_wires', wl: 1.8, b0: 5, t0: -21, z0: 13.0, gap: 0.55, sling: 2.5 },
  cg: { b: null, tn: 'GOL_trolley', tax: 'y', hook: 'GOL_hook', wires: 'GOL_wires', wl: 13.0, b0: 0, t0: 41, z0: 30.0, gap: 0.9, sling: 4.0, fx: 46 },
};
const SIM_VE = { ft: { node: 'SIM_ftrans', hl: 9.0, hw: 1.3, r: 0.36 }, sp: { node: 'P06_transporter', hl: 9.2, hw: 2.8, r: 0.45 } };
const steerA = (m, x, y) => { if (m === 'crab') return Math.PI / 2; if (m !== 'pivot') return 0; let a = Math.atan2(x, -y); if (a > Math.PI / 2) a -= Math.PI; if (a <= -Math.PI / 2) a += Math.PI; return a; };   // 부재 운반차(적재면 1.38 m), SPMT(적재면 2.09 m)
const SIM_HIDE = ['P01_topplate', 'P01_mplate', 'P01_cutplate', 'P02_block', 'P03_block', 'P04_block', 'P05_block', 'P06_block', 'P03_spark'];
function gZ(x, y) { for (const k in T3_X) if (Math.abs(x - T3_X[k]) <= 20 && y <= 22) return 0.3 * clamp01((y + 24.5) / 2.5); return 0; }
function veZ(k, x, y, h) { const v = SIM_VE[k], c = Math.cos(h), s = Math.sin(h); let z = 0;
  for (const a of [-1, 1]) for (const b of [-1, 1]) z = Math.max(z, gZ(x + a * v.hl * c - b * v.hw * s, y + a * v.hl * s + b * v.hw * c)); return z; }
function crBT(k, p) { const c = SIM_CR[k]; return [c.ax === 'x' ? p.x : c.ax === 'y' ? p.y : 0, c.tax === 'x' ? p.x : p.y]; }
function crHookW(k, t) { const c = SIM_CR[k], [b, tr, z] = kfEval(SB.cr[k], t); return new T3.THREE.Vector3(c.fx ?? (c.ax === 'x' ? b : tr), c.ax === 'y' ? b : tr, z); }
function topOff(o, q) { let m = -1e9; for (const c of o.userData.cor) { const z = c.clone().applyQuaternion(q).z; if (z > m) m = z; } return m; }
function botOff(o, q) { let m = 1e9; for (const c of o.userData.cor) { const z = c.clone().applyQuaternion(q).z; if (z < m) m = z; } return m; }

// ---------- 시뮬레이션 전용 물체 ----------
function simBuild() {
  if (SIM.obj) return;
  const T = T3.THREE, sc = T3.scene, O = SIM.obj = { ob: {}, nodes: {} }, V = (x, y, z) => new T.Vector3(x, y, z);
  const M = (c, o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.35, ...o });
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };
  const group = (...ms) => { const g = new T.Group(); ms.forEach(m => g.add(m)); return g; };
  const dark = M(0x111214, { metalness: 0 }), yel = M(0xe8a317), blue = M(0x1f4f8c), wood = M(0x5a3e26, { metalness: 0, roughness: 0.9 });
  // 블록 강재: 프라이머(붉은색) → 블라스팅(회갈색) → 도장(청회색). 블록 길이 방향 진행선 앞뒤로 색이 바뀜
  O.paintU = { uO: { value: V(0, 0, 0) }, uD: { value: V(0, 1, 0) }, uB: { value: -1e9 }, uP: { value: -1e9 },
    uC0: { value: new T.Color(0x8c2f1c) }, uC1: { value: new T.Color(0x8d8780) }, uC2: { value: new T.Color(0x7f97ab) } };
  O.blockMat = M(0x8c2f1c, { metalness: 0.3, roughness: 0.55 });
  O.blockMat.onBeforeCompile = sh => { Object.assign(sh.uniforms, O.paintU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 uO, uD, uC0, uC1, uC2; uniform float uB, uP;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat sP = dot(vWP - uO, uD); vec3 cP = uC0; if (sP < uB) cP = uC1; if (sP < uP) cP = uC2; diffuseColor.rgb = cP;'); };
  const reg = (key, o) => { o.visible = false; sc.add(o); O.ob[key] = o; o.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(o); o.userData.cor = []; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) o.userData.cor.push(V(x, y, z)); return o; };
  const strips = (pts, m, z) => { const g = new T.Group(); for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const s = mesh(new T.BoxGeometry(L + 0.03, 0.035, 0.012), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z); s.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]); s.castShadow = false; g.add(s); } return g; };
  const ell = (cx, cy, rx, ry, n = 14) => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos(i / n * Math.PI * 2), cy + ry * Math.sin(i / n * Math.PI * 2)]);
  const shapeOf = (pts, P = T.Shape) => { const s = new P(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath(); return s; };
  const extr = (shape, t) => { const g = new T.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 16 }); g.translate(0, 0, -t / 2); return g; };

  const L = 12.5, Bw = 5.2, H = 3.4, Hw = 3.24, IBH = flatHoles('IB', [L, 2.6, 0.08], { manhole: true });
  // ---- 블록 부재 15장(세트 8개). 기준점 = 부재 중심, 블록 좌표 원점 = 블록 중심(바닥에서 1.7 m) ----
  const fx = Array.from({ length: 6 }, (_, i) => -L / 2 + 0.25 + (L - 0.5) * i / 5), ctx = { bays: [-3 * Bw / 8, -Bw / 8, Bw / 8, 3 * Bw / 8], fx, cx: 0, manhole: true };
  const NOTCH = { GD: fx.map(x => [x, 0.12, Hw / 2 + 0.01, true]), FL: [-1.3, 0, 1.3].map(y => [y, 0.12, Hw / 2 + 0.01, false]) };
  const P = (type, size) => mesh(plateGeo(T, size, flatHoles(type, size, ctx), NOTCH[type]), O.blockMat);
  const qI = new T.Quaternion(), qGX = new T.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2), qFY = new T.Quaternion().setFromAxisAngle(V(0, 1, 0), -Math.PI / 2), qGXi = qGX.clone().invert();
  O.pieces = [];
  const piece = (key, g, local, flat) => { reg(key, g); g.userData.local = local; g.userData.flat = flat; O.pieces.push(key); };
  piece('BPA', group(P('BP', [L, 2.6, 0.08])), V(0, -1.3, -1.66), qI);
  piece('BPB', group(P('BP', [L, 2.6, 0.08])), V(0, 1.3, -1.66), qI);
  [-1.3, 0, 1.3].forEach((y, i) => piece('GD' + (i + 1), group(P('GD', [L, 0.08, Hw])), V(0, y, 0), qGX));
  fx.forEach((x, i) => piece('FL' + (i + 1), group(P('FL', [0.08, Bw, Hw])), V(x, 0, 0), qFY));
  const ssP = group(P('SS', [L, 0.08, H])); O.stencil = ssP;
  piece('SSP', ssP, V(0, -Bw / 2 - 0.04, 0), qGXi); piece('SSS', group(P('SS', [L, 0.08, H])), V(0, Bw / 2 + 0.04, 0), qGX);
  const ib = () => { const g = group(mesh(plateGeo(T, [L, 2.6, 0.08], IBH), O.blockMat)); [-0.65, 0.65].forEach(y => g.add(mesh(new T.BoxGeometry(L, 0.025, 0.25), O.blockMat, 0, y, 0.165)));
    for (const x of [-4.2, 4.2]) { const l = lugMesh(T, yel); l.rotation.z = Math.PI / 2; l.position.set(x, 0, 0.22); g.add(l); } return g; };
  piece('IBA', ib(), V(0, -1.3, 1.66), qI); piece('IBB', ib(), V(0, 1.3, 1.66), qI);
  for (const k of ['IBA', 'IBB']) O.ob[k].userData.lugs = [V(-4.2, 0, 0.4), V(4.2, 0, 0.4)];   // 줄걸이는 인양 러그 윗구멍에 건다
  // ---- 01·02 재료: 내저판은 01에서 판만 잘라 오고(맨홀 0·1·2개 단계), 02에서 평철 2개를 붙여 판넬(IBA·IBB)이 됨 ----
  const yaw90 = new T.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2), rawM = M(0x5a4033, { roughness: 0.8 });
  for (const k of ['IBA', 'IBB']) { reg(k + '0', mesh(new T.BoxGeometry(L, 2.6, 0.08), O.blockMat)); reg(k + '1', mesh(plateGeo(T, [L, 2.6, 0.08], IBH.slice(0, 1)), O.blockMat));
    reg(k + '2', mesh(plateGeo(T, [L, 2.6, 0.08], IBH), O.blockMat)); for (const n of [0, 1, 2]) O.ob[k + n].userData.flat = qI;
    reg('bar' + k, group(...[-0.65, 0.65].map(y => mesh(new T.BoxGeometry(L, 0.025, 0.25), O.blockMat, 0, y, 0)))); O.ob['bar' + k].userData.flat = qI; }
  // 01 절단 순서(정척판 12장: 늑판은 2장씩 한 판). 판 위 배치 = 테이블 중심 기준
  O.CYC = [['FL6', 'FL5'], ['FL4', 'FL3'], ['FL2', 'FL1'], ['BPB'], ['BPA'], ['GD3'], ['GD2'], ['GD1'], ['SSS'], ['SSP'], ['IBB0'], ['IBA0']].map((ks, i) => {
    const fl = ks[0].startsWith('FL'), lay = ks.map((k, j) => ({ k, p: V(fl ? (j ? -2.65 : 2.65) : 0, 0, 0), q: fl ? yaw90.clone().multiply(O.ob[k].userData.flat) : O.ob[k].userData.flat.clone() }));
    const bb = new T.Box3(); lay.forEach(l => O.ob[l.k].userData.cor.forEach(c => bb.expandByPoint(c.clone().applyQuaternion(l.q).add(l.p))));
    const sz = bb.getSize(V(0, 0, 0)), raw = mesh(new T.BoxGeometry(sz.x, sz.y, 0.08), rawM); reg('raw' + i, raw);
    // 절단선: 부재 윗면 윤곽(외곽·구멍·슬롯)을 판 위에 검은 띠로. 토치가 지나간 쪽(동쪽)만 보이게 잘라 그림(clipping)
    const pos = []; lay.forEach(l => { const o = O.ob[l.k], g = (o.isMesh ? o : o.children[0]).geometry; const eg = new T.EdgesGeometry(g, 30), a = eg.attributes.position;
      for (let e = 0; e < a.count; e += 2) { const p0 = V(a.getX(e), a.getY(e), a.getZ(e)).applyQuaternion(l.q).add(l.p), p1 = V(a.getX(e + 1), a.getY(e + 1), a.getZ(e + 1)).applyQuaternion(l.q).add(l.p);
        if (p0.z < 0.01 || p1.z < 0.01) continue; const d = V(p1.x - p0.x, p1.y - p0.y, 0); if (d.length() < 1e-4) continue; const n = V(-d.y, d.x, 0).normalize().multiplyScalar(0.018), z = 0.048;
        pos.push(p0.x + n.x, p0.y + n.y, z, p1.x + n.x, p1.y + n.y, z, p1.x - n.x, p1.y - n.y, z, p0.x + n.x, p0.y + n.y, z, p1.x - n.x, p1.y - n.y, z, p0.x - n.x, p0.y - n.y, z); } });
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    const clip = new T.Plane(V(1, 0, 0), 1e9), lm = new T.MeshBasicMaterial({ color: 0x0b0b0c, side: T.DoubleSide, clippingPlanes: [clip] });
    const cl = new T.Mesh(lg, lm); cl.visible = false; raw.add(cl);
    return { ks, lay, raw: 'raw' + i, sz, cl, clip, fl };
  });
  T3.r.localClippingEnabled = true;
  // 블록(조립 완료 후 부재 15장을 묶는 그룹) + 검사점 10개(치수 6 + 용접 4)
  O.blk = new T.Group(); O.blk.visible = false; sc.add(O.blk); O.ob.blk = O.blk; O.blk.userData.cor = [];
  for (const x of [-L / 2, L / 2]) for (const y of [-Bw / 2 - 0.1, Bw / 2 + 0.1]) for (const z of [-H / 2, H / 2 + 0.4]) O.blk.userData.cor.push(V(x, y, z));
  O.blk.userData.lugs = [V(-4.2, -1.3, 2.06), V(4.2, -1.3, 2.06), V(-4.2, 1.3, 2.06), V(4.2, 1.3, 2.06)];   // 내저판 위 러그 4곳
  O.marks = [[-L / 2 + 0.2, -Bw / 2, H / 2 + 0.2], [L / 2 - 0.2, -Bw / 2, H / 2 + 0.2], [0, -Bw / 2, H / 2 + 0.2], [-L / 2 + 0.2, Bw / 2, H / 2 + 0.2], [L / 2 - 0.2, Bw / 2, H / 2 + 0.2], [0, Bw / 2, H / 2 + 0.2],
    [-4.5, Bw / 2 + 0.32, -H / 2 + 0.2], [-1.5, Bw / 2 + 0.32, -H / 2 + 0.2], [1.5, Bw / 2 + 0.32, -H / 2 + 0.2], [4.5, Bw / 2 + 0.32, -H / 2 + 0.2]]
    .map(p => { const m = mesh(new T.SphereGeometry(0.2, 14, 10), new T.MeshStandardMaterial({ color: 0x9ca3af })); m.position.set(...p); m.visible = false; O.blk.add(m); return m; });
  // 받침목(운반차 위, 차량을 따라 다님)
  const timber = (w, d, h, x, y) => mesh(new T.BoxGeometry(w, d, h), wood, x, y, h / 2);
  reg('spDun', group(...[[-8.5, 1.7, 3.0], [-3.5, 1.7, 3.0], [1.5, 1.7, 3.0], [-8.5, -1.7, 3.0], [-3.5, -1.7, 3.0], [1.5, -1.7, 3.0], [4.8, 0, 5.4], [7.6, 0, 5.4]].map(([x, y, d]) => timber(0.4, d, 0.12, x, y))));
  reg('ftDun', group(...[-8.6, -3.4, 1.8, 4.4, 8.0].map(x => timber(0.3, 2.8, 0.1, x, 0))));
  reg('rsDun', group(...[-5, 0, 5].map(x => timber(0.3, 3.6, 0.25, x, 0))));
  reg('stgDun', group(...[-5, 0, 5].map(x => timber(0.3, 3.6, 0.12, x, 0)), ...[9.4, 12.6].map(x => timber(0.3, 3.6, 0.12, x, 0))));
  const rack = group(); for (const x of [-5, 0, 5]) { rack.add(mesh(new T.BoxGeometry(0.3, 0.3, 1.0), blue, x, 0, 0.5)); rack.add(mesh(new T.BoxGeometry(0.4, 2.8, 0.08), blue, x, 0, 1.04));   // 평철 거치대: 빗살(세운 평철을 끼워 세움)
    for (const y of [-0.7, 0.7]) for (const d of [-0.65, 0.65]) for (const e of [-0.05, 0.05]) rack.add(mesh(new T.BoxGeometry(0.06, 0.03, 0.2), blue, x, y + d + e, 1.18)); } reg('rack', rack);
  // 불꽃, 줄걸이 선, 레이저 측정선, 초음파 탐촉자, 도장용 고소작업대·노즐·분무, 탑재 위치 표시
  O.spark = new T.PointLight(0xffb060, 0, 18); sc.add(O.spark);
  O.sparkM = mesh(new T.SphereGeometry(0.12, 10, 8), new T.MeshBasicMaterial({ color: 0xffe0a0 })); O.sparkM.castShadow = false; O.sparkM.visible = false; sc.add(O.sparkM);
  const line = (n, color) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(n * 3), 3)); const l = new (n > 2 ? T.LineSegments : T.Line)(g, new T.LineBasicMaterial({ color })); l.frustumCulled = false; l.visible = false; sc.add(l); return l; };
  O.sling = {}; for (const k in SIM_CR) O.sling[k] = line(8, 0x202326);
  O.laser = line(2, 0xff3b30); O.probeCable = line(2, 0x111111);
  O.probe = group(mesh(new T.BoxGeometry(0.18, 0.12, 0.28), blue), mesh(new T.CylinderGeometry(0.03, 0.03, 0.25, 8), dark, 0, 0, -0.25)); O.probe.visible = false; sc.add(O.probe);
  O.lift = group(mesh(new T.BoxGeometry(2.4, 1.6, 0.6), yel, 0, 0, 0.3)); O.boom = mesh(new T.BoxGeometry(0.25, 0.25, 1), yel); O.lift.add(O.boom);
  O.basket = group(mesh(new T.BoxGeometry(1.2, 0.9, 0.08), yel), mesh(new T.BoxGeometry(1.2, 0.05, 0.9), yel, 0, -0.43, 0.45), mesh(new T.BoxGeometry(1.2, 0.05, 0.9), yel, 0, 0.43, 0.45), mesh(new T.BoxGeometry(0.05, 0.9, 0.9), yel, 0.58, 0, 0.45));
  const nz = mesh(new T.CylinderGeometry(0.05, 0.08, 0.5, 10), dark, -0.75, 0, 0.6); nz.rotation.z = Math.PI / 2; O.basket.add(nz);
  O.mist = mesh(new T.ConeGeometry(0.75, 2.2, 18, 1, true), new T.MeshBasicMaterial({ color: 0xc9d2da, transparent: true, opacity: 0.35, depthWrite: false, side: T.DoubleSide }), -2.0, 0, 0.6);
  O.mist.castShadow = false; O.mist.rotation.z = -Math.PI / 2; O.basket.add(O.mist); O.lift.add(O.basket); O.lift.visible = false; sc.add(O.lift);
  O.target = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(Bw, L, H)), new T.LineBasicMaterial({ color: 0x6fd3ff })); O.target.visible = false; sc.add(O.target);
  // 모델 쪽 노드: 원래 상태를 기억했다가 끝낼 때 되돌린다
  const keep = n => { const o = T3.find(n); if (o && !o.userData.s0) o.userData.s0 = { pos: o.position.clone(), rot: o.rotation.clone(), sc: o.scale.clone(), vis: o.visible }; return o; };
  for (const k in SIM_CR) { const c = SIM_CR[k]; c.bn = c.b && keep(c.b); c.tnn = keep(c.tn); c.hn = keep(c.hook); c.wn = keep(c.wires); }
  for (const k in SIM_VE) { const v = SIM_VE[k]; v.n = keep(v.node); v.bog = [];   // 대차(조향) + 바퀴(굴러감)
    const [bp, wp] = k === 'sp' ? ['P06_bog', 'P06_whl'] : ['SIM_ftb', 'SIM_ftw'];
    for (let i = 0; i < 8; i++) for (const sd of 'LR') { const b = keep(bp + i + sd), w = keep(wp + i + sd); if (b) v.bog.push({ b, w, x: b.position.x, y: -b.position.z }); } }
  for (const n of [...SIM_HIDE, 'P01_cnc', 'P01_torch', 'P02_gantry', 'P02_wtorch']) O.nodes[n] = keep(n);
}

// ---------- 계획(시간표) 만들기 ----------
function simPlan() {
  const T = T3.THREE, O = SIM.obj, V = (x, y, z) => new T.Vector3(x, y, z), q = simQty();
  const yaw = h => new T.Quaternion().setFromAxisAngle(V(0, 0, 1), h), qI = new T.Quaternion(), R90 = Math.PI / 2;
  SB = { cr: { c1: [[0, -2, -119, 6.65]], c2: [[0, -51.5, 0, 10.6]], c3: [[0, 5, -21, 13.0]], cg: [[0, 0, 41, 30.0]] },
    ve: { ft: [[0, -112, -17.5, 0]], sp: [[0, 115, -31, 0]] }, st: { ft: [[0, 'drive']], sp: [[0, 'drive']] }, sd: { ft: [[0, 0, 0]], sp: [[0, 0, 0]] }, ob: {}, cam: [], cap: [], fx: [], cnt: {}, ph: [], upd: [], ev: {} };
  const CS = { h: 10, v: 6 }, VS = { drive: 9, crab: 4, turn: 0.6 }, last = a => a[a.length - 1];
  const crHold = (k, t) => { const l = last(SB.cr[k]); if (t > l[0]) SB.cr[k].push([t, l[1], l[2], l[3]]); };
  const crGo = (k, t, b, tr, z, f = 1) => { crHold(k, t); const l = last(SB.cr[k]); const d = Math.max(0.4 / f, Math.hypot(b - l[1], tr - l[2]) / (CS.h * f), Math.abs(z - l[3]) / (CS.v * f)); SB.cr[k].push([l[0] + d, b, tr, z]); return l[0] + d; };
  const veHold = (k, t) => { const l = last(SB.ve[k]); if (t > l[0]) SB.ve[k].push([t, l[1], l[2], l[3]]); };
  const veGo = (k, t, x, y, h, spd) => { veHold(k, t); let l = last(SB.ve[k]); const dx = x - l[1], dy = y - l[2], dist = Math.hypot(dx, dy), dh = h - l[3];
    const a = Math.atan2(dy, dx) - l[3], m = dist < 1e-6 ? (Math.abs(dh) > 1e-6 ? 'pivot' : last(SB.st[k])[1]) : Math.abs(Math.sin(a)) > 0.7 ? 'crab' : 'drive';
    if (m !== last(SB.st[k])[1]) { const lm = last(SB.st[k])[1]; SB.st[k].push([l[0], lm], [l[0] + 1.0, m]); veHold(k, l[0] + 1.0); l = last(SB.ve[k]); }
    const d = Math.max(0.5, dist / spd, Math.abs(dh) / VS.turn); SB.ve[k].push([l[0] + d, x, y, h]);
    const sl = m === 'crab' ? Math.sign(Math.sin(a)) * dist : m === 'drive' ? Math.sign(Math.cos(a)) * dist : 0, c = last(SB.sd[k]);
    SB.sd[k].push([l[0], c[1], c[2]], [l[0] + d, c[1] + sl, c[2] + (m === 'pivot' ? dh : 0)]); return l[0] + d; };
  const vW = (k, t, lp, lq = qI) => { const [x, y, h] = kfEval(SB.ve[k], t), c = Math.cos(h), s = Math.sin(h); return { p: V(x + lp.x * c - lp.y * s, y + lp.x * s + lp.y * c, lp.z + veZ(k, x, y, h)), q: yaw(h).multiply(lq) }; };
  const ob = (key, ev) => (SB.ob[key] = SB.ob[key] || []).push(ev);
  const cap = (t, s) => SB.cap.push([t, s]), cam = (t, f) => SB.cam.push([t, f]);   // f(t) → [바라볼 점, 카메라 위치]
  const camHook = (k, off, zMin = 2) => t => { const h = crHookW(k, t), g = V(h.x, h.y, Math.max(zMin, h.z - 4)); return [g, g.clone().add(V(...off))]; };
  const camVe = (k, off, lx = 0) => t => { const g = vW(k, t, V(lx, 0, 2)).p; return [g, g.clone().add(V(...off))]; };
  const camFix = (pos, tg) => () => [V(...tg), V(...pos)];
  const camObj = (key, off) => t => { const s = simObPose(key, t), g = s ? s.p.clone() : V(0, 0, 0); return [g, g.clone().add(V(...off))]; };
  // 크레인 작업 하나: 위로 이동 → 내림 → 걸기 → 들어 올림 → 이동(필요하면 공중에서 돌림) → 내림 → 풀기 → 올림
  const lift = (k, key, from, to, t, o = {}) => {
    const C = SIM_CR[k], o3 = O.ob[key], zT = o.zT ?? C.z0, f = o.f || 1, [bf, tf] = crBT(k, from.p);
    let tc = crGo(k, t, bf, tf, zT, f);
    tc = crGo(k, tc, bf, tf, from.p.z + topOff(o3, from.q) + C.sling + C.gap, f);
    const ev = { t: tc, m: 'h', c: k, q0: from.q, q1: null, ta: 0, tb: 0 }; ob(key, ev); tc += 0.35 / f; crHold(k, tc);
    tc = crGo(k, tc, bf, tf, zT, f); ev.ta = tc;
    const toW = to.v ? vW(to.v, tc, to.lp, to.lq) : to.o ? (() => { const pp = simObPose(to.o, tc); return { p: to.lp.clone().applyQuaternion(pp.q).add(pp.p), q: pp.q.clone().multiply(to.lq) }; })() : to;
    ev.q1 = toW.q; const [bt, tt] = crBT(k, toW.p);
    tc = crGo(k, tc, bt, tt, zT, f); ev.tb = tc;
    tc = crGo(k, tc, bt, tt, toW.p.z + topOff(o3, toW.q) + C.sling + C.gap, f);
    const tSet = tc; if (o.hold) { tc += o.hold; crHold(k, tc); }   // 줄을 건 채 붙잡고 가접
    ob(key, to.v ? { t: tc, m: 'v', v: to.v, lp: to.lp, lq: to.lq } : to.o ? { t: tc, m: 'o', parent: to.o, lp: to.lp, lq: to.lq } : { t: tc, m: 'w', p: toW.p, q: toW.q });
    const tRel = tc; tc += 0.35 / f; crHold(k, tc); tc = crGo(k, tc, bt, tt, zT, f);
    return { t: tc, tRel, tAtt: ev.t, tSet };
  };
  const poseAt = (key, t) => { const s = simObPose(key, t); return { p: s.p.clone(), q: s.q.clone() }; };
  // 여러 장을 한 묶음으로 들기: keys = 아래 → 위. 맨 위 부재에 줄을 걸고 나머지는 같은 상대 위치로 매달렸다가 함께 내려앉음
  const liftSet = (k, keys, to, t, o = {}) => {
    const lead = keys[keys.length - 1], L0 = poseAt(lead, t), iq = L0.q.clone().invert();
    const rel = keys.slice(0, -1).map(kk => { const P = poseAt(kk, t); return { kk, p: P.p.sub(L0.p).applyQuaternion(iq), q: iq.clone().multiply(P.q) }; });
    const r = lift(k, lead, L0, to, t, o);
    rel.forEach(({ kk, p, q }) => { ob(kk, { t: r.tAtt, m: 'o', parent: lead, lp: p, lq: q });
      ob(kk, to.v ? { t: r.tRel, m: 'v', v: to.v, lp: p.clone().applyQuaternion(to.lq).add(to.lp), lq: to.lq.clone().multiply(q) } : { t: r.tRel, m: 'w', p: p.clone().applyQuaternion(to.q).add(to.p), q: to.q.clone().multiply(q) }); });
    return r;
  };
  // 쌓기: keys(아래 → 위, 지금 위치의 상대 배치 유지)를 받침 높이 top 위에 놓을 때 맨 위 부재의 자리. 놓은 뒤 새 top을 돌려줌
  const stackAt = (keys, t, x, y, top, lq) => {
    const lead = keys[keys.length - 1], L0 = poseAt(lead, t), iq = L0.q.clone().invert(), b0 = keys[0], B = poseAt(b0, t);
    const rp = B.p.sub(L0.p).applyQuaternion(iq), rq = iq.clone().multiply(B.q);
    const z = top + 0.005 - botOff(O.ob[b0], lq.clone().multiply(rq)) - rp.clone().applyQuaternion(lq).z;
    return { lp: V(x, y, z), lq, top: z + topOff(O.ob[lead], lq) };
  };
  const phase = (key, a, b) => SB.ph.push([key, a, b]);
  const IBS = ['IBA0', 'IBA1', 'IBA2', 'IBB0', 'IBB1', 'IBB2', 'barIBA', 'barIBB'];
  [...O.CYC.map(c => c.raw), ...IBS, ...O.pieces, 'blk'].forEach(k => ob(k, { t: 0, m: 'x' }));
  ob('spDun', { t: 0, m: 'v', v: 'sp', lp: V(0, 0, 2.09), lq: qI }); ob('ftDun', { t: 0, m: 'v', v: 'ft', lp: V(0, 0, 1.385), lq: qI });
  const yaw90 = yaw(R90), flat = k => O.ob[k].userData.flat;

  // ===== 01 강재 절단: 이 블록용 강판 더미 → CNC 절단 → 부재 운반차(긴 판 더미 + 늑판 더미) =====
  let t = 0, r; const P1 = -115, TBL = V(P1 + 6.5, 16.2, 1.165), RS = V(P1 - 9.5, 13, 0.3), PARK = 14.4;
  ob('rsDun', { t: 0, m: 'w', p: RS.clone(), q: qI });
  let zr = RS.z + 0.25; for (let i = O.CYC.length - 1; i >= 0; i--) { const c = O.CYC[i]; c.rp = V(RS.x, RS.y, zr + 0.04); ob(c.raw, { t: 0, m: 'w', p: c.rp, q: qI }); zr += 0.08; }
  const ftTop = { L: 1.485, F: 1.485 }, ftX = { L: -3.4, F: 6.2 };
  cam(0, camFix([P1 + 34, -44, 30], [P1 + 2, 2, 3]));
  cap(0, '01 강재 적치장. 북쪽에 이 블록(B011)용 강판 12장, 앞쪽에 빈 부재 운반차가 있습니다.');
  const CK = [[0, PARK, 15.4]], CUT = [], cutDone = [];
  O.CYC.forEach((c, i) => {
    const fast = i > 0, f = fast ? 8 : 1;
    if (i === 0) { t = 2.5; cap(t, '마그넷 크레인이 강판 더미 맨 위 1장(늑판 2장 몫)을 집어 CNC 절단기 테이블로 옮깁니다.'); cam(t, camHook('c1', [-16, -20, 12])); }
    if (i === 1) { cap(t, '나머지 강판 11장(늑판 4 · 바닥판 2 · 거더 3 · 측판 2 · 내저판 2)도 같은 순서로 자릅니다 (×8 빠르게).'); cam(t, camFix([P1 - 4, -30, 40], [P1 + 1, 7, 0])); }
    r = lift('c1', c.raw, { p: c.rp, q: qI }, { p: TBL, q: qI }, t, { f });
    // 절단: 갠트리가 동쪽 대기 자리에서 판 동쪽 끝으로 와서 서쪽으로 훑으며 자름(지나간 자리에 절단선)
    const xe = 6.5 + c.sz.x / 2 + 0.1, xw = 6.5 - c.sz.x / 2 - 0.1, cut0 = r.t + (fast ? 0.4 : 1.2), cut1 = cut0 + (fast ? 1.6 : 8), back = fast ? 0.4 : 1.5;
    CK.push([r.t, PARK, 15.4], [cut0, xe, 15.4]); CUT.push({ cut0, cut1, xe, xw, hw: c.sz.y / 2, c }); CK.push([cut1, xw, 15.4], [cut1 + back, PARK, 15.4]);
    if (i === 0) { cap(cut0 - 1, '절단기가 판을 자릅니다: 늑판 2장의 외곽, 경감공(둥근 구멍), 거더가 끼워질 슬롯. 구멍에서 빠진 조각은 수조 테이블 아래로 떨어집니다.'); cam(cut0 - 1, camFix([P1 - 2, 7, 7.5], [P1 + 6.5, 16.2, 1.3])); }
    ob(c.raw, { t: cut1, m: 'x' }); c.lay.forEach(l => ob(l.k, { t: cut1, m: 'w', p: TBL.clone().add(l.p), q: l.q.clone() })); cutDone.push([cut1, c.ks.length]);
    t = cut1 + back + 0.1;
    if (i === 0) { cap(t, '잘린 늑판을 한 장씩 들어 부재 운반차 앞쪽(늑판 더미)에 싣습니다.'); cam(t, camHook('c1', [-18, -24, 13])); }
    c.lay.forEach((l, j) => { const row = c.fl ? 'F' : 'L', lq = c.fl ? yaw90.clone().multiply(flat(l.k)) : flat(l.k).clone(), st = stackAt([l.k], t, ftX[row], 0, ftTop[row], lq); ftTop[row] = st.top;
      r = lift('c1', l.k, poseAt(l.k, t), { v: 'ft', lp: st.lp, lq: st.lq }, t, { f: fast ? 8 : (j ? 2.5 : 1) }); t = r.t; });
  });
  t = crGo('c1', t, -2, -119, 6.65, 2);
  const inCut = tt => CUT.find(w => tt >= w.cut0 && tt < w.cut1);
  CUT.forEach(w => SB.fx.push([w.cut0, w.cut1, tt => { const u = (tt - w.cut0) / (w.cut1 - w.cut0); return V(P1 + w.xe + (w.xw - w.xe) * u, 16.2 + w.hw * Math.sin(u * Math.PI * (w.c.fl ? 10 : 6)), 1.25); }]));
  SB.upd.push(tt => { const N = O.nodes, w = inCut(tt); let x, y;
    if (w) { const u = (tt - w.cut0) / (w.cut1 - w.cut0); x = w.xe + (w.xw - w.xe) * u; y = 16.2 + w.hw * Math.sin(u * Math.PI * (w.c.fl ? 10 : 6)); } else [x, y] = kfEval(CK, tt);
    if (N.P01_cnc) N.P01_cnc.position.x = N.P01_cnc.userData.s0.pos.x + (x - 3.9);
    if (N.P01_torch) N.P01_torch.position.z = N.P01_torch.userData.s0.pos.z - (y - 15.4);
    CUT.forEach(v => { const on = tt >= v.cut0 && tt < v.cut1; v.c.cl.visible = on; if (on) v.c.clip.constant = -(P1 + x); }); });
  SB.cnt.w1 = tt => `부재 ${Math.round(q[0] * cutDone.filter(d => d[0] <= tt).reduce((a, d) => a + d[1], 0) / 15)} / ${q[0]} piece`;
  phase('w1', 0, t + 0.5); t += 0.5;

  // ===== 01 → 02: 부재 운반차(바퀴 90° 돌려 옆으로 → 도로 → 옆으로) =====
  const T2 = t; cam(t, camVe('ft', [-14, -26, 15])); cap(t, '부재 운반차가 바퀴를 옆으로 돌려 도로로 나온 뒤 판넬 라인(02)으로 갑니다. 부재 15장(긴 판 9장 + 늑판 6장).');
  t = veGo('ft', t, -112, -31, 0, VS.crab); t = veGo('ft', t, -67, -31, 0, VS.drive); t = veGo('ft', t, -67, -13.8, 0, VS.crab);
  phase('m12', T2, t + 0.3); t += 0.3;
  veGo('sp', 4, -40, -31, 0, VS.drive);   // SPMT는 미리 02 동쪽 도로에서 대기

  // ===== 02 소조립·취부: 내저판 2장 → 판넬(맨홀 + 평철 취부 + FCB 용접), 나머지는 대기 구역에 두었다가 세트로 SPMT에 =====
  const T3s = t, P2 = -69, ENT = V(P2 - 11, 0, 1.54), EXIT = V(P2 + 11, 0, 1.54), WX = P2 + 3, STG = V(P2, 13, 0.3), RK = V(P2, 9.6, 0.3);
  ob('stgDun', { t: 0, m: 'w', p: STG.clone(), q: qI }); ob('rack', { t: 0, m: 'w', p: RK.clone(), q: qI });
  ob('barIBA', { t: 0, m: 'w', p: V(RK.x, RK.y - 0.7, 1.38 + 0.125), q: qI }); ob('barIBB', { t: 0, m: 'w', p: V(RK.x, RK.y + 0.7, 1.38 + 0.125), q: qI });
  cam(t, camFix([P2 + 24, -42, 25], [P2, -2, 2])); cap(t, '판넬 라인 크레인이 운반차 짐을 내립니다: 내저판 1장은 컨베이어 입구로, 나머지 긴 판 8장과 늑판 6장은 묶음째 대기 구역으로.');
  t += 1.5; cam(t, camHook('c2', [-15, -24, 13]));
  r = lift('c2', 'IBA0', poseAt('IBA0', t), { p: ENT.clone(), q: qI }, t); t = r.t;
  const LONG = ['BPB', 'BPA', 'GD3', 'GD2', 'GD1', 'SSS', 'SSP', 'IBB0'], FLS = ['FL6', 'FL5', 'FL4', 'FL3', 'FL2', 'FL1'];
  let st = stackAt(LONG, t, STG.x, STG.y, STG.z + 0.12, qI); r = liftSet('c2', LONG, { p: st.lp, q: st.lq }, t, { f: 1.6, zT: 11.5 }); t = r.t;
  st = stackAt(FLS, t, STG.x + 11, STG.y, STG.z + 0.12, yaw90.clone().multiply(flat('FL1'))); r = liftSet('c2', FLS, { p: st.lp, q: st.lq }, t, { f: 1.6, zT: 11.5 }); t = r.t;
  // 부재 운반차는 빠지고 SPMT가 들어옴. 차량이 크레인 레일(y -20.5)을 넘는 동안 크레인은 동쪽 끝(x -51.5)에 비켜 섬
  t = crGo('c2', t, -51.5, 0, 10.6);
  const tvc = veGo('ft', t, -67, -31, 0, VS.crab); veGo('ft', tvc, -150, -31, 0, VS.drive); crHold('c2', tvc);
  veGo('sp', tvc + 4, -69.5, -31, 0, VS.drive); t = tvc;
  // 판넬 1장 만들기: 맨홀 2개(절단 갠트리) → 평철 2개 취부(크레인이 붙잡은 채 가접) → 컨베이어로 FCB 용접기 통과 → 출구
  const MHu = flatHoles('IB', [12.5, 2.6, 0.08], { manhole: true }).map(h => ENT.x + h[0]), GPK = P2 - 18.5, GK = [[0, GPK]], TW = [], FCBY = [-0.85, -0.45, 0.45, 0.85];
  const panel = (k, t, fast) => {
    const sp = fast ? 0.5 : 1, h1 = t + 1.6 * sp, h2 = h1 + 2.2 * sp, h3 = h2 + 2.2 * sp;
    GK.push([t, GPK], [h1 - 0.1, MHu[0]], [h2, MHu[0]], [h2 + 0.4 * sp, MHu[1]], [h3 + 0.1, MHu[1]], [h3 + 1.5 * sp, GPK]);
    ob(k + '0', { t: h2, m: 'x' }); ob(k + '1', { t: h2, m: 'w', p: ENT.clone(), q: qI }); ob(k + '1', { t: h3, m: 'x' }); ob(k + '2', { t: h3, m: 'w', p: ENT.clone(), q: qI });
    SB.fx.push([h1 + 0.4 * sp, h2, tt => { const a = (tt - h1) * 5; return V(MHu[0] + 0.36 * Math.cos(a), 0.24 * Math.sin(a), 1.62); }]);
    SB.fx.push([h2 + 0.4 * sp, h3, tt => { const a = (tt - h2) * 5; return V(MHu[1] + 0.36 * Math.cos(a), 0.24 * Math.sin(a), 1.62); }]);
    const rb = lift('c2', 'bar' + k, poseAt('bar' + k, h3), { p: V(ENT.x, 0, 1.705), q: qI }, h3 + 0.3, { hold: 1.4 * sp, f: fast ? 2 : 1 });
    SB.fx.push([rb.tSet + 0.1, rb.tRel - 0.1, tt => V(ENT.x + [-5, 0, 5][Math.floor((tt - rb.tSet) * 4) % 3], FCBY[Math.floor(tt * 7) % 4], 1.62)]);
    const c0 = rb.tRel + 0.6, c1 = c0 + 8 * sp;
    ob(k + '2', { t: c0, m: 'x' }); ob('bar' + k, { t: c0, m: 'x' });
    ob(k, { t: c0, m: 'f', fn: tt => ({ p: V(ENT.x + (EXIT.x - ENT.x) * ease(clamp01((tt - c0) / (c1 - c0))), 0, 1.54), q: qI }) });
    SB.fx.push([c0 + 1.2 * sp, c1 - 0.8 * sp, tt => V(WX, FCBY[Math.floor(tt * 8) % 4], 1.62)]); TW.push([c0, c1]);
    return { h1, c0, c1, tb: rb.t };
  };
  const pA = panel('IBA', t, false);
  t = crGo('c2', pA.tb, -51.5, 0, 10.6);   // FCB 용접 동안 크레인이 비켜 서면 SPMT가 옆으로 들어옴
  let ts = veGo('sp', Math.max(t, last(SB.ve.sp)[0]), -69.5, -13.8, 0, VS.crab); crHold('c2', ts);
  cap(pA.h1, '절단 갠트리가 내저판에 맨홀 2개를 뚫습니다.'); cam(pA.h1 - 0.5, camFix([P2 - 19, -10, 7], [P2 - 11, 0, 1.6]));
  cap(pA.h1 + 4.6, '거치대의 평철 2개를 판 위 정해진 선에 세우고, 크레인이 붙잡은 채로 가접합니다(취부).'); cam(pA.h1 + 4.6, camHook('c2', [-13, -21, 11]));
  cap(pA.c0, '판넬이 컨베이어를 타고 FCB 용접기 아래를 지나며 평철이 판에 용접됩니다(인양 러그도 함께).'); cam(pA.c0, camFix([P2 - 4, -12, 8], [WX, 0, 1.6]));
  SB.upd.push(tt => { const g = O.nodes.P02_gantry; if (g) g.position.x = g.userData.s0.pos.x + (kfEval(GK, tt)[0] - (P2 - 7)); });
  SB.upd.push(tt => { const g = O.nodes.P02_wtorch; if (!g) return; let d = 0; TW.forEach(([a, b]) => { d = Math.max(d, clamp01(Math.min(tt - (a + 0.2), b - 0.2 - tt) / 0.8)); }); g.position.y = g.userData.s0.pos.y + 0.7 * (1 - ease(d)); });
  // SPMT에 싣기: 줄마다 아래 짐의 실제 윗면 위에. 세트 8개 = 판넬 2 + 측판 2 + 거더 묶음 + 늑판 묶음 + 바닥판 2
  const ROW = { A: V(-2.9, 1.7, 0), B: V(-2.9, -1.7, 0), F: V(6.2, 0, 0) }, rowTop = { A: 2.09 + 0.12, B: 2.09 + 0.12, F: 2.09 + 0.12 };
  SB.spLocal = {}; const loadT = [];
  const toSP = (keys, row, t, o = {}) => { const lead = keys[keys.length - 1], s2 = stackAt(keys, t, ROW[row].x, ROW[row].y, rowTop[row], flat(lead)); rowTop[row] = s2.top;
    const r2 = keys.length > 1 ? liftSet('c2', keys, { v: 'sp', lp: s2.lp, lq: s2.lq }, t, { zT: 11.5, ...o }) : lift('c2', lead, poseAt(lead, t), { v: 'sp', lp: s2.lp, lq: s2.lq }, t, { zT: 11.5, ...o });
    keys.forEach(k => { const e = SB.ob[k].filter(x => x.m === 'v' && x.v === 'sp').pop(); SB.spLocal[k] = e.lp; }); loadT.push(r2.tRel); return r2; };
  t = Math.max(pA.c1 + 0.3, ts + 0.2); cap(t, '완성된 판넬을 크레인으로 SPMT 받침목 위에 싣습니다.'); cam(t, camHook('c2', [-17, -26, 14]));
  r = toSP(['IBA'], 'A', t); t = r.t;
  cap(t, '두 번째 내저판도 같은 순서로 판넬을 만듭니다(빠르게).'); cam(t, camFix([P2 + 6, -26, 14], [P2 - 4, 2, 1.6]));
  r = lift('c2', 'IBB0', poseAt('IBB0', t), { p: ENT.clone(), q: qI }, t, { zT: 11.5, f: 2 });
  const pB = panel('IBB', r.t, true); t = Math.max(pB.c1 + 0.3, last(SB.cr.c2)[0]);
  r = toSP(['IBB'], 'B', t, { f: 2 }); t = r.t;
  cap(t, '대기 구역의 부재를 세트로 SPMT에 싣습니다: 측판 2 · 거더 3장 묶음 · 늑판 6장 묶음 · 바닥판 2(시간 압축).'); cam(t, camFix([P2 + 26, -40, 26], [P2, 0, 2]));
  [[['SSP'], 'A'], [['SSS'], 'B'], [['GD3', 'GD2', 'GD1'], 'A'], [FLS, 'F'], [['BPA'], 'A'], [['BPB'], 'B']].forEach(([ks, row]) => { r = toSP(ks, row, t, { f: 2.2 }); t = r.t; });
  SB.cnt.w2 = tt => `세트 ${loadT.filter(x => x <= tt).length} / ${q[1]} set` + (tt < pB.c1 ? ' · 판넬 제작 중' : '');
  t = crGo('c2', last(SB.cr.c2)[0], -51.5, 0, 10.6); phase('w2', T3s, t + 0.3); t += 0.3;

  // ===== 02 → 03: 옆으로 → 도로 → 제자리 90° 회전 → 공장 안으로 =====
  const T4 = t, SPX3 = -28.5, SPY3 = -1.25; cam(t, camVe('sp', [-18, -28, 17])); cap(t, 'SPMT가 세트 8개(부재 15장)를 싣고 블록 조립 공장(03)으로 갑니다.');
  t = veGo('sp', t, -69.5, -31, 0, VS.crab); t = veGo('sp', t, SPX3, -31, 0, VS.drive);
  cap(t, '공장 앞에서 제자리 회전한 뒤 공장 안으로 들어갑니다.'); t = veGo('sp', t, SPX3, -31, R90, VS.drive); t = veGo('sp', t, SPX3, SPY3, R90, VS.drive * 0.6);
  phase('m23', T4, t + 0.3); t += 0.3;

  // ===== 03 블록 조립·용접: 천장 크레인이 부재를 하나씩 들어 받침(정반) 위에 조립, 놓을 때마다 이음매 용접 =====
  const T5 = t, BO = V(-18, -6, 1.4 + 1.7);
  cam(t, camFix([-9, -16, 11], [-23, -3, 3])); cap(t, '공장 안. 서쪽에 SPMT, 가운데에 블록 조립 받침(정반)이 있습니다.');
  t += 2; cam(t, camHook('c3', [8, -9, 6], 3));
  const order = ['BPA', 'BPB', 'GD1', 'GD2', 'GD3', 'FL1', 'FL2', 'FL3', 'FL4', 'FL5', 'FL6', 'SSP', 'SSS', 'IBA', 'IBB'];
  const NAME = { BP: '바닥판', GD: '거더', FL: '늑판', SS: '측판', IB: '내저판' }, weldT = [];
  order.forEach((k, i) => {
    const o3 = O.ob[k], w = { p: BO.clone().add(o3.userData.local), q: qI }, ty = k.slice(0, 2), up = ty === 'GD' || ty === 'FL' || ty === 'SS';
    const first = i === 0 || i === 2 || i === 5 || i === 11 || i === 13;
    if (first) cap(t, up ? `${NAME[ty]}을(를) SPMT에서 들어 공중에서 세운 뒤(턴오버) 자리에 내립니다. 크레인이 붙잡고 있는 동안 아래쪽을 가접하고, 고정된 뒤에 줄을 풀고 본용접합니다.` : `${NAME[ty]}을(를) SPMT에서 들어 블록 자리에 내려놓고 이음매를 용접합니다.`);
    if (i === 5) cam(t, camFix([-9, -17, 9], [-18, -6, 3]));
    if (i === 6) cap(t, '나머지 늑판 5장도 같은 순서로 세웁니다(시간 압축).');
    if (i === 11) cam(t, camHook('c3', [8, -9, 6], 3));
    r = lift('c3', k, vW('sp', t, SB.spLocal[k], flat(k)), w, t, { zT: up ? 12.0 : 9.5, f: first ? 1 : 2.6, hold: up ? (first ? 1.8 : 0.8) : 0 });
    const w0 = r.tRel + 0.1, w1 = w0 + (first ? 1.2 : 0.6), half = ty === 'FL' ? 2.4 : 6.0, base = w.p.clone();
    base.z = ty === 'IB' ? BO.z + 1.7 : BO.z - 1.62;
    if (up) { const a0 = r.tSet + 0.1, a1 = r.tRel - 0.05; SB.fx.push([a0, a1, tt => { const u = [-0.9, 0.9, 0][Math.min(2, Math.floor((tt - a0) / (a1 - a0) * 3))]; return ty === 'FL' ? V(base.x, base.y + u * half, base.z) : V(base.x + u * half, base.y, base.z); }]); }
    SB.fx.push([w0, w1, tt => { const u = (tt - w0) / (w1 - w0) * 2 - 1; return ty === 'FL' ? V(base.x, base.y + u * half, base.z) : V(base.x + u * half, base.y, base.z); }]);
    weldT.push([w0, w1]); t = Math.max(r.tRel + 0.2, w1 - 0.3);
  });
  SB.cnt.w3 = tt => { let d = 0; weldT.forEach(([a, b]) => d += clamp01((tt - a) / (b - a))); return `용접 ${(q[2] * d / weldT.length).toFixed(1)} / ${q[2]} m · 모형 판 ${weldT.filter(x => x[0] <= tt).length} / 15장`; };
  const tDone = Math.max(t, last(SB.cr.c3)[0]) + 0.3; cap(tDone, `블록 ${SIM.block} 완성(세트 8개 = 부재 15장). 크레인이 블록째 들어 SPMT에 싣습니다.`);
  order.forEach(k => ob(k, { t: tDone, m: 'o', parent: 'blk', lp: O.ob[k].userData.local, lq: qI }));
  ob('blk', { t: tDone, m: 'w', p: BO.clone(), q: qI }); cam(tDone, camHook('c3', [8, -9, 6], 3));
  r = lift('c3', 'blk', { p: BO.clone(), q: qI }, { v: 'sp', lp: V(0, 0, 2.21 + 1.7), lq: qI }, tDone + 0.3, { zT: 13.0 });
  t = crGo('c3', r.t, 5, -21, 13.0); phase('w3', T5, t + 0.3); t += 0.3;

  // ===== 03 → 04 =====
  const T6 = t; cam(t, camVe('sp', [-18, -28, 17])); cap(t, 'SPMT가 공장에서 후진해 나와 검사장(04)으로 갑니다.');
  t = veGo('sp', t, SPX3, -31, R90, VS.drive * 0.6); t = veGo('sp', t, SPX3, -31, 0, VS.drive); t = veGo('sp', t, 21, -31, 0, VS.drive); t = veGo('sp', t, 21, 0, 0, VS.crab);
  phase('m34', T6, t + 0.3); t += 0.3;

  // ===== 04 치수·용접 검사 =====
  const T7 = t, TS = V(6.7, -6.5, 1.95), UC = V(6.5, 6.0, 1.2);
  cam(t, camFix([9, -21, 12], [23, 0, 3.5])); cap(t, '토털스테이션(레이저)으로 블록 치수 6곳을, 초음파 탐상기로 용접부 4곳을 확인합니다.');
  const VAL = [['D1 길이(좌현)', '12,500', '12,502'], ['D2 길이(우현)', '12,500', '12,499'], ['D3 폭(선미)', '5,200', '5,201'], ['D4 폭(선수)', '5,200', '5,198'], ['D5 높이(중앙)', '3,400', '3,401'], ['D6 대각선', '13,538', '13,541'],
    ['W1 측판-바닥판 이음'], ['W2 측판-바닥판 이음'], ['W3 측판-바닥판 이음'], ['W4 측판-바닥판 이음']];
  const iT = []; t += 2; for (let i = 0; i < 10; i++) { iT.push(t); t += i < 6 ? 1.7 : 2.1; }
  SB.insp = { iT, end: t, TS, UC };
  iT.forEach((x, i) => cap(x, i < 6 ? `${VAL[i][0]}: 기준 ${VAL[i][1]} mm · 측정 ${VAL[i][2]} mm → 합격(허용 ±3 mm, 시연용 가상값)` : `${VAL[i][0]}: 초음파 탐상 → 결함 없음, 합격`));
  cam(iT[0], camObj('blk', [-13, -15, 9])); cam(iT[6], camObj('blk', [-5, 12, 5]));
  SB.cnt.w4 = tt => `합격 ${iT.filter(x => x + 1.2 <= tt).length} / ${q[3]} point`;
  t += 0.5; phase('w4', T7, t);

  // ===== 04 → 05 =====
  const T8 = t; cam(t, camVe('sp', [-18, -28, 17])); cap(t, 'SPMT가 도장 공장(05)으로 갑니다.');
  t = veGo('sp', t, 21, -31, 0, VS.crab); t = veGo('sp', t, 66, -31, 0, VS.drive); t = veGo('sp', t, 66, -31, R90, VS.drive); t = veGo('sp', t, 66, 1.75, R90, VS.drive * 0.6);
  phase('m45', T8, t + 0.3); t += 0.3;

  // ===== 05 표면처리·도장 =====
  const T9 = t, BC = V(66, 1.75, 2.21 + 1.7 + veZ('sp', 66, 1.75, R90)), b0 = t + 2, b1 = b0 + 7, p0 = b1 + 0.6, p1 = p0 + 8;
  cam(t, camFix([76, -13, 9], [66, 1.5, 3.5])); cap(t, '표면처리: 고소작업대의 노즐로 연마재를 쏘아 녹과 프라이머를 벗깁니다(블라스팅).');
  cap(p0, '도장: 같은 순서로 도료를 뿌립니다. 노즐이 지나간 자리만 색이 바뀝니다.'); cam(p0, camFix([75, 9, 8], [66, 1.5, 3.5]));
  SB.paint = { BC, b0, b1, p0, p1 };
  SB.cnt.w5 = tt => `${tt < b1 ? `블라스팅 ${Math.round(100 * clamp01((tt - b0) / (b1 - b0)))}%` : '블라스팅 완료'} · 도장 ${Math.round(q[4] * clamp01((tt - p0) / (p1 - p0)))} / ${q[4]} m²`;
  t = p1 + 1; phase('w5', T9, t);

  // ===== 06 블록 이송: 후진 → 회전 → 도로 → 회전 → P04·P05 사이 통로로 북쪽 =====
  const T10 = t; cam(t, camVe('sp', [-20, -30, 19])); cap(t, 'SPMT가 완성된 블록을 싣고 도크 옆 골리앗 크레인 아래로 갑니다.');
  t = veGo('sp', t, 66, -31, R90, VS.drive * 0.6); t = veGo('sp', t, 66, -31, 0, VS.drive); t = veGo('sp', t, 46, -31, 0, VS.drive); t = veGo('sp', t, 46, -31, R90, VS.drive);
  const tArr = veGo('sp', t, 46, 13, R90, VS.drive * 0.7); t = tArr;
  SB.cnt.m56 = tt => `이송 ${tt >= tArr ? 1 : 0} / ${q[5]} block`;
  phase('m56', T10, t + 0.3); t += 0.3;

  // ===== 탑재: 훅 내림 → 줄걸이 4줄 → 시험 인양 → 인양 → 이동 → 정렬 → 내려놓기 → 줄 풀기 =====
  const T11 = t, LAND = V(46, 40.7, 0.25 + 1.7), qL = yaw(R90), CG = SIM_CR.cg;   // LAND: 도크 배의 맨 위 단 빈자리(twin3d/scene.py SHIP_X·SHIP_Y·SHIP_Z와 같은 값)
  cam(t, camFix([20, -8, 40], [46, 28, 8])); cap(t, '골리앗 크레인(600 t) 트롤리가 블록 위로 와서 훅을 내립니다.');
  const fromE = vW('sp', t, V(0, 0, 2.21 + 1.7)), trE = fromE.p.y, zHook = fromE.p.z + topOff(O.blk, fromE.q) + CG.sling + CG.gap;
  t = crGo('cg', t, 0, trE, 30.0); t = crGo('cg', t, 0, trE, zHook);
  ob('blk', { t, m: 'h', c: 'cg', q0: fromE.q, q1: qL, ta: t, tb: t + 1 }); cap(t, '블록 위 인양 러그 4곳에 줄걸이를 겁니다.'); cam(t, camObj('blk', [-12, -10, 8]));
  t += 1.6; crHold('cg', t); cap(t, '시험 인양: 30 cm만 들어 균형을 확인합니다.'); t = crGo('cg', t, 0, trE, zHook + 0.3); t += 1.2; crHold('cg', t);
  const zTr = 16.5 + 1.7 + topOff(O.blk, qL) + CG.sling + CG.gap;   // 블록 밑면 16.5 m로 이동(골리앗 다리 사이 아래 가로보·점검 통로 난간(15.6 m) 위로 넘김)
  cap(t, '본 인양 후 도크 위로 옮깁니다.'); cam(t, camHook('cg', [-26, -16, 4], 6));
  t = crGo('cg', t, 0, trE, zTr); t = crGo('cg', t, 0, LAND.y, zTr);
  const zLand = LAND.z + topOff(O.blk, qL) + CG.sling + CG.gap;
  cap(t, '탑재 위치(파란 선: 맨 위 단의 빈자리, 옆 블록과 같은 크기)에 맞춰 천천히 내립니다.'); cam(t, camFix([30, 26.7, 13], [46, 40.7, 1]));
  SB.target = { from: t, p: LAND.clone() };
  t = crGo('cg', t, 0, LAND.y, zLand + 1.5); t += 0.6; crHold('cg', t); SB.cr.cg.push([t + 2.6, 0, LAND.y, zLand]); t += 2.6;
  ob('blk', { t, m: 'w', p: LAND.clone(), q: qL }); SB.target.to = t;
  cap(t, '안착 확인 후 줄걸이를 풉니다. 이어서 맞댄 이음매를 용접하면 블록이 선체의 일부가 됩니다.'); cam(t + 1.2, camFix([84, 6, 30], [40, 46, -2])); t += 1;   // 마지막: 뒤로 빠져 같은 블록이 쌓여 가는 배 전체 crHold('cg', t); t = crGo('cg', t, 0, LAND.y, 30.0);
  SB.cnt.er = tt => tt >= SB.target.to ? `탑재 완료 · ${q[5]} / ${q[5]} block` : '탑재 중';
  phase('er', T11, t + 1.5);
  // 단계 길이 반영
  SB.ph.forEach(([k, a, b]) => { SIM_PH.find(x => x[0] === k)[1] = +(b - a).toFixed(2); });
  SIM_TOTAL = SIM_PH.reduce((a, p) => a + p[1], 0);
  SB.cam.sort((a, b) => a[0] - b[0]); SB.cap.sort((a, b) => a[0] - b[0]);
}


// ---------- 시간 t의 상태 계산 ----------
function simObPose(key, t) {
  const T = T3.THREE, ev = SB.ob[key]; if (!ev) return null; let e = ev[0]; for (const x of ev) { if (x.t <= t) e = x; else break; }
  if (e.m === 'x') return null;
  if (e.m === 'w') return { p: e.p, q: e.q };
  if (e.m === 'f') return e.fn(t);
  if (e.m === 'v') { const [x, y, h] = kfEval(SB.ve[e.v], t), c = Math.cos(h), s = Math.sin(h);
    return { p: new T.Vector3(x + e.lp.x * c - e.lp.y * s, y + e.lp.x * s + e.lp.y * c, e.lp.z + veZ(e.v, x, y, h)), q: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), h).multiply(e.lq) }; }
  if (e.m === 'o') { const pp = simObPose(e.parent, t); if (!pp) return null; return { p: e.lp.clone().applyQuaternion(pp.q).add(pp.p), q: pp.q.clone().multiply(e.lq) }; }
  if (e.m === 'h') { const C = SIM_CR[e.c], u = e.tb > e.ta ? clamp01((t - e.ta) / (e.tb - e.ta)) : 0;
    if (!e.qm) { const d = e.q1.clone().multiply(e.q0.clone().invert()), tw = new T.Quaternion(0, 0, d.z, d.w);   // 돌리기 = 수직축 회전(먼저) + 수평축 턴오버(나중)
      if (tw.lengthSq() < 1e-9) tw.identity(); else tw.normalize(); e.qm = tw.multiply(e.q0); }
    const q = u < 0.4 ? e.q0.clone().slerp(e.qm, ease(u / 0.4)) : e.qm.clone().slerp(e.q1, ease((u - 0.4) / 0.6));
    return { p: crHookW(e.c, t).add(new T.Vector3(0, 0, -(C.gap + C.sling + topOff(SIM.obj.ob[key], q)))), q, hook: e.c }; }
  return null;
}
function simApply(dt) {
  const T = T3.THREE, O = SIM.obj, t = SIM.t, { i: ph } = simPhaseAt(t), key = SIM_PH[ph][0], V = (x, y, z) => new T.Vector3(x, y, z);
  for (const k in SIM_CR) { const c = SIM_CR[k], [b, tr, z] = kfEval(SB.cr[k], t);   // 크레인
    if (c.bn) { const s0 = c.bn.userData.s0.pos; if (c.ax === 'x') c.bn.position.x = s0.x + (b - c.b0); else c.bn.position.z = s0.z - (b - c.b0); }
    if (c.tnn) { const s0 = c.tnn.userData.s0.pos; if (c.tax === 'x') c.tnn.position.x = s0.x + (tr - c.t0); else c.tnn.position.z = s0.z - (tr - c.t0); }
    if (c.hn) c.hn.position.y = c.hn.userData.s0.pos.y - (c.z0 - z);
    if (c.wn) c.wn.scale.y = (c.wl + c.z0 - z) / c.wl;
    O.sling[k].visible = false; }
  for (const k in SIM_VE) { const v = SIM_VE[k]; if (!v.n) continue; const [x, y, h] = kfEval(SB.ve[k], t); v.n.position.x = x; v.n.position.z = -y; v.n.position.y = v.n.userData.s0.pos.y + veZ(k, x, y, h); v.n.rotation.y = h;
    const S = SB.st[k]; let i = 0; while (i < S.length - 1 && S[i + 1][0] <= t) i++; const m1 = S[i][1], nx = S[i + 1], u = nx && nx[1] !== m1 && t > S[i][0] ? ease(clamp01((t - S[i][0]) / (nx[0] - S[i][0]))) : 0;
    const [lin, ang] = kfEval(SB.sd[k], t);
    v.bog.forEach(g => { const a0 = steerA(m1, g.x, g.y), a = nx && u > 0 ? a0 + (steerA(nx[1], g.x, g.y) - a0) * u : a0; g.b.rotation.y = a;
      if (g.w) g.w.rotation.z = -(lin + ang * Math.hypot(g.x, g.y)) / v.r; }); }   // 차량
  for (const k in SB.ob) { const o = O.ob[k], s = simObPose(k, t); if (!o) continue; o.visible = !!s; if (!s) continue;   // 물체
    o.position.copy(s.p); o.quaternion.copy(s.q);
    if (s.hook && SIM_CR[s.hook].sling > 0) {   // 줄걸이: 훅 아래끝 → 물체 윗면 네 모서리
      const C = SIM_CR[s.hook], hb = crHookW(s.hook, t).add(V(0, 0, -C.gap)), cs = o.userData.lugs ? [0, 1, 2, 3].map(j => o.userData.lugs[j % o.userData.lugs.length].clone().applyQuaternion(s.q).add(s.p)) : o.userData.cor.map(c => c.clone().applyQuaternion(s.q).add(s.p)).sort((a, b) => b.z - a.z).slice(0, 4);
      const a = O.sling[s.hook].geometry.attributes.position; cs.forEach((c, j) => { a.setXYZ(j * 2, hb.x, hb.y, hb.z); a.setXYZ(j * 2 + 1, c.x, c.y, c.z); }); a.needsUpdate = true; O.sling[s.hook].visible = true; } }
  SB.upd.forEach(f => f(t));
  // 검사: 레이저(치수 6곳) · 초음파 탐촉자(용접 4곳)
  const I = SB.insp; O.laser.visible = O.probe.visible = O.probeCable.visible = false;
  O.marks.forEach((m, i) => { m.visible = key === 'w4'; const ok = t >= I.iT[i] + 1.2; m.material.color.setHex(ok ? 0x22c55e : t >= I.iT[i] ? 0xf5b041 : 0x9ca3af); m.material.emissive.setHex(ok ? 0x0b5d2b : 0); });
  if (key === 'w4') { O.blk.updateMatrixWorld(true); const cur = I.iT.findIndex((x, i) => t >= x && t < (I.iT[i + 1] ?? I.end));
    if (cur >= 0) { const wp = O.marks[cur].getWorldPosition(V(0, 0, 0));
      if (cur < 6) { const a = O.laser.geometry.attributes.position; a.setXYZ(0, I.TS.x + 0.2, I.TS.y, I.TS.z); a.setXYZ(1, wp.x, wp.y, wp.z); a.needsUpdate = true; O.laser.visible = t < I.iT[cur] + 1.2; }
      else { O.probe.visible = O.probeCable.visible = true; O.probe.position.lerpVectors(I.UC, wp.clone().add(V(0, 0.3, 0.1)), ease(clamp01((t - I.iT[cur]) / 0.8))); O.probe.rotation.x = Math.PI / 2;
        const a = O.probeCable.geometry.attributes.position; a.setXYZ(0, I.UC.x, I.UC.y, I.UC.z); a.setXYZ(1, O.probe.position.x, O.probe.position.y, O.probe.position.z); a.needsUpdate = true; } } }
  // 도장: 블록 길이 방향 진행선(블라스팅 → 도장), 고소작업대 노즐
  const Pn = SB.paint, U = O.paintU, Lh = 6.4; U.uO.value.copy(Pn.BC); U.uD.value.set(0, 1, 0);
  const front = (a, b) => t < a ? -1e9 : t > b ? 1e9 : -Lh + 2 * Lh * clamp01((t - a) / (b - a));
  U.uB.value = front(Pn.b0, Pn.b1); U.uP.value = front(Pn.p0, Pn.p1);
  O.lift.visible = key === 'w5';
  if (O.lift.visible) { const blast = t < Pn.b1 + 0.3, a = blast ? Pn.b0 : Pn.p0, b = blast ? Pn.b1 : Pn.p1, u = clamp01((t - a) / (b - a)), zz = Pn.BC.z + 1.4 * Math.sin(u * Math.PI * 9);
    O.lift.position.set(Pn.BC.x + 5.2, Pn.BC.y - Lh + 2 * Lh * u, 0.3); O.basket.position.set(-0.6, 0, zz - 0.6); O.boom.position.set(-0.3, 0, (zz - 0.6) / 2 + 0.6); O.boom.scale.z = Math.max(0.5, zz - 0.6);
    O.mist.visible = t > a && t < b; O.mist.material.color.setHex(blast ? 0x9a8170 : 0xb9c7d4); }
  O.target.visible = key === 'er' && t >= SB.target.from && t < SB.target.to + 1.5; if (O.target.visible) O.target.position.copy(SB.target.p);   // 탑재 위치 표시
  const fx = SB.fx.find(([a, b]) => t >= a && t < b);   // 용접·절단 불꽃
  O.sparkM.visible = !!fx; if (fx) { const p = fx[2](t); O.spark.position.copy(p).add(V(0, 0, 0.4)); O.sparkM.position.copy(p); O.spark.intensity = 120 + Math.random() * 380; O.sparkM.scale.setScalar(0.7 + Math.random() * 0.8); } else O.spark.intensity = 0;
  // 카메라(공정마다 전경 → 작업 → 근접)
  const ck = SB.cam.filter(c => c[0] <= t).pop() || SB.cam[0], [tgt, pos] = ck[1](t), k = 1 - Math.exp(-dt * 2.0);
  SIM.camT = SIM.camT ? SIM.camT.lerp(tgt, k) : tgt.clone(); SIM.camP = SIM.camP ? SIM.camP.lerp(pos, k) : pos.clone();
  T3.cam.position.copy(SIM.camP); T3.ctl.target.copy(SIM.camT); T3.cam.lookAt(SIM.camT);
  // 자막·수량
  const c = SB.cap.filter(x => x[0] <= t).pop(), cnt = SB.cnt[key] ? SB.cnt[key](t) : '';
  const set = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== v) e.textContent = v; };
  set('simT', SIM_PH[ph][3]); set('simD', (c && c[1]) || SIM_PH[ph][4]); set('simQ', cnt);
  const bar = document.getElementById('simBar'); if (bar) bar.style.width = `${t / SIM_TOTAL * 100}%`;
  if (ph !== SIM.phase) { SIM.phase = ph; render(); }
}
function simStart() { if (!T3.ready) return; simBuild(); SIM.block = simBlockId(); simPlan();
  const O = SIM.obj; if (O.stencilFor !== SIM.block) { O.stencil.children.filter(c => c.geometry && c.geometry.type === 'PlaneGeometry').forEach(c => O.stencil.remove(c));
    const st = stencilMesh(T3.THREE, SIM.block, 3.0); st.position.set(-12.5 * .2, -0.06, 0); O.stencil.add(st); O.stencilFor = SIM.block; }
  SIM.on = true; SIM.play = true; SIM.t = 0; SIM.phase = -1; SIM.camT = SIM.camP = null; if (SIM.vid) SIM.play = false;
  T3.ctl.enabled = false; for (const n of SIM_HIDE) if (O.nodes[n]) O.nodes[n].visible = false; T3.dirty = true; render(); }
function simStop(quiet) { if (SIMV) { SIMV.querySelector('video').pause(); delete SIMV.dataset.started; } if (!SIM.on) return; SIM.on = false; SIM.play = false; const O = SIM.obj;
  for (const k in O.ob) O.ob[k].visible = false; [O.laser, O.probe, O.probeCable, O.lift, O.target, O.sparkM].forEach(o => o.visible = false); for (const k in O.sling) O.sling[k].visible = false; O.spark.intensity = 0;
  O.paintU.uB.value = O.paintU.uP.value = -1e9;
  T3.scene.traverse(o => { const s = o.userData.s0; if (s) { o.position.copy(s.pos); o.rotation.copy(s.rot); o.scale.copy(s.sc); o.visible = s.vis; } });
  for (const k in T3.anim) { const a = T3.anim[k]; if (a && a.userData.p0) a.position.copy(a.userData.p0); }
  T3.ctl.enabled = true; T3.ctl.update(); T3.dirty = true; if (!quiet) render(); }
function simStep() { return SIM_PH[simPhaseAt(SIM.t).i][2]; }
function simSide() {   // 오른쪽 패널: 시뮬레이션 블록의 공정별 수량과 재생 조작
  const st = simStep(), q = simQty(), end = SIM.t >= SIM_TOTAL;
  return `<aside class="txside"><div class="txsec">시뮬레이션 블록 · ${SIM.block}</div>
    <div class="txkv">${SIM_STEPS.map((s, k) => { const w = bkWos(SIM.block)[k]; return `<span>${s}</span><b class="${k < st || end ? 'done' : k === st ? 'on' : ''}">${k < st || end ? '✓ ' : k === st ? '● ' : ''}${q[k]} ${BK_UNIT_NAME[w?.unit] || ''}</b>`; }).join('')}</div>
    <div class="txsec">재생</div>
    <div class="txctl simmode"><button class="txb" data-act="simMode" data-arg="vid">16배속 영상 · 약 ${Math.round(SIM_TOTAL / SIM_VX)}초</button><button class="txb fill w" data-act="simMode" data-arg="full">3D 직접 재생 · 약 ${Math.round(SIM_TOTAL / 60)}분</button></div>
    <div class="txctl"><button class="txb fill w" data-act="simPlay">${SIM.play ? '⏸ 일시정지' : end ? '↺ 다시 보기' : '▶ 계속'}</button><button class="txb" data-act="simNext" title="다음 단계로">다음 단계 ⏭</button>
      <select data-sim="speed">${[1, 2, 4].map(v => `<option value="${v}" ${SIM.speed === v ? 'selected' : ''}>${v}x</option>`).join('')}</select></div>
    <div class="txsec">이 재생은</div>
    <p class="txnote">블록 하나가 공정을 거쳐 배에 올라가는 <b>정상 흐름</b>을 보여 주는 시연용 재생입니다. 공중의 물체는 모두 크레인 훅에 걸려 있고, 02에서 만든 세트 8개(시연 모형 판 15장)가 그대로 03 블록이 됩니다. 실제 부재 수는 블록 내부 3D에 있습니다. 수량은 엑셀 데이터(블록 ${SIM.block})의 계획 수량, 검사 측정값은 시연용 가상값입니다. 실제 서버 데이터는 바꾸지 않습니다.</p>
    <p class="txnote">3D 직접 재생은 약 ${Math.round(SIM_TOTAL / 60)}분이며 배속(2x·4x)으로 줄일 수 있습니다. 30초 안에 전체를 보려면 [16배속 영상]을 누릅니다. 왼쪽 위 단계 이름을 누르면 그 단계로 이동합니다.</p></aside>`;
}
// ---------- 16배속 녹화 영상 ----------
// 전체 재생(약 7분 30초)을 16배속으로 녹화한 영상. 영상 요소는 한 번만 만들어 두고 화면을 다시 그려도 재생 위치가 유지되게 옮겨 붙인다
let SIMV = null;
function simVidEl() {
  if (SIMV) return SIMV.querySelector('video');
  SIMV = document.createElement('div'); SIMV.className = 'simvid';
  SIMV.innerHTML = `<video muted playsinline preload="auto"><source src="${SIM_VIDEO}.webm" type="video/webm"><source src="${SIM_VIDEO}.mp4" type="video/mp4"></video><div class="simvbar"><button class="txb fill w" data-act="simVidPlay">⏸ 일시정지</button>
    <span class="simvrate">${[[1, '16배속'], [2, '32배속']].map(([r, l]) => `<button class="txb" data-act="simVidRate" data-arg="${r}">${l}</button>`).join('')}</span>
    <span class="simvchips">${SIM_STEPS.map((s, k) => `<button data-act="simVidJump" data-arg="${k}">${s}</button>`).join('')}</span><i class="simvprog"><em></em></i><span class="simvtime"></span>
    <button class="txb" data-act="simMode" data-arg="full">3D 직접 재생 ›</button></div><div class="simverr">녹화 영상(${SIM_VIDEO}.webm / .mp4)을 찾지 못했습니다. index.html 옆 media 폴더에 있어야 합니다. [3D 직접 재생]으로 보세요.</div>`;
  const v = SIMV.querySelector('video');
  const sync = () => { const pb = SIMV.querySelector('.simvbar .txb'); pb.textContent = v.ended ? '↺ 다시 보기' : v.paused ? '▶ 재생' : '⏸ 일시정지';
    SIMV.querySelectorAll('.simvrate button').forEach(b => b.classList.toggle('fill', +b.dataset.arg === SIM.rate)); SIMV.querySelectorAll('.simvrate button').forEach(b => b.classList.toggle('w', +b.dataset.arg === SIM.rate));
    const d = v.duration || SIM_TOTAL / SIM_VX, sim = v.currentTime * SIM_VX, st = SIM_PH[simPhaseAt(Math.min(sim, SIM_TOTAL - 0.01)).i][2];
    SIMV.querySelector('.simvprog em').style.width = `${Math.min(100, v.currentTime / d * 100)}%`;
    SIMV.querySelectorAll('.simvchips button').forEach((b, k) => { b.className = k < st ? 'done' : k === st ? 'on' : ''; });
    SIMV.querySelector('.simvtime').textContent = `${Math.floor(v.currentTime)}초 / ${Math.round(d)}초 · 실제 ${Math.floor(sim / 60)}분 ${String(Math.floor(sim % 60)).padStart(2, '0')}초`; };
  ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'ratechange'].forEach(e => v.addEventListener(e, sync));
  v.querySelector('source:last-child').addEventListener('error', () => SIMV.classList.add('err'));   // 두 형식 모두 실패할 때만 안내
  v.playbackRate = SIM.rate; return v;
}
function simVidMount() {   // 화면을 다시 그린 뒤 영상 자리에 같은 영상 요소를 옮겨 붙임
  const host = document.getElementById('simvidhost'); if (!host) { if (SIMV && SIMV.isConnected && !(SIM.on && SIM.vid)) { SIMV.querySelector('video').pause(); SIMV.remove(); } return; }
  const v = simVidEl(); host.replaceWith(SIMV); v.playbackRate = SIM.rate; if (!SIMV.dataset.started) { SIMV.dataset.started = '1'; v.currentTime = 0; v.play().catch(() => {}); }
}
Object.assign(ACT, {
  simStart() { simStart(); },
  simEnd() { if (SIMV) { SIMV.querySelector('video').pause(); delete SIMV.dataset.started; } simStop(); },
  simVidJump(k) { const v = simVidEl(); let a = 0; for (const p of SIM_PH) { if (p[2] === +k) break; a += p[1]; } v.currentTime = a / SIM_VX; if (v.paused) v.play().catch(() => {}); },
  simPlay() { if (SIM.t >= SIM_TOTAL) { SIM.t = 0; SIM.camT = SIM.camP = null; } SIM.play = !SIM.play; render(); },
  simMode(m) { SIM.vid = m === 'vid'; SIM.t = 0; SIM.phase = -1; SIM.camT = SIM.camP = null; SIM.play = !SIM.vid; if (SIM.vid) { const v = simVidEl(); v.currentTime = 0; v.play().catch(() => {}); } else simVidEl().pause(); T3.dirty = true; render(); },
  simVidRate(r) { SIM.rate = +r; simVidEl().playbackRate = SIM.rate; render(); },
  simVidPlay() { const v = simVidEl(); if (v.ended) v.currentTime = 0; if (v.paused) v.play().catch(() => {}); else v.pause(); render(); },
  simNext() { const { i } = simPhaseAt(SIM.t); const st = SIM_PH[i][2]; let a = 0; for (const p of SIM_PH) { if (p[2] > st) { SIM.t = a; break; } a += p[1]; } if (st >= 5) SIM.t = SIM_TOTAL - 0.01; SIM.camT = SIM.camP = null; T3.dirty = true; render(); },
  simJump(k) { let a = 0; for (const p of SIM_PH) { if (p[2] === +k) { SIM.t = a; break; } a += p[1]; } SIM.camT = SIM.camP = null; T3.dirty = true; render(); },
});
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.sim === 'speed') SIM.speed = +e.target.value; });
