/* ============ 경주이가국밥 관리자 ============
 * GitHub Pages 에는 서버가 없으므로, GitHub API 로 저장소의 파일을 직접 고칩니다.
 *   - 글 · 가격 · 영업시간 · 배달 주소 → data/stores.json
 *   - 사진 → images/up-<날짜>.webp (휴대폰 사진도 이 기기에서 줄여서 올림)
 * 저장 후 1~2분 뒤 홈페이지에 반영됩니다.
 * 저장소를 옮기면 아래 REPO · BRANCH · BASE 만 바꾸면 됩니다.
 */
const REPO = 'syyoon2-dhc/dhcaravan';   // 지금은 동해카라반 저장소 안의 확인용 폴더
const BRANCH = 'master';
const BASE = 'gyeongju-leega/';          // 저장소 안에서 이 홈페이지가 있는 폴더 (저장소 맨 위면 '')
const DATA = BASE + 'data/stores.json';
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const KNOWN_HOSTS = /(^|\.)(baemin\.com|baemin\.me|coupangeats\.com|coupang\.com|yogiyo\.co\.kr|page\.link)$/;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let TOKEN = localStorage.getItem('gj_gh_token') || sessionStorage.getItem('gj_gh_token') || '';
let D = null, SHA = null, dirty = false, tab = 'menu';
const preview = {};   // 방금 올린 사진: 경로 → 이 기기 미리보기 주소 (홈페이지 반영 전에도 보이게)

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function setDirty(v = true) {
  dirty = v;
  $('state').textContent = v ? '● 저장하지 않은 변경이 있어요' : '저장됨 · 홈페이지 반영까지 1~2분';
  $('state').className = v ? 'dirty' : '';
}
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- GitHub ---------- */
function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });
}
const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
const textToB64 = txt => { let s = ''; new TextEncoder().encode(txt).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const blobToB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });

async function loadData() {
  const res = await gh(`contents/${DATA}?ref=${BRANCH}&t=${Date.now()}`);
  if (res.status === 401 || res.status === 403) throw new Error('토큰이 맞지 않거나 이 저장소 권한이 없어요');
  if (!res.ok) throw new Error(`데이터를 못 읽었어요 (${res.status})`);
  const j = await res.json();
  SHA = j.sha;
  D = JSON.parse(b64ToText(j.content));
  D.platforms = D.platforms || [];
  D.stores.forEach(s => { s.delivery = s.delivery || {}; });
}

async function save() {
  // 배달 주소 검사: https 로 시작해야 함
  const bad = [];
  D.stores.forEach(s => D.platforms.forEach(p => {
    const u = (s.delivery[p.id] || '').trim();
    s.delivery[p.id] = u;
    if (u && !/^https:\/\/[^\s]+$/.test(u)) bad.push(`${s.name} ${p.name}`);
  }));
  if (bad.length) { toast('배달 주소는 https:// 로 시작해야 해요: ' + bad.join(', '), 4000); showTab('stores'); return; }
  $('save').disabled = true; $('save').textContent = '저장 중...';
  try {
    const body = JSON.stringify({ message: '관리자: 홈페이지 내용 수정', content: textToB64(JSON.stringify(D, null, 2) + '\n'), sha: SHA, branch: BRANCH });
    const res = await gh(`contents/${DATA}`, { method: 'PUT', body });
    if (res.status === 409) throw new Error('다른 곳에서 먼저 수정됐어요. 새로고침 후 다시 해 주세요');
    if (!res.ok) throw new Error(`저장 실패 (${res.status})`);
    SHA = (await res.json()).content.sha;
    setDirty(false);
    toast('저장했어요. 1~2분 뒤 홈페이지에 반영됩니다');
  } catch (e) { toast('⚠️ ' + e.message, 4000); }
  $('save').disabled = false; $('save').textContent = '저장하기';
}

/* 사진 줄여서 올리기 → 'images/up-....webp' 돌려줌 */
function shrink(file, maxW) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(maxW, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(b => b ? ok(b) : no(new Error('사진 변환 실패')), 'image/webp', 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => no(new Error('사진을 열 수 없어요'));
    img.src = URL.createObjectURL(file);
  });
}
async function upload(file, maxW = 1400) {
  const blob = await shrink(file, maxW);
  const name = `images/up-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}.webp`;
  const res = await gh(`contents/${BASE}${name}`, { method: 'PUT', body: JSON.stringify({ message: '관리자: 사진 올리기', content: await blobToB64(blob), branch: BRANCH }) });
  if (!res.ok) throw new Error(`사진 올리기 실패 (${res.status})`);
  preview[name] = URL.createObjectURL(blob);
  return name;
}
const imgUrl = p => preview[p] || p;
function pickFile(multi) {
  return new Promise(ok => {
    const inp = multi ? $('files') : $('file');
    inp.value = '';
    inp.onchange = () => ok([...inp.files]);
    inp.click();
  });
}

