/**
 * fx/scroll.js — Scroll-driven Animations
 * Sóng · Media Hub — Hello Kitty Milk Pink Theme
 * Mọi màu lấy từ CSS vars. prefers-reduced-motion được tôn trọng.
 */

// ─── Kiểm tra prefers-reduced-motion ────────────────────────────────────────
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── Trạng thái nội bộ ───────────────────────────────────────────────────────
let _rafId = null;
let _scrollY = 0;
let _prevScrollY = 0;
let _velocity = 0;
let _skewCurrent = 0;
let _mouseX = 0;
let _mouseY = 0;
let _targetMouseX = 0;
let _targetMouseY = 0;
let _gyroX = 0;
let _gyroY = 0;
let _useGyro = false;
let _compactTimeout = null;
let _mascotTimeout = null;
let _observers = [];
let _scrollHandlers = [];
let _mouseHandlers = [];
let _gyroHandlers = [];
let _visibilityHandler = null;
let _isMobile = /Mobi|Android/i.test(navigator.userAgent);

// ─── Xuất ra RAF handle chung (scroll.js + audio-reactive.js có thể share) ──
window.SONG_RAF = window.SONG_RAF || { callbacks: new Set() };

// ─────────────────────────────────────────────────────────────────────────────
// 1. init() — Khởi chạy toàn bộ module
// ─────────────────────────────────────────────────────────────────────────────
export function init() {
  initScrollProgress();
  initRevealObserver();
  initParallax();
  initScrollVelocitySkew();
  initStickyViewHeader();
  initMascotScrollReveal();

  // Khởi động RAF loop chung
  _startRAF();

  // Cleanup khi tab bị ẩn
  _visibilityHandler = () => {
    if (document.hidden) {
      _stopRAF();
    } else {
      _startRAF();
    }
  };
  document.addEventListener('visibilitychange', _visibilityHandler);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. initScrollProgress() — Thanh tiến trình cuộn
// ─────────────────────────────────────────────────────────────────────────────
export function initScrollProgress() {
  // Tạo element nếu chưa có
  let bar = document.getElementById('scrollProgress');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'scrollProgress';
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0%',
      height: '3px',
      background: 'linear-gradient(90deg, var(--cyan, #FF5C8A), var(--hot-pink, #FF8FB1), var(--amber, #FFD966))',
      zIndex: '9999',
      transformOrigin: 'left',
      pointerEvents: 'none',
      transition: 'width 0.05s linear',
    });
    document.body.appendChild(bar);
  }

  // Icon 🎀 chạy theo vị trí scroll
  let bow = document.getElementById('scrollProgressBow');
  if (!bow) {
    bow = document.createElement('span');
    bow.id = 'scrollProgressBow';
    bow.textContent = '🎀';
    Object.assign(bow.style, {
      position: 'absolute',
      right: '-10px',
      top: '-6px',
      fontSize: '14px',
      lineHeight: '1',
      pointerEvents: 'none',
      transform: 'translateY(0)',
      transition: 'right 0.05s linear',
    });
    bar.appendChild(bow);
  }

  // Thử dùng CSS animation-timeline nếu trình duyệt hỗ trợ
  const supportsAnimTimeline = CSS.supports('animation-timeline', 'scroll()');
  if (supportsAnimTimeline && !prefersReducedMotion()) {
    // Đặt CSS var để CSS có thể dùng
    bar.style.animationTimeline = 'scroll()';
    bar.style.animationRangeStart = '0%';
    bar.style.animationRangeEnd = '100%';
  }

  // Fallback: cập nhật qua scroll event + RAF
  const updateProgress = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0;

    // Set CSS var để các thứ khác dùng
    document.documentElement.style.setProperty('--scroll-pct', pct.toFixed(4));
    bar.style.width = `${(pct * 100).toFixed(2)}%`;
  };

  // Đăng ký vào RAF chung
  window.SONG_RAF.callbacks.add(updateProgress);
  _scrollHandlers.push(() => window.SONG_RAF.callbacks.delete(updateProgress));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. initRevealObserver() — Reveal khi scroll vào viewport
