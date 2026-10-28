"""Phòng nghe chung: trạng thái phòng, đồng bộ phát nhạc, hàng đợi chung, chat.

Mọi thứ lưu trong RAM của tiến trình => chỉ chạy 1 worker (uvicorn mặc định là 1).
Đồng bộ theo "đồng hồ máy chủ": server giữ (vị trí, thời điểm, đang phát?) rồi mỗi client tự tính lại vị trí hiện tại.
"""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import WebSocket

from app.services.ytdlp_service import ServiceError, validate_url

log = logging.getLogger("rooms")

MAX_MEMBERS = 20
MAX_ROOMS = 200
MAX_QUEUE = 100
MAX_CHAT = 100
EMPTY_TTL = 600        # giây: phòng trống quá lâu sẽ bị xoá
GRACE = 8              # giây: chờ người dùng kết nối lại (F5, rớt mạng) trước khi coi là đã rời
ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,20}$")
ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # bỏ ký tự dễ nhầm (0/O, 1/I)
REACTIONS = {"❤️", "😂", "🔥", "👏", "😍", "🎉", "😭", "🥰"}
COMMANDS = {
    "play", "queue_add", "queue_remove", "queue_play", "pause", "resume", "seek", "next", "prev",
    "ended", "settings", "chat", "react", "sync", "kick", "transfer", "clear_queue",
}


class RoomError(Exception):
    """Lỗi có thông điệp thân thiện gửi lại cho người dùng."""


def track_key(t: dict) -> str:
    return f"{t['provider']}:{t['id']}"


def clean_track(raw) -> dict:
    """Không tin dữ liệu từ client: chỉ giữ các trường cần thiết và kiểm tra URL."""
    if not isinstance(raw, dict):
        raise RoomError("Bài hát không hợp lệ.")
    provider = raw.get("provider")
    if provider not in ("youtube", "soundcloud"):
        raise RoomError("Chỉ hỗ trợ bài từ YouTube và SoundCloud.")
    url = str(raw.get("url") or "")[:500]
    try:
        validate_url(url)
    except ServiceError as e:
        raise RoomError(str(e)) from e
    tid = str(raw.get("id") or "")[:100]
    if not tid:
        raise RoomError("Bài hát thiếu mã định danh.")
    thumb = str(raw.get("thumb") or "")[:500]
    if not thumb.startswith(("https://", "http://")):
        thumb = ""
    try:
        duration = max(0, min(int(raw.get("duration") or 0), 86400))
    except (TypeError, ValueError):
        duration = 0
    return {
        "provider": provider, "id": tid, "url": url, "thumb": thumb, "duration": duration,
        "title": (str(raw.get("title") or "Không có tiêu đề").strip() or "Không có tiêu đề")[:200],
        "artist": str(raw.get("artist") or "").strip()[:120],
    }


@dataclass
class Member:
    uid: str
    name: str
    avatar: str
    ws: WebSocket
    joined: float = field(default_factory=time.time)
    msg_times: deque = field(default_factory=lambda: deque(maxlen=5))
    react_times: deque = field(default_factory=lambda: deque(maxlen=8))


