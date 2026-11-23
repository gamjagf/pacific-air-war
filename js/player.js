// 내 비행기 움직임 (아이들도 쉽게: 손을 떼면 저절로 수평으로 돌아옴)
// 방향 규칙: 비행기 앞 = -Z. 조이스틱 오른쪽 = 오른쪽으로 기울며 선회, 위 = 기수 올림(상승)
import * as THREE from 'three';

const SPEED = 75;          // 비행 속도 (m/초)
const MAX_BANK = 1.75;     // 최대 기울기 (라디안, 약 100도 = 90도 넘게 눕힘)
const TURN = 1.35;         // 기울기에 따른 선회 빠르기 (끝까지 밀면 반 바퀴 약 1.5초)
const ROLL_RATE = 5;       // 조이스틱을 따라 기우는 빠르기
const PITCH_RATE = 0.85;   // 기수 올리고 내리는 빠르기
const MAX_PITCH = 0.95;    // 최대 상승·하강 각 (약 55도)
const MIN_ALT = 45, MAX_ALT = 1300;
const ARENA = 2300;        // 이 거리보다 멀리 가면 부드럽게 가운데로 돌려 줌
// 뒤로 돌기(임멜만 턴): 위로 반 바퀴 공중제비 → 반 바퀴 굴러 바로 서기 = 반대 방향
const LOOP_TIME = 1.0;     // 공중제비 반 바퀴 시간(초)
const ROLL_TIME = 0.5;     // 뒤집힌 상태에서 바로 서는 시간(초)
const TURN_COOL = 1.2;     // 끝난 뒤 다시 쓸 수 있을 때까지(초)
const HIGH_ALT = 950;      // 이보다 높으면 아래로 공중제비(스플릿 S)
const ease = t => t * t * (3 - 2 * t);

