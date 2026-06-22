"""Raw HID transport for Axpert/Voltronic inverters that expose `/dev/hidraw*`.

Many Axpert King units enumerate as a USB HID device rather than a serial port. The
Voltronic convention is to write the framed command in 8-byte reports and read back
8-byte reports until a carriage return is seen.
"""

from __future__ import annotations

import asyncio
import os
from typing import Optional

from .base import Transport


class HidRawTransport(Transport):
    def __init__(self, path: str = "/dev/hidraw0", timeout: float = 3.0, report_size: int = 8):
        self.path = path
        self.timeout = timeout
        self.report_size = report_size
        self._fd: Optional[int] = None
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        if self._fd is not None:
            return
        self._fd = await asyncio.to_thread(os.open, self.path, os.O_RDWR | os.O_NONBLOCK)

    async def close(self) -> None:
        if self._fd is not None:
            await asyncio.to_thread(os.close, self._fd)
        self._fd = None

    async def query(self, payload: bytes, *, expect_terminator: bytes = b"\r") -> bytes:
        async with self._lock:
            if self._fd is None:
                await self.open()
            return await asyncio.to_thread(self._query_blocking, payload, expect_terminator)

    def _query_blocking(self, payload: bytes, terminator: bytes) -> bytes:
        assert self._fd is not None
        for i in range(0, len(payload), self.report_size):
            chunk = payload[i : i + self.report_size]
            chunk = chunk.ljust(self.report_size, b"\x00")
            os.write(self._fd, chunk)

        loop_deadline = asyncio.get_event_loop().time if False else None  # noqa: keep blocking
        import time

        deadline = time.monotonic() + self.timeout
        buf = bytearray()
        while time.monotonic() < deadline:
            try:
                data = os.read(self._fd, self.report_size)
            except BlockingIOError:
                time.sleep(0.02)
                continue
            if not data:
                time.sleep(0.02)
                continue
            buf.extend(data)
            if terminator in buf:
                break
        # Trim at terminator and drop HID null padding.
        if terminator in buf:
            buf = buf[: buf.index(terminator) + len(terminator)]
        return bytes(buf.rstrip(b"\x00") + (terminator if terminator in buf else b""))
