// INC004 설명도 — B009 소조립·취부(WO009-02)가 취부 대상 부재 공급 대기로 멈춘 모습(P02 소조립장).
// 맞춘 기준(같은 모양·색): 블록 내부 3D(src/block3d.js bkBom·bkAt)와 3D 공장(twin3d/scene.py P02: 롤러 컨베이어 작업대·구동 모터·나무 받침, beacon).
//   - B009: 길이 14.75 m(11 + (52.5 − 30) / 6). 소조립 세트 8개 중 2개 완료(WO009-02 2 / 8 set)
//     S01 바닥 패널 A·S02 바닥 패널 B = 바닥판 2장 + 종보강재 8개씩(bkBom의 bot1·bot2), 소조립 완료라 강재 회색(3D와 같음)
//   - 다음 세트 S03 거더(거더 3장)는 부재가 들어오지 않아 EQ02 취부 작업대가 비어 있다. 들어와야 할 거더 3장은 파란 점선
//   - 컨베이어는 3D 공장의 판넬 라인과 같은 구성(남색 프레임·다리·강재 롤러 1.5 m 간격·파란 구동 모터·노란 덮개)이고 길이만 줄였다. 1단위 = 0.1 m
// 움직임: 올리거나 Enter → 위에 쌓인 S02 세트가 들려 S01·S02 두 세트가 따로 보인다.
// 실행: node figures/inc004/build.mjs [--audit]  →  inc004.html(미리보기), inc004.fragment.html(앱 조각)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { figure, k } from "../common.mjs";

const L = 14.75, L2 = L * 5;                 // B009 길이(0.1 m 단위 반길이)
const DONE = 2, PLAN = 8;
const PIECES = { s02: { move: [0, 0, 14] }, base: { move: [0, 0, 0] } };
const PLATE = { x: -84, y: -44, w: 168, d: 140, r: 4 };
const CV = { x0: -82, x1: 82, y: 33, top: 13 };   // 컨베이어: 레일 안쪽 면 y ±33, 레일 윗면 z 13
const SY = 50;                                    // 완료 세트 적치(앞쪽, y 50 ~ 89.6)
const F = figure({
  W: 760, H: 470, pieces: PIECES, stagger: ["s02", "base"], spring: { stagger: 0.1, stiffness: 64, damping: 15, substeps: 4 },
  fit: [...k.boxCorners(PLATE, -3, 0), [CV.x0, -36, 40], [CV.x1, 36, 40], [-L2, SY + 40, 36], [-63, -41, 82]],
});
const { as, box, disc, at, Dots, onTopG, onSide, ALONG, poly } = F;

const back = F.floor(PLATE, [-60, -40, -20, 0, 20, 40, 60], [-20, 0, 20, 40, 60, 80]);

// ---------- EQ02 취부 작업대(롤러 컨베이어) ----------
as("base", "eq02", () => {
  for (const s of [-1, 1]) {
    const y0 = s > 0 ? CV.y : -CV.y - 3;
    const name = s > 0 ? onSide([CV.x0 + 30, CV.y + 3], CV.top - 0.7, "left", `<text class="cv-name" x="0" y="2.2" font-size="2.4">EQ02 취부 작업대</text>`) : "";
    box(`cv.rail${s}`, { x: CV.x0, y: y0, w: CV.x1 - CV.x0, d: 3, r: 0.2 }, 9, CV.top, { className: "tw-navy" }, { steps: 2, bevel: 0.2, extra: name });
    for (let x = CV.x0 + 4; x <= CV.x1 - 4; x += 30) {
      box(`cv.leg${s},${x}`, { x: x - 1.25, y: y0 + 0.25, w: 2.5, d: 2.5, r: 0.2 }, 0.6, 9, { className: "tw-navy" }, { steps: 1 });
      box(`cv.foot${s},${x}`, { x: x - 2.5, y: y0 - 1, w: 5, d: 5, r: 0.3 }, 0, 0.6, { className: "tw-stl" }, { steps: 1 });
    }
  }
  for (let x = CV.x0 + 4; x <= CV.x1 - 4; x += 60) box(`cv.tie${x}`, { x: x - 0.75, y: -CV.y - 0.25, w: 1.5, d: 2 * CV.y + 0.5, r: 0.1 }, 4.5, 6, { className: "tw-navy" }, { steps: 1 });
  for (let x = CV.x0 + 6; x <= CV.x1 - 5; x += 15) {
    const Fr = ALONG(x, -CV.y, 12.4, [0, 1, 0]);
    disc(`cv.roller${x}`, Fr, 0, 2 * CV.y, 1.4, { className: "tw-stl" }, { extra: Dots([at([x, CV.y, 12.4])], { size: 0.3 }) });
  }
  // 구동 모터 3개(+y 레일 바깥) + 노란 체인 덮개
  for (const x of [-60, 0, 60]) {
    box(`cv.gear${x}`, { x: x - 2.5, y: CV.y + 3, w: 5, d: 4, r: 0.3 }, 7.5, 12.5, { className: "tw-blu" }, { steps: 2, bevel: 0.2 });
    disc(`cv.motor${x}`, ALONG(x, CV.y + 7, 10, [0, 1, 0]), 0, 6, 2.4, { className: "tw-blu" }, { extra: Dots([at([x, CV.y + 13, 10])], { size: 0.45 }) });
    box(`cv.guard${x}`, { x: x + 2.5, y: CV.y + 3, w: 11, d: 0.8, r: 0.2 }, 10, 13.4, { className: "tw-yel" }, { steps: 1 });
  }
});

