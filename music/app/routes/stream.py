"""Phát audio qua cùng origin. Thứ tự: proxy từng đoạn Range -> (nếu bị từ chối) tải file về cache rồi phát."""
import logging
import re

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.services import ytdlp_service as svc

log = logging.getLogger("stream")
router = APIRouter(prefix="/api/stream", tags=["stream"])
CHUNK = 4 * 1024 * 1024
MIME = {".m4a": "audio/mp4", ".webm": "audio/webm", ".mp3": "audio/mpeg", ".opus": "audio/ogg", ".ogg": "audio/ogg"}


@router.get("/info")
async def stream_info(url: str = Query(...)):
    info = await run_in_threadpool(svc.resolve, url)
    return {"title": info["title"], "duration": info["duration"]}


async def _from_cache(url: str):
    path = await run_in_threadpool(svc.cached_audio, url)  # ném ServiceError -> 400 nếu cũng thất bại
    return FileResponse(path, media_type=MIME.get(path.suffix, "application/octet-stream"))


@router.get("/audio")
async def stream_audio(request: Request, url: str = Query(...)):
    try:
        info = await run_in_threadpool(svc.resolve, url)
    except svc.ServiceError as e:
        log.warning("resolve thất bại (%s) -> dùng file cache", e)
        return await _from_cache(url)

    m = re.match(r"bytes=(\d+)-", request.headers.get("range", ""))
    start = int(m.group(1)) if m else 0
    client = httpx.AsyncClient(timeout=httpx.Timeout(20, read=60), follow_redirects=True, headers=info["headers"],
                               transport=httpx.AsyncHTTPTransport(local_address=svc.local_addr(info["url"])))

    async def fetch(a: int) -> httpx.Response:
        return await client.get(info["url"], headers={"Range": f"bytes={a}-{a + CHUNK - 1}"})

    try:
        first = await fetch(start)
    except httpx.HTTPError as e:
        first = None
        log.warning("Lỗi kết nối nguồn: %s", e)
    if first is None or first.status_code not in (200, 206):
        await client.aclose()
        svc.invalidate(url)
        log.warning("Nguồn trả HTTP %s -> dùng file cache", first.status_code if first else "lỗi")
        return await _from_cache(url)

    ctype = first.headers.get("content-type", "audio/mp4")
    if first.status_code == 200:
        await client.aclose()
        return Response(first.content, media_type=ctype, headers={"Accept-Ranges": "none"})
    total = int(first.headers["content-range"].rsplit("/", 1)[1])

    async def body():
        try:
            yield first.content
            pos = start + len(first.content)
            while pos < total:
                part = await fetch(pos)
                if part.status_code not in (200, 206) or not part.content:
                    break
                yield part.content
                pos += len(part.content)
        finally:
            await client.aclose()

    return StreamingResponse(body(), status_code=206, media_type=ctype, headers={
        "Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{total - 1}/{total}",
        "Content-Length": str(total - start)})
