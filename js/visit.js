/* ============ 방문자 수 세기 ============
 * 예약 서버에 "이 페이지를 열었다"만 알려 날짜별 방문자 수를 셉니다 (관리자 → 운영관리 → 방문자 통계).
 * 이름·전화번호 같은 개인정보는 보내지 않고, 이 브라우저에서 만든 임의 번호만 보냅니다.
 * (js/booking-config.js 다음에 넣기)
 */
(() => {
  if (navigator.webdriver) return; // 자동 프로그램(검색 로봇 등)은 세지 않음
  const page = /reserve/.test(location.pathname) ? 'reserve' : 'home';
  let vid = '';
  try {
    vid = localStorage.getItem('dhc_vid') || '';
    if (!vid) {
      vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('dhc_vid', vid);
    }
  } catch { return; }
  fetch((window.DHC_API_BASE || '') + '/api/public/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, vid, ref: document.referrer, ua: navigator.userAgent }),
    keepalive: true,
  }).catch(() => {});
})();
