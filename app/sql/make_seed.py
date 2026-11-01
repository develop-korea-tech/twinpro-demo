# data.json(엑셀 변환본) → sql/03_seed.sql : tp_seed에 원본을 넣고 초기화 실행
import json, hashlib, os
d = json.load(open('data.json', encoding='utf-8'))
out = ['-- 받은 엑셀 15개 시트 원본 (자동 생성: python3 sql/make_seed.py)']
for k, v in d.items():
    out.append(f"insert into tp_seed values ('{k}', $seed${json.dumps(v, ensure_ascii=False)}$seed$::jsonb) on conflict (sheet) do update set rows = excluded.rows;")
code = json.load(open('config.json'))['demo_code'] if os.path.exists('config.json') else 'twinpro'
out.append(f"insert into tp_config values ('demo_code_sha256', '{hashlib.sha256(code.encode()).hexdigest()}') on conflict (key) do update set value = excluded.value;")
out.append('select tp_load_seed();')
open('sql/03_seed.sql', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(len(out))
