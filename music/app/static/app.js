'use strict';

/* ==========================================================================
   ANTI-GRAVITY · ZERO-G ASTRAL SOUNDSCAPE
   app.js — Three.js WebGL Engine + Web Audio API + Full Application Logic
   ==========================================================================

   Architecture:
     1.  Utility Helpers & SVG Icons
     2.  Web Audio API — AudioContext / AnalyserNode
     3.  THREE.JS ENGINE — Anti-Gravity Audio Core + Galaxy Visualizer
     4.  Application State
     5.  Navigation
     6.  Card / Grid Rendering (Zero-G Glass Slates)
     7.  Unified Player (Audio + YouTube IFrame)
     8.  Playback Controls & Sync UI
     9.  Canvas Visualizers (Mini, Big, Sidebar, Seek Wave)
     10. Download Manager (Quantum Downloader)
     11. Library / Playlist System
     12. Custom Cursor & Micro-interactions
     13. Splash Screen & Boot Sequence
     14. Event Binding & Initialization

   Backend API Endpoints:
     GET /api/youtube/search?q=…          → { results: [...] }
     GET /api/soundcloud/search?q=…       → { results: [...] }
     GET /api/stream/audio?url=…          → audio stream (supports Range)
     GET /api/download/youtube?…          → file download
     GET /api/download/soundcloud?url=…   → file download
   ========================================================================== */

/* ═══════════════════════════════════════════════════════════
   §1. UTILITY HELPERS
═══════════════════════════════════════════════════════════ */

/** Shorthand querySelector */
const $ = (s, r = document) => r.querySelector(s);
/** Shorthand querySelectorAll → Array */
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** HTML-escape a string */
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Format seconds → m:ss or h:mm:ss */
const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600),
    m = Math.floor(s % 3600 / 60),
    x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

/** LocalStorage with JSON serialization */
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

/** Check user prefers reduced motion */
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Detect low-end GPU via canvas heuristics (used to scale particle count) */
let _gpuTier = null;
function getGPUTier() {
  if (_gpuTier !== null) return _gpuTier;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return (_gpuTier = 'low');
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '';
    if (/intel|mesa|swiftshader|mali-4|mali-t/i.test(renderer)) return (_gpuTier = 'low');
    if (/mali-g|adreno [3-5]/i.test(renderer)) return (_gpuTier = 'mid');
    return (_gpuTier = 'high');
  } catch { return (_gpuTier = 'mid'); }
}

/** Debounce factory */
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Generate a unique key for a track */
const key = t => (t.provider || 'yt') + ':' + t.id;

/** Fetch JSON from backend, throw on error */
async function api(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `Server error (${r.status})`);
  return j;
}

/* ─── Toast notification ─── */
let _toastTimer;
const toast = msg => {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
};

/* ─── Streaming URL helper ─── */
const streamUrl = t => '/api/stream/audio?url=' + encodeURIComponent(t.url);


/* ═══════════════════════════════════════════════════════════
   §2. WEB AUDIO API — AudioContext / AnalyserNode
═══════════════════════════════════════════════════════════ */

let audioCtx, analyserNode, sourceNode, freqData, timeDomainData;
const FFT_SIZE = 256; // 128 bins of frequency data

/**
 * Initialize the Web Audio chain:
 * HTMLAudioElement → MediaElementSourceNode → AnalyserNode → Destination
 * Must be called after a user gesture (play event).
 */
function initAudioContext() {
  if (audioCtx) return; // already initialized
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaElementSource($('#audio'));
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = FFT_SIZE;
    analyserNode.smoothingTimeConstant = 0.82;
    sourceNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
    freqData = new Uint8Array(analyserNode.frequencyBinCount);   // 128
    timeDomainData = new Uint8Array(analyserNode.frequencyBinCount);
  } catch (e) {
    console.warn('Web Audio API unavailable:', e);
  }
}

function resumeAudioContext() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

/**
 * Get frequency levels (0→1) as an array of `n` samples.
 * Falls back to simulated oscillation when AudioContext is unavailable
 * (e.g. during YouTube IFrame playback which blocks MediaElement source).
 */
function getFrequencyLevels(n = 32, ts = 0) {
  const out = new Float32Array(n);
  if (analyserNode && freqData) {
    analyserNode.getByteFrequencyData(freqData);
    const stride = freqData.length * 0.75 / n;
    for (let i = 0; i < n; i++) {
      out[i] = freqData[Math.floor(i * stride)] / 255;
    }
  } else {
    // Synthesized approximation for YouTube / paused states
    const pl = isPlaying();
    for (let i = 0; i < n; i++) {
      out[i] = pl
        ? 0.18 + 0.65 * Math.abs(
            Math.sin(ts / 300 + i * 0.57) *
            Math.cos(ts / 430 + i * 0.23)
          )
        : 0.04 + 0.02 * Math.abs(Math.sin(ts / 800 + i * 0.4));
    }
  }
  return out;
}

/**
 * Extract bass, mid, treble energy (0→1) from frequency data.
 */
function getAudioBands() {
  if (!analyserNode || !freqData) return { bass: 0, mid: 0, treble: 0 };
  analyserNode.getByteFrequencyData(freqData);
  const n = freqData.length;
  let bass = 0, mid = 0, treble = 0;
  // Bass: bins 0–10 (≈20–300 Hz)
  for (let i = 0; i < 10; i++) bass += freqData[i];
  bass /= 10 * 255;
  // Mid: bins 10–60 (≈300–4000 Hz)
  for (let i = 10; i < 60; i++) mid += freqData[i];
  mid /= 50 * 255;
  // Treble: bins 60–128 (≈4000–20000 Hz)
  for (let i = 60; i < n; i++) treble += freqData[i];
  treble /= (n - 60) * 255;
  return { bass, mid, treble };
}


/* ═══════════════════════════════════════════════════════════
   §3. THREE.JS ENGINE
═══════════════════════════════════════════════════════════ */

/* ── 3A. BACKGROUND STARDUST SCENE ──────────────────────── */
/**
 * Creates the full-page WebGL background:
 * - Ambient drifting stardust particle field
 * - A rotating nebula color field
 * Particles react to mouse proximity (anti-gravity repulsion).
 */
