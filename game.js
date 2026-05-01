import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─────────────────────────────────────────────
//  Shaders
// ─────────────────────────────────────────────

const VERT_SHADER = /* glsl */`
  uniform float uHeightScale;
  uniform sampler2D uHeightMap;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vUv = uv;
    float h = texture2D(uHeightMap, uv).r;
    vHeight = h;
    vec3 pos = position;
    pos.z += h * uHeightScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG_SHADER = /* glsl */`
  uniform int   uMaxIter;
  uniform float uCx;
  uniform float uCy;
  uniform float uZoom;
  uniform int   uColorMode;
  uniform float uTime;
  varying vec2  vUv;
  varying float vHeight;

  // ── palette helpers ──
  vec3 neon(float t) {
    t = fract(t + uTime * 0.05);
    float r = 0.5 + 0.5 * cos(6.2832 * (t + 0.0));
    float g = 0.5 + 0.5 * cos(6.2832 * (t + 0.33));
    float b = 0.5 + 0.5 * cos(6.2832 * (t + 0.67));
    return vec3(r, g, b);
  }

  vec3 fire(float t) {
    t = fract(t + uTime * 0.05);
    return vec3(
      min(1.0, t * 3.0),
      max(0.0, t * 2.0 - 0.5),
      max(0.0, t * 3.0 - 2.0)
    );
  }

  vec3 ice(float t) {
    t = fract(t + uTime * 0.05);
    return vec3(t * 0.3, t * 0.7, min(1.0, t * 1.5));
  }

  vec3 gold(float t) {
    t = fract(t + uTime * 0.05);
    return vec3(
      min(1.0, t * 1.8),
      min(1.0, t * 1.4),
      t * 0.4
    );
  }

  vec3 psychedelic(float t) {
    t = fract(t + uTime * 0.12);
    float r = 0.5 + 0.5 * sin(t * 12.566 + 0.0);
    float g = 0.5 + 0.5 * sin(t * 12.566 + 2.094);
    float b = 0.5 + 0.5 * sin(t * 12.566 + 4.189);
    return vec3(r, g, b);
  }

  vec3 palette(float t) {
    if (uColorMode == 1) return fire(t);
    if (uColorMode == 2) return ice(t);
    if (uColorMode == 3) return gold(t);
    if (uColorMode == 4) return psychedelic(t);
    return neon(t);
  }

  // ── Mandelbrot iteration (smooth) ──
  float mandelbrot(vec2 c) {
    vec2 z = vec2(0.0);
    float n = 0.0;
    for (int i = 0; i < 512; i++) {
      if (i >= uMaxIter) break;
      z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
      if (dot(z, z) > 4.0) {
        // smooth colouring
        n = float(i) - log2(log2(dot(z,z))) + 4.0;
        return n / float(uMaxIter);
      }
    }
    return 0.0; // interior
  }

  void main() {
    // map UV to complex plane
    float aspect = 1.0; // plane is square in shader coords
    float hw = 2.0 / uZoom;
    vec2 c = vec2(
      uCx + (vUv.x - 0.5) * hw * 2.0,
      uCy + (vUv.y - 0.5) * hw * 2.0
    );

    float t = mandelbrot(c);

    if (t == 0.0) {
      // inside the set – near black with subtle glow
      float glow = vHeight * 0.15;
      gl_FragColor = vec4(vec3(glow), 1.0);
    } else {
      vec3 col = palette(t);
      // edge highlight from height
      col += vec3(vHeight * 0.25);
      col = clamp(col, 0.0, 1.0);
      gl_FragColor = vec4(col, 1.0);
    }
  }
`;

// Heightmap generation shader (renders to a RenderTarget)
const HM_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HM_FRAG = /* glsl */`
  uniform int   uMaxIter;
  uniform float uCx;
  uniform float uCy;
  uniform float uZoom;
  varying vec2  vUv;

  float mandelbrot(vec2 c) {
    vec2 z = vec2(0.0);
    for (int i = 0; i < 512; i++) {
      if (i >= uMaxIter) break;
      z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
      if (dot(z,z) > 4.0) {
        float n = float(i) - log2(log2(dot(z,z))) + 4.0;
        return n / float(uMaxIter);
      }
    }
    return 0.0;
  }

  void main() {
    float hw = 2.0 / uZoom;
    vec2 c = vec2(
      uCx + (vUv.x - 0.5) * hw * 2.0,
      uCy + (vUv.y - 0.5) * hw * 2.0
    );
    float h = mandelbrot(c);
    gl_FragColor = vec4(h, h, h, 1.0);
  }
