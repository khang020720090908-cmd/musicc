/**
 * fx/gl.js — WebGL Aurora Sóng + Audio-Reactive + Beat Detection
 * Sóng · Media Hub — Hello Kitty Milk Pink Theme
 * Three.js r160 — chỉ dùng cho nền sóng aurora hồng sữa
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ============================================================
// GLOBALS
// ============================================================
let scene, camera, renderer;
let oceanMesh, oceanMaterial;
let particleSystem, particlePositions, particleVelocities;
let clock;
let qualityLevel = 1.0;
let lastFPSCheck = 0, frameCountFPS = 0, currentFPS = 60;
let mouseX = 0, mouseY = 0;
let targetCamX = 0, targetCamY = 0;
let isRunning = false;

// Beat detection
let beatThreshold = 0.42;
let beatCooldown = 0;
let lastBeatTime = 0;

// === Màu theme hồng sữa (Hello Kitty Milk Pink) ===
// Đọc từ CSS vars nếu có, fallback hardcode
function getCSSColor(varName, fallback) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (val && val.startsWith('#')) return val;
  return fallback;
}

let themeA = new THREE.Color(0xFF5C8A); // --cyan: hồng mận
let themeB = new THREE.Color(0xE8344E); // --violet: đỏ hồng
let themeC = new THREE.Color(0xFF8FB1); // --hot-pink: hồng nhạt
let themeD = new THREE.Color(0xFFD966); // bơ vàng

// ============================================================
// SHADERS — Sóng aurora hồng sữa
// ============================================================
const OCEAN_VERT = `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uSpeed;
  uniform float uAmplitude;

  varying vec2 vUv;
  varying float vElevation;

  // Simplex noise 2D
  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_) - 0.5;
    vec3 ox = floor(x_ + 0.5);
    vec3 a0 = x_ - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    float t = uTime * uSpeed;

    // Bass boost biên độ sóng
    float bassBoost = 1.0 + uBass * 3.0;
    float amp = uAmplitude * bassBoost;

    // 3 lớp sóng chồng lên nhau
    float wave1 = snoise(vec2(pos.x * 0.7 + t * 0.3, pos.z * 0.7 - t * 0.25)) * amp;
    float wave2 = snoise(vec2(pos.x * 1.5 - t * 0.18, pos.z * 1.5 + t * 0.4)) * amp * 0.55;
    float wave3 = snoise(vec2(pos.x * 2.8 + t * 0.55, pos.z * 2.8 - t * 0.35)) * amp * 0.28;

    float elevation = wave1 + wave2 + wave3;
    pos.y += elevation;
    vElevation = elevation;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const OCEAN_FRAG = `
  uniform float uTime;
  uniform float uBass;
  uniform float uTreble;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  varying vec2 vUv;
  varying float vElevation;

  void main() {
    // Gradient theo độ cao sóng
    float t = clamp((vElevation + 0.6) * 0.8, 0.0, 1.0);
    vec3 color = mix(uColorA * 0.25, uColorB * 0.9, t);
    color = mix(color, uColorC, t * t * (0.25 + uTreble * 0.35));

    // Ánh sáng ở đỉnh sóng
    float fresnel = pow(clamp(1.0 - abs(vElevation) * 1.2, 0.0, 1.0), 5.0);
    color += uColorA * fresnel * (0.6 + uBass * 0.5);

    // Nhấp lánh nhỏ khi treble cao
    float sparkle = fract(sin(dot(vUv * 80.0, vec2(12.9898, 78.233))) * 43758.5453);
    color += vec3(sparkle > (0.985 - uTreble * 0.025) ? 0.4 : 0.0);

    // Fade ra mép
    float depth = 1.0 - length(vUv - 0.5) * 1.6;
    depth = clamp(depth, 0.0, 1.0);

    // Alpha tổng: sóng hồng mờ overlay lên nền
    gl_FragColor = vec4(color * depth, depth * 0.55);
  }
`;

// ============================================================
// INIT
// ============================================================
export function init() {
  // Kiểm tra WebGL
  const canvas = document.getElementById('gl');
  if (!canvas) return;

  // Mobile + pin yếu → bỏ qua WebGL
  const isMobile = window.innerWidth < 768;
  const isLowPower = navigator.getBattery
    ? false  // check async bên dưới
    : false;

  if (navigator.getBattery) {
    navigator.getBattery().then(bat => {
      if (!bat.charging && bat.level < 0.2) {
        canvas.style.display = 'none';
        return;
      }
      startGL(canvas, isMobile);
    }).catch(() => startGL(canvas, isMobile));
  } else {
    startGL(canvas, isMobile);
  }
}

function startGL(canvas, isMobile) {
  try {
    const testCtx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!testCtx) throw new Error('no webgl');
  } catch {
    canvas.style.display = 'none';
    return;
  }

  // Đọc màu từ CSS vars (sau khi DOM load, theme pink đã active)
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);
  // theme pink: --cyan = #FF5C8A
  themeA = new THREE.Color(0xFF5C8A);
  themeB = new THREE.Color(0xE8344E);
  themeC = new THREE.Color(0xFF8FB1);
  themeD = new THREE.Color(0xFFD966);

  clock = new THREE.Clock();

  // Scene với fog hồng nhạt
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xFFE4EC, 0.022);

  // Camera nhìn từ trên xuống nhẹ
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 5, 9);
  camera.lookAt(0, 0, 0);

  // Renderer
  const dpr = Math.min(window.devicePixelRatio, isMobile ? 1 : 1.5);
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    alpha: true,
    powerPreference: 'default'
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Geometry sóng (lưới mịn hơn trên desktop)
  const gridSize = isMobile ? 48 : 96;
  const geo = new THREE.PlaneGeometry(22, 22, gridSize, gridSize);
  geo.rotateX(-Math.PI / 2);

  // Material sóng hồng
  oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: OCEAN_VERT,
    fragmentShader: OCEAN_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:      { value: 0 },
      uBass:      { value: 0 },
      uMid:       { value: 0 },
      uTreble:    { value: 0 },
      uSpeed:     { value: 0.5 },
      uAmplitude: { value: 0.38 },
      uColorA:    { value: themeA.clone() },
      uColorB:    { value: themeB.clone() },
      uColorC:    { value: themeD.clone() }
    }
  });

  oceanMesh = new THREE.Mesh(geo, oceanMaterial);
  scene.add(oceanMesh);

  // Hạt lấp lánh (bokeh hồng)
  initParticles(isMobile);

  // Ánh sáng ambient hồng
  const ambient = new THREE.AmbientLight(0xFFE4EC, 0.8);
  scene.add(ambient);
  // Điểm sáng hồng đậm
  const pt1 = new THREE.PointLight(0xFF5C8A, 1.2, 25);
  pt1.position.set(-6, 6, 2);
  scene.add(pt1);
  // Điểm sáng vàng bơ
  const pt2 = new THREE.PointLight(0xFFD966, 0.6, 20);
  pt2.position.set(5, 4, 5);
  scene.add(pt2);

  // Events
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('deviceorientation', onGyro, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  isRunning = true;
  renderer.setAnimationLoop(animate);
}

// ============================================================
// HẠT SÁNG LẤPLÁNH (Bokeh hồng + vàng)
// ============================================================
function initParticles(isMobile) {
  const count = isMobile ? 200 : 600;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  particleVelocities = new Float32Array(count * 3);

  // Màu hạt: hồng nhạt, hồng đậm, vàng bơ, trắng sữa
  const palette = [themeA, themeB, themeC, themeD, new THREE.Color(0xFFF0F5)];

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 28;
    positions[i * 3 + 1] = Math.random() * 10 - 1;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 28;

    const c = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = Math.random() * 3 + 1;
    particleVelocities[i * 3]     = (Math.random() - 0.5) * 0.0015;
    particleVelocities[i * 3 + 1] = Math.random() * 0.0025 + 0.0008;
    particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.0015;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  particlePositions = positions;

  const mat = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });

  particleSystem = new THREE.Points(geo, mat);
  scene.add(particleSystem);
}

// ============================================================
// AUDIO LEVELS — Đọc từ window.__analyser
// ============================================================
let fftData = null;
let bassSmooth = 0.1, midSmooth = 0.08, trebleSmooth = 0.06;
const SMOOTH = 0.14;

function getAudioLevels() {
  const an = window.__analyser;
  if (an) {
    if (!fftData || fftData.length !== an.frequencyBinCount) {
      fftData = new Uint8Array(an.frequencyBinCount);
    }
    an.getByteFrequencyData(fftData);
    const n = fftData.length;
    const bassEnd   = Math.floor(n * 0.08);
    const midEnd    = Math.floor(n * 0.35);
    const trebleEnd = Math.floor(n * 0.72);

    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < bassEnd; i++) bass += fftData[i];
    for (let i = bassEnd; i < midEnd; i++) mid += fftData[i];
    for (let i = midEnd; i < trebleEnd; i++) treble += fftData[i];
    bass   /= bassEnd * 255;
    mid    /= (midEnd - bassEnd) * 255;
    treble /= (trebleEnd - midEnd) * 255;

    bassSmooth   += (bass - bassSmooth) * SMOOTH;
    midSmooth    += (mid - midSmooth) * SMOOTH;
    trebleSmooth += (treble - trebleSmooth) * SMOOTH;
  } else {
    // Mô phỏng nhịp tim bình lặng khi không có nhạc
    const t = clock ? clock.getElapsedTime() : 0;
    const sim = 0.12 + 0.08 * Math.abs(Math.sin(t * 0.9));
    bassSmooth   += (sim - bassSmooth) * 0.04;
    midSmooth    += (sim * 0.65 - midSmooth) * 0.04;
    trebleSmooth += (sim * 0.35 - trebleSmooth) * 0.04;
  }
  return { bass: bassSmooth, mid: midSmooth, treble: trebleSmooth };
}

// ============================================================
// BEAT DETECTION
// ============================================================
function detectBeat(bass, elapsed) {
  beatCooldown = Math.max(0, beatCooldown - 1);
  if (bass > beatThreshold && beatCooldown === 0 && (elapsed - lastBeatTime) > 0.22) {
    lastBeatTime = elapsed;
    beatCooldown = 8;
    beatThreshold = bass * 0.82;
    setTimeout(() => { beatThreshold = Math.max(0.4, beatThreshold - 0.04); }, 450);

    // Dispatch beat event (audio-reactive.js cũng dùng cái này)
    window.dispatchEvent(new CustomEvent('song:beat', { detail: { intensity: bass } }));

    // Camera rung nhẹ theo beat
    if (camera) {
      const shakeAmt = bass * 0.06;
      camera.position.x += (Math.random() - 0.5) * shakeAmt;
      camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.4;
    }
    return true;
  }
  beatThreshold = Math.max(0.38, beatThreshold * 0.9985);
  return false;
}

// ============================================================
// FPS ADAPTIVE QUALITY
// ============================================================
function checkFPS(now) {
  frameCountFPS++;
  if (now - lastFPSCheck > 3000) {
    currentFPS = frameCountFPS / ((now - lastFPSCheck) / 1000);
    frameCountFPS = 0;
    lastFPSCheck = now;

    if (currentFPS < 40 && qualityLevel > 0.4) {
      qualityLevel -= 0.15;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio * qualityLevel, 1.5));
      if (currentFPS < 28) scene.fog.density = 0.045; // fog mạnh hơn = ít render
    } else if (currentFPS > 58 && qualityLevel < 1.0) {
      qualityLevel = Math.min(1.0, qualityLevel + 0.1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio * qualityLevel, 1.5));
    }
  }
}

// ============================================================
// MAIN LOOP
// ============================================================
function animate(time) {
  if (document.hidden || !isRunning) return;

  const elapsed = clock.getElapsedTime();
  checkFPS(time);

  const { bass, mid, treble } = getAudioLevels();
  detectBeat(bass, elapsed);

  // Update shader uniforms
  if (oceanMaterial) {
    oceanMaterial.uniforms.uTime.value    = elapsed;
    oceanMaterial.uniforms.uBass.value    = bass;
    oceanMaterial.uniforms.uMid.value     = mid;
    oceanMaterial.uniforms.uTreble.value  = treble;
    oceanMaterial.uniforms.uSpeed.value   = 0.45 + mid * 0.7;
    oceanMaterial.uniforms.uAmplitude.value = 0.32 + bass * 0.38;
  }

  // Cập nhật hạt lấp lánh
  if (particleSystem && particlePositions) {
    const pos = particleSystem.geometry.attributes.position.array;
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) {
      pos[i * 3]     += particleVelocities[i * 3]     * (1 + bass * 2.2);
      pos[i * 3 + 1] += particleVelocities[i * 3 + 1] * (1 + treble * 1.4);
      pos[i * 3 + 2] += particleVelocities[i * 3 + 2] * (1 + mid);
      // Wrap bounds
      if (pos[i * 3 + 1] > 11) pos[i * 3 + 1] = -1;
      if (Math.abs(pos[i * 3]) > 14)     pos[i * 3]     *= -0.88;
      if (Math.abs(pos[i * 3 + 2]) > 14) pos[i * 3 + 2] *= -0.88;
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.material.size = 0.07 + bass * 0.05;
    particleSystem.material.opacity = 0.48 + treble * 0.28;
  }

  // Parallax camera theo chuột
  targetCamX += (mouseX * 1.2 - targetCamX) * 0.035;
  targetCamY += (-mouseY * 0.7 - targetCamY) * 0.035;
  camera.position.x += (targetCamX - camera.position.x) * 0.055;
  camera.position.y += (targetCamY + 5 - camera.position.y) * 0.055;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

// ============================================================
// EVENT HANDLERS
// ============================================================
function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(e) {
  mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
  mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
}

function onGyro(e) {
  if (e.gamma !== null && e.beta !== null) {
    mouseX = (e.gamma / 30) * 1.2;
    mouseY = ((e.beta - 25) / 30) * 0.7;
  }
}

function onVisibility() {
  if (!renderer) return;
  if (document.hidden) {
    renderer.setAnimationLoop(null);
    isRunning = false;
  } else {
    isRunning = true;
    renderer.setAnimationLoop(animate);
    if (clock) clock.getDelta();
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/** Cập nhật màu sắc khi đổi theme */
export function updatePalette(colorA, colorB, colorC) {
  if (!oceanMaterial) return;
  const tA = new THREE.Color(colorA || 0xFF5C8A);
  const tB = new THREE.Color(colorB || 0xE8344E);
  const tC = new THREE.Color(colorC || 0xFFD966);

  const startTime = clock ? clock.getElapsedTime() : 0;
  const fromA = oceanMaterial.uniforms.uColorA.value.clone();
  const fromB = oceanMaterial.uniforms.uColorB.value.clone();
  const fromC = oceanMaterial.uniforms.uColorC.value.clone();

  function tick() {
    if (!oceanMaterial) return;
    const t = Math.min((clock.getElapsedTime() - startTime) / 0.9, 1);
    const e = 1 - Math.pow(1 - t, 3);
    oceanMaterial.uniforms.uColorA.value.lerpColors(fromA, tA, e);
    oceanMaterial.uniforms.uColorB.value.lerpColors(fromB, tB, e);
    oceanMaterial.uniforms.uColorC.value.lerpColors(fromC, tC, e);
    if (t < 1) requestAnimationFrame(tick);
  }
  tick();
}

/** Pulse amplitude khi click */
document.addEventListener('click', () => {
  if (!oceanMaterial) return;
  const orig = oceanMaterial.uniforms.uAmplitude.value;
  oceanMaterial.uniforms.uAmplitude.value = orig + 0.25;
  setTimeout(() => { if (oceanMaterial) oceanMaterial.uniforms.uAmplitude.value = orig; }, 200);
});

export function destroy() {
  isRunning = false;
  if (renderer) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
  }
  window.removeEventListener('resize', onResize);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('deviceorientation', onGyro);
  document.removeEventListener('visibilitychange', onVisibility);
}