const BG = (() => {
  const canvas = $('#bgCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.z = 80;

  // ── Particle count based on GPU tier ──
  const tier = getGPUTier();
  const PARTICLE_COUNT = tier === 'high' ? 2800 : tier === 'mid' ? 1600 : 800;

  // ── Create particle geometry ──
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = [];  // drift velocities
  const originalPos = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x = (Math.random() - 0.5) * 200;
    const y = (Math.random() - 0.5) * 120;
    const z = (Math.random() - 0.5) * 100;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    originalPos[i * 3] = x;
    originalPos[i * 3 + 1] = y;
    originalPos[i * 3 + 2] = z;
    velocities.push({
      x: (Math.random() - 0.5) * 0.008,
      y: (Math.random() - 0.5) * 0.008,
      z: (Math.random() - 0.5) * 0.004
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Custom shader material for iridescent particles
  const mat = new THREE.PointsMaterial({
    size: 0.4,
    vertexColors: false,
    color: 0x4facfe,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const particles = new THREE.Points(geo, mat);
  scene.add(particles);

  // Mouse repulsion vector (normalized device coords)
  const mouse = new THREE.Vector2(9999, 9999);
  window.addEventListener('mousemove', e => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 200;
    mouse.y = -(e.clientY / window.innerHeight - 0.5) * 120;
  });

  // ── Resize handler ──
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  let _animTime = 0;
  let _lastBass = 0;

  function animate(ts) {
    requestAnimationFrame(animate);
    _animTime = ts * 0.001;
    const { bass } = getAudioBands();
    const smoothBass = _lastBass * 0.88 + bass * 0.12;
    _lastBass = smoothBass;

    const pos = geo.attributes.position.array;
    const REPULSE_RADIUS = 28;
    const REPULSE_FORCE = 0.5 + smoothBass * 2.5;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const idx = i * 3;

      // Drift
      pos[idx]     += velocities[i].x;
      pos[idx + 1] += velocities[i].y;
      pos[idx + 2] += velocities[i].z;

      // Gentle return to origin
      pos[idx]     += (originalPos[idx] - pos[idx]) * 0.0008;
      pos[idx + 1] += (originalPos[idx + 1] - pos[idx + 1]) * 0.0008;
      pos[idx + 2] += (originalPos[idx + 2] - pos[idx + 2]) * 0.0008;

      // Mouse / audio repulsion (XY plane only)
      const dx = pos[idx] - mouse.x;
      const dy = pos[idx + 1] - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < REPULSE_RADIUS && dist > 0.01) {
        const force = (REPULSE_RADIUS - dist) / REPULSE_RADIUS * REPULSE_FORCE;
        pos[idx]     += (dx / dist) * force;
        pos[idx + 1] += (dy / dist) * force;
      }
    }
    geo.attributes.position.needsUpdate = true;

    // Color shift with audio: cyan → violet → magenta
    const hue = (0.55 + smoothBass * 0.3 + _animTime * 0.02) % 1;
    mat.color.setHSL(hue, 1, 0.65);

    // Overall gentle rotation
    particles.rotation.y = _animTime * 0.04;
    particles.rotation.x = Math.sin(_animTime * 0.02) * 0.15;

    renderer.render(scene, camera);
  }
  animate(0);

  return { scene, renderer, camera };
})();

/* ── 3B. ANTI-GRAVITY AUDIO CORE (Hero Orb) ──────────────
 * A morphing deformed icosahedron that reacts to audio in real time.
 * Displayed in a small canvas in the hero section.
 */
const HeroOrb = (() => {
  const canvas = $('#heroOrbCanvas');
  if (!canvas) return null;

  const w = 200, h = 200;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 3.5;

  // ── Icosahedron Orb Mesh ──
  const geo = new THREE.IcosahedronGeometry(1.2, 5);  // detail=5 gives ~2k vertices
  // Store original positions for morph reference
  const origPositions = geo.attributes.position.array.slice();

  // Holographic shader material (custom ShaderMaterial for iridescence)
  const mat = new THREE.MeshPhongMaterial({
    color: 0x00f2fe,
    emissive: 0x4facfe,
    emissiveIntensity: 0.4,
    shininess: 120,
    transparent: true,
    opacity: 0.85,
    wireframe: false,
    side: THREE.DoubleSide,
  });

  // Semi-transparent wireframe overlay for cyberpunk look
  const wireGeo = geo.clone();
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x00f2fe,
    wireframe: true,
    transparent: true,
    opacity: 0.08,
  });
  const wireMesh = new THREE.Mesh(wireGeo, wireMat);
  scene.add(wireMesh);

  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  // Glow point light
  const light = new THREE.PointLight(0x00f2fe, 2.5, 8);
  light.position.set(0, 0, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x4facfe, 0.4));

  // Rim light for depth
  const rimLight = new THREE.PointLight(0xf72585, 1.5, 10);
  rimLight.position.set(-4, -2, -3);
  scene.add(rimLight);

  // Morph noise function (simplex-like using sin/cos)
  function noiseDisplace(x, y, z, t, bass, mid) {
    const n1 = Math.sin(x * 2.2 + t * 1.1) * Math.cos(y * 1.8 + t * 0.9) * Math.sin(z * 2.0 + t * 1.3);
    const n2 = Math.sin(x * 3.5 + t * 0.7) * Math.cos(z * 2.8 + t * 1.4);
    return (n1 * 0.15 + n2 * 0.08) * (1 + bass * 1.8) + mid * 0.15 * Math.sin(t * 3);
  }

  let _t = 0;
  let _lastBass = 0, _lastMid = 0;

  // 3D mouse tilt tracking (normalized -1 → 1)
  const orbMouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    orbMouse.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    orbMouse.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  });

  function animate(ts) {
    requestAnimationFrame(animate);
    _t = ts * 0.001;

    const { bass, mid, treble } = getAudioBands();
    _lastBass = _lastBass * 0.9 + bass * 0.1;
    _lastMid  = _lastMid  * 0.9 + mid  * 0.1;

    // Smoothly track mouse
    orbMouse.x += (orbMouse.tx - orbMouse.x) * 0.06;
    orbMouse.y += (orbMouse.ty - orbMouse.y) * 0.06;

    // Morph icosahedron vertices based on audio
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ox = origPositions[i * 3];
      const oy = origPositions[i * 3 + 1];
      const oz = origPositions[i * 3 + 2];
      const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const nx = ox / len, ny = oy / len, nz = oz / len;

      const disp = noiseDisplace(ox, oy, oz, _t, _lastBass, _lastMid);
      const r = 1.2 + disp;
      pos.setXYZ(i, nx * r, ny * r, nz * r);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    wireGeo.attributes.position.copy(pos);
    wireGeo.attributes.position.needsUpdate = true;

    // Pulsing scale on bass hits
    const scale = 1.0 + _lastBass * 0.25;
    mesh.scale.setScalar(scale);
    wireMesh.scale.setScalar(scale * 1.01);

    // Auto rotation + mouse-driven tilt
    mesh.rotation.x += 0.004 + _lastBass * 0.01;
    mesh.rotation.y += 0.006 + treble * 0.008;
    mesh.rotation.x += orbMouse.y * 0.03;
    mesh.rotation.y += orbMouse.x * 0.03;
    wireMesh.rotation.copy(mesh.rotation);

    // Color pulse: cyan → violet on bass
    const hue = 0.55 - _lastBass * 0.25;
    mat.color.setHSL(hue, 1, 0.55);
    mat.emissive.setHSL(hue + 0.05, 1, 0.45);
    light.color.setHSL(hue, 1, 0.8);
    light.intensity = 2.5 + _lastBass * 3;

    // Emissive intensity up on mid presence
    mat.emissiveIntensity = 0.3 + _lastMid * 0.6;

    renderer.render(scene, camera);
  }
  animate(0);

  return { renderer };
})();

/* ── 3C. GALAXY VISUALIZER (Fullscreen Overlay) ───────────
 * Activated via the globe button. Features:
 * - Massive particle orb that explodes / contracts with bass
 * - Neon light trails
 * - Frequency bars arranged in a 3D ring
 */
