from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.routes import download, search, stream
from app.services.ytdlp_service import HAS_FFMPEG, ServiceError

BASE = Path(__file__).parent
app = FastAPI(title="Media Hub")
templates = Jinja2Templates(directory=BASE / "templates")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
for r in (search.router, stream.router, download.router):
    app.include_router(r)


@app.exception_handler(ServiceError)
async def service_error(_: Request, exc: ServiceError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.get("/api/health")
async def health():
    return {"ok": True, "ffmpeg": HAS_FFMPEG}


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")
