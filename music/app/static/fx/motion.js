/**
 * fx/motion.js — GSAP Animations, Splash Cinematic, View Transitions, Micro-FX
 * Sóng · Media Hub — Hello Kitty Milk Pink Theme
 * Màu sắc lấy từ CSS vars để hỗ trợ multi-theme.
 */

// ============================================================
// TIỆN ÍCH
// ============================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Màu pink theme (hardcode dự phòng khi CSS vars chưa load)
const PINK = { a: '#FF5C8A', b: '#E8344E', c: '#FF8FB1', d: '#FFD966' };

// ============================================================
// SAFE GSAP WRAPPERS (GSAP được load từ CDN global)
// ============================================================
function gsapTo(el, props) {
  if (window.gsap) return gsap.to(el, props);
  // Fallback thuần CSS
  const dur = (props.duration || 0.3) * 1000;
  el.style.transition = `opacity ${dur}ms ease, transform ${dur}ms ease, filter ${dur}ms ease`;
  if (props.opacity !== undefined) el.style.opacity = props.opacity;
  if (props.x !== undefined || props.y !== undefined) {
    el.style.transform = `translate(${props.x || 0}px, ${props.y || 0}px)`;
  }
  if (props.filter !== undefined) el.style.filter = props.filter;
  if (props.onComplete) setTimeout(props.onComplete, dur);
  return null;
}
function gsapSet(el, props) {
  if (window.gsap) return gsap.set(el, props);
  if (props.opacity !== undefined) el.style.opacity = props.opacity;
  if (props.x !== undefined || props.y !== undefined) {
    el.style.transform = `translate(${props.x || 0}px, ${props.y || 0}px)`;
  }
  if (props.filter !== undefined) el.style.filter = props.filter;
  if (props.scale !== undefined) el.style.transform = (el.style.transform || '') + ` scale(${props.scale})`;
}
function gsapTimeline(opts) {
  if (window.gsap) return gsap.timeline(opts);
  return {
    fromTo: (el, from, to) => {
      gsapSet(el, from);
      setTimeout(() => gsapTo(el, to), 10);
      return this;
    },
    to: (el, props) => { gsapTo(el, props); return this; }
  };
}