const GalaxyViz = (() => {
  const canvas = $('#galaxyCanvas');
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x030509, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  camera.position.z = 5;

  // ── Central Audio Orb (large version) ──
  const coreGeo = new THREE.IcosahedronGeometry(1.6, 6);
  const coreOrigPos = coreGeo.attributes.position.array.slice();
  const coreMat = new THREE.MeshPhongMaterial({
    color: 0x00f2fe,
    emissive: 0x7b2fff,
    emissiveIntensity: 0.5,
    shininess: 80,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const coreWire = new THREE.Mesh(
    coreGeo.clone(),
    new THREE.MeshBasicMaterial({ color: 0x00f2fe, wireframe: true, transparent: true, opacity: 0.1 })
  );
  scene.add(coreWire);
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  scene.add(coreMesh);

  // Lights
  const gal_light1 = new THREE.PointLight(0x00f2fe, 4, 20);
  gal_light1.position.set(0, 3, 3);
  scene.add(gal_light1);
  const gal_light2 = new THREE.PointLight(0xf72585, 3, 15);
  gal_light2.position.set(-4, -3, -2);
  scene.add(gal_light2);
  scene.add(new THREE.AmbientLight(0x111133, 0.5));

  // ── Frequency bar ring (64 bars arranged in a torus) ──
  const BAR_COUNT = 64;
  const barMeshes = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const angle = (i / BAR_COUNT) * Math.PI * 2;
    const barGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06);
    const barMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.8,
    });
    const bar = new THREE.Mesh(barGeo, barMat);
    const radius = 2.5;
    bar.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    bar.rotation.z = angle + Math.PI / 2;
    scene.add(bar);
    barMeshes.push({ mesh: bar, angle });
  }

  // ── Ambient stardust particles ──
  const STAR_COUNT = 1200;
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    starPos[i * 3]     = (Math.random() - 0.5) * 30;
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 30;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.05, color: 0xffffff, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  scene.add(new THREE.Points(starGeo, starMat));

  function resize() {
    const overlay = $('#galaxyOverlay');
    if (!overlay || overlay.hidden) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize, { passive: true });

  let _active = false;
  let _t = 0;
  let _lastBass = 0, _lastMid = 0, _lastTreble = 0;

  // Morph function (same as hero orb but larger scale)
  function coreNoise(x, y, z, t, bass, mid) {
    const n = Math.sin(x * 2.5 + t) * Math.cos(y * 2 + t * 1.1) * Math.sin(z * 2.2 + t * 0.9);
    return n * 0.2 * (1 + bass * 2.2) + mid * 0.12;
  }

  function animate(ts) {
    requestAnimationFrame(animate);
    if (!_active) return;
    _t = ts * 0.001;

    const { bass, mid, treble } = getAudioBands();
    _lastBass   = _lastBass   * 0.88 + bass   * 0.12;
    _lastMid    = _lastMid    * 0.90 + mid    * 0.10;
    _lastTreble = _lastTreble * 0.85 + treble * 0.15;

    // Morph core
    const pos = coreGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ox = coreOrigPos[i * 3], oy = coreOrigPos[i * 3 + 1], oz = coreOrigPos[i * 3 + 2];
      const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const d = coreNoise(ox, oy, oz, _t, _lastBass, _lastMid);
      const r = 1.6 + d;
      pos.setXYZ(i, ox / len * r, oy / len * r, oz / len * r);
    }
    pos.needsUpdate = true;
    coreGeo.computeVertexNormals();
    coreWire.geometry.attributes.position.copy(pos);
    coreWire.geometry.attributes.position.needsUpdate = true;

    const coreScale = 1 + _lastBass * 0.35;
    coreMesh.scale.setScalar(coreScale);
    coreWire.scale.setScalar(coreScale * 1.01);
    coreMesh.rotation.x += 0.003 + _lastMid * 0.008;
    coreMesh.rotation.y += 0.005 + _lastBass * 0.012;
    coreWire.rotation.copy(coreMesh.rotation);

    // Color shift
    const hue = (0.55 - _lastBass * 0.3 + _t * 0.01) % 1;
    coreMat.color.setHSL(hue, 1, 0.55);
    coreMat.emissive.setHSL((hue + 0.15) % 1, 1, 0.45);
    gal_light1.color.setHSL(hue, 1, 0.8);
    gal_light1.intensity = 3 + _lastBass * 6;
    gal_light2.intensity = 2 + _lastTreble * 4;

    // ── Frequency bar ring ──
    const freqLevels = getFrequencyLevels(BAR_COUNT, ts);
    for (let i = 0; i < BAR_COUNT; i++) {
      const { mesh: bar, angle } = barMeshes[i];
      const level = freqLevels[i];
      const barH = 0.1 + level * 2.5 * (1 + _lastBass * 1.5);
      bar.scale.y = barH;
      const radius = 2.5 + _lastBass * 0.6;
      bar.position.x = Math.cos(angle) * radius;
      bar.position.y = Math.sin(angle) * radius;

      const barHue = (hue + i / BAR_COUNT * 0.5) % 1;
      bar.material.color.setHSL(barHue, 1, 0.65);
      bar.material.opacity = 0.4 + level * 0.6;
    }

    // Rotate entire ring
    scene.rotation.z += 0.003 + _lastMid * 0.006;

    renderer.render(scene, camera);
  }
  animate(0);

  return {
    activate() {
      _active = true;
      resize();
    },
    deactivate() {
      _active = false;
    }
  };
})();


/* ═══════════════════════════════════════════════════════════
   §4. APPLICATION STATE
═══════════════════════════════════════════════════════════ */

/** Global track registry — all loaded track metadata */
const TR = {};

/** Download job list */
const DL = [];

/** Application state object */
const S = {
  queue:   [],             // Playback queue of track objects
  idx:     -1,             // Current queue index
  cur:     null,           // Currently loaded track object
  mode:    'video',        // 'video' | 'audio' (YouTube Hub mode)
  repeat:  'off',          // 'off' | 'all' | 'one'
  shuffle: false,
  lists:   store.get('lists', { 'Favourites': [] }),
  recent:  store.get('recent', [])
};

const inList = (name, t) => S.lists[name] && S.lists[name].some(x => key(x) === key(t));

function toggleFav(name, t) {
  if (!S.lists[name]) S.lists[name] = [];
  const arr = S.lists[name];
  const i = arr.findIndex(x => key(x) === key(t));
  if (i < 0) arr.push(t); else arr.splice(i, 1);
  store.set('lists', S.lists);
}


/* ═══════════════════════════════════════════════════════════
   §5. NAVIGATION
═══════════════════════════════════════════════════════════ */

