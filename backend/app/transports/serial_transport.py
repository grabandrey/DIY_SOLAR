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

    async def transact(self, payload: bytes, *, read_bytes: int, timeout: Optional[float] = None) -> bytes:
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                await self.open()
            return await asyncio.to_thread(self._transact_blocking, payload, read_bytes, timeout)

    def _transact_blocking(self, payload: bytes, read_bytes: int, timeout: Optional[float]) -> bytes:
        assert self._serial is not None
        if timeout is not None:
            self._serial.timeout = timeout
        try:
            self._serial.reset_input_buffer()
            self._serial.write(payload)
            self._serial.flush()
            return self._serial.read(read_bytes)
        finally:
            if timeout is not None:
                self._serial.timeout = self.timeout

    async def collect(self, payload: bytes, *, duration: float, max_bytes: int = 65536, until=None) -> bytes:
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                await self.open()
            return await asyncio.to_thread(self._collect_blocking, payload, duration, max_bytes, until)

    def _collect_blocking(self, payload: bytes, duration: float, max_bytes: int, until) -> bytes:
        import time as _time
        assert self._serial is not None
        old = self._serial.timeout
        self._serial.timeout = 0.3
        try:
            self._serial.reset_input_buffer()
            self._serial.write(payload)
            self._serial.flush()
            buf = bytearray()
            deadline = _time.monotonic() + duration
            while _time.monotonic() < deadline and len(buf) < max_bytes:
                chunk = self._serial.read(4096)
                if chunk:
                    buf += chunk
                    if until and until(bytes(buf)):
                        break
            return bytes(buf)
        finally:
            self._serial.timeout = old

    async def transact_framed(self, payload: bytes, *, header_len: int, frame_len, timeout=None) -> bytes:
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                await self.open()
            return await asyncio.to_thread(
                self._transact_framed_blocking, payload, header_len, frame_len, timeout
            )

    def _transact_framed_blocking(self, payload, header_len, frame_len, timeout) -> bytes:
        assert self._serial is not None
        if timeout is not None:
            self._serial.timeout = timeout
        try:
            self._serial.reset_input_buffer()
            self._serial.write(payload)
            self._serial.flush()
            header = self._serial.read(header_len)
            if len(header) < header_len:
                return header
            total = frame_len(header)
            rest = self._serial.read(total - header_len) if total > header_len else b""
            return header + rest
        finally:
            if timeout is not None:
                self._serial.timeout = self.timeout