/* ---------- 목록 공통: 위 · 아래 · 삭제 ---------- */
function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }
const ctl = (path, i) => `<div class="ctl"><button type="button" data-mv="${path}|${i}|-1" title="위로">↑</button><button type="button" data-mv="${path}|${i}|1" title="아래로">↓</button><button type="button" class="del" data-rm="${path}|${i}" title="삭제">✕</button></div>`;
// 'menu.0.items' → 배열
const at = path => path.split('.').reduce((o, k) => o[k], D);

/* ---------- 화면 ---------- */
function render() {
  // 메뉴판
  $('panel-menu').innerHTML = `<div class="card"><h2>메뉴판</h2>
    <p class="hint">가격은 "10,000"처럼, 크기별은 "大 35,000 · 中 30,000"처럼 적으면 홈페이지에 그대로 나옵니다.</p>
    <label>메뉴판 아래 안내 문구</label><input type="text" data-f="menuNote" value="${esc(D.menuNote)}"></div>` +
    D.menu.map((g, gi) => `<div class="card">
      <div style="display:flex;gap:8px;align-items:center"><input type="text" data-f="menu.${gi}.group" value="${esc(g.group)}" style="font-weight:800;max-width:220px">${ctl('menu', gi)}</div>
      <div style="margin-top:8px">${g.items.map((it, ii) => `<div class="row">
        <input type="text" data-f="menu.${gi}.items.${ii}.name" value="${esc(it.name)}" placeholder="메뉴 이름">
        <input type="text" data-f="menu.${gi}.items.${ii}.price" value="${esc(it.price)}" placeholder="가격">
        <input type="text" class="note" data-f="menu.${gi}.items.${ii}.note" value="${esc(it.note || '')}" placeholder="작은 설명 (없어도 됨)">
        ${ctl(`menu.${gi}.items`, ii)}</div>`).join('')}</div>
      <button class="btn btn-sm" type="button" data-add="item|${gi}" style="margin-top:10px">+ 메뉴 추가</button>
    </div>`).join('') +
    `<button class="btn" type="button" data-add="group">+ 메뉴 묶음 추가 (예: 계절 메뉴)</button>`;

  // 대표 메뉴
  $('panel-sig').innerHTML = `<div class="card"><h2>대표 메뉴 (사진 카드)</h2>
    <p class="hint">홈페이지 메뉴 맨 위에 사진과 함께 나오는 메뉴예요. 사진을 누르면 바꿀 수 있어요. 4개가 가장 보기 좋아요.</p>
    <div class="grid">${D.signature.map((m, i) => `<div class="pic">
      <div class="ph" data-sigimg="${i}" style="background-image:url('${esc(imgUrl(m.img))}')"><span>📷 사진 바꾸기</span></div>
      <div class="bd">
        <input type="text" data-f="signature.${i}.name" value="${esc(m.name)}" placeholder="메뉴 이름">
        <input type="text" data-f="signature.${i}.price" value="${esc(m.price)}" placeholder="가격 (예: 10,000)">
        <input type="text" data-f="signature.${i}.text" value="${esc(m.text)}" placeholder="한 줄 설명">
        <input type="text" data-f="signature.${i}.tag" value="${esc(m.tag || '')}" placeholder="딱지 (예: 대표, 인기 · 없어도 됨)">
        ${ctl('signature', i)}
      </div></div>`).join('')}</div>
    <button class="btn" type="button" data-add="sig" style="margin-top:12px">+ 대표 메뉴 추가 (사진 고르기)</button></div>`;

  // 사진
  $('panel-gallery').innerHTML = `<div class="card"><h2>매장 사진</h2>
    <p class="hint">홈페이지 중간에 흘러가는 사진이에요. 여러 장을 한 번에 올릴 수 있고, 휴대폰 사진은 자동으로 줄여서 올립니다. 설명은 검색과 시각장애인 화면 읽기에 쓰여요.</p>
    <div class="grid">${D.gallery.map((g, i) => `<div class="pic">
      <div class="ph" style="background-image:url('${esc(imgUrl(g.src))}')"></div>
      <div class="bd"><input type="text" data-f="gallery.${i}.alt" value="${esc(g.alt)}" placeholder="사진 설명">${ctl('gallery', i)}</div></div>`).join('')}</div>
    <button class="btn btn-red" type="button" data-add="photos" style="margin-top:12px">+ 사진 올리기</button></div>`;

  // 지점 · 배달
  $('panel-stores').innerHTML = D.stores.map((s, si) => `<div class="card">
    <h2>${esc(s.full || s.name)}</h2>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px">
      <div><label>전화번호</label><input type="text" data-f="stores.${si}.phone" value="${esc(s.phone)}"></div>
      <div><label>쉬는 날 안내</label><input type="text" data-f="stores.${si}.closed" value="${esc(s.closed)}"></div>
      <div><label>주소 (도로명)</label><input type="text" data-f="stores.${si}.road" value="${esc(s.road)}"></div>
      <div><label>찾아오는 길 한 줄 (예: 청우아파트 맞은편)</label><input type="text" data-f="stores.${si}.landmark" value="${esc(s.landmark || '')}"></div>
      <div><label>라스트오더 (없으면 비움)</label><input type="text" data-f="stores.${si}.lastOrder" value="${esc(s.lastOrder || '')}" placeholder="21:30"></div>
      <div><label>편의시설 (쉼표로 구분)</label><input type="text" data-fl="stores.${si}.features" value="${esc((s.features || []).join(', '))}"></div>
    </div>
    <h3>영업시간</h3>
    ${DAYS.map(d => { const h = s.hours[d]; return `<div class="hours"><b>${d}</b>
      <label><input type="checkbox" data-off="${si}|${d}" ${h ? '' : 'checked'}> 휴무</label>
      <input type="time" data-h="${si}|${d}|0" value="${h ? h[0] : ''}" ${h ? '' : 'disabled'}>
      <input type="time" data-h="${si}|${d}|1" value="${h ? h[1] : ''}" ${h ? '' : 'disabled'}></div>`; }).join('')}
    <h3>🛵 배달앱 주문 주소</h3>
    <p class="hint">배달앱에서 이 가게 화면의 [공유] → [링크 복사]로 얻은 주소를 붙여 넣으세요. 비워 두면 그 배달앱 버튼은 홈페이지에 안 보여요. 주문 · 결제는 배달앱에서 합니다.</p>
    ${D.platforms.map(p => `<div class="plat"><b style="color:${esc(p.color)}">${esc(p.name)}</b>
      <div><input type="url" data-f="stores.${si}.delivery.${p.id}" value="${esc(s.delivery[p.id] || '')}" placeholder="https://..."><span class="warn" data-w="${si}|${p.id}"></span></div></div>`).join('')}
    <h3>지점 사진</h3>
    <div class="pic" style="max-width:320px"><div class="ph" data-storeimg="${si}" style="background-image:url('${esc(imgUrl(s.img || ''))}')"><span>📷 ${s.img ? '사진 바꾸기' : '사진 넣기'}</span></div></div>
  </div>`).join('');

  // 기본 문구
  const b = D.brand;
  $('panel-brand').innerHTML = `<div class="card"><h2>기본 문구</h2>
    <label>구호 (빨간 띠 · 홈페이지 곳곳)</label><input type="text" data-f="brand.slogan" value="${esc(b.slogan)}">
    <label>가게 이야기</label><textarea data-f="brand.story">${esc(b.story)}</textarea>
    <label>응원 문구 (빨간 띠)</label><textarea data-f="brand.message">${esc(b.message)}</textarea></div>`;

  checkLinks();
}