function go(view) {
  $$('.ag-view').forEach(el => {
    el.classList.toggle('active', el.id === 'view-' + view);
  });
  $$('.ag-nav__btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'library')   renderLib();
  if (view === 'home')      renderRecent();
  if (view === 'downloads') renderDL();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}


/* ═══════════════════════════════════════════════════════════
   §6. CARD / GRID RENDERING — Zero-G Glass Slates
═══════════════════════════════════════════════════════════ */

/** Thumb <img> element markup */
const thumbImg = t =>
  t.thumb
    ? `<img src="${esc(t.thumb)}" loading="lazy" alt="" referrerpolicy="no-referrer">`
    : '';

/** Lucide icon HTML (inline svg via JS, size 16px) */
const icon = name => `<i data-lucide="${name}"></i>`;

/**
 * Render a single track card (Zero-G Glass Slate).
 * Stores track in TR registry for later retrieval.
 */
function card(t) {
  TR[key(t)] = t;
  const isNow = S.cur && key(S.cur) === key(t);
  const isFav = inList('Favourites', t);
  return `
  <article class="ag-card ${isNow ? 'now' : ''}" data-k="${esc(key(t))}">
    <div class="ag-card__thumb" data-act="play" title="Play in Zero-G" role="button" tabindex="0" aria-label="Play ${esc(t.title)}">
      ${thumbImg(t)}
      <span class="ag-card__dur">${fmt(t.duration)}</span>
      <div class="ag-card__play-btn" aria-hidden="true">
        <div class="ag-card__play-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
    </div>
    <div class="ag-card__body">
      <div class="ag-card__title" title="${esc(t.title)}">${esc(t.title)}</div>
      <div class="ag-card__artist">${esc(t.artist)}</div>
      <div class="ag-card__actions">
        <button class="ag-icon-btn" data-act="queue" title="Add to queue" aria-label="Add to queue">${icon('list-plus')}</button>
        <button class="ag-icon-btn ${isFav ? 'active' : ''}" data-act="fav" title="Favourite" aria-label="Favourite">${icon('heart')}</button>
        <button class="ag-icon-btn" data-act="pl" title="Add to playlist" aria-label="Add to playlist">${icon('folder-plus')}</button>
        <button class="ag-icon-btn" data-act="copy" title="Copy URL" aria-label="Copy URL">${icon('link-2')}</button>
        <button class="ag-btn ag-btn--primary ag-card__dl-btn" data-act="mp3" title="Quantum Download" aria-label="Download MP3">
          ${icon('download')}<span>DL</span>
        </button>
      </div>
    </div>
  </article>`;
}

/** Skeleton loading placeholders */
const skeletons = n =>
  Array.from({ length: n }, (_, i) =>
    `<div class="ag-sk" style="--delay:${i * 0.05}s"></div>`
  ).join('');

/** Empty state */
function emptyState(msg) {
  return `<div class="ag-empty">
    <div class="ag-empty__icon">${icon('music-2')}</div>
    <p class="ag-empty__msg">${esc(msg)}</p>
  </div>`;
}

/**
 * Search a provider, render results into `el`.
 * Shows skeletons → results → empty / error state.
 */
async function search(provider, q, el) {
  el.innerHTML = skeletons(8);
  lucide.createIcons();
  try {
    const { results } = await api(`/api/${provider}/search?q=${encodeURIComponent(q)}`);
    el.innerHTML = results?.length
      ? results.map(card).join('')
      : emptyState('No tracks found in the void. Try another query.');
    lucide.createIcons();
    bindCardTilt(el);
  } catch (err) {
    el.innerHTML = emptyState(`Transmission failure: ${esc(err.message)}`);
    lucide.createIcons();
  }
}

function renderRecent() {
  const el = $('#recent');
  if (!el) return;
  el.innerHTML = S.recent.length
    ? S.recent.map(card).join('')
    : emptyState('Tracks you play will materialize here.');
  lucide.createIcons();
  bindCardTilt(el);
}

function renderLib() {
  const el = $('#libList');
  if (!el) return;
  el.innerHTML = Object.entries(S.lists).map(([name, arr]) => `
    <div class="ag-lib-section">
      <div class="ag-lib-section__header">
        <div>
          <h3 class="ag-lib-section__title">${esc(name)}</h3>
          <span class="ag-lib-section__count">${arr.length} track${arr.length !== 1 ? 's' : ''}</span>
        </div>
        ${name !== 'Favourites'
          ? `<button class="ag-btn ag-btn--ghost" style="font-size:.7rem;padding:6px 14px" data-lrm="${esc(name)}">
              ${icon('trash-2')} Delete Playlist
            </button>`
          : ''}
      </div>
      <div class="ag-grid">
        ${arr.length ? arr.map(card).join('') : emptyState('This playlist is empty — add some tracks!')}
      </div>
    </div>`).join('');
  lucide.createIcons();
  bindCardTilt(el);
}

function renderQueue() {
  const el = $('#queueList');
  if (!el) return;
  if (!S.queue.length) {
    el.innerHTML = `<p class="mut" style="padding:20px;text-align:center;font-size:.82rem;">Queue is empty — add some tracks!</p>`;
    return;
  }
  el.innerHTML = S.queue.map((t, i) => {
    const isNow = i === S.idx;
    return `<div class="ag-qi ${isNow ? 'now' : ''}" data-qi="${i}">
      ${t.thumb ? `<img src="${esc(t.thumb)}" referrerpolicy="no-referrer" alt="">` : ''}
      <div class="ag-qi__info">
        <div class="ag-qi__title">
          ${isNow ? '<span class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>' : ''}
          ${esc(t.title)}
        </div>
        <div class="ag-qi__artist">${esc(t.artist)}</div>
      </div>
      <button class="ag-icon-btn" data-qrm="${i}" aria-label="Remove from queue">${icon('x')}</button>
    </div>`;
  }).join('');
  lucide.createIcons();
}


/* ═══════════════════════════════════════════════════════════
   §7. UNIFIED PLAYER — Audio Element + YouTube IFrame
═══════════════════════════════════════════════════════════ */

const audio = $('#audio');
let yt = null, ytReady = false, ytPending = null;

/** Is the player in YouTube video mode? */
const usingYT = () => S.cur?.provider === 'youtube' && S.mode === 'video';
const ytOK    = () => yt && typeof yt.getPlayerState === 'function';
const isPlaying = () =>
  usingYT()
    ? ytOK() && yt.getPlayerState() === 1
    : !audio.paused;
const currentPos  = () => usingYT() ? (ytOK() ? yt.getCurrentTime() : 0) : audio.currentTime || 0;
const currentDur  = () =>
  usingYT()
    ? (ytOK() ? yt.getDuration() : 0) || S.cur?.duration || 0
    : (isFinite(audio.duration) ? audio.duration : 0) || S.cur?.duration || 0;
const seekTo = t => usingYT() ? ytOK() && yt.seekTo(t, true) : (audio.currentTime = t);

/* ── YouTube IFrame Player ── */
window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('ytPlayer', {
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1 },
    events: {
      onReady: () => {
        ytReady = true;
        if (ytPending) {
          yt.loadVideoById(ytPending.id, ytPending.t);
          ytPending = null;
        }
      },
      onStateChange: e => {
        if (e.data === 1) audio.pause(); // YT playing → stop audio
        if (e.data === 0 && usingYT()) next(true); // ended → next
        syncPlayPauseBtn();
        syncPlayerClass();
      }
    }
  });
};

// Inject YouTube IFrame API script
(function injectYTApi() {
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.async = true;
  document.head.appendChild(s);
})();

/* ── Audio element events ── */
audio.addEventListener('play', () => {
  initAudioContext();
  resumeAudioContext();
  if (ytOK() && yt.getPlayerState() === 1) yt.pauseVideo();
  syncPlayPauseBtn();
  syncPlayerClass();
});
audio.addEventListener('pause', () => { syncPlayPauseBtn(); syncPlayerClass(); });
audio.addEventListener('ended', () => next(true));
audio.addEventListener('error', () => {
  if (!S.cur || usingYT() || !audio.getAttribute('src')) return;
  if (S.cur.provider === 'youtube') {
    toast('Audio extraction failed — switching to embedded player.');
    setMode('video', true);
  } else {
    toast('Track unavailable — try another.');
  }
});

/* ── Load / play helpers ── */
function ytLoad(t, start = 0) {
  if (ytReady) yt.loadVideoById(t.id, start);
  else ytPending = { id: t.id, t: start };
}

function audioLoad(t, start = 0) {
  audio.src = streamUrl(t);
  if (start > 0) {
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = start; }, { once: true });
  }
  audio.play().catch(() => {});
}

function loadTrack(t, start = 0) {
  S.cur = t;

  // Add to recent
  S.recent = [t, ...S.recent.filter(x => key(x) !== key(t))].slice(0, 20);
  store.set('recent', S.recent);

  // Stop all current playback
  if (ytOK()) yt.pauseVideo();
  audio.pause();

  // Start new playback
  if (usingYT()) ytLoad(t, start);
  else audioLoad(t, start);

  syncUI();
  renderQueue();

  // First-play confetti
  if (!sessionStorage.getItem('agFirstPlay')) {
    sessionStorage.setItem('agFirstPlay', '1');
    burstConfetti(window.innerWidth / 2, window.innerHeight * 0.7, 20);
  }

  // GSAP art flip animation
  gsap.fromTo('#pArt', { rotateY: 90, scale: 0.8 }, { rotateY: 0, scale: 1, duration: 0.6, ease: 'back.out(1.7)' });
}

