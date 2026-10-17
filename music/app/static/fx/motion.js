/**
 * fx/motion.js — GSAP Animations, Splash Cinematic, View Transitions, Micro-FX
 * Sóng · Liquid Neon Ocean
 */

// GSAP loaded via CDN (global)
// import gsap from CDN via script tag in HTML

// ============================================================
// SPLASH CINEMATIC
// ============================================================
export function initSplashCinematic() {
  const splash = document.getElementById('splashScreen');
  if (!splash) return;

  const seen = sessionStorage.getItem('splashSeen');
  
  if (seen) {
    // Fast exit on subsequent visits
    splash.style.transition = 'opacity 0.4s ease-out';
    setTimeout(() => {
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 500);
    }, 300);
    sessionStorage.setItem('splashSeen', '1');
    return;
  }

  // Skip on keydown or click
  const skip = () => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 900);
    sessionStorage.setItem('splashSeen', '1');
  };
  
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') skip(); }, { once: true });
  splash.addEventListener('click', skip, { once: true });

  // Particle text effect
  const canvas = document.createElement('canvas');
  canvas.id = 'splashCanvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  splash.insertBefore(canvas, splash.firstChild);
  
  initParticleText(canvas, 'SÓNG', () => {
    // After particle animation: fade to app
    setTimeout(() => {
      splash.classList.add('hide');
      sessionStorage.setItem('splashSeen', '1');
      setTimeout(() => {
        splash.remove();
        // Stagger-in main UI elements
        staggerInUI();
      }, 900);
    }, 800);
  });
}

function initParticleText(canvas, text, onComplete) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  
  // Sample text to get pixel positions
  const offscreen = document.createElement('canvas');
  const fontSize = Math.min(W * 0.18, 140);
  offscreen.width = W;
  offscreen.height = H;
  const oc = offscreen.getContext('2d');
  oc.fillStyle = '#fff';
  oc.font = `900 ${fontSize}px "Space Grotesk", sans-serif`;
  oc.textAlign = 'center';
  oc.textBaseline = 'middle';
  oc.fillText(text, W / 2, H / 2);
  
  const data = oc.getImageData(0, 0, W, H).data;
  const textPoints = [];
  const step = 4;
  
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > 128) {
        textPoints.push({ tx: x, ty: y });
      }
    }
  }
  
  // Particles
  const MAX = Math.min(textPoints.length, 2000);
  const selected = textPoints.sort(() => Math.random() - 0.5).slice(0, MAX);
  
  const particles = selected.map(p => ({
    x: (Math.random() - 0.5) * W * 1.5 + W / 2,
    y: (Math.random() - 0.5) * H * 1.5 + H / 2,
    tx: p.tx,
    ty: p.ty,
    vx: 0,
    vy: 0,
    color: ['#3CF2FF', '#8B5CFF', '#FF3DA5', '#FFC14D'][Math.floor(Math.random() * 4)],
    size: Math.random() * 2 + 1,
    gathered: false
  }));
  
  let startTime = performance.now();
  const GATHER_DURATION = 1200;
  const HOLD_DURATION = 600;
  const EXPLODE_DURATION = 500;
  
  let phase = 'gather';
  
  function draw() {
    const now = performance.now();
    const elapsed = now - startTime;
    
    ctx.clearRect(0, 0, W, H);
    
    if (phase === 'gather') {
      const t = Math.min(elapsed / GATHER_DURATION, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      
      particles.forEach(p => {
        p.x += (p.tx - p.x) * ease * 0.15;
        p.y += (p.ty - p.y) * ease * 0.15;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = ease;
        ctx.fill();
      });
      
      if (t >= 1) { phase = 'hold'; startTime = now; }
      
    } else if (phase === 'hold') {
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.tx, p.ty, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1;
        ctx.fill();
      });
      
      // Add glow shimmer
      const glow = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W * 0.4);
      glow.addColorStop(0, 'rgba(60,242,255,0.05)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      
      if (elapsed >= HOLD_DURATION) { phase = 'explode'; startTime = now; }
      
    } else if (phase === 'explode') {
      const t = Math.min(elapsed / EXPLODE_DURATION, 1);
      
      particles.forEach(p => {
        if (!p.gathered) {
          const angle = Math.atan2(p.ty - H/2, p.tx - W/2);
          const speed = (1 + Math.random()) * t * 8;
          p.vx = Math.cos(angle) * speed + (Math.random() - 0.5) * 3;
          p.vy = Math.sin(angle) * speed + (Math.random() - 0.5) * 3;
          p.gathered = true;
        }
        p.x += p.vx;
        p.y += p.vy;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1 - t;
        ctx.fill();
      });
      
      if (t >= 1) {
        ctx.clearRect(0, 0, W, H);
        onComplete?.();
        return;
      }
    }
    
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  
  requestAnimationFrame(draw);
}

