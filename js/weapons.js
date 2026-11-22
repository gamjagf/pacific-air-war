// 기관총 총알(빛나는 예광탄)과 폭탄, 바다에 떨어질 때 물보라
// 매번 새로 만들지 않고 미리 만들어 둔 것을 돌려 씀(풀) → 폰에서 끊김 없이
import * as THREE from 'three';

const FIRE_RATE = 14;        // 초당 총알 수
const BULLET_SPEED = 520;    // 비행기 속도에 더해지는 총알 속도 (m/초)
const BULLET_LIFE = 1.3;
const BOMB_COOLDOWN = 1.4;   // 폭탄 다시 쓸 수 있을 때까지 (초)
const GRAVITY = 14;          // 게임이라 실제(9.8)보다 조금 빨리 떨어지게
const ASSIST_ANGLE = 0.1;    // 조준 도움: 조준점에서 약 6도 안의 적이면
const ASSIST_RANGE = 750;    //            750m 안이면 총알을 그 적이 갈 곳으로 살짝 꺾어 줌
const NEG_Z = new THREE.Vector3(0, 0, -1);

// 총알처럼 한 장면에 몇 m씩 건너뛰는 물체도 놓치지 않게: 선분 a→b 가 공(c, r)을 지나갔는지
export function segmentHitsSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