// ============================================================
// SPLASH CINEMATIC — Hạt bay ghép chữ "Sóng" + rèm mở
// ============================================================
export function initSplashCinematic() {
  const splash = $('#splashScreen');
  if (!splash) return;

  const seen = sessionStorage.getItem('splashSeen');

  // Cho phép bỏ qua bằng Esc hoặc click
  const skip = () => {
    sessionStorage.setItem('splashSeen', '1');
    curtainReveal(splash);
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') skip(); }, { once: true });
  splash.addEventListener('click', skip, { once: true });

  if (seen) {
    // Lần thứ 2 trở đi: thoát nhanh
    setTimeout(() => curtainReveal(splash), 300);
    return;
  }

  // Thêm canvas hạt trước nội dung
  const canvas = document.createElement('canvas');
  canvas.id = 'splashCanvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  splash.insertBefore(canvas, splash.firstChild);

  // Thêm nút skip hint
  if (!$('.splash-skip', splash)) {
    const hint = document.createElement('p');
    hint.className = 'splash-skip';
    hint.textContent = 'Nhấn Esc hoặc click để bỏ qua ♡';
    splash.appendChild(hint);
  }

  if (prefersReducedMotion()) {
    // Chỉ fade đơn giản
    setTimeout(() => curtainReveal(splash), 1000);
    return;
  }

  // Khởi động hiệu ứng hạt bay ghép chữ "Sóng"
  initParticleText(canvas, 'SÓNG ♡', () => {
    setTimeout(() => {
      sessionStorage.setItem('splashSeen', '1');
      curtainReveal(splash);
      setTimeout(() => staggerInUI(), 600);
    }, 500);
  });
}

/**
 * Hiệu ứng rèm sân khấu: slide up 2 nửa màn hình rồi remove splash
 */
function curtainReveal(splash) {
  // Tạo 2 rèm trái/phải
  const colors = ['linear-gradient(135deg,#FFF1F5,#FFE4EC)', 'linear-gradient(135deg,#FFE4EC,#FFD6E4)'];
  const curtains = [0, 1].map(i => {
    const c = document.createElement('div');
    c.style.cssText = `
      position:fixed; top:0; bottom:0; width:50%; z-index:9999;
      background:${colors[i]}; pointer-events:none;
      transition: transform 0.7s cubic-bezier(0.76,0,0.24,1);
      ${i === 0 ? 'left:0; transform-origin:left;' : 'right:0; transform-origin:right;'}
    `;
    document.body.appendChild(c);
    return c;
  });

  // Fade splash
  splash.style.transition = 'opacity 0.4s ease-out';
  splash.style.opacity = '0';

  requestAnimationFrame(() => requestAnimationFrame(() => {
    curtains[0].style.transform = 'translateX(-100%)';
    curtains[1].style.transform = 'translateX(100%)';
  }));

  setTimeout(() => {
    splash.remove();
    curtains.forEach(c => c.remove());
  }, 800);
}

/**
 * Hạt bay từ ngoài vào ghép thành chữ, sau đó nổ tung
 */
function initParticleText(canvas, text, onComplete) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;

  // Lấy các điểm pixel của chữ
  const offscreen = document.createElement('canvas');
  const fontSize = Math.min(W * 0.15, 120);
  offscreen.width = W;
  offscreen.height = H;
  const oc = offscreen.getContext('2d');
  oc.fillStyle = '#fff';
  oc.font = `900 ${fontSize}px "Baloo 2", "Fredoka", sans-serif`;
  oc.textAlign = 'center';
  oc.textBaseline = 'middle';
  oc.fillText(text, W / 2, H / 2);

  const data = oc.getImageData(0, 0, W, H).data;
  const textPoints = [];
  const step = 5;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > 128) textPoints.push({ tx: x, ty: y });
    }
  }

  const isMobile = W < 768;
  const MAX = isMobile ? 600 : 1500;
  const selected = textPoints.sort(() => Math.random() - 0.5).slice(0, MAX);

  // Màu hạt: hồng, đỏ hồng, vàng bơ, trắng sữa
  const colors = [PINK.a, PINK.b, PINK.c, PINK.d, '#FFF0F5', '#E8344E'];
  // Emoji bay vào: tim, hoa, nơ, sao
  const emojis = ['♡', '🌸', '🎀', '✦', '♡', '✨'];

  const particles = selected.map(p => ({
    x: (Math.random() - 0.5) * W * 2 + W / 2,
    y: (Math.random() - 0.5) * H * 2 + H / 2,
    tx: p.tx, ty: p.ty,
    vx: 0, vy: 0,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: Math.random() * 2.5 + 1,
    exploded: false
  }));

  // Thêm một số emoji đặc biệt bay vào
  const emojiParticles = isMobile ? [] : Array.from({ length: 20 }, (_, i) => ({
    x: Math.random() * W,
    y: H + 50 + Math.random() * 200,
    tx: 80 + Math.random() * (W - 160),
    ty: 100 + Math.random() * (H - 200),
    emoji: emojis[i % emojis.length],
    size: 16 + Math.random() * 14,
    opacity: 0,
    exploded: false
  }));

  let startTime = performance.now();
  const GATHER = 1400;
  const HOLD = 700;
  const EXPLODE = 500;
  let phase = 'gather';
  let rafId;

  function draw() {
    const now = performance.now();
    const elapsed = now - startTime;
    ctx.clearRect(0, 0, W, H);

    if (phase === 'gather') {
      const t = Math.min(elapsed / GATHER, 1);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Hạt tập hợp
      particles.forEach(p => {
        p.x += (p.tx - p.x) * ease * 0.12;
        p.y += (p.ty - p.y) * ease * 0.12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = ease;
        ctx.fill();
      });

      // Emoji bay lên
      emojiParticles.forEach((ep, i) => {
        const delay = i * 0.04;
        const localT = Math.max(0, Math.min((t - delay) / (1 - delay), 1));
        ep.opacity = localT;
        ep.x += (ep.tx - ep.x) * localT * 0.08;
        ep.y += (ep.ty - ep.y) * localT * 0.08;
        if (localT > 0) {
          ctx.globalAlpha = localT * 0.7;
          ctx.font = `${ep.size}px serif`;
          ctx.fillText(ep.emoji, ep.x, ep.y);
        }
      });

      ctx.globalAlpha = 1;
      if (t >= 1) { phase = 'hold'; startTime = now; }

    } else if (phase === 'hold') {
      // Giữ nguyên, thêm glow pulse
      const pulse = 0.8 + 0.2 * Math.sin(elapsed / 120);
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.tx, p.ty, p.size * pulse, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1;
        ctx.fill();
      });
      // Ánh sáng hồng bùng sáng ở giữa
      const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.35);
      glow.addColorStop(0, `rgba(255,92,138,${0.08 * pulse})`);
      glow.addColorStop(1, 'transparent');
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      emojiParticles.forEach(ep => {
        ctx.globalAlpha = 0.7;
        ctx.font = `${ep.size}px serif`;
        ctx.fillText(ep.emoji, ep.tx, ep.ty);
      });
      ctx.globalAlpha = 1;

      if (elapsed >= HOLD) { phase = 'explode'; startTime = now; }

    } else if (phase === 'explode') {
      const t = Math.min(elapsed / EXPLODE, 1);
      particles.forEach(p => {
        if (!p.exploded) {
          const angle = Math.atan2(p.ty - H / 2, p.tx - W / 2);
          const speed = (0.5 + Math.random() * 0.5) * t * 12;
          p.vx = Math.cos(angle) * speed + (Math.random() - 0.5) * 4;
          p.vy = Math.sin(angle) * speed + (Math.random() - 0.5) * 4;
          p.exploded = true;
        }
        p.x += p.vx;
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.7), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - t * 1.2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      if (t >= 1) {
        cancelAnimationFrame(rafId);
        ctx.clearRect(0, 0, W, H);
        onComplete?.();
        return;
      }
    }

    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);
}

