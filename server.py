# -*- coding: utf-8 -*-
"""동해카라반펜션 홈페이지 서버 (사진/동영상 업로드 + 예약관리)

실행:  python server.py
접속:  http://<PC IP>:8000                    (홈페이지)
       http://<PC IP>:8000/admin.html         (사진 관리)
       http://<PC IP>:8000/booking-admin.html (예약 관리)
       http://<PC IP>:8000/reserve.html       (손님 예약 페이지)
"""
import glob
import json
import os
import re
import secrets
import shutil
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import booking

PORT = int(os.environ.get('DHC_PORT', 8000))
TOKENS = set()  # 로그인 성공 시 발급되는 인증 토큰 (서버 재시작 시 초기화)

# ──────────────────────────────────────────────
#  관리자 로그인 정보는 admin_config.json 파일에 있습니다.
#  (이 파일은 인터넷에 올라가지 않습니다 — .gitignore 처리됨)
#  아이디/비밀번호를 바꾸려면 admin_config.json 을 수정하고
#  서버를 재시작하세요.
# ──────────────────────────────────────────────
_ROOT_EARLY = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(_ROOT_EARLY, 'admin_config.json')
if not os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as _f:
        json.dump({'id': 'admin', 'pw': 'dh1415!'}, _f, ensure_ascii=False, indent=2)
with open(CONFIG_FILE, encoding='utf-8') as _f:
    _cfg = json.load(_f)
ADMIN_ID = _cfg.get('id', 'admin')
ADMIN_PW = _cfg.get('pw', '')
ROOT = os.path.dirname(os.path.abspath(__file__))
ROOMS_DIR = os.path.join(ROOT, 'images', 'rooms')
GALLERY_DIR = os.path.join(ROOT, 'images', 'photos')
ROOM_IDS = {'adora', 'harby', 'pursuit', 'gureum', 'bada', 'mujigae', 'deckzone'}
MAX_PHOTO = 20 * 1024 * 1024    # 20MB (브라우저에서 이미 압축돼서 옴)
MAX_VIDEO = 500 * 1024 * 1024   # 500MB

PHOTO_RE = re.compile(r'^\d+\.jpg$')

# 인터넷에 공개해도 되는 파일만 허용 (admin_config.json, private/, .git 등은 차단)
PUBLIC_FILES = {'/', '/index.html', '/admin.html', '/booking-admin.html', '/reserve.html',
                '/robots.txt', '/sitemap.xml', '/favicon.ico'}
PUBLIC_DIRS = ('/css/', '/js/', '/images/', '/data/')


def find_ffmpeg():
    """ffmpeg 실행 파일 찾기 (PATH → winget 설치 경로 순)"""
    path = shutil.which('ffmpeg')
    if path:
        return path
    pattern = os.path.join(os.environ.get('LOCALAPPDATA', ''),
                           'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg*', '*', 'bin', 'ffmpeg.exe')
    hits = glob.glob(pattern)
    return hits[0] if hits else None


FFMPEG = find_ffmpeg()


def compress_video(src, dst):
    """동영상을 720p H.264로 압축. 성공하면 True.
    (세로 영상도 긴 쪽 기준으로 자동 축소됨)"""
    if not FFMPEG:
        return False
    cmd = [
        FFMPEG, '-y', '-i', src,
        '-vf', "scale=-2:'min(720\\,ih)'",
        '-c:v', 'libx264', '-crf', '28', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        dst,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=600)
        return result.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def list_photos(room_dir):
    if not os.path.isdir(room_dir):
        return []
    files = [f for f in os.listdir(room_dir) if PHOTO_RE.fullmatch(f)]
    return sorted(files, key=lambda f: int(f.split('.')[0]))


