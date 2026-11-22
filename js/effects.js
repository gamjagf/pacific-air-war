// 폭발·불꽃·연기 효과 (사람·피 표현 없이 폭발만)
// 미리 만들어 둔 스프라이트(항상 카메라를 보는 그림판)를 돌려 씀 → 폰에서 끊김 없이
import * as THREE from 'three';

export function createEffects(scene) {
  const fire = makePool(scene, 40, fireTexture(), true);
  const smoke = makePool(scene, 90, smokeTexture(), false);
  const rnd = () => Math.random() - 0.5;
  const at = new THREE.Vector3(), vel = new THREE.Vector3();

  function emit(pool, pos, o) {
    const p = pool[pool.i = (pool.i + 1) % pool.length];
    p.alive = true; p.t = 0; p.dur = o.dur; p.s0 = o.s0; p.s1 = o.s1; p.a0 = o.a;
    p.vel.copy(o.vel || ZERO);
    p.s.position.copy(pos);
    p.s.material.rotation = Math.random() * Math.PI * 2;
    p.s.material.color.setScalar(o.shade ?? 1);
    p.s.scale.setScalar(o.s0);
    p.s.visible = true;
  }

  const api = {
    // 큰 폭발: 가운데 불덩이 + 작은 불꽃 + 검은 연기
    explode(pos, size = 1) {
      emit(fire, pos, { dur: 0.55, s0: 6 * size, s1: 26 * size, a: 1 });
      for (let i = 0; i < 5; i++) {
        at.set(rnd(), rnd(), rnd()).multiplyScalar(10 * size).add(pos);
        emit(fire, at, { dur: 0.35 + Math.random() * 0.4, s0: 4 * size, s1: 14 * size, a: 0.9 });
      }
      for (let i = 0; i < 6; i++) {
        at.set(rnd(), rnd(), rnd()).multiplyScalar(12 * size).add(pos);
        vel.set(rnd() * 6, 3 + Math.random() * 3, rnd() * 6);
        emit(smoke, at, { dur: 2.2 + Math.random() * 0.8, s0: 6 * size, s1: 28 * size, a: 0.75, shade: 0.2 + Math.random() * 0.15, vel });
      }
    },
    // 총알이 맞은 자리의 작은 불꽃
    spark(pos) { emit(fire, pos, { dur: 0.18, s0: 2, s1: 6, a: 1 }); },
    // 대공포탄이 하늘에서 터짐: 번쩍 + 검은 연기 덩이
    flak(pos) {
      emit(fire, pos, { dur: 0.25, s0: 5, s1: 14, a: 1 });
      vel.set(0, 1, 0);
      emit(smoke, pos, { dur: 2.2, s0: 8, s1: 20, a: 0.85, shade: 0.1, vel });
    },
    // 꼬리 연기 한 덩이
    smoke(pos, size = 1, shade = 0.3) {
      vel.set(0, 2, 0);
      emit(smoke, pos, { dur: 1.6, s0: 3 * size, s1: 10 * size, a: 0.7, shade, vel });
    },

    update(dt) {
      for (const pool of [fire, smoke]) {
        const isFire = pool === fire;
        for (const p of pool) {
          if (!p.alive) continue;
          p.t += dt;
          const k = p.t / p.dur;
          if (k >= 1) { p.alive = false; p.s.visible = false; continue; }
          const grow = 1 - (1 - k) * (1 - k); // 처음엔 빨리, 나중엔 천천히 커짐
          p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * grow);
          p.s.position.addScaledVector(p.vel, dt);
          p.s.material.opacity = p.a0 * (isFire ? 1 - k * k : 1 - k);
        }
      }
    },
    reset() {
      for (const pool of [fire, smoke]) for (const p of pool) { p.alive = false; p.s.visible = false; }
    },
  };
  return api;
}

const ZERO = new THREE.Vector3();

function makePool(scene, n, map, additive) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({
      map, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: !additive, toneMapped: !additive,
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    s.renderOrder = additive ? 1 : 0;
    scene.add(s);
    pool.push({ s, alive: false, t: 0, dur: 1, s0: 1, s1: 1, a0: 1, vel: new THREE.Vector3() });
  }
  pool.i = 0;
  return pool;
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fireTexture() {
  return canvasTexture(64, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,250,225,1)');
    grd.addColorStop(0.25, 'rgba(255,195,90,0.95)');
    grd.addColorStop(0.6, 'rgba(235,90,20,0.45)');
    grd.addColorStop(1, 'rgba(120,30,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

function smokeTexture() {
  return canvasTexture(64, (g, s) => {
    for (let i = 0; i < 9; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.35, y = s / 2 + (Math.random() - 0.5) * s * 0.35;
      const r = s * (0.18 + Math.random() * 0.16);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
}
