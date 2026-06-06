/* ============ 동해카라반펜션 ============ */

/* ---------- 객실 · 요금 데이터 ----------
 * 모든 객실 정보와 요금은 data/prices.json 파일에서 불러옵니다.
 * (admin.html 관리 페이지에서 수정 가능)
 *
 * 객실 사진: images/rooms/<id>/ 폴더에 1.jpg, 2.jpg ... 순서로
 * 넣으면 자동 표시됩니다. 1.jpg 가 객실 카드의 대표 사진이 됩니다.
 */
let ROOMS = [];
let PRICE_DATA = null;

async function loadData() {
  const res = await fetch('data/prices.json?t=' + Date.now());
  PRICE_DATA = await res.json();
  ROOMS = PRICE_DATA.rooms;
}

const GROUP_LABEL = { caravan: '카라반', pension: '펜션', deck: '데크존' };

/* ---------- 갤러리 사진 자동 탐색 ----------
 * images/photos/ 폴더의 1.jpg, 2.jpg ... 가 자동으로 표시됩니다.
 * (admin.html 사진 관리 페이지에서 추가/삭제 가능)
 */
const GALLERY = []; // 동적으로 채워짐

function probeGallery(maxCount = 100) {
  return new Promise(resolve => {
    const tryNext = n => {
      if (n > maxCount) return resolve();
      const img = new Image();
      const src = `images/photos/${n}.jpg`;
      img.onload = () => { GALLERY.push(src); tryNext(n + 1); };
      img.onerror = () => resolve();
      img.src = src;
    };
    tryNext(1);
  });
}

const won = n => n.toLocaleString('ko-KR');

/* ---------- 객실 사진 자동 탐색 ----------
 * images/rooms/<id>/ 폴더에서 1.jpg 부터 차례로 찾고,
 * 없는 번호가 나오면 거기서 멈춥니다.
 */
function probeRoomPhotos(id, maxCount = 12) {
  return new Promise(resolve => {
    const found = [];
    const tryNext = n => {
      if (n > maxCount) return resolve(found);
      const img = new Image();
      const src = `images/rooms/${id}/${n}.jpg`;
      img.onload = () => { found.push(src); tryNext(n + 1); };
      img.onerror = () => resolve(found);
      img.src = src;
    };
    tryNext(1);
  });
}

/* ---------- 객실 동영상 자동 탐색 ----------
 * images/rooms/<id>/video.mp4 파일이 있으면
 * 객실 상세 슬라이드의 첫 번째에 동영상이 표시됩니다. (객실당 1개)
 */
function probeRoomVideo(id) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const src = `images/rooms/${id}/video.mp4`;
    v.onloadedmetadata = () => resolve(src);
    v.onerror = () => resolve(null);
    v.preload = 'metadata';
    v.src = src;
  });
}

/* ---------- 객실 카드 렌더링 ---------- */
const roomPhotos = {}; // id -> [src, ...]
const roomVideos = {}; // id -> src | null

function renderRooms() {
  const targets = {
    caravan: document.getElementById('caravan-grid'),
    pension: document.getElementById('pension-grid'),
    deck: document.getElementById('deck-grid'),
  };
  ROOMS.forEach(room => {
    const card = document.createElement('article');
    card.className = 'room-card';
    card.innerHTML = `
      <div class="room-thumb">
        <img src="${room.cover}" alt="${room.name}" loading="lazy" id="cover-${room.id}">
        <span class="room-badge">${room.badge}</span>
      </div>
      <div class="room-body">
        <h4>${room.name}</h4>
        <p class="room-meta">기준 ${room.std}인 · 최대 ${room.max}인 — ${room.desc}</p>
        <p class="room-price"><strong>${won(room.price.normal[0])}원</strong> ~ / 1박</p>
        <p class="room-more">자세히 보기 →</p>
      </div>`;
    card.addEventListener('click', () => openRoomModal(room));
    targets[room.group].appendChild(card);

    // 객실 폴더에 사진/동영상이 있으면 자동으로 사용
    probeRoomPhotos(room.id).then(photos => {
      roomPhotos[room.id] = photos;
      if (photos.length > 0) {
        document.getElementById(`cover-${room.id}`).src = photos[0];
      }
    });
    probeRoomVideo(room.id).then(src => { roomVideos[room.id] = src; });
  });
}