// ============================================================
// STAGGER IN UI SAU SPLASH
// ============================================================
function staggerInUI() {
  const sidebar = $('.side');
  const player = $('#player');
  const mobileNav = $('.mobile-nav');
  const header = $('.view.on .view-header');
  const themeSwitcher = $('.theme-switcher');

  const els = [sidebar, player, mobileNav, themeSwitcher, header].filter(Boolean);
  els.forEach((el, i) => {
    if (window.gsap) {
      gsap.from(el, {
        opacity: 0,
        y: 24,
        duration: 0.55,
        delay: i * 0.08 + 0.05,
        ease: 'back.out(1.7)',
        clearProps: 'all'
      });
    } else {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transition = `opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)`;
          el.style.opacity = '';
          el.style.transform = '';
          setTimeout(() => { el.style.transition = ''; }, 600);
        }, i * 80 + 60);
      });
    }
  });
}

// ============================================================
// VIEW TRANSITION — Clip-path wipe + stagger content
// ============================================================
// Mỗi view có kiểu chuyển riêng
const VIEW_TRANSITIONS = {
  home:       { clip: 'inset(0% 100% 0% 0%)',  dir: 'right'  },
  youtube:    { clip: 'circle(0% at 80% 20%)',  dir: 'circle' },
  soundcloud: { clip: 'inset(0% 0% 100% 0%)',  dir: 'up'     },
  room:       { clip: 'inset(50% 0% 50% 0%)',  dir: 'center' },
  library:    { clip: 'inset(0% 0% 0% 100%)',  dir: 'left'   },
  downloads:  { clip: 'circle(0% at 50% 50%)',  dir: 'circle' }
};
const VIEW_CLIP_END = {
  right:  'inset(0% 0% 0% 0%)',
  up:     'inset(0% 0% 0% 0%)',
  left:   'inset(0% 0% 0% 0%)',
  center: 'inset(0% 0% 0% 0%)',
  circle: 'circle(150% at 50% 50%)'
};

export function animateViewTransition(oldView, newView, callback) {
  // View Transitions API nếu có
  if (document.startViewTransition && !prefersReducedMotion()) {
    document.startViewTransition(() => {
      callback();
      // Stagger cards sau khi DOM update
      requestAnimationFrame(() => staggerNewView(newView));
    });
    return;
  }

  if (prefersReducedMotion()) {
    callback();
    return;
  }

  const oldEl = $(`#view-${oldView}`);
  const newEl = $(`#view-${newView}`);

  if (!oldEl && !newEl) { callback(); return; }

  // Fallback: clip-path wipe
  const config = VIEW_TRANSITIONS[newView] || VIEW_TRANSITIONS.home;
  const endClip = VIEW_CLIP_END[config.dir];

  // Old view fade out
  if (oldEl) {
    gsapTo(oldEl, {
      opacity: 0,
      filter: 'blur(4px)',
      duration: 0.25,
      ease: 'power2.in',
      onComplete: () => {
        callback();
        if (newEl) {
          // New view clip-path reveal
          newEl.style.clipPath = config.clip;
          newEl.style.opacity = '1';
          newEl.style.filter = 'blur(0)';
          newEl.style.transition = `clip-path 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease`;
          requestAnimationFrame(() => {
            newEl.style.clipPath = endClip;
            setTimeout(() => {
              newEl.style.clipPath = '';
              newEl.style.transition = '';
              staggerNewView(newView);
            }, 520);
          });
        }
      }
    });
  } else {
    callback();
    staggerNewView(newView);
  }
}

