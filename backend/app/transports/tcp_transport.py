"""TCP transport.

Talks to a serial device that has been exposed over the network by a bridge. This is
how a container reaches a USB inverter plugged into a macOS/Windows host: Docker there
runs in a VM with no host-USB access, so a small bridge on the host (see
``tools/usb_bridge.py``) republishes the serial port as a TCP socket and the backend
connects to it via ``host.docker.internal``.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from .base import Transport


class TcpTransport(Transport):
    def __init__(
        self,
        host: str = "host.docker.internal",
        port: int = 5500,
        timeout: float = 3.0,
        baud: Optional[int] = None,
    ):
        self.host = host
        self.port = int(port)
        self.timeout = timeout
        # Optional: ask the bridge to open the underlying serial port at this baud.
        self.baud = int(baud) if baud else None
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        if self._writer and not self._writer.is_closing():
            return
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port), self.timeout
        )
        # Per-connection control line (leading NUL marks it; never part of the ASCII
        # inverter protocol). The bridge applies the baud, then relays transparently.
        if self.baud:
            self._writer.write(b"\x00SACONF baud=%d\n" % self.baud)
            await self._writer.drain()

    async def close(self) -> None:
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
        self._reader = self._writer = None

    async def query(self, payload: bytes, *, expect_terminator: bytes = b"\r") -> bytes:
        async with self._lock:
            if not self._writer or self._writer.is_closing():
                await self.open()
            try:
                assert self._writer and self._reader
                self._writer.write(payload)
                await self._writer.drain()
                return await asyncio.wait_for(
                    self._reader.readuntil(expect_terminator), self.timeout
                )
            except Exception:
                # Drop the connection so the next poll reconnects cleanly.
                await self.close()
                raise
