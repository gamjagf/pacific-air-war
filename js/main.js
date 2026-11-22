// 게임 시작점: 불러오기 → 시작 화면 → 스테이지 → 결과 화면
// 주소 뒤에 붙이는 시험용 옵션:
//   ?debug=1     화면 왼쪽 위에 초당 장면 수(fps)와 모델 상태 표시, window.__game 으로 시험 명령
//   ?fallback=1  GLB 대신 코드로 만든 대체 모양으로 보기
//   ?view=models 모델 4개를 나란히 놓고 보기 (방향 확인용, &cam=x,y,z&at=x,y,z 로 카메라 지정)
import * as THREE from 'three';
import { createWorld } from './scene.js';
import { loadModels } from './models.js';
import { createControls } from './controls.js';
import { createPlayer, createChaseCamera } from './player.js';
import { createWeapons } from './weapons.js';
import { createEffects } from './effects.js';
import { createUI } from './ui.js';
import { STAGES } from './stages.js';
import { createAudio } from './audio.js';
import { loadHighScore, saveHighScore } from './storage.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const hud = document.getElementById('hud');
const loadbar = document.getElementById('loadbar');

const world = createWorld(document.getElementById('game'));
const { scene, camera, renderer } = world;

const models = await loadModels({
  forceFallback: params.has('fallback'),
  onProgress: p => { loadbar.style.width = Math.round(p * 100) + '%'; },
});
window.__models = models.info; // 시험할 때 확인용
document.getElementById('loading').classList.add('done');

const update = params.get('view') === 'models' ? setupModelView() : setupGame();

