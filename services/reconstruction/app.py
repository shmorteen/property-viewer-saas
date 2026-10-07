"""One-process FastAPI worker. Run a single Uvicorn worker per deployment."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI
from supabase import Client, ClientOptions, create_client

from geometry import build_model, image_size

logger = logging.getLogger("reconstruction")


def client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    if not url.startswith("https://") or not key:
        raise RuntimeError("Set a hosted SUPABASE_URL and server-only service role key")
    # A long-lived poller should avoid HTTP/2 proxy connection corruption on
    # some hosts; HTTP/1.1 is sufficient for these small API requests.
    return create_client(url, key, options=ClientOptions(
        httpx_client=httpx.Client(http2=False, timeout=30)))


def _rows(db: Client, table: str, column: str, value: str) -> list[dict]:
    result = db.table(table).select("*").eq(column, value).execute()
    return result.data or []


def process_job(db: Client, job: dict) -> None:
    job_id, property_id = job["id"], job["property_id"]
    def progress(value: int) -> None:
        db.table("processing_jobs").update({"progress": value}).eq("id", job_id).execute()

    property_rows = _rows(db, "properties", "id", property_id)
    if not property_rows:
        raise ValueError("Property no longer exists")
    property_row = property_rows[0]
    levels = _rows(db, "levels", "property_id", property_id)
    layout_graphs = []
    for level in levels:
        layout_graphs.extend(_rows(db, "layout_graphs", "level_id", level["id"]))
    rooms = _rows(db, "rooms", "property_id", property_id)
    stair_connections: list[dict] = []
    for room in rooms:
        if room.get('space_type') == 'stairs':
            stair_connections.extend(_rows(db, 'stair_connections', 'space_id', room['id']))
    polygons = _rows(db, "room_polygons", "level_id", levels[0]["id"]) if len(levels) == 1 else []
    if len(levels) != 1:
        for level in levels:
            polygons.extend(_rows(db, "room_polygons", "level_id", level["id"]))
    photos: list[dict] = []
    for room in rooms:
        photos.extend(_rows(db, "room_media", "room_id", room["id"]))
    progress(25)
    # Read image headers only. The model links to the existing full-resolution photos.
    for photo in photos:
        try:
            data = db.storage.from_("room-photos").download(photo["storage_path"])
            photo["width"], photo["height"] = image_size(data)
        except Exception as exc:
            logger.warning("Could not inspect photo %s: %s", photo["id"], exc)
    glb, manifest = build_model(property_row, levels, rooms, polygons, photos, layout_graphs, stair_connections)
    progress(70)
    existing = db.table("property_models").select("version").eq("property_id", property_id).order("version", desc=True).limit(1).execute().data or []
    version = (existing[0]["version"] if existing else 0) + 1
    prefix = f"{property_row['organization_id']}/{property_id}/{job_id}"
    glb_path, scene_path = f"{prefix}/model.glb", f"{prefix}/scene.json"
    bucket = db.storage.from_("property-models")
    bucket.upload(glb_path, glb, {"content-type": "model/gltf-binary", "upsert": "false"})
    bucket.upload(scene_path, manifest, {"content-type": "application/json", "upsert": "false"})
    progress(90)
    db.table("property_models").insert({"property_id": property_id, "glb_path": glb_path,
                                         "scene_path": scene_path, "version": version}).execute()
    db.table("processing_jobs").update({"status": "completed", "progress": 100,
        "completed_at": datetime.now(timezone.utc).isoformat()}).eq("id", job_id).execute()


async def poll(db: Client) -> None:
    while True:
        try:
            result = await asyncio.to_thread(lambda: db.rpc("claim_processing_job").execute())
            jobs = result.data or []
            for job in jobs:
                try:
                    await asyncio.to_thread(process_job, db, job)
                except Exception as exc:
                    logger.exception("Model job %s failed", job["id"])
                    await asyncio.to_thread(lambda: db.table("processing_jobs").update({
                        "status": "failed", "error_message": str(exc)[:1000],
                        "completed_at": datetime.now(timezone.utc).isoformat()
                    }).eq("id", job["id"]).execute())
        except Exception:
            logger.exception("Could not poll processing queue")
        await asyncio.sleep(float(os.environ.get("POLL_SECONDS", "5")))


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = client()
    task = asyncio.create_task(poll(db))
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Property reconstruction worker", lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"ok": True}
