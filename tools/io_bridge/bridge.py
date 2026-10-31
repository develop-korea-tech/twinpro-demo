"""
TWIN PRO 연결 프로그램: 현장 장비 값 → 서버 입구(tp_ingest_signal)
- 개별 장비(LS XGT 계열 PLC): Modbus TCP로 Coil 00001(가동) · DI 10001(이상) · HR 40001(누적 수량)을 읽음
- 집약 라우팅 장비(AC&T ETOS 통신 서버): XGT FEnet(IP, 포트 2004)으로 설비마다 %MW 3개를 읽음
- 값이 바뀌면 신호로 바꿔 보냄: 가동 0→1 RUN · 1→0 STOP / 누적 수량 증가분 COUNT / 이상 0→1 FAULT
  (처음 읽은 값은 기준으로만 삼고 신호를 보내지 않음)
- 서버 주소·키·시연 코드는 파일에 쓰지 않고 환경 변수로 받음:
    TP_SUPABASE_URL  예) https://xxxx.supabase.co
    TP_SUPABASE_KEY  anon public 키
    TP_DEMO_CODE     시연 코드(조작 권한)
사용: python bridge.py [--config config_demo.json] [--interval 1] [--dry-run]
표준 라이브러리만 씁니다(설치할 것 없음).
"""
import argparse
import json
import os
import socket
import struct
import sys
import time
import urllib.request
from pathlib import Path


# ---------- Modbus TCP 클라이언트 ----------
class Modbus:
    def __init__(self, host, port, unit=1, timeout=2):
        self.addr, self.unit, self.timeout, self.sock, self.tid = (host, port), unit, timeout, None, 0

    def _req(self, fc, addr, qty):
        if self.sock is None:
            self.sock = socket.create_connection(self.addr, timeout=self.timeout)
        self.tid = (self.tid + 1) & 0xFFFF
        self.sock.sendall(struct.pack('>HHHBBHH', self.tid, 0, 6, self.unit, fc, addr, qty))
        hdr = self._recv(7)
        length = struct.unpack('>H', hdr[4:6])[0]
        pdu = self._recv(length - 1)
        if pdu[0] & 0x80:
            raise IOError(f'Modbus 예외 응답(기능 {fc})')
        return pdu[2:2 + pdu[1]]

    def _recv(self, n):
        b = b''
        while len(b) < n:
            c = self.sock.recv(n - len(b))
            if not c:
                raise IOError('연결이 끊겼습니다')
            b += c
        return b

    def bit(self, fc, addr):                 # fc 1 = Coil, 2 = DI
        return self._req(fc, addr, 1)[0] & 1

    def reg(self, addr):                     # fc 3 = Holding Register
        return struct.unpack('>H', self._req(3, addr, 1))[0]

    def close(self):
        if self.sock:
            self.sock.close()
        self.sock = None


