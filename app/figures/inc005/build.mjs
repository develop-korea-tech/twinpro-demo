// INC005 설명도 — B007 치수·용접 검사 10곳 중 2곳 불합격, 보수 완료 후 재검사 대기(P04 검사장).
// 맞춘 기준(같은 모양·색): 블록 내부 3D(src/block3d.js bkBom·bkAt, 검사 표시 BK.marks)와 3D 공장(twin3d/scene.py P04: 토털스테이션 삼각대·초음파 탐상기 카트, welder_cart).
//   - B007: 길이 13.9 m · 폭 8 m · 높이 2.6 m, 받침대 위 z0 1.0 m. 부재가 모두 붙고 용접이 끝난 상태(프라이머 색)
//     바닥판 4 · 종보강재 16 · 거더 3 · 늑판 6(x −6.65 ~ +6.65 m) · 측판 2 · 내저판 4(맨홀은 3D처럼 1·3번째 판에 2개씩)
//   - 검사 위치 10곳: 3D와 같은 x(블록 길이를 5등분한 가운데), 1~5번은 뒤쪽 가장자리, 6~10번은 앞쪽 가장자리.
//     QC007: 8곳 합격, 9·10번 불합격 → RW001(EQ07)로 보수 완료(10:30~11:30), 재검사 판정 대기. 측판 리프팅 러그는 3D처럼 뒤쪽 측판 위
//   - 3D에서 검사 표시는 블록 옆 공중의 구슬이다. 그림에서는 같은 x 위치의 내저판 가장자리 위 원판으로 그렸다. 1단위 = 0.1 m
// 움직임: 올리거나 Enter → 내저판이 들려 내부 골조가 보인다(검사 표시는 내저판과 함께 움직임).
// 실행: node figures/inc005/build.mjs [--audit]  →  inc005.html(미리보기), inc005.fragment.html(앱 조각)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { figure, k } from "../common.mjs";

const L = 13.9, L2 = L * 5, B2 = 40, Z0 = 10;          // B007: L = 11 + (47.5 − 30) / 6
const FX = Array.from({ length: 6 }, (_, i) => (-L / 2 + 0.3 + (L - 0.6) * i / 5) * 10);
const PASSED = 8, FAILED = 2, CHECKED = 10;
const PIECES = { ib: { move: [0, 0, 26] }, base: { move: [0, 0, 0] } };
const PLATE = { x: -76, y: -47, w: 152, d: 126, r: 4 };
const F = figure({
  W: 760, H: 470, pieces: PIECES, stagger: ["ib", "base"], spring: { stagger: 0.12, stiffness: 64, damping: 15, substeps: 4 },
  fit: [...k.boxCorners(PLATE, -3, 0), ...k.boxCorners({ x: -L2, y: -B2 - 1, w: 2 * L2, d: 2 * B2 + 2 }, Z0, Z0 + 26.4 + 26)],
});
const { as, box, cable, disc, at, Dots, onTopG, onSide, UP, P } = F;

const back = F.floor(PLATE, [-60, -40, -20, 0, 20, 40, 60], [-40, -20, 0, 20, 40, 60]);
as("base", "stool", () => { for (const x of [-50, 0, 50]) for (const y of [-25, 25]) F.stool(x, y, Z0); });

const { BT, TOPZ } = F.crate({
  L2, B2, Z0,
  bp: { cls: "tw-pri", piece: "base", tag: "bp" }, ls: { cls: "tw-pri", piece: "base", tag: "ls" }, girder: { cls: "tw-pri", piece: "base", tag: "gd" },
  floors: FX.map((x, i) => ({ x, no: i + 1, cls: "tw-pri", piece: "base", tag: "fl" })),
});
const IBZ = TOPZ + 0.8;

// ---------- 측판 2(뒤 −y 측판 위에 리프팅 러그 3개) ----------
as("base", "ss", () => box("ss.front", { x: -L2, y: B2, w: 2 * L2, d: 0.8, r: 0.1 }, Z0, IBZ, { className: "tw-pri" }, { steps: 1,
  extra: onSide([-L2 + 8, B2 + 0.8], IBZ - 6, "left", `<text class="qc-sten" x="0" y="0" font-size="5">B007</text>`) }));
as("base", "ss", () => {
  box("ss.back", { x: -L2, y: -B2 - 0.8, w: 2 * L2, d: 0.8, r: 0.1 }, Z0, IBZ, { className: "tw-pri" }, { steps: 1 });
  for (const x of [-L2 / 1.5, 0, L2 / 1.5]) box(`lug${x.toFixed(0)}`, { x: x - 1.6, y: -B2 - 0.8, w: 3.2, d: 0.8, r: 0.1 }, IBZ, IBZ + 3.6, { className: "tw-yel" }, { steps: 1,
    extra: Dots([at([x, -B2, IBZ + 2.2])], { size: 0.7, tone: "hi" }) });
});

