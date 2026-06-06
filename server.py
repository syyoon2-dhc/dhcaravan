# -*- coding: utf-8 -*-
"""동해카라반펜션 홈페이지 서버 (사진/동영상 업로드 지원)

실행:  python server.py
접속:  http://<PC IP>:8000          (홈페이지)
       http://<PC IP>:8000/admin.html (사진 관리)
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

PORT = 8000
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
        if self.path.startswith(('/images/rooms/', '/images/photos/', '/api/')):
            self.send_header('Cache-Control', 'no-store')
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
        return super().do_GET()

    # ---------- 업로드 / 삭제 ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        # ---------- 로그인 ----------
        if parsed.path == '/api/login':
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
        if '/api/' in (args[0] if args else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'동해카라반펜션 서버 실행 중 → http://localhost:{PORT}')
    print(f'사진 관리 페이지 → http://localhost:{PORT}/admin.html')
    server.serve_forever()
