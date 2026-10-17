"""Lớp dịch vụ bọc yt-dlp: tìm kiếm, lấy stream URL, tải xuống."""
from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import yt_dlp

ALLOWED_HOSTS = ("youtube.com", "youtu.be", "soundcloud.com")
HAS_FFMPEG = shutil.which("ffmpeg") is not None
BASE = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 15, "retries": 3}
# Tuỳ chọn khi YouTube chặn IP máy chủ / yêu cầu đăng nhập (xem README):
#   YTDLP_COOKIES=/đường/dẫn/cookies.txt   hoặc   YTDLP_COOKIES_BROWSER=chrome
#   YTDLP_YT_CLIENTS=android_vr,tv  (ép client YouTube, phân tách bằng dấu phẩy)
# yt-dlp cần môi trường JS (deno/node) để giải thử thách của YouTube; tự dùng node nếu không có deno.
if not shutil.which("deno") and shutil.which("node"):
    BASE["js_runtimes"] = {"node": {}}
# Link googlevideo bị khoá theo IP lúc trích xuất. Máy dual-stack (IPv4+IPv6) hay trích xuất bằng IPv6 rồi
# tải bằng IPv4 -> 403. Ép dùng một họ địa chỉ: YTDLP_IP=4 (mặc định) | 6 | auto
_ip = os.getenv("YTDLP_IP", "4")
if _ip in ("4", "6"):
    BASE["source_address"] = "0.0.0.0" if _ip == "4" else "::"
if os.getenv("YTDLP_PROXY"):
    BASE["proxy"] = os.environ["YTDLP_PROXY"]  # ví dụ http://user:pass@host:port
if os.getenv("YTDLP_COOKIES"):
    BASE["cookiefile"] = os.environ["YTDLP_COOKIES"]
if os.getenv("YTDLP_COOKIES_BROWSER"):
    BASE["cookiesfrombrowser"] = (os.environ["YTDLP_COOKIES_BROWSER"],)
if os.getenv("YTDLP_YT_CLIENTS"):
    BASE["extractor_args"] = {"youtube": {"player_client": os.environ["YTDLP_YT_CLIENTS"].split(",")}}
AUDIO_FMT = "bestaudio[ext=m4a][protocol^=http]/bestaudio[protocol^=http][protocol!*=m3u8]/bestaudio/best"


class ServiceError(Exception):
    """Lỗi có thông điệp thân thiện để trả về cho client."""


@contextmanager
def _guard():
    try:
        yield
    except yt_dlp.utils.DownloadError as e:
        raise ServiceError(str(e).replace("ERROR: ", "")[:300]) from e


