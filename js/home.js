/* ============ 동해카라반펜션 새 홈페이지 (new.html) ============
 * 화면에 나오는 내용은 두 데이터 파일에서 읽습니다. 디자인(이 파일 · css/home.css)과 내용이 분리돼 있어요.
 *   data/prices.json : 객실 이름 · 인원 · 요금 · 옵션 · 안내 문구 (관리자 화면 [요금 관리]에서 수정, 예약 서버도 같이 씀)
 *   data/site.json   : 메인 사진 · 소개 · 객실 시설 · 갤러리 · 관광지 · 공지 · 연락처
 * 객실 사진은 기존과 같이 images/rooms/<객실id>/1.jpg, 2.jpg ... (+ video.mp4, 360도 사진)을 자동으로 찾습니다.
 */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => Number(n).toLocaleString('ko-KR');
const GROUP_LABEL = { caravan: '카라반', pension: '펜션', deck: '데크존' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => matchMedia('(max-width: 640px)').matches;

let PRICE = null, SITE = null, ROOMS = [];

async function getJSON(url) {
  const res = await fetch(url + '?t=' + Date.now());
  if (!res.ok) throw new Error(url);
  return res.json();
}

/* ---------- 객실 도우미 ---------- */
const detailOf = r => (SITE.rooms && SITE.rooms[r.id]) || {};
const extraFree = r => /없음/.test(r.extra || '');
// "인원 추가 1인 10,000원" → 10000
const extraPerPerson = r => extraFree(r) ? 0 : +((r.extra || '').match(/([\d,]+)\s*원/) || [, '0'])[1].replace(/,/g, '');
const roomPhotos = {}, roomVideos = {};

function probeRoomPhotos(id, max = 12) {
  return new Promise(resolve => {
    const found = [];
    const next = n => {
      if (n > max) return resolve(found);
      const img = new Image();
      img.onload = () => { found.push(img.src); next(n + 1); };
      img.onerror = () => resolve(found);
      img.src = `images/rooms/${id}/${n}.jpg`;
    };
    next(1);
  });
}
function probeRoomVideo(id) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(v.src);
    v.onerror = () => resolve(null);
    v.src = `images/rooms/${id}/video.mp4`;
  });
}

