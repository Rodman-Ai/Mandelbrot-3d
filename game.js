import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ─────────────────────────────────────────────────────────────────────────────
//  GLSL – shared fractal kernel (embedded in both shaders)
// ─────────────────────────────────────────────────────────────────────────────

// Smooth escape time.  Returns 0.0 for interior points.
const GLSL_FRACTAL = /* glsl */`
float computeFractal(vec2 uv, float cx, float cy, float zoom,
                     int maxIter, int ftype, vec2 juliaC, float power) {
  float hw  = 2.0 / zoom;
  float re  = cx + (uv.x - 0.5) * hw * 2.0;
  float im  = cy + (uv.y - 0.5) * hw * 2.0;

  float zr, zi, cr, ci;
  if (ftype == 1) { zr=re; zi=im; cr=juliaC.x; ci=juliaC.y; }
  else            { zr=0.0; zi=0.0; cr=re; ci=im; }

  for (int i = 0; i < 512; i++) {
    if (i >= maxIter) break;
    float zr2 = zr*zr, zi2 = zi*zi;
    float mag2 = zr2 + zi2;
    if (mag2 > 256.0)
      return (float(i) - log2(log2(mag2) * 0.5)) / float(maxIter);

    float nr, ni;
    if (ftype == 2) {                           // Burning Ship
      float azr=abs(zr), azi=abs(zi);
      nr=azr*azr-azi*azi+cr; ni=2.0*azr*azi+ci;
    } else if (ftype == 3) {                    // Tricorn
      nr=zr2-zi2+cr; ni=-2.0*zr*zi+ci;
    } else if (ftype == 4) {                    // Newton  z^3-1
      // Newton's method for z^3 - 1 = 0
      float denom = 3.0*(zr2-zi2)*(zr2-zi2) + 4.0*zr2*zi2*3.0;
      if (denom < 1e-6) return 0.0;
      float num_r = 2.0*zr*(zr2-3.0*zi2)*0.333333 + cr*0.333333;
      float num_i = 2.0*zi*(3.0*zr2-zi2)*0.333333 + ci*0.333333;
      // Approximate convergence by step distance
      float dz = (zr-num_r)*(zr-num_r)+(zi-num_i)*(zi-num_i);
      nr=num_r; ni=num_i;
      if (dz < 1e-8) return float(i)/float(maxIter);
    } else if (ftype == 5) {                    // Multibrot  z^p + c
      // Compute z^p in polar form
      float r   = sqrt(zr2 + zi2);
      float ang = atan(zi, zr);
      float rp  = pow(r, power);
      float ap  = ang * power;
      nr = rp*cos(ap)+cr; ni = rp*sin(ap)+ci;
    } else {                                    // Mandelbrot / Julia
      nr=zr2-zi2+cr; ni=2.0*zr*zi+ci;
    }
    zr=nr; zi=ni;
  }
  return 0.0;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  Vertex Shader  – displaces geometry vertically by escape time
// ─────────────────────────────────────────────────────────────────────────────
const VERT_SHADER = /* glsl */`
${GLSL_FRACTAL}

uniform int   uMaxIter;
uniform float uCx, uCy, uZoom;
uniform float uHeightScale;
uniform int   uFractalType;
uniform vec2  uJuliaC;
uniform float uPower;

varying vec2  vUv;
varying float vT;

