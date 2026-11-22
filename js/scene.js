// 3D 세상: 렌더러, 하늘, 바다, 조명, 구름, 안개
// 폰 속도가 우선이라 그림자·반사 렌더링(두 번 그리기)은 쓰지 않고, 셰이더 계산으로 분위기를 냄
import * as THREE from 'three';

// 하늘·바다·안개가 같은 색을 쓰게 한 곳에 모음 (지평선이 자연스럽게 이어짐)
export const PALETTE = {
  horizon: new THREE.Color(0xb7cbd9),  // 지평선 = 안개 색
  zenith: new THREE.Color(0x2f6ea8),   // 머리 위 하늘
  sun: new THREE.Color(0xfff1d6),
  deep: new THREE.Color(0x06263d),     // 깊은 바다
  shallow: new THREE.Color(0x0f5a6e),  // 물결 꼭대기
};
export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
export const FOG_DENSITY = 0.00042;   // 약 2.5km 앞부터 거의 안개에 묻힘

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // 폰의 3배 화소는 너무 무거움
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PALETTE.horizon, FOG_DENSITY);
  scene.background = PALETTE.horizon;

  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 7000);

  // 조명: 하늘빛(위는 파랗게, 아래는 바다색) + 햇빛
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x24465a, 1.15));
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);

  const sky = makeSky();
  const ocean = makeOcean();
  const clouds = makeClouds();
  scene.add(sky, ocean.mesh, clouds.group);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 세로 화면(폰)에서는 옆이 너무 좁아 보이지 않게 화각을 넓힘
    camera.fov = w < h ? 75 : 62;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // 매 장면마다: 하늘·바다·구름을 카메라 주변으로 옮기고 물결 시간을 흘림
  function update(time) {
    sky.position.copy(camera.position);
    ocean.update(time, camera);
    clouds.update(camera);
  }

  return { renderer, scene, camera, update };
}

// ---------- 하늘: 지평선→머리 위 색 변화 + 해와 햇무리 ----------
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uHorizon: { value: PALETTE.horizon }, uZenith: { value: PALETTE.zenith },
      uSun: { value: PALETTE.sun }, uSunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // 항상 가장 먼 곳에 그림
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHorizon, uZenith, uSun, uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
        // 지평선 아래는 안개 색 그대로 (바다 끝과 이어짐)
        col = mix(uHorizon, col, smoothstep(-0.02, 0.06, d.y));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

// ---------- 바다: 여러 물결을 겹쳐 표면 기울기를 계산, 하늘 반사 + 햇빛 반짝임 ----------
function makeOcean() {
  const size = 14000;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR }, uSun: { value: PALETTE.sun },
      uDeep: { value: PALETTE.deep }, uShallow: { value: PALETTE.shallow },
      uHorizon: { value: PALETTE.horizon }, uZenith: { value: PALETTE.zenith },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFogDensity;
      uniform vec3 uSunDir, uSun, uDeep, uShallow, uHorizon, uZenith;
      varying vec3 vWorld;

      // 방향·크기·속도가 다른 물결 하나의 높이 기울기
      void wave(vec2 p, vec2 dir, float len, float amp, float spd, inout vec2 g, inout float h) {
        float k = 6.2832 / len;
        float ph = dot(normalize(dir), p) * k + uTime * spd;
        h += amp * sin(ph);
        g += normalize(dir) * (amp * k * cos(ph));
      }

      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;
        vec2 g = vec2(0.0); float h = 0.0;
        // 큰 너울 → 잔물결 순서. 멀수록 잔물결을 줄여 반짝임 깨짐(계단 현상)을 막음
        float far = clamp(dist / 1800.0, 0.0, 1.0);
        wave(p, vec2( 1.0, 0.35), 140.0, 1.6, 0.55, g, h);
        wave(p, vec2( 0.6,-1.0),  90.0, 0.9, 0.75, g, h);
        vec2 gm = vec2(0.0);
        wave(p, vec2(-0.8, 0.5),  55.0, 0.5, 1.00, gm, h);
        g = g * (1.0 - far * 0.7) + gm * (1.0 - smoothstep(300.0, 1200.0, dist));
        float fine = 1.0 - smoothstep(60.0, 420.0, dist);
        vec2 g2 = vec2(0.0); float h2 = 0.0;
        wave(p, vec2( 0.2, 1.0),  21.0, 0.16, 1.7, g2, h2);
        wave(p, vec2(-1.0,-0.3),  13.0, 0.09, 2.1, g2, h2);
        wave(p, vec2( 0.9,-0.8),   7.0, 0.04, 2.9, g2, h2);
        g += g2 * fine;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 skyCol = mix(uHorizon, uZenith, pow(R.y, 0.45));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 water = mix(uDeep, uShallow, clamp(h * 0.25 + 0.35, 0.0, 1.0) * 0.6);
        vec3 col = mix(water, skyCol, clamp(fres, 0.0, 1.0));
        float spec = pow(max(dot(R, uSunDir), 0.0), mix(500.0, 120.0, far));
        col += uSun * spec * mix(4.0, 1.5, far);

        float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        col = mix(col, uHorizon, f);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(time, camera) {
      mat.uniforms.uTime.value = time;
      // 바다판은 카메라를 따라오지만, 물결은 '세상 좌표'로 계산해서 미끄러져 보이지 않음
      mesh.position.set(camera.position.x, 0, camera.position.z);
    },
  };
}

// ---------- 구름: 부드러운 솜 그림을 붙인 판(스프라이트) 여러 개 ----------
function makeClouds() {
  const tex = cloudTexture();
  const group = new THREE.Group();
  const span = 5000;               // 카메라 주변 5km 안에서 반복 배치
  const items = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true,
      color: new THREE.Color().setScalar(0.92 + rnd() * 0.08), opacity: 0.75 + rnd() * 0.2 });
    const s = new THREE.Sprite(mat);
    const w = 260 + rnd() * 420;
    s.scale.set(w, w * (0.42 + rnd() * 0.2), 1);
    const base = new THREE.Vector3((rnd() - 0.5) * span, 380 + rnd() * 520, (rnd() - 0.5) * span);
    items.push({ s, base });
    group.add(s);
  }
  const half = span / 2;
  const wrap = (v, c) => v - Math.round((v - c) / span) * span;
  return {
    group,
    update(camera) {
      for (const { s, base } of items) {
        s.position.set(wrap(base.x, camera.position.x), base.y, wrap(base.z, camera.position.z));
      }
    },
  };
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = 50 + rnd() * 156, y = 56 + (rnd() - 0.5) * 34, r = 18 + rnd() * 34;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