def validate_url(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise ServiceError("Chỉ hỗ trợ liên kết YouTube và SoundCloud.")
    return url


# ---------- Tìm kiếm ----------
def _thumb(info: dict) -> str:
    t = info.get("thumbnail")
    if not t and info.get("thumbnails"):
        t = info["thumbnails"][-1].get("url")
    return (t or "").replace("-large.", "-t300x300.")


def _yt_item(e: dict) -> dict:
    vid = e["id"]
    return {
        "provider": "youtube", "id": vid, "title": e.get("title") or "Không có tiêu đề",
        "artist": e.get("channel") or e.get("uploader") or "", "duration": int(e.get("duration") or 0),
        "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", "url": f"https://www.youtube.com/watch?v={vid}",
    }


def _sc_item(e: dict) -> dict | None:
    info = e
    if not (e.get("title") and e.get("duration")):  # kết quả flat thiếu metadata -> bổ sung
        try:
            with yt_dlp.YoutubeDL(BASE) as y:
                info = y.extract_info(e["url"], download=False)
        except Exception:
            return None
    return {
        "provider": "soundcloud", "id": str(info.get("id")), "title": info.get("title") or "Không có tiêu đề",
        "artist": info.get("uploader") or "", "duration": int(info.get("duration") or 0),
        "thumb": _thumb(info), "url": info.get("webpage_url") or info.get("url"),
    }


def search(provider: str, q: str, limit: int = 20) -> list[dict]:
    prefix = {"youtube": "ytsearch", "soundcloud": "scsearch"}[provider]
    with _guard(), yt_dlp.YoutubeDL({**BASE, "extract_flat": True}) as ydl:
        info = ydl.extract_info(f"{prefix}{limit}:{q}", download=False)
    entries = [e for e in (info.get("entries") or []) if e]
    if provider == "youtube":
        return [_yt_item(e) for e in entries]
    with ThreadPoolExecutor(8) as pool:
        return [r for r in pool.map(_sc_item, entries[:limit]) if r]


# ---------- Stream ----------
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def invalidate(url: str) -> None:
    with _lock:
        _cache.pop(url, None)


_YT_CLIENTS = [None, "android_vr", "tv", "web_safari"]  # None = danh sách client mặc định của yt-dlp (thường tốt nhất)
CACHE_DIR = Path(tempfile.gettempdir()) / "mediahub_cache"


def _extract(url: str, client: str | None) -> dict:
    opts = {**BASE, "format": AUDIO_FMT}
    if client:
        opts["extractor_args"] = {"youtube": {"player_client": [client]}}
    with _guard(), yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def local_addr(link: str) -> str | None:
    """Link googlevideo gắn với IP lúc trích xuất (tham số `ip=`). Ép httpx dùng đúng họ địa chỉ (IPv4/IPv6)
    để không bị 403 do máy dual-stack kết nối bằng IP khác với IP mà yt-dlp đã dùng."""
    ip = (parse_qs(urlparse(link).query).get("ip") or [""])[0]
    return None if not ip else ("::" if ":" in ip else "0.0.0.0")


def _probe(link: str, headers: dict, size: int) -> int:
    """Xin 2 byte ở offset sâu (tới ~5MB). Link thiếu PO token thường cho đoạn đầu nhưng 403 ở đoạn sau."""
    off = max(0, min(size - 2, 5_000_000))
    try:
        with httpx.Client(transport=httpx.HTTPTransport(local_address=local_addr(link)), timeout=15, follow_redirects=True) as c:
            return c.get(link, headers={**headers, "Range": f"bytes={off}-{off + 1}"}).status_code
    except httpx.HTTPError:
        return 0


def resolve(url: str) -> dict:
    """Trả về URL audio dùng được + header (cache 20 phút). Thử lần lượt nhiều client YouTube."""
    validate_url(url)
    with _lock:
        hit = _cache.get(url)
    if hit and hit[0] > time.time():
        return hit[1]
    is_yt = "youtu" in (urlparse(url).hostname or "")
    clients = _YT_CLIENTS if is_yt and "extractor_args" not in BASE else [None]
    last = "không rõ"
    for c in clients:
        try:
            info = _extract(url, c)
        except ServiceError as e:
            last = str(e)
            continue
        if not info.get("url"):
            continue
        headers = {k: v for k, v in (info.get("http_headers") or {}).items() if k.lower() != "accept-encoding"}
        if "m3u8" in (info.get("protocol") or ""):  # HLS: trình duyệt không phát trực tiếp -> để dự phòng tải file
            last = "luồng HLS"
            continue
        # Chỉ YouTube mới cần kiểm tra sâu (PO token). SoundCloud và nguồn khác: dùng luôn.
        code = _probe(info["url"], headers, info.get("filesize") or info.get("filesize_approx") or 6_000_000) if is_yt else 206
        if code in (200, 206, 416):  # 416: file nhỏ hơn offset thử, vẫn dùng được
            out = {"url": info["url"], "title": info.get("title"), "duration": info.get("duration"), "headers": headers}
            with _lock:
                _cache[url] = (time.time() + 1200, out)
            return out
        last = f"HTTP {code} (client {c or 'mặc định'})"
    raise ServiceError(f"Nguồn phát từ chối truy cập: {last}")


def _variants(url: str) -> list:
    is_yt = "youtu" in (urlparse(url).hostname or "")
    return _YT_CLIENTS if is_yt and "extractor_args" not in BASE else [None]


def _run_download(url: str, opts: dict, outdir: Path) -> None:
    """Chạy yt-dlp lần lượt với từng client YouTube cho tới khi tải được."""
    errors: list[str] = []
    for c in _variants(url):
        o = dict(opts)
        if c:
            o["extractor_args"] = {"youtube": {"player_client": [c]}}
        for f in outdir.glob("*"):
            f.unlink(missing_ok=True)  # dọn file dở của lần thử trước
        try:
            with _guard(), yt_dlp.YoutubeDL(o) as ydl:
                ydl.download([url])
            if any(f.suffix not in (".part", ".ytdl") for f in outdir.glob("*")):
                return
        except ServiceError as e:
            errors.append(f"[{c or 'mặc định'}] {e}")
    raise ServiceError(" | ".join(errors)[:500] or "Tải xuống không tạo ra tệp nào.")


def cached_audio(url: str) -> Path:
    """Phương án dự phòng: tải hẳn file âm thanh về cache rồi phát từ đĩa."""
    validate_url(url)
    CACHE_DIR.mkdir(exist_ok=True)
    now = time.time()
    for f in CACHE_DIR.iterdir():
        if f.is_file() and now - f.stat().st_mtime > 3600:
            f.unlink(missing_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    work = CACHE_DIR / key
    done = lambda: [f for f in work.glob("*") if f.suffix not in (".part", ".ytdl")] if work.exists() else []
    if not done():
        work.mkdir(exist_ok=True)
        _run_download(url, {**BASE, "format": "bestaudio[ext=m4a]/bestaudio/best", "outtmpl": str(work / "a.%(ext)s")}, work)
    return done()[0]


# ---------- Tải xuống ----------
def download(url: str, mode: str, height: int = 720) -> tuple[Path, Path]:
    """Tải về thư mục tạm. Trả về (đường dẫn file, thư mục tạm cần xoá sau)."""
    validate_url(url)
    tmp = Path(tempfile.mkdtemp(prefix="mediahub_"))
    opts = {**BASE, "outtmpl": str(tmp / "%(title).150B.%(ext)s")}
    if mode == "mp3":
        opts["format"] = "bestaudio/best"
        if HAS_FFMPEG:
            opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"}]
    else:
        opts["format"] = f"bv*[height<={height}]+ba/b[height<={height}]/b"
        opts["merge_output_format"] = "mp4"
    try:
        _run_download(url, opts, tmp)
        files = [f for f in tmp.iterdir() if f.is_file() and f.suffix not in (".part", ".ytdl")]
        return max(files, key=lambda f: f.stat().st_size), tmp
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
