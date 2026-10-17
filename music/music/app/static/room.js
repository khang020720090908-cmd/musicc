'use strict';

/* ==========================================================================
   NGHE CHUNG — phòng nghe nhạc đồng bộ qua WebSocket
   Dùng lại các hàm của app.js: loadTrack, seekTo, pos, dur, isPlaying, playLocal, pauseLocal...
   Server giữ "đồng hồ phòng"; client chỉ làm theo trạng thái nhận được và sửa lệch khi cần.
   ========================================================================== */
const Room = (() => {
  const AVATARS = ['🐱', '🐰', '🐻', '🐼', '🦊', '🐸', '🐧', '🦄', '🍓', '🌸', '🍰', '⭐'];
  const REACTS = ['❤️', '😂', '🔥', '👏', '😍', '🎉', '😭', '🥰'];
  const ID_RE = /^[A-Za-z0-9_-]{3,20}$/;

  /* ----- Danh tính (lưu trên trình duyệt để F5 vẫn giữ quyền chủ phòng) ----- */
  let uid = store.get('room_uid', '');
  if (!/^[\w-]{8,40}$/.test(uid)) {
    uid = ((crypto.randomUUID && crypto.randomUUID()) || (Math.random().toString(36).slice(2) + Date.now().toString(36))).slice(0, 40);
    store.set('room_uid', uid);
  }
  const me = { name: store.get('room_name', ''), avatar: store.get('room_avatar', AVATARS[0]) };

  Object.assign(R, {
    ws: null, id: '', name: '', host: null, members: [], chat: [], state: null,
    open: true, loop: false, loaded: null, tries: 0, leaving: false, pw: '',
    unread: 0, needResync: false, tight: false, busy: false
  });

  const send = o => { if (R.ws && R.ws.readyState === 1) R.ws.send(JSON.stringify(o)); };
  const canControl = () => R.host === uid || R.open;
  const viewOn = () => $('#view-room').classList.contains('on');
  const hhmm = ts => new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  async function apiPost(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'Thông tin chưa hợp lệ, kiểm tra lại nha.');
    return j;
  }

  /* ========== KẾT NỐI ========== */
  function closeWs() {
    if (R.ws) {
      const w = R.ws;
      R.ws = null;
      w.onclose = w.onmessage = w.onerror = null;
      try { w.close(); } catch { /* đã đóng */ }
    }
  }

  function connect(id, pw) {
    R.leaving = false;
    R.id = id.toUpperCase();
    R.pw = pw || '';
    closeWs();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = `uid=${encodeURIComponent(uid)}&name=${encodeURIComponent(me.name)}&avatar=${encodeURIComponent(me.avatar)}&pw=${encodeURIComponent(R.pw)}`;
    const ws = new WebSocket(`${proto}://${location.host}/ws/room/${encodeURIComponent(R.id)}?${q}`);
    R.ws = ws;
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      onMsg(m);
    };
    ws.onclose = () => {
      if (R.ws !== ws || R.leaving) return;
      if (R.on) return retry();
      setBusy(false);
      toast('Hổng kết nối được tới phòng, thử lại nha ♡');
    };
  }

  function retry() {
    R.tries++;
    if (R.tries > 6) {
      toast('Mất kết nối với phòng rồi, bạn vào lại nha ♡');
      return leaveLocal();
    }
    if (R.tries === 1) toast('Mất kết nối, đang kết nối lại… ♡');
    setTimeout(() => { if (R.on && !R.leaving) connect(R.id, R.pw); }, Math.min(1000 * R.tries, 5000));
  }

  function setBusy(b) {
    R.busy = b;
    $$('#roomCreateForm button, #roomJoinForm button').forEach(x => x.disabled = b);
  }

  /* ========== NHẬN TIN TỪ SERVER ========== */
  function onMsg(m) {
    switch (m.t) {
      case 'joined': return onJoined(m);
      case 'members':
        R.members = m.members;
        R.host = m.host;
        return renderMeta(), renderMembers();
      case 'state': return applyState(m.s, m.s.reason);
      case 'sync': return applyState(m.s, 'sync');
      case 'chat': return onChat(m.m);
      case 'react': return floatReact(m.emoji, m.name);
      case 'error': return toast(m.msg);
      case 'fatal':
        R.leaving = true;
        setBusy(false);
        toast(m.msg);
        if (R.on) leaveLocal();
        return;
      case 'kicked':
        R.leaving = true;
        toast('Bạn đã bị chủ phòng mời ra khỏi phòng ♡');
        return leaveLocal();
    }
  }

  function onJoined(m) {
    const first = !R.on;
    R.on = true;
    R.tries = 0;
    R.id = m.room.id;
    R.name = m.room.name;
    R.host = m.host;
    R.members = m.members;
    R.chat = m.chat;
    setBusy(false);
    if (first) {
      // Trong phòng phát bằng âm thanh (qua proxy) để đồng bộ chính xác và visualizer hoạt động.
      const cur = S.cur;
      pauseLocal();
      S.cur = null;
      setMode('audio');
      S.cur = cur;
      R.loaded = null;
      rememberRoom(R.id, R.name);
      toast(`Đã vào phòng “${R.name}” ♡`);
      burstConfetti(innerWidth / 2, innerHeight * 0.4, 14);
    }
    showInside();
    renderAll();
    applyState(m.s, 'join');
  }

  /* ========== ĐỒNG BỘ PHÁT NHẠC ========== */
  function stopLocal() {
    audio.pause();
    if (ytOK()) yt.pauseVideo();
  }

  function applyState(st, reason) {
    R.state = st;
    R.open = st.open_control;
    R.loop = st.loop;
    S.queue = st.queue;
    S.idx = st.idx;
    renderQueue();
    renderRQueue();
    renderMeta();
    renderNow();

    const t = st.track;
    if (!t) {
      R.loaded = null;
      stopLocal();
      return;
    }
    const k = key(t);
    if (R.loaded !== k || reason === 'jump') {
      R.loaded = k;
      loadTrack(t, st.pos, st.playing);
      R.needResync = st.playing;  // link nguồn có thể mất vài giây mới phát -> khớp lại khi bắt đầu phát
      return;
    }

    // Cùng bài: chỉ sửa lệch & trạng thái phát/dừng
    const drift = Math.abs(pos() - st.pos);
    if (reason === 'seek' || reason === 'pause' || (reason === 'resume' && drift > 0.8)) {
      seekTo(st.pos);
    } else if (st.playing && drift > (R.tight ? 0.6 : 2)) {
      seekTo(st.pos);
    }
    if (reason === 'sync') R.tight = false;
    if (reason !== 'sync' && reason !== 'queue' && reason !== 'settings') {
      if (st.playing && !isPlaying()) playLocal();
      else if (!st.playing && isPlaying()) pauseLocal();
    }
  }

  audio.addEventListener('playing', () => {
    if (R.on && R.needResync) {
      R.needResync = false;
      R.tight = true;
      send({ t: 'sync' });
    }
  });
  setInterval(() => { if (R.on) send({ t: 'sync' }); }, 10000);  // sửa lệch định kỳ + giữ kết nối

  /* ========== LỆNH TỪ GIAO DIỆN ========== */
  function toggle() {
    const st = R.state;
    if (!st || !st.track) return toast('Phòng chưa có bài nào, thêm bài vào nha ♡');
    if (st.playing && !isPlaying()) return playLocal();  // trình duyệt chặn tự phát: bấm ▶ để nghe cùng
    send({ t: st.playing ? 'pause' : 'resume' });
  }

  function playTrack(t) {
    if (!t) return;
    if (!canControl()) {
      toast('Chỉ chủ phòng được đổi bài, mình thêm vào hàng đợi giúp bạn nha ♡');
      return send({ t: 'queue_add', track: t });
    }
    send({ t: 'play', track: t });
  }

  const addTrack = t => t && send({ t: 'queue_add', track: t });
  const seek = s => send({ t: 'seek', pos: Math.max(0, s || 0) });
  const ended = () => S.cur && send({ t: 'ended', key: key(S.cur) });

  function leaveLocal() {
    closeWs();
    R.on = false;
    R.state = null;
    R.loaded = null;
    R.members = [];
    R.chat = [];
    pauseLocal();
    S.queue = [];
    S.idx = -1;
    renderQueue();
    $('#roomFloat').innerHTML = '';
    $('#roomPill').hidden = true;
    $('#roomLobby').hidden = false;
    $('#roomInside').hidden = true;
    setBusy(false);
    loadPublic();
    renderRecent2();
  }

  function leave() {
    R.leaving = true;
    leaveLocal();
    toast('Đã rời phòng, hẹn gặp lại nha ♡');
  }

  /* ========== HIỂN THỊ ========== */
  function showInside() {
    $('#roomLobby').hidden = true;
    $('#roomInside').hidden = false;
    $('#roomPill').hidden = false;
    if (!viewOn()) go('room');
    else scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function renderAll() {
    renderMeta();
    renderMembers();
    renderChat();
  }

  function renderMeta() {
    if (!R.on) return;
    $('#rmRoomName').textContent = R.name;
    $('#rmRoomId').textContent = R.id;
    const isHost = R.host === uid;
    const o = $('#rmOpen'), l = $('#rmLoop');
    o.checked = !!R.open;
    o.disabled = !isHost;
    l.checked = !!R.loop;
    l.disabled = !canControl();
    $('#rmClearQ').hidden = !canControl();
    $('#roomPill').textContent = `🎧 ${R.id} · ${R.members.length}`;
  }

  function renderNow() {
    const st = R.state, t = st && st.track;
    const art = $('#rmArt');
    art.hidden = !(t && t.thumb);
    if (t && t.thumb && art.getAttribute('src') !== t.thumb) art.src = t.thumb;
    $('#rmArtEmpty').hidden = !!(t && t.thumb);
    $('#rmTitle').textContent = t ? t.title : 'Thêm bài để cả phòng cùng nghe nha ♡';
    $('#rmArtist').textContent = t ? t.artist : 'Tìm bài ở ô bên dưới, bấm ▶ để phát cho cả phòng.';
    $('#rmStatus').textContent = !t ? 'Chưa có bài nào' : st.playing ? `▶ Đang phát cho cả phòng · ${R.members.length} người` : '⏸ Đang tạm dừng';
    $('#rmPlayIcon').innerHTML = svg(st && st.playing ? 'pause' : 'play');
    $('#rmQCount').textContent = st && st.queue.length ? `♡ ${st.queue.length} bài` : '';
  }

  function renderRQueue() {
    const el = $('#roomQueue'), st = R.state;
    if (!el) return;
    el.innerHTML = st && st.queue.length ? st.queue.map((t, i) => `
      <div class="rq ${i === st.idx ? 'now' : ''}">
        ${img(t)}
        <div class="rq-info"><b>${i === st.idx && st.playing ? '🎵 ' : ''}${esc(t.title)}</b><small class="mut">${esc(t.artist)} · ${fmt(t.duration)}</small></div>
        <button class="ib" data-rq-play="${i}" title="Phát bài này cho cả phòng" aria-label="Phát">${svg('play')}</button>
        <button class="ib" data-rq-rm="${i}" title="Xóa khỏi hàng đợi" aria-label="Xóa">${svg('x')}</button>
      </div>`).join('') : '<p class="mut" style="padding:14px;text-align:center;">Hàng đợi đang trống, tìm bài rồi thêm vào nha ♡</p>';
  }

  function renderMembers() {
    const iAmHost = R.host === uid;
    $('#rmMemCount').textContent = `♡ ${R.members.length}`;
    $('#roomMembers').innerHTML = R.members.map(m => {
      const self = m.uid === uid;
      return `<div class="rm ${self ? 'me' : ''}">
        <span class="rm-av">${esc(m.avatar)}</span>
        <span class="rm-name">${esc(m.name)}${self ? ' (bạn)' : ''}</span>
        ${m.host ? '<span class="rm-crown" title="Chủ phòng">👑</span>' : ''}
        ${iAmHost && !self ? `<button class="ib sm" data-rm-host="${esc(m.uid)}" title="Trao quyền chủ phòng">👑</button><button class="ib sm" data-rm-kick="${esc(m.uid)}" title="Mời ra khỏi phòng">🚪</button>` : ''}
      </div>`;
    }).join('');
    $('#roomPill').textContent = `🎧 ${R.id} · ${R.members.length}`;
    renderNow();
  }

  function chatHtml(m) {
    if (m.kind === 'sys') return `<div class="rc-sys">${esc(m.text)}</div>`;
    const self = m.uid === uid;
    return `<div class="rc-msg ${self ? 'me' : ''}">
      <span class="rm-av">${esc(m.avatar)}</span>
      <div class="rc-body"><div class="rc-head"><b>${esc(m.name)}</b><small class="mut">${hhmm(m.ts)}</small></div><div class="rc-text">${esc(m.text)}</div></div>
    </div>`;
  }

  function renderChat() {
    const el = $('#roomChat');
    el.innerHTML = R.chat.map(chatHtml).join('');
    el.scrollTop = el.scrollHeight;
  }

  function onChat(m) {
    R.chat.push(m);
    if (R.chat.length > 100) R.chat.shift();
    const el = $('#roomChat');
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    el.insertAdjacentHTML('beforeend', chatHtml(m));
    while (el.children.length > 100) el.firstChild.remove();
    if (near || m.uid === uid) el.scrollTop = el.scrollHeight;
    if (m.kind === 'msg' && m.uid !== uid && !viewOn()) {
      R.unread++;
      $('#roomDot').hidden = false;
    }
  }

  function floatReact(emoji, name) {
    if (prefersReducedMotion() || !R.on) return;
    const box = $('#roomFloat');
    const el = document.createElement('span');
    el.className = 'room-float';
    el.style.left = `${Math.random() * 85 + 5}%`;
    el.style.setProperty('--dx', `${Math.random() * 60 - 30}px`);
    el.innerHTML = `<b>${esc(emoji)}</b><small>${esc(name)}</small>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /* Thanh tiến độ nhỏ trong phòng */
  setInterval(() => {
    if (!R.on || document.hidden || !R.state || !R.state.track) return;
    const p = pos(), d = dur();
    $('#rmBar').style.width = `${d ? Math.min(100, p / d * 100) : 0}%`;
    $('#rmCur').textContent = fmt(p);
    $('#rmDur').textContent = fmt(d);
    $('#rmPlayIcon').innerHTML = svg(R.state.playing ? 'pause' : 'play');
  }, 500);

  /* ========== SẢNH ========== */
  function rememberRoom(id, name) {
    const a = store.get('room_recent', []).filter(r => r.id !== id);
    a.unshift({ id, name });
    store.set('room_recent', a.slice(0, 5));
  }

  function renderRecent2() {
    const a = store.get('room_recent', []);
    $('#roomRecent').innerHTML = a.length
      ? '<small class="mut">Phòng gần đây:</small>' + a.map(r => `<button type="button" class="room-tag" data-fill="${esc(r.id)}" title="${esc(r.name)}">${esc(r.id)}</button>`).join('')
      : '';
  }

  function renderAvatars() {
    $('#rmAvatars').innerHTML = AVATARS.map(a => `<button type="button" class="av-btn ${a === me.avatar ? 'on' : ''}" data-av="${a}" aria-label="Chọn ${a}">${a}</button>`).join('');
  }

  async function loadPublic() {
    const el = $('#roomPublic');
    try {
      const { rooms } = await api('/api/rooms');
      el.innerHTML = rooms.length ? rooms.map(r => `
        <div class="room-item glass">
          <div class="room-item-info">
            <b>${r.locked ? '🔒 ' : ''}${esc(r.name)}</b>
            <small class="mut">ID: ${esc(r.id)} · ${r.members} người${r.now_playing ? ' · 🎵 ' + esc(r.now_playing) : ''}</small>
          </div>
          <button class="btn sm pri" data-join="${esc(r.id)}" data-locked="${r.locked ? 1 : 0}">Vào</button>
        </div>`).join('') : emptyStateHtml('Chưa có phòng công khai nào, tạo phòng đầu tiên đi nè ♡');
    } catch (e) {
      el.innerHTML = emptyStateHtml('Hổng tải được danh sách phòng: ' + esc(e.message));
    }
  }

  function joinFromLobby(id, pw) {
    id = (id || '').trim();
    if (!ID_RE.test(id)) return toast('ID phòng gồm 3–20 ký tự chữ, số, - hoặc _ nha ♡');
    saveProfile();
    setBusy(true);
    connect(id, pw);
  }

  function saveProfile() {
    me.name = $('#rmName').value.trim().slice(0, 20);
    store.set('room_name', me.name);
    store.set('room_avatar', me.avatar);
  }

  function onShow() {
    R.unread = 0;
    $('#roomDot').hidden = true;
    if (R.on) {
      const el = $('#roomChat');
      el.scrollTop = el.scrollHeight;
    } else {
      loadPublic();
    }
  }

  /* ========== SỰ KIỆN ========== */
  $('#rmName').value = me.name;
  $('#rmName').addEventListener('input', saveProfile);
  $('#rmAvatars').onclick = e => {
    const b = e.target.closest('[data-av]');
    if (!b) return;
    me.avatar = b.dataset.av;
    saveProfile();
    renderAvatars();
  };

  $('#roomCreateForm').onsubmit = async e => {
    e.preventDefault();
    if (R.busy) return;
    const f = e.target, pw = f.pw.value;
    setBusy(true);
    try {
      saveProfile();
      const j = await apiPost('/api/rooms', { name: f.name.value, id: f.id.value.trim() || null, password: pw, public: f.public.checked });
      f.reset();
      connect(j.id, pw);
    } catch (err) {
      setBusy(false);
      toast(err.message);
    }
  };

  $('#roomJoinForm').onsubmit = e => {
    e.preventDefault();
    if (R.busy) return;
    joinFromLobby(e.target.id.value, e.target.pw.value);
  };

  $('#roomRecent').onclick = e => {
    const b = e.target.closest('[data-fill]');
    if (b) $('#roomJoinForm').id.value = b.dataset.fill;
  };

  $('#roomRefresh').onclick = loadPublic;
  $('#roomPublic').onclick = e => {
    const b = e.target.closest('[data-join]');
    if (!b) return;
    const f = $('#roomJoinForm');
    f.id.value = b.dataset.join;
    if (b.dataset.locked === '1') {
      f.pw.focus();
      toast('Phòng này có mật khẩu, nhập mật khẩu rồi bấm Vào phòng nha ♡');
    } else {
      joinFromLobby(b.dataset.join, '');
    }
  };

  $('#rmLeave').onclick = leave;
  $('#roomPill').onclick = () => go('room');
  $('#rmCopyId').onclick = () => navigator.clipboard.writeText(R.id).then(() => toast('Đã copy ID phòng ♡'), () => toast(R.id));
  $('#rmCopyLink').onclick = () => {
    const link = `${location.origin}/?room=${encodeURIComponent(R.id)}`;
    navigator.clipboard.writeText(link).then(() => toast('Đã copy link mời, gửi cho bạn bè nha ♡'), () => toast(link));
  };

  $('#rmOpen').onchange = e => send({ t: 'settings', open_control: e.target.checked });
  $('#rmLoop').onchange = e => send({ t: 'settings', loop: e.target.checked });
  $('#rmClearQ').onclick = () => confirm('Xóa hết hàng đợi của phòng?') && send({ t: 'clear_queue' });

  $('#rmPlay').onclick = toggle;
  $('#rmPrev').onclick = prev;
  $('#rmNext').onclick = () => next(false);
  $('#rmSync').onclick = () => {
    R.tight = true;
    R.loaded = null;  // nạp lại bài hiện tại theo đúng vị trí của phòng
    send({ t: 'sync' });
    toast('Đang khớp lại với phòng… ♡');
  };

  $('#roomSearchForm').onsubmit = e => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    q && search(e.target.p.value, q, $('#roomResults'));
  };

  $('#roomQueue').onclick = e => {
    const p = e.target.closest('[data-rq-play]'), r = e.target.closest('[data-rq-rm]');
    if (p) send({ t: 'queue_play', index: +p.dataset.rqPlay });
    if (r) send({ t: 'queue_remove', index: +r.dataset.rqRm });
  };

  $('#roomMembers').onclick = e => {
    const h = e.target.closest('[data-rm-host]'), k = e.target.closest('[data-rm-kick]');
    if (h) send({ t: 'transfer', uid: h.dataset.rmHost });
    if (k && confirm('Mời bạn này ra khỏi phòng?')) send({ t: 'kick', uid: k.dataset.rmKick });
  };

  $('#roomChatForm').onsubmit = e => {
    e.preventDefault();
    const v = e.target.t.value.trim();
    if (!v) return;
    send({ t: 'chat', text: v });
    e.target.reset();
  };

  $('#roomReacts').innerHTML = REACTS.map(x => `<button type="button" class="rr" data-emoji="${x}" aria-label="Gửi ${x}">${x}</button>`).join('');
  $('#roomReacts').onclick = e => {
    const b = e.target.closest('[data-emoji]');
    if (b) send({ t: 'react', emoji: b.dataset.emoji });
  };

  /* ========== KHỞI CHẠY ========== */
  renderAvatars();
  renderRecent2();

  // Link mời: /?room=ID  (chạy sau khi `Room` khởi tạo xong, vì go() gọi Room.onShow)
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => {
      go('room');
      $('#roomJoinForm').id.value = invited.toUpperCase().slice(0, 20);
      api('/api/rooms/' + encodeURIComponent(invited)).then(info => {
        if (info.locked) {
          $('#roomJoinForm').pw.focus();
          toast('Phòng có mật khẩu, nhập mật khẩu rồi bấm Vào phòng nha ♡');
        } else if (me.name) {
          joinFromLobby(info.id, '');
        } else {
          $('#rmName').focus();
          toast('Đặt tên của bạn rồi bấm Vào phòng nha ♡');
        }
      }).catch(err => toast(err.message));
    }, 0);
  }

  return { send, toggle, seek, ended, playTrack, addTrack, onShow };
})();