/* ---------- 01 메인 슬라이드 ---------- */
function initHero() {
  const h = SITE.hero || {};
  if (h.title) $('hero-title').innerHTML = h.title;
  if (h.sub) $('hero-sub').innerHTML = h.sub;
  if (h.eyebrow) $('hero-eyebrow').textContent = h.eyebrow;
  const slides = h.slides || [];
  if (!slides.length) return;
  const box = $('hero-slides');
  const saveData = navigator.connection && navigator.connection.saveData;
  const useVideo = h.video && !reduceMotion && !saveData;
  box.innerHTML = slides.map((s, i) => `<div class="hero-slide${i === 0 ? ' on' : ''}">
    ${s.video && useVideo
      ? `<video muted playsinline loop preload="${i === 0 ? 'auto' : 'none'}" poster="${esc(isMobile() ? s.m || s.img : s.img)}" aria-label="${esc(s.alt)}">
           <source src="${esc(isMobile() && h.videoMobile ? h.videoMobile : h.video)}" type="video/mp4"></video>`
      : `<picture>${s.m ? `<source media="(max-width: 640px)" srcset="${esc(s.m)}">` : ''}
           <img src="${esc(s.img)}" alt="${esc(s.alt)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></picture>`}
  </div>`).join('');
  const els = [...box.children];
  const dots = $('hero-dots');
  dots.innerHTML = slides.length > 1 ? slides.map((_, i) => `<button aria-label="${i + 1}번 화면"></button>`).join('') : '';
  let cur = 0, timer = 0;
  const dur = i => (slides[i].video && useVideo ? 12000 : 6000);
  function show(i) {
    els[cur].classList.remove('on');
    const v0 = els[cur].querySelector('video'); if (v0) v0.pause();
    cur = (i + els.length) % els.length;
    els[cur].classList.add('on');
    const v = els[cur].querySelector('video');
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    [...dots.children].forEach(d => { d.classList.remove('on'); d.style.setProperty('--d', dur(cur) + 'ms'); });
    const dd = dots.children[cur];
    if (dd) { void dd.offsetWidth; dd.classList.add('on'); }   // 진행 막대 애니메이션 처음부터
    clearTimeout(timer);
    if (!reduceMotion && els.length > 1) timer = setTimeout(() => show(cur + 1), dur(cur));
  }
  dots.addEventListener('click', e => {
    const i = [...dots.children].indexOf(e.target);
    if (i >= 0) show(i);
  });
  // 첫 화면이 영상이면 바로 재생
  cur = 0;
  show(0);
  // 화면 밖으로 나가면 영상 멈춤 (휴대폰 배터리 · 데이터 절약)
  new IntersectionObserver(([en]) => {
    const v = els[cur].querySelector('video');
    if (v) en.isIntersecting ? v.play().catch(() => {}) : v.pause();
  }).observe($('home'));
}

/* ---------- 메뉴 ---------- */
function initNav() {
  const nav = $('nav'), burger = $('burger');
  const onScroll = () => nav.classList.toggle('solid', scrollY > 60);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const close = () => { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); };
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });
  $('menu').addEventListener('click', e => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', e => { if (nav.classList.contains('open') && !nav.contains(e.target)) close(); });
}

/* ---------- 공지 · 소개 · 스페셜 ---------- */
function renderIntro() {
  const notices = (SITE.notices || []).filter(n => n && (n.text || typeof n === 'string'));
  if (notices.length) {
    $('notice-text').textContent = notices.map(n => n.text || n).join('  ·  ');
    $('notice-bar').hidden = false;
  }
  $('about-grid').innerHTML = (SITE.about || []).map((a, i) => `
    <article class="about-card reveal d${i % 5}">
      <div class="ph"><img src="${esc(a.img)}" alt="${esc(a.title)}" loading="lazy"></div>
      <div class="bd"><span class="no">${esc(a.no)}</span><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></div>
    </article>`).join('');
  $('exp-grid').innerHTML = (SITE.experiences || []).map((x, i) => `
    <article class="exp reveal d${i % 3}">
      <img src="${esc(x.img)}" alt="${esc(x.title)}" loading="lazy">
      <div class="bd"><span class="tag">${esc(x.tag)}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>
    </article>`).join('');
  $('amen').innerHTML = (SITE.amenities || []).map(a =>
    `<div class="reveal"><i>${esc(a.icon)}</i><p><b>${esc(a.title)}</b><span>${esc(a.text)}</span></p></div>`).join('');
}

/* ---------- 04 · 05 객실 카드 ---------- */
function roomCard(r, i) {
  const d = detailOf(r);
  const facil = (d.facilities || []).slice(0, 5).map(f => `<span>${esc(f)}</span>`).join('');
  return `<article class="room-card reveal d${i % 3}" data-room="${esc(r.id)}">
    <button type="button" class="room-ph" data-open="${esc(r.id)}" aria-label="${esc(r.name)} 사진 · 상세 보기">
      <img src="${esc(r.cover)}" alt="${esc(r.name)} ${esc(d.type || '')}" loading="lazy" data-cover="${esc(r.id)}">
      <span class="badges"><span class="chip-b gold">${esc(d.view || r.badge)}</span>${r.badge && r.badge !== d.view ? `<span class="chip-b">${esc(r.badge)}</span>` : ''}</span>
      <span class="more" data-more="${esc(r.id)}">사진 보기</span>
    </button>
    <div class="room-bd">
      <span class="room-type">${esc(d.type || GROUP_LABEL[r.group])}</span>
      <h3>${esc(r.name)}</h3>
      <div class="room-cap"><span>기준 <b>${r.std}명</b></span><span>최대 <b>${r.max}명</b></span></div>
      <div class="room-facil">${facil}</div>
      <p class="room-extra${extraFree(r) ? ' free' : ''}">${extraFree(r) ? '✓ 추가 인원 비용 없음' : esc(r.extra)}</p>
      <div class="room-foot">
        <p class="room-price"><b>${won(r.price.normal[0])}</b>원~ / 1박</p>
        <div class="btns">
          <button class="btn btn-line-dark btn-sm" data-open="${esc(r.id)}">자세히</button>
          <button class="btn btn-navy btn-sm" data-book="${esc(r.id)}">예약하기</button>
        </div>
      </div>
    </div>
  </article>`;
}

function renderRooms() {
  const by = g => ROOMS.filter(r => r.group === g);
  $('caravan-grid').innerHTML = by('caravan').map(roomCard).join('');
  $('pension-grid').innerHTML = by('pension').map(roomCard).join('');
  $('deck-grid').innerHTML = by('deck').map(r => {
    const d = detailOf(r);
    return `<article class="deck-card reveal" data-room="${esc(r.id)}">
      <button type="button" class="room-ph" data-open="${esc(r.id)}" aria-label="${esc(r.name)} 사진 보기">
        <img src="${esc(r.cover)}" alt="${esc(r.name)}" loading="lazy" data-cover="${esc(r.id)}">
        <span class="badges"><span class="chip-b gold">${esc(d.view || r.badge)}</span></span>
      </button>
      <div class="room-bd">
        <span class="room-type">⛺ ${esc(d.type || '캠핑 데크')}</span>
        <h3>${esc(r.name)}</h3>
        <p class="room-extra">${esc(d.intro || r.desc)}</p>
        <div class="room-cap"><span>기준 <b>${r.std}명</b></span><span>최대 <b>${r.max}명</b></span><span>${esc(r.extra)}</span></div>
        <div class="room-foot">
          <p class="room-price"><b>${won(r.price.normal[0])}</b>원~ / 1박</p>
          <div class="btns"><button class="btn btn-line-dark btn-sm" data-open="${esc(r.id)}">자세히</button><button class="btn btn-navy btn-sm" data-book="${esc(r.id)}">예약하기</button></div>
        </div>
      </div>
    </article>`;
  }).join('');

  ROOMS.forEach(r => {
    probeRoomPhotos(r.id).then(ph => {
      roomPhotos[r.id] = ph;
      if (ph.length) document.querySelectorAll(`[data-cover="${r.id}"]`).forEach(img => { img.src = ph[0]; });
      document.querySelectorAll(`[data-more="${r.id}"]`).forEach(el => {
        el.textContent = `📷 ${ph.length || 1}${DhcTour.has(r.id) ? ' · 360°' : ''}`;
      });
    });
    probeRoomVideo(r.id).then(src => { roomVideos[r.id] = src; });
  });
}

// 카드 · 비교표 · 추천의 [자세히] [예약하기] 버튼
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) { openRoom(o.dataset.open); return; }
  const b = e.target.closest('[data-book]');
  if (b) { closeRoom(); pickRoom(b.dataset.book); }
});

/* ---------- 객실 상세 창 ---------- */
let slideIdx = 0, slideCount = 0;
function openRoom(id) {
  const r = ROOMS.find(x => x.id === id);
  if (!r) return;
  const d = detailOf(r);
  const photos = roomPhotos[r.id] && roomPhotos[r.id].length ? roomPhotos[r.id] : [r.cover];
  const video = roomVideos[r.id];
  const tour = DhcTour.has(r.id);
  const slides = [];
  if (tour) slides.push({ html: `<div class="slider-pano"><div class="pano-cover" style="background-image:url('${esc(photos[0])}')"><button type="button" class="pano-start">🔄 360° 둘러보기</button></div></div>`, thumb: '360°' });
  if (video) slides.push({ html: `<video src="${esc(video)}" controls playsinline preload="metadata"></video>`, thumb: '▶' });
  photos.forEach((src, i) => slides.push({ html: `<img src="${esc(src)}" alt="${esc(r.name)} 사진 ${i + 1}" ${i ? 'loading="lazy"' : ''}>`, img: src }));
  $('rm-track').innerHTML = slides.map(s => s.html).join('');
  $('rm-thumbs').innerHTML = slides.length > 1 ? slides.map((s, i) =>
    `<button data-i="${i}" aria-label="${i + 1}번">${s.img ? `<img src="${esc(s.img)}" alt="" loading="lazy">` : s.thumb}</button>`).join('') : '';
  slideCount = slides.length; slideIdx = 0; updateSlide();
  $('rm-prev').hidden = $('rm-next').hidden = slideCount < 2;

  if (tour) {
    const btn = $('rm-track').querySelector('.pano-start');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '불러오는 중...';
      try { await DhcTour.open(r); btn.textContent = '🔄 360° 둘러보기'; } catch { btn.textContent = '⚠️ 다시 시도'; }
      btn.disabled = false;
    });
  }

  const p = r.price;
  $('rm-body').innerHTML = `
    <span class="room-type">${esc(d.type || GROUP_LABEL[r.group])} · ${esc(d.view || r.badge)}</span>
    <h3 id="rm-title">${esc(r.name)}</h3>
    <p class="intro">${esc(d.intro || r.desc)}</p>
    <div class="rm-spec">
      <div><small>기준 인원</small><b>${r.std}명</b></div>
      <div><small>최대 인원</small><b>${r.max}명</b></div>
      <div><small>추가 인원</small><b style="font-size:13.5px">${extraFree(r) ? '비용 없음' : esc((r.extra || '').replace('인원 추가 ', ''))}</b></div>
    </div>
    ${d.spaces && d.spaces.length ? `<h4>SPACE</h4><div class="room-facil">${d.spaces.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
    ${d.facilities && d.facilities.length ? `<h4>FACILITIES</h4><div class="room-facil">${d.facilities.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
    <h4>PRICE · 1박</h4>
    <table class="rm-price">
      <thead><tr><th></th><th>평일</th><th>주말</th></tr></thead>
      <tbody>
        <tr><th>비수기</th><td>${won(p.normal[0])}원</td><td>${won(p.normal[1])}원</td></tr>
        <tr><th>성수기</th><td>${won(p.peak[0])}원</td><td>${won(p.peak[1])}원</td></tr>
      </tbody>
    </table>
    <p class="rm-note">${PRICE.modalNote || ''}</p>
    <div class="rm-actions">
      <button class="btn btn-navy" data-book="${esc(r.id)}">이 객실 예약하기</button>
      <a class="btn btn-line-dark" href="tel:${esc(SITE.contact.phone)}">전화 문의</a>
    </div>`;
  $('rm').hidden = false;
  document.body.style.overflow = 'hidden';
  $('rm-body').scrollTop = 0;
}
function closeRoom() {
  if ($('rm').hidden) return;
  $('rm').hidden = true;
  document.body.style.overflow = '';
  $('rm-track').querySelectorAll('video').forEach(v => v.pause());
}
function updateSlide() {
  $('rm-track').style.transform = `translateX(-${slideIdx * 100}%)`;
  $('rm-count').textContent = slideCount > 1 ? `${slideIdx + 1} / ${slideCount}` : '';
  [...$('rm-thumbs').children].forEach((b, i) => b.classList.toggle('on', i === slideIdx));
  const on = $('rm-thumbs').children[slideIdx];
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('rm-track').querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });
}
const moveSlide = d => { slideIdx = (slideIdx + d + slideCount) % slideCount; updateSlide(); };
$('rm-prev').onclick = () => moveSlide(-1);
$('rm-next').onclick = () => moveSlide(1);
$('rm-thumbs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { slideIdx = +b.dataset.i; updateSlide(); } });
$('rm').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeRoom(); });
swipe($('rm-slider'), d => moveSlide(d));

// 손가락으로 밀어서 넘기기
function swipe(el, cb) {
  let x0 = null, y0 = 0;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) cb(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ---------- 06 인원별 추천 ---------- */
// 추천 기준은 js/reco.js (AI 숙박 도우미와 같이 씀)
const recommend = n => DhcReco.recommend(ROOMS, SITE.rooms, n);
// "오션 전면뷰 카라반 아도라542UL · 하비495WFB 또는 펜션 구름 · 바다"
function recoNames(best) {
  const c = best.filter(x => x.r.group === 'caravan'), p = best.filter(x => x.r.group !== 'caravan');
  const names = xs => xs.map(x => `<b>${esc(x.r.name)}</b>`).join(' · ');
  const parts = [];
  if (c.length) parts.push(`${c.every(x => x.front) ? '오션 전면뷰 ' : ''}카라반 ${names(c)}`);
  if (p.length) parts.push(`펜션 ${names(p)}`);
  return parts.join(' 또는 ');
}
function recoText(x) {
  const r = x.r;
  if (!x.extraN) return `기준 ${r.std}명 · 최대 ${r.max}명`;
  return extraFree(r) ? `기준 ${r.std}명 · 최대 ${r.max}명 · 추가 인원 비용 없음`
    : `기준 ${r.std}명 · 추가 ${x.extraN}명 +${won(x.extraCost)}원/박`;
}
function renderReco() {
  const MAXN = Math.max(...ROOMS.filter(r => r.group !== 'deck').map(r => r.max));
  const btns = [];
  for (let n = 1; n <= MAXN; n++) btns.push(`<button data-n="${n}">${n}명</button>`);
  btns.push(`<button data-n="${MAXN + 1}">${MAXN + 1}명+</button>`);
  $('people').innerHTML = btns.join('');
  $('people').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    [...$('people').children].forEach(x => x.classList.toggle('on', x === b));
    showReco(+b.dataset.n, MAXN);
  });
}
function showReco(n, MAXN) {
  const out = $('reco-out');
  if (n > MAXN) {
    const big = ROOMS.filter(r => r.group === 'pension').sort((a, b) => b.max - a.max);
    out.innerHTML = `<p class="reco-msg">${n - 1}명이 넘는 단체는 <b>여러 객실을 함께</b> 예약해 주세요. 실시간 예약에서 한 번에 여러 객실을 고를 수 있고, 전화로도 도와드립니다.</p>
      <div class="reco-list">${big.map(r => recoItem({ r, extraN: 0 }, false)).join('')}</div>`;
    return;
  }
  const { list, best } = recommend(n);
  if (!list.length) { out.innerHTML = '<p class="reco-msg">맞는 객실이 없습니다. 전화로 문의해 주세요.</p>'; return; }
  out.innerHTML = `<p class="reco-msg"><b>${n}명</b>이면 ${recoNames(best)} 객실을 추천합니다. 머물 수 있는 객실 ${list.length}곳</p>
    <div class="reco-list">${list.map(x => recoItem(x, x.best)).join('')}</div>`;
}
function recoItem(x, best) {
  const r = x.r;
  return `<button class="reco-item" data-open="${esc(r.id)}">
    <img src="${esc((roomPhotos[r.id] || [])[0] || r.cover)}" alt="" loading="lazy">
    <span>${best ? '<span class="best">추천</span>' : ''}<b>${esc(r.name)}</b><small>${esc(detailOf(r).type || GROUP_LABEL[r.group])} · ${esc(x.view || detailOf(r).view || r.badge)}</small><small>${recoText(x)}</small>
    <small>${won(r.price.normal[0])}원~ / 1박</small></span>
  </button>`;
}

/* ---------- 06 비교표 · 요금표 ---------- */
function renderTables() {
  let last = '';
  $('cmp-table').querySelector('tbody').innerHTML = ROOMS.map(r => {
    const d = detailOf(r);
    const head = r.group !== last ? `<tr class="grp"><td colspan="8">${esc(GROUP_LABEL[r.group] || r.group)}</td></tr>` : '';
    last = r.group;
    return `${head}<tr>
      <th>${esc(r.name)}<small>${esc(d.type || '')}</small></th>
      <td class="num">${r.std}명</td><td class="num">${r.max}명</td>
      <td>${esc(d.view || r.badge)}</td>
      <td class="facil">${esc((d.facilities || []).join(' · '))}</td>
      <td>${extraFree(r) ? '<b style="color:var(--ocean)">비용 없음</b>' : esc((r.extra || '').replace('인원 추가 ', ''))}</td>
      <td class="num">${won(r.price.normal[0])}원~</td>
      <td><button class="btn btn-navy btn-sm" data-book="${esc(r.id)}">예약</button></td>
    </tr>`;
  }).join('');

  $('price-tbody').innerHTML = ROOMS.map(r => `<tr>
    <th>${esc(r.name)}<small>${esc(GROUP_LABEL[r.group])}</small></th><td>${r.std}</td><td>${r.max}</td>
    <td>${won(r.price.normal[0])}</td><td>${won(r.price.normal[1])}</td><td>${won(r.price.peak[0])}</td><td>${won(r.price.peak[1])}</td>
    <td class="${extraFree(r) ? 'free' : ''}">${esc(r.extra)}</td></tr>`).join('');
  last = '';
  $('price-cards').innerHTML = ROOMS.map(r => `<div class="pc">
      <div class="pc-head"><b>${esc(r.name)}</b><span>${esc(GROUP_LABEL[r.group])} · 기준 ${r.std}명 · 최대 ${r.max}명</span></div>
      <table><tr><th></th><th>평일</th><th>주말</th></tr>
        <tr><th>비수기</th><td>${won(r.price.normal[0])}</td><td>${won(r.price.normal[1])}</td></tr>
        <tr><th>성수기</th><td>${won(r.price.peak[0])}</td><td>${won(r.price.peak[1])}</td></tr></table>
      <p class="ex${extraFree(r) ? ' free' : ''}">${esc(r.extra)}</p>
    </div>`).join('');

  const opts = PRICE.options || [];
  $('option-tbody').innerHTML = opts.map(o =>
    `<tr><th>${esc(o.name)}</th><td>${esc(o.detail)}</td><td class="num">${o.price === '무료' ? '<b style="color:var(--ocean)">무료</b>' : esc(o.price)}</td></tr>`).join('') +
    (PRICE.optionNote ? `<tr><td colspan="3" style="text-align:left;font-size:13.5px;color:var(--muted)">${PRICE.optionNote}</td></tr>` : '');
  // 안내 문구는 관리자 화면에서 <strong> 등을 넣어 쓰므로 그대로 표시
  $('price-notes').innerHTML = (PRICE.notes || []).map(n => `<li>${n}</li>`).join('');
}

/* ---------- 07 갤러리 ---------- */
let G_ALL = [], gCat = 'all', gShown = 0;
const G_PAGE = 12;
async function loadGallery() {
  G_ALL = (SITE.gallery || []).map(g => ({ ...g, cat: g.cat || [] }));
  renderGalleryTabs(); renderGallery();
  // 관리자 [사진 관리]에서 올린 사진 중 여기 없는 번호는 '전체'에 붙임
  const known = new Set(G_ALL.filter(g => g.photo).map(g => g.photo).concat(SITE.galleryExclude || []));
  const extra = [];
  for (let n = 1; n <= 100; n++) {
    const ok = await exists(`images/photos/${n}.jpg`);
    if (!ok) break;
    if (!known.has(n)) extra.push({ src: `images/photos/${n}.jpg`, thumb: `images/photos/${n}.jpg`, cat: [], alt: '동해카라반펜션 사진', photo: n });
  }
  if (extra.length) { G_ALL = G_ALL.concat(extra); renderGalleryTabs(); if (gCat === 'all') renderGallery(gShown); }
}
// 파일이 있는지만 확인 (HEAD 가 안 되는 서버면 그림을 불러 봄)
async function exists(src) {
  try {
    const r = await fetch(src, { method: 'HEAD', cache: 'no-store' });
    if (r.ok) return true;
    if (r.status === 404) return false;
  } catch { /* 아래에서 다시 확인 */ }
  return new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
}
const gList = () => gCat === 'all' ? G_ALL : G_ALL.filter(g => g.cat.includes(gCat));
function renderGalleryTabs() {
  $('g-tabs').innerHTML = (SITE.galleryCats || []).map(c => {
    const n = c.id === 'all' ? G_ALL.length : G_ALL.filter(g => g.cat.includes(c.id)).length;
    if (!n) return '';
    return `<button role="tab" data-c="${esc(c.id)}" class="${c.id === gCat ? 'on' : ''}" aria-selected="${c.id === gCat}">${esc(c.name)}<small>${n}</small></button>`;
  }).join('');
}
function renderGallery(upTo) {
  const list = gList();
  gShown = Math.min(list.length, Math.max(upTo || 0, G_PAGE));
  // 크기 패턴: 큰 사진 · 넓은 사진을 섞어 잡지처럼
  const pat = ['big', '', '', 'wide', '', '', '', 'wide', '', 'big', '', ''];
  $('g-grid').innerHTML = list.slice(0, gShown).map((g, i) =>
    `<button class="g-item ${pat[i % pat.length]}" data-g="${i}"><img src="${esc(g.thumb || g.src)}" alt="${esc(g.alt)}" loading="lazy"><span>${esc(g.alt)}</span></button>`).join('');
  $('g-more').hidden = gShown >= list.length;
  $('g-more').textContent = `사진 더 보기 (${list.length - gShown})`;
}
$('g-tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  gCat = b.dataset.c;
  renderGalleryTabs(); renderGallery();
});
$('g-more').onclick = () => renderGallery(gShown + G_PAGE);
$('g-grid').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) openLB(gList(), +b.dataset.g); });

/* 크게 보기 (갤러리 · 동해횟집 사진 함께 사용) */
let lbList = [], lbIdx = 0, lbTimer = 0;
function openLB(list, i) {
  lbList = list; lbIdx = i;
  $('lb-thumbs').innerHTML = list.map((g, k) => `<button data-k="${k}" aria-label="${k + 1}번 사진"><img src="${esc(g.thumb || g.src)}" alt="" loading="lazy"></button>`).join('');
  showLB();
  $('lb').hidden = false;
  document.body.style.overflow = 'hidden';
}
function showLB() {
  const g = lbList[lbIdx];
  const img = $('lb-img');
  img.style.opacity = .3;
  img.onload = () => { img.style.opacity = 1; };
  img.src = g.src; img.alt = g.alt || '';
  $('lb-cap').textContent = `${lbIdx + 1} / ${lbList.length}  ${g.alt || ''}`;
  [...$('lb-thumbs').children].forEach((b, k) => b.classList.toggle('on', k === lbIdx));
  const on = $('lb-thumbs').children[lbIdx];
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  // 다음 사진 미리 불러오기
  const nx = lbList[(lbIdx + 1) % lbList.length];
  if (nx) new Image().src = nx.src;
}
const moveLB = d => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLB(); };
function stopPlay() { clearInterval(lbTimer); lbTimer = 0; $('lb-play').textContent = '▶'; }
function closeLB() { $('lb').hidden = true; document.body.style.overflow = $('rm').hidden ? '' : 'hidden'; stopPlay(); }
$('lb-prev').onclick = () => { stopPlay(); moveLB(-1); };
$('lb-next').onclick = () => { stopPlay(); moveLB(1); };
$('lb-close').onclick = closeLB;
$('lb-play').onclick = () => {
  if (lbTimer) return stopPlay();
  $('lb-play').textContent = '❚❚';
  lbTimer = setInterval(() => moveLB(1), 3500);
};
$('lb-thumbs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { stopPlay(); lbIdx = +b.dataset.k; showLB(); } });
$('lb-stage').addEventListener('click', e => { if (e.target === $('lb-stage')) closeLB(); });
swipe($('lb-stage'), d => { stopPlay(); moveLB(d); });

function initFish() {
  const btns = [...$('fish-shots').children];
  const list = btns.map(b => { const im = b.querySelector('img'); return { src: im.getAttribute('src'), alt: im.alt }; });
  btns.forEach((b, i) => b.addEventListener('click', () => openLB(list, i)));
}

document.addEventListener('keydown', e => {
  if (!$('lb').hidden) {
    if (e.key === 'Escape') closeLB();
    if (e.key === 'ArrowLeft') { stopPlay(); moveLB(-1); }
    if (e.key === 'ArrowRight') { stopPlay(); moveLB(1); }
  } else if (!$('rm').hidden && $('vr-tour').hidden) {
    if (e.key === 'Escape') closeRoom();
    if (e.key === 'ArrowLeft') moveSlide(-1);
    if (e.key === 'ArrowRight') moveSlide(1);
  }
});

/* ---------- 08 관광지 ---------- */
function renderSpots() {
  $('spot-grid').innerHTML = (SITE.spots || []).map((s, i) => `
    <article class="spot reveal d${i % 3}">
      <div class="ph">${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name)}" loading="lazy">` : `<span aria-hidden="true">${esc(s.icon)}</span>`}<span class="dist">${esc(s.dist)}</span></div>
      <div class="bd">
        <h3>${esc(s.name)}</h3><p class="sub">${esc(s.sub)}</p><p>${esc(s.text)}</p>
        <div class="links">
          <a href="https://map.naver.com/p/search/${encodeURIComponent(s.query || s.name)}" target="_blank" rel="noopener">네이버 지도</a>
          <a href="https://map.kakao.com/link/search/${encodeURIComponent(s.query || s.name)}" target="_blank" rel="noopener">카카오맵</a>
        </div>
      </div>
    </article>`).join('');
}

/* ---------- 09 빠른 예약 → reserve.html ---------- */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const nightsOf = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
function initQuickBook() {
  const today = ymd(new Date());
  $('qb-in').min = today;
  $('qb-out').min = addDays(today, 1);
  $('qb-room').innerHTML = '<option value="">전체 객실 보기</option>' +
    ['caravan', 'pension', 'deck'].map(g => {
      const list = ROOMS.filter(r => r.group === g);
      return list.length ? `<optgroup label="${GROUP_LABEL[g]}">${list.map(r => `<option value="${esc(r.id)}">${esc(r.name)} (최대 ${r.max}명)</option>`).join('')}</optgroup>` : '';
    }).join('');
  const fillN = () => {
    const r = ROOMS.find(x => x.id === $('qb-room').value);
    const max = r ? r.max : Math.max(...ROOMS.map(x => x.max));
    const cur = +$('qb-n').value || (r ? r.std : 2);
    $('qb-n').innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${i + 1 === Math.min(cur, max) ? 'selected' : ''}>${i + 1}명</option>`).join('');
  };
  fillN();
  $('qb-room').addEventListener('change', fillN);
  const upd = () => {
    const a = $('qb-in').value, b = $('qb-out').value;
    if (a) {
      $('qb-out').min = addDays(a, 1);
      if (!b || b <= a) $('qb-out').value = addDays(a, 1);
    }
    const x = $('qb-in').value, y = $('qb-out').value;
    $('qb-nights').textContent = x && y && y > x ? `${x.replace(/-/g, '.')} ~ ${y.replace(/-/g, '.')} · ${nightsOf(x, y)}박` : '';
    $('qb-err').textContent = '';
  };
  $('qb-in').addEventListener('change', upd);
  $('qb-out').addEventListener('change', upd);
  $('qb').addEventListener('submit', e => {
    e.preventDefault();
    const a = $('qb-in').value, b = $('qb-out').value;
    if (!a || !b) { $('qb-err').textContent = '입실일과 퇴실일을 골라 주세요.'; return; }
    if (a < today) { $('qb-err').textContent = '지난 날짜는 예약할 수 없습니다.'; return; }
    if (b <= a) { $('qb-err').textContent = '퇴실일은 입실일 다음 날 이후로 골라 주세요.'; return; }
    const q = new URLSearchParams({ ci: a, co: b });
    if ($('qb-room').value) q.set('room', $('qb-room').value);
    q.set('n', $('qb-n').value);
    location.href = `${SITE.contact.reserveUrl || 'reserve.html'}?${q}`;
  });
}
// 객실 카드 · 상세 창의 [예약하기] → 빠른 예약에 객실을 넣고 이동
function pickRoom(id) {
  const r = ROOMS.find(x => x.id === id);
  if (!r) return;
  $('qb-room').value = id;
  $('qb-room').dispatchEvent(new Event('change'));
  $('qb-n').value = r.std;
  $('reserve').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  setTimeout(() => { if (!$('qb-in').value) $('qb-in').focus({ preventScroll: true }); }, 700);
}