// ─────────────────────────────────────────────────────────────────────────────
export function initRevealObserver() {
  const SELECTORS = [
    '.card',
    '.section-title-wrap',
    '.view-header',
    '.glass.room-card',
    '.room-now',
    '.room-box',
    '.job',
  ];

  // Inject CSS cho animation nếu chưa có
  if (!document.getElementById('_scrollRevealCSS')) {
    const style = document.createElement('style');
    style.id = '_scrollRevealCSS';
    style.textContent = `
      .reveal-target {
        opacity: 0;
        transform: translateY(40px) scale(0.95);
        filter: blur(8px);
        transition:
          opacity 0.55s cubic-bezier(.22,1,.36,1),
          transform 0.55s cubic-bezier(.22,1,.36,1),
          filter 0.55s cubic-bezier(.22,1,.36,1);
        will-change: transform, opacity, filter;
      }
      .reveal-target.reveal-in {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0);
        will-change: auto;
      }
      .word-char {
        display: inline-block;
        opacity: 0;
        transform: translateY(16px);
        transition: opacity 0.35s ease, transform 0.35s ease;
      }
      .word-char.reveal-in {
        opacity: 1;
        transform: translateY(0);
      }
      .bow-icon {
        display: inline-block;
        transition: transform 0.5s cubic-bezier(.34,1.56,.64,1);
      }
      .bow-icon.reveal-in {
        animation: bowBounce 0.6s cubic-bezier(.34,1.56,.64,1) forwards;
      }
      @keyframes bowBounce {
        0%   { transform: rotate(0deg); }
        40%  { transform: rotate(-20deg); }
        70%  { transform: rotate(10deg); }
        100% { transform: rotate(0deg); }
      }
    `;
    document.head.appendChild(style);
  }

  const allTargets = document.querySelectorAll(SELECTORS.join(', '));

  if (!('IntersectionObserver' in window)) {
    // Fallback: hiện tất cả ngay
    allTargets.forEach(el => {
      el.classList.add('reveal-in');
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
    });
    return;
  }

  // Gán class và stagger index tự động theo cột
  allTargets.forEach(el => {
    if (!el.classList.contains('reveal-target')) {
      el.classList.add('reveal-target');
    }
    // Tính chỉ số cột dựa theo vị trí ngang
    if (!el.dataset.revealI) {
      const rect = el.getBoundingClientRect();
      const col = Math.floor(rect.left / 220); // ~220px mỗi cột
      el.dataset.revealI = col;
    }
  });

  // Xử lý .section-title-wrap — tách text h2 thành từng span
  document.querySelectorAll('.section-title-wrap').forEach(wrap => {
    const h2 = wrap.querySelector('.h2, h2');
    if (h2 && !h2.dataset.charSplit) {
      h2.dataset.charSplit = '1';
      const text = h2.textContent;
      h2.textContent = '';
      text.split('').forEach((ch, i) => {
        const span = document.createElement('span');
        span.className = 'word-char';
        span.textContent = ch === ' ' ? '\u00A0' : ch;
        span.style.transitionDelay = `${i * 0.04}s`;
        h2.appendChild(span);
      });
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = (parseInt(el.dataset.revealI || 0, 10)) * 80;

        setTimeout(() => {
          el.classList.add('reveal-in');

          // Reveal các char span bên trong section title
          el.querySelectorAll('.word-char').forEach((span, i) => {
            setTimeout(() => span.classList.add('reveal-in'), i * 40);
          });

          // Bow icon bounce
          el.querySelectorAll('.bow-icon').forEach(bow => {
            bow.classList.add('reveal-in');
          });
        }, delay);

        observer.unobserve(el);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  allTargets.forEach(el => observer.observe(el));
  _observers.push(observer);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. initParallax() — Parallax nhiều lớp
// ─────────────────────────────────────────────────────────────────────────────
export function initParallax() {
  if (prefersReducedMotion()) return;

  const bgDecors = document.getElementById('bgDecors');
  if (!bgDecors) return;

  const items = bgDecors.querySelectorAll('[data-depth]');
  if (!items.length) return;

  // Lerp helper
  const lerp = (a, b, t) => a + (b - a) * t;

  let lerpMouseX = 0;
  let lerpMouseY = 0;
  let scrollOffset = 0;
  let lerpScroll = 0;

  const onMouseMove = (e) => {
    _targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;  // -1 → 1
    _targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  };

  // Gyroscope trên mobile
  if (_isMobile && typeof DeviceOrientationEvent !== 'undefined') {
    const onGyro = (e) => {
      if (e.gamma !== null && e.beta !== null) {
        _gyroX = Math.max(-1, Math.min(1, e.gamma / 30));
        _gyroY = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
        _useGyro = true;
      }
    };
    window.addEventListener('deviceorientation', onGyro, { passive: true });
    _gyroHandlers.push(onGyro);
  } else {
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    _mouseHandlers.push(onMouseMove);
  }

  // Đăng ký vào RAF chung
  const tick = () => {
    scrollOffset = window.scrollY;
    lerpScroll = lerp(lerpScroll, scrollOffset, 0.08);

    const srcX = _useGyro ? _gyroX : _targetMouseX;
    const srcY = _useGyro ? _gyroY : _targetMouseY;
    lerpMouseX = lerp(lerpMouseX, srcX, 0.06);
    lerpMouseY = lerp(lerpMouseY, srcY, 0.06);

    items.forEach(item => {
      const depth = parseFloat(item.dataset.depth) || 0.5;
      // Vật gần (depth cao) dịch nhiều hơn
      const scrollFactor = depth * 0.4;
      const mouseFactor = depth * 18;

      const tx = lerpMouseX * mouseFactor;
      const ty = lerpMouseY * mouseFactor * 0.6 - lerpScroll * scrollFactor;

      item.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
    });
  };

  window.SONG_RAF.callbacks.add(tick);
  _scrollHandlers.push(() => window.SONG_RAF.callbacks.delete(tick));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. initScrollVelocitySkew() — Skew theo tốc độ cuộn
// ─────────────────────────────────────────────────────────────────────────────
export function initScrollVelocitySkew() {
  if (prefersReducedMotion()) return;

  const MAX_SKEW = 4; // độ
  const LERP_BACK = 0.15;
  const SKEW_FACTOR = 0.04;

  let lastScroll = window.scrollY;

  const tick = () => {
    const currentScroll = window.scrollY;
    const delta = currentScroll - lastScroll;
    lastScroll = currentScroll;

    // Tính velocity thô → clamp
    const targetSkew = Math.max(-MAX_SKEW, Math.min(MAX_SKEW, delta * SKEW_FACTOR));
    _skewCurrent = _skewCurrent + (targetSkew - _skewCurrent) * (1 - LERP_BACK);

    // Chỉ áp dụng cho các element đang trong view
    if (Math.abs(_skewCurrent) > 0.01) {
      // Batch đọc trước (getBoundingClientRect), ghi sau (style)
      const targets = document.querySelectorAll('.card, .grid');
      const inView = [];
      const vh = window.innerHeight;

      targets.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < vh) {
          inView.push(el);
        }
      });

      // Ghi sau khi đã đọc xong
      inView.forEach(el => {
        el.style.transform = `skewY(${_skewCurrent.toFixed(3)}deg)`;
        el.style.willChange = 'transform';
      });
    } else {
      // Reset khi gần 0 để không để lại style thừa
      document.querySelectorAll('.card[style*="skewY"], .grid[style*="skewY"]').forEach(el => {
        el.style.transform = '';
        el.style.willChange = '';
      });
    }
  };

  window.SONG_RAF.callbacks.add(tick);
  _scrollHandlers.push(() => window.SONG_RAF.callbacks.delete(tick));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. initStickyViewHeader() — Header co lại khi cuộn
// ─────────────────────────────────────────────────────────────────────────────
export function initStickyViewHeader() {
  // Inject CSS cho compact nếu chưa có
  if (!document.getElementById('_headerCompactCSS')) {
    const style = document.createElement('style');
    style.id = '_headerCompactCSS';
    style.textContent = `
      .view-header {
        transition: all 0.3s ease;
      }
      .view-header.header-compact {
        transform: scale(0.95);
        opacity: 0.85;
        padding-top: 8px !important;
        padding-bottom: 8px !important;
      }
    `;
    document.head.appendChild(style);
  }

  const THRESHOLD = 60;

  const tick = () => {
    const scrollY = window.scrollY;
    // Tìm view đang active
    const activeView = document.querySelector('.view.on');
    if (!activeView) return;
    const header = activeView.querySelector('.view-header');
    if (!header) return;

    if (scrollY > THRESHOLD) {
      header.classList.add('header-compact');
    } else {
      header.classList.remove('header-compact');
    }
  };

  window.SONG_RAF.callbacks.add(tick);
  _scrollHandlers.push(() => window.SONG_RAF.callbacks.delete(tick));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. initMascotScrollReveal() — Mascot vẫy tay khi gần cuối trang
// ─────────────────────────────────────────────────────────────────────────────
export function initMascotScrollReveal() {
  // Inject CSS wave animation nếu chưa có
  if (!document.getElementById('_mascotWaveCSS')) {
    const style = document.createElement('style');
    style.id = '_mascotWaveCSS';
    style.textContent = `
      #playerMascot.wave-hi {
        animation: mascotWave 0.8s ease-in-out;
      }
      @keyframes mascotWave {
        0%   { transform: rotate(0deg); }
        20%  { transform: rotate(-15deg) translateY(-4px); }
        40%  { transform: rotate(15deg) translateY(-6px); }
        60%  { transform: rotate(-10deg) translateY(-4px); }
        80%  { transform: rotate(10deg) translateY(-2px); }
        100% { transform: rotate(0deg) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  let debounceTimer = null;
  let isWaving = false;

  const checkMascot = () => {
    const distFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    const mascot = document.getElementById('playerMascot');
    if (!mascot) return;

    if (distFromBottom < 200 && !isWaving) {
      isWaving = true;
      mascot.classList.add('wave-hi');

      // Xoá class sau animation để có thể trigger lại
      setTimeout(() => {
        mascot.classList.remove('wave-hi');
        isWaving = false;
      }, 800);
    }
  };

  const onScroll = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkMascot, 500);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  _scrollHandlers.push(() => {
    window.removeEventListener('scroll', onScroll);
    if (debounceTimer) clearTimeout(debounceTimer);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RAF Loop chung
// ─────────────────────────────────────────────────────────────────────────────
function _rafTick() {
  window.SONG_RAF.callbacks.forEach(fn => {
    try { fn(); } catch (e) { /* bỏ qua lỗi từ callback đơn lẻ */ }
  });
  _rafId = requestAnimationFrame(_rafTick);
}

function _startRAF() {
  if (_rafId) return;
  _rafId = requestAnimationFrame(_rafTick);
}

function _stopRAF() {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. destroy() — Cleanup toàn bộ
// ─────────────────────────────────────────────────────────────────────────────
export function destroy() {
  // Dừng RAF
  _stopRAF();
  window.SONG_RAF.callbacks.clear();

  // Remove scroll handlers
  _scrollHandlers.forEach(fn => fn());
  _scrollHandlers.length = 0;

  // Remove mouse handlers
  _mouseHandlers.forEach(fn => window.removeEventListener('mousemove', fn));
  _mouseHandlers.length = 0;

  // Remove gyro handlers
  _gyroHandlers.forEach(fn => window.removeEventListener('deviceorientation', fn));
  _gyroHandlers.length = 0;

  // Disconnect observers
  _observers.forEach(obs => obs.disconnect());
  _observers.length = 0;

  // Remove visibility listener
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }

  // Clear pending timeouts
  if (_compactTimeout) clearTimeout(_compactTimeout);
  if (_mascotTimeout) clearTimeout(_mascotTimeout);
}