/**
 * Stagger các phần tử trong view mới khi chuyển trang
 */
function staggerNewView(viewName) {
  const view = $(`#view-${viewName}`);
  if (!view) return;
  const items = $$('.card, .section-title-wrap, .view-header, .glass.room-card, .room-now, .search', view);
  if (window.gsap) {
    gsap.from(items, {
      opacity: 0,
      y: 20,
      scale: 0.97,
      stagger: 0.04,
      duration: 0.45,
      ease: 'power2.out',
      clearProps: 'all'
    });
  } else {
    items.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px) scale(0.97)';
      setTimeout(() => {
        el.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.16,1,0.3,1)';
        el.style.opacity = '';
        el.style.transform = '';
        setTimeout(() => { el.style.transition = ''; }, 450);
      }, i * 35 + 50);
    });
  }
}

// ============================================================
// SHARED ELEMENT — Card bay vào Player (album art FLIP)
// ============================================================
export function animateCardToPlayer(cardEl) {
  if (prefersReducedMotion()) return;
  const art = cardEl?.querySelector('.thumb img');
  const playerArt = $('#pArt');
  if (!art || !playerArt) return;

  const from = art.getBoundingClientRect();
  const to = playerArt.getBoundingClientRect();

  // Tạo bản sao bay
  const clone = document.createElement('img');
  clone.src = art.src;
  clone.style.cssText = `
    position:fixed;
    top:${from.top}px; left:${from.left}px;
    width:${from.width}px; height:${from.height}px;
    border-radius:12px; object-fit:cover;
    z-index:9980; pointer-events:none;
    will-change:transform,width,height,top,left,border-radius,box-shadow;
    transition:all 0.55s cubic-bezier(0.34,1.56,0.64,1);
    box-shadow:0 0 0 0 rgba(255,92,138,0);
  `;
  document.body.appendChild(clone);

  // Force reflow
  clone.offsetHeight;

  // Animate bay xuống player
  clone.style.top = `${to.top}px`;
  clone.style.left = `${to.left}px`;
  clone.style.width = `${to.width}px`;
  clone.style.height = `${to.height}px`;
  clone.style.borderRadius = '10px';
  clone.style.boxShadow = '0 0 24px rgba(255,92,138,0.5)';

  setTimeout(() => clone.remove(), 650);
}

// ============================================================
// MAGNETIC BUTTONS
// ============================================================
export function initMagneticButtons() {
  if (prefersReducedMotion() || ('ontouchstart' in window)) return;

  const magnetEls = $$('.btn.pri, .play, .btn.sc');
  magnetEls.forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = 70;
      if (dist < radius) {
        const power = (1 - dist / radius) * 0.38;
        btn.style.transform = `translate(${dx * power}px, ${dy * power}px)`;
      }
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transition = 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1)';
      btn.style.transform = '';
      setTimeout(() => { btn.style.transition = ''; }, 450);
    });
  });
}

// ============================================================
// SPOTLIGHT — CSS vars --mx --my trên card/glass
// ============================================================
export function initSpotlight() {
  document.addEventListener('mousemove', e => {
    // Chỉ update elements gần con trỏ để tránh thrash
    const elements = $$('.card:hover, .glass:hover, .stage:hover');
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--mx', x + '%');
      el.style.setProperty('--my', y + '%');
    });
  }, { passive: true });
}

