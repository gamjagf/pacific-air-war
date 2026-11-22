// 3D 모델 불러오기
// - 모든 모델을 "앞 = -Z, 위 = +Y, 길이 = 정해진 미터" 로 맞춰서 돌려줌 (원본마다 크기·방향이 달라서)
// - 파일이 없거나 불러오기에 실패하면 코드로 만든 대체 모양을 씀
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// yaw: 원본의 앞이 -Z를 보도록 Y축으로 돌릴 각도(도). sink: 배가 물에 잠기는 비율(높이 대비)
const SPECS = {
  player:  { file: 'assets/models/player.glb',  length: 10,  yaw: 180, center: true },
  enemy:   { file: 'assets/models/enemy.glb',   length: 9.2, yaw: 180, center: true },
  carrier: { file: 'assets/models/carrier.glb', length: 180, yaw: 90, sink: 0.18 },
  ship:    { file: 'assets/models/ship.glb',    length: 110, yaw: 0, sink: 0.2 },
};

const TIMEOUT_MS = 20000;

// onProgress(0~1) 로 진행률을 알려 줌. forceFallback=true 면 대체 모양만 사용(시험용)
export async function loadModels({ onProgress = () => {}, forceFallback = false } = {}) {
  const loader = new GLTFLoader();
  const names = Object.keys(SPECS);
  const done = {};
  const progress = Object.fromEntries(names.map(n => [n, 0]));
  const tick = () => onProgress(names.reduce((a, n) => a + progress[n], 0) / names.length);

  await Promise.all(names.map(async name => {
    const spec = SPECS[name];
    let proto, source = 'glb', error = null;
    try {
      if (forceFallback) throw new Error('대체 모양 시험');
      const gltf = await withTimeout(loader.loadAsync(spec.file, e => {
        if (e.total) { progress[name] = e.loaded / e.total; tick(); }
      }), TIMEOUT_MS);
      proto = normalize(gltf.scene, spec);
    } catch (e) {
      error = e.message || String(e);
      source = 'fallback';
      proto = normalize(FALLBACK[name](), { ...spec, yaw: 0 }); // 대체 모양은 처음부터 앞 = -Z
    }
    progress[name] = 1; tick();
    done[name] = { proto, source, error };
  }));

  return {
    info: Object.fromEntries(names.map(n => [n, { source: done[n].source, error: done[n].error }])),
    // 같은 모양·재질을 함께 쓰는 복사본 (적기 여러 대도 가볍게)
    make(name) { return done[name].proto.clone(); },
  };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과')), ms))]);
}

// 원본 모델을 감싸서 방향·크기·위치를 맞춤
function normalize(obj, spec) {
  const inner = new THREE.Group();
  inner.add(obj);
  inner.rotation.y = THREE.MathUtils.degToRad(spec.yaw);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const s = spec.length / size.z;
  inner.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  if (spec.center) {
    inner.position.set(-c.x, -c.y, -c.z);
  } else {
    // 배: 바닥에서 높이의 sink 만큼 물에 잠기게
    inner.position.set(-c.x, -box.min.y * s - size.y * s * spec.sink, -c.z);
  }
  obj.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = true;
      const m = o.material;
      if (m && m.map) m.map.anisotropy = 4;
    }
  });
  const root = new THREE.Group();
  root.add(inner);
  root.userData.size = size.multiplyScalar(s);
  return mergeByMaterial(root);
}