`;

// ─────────────────────────────────────────────
//  Game State
// ─────────────────────────────────────────────

const state = {
  cx: -0.5,
  cy: 0.0,
  zoom: 1.0,
  maxIter: 128,
  heightScale: 40,
  colorMode: 0,
  animateColors: false,
  score: 0,
  depth: 0,
  time: 0,
};

const MILESTONES = [
  { zoom: 10,    label: '🔭 Deep Diver',        pts: 100 },
  { zoom: 100,   label: '🌀 Spiral Hunter',      pts: 250 },
  { zoom: 1000,  label: '⚡ Fractal Chaser',     pts: 500 },
  { zoom: 10000, label: '🚀 Infinity Explorer',  pts: 1000 },
  { zoom: 1e6,   label: '🌌 Mandelbrot Master',  pts: 5000 },
];

const achieved = new Set();

// ─────────────────────────────────────────────
//  Three.js Setup
// ─────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -3.5, 3.5);
camera.lookAt(0, 0, 0);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.5;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.9;

// ── Heightmap render target ──
const HM_SIZE = 512;
const hmTarget = new THREE.WebGLRenderTarget(HM_SIZE, HM_SIZE, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
});

const hmScene = new THREE.Scene();
const hmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const hmGeo = new THREE.PlaneGeometry(2, 2);
const hmMat = new THREE.ShaderMaterial({
  vertexShader: HM_VERT,
  fragmentShader: HM_FRAG,
  uniforms: {
    uMaxIter: { value: state.maxIter },
    uCx:      { value: state.cx },
    uCy:      { value: state.cy },
    uZoom:    { value: state.zoom },
  },
});
hmScene.add(new THREE.Mesh(hmGeo, hmMat));

// ── Main fractal plane ──
const PLANE_SEGS = 256;
const planeGeo = new THREE.PlaneGeometry(4, 4, PLANE_SEGS, PLANE_SEGS);
// Rotate to horizontal, then tilt
planeGeo.rotateX(-Math.PI / 2);

const planeMat = new THREE.ShaderMaterial({
  vertexShader:   VERT_SHADER,
  fragmentShader: FRAG_SHADER,
  uniforms: {
    uHeightScale: { value: state.heightScale * 0.01 },
    uHeightMap:   { value: hmTarget.texture },
    uMaxIter:     { value: state.maxIter },
    uCx:          { value: state.cx },
    uCy:          { value: state.cy },
    uZoom:        { value: state.zoom },
    uColorMode:   { value: state.colorMode },
    uTime:        { value: 0.0 },
  },
  side: THREE.DoubleSide,
});

const planeMesh = new THREE.Mesh(planeGeo, planeMat);
scene.add(planeMesh);

// Subtle grid of particle stars for ambience
const starGeo = new THREE.BufferGeometry();
const starCount = 1200;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  starPos[i * 3]     = (Math.random() - 0.5) * 40;
  starPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
  starPos[i * 3 + 2] = (Math.random() - 0.5) * 40;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0x88aaff, size: 0.04, transparent: true, opacity: 0.6 });
scene.add(new THREE.Points(starGeo, starMat));

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function syncUniforms() {
  const u = planeMat.uniforms;
  u.uMaxIter.value     = state.maxIter;
  u.uCx.value          = state.cx;
  u.uCy.value          = state.cy;
  u.uZoom.value        = state.zoom;
  u.uColorMode.value   = state.colorMode;
  u.uHeightScale.value = state.heightScale * 0.01;

  hmMat.uniforms.uMaxIter.value = state.maxIter;
  hmMat.uniforms.uCx.value      = state.cx;
  hmMat.uniforms.uCy.value      = state.cy;
  hmMat.uniforms.uZoom.value    = state.zoom;
}

function rebakeHeightmap() {
  renderer.setRenderTarget(hmTarget);
  renderer.render(hmScene, hmCam);
  renderer.setRenderTarget(null);
}

function updateHUD() {
  document.getElementById('depth-display').textContent = state.depth;
  document.getElementById('score-display').textContent = state.score.toLocaleString();
  document.getElementById('cx-display').textContent = `Re: ${state.cx.toFixed(6)}`;
  document.getElementById('cy-display').textContent = `Im: ${state.cy.toFixed(6)}`;

  const z = state.zoom;
  let zStr;
  if (z >= 1e6)      zStr = (z / 1e6).toFixed(1) + 'M×';
  else if (z >= 1e3) zStr = (z / 1e3).toFixed(1) + 'K×';
  else               zStr = z.toFixed(1) + '×';
  document.getElementById('zoom-display').textContent = zStr;
}

function checkMilestones() {
  for (const m of MILESTONES) {
    if (!achieved.has(m.zoom) && state.zoom >= m.zoom) {
      achieved.add(m.zoom);
      state.score += m.pts;
      showTrophy(`${m.label}  +${m.pts} pts`);
    }
  }
}

let trophyTimer = null;
function showTrophy(text) {
  const el = document.getElementById('trophy');
  el.classList.remove('hidden');
  document.getElementById('trophy-text').textContent = text;
  // force reflow
  void el.offsetWidth;
  el.classList.add('show');
  if (trophyTimer) clearTimeout(trophyTimer);
  trophyTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 320);
  }, 2500);
}

// ─────────────────────────────────────────────
//  Zoom into a point on the fractal plane
// ─────────────────────────────────────────────

function zoomToPoint(screenX, screenY, zoomFactor) {
  // Raycast to find the plane hit point
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((screenX - rect.left) / rect.width)  * 2 - 1;
  const ndcY = -((screenY - rect.top)  / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hits = raycaster.intersectObject(planeMesh);

  if (hits.length > 0) {
    const uv = hits[0].uv;
    if (uv) {
      const hw = 2.0 / state.zoom;
      state.cx = state.cx + (uv.x - 0.5) * hw * 2.0;
      state.cy = state.cy + (uv.y - 0.5) * hw * 2.0;
    }
  }

  state.zoom *= zoomFactor;
  state.depth = Math.floor(Math.log2(state.zoom));
  state.score += Math.floor(state.depth * 2);
  checkMilestones();
  syncUniforms();
  rebakeHeightmap();
  updateHUD();
}

// ─────────────────────────────────────────────
//  Input Handling
// ─────────────────────────────────────────────

// Double-click → zoom in ×4
let lastClickTime = 0;
canvas.addEventListener('dblclick', (e) => {
  zoomToPoint(e.clientX, e.clientY, 4);
});

// Mouse wheel → zoom fractal (not camera)
canvas.addEventListener('wheel', (e) => {
  if (e.ctrlKey) return; // let OrbitControls handle pinch-zoom on desktop
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.5 : 1 / 1.5;
  state.zoom = Math.max(0.5, state.zoom * factor);
  state.depth = Math.floor(Math.log2(state.zoom));
  if (factor > 1) {
    state.score += 1;
    checkMilestones();
  }
  syncUniforms();
  rebakeHeightmap();
  updateHUD();
}, { passive: false });

// Touch: double-tap → zoom in ×4, pinch → zoom fractal
let lastTapTime = 0;
let lastPinchDist = null;

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const now = Date.now();
    if (now - lastTapTime < 300) {
      zoomToPoint(e.touches[0].clientX, e.touches[0].clientY, 4);
    }
    lastTapTime = now;
    lastPinchDist = null;
  }
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastPinchDist = Math.hypot(dx, dy);
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && lastPinchDist !== null) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const factor = dist / lastPinchDist;
    lastPinchDist = dist;
    state.zoom = Math.max(0.5, state.zoom * factor);
    state.depth = Math.floor(Math.log2(state.zoom));
    checkMilestones();
    syncUniforms();
    rebakeHeightmap();
    updateHUD();
  }
}, { passive: false });

// ─────────────────────────────────────────────
//  UI Controls
// ─────────────────────────────────────────────

const iterSlider = document.getElementById('iter-slider');
const iterVal    = document.getElementById('iter-val');
iterSlider.addEventListener('input', () => {
  state.maxIter = parseInt(iterSlider.value);
  iterVal.textContent = state.maxIter;
  syncUniforms();
  rebakeHeightmap();
});

const heightSlider = document.getElementById('height-slider');
const heightVal    = document.getElementById('height-val');
heightSlider.addEventListener('input', () => {
  state.heightScale = parseInt(heightSlider.value);
  heightVal.textContent = state.heightScale;
  syncUniforms();
});

document.getElementById('color-mode').addEventListener('change', (e) => {
  state.colorMode = parseInt(e.target.value);
  syncUniforms();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  state.cx    = -0.5;
  state.cy    = 0.0;
  state.zoom  = 1.0;
  state.depth = 0;
  syncUniforms();
  rebakeHeightmap();
  updateHUD();
  camera.position.set(0, -3.5, 3.5);
  camera.lookAt(0, 0, 0);
  controls.reset();
});

const animBtn = document.getElementById('animate-btn');
animBtn.addEventListener('click', () => {
  state.animateColors = !state.animateColors;
  animBtn.classList.toggle('active', state.animateColors);
  animBtn.textContent = state.animateColors ? 'Stop Anim' : 'Animate Colors';
});

// ─────────────────────────────────────────────
//  Resize
// ─────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────
//  Render Loop
// ─────────────────────────────────────────────

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  state.time += delta;

  if (state.animateColors) {
    planeMat.uniforms.uTime.value = state.time;
  }

  controls.update();
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────

syncUniforms();
rebakeHeightmap();
updateHUD();
animate();
