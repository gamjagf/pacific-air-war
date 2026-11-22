// 소리: 효과음(짧은 소리), 엔진 소리(반복), 배경음악
// - 폰은 사람이 화면을 누른 뒤에만 소리를 낼 수 있음 → '출격!' 버튼을 누를 때 unlock()
// - 효과음은 미리 풀어 둔(decode) 소리를 겹쳐 재생, 배경음악은 긴 파일이라 <audio>로 흘려 재생(메모리 절약)
// - 소리 켜기/끄기 설정은 이 폰에만 저장 (localStorage, 막혀 있어도 게임은 됨)
const SFX = ['gun', 'bomb', 'explosion', 'explosion_small', 'engine', 'hit', 'clear', 'gameover'];
const MUSIC = { bgm: 'assets/sounds/bgm.mp3', bgm_boss: 'assets/sounds/bgm_boss.mp3' };
const MIN_GAP = { gun: 0.05, hit: 0.1, explosion_small: 0.06 }; // 너무 자주 겹치면 시끄러워서
const MUSIC_VOL = 0.45, ENGINE_VOL = 0.18;
const KEY = 'paw_sound';

export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, master, sfxGain, musicGain, engineGain, engineSrc = null;
  const buffers = {}, last = {};
  let muted = readMuted();
  let unlocked = false, wantMusic = null, curMusic = null, wantEngine = false;
  const els = {};

  // 효과음 파일은 미리 받아 둠 (풀기는 unlock 때)
  const raw = Object.fromEntries(SFX.map(n => [n,
    fetch(`assets/sounds/${n}.mp3`).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)]));

  function setup() {
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ac.destination);
    sfxGain = ac.createGain(); sfxGain.connect(master);
    musicGain = ac.createGain(); musicGain.gain.value = MUSIC_VOL; musicGain.connect(master);
    engineGain = ac.createGain(); engineGain.gain.value = 0; engineGain.connect(master);
    for (const n of SFX) {
      raw[n].then(buf => buf && new Promise(res => ac.decodeAudioData(buf, res, () => res(null))))
        .then(b => { if (b) buffers[n] = b; if (n === 'engine') applyEngine(); })
        .catch(() => {});
    }
  }

  function applyEngine() {
    if (!ac) return;
    if (wantEngine && !engineSrc && buffers.engine) {
      engineSrc = ac.createBufferSource();
      engineSrc.buffer = buffers.engine;
      engineSrc.loop = true;
      engineSrc.connect(engineGain);
      engineSrc.start();
    }
    engineGain.gain.setTargetAtTime(wantEngine ? ENGINE_VOL : 0, ac.currentTime, 0.3);
  }

  function applyMusic() {
    if (!unlocked || wantMusic === curMusic) return;
    if (curMusic && els[curMusic]) els[curMusic].pause();
    curMusic = wantMusic;
    if (!curMusic) return;
    let el = els[curMusic];
    if (!el) {
      el = els[curMusic] = new Audio(MUSIC[curMusic]);
      el.loop = true;
      el.preload = 'auto';
      try { ac.createMediaElementSource(el).connect(musicGain); } catch { /* 연결 실패해도 소리는 남 */ }
    }
    el.currentTime = 0;
    el.play().catch(() => {});
  }

  const api = {
    get muted() { return muted; },
    // 시험용: 소리 장치 상태와 준비된 효과음 수
    get state() { return { ctx: ac ? ac.state : 'none', loaded: Object.keys(buffers).length, music: curMusic }; },

    // '출격!' 같은 버튼을 누른 그 순간에 불러야 폰에서 소리가 켜짐
    unlock() {
      if (!AC) return;
      if (!ac) setup();
      if (ac.state !== 'running') ac.resume().catch(() => {});
      unlocked = true;
      applyMusic();
      applyEngine();
    },

    play(name, vol = 1, rate = 1) {
      if (!ac || muted || !buffers[name] || ac.state !== 'running') return;
      const now = ac.currentTime;
      if (MIN_GAP[name] && now - (last[name] || -1) < MIN_GAP[name]) return;
      last[name] = now;
      const src = ac.createBufferSource();
      src.buffer = buffers[name];
      src.playbackRate.value = rate * (0.94 + Math.random() * 0.12); // 매번 살짝 다르게 → 덜 지루함
      const g = ac.createGain();
      g.gain.value = vol;
      src.connect(g).connect(sfxGain);
      src.start();
    },

    // 배경음악 바꾸기: 'bgm' | 'bgm_boss' | null(끄기)
    music(name) { wantMusic = name; applyMusic(); },
    engine(on) { wantEngine = on; applyEngine(); },

    setMuted(m) {
      muted = m;
      try { localStorage.setItem(KEY, m ? '0' : '1'); } catch { /* 저장 못 해도 괜찮음 */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.05);
    },

    // 앱을 내리면 소리도 멈춤
    pause() {
      if (ac && ac.state === 'running') ac.suspend().catch(() => {});
      if (curMusic && els[curMusic]) els[curMusic].pause();
    },
    resume() {
      if (!unlocked) return;
      ac.resume().catch(() => {});
      if (curMusic && els[curMusic]) els[curMusic].play().catch(() => {});
    },
  };
  return api;
}

function readMuted() {
  try { return localStorage.getItem(KEY) === '0'; } catch { return false; }
}
