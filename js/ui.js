// 화면 위 글자와 버튼: 시작 화면, 점수·체력·목표, 안내 글, 적 위치 표시, 결과 화면
import * as THREE from 'three';

export function createUI() {
  const $ = id => document.getElementById(id);
  const hudTop = $('hudTop'), scoreEl = $('score'), goalEl = $('goal'), hpFill = $('hpbar').firstElementChild;
  const flashEl = $('flash'), bannerEl = $('banner'), titleEl = $('title'), resultEl = $('result');
  const crosshair = $('crosshair'), hint = $('hint'), marksBox = $('marks');
  const stick = $('stick'), btnGun = $('btnGun'), btnBomb = $('btnBomb'), btnTurn = $('btnTurn');

  // 적 표시: 화면 안이면 네모, 화면 밖이면 가장자리 화살표
  const marks = Array.from({ length: 12 }, () => {
    const d = document.createElement('div');
    d.className = 'mark';
    d.style.display = 'none';
    marksBox.appendChild(d);
    return d;
  });

  let flashV = 0, bannerTimer = 0, hintTimer = 0;
  const v = new THREE.Vector3();

  const api = {
    // 시작 화면: 최고 점수, 출격, 소리 켜기/끄기, 출처
    showTitle(onStart, { high = 0, muted = false, onSound = () => {} } = {}) {
      titleEl.hidden = false;
      resultEl.hidden = true;
      $('highScore').textContent = high > 0 ? `최고 점수 ${high}` : '';
      $('btnStart').onclick = () => onStart();
      const btnSound = $('btnSound');
      const label = m => { btnSound.textContent = m ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'; };
      label(muted);
      btnSound.onclick = () => { muted = !muted; label(muted); onSound(muted); };
      $('btnCredits').onclick = () => { $('credits').hidden = false; };
      $('btnCreditsClose').onclick = () => { $('credits').hidden = true; };
    },
    hideScreens() { titleEl.hidden = true; resultEl.hidden = true; },

    // 게임 중에만 보이는 것들 (조이스틱·버튼·조준점·위쪽 정보)
    setPlaying(on, { bomb = false } = {}) {
      hudTop.hidden = !on;
      stick.hidden = !on;
      btnGun.hidden = !on;
      btnBomb.hidden = !(on && bomb);
      btnTurn.hidden = !on;
      crosshair.hidden = !on;
      clearTimeout(hintTimer);
      hint.classList.toggle('off', !on);
      if (on) hintTimer = setTimeout(() => hint.classList.add('off'), 7000);
      if (!on) { api.markers(null, []); api.setBoss(null); }
    },

    setScore(n) { scoreEl.textContent = `점수 ${n}`; },
    setGoal(text) { if (goalEl.textContent !== text) goalEl.textContent = text; },
    setHp(f) {
      f = Math.max(0, Math.min(1, f));
      hpFill.style.width = (f * 100) + '%';
      hpFill.style.background = f > 0.5 ? '#5fd16b' : f > 0.25 ? '#f2c14e' : '#ff5a4a';
    },
    flash() { flashV = 1; },
    // 보스 체력: 0~1, null이면 숨김
    setBoss(f) {
      const bar = $('bossbar');
      bar.hidden = f == null;
      if (f != null) bar.querySelector('i').style.width = (Math.max(0, f) * 100) + '%';
    },
    bombReady(ready) { btnBomb.classList.toggle('wait', !ready); },
    turnReady(ready) { btnTurn.classList.toggle('wait', !ready); },

    // 화면 가운데 큰 안내 글 (몇 초 뒤 사라짐)
    banner(big, small = '', ms = 2800) {
      if (!resultEl.hidden || !titleEl.hidden) return; // 시작·결과 화면 위에는 띄우지 않음
      bannerEl.querySelector('b').textContent = big;
      bannerEl.querySelector('span').textContent = small;
      bannerEl.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), ms);
    },

    update(dt) {
      if (flashV > 0) {
        flashV = Math.max(0, flashV - dt * 3);
        flashEl.style.opacity = flashV.toFixed(2);
      }
    },

    // 조준점: 비행기 앞 300m 지점
    crosshair(camera, player) {
      v.copy(player.forward).multiplyScalar(300).add(player.position).project(camera);
      crosshair.style.left = ((v.x + 1) / 2 * 100) + '%';
      crosshair.style.top = ((1 - v.y) / 2 * 100) + '%';
    },

    markers(camera, targets, lock = null) {
      const W = window.innerWidth, H = window.innerHeight;
      let n = 0;
      for (const t of targets) {
        if (!t.targetable || n >= marks.length) continue;
        const m = marks[n++];
        v.copy(t.position).project(camera);
        let x = v.x, y = v.y;
        const behind = v.z > 1;
        if (!behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88) {
          m.className = 'mark' + (t.type === 'boss' ? ' boss' : '') + (t === lock ? ' lock' : '');
          m.style.transform = `translate(${(x + 1) / 2 * W}px, ${(1 - y) / 2 * H}px)`;
        } else {
          if (behind) { x = -x; y = -y; if (Math.abs(x) + Math.abs(y) < 1e-3) y = -1; }
          const k = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.8);
          x /= k; y /= k;
          const ang = Math.atan2(-y * H, x * W); // 화면 좌표(아래가 +)에서의 방향
          m.className = 'mark edge';
          m.style.transform = `translate(${(x + 1) / 2 * W}px, ${(1 - y) / 2 * H}px) rotate(${ang}rad)`;
        }
        m.style.display = '';
      }
      for (; n < marks.length; n++) marks[n].style.display = 'none';
    },

    // 결과 화면: buttons = [{ label, primary, onClick }]
    // lines: 글 줄들. 줄 앞에 '★'가 있으면 강조(새 최고 기록)
    showResult({ win, title, lines, buttons }) {
      resultEl.hidden = false;
      bannerEl.classList.remove('show');
      resultEl.className = 'screen ' + (win ? 'win' : 'lose');
      $('resTitle').textContent = title;
      const text = $('resText');
      text.replaceChildren(...lines.map(l => Object.assign(document.createElement('div'),
        { textContent: l, className: l.startsWith('★') ? 'newrec' : '' })));
      const box = $('resButtons');
      box.replaceChildren(...buttons.map(b => {
        const el = document.createElement('button');
        el.className = 'big' + (b.primary ? '' : ' sub');
        el.textContent = b.label;
        el.onclick = b.onClick;
        return el;
      }));
    },
  };
  api.setPlaying(false);
  return api;
}