// ---------- 완료 세트 S01·S02(나무 받침 위에 쌓음) ----------
const LSY = [8, 16, 24, 32];                      // 판넬 안 종보강재 위치(블록의 bot1·bot2와 같은 간격)
function panelSet(id, name, z) {
  for (const x of [-55, 0, 55]) box(`${id}.sleeper${x}`, { x: x - 3, y: SY + 1, w: 6, d: 37.6, r: 0.3 }, z, z + 4, { className: "tw-wood" }, { steps: 1 });
  for (let i = 0; i < 2; i++) {
    const y = SY + 20 * i;
    const extra = i === 1 ? onTopG([-L2 + 6, y + 15], z + 4.8, `<text class="set-sten" x="0" y="0" font-size="3.6">${id} ${name}</text>`) : "";
    box(`${id}.plate${i}`, { x: -L2, y, w: 2 * L2, d: 19.8, r: 0.3 }, z + 4, z + 4.8, { className: "tw-plate" }, { steps: 2, extra });
  }
  for (const ly of LSY) for (const [a, b] of [[-L2 + 0.5, -0.05], [0.05, L2 - 0.5]])
    box(`${id}.ls${ly}:${a.toFixed(0)}`, { x: a, y: SY + ly - 0.3, w: b - a, d: 0.6, r: 0.1 }, z + 4.8, z + 8, { className: "tw-plate" }, { steps: 1 });
}
as("base", "s01", () => panelSet("S01", "바닥 패널 A", 0));
as("s02", "s02", () => panelSet("S02", "바닥 패널 B", 8));

// ---------- 02 공정 경광등(3D beacon) ----------
as("base", "beacon", () => F.beacon("beacon", -63, -41));

// ---------- 들어와야 할 S03 거더 3장(점선, 작업대 위) ----------
const ghost = [];
for (let i = 0; i < 3; i++) { const z = 15 + i * 1.2, y0 = -12.7, y1 = 12.7; ghost.push(poly([[-L2, y0, z], [L2, y0, z], [L2, y1, z], [-L2, y1, z]])); }

F.finish({
  out: dirname(fileURLToPath(import.meta.url)), id: "inc004", back, ghost, eq: "hold",
  label: "INC004 설명도. P02 소조립장의 EQ02 취부 작업대(롤러 컨베이어)가 비어 있고, 그 위에 들어와야 할 B009 S03 거더 3장이 점선으로 표시돼 있다. 앞쪽 나무 받침 위에는 소조립을 마친 S01 바닥 패널 A와 S02 바닥 패널 B가 쌓여 있다. 왼쪽 뒤 02 공정 경광등은 주황(자재 대기)이다.",
  stageAria: "완료 세트 펼쳐 보기(Enter)",
  css: `.iso .cv-name{font-family:var(--anatomy-mono);font-weight:700;fill:#fff;letter-spacing:.04em}
.iso .eqx-ghost path{stroke-width:1.3px;opacity:.9;fill:rgba(62,99,221,.07)}
.iso .set-sten{font-family:var(--anatomy-mono);font-weight:700;fill:#3e4650;letter-spacing:.04em}`,
  data: {
    base: `${DONE} / ${PLAN} set · S03 거더 부재 입고 대기`,
    apart: `완료 세트 ${DONE}개(S01·S02) · 다음 S03 거더 부재 대기`,
    tags: {
      eq02: "EQ02 취부 작업대 · 비어 있음(S03 거더 3장 입고 대기)",
      s01: "S01 바닥 패널 A · 바닥판 2장 + 종보강재 8개 · 소조립 완료",
      s02: "S02 바닥 패널 B · 바닥판 2장 + 종보강재 8개 · 소조립 완료",
      beacon: "02 소조립·취부 경광등 · 자재 대기",
    },
    tagsOk: { eq02: "EQ02 취부 작업대 · 부재 입고, 취부 재개", beacon: "02 소조립·취부 경광등 · 가동" },
  },
  plate: {
    fig: "Fig 1", title: "INC004 · B009 소조립·취부", hint: "올리거나 Enter = 펼치기",
    keys: [
      { mark: "red", label: "02 공정 경광등(자재 대기 = 주황)" },
      { mark: "lit", label: "파란 점선: 들어와야 할 S03 거더 3장" },
      { mark: "raised", label: `소조립 완료 세트 ${DONE}개(S01·S02)` },
    ],
    caption: `B009 소조립·취부(WO009-02). 세트 8개 중 S01·S02 바닥 패널은 소조립을 마쳤고, 다음 세트인 S03 거더의 부재가 들어오지 않아 09:00부터 EQ02 취부 작업대가 비어 있습니다(자재 대기). 부재가 입고되면 S03부터 다시 시작합니다. 그림 위에 마우스를 올리면 쌓인 S02가 들려 두 세트가 따로 보입니다. 세트 구성은 블록 내부 3D, 작업대와 경광등은 3D 공장 모형과 같고, 컨베이어 길이만 줄여 그렸습니다.`,
  },
});