// ============================================================
// CURSOR STAR TRAIL — vệt sao theo con trỏ
// ============================================================
export function initStarTrail() {
  if (prefersReducedMotion() || ('ontouchstart' in window)) return;
  let lastTrail = 0;
  const CHARS = ['✦', '♡', '✨', '🌸', '·'];
  const COLORS = [PINK.a, PINK.b, PINK.c, PINK.d, '#fff'];

  document.addEventListener('mousemove', e => {
    const now = performance.now();
    if (now - lastTrail < 60) return; // ~16fps cho trail
    if (Math.random() > 0.45) return; // ngẫu nhiên để bớt dày
    lastTrail = now;

    const star = document.createElement('span');
    star.className = 'cursor-star-trail';
    star.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
    star.style.cssText = `
      position:fixed; pointer-events:none; z-index:9997;
      left:${e.clientX}px; top:${e.clientY}px;
      color:${COLORS[Math.floor(Math.random() * COLORS.length)]};
      font-size:${10 + Math.random() * 8}px;
      transform:translate(-50%,-50%);
      animation:starTrailFade 0.65s ease-out forwards;
      will-change:transform,opacity;
    `;
    document.body.appendChild(star);
    setTimeout(() => star.remove(), 700);
  }, { passive: true });
}

// ============================================================
// CIRCULAR THEME REVEAL
// ============================================================
export function circularReveal(fromX, fromY, newTheme) {
  const themeColors = {
    ocean:     '#080C18',
    pink:      '#FFE4EC',
    lime:      '#051A0C',
    synthwave: '#1A0026'
  };

  const maxDist = Math.max(
    Math.hypot(fromX, fromY),
    Math.hypot(window.innerWidth - fromX, fromY),
    Math.hypot(fromX, window.innerHeight - fromY),
    Math.hypot(window.innerWidth - fromX, window.innerHeight - fromY)
  );
  const size = maxDist * 2.2;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;
    left:${fromX - size / 2}px; top:${fromY - size / 2}px;
    width:${size}px; height:${size}px;
    border-radius:50%;
    background:${themeColors[newTheme] || themeColors.ocean};
    z-index:800;
    transform:scale(0);
    pointer-events:none;
    will-change:transform,opacity;
    transition:transform 0.65s cubic-bezier(0.4,0,0.2,1);
  `;
  document.body.appendChild(overlay);
  overlay.offsetHeight;
  overlay.style.transform = 'scale(1)';

  setTimeout(() => {
    document.documentElement.setAttribute('data-theme', newTheme);
    overlay.style.transition = 'opacity 0.3s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 350);
  }, 500);
}

// ============================================================
// BEAT REACTIONS — Listen CustomEvent từ audio-reactive.js
// ============================================================
window.addEventListener('song:beat', e => {
  const intensity = e.detail?.intensity || 0.5;

  // Viền player nhấp nháy
  const player = $('#player');
  if (player) {
    player.style.setProperty('--beat-intensity', intensity);
    player.classList.add('beat-flash');
    setTimeout(() => player.classList.remove('beat-flash'), 200);
  }

  // Album art nảy nhẹ
  const pArt = $('#pArt');
  if (pArt && intensity > 0.45) {
    const sc = 1 + intensity * 0.04;
    pArt.style.transition = 'transform 0.1s ease-out';
    pArt.style.transform = `scale(${sc})`;
    setTimeout(() => {
      pArt.style.transition = 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)';
      pArt.style.transform = '';
    }, 120);
  }

  // Mascot nhảy theo beat
  const mascot = $('#playerMascot');
  if (mascot?.classList.contains('swaying')) {
    mascot.style.transition = 'transform 0.1s ease-out';
    mascot.style.transform = `translateY(-${intensity * 7}px) scale(1.05)`;
    setTimeout(() => {
      mascot.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
      mascot.style.transform = '';
    }, 130);
  }
});

// ============================================================
// NOW PLAYING FULLSCREEN (swipe up / click album art)
// ============================================================
export function initNowPlaying() {
  // NowPlaying element sẽ được tạo động trong HTML
  const player = $('#player');
  if (!player) return;

  // Swipe up để mở
  let touchStartY = 0;
  player.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  player.addEventListener('touchmove', e => {
    const dy = touchStartY - e.touches[0].clientY;
    if (dy > 45) openNowPlaying();
  }, { passive: true });

  $('#pArt')?.addEventListener('click', openNowPlaying);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeNowPlaying();
  });
}

export function openNowPlaying() {
  let np = $('#nowPlaying');
  if (!np) {
    // Tạo NowPlaying overlay nếu chưa có
    np = document.createElement('div');
    np.id = 'nowPlaying';
    np.innerHTML = `
      <button class="np-close" aria-label="Đóng">✕</button>
      <div class="np-art"><img alt="" referrerpolicy="no-referrer"></div>
      <div class="np-title"></div>
      <div class="np-artist mut"></div>
    `;
    document.body.appendChild(np);
    np.querySelector('.np-close')?.addEventListener('click', closeNowPlaying);
    np.addEventListener('click', e => { if (e.target === np) closeNowPlaying(); });
  }

  // Sync nội dung
  const pArt = $('#pArt'), pTitle = $('#pTitle'), pArtist = $('#pArtist');
  const npImg = np.querySelector('.np-art img');
  const npTitle = np.querySelector('.np-title');
  const npArtist = np.querySelector('.np-artist');
  if (npImg && pArt) npImg.src = pArt.src;
  if (npTitle && pTitle) npTitle.textContent = pTitle.textContent;
  if (npArtist && pArtist) npArtist.textContent = pArtist.textContent;

  np.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeNowPlaying() {
  const np = $('#nowPlaying');
  if (np) {
    np.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ============================================================
// CARD FLIP → QUEUE ICON (thêm vào hàng đợi)
// ============================================================
export function animateCardToQueue(cardEl) {
  if (prefersReducedMotion()) return;
  const thumb = cardEl?.querySelector('.thumb img');
  const queueBtn = $('#bQueue');
  if (!thumb || !queueBtn) return;

  const from = thumb.getBoundingClientRect();
  const to = queueBtn.getBoundingClientRect();

  const clone = document.createElement('img');
  clone.src = thumb.src;
  clone.style.cssText = `
    position:fixed;
    top:${from.top}px; left:${from.left}px;
    width:${from.width}px; height:${from.height}px;
    border-radius:8px; object-fit:cover;
    z-index:9980; pointer-events:none;
    will-change:transform,width,height,top,left,opacity,border-radius;
    transition:all 0.5s cubic-bezier(0.34,1.56,0.64,1), opacity 0.4s ease;
  `;
  document.body.appendChild(clone);
  clone.offsetHeight;

  clone.style.top = `${to.top + to.height / 2 - 16}px`;
  clone.style.left = `${to.left + to.width / 2 - 16}px`;
  clone.style.width = '32px';
  clone.style.height = '32px';
  clone.style.borderRadius = '50%';
  clone.style.opacity = '0';

  // Queue button nảy lò xo
  queueBtn.style.transition = 'transform 0.2s ease-out';
  queueBtn.style.transform = 'scale(1.3)';
  setTimeout(() => {
    queueBtn.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
    queueBtn.style.transform = '';
  }, 220);

  setTimeout(() => clone.remove(), 550);
}

// ============================================================
// ROOM: Pop-in animation khi thành viên vào
// ============================================================
export function animateMemberJoin(memberEl) {
  if (!memberEl || prefersReducedMotion()) return;
  memberEl.style.opacity = '0';
  memberEl.style.transform = 'scale(0.5) translateY(10px)';
  memberEl.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
  requestAnimationFrame(() => {
    memberEl.style.opacity = '';
    memberEl.style.transform = '';
  });
}

/**
 * Emoji cảm xúc bay với quỹ đạo cong trong phòng nghe chung
 */
export function floatRoomEmoji(emoji, x, y) {
  if (prefersReducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'room-float-emoji';
  const randX = (Math.random() - 0.5) * 120;
  el.style.cssText = `
    position:fixed; left:${x}px; top:${y}px;
    font-size:${24 + Math.random() * 16}px;
    pointer-events:none; z-index:9996; user-select:none;
    --rx:${randX}px;
    animation:roomEmojiFloat 2.2s cubic-bezier(0.16,1,0.3,1) forwards;
  `;
  el.textContent = emoji;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// ============================================================
// CHAT MESSAGE SLIDE-IN
// ============================================================
export function animateChatMessage(msgEl) {
  if (!msgEl || prefersReducedMotion()) return;
  msgEl.style.opacity = '0';
  msgEl.style.transform = 'translateX(-12px)';
  msgEl.style.transition = 'opacity 0.3s ease, transform 0.35s cubic-bezier(0.16,1,0.3,1)';
  requestAnimationFrame(() => {
    msgEl.style.opacity = '';
    msgEl.style.transform = '';
  });
}

// ============================================================
// INIT TẤT CẢ
// ============================================================
export function init() {
  initMagneticButtons();
  initSpotlight();
  initStarTrail();
  initNowPlaying();
}

export function destroy() {
  // Cleanup nếu cần
}
