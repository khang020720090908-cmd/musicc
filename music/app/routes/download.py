import shutil
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.services import ytdlp_service as svc

router = APIRouter(prefix="/api/download", tags=["download"])


async def _send(url: str, mode: str, height: int = 720) -> FileResponse:
    path, tmp = await run_in_threadpool(svc.download, url, mode, height)
    return FileResponse(path, filename=path.name, background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True))


@router.get("/youtube")
async def download_youtube(
    video_id: str | None = Query(None, pattern=r"^[\w-]{6,20}$"),
    url: str | None = None,
    mode: Literal["mp3", "video"] = "video",
    height: int = Query(720, ge=144, le=4320),
):
    target = f"https://www.youtube.com/watch?v={video_id}" if video_id else url
    if not target:
        raise HTTPException(400, "Thiếu video_id hoặc url.")
    return await _send(target, mode, height)


@router.get("/soundcloud")
async def download_soundcloud(url: str = Query(...)):
    return await _send(url, "mp3")
