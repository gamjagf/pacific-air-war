// 일본 함대: 항공모함·구축함. 대공포(하늘에서 터지는 검은 포탄 연기)를 쏘고, 폭탄에 맞으면 불타다 가라앉음
// 배는 크고 길어서 총알·폭탄 판정을 '공'이 아니라 배 모양 상자(앞뒤로 긴 네모)로 함
import * as THREE from 'three';

// 종류별 성질. hp는 폭탄 한 발 = 30, 기관총 한 발 = 1 × gunMul
export const SHIP_TYPES = {
  carrier:   { name: '항공모함', model: 'carrier', hp: 90,  gunMul: 0.25, score: 1000, aaRate: 3.0, aaRange: 1100, speed: 5 },
  destroyer: { name: '구축함',   model: 'ship',    hp: 60,  gunMul: 1,    score: 300,  aaRate: 2.0, aaRange: 1000, speed: 7 },
  // 보스: 1.35배 크고, 폭탄 6발을 맞아야 가라앉고, 대공포를 한 번에 2발씩 더 자주 쏨
  boss:      { name: '보스 항공모함', model: 'carrier', hp: 180, gunMul: 0.2, score: 3000, aaRate: 2.2, aaRange: 1250, speed: 4, scale: 1.35, flakCount: 2 },
};
const BOMB_DMG = 30;
const FLAK_SPEED = 330;         // 대공포탄이 올라오는 빠르기 (도착까지 걸리는 시간 계산용)
const FLAK_RADIUS = 26;         // 이 거리 안에서 터지면 피해
const FLAK_DMG = 6;             // 바로 옆에서 터질 때 피해 (멀수록 줄어듦)
const FLAK_ERROR = 55;          // 조준 오차(m). 방향을 바꾸며 날면 더 많이 빗나감

