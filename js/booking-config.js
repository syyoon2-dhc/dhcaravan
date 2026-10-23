/* ============ 예약 서버 주소 ============
 * iwinv 서버(Tailscale Funnel)의 인터넷 주소 — 2026-10-24 연결
 *
 * GitHub 홈페이지(github.io)에서 열 때만 이 서버를 쓰고,
 * 서버 주소나 http://localhost:8000 으로 열 때는 지금 열린 서버를 그대로 사용합니다.
 */
window.DHC_API_BASE = location.hostname.endsWith('github.io') ? 'https://dhc.tail2b0b5e.ts.net' : '';
