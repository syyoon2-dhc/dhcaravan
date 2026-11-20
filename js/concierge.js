/* ============ AI 숙박 도우미 ============
 * 화면 오른쪽 아래 로봇을 누르면 상담 창이 열립니다.
 *
 * 지금은 "정해진 답변형"입니다. 객실 · 인원 · 요금은 data/prices.json, 시설 · 관광지 · 자주 묻는 질문은
 * data/site.json 에서 읽어 답하므로, 관리자 화면에서 요금을 바꾸면 도우미 답도 같이 바뀝니다.
 * 모르는 내용은 지어내지 않고 전화 문의로 안내하며, 예약 확정 · 빈 객실 여부는 말하지 않습니다
 * (빈 객실은 실시간 예약 화면에서만 확인).
 *
 * 나중에 진짜 AI(Claude 등)를 붙일 때:
 *   1) 예약 서버(server.py)에 POST /api/public/chat 을 만들고 API 키는 서버에만 둡니다 (이 파일 · GitHub 에 키 넣지 않기).
 *   2) js/booking-config.js 에 window.DHC_CHAT_AI = true 를 넣으면 질문을 서버로 보내고,
 *      서버가 응답하지 않으면 아래 정해진 답변으로 대신 답합니다.
 *      요청 { message, history:[{role,text}] } → 응답 { reply: '텍스트' }
 * 홈페이지(index.html)가 아닌 다른 화면(reserve.html 등)에 붙여도 혼자 데이터를 읽어 동작합니다.
 */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Number(n).toLocaleString('ko-KR');
  const GROUP = { caravan: '카라반', pension: '펜션', deck: '데크존' };
  let PRICE = null, SITE = null, ROOMS = [], PHONE = '010-4589-1415';
  const history = [];

  // 캠핑 레인저 로봇: 일출 바다 배경 + 캠핑 모자(소나무 배지) · 반다나 · 손에 든 랜턴(불빛 깜빡임)
  // 그림 안 색(gradient) 이름이 겹치면 숨긴 쪽 그림 때문에 안 보이므로 쓸 때마다 이름을 다르게
  const ROBOT = k => `<svg viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <clipPath id="cgClip${k}"><circle cx="60" cy="60" r="58"/></clipPath>
      <linearGradient id="cgSky${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#102C40"/><stop offset=".45" stop-color="#397D96"/><stop offset=".72" stop-color="#f0b46a"/></linearGradient>
      <linearGradient id="cgSea${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a6680"/><stop offset="1" stop-color="#102C40"/></linearGradient>
      <radialGradient id="cgBody${k}" cx="38%" cy="28%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef1f3"/><stop offset="1" stop-color="#b9c6cf"/></radialGradient>
      <linearGradient id="cgFace${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4d68"/><stop offset="1" stop-color="#0b2233"/></linearGradient>
      <radialGradient id="cgEye${k}" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#fff6dd"/><stop offset=".5" stop-color="#f3c977"/><stop offset="1" stop-color="#D5A65A"/></radialGradient>
      <linearGradient id="cgHat${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b57a"/><stop offset="1" stop-color="#a77f47"/></linearGradient>
      <radialGradient id="cgGlow${k}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe7a3" stop-opacity=".95"/><stop offset="1" stop-color="#ffb84d" stop-opacity="0"/></radialGradient>
    </defs>
    <g clip-path="url(#cgClip${k})">
      <rect width="120" height="120" fill="url(#cgSky${k})"/>
      <circle cx="18" cy="86" r="11" fill="#ffd27a" opacity=".95"/><circle cx="18" cy="86" r="17" fill="#ffd27a" opacity=".25"/>
      <rect y="85" width="120" height="35" fill="url(#cgSea${k})"/>
      <path d="M6 92 h22 M10 97 h14 M84 95 h14" stroke="#ffd27a" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
      <path d="M34 98 h52 a10 10 0 0 1 10 10 v14 h-72 v-14 a10 10 0 0 1 10 -10z" fill="url(#cgBody${k})"/>
      <path d="M90 104 q8 -2 10 -12" stroke="#cfd9e0" stroke-width="6" fill="none" stroke-linecap="round"/>
    </g>
    <circle cx="101" cy="84" r="14" fill="url(#cgGlow${k})"><animate attributeName="opacity" values=".75;1;.85;1;.7" dur="2.4s" repeatCount="indefinite"/></circle>
    <path d="M96.5 76 q4.5 -6 9 0" stroke="#5b4630" stroke-width="1.8" fill="none"/>
    <rect x="96" y="76" width="10" height="3" rx="1" fill="#5b4630"/>
    <rect x="96.8" y="79" width="8.4" height="10" rx="2" fill="#ffd77f" stroke="#5b4630" stroke-width="1.4"/>
    <rect x="96" y="89" width="10" height="3" rx="1" fill="#5b4630"/>
    <rect x="23" y="56" width="8" height="16" rx="4" fill="#cfd9e0"/>
    <rect x="89" y="56" width="8" height="16" rx="4" fill="#cfd9e0"/>
    <rect x="29" y="38" width="62" height="52" rx="22" fill="url(#cgBody${k})"/>
    <rect x="36" y="49" width="48" height="29" rx="13" fill="url(#cgFace${k})"/>
    <ellipse cx="49" cy="62" rx="5" ry="6" fill="url(#cgEye${k})"><animate attributeName="ry" values="6;6;0.8;6;6" keyTimes="0;.9;.94;.98;1" dur="4s" repeatCount="indefinite"/></ellipse>
    <ellipse cx="71" cy="62" rx="5" ry="6" fill="url(#cgEye${k})"><animate attributeName="ry" values="6;6;0.8;6;6" keyTimes="0;.9;.94;.98;1" dur="4s" repeatCount="indefinite"/></ellipse>
    <path d="M54 70 q6 4.5 12 0" stroke="#D5A65A" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <circle cx="40" cy="71" r="3" fill="#f08a6b" opacity=".45"/><circle cx="80" cy="71" r="3" fill="#f08a6b" opacity=".45"/>
    <ellipse cx="60" cy="40" rx="38" ry="7" fill="#9c7542"/>
    <path d="M37 40 Q38 17 60 16 Q82 17 83 40 Z" fill="url(#cgHat${k})"/>
    <path d="M38 33 Q60 37 82 33 L82.6 38.5 Q60 42.5 37.4 38.5 Z" fill="#102C40"/>
    <path d="M60 23 l-5.5 9 h3.5 l-4.5 6.5 h13 l-4.5 -6.5 h3.5 z" fill="#2f6b4f" transform="translate(13 -2) scale(.8)" transform-origin="60 30"/>
    <ellipse cx="50" cy="22" rx="8" ry="2.6" fill="#fff" opacity=".35"/>
    <path d="M42 88 L78 88 L60 102 Z" fill="#e0703f"/>
    <circle cx="69" cy="91" r="3" fill="#c85a2c"/>
  </svg>`;

  /* ---------- 데이터 ---------- */
  async function loadData() {
    if (window.DHC && window.DHC.PRICE) { ({ PRICE, SITE, ROOMS } = window.DHC); }
    else {
      const get = u => fetch(u + '?t=' + Date.now()).then(r => r.json());
      [PRICE, SITE] = await Promise.all([get('data/prices.json'), get('data/site.json')]);
      ROOMS = PRICE.rooms || [];
    }
    PHONE = (SITE.contact && SITE.contact.phone) || PHONE;
    // 인원별 추천 기준(js/reco.js)이 없는 화면이면 불러옴
    if (!window.DhcReco) {
      await new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = 'js/reco.js'; s.onload = ok; s.onerror = fail;
        document.head.appendChild(s);
      });
    }
  }
  const detail = r => (SITE.rooms && SITE.rooms[r.id]) || {};
  const extraFree = r => /없음/.test(r.extra || '');
  const reserveUrl = () => (SITE.contact && SITE.contact.reserveUrl) || 'reserve.html';
  const onHome = () => !!document.getElementById('reserve') && !!window.DHC;

  /* ---------- 답변 만들기 ---------- */
  const callBtn = () => ({ label: `📞 전화 예약하기`, href: `tel:${PHONE}`, cls: 'gold' });
  const bookBtn = (room) => onHome()
    ? { label: '📅 실시간 예약하기', act: () => room ? window.DHC.pickRoom(room) : document.getElementById('reserve').scrollIntoView({ behavior: 'smooth' }), cls: 'pri', close: true }
    : { label: '📅 실시간 예약하기', href: reserveUrl(), cls: 'pri' };
  const roomBtn = r => onHome()
    ? { label: `📷 ${r.name} 사진 보기`, act: () => window.DHC.openRoom(r.id), close: true }
    : null;

  // 추천 기준은 js/reco.js (홈페이지 [객실 찾기]와 같이 씀)
  const recommend = n => DhcReco.recommend(ROOMS, SITE.rooms, n);

  function ansPeople(n) {
    const maxAll = Math.max(...ROOMS.filter(r => r.group !== 'deck').map(r => r.max));
    if (n > maxAll) {
      const big = ROOMS.filter(r => r.group === 'pension').sort((a, b) => b.max - a.max)[0];
      return {
        html: `${n}명이면 한 객실로는 어렵고 <b>여러 객실을 함께</b> 예약하셔야 해요.\n가장 큰 객실은 <b>${esc(big.name)}</b>(기준 ${big.std}명 · 최대 ${big.max}명)입니다. 실시간 예약에서 한 번에 여러 객실을 고를 수 있고, 단체는 전화로 상담해 드려요.`,
        acts: [bookBtn(), callBtn()],
      };
    }
    const { list, best } = recommend(n);
    if (!best.length) return ansUnknown();
    const line = x => {
      const r = x.r;
      const ex = !x.extraN ? '' : extraFree(r) ? ' · 추가 인원 비용 없음' : ` · 추가 ${x.extraN}명 +${won(x.extraCost)}원/박`;
      return `<li><b>${esc(r.name)}</b> ${esc(x.view)} · 기준 ${r.std}명 · 최대 ${r.max}명${ex} · ${won(r.price.normal[0])}원~</li>`;
    };
    const cs = best.filter(x => x.r.group === 'caravan'), ps = best.filter(x => x.r.group !== 'caravan');
    let html = `<b>${n}명</b>이면 이렇게 추천해요.`;
    if (cs.length) html += `\n🚐 <b>${cs.every(x => x.front) ? '바다를 정면으로 마주한 오션 전면뷰 카라반' : '유럽형 카라반'}</b><ul>${cs.map(line).join('')}</ul>`;
    // 목록(ul) 뒤에는 이미 줄이 바뀌므로 \n 을 또 넣지 않음
    if (ps.length) html += `${cs.length ? '' : '\n'}🏠 <b>${ps[0].r.std >= 8 ? '가족 · 단체 숙박에 적합한 넓은 펜션' : '추가 인원 비용 없이 넉넉한 펜션'}</b><ul>${ps.map(line).join('')}</ul>`;
    const more = list.length - best.length;
    if (more > 0) html += `이 밖에도 ${list.filter(x => !x.best).map(x => esc(x.r.name)).join(' · ')} 객실에 머물 수 있어요.\n`;
    html += `요금은 비수기 평일 기준이며, 빈 객실은 날짜를 고르면 실시간 예약에서 확인됩니다.`;
    return {
      html,
      acts: [cs[0] && roomBtn(cs[0].r), ps[0] && roomBtn(ps[0].r), bookBtn(best.length === 1 ? best[0].r.id : null), callBtn()].filter(Boolean),
    };
  }

  function ansRoom(r, wantPrice) {
    const d = detail(r), p = r.price;
    const priceHtml = `<ul><li>비수기 평일 ${won(p.normal[0])}원 · 주말 ${won(p.normal[1])}원</li><li>성수기 평일 ${won(p.peak[0])}원 · 주말 ${won(p.peak[1])}원</li></ul>`;
    const extra = extraFree(r) ? '추가 인원 비용 없음' : r.extra;
    const html = wantPrice
      ? `<b>${esc(r.name)}</b> 1박 요금 (기준 ${r.std}명)${priceHtml}${esc(extra)}`
      : `<b>${esc(r.name)}</b> · ${esc(d.type || GROUP[r.group])} · ${esc(d.view || r.badge)}\n${esc(d.intro || r.desc)}<ul>
          <li>기준 ${r.std}명 · 최대 ${r.max}명 (${esc(extra)})</li>
          ${d.facilities && d.facilities.length ? `<li>시설: ${esc(d.facilities.join(' · '))}</li>` : ''}
          <li>1박 ${won(p.normal[0])}원~ (비수기 평일)</li></ul>`;
    return { html, acts: [roomBtn(r), bookBtn(r.id), callBtn()].filter(Boolean) };
  }

  function ansAllPrice() {
    const lines = ROOMS.map(r => `<li><b>${esc(r.name)}</b> ${won(r.price.normal[0])}원~ (성수기 주말 ${won(r.price.peak[1])}원)</li>`).join('');
    const note = (PRICE.notes || []).slice(0, 3).map(n => n.replace(/<[^>]+>/g, '')).join('\n');
    return { html: `1박 요금 (기준 인원, 비수기 평일부터)<ul>${lines}</ul>\n${esc(note)}`, acts: [onHome() ? { label: '요금표 보기', act: () => document.getElementById('price').scrollIntoView({ behavior: 'smooth' }), close: true } : null, bookBtn()].filter(Boolean) };
  }

  function ansRooms() {
    const by = g => ROOMS.filter(r => r.group === g);
    const line = r => `<li><b>${esc(r.name)}</b> 기준 ${r.std}명 · 최대 ${r.max}명${extraFree(r) ? ' · 추가 인원 비용 없음' : ''}</li>`;
    return {
      html: `객실은 이렇게 있어요.\n🚐 <b>카라반</b><ul>${by('caravan').map(line).join('')}</ul>\n🏠 <b>펜션</b><ul>${by('pension').map(line).join('')}</ul>\n⛺ <b>데크존</b><ul>${by('deck').map(line).join('')}</ul>\n인원을 알려 주시면 맞는 객실을 추천해 드릴게요. (예: "가족 5명")`,
      acts: [],
    };
  }

  function ansFacilities() {
    const a = (SITE.amenities || []).map(x => `<li>${esc(x.icon)} <b>${esc(x.title)}</b> — ${esc(x.text)}</li>`).join('');
    return { html: `동해카라반펜션 시설 안내<ul>${a}</ul>\n객실별 시설은 객실 이름으로 물어봐 주세요. (예: "무지개 시설")`, acts: [] };
  }

  function ansBooking() {
    return {
      html: `예약은 두 가지 방법이 있어요.\n<b>① 실시간 예약</b> — 날짜를 고르면 빈 객실과 요금이 바로 나오고, 무통장입금으로 결제합니다. 입금 계좌와 기한은 문자로 안내돼요.\n<b>② 전화 예약</b> — ${PHONE}\n예약 확인 · 취소는 예약자 이름과 휴대폰 번호로 조회할 수 있습니다.`,
      acts: [bookBtn(), callBtn(), { label: '예약 조회', href: 'reserve.html#lookup' }],
    };
  }

  // 질문에 관광지 이름 또는 site.json spots[].keys 의 낱말(예: 해수욕 → 진하해수욕장)이 있으면 그 관광지
  function findSpots(t) {
    return (SITE.spots || []).filter(s =>
      s.name.split(/[ ·]/).filter(w => w.length > 1).concat(s.keys || []).some(w => t.includes(w)));
  }

  function ansSpots(spots) {
    const map = s => ({ label: `🗺️ ${s.name} 지도`, href: `https://map.naver.com/p/search/${encodeURIComponent(s.query || s.name)}`, blank: true });
    const one = s => `📍 <b>${esc(s.name)}</b> (펜션에서 ${esc(s.dist)})\n${esc(s.sub)}\n${esc(s.text)}`;
    if (spots && spots.length) return { html: spots.map(one).join('\n\n'), acts: spots.slice(0, 3).map(map) };
    const lines = (SITE.spots || []).map(s => `<li><b>${esc(s.name)}</b> ${esc(s.dist)} — ${esc(s.sub)}</li>`).join('');
    return {
      html: `펜션 주변 가 볼 만한 곳이에요.<ul>${lines}</ul>\n관광지 이름을 물어보시면 자세히 알려 드릴게요.`,
      acts: [onHome() ? { label: '관광지 자세히 보기', act: () => document.getElementById('location').scrollIntoView({ behavior: 'smooth' }), close: true } : null].filter(Boolean),
    };
  }

  // 테마 추천 (site.json themes — 예: 아이들 → 진하해수욕장 · 옹기마을 · 고래마을 + 수영장 · 오락기)
  function ansTheme(th) {
    const list = (th.spots || []).map(x => ({ ...x, s: (SITE.spots || []).find(s => s.name === x.name) })).filter(x => x.s);
    const spotLines = list.map(x => `<li><b>${esc(x.s.name)}</b> (${esc(x.s.dist)}) — ${esc(x.why)}</li>`).join('');
    const stay = (th.stay || []).map(x => `<li>${esc(x)}</li>`).join('');
    return {
      html: `${esc(th.title)}.\n📍 <b>주변 추천</b><ul>${spotLines}</ul>${stay ? `🏕 <b>펜션 안에서</b><ul>${stay}</ul>` : ''}관광지 이름을 물어보시면 자세히 알려 드릴게요.`,
      acts: list.slice(0, 3).map(x => ({ label: `🗺️ ${x.s.name}`, href: `https://map.naver.com/p/search/${encodeURIComponent(x.s.query || x.s.name)}`, blank: true })),
    };
  }

  const ansPhone = () => ({ html: `전화 예약 · 문의는 아래 번호로 연락해 주세요.\n<b style="font-size:18px">${PHONE}</b>`, acts: [callBtn()] });
  const ansUnknown = () => ({
    html: `죄송해요, 그 내용은 제가 정확히 안내해 드리기 어려워요. 잘못된 정보를 드리지 않도록 펜션에 직접 확인해 주세요.\n📞 ${PHONE}`,
    acts: [callBtn()],
  });
  const ansAskPeople = () => ({ html: '몇 명이 방문하시나요? 영 · 유아를 포함한 인원을 알려 주세요.', acts: [2, 4, 6, 8, 10, 12].map(n => ({ label: `${n}명`, say: `${n}명` })) });

  /* 인원 읽기: "10명", "어른 4명 아이 2명", "가족 열 명", "4인" → 합계 */
  const KNUM = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };
  function parsePeople(t) {
    let sum = 0, hit = false;
    t.replace(/(\d{1,2})\s*(명|인(?!원|분)|사람)/g, (_, n) => { sum += +n; hit = true; });
    t.replace(/(열)?\s*(한|두|세|네|다섯|여섯|일곱|여덟|아홉)?\s*(명|사람)/g, (m, ten, one) => {
      if (!ten && !one) return;
      sum += (ten ? 10 : 0) + (one ? KNUM[one] : 0); hit = true;
    });
    return hit ? sum : 0;
  }

  const ALIAS = {
    adora: ['아도라', 'adora', '542'], harby: ['하비', 'hobby', 'harby', '495'], pursuit: ['퍼슈트', 'pursuit', '530'],
    gureum: ['구름'], bada: ['바다객실', '바다 객실', '바다방', '바다룸', '바다펜션', '바다 펜션', '바다호'], mujigae: ['무지개'], deckzone: ['데크존', '데크 존', '캠핑데크', '텐트'],
  };
  const COMMON = ['바다'];
  function findRoom(t) {
    const low = t.toLowerCase();
    for (const r of ROOMS) {
      // '바다'처럼 흔한 낱말인 객실 이름은 이름만으로는 찾지 않음 ("바다 보이나요?" ≠ 바다 객실)
      const keys = (ALIAS[r.id] || []).concat(COMMON.includes(r.name) ? [] : r.name.toLowerCase());
      if (keys.some(k => low.includes(k))) return r;
    }
    if (/^\s*바다\s*[?？]?\s*$/.test(t)) return ROOMS.find(r => r.id === 'bada');
    return null;
  }

  function faqAnswer(faq, t) {
    const acts = /주소|위치|길찾기|어디|오시는/.test(t) && SITE.contact
      ? [{ label: '네이버 지도', href: SITE.contact.naverMap, blank: true }, { label: '카카오맵', href: SITE.contact.kakaoMap, blank: true }] : [];
    // site.json faq[].links (예: 횟집 홈페이지 · 횟집 전화)
    (faq.links || (faq.link ? [faq.link] : [])).forEach((l, i) => acts.push({ label: l.label, href: l.href, blank: !/^tel:/.test(l.href), cls: i ? '' : 'gold' }));
    return { html: esc(faq.a), acts };
  }

  function answer(raw) {
    const t = raw.trim();
    if (!t) return null;
    const has = re => re.test(t);
    // 횟집 질문은 펜션 예약 · 전화보다 먼저 (예: "횟집 예약" → 횟집 전화 안내)
    if (has(/횟집|물회|매운탕|생선회|회\s?(먹|메뉴|포장|한\s?접시)/)) {
      const hf = (SITE.faq || []).find(f => f.q === '동해횟집');
      if (hf) return faqAnswer(hf, t);
    }
    if (has(/전화|통화|연락처|번호/)) return ansPhone();
    if (has(/반려|강아지|애견|고양이|펫/)) return ansUnknown();
    const n = parsePeople(t);
    if (n) return ansPeople(n);
    const room = findRoom(t);
    const wantPrice = has(/요금|가격|얼마|비용|금액|가격표/);
    if (room) return ansRoom(room, wantPrice);
    if (has(/빈\s?방|빈\s?객실|예약\s?가능|자리\s?있|남은\s?방|예약\s?돼|예약\s?확정|확정/)) {
      return { html: `빈 객실과 예약 확정 여부는 제가 확인해 드릴 수 없어요. <b>실시간 예약</b>에서 날짜를 고르면 바로 확인되고, 예약 후 상태는 예약 조회에서 볼 수 있습니다.`, acts: [bookBtn(), { label: '예약 조회', href: 'reserve.html#lookup' }, callBtn()] };
    }
    if (has(/예약|예매|잡고|방법/)) return ansBooking();
    if (has(/성수기|주말\s?요금/)) { const f = (SITE.faq || []).find(x => x.q === '성수기'); if (f) return { html: esc(f.a), acts: [] }; }
    if (wantPrice) return ansAllPrice();
    // 관광지는 '추천'보다 먼저 봄 ("해수욕장 추천", "주변 관광지 추천"이 인원 질문으로 가지 않게)
    const spots = findSpots(t);
    if (spots.length) return ansSpots(spots);
    const theme = (SITE.themes || []).find(th => th.keys.some(k => t.includes(k)));
    if (theme) return ansTheme(theme);
    if (has(/관광|근처|주변|가볼|가 볼|놀거리|볼거리|여행지|코스|명소|구경/)) return ansSpots();
    if (has(/추천|어떤\s?방|어느\s?방|몇\s?명|인원/)) return ansAskPeople();
    const faq = (SITE.faq || []).find(f => f.keys.some(k => t.includes(k)));
    if (faq) return faqAnswer(faq, t);
    if (has(/시설|편의|비품|부대/)) return ansFacilities();
    if (has(/객실|방\b|카라반|펜션|종류/)) return ansRooms();
    if (has(/^(안녕|하이|hi|hello)/i)) return { html: '안녕하세요! 무엇이 궁금하신가요? 아래 버튼을 누르거나 편하게 물어봐 주세요.', acts: [] };
    if (has(/고마|감사|땡큐/)) return { html: '도움이 되었다니 기뻐요. 동해에서 좋은 추억 만드세요! 🌅', acts: [] };
    return ansUnknown();
  }

  /* ---------- 진짜 AI 서버 연결 (설정했을 때만) ---------- */
  async function askServer(text) {
    const res = await fetch((window.DHC_API_BASE || '') + '/api/public/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: history.slice(-10) }),
    });
    if (!res.ok) throw new Error('chat');
    const j = await res.json();
    if (!j.reply) throw new Error('chat');
    return { html: esc(j.reply), acts: [bookBtn(), callBtn()] };
  }

  /* ---------- 화면 ---------- */
  let log, input, panel, launch, tip;
  function build() {
    launch = document.createElement('button');
    launch.className = 'cg-launch';
    launch.type = 'button';
    launch.setAttribute('aria-label', 'AI 숙박 도우미 열기');
    launch.innerHTML = ROBOT('L') + '<span class="cg-dot"></span>';
    tip = document.createElement('div');
    tip.className = 'cg-tip'; tip.hidden = true;
    tip.textContent = '객실 추천 · 요금 · 예약, 무엇이든 물어보세요!';
    panel = document.createElement('section');
    panel.className = 'cg-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'AI 숙박 도우미');
    panel.innerHTML = `
      <div class="cg-head"><span class="av">${ROBOT('H')}</span><div><b>AI 숙박 도우미</b><small>객실 · 요금 · 예약 · 관광 안내</small></div><button class="x" type="button" aria-label="닫기">✕</button></div>
      <div class="cg-log" aria-live="polite"></div>
      <div class="cg-chips">${['객실 추천', '객실별 인원', '시설 안내', '요금 안내', '예약 방법', '주변 관광지', '전화 예약'].map(c => `<button type="button">${c}</button>`).join('')}</div>
      <form class="cg-form"><input type="text" placeholder="예: 가족 10명이 방문하려고 해요" aria-label="질문 입력" maxlength="200" enterkeyhint="send"><button type="submit" aria-label="보내기">↑</button></form>
      <p class="cg-foot">안내용 자동 답변입니다 · 예약 확정은 실시간 예약 또는 전화로</p>`;
    document.body.append(tip, launch, panel);
    log = panel.querySelector('.cg-log');
    input = panel.querySelector('input');

    launch.addEventListener('click', open);
    tip.addEventListener('click', open);
    panel.querySelector('.x').addEventListener('click', close);
    panel.querySelector('.cg-form').addEventListener('submit', e => { e.preventDefault(); send(input.value); input.value = ''; });
    panel.querySelector('.cg-chips').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const map = { '객실 추천': '객실 추천해 주세요', '객실별 인원': '객실 종류와 인원 알려 주세요', '시설 안내': '시설 안내', '요금 안내': '요금 알려 주세요', '예약 방법': '예약 방법', '주변 관광지': '주변 관광지 추천', '전화 예약': '전화 예약' };
      send(map[b.textContent] || b.textContent, b.textContent);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

    // 처음 온 손님에게 한 번만 말풍선
    try {
      if (!sessionStorage.getItem('dhc_cg_tip')) {
        setTimeout(() => { if (panel.hidden) tip.hidden = false; }, 4000);
        setTimeout(() => { tip.hidden = true; }, 14000);
        sessionStorage.setItem('dhc_cg_tip', '1');
      }
    } catch { /* 개인 정보 보호 모드 */ }
  }

  let greeted = false;
  function open() {
    tip.hidden = true;
    launch.querySelector('.cg-dot')?.remove();
    panel.hidden = false;
    launch.hidden = true;
    if (!greeted) {
      greeted = true;
      addBot({
        html: '안녕하세요!\n<b>동해카라반펜션 AI 숙박 도우미</b>입니다.\n\n객실 안내부터 인원별 객실 추천,\n예약 및 주변 관광 정보까지 안내해 드립니다.\n\n무엇이 궁금하신가요?',
        acts: [],
      });
    }
    if (matchMedia('(min-width: 641px)').matches) input.focus();
  }
  function close() { panel.hidden = true; launch.hidden = false; }

  function addMe(text) {
    const d = document.createElement('div');
    d.className = 'cg-msg me'; d.textContent = text;
    log.appendChild(d);
  }
  function addBot(a) {
    const d = document.createElement('div');
    d.className = 'cg-msg bot';
    d.innerHTML = a.html;
    const acts = (a.acts || []).filter(Boolean);
    if (acts.length) {
      const box = document.createElement('div');
      box.className = 'cg-acts';
      acts.forEach(x => {
        const el = document.createElement(x.href ? 'a' : 'button');
        el.textContent = x.label;
        if (x.cls) el.className = x.cls;
        if (x.href) { el.href = x.href; if (x.blank) { el.target = '_blank'; el.rel = 'noopener'; } }
        else el.type = 'button';
        el.addEventListener('click', () => {
          if (x.say) send(x.say);
          if (x.act) { if (x.close || matchMedia('(max-width: 640px)').matches) close(); x.act(); }
        });
        box.appendChild(el);
      });
      d.appendChild(box);
    }
    log.appendChild(d);
    d.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  let busy = false;
  async function send(text, shown) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    addMe(shown || text);
    history.push({ role: 'user', text });
    const typing = document.createElement('div');
    typing.className = 'cg-typing'; typing.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
    let a = null;
    if (window.DHC_CHAT_AI) { try { a = await askServer(text); } catch { a = null; } }
    if (!a) { await new Promise(r => setTimeout(r, 450)); a = answer(text) || ansUnknown(); }
    typing.remove();
    addBot(a);
    history.push({ role: 'bot', text: a.html.replace(/<[^>]+>/g, '') });
    busy = false;
  }

  async function start() {
    try { await loadData(); } catch { return; }   // 데이터를 못 읽으면 도우미를 띄우지 않음
    build();
  }
  if (window.DHC) start();
  else if (document.getElementById('reserve') && document.querySelector('script[src*="home.js"]')) document.addEventListener('dhc:ready', start, { once: true });
  else start();

  // 확인용 (개발자 도구에서 DhcConcierge.answer('10명') 처럼 시험)
  window.DhcConcierge = { answer: t => { const a = answer(t); return a && a.html.replace(/<[^>]+>/g, ''); } };
})();
