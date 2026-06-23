"""Runtime device manager.

The single source of truth for which devices exist and how to reach them. Devices are
added/edited/removed from the frontend at runtime; this class validates the config,
(de)activates the matching poller task, and persists everything to a JSON store so the
setup survives restarts. No env vars or hand-edited compose files required.

On first run the store is seeded from the documented ``config/devices.yaml`` defaults
(which include the simulated inverter), then JSON becomes authoritative.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List

from ..config import settings
from .bus import bus
from .ports import scan_ports
from .poller import Poller
from .registry import DRIVERS, build_device, list_public_drivers

log = logging.getLogger(__name__)


class DeviceManager:
    def __init__(self, poller: Poller, store_path: Path):
        self.poller = poller
        self.store_path = store_path
        self._configs: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    # --- lifecycle -------------------------------------------------------
    async def start(self) -> None:
        self._load()
        for cfg in self._configs.values():
            if cfg.get("enabled", True):
                self._activate(cfg)

    def _load(self) -> None:
        if self.store_path.exists():
            data = json.loads(self.store_path.read_text("utf-8") or "{}")
            for cfg in data.get("devices", []):
                self._configs[cfg["id"]] = cfg
            return
        # Seed from YAML defaults on first run.
        for cfg in settings.load_devices():
            cfg.setdefault("id", str(uuid.uuid4())[:8])
            self._configs[cfg["id"]] = cfg
        self._persist()

    def _persist(self) -> None:
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"devices": list(self._configs.values())}
        self.store_path.write_text(json.dumps(payload, indent=2), "utf-8")

    # --- activation ------------------------------------------------------
    def _activate(self, cfg: Dict[str, Any]) -> None:
        try:
            device = build_device(cfg)
            self.poller.add(device)
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to activate %s: %s", cfg.get("id"), exc)

    def _deactivate(self, device_id: str) -> None:
        self.poller.remove_sync(device_id)

    # --- queries ---------------------------------------------------------
    def list_devices(self) -> List[Dict[str, Any]]:
        out = []
        for cfg in self._configs.values():
            latest = bus.latest_for(cfg["id"])
            out.append(
                {
                    **cfg,
                    "online": (latest or {}).get("online", False),
                    "kind": (latest or {}).get("kind"),
                }
            )
        return out

    def list_ports(self) -> List[Dict[str, Any]]:
        return scan_ports()

    def list_drivers(self) -> List[str]:
        return list_public_drivers()

    # --- mutations (called from the API) ---------------------------------
    async def add_device(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        async with self._lock:
            cfg = self._normalize(cfg)
            self._validate(cfg)
            self._configs[cfg["id"]] = cfg
            self._persist()
            if cfg.get("enabled", True):
                self._activate(cfg)
            return cfg

    async def update_device(self, device_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        async with self._lock:
            if device_id not in self._configs:
                raise KeyError(device_id)
            cfg = {**self._configs[device_id], **patch, "id": device_id}
            self._validate(cfg)
            self._configs[device_id] = cfg
            self._persist()
            # Re-apply: stop the old task, start fresh if still enabled.
            self._deactivate(device_id)
            if cfg.get("enabled", True):
                self._activate(cfg)
            return cfg

    async def remove_device(self, device_id: str) -> None:
        async with self._lock:
            if device_id not in self._configs:
                raise KeyError(device_id)
            self._deactivate(device_id)
            del self._configs[device_id]
            self._persist()

    # --- helpers ---------------------------------------------------------
    @staticmethod
    def _normalize(cfg: Dict[str, Any]) -> Dict[str, Any]:
        cfg = dict(cfg)
        cfg.setdefault("id", str(uuid.uuid4())[:8])
        cfg.setdefault("name", cfg["id"])
        cfg.setdefault("enabled", True)
        transport = cfg.get("transport") or {}
        ttype = transport.get("type", "serial")
        params = dict(transport.get("params", {}))
        # Sensible defaults so the frontend only has to send a port/path.
        if ttype == "serial":
            params.setdefault("baudrate", 2400)
        cfg["transport"] = {"type": ttype, "params": params}
        return cfg

    @staticmethod
    def _validate(cfg: Dict[str, Any]) -> None:
        if cfg.get("driver") not in DRIVERS:
            raise ValueError(f"Unknown driver {cfg.get('driver')!r}. Known: {sorted(DRIVERS)}")
        ttype = cfg["transport"]["type"]
        params = cfg["transport"]["params"]
        if ttype == "serial" and not params.get("port"):
            raise ValueError("serial transport requires a 'port'")
        if ttype == "hidraw" and not params.get("path"):
            raise ValueError("hidraw transport requires a 'path'")
        if ttype == "tcp" and not (params.get("host") and params.get("port")):
            raise ValueError("tcp transport requires 'host' and 'port'")
        if ttype == "tunnel" and not (params.get("bridge") and params.get("target")):
            raise ValueError("tunnel transport requires 'bridge' and 'target'")