export function createFleet(ctx) {
  const { scene, models, effects, weapons } = ctx;
  const ships = [];
  const flaks = [];              // 날아가는 중인 대공포탄 {pos, t}
  const tmp = new THREE.Vector3(), loc = new THREE.Vector3(), aim = new THREE.Vector3();

  function add(type, x, z, yaw = 0) {
    const T = SHIP_TYPES[type];
    const mesh = models.make(T.model);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw;
    const scale = T.scale || 1;
    mesh.scale.setScalar(scale);
    scene.add(mesh);
    const size = mesh.userData.size; // 배 자신의 단위(크기 배율 적용 전)
    const top = size.y * 0.82;      // 물 위로 나온 높이(대략, 배 자신의 단위)
    const topW = top * scale;       // 실제 세상에서의 높이
    const s = {
      type, mesh, position: mesh.position, velocity: new THREE.Vector3(),
      hp: T.hp, maxHp: T.hp, radius: Math.max(size.x, size.z) * scale / 2, name: T.name,
      targetable: true, sinking: 0, aaT: 1.5 + Math.random() * 1.5, smokeT: 0, phase: Math.random() * 6,
      // 이 점이 배 상자 안인가? (margin: 넉넉하게 봐주는 거리)
      inside(p, margin = 0) {
        loc.copy(p);
        mesh.worldToLocal(loc);
        return Math.abs(loc.x) < size.x / 2 + margin && Math.abs(loc.z) < size.z / 2 + margin && loc.y < top + margin;
      },
      // 기관총: 이번 장면에 총알이 도착한 점이 배 안이면 명중
      testSeg(a, b) { return b.y < topW + 2 && s.inside(b, 2); },
      // 폭탄: 갑판 높이까지 내려왔을 때 배 위면 명중 (아이들 위해 7m 봐줌)
      bombTest(p) { return p.y < topW && s.inside(p, 7); },
      hit(dmg, point, kind) {
        if (!s.targetable) return;
        s.hp -= kind === 'bomb' ? BOMB_DMG : dmg * T.gunMul;
        if (kind === 'bomb') effects.explode(point, 1.1); else effects.spark(point);
        // 폭탄이 떨어질 땐 비행기가 이미 배 위를 지나가서 폭발이 화면 밖일 때가 많음 → 글자로 알려 줌
        if (kind === 'bomb') {
          const name = T.name;
          ctx.ui.banner(s.hp <= 0 ? `${name} 격침!` : '명중!', s.hp <= 0 ? `+${T.score}점` : `${name}에 폭탄 명중`, 1600);
        }
        if (s.hp <= 0) {
          s.hp = 0;
          s.targetable = false;
          s.sinking = 0.001;
          effects.explode(tmp.copy(s.position).setY(topW), 2 * scale);
          ctx.addScore(T.score);
          ctx.onSink?.(s);
        }
      },
    };
    ships.push(s);
    return s;
  }

  const api = {
    ships,
    add,
    update(dt, t) {
      const p = ctx.player;
      for (let i = ships.length - 1; i >= 0; i--) {
        const s = ships[i], T = SHIP_TYPES[s.type], size = s.mesh.userData.size;

        if (s.sinking > 0) {
          // 가라앉기: 기울어지며 내려가고, 처음 2초 동안 여기저기서 폭발
          s.sinking += dt;
          s.mesh.position.y -= dt * (1.5 + s.sinking);
          s.mesh.rotation.z += dt * 0.05;
          s.mesh.rotation.x += dt * 0.02;
          if (s.sinking < 2.4 && (s.smokeT -= dt) <= 0) {
            s.smokeT = 0.35;
            tmp.set((Math.random() - 0.5) * size.x, size.y * 0.5, (Math.random() - 0.5) * size.z);
            effects.explode(s.mesh.localToWorld(tmp), 1);
          }
          if (s.sinking > 7) { scene.remove(s.mesh); ships.splice(i, 1); }
          continue;
        }

        // 천천히 앞으로 가며 물결에 살짝 흔들림
        s.velocity.set(-Math.sin(s.mesh.rotation.y), 0, -Math.cos(s.mesh.rotation.y)).multiplyScalar(T.speed);
        s.position.addScaledVector(s.velocity, dt);
        s.mesh.rotation.z = Math.sin(t * 0.5 + s.phase) * 0.012;
        s.mesh.rotation.x = Math.sin(t * 0.37 + s.phase * 2) * 0.008;

        // 다쳤으면 연기
        if (s.hp < s.maxHp && (s.smokeT -= dt) <= 0) {
          s.smokeT = s.hp < s.maxHp * 0.5 ? 0.12 : 0.25;
          tmp.set((Math.random() - 0.5) * size.x * 0.4, size.y * 0.7, (Math.random() - 0.5) * size.z * 0.5);
          effects.smoke(s.mesh.localToWorld(tmp), 2.2, 0.15);
        }

        // 대공포: 내 비행기가 가까우면 내가 '갈 곳'을 노리고 쏨
        s.aaT -= dt;
        const dist = s.position.distanceTo(p.position);
        if (s.aaT <= 0 && dist < T.aaRange && ctx.canBeHit()) {
          s.aaT = T.aaRate * (0.8 + Math.random() * 0.4);
          for (let k = 0; k < (T.flakCount || 1); k++) {
            const fly = dist / FLAK_SPEED + k * 0.25;  // 여러 발이면 조금씩 늦게 터짐
            // 0.6초 더 앞을 노려서 터지는 연기가 내 앞(화면 안)에 보이게 함
            aim.copy(p.position).addScaledVector(p.velocity, fly + 0.6);
            aim.x += (Math.random() - 0.5) * 2 * FLAK_ERROR;
            aim.y += (Math.random() - 0.5) * 2 * FLAK_ERROR * 0.6;
            aim.z += (Math.random() - 0.5) * 2 * FLAK_ERROR;
            aim.y = Math.max(aim.y, 30);
            flaks.push({ pos: aim.clone(), t: fly });
          }
        }
      }

      // 대공포탄 터지기
      for (let i = flaks.length - 1; i >= 0; i--) {
        const f = flaks[i];
        if ((f.t -= dt) > 0) continue;
        flaks.splice(i, 1);
        effects.flak(f.pos);
        const d = f.pos.distanceTo(p.position);
        if (d < 700) ctx.sfx?.('explosion_small', (1 - d / 700) * 0.5, 0.7); // 가까울수록 크게, 낮은 소리
        if (d < FLAK_RADIUS) ctx.damagePlayer(Math.round(2 + FLAK_DMG * (1 - d / FLAK_RADIUS)));
      }
    },
    dispose() {
      for (const s of ships) scene.remove(s.mesh);
      ships.length = 0;
      flaks.length = 0;
    },
  };
  return api;
}
