# src/* + 아이콘 → dist/ (1) twinpro.html : 브라우저로 바로 여는 완성 파일  (2) twinpro_test.html : 자동 테스트용(서버 대역 주입)
import json, os, sys
cfg = json.load(open('config.json')) if os.path.exists('config.json') else {'url': '__SUPABASE_URL__', 'anon': '__SUPABASE_ANON_KEY__'}
css = open('src/style.css', encoding='utf-8').read()
css += open('vendor/anatomy/kit/iso.css', encoding='utf-8').read()   # Anatomy 키트 스타일(MIT, .iso 안에서만 적용)
figs = {inc: open(f'figures/{d}/{d}.fragment.html', encoding='utf-8').read() for inc, d in (('INC003', 'eq03'), ('INC004', 'inc004'), ('INC005', 'inc005'))}   # 사건 설명도(node figures/<d>/build.mjs 로 생성)
fig_live = open('figures/live.js', encoding='utf-8').read()     # 설명도 공통 동작(분해·조립)
icons = open('icons.json', encoding='utf-8').read()
import base64, glob
eqart = {k: 'data:image/svg+xml;base64,' + base64.b64encode(open(f'assets/eqart/min_{f}.svg', 'rb').read()).decode() for k, f in [('b', 'lamp_run'), ('n', 'lamp_idle'), ('r', 'lamp_flt'), ('p', 'lamp_mnt')]}   # 신호등(상태 색, SVG)
eqart.update({k: 'data:image/webp;base64,' + base64.b64encode(open(f'assets/eq3d/{k}.webp', 'rb').read()).decode() for k in ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'SP']})   # 관제 지도 설비 그림: 3D 조선소 모델에서 공정별 설비만 떼어 투명 배경으로 렌더(tools/render_eq.js)
photo = {k: 'data:image/webp;base64,' + base64.b64encode(open(f'assets/photo/{k}.webp', 'rb').read()).decode() for k in ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'SP', 'block', 'ship_build', 'ship_done', 'io_modbus', 'io_etos']}   # 관리 화면 [그림] 보기의 실사형 예시 사진(AI 생성, 배경 제거)
thumbs = {os.path.basename(f)[6:9]: 'data:image/jpeg;base64,' + base64.b64encode(open(f, 'rb').read()).decode() for f in sorted(glob.glob('assets/thumb_*.jpg'))}   # 공정 썸네일(Blender 렌더)
js = '\n'.join(open(f'src/{f}', encoding='utf-8').read() for f in ['model.js', 'api.js', 'ui.js', 'pics.js', 'io.js', 'live.js', 'aic.js', 'motion.js', 't3d.js', 'plate3d.js', 'sim3d.js', 't3x.js', 'block3d.js'])
js = js.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
import hashlib
glbv = hashlib.md5(open(os.environ.get('TP_GLB_FILE', '../twinpro_shipyard.glb'), 'rb').read()).hexdigest()[:8]   # 모델이 바뀌면 주소가 바뀌어 브라우저가 예전 모델을 캐시에서 쓰지 않게
fav_svg = base64.b64encode(open('assets/icon/favicon.svg', 'rb').read()).decode()   # 탭 아이콘: 실제 블록(입체) + 디지털 쌍둥이(윤곽)
fav_png = {s: base64.b64encode(open(f'assets/icon/fav{s}.png', 'rb').read()).decode() for s in (32, 180)}
favicon = (f'<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,{fav_svg}">'
           f'<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,{fav_png[32]}">'
           f'<link rel="apple-touch-icon" href="data:image/png;base64,{fav_png[180]}"><meta name="theme-color" content="#0B1A33">')
def page(test):
    j = js.replace('__SUPABASE_URL__', cfg['url']).replace('__SUPABASE_ANON_KEY__', cfg['anon'])
    lib = '' if test else '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>'
    return f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>TWIN PRO 운영 모니터링</title>
{favicon}
<script type="importmap">{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}}}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{css}</style></head>
<body><div id="app" class="app"><div class="content" style="margin:40px">서버에서 데이터를 읽는 중…</div></div>
{lib}
<script>const ICONS = {icons};\nwindow.BK_THUMBS = {json.dumps(thumbs)};\nwindow.EQ_ART = {json.dumps(eqart)};\nwindow.EQ_PHOTO = {json.dumps(photo)};\nwindow.TP_GLB_V = '{glbv}';\nwindow.FIGS = {json.dumps(figs).replace("</", "<\\/")};
{fig_live}
{j}
boot();</script></body></html>'''
os.makedirs('dist', exist_ok=True)
import shutil
os.makedirs('dist/media', exist_ok=True)
for f in glob.glob('assets/media/*.mp4') + glob.glob('assets/media/*.webm'): shutil.copy(f, 'dist/media/')   # 공정 교육 재생 16배속 녹화 영상(index.html 옆 media 폴더에서 읽음)
open('dist/twinpro.html', 'w', encoding='utf-8').write(page(False))
open('dist/twinpro_test.html', 'w', encoding='utf-8').write(page(True))
print('built', os.path.getsize('dist/twinpro.html'))
