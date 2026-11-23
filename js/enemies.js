// 제로기(적 전투기) 편대: 다가오기 → 공격(쫓아가며 짧게 연사) → 너무 가까우면 빠져나가기
// 아이들도 이길 수 있게: 내 비행기보다 조금 느리고, 덜 날렵하게 돌고, 쉬어 가며 쏨
import * as THREE from 'three';
import { segmentHitsSphere } from './weapons.js';

const SPEED = 66;            // 가까이에선 내 비행기(75)보다 느림 → 뒤를 잡을 수 있음
const CATCHUP_SPEED = 105;   // 멀리 떨어지면 빨라져서 얼른 다시 싸움에 끼어듦
const MAX_YAW_RATE = 0.8;    // 도는 빠르기 (라디안/초). 빨리 돌아와서 화면에 자주 보이게
const PITCH_RATE = 0.55, MAX_PITCH = 0.6;
const HP = 4;                // 총알 4발 맞으면 격추
const SIZE = 1.7;            // 적 비행기를 실제보다 크게 보이게 (화면에서 잘 보이도록)
const RADIUS = 11;           // 명중 판정 크기 (커진 날개보다 넉넉하게)
const AWAY_DIST = 200, AWAY_TIME = 2.5, RETURN_DIST = 420; // 화면 밖(뒤·옆)에 2.5초 넘게 있으면 내 앞 420m로 다시 데려옴
const FLEE_SPEED = 58;       // 다시 나타난 적은 내 앞에서 같은 쪽으로 천천히 날아감 → 쫓아가서 쏘기 쉬움
const FIRE_RANGE = 520, FIRE_CONE = 0.12;
const SHOT_RATE = 7, BURST = 0.9;          // 0.9초 동안 연사하고
const COOL_MIN = 1.8, COOL_RAND = 1.0;     // 2~3초 쉼
const E_BULLET_SPEED = 420, E_BULLET_LIFE = 1.5, SPREAD = 0.018;
const DAMAGE = 4;            // 한 발 맞을 때 줄어드는 내 기체 체력 (100 중)
const PLAYER_RADIUS = 3.2;
const SCORE_KILL = 100;

const UP = new THREE.Vector3(0, 1, 0), NEG_Z = new THREE.Vector3(0, 0, -1);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