/* ---------- 객실 상세 모달 ---------- */
const modal = document.getElementById('room-modal');
const track = document.getElementById('slider-track');
const dotsBox = document.getElementById('slider-dots');
let slideIdx = 0, slideCount = 0;

function openRoomModal(room) {
  const photos = (roomPhotos[room.id] && roomPhotos[room.id].length)
    ? roomPhotos[room.id]
    : [room.cover];
  const video = roomVideos[room.id];

  // 동영상이 있으면 첫 번째 슬라이드로
  track.innerHTML =
    (video ? `<div class="slider-video"><video src="${video}" controls playsinline preload="metadata"></video></div>` : '') +
    photos.map(src => `<img src="${src}" alt="${room.name} 사진">`).join('');
  if (!roomPhotos[room.id] || roomPhotos[room.id].length === 0) {
    track.innerHTML += `<div class="slider-empty"><span>📷</span>객실 사진 준비 중입니다</div>`;
  }
  slideCount = track.children.length;
  slideIdx = 0;
  updateSlider();

  dotsBox.innerHTML = Array.from({ length: slideCount }, (_, i) =>
    `<button data-i="${i}" class="${i === 0 ? 'on' : ''}" aria-label="${i + 1}번 사진"></button>`).join('');

  document.getElementById('modal-title').textContent = room.name;
  document.getElementById('modal-tags').textContent =
    `${room.badge} · 기준 ${room.std}인 / 최대 ${room.max}인 · ${room.extra}`;
  document.getElementById('modal-price').innerHTML = `
    <table>
      <tr><th></th><th>평일</th><th>주말</th></tr>
      <tr><th>비수기</th><td>${won(room.price.normal[0])}원</td><td>${won(room.price.normal[1])}원</td></tr>
      <tr><th>성수기</th><td>${won(room.price.peak[0])}원</td><td>${won(room.price.peak[1])}원</td></tr>
    </table>
    <p class="note">${PRICE_DATA.modalNote || ''}</p>`;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function updateSlider() {
  track.style.transform = `translateX(-${slideIdx * 100}%)`;
  dotsBox.querySelectorAll('button').forEach((d, i) => d.classList.toggle('on', i === slideIdx));
  // 다른 슬라이드로 넘어가면 동영상 일시정지
  track.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });
}

document.getElementById('slider-prev').addEventListener('click', () => {
  slideIdx = (slideIdx - 1 + slideCount) % slideCount; updateSlider();
});
document.getElementById('slider-next').addEventListener('click', () => {
  slideIdx = (slideIdx + 1) % slideCount; updateSlider();
});
dotsBox.addEventListener('click', e => {
  if (e.target.dataset.i !== undefined) { slideIdx = +e.target.dataset.i; updateSlider(); }
});
modal.addEventListener('click', e => {
  if (e.target.hasAttribute('data-close')) {
    modal.hidden = true;
    document.body.style.overflow = '';
    track.querySelectorAll('video').forEach(v => v.pause());
  }
});