/* ---------- 주소 복사 ---------- */
$('copy-addr').addEventListener('click', async () => {
  const btn = $('copy-addr');
  try {
    await navigator.clipboard.writeText($('addr-text').textContent.trim());
    btn.textContent = '복사 완료!';
  } catch { btn.textContent = '복사 안 됨'; }
  setTimeout(() => { btn.textContent = '주소 복사'; }, 1500);
});

/* ---------- 홍보 팝업 (data/popup.json, 관리자 화면에서 수정) ---------- */
async function loadPopup() {
  try {
    const p = await getJSON('data/popup.json');
    if (!p.enabled || Date.now() < (+localStorage.getItem('dhc_popup_hide') || 0)) return;
    $('popup-title').textContent = p.title || '';
    $('popup-text').textContent = p.body || '';
    if (p.image) { $('popup-img').src = p.image + '?t=' + Date.now(); $('popup-img').hidden = false; }
    if (p.link) { $('popup-link').href = p.link; $('popup-link').textContent = p.linkText || '자세히 보기'; $('popup-link').hidden = false; }
    const pop = $('promo-popup');
    pop.hidden = false;
    pop.addEventListener('click', e => {
      if (!e.target.hasAttribute('data-pclose')) return;
      if ($('popup-today').checked) localStorage.setItem('dhc_popup_hide', Date.now() + 864e5);
      pop.hidden = true;
    });
  } catch { /* 팝업 없음 */ }
}