// ============================================================
// STAGGER-IN UI ON APP LOAD
// ============================================================
function staggerInUI() {
  const sidebar = document.querySelector('.side');
  const header = document.querySelector('.view.on .view-header');
  const player = document.getElementById('player');
  const themeSwitcher = document.querySelector('.theme-switcher');
  const mobileNav = document.querySelector('.mobile-nav');
  
  const els = [sidebar, player, themeSwitcher, mobileNav, header].filter(Boolean);
  
  els.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
      el.style.transition = `opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)`;
      el.style.opacity = '';
      el.style.transform = '';
      setTimeout(() => {
        el.style.transition = '';
        el.style.opacity = '';
        el.style.transform = '';
      }, 600);
    }, i * 80 + 100);
  });
}

// ============================================================
// VIEW TRANSITION (GSAP fallback + View Transitions API)
// ============================================================
let lastViewIndex = 0;
const VIEW_ORDER = ['home', 'youtube', 'soundcloud', 'library', 'downloads'];

export function animateViewTransition(oldView, newView, callback) {
  const oldIdx = VIEW_ORDER.indexOf(oldView);
  const newIdx = VIEW_ORDER.indexOf(newView);
  const dir = newIdx >= oldIdx ? 1 : -1;
  
  if (document.startViewTransition && !prefersReducedMotion()) {
    document.startViewTransition(() => {
      callback();
    });
    return;
  }
  
  // GSAP fallback
  const oldEl = document.getElementById('view-' + oldView);
  const newEl = document.getElementById('view-' + newView);
  
  if (!oldEl || !newEl) { callback(); return; }
  
  if (prefersReducedMotion()) {
    callback();
    return;
  }
  
  // Animate out
  const outProps = {
    opacity: 0,
    x: dir * -30,
    filter: 'blur(4px)',
    duration: 0.3,
    ease: 'power2.in',
    onComplete: () => {
      callback();
      // Animate in
      gsapSet(newEl, { opacity: 0, x: dir * 30, filter: 'blur(4px)' });
      gsapTo(newEl, {
        opacity: 1,
        x: 0,
        filter: 'blur(0px)',
        duration: 0.45,
        ease: 'power2.out'
      });
    }
  };
  
  gsapTo(oldEl, outProps);
}

// Safe GSAP wrappers (GSAP loaded globally from CDN)
function gsapTo(el, props) {
  if (window.gsap) return gsap.to(el, props);
  // CSS fallback
  el.style.transition = `opacity ${props.duration || 0.3}s ease, transform ${props.duration || 0.3}s ease`;
  el.style.opacity = props.opacity !== undefined ? props.opacity : '';
  if (props.onComplete) setTimeout(props.onComplete, (props.duration || 0.3) * 1000);
}

