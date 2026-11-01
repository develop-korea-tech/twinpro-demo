// 사건 설명도 공통 동작(분해·조립 스프링, 자동 반복, 마우스·키보드). 그림마다 다른 값은 그림 안의 <script class="fig-data"> JSON에서 읽는다.
// 앱은 그림 요소를 한 번 만들어 이 함수에 넘기고, 모달을 닫으면 요소만 떼어 둔다(화면에 없으면 멈춤).
window.FIG_RUN = function (root) {
  const D = JSON.parse(root.querySelector(".fig-data").textContent);
  const stage = root.querySelector(".eqx-stage");
  const box = stage.querySelector(".eqx-items");
  const out = root.querySelector("[data-readout]");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const nodes = [...box.querySelectorAll(".it")].map((el) => {
    const m = el.dataset.m.split(",").map(Number);
    return { el, piece: el.dataset.piece, key: +el.dataset.k, m, lift: m[0] * D.V[0] + m[1] * D.V[1] + m[2] * D.V[2], shown: "" };
  });
  let order = nodes.map((_, i) => i);
  const SP = D.spring, IDS = D.stagger;
  const sp = Object.fromEntries(IDS.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
  let seen = false, clock = 0, apart = false, hover = "", visible = false, frame = 0, last = 0, tour = 0, resume = 0, leave = 0, said = "";
  let touring = !still.matches;

  function setApart(on) {
    if (on === apart) return;
    apart = on;
    stage.classList.toggle("is-apart", on);
    (on ? IDS : [...IDS].reverse()).forEach((id, i) => { sp[id].pending = { value: on ? 1 : 0, at: clock + i * SP.stagger }; });
  }
  function steer(s, dt) {
    if (s.pending && clock >= s.pending.at) { s.target = s.pending.value; s.pending = null; }
    if (still.matches) { s.x = s.target; s.v = 0; return !!s.pending; }
    for (let i = 0; i < SP.substeps; i++) {
      const h = dt / SP.substeps;
      s.v += ((s.target - s.x) * SP.stiffness - s.v * SP.damping) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.target - s.x) < 2e-4 && Math.abs(s.v) < 2e-4) { s.x = s.target; s.v = 0; return !!s.pending; }
    return true;
  }
  function place() {
    for (const n of nodes) {
      const t = sp[n.piece].x;
      const tx = (D.EX[0] * n.m[0] + D.EY[0] * n.m[1] + D.EZ[0] * n.m[2]) * t;
      const ty = (D.EX[1] * n.m[0] + D.EY[1] * n.m[1] + D.EZ[1] * n.m[2]) * t;
      const text = t === 0 || (!n.m[0] && !n.m[1] && !n.m[2]) ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
      if (text !== n.shown) { n.shown = text; if (text) n.el.setAttribute("transform", text); else n.el.removeAttribute("transform"); }
    }
    const next = order.slice().sort((a, b) => nodes[a].key + nodes[a].lift * sp[nodes[a].piece].x - (nodes[b].key + nodes[b].lift * sp[nodes[b].piece].x));
    if (next.some((v, i) => v !== order[i])) {
      const frag = document.createDocumentFragment();
      for (const i of next) frag.appendChild(nodes[i].el);
      box.appendChild(frag);
      order = next;
    }
  }
  function say(moving) {
    const ok = stage.dataset.eq === "ok";
    const text = hover ? (ok && D.tagsOk && D.tagsOk[hover]) || D.tags[hover] || "" : moving ? (apart ? "분해 중" : "조립 중") : apart ? D.apart : out.dataset.base || D.base;
    if (text && text !== said) { said = text; out.textContent = text; }
  }
  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    if (touring) { tour += dt; const p = tour % 9; setApart(p > 1.6 && p < 6); }
    let moving = false;
    for (const id of IDS) if (steer(sp[id], dt)) moving = true;
    place();
    say(moving);
    frame = visible && (moving || touring) ? requestAnimationFrame(tick) : 0;
  }
  function run() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
  function hold() {   // 직접 만지면 자동 반복을 멈추고, 8초 동안 가만두면 다시 시작
    touring = false;
    clearTimeout(resume);
    if (!still.matches) resume = setTimeout(() => { touring = true; tour = 0; hover = ""; run(); }, 8000);
  }
  new IntersectionObserver((entries) => {   // 다시 보일 때(모달을 다시 열 때)는 조립된 처음 상태에서 시작
    const now = entries[entries.length - 1].isIntersecting;
    if (now && !visible && seen) { apart = false; stage.classList.remove("is-apart"); hover = ""; tour = 0; for (const id of IDS) Object.assign(sp[id], { x: 0, v: 0, target: 0, pending: null }); }
    if (now) seen = true;
    visible = now;
    if (visible) run();
  }).observe(stage);
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    hold();
    clearTimeout(leave);
    setApart(true);
    const it = e.target.closest && e.target.closest(".it");
    hover = it ? it.dataset.t : "";
    run();
  });
  stage.addEventListener("pointerleave", () => { clearTimeout(leave); leave = setTimeout(() => { hover = ""; setApart(false); run(); }, 300); });
  stage.addEventListener("click", (e) => { if (e.pointerType === "mouse") return; hold(); setApart(!apart); run(); });
  stage.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    hold();
    hover = "";
    setApart(!apart);
    run();
  });
  if (!out.dataset.base) out.dataset.base = out.textContent;
};
