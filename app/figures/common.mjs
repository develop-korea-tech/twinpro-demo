// 사건 설명도 공통 도구(Anatomy 키트, MIT 위에 얹은 얇은 층).
// 그림마다 build.mjs가 figure()로 무대를 만들고, 부품을 box·turned·disc·cable로 기록한 뒤 finish()로 파일을 쓴다.
// 결과: <id>.fragment.html(앱에 넣는 조각, 그림 데이터 JSON 포함), <id>.html(미리보기). 움직임 코드는 figures/live.js 하나를 같이 쓴다.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import * as G from "../vendor/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../vendor/anatomy/kit/tube.mjs";
import * as A from "../vendor/anatomy/kit/audit.mjs";

export { k, G, A };
const ROOT = dirname(fileURLToPath(import.meta.url));
const f2 = (v) => v.toFixed(2);

// [a,b]에서 cuts([중심, 반폭]) 자리를 뺀 조각들
export function spans(a, b, cuts) {
  const out = [];
  let from = a;
  for (const [c, half] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (c + half <= from || c - half >= b) continue;
    if (c - half > from) out.push([from, c - half]);
    from = Math.max(from, c + half);
  }
  if (from < b) out.push([from, b]);
  return out;
}

export function figure({ W, H, fit, pieces, stagger, spring, azimuth = 52, elevation = 34, pad = 12 }) {
  const P = k.fitProjection(fit, W, H, { pad, azimuth, elevation });
  const V = G.viewOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);
  const poly = (pts) => "M" + pts.map((p) => at(p).map(f2).join(" ")).join("L") + "Z";
  const R = A.recorder(P, { order: stagger, spring });
  const record = R.solid;
  let PIECE = stagger[stagger.length - 1], TAG = "";
  const put = (name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) =>
    R.put({ name, at: ref, bias, svg, shapes, piece: PIECE, move: pieces[PIECE].move, tag: TAG, ...rest });
  const as = (piece, tag, fn) => { const [p0, t0] = [PIECE, TAG]; PIECE = piece; TAG = tag; fn(); PIECE = p0; TAG = t0; };

  function box(name, plan, z0, z1, style = {}, { steps = 3, bevel = 0, extra = "", inner = "", bias = 0, ground = false } = {}) {
    const shape = record(A.slab(plan, z0, z1 - z0, { name, ...(ground ? { ground: true } : {}) }, steps));
    put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
    return shape;
  }
  function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, bevel = 0, owner, wrap } = {}) {
    const paths = G.solidOf(profile, F, P, { bevel });
    const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
    const shape = record(A.solid(F, profile, { name, owner }));
    const svg = S(paths, { tone: "mid", ...style, inner }) + extra;
    put(name, G.add3(F.o, G.mul3(F.a, mid)), wrap ? `<g ${wrap}>${svg}</g>` : svg, [shape], { bias });
    return shape;
  }
  const disc = (name, F, s0, s1, r, style, options) => turned(name, F, [[s0, r], [s1, r]], style, options);
  const UP = (x, y, z) => G.frameAlong([x, y, z], [0, 0, 1]);
  const ALONG = (x, y, z, dir) => G.frameAlong([x, y, z], dir);

  const CABLES = [];
  function cable(name, points, r, { tone = "mid", cls = "", bend = 4, rings, maxLength = 14, bias = 0.05 } = {}) {
    const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
    R.route(name, route, r, { limp: true, piece: PIECE, move: pieces[PIECE].move });
    CABLES.push(name);
    tubePieces(route, r, P, { maxLength, spacing: Math.max(0.5, Math.min(1.4, r)), ...(rings ? { rings } : {}) }).forEach((part, index) =>
      put(`${name}:${index}`, part.mid, cls ? `<g class="${cls}">${tubeSvg(part, { tone })}</g>` : tubeSvg(part, { tone }), [A.tube(part.points, part.radii)], { bias, route: name, chunk: index }));
    return route;
  }
  // 면 위에 붙이는 납작한 그림(구멍·창·글자): 옆면 좌표계(로컬 x = 면을 따라, y = 아래로)
  const onSide = (atXY, z, face, inner) => `<g transform="${k.sideMatrix(atXY, z, P, face)}">${inner}</g>`;
  const onTopG = (atXY, z, inner, along = "x") => `<g transform="${k.topMatrix(atXY, z, P, along)}">${inner}</g>`;
  const stadium = (cx, cy, w, h, cls = "eqx-hole") => `<rect class="${cls}" x="${f2(cx - w / 2)}" y="${f2(cy - h / 2)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(Math.min(w, h) / 2)}"/>`;

  const F = { P, V, R, at, S, Ln, Dots, poly, put, as, box, turned, disc, cable, onSide, onTopG, stadium, UP, ALONG, CABLES, record, pieces, stagger, spring };

  // 작업장 바닥판(정적, 맨 뒤): 격자 + 테두리
  F.floor = (PLATE, gridX, gridY) => {
    const back = [`<path class="iso-halo" d="${k.haloOf(PLATE, -3, 3, P)}"/>`, S(k.slabOf(PLATE, -3, 3, P, 8, 0.8), { tone: "mid", className: "tw-floor" })];
    const IN = k.insetPlan(PLATE, 4), grid = [];
    for (const x of gridX) grid.push(k.lineOnTop([x, IN.y], [x, IN.y + IN.d], 0, P));
    for (const y of gridY) grid.push(k.lineOnTop([IN.x, y], [IN.x + IN.w, y], 0, P));
    back.push(Ln(k.planOutline(IN, 0, P, 6), { tone: "lo" }), Ln(grid.join(""), { tone: "faint" }));
    record(A.slab(PLATE, -3, 3, { name: "floor", ground: true }, 8));
    return back;
  };
  // 바닥에 쓰는 글자(정적)
  F.floorText = (xy, text, { size = 2.6, tone = "hi", cls } = {}) => {
    const t = k.faceTextSvg(k.topMatrix(xy, 0, P, "x"), text, { size, tone });
    return cls ? `<g class="${cls}">${t}</g>` : t;
  };

  // 블록 받침대(3D: 강재 밑판 + 노란 기둥 + 강재 받침판), 높이 z0
  F.stool = (x, y, z0) => {
    box(`stool.foot${x},${y}`, { x: x - 6.5, y: y - 6.5, w: 13, d: 13, r: 0.6 }, 0, 1, { className: "tw-stl" }, { steps: 2, bevel: 0.2 });
    box(`stool.post${x},${y}`, { x: x - 4, y: y - 4, w: 8, d: 8, r: 0.5 }, 1, z0 - 1.2, { className: "tw-yel" }, { steps: 2, bevel: 0.3 });
    box(`stool.cap${x},${y}`, { x: x - 5.5, y: y - 5.5, w: 11, d: 11, r: 0.5 }, z0 - 1.2, z0, { className: "tw-stl" }, { steps: 2, bevel: 0.2 });
  };

  // 용접기 대차(3D welder_cart): 대차·바퀴 4·본체(앞판 +y)·손잡이(+x)·케이블 감개(−y)·경광등(설명용)
  F.weldCart = (c, y) => {
    const x = c.x;
    box(`${c.id}.cart`, { x: x - 4, y: y - 2.75, w: 8, d: 5.5, r: 0.4 }, 2.2, 2.8, { className: "tw-stl" }, { steps: 2, bevel: 0.15 });
    for (const dx of [-3, 3]) for (const dy of [-2, 2]) {
      const Fw = ALONG(x + dx, y + dy - 0.25, 1.1, [0, 1, 0]);
      disc(`${c.id}.wheel${dx},${dy}`, Fw, 0, 0.5, 1.1, { className: "tw-dark" }, { extra: Ln(G.circleOf(Fw, 0.5, 0.55, P, 18), { tone: "lo" }) + Dots([at(G.add3(Fw.o, [0, 0.5, 0]))], { size: 0.3 }) });
    }
    const panel = onSide([x - 2.5, y + 2.5], 9.5, "left",
      `<rect class="eqx-panel" x="0" y="0" width="5" height="3" rx=".25"/>` +
      `<rect class="eq-win" x=".45" y=".4" width="4.1" height="1.35" rx=".15"/>` +
      `<text class="eq-code" data-cart="${c.state}" x="2.5" y="1.42" font-size="1.05" text-anchor="middle">${c.code}</text>` +
      `<circle class="eqx-knob" cx="1.3" cy="2.35" r=".42"/><circle class="eqx-knob" cx="3.7" cy="2.35" r=".42"/>`);
    const sockets = onSide([x - 2.5, y + 2.5], 5.4, "left", `<circle class="eqx-sock" cx="1.4" cy=".9" r=".7"/><circle class="eqx-sock" cx="3.6" cy=".9" r=".7"/>`);
    const vents = onSide([x + 3.5, y + 1.8], 9.2, "right", [0, 1, 2, 3].map((i) => `<rect class="eqx-slot" x="0" y="${i * 0.9}" width="3.6" height=".45" rx=".22"/>`).join("") +
      `<rect class="eqx-name" x="0" y="4.4" width="3.6" height="1.7" rx=".2"/><text class="eqx-id" x="1.8" y="5.65" font-size="1.05" text-anchor="middle">${c.id}</text>`);
    box(`${c.id}.body`, { x: x - 3.5, y: y - 2.5, w: 7, d: 5, r: 0.4 }, 2.8, 10.3, { className: "tw-blu" }, { steps: 3, bevel: 0.3, extra: panel + sockets + vents });
    cable(`${c.id}.handle`, [[x + 3.5, y - 1.9, 9.7], [x + 4.5, y - 1.9, 9.7], [x + 4.5, y + 1.9, 9.7], [x + 3.5, y + 1.9, 9.7]], 0.3, { tone: "mid", bend: 0.9 });
    const RF = ALONG(x - 2, y - 2.5, 6, [0, -1, 0]);
    disc(`${c.id}.reel.hub`, RF, 0, 0.3, 0.8, { className: "tw-dark" });
    disc(`${c.id}.reel.a`, RF, 0.3, 0.5, 2.5, { className: "tw-dark" });
    disc(`${c.id}.reel.drum`, RF, 0.5, 1.3, 1.7, { className: "tw-dark" });
    disc(`${c.id}.reel.b`, RF, 1.3, 1.5, 2.5, { className: "tw-dark" }, { extra: Ln(G.circleOf(RF, 1.5, 1.0, P, 20), { tone: "lo" }) });
    disc(`${c.id}.lamp.base`, UP(x + 2.1, y - 1.1, 10.3), 0, 0.5, 0.85, { className: "tw-dark" });
    const LF = UP(x + 2.1, y - 1.1, 10.8), LP = [[0, 0.7], [1.3, 0.7], [1.75, 0.45, 1], [1.95, 0]];
    put(`${c.id}.lamp`, [x + 2.1, y - 1.1, 11.7], `<g class="eq-lamp" data-cart="${c.state}">${S(G.solidOf(LP, LF, P), { tone: "hi", lit: true })}</g>`, [record(A.solid(LF, LP, { name: `${c.id}.lamp` }))]);
    return { reel: [x - 2, y - 2.5 - 1.5, 6] };
  };

  // 공정 경광등(3D beacon: 강재 기둥 7 m · 검은 집 · 램프). 상태 색은 CSS(data-eq)로
  F.beacon = (id, x, y) => {
    disc(`${id}.base`, UP(x, y, 0), 0, 3, 3.5, { className: "tw-stl" });
    disc(`${id}.pole`, UP(x, y, 3), 0, 67, 1.2, { className: "tw-stl" });
    disc(`${id}.house`, UP(x, y, 70), 0, 4, 3.2, { className: "tw-dark" });
    const LF = UP(x, y, 74), LP = [[0, 3.2], [1.6, 3.6], [4.2, 3.3, 1], [6.4, 1.6, 1], [7.4, 0]];
    put(`${id}.lamp`, [x, y, 77], `<g class="zone-lamp">${S(G.solidOf(LP, LF, P), { tone: "hi", lit: true })}</g>`, [record(A.solid(LF, LP, { name: `${id}.lamp` }))]);
  };

  // 이중저 블록 내부 골조(블록 내부 3D bkBom과 같은 구성): 바닥판 4 · 종보강재 16 · 거더 3 · 붙어 있는 늑판.
  // 거더·늑판·보강재는 서로 만나는 자리에서 끊어 그린다(앞뒤 순서를 바르게 정하기 위해). 1단위 = 0.1 m
  //   floors: [{ x, cls, piece, tag }] 붙어 있는 늑판, girder·bp·ls: { cls, piece, tag }
  F.crate = ({ L2, B2 = 40, Z0 = 10, floors, girder, bp, ls, stencil }) => {
    const BT = Z0 + 0.8, TOPZ = Z0 + 25.6, GY = [-20, 0, 20], LSY = [-32, -24, -16, -8, 8, 16, 24, 32], TG = 0.4, TF = 0.4, TL = 0.3;
    const fcuts = floors.map((f) => [f.x, TF]);
    as(bp.piece, bp.tag, () => {
      for (let i = 0; i < 4; i++) {
        const y = -B2 + 20 * i;
        const extra = i === 3 && stencil ? k.faceTextSvg(k.topMatrix([stencil.x, y + 19.2], BT, P, "x"), stencil.text, { size: 4.2, tone: "mid" }) : "";
        box(`bp${i + 1}`, { x: -L2, y, w: 2 * L2, d: 20, r: 0.3 }, Z0, BT, { className: bp.cls }, { steps: 2, extra });
      }
    });
    as(ls.piece, ls.tag, () => {
      for (const y of LSY) for (const [a, b] of spans(-L2 + 0.5, L2 - 0.5, [...fcuts, [0, 0.05]]))
        box(`ls${y}:${a.toFixed(1)}`, { x: a, y: y - TL, w: b - a, d: 2 * TL, r: 0.1 }, BT, BT + 3.2, { className: ls.cls }, { steps: 1 });
    });
    as(girder.piece, girder.tag, () => {
      for (const y of GY) for (const [a, b] of spans(-L2, L2, fcuts)) {
        const len = b - a, n = Math.max(0, Math.floor((len - 3) / 13)), holes = [];
        for (let i = 0; i < n; i++) holes.push(stadium((len / n) * (i + 0.5), 12.4, 6.4, 10));
        const extra = holes.length ? onSide([a, y + TG], TOPZ, "left", holes.join("")) : "";
        box(`gd${y}:${a.toFixed(1)}`, { x: a, y: y - TG, w: len, d: 2 * TG, r: 0.1 }, BT, TOPZ, { className: girder.cls }, { steps: 1, extra });
      }
    });
    const YSEG = spans(-B2 + 0.3, B2 - 0.3, GY.map((y) => [y, TG]));
    floors.forEach((f, i) => as(f.piece, f.tag, () => {
      for (const [a, b] of YSEG) {
        const len = b - a;
        const slots = LSY.filter((y) => y > a && y < b).map((y) => `<path class="eqx-hole" d="M${f2(b - y - 1.4)} 25.6V23.4A1.4 1.4 0 0 1 ${f2(b - y + 1.4)} 23.4V25.6Z"/>`);
        const extra = onSide([f.x + TF, b], TOPZ, "right", stadium(len / 2, 11.5, Math.min(10, len - 6), 6.4) + slots.join(""));
        box(`fl${f.no ?? i + 1}:${a.toFixed(1)}`, { x: f.x - TF, y: a, w: 2 * TF, d: len, r: 0.1 }, BT, TOPZ, { className: f.cls }, { steps: 1, extra });
      }
    }));
    return { BT, TOPZ, GY, LSY, TG, TF, TL };
  };

  F.finish = ({ out, id, back, ghost = [], label, data, css = "", plate, stageAria, eq = "fault", audit = {} }) => {
    A.settle(R, P);
    R.items.sort((a, b) => a.key - b.key);
    const groups = R.items.map((item, index) => {
      const [mx, my, mz] = item.move;
      return `<g class="it" data-piece="${item.piece}" data-t="${item.tag}" data-k="${item.key.toFixed(2)}" data-m="${mx.toFixed(1)},${my.toFixed(1)},${mz.toFixed(1)}" data-i="${index}">${item.svg}</g>`;
    });
    const ghostSvg = ghost.length ? `<g class="eqx-ghost" aria-hidden="true"><path d="${ghost.join("")}"/></g>` : "";
    const svg = k.figureSvg({ width: W, height: H, label, body: [...back, `<g class="eqx-items">${groups.join("")}</g>`, ghostSvg] });
    const unit = (vector) => { const o = at([0, 0, 0]), p = at(vector); return [p[0] - o[0], p[1] - o[1]]; };
    const DATA = { V, EX: unit([1, 0, 0]), EY: unit([0, 1, 0]), EZ: unit([0, 0, 1]), stagger, spring, ...data };
    const json = JSON.stringify(DATA).replace(/</g, "\\u003c");
    const html = k.plateHtml({
      ...plate,
      readout: data.base,
      body: `<div class="iso-stage eqx-stage" data-fig="${id}" data-eq="${eq}" tabindex="0" role="button" aria-label="${stageAria}">${svg}</div><script type="application/json" class="fig-data">${json}</script>`,
    });
    const style = `<style>${COMMON_CSS}${css}</style>`;
    writeFileSync(join(out, `${id}.fragment.html`), style + html);
    const live = readFileSync(join(ROOT, "live.js"), "utf8");
    writeFileSync(join(out, `${id}.html`), k.pageHtml({ title: plate.title, theme: "light", body: style + html, script: `${live}\nwindow.FIG_RUN(document.querySelector(".iso-figure"));`, width: 780 }));
    console.log(`wrote ${id}`, `${R.items.length} items`, `${CABLES.length} cables`);
    A.auditOrExit(R, P, audit);
  };
  return F;
}

