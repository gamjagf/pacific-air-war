// 스마트폰 터치 조작
// - 화면 왼쪽 절반 아무 곳이나 누르면 그 자리에 조이스틱이 생기고, 끌면 방향이 정해짐
// - 오른쪽 아래: 기관총(누르고 있으면 계속 발사), 폭탄(한 번 누르면 한 발)
// - 컴퓨터 시험용 키보드: 방향키/WASD = 조종, 스페이스 = 기관총, B = 폭탄
// 손가락 여러 개를 동시에 써도 되도록 손가락 번호(pointerId)별로 따로 기억함

const RADIUS = 60; // 조이스틱이 움직이는 최대 거리(px)

export function createControls() {
  const state = {
    x: 0, y: 0,          // 조이스틱 -1~1 (x: 오른쪽 +, y: 위쪽 +)
    fire: false,         // 기관총 버튼을 누르고 있는지
    bombQueued: false,   // 폭탄 버튼을 눌렀는지 (게임이 한 번 읽으면 꺼짐)
    enabled: true,
  };

  const stick = document.getElementById('stick');
  const knob = stick.querySelector('i');
  const btnGun = document.getElementById('btnGun');
  const btnBomb = document.getElementById('btnBomb');

  // ---------- 조이스틱 ----------
  let stickId = null, cx = 0, cy = 0;
  function moveStick(px, py) {
    let dx = px - cx, dy = py - cy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // 가운데 근처 살짝 흔들림은 무시(데드존)
    const dz = v => (Math.abs(v) < 0.08 ? 0 : v);
    state.x = dz(dx / RADIUS);
    state.y = dz(-dy / RADIUS);
  }
  function releaseStick() {
    stickId = null;
    state.x = state.y = 0;
    stick.classList.remove('on');
    knob.style.transform = '';
  }

  // 길게 누르면 뜨는 메뉴 막기 (기관총을 오래 누르고 있어도 끊기지 않게). 출처 화면 링크는 그대로 둠
  window.addEventListener('contextmenu', e => { if (!e.target.closest('a')) e.preventDefault(); });

  window.addEventListener('pointerdown', e => {
    if (!state.enabled || stickId !== null) return;
    if (e.target.closest('.btn')) return;           // 버튼은 따로 처리
    if (e.clientX > window.innerWidth * 0.5) return; // 왼쪽 절반만 조이스틱
    stickId = e.pointerId;
    cx = e.clientX; cy = e.clientY;
    stick.style.left = cx + 'px';
    stick.style.top = cy + 'px';
    stick.classList.add('on');
    moveStick(cx, cy);
  });
  window.addEventListener('pointermove', e => {
    if (e.pointerId === stickId) moveStick(e.clientX, e.clientY);
  });
  const up = e => { if (e.pointerId === stickId) releaseStick(); };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  // ---------- 버튼 ----------
  function holdButton(el, onDown, onUp) {
    const ids = new Set();
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!state.enabled) return;
      ids.add(e.pointerId);
      try { el.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저는 지원 안 함 */ }
      el.classList.add('on');
      onDown();
    });
    const end = e => {
      if (!ids.delete(e.pointerId)) return;
      if (ids.size === 0) { el.classList.remove('on'); onUp(); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }
  holdButton(btnGun, () => { state.fire = true; }, () => { state.fire = false; });
  holdButton(btnBomb, () => { state.bombQueued = true; }, () => {});

  // ---------- 키보드 (컴퓨터에서 시험할 때) ----------
  const keys = new Set();
  const keyAxis = () => {
    if (stickId !== null) return;
    const has = (...k) => k.some(c => keys.has(c));
    state.x = (has('ArrowRight', 'KeyD') ? 1 : 0) - (has('ArrowLeft', 'KeyA') ? 1 : 0);
    state.y = (has('ArrowUp', 'KeyW') ? 1 : 0) - (has('ArrowDown', 'KeyS') ? 1 : 0);
  };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { state.fire = true; btnGun.classList.add('on'); }
    if (e.code === 'KeyB') { state.bombQueued = true; }
    keyAxis();
  });
  window.addEventListener('keyup', e => {
    keys.delete(e.code);
    if (e.code === 'Space') { state.fire = false; btnGun.classList.remove('on'); }
    keyAxis();
  });

  // 앱을 내리거나 다른 창으로 가면 누르던 것을 모두 놓음 (버튼이 눌린 채로 남지 않게)
  const resetAll = () => {
    keys.clear(); releaseStick(); state.fire = false;
    btnGun.classList.remove('on'); btnBomb.classList.remove('on');
  };
  window.addEventListener('blur', resetAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll(); });

  // 폭탄 요청을 한 번 꺼내 쓰기
  state.takeBomb = () => { const b = state.bombQueued; state.bombQueued = false; return b; };
  // 스테이지가 끝나거나 다시 시작할 때 누르던 것을 모두 놓음
  state.reset = () => { resetAll(); state.bombQueued = false; };
  return state;
}