/* ---------- 요금표 렌더링 ---------- */
function renderPriceTables() {
  // 객실 요금표 (구분 칸은 그룹별로 병합)
  const tbody = document.getElementById('price-tbody');
  const groupCount = {};
  ROOMS.forEach(r => { groupCount[r.group] = (groupCount[r.group] || 0) + 1; });
  const seen = {};
  tbody.innerHTML = ROOMS.map(r => {
    let groupCell = '';
    if (!seen[r.group]) {
      seen[r.group] = true;
      groupCell = `<td rowspan="${groupCount[r.group]}">${GROUP_LABEL[r.group] || r.group}</td>`;
    }
    return `<tr>${groupCell}<td>${r.name}</td><td>${r.std}</td><td>${r.max}</td>` +
      `<td>${won(r.price.normal[0])}</td><td>${won(r.price.normal[1])}</td>` +
      `<td>${won(r.price.peak[0])}</td><td>${won(r.price.peak[1])}</td>` +
      `<td>${r.extra}</td></tr>`;
  }).join('');

  // 옵션 표 (같은 이름은 칸 병합)
  const obody = document.getElementById('option-tbody');
  const opts = PRICE_DATA.options || [];
  let html = '';
  for (let i = 0; i < opts.length; i++) {
    let nameCell = '';
    if (i === 0 || opts[i].name !== opts[i - 1].name) {
      let span = 1;
      while (i + span < opts.length && opts[i + span].name === opts[i].name) span++;
      nameCell = `<td rowspan="${span}">${opts[i].name}</td>`;
    }
    const price = opts[i].price === '무료' ? '<strong>무료</strong>' : opts[i].price;
    html += `<tr>${nameCell}<td>${opts[i].detail}</td><td>${price}</td></tr>`;
  }
  if (PRICE_DATA.optionNote) {
    html += `<tr><td colspan="3" class="option-note">${PRICE_DATA.optionNote}</td></tr>`;
  }
  obody.innerHTML = html;

  // 안내 문구
  document.getElementById('price-notes').innerHTML =
    (PRICE_DATA.notes || []).map(n => `<li>${n}</li>`).join('');
}

/* ---------- 갤러리 + 라이트박스 ---------- */
function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  GALLERY.forEach((src, i) => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.innerHTML = `<img src="${src}" alt="동해카라반펜션 갤러리 ${i + 1}" loading="lazy">`;
    item.addEventListener('click', () => openLightbox(i));
    grid.appendChild(item);
  });
}

const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lightbox-img');
let lbIdx = 0;

function openLightbox(i) {
  lbIdx = i;
  lbImg.src = GALLERY[lbIdx];
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}
function moveLightbox(d) {
  lbIdx = (lbIdx + d + GALLERY.length) % GALLERY.length;
  lbImg.src = GALLERY[lbIdx];
}
document.getElementById('lb-prev').addEventListener('click', e => { e.stopPropagation(); moveLightbox(-1); });
document.getElementById('lb-next').addEventListener('click', e => { e.stopPropagation(); moveLightbox(1); });
document.getElementById('lightbox-close').addEventListener('click', () => {
  lightbox.hidden = true; document.body.style.overflow = '';
});
lightbox.addEventListener('click', e => {
  if (e.target === lightbox) { lightbox.hidden = true; document.body.style.overflow = ''; }
});
document.addEventListener('keydown', e => {
  if (!lightbox.hidden) {
    if (e.key === 'Escape') { lightbox.hidden = true; document.body.style.overflow = ''; }
    if (e.key === 'ArrowLeft') moveLightbox(-1);
    if (e.key === 'ArrowRight') moveLightbox(1);
  } else if (!modal.hidden && e.key === 'Escape') {
    modal.hidden = true; document.body.style.overflow = '';
    track.querySelectorAll('video').forEach(v => v.pause());
  }
});

/* ---------- 네비게이션 ---------- */
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

const hamburger = document.getElementById('hamburger');
const menu = document.getElementById('menu');
hamburger.addEventListener('click', () => {
  menu.classList.toggle('open');
  hamburger.classList.toggle('active');
});
menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
  menu.classList.remove('open');
  hamburger.classList.remove('active');
}));

/* ---------- 주소 복사 ---------- */
document.getElementById('copy-addr').addEventListener('click', async () => {
  const text = document.getElementById('addr-text').textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copy-addr');
    btn.textContent = '복사 완료!';
    setTimeout(() => { btn.textContent = '주소 복사'; }, 1500);
  } catch { /* http 환경 등에서 클립보드 미지원 시 무시 */ }
});

/* ---------- 초기화 ---------- */
loadData().then(() => {
  renderRooms();
  renderPriceTables();
});
probeGallery().then(renderGallery);
