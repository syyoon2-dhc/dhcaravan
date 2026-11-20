/* ============ 인원별 객실 추천 (홈페이지 [객실 찾기] · AI 숙박 도우미 함께 사용) ============
 * DhcReco.recommend(객실목록(prices.json rooms), 객실상세(site.json rooms), 인원)
 *   → { list: 머물 수 있는 모든 객실(추천 먼저), best: 추천 객실, caravans, pensions }
 * 추천 기준
 *   카라반 : 오션 전면뷰 먼저, 그다음 (요금 + 추가 인원 비용)이 적은 순 → 전면뷰 카라반을 추천 (없으면 가장 알맞은 카라반 1곳)
 *   펜션   : 기준 인원 안(또는 추가 인원 비용 없음)인 객실 먼저, 그다음 요금이 적은 순 → 같은 조건 · 같은 요금 객실까지 최대 2곳
 *   데크존은 텐트를 직접 가져오는 곳이라 추천에서 뺌
 */
window.DhcReco = (() => {
  const extraFree = r => /없음/.test(r.extra || '');
  // "인원 추가 1인 10,000원" → 10000
  const extraPerPerson = r => extraFree(r) ? 0 : +((r.extra || '').match(/([\d,]+)\s*원/) || [, '0'])[1].replace(/,/g, '');

  function recommend(rooms, details, n) {
    const items = rooms.filter(r => r.group !== 'deck' && r.max >= n).map(r => {
      const d = (details && details[r.id]) || {};
      const view = d.view || r.badge || '';
      const extraN = Math.max(0, n - r.std);
      const extraCost = extraN * extraPerPerson(r);
      return {
        r, view, extraN, extraCost,
        front: /전면/.test(view),
        fits: extraN === 0 || extraFree(r) ? 0 : 1,
        total: r.price.normal[0] + extraCost,
      };
    });
    const caravans = items.filter(x => x.r.group === 'caravan')
      .sort((a, b) => b.front - a.front || a.total - b.total || a.r.std - b.r.std);
    const pensions = items.filter(x => x.r.group !== 'caravan')
      .sort((a, b) => a.fits - b.fits || a.total - b.total || a.r.std - b.r.std);

    const bestC = caravans.some(x => x.front) ? caravans.filter(x => x.front) : caravans.slice(0, 1);
    const p0 = pensions[0];
    const bestP = p0 ? pensions.filter(x => x.fits === p0.fits && x.total === p0.total).slice(0, 2) : [];
    const best = bestC.concat(bestP);
    best.forEach(x => { x.best = true; });
    const list = best.concat(caravans.filter(x => !x.best), pensions.filter(x => !x.best));
    return { list, best, caravans, pensions };
  }

  return { recommend, extraFree, extraPerPerson };
})();
