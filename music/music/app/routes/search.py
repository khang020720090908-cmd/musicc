from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.services import ytdlp_service as svc

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/youtube/search")
async def youtube_search(q: str = Query(..., min_length=1, max_length=200)):
    return {"results": await run_in_threadpool(svc.search, "youtube", q)}


@router.get("/soundcloud/search")
async def soundcloud_search(q: str = Query(..., min_length=1, max_length=200)):
    return {"results": await run_in_threadpool(svc.search, "soundcloud", q, 12)}
