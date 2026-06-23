"""Reverse-tunnel transport.

Reaches a device through a bridge that dialed OUT to us (see ``app/core/tunnel.py``).
Behaves exactly like :class:`TcpTransport` — same query/transact/framed/collect logic —
but its byte stream is a multiplexed channel over the bridge's WebSocket instead of a
direct socket. That is what makes a cloud backend able to read USB hardware sitting
behind a home NAT: we never connect *to* the bridge, the bridge connects to us.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from ..core.tunnel import hub
from .tcp_transport import TcpTransport


class TunnelTransport(TcpTransport):
    def __init__(self, bridge: str, target: str, baud: Optional[int] = None, timeout: float = 3.0):
        self.bridge = bridge
        self.target = target
        self.timeout = timeout
        # Optional: ask the bridge to open the underlying serial port at this baud. Sent
        # as the same leading control line TcpTransport uses, which the bridge consumes.
        self.baud = int(baud) if baud else None
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer = None
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        if self._writer and not self._writer.is_closing():
            return
        # baud is delivered via the open frame; the bridge applies it before relaying.
        self._reader, self._writer = await hub.open_channel(self.bridge, self.target, self.baud)
