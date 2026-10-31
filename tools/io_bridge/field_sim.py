"""
가상 현장 장비 (시연·테스트용)
- 개별 장비 5대(EQ01·03·05·07·08): LS XGT 계열 PLC를 흉내 낸 Modbus TCP 서버
    Coil 00001 = 가동(1)/정지(0), DI 10001 = 이상(1), HR 40001 = 누적 생산 수량
- 집약 라우팅 장비 1대: AC&T ETOS 통신 서버를 흉내 낸 XGT FEnet 서버
    설비마다 %MW 3개: 가동(0/1) · 누적 수량 · 이상(0/1)  (EQ02 → %MW200~202, EQ04 → %MW400~402, EQ06 → %MW600~602)

사용: python field_sim.py [--config config_demo.json] [--auto 10]
  실행 후 아래 명령을 입력해 장비 값을 바꿉니다(연결 프로그램 bridge.py가 이 변화를 신호로 바꿔 서버로 보냄).
    run EQ03       가동 비트 1      stop EQ03   가동 비트 0
    count EQ01 5   누적 수량 +5     fault EQ03  이상 비트 1     clear EQ03  이상 비트 0
    show           현재 값 보기      quit        종료
  --auto N : N초마다 가동 중인 장비의 누적 수량을 1씩 올림
표준 라이브러리만 씁니다(설치할 것 없음).
"""
import argparse
import json
import socket
import struct
import threading
import time
from pathlib import Path

LOCK = threading.Lock()
DEV = {}      # 설비 → {'run': 0/1, 'cnt': int, 'alm': 0/1}
ETOS_MW = {}  # ETOS 메모리 %MW 번호 → 값


def etos_sync():
    for eq, d in DEV.items():
        if d['route'] == 'ETOS':
            b = d['mw']
            ETOS_MW[b], ETOS_MW[b + 1], ETOS_MW[b + 2] = d['run'], d['cnt'] & 0xFFFF, d['alm']


# ---------- Modbus TCP 서버(기능 01 코일 · 02 입력 · 03 보유 레지스터) ----------
def modbus_handle(conn, eq):
    with conn:
        while True:
            hdr = conn.recv(7)
            if len(hdr) < 7:
                return
            tid, pid, length, unit = struct.unpack('>HHHB', hdr)
            pdu = conn.recv(length - 1)
            fc, addr, qty = struct.unpack('>BHH', pdu[:5])
            with LOCK:
                d = DEV[eq]
                if fc in (1, 2):
                    bit = d['run'] if fc == 1 else d['alm']
                    bits = [bit if addr + i == 0 else 0 for i in range(qty)]
                    data = bytearray((qty + 7) // 8)
                    for i, b in enumerate(bits):
                        data[i // 8] |= b << (i % 8)
                    body = struct.pack('>BB', fc, len(data)) + bytes(data)
                elif fc == 3:
                    regs = [d['cnt'] & 0xFFFF if addr + i == 0 else 0 for i in range(qty)]
                    body = struct.pack('>BB', fc, qty * 2) + b''.join(struct.pack('>H', r) for r in regs)
                else:
                    body = struct.pack('>BB', fc | 0x80, 1)   # 지원하지 않는 기능
            conn.sendall(struct.pack('>HHHB', tid, 0, len(body) + 1, unit) + body)


# ---------- XGT FEnet 서버(ETOS) : 연속 읽기 0x54 / 0x14 ----------
def etos_handle(conn):
    with conn:
        while True:
            hdr = conn.recv(20)
            if len(hdr) < 20:
                return
            blen = struct.unpack('<H', hdr[16:18])[0]
            body = conn.recv(blen)
            cmd, dtype = struct.unpack('<HH', body[:4])
            if cmd == 0x54 and dtype == 0x14:
                nlen = struct.unpack('<H', body[8:10])[0]
                name = body[10:10 + nlen].decode()            # 예: %MB400 (바이트 주소) = %MW200
                start = int(name[3:]) // 2
                nbytes = struct.unpack('<H', body[10 + nlen:12 + nlen])[0]
                with LOCK:
                    data = b''.join(struct.pack('<H', ETOS_MW.get(start + i, 0)) for i in range(nbytes // 2))
                rbody = struct.pack('<HHHHHH', 0x55, 0x14, 0, 0, 1, len(data)) + data
            else:
                rbody = struct.pack('<HHHHH', cmd + 1, dtype, 0, 0xFFFF, 1)
            rhdr = hdr[:10] + b'\x00\x00' + b'\xA0' + b'\x11' + hdr[14:16] + struct.pack('<H', len(rbody)) + b'\x00'
            conn.sendall(rhdr + bytes([sum(rhdr) & 0xFF]) + rbody)


def serve(port, handler, *args):
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', port))
    srv.listen(5)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handler, args=(c, *args), daemon=True).start()


def command(line):
    p = line.split()
    if not p:
        return ''
    op = p[0].lower()
    if op == 'show':
        with LOCK:
            return '\n'.join(f"{eq} {d['route']:6} 가동={d['run']} 누적={d['cnt']} 이상={d['alm']}" for eq, d in DEV.items())
    if len(p) < 2 or p[1].upper() not in DEV:
        return '설비 코드를 확인하세요(예: run EQ03)'
    eq = p[1].upper()
    with LOCK:
        d = DEV[eq]
        if op == 'run':
            d['run'] = 1
        elif op == 'stop':
            d['run'] = 0
        elif op == 'count':
            d['cnt'] += int(p[2]) if len(p) > 2 else 1
        elif op == 'fault':
            d['alm'] = 1
        elif op == 'clear':
            d['alm'] = 0
        else:
            return '알 수 없는 명령입니다'
        etos_sync()
        return f"{eq} 가동={d['run']} 누적={d['cnt']} 이상={d['alm']}"


def main():
    ap = argparse.ArgumentParser(description='가상 현장 장비(Modbus TCP PLC 5대 + ETOS 통신 서버 1대)')
    ap.add_argument('--config', default=str(Path(__file__).with_name('config_demo.json')))
    ap.add_argument('--auto', type=float, default=0, help='N초마다 가동 중 장비 누적 수량 +1')
    ap.add_argument('--no-console', action='store_true', help='명령 입력 없이 실행(테스트용)')
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text(encoding='utf-8'))
    for d in cfg['devices']:
        DEV[d['equipment_id']] = {'route': d['route'], 'run': d.get('init_run', 0), 'cnt': 0, 'alm': 0, 'mw': d.get('mw', 0)}
        if d['route'] == 'MODBUS':
            threading.Thread(target=serve, args=(d['port'], modbus_handle, d['equipment_id']), daemon=True).start()
    etos_sync()
    threading.Thread(target=serve, args=(cfg['etos']['port'], etos_handle), daemon=True).start()
    print(f"가상 현장 장비 실행: Modbus {sum(d['route'] == 'MODBUS' for d in cfg['devices'])}대 · ETOS 1대(포트 {cfg['etos']['port']})")
    if a.auto:
        def tick():
            while True:
                time.sleep(a.auto)
                with LOCK:
                    for d in DEV.values():
                        if d['run']:
                            d['cnt'] += 1
                    etos_sync()
        threading.Thread(target=tick, daemon=True).start()
    if a.no_console:
        while True:
            time.sleep(3600)
    print('명령: run · stop · count · fault · clear <설비> / show / quit')
    while True:
        try:
            line = input('> ')
        except EOFError:
            break
        if line.strip().lower() in ('quit', 'exit'):
            break
        print(command(line))


if __name__ == '__main__':
    main()
