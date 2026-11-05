/* 예약확인증 — 손님 예약조회(reserve.html) · 관리자(booking-admin.html) 공통
   DhcVoucher.open(v)  v = 서버 booking.voucher() 결과 */
(function () {
  const WD = '일월화수목금토';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const won = n => Number(n || 0).toLocaleString('ko-KR');
  const day = s => { const [y, m, d] = s.split('-').map(Number); return `${y}년 ${m}월 ${d}일 (${WD[new Date(y, m - 1, d).getDay()]})`; };

  const CSS = `
  #dv-wrap { position:fixed; inset:0; z-index:9999; background:rgba(20,30,40,.6); overflow:auto; padding:20px 12px 40px; }
  #dv-wrap .dv-bar { max-width:640px; margin:0 auto 12px; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
  #dv-wrap .dv-bar button { border:0; border-radius:10px; padding:10px 16px; font-size:14.5px; font-weight:700; cursor:pointer; font-family:inherit; background:#fff; color:#0e6ba8; }
  #dv-wrap .dv-bar button.dv-main { background:#0e6ba8; color:#fff; }
  #dv-doc { max-width:640px; margin:0 auto; background:#fff; color:#1d2b36; padding:34px 30px 30px; border-radius:4px; position:relative;
            font-family:'Pretendard',-apple-system,'Malgun Gothic',sans-serif; word-break:keep-all; line-height:1.55; overflow:hidden; }
  #dv-doc .dv-head { text-align:center; border-bottom:3px double #0e6ba8; padding-bottom:14px; margin-bottom:18px; }
  #dv-doc .dv-head small { color:#5f7382; font-size:13px; letter-spacing:.1em; }
  #dv-doc h2 { font-size:27px; letter-spacing:.35em; margin:4px 0 2px; color:#0a4d7a; }
  #dv-doc .dv-st { display:inline-block; margin-top:6px; padding:3px 14px; border-radius:50px; font-size:13.5px; font-weight:800; }
  #dv-doc .dv-st.confirmed { background:#e3f5ec; color:#1f8a5b; } #dv-doc .dv-st.pending { background:#fff4dd; color:#b7791f; }
  #dv-doc .dv-st.cancelled { background:#fde8e8; color:#d64545; }
  #dv-doc h4 { font-size:14.5px; color:#0e6ba8; margin:18px 0 6px; }
  #dv-doc table { width:100%; border-collapse:collapse; font-size:14px; }
  #dv-doc th, #dv-doc td { border:1px solid #d5e0e8; padding:7px 9px; text-align:left; vertical-align:top; }
  #dv-doc th { background:#f2f7fa; width:26%; font-weight:700; color:#33485a; white-space:nowrap; }
  #dv-doc .dv-items th { width:auto; text-align:center; }
  #dv-doc .dv-items td.n { text-align:right; white-space:nowrap; }
  #dv-doc .dv-items small { color:#5f7382; }
  #dv-doc .dv-items tr.x td { color:#9aa8b3; text-decoration:line-through; }
  #dv-doc .dv-tot td { font-weight:800; background:#f8fbfd; }
  #dv-doc .red { color:#d64545; font-weight:800; }
  #dv-doc pre { white-space:pre-wrap; font-family:inherit; font-size:12.5px; color:#4a5d6c; background:#f8fbfd; border:1px solid #e3ebf1; padding:9px 11px; border-radius:4px; }
  #dv-doc .dv-sign { margin-top:26px; text-align:center; font-size:14px; }
  #dv-doc .dv-sign p { margin:2px 0; }
  #dv-doc .dv-co { display:inline-block; font-size:19px; font-weight:800; margin-top:14px; }
  #dv-doc .dv-in { position:relative; display:inline-block; margin-left:30px; font-size:15px; font-weight:500; color:#5f7382; }
  #dv-doc .dv-in img { position:absolute; left:50%; top:50%; width:70px; height:70px; transform:translate(-50%,-50%) rotate(-3deg); opacity:.92; }
  #dv-doc .dv-biz { margin-top:16px; font-size:12px; color:#5f7382; text-align:center; border-top:1px solid #e3ebf1; padding-top:10px; }
  #dv-doc .dv-void { position:absolute; top:40%; left:50%; transform:translate(-50%,-50%) rotate(-20deg); font-size:90px; font-weight:900;
                     color:rgba(214,69,69,.16); border:8px solid rgba(214,69,69,.16); padding:0 30px; pointer-events:none; white-space:nowrap; }
  @media (max-width:520px) { #dv-wrap .dv-bar button { padding:9px 11px; font-size:13.5px; } #dv-doc { padding:24px 16px; } #dv-doc h2 { font-size:22px; } #dv-doc th, #dv-doc td { padding:6px 6px; font-size:13px; } }
  @media print {
    @page { size:A4; margin:14mm; }
    body.dv-open > *:not(#dv-wrap) { display:none !important; }
    body.dv-open { background:#fff !important; padding:0 !important; }
    #dv-wrap { position:static; background:none; padding:0; overflow:visible; }
    #dv-wrap .dv-bar { display:none; }
    #dv-doc { max-width:none; padding:0; border-radius:0; line-height:1.45; }
    #dv-doc .dv-head { padding-bottom:10px; margin-bottom:10px; }
    #dv-doc h4 { margin:12px 0 5px; font-size:13.5px; }
    #dv-doc th, #dv-doc td { padding:4px 8px; font-size:13px; }
    #dv-doc pre { font-size:11.5px; padding:6px 10px; }
    #dv-doc .dv-sign { margin-top:10px; }
    #dv-doc .dv-co { margin-top:8px; }
    #dv-doc .dv-biz { margin-top:10px; padding-top:6px; }
    #dv-doc h2 { font-size:24px; }
    #dv-doc * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }`;

  function html(v) {
    const b = v.business, cx = v.status === 'cancelled';
    const items = v.items.map(it => `<tr class="${it.status === 'cancelled' && !cx ? 'x' : ''}">
      <td><b>${esc(it.room_name)}</b>${it.options.map(o => `<br><small>· ${esc(o.name)}${o.detail ? ' ' + esc(o.detail) : ''} × ${o.qty}</small>`).join('')}</td>
      <td class="n">${it.guests}명</td><td class="n">${won(it.total)}원${it.status === 'cancelled' && !cx ? '<br><small>(취소)</small>' : ''}</td></tr>`).join('');
    let pay = `<tr><th>결제 금액</th><td><b>${won(v.total)}원</b></td></tr>`;
    if (cx) {
      pay += `<tr><th>취소</th><td class="red">취소된 예약입니다${v.refund ? ` (환불 ${won(v.refund)}원)` : ''}</td></tr>`;
    } else {
      pay += `<tr><th>입금 금액</th><td>${won(v.paid)}원${v.paid ? ` <small>(${esc(v.payMethod)}${v.paidAt ? ' · ' + esc(v.paidAt) : ''})</small>` : ''}</td></tr>`;
      if (v.balance) pay += `<tr><th>${v.status === 'pending' ? '입금하실 금액' : '남은 금액'}</th><td class="red">${won(v.balance)}원</td></tr>`;
      if (v.bank) pay += `<tr><th>입금 계좌</th><td><b>${esc(v.bank)}</b>${v.deadline ? `<br><span class="red">${esc(v.deadline)}까지</span> <small>(기한 내 미입금 시 자동 취소)</small>` : ''}</td></tr>`;
    }
    return `${cx ? '<div class="dv-void">취 소</div>' : ''}
      <div class="dv-head"><small>${esc(b.name)}</small><h2>예약확인증</h2><span class="dv-st ${v.status}">${esc(v.status_label)}</span></div>
      <h4>예약 정보</h4>
      <table>
        <tr><th>예약번호</th><td><b>${esc(v.code)}</b></td></tr>
        <tr><th>예약자</th><td>${esc(v.name)} <small>(${esc(v.phone)})</small></td></tr>
        <tr><th>입실</th><td><b>${day(v.checkin)}</b> 15:00부터</td></tr>
        <tr><th>퇴실</th><td><b>${day(v.checkout)}</b> 11:00까지 <small>(${v.nights}박)</small></td></tr>
        <tr><th>예약일시</th><td>${esc(v.createdAt)}</td></tr>
        ${v.request ? `<tr><th>요청사항</th><td style="white-space:pre-wrap">${esc(v.request)}</td></tr>` : ''}
      </table>
      <h4>객실 · 금액</h4>
      <table class="dv-items"><tr><th>객실 · 옵션</th><th>인원</th><th>금액</th></tr>${items}</table>
      <table style="margin-top:6px">${pay}</table>
      ${v.notice ? `<h4>이용 안내</h4><pre>${esc(v.notice)}</pre>` : ''}
      ${!cx && v.refundPolicy ? `<h4>취소 · 환불 규정</h4><pre>${esc(v.refundPolicy)}</pre>` : ''}
      <div class="dv-sign">
        <p>${v.status === 'pending' ? '위와 같이 예약이 접수되었음을 확인합니다. (입금 확인 후 확정)' : cx ? '위 예약은 취소되었음을 확인합니다.' : '위와 같이 예약되었음을 확인합니다.'}</p>
        <p style="color:#5f7382">발급일시 ${esc(v.issuedAt)}</p>
        <div class="dv-co">${esc(b.name)}<span class="dv-in">(인)<img src="${SEAL}" alt="직인"></span></div>
      </div>
      <div class="dv-biz">${esc(b.name)} · 사업자등록번호 ${esc(b.bizNo)}<br>${esc(b.address)} · 예약문의 ${esc(b.phone)}</div>`;
  }

  // 이 파일(js/voucher.js) 기준으로 직인 이미지 경로
  const SEAL = new URL('../images/seal.png', document.currentScript.src).href;

  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  }

  function close() { document.getElementById('dv-wrap')?.remove(); document.body.classList.remove('dv-open'); }

  async function saveImage(v, btn) {
    btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
      const canvas = await html2canvas(document.getElementById('dv-doc'), { scale: 2, backgroundColor: '#fff', useCORS: true });
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], `예약확인증_${v.code}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: '예약확인증' }).catch(() => {});
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (e) { alert('이미지를 만들지 못했습니다. [인쇄 · PDF 저장]을 이용해 주세요.'); }
    btn.disabled = false; btn.textContent = '📷 이미지 저장';
  }

  function open(v) {
    close();
    if (!document.getElementById('dv-css')) {
      const st = document.createElement('style'); st.id = 'dv-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const wrap = document.createElement('div');
    wrap.id = 'dv-wrap';
    wrap.innerHTML = `<div class="dv-bar"><button class="dv-main" data-a="print">🖨 인쇄 · PDF 저장</button>
      <button data-a="img">📷 이미지 저장</button><button data-a="close">✕ 닫기</button></div><div id="dv-doc">${html(v)}</div>`;
    wrap.onclick = e => {
      const a = e.target.dataset.a;
      if (e.target === wrap || a === 'close') close();
      else if (a === 'print') window.print();
      else if (a === 'img') saveImage(v, e.target);
    };
    document.body.appendChild(wrap);
    document.body.classList.add('dv-open');
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('dv-wrap')) { e.stopImmediatePropagation(); close(); } }, true);
  window.DhcVoucher = { open, close };
})();
