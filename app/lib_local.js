// 로컬 테스트용 서버: PGlite(Postgres)에 SQL을 올리고 load/rpc 를 제공 (Supabase 대역)
const {PGlite}=require('@electric-sql/pglite'); const fs=require('fs');
const TABLES=['vessels','zones','processes','equipment','equipment_snapshot','blocks','status_codes','work_orders','production_plan','production_actual','equipment_intervals','incidents','incident_actions','work_history','inspections','rework','sim_clock','event_log','ai_summary','ai_usage','signal_log','sim_lock','equipment_fit','incident_steps','ai_priority','io_point','daily','live_signal','ai_model','ai_bench'];
async function makeServer(){
  const db=new PGlite(); let chain=Promise.resolve(); const lock=f=>{ const r=chain.then(f,f); chain=r.catch(()=>{}); return r; };   // lock: 헤더 설정과 호출이 섞이지 않게 한 번에 하나씩
  for (const f of ['01_schema','02_functions','03_seed','05_extend','07_sim_lock','09_trial','10_trial_play','11_substitute','15_priority','17_io','19_live','21_ai_bench','23_equipment_admin']) await db.exec(fs.readFileSync(__dirname+`/sql/${f}.sql`,'utf8'));
  const fmt=(v,k)=>v instanceof Date? (k==='until'||k==='created_at'||k==='sent_at'? v.toISOString() : v.toISOString().slice(0,19)) : v;
  return {
    db, TABLES,
    async load(){ const out={}; for(const t of TABLES){ out[t]=(await db.query(`select * from tp_${t}`)).rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,fmt(v,k)]))); } return out; },
    // AI 대역: 실제 Edge Function과 같은 순서(차감 → 사실 → 저장), Claude 대신 사실 JSON으로 만든 고정 문장
    ai(code,mode){ const p=lock(() => this._ai(code,mode)); return mode&&mode.mode==='bench' ? p.then(r=>new Promise(ok=>setTimeout(()=>ok(r), Math.min(r.latency_ms||0, 4000)))) : p; },   // 모델 비교 대역은 응답 시간만큼 기다렸다가 돌려줌(모델별로 따로 끝남)
    async _ai(code,mode){ await db.query("select set_config('request.headers', $1, false)", [JSON.stringify(code==null?{}:{'x-demo-code':code})]);
      if(mode&&mode.mode==='bench') return this._bench(mode.model_id, mode.run_id);
      const c=(await db.query('select tp_ai_claim() r')).rows[0].r; if(!c.ok) return c;
      if(mode==='priority'){ const p=(await db.query('select tp_ai_priority_facts() r')).rows[0].r; const top=p.ranking.map(x=>x.incident).join(' → ');
        await db.query('select tp_ai_save_priority($1,$2)',[`${p.sim_now} 기준 처리 순서는 ${top}입니다(테스트 대역).`,'local-test']);
        return {ok:true,msg:`AI 우선순위 요약을 생성했습니다. 오늘 남은 횟수 ${10-c.used}/10`}; }
      const f=(await db.query('select tp_ai_facts() r')).rows[0].r;
      await db.query('select tp_ai_save($1,$2)',[`[현황 요약]\n${f.sim_now} 기준 미해소 사건 ${f.kpi.open_incidents}건(테스트 대역).`,'local-test']);
      return {ok:true,msg:`AI 운영 요약을 생성했습니다. 오늘 남은 횟수 ${10-c.used}/10`}; },
    // AI 모델 비교 대역: 실제 Edge Function과 같은 순서(회차 확인 → 사실 → 호출 → 채점 · 저장). 회사 API 대신 사실로 만든 고정 문장과 고정 지연을 씀
    async _bench(model, run){ const m=(await db.query('select * from tp_ai_model where model_id=$1',[model])).rows[0]; if(!m) return {ok:false,msg:'모델 목록에 없는 모델입니다.'};
      if(m.provider==='google') return {ok:false,skipped:true,msg:'GEMINI_API_KEY 미등록 · Supabase 비밀값에 등록하면 비교에 포함됩니다.'};
      const c=(await db.query('select tp_ai_bench_claim($1) r',[run])).rows[0].r; if(!c.ok) return c;
      const f=(await db.query('select tp_ai_facts() r')).rows[0].r, inc=f.open_incidents||[];
      const ids=inc.map(i=>`${i.id}(${i.equipment})`), lat={ 'claude-haiku-5-5':900,'claude-sonnet-5-5':2400,'claude-opus-5-5':4100,'gpt-6-luna':1100,'gpt-6.1-terra':2000,'gpt-6.1-sol':2300,'gpt-6-astra':3800 }[model]||1500;
      let body=ids.join(', '); if(model==='gpt-6-luna') body=ids.slice(1).join(', '); if(model==='gpt-6.1-terra') body+=', INC099(EQ09)';
      const text=`[현황 요약]\n${f.sim_now} 기준 미해소 사건 ${inc.length}건(테스트 대역).\n[이상 상황 설명]\n${body}\n[보고용 한 문단]\n테스트 대역 문장입니다.`;
      const r=(await db.query('select tp_ai_bench_save($1,$2,true,$3,$4,$5,$6,null) r',[run,model,lat,1800,220,text])).rows[0].r;
      return {ok:true,msg:`${m.label} 응답 ${lat}ms(테스트 대역)`,latency_ms:lat,...r}; },
    rpc(fn,args,code){ return lock(() => this._rpc(fn,args,code)); },
    async _rpc(fn,args,code){ await db.query("select set_config('request.headers', $1, false)", [JSON.stringify(code==null?{}:{'x-demo-code':code})]); const keys=Object.keys(args); const r=(await db.query(`select ${fn}(${keys.map(k=>`${k} => $${keys.indexOf(k)+1}`).join(',')}) r`, keys.map(k=>args[k]))).rows[0].r; return r; },
  };
}
module.exports={makeServer,TABLES};