// ---------- 게임: 시작 화면 → 스테이지 → 결과 화면 ----------
// 상태(state): title(시작 화면) → playing(게임 중) → clearing(임무 완료, 잠깐 더 날기)
//              또는 dying(격추당함, 폭발 보여 주기) → result(결과 화면)
function setupGame() {
  const ui = createUI();
  const audio = createAudio();
  window.__audio = audio; // 시험할 때 확인용
  const ctl = createControls();
  ctl.enabled = false;
  const IDLE = { x: 0, y: 0, fire: false, takeBomb: () => false }; // 시작·결과 화면에서는 저절로 날기
  const NONE = [];
  const effects = createEffects(scene);
  const weapons = createWeapons(scene);
  weapons.bombEnabled = false;
  const player = createPlayer(models.make('player'));
  scene.add(player.mesh);
  const chase = createChaseCamera(camera);
  const START = [0, 260, 600, 0];
  player.reset(...START);

  const game = { state: 'title', index: 0, score: 0, stageStart: 0, hp: 100, stage: null, timer: 0, smokeT: 0, god: false };
  const ctx = {
    scene, models, effects, weapons, player, ui,
    sfx: (name, vol, rate) => audio.play(name, vol, rate),          // 스테이지·배에서 소리 낼 때
    addScore(n) { game.score += n; ui.setScore(game.score); },
    canBeHit: () => game.state === 'playing' && !game.god,
    damagePlayer(n) {
      if (!ctx.canBeHit()) return;
      game.hp = Math.max(0, game.hp - n);
      ui.setHp(game.hp / 100);
      ui.flash();
      audio.play('hit', 0.8);
    },
    heal(n) { game.hp = Math.min(100, game.hp + n); ui.setHp(game.hp / 100); },
    onKill: () => audio.play('explosion_small', 0.9),   // 제로기 격추
    onSink: () => audio.play('explosion', 1.0),         // 배 격침
  };
  // 무기에서 생긴 일 → 소리
  const WEAPON_SFX = { fire: ['gun', 0.3], bomb: ['bomb', 0.6], hit: ['hit', 0.2], bombShip: ['explosion', 0.8], bombHit: ['explosion_small', 0.5] };

  function clearStage() {
    game.stage?.dispose();
    game.stage = null;
    weapons.reset();
    effects.reset();
  }

  function startStage(i) {
    clearStage();
    const def = STAGES[i];
    game.index = i;
    game.stageStart = game.score;  // '다시 하기'를 누르면 이 점수로 돌아감
    game.hp = 100;
    game.state = 'playing';
    player.reset(...(def.start || START));
    player.mesh.visible = true;
    chase.snap();
    weapons.bombEnabled = def.bomb;
    game.stage = def.create(ctx);
    ui.hideScreens();
    ui.setPlaying(true, { bomb: def.bomb });
    ui.setScore(game.score);
    ui.setHp(1);
    ui.banner(def.name, def.goal, 3200);
    ctl.reset();
    ctl.enabled = true;
    audio.music(def.bgm || 'bgm');
    audio.engine(true);
  }

  function goTitle() {
    clearStage();
    weapons.bombEnabled = false;
    game.state = 'title';
    player.reset(...START);
    player.mesh.visible = true;
    chase.snap();
    audio.engine(false);
    audio.music('bgm');   // 소리가 켜진 뒤(한 번 출격한 뒤)에만 실제로 나옴
    ui.showTitle(() => {
      audio.unlock();     // 폰은 버튼을 누른 이 순간에만 소리를 켤 수 있음
      game.score = 0;
      startStage(0);
    }, { high: loadHighScore(), muted: audio.muted, onSound: m => audio.setMuted(m) });
  }

  function finish(win) {
    ctl.enabled = false;
    ctl.reset();
    weapons.bombEnabled = false; // 결과 화면에서는 폭탄 조준 고리를 숨김
    game.state = 'result';
    ui.setPlaying(false);
    const def = STAGES[game.index];
    const lines = [];
    if (win) {
      const bonus = Math.round(game.hp) * 10;   // 기체가 덜 다쳤을수록 보너스
      game.score += bonus;
      lines.push(`기체 보너스 +${bonus}`);
    }
    lines.push(`점수 ${game.score}`);
    // 최고 점수: 이긴 판이든 진 판이든 지금 점수가 더 높으면 저장
    if (saveHighScore(game.score)) lines.push('★ 새 최고 기록!');
    else lines.push(`최고 점수 ${loadHighScore()}`);
    audio.engine(false);
    if (!win) audio.play('gameover', 0.9);   // 이겼을 땐 '임무 완료!' 때 이미 클리어 소리를 냄
    const hasNext = win && game.index + 1 < STAGES.length;
    if (win && !hasNext) lines.push(game.index + 1 === 3 ? '모든 스테이지를 클리어했어요!' : '다음 스테이지는 준비 중이에요.');
    if (!win) lines.push('다시 도전해 보자!');
    const buttons = [];
    if (hasNext) buttons.push({ label: '다음 스테이지', primary: true, onClick: () => startStage(game.index + 1) });
    buttons.push({ label: '다시 하기', primary: !hasNext, onClick: () => { game.score = game.stageStart; startStage(game.index); } });
    buttons.push({ label: '처음으로', onClick: goTitle });
    ui.showResult({ win, title: win ? `${def.name} 클리어!` : '격추당했다…', lines, buttons });
  }

  goTitle();

  // 시험용 (?debug=1 일 때만): 적 모두 격추, 무적
  if (DEBUG) {
    window.__game = {
      game, ctx, startStage, goTitle,
      killAll() { for (const t of game.stage?.targets || []) if (t.targetable) t.hit(99, t.position); },
      god(on = true) { game.god = on; },
    };
    window.__ctl = ctl;
  }

  const tail = new THREE.Vector3(), camGoal = new THREE.Vector3();
  return function (t, dt) {
    const s = game.state;
    const flying = s === 'playing' || s === 'clearing';
    const input = flying ? ctl : IDLE;
    if (s !== 'dying') player.update(dt, input);
    const targets = game.stage ? game.stage.targets : NONE;
    weapons.update(dt, player, input, targets);
    for (const e of weapons.events) {
      const s2 = WEAPON_SFX[e.type || e];
      if (s2) audio.play(s2[0], s2[1]);
    }
    game.stage?.update(dt, t);
    effects.update(dt);
    if (s !== 'dying') chase(dt, player);
    else {
      // 격추당하면 카메라가 뒤로 물러나며 폭발 쪽을 봄 (연기 속에 갇히지 않게)
      camGoal.subVectors(camera.position, player.position).setY(0).normalize().multiplyScalar(85).add(player.position);
      camGoal.y = player.position.y + 25;
      camera.position.lerp(camGoal, 1 - Math.exp(-dt * 1.5));
      camera.lookAt(player.position);
    }
    ui.update(dt);
    camera.updateMatrixWorld();

    if (flying) {
      ui.crosshair(camera, player);
      ui.markers(camera, targets, weapons.lockTarget);
      ui.setGoal(game.stage.goalText());
      ui.bombReady(weapons.bombReady());
      // 많이 다치면 꼬리에서 연기
      if (game.hp < 40 && (game.smokeT -= dt) <= 0) {
        game.smokeT = 0.08;
        effects.smoke(tail.set(0, 0.6, 5).applyMatrix4(player.mesh.matrixWorld), 0.8, 0.25);
      }
    }

    if (s === 'playing') {
      if (game.hp <= 0) {                       // 격추당함: 폭발을 보여 주고 결과 화면으로
        game.state = 'dying';
        game.timer = 2.4;
        effects.explode(player.position, 1.1);
        audio.play('explosion', 1.0);
        audio.engine(false);
        audio.music(null);
        player.mesh.visible = false;
        ctl.enabled = false;
        ctl.reset();
        ui.setPlaying(false);
      } else if (game.stage.status() === 'clear') {
        game.state = 'clearing';
        game.timer = 2.5;
        ui.banner('임무 완료!', '잘했어요!', 2400);
        audio.play('clear', 0.9);
      }
    } else if (s === 'dying' || s === 'clearing') {
      if ((game.timer -= dt) <= 0) finish(s === 'clearing');
    }
  };
}