function toggle() {
  if (!S.cur) return toast('Select a track first — the void awaits.');
  if (usingYT()) {
    ytOK() && (isPlaying() ? yt.pauseVideo() : yt.playVideo());
  } else {
    audio.paused ? audio.play() : audio.pause();
  }
}

function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') {
    seekTo(0);
    usingYT() ? yt.playVideo() : audio.play();
    return;
  }
  let i;
  if (S.shuffle && S.queue.length > 1) {
    do { i = Math.floor(Math.random() * S.queue.length); } while (i === S.idx);
  } else {
    i = S.idx + 1;
  }
  if (i >= S.queue.length) {
    if (S.repeat === 'all' || !auto) i = 0; else return;
  }
  S.idx = i;
  loadTrack(S.queue[i]);
}

function prev() {
  if (currentPos() > 3 || S.idx <= 0) { seekTo(0); return; }
  S.idx--;
  loadTrack(S.queue[S.idx]);
}

function playFrom(cardEl) {
  const allCards = $$('[data-k]', cardEl.parentElement);
  const list = allCards.map(c => TR[c.dataset.k]).filter(Boolean);
  const t = TR[cardEl.dataset.k];
  S.queue = list;
  S.idx = list.indexOf(t);
  loadTrack(t);
}

function enqueue(t) {
  S.queue.push(t);
  if (S.idx < 0) { S.idx = 0; loadTrack(t); }
  renderQueue();
  toast(`Added "${t.title}" to the queue.`);
}

function setMode(m, force = false) {
  if (m === S.mode && !force) return;
  const t = S.cur, playing = isPlaying(), at = currentPos();
  S.mode = m;

  if (ytOK()) yt.pauseVideo();
  audio.pause();

  if (m === 'video') { audio.removeAttribute('src'); audio.load(); }

  $$('#modeSeg .ag-seg__btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#ytVideoWrap').hidden = m !== 'video';
  $('#ytAudioWrap').hidden = m !== 'audio';
  $('#modeHint').textContent = m === 'video' ? 'YouTube embedded player' : 'Audio-only — saves bandwidth';

  if (t?.provider === 'youtube' && (playing || at > 0 || force)) {
    if (m === 'video') ytLoad(t, at);
    else audioLoad(t, at);
  }
}


/* ═══════════════════════════════════════════════════════════
   §8. SYNC UI
═══════════════════════════════════════════════════════════ */

function syncUI() {
  const t = S.cur;
  if (!t) return;

  // Player bar
  $('#pTitle').textContent = t.title;
  $('#pArtist').textContent = t.artist;
  $('#pArt').src = t.thumb || '';
  $('#pArt').onerror = () => { $('#pArt').src = ''; };

  // Galaxy overlay
  $('#galaxyTitle').textContent = t.title;
  $('#galaxyArtist').textContent = t.artist;

  // YouTube stage
  const isYT = t.provider === 'youtube';
  if ($('#ytTitle'))  $('#ytTitle').textContent  = isYT ? t.title : 'No Track Selected';
  if ($('#ytArtist')) $('#ytArtist').textContent = isYT ? t.artist : 'Select a result below';
  if ($('#ytArt'))    $('#ytArt').src            = isYT ? (t.thumb || '') : '';

  // SoundCloud stage
  if ($('#scTitle'))  $('#scTitle').textContent  = !isYT ? t.title : 'No Track Selected';
  if ($('#scArtist')) $('#scArtist').textContent = !isYT ? t.artist : 'Find and select a track';
  if ($('#scArt'))    $('#scArt').src            = !isYT ? (t.thumb || '') : '';

  // Highlight now-playing cards
  $$('.ag-card').forEach(c => c.classList.toggle('now', c.dataset.k === key(t)));

  document.title = `${t.title} · Anti-Gravity`;

  syncPlayPauseBtn();
}

function syncPlayPauseBtn() {
  const pl = isPlaying();
  const icon = pl ? 'pause' : 'play';
  const ppEl = $('#ppIcon');
  if (ppEl) {
    ppEl.setAttribute('data-lucide', icon);
    lucide.createIcons({ attrs: { 'stroke-width': 2, fill: pl ? 'var(--bg-void-1)' : 'var(--bg-void-1)' } });
  }
}

function syncPlayerClass() {
  $('#player')?.classList.toggle('is-playing', isPlaying());
}


/* ═══════════════════════════════════════════════════════════
   §9. CANVAS VISUALIZERS
═══════════════════════════════════════════════════════════ */

/** Fit a canvas to its CSS size (handles HiDPI) */
function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
  if (!w || !h) return null;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

/**
 * Draw aurora frequency bars (mini visualizer for player bar or sidebar).
 */
function drawBars(canvas, freqLevels, opts = {}) {
  const f = fitCanvas(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const n = freqLevels.length;
  const gap = opts.gap ?? 1;
  const bw = (w / n) - gap;

  for (let i = 0; i < n; i++) {
    const level = freqLevels[i];
    const bh = Math.max(2 * f.dpr, level * h * 0.95);
    const x = i * (bw + gap);
    const y = h - bh;

    // Color: cyan → violet → magenta based on frequency band
    const hue = 180 + i / n * 180; // 180 (cyan) → 300 (magenta)
    ctx.fillStyle = `hsl(${hue}, 100%, ${50 + level * 25}%)`;

    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, [bw / 2, bw / 2, 1, 1]);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, bw, bh);
    }
  }
}

/**
 * Draw a big frequency visualizer (YouTube audio stage).
 */
function drawBigBars(canvas, freqLevels) {
  const f = fitCanvas(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const n = freqLevels.length;
  const bw = w / n;

  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#00f2fe');
  grad.addColorStop(0.5, '#4facfe');
  grad.addColorStop(1, '#f72585');

  for (let i = 0; i < n; i++) {
    const bh = Math.max(2, freqLevels[i] * h);
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh, [bw * 0.35, bw * 0.35, 1, 1]);
    } else {
      ctx.rect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh);
    }
    ctx.fill();
  }
}

/** Pre-computed pseudo-waveform seeded from track ID */
const _waveCache = {};
function getWaveform(trackId, n = 80) {
  if (_waveCache[trackId]) return _waveCache[trackId];
  let h = 7;
  for (const ch of (trackId || 'ag')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  _waveCache[trackId] = Array.from({ length: n }, () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return 0.15 + 0.85 * (h / 4294967296);
  });
  return _waveCache[trackId];
}

/**
 * Draw SoundCloud-style waveform on canvas.
 */
function drawWave(canvas, track, progressFrac, playing, ts) {
  const f = fitCanvas(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const wv = getWaveform(track.id, 80);
  const n = wv.length;
  const bw = w / n;
  const playing_k = playing ? 0.85 + 0.15 * Math.sin(ts / 150) : 1;

  const gradPlayed = ctx.createLinearGradient(0, 0, w, 0);
  gradPlayed.addColorStop(0, '#00f2fe');
  gradPlayed.addColorStop(1, '#4facfe');

  for (let i = 0; i < n; i++) {
    const amp = wv[i] * playing_k;
    const bh = amp * h;
    const x = i * bw + bw * 0.15;
    const y = (h - bh) / 2;

    ctx.fillStyle = i / n < progressFrac
      ? gradPlayed
      : 'rgba(0, 242, 254, 0.18)';

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, bw * 0.7, bh, bw * 0.35);
    } else {
      ctx.rect(x, y, bw * 0.7, bh);
    }
    ctx.fill();
  }
}

