"""USB serial transport (pyserial).

Axpert King / Phocos inverters that present a `/dev/ttyUSB*` CDC-ACM device use this.
Blocking pyserial calls are pushed to a thread so they don't stall the event loop.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import serial

from .base import Transport


class SerialTransport(Transport):
    def __init__(
        self,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 2400,
        timeout: float = 3.0,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: int = 1,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.bytesize = bytesize
        self.parity = parity
        self.stopbits = stopbits
        self._serial: Optional[serial.Serial] = None
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        if self._serial and self._serial.is_open:
            return
        self._serial = await asyncio.to_thread(
            serial.Serial,
            self.port,
            self.baudrate,
            timeout=self.timeout,
            bytesize=self.bytesize,
            parity=self.parity,
            stopbits=self.stopbits,
        )

    async def close(self) -> None:
        if self._serial and self._serial.is_open:
            await asyncio.to_thread(self._serial.close)
        self._serial = None

    async def query(self, payload: bytes, *, expect_terminator: bytes = b"\r") -> bytes:
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                await self.open()
            return await asyncio.to_thread(self._query_blocking, payload, expect_terminator)

    def _query_blocking(self, payload: bytes, terminator: bytes) -> bytes:
        assert self._serial is not None
        self._serial.reset_input_buffer()
        self._serial.write(payload)
        self._serial.flush()
        return self._serial.read_until(terminator)