function checkLinks() {
  document.querySelectorAll('[data-w]').forEach(w => {
    const [si, pid] = w.dataset.w.split('|');
    const u = (D.stores[si].delivery[pid] || '').trim();
    const inp = w.previousElementSibling;
    let msg = '';
    if (u) {
      try {
        const url = new URL(u);
        if (url.protocol !== 'https:') msg = 'https:// 로 시작해야 해요';
        else if (!KNOWN_HOSTS.test(url.hostname)) msg = `배달앱 주소가 맞는지 확인해 주세요 (${url.hostname})`;
      } catch { msg = '주소 형식이 아니에요'; }
    }
    w.textContent = msg;
    inp.classList.toggle('bad', !!msg && !/확인해/.test(msg));
  });
}

function showTab(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  ['menu', 'sig', 'gallery', 'stores', 'brand'].forEach(x => { $('panel-' + x).hidden = x !== t; });
  scrollTo(0, 0);
}

/* ---------- 입력 ---------- */
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f) {
    const keys = el.dataset.f.split('.'), last = keys.pop();
    const obj = keys.reduce((o, k) => o[k], D);
    obj[last] = el.value;
    setDirty();
    if (el.dataset.f.includes('.delivery.')) checkLinks();
  } else if (el.dataset.fl) {
    const keys = el.dataset.fl.split('.'), last = keys.pop();
    keys.reduce((o, k) => o[k], D)[last] = el.value.split(',').map(x => x.trim()).filter(Boolean);
    setDirty();
  } else if (el.dataset.h) {
    const [si, d, k] = el.dataset.h.split('|');
    const h = D.stores[si].hours[d];
    if (h) { h[+k] = el.value; setDirty(); }
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.off) {
    const [si, d] = el.dataset.off.split('|');
    D.stores[si].hours[d] = el.checked ? null : ['09:00', '21:00'];
    setDirty(); render();
  }
});

