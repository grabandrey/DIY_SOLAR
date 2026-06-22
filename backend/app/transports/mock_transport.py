"""Mock transport so the stack runs end-to-end without hardware.

Returns canned Voltronic-style responses with valid CRCs and a bit of jitter so the
dashboard shows live-looking data. Set the inverter transport ``type: mock`` to use it.
"""

from __future__ import annotations

import asyncio
import random

from ..protocols import voltronic
from .base import Transport


class MockTransport(Transport):
    def __init__(self, jitter: bool = True):
        self.jitter = jitter
        self._open = False

    async def open(self) -> None:
        self._open = True

    async def close(self) -> None:
        self._open = False

    async def query(self, payload: bytes, *, expect_terminator: bytes = b"\r") -> bytes:
        await asyncio.sleep(0.05)
        cmd = payload.split(b"\x17")[0].rstrip(b"\r")[:6].decode(errors="ignore").strip()

        if cmd.startswith("QPIGS"):
            body = self._qpigs_body()
        elif cmd.startswith("QPIRI"):
            body = "230.0 21.7 230.0 50.0 21.7 5000 5000 48.0 46.0 42.0 56.4 54.0 2 30 60 0 2 1 9 0 1 0 54.0 0 1"
        elif cmd.startswith("QMOD"):
            body = "B"
        elif cmd.startswith("QPIWS"):
            body = "00000000000000000000000000000000000000"
        else:
            body = "NAK"
        return voltronic.frame_response(body)

    def _qpigs_body(self) -> str:
        def j(base, spread):
            return base + (random.uniform(-spread, spread) if self.jitter else 0)

        grid_v = j(230.0, 2)
        out_w = int(j(1200, 300))
        load_pct = int(j(24, 6))
        bat_v = j(51.2, 0.4)
        bat_chg = int(j(12, 5))
        bat_cap = int(j(78, 3))
        pv_v = j(320.0, 15)
        pv_w = int(j(1800, 400))
        pv_i = round(pv_w / max(pv_v, 1), 1)
        temp = int(j(38, 3))
        # QPIGS field order (Voltronic):
        return (
            f"{grid_v:05.1f} 50.0 {grid_v:05.1f} 50.0 {out_w:04d} {out_w:04d} "
            f"{load_pct:03d} 420 {bat_v:05.2f} {bat_chg:03d} {bat_cap:03d} {temp:04d} "
            f"{pv_i:04.1f} {pv_v:05.1f} {bat_v:05.2f} 00000 00010101 00 00 {pv_w:05d} 010"
        )
