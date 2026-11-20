/* ============ 경주이가국밥 ============
 * 내용은 data/stores.json 에서 읽습니다 (가격 · 영업시간 · 전화 · 사진). 이 파일은 화면 그리기만.
 */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK = ['월', '화', '수', '목', '금', '토', '일'];
let D = null;

/* ---------- 지금 한국 시간 기준 영업 여부 ---------- */
function nowKST() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { day: DAYS[wd], hm: `${p.hour}:${p.minute}` };
}
function status(s) {
  const { day, hm } = nowKST();
  const h = s.hours[day];
  if (!h) return { open: false, text: '오늘 휴무', day };
  if (hm < h[0]) return { open: false, text: `${h[0]} 영업 시작`, day };
  if (hm >= h[1]) return { open: false, text: '영업 종료', day };
  return { open: true, text: `영업 중 · ${h[1]}까지`, day };
}

/* ---------- 그리기 ---------- */
function render() {
  const b = D.brand;
  $('story-text').textContent = b.story;
  $('cheer').innerHTML = `${esc(b.message).replace('오늘 하루도', '<br>오늘 하루도')}<b>${esc(b.slogan)}</b>`;

  $('sig').innerHTML = D.signature.map(m => `
    <article class="sig-card rv-in">
      <div class="ph"><img src="${esc(m.img)}" alt="경주이가국밥 ${esc(m.name)}" loading="lazy">${m.tag ? `<span class="tag">${esc(m.tag)}</span>` : ''}</div>
      <div class="bd"><h3>${esc(m.name)}<span>${esc(m.price)}원</span></h3><p>${esc(m.text)}</p></div>
    </article>`).join('');

  // 메뉴판: 첫 묶음(식사류)은 왼쪽, 나머지는 오른쪽 · 휴대폰은 탭
  const grp = (g, i) => `<div class="mgroup${i === 0 ? ' on' : ' single'}" data-g="${i}"><h4>${esc(g.group)}</h4><ul>${g.items.map(it =>
    `<li><p>${esc(it.name)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</p><span>${esc(it.price)}</span></li>`).join('')}</ul></div>`;
  $('board-body').innerHTML = grp(D.menu[0], 0) + `<div class="mside">${D.menu.slice(1).map((g, i) => grp(g, i + 1)).join('')}</div>`;
  $('board-tabs').innerHTML = D.menu.map((g, i) => `<button type="button" data-g="${i}" class="${i ? '' : 'on'}">${esc(g.group)}</button>`).join('');
  $('menu-note').textContent = `※ ${D.menuNote}`;

  const pics = D.gallery.concat(D.gallery);   // 끊김 없이 흐르도록 두 번
  $('strip').innerHTML = pics.map((g, i) => `<img src="${esc(g.src)}" alt="${i < D.gallery.length ? esc(g.alt) : ''}" loading="lazy">`).join('');

  renderStores();

  $('foot-stores').innerHTML = D.stores.map(s =>
    `<p class="foot-st"><b>${esc(s.name)}</b> · ${esc(s.road)} · <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a> · ${esc(s.closed)}</p>`).join('');
  // 배달앱 주소가 하나라도 있으면 [배달 주문] 버튼을 보여 줌 (휴대폰 하단은 '지점' 대신)
  const anyDelivery = D.stores.some(s => links(s).length);
  document.querySelectorAll('[data-delivery]').forEach(b => { b.hidden = !anyDelivery; });
  $('mbar-stores').hidden = anyDelivery;
}

/* ---------- 배달 주문: 지점 → 그 지점이 입점한 배달앱 → 앱의 가게 주문 화면 ----------
 * 주문 · 결제 · 배달은 각 배달앱에서 진행. 주소가 없는 앱은 버튼을 숨김.
 * https 주소를 그대로 열면 휴대폰에서는 배달앱이 설치돼 있을 때 앱으로 열림 */
const links = s => (D.platforms || []).filter(p => /^https:\/\//.test((s.delivery || {})[p.id] || ''))
  .map(p => ({ ...p, url: s.delivery[p.id] }));

function openSheet(mode, storeId) {
  const list = $('sheet-list');
  if (mode === 'call') {
    $('sheet-title').textContent = '어느 지점으로 전화할까요?';
    list.innerHTML = D.stores.map(s => `<a href="tel:${esc(s.phone)}">${esc(s.name)}<small>${esc(s.area)} · ${esc(status(s).text)}</small><span>${esc(s.phone)}</span></a>`).join('');
  } else if (!storeId) {
    $('sheet-title').textContent = '🛵 어느 지점에서 배달 주문할까요?';
    list.innerHTML = D.stores.map(s => {
      const n = links(s).length;
      return `<a href="#" data-dstore="${esc(s.id)}">${esc(s.name)}<small>${esc(s.area)} · ${esc(status(s).text)}</small><span>${n ? `배달앱 ${n}곳 ›` : '전화 주문 ›'}</span></a>`;
    }).join('');
  } else {
    const s = D.stores.find(x => x.id === storeId);
    const ls = links(s);
    $('sheet-title').textContent = `🛵 ${s.name} 배달 주문`;
    list.innerHTML = (ls.length
      ? ls.map(p => `<a class="plat" href="${esc(p.url)}" target="_blank" rel="noopener" style="--c:${esc(p.color)}">${esc(p.name)}<small>앱에서 주문 · 결제</small><span>열기 ›</span></a>`).join('')
      : `<p class="sheet-empty">${esc(s.name)}은 아직 배달앱 주문 링크가 없어요.<br>전화로 주문해 주세요.</p>`) +
      `<a href="tel:${esc(s.phone)}">📞 전화 주문<small>${esc(s.name)}</small><span>${esc(s.phone)}</span></a>
       <button type="button" class="sheet-back" data-delivery>‹ 다른 지점 고르기</button>`;
  }
  $('sheet').hidden = false;
}

function renderStores(nearId) {
  const { day } = nowKST();
  $('hero-open').innerHTML = D.stores.map(s => {
    const st = status(s);
    return `<span><i class="dot${st.open ? ' on' : ''}"></i>${esc(s.name)} ${esc(st.open ? '영업 중' : st.text)}</span>`;
  }).join('');
  $('store-list').innerHTML = D.stores.map(s => {
    const st = status(s);
    const rows = WEEK.map(d => {
      const h = s.hours[d];
      return `<tr class="${d === day ? 'today' : ''}${h ? '' : ' off'}"><td>${d}${d === day ? ' (오늘)' : ''}</td><td>${h ? `${h[0]} ~ ${h[1]}` : '정기휴무'}</td></tr>`;
    }).join('');
    const naver = `https://m.place.naver.com/restaurant/${s.naverId}/home`;
    const kakao = `https://map.kakao.com/link/to/${encodeURIComponent(s.full)},${s.lat},${s.lng}`;
    return `<article class="store rv-in${s.id === nearId ? ' near' : ''}" id="st-${esc(s.id)}">
      <div class="ph">${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.full)} 외관" loading="lazy">`
        : `<div class="noimg"><div>李가국밥 ${esc(s.name)}<small>${esc(s.area)}</small></div></div>`}
        <span class="badge"><i class="dot${st.open ? ' on' : ''}"></i>${esc(st.text)}</span>
        ${s.id === nearId ? '<span class="nearb">가장 가까운 지점</span>' : ''}</div>
      <div class="bd">
        <h3>${esc(s.name)}<small>${esc(s.area)}</small></h3>
        <p class="addr">${esc(s.road)}</p>
        ${s.landmark ? `<p class="lm">${esc(s.landmark)}</p>` : ''}
        <a class="tel" href="tel:${esc(s.phone)}">📞 ${esc(s.phone)}</a>
        ${s.review ? `<p class="rv">💬 “${esc(s.review)}” <small>— 네이버 방문자 리뷰 요약</small></p>` : ''}
        <table class="hours">${rows}</table>
        <p class="lm">${esc(s.closed)}${s.lastOrder ? ` · 라스트오더 ${esc(s.lastOrder)}` : ''}</p>
        <div class="feat">${s.features.map(f => `<span>${esc(f)}</span>`).join('')}</div>
        ${links(s).length ? `<div class="dlv">${links(s).map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="--c:${esc(p.color)}">🛵 ${esc(p.name)}</a>`).join('')}</div>` : ''}
        <div class="acts">
          <a class="btn btn-red full" href="tel:${esc(s.phone)}">전화 · 포장 주문</a>
          <a class="btn btn-line" href="${naver}" target="_blank" rel="noopener">네이버 지도</a>
          <a class="btn btn-line" href="${kakao}" target="_blank" rel="noopener">카카오 길찾기</a>
          <button class="btn btn-dark btn-sm full" type="button" data-map="${esc(s.id)}">아래 지도에서 보기</button>
        </div>
      </div>
    </article>`;
  }).join('');
  observe();
}

