// ---------- 평블록 디테일 공용(블록 제조 화면·공정 시뮬레이션): 구멍 뚫린 판(경감공·맨홀), 블록 번호 스텐실, 인양 러그 ----------
// size = [x, y, z] 판 치수(m). 가장 얇은 축이 판의 두께 방향. holes = [[u, v, 가로반지름, 세로반지름]] (판 중심 기준, 판 평면 좌표)
// notches = [[u, 폭, 깊이, 위(true)/아래(false)]]: 판 가장자리에서 파 들어간 슬롯(거더·늑판이 서로 끼워지는 자리)
function plateGeo(T, size, holes, notches) {
  if ((!holes || !holes.length) && (!notches || !notches.length)) return new T.BoxGeometry(...size);
  const ax = size.indexOf(Math.min(...size)), [a, b] = ax === 0 ? [1, 2] : ax === 1 ? [0, 2] : [0, 1];
  const w = size[a], h = size[b], t = size[ax], sh = new T.Shape(), N = notches || [];
  const bot = N.filter(n => !n[3]).sort((p, q) => p[0] - q[0]), top = N.filter(n => n[3]).sort((p, q) => q[0] - p[0]);
  sh.moveTo(-w / 2, -h / 2);
  for (const [u, nw, d] of bot) { sh.lineTo(u - nw / 2, -h / 2); sh.lineTo(u - nw / 2, -h / 2 + d); sh.lineTo(u + nw / 2, -h / 2 + d); sh.lineTo(u + nw / 2, -h / 2); }
  sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2);
  for (const [u, nw, d] of top) { sh.lineTo(u + nw / 2, h / 2); sh.lineTo(u + nw / 2, h / 2 - d); sh.lineTo(u - nw / 2, h / 2 - d); sh.lineTo(u - nw / 2, h / 2); }
  sh.lineTo(-w / 2, h / 2); sh.lineTo(-w / 2, -h / 2);
  for (const [u, v, rw, rh] of holes || []) { const p = new T.Path(); p.absellipse(u, v, rw, rh, 0, Math.PI * 2, true); sh.holes.push(p); }
  const g = new T.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 20 }); g.translate(0, 0, -t / 2);
  const M = new T.Matrix4();
  if (ax === 0) M.set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);        // 판 평면 (u,v) = (y,z), 두께 = x  (늑판)
  else if (ax === 1) M.set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);  // 판 평면 (u,v) = (x,z), 두께 = y  (거더·측판)
  g.applyMatrix4(M); return g;
}
function flatHoles(type, size, ctx) {   // 평블록 부재별 구멍: 늑판 = 거더 사이 경감공, 거더 = 늑판 사이 타원 경감공, 내저판 = 맨홀
  const H = size[2];
  if (type === 'FL') return ctx.bays.map(y => [y, 0, Math.min(.4, H * .17), Math.min(.4, H * .17)]);
  if (type === 'GD') return ctx.fx.slice(1).map((x, i) => [(x + ctx.fx[i]) / 2 - ctx.cx, 0, .45, Math.min(.32, H * .13)]);
  if (type === 'IB' && ctx.manhole) return [[-size[0] * .3, 0, .36, .24], [size[0] * .22, 0, .36, .24]];
  return null;
}
const STENCIL = {};
function stencilMesh(T, id, w = 2.8) {   // 외판에 칠한 흰 글자: 블록 번호 + TWIN PRO (투명 배경)
  if (!STENCIL[id]) { const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#f3f1ea'; g.textAlign = 'center'; g.font = 'bold 120px Arial, sans-serif'; g.fillText(id, 256, 120); g.font = 'bold 54px Arial, sans-serif'; g.fillText('TWIN PRO', 256, 200);
    const tx = new T.CanvasTexture(c); tx.colorSpace = T.SRGBColorSpace; STENCIL[id] = new T.MeshStandardMaterial({ map: tx, transparent: true, roughness: .7, depthWrite: false }); }
  const m = new T.Mesh(new T.PlaneGeometry(w, w / 2), STENCIL[id]); m.rotation.x = Math.PI / 2; m.renderOrder = 2; return m;   // 평면 법선 = -y(앞쪽)
}
function lugMesh(T, mat) { const m = new T.Mesh(new T.BoxGeometry(.3, .06, .36), mat); m.castShadow = true; return m; }