// 3D와 같은 색(블록 내부 3D·3D 공장): 노랑 받침대, 파랑 장비, 프라이머(용접 완료), 초록(지금 작업 중), 강재 회색 등
export const COMMON_CSS = `
.iso .eqx-stage{cursor:pointer;outline:none;touch-action:manipulation}
.iso .eqx-stage:focus-visible{box-shadow:0 0 0 2px var(--anatomy-blue);border-radius:4px}
.iso .tw-yel{--anatomy-top:#f6c547;--anatomy-paper:#f6c547;--anatomy-shade-3:#eeb934;--anatomy-shade-2:#e2a925;--anatomy-shade-1:#d39a1a;--anatomy-shade-0:#c48b12}
.iso .tw-blu{--anatomy-top:#4f80c6;--anatomy-paper:#4f80c6;--anatomy-shade-3:#4574bb;--anatomy-shade-2:#3c69ae;--anatomy-shade-1:#335ea1;--anatomy-shade-0:#2b5494}
.iso .tw-navy{--anatomy-top:#4a5f86;--anatomy-paper:#4a5f86;--anatomy-shade-3:#41557b;--anatomy-shade-2:#394c70;--anatomy-shade-1:#314365;--anatomy-shade-0:#2a3a5a}
.iso .tw-pri{--anatomy-top:#bd5d40;--anatomy-paper:#bd5d40;--anatomy-shade-3:#af5338;--anatomy-shade-2:#a14a31;--anatomy-shade-1:#93422b;--anatomy-shade-0:#853a25}
.iso .tw-cur{--anatomy-top:#74dd9e;--anatomy-paper:#74dd9e;--anatomy-shade-3:#63d090;--anatomy-shade-2:#55c383;--anatomy-shade-1:#48b676;--anatomy-shade-0:#3ca86a}
.iso .tw-cut{--anatomy-top:#eef1f4;--anatomy-paper:#eef1f4;--anatomy-shade-3:#e3e7eb;--anatomy-shade-2:#d9dee3;--anatomy-shade-1:#cfd5db;--anatomy-shade-0:#c5ccd3}
.iso .tw-plate{--anatomy-top:#c3cad2;--anatomy-paper:#c3cad2;--anatomy-shade-3:#b6bec7;--anatomy-shade-2:#aab3bd;--anatomy-shade-1:#9ea8b3;--anatomy-shade-0:#929da9}
.iso .tw-wood{--anatomy-top:#a07a52;--anatomy-paper:#a07a52;--anatomy-shade-3:#936e48;--anatomy-shade-2:#86633f;--anatomy-shade-1:#795836;--anatomy-shade-0:#6c4e2f}
.iso .tw-dark{--anatomy-top:#5a6068;--anatomy-paper:#5a6068;--anatomy-shade-3:#50565e;--anatomy-shade-2:#474c53;--anatomy-shade-1:#3e4349;--anatomy-shade-0:#363a40}
.iso .tw-stl{--anatomy-top:#e4e7eb;--anatomy-paper:#e4e7eb;--anatomy-shade-3:#d8dce1;--anatomy-shade-2:#cdd2d8;--anatomy-shade-1:#c2c8cf;--anatomy-shade-0:#b7bec6}
.iso .tw-brass{--anatomy-top:#e2b354;--anatomy-paper:#e2b354;--anatomy-shade-3:#d6a647;--anatomy-shade-2:#c9993d;--anatomy-shade-1:#bb8c34;--anatomy-shade-0:#ad802c}
.iso .tw-floor{--anatomy-top:#eceeef;--anatomy-paper:#eceeef;--anatomy-shade-3:#dfe2e4;--anatomy-shade-2:#d6d9dc;--anatomy-shade-1:#ccd0d4;--anatomy-shade-0:#c3c8cc}
.iso .eqx-hose{--anatomy-top:#6a7078;--anatomy-shade-3:#5f656d;--anatomy-shade-2:#555b62;--anatomy-shade-1:#4b5057;--anatomy-shade-0:#41464c}
.iso .eqx-hole{fill:var(--anatomy-shade-0);stroke:var(--anatomy-hi);stroke-width:.5px;vector-effect:non-scaling-stroke;opacity:.9}
.iso .eqx-panel{fill:#2a2f36;stroke:var(--anatomy-hi);stroke-width:.5px;vector-effect:non-scaling-stroke}
.iso .eq-win{fill:#12161b}
.iso .eq-code{font-family:var(--anatomy-mono);font-weight:700;fill:#9aa3ad;letter-spacing:.04em}
.iso .eqx-knob{fill:#c9ced4}.iso .eqx-sock{fill:#1c2026;stroke:#c9ced4;stroke-width:.5px;vector-effect:non-scaling-stroke}
.iso .eqx-slot{fill:var(--anatomy-shade-0);stroke:var(--anatomy-hi);stroke-width:.4px;vector-effect:non-scaling-stroke}
.iso .eqx-name{fill:#f4f5f6;stroke:var(--anatomy-hi);stroke-width:.4px;vector-effect:non-scaling-stroke}
.iso .eqx-id{font-family:var(--anatomy-mono);font-weight:700;fill:#26262a}
.iso .eq-lamp .iso-top,.iso .eq-lamp .iso-shade{fill:#c3c8ce}
.iso .eq-lamp[data-cart="ready"] .iso-top,.iso .eq-lamp[data-cart="ready"] .iso-shade{fill:var(--anatomy-green)}
.iso .eq-code[data-cart="ready"]{fill:#7fe0a8}
.iso [data-eq="fault"] .eq-lamp[data-cart="fault"] .iso-top,.iso [data-eq="fault"] .eq-lamp[data-cart="fault"] .iso-shade{fill:var(--anatomy-red)}
.iso [data-eq="fault"] .eq-lamp[data-cart="fault"]{animation:eq-blink 1.4s ease-in-out infinite}
.iso [data-eq="fault"] .eq-code[data-cart="fault"]{fill:#ff8a8a}
.iso [data-eq="ok"] .eq-lamp[data-cart="fault"] .iso-top,.iso [data-eq="ok"] .eq-lamp[data-cart="fault"] .iso-shade{fill:var(--anatomy-green)}
.iso [data-eq="ok"] .eq-code[data-cart="fault"]{fill:#7fe0a8}
.iso [data-eq="fault"] .eqx-word[data-cart="fault"] text{fill:var(--anatomy-red)}
.iso .zone-lamp .iso-top,.iso .zone-lamp .iso-shade{fill:var(--anatomy-green)}
.iso [data-eq="fault"] .zone-lamp .iso-top,.iso [data-eq="fault"] .zone-lamp .iso-shade{fill:var(--anatomy-red)}
.iso [data-eq="fault"] .zone-lamp{animation:eq-blink 1.4s ease-in-out infinite}
.iso [data-eq="hold"] .zone-lamp .iso-top,.iso [data-eq="hold"] .zone-lamp .iso-shade{fill:#f2a93b}
.iso [data-eq="hold"] .zone-lamp{animation:eq-blink 1.4s ease-in-out infinite}
.iso .eqx-ghost path{fill:none;stroke:var(--anatomy-blue);stroke-width:.8px;stroke-dasharray:3 3;vector-effect:non-scaling-stroke;opacity:.55;transition:opacity .4s}
.iso .eqx-stage.is-apart .eqx-ghost path{opacity:0}
.iso .eqx-ghost{pointer-events:none}
@keyframes eq-blink{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.iso [data-eq] .eq-lamp,.iso [data-eq] .zone-lamp{animation:none!important}}
`;