export function createWeapons(scene) {
  // ---------- 총알 ----------
  const bulletGeo = new THREE.BoxGeometry(0.4, 0.4, 9);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false, toneMapped: false });
  const bullets = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(bulletGeo, bulletMat);
    m.visible = false;
    scene.add(m);
    bullets.push({ mesh: m, vel: new THREE.Vector3(), prev: new THREE.Vector3(), life: 0, alive: false });
  }
  let bi = 0, fireTimer = 0, side = 1;

  // ---------- 폭탄 ----------
  const bombGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.2, 8);
  bombGeo.rotateX(Math.PI / 2);
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.5, metalness: 0.5 });
  const bombs = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(bombGeo, bombMat);
    m.visible = false;
    scene.add(m);
    bombs.push({ mesh: m, vel: new THREE.Vector3(), alive: false });
  }
  let bombTimer = 0;

  // 폭탄 조준 고리: 지금 폭탄을 놓으면 바다 어디에 떨어지는지 미리 보여 줌
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 12, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, fog: false }));
  // depthTest:false = 배 위에 떠 있어도 배에 가려지지 않고 항상 보임
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  scene.add(ring);

  // ---------- 물보라 ----------
  const splashTex = splashTexture();
  const splashes = [];
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: splashTex, transparent: true, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    splashes.push({ s, t: 0, dur: 1, size: 1, alive: false });
  }
  let si = 0;
  function splash(pos, size) {
    const sp = splashes[si = (si + 1) % splashes.length];
    sp.alive = true; sp.t = 0; sp.size = size; sp.dur = 0.6 + size * 0.03;
    sp.s.position.set(pos.x, 0, pos.z);
    sp.s.visible = true;
  }

  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), lead = new THREE.Vector3();
  const api = {
    bullets, bombs,
    events: [], // 이번 장면에 일어난 일 (소리·점수 연결용: 'fire', 'bomb', 'bombHit')
    bombEnabled: true,   // 스테이지 1은 폭탄 없음
    lockTarget: null,    // 지금 조준 도움을 받는 적 (화면 표시가 노란색이 됨)
    bombReady: () => bombTimer <= 0,
    bombCooldown: () => Math.max(0, bombTimer / BOMB_COOLDOWN),

    // targets: 맞힐 수 있는 것들 [{position, velocity, radius, targetable, hit(dmg, point)}]
    update(dt, player, ctl, targets = []) {
      api.events.length = 0;

      // 조준 도움 대상 찾기: 조준점에 가장 가까운(각도가 작은) 적
      let best = null, bestAng = ASSIST_ANGLE;
      for (const t of targets) {
        if (!t.targetable) continue;
        tmp.subVectors(t.position, player.position);
        if (tmp.length() > ASSIST_RANGE) continue;
        const ang = player.forward.angleTo(tmp);
        if (ang < bestAng) { bestAng = ang; best = t; }
      }
      api.lockTarget = best;

      // 총 쏘기: 양쪽 날개에서 번갈아
      fireTimer -= dt;
      if (ctl.fire && fireTimer <= 0) {
        fireTimer = 1 / FIRE_RATE;
        side = -side;
        const b = bullets[bi = (bi + 1) % bullets.length];
        b.alive = true; b.life = BULLET_LIFE;
        b.mesh.visible = true;
        b.mesh.position.set(side * 2.6, -0.3, -2).applyMatrix4(player.mesh.matrixWorld);
        b.prev.copy(b.mesh.position);
        dir.copy(player.forward);
        if (best) {
          // 총알이 날아가는 동안 적이 움직일 곳(내 비행기 속도를 뺀 상대 속도 기준)을 노림
          const tFly = b.mesh.position.distanceTo(best.position) / BULLET_SPEED;
          lead.copy(best.velocity).sub(player.velocity).multiplyScalar(tFly).add(best.position);
          dir.subVectors(lead, b.mesh.position).normalize();
        }
        b.mesh.quaternion.setFromUnitVectors(NEG_Z, dir);
        b.vel.copy(dir).multiplyScalar(BULLET_SPEED).add(player.velocity);
        api.events.push('fire');
      }
      for (const b of bullets) {
        if (!b.alive) continue;
        b.life -= dt;
        b.prev.copy(b.mesh.position);
        b.mesh.position.addScaledVector(b.vel, dt);
        for (const t of targets) {                   // 적에 맞음 (배는 testSeg로 배 모양 판정)
          if (!t.targetable) continue;
          const hitIt = t.testSeg ? t.testSeg(b.prev, b.mesh.position)
            : segmentHitsSphere(b.prev, b.mesh.position, t.position, t.radius);
          if (hitIt) {
            t.hit(1, b.mesh.position, 'gun');
            api.events.push('hit');
            b.life = 0;
            break;
          }
        }
        if (b.life > 0 && b.mesh.position.y <= 0) {  // 바다에 맞음
          splash(b.mesh.position, 3);
          b.life = 0;
        }
        if (b.life <= 0) { b.alive = false; b.mesh.visible = false; }
      }

      // 폭탄 떨어뜨리기
      bombTimer -= dt;
      if (ctl.takeBomb() && bombTimer <= 0 && api.bombEnabled) {
        const b = bombs.find(x => !x.alive);
        if (b) {
          bombTimer = BOMB_COOLDOWN;
          b.alive = true;
          b.mesh.visible = true;
          b.mesh.position.set(0, -1.2, 0).applyMatrix4(player.mesh.matrixWorld);
          b.vel.copy(player.velocity);
          api.events.push('bomb');
        }
      }
      // 조준 고리 위치: 떨어지는 시간 t를 구해서 (높이 = 처음높이 + 위아래속도·t − ½·중력·t²) 그만큼 앞으로
      const y0 = player.position.y - 1.2, vy = player.velocity.y;
      const tFall = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * y0)) / GRAVITY;
      ring.position.set(player.position.x + player.velocity.x * tFall, 0.6, player.position.z + player.velocity.z * tFall);
      ring.visible = api.bombEnabled && player.mesh.visible && y0 < 700;
      ring.material.opacity = api.bombReady() ? 0.85 : 0.3;
      // 고리가 배 위에 있으면 초록색 = "지금 폭탄을 놓으면 맞아요"
      // 배는 폭탄이 떨어지는 동안에도 앞으로 가므로, '떨어질 때 배가 있을 자리'와 비교
      const over = ring.visible && targets.some(t => t.targetable && t.inside &&
        t.inside(tmp.set(ring.position.x - t.velocity.x * tFall, 1, ring.position.z - t.velocity.z * tFall), 3));
      ring.material.color.setHex(over ? 0x6dff7a : 0xffe08a);
      api.ringOverShip = over;
      const rs = 0.6 + y0 / 300; // 높이 날수록 고리를 키워 멀리서도 보이게
      ring.scale.set(rs, rs, rs);

      for (const b of bombs) {
        if (!b.alive) continue;
        b.vel.y -= GRAVITY * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        b.mesh.lookAt(tmp.copy(b.mesh.position).sub(b.vel)); // 날아가는 방향으로 머리를 향하게
        const ship = targets.find(t => t.targetable && t.bombTest && t.bombTest(b.mesh.position));
        if (ship) {                                    // 배에 명중!
          ship.hit(1, b.mesh.position, 'bomb');
          b.alive = false; b.mesh.visible = false;
          api.events.push('bombShip');
        } else if (b.mesh.position.y <= 0) {
          splash(b.mesh.position, 26);
          b.alive = false; b.mesh.visible = false;
          api.events.push('bombHit');
        }
      }

      // 물보라: 위로 솟았다가 사라짐
      for (const sp of splashes) {
        if (!sp.alive) continue;
        sp.t += dt;
        const k = sp.t / sp.dur;
        if (k >= 1) { sp.alive = false; sp.s.visible = false; continue; }
        const h = sp.size * (0.4 + Math.sin(Math.min(k * 1.6, 1) * Math.PI / 2));
        sp.s.scale.set(sp.size * (0.6 + k * 0.6), h, 1);
        sp.s.position.y = h * 0.42;
        sp.s.material.opacity = 1 - k * k;
      }
    },

    // 폭탄이 터지는 위치 등에서 물보라를 직접 만들 때 사용 (스테이지에서 씀)
    splash,

    // 새 스테이지를 시작할 때 날아가던 것을 모두 치움
    reset() {
      for (const b of bullets) { b.alive = false; b.mesh.visible = false; }
      for (const b of bombs) { b.alive = false; b.mesh.visible = false; }
      for (const sp of splashes) { sp.alive = false; sp.s.visible = false; }
      bombTimer = 0; fireTimer = 0; api.lockTarget = null;
    },
  };
  return api;
}

function splashTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = 32 + (Math.random() - 0.5) * 34, y = 40 + Math.random() * 80, r = 6 + Math.random() * 12;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
