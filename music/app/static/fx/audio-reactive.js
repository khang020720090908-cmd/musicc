/**
 * fx/audio-reactive.js — Audio Reactive Animations
 * Sóng · Media Hub — Hello Kitty Milk Pink Theme
 * Nhận dữ liệu từ window.__analyser (set bởi app.js)
 * Phát CustomEvent 'song:levels' mỗi frame với {bass, mid, treble}
 * Phát CustomEvent 'song:beat' khi phát hiện beat
 */

// ─── Màu theme (hardcode theo spec) ─────────────────────────────────────────
const COLOR_CYAN     = '#FF5C8A';
const COLOR_VIOLET   = '#E8344E';
const COLOR_HOTPINK  = '#FF8FB1';
const COLOR_AMBER    = '#FFD966';

// ─── Kiểm tra prefers-reduced-motion ────────────────────────────────────────
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── Trạng thái nội bộ ───────────────────────────────────────────────────────
let _rafId = null;
let _running = false;

// EWMA smoothing state
let _smoothBass   = 0;
let _smoothMid    = 0;
let _smoothTreble = 0;
const EWMA_FACTOR = 0.15;

// Beat detection state
let _beatThreshold  = 0.42;
let _lastBeatTime   = 0;
const BEAT_COOLDOWN = 250; // ms

// YT beat simulator state
let _ytBeatInterval  = null;
let _ytBPM           = 120;
let _simPhase        = 0;  // rad, cho sin-wave simulator
let _simLastTime     = 0;

// Confetti pool
let _confettiPool = [];

// Cleanup handlers
let _cleanupFns = [];