// ---------- 방향 확인: 빨간 화살표가 '앞(-Z)' ----------
function setupModelView() {
  for (const id of ['stick', 'btnGun', 'btnBomb', 'hint']) document.getElementById(id).hidden = true;
  const place = { player: [0, 20], enemy: [14, 20], carrier: [-150, 0], ship: [150, 0] };
  for (const [n, [x, y]] of Object.entries(place)) {
    const o = models.make(n);
    o.position.set(x, y, 0);
    scene.add(o);
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(x, 30, 0), 120, 0xff0000, 30, 18));
  }
  const num = k => (params.get(k) || '').split(',').map(Number);
  return function () {
    if (params.has('cam')) { camera.position.fromArray(num('cam')); camera.lookAt(...num('at')); }
    else { camera.position.set(0, 520, 0.01); camera.lookAt(0, 0, 0); }
  };
}

// ---------- 매 장면 그리기 ----------
const clock = new THREE.Clock();
let frames = 0, fpsTime = 0;
if (DEBUG) {
  hud.hidden = false;
  // 시험용: 화면 그리기 없이 게임 시간을 n장면만큼 빨리 돌림 (브라우저가 느리게 돌 때 확인용)
  let simT = 0;
  window.__three = { scene, camera, renderer, world }; // 시험·홍보 그림 만들 때 카메라 직접 잡기용
  window.__step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) update(simT += dt, dt); world.update(simT); renderer.render(scene, camera); };
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); // 잠깐 멈췄다 돌아와도 순간이동하지 않게
  const t = clock.elapsedTime;
  update(t, dt);
  world.update(t);
  renderer.render(scene, camera);
  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    window.__fps = frames / fpsTime;
    if (DEBUG) {
      const info = renderer.info.render;
      const g = window.__game;
      hud.textContent = `fps ${window.__fps.toFixed(0)}  그리기 ${info.calls}회  삼각형 ${(info.triangles / 1000).toFixed(0)}k\n` +
        Object.entries(models.info).map(([n, i]) => `${n}: ${i.source === 'glb' ? 'GLB' : '대체'}`).join('  ') +
        (g ? `\n${g.game.state}  체력 ${g.game.hp}  고도 ${g.ctx.player.position.y.toFixed(0)}m` : '');
    }
    frames = 0; fpsTime = 0;
  }
}
renderer.setAnimationLoop(frame);

// 앱을 내리면 멈춰서 배터리 아끼기 (돌아오면 다시 시작)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { renderer.setAnimationLoop(null); window.__audio?.pause(); }
  else { clock.getDelta(); renderer.setAnimationLoop(frame); window.__audio?.resume(); }
});
