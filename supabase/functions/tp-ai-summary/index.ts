// TWIN PRO AI 운영 요약 (Supabase Edge Function)
// 순서: 시연 코드 확인·1회 차감(tp_ai_claim, 하루 5회) → DB에서 사실 읽기(tp_ai_facts) → Claude 호출 → 결과 저장(tp_ai_save)
// mode = 'bench': AI 모델 비교 한 건(회사별 모델, 하루 3회차) → 응답 시간 · 토큰 · 비용 · 자동 채점 저장(tp_ai_bench_save)
// 실패하면 차감한 1회를 되돌린다(tp_ai_refund). API 키는 Supabase 비밀값 ANTHROPIC_API_KEY에만 있다(화면·저장소에 없음).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-demo-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SYSTEM = `당신은 조선소 블록 제작 공장의 운영 관제 담당자를 돕는 보조자입니다.
입력 JSON은 TWIN PRO 서버 DB에서 방금 읽은 운영 사실입니다.

규칙
1. 입력에 있는 사실만 씁니다. 숫자·ID·시각은 입력값 그대로 쓰고, 입력에 없는 원인·수치·일정은 만들지 않습니다.
2. 시각은 sim_now(시연 기준 시각) 기준입니다. minutes_open은 사건이 열린 뒤 지난 분입니다.
3. 상태 코드는 한국어로 씁니다: RUNNING 가동, IDLE 대기, FAULT 고장, MAINTENANCE 점검, IN_PROGRESS 진행, BLOCKED 보류, PLANNED 계획, COMPLETED 완료.
4. 사건 분류: EQUIPMENT 설비 고장, MATERIAL 자재 대기, QUALITY 품질 보류.
5. 보고서체(~함, ~임)로 짧게 씁니다. 마크다운 기호(#, *, -)는 쓰지 않습니다.
6. 아래 형식을 그대로 지키고, 전체 700자 이내로 씁니다.

[현황 요약]
(2~3문장: 설비 가동·대기·고장·점검 대수, 기준일 계획 완료 건수, 계획 종료 도래·미완료 건수, 미해소 사건 수)

[이상 상황 설명]
(미해소 사건마다 한 줄: 사건ID · 대상 설비/작업/블록 · 무슨 일 · 영향(경과 시간, 보류된 작업) · 확인할 것. 사건이 없으면 "미해소 사건 없음")

[보고용 한 문단]
(상급자에게 그대로 보낼 수 있는 3문장 이내)`;

// 작업 관리 우선순위 요약(mode = 'priority'): 순위는 서버(tp_priority)가 규칙으로 정하고, AI는 그 순위를 문장으로만 옮긴다.
const SYSTEM_PRIORITY = `당신은 조선소 블록 제작 공장의 생산관리 담당자를 돕는 보조자입니다.
입력 JSON은 TWIN PRO 서버 DB가 방금 계산한 처리 우선순위(ranking)와 근거 관계(relations)입니다.

규칙
1. 순서는 ranking의 rank를 그대로 따릅니다. 순서를 바꾸거나 새 순위를 만들지 않습니다.
2. 입력에 있는 사실만 씁니다. 숫자·ID는 입력값 그대로 쓰고, 원인·예상 시각·복구 시간은 만들지 않습니다.
3. 분류: EQUIPMENT 설비 고장, MATERIAL 자재 대기, QUALITY 품질 보류. 상태: FAULT 고장, IDLE 대기, MAINTENANCE 점검, RUNNING 가동.
4. 1순위는 왜 먼저인지 근거(blocks_process, waiting, substitutes)를 한 문장으로 붙입니다. substitutes가 있으면 해당 설비 상태도 씁니다.
5. 존댓말 평서문(~입니다)으로 3문장 이내, 전체 250자 이내. 마크다운 기호는 쓰지 않습니다.`;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- AI 모델 비교(mode = 'bench'): 같은 사실 · 같은 지시문으로 회사별 모델 하나를 호출하고 실측값을 저장 ----------
// 키는 Supabase 비밀값에만 둔다: ANTHROPIC_API_KEY · OPENAI_API_KEY · GEMINI_API_KEY. 키가 없는 회사 모델은 '키 미등록'으로 건너뛴다.
const KEY_NAME: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY' };
type Out = { text: string; inTok: number; outTok: number };
async function callModel(provider: string, model: string, key: string, system: string, user: string): Promise<Out> {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1000, system, messages: [{ role: 'user', content: user }] }) });
    const b = await r.json(); if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
    return { text: (b.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('').trim(), inTok: b.usage?.input_tokens || 0, outTok: b.usage?.output_tokens || 0 };
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_completion_tokens: 1000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    const b = await r.json(); if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
    return { text: (b.choices?.[0]?.message?.content || '').trim(), inTok: b.usage?.prompt_tokens || 0, outTok: b.usage?.completion_tokens || 0 };
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: 1000 } }) });
  const b = await r.json(); if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
  return { text: (b.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('').trim(), inTok: b.usageMetadata?.promptTokenCount || 0, outTok: b.usageMetadata?.candidatesTokenCount || 0 };
}
// deno-lint-ignore no-explicit-any
async function bench(db: any, modelId: string, runId: string) {
  const m = await db.from('tp_ai_model').select('*').eq('model_id', modelId).maybeSingle();
  if (m.error || !m.data) return json({ ok: false, msg: '모델 목록에 없는 모델입니다.' });
  const key = Deno.env.get(KEY_NAME[m.data.provider]);
  if (!key) return json({ ok: false, skipped: true, msg: `${KEY_NAME[m.data.provider]} 미등록 · Supabase 비밀값에 등록하면 비교에 포함됩니다.` });
  const claim = await db.rpc('tp_ai_bench_claim', { p_run: runId });
  if (claim.error) return json({ ok: false, msg: '서버 오류: ' + claim.error.message });
  if (!claim.data.ok) return json(claim.data);
  const facts = await db.rpc('tp_ai_facts');
  if (facts.error) return json({ ok: false, msg: '서버 오류: ' + facts.error.message });
  const t0 = performance.now();
  let out: Out | null = null, err = '';
  try { out = await callModel(m.data.provider, modelId, key, SYSTEM, '현재 운영 데이터(JSON)입니다.\n' + JSON.stringify(facts.data)); }
  catch (e) { err = e instanceof Error ? e.message : String(e); }
  const latency = Math.round(performance.now() - t0);
  const saved = await db.rpc('tp_ai_bench_save', { p_run: runId, p_model: modelId, p_ok: !!out, p_latency: latency, p_in: out?.inTok ?? null, p_out: out?.outTok ?? null, p_text: out?.text ?? null, p_err: err || null });
  if (saved.error) return json({ ok: false, msg: '저장 실패: ' + saved.error.message });
  return json({ ok: !!out, msg: out ? `${m.data.label} 응답 ${latency}ms` : `${m.data.label} 호출 실패: ${err}`, latency_ms: latency, ...saved.data });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, msg: 'POST만 받습니다.' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-demo-code': req.headers.get('x-demo-code') || '' } },
  });
  const body = (await req.json().catch(() => ({}))) as { mode?: string; model_id?: string; run_id?: string };
  if (body.mode === 'bench') return bench(db, String(body.model_id || ''), String(body.run_id || ''));
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, msg: '서버에 ANTHROPIC_API_KEY가 등록되지 않았습니다. Supabase → Edge Functions → Secrets에서 등록하세요.' });
  const mode = body.mode === 'priority' ? 'priority' : 'summary';
  const claim = await db.rpc('tp_ai_claim');
  if (claim.error) return json({ ok: false, msg: '서버 오류: ' + claim.error.message });
  if (!claim.data.ok) return json(claim.data);
  try {
    const facts = await db.rpc(mode === 'priority' ? 'tp_ai_priority_facts' : 'tp_ai_facts');
    if (facts.error) throw new Error(facts.error.message);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: mode === 'priority' ? 500 : 1000, system: mode === 'priority' ? SYSTEM_PRIORITY : SYSTEM,
        messages: [{ role: 'user', content: (mode === 'priority' ? '현재 처리 우선순위 데이터(JSON)입니다.\n' : '현재 운영 데이터(JSON)입니다.\n') + JSON.stringify(facts.data) }],
      }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error?.message || `Claude API HTTP ${r.status}`);
    const text = (body.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('').trim();
    const saved = await db.rpc(mode === 'priority' ? 'tp_ai_save_priority' : 'tp_ai_save', { p_text: text, p_model: body.model || MODEL });
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data.ok) throw new Error(saved.data.msg);
    return json({ ok: true, msg: `${mode === 'priority' ? 'AI 우선순위 요약' : 'AI 운영 요약'}을 생성했습니다. 오늘 남은 횟수 ${5 - claim.data.used}/5` });
  } catch (e) {
    await db.rpc('tp_ai_refund');
    return json({ ok: false, msg: 'AI 요약 생성 실패(횟수는 차감되지 않았습니다): ' + (e instanceof Error ? e.message : String(e)) });
  }
});