def renumber_photos(room_dir):
    """사진을 1.jpg, 2.jpg ... 로 빈틈없이 다시 번호 매김"""
    photos = list_photos(room_dir)
    # 임시 이름으로 옮긴 뒤 순서대로 재배치 (충돌 방지)
    for i, f in enumerate(photos):
        os.replace(os.path.join(room_dir, f), os.path.join(room_dir, f'__tmp_{i}.jpg'))
    for i in range(len(photos)):
        os.replace(os.path.join(room_dir, f'__tmp_{i}.jpg'), os.path.join(room_dir, f'{i + 1}.jpg'))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 객실 사진/영상과 API 는 항상 최신으로
        if self.path.startswith(('/images/rooms/', '/images/photos/', '/images/popup', '/data/', '/api/')):
            self.send_header('Cache-Control', 'no-store')
        if self.path.startswith('/api/public/'):
            self._cors()
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return self.headers.get('X-Auth-Token', '') in TOKENS

    def _client_ip(self):
        # Cloudflare Tunnel / Tailscale Funnel 을 거치면 실제 손님 IP 는 헤더에 있음
        ip = self.client_address[0]
        if ip in ('127.0.0.1', '::1'):
            if self.headers.get('CF-Connecting-IP'):
                return self.headers['CF-Connecting-IP']
            if self.headers.get('X-Forwarded-For'):
                return self.headers['X-Forwarded-For'].split(',')[0].strip()
        return ip

    def _read_body(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 1024 * 1024:
                return None
            return json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
        except (ValueError, json.JSONDecodeError):
            return None

    def _cors(self):
        # GitHub Pages 홈페이지에서 예약 API 를 부를 수 있도록 허용
        origin = self.headers.get('Origin', '')
        if origin and origin in booking.load_settings().get('allowOrigins', []):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

    def _booking(self, method, parsed, body):
        """예약 API 처리. 처리했으면 True"""
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            if path.startswith('/api/public/'):
                code, obj = booking.handle_public(method, path, query, body or {}, self._client_ip())
                return self._json(code, obj) or True
            if path.startswith('/api/bk/'):
                if not self._authed():
                    return self._json(401, {'error': '로그인이 필요합니다'}) or True
                res = booking.handle_admin(method, path, query, body or {})
                if res[0] == 'file':
                    _, data, ctype, fname = res
                    self.send_response(200)
                    self.send_header('Content-Type', ctype)
                    self.send_header('Content-Disposition', f'attachment; filename="{fname}"')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return True
                return self._json(*res) or True
        except booking.BookingError as e:
            return self._json(400, {'error': str(e)}) or True
        except (KeyError, ValueError, TypeError) as e:
            return self._json(400, {'error': f'잘못된 요청입니다 ({e})'}) or True
        return False

    def do_OPTIONS(self):
        self.send_response(204)  # 허용 주소(Origin) 헤더는 end_headers 에서 붙임
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def _room_dir(self, query):
        room = query.get('room', [None])[0]
        if room == 'gallery':
            d = GALLERY_DIR
        elif room in ROOM_IDS:
            d = os.path.join(ROOMS_DIR, room)
        else:
            return None, None
        os.makedirs(d, exist_ok=True)
        return room, d

    # ---------- 목록 조회 ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/media':
            if not self._authed():
                return self._json(401, {'error': '로그인이 필요합니다'})
            room, d = self._room_dir(parse_qs(parsed.query))
            if not room:
                return self._json(400, {'error': '잘못된 객실'})
            video = os.path.join(d, 'video.mp4')
            return self._json(200, {
                'photos': list_photos(d),
                'video': 'video.mp4' if os.path.exists(video) else None,
                'videoSize': os.path.getsize(video) if os.path.exists(video) else 0,
            })
        if parsed.path.startswith('/api/'):
            if not self._booking('GET', parsed, None):
                self._json(404, {'error': '알 수 없는 요청'})
            return
        if parsed.path not in PUBLIC_FILES and not parsed.path.startswith(PUBLIC_DIRS):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path not in PUBLIC_FILES and not parsed.path.startswith(PUBLIC_DIRS):
            return self.send_error(404)
        return super().do_HEAD()

    # ---------- 업로드 / 삭제 ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        # ---------- 고객 명단 파일 가져오기 (엑셀/CSV 원본 그대로 받음) ----------
        if parsed.path == '/api/bk/customers/import':
            if not self._authed():
                return self._json(401, {'error': '로그인이 필요합니다'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            if length <= 0 or length > MAX_PHOTO:
                return self._json(400, {'error': '파일이 비어 있거나 너무 큽니다'})
            try:
                result = booking.import_customers(self.rfile.read(length), query.get('name', [''])[0])
            except booking.BookingError as e:
                return self._json(400, {'error': str(e)})
            except Exception as e:  # 손상된 파일 등
                return self._json(400, {'error': f'파일을 읽을 수 없습니다 ({e})'})
            return self._json(200, result)

        # ---------- 예약 API (손님용 / 관리자용) ----------
        if parsed.path.startswith(('/api/public/', '/api/bk/')):
            body = self._read_body()
            if body is None:
                return self._json(400, {'error': '잘못된 요청'})
            self._booking('POST', parsed, body)
            return

        # ---------- 로그인 ----------
        if parsed.path == '/api/login':
            if booking.rate_limited('login:' + self._client_ip(), 10, 600):
                return self._json(429, {'error': '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(length).decode('utf-8'))
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {'error': '잘못된 요청'})
            if body.get('id') == ADMIN_ID and body.get('pw') == ADMIN_PW:
                token = secrets.token_hex(24)
                TOKENS.add(token)
                return self._json(200, {'token': token})
            return self._json(401, {'error': '아이디 또는 비밀번호가 올바르지 않습니다'})

        if not self._authed():
            return self._json(401, {'error': '로그인이 필요합니다'})

        # ---------- 요금 저장 ----------
        if parsed.path == '/api/prices':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                data = json.loads(self.rfile.read(length).decode('utf-8'))
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {'error': '잘못된 요금 데이터'})
            if 'rooms' not in data:
                return self._json(400, {'error': '잘못된 요금 데이터'})
            os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
            with open(os.path.join(ROOT, 'data', 'prices.json'), 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return self._json(200, {'ok': True})

        # ---------- 팝업 저장 ----------
        if parsed.path == '/api/popup':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                data = json.loads(self.rfile.read(length).decode('utf-8'))
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {'error': '잘못된 팝업 데이터'})
            if 'enabled' not in data:
                return self._json(400, {'error': '잘못된 팝업 데이터'})
            os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
            with open(os.path.join(ROOT, 'data', 'popup.json'), 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return self._json(200, {'ok': True})

        # ---------- 팝업 이미지 업로드 ----------
        if parsed.path == '/api/upload-popup':
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            if length <= 0 or length > MAX_PHOTO:
                return self._json(400, {'error': '잘못된 이미지'})
            data = self.rfile.read(length)
            with open(os.path.join(ROOT, 'images', 'popup.jpg'), 'wb') as f:
                f.write(data)
            return self._json(200, {'ok': True, 'path': 'images/popup.jpg'})

        room, d = self._room_dir(query)
        if not room:
            return self._json(400, {'error': '잘못된 객실'})

        if parsed.path == '/api/upload':
            kind = query.get('type', ['photo'])[0]
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            limit = MAX_VIDEO if kind == 'video' else MAX_PHOTO
            if length <= 0:
                return self._json(400, {'error': '파일이 비어 있습니다'})
            if length > limit:
                return self._json(413, {'error': f'파일이 너무 큽니다 (최대 {limit // (1024 * 1024)}MB)'})

            remaining = length
            chunks = []
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1024 * 1024))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            data = b''.join(chunks)
            if len(data) != length:
                return self._json(400, {'error': '업로드가 중단되었습니다'})

            if kind == 'video':
                final = os.path.join(d, 'video.mp4')
                raw = os.path.join(d, '_upload_raw.mp4')
                with open(raw, 'wb') as f:
                    f.write(data)
                # ffmpeg 자동 압축 (720p H.264) — 압축본이 더 크면 원본 유지
                tmp = os.path.join(d, '_compressed.mp4')
                original_size = len(data)
                if compress_video(raw, tmp) and os.path.getsize(tmp) < original_size:
                    os.replace(tmp, final)
                    os.remove(raw)
                else:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                    os.replace(raw, final)
                final_size = os.path.getsize(final)
                return self._json(200, {
                    'ok': True, 'file': 'video.mp4',
                    'originalMB': round(original_size / 1024 / 1024, 1),
                    'finalMB': round(final_size / 1024 / 1024, 1),
                    'compressed': final_size < original_size,
                })

            photos = list_photos(d)
            next_no = int(photos[-1].split('.')[0]) + 1 if photos else 1
            fname = f'{next_no}.jpg'
            with open(os.path.join(d, fname), 'wb') as f:
                f.write(data)
            return self._json(200, {'ok': True, 'file': fname})

        if parsed.path == '/api/delete':
            fname = query.get('file', [''])[0]
            target = os.path.join(d, fname)
            if fname == 'video.mp4':
                if os.path.exists(target):
                    os.remove(target)
                return self._json(200, {'ok': True})
            if PHOTO_RE.fullmatch(fname):
                if os.path.exists(target):
                    os.remove(target)
                    renumber_photos(d)  # 번호 빈틈 없이 재정렬
                return self._json(200, {'ok': True})
            return self._json(400, {'error': '잘못된 파일 이름'})

        return self._json(404, {'error': '알 수 없는 요청'})

    def log_message(self, fmt, *args):
        # 업로드/삭제만 콘솔에 표시
        if '/api/' in str(args[0] if args else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    booking.start_worker()  # 입금기한 초과 자동취소 · 입실 전날 안내문자
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'동해카라반펜션 서버 실행 중 → http://localhost:{PORT}')
    print(f'사진 관리 페이지 → http://localhost:{PORT}/admin.html')
    print(f'예약 관리 페이지 → http://localhost:{PORT}/booking-admin.html')
    server.serve_forever()