function gsapSet(el, props) {
  if (window.gsap) return gsap.set(el, props);
  Object.assign(el.style, {
    opacity: props.opacity !== undefined ? props.opacity : '',
    transform: `translate(${props.x || 0}px, ${props.y || 0}px)`,
    filter: props.filter || ''
  });
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ============================================================
// CARD SHARED ELEMENT (GSAP Flip simulation)
// ============================================================
export function animateCardToPlayer(cardEl) {
  if (prefersReducedMotion()) return;
  
  const art = cardEl?.querySelector('.thumb img');
  const playerArt = document.getElementById('pArt');
  
  if (!art || !playerArt) return;
  
  // Capture initial position
  const from = art.getBoundingClientRect();
  const to = playerArt.getBoundingClientRect();
  
  // Create flying clone
  const clone = art.cloneNode();
  clone.style.cssText = `
    position: fixed;
    top: ${from.top}px;
    left: ${from.left}px;
    width: ${from.width}px;
    height: ${from.height}px;
    border-radius: 12px;
    object-fit: cover;
    z-index: 9980;
    pointer-events: none;
    transition: all 0.5s cubic-bezier(0.34,1.56,0.64,1);
    will-change: transform, width, height, top, left, border-radius;
  `;
  document.body.appendChild(clone);
  
  // Force reflow
  clone.offsetHeight;
  
  // Animate to player position
  clone.style.top = `${to.top}px`;
  clone.style.left = `${to.left}px`;
  clone.style.width = `${to.width}px`;
  clone.style.height = `${to.height}px`;
  clone.style.borderRadius = '10px';
  clone.style.boxShadow = '0 0 20px rgba(60,242,255,0.4)';
  
  setTimeout(() => clone.remove(), 600);
}

// ============================================================
// BEAT REACTIVE UI
// ============================================================
let beatHandlers = [];

window.addEventListener('beat', (e) => {
  const intensity = e.detail?.intensity || 0.5;
  
  // Player border flash
  const player = document.getElementById('player');
  if (player) {
    player.classList.add('beat-flash');
    setTimeout(() => player.classList.remove('beat-flash'), 200);
  }
  
  // Album art scale
  const pArt = document.getElementById('pArt');
  if (pArt && intensity > 0.5) {
    pArt.style.transform = `scale(${1 + intensity * 0.04})`;
    setTimeout(() => { pArt.style.transform = ''; }, 150);
  }
  
  // Mascot bounce
  const mascot = document.getElementById('playerMascot');
  if (mascot?.classList.contains('swaying')) {
    mascot.style.transform = `translateY(-${intensity * 6}px)`;
    setTimeout(() => { mascot.style.transform = ''; }, 120);
  }
});

// ============================================================
// MAGNETIC BUTTONS
// ============================================================
export function initMagneticButtons() {
  if (prefersReducedMotion()) return;
  
  const magnetEls = document.querySelectorAll('.btn.pri, .play, .btn.sc');
  
  magnetEls.forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = 80;
      
      if (dist < radius) {
        const power = (1 - dist / radius) * 0.35;
        btn.style.transform = `translate(${dx * power}px, ${dy * power}px)`;
      }
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
      setTimeout(() => { btn.style.transition = ''; }, 400);
    });
  });
}

// ============================================================
// SPOTLIGHT ON GLASS CARDS (CSS vars --mx --my)
// ============================================================
export function initSpotlight() {
  document.addEventListener('mousemove', (e) => {
    const elements = document.querySelectorAll('.card, .glass, .stage');
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--mx', x + '%');
      el.style.setProperty('--my', y + '%');
    });
  });
}