class Room:
    def __init__(self, rid: str, name: str, password: str, public: bool):
        self.id = rid
        self.name = name
        self.password = password
        self.public = public
        self.host_uid: str | None = None
        self.members: dict[str, Member] = {}
        self.pending: dict[str, asyncio.Task] = {}
        self.banned: set[str] = set()
        self.queue: list[dict] = []
        self.idx = -1
        self.playing = False
        self._pos = 0.0
        self._stamp = time.monotonic()
        self.open_control = True   # True: ai cũng điều khiển được; False: chỉ chủ phòng
        self.loop = False          # lặp lại hàng đợi khi hết
        self.chat: deque = deque(maxlen=MAX_CHAT)
        self.advanced_at = 0.0
        self.rev = 0
        self._mid = 0
        self.created = time.time()
        self.empty_since: float | None = time.time()

    # ---------- Trạng thái phát ----------
    @property
    def track(self) -> dict | None:
        return self.queue[self.idx] if 0 <= self.idx < len(self.queue) else None

    @property
    def pos(self) -> float:
        p = self._pos + (time.monotonic() - self._stamp if self.playing else 0.0)
        t = self.track
        if t and t["duration"]:
            p = min(p, float(t["duration"]))
        return round(max(0.0, p), 2)

    def _set(self, pos: float | None = None, playing: bool | None = None) -> None:
        cur = self.pos
        self._pos = cur if pos is None else max(0.0, float(pos))
        self._stamp = time.monotonic()
        if playing is not None:
            self.playing = playing
        self.rev += 1

    def snapshot(self, reason: str = "") -> dict:
        return {
            "track": self.track, "queue": self.queue, "idx": self.idx, "playing": self.playing,
            "pos": self.pos, "loop": self.loop, "open_control": self.open_control,
            "rev": self.rev, "reason": reason,
        }

    def member_list(self) -> list[dict]:
        ms = sorted(self.members.values(), key=lambda m: m.joined)
        return [{"uid": m.uid, "name": m.name, "avatar": m.avatar, "host": m.uid == self.host_uid} for m in ms]

    def info(self) -> dict:
        t = self.track
        return {
            "id": self.id, "name": self.name, "members": len(self.members), "public": self.public,
            "locked": bool(self.password), "now_playing": t["title"] if t and self.playing else "",
        }

    # ---------- Gửi tin ----------
    async def _send(self, m: Member, msg: dict) -> None:
        try:
            await m.ws.send_json(msg)
        except Exception:  # kết nối đã chết, vòng nhận của nó sẽ tự dọn
            pass

    async def broadcast(self, msg: dict) -> None:
        await asyncio.gather(*(self._send(m, msg) for m in list(self.members.values())))

    async def push(self, reason: str) -> None:
        await self.broadcast({"t": "state", "s": self.snapshot(reason)})

    async def push_members(self) -> None:
        await self.broadcast({"t": "members", "members": self.member_list(), "host": self.host_uid})

    def _new_msg(self, **kw) -> dict:
        self._mid += 1
        m = {"id": self._mid, "ts": int(time.time() * 1000), **kw}
        self.chat.append(m)
        return m

    async def say(self, text: str) -> None:
        await self.broadcast({"t": "chat", "m": self._new_msg(kind="sys", text=text)})

    # ---------- Thành viên ----------
    async def add_member(self, uid: str, name: str, avatar: str, ws: WebSocket) -> None:
        if uid in self.banned:
            raise RoomError("Bạn đã bị mời ra khỏi phòng này.")
        task = self.pending.pop(uid, None)
        if task:
            task.cancel()
        old = self.members.get(uid)
        if old is None and len(self.members) >= MAX_MEMBERS:
            raise RoomError(f"Phòng đã đầy ({MAX_MEMBERS} người).")
        if old is not None and old.ws is not ws:  # kết nối lại: thay thế kết nối cũ
            try:
                await old.ws.close(4000)
            except Exception:
                pass
        name = (name or "").strip()[:20] or f"Khách {uid[-3:].upper()}"
        m = Member(uid, name, (avatar or "🐱")[:8], ws, joined=old.joined if old else time.time())
        self.members[uid] = m
        self.empty_since = None
        if self.host_uid not in self.members:
            self.host_uid = uid
        await ws.send_json({
            "t": "joined", "you": uid, "host": self.host_uid, "members": self.member_list(),
            "room": {"id": self.id, "name": self.name, "public": self.public, "locked": bool(self.password)},
            "chat": list(self.chat), "s": self.snapshot("join"),
        })
        await self.push_members()
        if old is None:
            await self.say(f"{name} vào phòng ♡")

    def schedule_drop(self, uid: str, ws: WebSocket) -> None:
        m = self.members.get(uid)
        if not m or m.ws is not ws:  # đã bị thay bằng kết nối mới / đã bị đá
            return
        self.pending[uid] = asyncio.create_task(self._drop_later(uid, ws))

    async def _drop_later(self, uid: str, ws: WebSocket) -> None:
        try:
            await asyncio.sleep(GRACE)
        except asyncio.CancelledError:
            return
        m = self.members.get(uid)
        if m and m.ws is ws:
            await self.remove_member(uid, "rời phòng")

    async def remove_member(self, uid: str, verb: str = "rời phòng") -> None:
        t = self.pending.pop(uid, None)
        if t and t is not asyncio.current_task():
            t.cancel()
        m = self.members.pop(uid, None)
        if not m:
            return
        if not self.members:
            self.empty_since = time.time()
            self._set(playing=False)  # không ai nghe thì dừng, tránh "chạy" trong phòng trống
            return
        if self.host_uid == uid:
            self.host_uid = self.member_list()[0]["uid"]
            await self.say(f"{self.members[self.host_uid].name} là chủ phòng mới 👑")
        await self.say(f"{m.name} {verb}")
        await self.push_members()

    # ---------- Quyền ----------
    def _need_control(self, uid: str) -> None:
        if uid != self.host_uid and not self.open_control:
            raise RoomError("Chỉ chủ phòng mới được điều khiển nhạc. Bạn vẫn có thể thêm bài vào hàng đợi nha ♡")

    def _need_host(self, uid: str) -> None:
        if uid != self.host_uid:
            raise RoomError("Chỉ chủ phòng mới làm được việc này.")

    def _index_of(self, k: str) -> int:
        return next((i for i, t in enumerate(self.queue) if track_key(t) == k), -1)

    def _advance(self, auto: bool) -> None:
        self.advanced_at = time.monotonic()
        if not self.queue:
            return
        n = self.idx + 1
        if n >= len(self.queue):
            if self.loop or not auto:
                n = 0
            else:  # hết hàng đợi: dừng ở bài cuối
                self._set(0, False)
                return
        self.idx = n
        self._set(0, True)

    # ---------- Lệnh ----------
    async def handle(self, uid: str, data: dict) -> None:
        cmd = data.get("t")
        if cmd not in COMMANDS or uid not in self.members:
            return
        try:
            await getattr(self, "cmd_" + cmd)(uid, data)
        except RoomError as e:
            await self._send(self.members[uid], {"t": "error", "msg": str(e)})

    async def cmd_play(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        t = clean_track(d.get("track"))
        i = self._index_of(track_key(t))
        if i < 0:
            if len(self.queue) >= MAX_QUEUE:
                raise RoomError("Hàng đợi đầy rồi nè.")
            i = self.idx + 1 if self.idx >= 0 else len(self.queue)
            self.queue.insert(i, t)
        self.idx = i
        self._set(0, True)
        await self.push("jump")
        await self.say(f"{self.members[uid].name} phát “{t['title']}” 🎵")

    async def cmd_queue_add(self, uid: str, d: dict) -> None:
        t = clean_track(d.get("track"))
        if self._index_of(track_key(t)) >= 0:
            raise RoomError("Bài này đã có trong hàng đợi rồi nè ♡")
        if len(self.queue) >= MAX_QUEUE:
            raise RoomError("Hàng đợi đầy rồi nè.")
        self.queue.append(t)
        started = self.idx < 0
        if started:
            self.idx = len(self.queue) - 1
            self._set(0, True)
        await self.push("jump" if started else "queue")
        await self.say(f"{self.members[uid].name} thêm “{t['title']}” vào hàng đợi")

    async def cmd_queue_remove(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        try:
            i = int(d.get("index"))
        except (TypeError, ValueError):
            return
        if not 0 <= i < len(self.queue):
            return
        del self.queue[i]
        reason = "queue"
        if i < self.idx:
            self.idx -= 1
        elif i == self.idx:
            reason = "jump"
            if i < len(self.queue):
                self._set(0)          # bài kế tiếp trượt vào vị trí hiện tại
            else:
                self.idx = -1
                self._set(0, False)
        await self.push(reason)

    async def cmd_clear_queue(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        self.queue.clear()
        self.idx = -1
        self._set(0, False)
        await self.push("jump")

    async def cmd_queue_play(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        try:
            i = int(d.get("index"))
        except (TypeError, ValueError):
            return
        if not 0 <= i < len(self.queue):
            return
        self.idx = i
        self._set(0, True)
        await self.push("jump")

    async def cmd_pause(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        if self.track and self.playing:
            self._set(playing=False)
            await self.push("pause")

    async def cmd_resume(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        if self.track and not self.playing:
            self._set(playing=True)
            await self.push("resume")

    async def cmd_seek(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        t = self.track
        try:
            p = float(d.get("pos"))
        except (TypeError, ValueError):
            return
        if not t or p != p or p in (float("inf"), float("-inf")):
            return
        p = max(0.0, p)
        if t["duration"]:
            p = min(p, float(t["duration"]))
        self._set(p)
        await self.push("seek")

    async def cmd_next(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        self._advance(auto=False)
        await self.push("jump")

    async def cmd_prev(self, uid: str, d: dict) -> None:
        self._need_control(uid)
        if self.pos > 3 or self.idx <= 0:
            self._set(0)
            await self.push("seek")
            return
        self.idx -= 1
        self._set(0, True)
        await self.push("jump")

    async def cmd_ended(self, uid: str, d: dict) -> None:
        """Ai nghe xong trước sẽ báo; tin đến sau (cùng bài, trong 2s) bị bỏ qua."""
        t = self.track
        if not t or not self.playing or track_key(t) != d.get("key"):
            return
        if time.monotonic() - self.advanced_at < 2:
            return
        self._advance(auto=True)
        await self.push("jump")

    async def cmd_settings(self, uid: str, d: dict) -> None:
        if "open_control" in d:
            self._need_host(uid)
            self.open_control = bool(d["open_control"])
            await self.say("Mọi người đều điều khiển được nhạc 🎛️" if self.open_control else "Chỉ chủ phòng điều khiển nhạc 👑")
        if "loop" in d:
            self._need_control(uid)
            self.loop = bool(d["loop"])
        self.rev += 1
        await self.push("settings")

    async def cmd_chat(self, uid: str, d: dict) -> None:
        text = str(d.get("text") or "").strip()[:500]
        if not text:
            return
        m = self.members[uid]
        now = time.monotonic()
        m.msg_times.append(now)
        if len(m.msg_times) == m.msg_times.maxlen and now - m.msg_times[0] < 3:
            raise RoomError("Bạn nhắn nhanh quá, chậm lại xíu nha ♡")
        msg = self._new_msg(kind="msg", uid=uid, name=m.name, avatar=m.avatar, text=text)
        await self.broadcast({"t": "chat", "m": msg})

    async def cmd_react(self, uid: str, d: dict) -> None:
        emoji = d.get("emoji")
        m = self.members[uid]
        now = time.monotonic()
        m.react_times.append(now)
        if emoji not in REACTIONS or (len(m.react_times) == m.react_times.maxlen and now - m.react_times[0] < 4):
            return
        await self.broadcast({"t": "react", "uid": uid, "name": m.name, "emoji": emoji})

    async def cmd_sync(self, uid: str, d: dict) -> None:
        await self._send(self.members[uid], {"t": "sync", "s": self.snapshot("sync")})

    async def cmd_kick(self, uid: str, d: dict) -> None:
        self._need_host(uid)
        target = self.members.get(str(d.get("uid")))
        if not target or target.uid == uid:
            return
        self.banned.add(target.uid)
        await self._send(target, {"t": "kicked"})
        try:
            await target.ws.close(4003)
        except Exception:
            pass
        await self.remove_member(target.uid, "đã bị mời ra khỏi phòng")

    async def cmd_transfer(self, uid: str, d: dict) -> None:
        self._need_host(uid)
        target = self.members.get(str(d.get("uid")))
        if not target or target.uid == uid:
            return
        self.host_uid = target.uid
        await self.say(f"{target.name} là chủ phòng mới 👑")
        await self.push_members()


# ---------- Quản lý các phòng ----------
ROOMS: dict[str, Room] = {}


def _gc() -> None:
    now = time.time()
    for rid in [r.id for r in ROOMS.values() if r.empty_since and now - r.empty_since > EMPTY_TTL]:
        ROOMS.pop(rid, None)


def get_room(rid: str) -> Room | None:
    _gc()
    return ROOMS.get((rid or "").strip().upper())


def create_room(rid: str | None, name: str, password: str, public: bool) -> Room:
    _gc()
    if len(ROOMS) >= MAX_ROOMS:
        raise RoomError("Máy chủ đang có quá nhiều phòng, thử lại sau nha.")
    rid = (rid or "").strip().upper()
    if rid:
        if not ID_RE.match(rid):
            raise RoomError("ID phòng chỉ gồm chữ, số, dấu - hoặc _ (3–20 ký tự).")
        if rid in ROOMS:
            raise RoomError("ID phòng này đã có người dùng rồi, chọn ID khác nha.")
    else:
        while True:
            rid = "".join(secrets.choice(ID_ALPHABET) for _ in range(6))
            if rid not in ROOMS:
                break
    room = Room(rid, (name or "").strip()[:40] or f"Phòng {rid}", password.strip()[:30], public)
    ROOMS[rid] = room
    return room


def public_rooms() -> list[dict]:
    _gc()
    rs = [r for r in ROOMS.values() if r.public and r.members]
    return [r.info() for r in sorted(rs, key=lambda r: -len(r.members))][:30]
