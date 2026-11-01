// 연결 프로그램 자동 테스트: 가상 장비(field_sim.py) → 연결 프로그램(bridge.py) → 서버 입구(로컬 Postgres, Supabase와 같은 SQL)
// 실행: node tools/io_bridge/test_bridge.js   (저장소 루트에서, app/config.json 필요)
const http = require('http'), { spawn } = require('child_process'), path = require('path'), fs = require('fs');
const { makeServer } = require('../../app/lib_local.js');
const D = __dirname, PY = process.platform === 'win32' ? 'python' : 'python3', PORT = 18765;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = await makeServer(), code = JSON.parse(fs.readFileSync(path.join(D, '../../app/config.json'))).demo_code;
  // Supabase REST RPC 대역: POST /rest/v1/rpc/<함수> → 로컬 Postgres
  const web = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', async () => {
    try { const out = await srv.rpc(q.url.split('/').pop(), JSON.parse(b), q.headers['x-demo-code']); r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(out)); }
    catch (e) { r.statusCode = 400; r.end(JSON.stringify({ msg: String(e) })); } }); }).listen(PORT);
  const field = spawn(PY, ['-u', path.join(D, 'field_sim.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  await wait(1000);
  const env = { ...process.env, TP_SUPABASE_URL: `http://127.0.0.1:${PORT}`, TP_SUPABASE_KEY: 'test-anon', TP_DEMO_CODE: code };
  const bridge = spawn(PY, ['-u', path.join(D, 'bridge.py'), '--interval', '0.3', '--count', '14'], { env });
  let log = ''; bridge.stdout.on('data', d => { log += d; }); bridge.stderr.on('data', d => { log += d; });
  await wait(1200);
  for (const c of ['count EQ05 7', 'fault EQ01', 'count EQ04 3']) { field.stdin.write(c + '\n'); await wait(600); }
  await new Promise(r => bridge.on('exit', r));
  field.stdin.write('quit\n'); web.close();
  const rows = (await srv.db.query('select equipment_id, signal, value, ok, source from tp_signal_log order by id')).rows;
  const has = (eq, sig, src) => rows.some(r => r.equipment_id === eq && r.signal === sig && r.source === src && r.ok);
  const inc = (await srv.db.query("select count(*) c from tp_incidents where equipment_id = 'EQ01' and status = 'OPEN'")).rows[0].c;
  const res = [['Modbus 누적 수량 → COUNT 7(EQ05, 출처 MODBUS) 반영', has('EQ05', 'COUNT', 'MODBUS') && rows.find(r => r.equipment_id === 'EQ05').value == 7],
    ['Modbus 이상 비트 → FAULT(EQ01) → 고장 사건 등록', has('EQ01', 'FAULT', 'MODBUS') && +inc === 1],
    ['ETOS %MW 누적 수량 → COUNT 3(EQ04, 출처 ETOS) 반영', has('EQ04', 'COUNT', 'ETOS')],
    ['처음 읽은 값으로는 신호를 보내지 않음(신호 3건만)', rows.length === 3]];
  res.forEach(([t, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`));
  if (res.some(r => !r[1])) { console.log(log); console.log(rows); process.exit(1); }
  console.log(`${res.length}/${res.length} PASS`); process.exit(0);
})();