void main() {
  vUv = uv;
  float t = computeFractal(uv, uCx, uCy, uZoom, uMaxIter, uFractalType, uJuliaC, uPower);
  vT = t;
  vec3 p = position;
  p.y += t * uHeightScale;   // Y is "up" after rotateX(-PI/2)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  Fragment Shader  – color + normal-map lighting + edge glow
// ─────────────────────────────────────────────────────────────────────────────
const FRAG_SHADER = /* glsl */`
${GLSL_FRACTAL}

uniform int   uMaxIter;
uniform float uCx, uCy, uZoom;
uniform int   uFractalType;
uniform vec2  uJuliaC;
uniform float uPower;
uniform int   uColorMode;
uniform float uTime, uColorSpeed, uColorBands;
uniform float uLighting;   // 0–1

varying vec2  vUv;
varying float vT;

// ── cosine palette ──────────────────────────────────────────────────────────
vec3 cospal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return clamp(a + b * cos(6.28318 * (c * t + d)), 0.0, 1.0);
}

vec3 getColor(float t) {
  t = fract(t + uTime * uColorSpeed);
  if (uColorMode == 0) return cospal(t, vec3(.5),       vec3(.5),       vec3(1.,1.,1.),     vec3(0.,.333,.667)); // Neon
  if (uColorMode == 1) return cospal(t, vec3(.5,.2,.1), vec3(.5,.3,.2), vec3(1.,.7,.4),     vec3(0.,.15,.2));    // Fire
  if (uColorMode == 2) return cospal(t, vec3(.5,.5,.7), vec3(.4,.4,.3), vec3(1.,1.,.5),     vec3(.8,.9,.3));     // Ice
  if (uColorMode == 3) return cospal(t, vec3(.5,.4,.1), vec3(.5,.4,.1), vec3(1.,.8,.3),     vec3(0.,.1,.2));     // Gold
  if (uColorMode == 4) return cospal(t, vec3(.5),       vec3(.5),       vec3(2.,1.,.5),     vec3(.5,.2,.25));    // Psychedelic
  if (uColorMode == 5) return cospal(t, vec3(.28,.42,.45),vec3(.32,.28,.22),vec3(.6,.7,1.),vec3(0.,.2,.5));      // Viridis
  if (uColorMode == 6) return cospal(t, vec3(.5,.1,.1), vec3(.5,.4,.4), vec3(.8,.5,.3),     vec3(.1,.4,.9));     // Inferno
  if (uColorMode == 7) return cospal(t, vec3(.1,.3,.5), vec3(.3,.3,.4), vec3(.6,.8,1.),     vec3(0.,.1,.3));     // Ocean
  if (uColorMode == 8) return cospal(t, vec3(.1,.4,.1), vec3(.2,.3,.2), vec3(.8,1.,.5),     vec3(0.,.05,.1));    // Forest
  return vec3(t, t, t);  // Mono
}

// ── estimate surface normal from escape-time gradient ───────────────────────
vec3 estimateNormal() {
  float e = 0.002 / uZoom;
  float tR = computeFractal(vUv + vec2(e,0.), uCx, uCy, uZoom, uMaxIter, uFractalType, uJuliaC, uPower);
  float tL = computeFractal(vUv - vec2(e,0.), uCx, uCy, uZoom, uMaxIter, uFractalType, uJuliaC, uPower);
  float tU = computeFractal(vUv + vec2(0.,e), uCx, uCy, uZoom, uMaxIter, uFractalType, uJuliaC, uPower);
  float tD = computeFractal(vUv - vec2(0.,e), uCx, uCy, uZoom, uMaxIter, uFractalType, uJuliaC, uPower);
  return normalize(vec3(tL - tR, tD - tU, 0.3));
}

void main() {
  float t = computeFractal(vUv, uCx, uCy, uZoom, uMaxIter, uFractalType, uJuliaC, uPower);

  if (t <= 0.0) {
    gl_FragColor = vec4(0.02, 0.01, 0.06, 1.0);
    return;
  }

  vec3 col = getColor(t * uColorBands);

  // Normal-map lighting (Phase 2)
  if (uLighting > 0.01) {
    vec3  N     = estimateNormal();
    vec3  L     = normalize(vec3(1.0, 2.0, 1.0));
    float diff  = max(dot(N, L), 0.0);
    float spec  = pow(max(dot(reflect(-L, N), vec3(0.,0.,1.)), 0.0), 24.0);
    vec3  lit   = col * (0.35 + 0.65 * diff) + vec3(spec * 0.4);
    col = mix(col, lit, uLighting);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  Famous Locations (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────
const LOCATIONS = [
  { name: 'Seahorse Valley',   cx: -0.7435,  cy:  0.1314,  zoom: 400   },
  { name: 'Elephant Valley',   cx:  0.3015,  cy:  0.0225,  zoom: 1200  },
  { name: 'Lightning Bolt',    cx: -1.4780,  cy:  0.0,     zoom: 80    },
  { name: 'Double Spiral',     cx: -0.7269,  cy:  0.1889,  zoom: 5000  },
  { name: 'Mini-Brot',         cx: -1.7499,  cy:  0.0,     zoom: 2000  },
  { name: 'Starfish',          cx: -0.3750,  cy:  0.6590,  zoom: 800   },
  { name: 'Feather',           cx: -0.5880,  cy:  0.4230,  zoom: 300   },
  { name: 'Baby Mandelbrot',   cx: -1.2500,  cy:  0.0,     zoom: 50    },
  { name: 'Triple Spiral',     cx: -0.0840,  cy:  0.6560,  zoom: 3000  },
  { name: 'Deep Dendrite',     cx: -0.7454,  cy:  0.1130,  zoom: 25000 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  cx: -0.5, cy: 0.0, zoom: 1.0,
  maxIter: 128, heightScale: 0.4, colorMode: 0,
  fractalType: 0,
  juliaC: { x: -0.7269, y: 0.1889 },
  power: 2,
  animateColors: false, colorSpeed: 0.0, colorBands: 2.0,
  lighting: 0.6,
  bloomStrength: 0.0,
  wireframe: false,
  score: 0, depth: 0, time: 0,
};

const MILESTONES = [
  { zoom: 10,    label: '🔭 Deep Diver',       pts: 100  },
  { zoom: 100,   label: '🌀 Spiral Hunter',     pts: 250  },
  { zoom: 1000,  label: '⚡ Fractal Chaser',    pts: 500  },
  { zoom: 10000, label: '🚀 Infinity Explorer', pts: 1000 },
  { zoom: 1e6,   label: '🌌 Mandelbrot Master', pts: 5000 },
];
const achieved = new Set();

// Zoom history (Phase 5)
const history = [];
let histIdx = -1;
const MAX_HIST = 40;

function pushHistory() {
  const snap = { cx: state.cx, cy: state.cy, zoom: state.zoom };
  if (histIdx < history.length - 1) history.splice(histIdx + 1);
  history.push(snap);
  if (history.length > MAX_HIST) history.shift();
  histIdx = history.length - 1;
  updateHistoryBtns();
}

function updateHistoryBtns() {
  document.getElementById('hist-back').disabled = histIdx <= 0;
  document.getElementById('hist-fwd').disabled  = histIdx >= history.length - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Three.js Setup
// ─────────────────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 3.2, 2.4);
camera.lookAt(0, 0, 0);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.08;
controls.minDistance    = 0.3;
controls.maxDistance    = 14;
controls.target.set(0, 0, 0);

// ── Fractal Plane ─────────────────────────────────────────────────────────────
const SEGS = 256;
const planeGeo = new THREE.PlaneGeometry(4, 4, SEGS, SEGS);
planeGeo.rotateX(-Math.PI / 2);   // lie flat in XZ; Y is "up"

const planeMat = new THREE.ShaderMaterial({
  vertexShader:   VERT_SHADER,
  fragmentShader: FRAG_SHADER,
  uniforms: {
    uMaxIter:    { value: state.maxIter },
    uCx:         { value: state.cx },
    uCy:         { value: state.cy },
    uZoom:       { value: state.zoom },
    uHeightScale:{ value: state.heightScale },
    uFractalType:{ value: state.fractalType },
    uJuliaC:     { value: new THREE.Vector2(state.juliaC.x, state.juliaC.y) },
    uPower:      { value: state.power },
    uColorMode:  { value: state.colorMode },
    uTime:       { value: 0.0 },
    uColorSpeed: { value: 0.0 },
    uColorBands: { value: state.colorBands },
    uLighting:   { value: state.lighting },
  },
  side: THREE.DoubleSide,
});

const planeMesh = new THREE.Mesh(planeGeo, planeMat);
scene.add(planeMesh);

// ── Starfield ─────────────────────────────────────────────────────────────────
{
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(2400 * 3);
  for (let i = 0; i < 2400; i++) {
    pos[i*3]   = (Math.random()-0.5)*80;
    pos[i*3+1] = (Math.random()-0.5)*80;
    pos[i*3+2] = (Math.random()-0.5)*80;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x8899ff, size: 0.07, transparent: true, opacity: 0.45,
  })));
}

// ── Bloom (Phase 4) ───────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0, 0.6, 0.85   // strength=0 (off by default), radius, threshold
);
composer.addPass(bloomPass);

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function syncUniforms() {
  const u = planeMat.uniforms;
  u.uMaxIter.value    = state.maxIter;
  u.uCx.value         = state.cx;
  u.uCy.value         = state.cy;
  u.uZoom.value       = state.zoom;
  u.uHeightScale.value= state.heightScale;
  u.uFractalType.value= state.fractalType;
  u.uJuliaC.value.set(state.juliaC.x, state.juliaC.y);
  u.uPower.value      = state.power;
  u.uColorMode.value  = state.colorMode;
  u.uColorBands.value = state.colorBands;
  u.uLighting.value   = state.lighting;
  bloomPass.strength  = state.bloomStrength;
}

function updateHUD() {
  document.getElementById('depth-display').textContent = state.depth;
  document.getElementById('score-display').textContent = state.score.toLocaleString();
  document.getElementById('cx-display').textContent   = `Re: ${state.cx.toFixed(6)}`;
  document.getElementById('cy-display').textContent   = `Im: ${state.cy.toFixed(6)}`;
  const z = state.zoom;
  const zStr = z>=1e6 ? (z/1e6).toFixed(1)+'M×' : z>=1e3 ? (z/1e3).toFixed(1)+'K×' : z.toFixed(1)+'×';
  document.getElementById('zoom-display').textContent = zStr;
  saveURL();
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
  void el.offsetWidth;
  el.classList.add('show');
  if (trophyTimer) clearTimeout(trophyTimer);
  trophyTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 320);
  }, 2600);
}

// ─────────────────────────────────────────────────────────────────────────────
//  URL Share (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────
function saveURL() {
  const p = new URLSearchParams();
  p.set('cx',    state.cx.toFixed(10));
  p.set('cy',    state.cy.toFixed(10));
  p.set('zoom',  state.zoom.toPrecision(8));
  p.set('iter',  state.maxIter);
  p.set('color', state.colorMode);
  p.set('ft',    state.fractalType);
  if (state.fractalType === 1) {
    p.set('jx', state.juliaC.x.toFixed(6));
    p.set('jy', state.juliaC.y.toFixed(6));
  }
  if (state.fractalType === 5) p.set('pw', state.power);
  history.replaceState?.(null, '', '#' + p.toString());
}

function loadURL() {
  if (!location.hash) return;
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.has('cx'))   state.cx          = parseFloat(p.get('cx'));
    if (p.has('cy'))   state.cy          = parseFloat(p.get('cy'));
    if (p.has('zoom')) state.zoom        = parseFloat(p.get('zoom'));
    if (p.has('iter')) state.maxIter     = parseInt(p.get('iter'));
    if (p.has('color'))state.colorMode   = parseInt(p.get('color'));
    if (p.has('ft'))   state.fractalType = parseInt(p.get('ft'));
    if (p.has('jx'))   state.juliaC.x   = parseFloat(p.get('jx'));
    if (p.has('jy'))   state.juliaC.y   = parseFloat(p.get('jy'));
    if (p.has('pw'))   state.power       = parseFloat(p.get('pw'));
    state.depth = Math.floor(Math.log2(Math.max(1, state.zoom)));
    syncUIFromState();
  } catch(e) { console.warn('URL parse error', e); }
}

function syncUIFromState() {
  const get = id => document.getElementById(id);
  get('iter-slider').value  = state.maxIter;
  get('iter-val').textContent = state.maxIter;
  get('color-mode').value   = state.colorMode;
  get('fractal-type').value = state.fractalType;
  get('power-slider').value = state.power;
  get('power-val').textContent = state.power;
  updateFractalTypeUI();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Navigation
// ─────────────────────────────────────────────────────────────────────────────
function applyZoom(screenX, screenY, factor) {
  const rect  = canvas.getBoundingClientRect();
  const ndx   = ((screenX-rect.left)/rect.width)  *2 - 1;
  const ndy   = -((screenY-rect.top)/rect.height) *2 + 1;
  const ray   = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndx, ndy), camera);
  const hits  = ray.intersectObjects(scene.children);
  const hit   = hits.find(h => h.uv);
  if (hit) {
    const hw = 2.0 / state.zoom;
    state.cx += (hit.uv.x - 0.5) * hw * 2.0;
    state.cy += (hit.uv.y - 0.5) * hw * 2.0;
  }
  pushHistory();
  state.zoom  = Math.max(0.5, state.zoom * factor);
  state.depth = Math.floor(Math.log2(state.zoom));
  state.score+= Math.max(1, state.depth);
  checkMilestones();
  syncUniforms();
  updateHUD();
}

function jumpTo(loc) {
  pushHistory();
  state.cx   = loc.cx;
  state.cy   = loc.cy;
  state.zoom = loc.zoom;
  state.depth= Math.floor(Math.log2(loc.zoom));
  syncUniforms();
  updateHUD();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Input
// ─────────────────────────────────────────────────────────────────────────────

// Double-click → zoom in ×4
let lastClickMs = 0;
canvas.addEventListener('dblclick', e => {
  if (state.fractalType === 1) return; // Julia mode: dblclick sets C instead
  applyZoom(e.clientX, e.clientY, 4);
});

// Single click in Julia mode → set Julia C
canvas.addEventListener('click', e => {
  if (state.fractalType !== 1) return;
  const rect = canvas.getBoundingClientRect();
  const ndx  = ((e.clientX-rect.left)/rect.width)  *2-1;
  const ndy  = -((e.clientY-rect.top)/rect.height) *2+1;
  const ray  = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndx, ndy), camera);
  const hits = ray.intersectObjects(scene.children);
  const hit  = hits.find(h => h.uv);
  if (hit) {
    const hw = 2.0 / state.zoom;
    state.juliaC.x = state.cx + (hit.uv.x-0.5)*hw*2.0;
    state.juliaC.y = state.cy + (hit.uv.y-0.5)*hw*2.0;
    document.getElementById('julia-c-display').textContent =
      `${state.juliaC.x.toFixed(4)}+${state.juliaC.y.toFixed(4)}i`;
    syncUniforms();
  }
});

// Scroll → zoom fractal
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.25 : 1/1.25;
  pushHistory();
  state.zoom  = Math.max(0.5, state.zoom * f);
  state.depth = Math.floor(Math.log2(state.zoom));
  if (f > 1) { state.score++; checkMilestones(); }
  syncUniforms();
  updateHUD();
}, { passive: false });

// Touch – double-tap zoom, pinch zoom
let lastTapMs = 0, lastPinchDist = null;

canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    const now = Date.now();
    if (now - lastTapMs < 300) applyZoom(e.touches[0].clientX, e.touches[0].clientY, 4);
    lastTapMs = now;
    lastPinchDist = null;
  }
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastPinchDist = Math.hypot(dx, dy);
  }
}, { passive: true });

canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && lastPinchDist) {
    e.preventDefault();
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const f    = dist / lastPinchDist;
    lastPinchDist = dist;
    state.zoom  = Math.max(0.5, state.zoom * f);
    state.depth = Math.floor(Math.log2(state.zoom));
    checkMilestones();
    syncUniforms();
    updateHUD();
  }
}, { passive: false });

// Keyboard
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'p' || e.key === 'P') takeScreenshot();
  if (e.key === 'Backspace' || e.key === 'ArrowLeft' && e.altKey) histBack();
});
window.addEventListener('keyup', e => { delete keys[e.key]; });

function handleKeys(dt) {
  let any = false;
  const pan = (1.0 / state.zoom) * dt;
  const zm  = Math.pow(1.8, dt);
  if (keys['ArrowLeft']  || keys['a']) { state.cx -= pan; any = true; }
  if (keys['ArrowRight'] || keys['d']) { state.cx += pan; any = true; }
  if (keys['ArrowUp']    || keys['w']) { state.cy += pan; any = true; }
  if (keys['ArrowDown']  || keys['s']) { state.cy -= pan; any = true; }
  if (keys['+'] || keys['=']) { state.zoom = Math.min(1e9, state.zoom*zm); state.depth=Math.floor(Math.log2(state.zoom)); any=true; checkMilestones(); }
  if (keys['-'])               { state.zoom = Math.max(0.5, state.zoom/zm); state.depth=Math.floor(Math.log2(state.zoom)); any=true; }
  if (any) { syncUniforms(); updateHUD(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Actions
// ─────────────────────────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else                              document.exitFullscreen?.();
}

function takeScreenshot() {
  renderer.render(scene, camera);
  const dataURL = canvas.toDataURL('image/png');
  // Save to gallery
  saveToGallery(dataURL);
  // Download
  const a = document.createElement('a');
  a.download = `mandelbrot-${Date.now()}.png`;
  a.href = dataURL;
  a.click();
}

function shareURL() {
  saveURL();
  navigator.clipboard?.writeText(location.href).then(() => {
    const t = document.getElementById('share-toast');
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2000);
  });
}

function histBack() {
  if (histIdx <= 0) return;
  histIdx--;
  const s = history[histIdx];
  state.cx = s.cx; state.cy = s.cy; state.zoom = s.zoom;
  state.depth = Math.floor(Math.log2(Math.max(1, state.zoom)));
  syncUniforms(); updateHUD(); updateHistoryBtns();
}

function histFwd() {
  if (histIdx >= history.length-1) return;
  histIdx++;
  const s = history[histIdx];
  state.cx = s.cx; state.cy = s.cy; state.zoom = s.zoom;
  state.depth = Math.floor(Math.log2(Math.max(1, state.zoom)));
  syncUniforms(); updateHUD(); updateHistoryBtns();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Screenshot Gallery (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────
const GALLERY_KEY = 'mandelbrot_gallery';

function saveToGallery(dataURL) {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]'); } catch(e){}
  arr.unshift(dataURL);
  if (arr.length > 20) arr = arr.slice(0, 20);
  try { localStorage.setItem(GALLERY_KEY, JSON.stringify(arr)); } catch(e){}
  renderGallery();
}

function renderGallery() {
  const el = document.getElementById('gallery');
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]'); } catch(e){}
  if (!arr.length) {
    el.innerHTML = '<div class="empty-gallery">No screenshots yet.<br>Press 📸 to capture.</div>';
    return;
  }
  el.innerHTML = arr.map((src, i) =>
    `<img src="${src}" title="Screenshot ${i+1}" data-i="${i}" />`
  ).join('');
  el.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => {
      const a = document.createElement('a');
      a.download = `mandelbrot-saved-${Date.now()}.png`;
      a.href = img.src; a.click();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Auto Tour (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────
let tourTimer = null;
let tourIdx   = 0;

function startTour() {
  if (tourTimer) { stopTour(); return; }
  document.getElementById('tour-btn').classList.add('active');
  document.getElementById('tour-btn').textContent = 'Stop Tour';
  nextTourStep();
}

function stopTour() {
  clearTimeout(tourTimer);
  tourTimer = null;
  document.getElementById('tour-btn').classList.remove('active');
  document.getElementById('tour-btn').textContent = 'Auto Tour';
}

function nextTourStep() {
  const loc = LOCATIONS[tourIdx % LOCATIONS.length];
  tourIdx++;
  jumpTo(loc);
  showTrophy(`📍 ${loc.name}`);
  tourTimer = setTimeout(nextTourStep, 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI – Fractal type helpers
// ─────────────────────────────────────────────────────────────────────────────
function updateFractalTypeUI() {
  const ft = state.fractalType;
  document.getElementById('julia-row').style.display  = ft===1 ? '' : 'none';
  document.getElementById('power-row').style.display  = ft===5 ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI – wire up all controls
// ─────────────────────────────────────────────────────────────────────────────
function bindUI() {
  const $  = id => document.getElementById(id);
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

  // Fractal type
  on('fractal-type', 'change', e => {
    state.fractalType = parseInt(e.target.value);
    updateFractalTypeUI();
    syncUniforms();
  });

  // Power (multibrot)
  on('power-slider', 'input', e => {
    state.power = parseFloat(e.target.value);
    $('power-val').textContent = state.power;
    syncUniforms();
  });

  // Iterations
  on('iter-slider', 'input', e => {
    state.maxIter = parseInt(e.target.value);
    $('iter-val').textContent = state.maxIter;
    syncUniforms();
  });

  // Height
  on('height-slider', 'input', e => {
    state.heightScale = parseInt(e.target.value) * 0.01;
    $('height-val').textContent = e.target.value;
    syncUniforms();
  });

  // Color mode
  on('color-mode', 'change', e => {
    state.colorMode = parseInt(e.target.value);
    syncUniforms();
  });

  // Color bands
  on('bands-slider', 'input', e => {
    state.colorBands = parseFloat(e.target.value);
    $('bands-val').textContent = state.colorBands.toFixed(2);
    syncUniforms();
  });

  // Lighting (Phase 2)
  on('light-slider', 'input', e => {
    state.lighting = parseInt(e.target.value) / 100;
    $('light-val').textContent = e.target.value;
    syncUniforms();
  });

  // Bloom (Phase 4)
  on('bloom-slider', 'input', e => {
    state.bloomStrength = parseInt(e.target.value) / 50;
    $('bloom-val').textContent = e.target.value;
    syncUniforms();
  });

  // Reset
  on('reset-btn', 'click', () => {
    pushHistory();
    state.cx=-.5; state.cy=0; state.zoom=1; state.depth=0;
    syncUniforms(); updateHUD();
    camera.position.set(0, 3.2, 2.4);
    camera.lookAt(0,0,0);
    controls.reset();
  });

  // Animate colors
  on('animate-btn', 'click', () => {
    state.animateColors = !state.animateColors;
    state.colorSpeed    = state.animateColors ? 0.04 : 0.0;
    planeMat.uniforms.uColorSpeed.value = state.colorSpeed;
    $('animate-btn').classList.toggle('active', state.animateColors);
    $('animate-btn').textContent = state.animateColors ? 'Stop Anim' : 'Anim Colors';
  });

  // Wireframe (Phase 4)
  on('wireframe-btn', 'click', () => {
    state.wireframe = !state.wireframe;
    planeMat.wireframe = state.wireframe;
    $('wireframe-btn').classList.toggle('active', state.wireframe);
  });

  // Auto tour (Phase 5)
  on('tour-btn', 'click', startTour);

  // Toolbar
  on('screenshot-btn', 'click', takeScreenshot);
  on('fullscreen-btn', 'click', toggleFullscreen);
  on('share-btn',      'click', shareURL);

  // Zoom history (Phase 5)
  on('hist-back', 'click', histBack);
  on('hist-fwd',  'click', histFwd);

  // Gallery (Phase 5)
  on('gallery-toggle', 'click', () => {
    const g = $('gallery');
    const open = g.classList.toggle('hidden');
    if (!open) renderGallery();
  });
  // Start hidden properly
  $('gallery').classList.add('hidden');

  // Jump-to locations (Phase 5)
  const locList = $('loc-list');
  LOCATIONS.forEach(loc => {
    const btn = document.createElement('button');
    btn.textContent = loc.name;
    btn.addEventListener('click', () => jumpTo(loc));
    locList.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Resize
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────────────────────
//  Render Loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  state.time += dt;

  handleKeys(dt);

  if (state.animateColors) {
    planeMat.uniforms.uTime.value = state.time;
  }

  controls.update();

  // Use bloom composer when bloom is active, plain renderer otherwise
  if (state.bloomStrength > 0.01) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────────────────────
loadURL();
syncUniforms();
bindUI();
updateFractalTypeUI();
updateHUD();
updateHistoryBtns();
pushHistory();  // seed history with initial position
animate();