document.addEventListener('click', async e => {
  const t = e.target.closest('#tabs button');
  if (t) return showTab(t.dataset.t);
  const mv = e.target.closest('[data-mv]');
  if (mv) { const [p, i, d] = mv.dataset.mv.split('|'); move(at(p), +i, +d); setDirty(); return render(); }
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const [p, i] = rm.dataset.rm.split('|');
    const arr = at(p), it = arr[+i];
    if (!confirm(`"${it.name || it.group || it.alt || '이 항목'}"을(를) 지울까요?`)) return;
    arr.splice(+i, 1); setDirty(); return render();
  }
  const add = e.target.closest('[data-add]');
  if (add) {
    const [what, gi] = add.dataset.add.split('|');
    if (what === 'item') D.menu[+gi].items.push({ name: '', price: '' });
    if (what === 'group') D.menu.push({ group: '새 메뉴 묶음', items: [{ name: '', price: '' }] });
    if (what === 'sig' || what === 'photos') {
      const files = await pickFile(what === 'photos');
      if (!files.length) return;
      for (const [k, f] of files.entries()) {
        toast(`사진 올리는 중... (${k + 1}/${files.length})`, 1500);
        try {
          const src = await upload(f, what === 'sig' ? 1000 : 1400);
          if (what === 'sig') D.signature.push({ name: '', price: '', img: src, text: '', tag: '' });
          else D.gallery.push({ src, alt: '경주이가국밥 사진' });
        } catch (er) { toast('⚠️ ' + er.message, 4000); }
      }
    }
    setDirty(); render();
    return;
  }
  const si = e.target.closest('[data-sigimg], [data-storeimg]');
  if (si) {
    const [f] = await pickFile(false);
    if (!f) return;
    toast('사진 올리는 중...', 1500);
    try {
      if (si.dataset.sigimg !== undefined) D.signature[+si.dataset.sigimg].img = await upload(f, 1000);
      else D.stores[+si.dataset.storeimg].img = await upload(f, 1400);
      setDirty(); render();
      toast('사진을 올렸어요. [저장하기]를 눌러야 홈페이지에 나와요');
    } catch (er) { toast('⚠️ ' + er.message, 4000); }
  }
});
$('save').addEventListener('click', save);

/* ---------- 로그인 ---------- */
async function start() {
  $('login').hidden = true;
  try {
    await loadData();
  } catch (e) {
    $('login').hidden = false; $('login-err').textContent = e.message;
    return;
  }
  $('tabs').hidden = $('bar').hidden = $('logout').hidden = false;
  render(); showTab(tab); setDirty(false);
  $('state').textContent = '불러왔어요 · 고친 뒤 [저장하기]';
}
$('login-btn').addEventListener('click', () => {
  TOKEN = $('token').value.trim();
  if (!TOKEN) return;
  ($('remember').checked ? localStorage : sessionStorage).setItem('gj_gh_token', TOKEN);
  start();
});
$('token').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });
$('logout').addEventListener('click', () => {
  if (dirty && !confirm('저장하지 않은 변경이 있어요. 로그아웃할까요?')) return;
  localStorage.removeItem('gj_gh_token'); sessionStorage.removeItem('gj_gh_token');
  dirty = false; location.reload();
});
if (TOKEN) start(); else $('login').hidden = false;
