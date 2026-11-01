// ---------- 움직임: 숫자가 바뀌면 이전 값에서 새 값까지 굴러가듯 바뀜(처음 볼 때는 0부터) ----------
// 동작 줄이기 설정(prefers-reduced-motion)을 켠 화면과 자동 테스트에서는 바로 새 값만 보인다.
const CNT_PREV = {};
const cnt = (key, v, d = 0) => `<span class="cnt" data-cnt="${key}" data-v="${+v}" data-d="${d}">${(+v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })}</span>`;
function cntMount() {
  const still = navigator.webdriver || typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;   // 자동 테스트(webdriver)는 값을 바로 읽도록 움직임 끔
  document.querySelectorAll('[data-cnt]').forEach(el => { const k = el.dataset.cnt, v = +el.dataset.v, d = +el.dataset.d, p = CNT_PREV[k] ?? 0; CNT_PREV[k] = v;
    if (still || p === v) return; const t0 = performance.now(), fmt = x => x.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
    el.classList.add('roll'); const step = t => { const a = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - a, 3); el.textContent = fmt(p + (v - p) * e); if (a < 1) requestAnimationFrame(step); else el.classList.remove('roll'); };
    requestAnimationFrame(step); });
}
