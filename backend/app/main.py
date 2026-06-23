"""FastAPI application: REST + WebSocket API and lifecycle wiring.

Data flow:
    hardware -> Transport -> Device.poll() -> Reading -> Poller -> EventBus
             -> (REST snapshot)  /api/readings
             -> (live stream)    /ws

Devices are discovered and configured at runtime from the frontend (scan USB ports,
attach an inverter/BMS, enable/disable, remove). The manager persists them, so nothing
needs to be set via env vars or compose files.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import Body, FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .core.bus import bus
from .core.energy_store import EnergyStore
from .core.manager import DeviceManager
from .core.poller import Poller
from .core.ports import list_bridges, register_bridge

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("solar-assistant")

manager: DeviceManager | None = None
energy_store: EnergyStore | None = None


async def _flush_energy(store: EnergyStore) -> None:
    while True:
        await asyncio.sleep(settings.energy_flush_interval)
        try:
            await asyncio.to_thread(store.flush)
        except Exception:  # noqa: BLE001 - keep aggregation alive after transient DB errors
            log.exception("Failed to flush daily energy aggregates")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager, energy_store
    energy_store = EnergyStore(
        settings.energy_db_path,
        settings.timezone,
        settings.energy_retention_days,
    )
    flush_task = asyncio.create_task(_flush_energy(energy_store))
    poller = Poller(interval=settings.poll_interval, energy_store=energy_store)
    manager = DeviceManager(poller, settings.store_path)
    await manager.start()
    try:
        yield
    finally:
        flush_task.cancel()
        await asyncio.gather(flush_task, return_exceptions=True)
        await poller.stop()
        await asyncio.to_thread(energy_store.close)


app = FastAPI(title="Solar Assistant", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _mgr() -> DeviceManager:
    if manager is None:
        raise HTTPException(503, "manager not ready")
    return manager


def _energy() -> EnergyStore:
    if energy_store is None:
        raise HTTPException(503, "energy store not ready")
    return energy_store


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


# --- discovery & configuration -------------------------------------------
@app.get("/api/ports")
async def ports() -> dict:
    """USB serial / HID devices currently present on the host (re-scanned live)."""
    return {"ports": _mgr().list_ports()}


@app.get("/api/bridge")
async def bridge_list() -> dict:
    """Host USB bridges the backend currently knows about (self-registered + any pinned)."""
    return {"bridges": list_bridges()}


@app.post("/api/bridge/register")
async def bridge_register(payload: Dict[str, Any] = Body(...)) -> dict:
    """A host USB bridge announces its discovery feed here so the backend learns its
    address automatically — no SA_BRIDGE_URL / manual IP needed. The bridge re-posts
    periodically as a heartbeat; entries that stop posting expire (see BRIDGE_TTL)."""
    url = payload.get("url")
    if not url:
        raise HTTPException(400, "missing 'url'")
    register_bridge(url)
    return {"status": "ok", "url": url}


@app.get("/api/drivers")
async def drivers() -> dict:
    return {"drivers": _mgr().list_drivers()}


@app.get("/api/devices")
async def list_devices() -> dict:
    return {"devices": _mgr().list_devices()}


@app.post("/api/devices", status_code=201)
async def add_device(cfg: Dict[str, Any] = Body(...)) -> dict:
    try:
        return {"device": await _mgr().add_device(cfg)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.put("/api/devices/{device_id}")
async def update_device(device_id: str, patch: Dict[str, Any] = Body(...)) -> dict:
    try:
        return {"device": await _mgr().update_device(device_id, patch)}
    except KeyError:
        raise HTTPException(404, "device not found")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/devices/{device_id}", status_code=204, response_class=Response)
async def remove_device(device_id: str):
    try:
        await _mgr().remove_device(device_id)
    except KeyError:
        raise HTTPException(404, "device not found")
    return Response(status_code=204)


# --- readings -------------------------------------------------------------
@app.get("/api/readings")
async def readings() -> dict:
    return {"readings": bus.latest()}


@app.get("/api/readings/{device_id}")
async def reading_for(device_id: str) -> dict:
    return {"reading": bus.latest_for(device_id)}


@app.get("/api/energy/daily")
async def daily_energy(date: str | None = None) -> dict:
    return _energy().summary(date)


@app.websocket("/ws/discovery")
async def ws_discovery(websocket: WebSocket) -> None:
    """Push the discovery snapshot (ports + devices + bridges) on an interval so the
    Devices panel stays live over a WebSocket instead of HTTP-polling."""
    await websocket.accept()
    try:
        while True:
            mgr = manager
            if mgr is not None:
                # scan_ports() does blocking bridge HTTP; keep the event loop free.
                payload = await asyncio.to_thread(
                    lambda: {
                        "ports": mgr.list_ports(),
                        "devices": mgr.list_devices(),
                        "bridges": list_bridges(),
                    }
                )
                await websocket.send_json(payload)
            await asyncio.sleep(settings.poll_interval)
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    queue = await bus.subscribe()
    try:
        for snapshot in bus.latest():
            await websocket.send_json(snapshot)
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    finally:
        await bus.unsubscribe(queue)
