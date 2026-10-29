/* ============ 객실 360도 투어 ============
 * data/tour.json  { 객실id: { layout: 'layout.jpg', v, spots: [{ id, name, x, y, north, file, v }] } }
 *   layout : 도면 이미지 (images/rooms/<객실id>/layout.jpg)
 *   x, y   : 도면 위 촬영 위치 (가로 · 세로 %)
 *   north  : 360도 사진에서 도면 위쪽(↑)을 바라보는 각도 — 관리자 화면 [방향 맞추기]에서 정함
 *   file   : 360도 사진 (images/rooms/<객실id>/360-<id>.jpg) — 사진이 없는 위치는 손님에게 안 보임
 * 손님은 도면의 위치를 누르거나 360 화면 안의 화살표를 눌러 이동하고,
 * 도면에는 지금 보고 있는 방향이 부채꼴로 표시됩니다.
 */
const DhcTour = (() => {
  const $ = id => document.getElementById(id);
  const norm = a => ((a % 360) + 540) % 360 - 180;   // -180 ~ 180
  const sceneId = s => 's' + s.id;
  let data = {};
  let viewer = null, spots = [], cur = null, raf = 0, mapW = 1, mapH = 1, lastCone = '';

  async function load() {
    try { data = await (await fetch('data/tour.json?t=' + Date.now())).json(); } catch { data = {}; }
  }
  const spotsOf = id => (data[id] && data[id].spots || []).filter(s => s.file);
  const has = id => spotsOf(id).length > 0;

  // 360도 보기 프로그램(Pannellum)은 처음 열 때 한 번만 불러옴
  let libReady = null;
  function loadLib() {
    if (!libReady) {
      libReady = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css';
        document.head.appendChild(css);
        const js = document.createElement('script');
        js.src = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js';
        js.onload = resolve;
        js.onerror = () => { libReady = null; reject(new Error('360도 보기를 불러오지 못했습니다')); };
        document.head.appendChild(js);
      });
    }
    return libReady;
  }

  // 도면 위 a → b 방향 (도면 위쪽 = 0°, 시계 방향)
  const bearing = (a, b) => Math.atan2((b.x - a.x) * mapW, -(b.y - a.y) * mapH) * 180 / Math.PI;
  // 지금 보고 있는 방향 (도면 기준)
  const viewBearing = () => norm(viewer.getYaw() - (cur.north || 0));

  // 다른 위치로 이동 — facing: 도면 기준으로 바라볼 방향
  function go(to, facing) {
    if (!viewer || to === cur) return;
    viewer.loadScene(sceneId(to), 'same', norm(facing + (to.north || 0)), 'same');
  }

  function setCurrent(sid) {
    cur = spots.find(s => sceneId(s) === sid) || spots[0];
    $('tour-spot').textContent = spots.length > 1 ? `${cur.name} (${spots.indexOf(cur) + 1}/${spots.length})` : cur.name;
    $('tour-dots').querySelectorAll('.tour-dot').forEach(d => d.classList.toggle('on', d.dataset.sid === sceneId(cur)));
    lastCone = '';
  }

  // 지금 보는 방향을 도면 위 부채꼴로 계속 갱신
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!viewer || !cur) return;
    const h = viewer.getHfov();
    const from = viewBearing() - h / 2;
    const key = `${from.toFixed(1)}/${h.toFixed(1)}`;
    if (key === lastCone) return;
    lastCone = key;
    const cone = $('tour-dots').querySelector('.tour-dot.on .tour-cone');
    if (cone) cone.style.background = `conic-gradient(from ${from}deg, rgba(255,200,40,.55) 0deg ${h}deg, transparent ${h}deg)`;
  }

  async function open(room) {
    spots = spotsOf(room.id);
    if (!spots.length) return;
    await loadLib();
    const t = data[room.id];
    const img = $('tour-map-img');
    $('tour-map').hidden = !t.layout;
    if (t.layout) {
      img.src = `images/rooms/${room.id}/${t.layout}?v=${t.v || ''}`;
      try { await img.decode(); } catch {}
      mapW = img.naturalWidth || 1; mapH = img.naturalHeight || 1;
    }
    $('tour-title').textContent = room.name;
    $('tour-dots').innerHTML = spots.map(s => `
      <button type="button" class="tour-dot" data-sid="${sceneId(s)}" style="left:${s.x}%;top:${s.y}%" aria-label="${s.name}">
        <i class="tour-cone"></i><b>${s.id}</b><span>${s.name}</span>
      </button>`).join('');
    $('tour-dots').querySelectorAll('.tour-dot').forEach(d => {
      d.onclick = () => go(spots.find(s => sceneId(s) === d.dataset.sid), viewBearing());
    });

    const scenes = {};
    spots.forEach(s => {
      scenes[sceneId(s)] = {
        type: 'equirectangular',
        panorama: `images/rooms/${room.id}/${s.file}?v=${s.v || ''}`,
        yaw: s.north || 0,
        // 360 화면 안에 다른 위치로 가는 표시 (그쪽 방향으로 바라보며 이동)
        hotSpots: spots.filter(o => o !== s).map(o => ({
          type: 'scene', pitch: -15, yaw: norm(bearing(s, o) + (s.north || 0)),
          text: `${o.name}(으)로 이동`,
          clickHandlerFunc: () => go(o, bearing(s, o)),
        })),
      };
    });
    scenes[sceneId(spots[0])].autoRotate = -2; // 처음 화면만 천천히 회전 (손대면 멈춤)

    $('vr-tour').hidden = false;
    viewer = pannellum.viewer('tour-pano', {
      default: {
        firstScene: sceneId(spots[0]), sceneFadeDuration: 600, autoLoad: true,
        showZoomCtrl: false, hfov: 100, strings: { loadingLabel: '불러오는 중...' },
      },
      scenes,
    });
    viewer.on('scenechange', setCurrent);
    setCurrent(sceneId(spots[0]));
    cancelAnimationFrame(raf);
    tick();
  }

  function close() {
    cancelAnimationFrame(raf);
    if (viewer) { viewer.destroy(); viewer = null; }
    $('tour-pano').innerHTML = '';
    $('vr-tour').hidden = true;
  }

  $('tour-close').addEventListener('click', close);
  $('tour-map-toggle').addEventListener('click', () => $('tour-map').classList.toggle('folded'));
  // ESC 는 투어만 닫고 객실 창은 그대로 둠
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('vr-tour').hidden) { close(); e.stopImmediatePropagation(); }
  }, true);

  return { load, has, open, close };
})();
