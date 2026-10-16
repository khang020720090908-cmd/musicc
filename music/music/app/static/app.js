'use strict';

/* ==========================================================================
   SÓNG · MEDIA HUB — HELLO KITTY MILK PINK THEME (HỒNG SỮA)
   Hệ thống điều khiển, âm thanh, visualizer & Animation 60fps
   ========================================================================== */

/* ========== 1. TIỆN ÍCH CƠ BẢN ========== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

/* Biểu tượng SVG (Thick & Rounded) */
const P = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
  next: '<path d="M16 5h2v14h-2zM4 5l11 7L4 19z"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  listplus: '<path d="M3 6h12M3 12h8M3 18h8M17 14v6M14 17h6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"/>',
  copy: '<path d="M9 9h11v11H9zM5 15V4h11"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  vol: '<path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  video: '<path d="M3 6h13v12H3zM16 10l5-3v10l-5-3"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.6 1A3.5 3.5 0 0117 18z"/>'
};
const FILLED = ['play', 'pause', 'prev', 'next'];
const svg = n => `<svg class="ic ${FILLED.includes(n) ? 'f' : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
const $icons = () => $$('[data-i]').forEach(e => e.innerHTML = svg(e.dataset.i));

/* Toast thông báo bong bóng thoại mèo dễ thương */
let toastT;
const toast = m => {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
};

/* Gọi API Backend */
async function api(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || 'Máy chủ gặp lỗi (' + r.status + ')');
  return j;
}

/* ========== 2. TRẠNG THÁI (STATE) ========== */
const S = {
  queue: [],
  idx: -1,
  cur: null,
  mode: 'video',
  repeat: 'off',
  shuffle: false,
  lists: store.get('lists', { 'Yêu thích': [] }),
  recent: store.get('recent', [])
};
const TR = {}, DL = [], key = t => t.provider + ':' + t.id;
const inList = (n, t) => S.lists[n] && S.lists[n].some(x => key(x) === key(t));
function toggleIn(n, t) {
  if (!S.lists[n]) S.lists[n] = [];
  const a = S.lists[n], i = a.findIndex(x => key(x) === key(t));
  i < 0 ? a.push(t) : a.splice(i, 1);
  store.set('lists', S.lists);
}

/* Kiểm tra tùy chọn Giảm chuyển động */
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ========== 3. ĐIỀU HƯỚNG VIEW (NAVIGATION) ========== */
function go(v) {
  $$('.view').forEach(e => {
    const isTarget = e.id === 'view-' + v;
    if (isTarget) {
      e.classList.add('on');
    } else {
      e.classList.remove('on');
    }
  });

  $$('.nav').forEach(b => {
    const isOn = b.dataset.view === v;
    b.classList.toggle('on', isOn);
  });

  if (v === 'library') renderLib();
  if (v === 'home') renderRecent();

  scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* ========== 4. HIỂN THỊ BÀI HÁT (CARDS, SKELETONS, EMPTY STATES) ========== */
const img = t => t.thumb ? `<img src="${esc(t.thumb)}" loading="lazy" alt="" referrerpolicy="no-referrer">` : '';

function card(t) {
  TR[key(t)] = t;
  const isNow = S.cur && key(S.cur) === key(t);
  return `<article class="card ${isNow ? 'now' : ''}" data-k="${esc(key(t))}">
    <div class="thumb" data-act="play" title="Bấm để phát ngay nè ♡">
      ${img(t)}
      <span class="dur">${fmt(t.duration)}</span>
      <span class="pbtn">${svg('play')}</span>
    </div>
    <h3>${esc(t.title)}</h3>
    <p>${esc(t.artist)}</p>
    <div class="crow">
      <button class="ib" data-act="queue" title="Thêm vào hàng đợi">${svg('list')}</button>
      <button class="ib ${inList('Yêu thích', t) ? 'on' : ''}" data-act="fav" title="Yêu thích">${svg('heart')}</button>
      <button class="ib" data-act="pl" title="Thêm vào danh sách phát">${svg('listplus')}</button>
      <button class="ib" data-act="copy" title="Copy link bài hát">${svg('copy')}</button>
      <button class="ib" data-act="mp3" title="Tải về file MP3">${svg('download')}</button>
    </div>
  </article>`;
}

/* Mascot rỗng khi không có kết quả / danh sách rỗng */
function emptyStateHtml(msg) {
  return `<div class="empty">
    <div class="empty-mascot-icon">
      <svg viewBox="0 0 100 85" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M22 34 L26 10 C27 7 30 7 33 11 L43 27" fill="#FFFFFF" stroke="#5B3A4A" stroke-width="3"/>
        <path d="M26 15 L28 11 C29 9 31 9 32 12 L38 23" fill="#FFB5C5"/>
        <path d="M78 34 L74 10 C73 7 70 7 67 11 L57 27" fill="#FFFFFF" stroke="#5B3A4A" stroke-width="3"/>
        <path d="M74 15 L72 11 C71 9 69 9 68 12 L62 23" fill="#FFB5C5"/>
        <ellipse cx="50" cy="48" rx="38" ry="30" fill="#FFFFFF" stroke="#5B3A4A" stroke-width="3"/>
        <ellipse cx="27" cy="53" rx="5.5" ry="3.8" fill="#FF8FB1" opacity="0.6"/>
        <ellipse cx="73" cy="53" rx="5.5" ry="3.8" fill="#FF8FB1" opacity="0.6"/>
        <path d="M33 48 Q36 44 40 48" stroke="#5B3A4A" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <path d="M60 48 Q64 44 68 48" stroke="#5B3A4A" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <ellipse cx="50" cy="52" rx="3.6" ry="2.6" fill="#FFD966" stroke="#5B3A4A" stroke-width="1.6"/>
        <path d="M14 44 L25 46 M12 51 L24 51 M14 58 L25 56" stroke="#5B3A4A" stroke-width="2" stroke-linecap="round"/>
        <path d="M86 44 L75 46 M88 51 L76 51 M86 58 L75 56" stroke="#5B3A4A" stroke-width="2" stroke-linecap="round"/>
        <g class="kitty-bow" transform="translate(25, 14)">
          <ellipse cx="-8" cy="-5" rx="7.5" ry="6" fill="#E8344E" stroke="#5B3A4A" stroke-width="2.2"/>
          <ellipse cx="8" cy="5" rx="7.5" ry="6" fill="#E8344E" stroke="#5B3A4A" stroke-width="2.2"/>
          <circle cx="0" cy="0" r="5" fill="#FF5C8A" stroke="#5B3A4A" stroke-width="2.2"/>
        </g>
      </svg>
    </div>
    <p>${msg}</p>
  </div>`;
}

const sk = n => Array.from({ length: n }, () => '<div class="sk"></div>').join('');

async function search(provider, q, el) {
  el.innerHTML = sk(8);
  try {
    const { results } = await api(`/api/${provider}/search?q=${encodeURIComponent(q)}`);
    el.innerHTML = results && results.length ? results.map(card).join('') : emptyStateHtml('Hổng tìm thấy bài nào hết trơn á... Bạn thử tìm từ khóa khác xem sao nha ♡');
    bindCardTilt(el);
  } catch (e) {
    el.innerHTML = emptyStateHtml(`Ui tiêu rồi: ${esc(e.message)}. Thử lại chút nha bạn iu! ♡`);
  }
}

function renderRecent() {
  const el = $('#recent');
  if (!el) return;
  el.innerHTML = S.recent.length ? S.recent.map(card).join('') : emptyStateHtml('Các bài bạn phát sẽ xuất hiện ở đây nè ♡');
  bindCardTilt(el);
}

function renderLib() {
  const el = $('#libList');
  if (!el) return;
  el.innerHTML = Object.entries(S.lists).map(([n, a]) => `
    <section class="lib">
      <div class="lh">
        <h3>${esc(n)} <small>♡ ${a.length} bài</small></h3>
        ${n !== 'Yêu thích' ? `<button class="btn" data-lrm="${esc(n)}">Xóa danh sách</button>` : ''}
      </div>
      <div class="grid">${a.length ? a.map(card).join('') : emptyStateHtml('Danh sách này đang trống nè, thêm bài vào nha ♡')}</div>
    </section>`).join('');
  bindCardTilt(el);
}

function renderQueue() {
  const qEl = $('#queueList');
  if (!qEl) return;
  qEl.innerHTML = S.queue.length ? S.queue.map((t, i) => {
    const isNow = i === S.idx;
    return `<div class="qi ${isNow ? 'now' : ''}" data-qi="${i}">
      ${img(t)}
      <span>
        ${isNow ? '<span class="eq-bars" aria-hidden="true"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>' : ''}
        ${esc(t.title)}<br><small class="mut">${esc(t.artist)}</small>
      </span>
      <button class="ib" data-qrm="${i}" aria-label="Bỏ khỏi hàng đợi" title="Xóa khỏi hàng đợi">${svg('x')}</button>
    </div>`;
  }).join('') : '<p class="mut" style="padding:14px; text-align:center;">Hàng đợi đang trống nè ♡</p>';
}

/* ========== 5. TRÌNH PHÁT HỢP NHẤT (AUDIO + YOUTUBE IFRAME) ========== */
const audio = $('#audio');
let yt = null, ytReady = false, ytPending = null, ac, an, fft;
const usingYT = () => S.cur?.provider === 'youtube' && S.mode === 'video';
const ytOK = () => yt && yt.getPlayerState;
const isPlaying = () => usingYT() ? ytOK() && yt.getPlayerState() === 1 : !audio.paused;
const pos = () => usingYT() ? (ytOK() ? yt.getCurrentTime() : 0) : audio.currentTime || 0;
const dur = () => usingYT() ? (ytOK() ? yt.getDuration() : 0) || S.cur?.duration || 0 : (isFinite(audio.duration) ? audio.duration : 0) || S.cur?.duration || 0;
const seekTo = s => usingYT() ? ytOK() && yt.seekTo(s, true) : (audio.currentTime = s);
const streamUrl = t => '/api/stream/audio?url=' + encodeURIComponent(t.url);

window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('ytPlayer', {
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        ytReady = true;
        if (ytPending) {
          yt.loadVideoById(ytPending.id, ytPending.t);
          ytPending = null;
        }
      },
      onStateChange: e => {
        if (e.data === 1) audio.pause();
        if (e.data === 0 && usingYT()) next(true);
      }
    }
  });
};
document.head.appendChild(Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api', async: true }));

audio.addEventListener('play', () => {
  if (!ac) initAnalyser();
  if (ac.state === 'suspended') ac.resume();
  if (ytOK() && yt.getPlayerState() === 1) yt.pauseVideo();
});
audio.addEventListener('ended', () => next(true));
audio.addEventListener('error', () => {
  if (!S.cur || usingYT() || !audio.getAttribute('src')) return;
  if (S.cur.provider === 'youtube') {
    toast('Máy chủ không lấy được âm thanh, chuyển sang YouTube nha ♡');
    setMode('video', true);
  } else {
    toast('Track này hổng phát được rồi, chọn bài khác nha bạn iu ♡');
  }
});

function initAnalyser() {
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaElementSource(audio);
    an = ac.createAnalyser();
    an.fftSize = 128;
    src.connect(an);
    an.connect(ac.destination);
    fft = new Uint8Array(an.frequencyBinCount);
  } catch (e) {
    // AudioContext fallback
  }
}

function ytLoad(t, start = 0) {
  ytReady ? yt.loadVideoById(t.id, start) : (ytPending = { id: t.id, t: start });
}
function audioLoad(t, start = 0) {
  audio.src = streamUrl(t);
  if (start) audio.addEventListener('loadedmetadata', () => audio.currentTime = start, { once: true });
  audio.play().catch(() => {});
}

function loadTrack(t, start = 0) {
  S.cur = t;
  S.recent = [t, ...S.recent.filter(x => key(x) !== key(t))].slice(0, 16);
  store.set('recent', S.recent);

  if (ytOK()) yt.pauseVideo();
  audio.pause();

  if (usingYT()) ytLoad(t, start);
  else audioLoad(t, start);

  syncUI();
  renderQueue();

  // Hiệu ứng ăn mừng khi phát bài đầu tiên trong phiên
  if (!sessionStorage.getItem('playedFirst')) {
    sessionStorage.setItem('playedFirst', '1');
    burstConfetti(window.innerWidth / 2, window.innerHeight * 0.7, 18);
  }
}

function toggle() {
  if (!S.cur) return toast('Chọn một bài hát kẹo ngọt để phát nha bạn iu ♡');
  if (usingYT()) {
    ytOK() && (isPlaying() ? yt.pauseVideo() : yt.playVideo());
  } else {
    audio.paused ? audio.play() : audio.pause();
  }
}

function next(auto) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') return seekTo(0), usingYT() ? yt.playVideo() : audio.play();
  let i = S.shuffle && S.queue.length > 1 ? (() => {
    let r;
    do r = Math.floor(Math.random() * S.queue.length); while (r === S.idx);
    return r;
  })() : S.idx + 1;

  if (i >= S.queue.length) {
    if (S.repeat === 'all' || !auto) i = 0;
    else return;
  }
  S.idx = i;
  loadTrack(S.queue[i]);
}

function prev() {
  if (pos() > 3 || S.idx <= 0) return seekTo(0);
  S.idx--;
  loadTrack(S.queue[S.idx]);
}

function playFrom(cardEl) {
  const list = $$('[data-k]', cardEl.parentElement).map(c => TR[c.dataset.k]), t = TR[cardEl.dataset.k];
  S.queue = list;
  S.idx = list.indexOf(t);
  loadTrack(t);
}

function enqueue(t) {
  S.queue.push(t);
  if (S.idx < 0) {
    S.idx = 0;
    loadTrack(t);
  }
  renderQueue();
  toast('Đã thêm vào hàng đợi rồi nè ♡');
}

function setMode(m, force) {
  if (m === S.mode) return;
  const t = S.cur, playing = isPlaying(), at = pos();
  S.mode = m;
  if (ytOK()) yt.pauseVideo();
  audio.pause();
  if (m === 'video') {
    audio.removeAttribute('src');
    audio.load();
  }
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#ytVideoWrap').hidden = m !== 'video';
  $('#ytAudioWrap').hidden = m !== 'audio';
  $('#modeHint').textContent = m === 'video' ? 'Phát bằng trình nhúng YouTube' : 'Chỉ phát âm thanh để tiết kiệm mạng nha ♡';
  if (t?.provider === 'youtube' && (playing || at > 0 || force)) {
    if (m === 'video') ytLoad(t, at);
    else audioLoad(t, at);
  }
}

/* ========== 6. ĐỒNG BỘ GIAO DIỆN THEO BÀI ĐANG PHÁT (SYNC UI) ========== */
function syncUI() {
  const t = S.cur;
  if (!t) return;

  // Lật nhẹ ảnh bìa player khi đổi bài
  const pArt = $('#pArt');
  if (pArt) {
    pArt.style.transform = 'scale(0.8) rotate(-10deg)';
    setTimeout(() => {
      pArt.src = t.thumb || '';
      pArt.style.transform = 'scale(1) rotate(0deg)';
    }, 150);
  }

  $('#pTitle').textContent = t.title;
  $('#pArtist').textContent = t.artist;

  const y = t.provider === 'youtube';
  $('#ytTitle').textContent = y ? t.title : 'Chưa chọn video';
  $('#ytArtist').textContent = y ? t.artist : 'Chọn một kết quả bên dưới để bắt đầu nghe nha~';
  $('#ytArt').src = y ? (t.thumb || '') : '';

  $('#scTitle').textContent = !y ? t.title : 'Chưa chọn track';
  $('#scArtist').textContent = !y ? t.artist : 'Tìm và chọn một track để nghe nha bạn iu.';
  $('#scArt').src = !y ? (t.thumb || '') : '';

  $$('.card').forEach(c => c.classList.toggle('now', c.dataset.k === key(t)));
  $$('.vwrap, .audiostage').forEach(e => e.style.opacity = y ? 1 : 0.35);

  document.title = `${t.title} · Sóng ♡`;
}

/* ========== 7. VISUALIZER & WAVEFORM (HỒNG SỮA & BƠ VÀNG) ========== */
function levels(pl, ts) {
  const n = 48, o = new Array(n).fill(0.04);
  if (!pl) return o;
  if (!usingYT() && an) {
    an.getByteFrequencyData(fft);
    for (let i = 0; i < n; i++) {
      o[i] = fft[Math.floor(i * fft.length * 0.8 / n)] / 255;
    }
    return o;
  }
  // Mô phỏng mượt mà cho YouTube iframe
  for (let i = 0; i < n; i++) {
    o[i] = 0.22 + 0.6 * Math.abs(Math.sin(ts / 260 + i * 0.55) * Math.cos(ts / 410 + i * 0.21));
  }
  return o;
}

function fit(c) {
  const d = devicePixelRatio || 1, w = c.clientWidth * d, h = c.clientHeight * d;
  if (!w || !h) return null;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  return { x, w, h, d };
}

/* Vẽ các thanh âm thanh màu hồng kẹo -> đào -> bơ vàng */
function bars(c, v, a, b) {
  const f = fit(c);
  if (!f) return;
  const g = f.x.createLinearGradient(0, f.h, 0, 0);
  g.addColorStop(0, '#FF5C8A');    // Hồng đậm ở đáy
  g.addColorStop(0.55, '#FF8FB1'); // Hồng kẹo ở giữa
  g.addColorStop(1, '#FFD966');    // Vàng bơ ở đỉnh

  f.x.fillStyle = g;
  const bw = f.w / v.length;
  v.forEach((p, i) => {
    const bh = Math.max(3 * f.d, p * f.h);
    f.x.beginPath();
    if (f.x.roundRect) {
      f.x.roundRect(i * bw + bw * 0.18, f.h - bh, bw * 0.64, bh, [bw * 0.32, bw * 0.32, 2, 2]);
    } else {
      f.x.rect(i * bw + bw * 0.18, f.h - bh, bw * 0.64, bh);
    }
    f.x.fill();

    // Chấm tròn nảy trên đỉnh thanh khi biên độ cao
    if (p > 0.45) {
      f.x.fillStyle = '#E8344E';
      f.x.beginPath();
      f.x.arc(i * bw + bw * 0.5, f.h - bh - 3 * f.d, Math.min(2.5 * f.d, bw * 0.25), 0, Math.PI * 2);
      f.x.fill();
      f.x.fillStyle = g;
    }
  });
}

const WV = {};
function wave(c, t, frac, pl, ts) {
  const f = fit(c);
  if (!f) return;
  const n = 90;
  if (!WV[t.id]) {
    let h = 7;
    for (const ch of (t.id || 'hello')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    WV[t.id] = Array.from({ length: n }, () => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return 0.2 + 0.8 * (h / 4294967296);
    });
  }
  const g = f.x.createLinearGradient(0, 0, f.w, 0);
  g.addColorStop(0, '#FF5C8A');
  g.addColorStop(1, '#FF8FB1');
  const bw = f.w / n;
  WV[t.id].forEach((a, i) => {
    const k = pl ? 0.9 + 0.1 * Math.sin(ts / 180 + i * 0.6) : 1;
    const bh = a * k * f.h;
    f.x.fillStyle = (i / n < frac) ? g : 'rgba(255, 180, 205, 0.45)';
    f.x.beginPath();
    if (f.x.roundRect) {
      f.x.roundRect(i * bw + bw * 0.2, (f.h - bh) / 2, bw * 0.6, bh, bw * 0.3);
    } else {
      f.x.rect(i * bw + bw * 0.2, (f.h - bh) / 2, bw * 0.6, bh);
    }
    f.x.fill();
  });
}

let lastPl = null;
function frame(ts) {
  const p = pos(), d = dur(), pl = isPlaying(), seek = $('#seek');

  if (document.activeElement !== seek && seek) {
    seek.max = d || 1;
    seek.value = p;
    // Cập nhật tooltip thời gian tua
    const tooltip = $('#seekTooltip');
    if (tooltip && d) {
      tooltip.style.left = `${(p / d) * 100}%`;
      tooltip.textContent = fmt(p);
    }
  }

  $('#tCur').textContent = fmt(p);
  $('#tDur').textContent = fmt(d);

  if (pl !== lastPl) {
    lastPl = pl;
    $('#ppIcon').innerHTML = svg(pl ? 'pause' : 'play');
    $('#scDisc').classList.toggle('playing', pl && S.cur?.provider === 'soundcloud');
    $('#ytArtWrap').classList.toggle('playing', pl);
    $('#bPlay').classList.toggle('playing', pl);

    // Cập nhật trạng thái mascot mèo trên player
    const mascot = $('#playerMascot');
    if (mascot) {
      mascot.classList.toggle('swaying', pl);
      mascot.classList.toggle('sleeping', !pl);
    }

    // Cập nhật kim đĩa than (Tonearm)
    const tonearm = $('#scTonearm');
    if (tonearm) {
      tonearm.classList.toggle('playing', pl && S.cur?.provider === 'soundcloud');
    }
  }

  // Tiết kiệm CPU nếu tab bị ẩn
  if (!document.hidden) {
    const v = levels(pl, ts);
    bars($('#viz'), v, '#FF8FB1', '#FF5C8A');

    if ($('#view-youtube').classList.contains('on') && !$('#ytAudioWrap').hidden) {
      bars($('#vizBig'), v, '#FF8FB1', '#FF5C8A');
    }
    if ($('#view-soundcloud').classList.contains('on') && S.cur?.provider === 'soundcloud') {
      wave($('#scWave'), S.cur, d ? p / d : 0, pl, ts);
    }
  }

  requestAnimationFrame(frame);
}

/* ========== 8. TẢI XUỐNG (DOWNLOAD MANAGER) ========== */
let dlPaint = false;
function renderDL() {
  if (dlPaint) return;
  dlPaint = true;
  requestAnimationFrame(() => {
    dlPaint = false;
    const dlEl = $('#dlList');
    if (!dlEl) return;
    dlEl.innerHTML = DL.length ? DL.map(j => `
      <div class="job glass ${j.state === 'err' ? 'err' : ''}">
        <div>
          <b>${esc(j.title)}</b>
          <small>${{
            prep: 'Máy chủ đang chuẩn bị tệp cho bạn nha… ♡',
            dl: 'Đang tải về nè ' + (j.got / 1048576).toFixed(1) + ' MB',
            done: 'Đã lưu xong rồi: ' + esc(j.name) + ' ♡',
            err: 'Ui lỗi rồi: ' + esc(j.err)
          }[j.state]}</small>
        </div>
        <div class="bar ${j.state === 'prep' ? 'ind' : ''}">
          <i style="width:${j.state === 'done' ? 100 : j.pct}%"></i>
        </div>
      </div>`).join('') : '<p class="mut" style="margin-top:16px; text-align:center;">Chưa có lượt tải nào nè. Dán link ở trên hoặc bấm nút tải trên từng bài nha ♡</p>';
  });
}

async function download(t, mode, height) {
  const q = t.provider === 'soundcloud'
    ? `/api/download/soundcloud?url=${encodeURIComponent(t.url)}`
    : `/api/download/youtube?${t.id ? 'video_id=' + t.id : 'url=' + encodeURIComponent(t.url)}&mode=${mode}&height=${height || $('#ytQ').value}`;

  const j = { title: `${t.title} (${mode === 'mp3' ? 'MP3' : 'Video'})`, state: 'prep', pct: 0, got: 0 };
  DL.unshift(j);
  renderDL();
  toast('Đang chuẩn bị tệp, xem tiến độ ở mục Tải xuống nha ♡');

  try {
    const r = await fetch(q);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Lỗi ' + r.status);

    const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), parts = [];
    j.state = 'dl';

    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value);
      j.got += value.length;
      j.pct = total ? j.got / total * 100 : 50;
      renderDL();
    }

    const cd = r.headers.get('content-disposition') || '', m = cd.match(/filename\*=utf-8''([^;]+)/i) || cd.match(/filename="?([^";]+)/i);
    j.name = m ? decodeURIComponent(m[1]) : 'download';

    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob(parts)),
      download: j.name
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 6e4);

    j.state = 'done';
    toast('Đã tải xong: ' + j.name + ' ♡');
    burstConfetti(window.innerWidth / 2, window.innerHeight * 0.4, 20);
  } catch (e) {
    j.state = 'err';
    j.err = e.message;
    toast('Tải thất bại: ' + e.message);
  }
  renderDL();
}

/* ========== 9. DANH SÁCH PHÁT (PLAYLIST MODAL) ========== */
function pickList(t) {
  const m = $('#modal');
  if (!m) return;
  m.innerHTML = `<div class="glass box">
    <h3>Thêm vào danh sách phát ♡</h3>
    ${Object.keys(S.lists).map(n => `
      <button class="pick" data-pk="${esc(n)}">
        ${inList(n, t) ? '✓ ' : ''}${esc(n)}
      </button>`).join('')}
    <button class="btn pri" data-close>Xong rồi nè</button>
  </div>`;
  m.classList.add('open');
  m.onclick = e => {
    const b = e.target.closest('[data-pk]');
    if (b) {
      toggleIn(b.dataset.pk, t);
      return pickList(t);
    }
    if (e.target === m || e.target.closest('[data-close]')) {
      m.classList.remove('open');
      renderLib();
    }
  };
}

/* ========== 10. HIỆU ỨNG MICRO-INTERACTIONS & CONFETTI ========== */

/* Hiệu ứng nổ hạt tim và sao (Confetti burst) */
function burstConfetti(x, y, count = 10) {
  if (prefersReducedMotion()) return;
  const colors = ['#FF5C8A', '#FF8FB1', '#E8344E', '#FFD966', '#BDE3FF'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle-confetti';
    const isHeart = Math.random() > 0.4;
    p.textContent = isHeart ? '♡' : '✦';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.color = colors[Math.floor(Math.random() * colors.length)];
    p.style.fontSize = `${Math.random() * 10 + 14}px`;

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 85 + 35;
    p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--ty', `${Math.sin(angle) * dist - 25}px`);
    p.style.setProperty('--tr', `${(Math.random() - 0.5) * 360}deg`);

    document.body.appendChild(p);
    setTimeout(() => p.remove(), 850);
  }
}

/* Hiệu ứng gợn sóng (Ripple) khi click nút */
function createRipple(e, target) {
  if (prefersReducedMotion()) return;
  const rect = target.getBoundingClientRect();
  const circle = document.createElement('span');
  const d = Math.max(rect.width, rect.height);
  const x = e.clientX - rect.left - d / 2;
  const y = e.clientY - rect.top - d / 2;

  circle.className = 'ripple-circle';
  circle.style.width = circle.style.height = `${d}px`;
  circle.style.left = `${x}px`;
  circle.style.top = `${y}px`;

  target.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
}

/* Hiệu ứng nghiêng 3D theo chuột trên Card (Card Tilt <= 6deg) */
function bindCardTilt(container) {
  if (prefersReducedMotion() || ('ontouchstart' in window)) return;
  $$('.card', container).forEach(c => {
    if (c._hasTilt) return;
    c._hasTilt = true;
    c.addEventListener('mousemove', e => {
      const rect = c.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      c.style.transform = `perspective(700px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-6px)`;
    });
    c.addEventListener('mouseleave', () => {
      c.style.transform = '';
    });
  });
}

/* Hạt bay trang trí nền (Bows, Hearts, Stars, Cookies) */
function initBackgroundDecors() {
  const container = $('#bgDecors');
  if (!container || prefersReducedMotion()) return;
  const decors = ['🎀', '♡', '✦', '🌸', '🍓', '✨', '🍎', '🍰'];
  const count = 16;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'floating-item';
    el.textContent = decors[i % decors.length];
    el.style.left = `${Math.random() * 96}vw`;
    el.style.animationDelay = `${Math.random() * 16}s`;
    el.style.animationDuration = `${Math.random() * 10 + 14}s`;
    el.style.fontSize = `${Math.random() * 12 + 16}px`;
    container.appendChild(el);
  }
}

/* Con trỏ tùy chỉnh mượt mà (Desktop Custom Cursor) */
function initCustomCursor() {
  const cur = $('#customCursor');
  const trail = $('#cursorTrail');
  if (!cur || !trail || prefersReducedMotion() || ('ontouchstart' in window)) return;

  let mouseX = -100, mouseY = -100;
  let trailX = -100, trailY = -100;
  let lastSparkle = 0;

  window.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cur.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%)`;

    // Rải vài hạt sao mờ khi di chuột (rất tiết chế)
    const now = performance.now();
    if (now - lastSparkle > 80 && Math.random() > 0.5) {
      lastSparkle = now;
      const sp = document.createElement('span');
      sp.className = 'cursor-sparkle';
      sp.textContent = Math.random() > 0.5 ? '✨' : '♡';
      sp.style.left = `${mouseX}px`;
      sp.style.top = `${mouseY}px`;
      sp.style.color = '#FF8FB1';
      sp.style.fontSize = '12px';
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 700);
    }
  });

  // Lerp mượt mà cho vòng đuôi
  function animCursor() {
    trailX += (mouseX - trailX) * 0.22;
    trailY += (mouseY - trailY) * 0.22;
    trail.style.transform = `translate3d(${trailX}px, ${trailY}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(animCursor);
  }
  animCursor();

  // Phóng to con trỏ khi hover phần tử tương tác
  document.addEventListener('mouseover', e => {
    if (e.target.closest('button, a, input, select, .card, .thumb, .qi, .brand, .player-mascot')) {
      document.body.classList.add('cursor-hover');
    } else {
      document.body.classList.remove('cursor-hover');
    }
  });
}

/* Màn hình chào Intro Splash */
function initSplashScreen() {
  const splash = $('#splashScreen');
  if (!splash) return;

  const seen = sessionStorage.getItem('splashSeen');
  const duration = seen ? 450 : 1300;

  setTimeout(() => {
    splash.classList.add('hide');
    sessionStorage.setItem('splashSeen', '1');
    setTimeout(() => splash.remove(), 700);
  }, duration);
}

/* Easter Egg Mèo Hello Kitty */
let easterClicks = 0;
function triggerEasterEgg(x, y) {
  easterClicks++;
  burstConfetti(x, y, 14);
  const quotes = [
    'Meo meo! Chúc bạn iu một ngày ngọt ngào như sữa dâu nha! ♡',
    'Bạn bấm tui nhột quá nè hihi! (ᐢ•͈ᴗ•͈ᐢ) ♡',
    'Nghe nhạc vui vẻ nha, mèo sữa luôn ở đây đồng hành cùng bạn nè! ♡',
    'Bật mí nè: Nơ của tui được thắt cẩn thận bằng tình yêu đó nha! 🎀'
  ];
  toast(quotes[easterClicks % quotes.length]);
}

/* ========== 11. SỰ KIỆN CLICK & TƯƠNG TÁC ========== */
document.addEventListener('click', e => {
  // Hiệu ứng Ripple cho các nút bấm
  const btnEl = e.target.closest('.btn, .ib, .play, .nav, .pick, .seg button');
  if (btnEl) createRipple(e, btnEl);

  // Điều hướng
  const nav = e.target.closest('.nav');
  if (nav) return go(nav.dataset.view);

  // Easter egg khi bấm vào logo hoặc mascot trên player
  const mascotEl = e.target.closest('.brand, .player-mascot, .mascot-badge');
  if (mascotEl) {
    const rect = mascotEl.getBoundingClientRect();
    return triggerEasterEgg(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // Hàng đợi
  const qi = e.target.closest('[data-qi]');
  if (e.target.closest('[data-qrm]')) {
    const i = +e.target.closest('[data-qrm]').dataset.qrm;
    S.queue.splice(i, 1);
    if (i < S.idx) S.idx--;
    return renderQueue();
  }
  if (qi) {
    S.idx = +qi.dataset.qi;
    return loadTrack(S.queue[S.idx]);
  }

  // Xóa danh sách phát
  const lrm = e.target.closest('[data-lrm]');
  if (lrm && confirm('Bạn có chắc muốn xóa danh sách "' + lrm.dataset.lrm + '" không nè?')) {
    delete S.lists[lrm.dataset.lrm];
    store.set('lists', S.lists);
    return renderLib();
  }

  // Các hành động trên bài hát ([data-act])
  const b = e.target.closest('[data-act]');
  if (!b) return;

  const cardEl = b.closest('[data-k]'), stage = b.closest('[data-stage]'), a = b.dataset.act;
  if (a === 'play') return playFrom(cardEl);
  if (stage && S.cur?.provider !== stage.dataset.stage) return toast('Chọn một bài trong mục này trước nha ♡');

  const t = cardEl ? TR[cardEl.dataset.k] : S.cur;
  if (!t) return toast('Chọn một bài hát trước nha ♡');

  ({
    queue: () => enqueue(t),
    pl: () => pickList(t),
    mp3: () => {
      burstConfetti(e.clientX, e.clientY, 8);
      download(t, 'mp3');
    },
    video: () => {
      burstConfetti(e.clientX, e.clientY, 8);
      download(t, 'video');
    },
    fav: () => {
      toggleIn('Yêu thích', t);
      const isFav = inList('Yêu thích', t);
      b.classList.toggle('on', isFav);
      if (isFav) {
        burstConfetti(e.clientX, e.clientY, 10);
        toast('Đã thêm vào Yêu thích rồi nè ♡');
      } else {
        toast('Đã bỏ khỏi Yêu thích ♡');
      }
    },
    copy: () => {
      navigator.clipboard.writeText(t.url).then(() => {
        b.classList.add('copied');
        setTimeout(() => b.classList.remove('copied'), 1500);
        toast('Đã copy link bài hát rồi nè! ♡');
      }, () => toast(t.url));
    }
  })[a]?.();
});

/* Chuyển chế độ video / nhạc trên YouTube Hub */
$('#modeSeg').onclick = e => {
  const b = e.target.closest('[data-mode]');
  b && setMode(b.dataset.mode);
};

/* Form tìm kiếm Trang chủ */
$('#homeForm').onsubmit = e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (!q) return;
  $('#homeRes').hidden = false;
  search('youtube', q, $('#homeYT'));
  search('soundcloud', q, $('#homeSC'));
};

/* Form tìm kiếm YouTube Hub */
$('#ytForm').onsubmit = e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  q && search('youtube', q, $('#ytResults'));
};

/* Form tìm kiếm SoundCloud Studio */
$('#scForm').onsubmit = e => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  q && search('soundcloud', q, $('#scResults'));
};

/* Form tạo danh sách mới */
$('#newList').onsubmit = e => {
  e.preventDefault();
  const n = e.target.n.value.trim();
  if (!n || S.lists[n]) return toast(n ? 'Tên danh sách này có rồi á ♡' : 'Nhập tên danh sách phát nha bạn iu ♡');
  S.lists[n] = [];
  store.set('lists', S.lists);
  e.target.reset();
  renderLib();
  toast('Tạo danh sách mới thành công rồi nè! ♡');
  burstConfetti(window.innerWidth / 2, window.innerHeight * 0.4, 12);
};

/* Form tải xuống trực tiếp từ URL */
$('#dlForm').onsubmit = e => {
  e.preventDefault();
  const u = e.target.u.value.trim(), m = e.target.m.value;
  if (!u) return;
  const sc = /soundcloud\.com/i.test(u);
  download(
    { provider: sc ? 'soundcloud' : 'youtube', id: '', title: u, url: u },
    sc ? 'mp3' : m.startsWith('video') ? 'video' : 'mp3',
    m === 'video1080' ? 1080 : 720
  );
  e.target.reset();
};

/* Nút điều khiển phát nhạc */
$('#bPlay').onclick = toggle;
$('#bNext').onclick = () => next(false);
$('#bPrev').onclick = prev;

/* Nút Shuffle ngẫu nhiên */
$('#bShuffle').onclick = e => {
  S.shuffle = !S.shuffle;
  e.currentTarget.classList.toggle('on', S.shuffle);
  toast(S.shuffle ? 'Đã bật phát ngẫu nhiên ♡' : 'Đã tắt phát ngẫu nhiên ♡');
};

/* Nút Repeat lặp lại */
$('#bRepeat').onclick = e => {
  S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat];
  e.currentTarget.classList.toggle('on', S.repeat !== 'off');
  e.currentTarget.classList.toggle('repeat-one', S.repeat === 'one');
  toast({ off: 'Không lặp lại ♡', all: 'Lặp lại toàn bộ danh sách ♡', one: 'Lặp lại một bài này thôi nè ♡' }[S.repeat]);
};

/* Nút mở/đóng Hàng đợi */
$('#bQueue').onclick = () => {
  renderQueue();
  $('#queueDrawer').classList.toggle('open');
};
$('[data-close-q]').onclick = () =>$('#queueDrawer').classList.remove('open');

/* Thanh tua và âm lượng */
$('#seek').oninput = e => {
  const val = +e.target.value;
  seekTo(val);
  const tooltip = $('#seekTooltip');
  if (tooltip) {
    const d = dur();
    if (d) tooltip.style.left = `${(val / d) * 100}%`;
    tooltip.textContent = fmt(val);
  }
};

$('#vol').oninput = e => {
  audio.volume = +e.target.value;
  ytOK() && yt.setVolume(e.target.value * 100);
};

$('#scWave').onpointerdown = e => {
  const r = e.target.getBoundingClientRect();
  seekTo((e.clientX - r.left) / r.width * dur());
};

/* Phím tắt Space để tạm dừng / phát */
addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) {
    e.preventDefault();
    toggle();
  }
});

/* ========== 12. KHỞI CHẠY HỆ THỐNG ========== */
$icons();
renderRecent();
renderDL();
initBackgroundDecors();
initCustomCursor();
initSplashScreen();
bindCardTilt(document);
requestAnimationFrame(frame);