/* ---------- 스크롤하면 나타나기 ---------- */
let revealObs = null;
function observeReveal() {
  if (reduceMotion || !('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
    return;
  }
  revealObs = revealObs || new IntersectionObserver(ens => ens.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('in'); revealObs.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal:not(.in)').forEach(el => revealObs.observe(el));
}

/* ---------- 시작 ---------- */
(async () => {
  initNav();
  initFish();
  try {
    [PRICE, SITE] = await Promise.all([getJSON('data/prices.json'), getJSON('data/site.json'), DhcTour.load()]);
  } catch (e) {
    console.error(e);
    observeReveal();
    return;
  }
  ROOMS = PRICE.rooms || [];
  initHero();
  renderIntro();
  renderRooms();
  renderReco();
  renderTables();
  renderSpots();
  initQuickBook();
  observeReveal();
  loadPopup();
  // 갤러리는 화면 가까이 왔을 때 불러옴 (첫 화면 빠르게)
  const gObs = new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) return;
    gObs.disconnect();
    loadGallery().then(observeReveal);
  }, { rootMargin: '600px 0px' });
  gObs.observe($('gallery'));
  // AI 숙박 도우미(js/concierge.js)가 같은 데이터를 쓰도록 공개
  window.DHC = { PRICE, SITE, ROOMS, openRoom, pickRoom, recommend, extraFree, extraPerPerson };
  document.dispatchEvent(new CustomEvent('dhc:ready'));
})();