// ---------- 내저판 4(맨홀) + 검사 표시 10곳 ----------
const QX = Array.from({ length: 5 }, (_, i) => -L2 + 2 * L2 * (i + 0.5) / 5);
const mark = (n, x, y) => {
  const fail = n > CHECKED - FAILED;
  return onTopG([x, y], IBZ, `<g class="qc-mark" data-q="${fail ? "fail" : "pass"}"><circle r="3.6"/><text y="1.15" font-size="3.3" text-anchor="middle">${n}</text></g>`);
};
as("ib", "ib", () => {
  for (let i = 0; i < 4; i++) {
    const y = -B2 + 20 * i;
    let extra = i % 2 === 0 ? [-0.3 * 2 * L2, 0.22 * 2 * L2].map((x) => onTopG([x, y + 10], IBZ, `<ellipse class="eqx-hole" rx="3.6" ry="2.4"/>`)).join("") : "";
    if (i === 0) extra += QX.map((x, j) => mark(j + 1, x, y + 3.6)).join("");
    if (i === 3) extra += QX.map((x, j) => mark(j + 6, x, y + 16.4)).join("");
    box(`ib${i + 1}`, { x: -L2, y, w: 2 * L2, d: 20, r: 0.3 }, TOPZ, IBZ, { className: "tw-pri" }, { steps: 2, extra });
  }
});

// ---------- EQ04 검사 스테이션: 토털스테이션 삼각대 + 초음파 탐상기 카트, EQ07 보수용 용접기(보수 끝, 대기) ----------
const TS = [-52, 66];
as("base", "eq04", () => {
  box("ts.head.base", { x: TS[0] - 1.6, y: TS[1] - 1.6, w: 3.2, d: 3.2, r: 1.2 }, 12.6, 13.4, { className: "tw-dark" }, { steps: 3 });
  [0, 1, 2].forEach((a) => {
    const ang = a * 2 * Math.PI / 3 + 0.4;
    const foot = [TS[0] + 6.5 * Math.cos(ang), TS[1] + 6.5 * Math.sin(ang), 0.1], top = [TS[0] + 1.1 * Math.cos(ang), TS[1] + 1.1 * Math.sin(ang), 12.6];
    const d = [top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]], len = Math.hypot(...d);
    disc(`ts.leg${a}`, F.ALONG(...foot, d), 0, len, 0.35, { className: "tw-stl" });
  });
  box("ts.body", { x: TS[0] - 1.75, y: TS[1] - 1.5, w: 3.5, d: 3, r: 0.4 }, 13.4, 17.9, { className: "tw-yel" }, { steps: 3, bevel: 0.2,
    extra: onSide([TS[0] - 1.2, TS[1] + 1.5], 17.2, "left", `<rect class="eq-win" x="0" y="0" width="2.4" height="1.4" rx=".15"/>`) });
  disc("ts.lens", F.ALONG(TS[0] + 1.75, TS[1], 15.9, [1, 0, 0]), 0, 2.2, 0.8, { className: "tw-dark" }, { extra: Dots([at([TS[0] + 3.95, TS[1], 15.9])], { size: 0.45, tone: "hi" }) });
});
const UT = [-30, 66];
as("base", "eq04", () => {
  box("ut.cart", { x: UT[0] - 4.5, y: UT[1] - 2.75, w: 9, d: 5.5, r: 0.4 }, 2.2, 2.8, { className: "tw-stl" }, { steps: 2, bevel: 0.15 });
  for (const dx of [-3.5, 3.5]) for (const dy of [-2, 2]) {
    const Fw = F.ALONG(UT[0] + dx, UT[1] + dy - 0.25, 1.1, [0, 1, 0]);
    disc(`ut.wheel${dx},${dy}`, Fw, 0, 0.5, 1.1, { className: "tw-dark" });
  }
  box("ut.box", { x: UT[0] - 3, y: UT[1] - 2, w: 6, d: 4, r: 0.4 }, 2.8, 6.3, { className: "tw-blu" }, { steps: 3, bevel: 0.2,
    extra: onSide([UT[0] - 2.25, UT[1] + 2], 6.0, "left", `<rect class="qc-screen" x="0" y="0" width="4.5" height="2.6" rx=".2"/><path class="qc-trace" d="M.4 1.9L1.2 1.9L1.5 .6L1.8 2.1L2.2 1.2L2.6 1.9L4.1 1.9"/>`) });
  disc("ut.post", UP(UT[0] + 3.8, UT[1], 2.8), 0, 5.5, 0.45, { className: "tw-stl" });
  disc("ut.probe.holder", UP(UT[0] + 3.8, UT[1], 8.3), 0, 0.8, 0.9, { className: "tw-dark" });
});
as("base", "eq07", () => F.weldCart({ id: "EQ07", x: 42, state: "ready", code: "READY" }, 64));
back.push(F.floorText([TS[0] - 6, 75], "EQ04 검사 스테이션"), F.floorText([38.4, 72.6], "EQ07"), `<g>${F.floorText([38.4, 75.4], "보수 완료", { size: 2.1, tone: "mid" })}</g>`);