// ============================================================
// CIRCULAR THEME REVEAL
// ============================================================
export function circularReveal(fromX, fromY, newTheme) {
  const overlay = document.createElement('div');
  overlay.className = 'theme-reveal';
  
  // Compute max radius to cover whole screen
  const maxDist = Math.max(
    Math.hypot(fromX, fromY),
    Math.hypot(window.innerWidth - fromX, fromY),
    Math.hypot(fromX, window.innerHeight - fromY),
    Math.hypot(window.innerWidth - fromX, window.innerHeight - fromY)
  );
  
  const size = maxDist * 2.2;
  
  const themeColors = {
    ocean:     'linear-gradient(135deg, #05070F, #080C18)',
    pink:      'linear-gradient(135deg, #FFF1F5, #FFE4EC)',
    lime:      'linear-gradient(135deg, #020F06, #051A0C)',
    synthwave: 'linear-gradient(135deg, #12001A, #1A0026)'
  };
  
  overlay.style.cssText = `
    position: fixed;
    left: ${fromX - size/2}px;
    top: ${fromY - size/2}px;
    width: ${size}px;
    height: ${size}px;
    border-radius: 50%;
    background: ${themeColors[newTheme] || themeColors.ocean};
    z-index: 800;
    transform: scale(0);
    pointer-events: none;
  `;
  
  document.body.appendChild(overlay);
  
  overlay.offsetHeight; // reflow
  
  overlay.style.transition = 'transform 0.65s cubic-bezier(0.4,0,0.2,1)';
  overlay.style.transform = 'scale(1)';
  
  setTimeout(() => {
    // Apply theme
    document.documentElement.setAttribute('data-theme', newTheme);
    // Remove overlay
    overlay.style.transition = 'opacity 0.3s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 350);
  }, 500);
}

// ============================================================
// NOW PLAYING FULLSCREEN
// ============================================================
export function initNowPlaying() {
  const npEl = document.getElementById('nowPlaying');
  const player = document.getElementById('player');
  
  if (!player || !npEl) return;
  
  // Swipe up to open
  let touchStartY = 0;
  player.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  
  player.addEventListener('touchmove', (e) => {
    const dy = touchStartY - e.touches[0].clientY;
    if (dy > 40) openNowPlaying();
  }, { passive: true });
  
  // Click on album art
  document.getElementById('pArt')?.addEventListener('click', openNowPlaying);
  document.getElementById('pTitle')?.addEventListener('click', openNowPlaying);
  
  // Close
  npEl.querySelector('.np-close')?.addEventListener('click', closeNowPlaying);
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNowPlaying();
  });
  
  // Swipe down to close
  let npTouchStartY = 0;
  npEl.addEventListener('touchstart', (e) => {
    npTouchStartY = e.touches[0].clientY;
  }, { passive: true });
  npEl.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - npTouchStartY;
    if (dy > 60) closeNowPlaying();
  }, { passive: true });
}