/**
 * Draw seek wave (behind the seek range input).
 */
function drawSeekWave(canvas, progressFrac, ts) {
  const f = fitCanvas(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const n = 80;
  const wv = S.cur ? getWaveform(S.cur.id, n) : Array(n).fill(0.5);
  const bw = w / n;
  const playing = isPlaying();
  const anim = playing ? 0.9 + 0.1 * Math.sin(ts / 200) : 1;

  for (let i = 0; i < n; i++) {
    const amp = wv[i] * anim;
    const bh = amp * h;
    const x = i * bw;
    const y = (h - bh) / 2;
    ctx.fillStyle = i / n < progressFrac
      ? 'rgba(0, 242, 254, 0.5)'
      : 'rgba(0, 242, 254, 0.08)';
    ctx.fillRect(x, y, bw - 0.5, bh);
  }
}

/** RAF render loop — drives all canvas visualizers and player sync */
let _lastPlayingState = null;
function frame(ts) {
  requestAnimationFrame(frame);
  const p = currentPos(), d = currentDur(), pl = isPlaying();
  const seek = $('#seek');

  // Update seek scrubber (don't update while user is dragging)
  if (document.activeElement !== seek && seek) {
    seek.max = d || 1;
    seek.value = p;

    const tooltip = $('#seekTooltip');
    if (tooltip && d) {
      tooltip.style.left = `${(p / d) * 100}%`;
      tooltip.textContent = fmt(p);
    }
  }

  // Time displays
  const tCur = $('#tCur'), tDur = $('#tDur');
  if (tCur) tCur.textContent = fmt(p);
  if (tDur) tDur.textContent = fmt(d);

  // Playing state change
  if (pl !== _lastPlayingState) {
    _lastPlayingState = pl;
    syncPlayPauseBtn();
    syncPlayerClass();

    // Disc animation
    const disc = $('#scDisc');
    if (disc) disc.classList.toggle('playing', pl && S.cur?.provider === 'soundcloud');
    // Tonearm
    const tonearm = $('#scTonearm');
    if (tonearm) tonearm.classList.toggle('playing', pl && S.cur?.provider === 'soundcloud');
    // Art wrap
    const ytArtWrap = $('#ytArtWrap');
    if (ytArtWrap) ytArtWrap.classList.toggle('playing', pl);
  }

  // Skip rendering if tab not visible (battery / CPU saving)
  if (document.hidden) return;

  const levels32  = getFrequencyLevels(32, ts);
  const levels16  = getFrequencyLevels(16, ts);

  // Mini visualizer (player bar)
  const vizCanvas = $('#viz');
  if (vizCanvas) drawBars(vizCanvas, levels32, { gap: 1 });

  // Sidebar strip
  const sideViz = $('#sidebarVizCanvas');
  if (sideViz) drawBars(sideViz, levels16, { gap: 1 });

  // Big visualizer (YouTube audio mode)
  const vizBig = $('#vizBig');
  if (vizBig && !$('#ytAudioWrap')?.hidden) {
    drawBigBars(vizBig, getFrequencyLevels(48, ts));
  }

  // SoundCloud waveform
  const scWave = $('#scWave');
  if (scWave && S.cur?.provider === 'soundcloud' && $('#view-soundcloud')?.classList.contains('active')) {
    drawWave(scWave, S.cur, d ? p / d : 0, pl, ts);
  }

  // Seek wave
  const seekWave = $('#seekWave');
  if (seekWave) drawSeekWave(seekWave, d ? p / d : 0, ts);
}


/* ═══════════════════════════════════════════════════════════
   §10. QUANTUM DOWNLOAD MANAGER
═══════════════════════════════════════════════════════════ */

let _dlPaint = false;
function renderDL() {
  if (_dlPaint) return;
  _dlPaint = true;
  requestAnimationFrame(() => {
    _dlPaint = false;
    const el = $('#dlList');
    if (!el) return;
    if (!DL.length) {
      el.innerHTML = `<p class="mut" style="margin-top:20px;text-align:center;font-size:.82rem;letter-spacing:.06em;">No downloads yet — paste a URL above to materialize audio.</p>`;
      return;
    }
    el.innerHTML = DL.map(j => {
      const statusText = {
        prep: 'Preparing quantum extraction…',
        dl: `Streaming — ${(j.got / 1048576).toFixed(1)} MB`,
        done: `Materialized: ${esc(j.name)}`,
        err: `Transmission error: ${esc(j.err)}`
      }[j.state] || '';
      return `
      <div class="ag-dl-job ${j.state === 'err' ? 'err' : ''} ${j.state === 'done' ? 'done' : ''}">
        <div>
          <div class="ag-dl-job__title">${esc(j.title)}</div>
          <div class="ag-dl-job__status">${statusText}</div>
        </div>
        <div class="ag-dl-job__bar ${j.state === 'prep' ? 'indeterminate' : ''}">
          <div class="ag-dl-job__bar-fill" style="width:${j.state === 'done' ? 100 : (j.pct || 0)}%"></div>
        </div>
      </div>`;
    }).join('');
  });
}

async function download(t, mode, height) {
  const isYT = t.provider !== 'soundcloud';
  const q = isYT
    ? `/api/download/youtube?${t.id ? 'video_id=' + t.id : 'url=' + encodeURIComponent(t.url)}&mode=${mode}&height=${height || 720}`
    : `/api/download/soundcloud?url=${encodeURIComponent(t.url)}`;

  const job = {
    title: `${t.title} · ${mode === 'mp3' ? 'MP3' : 'Video ' + (height || 720) + 'p'}`,
    state: 'prep', pct: 0, got: 0, name: '', err: ''
  };
  DL.unshift(job);
  renderDL();
  toast('Quantum extraction initiated — check Downloads for progress.');
  go('downloads');

  try {
    const r = await fetch(q);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);

    const total = +(r.headers.get('content-length') || 0);
    const reader = r.body.getReader();
    const chunks = [];
    job.state = 'dl';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      job.got += value.length;
      job.pct = total ? (job.got / total) * 100 : 50;
      renderDL();
    }

    // Parse filename from Content-Disposition header
    const cd = r.headers.get('content-disposition') || '';
    const mFn = cd.match(/filename\*=utf-8''([^;]+)/i) || cd.match(/filename="?([^";]+)/i);
    job.name = mFn ? decodeURIComponent(mFn[1]) : 'download';

    const blob = new Blob(chunks);
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: job.name
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);

    job.state = 'done';
    toast(`Materialized: ${job.name}`);
    burstConfetti(window.innerWidth / 2, window.innerHeight * 0.4, 22);
  } catch (err) {
    job.state = 'err';
    job.err = err.message;
    toast(`Download failed: ${err.message}`);
  }
  renderDL();
}


/* ═══════════════════════════════════════════════════════════
   §11. LIBRARY / PLAYLIST SYSTEM
═══════════════════════════════════════════════════════════ */

