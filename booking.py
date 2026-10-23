# -*- coding: utf-8 -*-
"""동해카라반펜션 예약관리 모듈 (server.py 에서 불러서 사용)

데이터 위치 (모두 private/ 폴더 — 인터넷/GitHub 에 올라가지 않음)
  private/booking.db             예약 · 문자 발송 기록 (SQLite)
  private/booking_settings.json  입금계좌, 입금기한, 알리고 문자 설정, 문자 문구

요금 · 성수기 기간 · 공휴일은 data/prices.json 을 그대로 사용합니다.
"""
import io
import json
import os
import random
import re
import sqlite3
import string
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.abspath(__file__))
PRIVATE_DIR = os.environ.get('DHC_PRIVATE_DIR') or os.path.join(ROOT, 'private')
DB_FILE = os.path.join(PRIVATE_DIR, 'booking.db')
SETTINGS_FILE = os.path.join(PRIVATE_DIR, 'booking_settings.json')
PRICES_FILE = os.path.join(ROOT, 'data', 'prices.json')

ACTIVE = ('pending', 'confirmed', 'block')  # 객실을 차지하는 상태
STATUS_LABEL = {'pending': '입금대기', 'confirmed': '예약확정', 'cancelled': '취소', 'block': '예약막음'}
SOURCES = ('홈페이지', '전화', '현장', '땡큐캠핑', '기타')
WEEKDAY = '월화수목금토일'

