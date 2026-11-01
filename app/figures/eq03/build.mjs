// INC003 설명도 — EQ03 용접기 경보로 B008 이중저 블록 용접이 멈춘 모습(P03 블록 조립장).
// 맞춘 기준(같은 모양·색): 블록 내부 3D(src/block3d.js bkBom·bkAt)와 3D 공장(twin3d/scene.py의 stools·welder_cart).
//   - B008: 길이 14.3 m · 폭 8 m · 높이 2.6 m, 받침대 위 z0 1.0 m. 바닥판 4 · 종보강재 16 · 거더 3(y −2·0·+2 m) · 늑판 6(x −6.85 ~ +6.85 m)
//   - 용접 102.5 / 164 m 시점 상태(bkAt): 바닥판·종보강재·거더·늑판-01·02 용접 완료(프라이머 색), 늑판-03 용접 중(초록),
//     늑판-04~06 · 측판 · 내저판은 아직 안 붙음(3D처럼 파란 점선 = 최종 위치)
//   - 용접기 3대: 3D 공장의 welder_cart 치수. 경광등만 설명용으로 더함. 배치는 설명을 위해 블록 가까이 모았다. 1단위 = 0.1 m
// 움직임: 올리거나 Enter → 용접이 끝난 거더·늑판-01·02가 들려 올라가고 멈춘 늑판-03과 토치만 남는다.
// 실행: node figures/eq03/build.mjs [--audit]  →  eq03.html(미리보기), eq03.fragment.html(앱 조각)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { figure, spans, k, G } from "../common.mjs";

// ---- 사실(서버 데이터·3D와 같은 값) ----
const PLAN_M = 164, DONE_M = 102.5;                 // WO008-03 계획·인정 용접 길이(m)
const FL3_W0 = 99.613, FL3_W1 = 103.058;            // 늑판-03(B008-026)의 용접 구간(bkBom w0·w1, m)
const FL3_SHARE = (DONE_M - FL3_W0) / (FL3_W1 - FL3_W0);   // 0.838

const L2 = 71.5, B2 = 40, Z0 = 10;
const FX = [-68.5, -41.1, -13.7, 13.7, 41.1, 68.5]; // 늑판 x(6개)
const YS = -39.7 + 79.4 * FL3_SHARE;                // 늑판-03 용접이 멈춘 y
const XF3 = FX[2];
const PIECES = { floors: { move: [0, 0, 22] }, girders: { move: [0, 0, 22] }, base: { move: [0, 0, 0] } };
const CY = 57;
const CARTS = [
  { id: "EQ03", x: -8.8, state: "fault", code: "ALM 31", word: "경보" },
  { id: "EQ07", x: 4.2, state: "ready", code: "READY", word: "대기" },
  { id: "EQ08", x: 17.2, state: "pm", code: "PM", word: "정비" },
];
const PLATE = { x: -77, y: -45, w: 154, d: 111, r: 4 };
const F = figure({
  W: 760, H: 470, pieces: PIECES, stagger: ["floors", "girders", "base"], spring: { stagger: 0.09, stiffness: 64, damping: 15, substeps: 4 },
  fit: [...k.boxCorners(PLATE, -3, 0), ...k.boxCorners({ x: -L2, y: -B2, w: 2 * L2, d: 2 * B2 }, Z0, Z0 + 25.6 + 22)],
});
const { as, box, turned, cable, at, Ln, Dots, poly, P } = F;

const back = F.floor(PLATE, [-60, -40, -20, 0, 20, 40, 60], [-40, -20, 0, 20, 40, 60]);
for (const c of CARTS) {
  back.push(F.floorText([c.x - 3.6, CY + 7.6], c.id));
  back.push(`<g class="eqx-word" data-cart="${c.state}">${F.floorText([c.x - 3.6, CY + 10.4], c.word, { size: 2.1, tone: "mid" })}</g>`);
}
as("base", "stool", () => { for (const x of [-50, 0, 50]) for (const y of [-25, 25]) F.stool(x, y, Z0); });

const C = F.crate({
  L2, B2, Z0, stencil: { x: 28, text: "B008" },
  bp: { cls: "tw-pri", piece: "base", tag: "bp" }, ls: { cls: "tw-pri", piece: "base", tag: "ls" }, girder: { cls: "tw-pri", piece: "girders", tag: "gd" },
  floors: [
    { x: FX[0], cls: "tw-pri", piece: "floors", tag: "fl12" }, { x: FX[1], cls: "tw-pri", piece: "floors", tag: "fl12" },
    { x: FX[2], cls: "tw-cur", piece: "base", tag: "fl3" },
  ],
});
const { BT, TOPZ, GY, LSY, TG, TF, TL } = C;

// ---------- 늑판-03 이음 비드(여기까지 용접, lit) + 토치 ----------
as("base", "bead", () => {
  const runs = spans(-B2 + 0.3, YS, [...GY.map((y) => [y, TG]), ...LSY.map((y) => [y, TL])]);
  runs.forEach(([a, b], i) => {
    const stop = i === runs.length - 1 ? Dots([at([XF3 + TF + 0.55, b - 0.4, BT + 1])], { size: 0.9, tone: "hi", pulse: true }) : "";   // 멈춘 지점(깜빡임)
    box(`bead${i}`, { x: XF3 + TF, y: a, w: 1.1, d: b - a, r: 0.45 }, BT, BT + 1, { tone: "hi", lit: true, className: "eqx-bead" }, { steps: 3, bias: 0.05, extra: stop });
  });
});
const TIP = [XF3 + TF + 0.9, YS + 0.9, BT + 0.3];
const TDIR = G.unit3([0.15, 0.68, 0.72]);
const TLEN = 11;
const TEND = G.add3(TIP, G.mul3(TDIR, TLEN));
as("base", "torch", () => {
  const TF_ = G.frameAlong(TIP, TDIR);
  turned("torch.nozzle", TF_, [[0, 0.45], [1.4, 0.75], [2.8, 0.75]], { className: "tw-brass" });
  turned("torch", TF_, [[2.8, 1.0], [4.4, 1.0], [4.4, 0.85], [TLEN, 0.85]], { className: "tw-dark" }, { inner: Ln(G.arcOf(TF_, 6.6, 0.85, P), { tone: "lo" }) });
});