function showMap(id) {
  const s = D.stores.find(x => x.id === id) || D.stores[0];
  $('map').src = `https://maps.google.com/maps?q=${s.lat},${s.lng}&z=16&output=embed`;
  $('map').title = `${s.full} 지도`;
}

/* ---------- 가까운 지점 (위치는 이 기기 안에서만 계산, 어디에도 보내지 않음) ---------- */
function distKm(a, b, c, d) {
  const r = x => x * Math.PI / 180, R = 6371;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
$('near-btn').addEventListener('click', () => {
  if (!navigator.geolocation) { $('near-msg').textContent = '이 기기에서는 위치를 알 수 없어요.'; return; }
  $('near-msg').textContent = '위치를 확인하는 중...';
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: la, longitude: lo } = pos.coords;
    const list = D.stores.map(s => ({ s, km: distKm(la, lo, s.lat, s.lng) })).sort((a, b) => a.km - b.km);
    const n = list[0];
    $('near-msg').textContent = `가장 가까운 곳은 ${n.s.name}이에요 (약 ${n.km < 1 ? Math.round(n.km * 1000) + 'm' : n.km.toFixed(1) + 'km'})`;
    renderStores(n.s.id);
    showMap(n.s.id);
    $('st-' + n.s.id).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, () => { $('near-msg').textContent = '위치 사용이 허용되지 않았어요. 아래에서 지점을 골라 주세요.'; }, { timeout: 10000, maximumAge: 300000 });
});