F.finish({
  out: dirname(fileURLToPath(import.meta.url)), id: "inc005", back,
  label: "INC005 설명도. P04 검사장 받침대 위에 용접이 끝난 B007 이중저 블록이 있다. 내저판 가장자리에 검사 위치 10곳이 번호로 표시돼 있고, 1~8번은 합격(초록), 앞쪽 오른쪽 9·10번은 불합격 후 보수를 마쳐 재검사를 기다린다(주황). 앞쪽에 EQ04 검사 스테이션(토털스테이션 삼각대, 초음파 탐상기 카트)과 보수에 쓴 EQ07 용접기가 있다.",
  stageAria: "B007 블록 분해 보기(Enter)", eq: "hold",
  css: `
.iso .qc-mark circle{fill:#30a46c;stroke:#fff;stroke-width:.6px;vector-effect:non-scaling-stroke}
.iso .qc-mark text{font-family:var(--anatomy-mono);font-weight:700;fill:#fff}
.iso [data-eq="hold"] .qc-mark[data-q="fail"] circle{fill:#f08c2e;animation:eq-blink 1.4s ease-in-out infinite}
.iso .qc-sten{font-family:var(--anatomy-mono);font-weight:700;fill:var(--anatomy-shade-0);letter-spacing:.1em}
.iso .qc-screen{fill:#12161b;stroke:var(--anatomy-hi);stroke-width:.4px;vector-effect:non-scaling-stroke}
.iso .qc-trace{fill:none;stroke:#7fe0a8;stroke-width:.6px;vector-effect:non-scaling-stroke}
@media (prefers-reduced-motion:reduce){.iso .qc-mark circle{animation:none!important}}`,
  data: {
    base: `합격 ${PASSED} / ${CHECKED}곳 · 9·10번 보수 완료, 재검사 대기`,
    apart: "내저판을 들어 내부 골조 표시 · 검사 표시는 내저판과 함께",
    tags: {
      ib: `내저판 4장 · 검사 위치 10곳(합격 ${PASSED}, 재검사 대기 ${FAILED})`,
      ss: "측판 · 용접 완료",
      fl: "늑판 6개 · 용접 완료",
      gd: "거더 3개 · 용접 완료",
      ls: "종보강재 16개 · 용접 완료",
      bp: "바닥판 4장 · 용접 완료",
      stool: "블록 받침대 6개",
      eq04: "EQ04 검사 스테이션 · QC007 8곳 합격, 2곳 불합격",
      eq07: "EQ07 보수용 용접기 · RW001 보수 2곳 완료(10:30~11:30)",
    },
    tagsOk: { ib: `내저판 4장 · 재검사 합격 ${CHECKED} / ${CHECKED}곳` },
  },
  plate: {
    fig: "Fig 1", title: "INC005 · B007 치수·용접 검사", hint: "올리거나 Enter = 분해",
    keys: [
      { mark: "red", label: "9·10번: 불합격 → 보수 완료, 재검사 대기" },
      { mark: "lit", label: "1~8번: 합격" },
      { mark: "raised", label: "EQ04 검사 스테이션 · EQ07 보수용 용접기" },
    ],
    caption: `B007 이중저 블록 치수·용접 검사(QC007). 10곳 중 8곳이 합격했고, 9·10번은 불합격 후 EQ07로 보수를 마쳐(RW001) 재검사 판정을 기다립니다. 합격 처리 전까지 다음 공정(도장)은 보류입니다. 그림 위에 마우스를 올리면 내저판이 들려 내부 골조가 보입니다. 블록 모양은 블록 내부 3D, 검사 장비와 용접기는 3D 공장 모형과 같고, 검사 표시는 3D와 같은 위치를 내저판 위에 그렸습니다.`,
  },
});
