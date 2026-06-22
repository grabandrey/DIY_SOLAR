"""USB / serial port discovery.

Returns every connectable port the backend can currently reach, so the frontend can
list them and let the user pick a driver per port. Re-scans on every call, so devices
plugged in after startup show up automatically.

Two sources are merged:

* **Local** - serial ports and raw-HID nodes visible to this process. This is what you
  get when the backend runs on the same Linux host the inverter is plugged into.
* **Bridge** - ports published by ``tools/usb_bridge.py`` running on a host that the
  container can't reach USB on directly (macOS/Windows Docker). The bridge auto-detects
  USB serial devices and exposes each over TCP; the backend reads its discovery feed.

Every returned port includes an ``attach`` spec - the exact ``transport`` block to POST
to ``/api/devices`` - so the frontend doesn't need to know how the port is reached.
"""

from __future__ import annotations

import glob
import json
import os
import threading
import time
import urllib.request
from typing import Any, Dict, List

try:
    from serial.tools import list_ports
except Exception:  # pragma: no cover
    list_ports = None

# Optional static bridge feed (back-compat). A bridge on another machine no longer needs
# this: it registers itself at runtime via register_bridge() (POST /api/bridge/register),
# so the backend learns its IP automatically without SA_BRIDGE_URL. Empty disables the
# static default; set it only if you want to hard-pin a bridge.
BRIDGE_URL = os.getenv("SA_BRIDGE_URL", "http://host.docker.internal:5510")

# How long a self-registered bridge stays "active" after its last heartbeat. The bridge
# re-registers well within this window; if it stops (Pi unplugged), it drops off the scan.
BRIDGE_TTL = float(os.getenv("SA_BRIDGE_TTL", "30"))

# url -> last-seen epoch seconds, for bridges that registered themselves.
_registered: Dict[str, float] = {}
_lock = threading.Lock()

# USB ids / descriptions commonly seen on Voltronic-family inverter cables.
_INVERTER_HINTS = ("0665:5161", "voltronic", "axpert", "phocos", "growatt", "cp210", "ch340", "ftdi", "hid")


def register_bridge(url: str) -> None:
    """Record a bridge that announced itself, refreshing its heartbeat timestamp."""
    url = url.rstrip("/")
    with _lock:
        _registered[url] = time.time()


def _active_bridge_urls() -> List[str]:
    """Static default (if set) plus every self-registered bridge still within its TTL."""
    now = time.time()
    with _lock:
        for url, seen in list(_registered.items()):
            if now - seen > BRIDGE_TTL:
                del _registered[url]
        urls = list(_registered)
    if BRIDGE_URL:
        pinned = BRIDGE_URL.rstrip("/")
        if pinned not in urls:
            urls.insert(0, pinned)
    return urls


def list_bridges() -> List[Dict[str, Any]]:
    """Bridges the backend currently knows about, for status/diagnostics in the UI."""
    now = time.time()
    out: List[Dict[str, Any]] = []
    if BRIDGE_URL:
        out.append({"url": BRIDGE_URL.rstrip("/"), "source": "pinned", "seconds_ago": None})
    with _lock:
        for url, seen in sorted(_registered.items()):
            if now - seen <= BRIDGE_TTL:
                out.append({"url": url, "source": "registered", "seconds_ago": round(now - seen, 1)})
    return out


def scan_ports() -> List[Dict[str, Any]]:
    ports = _scan_local()
    ports.extend(_scan_bridge())
    # De-dupe by (source, path) so a port isn't listed twice.
    seen, unique = set(), []
    for p in ports:
        key = (p["source"], p["path"])
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def _scan_local() -> List[Dict[str, Any]]:
    ports: List[Dict[str, Any]] = []

    if list_ports is not None:
        for p in list_ports.comports():
            ports.append(
                {
                    "source": "local",
                    "transport": "serial",
                    "path": p.device,
                    "description": p.description or "",
                    "manufacturer": getattr(p, "manufacturer", None),
                    "vid": f"{p.vid:04x}" if p.vid else None,
                    "pid": f"{p.pid:04x}" if p.pid else None,
                    "likely_inverter": _looks_like_inverter(p.description, getattr(p, "manufacturer", ""), p.hwid),
                    "attach": {"type": "serial", "params": {"port": p.device}},
                }
            )

    for path in sorted(glob.glob("/dev/hidraw*")):
        ports.append(
            {
                "source": "local",
                "transport": "hidraw",
                "path": path,
                "description": "Raw HID device",
                "manufacturer": None,
                "vid": None,
                "pid": None,
                "likely_inverter": True,
                "attach": {"type": "hidraw", "params": {"path": path}},
            }
        )

    return ports


def _scan_bridge() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for url in _active_bridge_urls():
        out.extend(_scan_one_bridge(url))
    return out


def _scan_one_bridge(url: str) -> List[Dict[str, Any]]:
    try:
        with urllib.request.urlopen(f"{url}/ports", timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        # Bridge not running / unreachable - simply contribute no remote ports.
        return []

    out: List[Dict[str, Any]] = []
    for p in data.get("ports", []):
        out.append(
            {
                "source": "bridge",
                "transport": "tcp",
                "path": p.get("path", ""),
                "description": p.get("description", ""),
                "manufacturer": p.get("manufacturer"),
                "vid": p.get("vid"),
                "pid": p.get("pid"),
                "likely_inverter": p.get(
                    "likely_inverter",
                    _looks_like_inverter(p.get("description"), p.get("manufacturer"), p.get("path")),
                ),
                # The bridge tells us which host:port re-publishes this serial device.
                "attach": {
                    "type": "tcp",
                    "params": {
                        "host": p.get("bridge_host", _bridge_host(url)),
                        "port": p.get("bridge_port"),
                    },
                },
            }
        )
    return out


def _bridge_host(url: str) -> str:
    # Strip scheme/port from a bridge URL to get the host the container should dial.
    return url.split("//", 1)[-1].split(":", 1)[0].split("/", 1)[0]


def _looks_like_inverter(*fields) -> bool:
    blob = " ".join(str(x).lower() for x in fields if x)
    return any(hint in blob for hint in _INVERTER_HINTS)
