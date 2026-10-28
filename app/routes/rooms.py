"""REST (tạo/xem phòng) + WebSocket (/ws/room/{id}) cho tính năng nghe chung."""
import json
import logging
import secrets

from fastapi import APIRouter, HTTPException, Query, WebSocket
from pydantic import BaseModel, Field

from app.services import rooms as rm

log = logging.getLogger("rooms")
router = APIRouter(tags=["rooms"])


class CreateBody(BaseModel):
    id: str | None = Field(None, max_length=20)
    name: str = Field("", max_length=40)
    password: str = Field("", max_length=30)
    public: bool = False


@router.post("/api/rooms")
async def create_room(b: CreateBody):
    try:
        room = rm.create_room(b.id, b.name, b.password, b.public)
    except rm.RoomError as e:
        raise HTTPException(400, str(e)) from e
    return room.info()


@router.get("/api/rooms")
async def list_rooms():
    return {"rooms": rm.public_rooms()}


@router.get("/api/rooms/{rid}")
async def room_info(rid: str):
    room = rm.get_room(rid)
    if not room:
        raise HTTPException(404, "Không tìm thấy phòng này, kiểm tra lại ID nha.")
    return room.info()


@router.websocket("/ws/room/{rid}")
async def room_ws(
    ws: WebSocket, rid: str,
    uid: str = Query(..., min_length=8, max_length=40, pattern=r"^[\w-]+$"),
    name: str = Query("", max_length=20),
    avatar: str = Query("", max_length=8),
    pw: str = Query("", max_length=30),
):
    await ws.accept()

    async def fatal(msg: str, code: int) -> None:
        await ws.send_json({"t": "fatal", "msg": msg})
        await ws.close(code)

    room = rm.get_room(rid)
    if not room:
        return await fatal("Không tìm thấy phòng này, kiểm tra lại ID nha.", 4004)
    if room.password and not secrets.compare_digest(room.password.encode(), pw.encode()):
        return await fatal("Sai mật khẩu phòng rồi nè.", 4001)
    try:
        await room.add_member(uid, name, avatar, ws)
    except rm.RoomError as e:
        return await fatal(str(e), 4002)

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            raw = msg.get("text")
            if not raw or len(raw) > 20_000:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if isinstance(data, dict):
                await room.handle(uid, data)
    except Exception as e:  # noqa: BLE001 - kết nối rớt đột ngột
        log.debug("ws %s/%s kết thúc: %s", rid, uid, e)
    finally:
        room.schedule_drop(uid, ws)