// ─────────────────────────────────────────────────────────────────────────────
// 1. init() — Khởi chạy
// ─────────────────────────────────────────────────────────────────────────────
export function init() {
  _injectCSS();
  _bindBeatReactions();
  _setupAuroraReactive();
  _setupPlayerGlow();
  _setupDiscGlow();

  // Nếu không có real analyser → chạy YT beat simulator
  if (!window.__analyser) {
    initYTBeatSimulator();
  }

  // Hook vào RAF chung của scroll.js nếu có, không thì tự mở loop riêng
  if (window.SONG_RAF && window.SONG_RAF.callbacks) {
    window.SONG_RAF.callbacks.add(_rafTick);
    _cleanupFns.push(() => window.SONG_RAF.callbacks.delete(_rafTick));
  } else {
    _startOwnRAF();
  }

  _running = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. getAudioLevels() — Đọc analyser và trả về {bass, mid, treble}
// ─────────────────────────────────────────────────────────────────────────────
export function getAudioLevels() {
  const analyser = window.__analyser;

  if (analyser) {
    // ── Real analyser ──────────────────────────────────────────────────────
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    // Tính index theo tỉ lệ phần trăm dải tần
    const bassEnd   = Math.floor(bufLen * 0.08);
    const midEnd    = Math.floor(bufLen * 0.35);
    const trebleEnd = Math.floor(bufLen * 0.75);

    const avg = (arr, from, to) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += arr[i];
      return sum / ((to - from) * 255);
    };

    const rawBass   = avg(data, 0,        bassEnd);
    const rawMid    = avg(data, bassEnd,   midEnd);
    const rawTreble = avg(data, midEnd,    trebleEnd);

    // EWMA smoothing
    _smoothBass   += EWMA_FACTOR * (rawBass   - _smoothBass);
    _smoothMid    += EWMA_FACTOR * (rawMid    - _smoothMid);
    _smoothTreble += EWMA_FACTOR * (rawTreble - _smoothTreble);
  } else {
    // ── Beat simulator — sin wave nhẹ nhàng như nhịp tim ──────────────────
    const t = performance.now() / 1000;
    const heartbeat = 0.18 + 0.12 * Math.sin(t * Math.PI * 1.1); // ~1.1 Hz ≈ 66 BPM

    _smoothBass   += EWMA_FACTOR * (heartbeat - _smoothBass);
    _smoothMid    += EWMA_FACTOR * (heartbeat * 0.6 - _smoothMid);
    _smoothTreble += EWMA_FACTOR * (heartbeat * 0.3 - _smoothTreble);
  }

  return {
    bass:   Math.max(0, Math.min(1, _smoothBass)),
    mid:    Math.max(0, Math.min(1, _smoothMid)),
    treble: Math.max(0, Math.min(1, _smoothTreble)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. detectBeat(bass) — Phát hiện beat và dispatch event
// ─────────────────────────────────────────────────────────────────────────────
export function detectBeat(bass) {
  const now = performance.now();
  if (now - _lastBeatTime < BEAT_COOLDOWN) return;

  if (bass > _beatThreshold) {
    _lastBeatTime = now;
    const intensity = Math.min(1, bass / _beatThreshold);

    // Dispatch event
    window.dispatchEvent(new CustomEvent('song:beat', {
      detail: { intensity, bass }
    }));

    // Adaptive threshold: tăng khi beat mạnh, decay dần về 0.42
    _beatThreshold = Math.min(0.85, _beatThreshold + intensity * 0.08);
  } else {
    // Decay ngưỡng về giá trị ban đầu
    _beatThreshold = Math.max(0.42, _beatThreshold - 0.002);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Beat reactions — Lắng nghe 'song:beat'
// ─────────────────────────────────────────────────────────────────────────────
function _bindBeatReactions() {
  const onBeat = (e) => {
    if (prefersReducedMotion()) return;
    const { intensity } = e.detail;

    // Player border flash
    _flashPlayerBeat(intensity);

    // Album art scale
    _pulseAlbumArt(intensity);

    // Mascot bounce
    _bounceMascot(intensity);

    // Confetti nếu đủ mạnh
    if (intensity > 0.65) {
      _burstConfetti(3);
    }

    // BgDecors tăng tốc độ
    const bgDecors = document.getElementById('bgDecors');
    if (bgDecors) {
      bgDecors.style.setProperty('--decor-speed', `${(1 + intensity * 1.5).toFixed(2)}s`);
      // Decay về bình thường sau 600ms
      setTimeout(() => {
        bgDecors.style.setProperty('--decor-speed', '3s');
      }, 600);
    }
  };

  window.addEventListener('song:beat', onBeat);
  _cleanupFns.push(() => window.removeEventListener('song:beat', onBeat));
}

function _flashPlayerBeat(intensity) {
  const player = document.getElementById('player');
  if (!player) return;
  player.classList.add('beat-flash');
  setTimeout(() => player.classList.remove('beat-flash'), 150);
}

function _pulseAlbumArt(intensity) {
  const art = document.getElementById('pArt');
  if (!art) return;
  const scale = 1 + intensity * 0.05;
  art.style.transition = 'transform 60ms ease-out';
  art.style.transform = `scale(${scale.toFixed(3)})`;
  setTimeout(() => {
    art.style.transition = 'transform 120ms ease-in';
    art.style.transform = 'scale(1)';
  }, 120);
}

function _bounceMascot(intensity) {
  const mascot = document.getElementById('playerMascot');
  if (!mascot || !mascot.classList.contains('swaying')) return;
  const dy = -(intensity * 5).toFixed(1);
  mascot.style.transition = 'transform 80ms ease-out';
  mascot.style.transform = `translateY(${dy}px)`;
  setTimeout(() => {
    mascot.style.transition = 'transform 180ms ease-in';
    mascot.style.transform = 'translateY(0)';
  }, 160);
}

// ─── Confetti mini ────────────────────────────────────────────────────────────
function _burstConfetti(count) {
  const player = document.getElementById('player');
  if (!player) return;
  const rect = player.getBoundingClientRect();

  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const colors = [COLOR_CYAN, COLOR_VIOLET, COLOR_HOTPINK, COLOR_AMBER];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 5 + Math.random() * 6;

    // Vị trí ngẫu nhiên gần player
    const startX = rect.left + Math.random() * rect.width;
    const startY = rect.top  + Math.random() * rect.height * 0.5;
    const vx = (Math.random() - 0.5) * 80;
    const vy = -(40 + Math.random() * 60);

    Object.assign(dot.style, {
      position: 'fixed',
      left: `${startX}px`,
      top:  `${startY}px`,
      width:  `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      background: color,
      pointerEvents: 'none',
      zIndex: '9998',
      opacity: '1',
      transition: 'opacity 0.4s ease',
    });
    document.body.appendChild(dot);

    let startTime = null;
    const dur = 500 + Math.random() * 300;

    const animate = (ts) => {
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const progress = elapsed / dur;
      if (progress >= 1) {
        dot.remove();
        return;
      }
      const x = startX + vx * progress;
      const y = startY + vy * progress + 60 * progress * progress; // gravity
      dot.style.left    = `${x}px`;
      dot.style.top     = `${y}px`;
      dot.style.opacity = `${1 - progress}`;
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. initAuroraReactive() — Aurora phản ứng theo bass
// ─────────────────────────────────────────────────────────────────────────────
function _setupAuroraReactive() {
  // Được gọi trong RAF tick — chỉ setup thôi
}

export function initAuroraReactive(levels) {
  if (prefersReducedMotion()) return;
  const { bass, mid } = levels;
  const scale   = (1 + bass * 0.3).toFixed(3);
  const opacity = (0.6 + mid * 0.4).toFixed(3);
  document.documentElement.style.setProperty('--aurora-scale',   scale);
  document.documentElement.style.setProperty('--aurora-opacity', opacity);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. initPlayerGlow() — Viền player sáng theo bass
// ─────────────────────────────────────────────────────────────────────────────
function _setupPlayerGlow() {
  if (!document.getElementById('_playerGlowCSS')) {
    const style = document.createElement('style');
    style.id = '_playerGlowCSS';
    style.textContent = `
      #player {
        --beat-intensity: 0;
        position: relative;
      }
      #player::before {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: inherit;
        background: transparent;
        box-shadow: 0 0 calc(var(--beat-intensity) * 30px) calc(var(--beat-intensity) * 8px) ${COLOR_CYAN};
        opacity: calc(var(--beat-intensity) * 0.8);
        pointer-events: none;
        border-radius: inherit;
        transition: box-shadow 0.1s ease, opacity 0.1s ease;
        z-index: -1;
      }
      #player.beat-flash::before {
        box-shadow: 0 0 40px 12px ${COLOR_HOTPINK};
        opacity: 1;
        transition: none;
      }
    `;
    document.head.appendChild(style);
  }
}

export function initPlayerGlow(bass) {
  if (prefersReducedMotion()) return;
  const player = document.getElementById('player');
  if (!player) return;
  player.style.setProperty('--beat-intensity', bass.toFixed(3));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. initDiscGlow() — Đĩa than phát sáng theo nhịp
// ─────────────────────────────────────────────────────────────────────────────
function _setupDiscGlow() {
  // CSS đã được handle bởi initDiscGlow() gọi mỗi frame
}

export function initDiscGlow(bass) {
  if (prefersReducedMotion()) return;
  const disc = document.getElementById('scDisc');
  if (!disc || !disc.classList.contains('playing')) return;

  const spread = (bass * 24).toFixed(1);
  const blur   = (bass * 40).toFixed(1);
  const alpha  = (bass * 0.7).toFixed(2);
  disc.style.boxShadow = `0 0 ${blur}px ${spread}px ${COLOR_CYAN}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. initYTBeatSimulator() — Giả lập beat cho YouTube
// ─────────────────────────────────────────────────────────────────────────────
export function initYTBeatSimulator() {
  // Phát hiện YT đang phát và không có real analyser
  const intervalMs = Math.round((60 / _ytBPM) * 1000);

  const tick = () => {
    // Nếu đã có analyser thật → dừng simulator
    if (window.__analyser) {
      if (_ytBeatInterval) {
        clearInterval(_ytBeatInterval);
        _ytBeatInterval = null;
      }
      return;
    }

    // Chỉ dispatch khi YT đang phát
    if (window.__ytPlaying === true) {
      window.dispatchEvent(new CustomEvent('song:beat', {
        detail: { intensity: 0.45 + Math.random() * 0.2, bass: 0.45 }
      }));
    }
  };

  // Xoá interval cũ nếu có
  if (_ytBeatInterval) clearInterval(_ytBeatInterval);
  _ytBeatInterval = setInterval(tick, intervalMs);

  _cleanupFns.push(() => {
    if (_ytBeatInterval) clearInterval(_ytBeatInterval);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RAF Tick chính — chạy mỗi frame
// ─────────────────────────────────────────────────────────────────────────────
function _rafTick() {
  if (!_running) return;

  const levels = getAudioLevels();
  const { bass, mid, treble } = levels;

  // Dispatch levels event
  window.dispatchEvent(new CustomEvent('song:levels', { detail: levels }));

  // Beat detection
  detectBeat(bass);

  // Per-frame visual updates (không phụ thuộc beat event)
  if (!prefersReducedMotion()) {
    initAuroraReactive(levels);
    initPlayerGlow(bass);
    initDiscGlow(bass);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAF tự quản (khi scroll.js chưa khởi động)
// ─────────────────────────────────────────────────────────────────────────────
function _ownRafLoop() {
  _rafTick();
  _rafId = requestAnimationFrame(_ownRafLoop);
}

function _startOwnRAF() {
  if (_rafId) return;
  _rafId = requestAnimationFrame(_ownRafLoop);
}

function _stopOwnRAF() {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inject CSS cần thiết
// ─────────────────────────────────────────────────────────────────────────────
function _injectCSS() {
  if (document.getElementById('_audioReactiveCSS')) return;
  const style = document.createElement('style');
  style.id = '_audioReactiveCSS';
  style.textContent = `
    /* Beat flash trên player */
    #player.beat-flash {
      outline: 2px solid ${COLOR_HOTPINK};
      outline-offset: 3px;
      transition: outline 0s;
    }

    /* Aurora phản ứng */
    .aurora {
      transform: scale(var(--aurora-scale, 1));
      opacity: var(--aurora-opacity, 0.6);
      transition: transform 0.3s ease, opacity 0.3s ease;
    }

    /* BgDecors speed */
    #bgDecors [data-depth] {
      transition: transform 0.1s linear;
    }
  `;
  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. destroy() — Cleanup toàn bộ
// ─────────────────────────────────────────────────────────────────────────────
export function destroy() {
  _running = false;
  _stopOwnRAF();
  _cleanupFns.forEach(fn => fn());
  _cleanupFns.length = 0;

  // Reset CSS vars
  document.documentElement.style.removeProperty('--aurora-scale');
  document.documentElement.style.removeProperty('--aurora-opacity');

  const player = document.getElementById('player');
  if (player) player.style.removeProperty('--beat-intensity');
}