export function createSquad(ctx) {
  const { scene, models, effects, weapons } = ctx;
  const list = [];
  const tmp = new THREE.Vector3(), toP = new THREE.Vector3(), right = new THREE.Vector3();

  // ---------- 적 총알 (주황색) ----------
  const bGeo = new THREE.BoxGeometry(0.35, 0.35, 7);
  const bMat = new THREE.MeshBasicMaterial({ color: 0xff9a5c, fog: false, toneMapped: false });
  const bullets = [];
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(bGeo, bMat);
    m.visible = false;
    scene.add(m);
    bullets.push({ mesh: m, vel: new THREE.Vector3(), prev: new THREE.Vector3(), life: 0, alive: false });
  }
  let bi = 0;

  function shoot(e) {
    const b = bullets[bi = (bi + 1) % bullets.length];
    b.alive = true; b.life = E_BULLET_LIFE;
    b.mesh.visible = true;
    b.mesh.position.copy(e.position).addScaledVector(e.forward, 6);
    tmp.copy(e.forward);
    tmp.x += (Math.random() - 0.5) * 2 * SPREAD;
    tmp.y += (Math.random() - 0.5) * 2 * SPREAD;
    tmp.z += (Math.random() - 0.5) * 2 * SPREAD;
    tmp.normalize();
    b.mesh.quaternion.setFromUnitVectors(NEG_Z, tmp);
    b.vel.copy(tmp).multiplyScalar(E_BULLET_SPEED).add(e.velocity);
    b.prev.copy(b.mesh.position);
  }

  // ---------- 적 한 대 만들기 ----------
  function makeEnemy(pos, yaw, latVec) {
    const mesh = models.make('enemy');
    mesh.scale.setScalar(SIZE);
    mesh.position.copy(pos);
    scene.add(mesh);
    const e = {
      mesh, position: mesh.position,
      velocity: new THREE.Vector3(), forward: new THREE.Vector3(),
      yaw, pitch: 0, roll: 0, speed: SPEED, hp: HP, radius: RADIUS,
      targetable: true,           // 아직 격추 안 됨 = 총알·표시 대상
      state: 'approach', timer: 0,
      burst: 0, shotT: 0, cool: 1 + Math.random() * 2, smokeT: 0, away: 0,
      latVec: latVec.clone(),     // 편대 자리 (다가올 때 옆으로 벌린 거리)
      jit: new THREE.Vector3((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 80),
      goal: new THREE.Vector3(),

      hit(dmg, point) {
        if (!e.targetable) return;
        e.hp -= dmg;
        effects.spark(point);
        if (e.hp <= 0) {
          e.targetable = false;
          e.state = 'down';
          effects.explode(e.position, 0.7);
          ctx.addScore(SCORE_KILL);
          ctx.onKill?.(e);
        } else if (e.state === 'attack' && Math.random() < 0.3) {
          evade(e); // 맞으면 가끔 놀라서 피함
        }
      },
    };
    apply(e, 0);
    list.push(e);
    return e;
  }

  function apply(e, dt) {
    e.mesh.rotation.set(e.pitch, e.yaw, e.roll, 'YXZ');
    e.mesh.updateMatrixWorld();
    e.forward.copy(NEG_Z).applyQuaternion(e.mesh.quaternion);
    e.velocity.copy(e.forward).multiplyScalar(e.speed);
    e.position.addScaledVector(e.velocity, dt);
  }

  // 목표 지점 쪽으로 정해진 빠르기 안에서 방향을 돌림 (돌 때는 날개를 기울임)
  function steer(e, target, dt) {
    tmp.subVectors(target, e.position);
    const d = tmp.length() || 1;
    tmp.divideScalar(d);
    const rate = clamp(wrap(Math.atan2(-tmp.x, -tmp.z) - e.yaw) * 1.8, -MAX_YAW_RATE, MAX_YAW_RATE);
    e.yaw += rate * dt;
    e.roll += (rate / MAX_YAW_RATE - e.roll) * Math.min(1, dt * 3);
    let wantPitch = clamp(Math.asin(clamp(tmp.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
    if (e.position.y < 110) wantPitch = Math.max(wantPitch, 0.35);   // 바다에 너무 가까우면 올라감
    if (e.position.y > 1100) wantPitch = Math.min(wantPitch, -0.2);
    e.pitch += clamp(wantPitch - e.pitch, -PITCH_RATE * dt, PITCH_RATE * dt);
  }

  function evade(e) {
    e.state = 'evade';
    e.timer = 1.2 + Math.random() * 0.8;   // 짧게 빠졌다가 금방 다시 공격
    right.crossVectors(e.forward, UP).normalize();
    e.goal.copy(e.position).addScaledVector(e.forward, 300)
      .addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * 220);
    e.goal.y = Math.max(140, e.position.y + (Math.random() - 0.3) * 200);
  }

  function bringBack(e, p) {
    const a = p.yaw + (Math.random() - 0.5) * 0.9;              // 내 정면에서 좌우로 조금씩 다른 자리
    e.position.set(p.position.x - Math.sin(a) * RETURN_DIST, 0, p.position.z - Math.cos(a) * RETURN_DIST);
    e.position.y = clamp(p.position.y + (Math.random() - 0.3) * 120, 140, 900);
    e.yaw = p.yaw + (Math.random() - 0.5) * 0.5; e.pitch = 0; e.roll = 0; // 나와 같은 쪽을 보고 날아감
    e.speed = FLEE_SPEED;
    e.state = 'flee'; e.timer = 5 + Math.random() * 3; e.away = 0; e.burst = 0;
    e.goal.copy(e.position).addScaledVector(tmp.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)), 1500);
    e.cool = 1.5 + Math.random();
    apply(e, 0);
  }

  const api = {
    list,

    // 내 비행기 앞쪽 dist 거리에 V자 편대를 만듦. angle: 앞에서 왼쪽(+)/오른쪽(-)으로 돌린 각
    spawnFormation(count, { angle = 0, dist = 650 } = {}) {
      const p = ctx.player;
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).applyAxisAngle(UP, angle);
      const center = p.position.clone().addScaledVector(fwd, dist);
      center.y = clamp(p.position.y + 60, 160, 700);
      const toPlayer = fwd.clone().negate();
      const side = new THREE.Vector3().crossVectors(toPlayer, UP).normalize();
      const yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
      for (let i = 0; i < count; i++) {
        const k = Math.ceil(i / 2), s = i === 0 ? 0 : (i % 2 ? 1 : -1);
        const lat = side.clone().multiplyScalar(s * 45 * k);
        const pos = center.clone().add(lat).addScaledVector(fwd, 35 * k);
        pos.y += k * 6;
        makeEnemy(pos, yaw, lat.multiplyScalar(3)); // 다가올 땐 편대를 넓게 벌려 둘러싸듯이
      }
    },

    // 정해진 자리(예: 보스 항공모함 갑판)에서 줄지어 이륙해서 바로 공격하러 옴
    spawnAt(count, pos, yaw) {
      const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // 뒤쪽(+Z를 yaw만큼 돌린 방향)
      for (let i = 0; i < count; i++) {
        const p = pos.clone().addScaledVector(back, i * 30);
        p.y += i * 4;
        const e = makeEnemy(p, yaw, new THREE.Vector3());
        e.state = 'attack';
        e.cool = 3 + Math.random() * 2; // 이륙하자마자 쏘지는 않게
      }
    },

    remaining: () => list.reduce((n, e) => n + (e.targetable ? 1 : 0), 0),

    update(dt) {
      const p = ctx.player;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];

        // 격추된 비행기: 연기를 뿜으며 빙글빙글 떨어지다 바다에 부딪히면 폭발
        if (e.state === 'down') {
          e.pitch += (-0.9 - e.pitch) * Math.min(1, dt * 1.2);
          e.roll += 2.8 * dt;
          apply(e, dt);
          e.position.y -= 10 * dt;
          if ((e.smokeT -= dt) <= 0) { e.smokeT = 0.05; effects.smoke(e.position, 1.1, 0.16); }
          if (e.position.y <= 1.5) {
            weapons.splash(e.position, 30);
            tmp.copy(e.position).setY(3);
            effects.explode(tmp, 0.8);
            scene.remove(e.mesh);
            list.splice(i, 1);
          }
          continue;
        }

        toP.subVectors(p.position, e.position);
        const dist = toP.length();
        toP.divideScalar(dist || 1);

        // 화면 밖(내 앞 약 37도 밖)에 오래 있으면 → 내 앞쪽으로 다시 데려와서 화면에 자주 보이게
        if (dist > AWAY_DIST && p.forward.dot(tmp.copy(toP).negate()) < 0.8) e.away += dt; else e.away = 0;
        if (e.away > AWAY_TIME) bringBack(e, p);

        if (e.state === 'approach') {
          e.goal.copy(p.position).add(e.latVec);
          steer(e, e.goal, dt);
          if (dist < 700) e.state = 'attack';
        } else if (e.state === 'attack') {
          const lead = Math.min(dist / E_BULLET_SPEED, 1.2) * 0.6; // 내가 갈 곳을 조금 앞질러 노림
          // 멀리선 저마다 조금씩 다른 곳으로(겹치지 않게), 가까워지면 정확히 나를 향함
          e.goal.copy(p.position).addScaledVector(p.velocity, lead)
            .addScaledVector(e.jit, clamp((dist - 200) / 600, 0, 1));
          steer(e, e.goal, dt);
          if (dist < 110) evade(e); // 부딪히기 전에 빠져나감
        } else if (e.state === 'flee') {               // 내 앞에서 도망 다니다가 시간이 되면 공격
          e.goal.y = e.position.y;
          steer(e, e.goal, dt);
          if ((e.timer -= dt) <= 0 || dist < 120) e.state = 'attack';
        } else if (e.state === 'evade') {
          steer(e, e.goal, dt);
          if ((e.timer -= dt) <= 0) e.state = 'attack';
        }
        // 빠르기: 멀면 따라붙고, 가까우면 느려짐 (아이들이 뒤를 잡을 수 있게)
        const want = e.state === 'flee' ? FLEE_SPEED : e.state === 'approach' ? SPEED : dist > 260 ? CATCHUP_SPEED : SPEED;
        e.speed += (want - e.speed) * Math.min(1, dt * 0.8);
        apply(e, dt);

        // 쏘기: 내 쪽을 똑바로 보고 가까울 때만, 짧게 연사하고 쉼
        e.cool -= dt;
        if (e.burst > 0) {
          e.burst -= dt;
          if ((e.shotT -= dt) <= 0) { e.shotT = 1 / SHOT_RATE; shoot(e); }
          if (e.burst <= 0) e.cool = COOL_MIN + Math.random() * COOL_RAND;
        } else if (e.cool <= 0 && e.state === 'attack' && dist < FIRE_RANGE &&
                   e.forward.angleTo(toP) < FIRE_CONE && ctx.canBeHit()) {
          e.burst = BURST; e.shotT = 0;
        }
      }

      // 적 총알 움직이기 + 내 비행기에 맞았는지
      for (const b of bullets) {
        if (!b.alive) continue;
        b.prev.copy(b.mesh.position);
        b.mesh.position.addScaledVector(b.vel, dt);
        b.life -= dt;
        if (ctx.canBeHit() && segmentHitsSphere(b.prev, b.mesh.position, p.position, PLAYER_RADIUS)) {
          ctx.damagePlayer(DAMAGE);
          effects.spark(tmp.copy(p.position).addScaledVector(p.forward, -2));
          b.life = 0;
        } else if (b.mesh.position.y <= 0) {
          weapons.splash(b.mesh.position, 2.5);
          b.life = 0;
        }
        if (b.life <= 0) { b.alive = false; b.mesh.visible = false; }
      }
    },

    dispose() {
      for (const e of list) scene.remove(e.mesh);
      list.length = 0;
      for (const b of bullets) scene.remove(b.mesh);
      bGeo.dispose(); bMat.dispose();
    },
  };
  return api;
}