// ---------- 용접기 3대 + 용접 케이블(EQ03 감개 → 블록 열린 옆(+y)으로 넘어 → 토치) ----------
const reels = {};
for (const c of CARTS) as("base", c.id.toLowerCase(), () => { reels[c.id] = F.weldCart(c, CY).reel; });
as("base", "hose", () => {
  const [cx, reelOut] = [reels.EQ03[0], reels.EQ03[1]];
  cable("hose", [TEND, G.add3(TEND, G.mul3(TDIR, 5)), [cx, 49, TEND[2] + 5], [cx, 49, 6], [cx, reelOut, 6]],
    0.75, { tone: "mid", cls: "eqx-hose", bend: 7, rings: { pitch: 1.4, fade: [0.1, 0.5] }, maxLength: 10 });
});

// ---------- 아직 안 붙은 부재: 최종 위치를 점선으로(3D의 파란 윤곽선과 같은 뜻) ----------
const ghost = [];
for (const x of FX.slice(3)) ghost.push(poly([[x, -B2 + 0.3, BT], [x, B2 - 0.3, BT], [x, B2 - 0.3, TOPZ], [x, -B2 + 0.3, TOPZ]]));
for (let i = 0; i < 4; i++) { const y0 = -B2 + 20 * i + 0.2, y1 = y0 + 19.6; ghost.push(poly([[-L2, y0, TOPZ + 0.8], [L2, y0, TOPZ + 0.8], [L2, y1, TOPZ + 0.8], [-L2, y1, TOPZ + 0.8]])); }
for (const y of [-B2, B2]) ghost.push(poly([[-L2, y, Z0], [L2, y, Z0], [L2, y, TOPZ + 0.8], [-L2, y, TOPZ + 0.8]]));

const pct = Math.round(FL3_SHARE * 100);
F.finish({
  out: dirname(fileURLToPath(import.meta.url)), id: "eq03", back, ghost,
  label: "INC003 설명도. P03 블록 조립장 받침대 위에 B008 이중저 블록이 있다. 바닥판·종보강재·거더 3개·늑판-01·02는 용접이 끝났고, 늑판-03은 앞쪽에서 84%까지 용접하다 멈췄으며 토치가 그 자리에 있다. 토치 케이블은 블록 앞 EQ03 용접기 감개로 이어지고, EQ03 경광등은 빨간색(경보 ALM 31)이다. 옆에 EQ07(대기), EQ08(정비) 용접기가 있다. 늑판-04~06, 측판, 내저판은 아직 붙지 않아 점선으로 위치만 표시했다.",
  stageAria: "B008 블록 분해 보기(Enter)",
  css: ".iso .eqx-bead .iso-top,.iso .eqx-bead .iso-shade{fill:#ffcf7a}",
  data: {
    base: `${DONE_M} / ${PLAN_M} m · EQ03 경보 ALM 31`,
    apart: "용접 끝난 부재를 들어 올림 · 늑판-03에서 멈춤",
    tags: {
      eq03: "EQ03 용접기 · 전원장치 경보 ALM 31 · 용접 멈춤",
      eq07: "EQ07 용접기 · 대기",
      eq08: "EQ08 용접기 · 정비 중",
      hose: "용접 케이블 · EQ03 감개 → 토치",
      torch: `토치 · 늑판-03 이음 ${pct}% 지점에서 멈춤`,
      bead: `늑판-03 이음 · ${(DONE_M - FL3_W0).toFixed(1)} / ${(FL3_W1 - FL3_W0).toFixed(1)} m 용접`,
      fl3: `늑판-03 (B008-026) · 용접 중 ${pct}%`,
      fl12: "늑판-01·02 · 용접 완료",
      gd: "거더 3개 · 용접 완료",
      ls: "종보강재 16개 · 용접 완료",
      bp: "바닥판 4장 · 용접 완료",
      stool: "블록 받침대 6개",
    },
    tagsOk: { eq03: "EQ03 용접기 · 복구 · 대기" },
  },
  plate: {
    fig: "Fig 1", title: "INC003 · B008 이중저 용접", hint: "올리거나 Enter = 분해",
    keys: [
      { mark: "red", label: "EQ03 경광등(전원장치 경보)" },
      { mark: "lit", label: "늑판-03 이음 비드와 토치: 용접이 멈춘 곳" },
      { mark: "raised", label: "용접 완료 부재 25개(프라이머 색)" },
    ],
    caption: `B008 이중저 블록. 바닥판·종보강재·거더·늑판-01·02는 용접이 끝났고, 늑판-03(초록)은 이음의 ${pct}%에서 멈췄습니다(작업지시 ${DONE_M} / ${PLAN_M} m). 늑판-04~06·측판·내저판은 아직 붙지 않아 점선으로 표시했습니다. 그림 위에 마우스를 올리면 용접이 끝난 부재가 들려 올라가 멈춘 지점이 드러납니다. 블록 모양은 블록 내부 3D, 용접기는 3D 공장 모형과 같고, 용접기 위치는 가깝게 모아 그렸습니다.`,
  },
});