export function createPlayer(mesh) {
  const forward = new THREE.Vector3();
  const p = {
    mesh,
    speed: SPEED,
    yaw: 0, pitch: 0, roll: 0,
    velocity: new THREE.Vector3(),
    forward,
    maneuver: null,        // 뒤로 돌기 중이면 { t, dir }
    turnCool: 0,
    get position() { return mesh.position; },
    turnReady: () => !p.maneuver && p.turnCool <= 0,

    reset(x = 0, y = 220, z = 900, yaw = 0) {
      mesh.position.set(x, y, z);
      p.yaw = yaw; p.pitch = 0; p.roll = 0;
      p.maneuver = null; p.turnCool = 0;
      apply();
    },

    update(dt, ctl) {
      p.turnCool = Math.max(0, p.turnCool - dt);
      if (ctl.takeTurn?.() && p.turnReady()) {
        // 높이 떠 있으면 아래로, 아니면 위로 공중제비
        p.maneuver = { t: 0, dir: mesh.position.y > HIGH_ALT ? -1 : 1 };
        p.pitch = 0;
      }
      if (p.maneuver) { doManeuver(dt); return; }

      // 1) 기울기: 조이스틱 좌우를 따라가고, 놓으면 수평으로
      const targetRoll = -ctl.x * MAX_BANK;
      p.roll += (targetRoll - p.roll) * Math.min(1, dt * ROLL_RATE);

      // 2) 기수: 조이스틱 위아래. 놓으면 천천히 수평 비행으로
      if (ctl.y !== 0) p.pitch += ctl.y * PITCH_RATE * dt;
      else p.pitch -= p.pitch * Math.min(1, dt * 0.9);

      // 3) 바다·하늘 한계: 너무 낮으면 저절로 기수를 들고, 너무 높으면 내림
      const y = mesh.position.y;
      if (y < MIN_ALT + 40) p.pitch = Math.max(p.pitch, (MIN_ALT + 40 - y) * 0.012);
      if (y > MAX_ALT - 100) p.pitch = Math.min(p.pitch, -(y - (MAX_ALT - 100)) * 0.006);
      p.pitch = THREE.MathUtils.clamp(p.pitch, -MAX_PITCH, MAX_PITCH);

      // 4) 선회: 기울인 만큼 방향이 돌아감
      p.yaw += p.roll * TURN * dt;

      // 5) 경기장 밖으로 멀리 나가면 가운데 쪽으로 살살 돌려 줌
      const { x, z } = mesh.position;
      const dist = Math.hypot(x, z);
      if (dist > ARENA) {
        const toCenter = Math.atan2(x, z); // yaw 기준: 앞(-Z)이 가운데를 보는 각
        let diff = toCenter - p.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        p.yaw += diff * Math.min(1, dt * 0.6 * (dist - ARENA) / 200);
      }

      apply();
      p.velocity.copy(forward).multiplyScalar(p.speed);
      mesh.position.addScaledVector(p.velocity, dt);
      if (mesh.position.y < MIN_ALT) mesh.position.y = MIN_ALT;
    },
  };

  function apply() {
    mesh.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    mesh.updateMatrixWorld();
    forward.set(0, 0, -1).applyQuaternion(mesh.quaternion);
  }

  // 뒤로 돌기: 조이스틱은 잠깐 무시하고 정해진 동작을 함 (기관총은 그대로 쏠 수 있음)
  function doManeuver(dt) {
    const m = p.maneuver;
    m.t += dt;
    const a = Math.min(1, m.t / LOOP_TIME);                         // 공중제비 진행
    const b = Math.max(0, Math.min(1, (m.t - LOOP_TIME) / ROLL_TIME)); // 바로 서기 진행
    p.roll += (0 - p.roll) * Math.min(1, dt * 8);                   // 시작할 때 기울기는 얼른 펴기
    const pitch = m.dir * Math.PI * ease(a);
    const roll = p.roll + Math.PI * ease(b);
    mesh.rotation.set(pitch, p.yaw, roll, 'YXZ');
    mesh.updateMatrixWorld();
    forward.set(0, 0, -1).applyQuaternion(mesh.quaternion);
    p.velocity.copy(forward).multiplyScalar(p.speed);
    mesh.position.addScaledVector(p.velocity, dt);
    if (mesh.position.y < MIN_ALT) mesh.position.y = MIN_ALT;
    if (b >= 1) {
      // 끝: 반대 방향을 보고 바로 선 자세로 정리 (각도 숫자만 바꿔 적고 모양은 그대로)
      p.yaw = Math.atan2(Math.sin(p.yaw + Math.PI), Math.cos(p.yaw + Math.PI));
      p.pitch = 0; p.roll = 0;
      p.maneuver = null; p.turnCool = TURN_COOL;
      apply();
    }
  }

  return p;
}

// 뒤따라가는 카메라: 비행기 뒤·위에서 부드럽게 따라감. 기울기는 일부만 따라가서 어지럽지 않게
export function createChaseCamera(camera) {
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const offset = new THREE.Vector3(), goal = new THREE.Vector3();
  let first = true;
  update.snap = () => { first = true; }; // 다음 장면에서 카메라를 바로 제자리로 (스테이지 시작 때)
  return update;
  function update(dt, player) {
    if (player.maneuver) {
      // 뒤로 돌기 중엔 비행기 자세를 그대로 따라가며 함께 공중제비 (안 그러면 카메라가 비행기를 놓침)
      q.copy(player.mesh.quaternion);
    } else {
      e.set(player.pitch * 0.85 - 0.07, player.yaw, player.roll * 0.3, 'YXZ');
      q.setFromEuler(e);
    }
    goal.copy(offset.set(0, 4.2, 19).applyQuaternion(q)).add(player.position);
    if (first) { camera.position.copy(goal); camera.quaternion.copy(q); first = false; return; }
    const k = 1 - Math.exp(-dt * 7);
    camera.position.lerp(goal, k);
    camera.quaternion.slerp(q, 1 - Math.exp(-dt * 6));
  };
}