# ---------- XGT FEnet 클라이언트(ETOS) ----------
class Fenet:
    COMPANY = b'LSIS-XGT\x00\x00'

    def __init__(self, host, port, timeout=2):
        self.addr, self.timeout, self.sock, self.inv = (host, port), timeout, None, 0

    def read_words(self, mw, count):        # %MW mw부터 count개 연속 읽기
        if self.sock is None:
            self.sock = socket.create_connection(self.addr, timeout=self.timeout)
        name = f'%MB{mw * 2}'.encode()
        body = struct.pack('<HHHHH', 0x54, 0x14, 0, 1, len(name)) + name + struct.pack('<H', count * 2)
        self.inv = (self.inv + 1) & 0xFFFF
        hdr = self.COMPANY + b'\x00\x00' + b'\x00' + b'\x33' + struct.pack('<HH', self.inv, len(body)) + b'\x00'
        self.sock.sendall(hdr + bytes([sum(hdr) & 0xFF]) + body)
        rh = self._recv(20)
        rb = self._recv(struct.unpack('<H', rh[16:18])[0])
        if struct.unpack('<H', rb[6:8])[0] != 0:
            raise IOError('ETOS 오류 응답')
        n = struct.unpack('<H', rb[10:12])[0]
        return [struct.unpack('<H', rb[12 + 2 * i:14 + 2 * i])[0] for i in range(n // 2)]

    _recv = Modbus._recv

    def close(self):
        Modbus.close(self)


# ---------- 서버 입구 ----------
def send(sig, dry):
    if dry:
        print('  (보내지 않음 --dry-run)', sig)
        return
    url, key, code = os.environ.get('TP_SUPABASE_URL'), os.environ.get('TP_SUPABASE_KEY'), os.environ.get('TP_DEMO_CODE')
    req = urllib.request.Request(url.rstrip('/') + '/rest/v1/rpc/tp_ingest_signal', data=json.dumps(sig).encode(), method='POST',
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'x-demo-code': code, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        res = json.loads(r.read().decode() or '{}')
    print('  서버:', res.get('msg', res))


def changes(prev, cur, eq, src):
    """이전 값과 지금 값을 비교해 보낼 신호 목록을 만든다."""
    out = []
    if prev is None:
        return out
    if cur['alm'] and not prev['alm']:
        out.append({'p_eq': eq, 'p_signal': 'FAULT', 'p_value': None, 'p_source': src})
    if cur['run'] != prev['run'] and not cur['alm']:
        out.append({'p_eq': eq, 'p_signal': 'RUN' if cur['run'] else 'STOP', 'p_value': None, 'p_source': src})
    d = (cur['cnt'] - prev['cnt']) & 0xFFFF   # 16비트 누적값이 넘어가도(65535 → 0) 증가분 계산
    if d and d < 0x8000:
        out.append({'p_eq': eq, 'p_signal': 'COUNT', 'p_value': d, 'p_source': src})
    return out


def main():
    ap = argparse.ArgumentParser(description='TWIN PRO 연결 프로그램(Modbus TCP · ETOS → tp_ingest_signal)')
    ap.add_argument('--config', default=str(Path(__file__).with_name('config_demo.json')))
    ap.add_argument('--interval', type=float, default=1.0, help='읽는 주기(초)')
    ap.add_argument('--dry-run', action='store_true', help='서버로 보내지 않고 화면에만 출력')
    ap.add_argument('--count', type=int, default=0, help='N번 읽고 끝냄(0 = 계속)')
    a = ap.parse_args()
    if not a.dry_run and not all(os.environ.get(k) for k in ('TP_SUPABASE_URL', 'TP_SUPABASE_KEY', 'TP_DEMO_CODE')):
        sys.exit('환경 변수 TP_SUPABASE_URL · TP_SUPABASE_KEY · TP_DEMO_CODE를 먼저 설정하세요(README 참고). 확인만 하려면 --dry-run')
    cfg = json.loads(Path(a.config).read_text(encoding='utf-8'))
    etos = Fenet(cfg['etos']['host'], cfg['etos']['port'])
    mb = {d['equipment_id']: Modbus(d['host'], d['port'], d.get('unit', 1)) for d in cfg['devices'] if d['route'] == 'MODBUS'}
    prev, n = {}, 0
    print(f"연결 프로그램 시작: Modbus {len(mb)}대 · ETOS {cfg['etos']['host']}:{cfg['etos']['port']} · {a.interval}초마다")
    while True:
        for d in cfg['devices']:
            eq = d['equipment_id']
            try:
                if d['route'] == 'MODBUS':
                    c = mb[eq]
                    cur = {'run': c.bit(1, 0), 'alm': c.bit(2, 0), 'cnt': c.reg(0)}
                else:
                    w = etos.read_words(d['mw'], 3)
                    cur = {'run': w[0] & 1, 'cnt': w[1], 'alm': w[2] & 1}
            except OSError as e:
                print(f'{eq} 읽기 실패: {e}')
                (mb.get(eq) or etos).close()
                continue
            for sig in changes(prev.get(eq), cur, eq, d['route']):
                print(f"{time.strftime('%H:%M:%S')} {eq} {d['route']} → {sig['p_signal']}{'' if sig['p_value'] is None else ' ' + str(sig['p_value'])}")
                try:
                    send(sig, a.dry_run)
                except Exception as e:   # 서버 오류여도 읽기는 계속
                    print('  서버로 보내지 못했습니다:', e)
            prev[eq] = cur
        n += 1
        if a.count and n >= a.count:
            break
        time.sleep(a.interval)


if __name__ == '__main__':
    main()
