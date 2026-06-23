"""Reverse tunnel hub.

Lets a USB bridge running at home (behind NAT) serve devices to a backend in the cloud.
The bridge dials OUT to the backend over a WebSocket (``/ws/bridge``) — an outbound
connection that NAT/firewalls allow — and the backend drives devices *through* that
socket instead of connecting back to the bridge. This is the only way a cloud backend
(e.g. Railway) can reach USB hardware on a home network.

Two things flow over the socket:

* **discovery** - the bridge pushes its port list (``ports`` frames); the backend serves
  it from memory, so it never has to fetch anything back from the (unreachable) bridge.
* **device I/O** - the backend opens a virtual byte-stream *channel* per device
  connection; raw bytes are multiplexed as ``data`` frames in both directions. A channel
  exposes an ``asyncio.StreamReader`` + writer pair, so :class:`TunnelTransport` talks to
  it exactly like :class:`TcpTransport` talks to a real socket.

Frame protocol (JSON text frames):

    bridge -> backend:  {"t":"hello","bridge":<id>}            (first frame, identifies)
                        {"t":"ports","ports":[...]}            (periodic discovery)
                        {"t":"data","ch":N,"b":<hex>}          (device -> backend bytes)
                        {"t":"close","ch":N}                   (device side closed)
    backend -> bridge:  {"t":"open","ch":N,"target":<dev id>}  (start a channel)
                        {"t":"data","ch":N,"b":<hex>}          (backend -> device bytes)
                        {"t":"close","ch":N}                   (tear the channel down)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)

# StreamReader buffer ceiling per channel. Generous so streaming devices (e.g. JK-BMS
# captured with collect()) don't trip the default 64 KiB limit mid-frame.
_READER_LIMIT = 1 << 20


class _ChannelWriter:
    """An ``asyncio.StreamWriter`` look-alike that ships bytes as tunnel ``data`` frames.

    Implements only the surface :class:`TcpTransport` uses: ``is_closing``, ``write``,
    ``drain``, ``close``, ``wait_closed``. Writes are buffered until ``drain`` so each
    request goes out as a single frame (the transport always writes-then-drains).
    """

    def __init__(self, hub: "TunnelHub", bridge_id: str, ch: int):
        self._hub = hub
        self._bridge_id = bridge_id
        self._ch = ch
        self._buf = bytearray()
        self._closing = False

    def is_closing(self) -> bool:
        return self._closing or not self._hub.has_bridge(self._bridge_id)

    def write(self, data: bytes) -> None:
        self._buf += data

    async def drain(self) -> None:
        if not self._buf:
            return
        data = bytes(self._buf)
        self._buf.clear()
        await self._hub._send(self._bridge_id, {"t": "data", "ch": self._ch, "b": data.hex()})

    def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        self._hub._close_channel_soon(self._bridge_id, self._ch)

    async def wait_closed(self) -> None:
        return


class _Bridge:
    """State for one connected bridge: its socket, open channels, and last port list."""

    def __init__(self, bridge_id: str, websocket: Any):
        self.id = bridge_id
        self.ws = websocket
        self.send_lock = asyncio.Lock()
        self.channels: Dict[int, asyncio.StreamReader] = {}
        self._next_ch = 1
        self.ports: List[Dict[str, Any]] = []
        self.seen = time.time()

    def next_ch(self) -> int:
        ch = self._next_ch
        self._next_ch += 1
        return ch


class TunnelHub:
    def __init__(self) -> None:
        self._bridges: Dict[str, _Bridge] = {}

    # --- bridge lifecycle (driven by the /ws/bridge endpoint) ------------
    async def serve(self, websocket: Any) -> None:
        await websocket.accept()
        bridge_id: Optional[str] = None
        try:
            hello = json.loads(await websocket.receive_text())
            if hello.get("t") != "hello" or not hello.get("bridge"):
                await websocket.close()
                return
            bridge_id = str(hello["bridge"])
            # Replace any stale connection with the same id (bridge reconnected).
            existing = self._bridges.get(bridge_id)
            if existing is not None:
                self._fail_bridge(existing)
            br = _Bridge(bridge_id, websocket)
            self._bridges[bridge_id] = br
            log.info("tunnel: bridge %s connected", bridge_id)

            while True:
                self._on_frame(br, json.loads(await websocket.receive_text()))
        except Exception as exc:  # noqa: BLE001  (normal on disconnect)
            log.info("tunnel: bridge %s closed (%s)", bridge_id, exc)
        finally:
            if bridge_id is not None:
                br = self._bridges.get(bridge_id)
                if br is not None and br.ws is websocket:
                    self._fail_bridge(br)
                    self._bridges.pop(bridge_id, None)

    def _on_frame(self, br: _Bridge, frame: Dict[str, Any]) -> None:
        br.seen = time.time()
        t = frame.get("t")
        if t == "ports":
            br.ports = frame.get("ports") or []
        elif t == "data":
            reader = br.channels.get(frame.get("ch"))
            if reader is not None:
                try:
                    reader.feed_data(bytes.fromhex(frame.get("b", "")))
                except Exception:  # noqa: BLE001  (eof already fed)
                    pass
        elif t == "close":
            reader = br.channels.pop(frame.get("ch"), None)
            if reader is not None:
                reader.feed_eof()

    def _fail_bridge(self, br: _Bridge) -> None:
        for reader in br.channels.values():
            try:
                reader.feed_eof()
            except Exception:  # noqa: BLE001
                pass
        br.channels.clear()

    # --- send (serialized per bridge: one WS, many channels) ------------
    async def _send(self, bridge_id: str, frame: Dict[str, Any]) -> None:
        br = self._bridges.get(bridge_id)
        if br is None:
            raise ConnectionError(f"bridge {bridge_id!r} not connected")
        async with br.send_lock:
            await br.ws.send_text(json.dumps(frame))

    async def _safe_send(self, bridge_id: str, frame: Dict[str, Any]) -> None:
        try:
            await self._send(bridge_id, frame)
        except Exception:  # noqa: BLE001
            pass

    def _close_channel_soon(self, bridge_id: str, ch: int) -> None:
        br = self._bridges.get(bridge_id)
        if br is not None:
            br.channels.pop(ch, None)
        asyncio.create_task(self._safe_send(bridge_id, {"t": "close", "ch": ch}))

    # --- channels (called by TunnelTransport) ---------------------------
    def has_bridge(self, bridge_id: str) -> bool:
        return bridge_id in self._bridges

    async def open_channel(
        self, bridge_id: str, target: str, baud: Optional[int] = None
    ) -> Tuple[asyncio.StreamReader, _ChannelWriter]:
        br = self._bridges.get(bridge_id)
        if br is None:
            raise ConnectionError(f"bridge {bridge_id!r} not connected")
        ch = br.next_ch()
        reader = asyncio.StreamReader(limit=_READER_LIMIT)
        br.channels[ch] = reader
        # baud travels in the open frame (not a separate control line) so the bridge can
        # apply it without a timing-sensitive handshake read over a high-latency link.
        frame: Dict[str, Any] = {"t": "open", "ch": ch, "target": target}
        if baud:
            frame["baud"] = int(baud)
        await self._send(bridge_id, frame)
        return reader, _ChannelWriter(self, bridge_id, ch)

    # --- discovery ------------------------------------------------------
    def list_ports(self) -> List[Dict[str, Any]]:
        """Ports advertised by every connected bridge, as ``attach``-ready entries."""
        out: List[Dict[str, Any]] = []
        for br in self._bridges.values():
            for p in br.ports:
                target = p.get("target")
                if not target:
                    continue
                out.append(
                    {
                        "source": "bridge",
                        "transport": "tunnel",
                        "path": p.get("path", ""),
                        "description": p.get("description", ""),
                        "manufacturer": p.get("manufacturer"),
                        "vid": p.get("vid"),
                        "pid": p.get("pid"),
                        "likely_inverter": bool(p.get("likely_inverter")),
                        "attach": {
                            "type": "tunnel",
                            "params": {
                                "bridge": br.id,
                                "target": target,
                                "baud": p.get("baud"),
                            },
                        },
                    }
                )
        return out

    def list_bridges(self) -> List[Dict[str, Any]]:
        now = time.time()
        return [
            {
                "url": f"tunnel://{br.id}",
                "source": "tunnel",
                "seconds_ago": round(now - br.seen, 1),
            }
            for br in self._bridges.values()
        ]


# Process-wide singleton.
hub = TunnelHub()