export function openNowPlaying() {
  const npEl = document.getElementById('nowPlaying');
  if (!npEl) return;
  
  // Sync content
  const pArt = document.getElementById('pArt')?.src;
  const pTitle = document.getElementById('pTitle')?.textContent;
  const pArtist = document.getElementById('pArtist')?.textContent;
  
  const npArtImg = npEl.querySelector('.np-art img');
  const npTitle = npEl.querySelector('.np-title');
  const npArtist = npEl.querySelector('.np-artist');
  
  if (npArtImg && pArt) npArtImg.src = pArt;
  if (npTitle && pTitle) npTitle.textContent = pTitle;
  if (npArtist && pArtist) npArtist.textContent = pArtist;
  
  npEl.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeNowPlaying() {
  const npEl = document.getElementById('nowPlaying');
  if (npEl) {
    npEl.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ============================================================
// KEYBOARD SHORTCUTS MODAL
// ============================================================
const SHORTCUTS = [
  { key: 'Space', desc: 'Phát / Tạm dừng' },
  { key: '← / →', desc: 'Tua ±5 giây' },
  { key: '↑ / ↓', desc: 'Âm lượng' },
  { key: 'N / P', desc: 'Bài sau / Bài trước' },
  { key: 'S', desc: 'Bật/Tắt Shuffle ngẫu nhiên' },
  { key: 'R', desc: 'Chuyển chế độ Lặp lại' },
  { key: 'L', desc: 'Yêu thích bài hiện tại' },
  { key: 'Q', desc: 'Mở/Đóng Hàng đợi' },
  { key: 'V', desc: 'Đổi chế độ Visualizer' },
  { key: 'T', desc: 'Đổi Theme màu' },
  { key: '/', desc: 'Focus ô Tìm kiếm' },
  { key: 'Esc', desc: 'Đóng cửa sổ / Bỏ qua Splash' },
  { key: '?', desc: 'Hiện bảng phím tắt này' }
];

export function initShortcutsModal() {
  const modal = document.getElementById('shortcutsModal');
  if (!modal) return;
  
  const box = modal.querySelector('.shortcuts-box');
  if (!box) return;
  
  // Populate shortcuts
  const rows = SHORTCUTS.map(s => `
    <div class="sc-row">
      <span class="sc-desc">${s.desc}</span>
      <kbd class="sc-key">${s.key}</kbd>
    </div>
  `).join('');
  
  const closeBtn = `<button class="np-close" id="scModalClose" style="position:static;width:36px;height:36px;margin-top:8px;align-self:flex-end">✕</button>`;
  
  box.innerHTML = `<h3>⌨ Phím tắt</h3>${rows}${closeBtn}`;
  
  document.getElementById('scModalClose')?.addEventListener('click', () => {
    modal.classList.remove('open');
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
}

// ============================================================
// TEXT SCRAMBLE EFFECT
// ============================================================
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

export function scrambleText(el, newText, duration = 600) {
  if (!el) return;
  
  const frames = Math.floor(duration / 16);
  let frame = 0;
  const original = newText;
  
  const tick = () => {
    const progress = frame / frames;
    let output = '';
    
    for (let i = 0; i < original.length; i++) {
      if (i < progress * original.length) {
        output += original[i];
      } else {
        output += CHARS[Math.floor(Math.random() * CHARS.length)];
      }
    }
    
    el.textContent = output;
    frame++;
    
    if (frame <= frames) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = original;
    }
  };
  
  requestAnimationFrame(tick);
}

// ============================================================
// CARD 3D TILT + GLARE (enhanced version)
// ============================================================
export function bindEnhancedTilt(container) {
  if (prefersReducedMotion() || ('ontouchstart' in window)) return;
  
  const cards = container.querySelectorAll('.card');
  cards.forEach(card => {
    if (card._hasEnhancedTilt) return;
    card._hasEnhancedTilt = true;
    
    // Add glare element
    if (!card.querySelector('.card-glare')) {
      const glare = document.createElement('div');
      glare.className = 'card-glare';
      card.appendChild(glare);
    }
    
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      
      card.style.transform = `
        perspective(800px)
        rotateY(${x * 12}deg)
        rotateX(${-y * 10}deg)
        translateZ(10px)
        translateY(-6px)
      `;
      
      // Glare position
      const glare = card.querySelector('.card-glare');
      if (glare) {
        glare.style.background = `radial-gradient(
          circle at ${(x + 0.5) * 100}% ${(y + 0.5) * 100}%,
          rgba(255,255,255,0.15) 0%,
          transparent 60%
        )`;
        glare.style.opacity = '1';
      }
      
      // Spotlight CSS vars
      card.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
      card.style.setProperty('--my', `${(y + 0.5) * 100}%`);
    });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      const glare = card.querySelector('.card-glare');
      if (glare) glare.style.opacity = '0';
    });
  });
}

// ============================================================
// SCROLL VELOCITY SKEW (Recent track row)
// ============================================================
export function initScrollSkew() {
  if (prefersReducedMotion()) return;
  
  const grids = document.querySelectorAll('.grid');
  grids.forEach(grid => {
    let lastScroll = 0;
    grid.addEventListener('scroll', () => {
      const velocity = grid.scrollLeft - lastScroll;
      lastScroll = grid.scrollLeft;
      
      grid.querySelectorAll('.card').forEach(card => {
        card.style.transform = `skewX(${-velocity * 0.3}deg)`;
      });
      
      clearTimeout(grid._skewTimeout);
      grid._skewTimeout = setTimeout(() => {
        grid.querySelectorAll('.card').forEach(card => {
          card.style.transform = '';
        });
      }, 150);
    }, { passive: true });
  });
}