// 같은 재질을 쓰는 조각들을 하나로 합침. 폰은 '그리는 횟수'가 많으면 느려지는데,
// 구축함 원본은 조각이 104개라 배 한 척에 104번을 그려야 했음 → 재질 수만큼으로 줄어듦
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const keep = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material) || o.isSkinnedMesh || o.morphTargetInfluences) { keep.push(o); return; }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld); // 조각의 위치·크기·방향을 그대로 굳힘
    const key = o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',');
    if (!groups.has(key)) groups.set(key, { material: o.material, geos: [] });
    groups.get(key).geos.push(g);
  });
  const out = new THREE.Group();
  out.userData = root.userData;
  for (const { material, geos } of groups.values()) {
    // 번호(index)가 있는 것과 없는 것을 섞을 수 없어서, 섞여 있으면 모두 번호 없는 모양으로 바꿈
    const mixed = geos.some(g => g.index) && geos.some(g => !g.index);
    const list = mixed ? geos.map(g => (g.index ? g.toNonIndexed() : g)) : geos;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list);
    if (merged) out.add(new THREE.Mesh(merged, material));
    else for (const g of list) out.add(new THREE.Mesh(g, material)); // 합치기 실패 시 따로따로
  }
  for (const o of keep) { // 합치지 못한 조각은 위치를 굳혀서 그대로 옮김
    o.matrixWorld.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  return out;
}

// ---------- 대체 모양 (모두 앞 = -Z) ----------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.2, ...extra });

function makePlane({ body, wing, mark, markColor }) {
  const g = new THREE.Group();
  const bodyM = std(body), wingM = std(wing);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 8, 10), bodyM);
  fus.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 12), std(0x222222));
  nose.rotation.x = Math.PI / 2; nose.position.z = -4.2;
  const prop = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 0.08), std(0x111111));
  prop.position.z = -4.7;
  const wings = new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 1.9), wingM);
  wings.position.set(0, -0.25, -1);
  const tailH = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1), wingM);
  tailH.position.z = 3.6;
  const tailV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 1.1), wingM);
  tailV.position.set(0, 0.7, 3.6);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    std(0x9fc4d8, { transparent: true, opacity: 0.6, roughness: 0.1 }));
  canopy.scale.z = 1.8; canopy.position.set(0, 0.4, -0.8);
  g.add(fus, nose, prop, wings, tailH, tailV, canopy);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), std(markColor));
    m.rotation.x = -Math.PI / 2; m.position.set(side * 3.8, -0.15, -1);
    g.add(m);
  }
  return g;
}

function makeHull(len, beam, height, color) {
  // 앞쪽이 뾰족한 배 바닥 모양
  const s = new THREE.Shape();
  s.moveTo(0, -len / 2);
  s.quadraticCurveTo(beam / 2, -len * 0.3, beam / 2, 0);
  s.lineTo(beam / 2, len / 2);
  s.lineTo(-beam / 2, len / 2);
  s.lineTo(-beam / 2, 0);
  s.quadraticCurveTo(-beam / 2, -len * 0.3, 0, -len / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height, 0);
  return new THREE.Mesh(geo, std(color, { metalness: 0.3 }));
}

const FALLBACK = {
  player: () => makePlane({ body: 0x34506b, wing: 0x3d5c7a, mark: 'star', markColor: 0xffffff }),
  enemy: () => makePlane({ body: 0x55623a, wing: 0x5f6d40, mark: 'circle', markColor: 0xb3261e }),
  carrier: () => {
    const g = new THREE.Group();
    g.add(makeHull(180, 24, 14, 0x4a5358));
    const deck = new THREE.Mesh(new THREE.BoxGeometry(28, 1, 176), std(0x7a6a52));
    deck.position.y = 14.5;
    const island = new THREE.Mesh(new THREE.BoxGeometry(5, 12, 22), std(0x4a5358));
    island.position.set(11, 21, 10);
    g.add(deck, island);
    return g;
  },
  ship: () => {
    const g = new THREE.Group();
    g.add(makeHull(110, 11, 8, 0x50595e));
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 12), std(0x5c666b));
    bridge.position.set(0, 11, -14);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 7, 10), std(0x3c4245));
    stack.position.set(0, 12, 6);
    g.add(bridge, stack);
    for (const z of [-36, 34]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 5), std(0x5c666b));
      t.position.set(0, 9, z);
      g.add(t);
    }
    return g;
  },
};