DEFAULT_SETTINGS = {
    'bookingOpen': True,           # 홈페이지 예약 받기
    'bank': '',                    # 입금 계좌 (예: 농협 000-0000-0000-00 홍길동) — 비어 있으면 예약 안 받음
    'depositHours': 3,             # 예약 후 입금 기한 (시간)
    'maxDaysAhead': 180,           # 며칠 뒤까지 예약 받을지
    'openUntil': '',               # 이 날짜 숙박까지만 예약 오픈 (비우면 maxDaysAhead 기준)
    'maxNights': 6,                # 1회 최대 박수
    'maxRooms': 6,                 # 1회 최대 객실 수
    'phone': '010-4589-1415',      # 펜션 대표 번호 (문자 문구에 사용)
    'adminPhone': '010-4589-1415', # 새 예약 알림 받을 번호
    'adminNotify': True,
    'reminderHour': 10,            # 입실 전날 안내 문자 보내는 시각
    'units': {},                   # 객실별 동시 예약 가능 수 (기본 1) 예: {"deckzone": 3}
    'refundPolicy': '이용 7일 전: 100% 환불\n이용 5~6일 전: 70% 환불\n이용 3~4일 전: 50% 환불\n'
                    '이용 1~2일 전 · 당일: 환불 불가\n(천재지변 등 불가항력 시 별도 협의)',
    'notice': '입실 15:00 / 퇴실 11:00\n매너타임 22:00 ~ 07:00 (고성방가 · 소음 자제)\n'
              '카라반 · 객실 내부는 금연입니다.\n인원 추가는 영·유아를 포함한 인원 기준입니다.',
    'allowOrigins': ['https://syyoon2-dhc.github.io'],
    'aligo': {'enabled': False, 'key': '', 'userId': '', 'sender': '', 'testmode': False},
    'auto': {'received': True, 'confirmed': True, 'cancelled': True, 'expired': True, 'reminder': True},
    'templates': {
        'received': '[동해카라반펜션] {이름}님 예약이 접수되었습니다.\n'
                    '예약번호: {예약번호}\n객실: {객실}\n일정: {입실}~{퇴실} ({박}박)\n'
                    '금액: {금액}원\n입금계좌: {계좌}\n'
                    '{입금기한}까지 입금해 주셔야 예약이 확정됩니다. (미입금 시 자동 취소)',
        'confirmed': '[동해카라반펜션] {이름}님 입금이 확인되어 예약이 확정되었습니다.\n'
                     '{객실} / {입실}~{퇴실} ({박}박)\n입실 15:00 / 퇴실 11:00\n문의 {펜션전화}',
        'cancelled': '[동해카라반펜션] {이름}님 예약({예약번호})이 취소되었습니다.\n문의 {펜션전화}',
        'expired': '[동해카라반펜션] 입금 기한이 지나 예약({예약번호})이 자동 취소되었습니다.\n'
                   '다시 예약을 원하시면 홈페이지 또는 {펜션전화}로 문의해 주세요.',
        'reminder': '[동해카라반펜션] {이름}님, 내일 {입실} 입실 예정입니다.\n'
                    '입실은 15:00부터 가능합니다.\n주소: 울산 울주군 온산읍 강양길 162\n문의 {펜션전화}',
        'admin': '[새 예약] {이름} {연락처}\n{객실}\n{입실}~{퇴실} {인원}명\n{금액}원 (입금대기)',
    },
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  group_code TEXT NOT NULL DEFAULT '',
  room_id TEXT NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  guests INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  request TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  room_amount INTEGER NOT NULL DEFAULT 0,
  extra_amount INTEGER NOT NULL DEFAULT 0,
  option_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  refund INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '홈페이지',
  deadline TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_res_dates ON reservations(room_id, checkin, checkout);
CREATE INDEX IF NOT EXISTS idx_res_group ON reservations(group_code);
CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  reservation_id INTEGER,
  phone TEXT NOT NULL,
  kind TEXT NOT NULL,
  msg TEXT NOT NULL,
  ok INTEGER NOT NULL,
  result TEXT NOT NULL DEFAULT ''
);
"""


class BookingError(Exception):
    """손님/관리자에게 그대로 보여줄 오류"""


_lock = threading.RLock()
_conn = None


def db():
    global _conn
    if _conn is None:
        os.makedirs(PRIVATE_DIR, exist_ok=True)
        _conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
    return _conn


def now_str():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


# ──────────────────────────────────────────────
#  설정
# ──────────────────────────────────────────────
def load_settings():
    s = json.loads(json.dumps(DEFAULT_SETTINGS))
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, encoding='utf-8') as f:
            saved = json.load(f)
        for k, v in saved.items():
            if isinstance(v, dict) and isinstance(s.get(k), dict) and k != 'units':
                s[k].update(v)
            else:
                s[k] = v
    return s


def save_settings(data):
    s = load_settings()
    for k in DEFAULT_SETTINGS:
        if k in data:
            if isinstance(DEFAULT_SETTINGS[k], dict) and k != 'units':
                s[k].update(data[k] or {})
            else:
                s[k] = data[k]
    s['depositHours'] = max(1, int(s.get('depositHours') or 3))
    s['maxDaysAhead'] = max(1, int(s.get('maxDaysAhead') or 180))
    s['maxNights'] = max(1, int(s.get('maxNights') or 6))
    s['maxRooms'] = max(1, int(s.get('maxRooms') or 6))
    s['reminderHour'] = min(23, max(0, int(s.get('reminderHour') or 10)))
    s['units'] = {k: max(1, int(v)) for k, v in (s.get('units') or {}).items() if str(v).strip()}
    if s.get('openUntil'):
        parse_date(s['openUntil'], '예약 오픈 마감일')
    os.makedirs(PRIVATE_DIR, exist_ok=True)
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    return s


# ──────────────────────────────────────────────
#  요금 계산
# ──────────────────────────────────────────────
def load_prices():
    with open(PRICES_FILE, encoding='utf-8') as f:
        return json.load(f)


def parse_won(s):
    """'30,000원' -> 30000, '무료' -> 0"""
    digits = re.sub(r'[^\d]', '', str(s))
    return int(digits) if digits else 0


def extra_person_fee(room):
    """인원 추가 요금 (1인 1박). extraPerson 값이 없으면 비고 문구에서 읽음"""
    if room.get('extraPerson') not in (None, ''):
        return int(room['extraPerson'])
    m = re.search(r'([\d,]+)\s*원', room.get('extra', ''))
    return parse_won(m.group(1)) if m else 0


def paid_options(prices):
    """유료 옵션 목록 (인덱스 포함)"""
    return [dict(o, i=i, amount=parse_won(o.get('price')))
            for i, o in enumerate(prices.get('options', [])) if parse_won(o.get('price')) > 0]


def day_info(prices, d):
    """(성수기 여부, 주말 요금 여부)
    주말 = 토요일 · 공휴일 전날 · 성수기 금요일 (비수기 금요일은 평일 요금)"""
    ds = d.isoformat()
    peak = any(p.get('start', '') <= ds <= p.get('end', '') for p in prices.get('peakPeriods', []))
    before_holiday = (d + timedelta(days=1)).isoformat() in set(prices.get('holidays', []))
    wd = d.weekday()
    weekend = wd == 5 or before_holiday or (peak and wd == 4)
    return peak, weekend


def night_price(prices, room, d):
    peak, weekend = day_info(prices, d)
    return room['price']['peak' if peak else 'normal'][1 if weekend else 0], peak, weekend


def get_room(prices, room_id):
    for r in prices['rooms']:
        if r['id'] == room_id:
            return r
    raise BookingError('객실을 찾을 수 없습니다')


def parse_date(s, label='날짜'):
    try:
        return date.fromisoformat(str(s))
    except ValueError:
        raise BookingError(f'{label} 형식이 올바르지 않습니다')


def quote(room_id, checkin, checkout, guests, options=None, prices=None, max_nights=60):
    """요금 계산. options = [{'i': 옵션번호, 'qty': 수량}]"""
    prices = prices or load_prices()
    room = get_room(prices, room_id)
    ci, co = parse_date(checkin, '입실일'), parse_date(checkout, '퇴실일')
    nights_n = (co - ci).days
    if nights_n < 1:
        raise BookingError('퇴실일은 입실일 다음 날 이후여야 합니다')
    if nights_n > max_nights:
        raise BookingError(f'최대 {max_nights}박까지 예약할 수 있습니다')
    try:
        guests = int(guests or 0)
    except ValueError:
        guests = 0
    if guests < 1:
        raise BookingError('인원을 선택해 주세요')
    if guests > room['max']:
        raise BookingError(f'{room["name"]}은(는) 최대 {room["max"]}명까지 이용할 수 있습니다')

    nights = []
    for k in range(nights_n):
        d = ci + timedelta(days=k)
        p, peak, weekend = night_price(prices, room, d)
        nights.append({'date': d.isoformat(), 'price': p, 'peak': peak, 'weekend': weekend})
    room_amount = sum(n['price'] for n in nights)
    extra_n = max(0, guests - room['std'])
    extra_amount = extra_n * extra_person_fee(room) * nights_n

    by_index = {o['i']: o for o in paid_options(prices)}
    chosen = []
    for o in options or []:
        try:
            qty, opt = int(o.get('qty') or 0), by_index.get(int(o.get('i', -1)))
        except (ValueError, TypeError, AttributeError):
            continue
        if opt and qty > 0:
            chosen.append({'i': opt['i'], 'name': opt['name'], 'detail': opt.get('detail', ''),
                           'price': opt['amount'], 'qty': min(qty, 5)})
    option_amount = sum(o['price'] * o['qty'] for o in chosen)

    return {
        'room_id': room_id, 'room_name': room['name'], 'checkin': ci.isoformat(), 'checkout': co.isoformat(),
        'nights': nights, 'guests': guests, 'extra_guests': extra_n,
        'room_amount': room_amount, 'extra_amount': extra_amount,
        'options': chosen, 'option_amount': option_amount,
        'total': room_amount + extra_amount + option_amount,
    }


# ──────────────────────────────────────────────
#  예약 가능 여부
# ──────────────────────────────────────────────
def units_of(settings, room_id):
    return int((settings.get('units') or {}).get(room_id, 1) or 1)


def booked_counts(room_id, start, end, exclude_id=None):
    """start~end(미포함) 각 날짜별로 객실을 차지한 예약 수"""
    rows = db().execute(
        f"SELECT id, checkin, checkout FROM reservations WHERE room_id=? AND status IN ({','.join('?' * len(ACTIVE))}) "
        "AND checkin < ? AND checkout > ?",
        (room_id, *ACTIVE, end.isoformat(), start.isoformat())).fetchall()
    counts = {}
    for r in rows:
        if exclude_id and r['id'] == exclude_id:
            continue
        d = max(date.fromisoformat(r['checkin']), start)
        last = min(date.fromisoformat(r['checkout']), end)
        while d < last:
            counts[d] = counts.get(d, 0) + 1
            d += timedelta(days=1)
    return counts


def is_available(settings, room_id, checkin, checkout, exclude_id=None):
    ci, co = date.fromisoformat(checkin), date.fromisoformat(checkout)
    counts = booked_counts(room_id, ci, co, exclude_id)
    units = units_of(settings, room_id)
    return all(counts.get(ci + timedelta(days=k), 0) < units for k in range((co - ci).days))


def open_until(settings):
    """예약을 받는 마지막 숙박일"""
    if settings.get('openUntil'):
        try:
            return date.fromisoformat(settings['openUntil'])
        except ValueError:
            pass
    return date.today() + timedelta(days=settings['maxDaysAhead'])


# ──────────────────────────────────────────────
#  예약 저장 / 변경
# ──────────────────────────────────────────────
def new_code():
    while True:
        code = 'DH' + datetime.now().strftime('%y%m%d') + '-' + ''.join(random.choices(string.digits, k=4))
        if not db().execute('SELECT 1 FROM reservations WHERE code LIKE ? OR group_code=?',
                            (code + '%', code)).fetchone():
            return code


def norm_phone(p):
    return re.sub(r'\D', '', str(p or ''))


def fmt_phone(p):
    p = norm_phone(p)
    if len(p) == 11:
        return f'{p[:3]}-{p[3:7]}-{p[7:]}'
    if len(p) == 10:
        return f'{p[:3]}-{p[3:6]}-{p[6:]}'
    return p


def valid_mobile(p):
    return bool(re.fullmatch(r'01\d{8,9}', norm_phone(p)))


def row_dict(r):
    d = dict(r)
    d['options'] = json.loads(d.get('options') or '[]')
    d['status_label'] = STATUS_LABEL.get(d['status'], d['status'])
    d['nights'] = (date.fromisoformat(d['checkout']) - date.fromisoformat(d['checkin'])).days
    d['phone_fmt'] = fmt_phone(d['phone'])
    return d


def get_reservation(rid):
    r = db().execute('SELECT * FROM reservations WHERE id=?', (rid,)).fetchone()
    if not r:
        raise BookingError('예약을 찾을 수 없습니다')
    return row_dict(r)


def group_rows(group_code):
    return [row_dict(r) for r in db().execute(
        'SELECT * FROM reservations WHERE group_code=? ORDER BY id', (group_code,)).fetchall()]


def _insert(q, status, source, deadline, name, phone, request, memo, total, paid, code, group_code):
    ts = now_str()
    cur = db().execute(
        'INSERT INTO reservations (code, group_code, room_id, checkin, checkout, guests, name, phone, request, memo, '
        'options, room_amount, extra_amount, option_amount, total, paid, status, source, deadline, created_at, '
        'updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (code, group_code, q['room_id'], q['checkin'], q['checkout'], q['guests'], name, phone, request, memo,
         json.dumps(q['options'], ensure_ascii=False), q['room_amount'], q['extra_amount'], q['option_amount'],
         total, paid, status, source, deadline, ts, ts))
    return cur.lastrowid


def check_open_range(settings, checkin, checkout):
    ci, co = parse_date(checkin, '입실일'), parse_date(checkout, '퇴실일')
    if ci < date.today():
        raise BookingError('지난 날짜는 예약할 수 없습니다')
    if co - timedelta(days=1) > open_until(settings):
        raise BookingError(f'현재 {fmt_day(open_until(settings).isoformat())} 숙박까지만 예약할 수 있습니다')


def create_web_booking(data):
    """홈페이지 예약 (객실 여러 개 한 번에). 모두 '입금대기'로 들어오고 하나의 예약번호로 묶임
    data = {checkin, checkout, name, phone, request, items: [{room_id, guests, options}]}"""
    settings, prices = load_settings(), load_prices()
    if not settings.get('bookingOpen', True) or not settings.get('bank'):
        raise BookingError('현재 온라인 예약을 받지 않고 있습니다. 전화로 문의해 주세요')
    name = str(data.get('name', '')).strip()[:30]
    phone = norm_phone(data.get('phone'))
    if not name:
        raise BookingError('예약자 이름을 입력해 주세요')
    if not valid_mobile(phone):
        raise BookingError('휴대폰 번호를 정확히 입력해 주세요')
    items = data.get('items') or []
    if not isinstance(items, list) or not items:
        raise BookingError('객실을 선택해 주세요')
    if len(items) > settings['maxRooms']:
        raise BookingError(f'한 번에 최대 {settings["maxRooms"]}개 객실까지 예약할 수 있습니다')
    if len({it.get('room_id') for it in items}) != len(items):
        raise BookingError('같은 객실이 중복 선택되었습니다')
    check_open_range(settings, data.get('checkin'), data.get('checkout'))
    quotes = [quote(it.get('room_id'), data.get('checkin'), data.get('checkout'), it.get('guests'),
                    it.get('options'), prices, settings['maxNights']) for it in items]
    request = str(data.get('request', '')).strip()[:500]

    with _lock:
        expire_overdue()
        for q in quotes:
            if not is_available(settings, q['room_id'], q['checkin'], q['checkout']):
                raise BookingError(f'{q["room_name"]}은(는) 방금 다른 분이 예약했습니다. 다시 선택해 주세요')
        base = new_code()
        deadline = (datetime.now() + timedelta(hours=settings['depositHours'])).strftime('%Y-%m-%d %H:%M:%S')
        for k, q in enumerate(quotes):
            code = base if len(quotes) == 1 else f'{base}-{k + 1}'
            _insert(q, 'pending', '홈페이지', deadline, name, phone, request, '', q['total'], 0, code, base)
        db().commit()
        rows = group_rows(base)

    notify('received', rows)
    if settings.get('adminNotify'):
        notify('admin', rows)
    return {'code': base, 'total': sum(r['total'] for r in rows), 'bank': settings['bank'],
            'deadline': fmt_deadline(deadline), 'phone': settings['phone']}


def create_reservation(data):
    """관리자가 직접 넣는 예약 (전화 · 현장 · 땡큐캠핑 이관 · 예약막음)"""
    settings, prices = load_settings(), load_prices()
    status = data.get('status', 'confirmed')
    if status not in ('pending', 'confirmed', 'block'):
        raise BookingError('잘못된 예약 상태')
    name = str(data.get('name', '')).strip()[:30]
    phone = norm_phone(data.get('phone'))
    source = data.get('source') if data.get('source') in SOURCES else '기타'

    if status == 'block':
        q = quote(data.get('room_id'), data.get('checkin'), data.get('checkout'), 1, [], prices)
        q.update(room_amount=0, extra_amount=0, option_amount=0, total=0, options=[], guests=0)
        name, phone, source = name or '예약막음', '', '기타'
    else:
        q = quote(data.get('room_id'), data.get('checkin'), data.get('checkout'), data.get('guests'),
                  data.get('options'), prices)
        if not name:
            raise BookingError('예약자 이름을 입력해 주세요')
        if phone and not valid_mobile(phone):
            raise BookingError('휴대폰 번호를 정확히 입력해 주세요')

    total = q['total'] if data.get('total') in (None, '') else int(data['total'])  # 할인 등 직접 조정 가능
    if data.get('paid') not in (None, ''):
        paid = int(data['paid'])
    else:
        paid = total if status == 'confirmed' else 0

    with _lock:
        expire_overdue()
        if not data.get('force') and not is_available(settings, q['room_id'], q['checkin'], q['checkout']):
            raise BookingError('해당 날짜에 이미 예약이 있습니다')
        deadline = None
        if status == 'pending':
            hours = int(data.get('depositHours') or settings['depositHours'])
            deadline = (datetime.now() + timedelta(hours=hours)).strftime('%Y-%m-%d %H:%M:%S')
        code = new_code()
        rid = _insert(q, status, source, deadline, name, phone, str(data.get('request', '')).strip()[:500],
                      str(data.get('memo', '')).strip()[:1000], total, paid, code, code)
        db().commit()
        r = get_reservation(rid)

    if data.get('sms') and phone and status in ('pending', 'confirmed'):
        notify('received' if status == 'pending' else 'confirmed', [r])
    return r


EDITABLE = ('room_id', 'checkin', 'checkout', 'guests', 'name', 'phone', 'request', 'memo', 'source',
            'room_amount', 'extra_amount', 'option_amount', 'total', 'paid', 'refund', 'deadline', 'options')


def update_reservation(rid, data):
    settings = load_settings()
    with _lock:
        r = get_reservation(rid)
        new = {k: data[k] for k in EDITABLE if k in data}
        if 'phone' in new:
            new['phone'] = norm_phone(new['phone'])
            if new['phone'] and not valid_mobile(new['phone']):
                raise BookingError('휴대폰 번호를 정확히 입력해 주세요')
        if 'source' in new and new['source'] not in SOURCES:
            new['source'] = '기타'
        for k in ('guests', 'room_amount', 'extra_amount', 'option_amount', 'total', 'paid', 'refund'):
            if k in new:
                new[k] = int(new[k] or 0)
        if 'options' in new:
            new['options'] = json.dumps(new['options'], ensure_ascii=False)
        if 'deadline' in new and not new['deadline']:
            new['deadline'] = None
        room_id = new.get('room_id', r['room_id'])
        ci = parse_date(new.get('checkin', r['checkin']), '입실일').isoformat()
        co = parse_date(new.get('checkout', r['checkout']), '퇴실일').isoformat()
        if co <= ci:
            raise BookingError('퇴실일은 입실일 다음 날 이후여야 합니다')
        get_room(load_prices(), room_id)
        moved = (room_id, ci, co) != (r['room_id'], r['checkin'], r['checkout'])
        if moved and r['status'] in ACTIVE and not data.get('force'):
            if not is_available(settings, room_id, ci, co, exclude_id=rid):
                raise BookingError('변경하려는 날짜에 이미 다른 예약이 있습니다')
        if moved:
            new['reminded'] = 0
        if not new:
            return r
        new['updated_at'] = now_str()
        db().execute(f'UPDATE reservations SET {", ".join(k + "=?" for k in new)} WHERE id=?', (*new.values(), rid))
        db().commit()
        return get_reservation(rid)


def set_status(rid, status, data=None):
    """상태 변경 (입금확인 → 확정, 취소, 되돌리기).
    같은 예약번호로 묶인 객실(여러 객실 예약)은 data['group'] 이 참이면 함께 변경"""
    data = data or {}
    settings = load_settings()
    if status not in ('pending', 'confirmed', 'cancelled'):
        raise BookingError('잘못된 상태')
    with _lock:
        r = get_reservation(rid)
        if r['status'] == 'block':
            raise BookingError('예약막음은 삭제로 해제하세요')
        targets = [r]
        if data.get('group', True) and r['group_code']:
            targets = [x for x in group_rows(r['group_code']) if x['status'] == r['status']]
        single = len(targets) == 1
        for t in targets:
            fields = {'status': status, 'updated_at': now_str()}
            if status == 'confirmed':
                fields['paid'] = int(data['paid']) if single and data.get('paid') not in (None, '') else t['total']
                fields['deadline'] = None
            elif status == 'cancelled':
                fields['cancel_reason'] = str(data.get('reason', '')).strip()[:200] or '관리자 취소'
                fields['refund'] = int(data.get('refund') or 0) if single else (t['paid'] if data.get('refundAll') else 0)
            elif status == 'pending':
                fields['deadline'] = (datetime.now() + timedelta(hours=settings['depositHours'])).strftime('%Y-%m-%d %H:%M:%S')
            if t['status'] == 'cancelled':
                if not is_available(settings, t['room_id'], t['checkin'], t['checkout'], exclude_id=t['id']):
                    raise BookingError('그 사이에 같은 날짜에 다른 예약이 들어와 복구할 수 없습니다')
                fields['cancel_reason'] = ''
                fields['refund'] = 0
            db().execute(f'UPDATE reservations SET {", ".join(k + "=?" for k in fields)} WHERE id=?',
                         (*fields.values(), t['id']))
        db().commit()
        rows = [get_reservation(t['id']) for t in targets]
    if data.get('sms') and status in ('confirmed', 'cancelled') and rows[0]['phone']:
        notify(status, rows)
    return rows


def delete_reservation(rid):
    with _lock:
        db().execute('DELETE FROM reservations WHERE id=?', (rid,))
        db().commit()


def list_reservations(start=None, end=None, status=None, q=None):
    sql, args = 'SELECT * FROM reservations WHERE 1=1', []
    if start and end:  # 해당 기간에 걸쳐 있는 예약
        sql += ' AND checkin < ? AND checkout > ?'
        args += [end, start]
    if status:
        sql += f' AND status IN ({",".join("?" * len(status))})'
        args += list(status)
    if q:
        like = f'%{q}%'
        sql += ' AND (name LIKE ? OR code LIKE ? OR memo LIKE ?'
        args += [like, like, like]
        if norm_phone(q):
            sql += ' OR phone LIKE ?'
            args.append(f'%{norm_phone(q)}%')
        sql += ')'
    sql += ' ORDER BY checkin, room_id LIMIT 3000'
    with _lock:
        return [row_dict(r) for r in db().execute(sql, args).fetchall()]


def lookup(code, phone):
    code, phone = str(code or '').strip().upper(), norm_phone(phone)
    with _lock:
        rows = [row_dict(r) for r in db().execute(
            "SELECT * FROM reservations WHERE (group_code=? OR code=?) AND phone=? AND status != 'block' ORDER BY id",
            (code, code, phone)).fetchall()] if code and phone else []
    if not rows:
        raise BookingError('예약 내역을 찾을 수 없습니다. 예약번호와 휴대폰 번호를 확인해 주세요')
    names = {r['id']: r['name'] for r in load_prices()['rooms']}
    settings = load_settings()
    pending = any(r['status'] == 'pending' for r in rows)
    return {
        'code': rows[0]['group_code'] or rows[0]['code'], 'name': rows[0]['name'],
        'checkin': rows[0]['checkin'], 'checkout': rows[0]['checkout'], 'nights': rows[0]['nights'],
        'items': [{'room_name': names.get(r['room_id'], r['room_id']), 'guests': r['guests'], 'total': r['total'],
                   'status': r['status'], 'status_label': r['status_label'], 'options': r['options']} for r in rows],
        'total': sum(r['total'] for r in rows if r['status'] != 'cancelled'),
        'paid': sum(r['paid'] for r in rows),
        'deadline': fmt_deadline(rows[0]['deadline']) if pending else '',
        'bank': settings['bank'] if pending else '', 'phone': settings['phone'],
        'refundPolicy': settings['refundPolicy'],
    }


# ──────────────────────────────────────────────
#  손님용 달력 / 검색
# ──────────────────────────────────────────────
def month_calendar(month):
    """해당 월 날짜별 예약 가능한 객실 목록"""
    try:
        first = date.fromisoformat(str(month) + '-01')
    except ValueError:
        raise BookingError('잘못된 월')
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    settings, prices = load_settings(), load_prices()
    today, limit = date.today(), open_until(settings)
    holidays = set(prices.get('holidays', []))
    with _lock:
        expire_overdue()
        counts = {r['id']: booked_counts(r['id'], first, nxt) for r in prices['rooms']}
    days = {}
    d = first
    while d < nxt:
        open_day = today <= d <= limit
        peak, weekend = day_info(prices, d)
        days[d.isoformat()] = {
            'open': open_day, 'peak': peak, 'weekend': weekend, 'holiday': d.isoformat() in holidays,
            'rooms': [r['id'] for r in prices['rooms']
                      if open_day and counts[r['id']].get(d, 0) < units_of(settings, r['id'])],
        }
        d += timedelta(days=1)
    return {'month': month, 'days': days, 'total': len(prices['rooms'])}


def search(checkin, checkout):
    """선택한 날짜에 객실별 예약 가능 여부와 기준인원 요금"""
    settings, prices = load_settings(), load_prices()
    check_open_range(settings, checkin, checkout)
    out = []
    with _lock:
        expire_overdue()
        for room in prices['rooms']:
            q = quote(room['id'], checkin, checkout, room['std'], [], prices, settings['maxNights'])
            out.append({
                'id': room['id'], 'name': room['name'], 'group': room['group'], 'badge': room.get('badge', ''),
                'cover': room.get('cover', ''), 'std': room['std'], 'max': room['max'],
                'extra': room.get('extra', ''), 'extraPerson': extra_person_fee(room), 'desc': room.get('desc', ''),
                'room_amount': q['room_amount'], 'nights': q['nights'],
                'available': is_available(settings, room['id'], q['checkin'], q['checkout']),
            })
    return out


def public_info():
    settings, prices = load_settings(), load_prices()
    return {
        'open': bool(settings.get('bookingOpen')) and bool(settings.get('bank')),
        'phone': settings['phone'], 'depositHours': settings['depositHours'],
        'openUntil': open_until(settings).isoformat(), 'maxNights': settings['maxNights'],
        'maxRooms': settings['maxRooms'], 'refundPolicy': settings['refundPolicy'],
        'notice': settings['notice'], 'today': date.today().isoformat(),
        'options': [{'i': o['i'], 'name': o['name'], 'detail': o.get('detail', ''), 'price': o['amount']}
                    for o in paid_options(prices)],
    }


# ──────────────────────────────────────────────
#  문자 (알리고)
# ──────────────────────────────────────────────
def fmt_day(ds):
    d = date.fromisoformat(ds)
    return f'{d.month}/{d.day}({WEEKDAY[d.weekday()]})'


def fmt_deadline(ts):
    if not ts:
        return ''
    t = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
    return f'{t.month}/{t.day}({WEEKDAY[t.weekday()]}) {t.hour:02d}:{t.minute:02d}'


def render_template(tpl, rows, settings=None):
    """문자 문구의 {이름} 같은 항목을 실제 값으로 바꿈. rows = 같은 예약번호로 묶인 객실들"""
    settings = settings or load_settings()
    names = {r['id']: r['name'] for r in load_prices()['rooms']}
    r = rows[0]
    vals = {
        '예약번호': r['group_code'] or r['code'], '이름': r['name'], '연락처': fmt_phone(r['phone']),
        '객실': ', '.join(names.get(x['room_id'], x['room_id']) for x in rows),
        '입실': fmt_day(r['checkin']), '퇴실': fmt_day(r['checkout']), '박': r['nights'],
        '인원': sum(x['guests'] for x in rows),
        '금액': f"{sum(x['total'] for x in rows):,}", '잔금': f"{sum(x['total'] - x['paid'] for x in rows):,}",
        '계좌': settings['bank'], '입금기한': fmt_deadline(r.get('deadline')), '펜션전화': settings['phone'],
    }
    return re.sub(r'\{([^{}]+)\}', lambda m: str(vals.get(m.group(1), m.group(0))), tpl)


def aligo_call(path, fields, settings):
    a = settings['aligo']
    body = urllib.parse.urlencode({'key': a['key'], 'user_id': a['userId'], **fields}).encode('utf-8')
    req = urllib.request.Request('https://apis.aligo.in/' + path, data=body)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def send_sms(phone, msg, kind='manual', reservation_id=None):
    """문자 1건 발송 후 기록. (성공 여부, 결과 메시지)"""
    settings = load_settings()
    a = settings['aligo']
    phone = norm_phone(phone)
    if not valid_mobile(phone):
        ok, result = False, '휴대폰 번호 없음/오류'
    elif not (a.get('enabled') and a.get('key') and a.get('userId') and a.get('sender')):
        ok, result = False, '문자 발송 꺼짐 (설정에서 알리고 연동 필요) — 기록만 저장'
    else:
        lms = len(msg.encode('euc-kr', errors='replace')) > 90  # 90바이트 넘으면 장문(LMS)
        fields = {'sender': norm_phone(a['sender']), 'receiver': phone, 'msg': msg,
                  'msg_type': 'LMS' if lms else 'SMS'}
        if lms:
            fields['title'] = '동해카라반펜션'
        if a.get('testmode'):
            fields['testmode_yn'] = 'Y'
        try:
            res = aligo_call('send/', fields, settings)
            ok = int(res.get('result_code', -1)) > 0
            result = str(res.get('message', '')) + (' (테스트모드 — 실제 발송 안 됨)' if a.get('testmode') else '')
        except Exception as e:  # 네트워크 오류 등
            ok, result = False, f'발송 오류: {e}'
    with _lock:
        db().execute('INSERT INTO sms_log (created_at, reservation_id, phone, kind, msg, ok, result) '
                     'VALUES (?,?,?,?,?,?,?)', (now_str(), reservation_id, phone, kind, msg, int(ok), result))
        db().commit()
    return ok, result


def notify(kind, rows):
    """자동 문자 (백그라운드로 발송 — 예약 처리가 문자 때문에 느려지지 않게)"""
    settings = load_settings()
    if kind != 'admin' and not settings['auto'].get(kind, True):
        return
    tpl = settings['templates'].get(kind, '')
    if not tpl.strip():
        return
    msg = render_template(tpl, rows, settings)
    phone = settings['adminPhone'] if kind == 'admin' else rows[0]['phone']
    threading.Thread(target=send_sms, args=(phone, msg, kind, rows[0]['id']), daemon=True).start()


def sms_balance():
    settings = load_settings()
    a = settings['aligo']
    if not (a.get('key') and a.get('userId')):
        raise BookingError('알리고 API 키와 아이디를 먼저 입력하세요')
    try:
        res = aligo_call('remain/', {}, settings)
    except Exception as e:
        raise BookingError(f'알리고 연결 실패: {e}')
    if int(res.get('result_code', -1)) <= 0:
        raise BookingError(f'알리고 오류: {res.get("message")}')
    return {'sms': res.get('SMS_CNT'), 'lms': res.get('LMS_CNT'), 'mms': res.get('MMS_CNT')}


def sms_log(limit=300):
    with _lock:
        return [dict(r) for r in db().execute('SELECT * FROM sms_log ORDER BY id DESC LIMIT ?', (limit,)).fetchall()]


# ──────────────────────────────────────────────
#  자동 처리 (입금기한 초과 취소, 입실 전날 안내)
# ──────────────────────────────────────────────
def _by_group(rows):
    groups = {}
    for r in rows:
        groups.setdefault(r['group_code'] or r['code'], []).append(r)
    return list(groups.values())


def expire_overdue():
    with _lock:
        ids = [r['id'] for r in db().execute(
            "SELECT id FROM reservations WHERE status='pending' AND deadline IS NOT NULL AND deadline < ?",
            (now_str(),)).fetchall()]
        if not ids:
            return
        for rid in ids:
            db().execute("UPDATE reservations SET status='cancelled', cancel_reason='입금기한 초과 자동취소', "
                         "updated_at=? WHERE id=?", (now_str(), rid))
        db().commit()
        rows = [get_reservation(rid) for rid in ids]
    for group in _by_group(rows):
        if group[0]['phone']:
            notify('expired', group)


def send_reminders():
    settings = load_settings()
    if datetime.now().hour < settings['reminderHour']:
        return
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    with _lock:
        rows = [row_dict(r) for r in db().execute(
            "SELECT * FROM reservations WHERE status='confirmed' AND checkin=? AND reminded=0", (tomorrow,)).fetchall()]
        for r in rows:
            db().execute('UPDATE reservations SET reminded=1 WHERE id=?', (r['id'],))
        db().commit()
    for group in _by_group(rows):
        if group[0]['phone']:
            notify('reminder', group)


def daily_backup(keep=60):
    """private/backup/ 에 하루 한 번 예약 DB 복사 (최근 60일치 보관)"""
    folder = os.path.join(PRIVATE_DIR, 'backup')
    target = os.path.join(folder, f'booking-{date.today().isoformat()}.db')
    if os.path.exists(target):
        return
    os.makedirs(folder, exist_ok=True)
    with _lock:
        dst = sqlite3.connect(target)
        db().backup(dst)
        dst.close()
    for old in sorted(f for f in os.listdir(folder) if f.startswith('booking-'))[:-keep]:
        os.remove(os.path.join(folder, old))


def _worker():
    while True:
        try:
            expire_overdue()
            send_reminders()
            daily_backup()
        except Exception as e:
            print('[예약 자동처리 오류]', e)
        time.sleep(60)


def start_worker():
    with _lock:
        db()
    threading.Thread(target=_worker, daemon=True).start()


# ──────────────────────────────────────────────
#  통계 / 엑셀
# ──────────────────────────────────────────────
def revenue_of(r):
    """매출: 확정 예약은 총액, 취소 예약은 받은 돈 - 환불액 (위약금)"""
    if r['status'] == 'confirmed':
        return r['total']
    if r['status'] == 'cancelled':
        return max(0, r['paid'] - r['refund'])
    return 0


def month_days(year, month):
    first = date(year, month, 1)
    return ((first.replace(day=28) + timedelta(days=4)).replace(day=1) - first).days


def stats(year):
    prices, settings = load_prices(), load_settings()
    rooms = [{'id': r['id'], 'name': r['name']} for r in prices['rooms']]
    with _lock:
        rows = [row_dict(r) for r in db().execute(
            "SELECT * FROM reservations WHERE status != 'block' AND checkin < ? AND checkout > ?",
            (f'{year + 1}-01-01', f'{year}-01-01')).fetchall()]
    months = [{'month': m, 'revenue': 0, 'count': 0, 'nights': 0, 'cancelled': 0} for m in range(1, 13)]
    by_room = {r['id']: {'nights': 0, 'revenue': 0, 'count': 0} for r in rooms}
    by_source = {}
    for r in rows:
        ci = date.fromisoformat(r['checkin'])
        if ci.year == year:  # 매출 · 건수는 입실월 기준
            m = months[ci.month - 1]
            if r['status'] == 'cancelled':
                m['cancelled'] += 1
            elif r['status'] == 'confirmed':
                m['count'] += 1
                by_source[r['source']] = by_source.get(r['source'], 0) + 1
            m['revenue'] += revenue_of(r)
            if r['room_id'] in by_room:
                by_room[r['room_id']]['revenue'] += revenue_of(r)
                by_room[r['room_id']]['count'] += int(r['status'] == 'confirmed')
        if r['status'] == 'confirmed':  # 가동 박수는 실제 숙박한 날짜 기준
            d, end = ci, date.fromisoformat(r['checkout'])
            while d < end:
                if d.year == year:
                    months[d.month - 1]['nights'] += 1
                    if r['room_id'] in by_room:
                        by_room[r['room_id']]['nights'] += 1
                d += timedelta(days=1)
    total_units = sum(units_of(settings, r['id']) for r in rooms)
    for m in months:
        cap = month_days(year, m['month']) * total_units
        m['occupancy'] = round(m['nights'] / cap * 100, 1) if cap else 0
    year_days = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    for r in rooms:
        s = by_room[r['id']]
        r.update(s, occupancy=round(s['nights'] / (year_days * units_of(settings, r['id'])) * 100, 1))
    return {'year': year, 'months': months, 'rooms': rooms, 'sources': by_source,
            'pending': sum(1 for r in rows if r['status'] == 'pending'),
            'revenue': sum(m['revenue'] for m in months)}


EXPORT_COLS = [('예약번호', 'code'), ('상태', 'status_label'), ('경로', 'source'), ('객실', 'room_name'),
               ('입실', 'checkin'), ('퇴실', 'checkout'), ('박', 'nights'), ('인원', 'guests'),
               ('예약자', 'name'), ('연락처', 'phone_fmt'), ('객실요금', 'room_amount'), ('인원추가', 'extra_amount'),
               ('옵션', 'option_text'), ('옵션요금', 'option_amount'), ('총액', 'total'), ('입금액', 'paid'),
               ('환불액', 'refund'), ('요청사항', 'request'), ('메모', 'memo'), ('취소사유', 'cancel_reason'),
               ('접수일시', 'created_at')]
EXPORT_WIDTHS = (16, 9, 9, 13, 11, 11, 5, 5, 10, 14, 10, 9, 26, 9, 10, 10, 9, 30, 30, 20, 19)
MONEY_COLS = {'room_amount', 'extra_amount', 'option_amount', 'total', 'paid', 'refund'}


def export(start, end):
    """엑셀(.xlsx) 파일 내용 반환. openpyxl 이 없으면 CSV"""
    names = {r['id']: r['name'] for r in load_prices()['rooms']}
    rows = list_reservations(start, end)
    for r in rows:
        r['room_name'] = names.get(r['room_id'], r['room_id'])
        r['option_text'] = ', '.join(f"{o['name']}({o.get('detail', '')}) x{o['qty']}" for o in r['options'])
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        import csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([c[0] for c in EXPORT_COLS])
        for r in rows:
            w.writerow([r.get(k, '') for _, k in EXPORT_COLS])
        return ('﻿' + buf.getvalue()).encode('utf-8'), 'text/csv; charset=utf-8', 'csv'
    wb = Workbook()
    ws = wb.active
    ws.title = '예약목록'
    ws.append([c[0] for c in EXPORT_COLS])
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='0E6BA8')
    for r in rows:
        ws.append([r.get(k, '') for _, k in EXPORT_COLS])
    for i, (w, (_, key)) in enumerate(zip(EXPORT_WIDTHS, EXPORT_COLS), start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
        if key in MONEY_COLS:
            for (cell,) in ws.iter_rows(min_row=2, min_col=i, max_col=i):
                cell.number_format = '#,##0'
    ws.freeze_panes = 'A2'
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'


# ──────────────────────────────────────────────
#  요금표의 성수기 기간 · 공휴일 수정
# ──────────────────────────────────────────────
def save_calendar_rules(peak_periods, holidays):
    periods = []
    for p in peak_periods:
        s, e = parse_date(p.get('start'), '성수기 시작일'), parse_date(p.get('end'), '성수기 종료일')
        if e < s:
            raise BookingError('성수기 종료일이 시작일보다 빠릅니다')
        periods.append({'start': s.isoformat(), 'end': e.isoformat()})
    hol = sorted({parse_date(h, '공휴일').isoformat() for h in holidays if str(h).strip()})
    with _lock:
        prices = load_prices()
        prices['peakPeriods'] = sorted(periods, key=lambda p: p['start'])
        prices['holidays'] = hol
        with open(PRICES_FILE, 'w', encoding='utf-8') as f:
            json.dump(prices, f, ensure_ascii=False, indent=2)
    return prices


# ──────────────────────────────────────────────
#  HTTP 요청 처리 (server.py 가 호출)
# ──────────────────────────────────────────────
_hits = {}  # 예약 시도 횟수 제한 (IP별)


def rate_limited(key, limit, window):
    t = time.time()
    with _lock:
        hits = [h for h in _hits.get(key, []) if t - h < window]
        if len(hits) >= limit:
            _hits[key] = hits
            return True
        hits.append(t)
        _hits[key] = hits
        return False


def handle_public(method, path, query, body, ip):
    """손님용 API — 로그인 없이 사용. (상태코드, 응답) 반환"""
    q = lambda k, d='': query.get(k, [d])[0]
    if method == 'GET' and path == '/api/public/info':
        return 200, public_info()
    if method == 'GET' and path == '/api/public/calendar':
        return 200, month_calendar(q('month'))
    if method == 'GET' and path == '/api/public/search':
        return 200, {'rooms': search(q('checkin'), q('checkout'))}
    if method == 'POST' and path == '/api/public/quote':
        settings, prices = load_settings(), load_prices()
        quotes = [quote(it.get('room_id'), body.get('checkin'), body.get('checkout'), it.get('guests'),
                        it.get('options'), prices, settings['maxNights']) for it in body.get('items') or []]
        return 200, {'items': quotes, 'total': sum(x['total'] for x in quotes)}
    if method == 'POST' and path == '/api/public/reserve':
        if body.get('website'):  # 스팸 봇 차단용 숨김 칸
            return 400, {'error': '잘못된 요청'}
        if rate_limited('reserve:' + ip, 5, 3600):
            return 429, {'error': '예약 시도가 너무 많습니다. 전화로 문의해 주세요'}
        return 200, create_web_booking(body)
    if method == 'POST' and path == '/api/public/lookup':
        if rate_limited('lookup:' + ip, 20, 600):
            return 429, {'error': '잠시 후 다시 시도해 주세요'}
        return 200, lookup(body.get('code'), body.get('phone'))
    return 404, {'error': '알 수 없는 요청'}


def handle_admin(method, path, query, body):
    """관리자용 API (로그인 필요). (상태코드, 응답) 또는 ('file', 내용, 형식, 파일명)"""
    q = lambda k, d='': query.get(k, [d])[0]
    if method == 'GET':
        if path == '/api/bk/reservations':
            status = [s for s in q('status').split(',') if s]
            return 200, {'items': list_reservations(q('from') or None, q('to') or None, status, q('q').strip())}
        if path == '/api/bk/reservation':
            with _lock:
                r = get_reservation(int(q('id', '0')))
                group = group_rows(r['group_code']) if r['group_code'] else [r]
            return 200, {'item': r, 'group': group}
        if path == '/api/bk/stats':
            return 200, stats(int(q('year') or date.today().year))
        if path == '/api/bk/settings':
            prices = load_prices()
            return 200, {'settings': load_settings(), 'peakPeriods': prices.get('peakPeriods', []),
                         'holidays': prices.get('holidays', []), 'sources': SOURCES,
                         'rooms': [{'id': r['id'], 'name': r['name'], 'std': r['std'], 'max': r['max'],
                                    'group': r['group']} for r in prices['rooms']],
                         'options': [{'i': o['i'], 'name': o['name'], 'detail': o.get('detail', ''),
                                      'price': o['amount']} for o in paid_options(prices)]}
        if path == '/api/bk/sms/log':
            return 200, {'items': sms_log()}
        if path == '/api/bk/sms/balance':
            return 200, sms_balance()
        if path == '/api/bk/myip':  # 알리고에 등록할 이 PC의 인터넷(공인) IP
            try:
                with urllib.request.urlopen('https://api.ipify.org', timeout=8) as resp:
                    return 200, {'ip': resp.read().decode().strip()}
            except Exception:
                raise BookingError('인터넷 IP를 확인할 수 없습니다')
        if path == '/api/bk/export':
            data, ctype, ext = export(q('from') or None, q('to') or None)
            return 'file', data, ctype, f'reservations_{q("from")}_{q("to")}.{ext}'
    if method == 'POST':
        if path == '/api/bk/quote':
            return 200, quote(body.get('room_id'), body.get('checkin'), body.get('checkout'),
                              body.get('guests'), body.get('options'))
        if path == '/api/bk/create':
            return 200, {'item': create_reservation(body)}
        if path == '/api/bk/update':
            return 200, {'item': update_reservation(int(body.get('id', 0)), body)}
        if path == '/api/bk/status':
            return 200, {'items': set_status(int(body.get('id', 0)), body.get('status'), body)}
        if path == '/api/bk/delete':
            delete_reservation(int(body.get('id', 0)))
            return 200, {'ok': True}
        if path == '/api/bk/settings':
            return 200, {'settings': save_settings(body)}
        if path == '/api/bk/calendar-rules':
            save_calendar_rules(body.get('peakPeriods') or [], body.get('holidays') or [])
            return 200, {'ok': True}
        if path == '/api/bk/sms/send':
            msg = str(body.get('msg', '')).strip()
            if not msg:
                raise BookingError('문자 내용을 입력하세요')
            ok, result = send_sms(body.get('phone'), msg, 'manual', body.get('reservation_id'))
            return (200 if ok else 400), ({'ok': True, 'result': result} if ok else {'error': result})
        if path == '/api/bk/sms/preview':
            with _lock:
                r = get_reservation(int(body.get('id', 0)))
                rows = group_rows(r['group_code']) if r['group_code'] else [r]
            return 200, {'msg': render_template(load_settings()['templates'].get(body.get('kind'), ''), rows)}
    return 404, {'error': '알 수 없는 요청'}
