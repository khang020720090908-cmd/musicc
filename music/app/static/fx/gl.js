/**
 * fx/gl.js — WebGL Ocean + Audio-Reactive + Beat Detection
 * Sóng · Liquid Neon Ocean — Three.js r160 CDN
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ============================================================
// GLOBALS
// ============================================================
let scene, camera, renderer, composer;
let oceanMesh, oceanMaterial, oceanGeometry;
let particleSystem, particlePositions, particleVelocities;
let clock, frameCount = 0;
let currentView = 'home';
let beatCallbacks = [];
let qualityLevel = 1.0; // 0.5 = low, 1.0 = full
let lastFPSCheck = 0, frameCountFPS = 0, currentFPS = 60;
let mouseX = 0, mouseY = 0;
let targetCamX = 0, targetCamY = 0;

// Beat detection state
let beatThreshold = 0.45;
let beatCooldown = 0;
let lastBeatTime = 0;

// Theme palette (synced from CSS vars)
let themeA = new THREE.Color(0x3CF2FF);
let themeB = new THREE.Color(0x8B5CFF);
let themeC = new THREE.Color(0xFF3DA5);

// ============================================================
// OCEAN SHADER
// ============================================================
const OCEAN_VERT = `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uSpeed;
  uniform float uAmplitude;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform int uViewMode;
  
  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vWorldPos;
  
  // Simplex-like noise (fast 2D)
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
    float bassBoost = 1.0 + uBass * 3.5;
    float amp = uAmplitude * bassBoost;
    
    float wave1 = snoise(vec2(pos.x * 0.8 + t * 0.4, pos.z * 0.8 - t * 0.3)) * amp;
    float wave2 = snoise(vec2(pos.x * 1.6 - t * 0.2, pos.z * 1.6 + t * 0.5)) * amp * 0.5;
    float wave3 = snoise(vec2(pos.x * 3.0 + t * 0.7, pos.z * 3.0 - t * 0.4)) * amp * 0.25;
    
    float elevation = wave1 + wave2 + wave3;
    
    // View-specific deformation
    if (uViewMode == 1) { // YouTube — grid pattern
      float gridX = sin(pos.x * 3.14159) * amp * 0.5;
      float gridZ = sin(pos.z * 3.14159) * amp * 0.5;
      elevation = mix(elevation, gridX + gridZ, 0.5);
    } else if (uViewMode == 2) { // SoundCloud — spiral
      float dist = length(pos.xz);
      float spiral = sin(dist * 4.0 - t * 2.0) * amp * (1.0 - dist * 0.05);
      elevation = mix(elevation, spiral, 0.6);
    } else if (uViewMode == 3) { // Library — expanding circles
      float dist = length(pos.xz);
      float circle = sin(dist * 2.0 - t * 1.5) * amp * exp(-dist * 0.08);
      elevation = mix(elevation, circle, 0.5);
    } else if (uViewMode == 4) { // Downloads — falling data
      float fall = snoise(vec2(pos.x * 2.0, pos.z * 0.3 - t * 2.0)) * amp * 1.2;
      elevation = mix(elevation, fall, 0.7);
    }
    
    pos.y += elevation;
    vElevation = elevation;
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    
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
  varying vec3 vWorldPos;
  
  void main() {
    // Gradient based on elevation
    float t = clamp((vElevation + 1.0) * 0.5, 0.0, 1.0);
    vec3 color = mix(uColorA * 0.3, uColorB, t);
    color = mix(color, uColorC, t * t * (0.3 + uTreble * 0.4));
    
    // Fresnel glow at wave peaks
    float fresnel = pow(1.0 - abs(vElevation), 6.0);
    color += uColorA * fresnel * (0.8 + uBass * 0.5);
    
    // Sparkle on treble
    float sparkle = fract(sin(dot(vUv * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
    color += vec3(sparkle > (0.99 - uTreble * 0.03) ? 0.3 : 0.0);
    
    // Depth fade
    float depth = 1.0 - length(vUv - 0.5) * 1.5;
    depth = clamp(depth, 0.0, 1.0);
    
    gl_FragColor = vec4(color * depth, depth * 0.75);
  }
`;

// ============================================================
// INIT
// ============================================================
export function init() {
  const canvas = document.getElementById('gl');
  if (!canvas) return;

  // WebGL support check
  try {
    const testGL = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!testGL) throw new Error('no webgl');
  } catch {
    canvas.style.display = 'none';
    return;
  }

  clock = new THREE.Clock();

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070F, 0.035);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 0, 0);

  // Renderer
  const dpr = Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.5 : 2);
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: dpr < 2,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Ocean geometry
  const isMobile = window.innerWidth < 768;
  const gridSize = isMobile ? 64 : 120;
  oceanGeometry = new THREE.PlaneGeometry(20, 20, gridSize, gridSize);
  oceanGeometry.rotateX(-Math.PI / 2);

  // Ocean material (shader)
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
      uSpeed:     { value: 0.6 },
      uAmplitude: { value: 0.4 },
      uViewMode:  { value: 0 },
      uColorA:    { value: themeA.clone() },
      uColorB:    { value: themeB.clone() },
      uColorC:    { value: themeC.clone() }
    }
  });

  oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
  scene.add(oceanMesh);

  // Ambient particles (bokeh)
  initParticles();

  // Lighting
  const ambient = new THREE.AmbientLight(0x1a1a2e, 0.5);
  scene.add(ambient);
  const point1 = new THREE.PointLight(0x3CF2FF, 1, 20);
  point1.position.set(-5, 5, 0);
  scene.add(point1);
  const point2 = new THREE.PointLight(0x8B5CFF, 0.8, 20);
  point2.position.set(5, 3, 5);
  scene.add(point2);

  // Events
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('deviceorientation', onGyro, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  // Start render loop
  renderer.setAnimationLoop(animate);
}

// ============================================================
// PARTICLES (bokeh ambient)
// ============================================================
function initParticles() {
  const count = window.innerWidth < 768 ? 300 : 800;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  particleVelocities = new Float32Array(count * 3);

  const palette = [themeA, themeB, themeC, new THREE.Color(0xFFC14D)];

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = Math.random() * 8 - 2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30;

    const c = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = Math.random() * 3 + 1;
    particleVelocities[i * 3]     = (Math.random() - 0.5) * 0.002;
    particleVelocities[i * 3 + 1] = Math.random() * 0.003 + 0.001;
    particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  particlePositions = positions;

  const mat = new THREE.PointsMaterial({
    size: 0.06,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });

  particleSystem = new THREE.Points(geo, mat);
  scene.add(particleSystem);
}

// ============================================================
// AUDIO REACTIVE
// ============================================================
let fftData = null;
let bassSmooth = 0, midSmooth = 0, trebleSmooth = 0;
const SMOOTH = 0.12;

function getAudioLevels() {
  // Try to get analyser from app.js global
  const an = window.__analyser;
  if (an) {
    if (!fftData || fftData.length !== an.frequencyBinCount) {
      fftData = new Uint8Array(an.frequencyBinCount);
    }
    an.getByteFrequencyData(fftData);

    const n = fftData.length;
    const bassEnd   = Math.floor(n * 0.08);
    const midEnd    = Math.floor(n * 0.35);
    const trebleEnd = Math.floor(n * 0.75);

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
    // Simulated wave when no audio
    const t = clock.getElapsedTime();
    const sim = 0.18 + 0.15 * Math.abs(Math.sin(t * 0.8));
    bassSmooth   += (sim - bassSmooth) * 0.05;
    midSmooth    += (sim * 0.7 - midSmooth) * 0.05;
    trebleSmooth += (sim * 0.4 - trebleSmooth) * 0.05;
  }

  return { bass: bassSmooth, mid: midSmooth, treble: trebleSmooth };
}

// ============================================================
// BEAT DETECTION
// ============================================================
function detectBeat(bass, now) {
  beatCooldown = Math.max(0, beatCooldown - 1);
  
  if (bass > beatThreshold && beatCooldown === 0 && (now - lastBeatTime) > 0.25) {
    // Beat detected!
    lastBeatTime = now;
    beatCooldown = 10;
    
    // Adaptive threshold
    beatThreshold = bass * 0.85;
    setTimeout(() => { beatThreshold = Math.max(0.38, beatThreshold - 0.05); }, 500);
    
    // Dispatch global beat event
    window.dispatchEvent(new CustomEvent('beat', { detail: { intensity: bass } }));

    // Camera shake
    const shakeAmt = bass * 0.08;
    camera.position.x += (Math.random() - 0.5) * shakeAmt;
    camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.5;
    return true;
  }
  
  // Decay threshold
  beatThreshold = Math.max(0.38, beatThreshold * 0.998);
  return false;
}

// ============================================================
// CLICK SHOCKWAVE (uniform ripple at click point)
// ============================================================
let rippleUniforms = null;

document.addEventListener('click', (e) => {
  if (!oceanMaterial) return;
  // Normalize to NDC then ocean plane
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = -(e.clientY / window.innerHeight) * 2 + 1;
  
  // Brief amplitude spike at click
  const orig = oceanMaterial.uniforms.uAmplitude.value;
  oceanMaterial.uniforms.uAmplitude.value = orig + 0.3;
  setTimeout(() => {
    if (oceanMaterial) oceanMaterial.uniforms.uAmplitude.value = orig;
  }, 200);
});

// ============================================================
// VIEW TRANSITIONS
// ============================================================
const VIEW_MODES = { home: 0, youtube: 1, soundcloud: 2, library: 3, downloads: 4 };

export function setView(viewName) {
  currentView = viewName;
  if (!oceanMaterial) return;

  const target = VIEW_MODES[viewName] || 0;
  
  // Animate uniform transition
  const startMode = oceanMaterial.uniforms.uViewMode.value;
  const startTime = clock.getElapsedTime();
  const duration = 1.2;

  function transitionTick() {
    if (!oceanMaterial) return;
    const elapsed = clock.getElapsedTime() - startTime;
    const t = Math.min(elapsed / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    
    if (t < 1) {
      requestAnimationFrame(transitionTick);
    } else {
      oceanMaterial.uniforms.uViewMode.value = target;
    }
  }
  
  oceanMaterial.uniforms.uViewMode.value = target;
  
  // Camera move per view
  const camTargets = {
    home:       { x: 0, y: 4, z: 8 },
    youtube:    { x: -2, y: 3, z: 7 },
    soundcloud: { x: 2, y: 5, z: 7 },
    library:    { x: 0, y: 6, z: 6 },
    downloads:  { x: 1, y: 3, z: 9 }
  };
  const ct = camTargets[viewName] || camTargets.home;
  
  // Smooth camera to target
  const dur = 1200;
  const startCam = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const startMs = performance.now();
  
  function camAnimate() {
    const p = Math.min((performance.now() - startMs) / dur, 1);
    const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    camera.position.x = startCam.x + (ct.x - startCam.x) * e;
    camera.position.y = startCam.y + (ct.y - startCam.y) * e;
    camera.position.z = startCam.z + (ct.z - startCam.z) * e;
    camera.lookAt(0, 0, 0);
    if (p < 1) requestAnimationFrame(camAnimate);
  }
  camAnimate();
}

// ============================================================
// DYNAMIC THEME COLOR (from dominant color)
// ============================================================
export function updatePalette(colorA, colorB, colorC) {
  if (!oceanMaterial) return;
  
  const tA = new THREE.Color(colorA || 0x3CF2FF);
  const tB = new THREE.Color(colorB || 0x8B5CFF);
  const tC = new THREE.Color(colorC || 0xFF3DA5);
  
  // Smooth color transition
  const dur = 0.8;
  const startTime = clock.getElapsedTime();
  const fromA = oceanMaterial.uniforms.uColorA.value.clone();
  const fromB = oceanMaterial.uniforms.uColorB.value.clone();
  const fromC = oceanMaterial.uniforms.uColorC.value.clone();
  
  function colorTick() {
    if (!oceanMaterial) return;
    const t = Math.min((clock.getElapsedTime() - startTime) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    
    oceanMaterial.uniforms.uColorA.value.lerpColors(fromA, tA, e);
    oceanMaterial.uniforms.uColorB.value.lerpColors(fromB, tB, e);
    oceanMaterial.uniforms.uColorC.value.lerpColors(fromC, tC, e);
    
    if (t < 1) requestAnimationFrame(colorTick);
  }
  colorTick();
}

// ============================================================
// ADAPTIVE QUALITY
// ============================================================
function checkFPS(now) {
  frameCountFPS++;
  if (now - lastFPSCheck > 3000) {
    currentFPS = frameCountFPS / ((now - lastFPSCheck) / 1000);
    frameCountFPS = 0;
    lastFPSCheck = now;

    if (currentFPS < 40 && qualityLevel > 0.4) {
      qualityLevel -= 0.2;
      const dpr = Math.min(window.devicePixelRatio * qualityLevel, 1.5);
      renderer.setPixelRatio(dpr);
      
      // Reduce geometry if very low
      if (currentFPS < 30) {
        scene.fog.density = 0.06; // stronger fog = less draw distance
      }
    } else if (currentFPS > 58 && qualityLevel < 1.0) {
      qualityLevel = Math.min(1.0, qualityLevel + 0.1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio * qualityLevel, 2));
    }
  }
}

// ============================================================
// MAIN ANIMATE LOOP
// ============================================================
function animate(time) {
  if (document.hidden) return;
  
  const now = time / 1000;
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();
  
  checkFPS(time);
  
  // Audio levels
  const { bass, mid, treble } = getAudioLevels();
  
  // Beat detection
  detectBeat(bass, elapsed);
  
  // Update ocean uniforms
  if (oceanMaterial) {
    oceanMaterial.uniforms.uTime.value    = elapsed;
    oceanMaterial.uniforms.uBass.value    = bass;
    oceanMaterial.uniforms.uMid.value     = mid;
    oceanMaterial.uniforms.uTreble.value  = treble;
    oceanMaterial.uniforms.uSpeed.value   = 0.5 + mid * 0.8;
    oceanMaterial.uniforms.uAmplitude.value = 0.35 + bass * 0.4;
  }
  
  // Particle animation
  if (particleSystem && particlePositions) {
    const pos = particleSystem.geometry.attributes.position.array;
    const count = pos.length / 3;
    
    for (let i = 0; i < count; i++) {
      pos[i * 3]     += particleVelocities[i * 3]     * (1 + bass * 2);
      pos[i * 3 + 1] += particleVelocities[i * 3 + 1] * (1 + treble * 1.5);
      pos[i * 3 + 2] += particleVelocities[i * 3 + 2] * (1 + mid);
      
      // Wrap bounds
      if (pos[i * 3 + 1] > 10) { pos[i * 3 + 1] = -2; }
      if (Math.abs(pos[i * 3]) > 15)     pos[i * 3]     *= -0.9;
      if (Math.abs(pos[i * 3 + 2]) > 15) pos[i * 3 + 2] *= -0.9;
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
    
    // Scale particles on beat
    particleSystem.material.size = 0.06 + bass * 0.04;
    particleSystem.material.opacity = 0.5 + treble * 0.3;
  }
  
  // Camera parallax (mouse)
  targetCamX += (mouseX * 1.5 - targetCamX) * 0.04;
  targetCamY += (-mouseY * 0.8 - targetCamY) * 0.04;
  camera.position.x += (targetCamX - camera.position.x) * 0.06;
  camera.position.y += (targetCamY + 4 - camera.position.y) * 0.06;
  camera.lookAt(0, 0, 0);
  
  renderer.render(scene, camera);
}

// ============================================================
// EVENT HANDLERS
// ============================================================
function onResize() {
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
    mouseX = (e.gamma / 30) * 1.5;
    mouseY = ((e.beta - 30) / 30) * 0.8;
  }
}

function onVisibility() {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
  } else {
    renderer.setAnimationLoop(animate);
    clock.getDelta(); // reset delta
  }
}

// ============================================================
// DOMINANT COLOR EXTRACTION (k-means lite)
// ============================================================
export function extractDominantColors(imgEl) {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      
      // Simple bucket quantization
      let r1 = 0, g1 = 0, b1 = 0;
      let r2 = 0, g2 = 0, b2 = 0;
      let r3 = 0, g3 = 0, b3 = 0;
      let c1 = 0, c2 = 0, c3 = 0;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const brightness = (r + g + b) / 3;
        
        // Skip near-black and near-white
        if (brightness < 20 || brightness > 235) continue;
        
        const hue = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
        
        if (hue < -0.5) { r1 += r; g1 += g; b1 += b; c1++; }
        else if (hue < 1.5) { r2 += r; g2 += g; b2 += b; c2++; }
        else { r3 += r; g3 += g; b3 += b; c3++; }
      }
      
      const colors = [];
      if (c1 > 0) colors.push(`rgb(${Math.round(r1/c1)},${Math.round(g1/c1)},${Math.round(b1/c1)})`);
      if (c2 > 0) colors.push(`rgb(${Math.round(r2/c2)},${Math.round(g2/c2)},${Math.round(b2/c2)})`);
      if (c3 > 0) colors.push(`rgb(${Math.round(r3/c3)},${Math.round(g3/c3)},${Math.round(b3/c3)})`);
      
      // Fallback to theme colors
      while (colors.length < 3) colors.push(['#3CF2FF','#8B5CFF','#FF3DA5'][colors.length]);
      
      resolve(colors);
    } catch {
      resolve(['#3CF2FF', '#8B5CFF', '#FF3DA5']);
    }
  });
}