function pickList(t) {
  const m = $('#modal');
  if (!m) return;
  m.innerHTML = `<div class="ag-modal-box">
    <h3>ADD TO PLAYLIST</h3>
    ${Object.keys(S.lists).map(n =>
      `<button class="ag-pick-btn" data-pk="${esc(n)}">
        ${inList(n, t) ? '✓ ' : ''}${esc(n)}
      </button>`).join('')}
    <button class="ag-btn ag-btn--ghost" style="margin-top:6px" data-close>Close</button>
  </div>`;
  m.classList.add('open');
  lucide.createIcons();

  m.onclick = e => {
    const pkBtn = e.target.closest('[data-pk]');
    if (pkBtn) { toggleFav(pkBtn.dataset.pk, t); return pickList(t); }
    if (e.target === m || e.target.closest('[data-close]')) {
      m.classList.remove('open');
      renderLib();
    }
  };
}


/* ═══════════════════════════════════════════════════════════
   §12. MICRO-INTERACTIONS
═══════════════════════════════════════════════════════════ */

/** Ripple effect on buttons */
function createRipple(e, el) {
  if (prefersReducedMotion()) return;
  const rect = el.getBoundingClientRect();
  const d = Math.max(rect.width, rect.height);
  const span = document.createElement('span');
  span.className = 'ripple-circle';
  span.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - rect.left - d / 2}px;top:${e.clientY - rect.top - d / 2}px`;
  el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.appendChild(span);
  setTimeout(() => span.remove(), 700);
}

/** Confetti burst */
function burstConfetti(x, y, count = 12) {
  if (prefersReducedMotion()) return;
  const symbols = ['◆', '◇', '○', '✦', '★', '·'];
  const colors = ['#00f2fe', '#4facfe', '#7b2fff', '#f72585', '#00d4aa', '#fbbf24'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle-confetti';
    p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.color = colors[Math.floor(Math.random() * colors.length)];
    p.style.fontSize = `${Math.random() * 10 + 12}px`;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 90 + 40;
    p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--ty', `${Math.sin(angle) * dist - 40}px`);
    p.style.setProperty('--tr', `${(Math.random() - 0.5) * 480}deg`);
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

/** 3D tilt effect on cards (physics-based, max ±8°) */
function bindCardTilt(container) {
  if (prefersReducedMotion() || ('ontouchstart' in window)) return;
  $$('.ag-card', container).forEach(c => {
    if (c._tilt) return;
    c._tilt = true;
    c.addEventListener('mousemove', e => {
      const rect = c.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5 → 0.5
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      c.style.transform = `perspective(900px) rotateX(${-ny * 12}deg) rotateY(${nx * 12}deg) translateY(-6px) scale(1.02)`;
    });
    c.addEventListener('mouseleave', () => {
      c.style.transform = '';
    });
  });
}

/** Custom cursor (desktop only) */
function initCustomCursor() {
  const curEl = $('#agCursor');
  if (!curEl || ('ontouchstart' in window)) return;

  const dot = curEl.querySelector('.ag-cursor__dot');
  const ring = curEl.querySelector('.ag-cursor__ring');
  if (!dot || !ring) return;

  let mx = -200, my = -200;
  let rx = -200, ry = -200;

  window.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    curEl.style.transform = `translate(${mx}px, ${my}px)`;
  });

  // Lerp ring for smoothness
  (function lerpCursor() {
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx - mx}px, ${ry - my}px)`;
    requestAnimationFrame(lerpCursor);
  })();

  document.addEventListener('mouseover', e => {
    const hoverable = e.target.closest('button, a, input, select, .ag-card, .ag-brand, .ag-qi, [role="button"]');
    document.body.classList.toggle('cursor-hover', !!hoverable);
  });
}


/* ═══════════════════════════════════════════════════════════
   §13. SPLASH SCREEN & BOOT SEQUENCE
═══════════════════════════════════════════════════════════ */

function initSplash() {
  const splash = $('#splashScreen');
  const statusEl = $('#splashStatus');
  if (!splash) return;

  const messages = [
    'Initializing quantum core…',
    'Calibrating anti-gravity field…',
    'Connecting to astral network…',
    'Loading audio engine…',
    'Zero-G online.'
  ];

  let mi = 0;
  const statusInterval = setInterval(() => {
    if (++mi < messages.length && statusEl) statusEl.textContent = messages[mi];
    else clearInterval(statusInterval);
  }, 280);

  const seen = sessionStorage.getItem('agSplashSeen');
  const delay = seen ? 500 : 1600;

  setTimeout(() => {
    splash.classList.add('hide');
    sessionStorage.setItem('agSplashSeen', '1');
    setTimeout(() => splash.remove(), 800);

    // GSAP entrance animations for sidebar and hero
    gsap.from('.ag-sidebar', { x: -60, opacity: 0, duration: 0.8, ease: 'power3.out', delay: 0.1 });
    gsap.from('.ag-hero__text', { y: 30, opacity: 0, duration: 0.9, ease: 'power3.out', delay: 0.3 });
    gsap.from('.ag-hero__orb-wrap', { scale: 0.6, opacity: 0, duration: 1.1, ease: 'back.out(1.5)', delay: 0.5 });
    gsap.from('.ag-search-deck', { y: 20, opacity: 0, duration: 0.7, ease: 'power3.out', delay: 0.6 });
    gsap.from('.ag-player', { y: 100, opacity: 0, duration: 0.8, ease: 'power3.out', delay: 0.8 });
  }, delay);
}


/* ═══════════════════════════════════════════════════════════
   §14. EVENT BINDING & INITIALIZATION
═══════════════════════════════════════════════════════════ */

/* ── GLOBAL CLICK HANDLER (event delegation) ── */
document.addEventListener('click', e => {
  // Ripple on interactive elements
  const rippleEl = e.target.closest('.ag-btn, .ag-icon-btn, .ag-player__play-btn, .ag-nav__btn, .ag-pick-btn, .ag-seg__btn');
  if (rippleEl) createRipple(e, rippleEl);

  // Navigation
  const navBtn = e.target.closest('.ag-nav__btn[data-view]');
  if (navBtn) { go(navBtn.dataset.view); return; }

  // Brand easter egg
  const brand = e.target.closest('.ag-brand');
  if (brand) {
    const rect = brand.getBoundingClientRect();
    burstConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2, 16);
    const quotes = [
      'Floating through the cosmos with you.',
      'Anti-gravity engaged. Enjoy the ride.',
      'Your music, weightless and infinite.',
      'The void sings. Can you hear it?'
    ];
    toast(quotes[Math.floor(Math.random() * quotes.length)]);
    return;
  }

  // Queue item click
  const qItem = e.target.closest('[data-qi]');
  const qRemove = e.target.closest('[data-qrm]');
  if (qRemove) {
    const i = +qRemove.dataset.qrm;
    S.queue.splice(i, 1);
    if (i < S.idx) S.idx--;
    renderQueue();
    return;
  }
  if (qItem) {
    S.idx = +qItem.dataset.qi;
    loadTrack(S.queue[S.idx]);
    return;
  }

  // Remove playlist
  const lrm = e.target.closest('[data-lrm]');
  if (lrm) {
    if (confirm(`Delete playlist "${lrm.dataset.lrm}"?`)) {
      delete S.lists[lrm.dataset.lrm];
      store.set('lists', S.lists);
      renderLib();
    }
    return;
  }

  // Card / Stage action buttons [data-act]
  const actBtn = e.target.closest('[data-act]');
  if (!actBtn) return;

  const cardEl = actBtn.closest('[data-k]');
  const stageEl = actBtn.closest('[data-stage]');
  const act = actBtn.dataset.act;

  if (act === 'play') { playFrom(cardEl); return; }
  if (stageEl && S.cur?.provider !== stageEl.dataset.stage) {
    toast('Select a track from this section first.');
    return;
  }

  const t = cardEl ? TR[cardEl.dataset.k] : S.cur;
  if (!t) { toast('Select a track first.'); return; }

  ({
    queue: () => enqueue(t),
    pl:    () => pickList(t),
    mp3:   () => { burstConfetti(e.clientX, e.clientY, 10); download(t, 'mp3'); },
    video: () => { burstConfetti(e.clientX, e.clientY, 10); download(t, 'video', +($('#ytQ')?.value || 720)); },
    fav: () => {
      toggleFav('Favourites', t);
      const isFav = inList('Favourites', t);
      actBtn.classList.toggle('active', isFav);
      isFav
        ? (burstConfetti(e.clientX, e.clientY, 12), toast('Added to Favourites!'))
        : toast('Removed from Favourites.');
    },
    copy: () => {
      navigator.clipboard.writeText(t.url || '').then(
        () => toast('URL copied to clipboard.'),
        () => toast(t.url)
      );
    }
  })[act]?.();
});