/* ---------- 버튼들 ---------- */
document.addEventListener('click', e => {
  const m = e.target.closest('[data-map]');
  if (m) { showMap(m.dataset.map); $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  const t = e.target.closest('#board-tabs button');
  if (t) {
    document.querySelectorAll('#board-tabs button').forEach(b => b.classList.toggle('on', b === t));
    document.querySelectorAll('#board-body .mgroup').forEach(g => g.classList.toggle('on', g.dataset.g === t.dataset.g));
  }
  if (e.target.closest('#call-open')) openSheet('call');
  if (e.target.closest('[data-delivery]')) openSheet('delivery');
  const ds = e.target.closest('[data-dstore]');
  if (ds) { e.preventDefault(); openSheet('delivery', ds.dataset.dstore); }
  if (e.target.closest('.plat')) $('sheet').hidden = true;
  if (e.target.closest('[data-close]')) $('sheet').hidden = true;
});
const nav = $('nav');
addEventListener('scroll', () => nav.classList.toggle('solid', scrollY > 20), { passive: true });
$('burger').addEventListener('click', () => nav.classList.toggle('open'));
$('menu').addEventListener('click', e => { if (e.target.closest('a')) nav.classList.remove('open'); });

/* 스크롤하면 나타나기 */
let io = null;
function observe() {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.rv-in').forEach(el => el.classList.add('in')); return;
  }
  io = io || new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.rv-in:not(.in)').forEach(el => io.observe(el));
}

(async () => {
  D = await (await fetch('data/stores.json?t=' + Date.now())).json();
  render();
  showMap(D.stores[0].id);
  observe();
  setInterval(() => renderStores(document.querySelector('.store.near')?.id.replace('st-', '')), 5 * 60 * 1000);   // 영업 중 표시 갱신
})();