/* ── Mode Segmented Control ── */
$('#modeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode);
});

/* ── Search Forms ── */
$('#homeForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (!q) return;
  const homeRes = $('#homeRes');
  if (homeRes) homeRes.hidden = false;
  search('youtube', q, $('#homeYT'));
  search('soundcloud', q, $('#homeSC'));
});

$('#ytForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) search('youtube', q, $('#ytResults'));
});

$('#scForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) search('soundcloud', q, $('#scResults'));
});

/* ── New Playlist Form ── */
$('#newList').addEventListener('submit', e => {
  e.preventDefault();
  const name = e.target.n.value.trim();
  if (!name) return toast('Enter a playlist name.');
  if (S.lists[name]) return toast('Playlist already exists.');
  S.lists[name] = [];
  store.set('lists', S.lists);
  e.target.reset();
  renderLib();
  toast(`Playlist "${name}" created!`);
  burstConfetti(window.innerWidth / 2, window.innerHeight * 0.4, 14);
});

/* ── Download Form ── */
$('#dlForm').addEventListener('submit', e => {
  e.preventDefault();
  const u = e.target.u.value.trim();
  const m = e.target.m.value;
  if (!u) return;
  const isSC = /soundcloud\.com/i.test(u);
  download(
    { provider: isSC ? 'soundcloud' : 'youtube', id: '', title: u, url: u },
    isSC ? 'mp3' : m.startsWith('video') ? 'video' : 'mp3',
    m === 'video1080' ? 1080 : 720
  );
  e.target.reset();
});

/* ── Player Controls ── */
$('#bPlay').addEventListener('click', toggle);
$('#bNext').addEventListener('click', () => next(false));
$('#bPrev').addEventListener('click', prev);

$('#bShuffle').addEventListener('click', e => {
  S.shuffle = !S.shuffle;
  e.currentTarget.classList.toggle('active', S.shuffle);
  toast(S.shuffle ? 'Shuffle ON — randomize the void.' : 'Shuffle OFF.');
});

$('#bRepeat').addEventListener('click', e => {
  S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat];
  const btn = e.currentTarget;
  btn.classList.toggle('active', S.repeat !== 'off');
  btn.classList.toggle('repeat-one', S.repeat === 'one');
  const badge = $('#repeatBadge');
  if (badge) badge.style.display = S.repeat === 'one' ? 'flex' : 'none';
  toast({ off: 'Repeat OFF', all: 'Repeat ALL', one: 'Repeat ONE' }[S.repeat]);
});

/* ── Queue ── */
$('#bQueue').addEventListener('click', () => {
  renderQueue();
  $('#queueDrawer').classList.toggle('open');
});
$('[data-close-q]').addEventListener('click', () => {
  $('#queueDrawer').classList.remove('open');
});

/* ── Seek ── */
$('#seek').addEventListener('input', e => {
  const val = +e.target.value;
  seekTo(val);
  const tt = $('#seekTooltip');
  if (tt) { tt.style.left = `${(val / (currentDur() || 1)) * 100}%`; tt.textContent = fmt(val); }
});

/* ── Volume ── */
$('#vol').addEventListener('input', e => {
  audio.volume = +e.target.value;
  ytOK() && yt.setVolume(e.target.value * 100);
});

/* ── SoundCloud wave seek ── */
$('#scWave').addEventListener('pointerdown', e => {
  const r = e.target.getBoundingClientRect();
  seekTo((e.clientX - r.left) / r.width * currentDur());
});

/* ── Galaxy Visualizer toggle ── */
$('#bVizToggle').addEventListener('click', () => {
  const overlay = $('#galaxyOverlay');
  overlay.hidden = false;
  overlay.removeAttribute('aria-hidden');
  GalaxyViz?.activate();
  gsap.from('#galaxyCanvas', { opacity: 0, scale: 0.95, duration: 0.6, ease: 'power2.out' });
});
$('#bGalaxyClose').addEventListener('click', () => {
  const overlay = $('#galaxyOverlay');
  GalaxyViz?.deactivate();
  gsap.to('#galaxyCanvas', {
    opacity: 0, scale: 0.95, duration: 0.4, ease: 'power2.in',
    onComplete: () => { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); gsap.set('#galaxyCanvas', { opacity: 1, scale: 1 }); }
  });
});

/* ── Keyboard shortcuts ── */
addEventListener('keydown', e => {
  // Space → toggle play/pause (skip if focus is on form element)
  if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) {
    e.preventDefault();
    toggle();
  }
  // Escape → close modal, queue drawer, galaxy
  if (e.key === 'Escape') {
    $('#modal').classList.remove('open');
    $('#queueDrawer').classList.remove('open');
    const overlay = $('#galaxyOverlay');
    if (!overlay.hidden) { GalaxyViz?.deactivate(); overlay.hidden = true; }
  }
  // Arrow keys → seek ±5s
  if (e.key === 'ArrowRight' && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
    e.preventDefault(); seekTo(Math.min(currentPos() + 5, currentDur()));
  }
  if (e.key === 'ArrowLeft' && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
    e.preventDefault(); seekTo(Math.max(currentPos() - 5, 0));
  }
});

/* ── Resize ── */
window.addEventListener('resize', () => {
  // Galaxy canvas resize
  if ($('#galaxyOverlay') && !$('#galaxyOverlay').hidden) GalaxyViz?.activate();
}, { passive: true });

/* ── Lucide Icons ── */
// Initialize all icons declared as data-lucide attributes
lucide.createIcons();

/* ── Boot ── */
renderRecent();
renderDL();
initCustomCursor();
initSplash();
requestAnimationFrame(frame);

/* Minimal GSAP float animation on already-rendered cards in home view */
gsap.delayedCall(0.1, () => {
  // Magnetic hover on search pill
  const pill = $('.ag-search-pill');
  if (pill) {
    pill.addEventListener('mousemove', e => {
      const r = pill.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width - 0.5) * 8;
      const ny = ((e.clientY - r.top) / r.height - 0.5) * 4;
      gsap.to(pill, { x: nx, y: ny, duration: 0.3, ease: 'power1.out' });
    });
    pill.addEventListener('mouseleave', () => {
      gsap.to(pill, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    });
  }

  // Staggered hero title letters
  gsap.from('.ag-hero__title-line1', { opacity: 0, y: 20, duration: 0.7, ease: 'power3.out', delay: 1.2 });
  gsap.from('.ag-hero__title-line2', { opacity: 0, y: 20, duration: 0.7, ease: 'power3.out', delay: 1.4 });
  gsap.from('.ag-hero__subtitle',    { opacity: 0, y: 10, duration: 0.5, ease: 'power3.out', delay: 1.6 });
});
